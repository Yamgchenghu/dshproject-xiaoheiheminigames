/**
 * 合成大西瓜 —— 落下水果，同级相碰合成更大的一颗。
 *
 * 【为什么自己写圆碰撞而不是格坐标】合成类游戏的乐趣全在「滚过去刚好碰上」，
 *   量化到格子就变成消消乐了。所以这里用连续坐标 + 简单冲量解算。
 *
 * 【计分口径】只算合成：合成出第 i 级得 (i+1)*10 分，越大越值钱。
 *   落果本身不计分——否则一直往同一个地方砸小果就能刷分。
 *
 * 【复刻来源】对齐 C:/server/minigame/core/games/watermelon.js 的手感：
 *   11 级水果、重力 1200、弹性 0.18、摩擦 0.985、越线 10 秒才结算。
 *   那几条参数都是原版反复调过的，照抄比自己重调更靠谱。
 */
import { makeRng, clamp } from '../core/util.js';
import { canvasFont } from '../core/fonts.js';

const W = 360;
const H = 520;
const DROP_Y = 60;
/** 超过这条线并持续 10 秒才结算；1.6 秒太急，玩家来不及消掉刚堆上去的水果 */
const LINE_Y = 96;
const OVERFLOW_MS = 10000;
const GRAVITY = 1200;
const RESTITUTION = 0.18;
const FRICTION = 0.985;

/** 11 级水果：半径递增，颜色用来区分 */
const TIERS = [
  { r: 12, color: '#f87171', name: '樱桃' },
  { r: 16, color: '#fb923c', name: '橘子' },
  { r: 21, color: '#facc15', name: '柠檬' },
  { r: 26, color: '#a3e635', name: '猕猴桃' },
  { r: 32, color: '#34d399', name: '番茄' },
  { r: 38, color: '#22d3ee', name: '桃子' },
  { r: 45, color: '#60a5fa', name: '菠萝' },
  { r: 52, color: '#a78bfa', name: '椰子' },
  { r: 60, color: '#f472b6', name: '哈密瓜' },
  { r: 68, color: '#fb7185', name: '南瓜' },
  { r: 76, color: '#4ade80', name: '西瓜' },
];

export const meta = {
  id: 'watermelon',
  title: '合成大西瓜',
  sub: '落下水果，同级相碰合成更大的一颗',
  accent: '#4ade80',
  // 【BGM】八段锦风格，D 宫五声，66 BPM，5:20 循环。
  //   详见 tools/lib/songs.mjs 的 watermelon()——那里写了为什么选这个风格。
  bgm: 'watermelon',
  modes: [
    { value: 'classic', label: '经典', sub: '堆过红线 10 秒才结束', fullMark: 2000 },
    // 【纯观战也占一个 mode】外壳按 modes 渲染开局选择页。
    //   它不计分、不上榜（result().ranked = false），fullMark 填 0。
    { value: 'watch', label: '纯观战', sub: 'AI 自动落果 · 不计分', fullMark: 0, spectate: true },
  ],
  schema: {
    score: 0,
    next: { tier: 0 },
    aim: { x: 180 },
    drop: { cooldown: 0 },
    timer: { remaining: 0, duration: 0, elapsed: 0, paused: false },
  },
  classes: {
    timer: { attrs: ['remaining', 'duration', 'elapsed', 'paused'], methods: ['add', 'reset', 'pause', 'resume'] },
  },
  achievements: [
    { id: 'merge5', name: '小有收获', desc: '合成出第 5 级水果', check: (s) => s.maxTier >= 4 },
    { id: 'merge8', name: '果园丰收', desc: '合成出第 8 级水果', check: (s) => s.maxTier >= 7 },
    { id: 'watermelon', name: '大西瓜', desc: '合成出西瓜', check: (s) => s.maxTier >= 10 },
  ],
};

export function create(opts = {}) {
  const mode = String(opts.mode || 'classic');
  const cfg = meta.modes.find((m) => m.value === mode) || meta.modes[0];
  /** 纯观战：由 AI 自动落果，不计分不上榜 */
  const spectate = cfg.spectate === true;
  const rng = makeRng(opts.seed == null ? Date.now() & 0xffff : opts.seed);

  const mods = {
    score: 0,
    next: { tier: 0 },
    aim: { x: W / 2 },
    drop: { cooldown: 0 },
    timer: { remaining: 0, duration: 0, elapsed: 0, paused: false },
  };

  let balls = [];
  let score = 0;
  let status = 'ready';
  let over = false;
  let aimX = W / 2;
  let nextTier = 0;
  let cooldown = 0;
  let overflowMs = 0;
  let elapsed = 0;
  let maxTier = 0;
  let merges = 0;
  /** 画布变换，指针换算要用 */
  let viewK = 1;
  let viewOx = 0;
  let viewOy = 0;

  function pickTier() {
    // 只在前 5 级里出，越小的越常见，否则一开局就塞满大果
    const roll = rng();
    if (roll < 0.35) return 0;
    if (roll < 0.62) return 1;
    if (roll < 0.82) return 2;
    if (roll < 0.94) return 3;
    return 4;
  }

  function reset() {
    balls = [];
    score = 0;
    status = 'ready';
    over = false;
    aimX = W / 2;
    nextTier = pickTier();
    cooldown = 0;
    overflowMs = 0;
    elapsed = 0;
    maxTier = 0;
    merges = 0;
    syncMods();
  }

  function addScore(tier) {
    const gain = (tier + 1) * 10;
    score += gain;
    if (tier > maxTier) maxTier = tier;
    merges++;
  }

  function drop(x) {
    if (status !== 'playing' || cooldown > 0) return false;
    const tier = nextTier;
    const r = TIERS[tier].r;
    const px = clamp(x, r + 2, W - r - 2);
    balls.push({ x: px, y: DROP_Y, vx: (rng() - 0.5) * 20, vy: 0, tier, r, merged: false });
    nextTier = pickTier();
    cooldown = 320;
    return true;
  }

  function mergePair(a, b) {
    a.merged = true;
    b.merged = true;
    const tier = Math.min(TIERS.length - 1, a.tier + 1);
    // 新果落在两球中点，带一点原有速度，手感更连贯
    balls.push({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      vx: (a.vx + b.vx) / 2,
      vy: (a.vy + b.vy) / 2,
      tier,
      r: TIERS[tier].r,
      merged: false,
    });
    addScore(tier);
  }

  /**
   * 观战 AI 选点：优先靠近同级水果，其次远离堆得太高的地方。
   * 不做复杂搜索——合成大西瓜的乐趣在于看同级水果碰在一起，
   * 只要不往快满的堆顶砸，场面就好看。
   */
  function pickAim() {
    const r = TIERS[nextTier].r;
    let bestX = W / 2;
    let bestScore = -Infinity;
    for (let x = r + 6; x <= W - r - 6; x += 12) {
      let s = 0;
      for (const b of balls) {
        const dx = Math.abs(b.x - x);
        if (dx > b.r + r + 2) continue;
        if (b.y - b.r < DROP_Y + 40) s -= 60;
        if (b.tier === nextTier) s += 40;
        s -= dx * 0.15;
      }
      s -= Math.abs(x - W / 2) * 0.02;
      if (s > bestScore) { bestScore = s; bestX = x; }
    }
    return bestX;
  }

  function syncMods() {
    mods.score = spectate ? 0 : score;
    mods.next.tier = nextTier;
    mods.aim.x = aimX;
    mods.drop.cooldown = cooldown;
    mods.timer.elapsed = elapsed;
    mods.balls = balls.length;
    mods.overflow = Math.round(overflowMs);
  }

  function finish() {
    if (over) return;
    over = true;
    status = 'over';
    syncMods();
    opts.onEnd && opts.onEnd(result());
  }

  function step(dt) {
    // 1) 重力与位移
    for (const b of balls) {
      b.vy += GRAVITY * dt;
      b.vx *= FRICTION;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) * RESTITUTION; }
      if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * RESTITUTION; }
      if (b.y + b.r > H) {
        b.y = H - b.r;
        b.vy = -Math.abs(b.vy) * RESTITUTION;
        if (Math.abs(b.vy) < 30) b.vy = 0;
      }
    }

    // 2) 两两碰撞：先判合成，再解重叠
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.merged) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (b.merged) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const minDist = a.r + b.r;
        if (dist >= minDist) continue;

        if (a.tier === b.tier && a.tier < TIERS.length - 1) {
          mergePair(a, b);
          break;
        }

        // 位置修正：按各自半重推开，避免叠在一起抖
        const overlap = (minDist - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;

        // 冲量：沿法线交换速度分量
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = (rel * (1 + RESTITUTION)) / 2;
          a.vx += nx * imp; a.vy += ny * imp;
          b.vx -= nx * imp; b.vy -= ny * imp;
        }
      }
    }

    // 3) 清掉被合成掉的球
    if (balls.some((b) => b.merged)) balls = balls.filter((b) => !b.merged);

    /**
     * 【必须再夹一次边界】墙/地板约束在上面第 1 步做过，但第 2 步的解重叠
     *   会把球往两边推开，推完没人再修正——于是球被挤到墙外，
     *   而且此后一直贴在画布外（原版用户反馈过「西瓜都飞到屏幕外」）。
     */
    for (const b of balls) {
      if (b.x - b.r < 0) { b.x = b.r; if (b.vx < 0) b.vx = 0; }
      if (b.x + b.r > W) { b.x = W - b.r; if (b.vx > 0) b.vx = 0; }
      if (b.y + b.r > H) { b.y = H - b.r; if (b.vy > 0) b.vy = 0; }
    }

    // 4) 过线判定：只看几何越线，不要求静止
    //    【为什么去掉速度门槛】堆到高位后水果会持续轻微抖动，vy 一直在
    //    阈值上下跳，静止条件永远不成立，于是分数很高了还不结算。
    //    10 秒计时本身就是滞回，瞬时飞过红线撑不满 10 秒。
    let lineOver = false;
    for (const b of balls) {
      if (b.y - b.r < LINE_Y) { lineOver = true; break; }
    }
    overflowMs = lineOver ? overflowMs + dt * 1000 : 0;
    if (overflowMs > OVERFLOW_MS && status === 'playing') finish();
  }

  function result() {
    if (spectate) {
      return {
        score: 0,
        won: false,
        ranked: false,
        timeMs: Math.round(elapsed * 1000),
        detail: '观战结束 · 合出 ' + (maxTier >= 10 ? '西瓜' : TIERS[maxTier].name) + ' · 合成 ' + merges + ' 次',
        extra: { ranked: false, maxTier, merges },
      };
    }
    return {
      score,
      won: maxTier >= TIERS.length - 1,
      timeMs: Math.round(elapsed * 1000),
      detail: '最大 ' + TIERS[maxTier].name + ' · 合成 ' + merges + ' 次',
      extra: { maxTier, merges },
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
    get elapsedMs() { return Math.round(elapsed * 1000); },
    get stats() { return result(); },
    get isSpectateMode() { return spectate; },

    start() { if (status === 'ready') status = 'playing'; },
    pause() { if (status === 'playing') status = 'paused'; },
    resume() { if (status === 'paused') status = 'playing'; },
    restart() { reset(); },

    extendTime(sec) {
      const n = Number(sec);
      if (!Number.isFinite(n) || n === 0) return;
      // 合成大西瓜没有倒计时，加时没有意义；留给模组调用不报错
      void n;
    },
    resetTimer() { elapsed = 0; syncMods(); },

    /** 指针：按下只瞄准，抬起才落下——按下即落会让玩家来不及调整位置 */
    pointer(nx, ny, isDown) {
      if (status === 'ready') return;
      // 【必须反算回逻辑坐标】画布做了等比缩放 + 居中留边，
      //   直接拿归一化坐标乘 W 会整体偏移（原版用户报过
      //   「点最左边却从中间落下」就是这个）。
      const lx = ((nx - viewOx) / viewK);
      aimX = clamp(lx, 0, W);
      syncMods();
      if (!isDown) drop(aimX);
    },

    key(name) {
      if (status === 'paused' || over) return;
      if (name === 'left') aimX = Math.max(0, aimX - 24);
      else if (name === 'right') aimX = Math.min(W, aimX + 24);
      else if (name === 'space' || name === 'down') drop(aimX);
      syncMods();
    },

    tick(dt) {
      if (cooldown > 0) cooldown = Math.max(0, cooldown - dt * 1000);
      if (status === 'ready') return;
      if (status !== 'playing') return;
      if (!mods.timer.paused) elapsed += dt;

      // 观战：AI 自动落果
      if (spectate && cooldown <= 0) {
        aimX = pickAim();
        drop(aimX);
      }
      step(dt);
      syncMods();
    },

    draw(ctx, w, h) {
      // 逻辑 360x520 → 画布，等比缩放并居中
      const k = Math.min(w / W, h / H);
      const ox = (w - W * k) / 2;
      const oy = (h - H * k) / 2;
      viewK = k;
      viewOx = ox;
      viewOy = oy;

      ctx.save();
      ctx.fillStyle = '#0d1014';
      ctx.fillRect(0, 0, w, h);
      ctx.translate(ox, oy);
      ctx.scale(k, k);

      // 容器
      ctx.fillStyle = '#171b21';
      ctx.fillRect(0, 0, W, H);

      // 红线：越线 10 秒结算
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = overflowMs > 0 ? 'rgba(255,120,120,0.95)' : 'rgba(255,140,120,0.45)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, LINE_Y);
      ctx.lineTo(W, LINE_Y);
      ctx.stroke();
      ctx.restore();

      // 水果
      for (const b of balls) {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = TIERS[b.tier].color;
        ctx.fill();
        // 高光，让圆看起来是球不是片
        ctx.beginPath();
        ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fill();
      }

      // 待落水果 + 指示线
      if (status === 'playing' || status === 'ready') {
        const r = TIERS[nextTier].r;
        const ax = clamp(aimX, r + 2, W - r - 2);
        ctx.save();
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ax, DROP_Y);
        ctx.lineTo(ax, H);
        ctx.stroke();
        ctx.restore();

        ctx.beginPath();
        ctx.arc(ax, DROP_Y, r, 0, Math.PI * 2);
        ctx.fillStyle = TIERS[nextTier].color;
        ctx.globalAlpha = cooldown > 0 ? 0.45 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      ctx.restore();

      // 分数 / 观战提示（画在缩放层外，字号不跟着缩）
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = canvasFont(15, 700);
      ctx.textAlign = 'left';
      ctx.fillText(spectate ? '观战中' : String(score), 14, 24);
      if (overflowMs > 0 && !spectate) {
        const left = Math.ceil((OVERFLOW_MS - overflowMs) / 1000);
        ctx.fillStyle = 'rgba(255,120,120,0.95)';
        ctx.font = canvasFont(13, 600);
        ctx.textAlign = 'right';
        ctx.fillText(left + ' 秒后结束', w - 14, 24);
      }
    },
  };
}
