/**
 * 贪吃蛇 —— 网格推进 + 实时转向。
 *
 * 【为什么用"累加器"而不是 setInterval】每帧按 dt 累加到 stepAcc，
 *   超过步进间隔才走一格。这样在不同刷新率（60/120Hz）下速度一致，
 *   暂停/恢复也不用重排定时器。
 *
 * 【为什么排队转向】玩家在一步内连按两次方向键时，直接改 dir 会让蛇
 *   在一步里掉头撞自己；用队列按步消费，输入手感才对。
 */
import { makeRng, randInt, clamp } from '../core/util.js';
import { createBattle, BATTLE_SIZES } from './snake-battle.js';

const MODES = {
  classic: { cols: 17, rows: 17, baseStepMs: 150, label: '经典', wrap: false, obstacles: 0 },
  wrap: { cols: 19, rows: 19, baseStepMs: 140, label: '穿墙', wrap: true, obstacles: 0 },
  maze: { cols: 19, rows: 19, baseStepMs: 160, label: '迷宫', wrap: false, obstacles: 16 },
};

export const meta = {
  id: 'snake',
  title: '贪吃蛇',
  sub: '吃果实变长，别撞到自己',
  accent: '#4ad991',
  // 【为什么没有 bgm 字段】贪吃蛇的音乐是实时合成的（见 games/snake-bgm.js），
  //   不走 mp3 那条链路。留空后外壳会走 synthBgm 分支，
  //   也就不会去 public/bgm/ 找一个已经删掉的 snake.mp3。
  modes: [
    { value: 'classic', label: '经典', sub: '撞墙即结束 · 17×17', fullMark: 120 },
    { value: 'wrap', label: '穿墙', sub: '从一边穿到另一边', fullMark: 140 },
    { value: 'maze', label: '迷宫', sub: '场上有障碍物', fullMark: 100 },
    // 【多人局为什么是独立模式而不是「选项」】
    //   排行榜是按 mode 分榜的（scores.js 的 shortKey = 游戏.模式）。
    //   如果做成选项，8 人局的成绩会和单人局混在同一个榜上，
    //   拿第 1 名和第 8 名没法区分，榜就没有意义了。
    //   拆成独立 mode 后，每种人数各有一个干净的榜。
    { value: 'b2', label: '2 人局', sub: '19×19 · 你 + 1 个 AI', fullMark: 200 },
    { value: 'b3', label: '3 人局', sub: '19×19 · 你 + 2 个 AI', fullMark: 200 },
    { value: 'b4', label: '4 人局', sub: '20×20 · 你 + 3 个 AI', fullMark: 220 },
    { value: 'b5', label: '5 人局', sub: '22×22 · 你 + 4 个 AI', fullMark: 220 },
    { value: 'b6', label: '6 人局', sub: '24×24 · 你 + 5 个 AI', fullMark: 240 },
    { value: 'b7', label: '7 人局', sub: '26×26 · 你 + 6 个 AI', fullMark: 240 },
    { value: 'b8', label: '8 人局', sub: '30×30 · 你 + 7 个 AI', fullMark: 260 },
    // 【文案里不再写「可观战」】死亡结算页的「继续观战」仍然保留，
    //   但不写进模式介绍——开局选模式时强调"可观战"会让人以为
    //   观战是这几种人数组的主要卖点，实际主角还是自己下场玩。
    // 【纯观战为什么也占一个 mode】
    //   外壳按 modes 渲染开局选择页，不做成 mode 就没法"开局选择模式"。
    //   它不计分、不上榜（result().ranked = false），
    //   所以 fullMark 填 0，排行榜和基准分页都不会给它留位置。
    { value: 'watch', label: '纯观战', sub: '空地图开局 · 可随时加 NPC · 不计分', fullMark: 0, spectate: true },
  ],
  schema: {
    score: 0,
    length: 3,
    speed: 1,
    food: { x: 0, y: 0 },
    grow: { perFood: 1 },
    obstacle: { count: 0 },
    timer: { remaining: 0, duration: 0, elapsed: 0, paused: false },
  },
  classes: {
    timer: { attrs: ['remaining', 'duration', 'elapsed', 'paused'], methods: ['add', 'reset', 'pause', 'resume'] },
  },
  achievements: [
    { id: 'len10', name: '小有规模', desc: '长度达到 10', check: (s) => s.maxLen >= 10 },
    { id: 'len25', name: '长蛇', desc: '长度达到 25', check: (s) => s.maxLen >= 25 },
    { id: 'len50', name: '巨蟒', desc: '长度达到 50', check: (s) => s.maxLen >= 50 },
    { id: 'food50', name: '大胃王', desc: '累计吃掉 50 个果实', check: (s) => s.totalFood >= 50 },
  ],
};

export function create(opts = {}) {
  // 【多人局转发】mode 形如 b2..b8 时交给 snake-battle.js。
  //   放在函数最前面，后面的单人逻辑完全不用感知多人的存在。
  // 纯观战：2 条 NPC 空地图开局，地图随加人自动放大
  if (String(opts.mode || '') === 'watch') {
    const battle = createBattle({
      mode: opts.mode,
      seed: opts.seed,
      players: 2,
      spectate: true,
      onEnd: opts.onEnd,
    });
    battle.meta = meta;
    return battle;
  }

  const battleMatch = /^b([2-8])$/.exec(String(opts.mode || ''));
  if (battleMatch) {
    const battle = createBattle({
      mode: opts.mode,
      seed: opts.seed,
      players: Number(battleMatch[1]),
      onEnd: opts.onEnd,
    });
    battle.meta = meta;
    return battle;
  }
  const modeKey = MODES[opts.mode] ? opts.mode : 'classic';
  const cfg = MODES[modeKey];
  const rng = makeRng(opts.seed == null ? Date.now() & 0xffff : opts.seed);

  const cols = cfg.cols;
  const rows = cfg.rows;

  const mods = {
    score: 0,
    length: 3,
    speed: 1,
    food: { x: 0, y: 0 },
    grow: { perFood: 1 },
    obstacle: { count: cfg.obstacles },
    timer: { remaining: 0, duration: 0, elapsed: 0, paused: false },
  };

  let body = [];
  let dir = { x: 1, y: 0 };
  let queue = [];
  let food = { x: 0, y: 0 };
  let obstacles = [];
  let stepAcc = 0;
  let elapsed = 0;
  let status = 'ready';
  let over = false;
  let eaten = 0;
  let maxLen = 3;
  let deathFlash = 0;

  function cellKey(x, y) {
    return x + ',' + y;
  }

  function occupied() {
    const set = new Set();
    for (const p of body) set.add(cellKey(p.x, p.y));
    for (const p of obstacles) set.add(cellKey(p.x, p.y));
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

  function reset() {
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);
    body = [
      { x: cx, y: cy },
      { x: cx - 1, y: cy },
      { x: cx - 2, y: cy },
    ];
    dir = { x: 1, y: 0 };
    queue = [];
    stepAcc = 0;
    elapsed = 0;
    status = 'ready';
    over = false;
    eaten = 0;
    maxLen = 3;
    deathFlash = 0;

    // 障碍物数量可由模组调整
    const want = Math.round(clamp(Number(mods.obstacle.count) || 0, 0, 60));
    obstacles = [];
    for (let i = 0; i < want; i++) {
      const spot = freeCell();
      if (!spot) break;
      // 别把障碍物直接放在蛇头上
      if (Math.abs(spot.x - cx) < 3 && Math.abs(spot.y - cy) < 2) continue;
      obstacles.push(spot);
    }
    placeFood();
    syncMods();
  }

  /**
   * 模组改时间：正数加时，负数扣时。
   *
   * 【贪吃蛇没有时限】加时只影响用时统计和脚本读到的 elapsed。
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

  function syncMods() {
    mods.score = score();
    mods.length = body.length;
    // 【为什么要把 eaten 暴露出去】外壳需要它来调 BGM 的节奏
    //   （吃得越多曲子越快，见 games/snake-bgm.js 的 setIntensity）。
    //   原来 eaten 只是内部变量，外面拿不到。
    mods.eaten = eaten;
    mods.timer.elapsed = elapsed;
  }

  function score() {
    // 分数 = 吃到的果实 × 基础分 + 长度奖励；速度倍率由模组调整
    const speedMul = clamp(Number(mods.speed) || 1, 0.2, 6);
    return Math.round((eaten * 10 + Math.max(0, body.length - 3) * 2) * speedMul);
  }

  function step() {
    if (queue.length) {
      const nd = queue.shift();
      // 禁止 180° 掉头
      if (nd.x !== -dir.x || nd.y !== -dir.y) dir = nd;
    }
    const head = body[0];
    let nx = head.x + dir.x;
    let ny = head.y + dir.y;

    if (cfg.wrap) {
      nx = (nx + cols) % cols;
      ny = (ny + rows) % rows;
    } else if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
      return die();
    }

    if (obstacles.some((o) => o.x === nx && o.y === ny)) return die();
    // 尾巴那一格在同一步里会让出来，所以撞尾不算死
    const tail = body[body.length - 1];
    const hitsSelf = body.some((p, i) => i < body.length - 1 && p.x === nx && p.y === ny);
    if (hitsSelf) return die();

    body.unshift({ x: nx, y: ny });
    if (nx === food.x && ny === food.y) {
      eaten++;
      const grow = Math.max(0, Math.round(Number(mods.grow.perFood) || 1));
      for (let i = 0; i < grow; i++) body.push({ ...body[body.length - 1] });
      maxLen = Math.max(maxLen, body.length);
      placeFood();
      syncMods();
    } else {
      body.pop();
    }
    syncMods();
  }

  function die() {
    over = true;
    status = 'over';
    deathFlash = 0.5;
    opts.onEnd && opts.onEnd(result());
  }

  function result() {
    return {
      score: score(),
      won: false,
      timeMs: Math.round(elapsed * 1000),
      detail: `长度 ${body.length} · 吃了 ${eaten} 个`,
      extra: { length: body.length, eaten },
    };
  }

  reset();

  return {
    kind: 'canvas',
    meta,
    mods,
    get status() { return status; },
    get over() { return over; },
    get score() { return score(); },
    get elapsedMs() { return Math.round(elapsed * 1000); },
    get stats() { return result(); },

    start() {
      if (status === 'ready') status = 'playing';
    },
    pause() { if (status === 'playing') status = 'paused'; },
    resume() { if (status === 'paused') status = 'playing'; },
    restart() { reset(); },

    extendTime,
    resetTimer,

    tick(dt) {
      if (deathFlash > 0) deathFlash = Math.max(0, deathFlash - dt);
      if (status !== 'playing') return;
      // 模组把 timer.paused 设成 true 时冻结计时（Python 侧 timer.pause()）
      if (!mods.timer.paused) elapsed += dt;
      // 速度倍率影响步进间隔；下限 40ms 防止改太快直接穿模
      const speedMul = clamp(Number(mods.speed) || 1, 0.2, 6);
      const stepMs = Math.max(40, cfg.baseStepMs / speedMul) / 1000;
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
      const map = {
        up: { x: 0, y: -1 },
        down: { x: 0, y: 1 },
        left: { x: -1, y: 0 },
        right: { x: 1, y: 0 },
      };
      const nd = map[name];
      if (!nd) return;
      if (nd.x === -dir.x && nd.y === -dir.y) return;
      if (queue.length < 2) queue.push(nd);
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
      // 棋盘格：让格子边界可读，又不抢蛇的视觉
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if ((x + y) % 2 === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.022)';
            ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
          }
        }
      }

      for (const o of obstacles) {
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(ox + o.x * cell + 1, oy + o.y * cell + 1, cell - 2, cell - 2);
      }

      // 食物：呼吸光晕
      const pulse = 0.75 + 0.25 * Math.sin(elapsed * 6);
      ctx.save();
      ctx.shadowColor = 'rgba(255,110,110,0.9)';
      ctx.shadowBlur = cell * 0.9 * pulse;
      ctx.fillStyle = '#ff6b6b';
      ctx.beginPath();
      ctx.arc(ox + food.x * cell + cell / 2, oy + food.y * cell + cell / 2, cell * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 蛇身：从头到尾渐变
      for (let i = body.length - 1; i >= 0; i--) {
        const p = body[i];
        const t = i / Math.max(1, body.length - 1);
        const isHead = i === 0;
        ctx.fillStyle = isHead
          ? (deathFlash > 0 ? '#ff5252' : '#7bf7b0')
          : `rgba(74, 217, 145, ${0.9 - t * 0.45})`;
        const inset = isHead ? 1 : 2;
        roundRect(ctx, ox + p.x * cell + inset, oy + p.y * cell + inset, cell - inset * 2, cell - inset * 2, cell * 0.26);
        ctx.fill();
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
