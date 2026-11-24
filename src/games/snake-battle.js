/**
 * 贪吃蛇多人局 —— 玩家 + AI 机器人同场竞技，死了可以观战。
 *
 * 【为什么单独一个文件】单人贪吃蛇（snake.js）的逻辑是「一条蛇 + 一个棋盘」，
 *   所有状态都是模块级闭包变量。多人局要同时驱动 N 条蛇、共享一个棋盘、
 *   处理蛇与蛇之间的碰撞，还要在玩家死后继续跑 AI。
 *   硬塞进 snake.js 会把那 350 行全改成「遍历所有蛇」的形式，
 *   单人模式的存档、模组注入、回归测试都会跟着动，风险远大于收益。
 *   所以这里独立实现，snake.js 只在 mode 命中时把 create 转发过来。
 *
 * 【为什么只有 AI 对手】小程序没有实时对战服务器：
 *   network 权限只放行了 6 个 AI 域名，不能开长连接；
 *   云存档是 KV，没有推送能力。所以「多人」只能是本地 AI，
 *   观战也是看 AI 继续打，而不是看别的真人。
 */

import { makeRng, randInt, clamp } from '../core/util.js';
import { canvasFont } from '../core/fonts.js';

/**
 * 各人数档位的棋盘尺寸。
 *
 * 【用户给的规则】8 人局地图两边各 +5 格，7 人局 +3，6 人局 +2，5 人局 +1。
 *   这里的「+N」按每边算，所以边长加 2N（左右各 N）。
 *   2~4 人局不加宽，保持原尺寸。
 *
 * 【为什么要给多人局加宽】原来 5~8 人局全挤在 20~21 格，8 条蛇同时跑
 *   几乎没有回旋余地，开局几步就被围死。地图随人数扩大才合理。
 *
 * 【为什么食物不用跟着加】场上始终只有 1 个果实（见 pickFood），
 *   它不和面积挂钩，所以扩图不会带来食物密度问题。
 */
export const BATTLE_SIZES = {
  2: { cols: 19, rows: 19 },
  3: { cols: 19, rows: 19 },
  4: { cols: 20, rows: 20 },
  // 5 人：每边 +1 → 边长 +2
  5: { cols: 22, rows: 22 },
  // 6 人：每边 +2 → 边长 +4
  6: { cols: 24, rows: 24 },
  // 7 人：每边 +3 → 边长 +6
  7: { cols: 26, rows: 26 },
  // 8 人：每边 +5 → 边长 +10
  8: { cols: 30, rows: 30 },
};

/** 玩家固定用这个颜色；AI 依次取后面的，保证一眼能认出自己 */
const PLAYER_COLOR = { head: '#7bf7b0', body: [74, 217, 145] };
const AI_COLORS = [
  { head: '#7fb4ff', body: [90, 150, 230] },
  { head: '#ffb86b', body: [230, 150, 80] },
  { head: '#ff8fb4', body: [230, 110, 150] },
  { head: '#c69bff', body: [160, 120, 230] },
  { head: '#6be0e0', body: [80, 200, 200] },
  { head: '#e0d96b', body: [200, 190, 90] },
  { head: '#ff9b6b', body: [230, 130, 90] },
];

const DIRS = [
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
];

/**
 * 创建一局多人贪吃蛇。
 * @param {object} opts { mode, seed, players, onEnd }
 *   players = 总人数（含玩家），2..8
 */
export function createBattle(opts = {}) {
  const rng = makeRng(opts.seed == null ? Date.now() & 0xffff : opts.seed);
  /**
   * 【纯观战】整局没有"玩家"这条蛇，全部由 AI 驱动。
   *
   * 用户要的观战是"开局空地图，允许批量增加 npc，地图大小根据全场峰值
   * npc 数来"。所以观战局的人数是可变的：起始 2 条，中途可以随时加。
   * 地图尺寸不能按开局人数定死——那样后面加人就挤爆了。
   * 这里先按传入值开，运行中扩容由 growTo 处理。
   */
  const spectate = opts.spectate === true;
  const total = clamp(Math.round(Number(opts.players) || 2), 2, 8);
  const size = BATTLE_SIZES[total] || BATTLE_SIZES[2];
  // 【为什么是 let】观战局允许中途批量加 NPC，地图要跟着放大。
  //   用 const 的话只能重开一局，观战就断了。
  let cols = size.cols;
  let rows = size.rows;
  // 人数越多每条蛇初始越短，不然开局就撞满
  const initLen = total <= 3 ? 3 : total <= 5 ? 3 : 2;
  // 步进间隔：人多就稍慢一点，给玩家反应时间
  const baseStepMs = 150 - Math.min(30, (total - 2) * 4);

  const mods = {
    score: 0,
    length: initLen,
    speed: 1,
    food: { x: 0, y: 0 },
    grow: { perFood: 1 },
    obstacle: { count: 0 },
    timer: { remaining: 0, duration: 0, elapsed: 0, paused: false },
  };

  /** 所有蛇：[{ id, isPlayer, alive, body, dir, queue, color, eaten, maxLen, ai }] */
  let snakes = [];
  let food = { x: 0, y: 0 };
  let stepAcc = 0;
  let elapsed = 0;
  let status = 'ready';
  let over = false;
  let deathFlash = 0;
  /** 玩家死后的观战对象 id；-1 表示没在观战 */
  let spectateId = -1;
  /** 观战局的 NPC 峰值，决定地图尺寸（只增不减） */
  let peakNpcs = 0;

  function cellKey(x, y) {
    return x + ',' + y;
  }

  /** 所有蛇身占用的格子（含各自尾巴，用于放食物） */
  function occupied() {
    const set = new Set();
    for (const s of snakes) for (const p of s.body) set.add(cellKey(p.x, p.y));
    return set;
  }

  function freeCell() {
    const taken = occupied();
    const pool = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) if (!taken.has(cellKey(x, y))) pool.push({ x, y });
    }
    if (!pool.length) return null;
    return pool[randInt(rng, 0, pool.length - 1)];
  }

  function placeFood() {
    const spot = freeCell();
    if (!spot) return;
    food = spot;
    mods.food.x = food.x;
    mods.food.y = food.y;
  }

  /**
   * 给每条蛇找一个互不重叠的出生点。
   * 【为什么要绕开已有蛇身】8 条蛇如果都从中心生成，
   *   开局第一步就会互相撞死，玩家看到的是「一开局就结束了」。
   *   沿棋盘边缘均匀分布，头朝棋盘中心。
   */
  function spawnSnakes() {
    snakes = [];
    // 沿四周按人数均匀取点，比随机更稳
    const spots = [];
    const perim = [];
    for (let x = 2; x < cols - 2; x += 3) perim.push({ x, y: 2 });
    for (let y = 2; y < rows - 2; y += 3) perim.push({ x: cols - 3, y });
    for (let x = cols - 3; x >= 2; x -= 3) perim.push({ x, y: rows - 3 });
    for (let y = rows - 3; y >= 2; y -= 3) perim.push({ x: 2, y });
    // 均匀抽样，避免全挤在一条边上
    const step = Math.max(1, Math.floor(perim.length / total));
    for (let i = 0; i < total; i++) {
      const p = perim[(i * step) % perim.length];
      spots.push(p);
    }

    for (let i = 0; i < total; i++) {
      // 观战局里没有玩家，第一条也是 NPC
      const isPlayer = !spectate && i === 0;
      const spot = spots[i] || { x: 2 + i, y: 2 };
      // 朝棋盘中心
      const toCenter = {
        x: Math.sign(Math.floor(cols / 2) - spot.x),
        y: Math.sign(Math.floor(rows / 2) - spot.y),
      };
      // 只能水平或垂直，取绝对值大的那个方向
      const dir = Math.abs(toCenter.x) >= Math.abs(toCenter.y)
        ? { x: toCenter.x || 1, y: 0 }
        : { x: 0, y: toCenter.y || 1 };
      const body = [];
      for (let k = 0; k < initLen; k++) {
        body.push({ x: spot.x - dir.x * k, y: spot.y - dir.y * k });
      }
      // 【为什么取模前要先加 length】观战局里 i=0 也是 NPC，
      //   (0 - 1) % 7 = -1，AI_COLORS[-1] 是 undefined，
      //   渲染时读 s.color.body 直接抛 TypeError —— 整个画布白屏。
      //   加一圈再取模保证结果落在 [0, len)。
      const color = isPlayer
        ? PLAYER_COLOR
        : AI_COLORS[(((i - 1) % AI_COLORS.length) + AI_COLORS.length) % AI_COLORS.length];
      snakes.push({
        id: i,
        isPlayer,
        alive: true,
        body,
        dir,
        queue: [],
        color,
        eaten: 0,
        maxLen: initLen,
        // AI 的「思考」间隔，避免每步都做完整搜索
        ai: isPlayer ? null : { thinkAcc: 0, target: null },
      });
    }
  }

  function reset() {
    spawnSnakes();
    stepAcc = 0;
    elapsed = 0;
    status = 'ready';
    over = false;
    deathFlash = 0;
    spectateId = -1;
    peakNpcs = snakes.length;
    placeFood();
    syncMods();
  }

  /**
   * 观战局专用：批量加 NPC，并按峰值人数扩容地图。
   *
   * 【为什么地图要按峰值而不是当前人数】用户的原话是「地图大小根据全场
   *   峰值 npc 数来」。如果按当前人数扩，加 1 个扩一次、死几条又不缩，
   *   地图会在观战过程中反复跳尺寸，视觉上很乱；而按峰值只增不减，
   *   一整局只有一次「变大」，玩家能预期。
   *
   * 【为什么扩容要把所有蛇一起平移】新格子是往四周各加一圈，
   *   旧坐标全部要 +offset 才能保持相对位置；只改 cols/rows 的话
   *   所有蛇会挤在左上角。
   */
  function addNpcs(n) {
    if (!spectate) return 0;
    const want = clamp(Math.round(Number(n) || 0), 1, 40);
    const before = snakes.length;
    // 峰值人数决定地图边长：每条蛇大约要 4x4 的空间才不挤
    const peak = Math.max(peakNpcs, before + want);
    peakNpcs = peak;
    const need = Math.ceil(Math.sqrt(peak * 16));
    const side = clamp(Math.max(need, cols), 19, 80);
    if (side !== cols) growTo(side);
    for (let i = 0; i < want; i++) spawnOne();
    placeFood();
    syncMods();
    return snakes.length - before;
  }

  /** 把棋盘扩到 side×side，所有坐标整体平移，保持相对位置不变 */
  function growTo(side) {
    const dx = Math.floor((side - cols) / 2);
    const dy = Math.floor((side - rows) / 2);
    cols = side;
    rows = side;
    for (const s of snakes) {
      for (const seg of s.body) {
        seg.x += dx;
        seg.y += dy;
      }
    }
    food.x += dx;
    food.y += dy;
  }

  /** 在随机空位放一条 NPC，朝棋盘中心 */
  function spawnOne() {
    const taken = occupied();
    const pool = [];
    for (let y = 2; y < rows - 2; y++) {
      for (let x = 2; x < cols - 2; x++) {
        if (!taken.has(cellKey(x, y))) pool.push({ x, y });
      }
    }
    if (!pool.length) return;
    const spot = pool[randInt(rng, 0, pool.length - 1)];
    const toCenter = {
      x: Math.sign(Math.floor(cols / 2) - spot.x),
      y: Math.sign(Math.floor(rows / 2) - spot.y),
    };
    const dir = Math.abs(toCenter.x) >= Math.abs(toCenter.y)
      ? { x: toCenter.x || 1, y: 0 }
      : { x: 0, y: toCenter.y || 1 };
    const body = [];
    for (let k = 0; k < initLen; k++) {
      const bx = spot.x - dir.x * k;
      const by = spot.y - dir.y * k;
      if (bx < 0 || by < 0 || bx >= cols || by >= rows) break;
      body.push({ x: bx, y: by });
    }
    if (!body.length) return;
    const id = snakes.length ? Math.max(...snakes.map((s) => s.id)) + 1 : 0;
    snakes.push({
      id,
      isPlayer: false,
      alive: true,
      body,
      dir,
      queue: [],
      color: AI_COLORS[((id % AI_COLORS.length) + AI_COLORS.length) % AI_COLORS.length],
      eaten: 0,
      maxLen: body.length,
      ai: { thinkAcc: 0, target: null },
    });
  }

  function player() {
    // 【为什么观战局返回 null 而不是 snakes[0]】
    //   所有"玩家死了没""玩家排第几""玩家得多少分"的判断都靠它。
    //   观战局里 snakes[0] 只是一条普通 NPC，把它当玩家会让
    //   HUD 显示一条 NPC 的分数、并在它死时弹结算——那是错的。
    if (spectate) return null;
    return snakes[0];
  }

  function syncMods() {
    const p = player();
    mods.score = p ? p.eaten * 10 + Math.max(0, p.body.length - initLen) * 2 : 0;
    mods.length = p ? p.body.length : initLen;
    mods.eaten = p ? p.eaten : 0;
    mods.timer.elapsed = elapsed;
    mods.alive = snakes.filter((s) => s.alive).length;
    // 【为什么用 snakes.length 而不是 total】观战局会中途加 NPC，
    //   total 是开局时的数，写死会让 HUD 一直显示旧人数。
    mods.players = snakes.length;
    mods.spectating = spectateId >= 0;
  }

  function extendTime(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n === 0) return;
    elapsed = Math.max(0, elapsed - n);
    syncMods();
  }

  function resetTimer() {
    elapsed = 0;
    syncMods();
  }

  /** 某格是否被任何活着的蛇占据 */
  function cellBlocked(x, y) {
    for (const s of snakes) {
      if (!s.alive) continue;
      for (const p of s.body) if (p.x === x && p.y === y) return true;
    }
    return false;
  }

  /**
   * AI 选方向。
   *
   * 【为什么不做 A* 全局寻路】8 条蛇 × 每步都要重算，21×21 的格子上
   *   开销不小，而且蛇是动态的，算出来的路径下一步就失效了。
   *   这里用「贪心 + 安全检查」：朝食物方向优先，
   *   但先剔除会立刻撞死的方向，再从剩下的里挑一个
   *   「周围空格最多」的（减少自己钻进死胡同的概率）。
   *   这套在 8 人局里表现足够像样，而且每步只扫有限个格子。
   */
  function aiChooseDir(s) {
    const head = s.body[0];
    const options = [];

    for (const d of DIRS) {
      // 不能 180° 掉头
      if (d.x === -s.dir.x && d.y === -s.dir.y) continue;
      let nx = head.x + d.x;
      let ny = head.y + d.y;
      // 多人局一律不穿墙：穿墙会让「包围」失效，也容易让人莫名其妙死
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      // 撞到任意蛇身（含自己的尾巴会让位，这里保守处理也算危险）
      if (cellBlocked(nx, ny)) continue;

      // 空格数：衡量这个方向是不是「开阔」
      let open = 0;
      for (const dd of DIRS) {
        const ax = nx + dd.x;
        const ay = ny + dd.y;
        if (ax < 0 || ay < 0 || ax >= cols || ay >= rows) continue;
        if (!cellBlocked(ax, ay)) open++;
      }

      const dist = Math.abs(nx - food.x) + Math.abs(ny - food.y);
      options.push({ d, open, dist });
    }

    if (!options.length) {
      // 无路可走：随便挑个不是掉头的方向，让它自然撞死
      for (const d of DIRS) {
        if (d.x === -s.dir.x && d.y === -s.dir.y) continue;
        return d;
      }
      return s.dir;
    }

    // 优先朝食物，但空格太少的要降权，避免自杀式直线冲刺
    options.sort((a, b) => {
      const sa = a.dist - a.open * 0.8;
      const sb = b.dist - b.open * 0.8;
      return sa - sb;
    });
    return options[0].d;
  }

  function killSnake(s) {
    if (!s.alive) return;
    s.alive = false;
    // 尸体消失，腾出格子；否则棋盘会被尸体逐渐堵死
    s.body = [];
    if (s.isPlayer) {
      // 【为什么玩家一死就结算，而不是自动观战】
      //   用户的原话是"自己死了就立刻结算并暂停，然后按钮有
      //   <再来一局><继续观战><退出>"。
      //   之前的实现是玩家死后自动接管一条 AI 继续看下去——
      //   玩家并不知道自己在观战，只看到分数不再涨、操作没反应，
      //   以为卡死了。现在死亡即结算，观战变成一个明确的选项。
      checkEnd();
      return;
    }
    checkEnd();
  }

  /** 结束条件：玩家死了且没有观战对象，或只剩一条蛇（玩家还活着就继续） */
  function checkEnd() {
    const alive = snakes.filter((s) => s.alive);
    const p = player();
    // 纯观战局没有"玩家"这条蛇，活到最后一条才结束
    if (!p) {
      if (alive.length <= 1) return finish();
      return;
    }
    // 【玩家一死就立刻结算】用户要求：自己死了就结算并暂停。
    //   原来这里还有一层「自动接管一条 AI 继续看」的分支，
    //   导致玩家死后游戏还在跑、分数不涨、按键没反应，像卡死。
    //   现在死亡即结束；想继续看就走结算层的「继续观战」按钮，
    //   那条路径会显式调用 startSpectate()。
    if (!p.alive) return finish();
    // 玩家还活着且是最后一条 → 赢
    if (alive.length === 1) return finish();
  }

  function finish() {
    if (over) return;
    over = true;
    status = 'over';
    deathFlash = 0.5;
    opts.onEnd && opts.onEnd(result());
  }

  function result() {
    const p = player();
    const alive = snakes.filter((s) => s.alive);
    // 【观战局不产出成绩】没有玩家就没有「我第几名」，
    //   返回 0 分且 ranked=false，外壳据此不上榜、不记最佳。
    if (!p) {
      const rankedS = snakes.slice().sort((a, b) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        return b.body.length - a.body.length || b.eaten - a.eaten;
      });
      const champ = rankedS[0];
      const n = snakes.length;
      return {
        score: 0,
        won: false,
        ranked: false,
        timeMs: Math.round(elapsed * 1000),
        detail: champ
          ? '观战结束 · 冠军长度 ' + champ.body.length + ' · 全场 ' + n + ' 条'
          : '观战结束 · 全场 ' + n + ' 条',
        extra: { ranked: false, players: n, champion: champ ? champ.body.length : 0 },
      };
    }
    const won = Boolean(p.alive && alive.length <= 1);
    // 排名：活着的按长度排，死了的按吃到的排
    const ranked = snakes.slice().sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      return b.body.length - a.body.length || b.eaten - a.eaten;
    });
    const rank = ranked.findIndex((s) => s.isPlayer) + 1;
    return {
      score: p.eaten * 10 + Math.max(0, p.body.length - initLen) * 2,
      won,
      timeMs: Math.round(elapsed * 1000),
      detail: won
        ? `最后一条！长度 ${p.body.length} · 吃了 ${p.eaten} 个`
        : `第 ${rank} 名 / ${total} 人 · 吃了 ${p.eaten} 个`,
      extra: { rank, players: total, eaten: p.eaten, length: p.body.length, won },
    };
  }

  function step() {
    // 先让每条蛇决定方向，再统一移动，避免「先动的占便宜」
    const moves = [];
    for (const s of snakes) {
      if (!s.alive) continue;
      if (s.isPlayer) {
        if (s.queue.length) {
          const nd = s.queue.shift();
          if (nd.x !== -s.dir.x || nd.y !== -s.dir.y) s.dir = nd;
        }
      } else {
        s.dir = aiChooseDir(s);
      }
      const head = s.body[0];
      let nx = head.x + s.dir.x;
      let ny = head.y + s.dir.y;
      moves.push({ s, nx, ny, dead: false });
    }

    // 统一判定：撞墙 / 撞任意蛇身 / 两条蛇头撞同一格
    const headTargets = new Map();
    for (const m of moves) {
      if (m.nx < 0 || m.ny < 0 || m.nx >= cols || m.ny >= rows) {
        m.dead = true;
        continue;
      }
      const k = cellKey(m.nx, m.ny);
      headTargets.set(k, (headTargets.get(k) || 0) + 1);
      if (cellBlocked(m.nx, m.ny)) m.dead = true;
    }
    // 对撞：两条蛇头进同一格，都死
    for (const m of moves) {
      const k = cellKey(m.nx, m.ny);
      if ((headTargets.get(k) || 0) > 1) m.dead = true;
    }

    // 应用移动
    const ateFood = [];
    for (const m of moves) {
      const s = m.s;
      if (m.dead) { killSnake(s); continue; }
      s.body.unshift({ x: m.nx, y: m.ny });
      if (m.nx === food.x && m.ny === food.y) {
        s.eaten++;
        const grow = Math.max(0, Math.round(Number(mods.grow.perFood) || 1));
        for (let i = 0; i < grow; i++) s.body.push({ ...s.body[s.body.length - 1] });
        s.maxLen = Math.max(s.maxLen, s.body.length);
        ateFood.push(s);
      } else {
        s.body.pop();
      }
    }
    if (ateFood.length) placeFood();
    syncMods();
  }

  reset();

  return {
    kind: 'canvas',
    meta: null,
    mods,
    get status() { return status; },
    get over() { return over; },
    get score() { return mods.score; },
    get elapsedMs() { return Math.round(elapsed * 1000); },
    get stats() { return result(); },
    /** 给渲染层用：所有蛇 + 食物 + 棋盘尺寸 */
    get battle() {
      return {
        snakes, food, cols, rows, spectateId,
        playerId: 0,
        aliveCount: snakes.filter((s) => s.alive).length,
      };
    },
    get spectating() { return spectateId >= 0; },

    start() { if (status === 'ready') status = 'playing'; },
    pause() { if (status === 'playing') status = 'paused'; },
    resume() { if (status === 'paused') status = 'playing'; },
    restart() { reset(); },
    extendTime,
    resetTimer,

    /** 观战局：批量加 NPC（会按峰值人数扩地图） */
    addNpcs,

    /**
     * 玩家死后继续观战：把 over 清掉，接管一条还活着的蛇，继续推进。
     *
     * 【为什么返回 boolean】没有活蛇时不能进观战，调用方要能提示用户。
     * 【为什么这里也清 submitted 之外的结算状态】外壳那边用 submitted
     *   标记"本局已结算"，继续观战之后不能再结算一次，所以外壳自己会
     *   把 submitted 置回 true；游戏这边只要保证 over=false、status=playing。
     */
    startSpectate() {
      const alive = snakes.filter((s) => s.alive);
      if (!alive.length) return false;
      over = false;
      status = 'playing';
      spectateId = alive[0].id;
      syncMods();
      return true;
    },
    /** 观战局标记（整局没有玩家），外壳据此隐藏 HUD 分数、不上榜 */
    get isSpectateMode() { return spectate; },

    /** 玩家死后点屏幕切换观战对象 */
    nextSpectate() {
      const alive = snakes.filter((s) => s.alive);
      if (!alive.length) return;
      const cur = alive.findIndex((s) => s.id === spectateId);
      spectateId = alive[(cur + 1) % alive.length].id;
      syncMods();
    },

    tick(dt) {
      if (deathFlash > 0) deathFlash = Math.max(0, deathFlash - dt);
      if (status !== 'playing') return;
      if (!mods.timer.paused) elapsed += dt;
      const speedMul = clamp(Number(mods.speed) || 1, 0.2, 6);
      const stepMs = Math.max(45, baseStepMs / speedMul) / 1000;
      stepAcc += dt;
      let guard = 0;
      while (stepAcc >= stepMs && !over && guard++ < 8) {
        stepAcc -= stepMs;
        step();
      }
      syncMods();
    },

    key(name) {
      if (status === 'paused' || over) return;
      const p = player();
      if (!p || !p.alive) return;
      const map = {
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 },
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 },
      };
      const nd = map[name];
      if (!nd) return;
      if (nd.x === -p.dir.x && nd.y === -p.dir.y) return;
      if (p.queue.length < 2) p.queue.push(nd);
      if (status === 'ready') status = 'playing';
    },

    swipe(dx, dy) {
      if (Math.abs(dx) < 16 && Math.abs(dy) < 16) return;
      if (Math.abs(dx) > Math.abs(dy)) this.key(dx > 0 ? 'right' : 'left');
      else this.key(dy > 0 ? 'down' : 'up');
    },

    draw(ctx, w, h) {
      const padTop = 52;
      const cell = Math.floor(Math.min((w - 24) / cols, (h - padTop - 20) / rows));
      const bw = cell * cols;
      const bh = cell * rows;
      const ox = (w - bw) / 2;
      const oy = padTop + (h - padTop - bh) / 2;

      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fillRect(ox, oy, bw, bh);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if ((x + y) % 2 === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.022)';
            ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
          }
        }
      }

      // 食物
      const pulse = 0.75 + 0.25 * Math.sin(elapsed * 6);
      ctx.save();
      ctx.shadowColor = 'rgba(255,110,110,0.9)';
      ctx.shadowBlur = cell * 0.9 * pulse;
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.arc(ox + food.x * cell + cell / 2, oy + food.y * cell + cell / 2, cell * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 所有蛇：观战对象高亮，其他半透明
      for (const s of snakes) {
        if (!s.alive) continue;
        const isSpectate = s.id === spectateId;
        const dim = spectateId >= 0 && !isSpectate;
        for (let i = s.body.length - 1; i >= 0; i--) {
          const p = s.body[i];
          const t = i / Math.max(1, s.body.length - 1);
          const isHead = i === 0;
          const [r, g, b] = s.color.body;
          if (isHead) {
            ctx.fillStyle = dim ? 'rgba(255,255,255,0.35)' : s.color.head;
          } else {
            const a = (0.9 - t * 0.45) * (dim ? 0.35 : 1);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
          }
          const inset = isHead ? 1 : 2;
          roundRect(ctx, ox + p.x * cell + inset, oy + p.y * cell + inset, cell - inset * 2, cell - inset * 2, cell * 0.26);
          ctx.fill();
        }
        // 观战对象头顶标个三角，方便一眼找到
        if (isSpectate && s.body.length) {
          const hd = s.body[0];
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(ox + hd.x * cell + cell / 2, oy + hd.y * cell - 3);
          ctx.lineTo(ox + hd.x * cell + cell / 2 - 4, oy + hd.y * cell - 9);
          ctx.lineTo(ox + hd.x * cell + cell / 2 + 4, oy + hd.y * cell - 9);
          ctx.closePath();
          ctx.fill();
        }
      }

      // 顶部状态：存活人数 / 观战提示
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = canvasFont(13, 600);
      ctx.textAlign = 'left';
      const aliveN = snakes.filter((s) => s.alive).length;
      ctx.fillText(`存活 ${aliveN} / ${total}`, 14, 24);
      if (spectateId >= 0) {
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,220,120,0.95)';
        ctx.fillText('观战中 · 点击切换', w - 14, 24);
      }
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
