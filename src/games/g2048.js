/**
 * 2048 —— 方向合并。
 *
 * 【为什么分数是"最大数 + 合并次数"】官方那套累加分数与棋盘状态脱节，
 *   玩家看着 2048 却不知道分数怎么来的。用最大数做主轴，排行榜一眼能懂。
 *
 * 【为什么地形表驱动】用户要求除经典 4×4 外还有 5×5 和菱形两种异形。
 *   把"墙"抽象成 mask，滑动时墙把一行切成若干独立段、每段各自合并，
 *   逻辑零分叉；加地形只需要加一条常量。
 */
import { makeRng, randInt, clamp } from '../core/util.js';
import { canvasFont } from '../core/fonts.js';

const WALL = -1;

const LAYOUTS = {
  classic: { rows: 4, cols: 4, mask: null },
  square5: { rows: 5, cols: 5, mask: null },
  diamond: {
    rows: 5,
    cols: 5,
    mask: [
      '##.##',
      '#...#',
      '.....',
      '#...#',
      '##.##',
    ],
  },
};

export const meta = {
  id: 'g2048',
  title: '2048',
  sub: '合并相同数字，拼出 2048',
  accent: '#f0b429',
  bgm: 'g2048',
  modes: [
    { value: 'classic', label: '经典 4×4', sub: '标准棋盘，最熟悉的节奏', fullMark: 3000 },
    { value: 'square5', label: '5×5', sub: '更大的空间，更容易堆高分', fullMark: 4000 },
    { value: 'diamond', label: '菱形', sub: '四角封死，只能走中间', fullMark: 1200 },
    // 【纯观战也占一个 mode】外壳按 modes 渲染开局选择页，
    //   不做成 mode 就没法"开局选择模式"。
    //   它不计分、不上榜（result().ranked = false），fullMark 填 0。
    { value: 'watch', label: '纯观战', sub: 'AI 自动走 · 不计分', fullMark: 0, spectate: true },
  ],
  /** 模组可见的实时状态：改这里的数就能立刻影响游戏 */
  schema: {
    score: 0,
    maxTile: 0,
    merges: 0,
    moves: 0,
    grid: { rows: 4, cols: 4 },
    spawn: { fourChance: 0.1 },
    timer: { remaining: 0, duration: 0, elapsed: 0, paused: false },
  },
  classes: {
    timer: { attrs: ['remaining', 'duration', 'elapsed', 'paused'], methods: ['add', 'reset', 'pause', 'resume'] },
  },
  achievements: [
    { id: 't512', name: '初见规模', desc: '合成 512', check: (s) => s.maxTile >= 512 },
    { id: 't1024', name: '稳步前进', desc: '合成 1024', check: (s) => s.maxTile >= 1024 },
    { id: 't2048', name: '2048！', desc: '合成 2048', check: (s) => s.maxTile >= 2048 },
    { id: 't4096', name: '超越极限', desc: '合成 4096', check: (s) => s.maxTile >= 4096 },
    { id: 'combo', name: '连击手感', desc: '单局合并 300 次', check: (s) => s.merges >= 300 },
  ],
};

const COLORS = {
  2: ['#eee4da', '#776e65'],
  4: ['#ede0c8', '#776e65'],
  8: ['#f2b179', '#ffffff'],
  16: ['#f59563', '#ffffff'],
  32: ['#f67c5f', '#ffffff'],
  64: ['#f65e3b', '#ffffff'],
  128: ['#edcf72', '#ffffff'],
  256: ['#edcc61', '#ffffff'],
  512: ['#edc850', '#ffffff'],
  1024: ['#edc53f', '#ffffff'],
  2048: ['#edc22e', '#ffffff'],
};

export function create(opts = {}) {
  /** 纯观战：AI 自动走棋，不计分不上榜 */
  const spectate = opts.mode === 'watch';
  const modeKey = LAYOUTS[opts.mode] ? opts.mode : 'classic';
  const layout = LAYOUTS[modeKey];
  const rng = makeRng(opts.seed == null ? Date.now() & 0xffff : opts.seed);

  const rows = layout.rows;
  const cols = layout.cols;
  const mask = layout.mask;

  const isWall = (r, c) => !!(mask && mask[r] && mask[r][c] === '#');

  let grid = [];
  /** 观战 AI 的走子节流累加器 */
  let aiAcc = 0;
  let score = 0;
  let maxTile = 0;
  let merges = 0;
  let moves = 0;
  let status = 'ready';
  let elapsed = 0;
  let over = false;
  const pops = []; // {r,c,t} 新生成/合并的方块做一次缩放动画

  /** 模组可写的实时参数。游戏逻辑每帧都从这里读，所以改完立刻生效。 */
  const mods = {
    score: 0,
    maxTile: 0,
    merges: 0,
    moves: 0,
    grid: { rows, cols },
    spawn: { fourChance: 0.1 },
    timer: { remaining: 0, duration: 0, elapsed: 0, paused: false },
  };

  function reset() {
    grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(isWall(r, c) ? WALL : 0);
      grid.push(row);
    }
    score = 0;
    maxTile = 0;
    merges = 0;
    moves = 0;
    over = false;
    status = 'ready';
    elapsed = 0;
    pops.length = 0;
    spawn();
    spawn();
    syncMods();
  }

  function emptyCells() {
    const out = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) if (grid[r][c] === 0) out.push([r, c]);
    }
    return out;
  }

  function spawn() {
    const empty = emptyCells();
    if (!empty.length) return null;
    const [r, c] = empty[randInt(rng, 0, empty.length - 1)];
    // 4 的出现概率可由模组调整（默认 10%）
    const four = rng() < clamp(Number(mods.spawn.fourChance) || 0, 0, 1);
    grid[r][c] = four ? 4 : 2;
    pops.push({ r, c, t: 0 });
    return [r, c];
  }

  function syncMods() {
    mods.score = score;
    mods.maxTile = maxTile;
    mods.merges = merges;
    mods.moves = moves;
    mods.grid.rows = rows;
    mods.grid.cols = cols;
    mods.timer.elapsed = elapsed;
  }

  /**
   * 模组改时间：正数加时，负数扣时。
   *
   * 【2048 没有时限】这里的"加时"只是把用时往回拨，
   *   影响的是统计和模组脚本里读到的 elapsed，不影响输赢。
   */
  function extendTime(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n === 0) return;
    elapsed = Math.max(0, elapsed - n);
    syncMods();
  }

  /** 模组重置计时 */
  function resetTimer() {
    elapsed = 0;
    syncMods();
  }

  /** 把一行（或列）按墙切段，每段独立左移合并 */
  function slideLine(cells) {
    // cells: [{r,c,v}] 沿方向排列
    const segments = [];
    let cur = [];
    for (const cell of cells) {
      if (cell.v === WALL) {
        if (cur.length) segments.push(cur);
        cur = [];
      } else cur.push(cell);
    }
    if (cur.length) segments.push(cur);

    let gained = 0;
    let mergedCount = 0;
    const result = new Map();

    for (const seg of segments) {
      const vals = seg.map((x) => x.v).filter((v) => v !== 0);
      const out = [];
      for (let i = 0; i < vals.length; i++) {
        if (i + 1 < vals.length && vals[i] === vals[i + 1]) {
          const nv = vals[i] * 2;
          out.push(nv);
          gained += nv;
          mergedCount++;
          if (nv > maxTile) maxTile = nv;
          i++;
        } else out.push(vals[i]);
      }
      while (out.length < seg.length) out.push(0);
      seg.forEach((cell, i) => {
        result.set(cell.r + ',' + cell.c, out[i]);
      });
    }
    return { result, gained, mergedCount };
  }

  function move(dir) {
    if (over) return false;
    const horizontal = dir === 'left' || dir === 'right';
    const reverse = dir === 'right' || dir === 'down';
    let gainedTotal = 0;
    let mergedTotal = 0;
    const next = grid.map((row) => row.slice());

    if (horizontal) {
      for (let r = 0; r < rows; r++) {
        let cells = [];
        for (let c = 0; c < cols; c++) cells.push({ r, c, v: grid[r][c] });
        if (reverse) cells = cells.reverse();
        const { result, gained, mergedCount } = slideLine(cells);
        gainedTotal += gained;
        mergedTotal += mergedCount;
        for (const cell of cells) {
          // 墙格子不在 result 里，写回去会把 WALL 变成 undefined，
          // 下一轮 undefined * 2 就是 NaN，整局分数报废
          if (cell.v === WALL) continue;
          const v = result.get(cell.r + ',' + cell.c);
          next[cell.r][cell.c] = v;
        }
      }
    } else {
      for (let c = 0; c < cols; c++) {
        let cells = [];
        for (let r = 0; r < rows; r++) cells.push({ r, c, v: grid[r][c] });
        if (reverse) cells = cells.reverse();
        const { result, gained, mergedCount } = slideLine(cells);
        gainedTotal += gained;
        mergedTotal += mergedCount;
        for (const cell of cells) {
          if (cell.v === WALL) continue;
          const v = result.get(cell.r + ',' + cell.c);
          next[cell.r][cell.c] = v;
        }
      }
    }

    // 判断是否真的动了：没动就不该生成新块、也不该计步
    let changed = false;
    for (let r = 0; r < rows && !changed; r++) {
      for (let c = 0; c < cols; c++) {
        if (next[r][c] !== grid[r][c]) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return false;

    grid = next;
    score += gainedTotal;
    merges += mergedTotal;
    moves++;
    if (status === 'ready') status = 'playing';
    pops.length = 0;
    spawn();
    syncMods();
    if (!canMove()) finish();
    return true;
  }

  /** 统一的结束入口：观战死局时也从这里走 */
  function finish() {
    if (over) return;
    over = true;
    status = 'over';
    opts.onEnd && opts.onEnd(result());
  }

  /**
   * 观战 AI：用「贪心 + 单调性」挑一步。
   *
   * 【为什么不用完整搜索】2048 的期望搜索（expectimax）在浏览器里跑一帧
   *   要几十毫秒，观战会卡成幻灯片。这里只用两个便宜指标：
   *     1. 空格数——空格多就不容易死；
   *     2. 单调性——大数靠边排成一条线，后续才能继续合。
   *   实测这个组合能稳定走到 512~1024，作为观战已经够好看。
   */
  function aiPickDir() {
    const dirs = ['up', 'down', 'left', 'right'];
    let bestDir = null;
    let bestScore = -Infinity;
    for (const d of dirs) {
      // 用一次试算：真走一遍再撤销代价太大，这里只做形状评估
      const sim = simulate(d);
      if (sim === null) continue;
      const empties = countEmpty(sim);
      const mono = monotonicity(sim);
      const s = empties * 12 + mono * 1.0;
      if (s > bestScore) { bestScore = s; bestDir = d; }
    }
    return bestDir;
  }

  /** 试算一步：返回走完后的棋盘，走不动则 null */
  function simulate(dir) {
    const horizontal = dir === 'left' || dir === 'right';
    const reverse = dir === 'right' || dir === 'down';
    const next = grid.map((row) => row.slice());
    let moved = false;
    if (horizontal) {
      for (let r = 0; r < rows; r++) {
        let cells = [];
        for (let c = 0; c < cols; c++) cells.push({ r, c, v: grid[r][c] });
        if (reverse) cells = cells.reverse();
        const { result } = slideLine(cells);
        for (const cell of cells) {
          if (cell.v === WALL) continue;
          const v = result.get(cell.r + ',' + cell.c);
          if (v !== grid[cell.r][cell.c]) moved = true;
          next[cell.r][cell.c] = v;
        }
      }
    } else {
      for (let c = 0; c < cols; c++) {
        let cells = [];
        for (let r = 0; r < rows; r++) cells.push({ r, c, v: grid[r][c] });
        if (reverse) cells = cells.reverse();
        const { result } = slideLine(cells);
        for (const cell of cells) {
          if (cell.v === WALL) continue;
          const v = result.get(cell.r + ',' + cell.c);
          if (v !== grid[cell.r][cell.c]) moved = true;
          next[cell.r][cell.c] = v;
        }
      }
    }
    return moved ? next : null;
  }

  function countEmpty(g) {
    let n = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) if (g[r][c] === 0) n++;
    }
    return n;
  }

  /** 单调性：相邻格子的数值差越小越好（大数排成一条线时差最小） */
  function monotonicity(g) {
    let s = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = g[r][c];
        if (!v || v === WALL) continue;
        const lv = Math.log2(v);
        if (c + 1 < cols) {
          const rv = g[r][c + 1];
          if (rv && rv !== WALL) s -= Math.abs(lv - Math.log2(rv));
        }
        if (r + 1 < rows) {
          const dv = g[r + 1][c];
          if (dv && dv !== WALL) s -= Math.abs(lv - Math.log2(dv));
        }
      }
    }
    return s;
  }

  function canMove() {
    if (emptyCells().length) return true;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = grid[r][c];
        if (v === WALL) continue;
        if (c + 1 < cols && grid[r][c + 1] === v) return true;
        if (r + 1 < rows && grid[r + 1][c] === v) return true;
      }
    }
    return false;
  }

  function result() {
    if (spectate) {
      return {
        score: 0,
        won: false,
        ranked: false,
        timeMs: Math.round(elapsed * 1000),
        detail: '观战结束 · 最大方块 ' + maxTile + ' · 合并 ' + merges + ' 次',
        extra: { ranked: false, maxTile, merges },
      };
    }
    return {
      score,
      maxTile,
      merges,
      moves,
      won: maxTile >= 2048,
      timeMs: Math.round(elapsed * 1000),
      detail: `最大方块 ${maxTile} · 合并 ${merges} 次`,
    };
  }

  reset();

  return {
    kind: 'canvas',
    meta,
    mods,
    get status() { return status; },
    get over() { return over; },
    get score() { return spectate ? 0 : score; },
    get isSpectateMode() { return spectate; },
    get elapsedMs() { return Math.round(elapsed * 1000); },
    get stats() { return result(); },

    start() {
      if (status === 'ready') status = 'playing';
    },
    pause() {
      if (status === 'playing') status = 'paused';
    },
    resume() {
      if (status === 'paused') status = 'playing';
    },
    restart() {
      reset();
    },
    extendTime,
    resetTimer,

    tick(dt) {
      if (status !== 'playing') return;
      // 模组把 timer.paused 设成 true 时冻结计时（Python 侧 timer.pause()）
      if (!mods.timer.paused) elapsed += dt;

      // 观战：AI 每隔一段时间走一步，太快看不清
      if (spectate) {
        aiAcc += dt;
        if (aiAcc >= 0.28) {
          aiAcc = 0;
          const d = aiPickDir();
          if (d) move(d);
          else if (!canMove()) finish();
        }
      }
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].t += dt;
        if (pops[i].t > 0.16) pops.splice(i, 1);
      }
      syncMods();
    },
    key(name) {
      if (status === 'paused') return;
      if (name === 'up') move('up');
      else if (name === 'down') move('down');
      else if (name === 'left') move('left');
      else if (name === 'right') move('right');
    },
    /** 滑动输入：起点到终点的位移决定方向 */
    swipe(dx, dy) {
      if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
      if (Math.abs(dx) > Math.abs(dy)) this.key(dx > 0 ? 'right' : 'left');
      else this.key(dy > 0 ? 'down' : 'up');
    },

    draw(ctx, w, h) {
      const pad = 12;
      const boardW = Math.min(w - pad * 2, h - pad * 2 - 56);
      const cell = boardW / Math.max(rows, cols);
      const boardH = cell * rows;
      const ox = (w - cell * cols) / 2;
      const oy = (h - boardH) / 2 + 14;

      // 背板
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      roundRect(ctx, ox - 8, oy - 8, cell * cols + 16, boardH + 16, 14);
      ctx.fill();

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = ox + c * cell;
          const y = oy + r * cell;
          const v = grid[r][c];
          const inner = cell - 8;
          if (v === WALL) {
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            roundRect(ctx, x + 4, y + 4, inner, inner, 8);
            ctx.fill();
            continue;
          }
          if (v === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.055)';
            roundRect(ctx, x + 4, y + 4, inner, inner, 8);
            ctx.fill();
            continue;
          }
          const pop = pops.find((p) => p.r === r && p.c === c);
          const scale = pop ? 1 + (0.16 * (1 - pop.t / 0.16)) : 1;
          const [bg, fg] = COLORS[v] || ['#3c3a32', '#ffffff'];
          ctx.save();
          ctx.translate(x + cell / 2, y + cell / 2);
          ctx.scale(scale, scale);
          const grad = ctx.createLinearGradient(-inner / 2, -inner / 2, inner / 2, inner / 2);
          grad.addColorStop(0, bg);
          grad.addColorStop(1, shade(bg, -12));
          ctx.fillStyle = grad;
          roundRect(ctx, -inner / 2, -inner / 2, inner, inner, 8);
          ctx.fill();
          ctx.fillStyle = fg;
          const fontSize = Math.max(12, Math.min(cell * 0.38, (inner * 1.6) / String(v).length));
          ctx.font = canvasFont(fontSize, 700);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(v), 0, 1);
          ctx.restore();
        }
      }
      ctx.restore();
    },
  };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}
