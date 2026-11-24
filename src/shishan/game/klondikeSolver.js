/**
 * klondikeSolver：诗句华容道（滑块解谜）的参考解法求解器
 * ------------------------------------------------------------
 * 纯函数模块，不依赖 Phaser，可以被场景和 Node 验收脚本直接引用。
 *
 * 为什么要「求解」而不是「挑第一个放错的字」：
 *  滑块谜题里，某个字现在离目标格只有一格，但那一格可能被别的字堵住，
 *  先挪那个「看起来最该放好」的字反而会绕远。玩家真正想知道的其实是
 *  「下一步该动哪一块、往哪边滑」——这只能从一条完整的可行解里读出来。
 *
 * 做法：带权 A*（f = g + W × h）
 *  - h = 同字分组后「字块到目标格」的最小曼哈顿距离之和；
 *    同字块可以互换，所以按字分组做最小匹配（同字很少，直接枚举）。
 *  - 允许一次比最优解多走几步（W > 1），换来毫秒级的响应；
 *    但返回的每一条走法都经过验证，一定能把棋盘排好。
 *  - 超过节点 / 时间上限就放弃，交给调用方退化成「启发式的一步」。
 */

/** 方向中文名（提示文案用） */
export const KLONDIKE_DIRECTION_CN = { up: '上', down: '下', left: '左', right: '右' };

const DEFAULT_OPTIONS = {
  maxNodes: 12000,
  maxMs: 300,
  weight: 3, // 越大越快出解、越不保证最优（实测 12 格内平均 12ms、最慢 ~150ms）
};

/** 取棋盘某一格的汉字（兼容 null / 字符串 / { char } 三种写法） */
function charOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value.char || '');
}

/** 网格下标 → 行列 */
function rowCol(index, cols) {
  return { row: Math.floor(index / cols), col: index % cols };
}

/** 两格之间的曼哈顿距离 */
function distance(a, b, cols) {
  const pa = rowCol(a, cols);
  const pb = rowCol(b, cols);
  return Math.abs(pa.row - pb.row) + Math.abs(pa.col - pb.col);
}

/** 上下左右四格 */
function neighborsOf(index, cols, rows) {
  const { row, col } = rowCol(index, cols);
  const list = [];
  if (col > 0) list.push(index - 1);
  if (col < cols - 1) list.push(index + 1);
  if (row > 0) list.push(index - cols);
  if (row < rows - 1) list.push(index + cols);
  return list;
}

/** from → to 的方向（只处理相邻格） */
export function directionOf(from, to, cols) {
  if (to === from - 1) return 'left';
  if (to === from + 1) return 'right';
  if (to === from - cols) return 'up';
  if (to === from + cols) return 'down';
  return '';
}

/**
 * 同字分组的最小匹配距离：目标字位 ↔ 同字的字块之间，
 * 每个字位挑一个不同的字块，让总曼哈顿距离最小。
 * 同字一般 1~4 个，直接枚举；超过 5 个时退化成贪心（只影响启发式精度）。
 */
function matchDistance(targets, tiles, cols) {
  if (targets.length === 0) return 0;
  if (tiles.length === 0) return targets.length * 20; // 字块缺失（正常不会发生）
  if (targets.length === 1) return distance(targets[0], tiles[0], cols);

  if (targets.length <= 5) {
    const used = new Array(tiles.length).fill(false);
    let best = Infinity;
    const walk = (i, cost) => {
      if (cost >= best) return;
      if (i === targets.length) {
        best = cost;
        return;
      }
      for (let j = 0; j < tiles.length; j += 1) {
        if (used[j]) continue;
        used[j] = true;
        walk(i + 1, cost + distance(targets[i], tiles[j], cols));
        used[j] = false;
      }
    };
    walk(0, 0);
    return best === Infinity ? 0 : best;
  }

  const taken = new Set();
  let total = 0;
  targets.forEach((target) => {
    let best = Infinity;
    let chosen = -1;
    tiles.forEach((tile) => {
      if (taken.has(tile)) return;
      const d = distance(target, tile, cols);
      if (d < best) {
        best = d;
        chosen = tile;
      }
    });
    if (chosen >= 0) {
      taken.add(chosen);
      total += best;
    }
  });
  return total;
}

/** 启发式 h：所有目标字位离「自己的字块」的曼哈顿距离之和 */
function heuristic(board, goalChars, cols) {
  const targets = new Map(); // char → 目标字位下标
  goalChars.forEach((char, index) => {
    const list = targets.get(char) || [];
    list.push(index);
    targets.set(char, list);
  });
  const tiles = new Map(); // char → 字块所在下标
  board.forEach((char, index) => {
    if (!char) return;
    const list = tiles.get(char) || [];
    list.push(index);
    tiles.set(char, list);
  });

  let total = 0;
  targets.forEach((targetList, char) => {
    total += matchDistance(targetList, tiles.get(char) || [], cols);
  });
  return total;
}

/** 极简二叉堆（按 f 升序） */
class NodeHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(node) {
    const items = this.items;
    items.push(node);
    let i = items.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (items[parent].f <= items[i].f) break;
      const swap = items[parent];
      items[parent] = items[i];
      items[i] = swap;
      i = parent;
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      const size = items.length;
      while (true) {
        const left = i * 2 + 1;
        const right = left + 1;
        let small = i;
        if (left < size && items[left].f < items[small].f) small = left;
        if (right < size && items[right].f < items[small].f) small = right;
        if (small === i) break;
        const swap = items[small];
        items[small] = items[i];
        items[i] = swap;
        i = small;
      }
    }
    return top;
  }
}

const nowMs = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

/**
 * 把棋盘的棋子摆成 goalChars（前 charCount 格按阅读顺序排）。
 * @param {Array<string|null|{char:string}>} board 长度 cols×rows，null 表示空位
 * @param {string[]} goalChars
 * @param {number} cols
 * @param {number} rows
 * @param {{maxNodes?:number, maxMs?:number, weight?:number}} options
 * @returns {null|{moves:Array<{from:number,to:number,char:string,direction:string}>,
 *   steps:number, from:number, to:number, char:string, direction:string}}
 */
export function solveKlondikeMove(board, goalChars, cols, rows, options = {}) {
  const { maxNodes, maxMs, weight } = { ...DEFAULT_OPTIONS, ...options };
  const cells = cols * rows;
  const goal = (goalChars || []).map((char) => String(char || ''));
  const count = goal.length;
  if (!cells || !count || count > cells) return null;

  const start = new Array(cells).fill('');
  for (let i = 0; i < cells; i += 1) start[i] = charOf((board || [])[i]);

  const isGoal = (chars) => {
    for (let i = 0; i < count; i += 1) {
      if (chars[i] !== goal[i]) return false;
    }
    return true;
  };
  if (isGoal(start)) return null;

  const keyOf = (chars) => chars.join('\u0001');
  const startedAt = nowMs();

  const root = {
    chars: start,
    g: 0,
    f: heuristic(start, goal, cols) * weight,
    parent: null,
    move: null,
  };

  const heap = new NodeHeap();
  heap.push(root);

  const bestG = new Map();
  bestG.set(keyOf(start), 0);

  const hCache = new Map();
  const hOf = (chars) => {
    const key = keyOf(chars);
    if (hCache.has(key)) return hCache.get(key);
    const value = heuristic(chars, goal, cols);
    hCache.set(key, value);
    return value;
  };

  let nodes = 0;
  while (heap.size > 0) {
    const node = heap.pop();
    nodes += 1;
    if (nodes > maxNodes) break;
    if (nodes % 32 === 0 && nowMs() - startedAt > maxMs) break;

    if (isGoal(node.chars)) {
      const moves = [];
      let cursor = node;
      while (cursor && cursor.move) {
        moves.push(cursor.move);
        cursor = cursor.parent;
      }
      moves.reverse();
      if (moves.length === 0) return null;
      const first = moves[0];
      return {
        moves,
        steps: moves.length,
        from: first.from,
        to: first.to,
        char: first.char,
        direction: first.direction,
      };
    }

    for (let blank = 0; blank < cells; blank += 1) {
      if (node.chars[blank]) continue;
      neighborsOf(blank, cols, rows).forEach((from) => {
        const char = node.chars[from];
        if (!char) return;

        const next = node.chars.slice();
        next[blank] = char;
        next[from] = '';

        const key = keyOf(next);
        const g = node.g + 1;
        const known = bestG.get(key);
        if (known !== undefined && known <= g) return;
        bestG.set(key, g);

        heap.push({
          chars: next,
          g,
          f: g + hOf(next) * weight,
          parent: node,
          move: { from, to: blank, char, direction: directionOf(from, blank, cols) },
        });
      });
    }
  }

  return null;
}

/**
 * 退化提示：求解器超时 / 找不到解时，枚举全部合法走法，
 * 挑「走完之后最接近排好」的那一步，至少保证提示是「动哪一块、往哪边」。
 * @returns {null|{from:number,to:number,char:string,direction:string,steps:null}}
 */
export function fallbackKlondikeMove(board, goalChars, cols, rows) {
  const cells = cols * rows;
  const goal = (goalChars || []).map((char) => String(char || ''));
  const count = goal.length;
  if (!cells || !count) return null;

  const start = new Array(cells).fill('');
  for (let i = 0; i < cells; i += 1) start[i] = charOf((board || [])[i]);

  let pick = null;
  let pickScore = Infinity;
  for (let blank = 0; blank < cells; blank += 1) {
    if (start[blank]) continue;
    neighborsOf(blank, cols, rows).forEach((from) => {
      const char = start[from];
      if (!char) return;

      const next = start.slice();
      next[blank] = char;
      next[from] = '';

      // 优先「直接把对字放进对格」，再看整体距离
      const landed = blank < count && char === goal[blank] ? -12 : 0;
      const score = landed + heuristic(next, goal, cols);
      if (score < pickScore) {
        pickScore = score;
        pick = { from, to: blank, char, direction: directionOf(from, blank, cols), steps: null };
      }
    });
  }
  return pick;
}

/**
 * 提示入口：先求解，失败再退化。
 * @returns {null|{from:number,to:number,char:string,direction:string,steps:number|null,solved:boolean}}
 */
export function hintKlondikeMove(board, goalChars, cols, rows, options = {}) {
  const plan = solveKlondikeMove(board, goalChars, cols, rows, options);
  if (plan) return { ...plan, solved: true };
  return fallbackKlondikeMove(board, goalChars, cols, rows);
}
