/**
 * 切水果 —— 轨迹线段与水果圆的相交判定。
 *
 * 【为什么用线段而不是点】鼠标一帧能移动几十像素，只判当前点会从水果
 *   两边穿过去（尤其快速挥动时）。所以每帧把「上一点 → 当前点」连成线段，
 *   和每个水果的圆做线段-圆相交测试，手感才对。
 *
 * 【炸弹概率可被模组实时修改】炸弹出现概率读 mods.bomb.appearrate，
 *   默认 12%。模组把它改成 0.001 就是 0.1%。
 */
import { makeRng, randInt, clamp } from '../core/util.js';
import { canvasFont } from '../core/fonts.js';

const MODES = {
  classic: { durationMs: 0, label: '经典', lives: 3 },
  t60: { durationMs: 60000, label: '限时 1 分钟', lives: 999 },
  t120: { durationMs: 120000, label: '限时 2 分钟', lives: 999 },
  // 【休闲模式】用户要求：没有炸弹、10 条命、保留道具果，
  //   且狂热期间 + 结束后 5 秒内漏果不扣血。
  //   设计意图是"能放心划、专心爽"，给新手和不追求分数的玩家一个入口。
  //   没有炸弹是硬性的（bombRate 直接为 0），不是"概率很低"。
  casual: { durationMs: 0, label: '休闲', lives: 10, noBomb: true, casualGuard: true },
  // 【纯观战】AI 自动划水果，不计分不上榜。
  //   用无限命 + 无炸弹，让画面能一直演下去——观战看的是"刀光切果"，
  //   被炸弹打断就只剩一片红屏了。
  watch: { durationMs: 0, label: '纯观战', lives: 999, noBomb: true, spectate: true },
};

/**
 * 道具果（special）定义。
 *
 * 【为什么要有道具】原版切水果只有「切水果加分、切炸弹扣命」两条线，
 *   玩两分钟就腻了。道具果给局面加变化：一段时间内改变规则，
 *   让玩家为了「吃到它」而调整划刀节奏。
 *
 * 四种效果对齐参考实现（minigame.rainstone103.top/fruitninja）：
 *   狂热 frenzy —— 15 秒内出果频率翻倍、只从两侧飞入，且不掉命
 *   冰冻 freeze —— 15 秒内水果下落速度降到 30%
 *   双倍 double —— 15 秒内得分翻倍
 *   加时 bonus  —— 立即加时（限时模式加 10 秒，经典模式加 1 条命）
 *
 * 【为什么 bonus 的 ms 是 0】它不是「持续一段时间的状态」，
 *   是「吃下立刻生效的一次性事件」。给个 15 秒的加时状态毫无意义。
 */
const SPECIALS = {
  frenzy: { label: '狂热', color: '#ef4444', juice: '#991b1b', ms: 15000 },
  freeze: { label: '冰冻', color: '#3b82f6', juice: '#1e40af', ms: 15000 },
  double: { label: '双倍', color: '#22c55e', juice: '#15803d', ms: 15000 },
  bonus: { label: '加时', color: '#a855f7', juice: '#6b21a8', ms: 0 },
};

/**
 * 冰冻状态下剩余时长的流逝速度。
 * 用户要求：冰冻时倒计时流逝速度 ×0.05（即几乎停住）。
 * 只影响剩余时长，不影响顺计时——顺计时记录的是真实游玩时长。
 */
const FREEZE_TIME_FLOW = 0.05;

/** 道具果出现的基础概率。0.08 = 平均每 12 个果里 1 个道具 */
const SPECIAL_RATE = 0.08;
/** 限时模式下，剩余时间少于这个比例时道具概率翻倍（救场机制） */
const SPECIAL_LATE_RATIO = 0.25;
/** 限时模式吃「加时」加多少秒 */
const BONUS_SECONDS = 10;
/** 经典模式吃「加时」加几条命 */
const BONUS_LIVES = 1;

/**
 * 观战 AI 的指针运动参数。
 *
 * 【参数演进】最初按「速度与手一致」取 30 px/s、加速度 10 px/s²，
 *   实测明显偏慢（60 秒只切 22 刀），观战看起来像慢放。
 *   用户要求提速：
 *     - 有目标时：速度 ×2 → 60 px/s，加速度 ×1.2 → 12 px/s²
 *     - 空驶时（没有目标、刀在挪向下一个位置）：
 *       速度 = 常规的 1.5 倍 → 90 px/s，加速度也 ×1.5 → 18 px/s²
 *
 * 【为什么空驶要更快】空驶是「手从上一个落点挪到下一个水果」的过程，
 *   真实的手在做这个动作时是放松、快速的，不会慢悠悠地飘过去。
 *   有目标时要减速瞄准，空驶时没必要，所以两者用不同的上限。
 */
const AI_MAX_SPEED = 60;
const AI_ACCEL = 12;
/** 空驶（没有锁定目标）时的速度与加速度上限，均为常规值的 1.5 倍 */
const AI_IDLE_SPEED = AI_MAX_SPEED * 1.5;
const AI_IDLE_ACCEL = AI_ACCEL * 1.5;

const FRUITS = [
  { name: '西瓜', color: '#3ecf6f', r: 26, score: 1 },
  { name: '橙子', color: '#ff9f43', r: 22, score: 1 },
  { name: '苹果', color: '#ff5d5d', r: 21, score: 1 },
  { name: '柠檬', color: '#ffe066', r: 19, score: 1 },
  { name: '蓝莓', color: '#7b8cff', r: 17, score: 2 },
];

export const meta = {
  id: 'fruitninja',
  title: '切水果',
  sub: '划开水果刷分，小心炸弹；⚡狂热 ❄冰冻 ×2双倍 +加时',
  accent: '#ff7a59',
  bgm: 'fruitninja',
  modes: [
    { value: 'classic', label: '经典', sub: '3 条命，漏果扣命', fullMark: 1200 },
    { value: 't60', label: '限时 1 分钟', sub: '60 秒内尽情切', fullMark: 1200 },
    { value: 't120', label: '限时 2 分钟', sub: '120 秒长局', fullMark: 2400 },
    // 【休闲模式的满分定低一些】它没有炸弹、10 条命，容错远高于其他模式，
    //   同样分数说明的"水平"更低。基准分定高了会让人靠刷休闲冲榜。
    { value: 'casual', label: '休闲', sub: '无炸弹 · 10 条命 · 道具果保留', fullMark: 900 },
    // 【纯观战】AI 自动划水果。不计分、不上榜，所以 fullMark 是 0，
    //   量化表里也不该有它。
    { value: 'watch', label: '纯观战', sub: 'AI 自动切 · 不计分', fullMark: 0, spectate: true },
  ],
  schema: {
    score: 0,
    combo: 0,
    lives: 3,
    timeLeft: 60,
    bomb: { appearrate: 0.12 },
    spawn: { interval: 0.62, speed: 1 },
    fruit: { scoreMul: 1 },
    timer: { remaining: 60, duration: 60, elapsed: 0, paused: false },
  },
  classes: {
    timer: { attrs: ['remaining', 'duration', 'elapsed', 'paused'], methods: ['add', 'reset', 'pause', 'resume'] },
  },
  achievements: [
    { id: 'combo10', name: '手起刀落', desc: '一次划中 5 个水果', check: (s) => s.bestSlice >= 5 },
    { id: 'score500', name: '水果摊主', desc: '单局 500 分', check: (s) => s.bestScore >= 500 },
    { id: 'nobomb', name: '炸弹绝缘', desc: '一局内切到 0 个炸弹且得分 200+', check: (s) => s.cleanRun },
  ],
};

export function create(opts = {}) {
  const modeKey = MODES[opts.mode] ? opts.mode : 'classic';
  const cfg = MODES[modeKey];
  /** 纯观战：AI 自动划，不计分不上榜 */
  const spectate = cfg.spectate === true;
  const rng = makeRng(opts.seed == null ? Date.now() & 0xffff : opts.seed);

  const mods = {
    score: 0,
    combo: 0,
    lives: cfg.lives,
    timeLeft: cfg.durationMs / 1000,
    bomb: { appearrate: 0.12 },
    spawn: { interval: 0.62, speed: 1 },
    fruit: { scoreMul: 1 },
    timer: { remaining: cfg.durationMs / 1000, duration: cfg.durationMs / 1000, elapsed: 0, paused: false },
  };

  /** 观战 AI 的划刀节流累加器 */
  let aiAcc = 0;
  /** AI 指针当前位置（逻辑坐标）。W 在下面才定义，这里先给字面量 */
  let aiX = 240;
  let aiY = 40;
  /** 上一帧位置，用来做切割判定 */
  let aiPrevX = aiX;
  let aiPrevY = aiY;
  let aiHasPrev = false;
  /** 当前速度（像素/秒），按加速度增长 */
  let aiVel = 0;
  /** 当前锁定的目标水果 */
  let aiTarget = null;
  /** 空驶锚点（没有目标时朝它移动），-1 表示尚未初始化 */
  let aiIdleX = -1;
  let aiIdleY = 0;
  let aiIdleAcc = 0;

  const W = 480;
  const H = 360;
  // W 到这里才可用，把 AI 指针摆到画布上方中央
  aiX = W / 2;
  aiPrevX = aiX;

  /**
   * 【为什么要有「世界」和「画面」两套坐标】W×H 是游戏逻辑的世界尺寸
   *   （480×360 横屏，水果按这个范围抛）。但小程序画布是竖屏
   *   （实测 440×803），比例差 2.4 倍。
   *   原来 draw() 用 FIT 等比缩放：480×360 塞进 440×803 只能缩到
   *   440×330，剩下 470px 全是黑边——画面被压在中间一条，
   *   手指划屏幕上半部分完全没反应。
   *   现在改成 ENVELOP 式：按较大的缩放比铺满画布，超出部分裁掉。
   *   世界坐标 480×360 会先被放大到覆盖整个画布，
   *   上下多出来的部分不可见（水果仍在那里飞，只是看不到）。
   *   这样整个屏幕都是有效操作区，手感和原版一致。
   */
  let viewScale = 1;
  let viewOffX = 0;
  let viewOffY = 0;
  /** 当前世界高度：随画布宽高比变化，见 draw() 里的说明 */
  let viewWorldH = H;

  let items = []; // {x,y,vx,vy,r,color,kind,rot,vr,slice}
  let trail = []; // {x,y,t}
  let score = 0;
  let lives = cfg.lives;
  let timeLeft = cfg.durationMs / 1000;
  let elapsed = 0;
  let status = 'ready';
  let over = false;
  let spawnAcc = 0;
  let combo = 0;
  let comboTimer = 0;
  let bestSlice = 0;
  let bombsHit = 0;
  let slicedThisSwing = 0;
  let flash = 0;
  // 【为什么要在 draw 里记画布尺寸】stroke() 需要知道 canvas 的像素尺寸，
  //   才能把 0..1 的归一化坐标还原成画布内部坐标（见 stroke 的说明）。
  //   draw 每帧都会被调用，尺寸天然是最新的，比另外传参或读 DOM 都稳。
  let canvasRect = { w: W, h: H };

  // ---- 道具果状态（剩余毫秒，0 表示未激活）----
  let frenzyMs = 0;
  let freezeMs = 0;
  let doubleMs = 0;
  /**
   * 狂热结束后的一小段「缓冲期」。
   *
   * 【为什么需要它】狂热的最后几秒出果极密，玩家习惯了那个节奏；
   *   一旦结束，出果频率骤降，会突然连续漏果，瞬间掉好几条命。
   *   参考实现里也有同样的 grace 机制（et=5e3）。
   *   缓冲期内漏果不罚，给玩家时间重新适应。
   */
  let frenzyGraceMs = 0;
  /** 本局吃了多少个道具果（结算展示用） */
  let specialsEaten = 0;

  function reset() {
    items = [];
    trail = [];
    score = 0;
    lives = cfg.lives;
    timeLeft = cfg.durationMs / 1000;
    elapsed = 0;
    status = 'ready';
    over = false;
    spawnAcc = 0;
    combo = 0;
    comboTimer = 0;
    bestSlice = 0;
    bombsHit = 0;
    flash = 0;
    frenzyMs = 0;
    freezeMs = 0;
    doubleMs = 0;
    frenzyGraceMs = 0;
    specialsEaten = 0;
    mods.lives = lives;
    mods.timeLeft = timeLeft;
    syncMods();
  }

  /**
   * 挑一个道具果类型。
   *
   * 【为什么冰冻在场时不再出冰冻】连续吃两个冰冻等于永久减速，
   *   游戏会变得没有难度。已经在生效的效果不重复投放，
   *   让玩家更可能拿到自己当下缺的那个。
   */
  function pickSpecial() {
    const pool = [];
    if (frenzyMs <= 0) pool.push('frenzy');
    if (freezeMs <= 0) pool.push('freeze');
    if (doubleMs <= 0) pool.push('double');
    // 加时永远在池子里：它是一次性的，不存在「已经在生效」的情况。
    // 【用户要求加时果全局 -50%】它比另外三种强得多——限时模式直接续命，
    //   经典模式白送一条命，是唯一能扭转败局的。所以固定放 1 份，
    //   其余三种各放 2 份，等效权重 = 1/7 ≈ 14%，
    //   比原先的 1/4 = 25% 正好低一半。
    pool.push('bonus');
    if (frenzyMs <= 0) pool.push('frenzy');
    if (freezeMs <= 0) pool.push('freeze');
    if (doubleMs <= 0) pool.push('double');
    return pool[randInt(rng, 0, pool.length - 1)];
  }

  /**
   * 当前道具果出现概率。
   *
   * 【用户给的三条规则】
   *   1. 已处于某个状态时，道具果生成概率 -95%（狂热状态下 -99.7%）
   *   2. 加时果全局生成 -50%
   *   3. 重复触发相同水果时，效果时间延长（见下面的叠加逻辑）
   *
   * 【为什么要这样削】原来已经吃到狂热/冰冻/双倍时，道具池会自动把
   *   同名的剔除（见 pickSpecial），但其他两种仍然照常刷新，
   *   结果是"状态几乎永不断档"，游戏长期处在加速状态、失去节奏感。
   *   现在按用户要求大幅压低：有任一状态在生效时概率只剩 5%，
   *   狂热时只剩 0.3%——狂热本身已经是高强度状态，再叠道具就失控了。
   */
  function specialRate() {
    let rate = SPECIAL_RATE;

    // 限时模式临近结束时翻倍，给翻盘机会
    if (cfg.durationMs > 0) {
      const total = cfg.durationMs / 1000;
      if (timeLeft <= total * SPECIAL_LATE_RATIO) rate *= 2;
    }

    // 规则 1：已有状态时大幅压低。狂热优先判定（它是更极端的那档）
    const anyState = frenzyMs > 0 || freezeMs > 0 || doubleMs > 0;
    if (frenzyMs > 0) rate *= 0.003;      // -99.7%
    else if (anyState) rate *= 0.05;      // -95%

    return rate;
  }

  function spawnWave() {
    const speedMul = clamp(Number(mods.spawn.speed) || 1, 0.2, 4);
    // 一次出 1~3 个；难度随时间上升（上限 3）
    const n = randInt(rng, 1, 3);
    for (let i = 0; i < n; i++) {
      // 【狂热优先于炸弹】狂热期间出果翻倍，如果还照常出炸弹，
      //   满屏炸弹会让这个道具变成惩罚。狂热时先判定道具/水果，
      //   炸弹概率压到原来的三成。
      const frenzyOn = frenzyMs > 0;
      // 【休闲模式没有炸弹】这是硬性规则，不走"概率调到很低"——
      //   概率再低玩家也会遇到，遇到就扣命，和"休闲"的定位矛盾。
      const bombRate = cfg.noBomb
        ? 0
        : clamp(Number(mods.bomb.appearrate) || 0, 0, 1) * (frenzyOn ? 0.3 : 1);
      const isBomb = rng() < bombRate;

      // 道具果：和炸弹互斥，一次只出一个特殊物
      let special = null;
      if (!isBomb && rng() < specialRate()) special = pickSpecial();

      const f = FRUITS[randInt(rng, 0, FRUITS.length - 1)];
      // 狂热时水果从左右两侧飞入（横向大速度），制造「满屏飞」的观感；
      // 平时按原逻辑从中间区域抛出。
      const x = frenzyOn
        ? (rng() < 0.5 ? 20 : W - 20)
        : 60 + rng() * (W - 120);
      // 【初速要跟着世界高度缩放】原来的 430~550 是按 360 高的世界调的，
      //   现在世界高度随竖屏拉长到约 876，同样的初速连一半都飞不到，
      //   水果会在屏幕最底部一闪就落回去，看起来像没抛起来。
      //   按 viewWorldH/H 等比放大，抛物线形状不变，只是整体变高。
      const hScale = viewWorldH / H;
      const vy = -(430 + rng() * 120) * speedMul * hScale;
      // 横向偏转不用放大：它只决定左右散开的角度，和世界高度无关
      // 狂热时从边缘飞入，需要更大的横向初速才能扫过屏幕
      const vx = frenzyOn
        ? (x < W / 2 ? 1 : -1) * (90 + rng() * 110)
        : (x - W / 2) * -0.55 * speedMul + (rng() - 0.5) * 60;

      const sp = special ? SPECIALS[special] : null;
      items.push({
        x,
        y: viewWorldH + 40,
        vx,
        vy,
        // 道具果比普通果大一圈，让玩家一眼看出「这个要接」
        r: sp ? 27 : (isBomb ? 20 : f.r),
        color: sp ? sp.color : (isBomb ? '#2b2b33' : f.color),
        name: sp ? sp.label + '果' : (isBomb ? '炸弹' : f.name),
        kind: sp ? 'special' : (isBomb ? 'bomb' : 'fruit'),
        // 基础分值必须跟着物体走：切中时读的是 it.score，
        // 漏了这行 score 会变成 undefined，累加后整局成绩是 NaN
        score: (isBomb || sp) ? 0 : f.score,
        // 道具果本身不加分，但它是「要接住的东西」，所以要记类型
        special: special || null,
        rot: rng() * Math.PI * 2,
        vr: (rng() - 0.5) * 6,
        sliced: false,
      });
    }
  }

  function syncMods() {
    mods.score = score;
    mods.lives = lives;
    // 【这里绝不能再用 elapsed 反推 timeLeft】那正是"顺计时和剩余时长
    //   互相冲突"的病根：一改剩余时长就得改 elapsed，顺计时跟着跳。
    //   更要命的是它会覆盖加时的效果——加时刚给 timeLeft 加了 10 秒，
    //   紧接着 syncMods 又按 elapsed 把它算回去，等于白加。
    //   现在 timeLeft 是独立维护的量（tick 里按冻结速率递减、加时果直接加），
    //   syncMods 只负责把它同步给模组视图，不做任何反向推导。
    mods.timeLeft = timeLeft;
    mods.timer.remaining = timeLeft;
    mods.timer.elapsed = elapsed;
    mods.timer.duration = cfg.durationMs / 1000;
    mods.combo = combo;
    // 道具状态对模组（Python）开放：模组能读到当前效果，
    // 也能据此做「冰冻期间加倍出果」这类玩法
    mods.special = {
      frenzy: frenzyMs,
      freeze: freezeMs,
      double: doubleMs,
      grace: frenzyGraceMs,
    };
  }

  function end() {
    over = true;
    status = 'over';
    opts.onEnd && opts.onEnd(result());
  }

  /**
   * 模组改时间：正数加时，负数扣时。
   *
   * 【为什么改 elapsed 而不是 timeLeft】timeLeft 每帧都从
   *   durationMs/1000 - elapsed 重算，直接改它会在下一帧被覆盖掉。
   */
  /**
   * 加时：只加剩余时长，不碰顺计时。
   *
   * 【为什么以前是错的】旧实现写的是 elapsed = elapsed - n。
   *   elapsed 是顺计时（"这一局真实打了多久"），往回拨会让屏幕上的
   *   已用时间倒退——玩家看到 5 秒突然变 0 秒。
   *   用户当初的原话是"剩余时长修改后，顺计时不应该被修改"，
   *   注释也写了，但代码没跟上，是注释和实现脱节。
   *   现在加时只动 timeLeft，顺计时照常往前走。
   */
  function extendTime(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n === 0) return;
    if (cfg.durationMs > 0) {
      timeLeft = Math.max(0, timeLeft + n);
    }
    syncMods();
  }

  /** 模组重置计时：限时模式回满，经典模式只把用时清零 */
  function resetTimer() {
    elapsed = 0;
    if (cfg.durationMs > 0) timeLeft = cfg.durationMs / 1000;
    syncMods();
  }

  /**
   * 观战 AI：挑一颗最值得切的水果，从它左边划到右边。
   *
   * 【为什么不切炸弹】炸弹扣命；观战模式虽然给了 999 条命不会死，
   *   但炸一次会全屏红闪，画面很难看。所以炸弹一律跳过。
   * 【为什么优先挑低处的】越往下越接近漏掉，先救快掉的。
   */
  /**
   * 观战 AI：像手指一样在屏幕上移动，而不是瞬移横切。
   *
   * 【为什么要限速】原来的实现是一帧之内从目标左边跳到右边，
   *   等于刀瞬间扫过整屏——观战看起来不像人在玩，而像特效。
   *   用户要求指针速度与手一致：30 像素/秒起步，加速度 10 像素/秒²。
   *
   * 【坐标系】items 里的 x/y 是逻辑坐标（W=480, H=360）。
   *   逻辑坐标和屏幕 CSS 像素近似 1:1（画布等比缩放后宽度接近屏幕宽），
   *   所以这里直接按逻辑坐标算速度，量级与真实手指一致。
   */
  function aiAim() {
    // 已经有目标就不换，否则指针会左右犹豫
    if (aiTarget && !aiTarget.sliced && aiTarget.y < viewWorldH) return;
    let best = null;
    let bestY = -Infinity;
    for (const it of items) {
      if (it.sliced || it.kind === 'bomb') continue;
      // 只切屏幕内的，屏幕外的划了也看不见
      if (it.y < 40 || it.y > viewWorldH - 20) continue;
      // 优先挑快掉出去的（y 大 = 更靠下）
      if (it.y > bestY) { bestY = it.y; best = it; }
    }
    if (best !== aiTarget) {
      aiTarget = best;
      // 换目标时速度不清零：手不会因为换了个目标就停下
    }
  }

  /**
   * 指针朝目标推进一帧。
   *
   * 速度模型：v += a*dt，然后按 v*dt 走。
   * 到目标附近时直接吸附，否则低速下会永远差一点点。
   */
  function aiStep(dt) {
    // 【空驶】没有目标时不再原地停住。
    //   真实的手在等待下一个水果时会继续移动、巡视，不会僵在半空。
    //   空驶用更高的速度上限（1.5 倍），因为挪位不需要瞄准精度。
    if (!aiTarget) {
      aiIdle(dt);
      return;
    }
    const tx = aiTarget.x;
    const ty = aiTarget.y;
    let dx = tx - aiX;
    let dy = ty - aiY;
    const dist = Math.hypot(dx, dy);
    // 到刀口范围内就算切到：直接判定，不再等它走到圆心
    if (dist <= aiTarget.r) {
      // 已经进到刀口范围内：判定这一刀。
      // 【为什么 aiHasPrev 为 false 时也要切】说明上一帧手还在空中空驶，
      //   这一帧刚落下——落下的瞬间就该切到，不能因为「没有上一帧」而漏掉。
      //   这时候把起点设成当前点，slice 退化成「点判定」，仍然有效。
      const fromX = aiHasPrev ? aiPrevX : aiX;
      const fromY = aiHasPrev ? aiPrevY : aiY;
      slice(fromX, fromY, aiX, aiY);
      aiTarget = null;
      aiVel = 0;
      aiHasPrev = false;
      return;
    }
    // 加速（有目标：常规上限）
    aiVel = Math.min(AI_MAX_SPEED, aiVel + AI_ACCEL * dt);
    const step = aiVel * dt;
    if (step >= dist) {
      // 这一帧能走到目标，直接落点并判定。
      // 【起点从哪来】上一帧若在空驶，aiHasPrev 是 false，
      //   此时不能拿空驶前的旧位置当起点——那会把「空中挪过来」的
      //   整段路径连成一条线，凭空切掉路径中间的水果。
      //   起点退化为当前点，只做落点判定。
      const fromX = aiHasPrev ? aiPrevX : aiX;
      const fromY = aiHasPrev ? aiPrevY : aiY;
      aiX = tx; aiY = ty;
      slice(fromX, fromY, aiX, aiY);
      aiTarget = null;
      aiVel = 0;
      aiHasPrev = false;
      return;
    }
    aiPrevX = aiX; aiPrevY = aiY; aiHasPrev = true;
    aiX += (dx / dist) * step;
    aiY += (dy / dist) * step;
    // 刀光跟着走，观战才看得到刀在动
    trail.push({ x: aiX, y: aiY, t: 0 });
    if (trail.length > 40) trail.shift();
  }

  /**
   * 空驶：手离开屏幕，指针在空中移动——不切割、不留刀光。
   *
   * 【空驶到底是什么】用户定义：指针不切、但移动，是「不碰屏幕地移动」。
   *   也就是真实玩家里「切完一刀，把手抬起来挪到下一颗水果上方」的那段动作。
   *   手在空中，所以屏幕上没有任何痕迹，也不该判定任何切割。
   *
   * 【为什么需要它】有目标时指针朝水果加速，切完就停在原地等下一颗。
   *   观战看到的是「刀停住 → 突然窜出去 → 又停住」，机械感很重。
   *   加上空驶，指针会持续在空中巡视，随时准备落下。
   *
   * 【往哪走】朝一个缓慢漂移的锚点走，锚点在画面中上部左右摆动。
   *   每 1.2 秒换一次锚点，指针通常追不上，于是持续处于空驶状态。
   *
   * 【为什么速度给 1.5 倍】空驶不需要瞄准精度，手是放松的，动作更快。
   *
   * 【关键：不能留下轨迹】手在空中，所以这里绝不调用 slice()，
   *   也不往 trail 里推点。否则屏幕上会出现一条凭空划过的刀光，
   *   而且那条线还会切到水果——那就不是空驶了。
   */
  function aiIdle(dt) {
    aiIdleAcc += dt;
    if (aiIdleAcc >= 1.2 || aiIdleX < 0) {
      aiIdleAcc = 0;
      // 在画面中上部随机选锚点，避开最下缘（那里是水果掉落区）
      aiIdleX = 60 + rng() * (W - 120);
      aiIdleY = 70 + rng() * Math.max(40, viewWorldH * 0.5);
    }
    const dx = aiIdleX - aiX;
    const dy = aiIdleY - aiY;
    const dist = Math.hypot(dx, dy);
    // 已经接近锚点：换一个新锚点，别在同一个点附近磨蹭
    if (dist < 24) {
      aiIdleAcc = 1.2;
      aiIdleX = -1;
      return;
    }
    // 空驶用更高的加速度与速度上限
    aiVel = Math.min(AI_IDLE_SPEED, aiVel + AI_IDLE_ACCEL * dt);
    const step = aiVel * dt;
    if (step >= dist) {
      aiX = aiIdleX;
      aiY = aiIdleY;
    } else {
      aiX += (dx / dist) * step;
      aiY += (dy / dist) * step;
    }
    // 【手在空中，不存在「上一帧刀口」】清掉，避免下一次落刀时
    //   把空驶的起点和落刀点连成一条线，凭空切掉中间的水果。
    aiHasPrev = false;
  }

  function slice(ax, ay, bx, by) {
    if (status !== 'playing') return;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let hits = 0;
    for (const it of items) {
      if (it.sliced) continue;
      // 点到线段的最近距离
      let t = len2 > 0 ? ((it.x - ax) * dx + (it.y - ay) * dy) / len2 : 0;
      t = clamp(t, 0, 1);
      const px = ax + dx * t;
      const py = ay + dy * t;
      const dist = Math.hypot(it.x - px, it.y - py);
      if (dist > it.r) continue;

      it.sliced = true;

      // 【道具果优先级最高】它既不是炸弹也不是普通水果：
      //   不加分、不扣命，只改一段时间的规则。
      //   如果落到下面任何一个分支，吃道具反而会被当成漏果扣命。
      if (it.kind === 'special') {
        const sp = SPECIALS[it.special];
        specialsEaten++;
        if (sp) {
          if (it.special === 'frenzy') frenzyMs = Math.min(60000, frenzyMs + sp.ms);
          else if (it.special === 'freeze') freezeMs = Math.min(60000, freezeMs + sp.ms);
          else if (it.special === 'double') doubleMs = Math.min(60000, doubleMs + sp.ms);
          else if (it.special === 'bonus') {
            // 加时：限时模式补时间，经典模式补命。
            // 【为什么经典模式补的是命】经典模式没有倒计时，
            //   加时间毫无意义；它唯一的稀缺资源是生命。
            if (cfg.durationMs > 0) {
              // 【为什么加 timeLeft 而不是回拨 elapsed】elapsed 是顺计时，
              //   回拨会让屏幕上已走过的秒数倒退。用户明确要求两者互不影响，
              //   所以加时只加剩余时长，顺计时照常往前走。
              timeLeft = Math.min(cfg.durationMs / 1000, timeLeft + BONUS_SECONDS);
            } else {
              lives += BONUS_LIVES;
            }
          }
        }
        hits++;
        slicedThisSwing++;
        combo++;
        comboTimer = 1.2;
        syncMods();
        continue;
      }

      if (it.kind === 'bomb') {
        bombsHit++;
        lives -= 1;
        combo = 0;
        flash = 0.35;
        if (lives <= 0) {
          syncMods();
          end();
          return;
        }
      } else {
        hits++;
        slicedThisSwing++;
        combo++;
        comboTimer = 1.2;
        const mul = clamp(Number(mods.fruit.scoreMul) || 1, 0, 100);
        // 双倍道具：在模组分值倍率之上再乘 2
        const doubleMul = doubleMs > 0 ? 2 : 1;
        score += Math.round(it.score * 10 * (1 + Math.min(combo, 10) * 0.1) * mul * doubleMul);
      }
    }
    if (slicedThisSwing > bestSlice) bestSlice = slicedThisSwing;
    syncMods();
  }

  /**
   * 画道具效果状态条。
   *
   * 【为什么用横向进度条而不是只显示图标】玩家需要知道「还剩多久」。
   *   只显示「冰冻中」的话，突然结束会让人措手不及；
   *   进度条让人能预判，从而安排接下来的划刀。
   */
  function drawSpecialBars(ctx) {
    const active = [];
    if (frenzyMs > 0) active.push({ k: 'frenzy', ms: frenzyMs });
    if (freezeMs > 0) active.push({ k: 'freeze', ms: freezeMs });
    if (doubleMs > 0) active.push({ k: 'double', ms: doubleMs });
    if (!active.length) return;

    const barW = 84;
    const barH = 7;
    const gap = 8;
    const totalW = active.length * barW + (active.length - 1) * gap;
    let x = (W - totalW) / 2;
    // 贴近判定线往上一点，不和漏果虚线重叠
    const y = viewWorldH - 34;

    for (const a of active) {
      const sp = SPECIALS[a.k];
      // 剩余比例：加时没有持续时间，不会进这个列表
      const ratio = clamp(a.ms / sp.ms, 0, 1);
      ctx.save();
      // 底槽
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(ctx, x, y, barW, barH, barH / 2);
      ctx.fill();
      // 进度
      ctx.fillStyle = sp.color;
      roundRect(ctx, x, y, Math.max(barH, barW * ratio), barH, barH / 2);
      ctx.fill();
      // 标签 + 剩余秒数
      // 【为什么要把秒数写出来】用户要求"显示剩余时间（秒）"。
      //   光有进度条只能看出"还剩多少比例"，重复吃同一个道具把时间叠到
      //   30 秒以上时，条已经满了（ratio 被 clamp 到 1），
      //   看不出到底还剩多久。数字是唯一能准确告知的信息。
      ctx.fillStyle = '#fff';
      ctx.font = canvasFont(12, 700);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      // 向上取整：剩 0.4 秒时显示 1 而不是 0，避免"看着还有 0 秒但没结束"的困惑
      const sec = Math.ceil(a.ms / 1000);
      ctx.fillText(sp.label + ' ' + sec + 's', x + 1, y - 2);
      ctx.restore();
      x += barW + gap;
    }
  }

  function result() {
    if (spectate) {
      return {
        score: 0,
        won: false,
        ranked: false,
        timeMs: Math.round(elapsed * 1000),
        detail: '观战结束 · 切中 ' + Math.round(score / 10) + ' 刀 · 道具 ' + specialsEaten + ' 个',
        extra: { ranked: false, bestSlice, specials: specialsEaten },
      };
    }
    return {
      score,
      won: false,
      timeMs: Math.round(elapsed * 1000),
      detail: `切中 ${Math.round(score / 10)} 刀 · 炸弹 ${bombsHit} 个`,
      extra: { bombs: bombsHit, bestSlice, specials: specialsEaten },
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

    /**
     * 只读快照。
     *
     * 【为什么要暴露 items】两方需要看到当前场上有哪些物体：
     *   一是测试（要验证道具果真的生成、真的生效），
     *   二是 Python 模组（要写「场上道具果超过 2 个就加时」这类玩法）。
     *   返回的是浅拷贝数组，外部改元素不会污染引擎内部状态。
     */
    view() {
      return {
        items: items.map((it) => ({ ...it })),
        score,
        lives,
        timeLeft,
        status,
        combo,
        specials: { frenzy: frenzyMs, freeze: freezeMs, double: doubleMs, grace: frenzyGraceMs },
        specialsEaten,
      };
    },

    start() {
      if (status === 'ready') status = 'playing';
    },
    pause() { if (status === 'playing') status = 'paused'; },
    resume() { if (status === 'paused') status = 'playing'; },
    restart() { reset(); },

    extendTime,
    resetTimer,

    tick(dt) {
      if (flash > 0) flash = Math.max(0, flash - dt);
      if (comboTimer > 0) {
        comboTimer -= dt;
        if (comboTimer <= 0) {
          combo = 0;
          slicedThisSwing = 0;
          syncMods();
        }
      }
      // 轨迹点在暂停时也要淡出，否则恢复后拖出一条长线
      for (let i = trail.length - 1; i >= 0; i--) {
        trail[i].t += dt;
        if (trail[i].t > 0.22) trail.splice(i, 1);
      }
      if (status !== 'playing') return;

      // 观战：AI 指针像手一样移动，每帧都推进，不再瞬移
      if (spectate) {
        aiAim();
        aiStep(dt);
      }

      // ---- 道具果倒计时 ----
      // 狂热结束后进入缓冲期，缓冲期内漏果不罚（见 frenzyGraceMs 的说明）
      if (frenzyMs > 0) {
        frenzyMs = Math.max(0, frenzyMs - dt * 1000);
        if (frenzyMs === 0) frenzyGraceMs = 5000;
      } else if (frenzyGraceMs > 0) {
        frenzyGraceMs = Math.max(0, frenzyGraceMs - dt * 1000);
      }
      if (freezeMs > 0) freezeMs = Math.max(0, freezeMs - dt * 1000);
      if (doubleMs > 0) doubleMs = Math.max(0, doubleMs - dt * 1000);

      // 模组把 timer.paused 设成 true 时冻结计时（Python 侧 timer.pause()）
      //
      // 【为什么顺计时和剩余时长必须分开算】原来只有 elapsed 一个量，
      //   timeLeft = duration - elapsed 由它推导。加时果要"多给 10 秒"，
      //   就只能把 elapsed 往回拨——可 elapsed 是顺计时，往回拨会让
      //   屏幕上已经走过的秒数倒退，用户看到时间倒流。
      //   用户明确要求："剩余时长修改后，顺计时不应该被修改"。
      //   所以现在两者各走各的：elapsed 只增（顺计时，永不倒退），
      //   timeLeft 独立递减（加时就加 timeLeft，不碰 elapsed）。
      //
      // 【冰冻为什么改的是流逝速度】用户要求"冰冻状态下倒计时流逝速度 ×0.05"。
      //   这影响的是 timeLeft 的下降速率，同样与顺计时无关——
      //   顺计时反映"这一局真实打了多久"，不该被道具扭曲。
      if (!mods.timer.paused) {
        elapsed += dt;
        if (cfg.durationMs > 0) {
          // 冰冻时剩余时长几乎不流逝（5% 速度）
          const flow = freezeMs > 0 ? FREEZE_TIME_FLOW : 1;
          timeLeft = Math.max(0, timeLeft - dt * flow);
          if (timeLeft <= 0) {
            syncMods();
            end();
            return;
          }
        }
      }

      const baseInterval = clamp(Number(mods.spawn.interval) || 0.62, 0.08, 4);
      // 狂热：出果间隔压到 1/2.5，接近参考实现的 200ms 一波动
      const interval = frenzyMs > 0 ? baseInterval / 2.5 : baseInterval;
      spawnAcc += dt;
      while (spawnAcc >= interval) {
        spawnAcc -= interval;
        spawnWave();
        // 狂热时一次波次之后再补一波，让画面真的「满」起来
        if (frenzyMs > 0) spawnWave();
      }

      // 冰冻：所有水果的下落时间流速降到 30%
      // 【为什么缩放 dt 而不是缩放重力】缩放重力只影响加速度，
      //   初速不变，水果照样一瞬间冲上去；玩家看到的是「起飞还是那么快」。
      //   缩放时间轴才是真正的慢动作。
      const physDt = freezeMs > 0 ? dt * 0.3 : dt;
      for (const it of items) {
        // 重力同样按世界高度缩放，保证抛物线的「胖瘦」不变。
        // 只放大初速不放大重力的话，水果会飞到屏幕顶外再慢慢掉，
        // 玩家反而更难接。
        it.vy += 900 * (viewWorldH / H) * physDt;
        it.x += it.vx * physDt;
        it.y += it.vy * physDt;
        it.rot += it.vr * physDt;
      }

      // 掉出屏幕：水果扣命/扣时，炸弹不罚
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.sliced || it.y > viewWorldH + 90) {
          // 【哪些漏果不罚】道具果漏掉不该扣命——它本来就不是必须接的，
          //   玩家选择不接是一种策略。
          // 【狂热免伤只在休闲模式生效】用户对休闲模式的要求是
          //   "狂热期间以及结束后 5s 内水果掉落不扣血"。
          //   经典/限时模式保留原有的紧张感，不能被这条豁免削弱，
          //   否则三个模式就只剩难度差异、没有规则差异了。
          const frenzyGuard = cfg.casualGuard === true
            && (frenzyMs > 0 || frenzyGraceMs > 0);
          const exempt = it.kind === 'special' || frenzyGuard;
          if (!it.sliced && it.kind === 'fruit' && !exempt && status === 'playing') {
            if (cfg.durationMs > 0) {
              // 限时模式：漏果扣 1 秒。
              // 【为什么扣的是 timeLeft 而不是 elapsed】elapsed 是顺计时，
              //   往上加会让屏幕上"已用时间"跳变，用户会看到秒数突然 +1。
              //   扣剩余时长在语义上也更直接：漏一个果，少 1 秒。
              timeLeft = Math.max(0, timeLeft - 1);
              if (timeLeft <= 0) {
                syncMods();
                end();
                return;
              }
            } else {
              lives -= 1;
              if (lives <= 0) {
                syncMods();
                end();
                return;
              }
            }
          }
          items.splice(i, 1);
        }
      }
      syncMods();
    },

    /**
     * 轨迹输入：把点串成线段做判定。
     *
     * 【为什么不能直接乘 W/H】draw() 里画布是按 FIT 等比缩放的：
     *   scale = min(w/W, h/H)，然后四周留 ox/oy 的黑边。
     *   而输入这边原来把 0..1 直接乘 W/H，等于假设「画布铺满整个 canvas」。
     *   屏幕比例和 480:360 不一致时，这两个坐标系就对不上——
     *   玩家手指在屏幕中间划，刀光却出现在偏上/偏下的位置，
     *   越往边缘偏得越多。这正是「触屏位置和🔪对不上」的原因。
     *   正确做法是先把 0..1 还原成 canvas 像素，再减掉黑边、除以 scale，
     *   才是画布内部坐标。
     */
    stroke(ax, ay, bx, by) {
      // 【为什么直接用 draw 里算好的 viewScale / viewOffX / viewOffY】
      //   输入和渲染必须用**同一套**变换，否则刀光就会和手指错位。
      //   之前这里自己又算了一遍，而且用的是 Math.min（FIT），
      //   draw 后来改成了 Math.max（ENVELOP），两边不一致，
      //   屏幕上越靠边偏得越多。现在只认 draw 记录的那一份，
      //   从根上避免两处各算一套。
      const sc = viewScale || 1;
      const pax = (ax * canvasRect.w - viewOffX) / sc;
      const pay = (ay * canvasRect.h - viewOffY) / sc;
      const pbx = (bx * canvasRect.w - viewOffX) / sc;
      const pby = (by * canvasRect.h - viewOffY) / sc;
      trail.push({ x: pbx, y: pby, t: 0 });
      if (trail.length > 16) trail.shift();
      slice(pax, pay, pbx, pby);
    },

    draw(ctx, w, h) {
      canvasRect = { w, h };
      // 【为什么世界尺寸要跟着画布比例走】
      //   原来世界固定 480×360（横屏），竖屏画布 440×803 只有两种摆法：
      //     FIT  ：缩到 440×330，上下留 470px 黑边，手指划上半屏没反应；
      //     ENVELOP：放大到 1070×803，左右各裁 315px，
      //              而水果只在世界 x∈[60,420] 内生成，
      //              可见区却只有中间约 197 宽 —— 大部分水果一出生就在屏幕外。
      //   两种都是「世界形状和画布形状对不上」的补救，治标不治本。
      //
      //   根本解法：让世界就是画布的形状。按画布宽高比反推世界尺寸，
      //   横向保持 480 为基准（水果、重力、速度都是按这个尺度调的），
      //   高度按比例伸缩。这样 scale 只有一档、四周不裁不留白，
      //   水果生成范围天然覆盖整个可见区。
      const aspect = h / w;
      const worldH = W * aspect;   // 竖屏时远大于 360，世界变高
      const scale = w / W;
      const ox = 0;
      const oy = 0;
      // 记下当前世界的实际高度，供生成/判定/绘制统一使用
      viewWorldH = worldH;
      viewScale = scale;
      viewOffX = ox;
      viewOffY = oy;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);

      if (flash > 0) {
        ctx.fillStyle = `rgba(255,60,60,${flash * 0.5})`;
        // 用 viewWorldH：世界已经随画布拉高，还用 H 只能闪到上面一小块
        ctx.fillRect(0, 0, W, viewWorldH);
      }

      // 下界虚线
      // 【为什么要画这条线】水果掉到 H+90 才扣命，但屏幕上完全看不到
      //   这个边界——玩家只知道「漏了」，不知道差多少、也不知道
      //   在哪个高度算漏。画一条虚线把判定线明示出来，
      //   低于它的水果就快掉出去了，视觉上可以提前反应。
      // 【为什么是 H-6 而不是 H+90】H+90 在画布外面，看不见。
      //   这里画在画布底边稍上，作为「危险区」提示，
      //   真正的判定仍在 H+90（水果完全离开视野才扣命，手感更宽容）。
      ctx.save();
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,140,120,0.45)';
      ctx.beginPath();
      // 判定线画在世界底部（viewWorldH），不是旧的固定 H
      ctx.moveTo(0, viewWorldH - 6);
      ctx.lineTo(W, viewWorldH - 6);
      ctx.stroke();
      ctx.restore();

      for (const it of items) {
        ctx.save();
        ctx.translate(it.x, it.y);
        ctx.rotate(it.rot);
        if (it.kind === 'bomb') {
          ctx.fillStyle = '#23232b';
          ctx.beginPath();
          ctx.arc(0, 0, it.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,120,80,0.9)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, 0, it.r - 2, 0, Math.PI * 2);
          ctx.stroke();
          // 引信
          ctx.strokeStyle = '#ffb648';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(0, -it.r);
          ctx.quadraticCurveTo(8, -it.r - 12, 2, -it.r - 20);
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.font = canvasFont(15, 700);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('💣', 0, 1);
        } else if (it.kind === 'special') {
          // 【道具果必须一眼可辨】它和普通水果同样大小、同样在飞，
          //   如果只是换个颜色，玩家在高速划动时根本分不出该不该接。
          //   三重标记：外发光 + 白色粗描边 + 文字图标。
          const sp = SPECIALS[it.special] || SPECIALS.bonus;
          // 外发光
          const glow = ctx.createRadialGradient(0, 0, it.r * 0.6, 0, 0, it.r * 2.1);
          glow.addColorStop(0, sp.color + 'cc');
          glow.addColorStop(1, sp.color + '00');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(0, 0, it.r * 2.1, 0, Math.PI * 2);
          ctx.fill();
          // 本体
          const g = ctx.createRadialGradient(-it.r * 0.3, -it.r * 0.3, it.r * 0.2, 0, 0, it.r);
          g.addColorStop(0, lighten(sp.color, 45));
          g.addColorStop(1, sp.color);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, it.r, 0, Math.PI * 2);
          ctx.fill();
          // 白色粗描边：在满屏水果里靠颜色不够，靠轮廓才够
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, it.r - 1.5, 0, Math.PI * 2);
          ctx.stroke();
          // 图标（用文字，避免额外图片资源）
          ctx.fillStyle = '#fff';
          ctx.font = canvasFont(Math.round(it.r * 0.95), 700);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const ICON = { frenzy: '⚡', freeze: '❄', double: '×2', bonus: '+' };
          ctx.fillText(ICON[it.special] || '★', 0, 1);
        } else {
          const g = ctx.createRadialGradient(-it.r * 0.3, -it.r * 0.3, it.r * 0.2, 0, 0, it.r);
          g.addColorStop(0, lighten(it.color, 40));
          g.addColorStop(1, it.color);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, it.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.beginPath();
          ctx.ellipse(-it.r * 0.35, -it.r * 0.4, it.r * 0.22, it.r * 0.14, -0.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 刀光
      if (trail.length > 1) {
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1];
          const b = trail[i];
          const alpha = clamp(1 - b.t / 0.22, 0, 1);
          ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.85})`;
          ctx.lineWidth = 3 + alpha * 5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // 连击提示
      if (combo >= 3) {
        ctx.fillStyle = 'rgba(255,220,120,0.95)';
        ctx.font = canvasFont(26, 700);
        ctx.textAlign = 'center';
        ctx.fillText(`连击 ×${combo}`, W / 2, 48);
      }

      // ---- 道具效果状态条 ----
      // 【为什么画在底部】顶部已经有连击提示，中间是水果飞行区。
      //   底部靠近判定线，玩家视线本来就会扫到，不遮挡操作。
      //   用剩余时间做进度条宽度，玩家能直观看到「还剩多久」。
      drawSpecialBars(ctx);
      ctx.restore();
    },
  };
}

/**
 * 圆角矩形路径。
 *
 * 【为什么自己写】ctx.roundRect 在部分小程序 WebView 里缺失（Safari 15 及更早），
 *   直接调用会抛错，整帧绘制中断——表现是整个游戏黑屏。
 *   手写一个只依赖 arcTo 的版本，兼容性最好。
 */
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

function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}
