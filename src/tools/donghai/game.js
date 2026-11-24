/**
 * 东海龙珠 · 2.5D 推币机（移植自上游 v1.2.7）
 *
 * ⚠️ 上游出新版本时，**绝对不要用新包整文件覆盖这个文件**。
 *   本文件含有多处与上游有意不同的改动（大龙珠尺寸、质量、初速、
 *   非法灯组保护），覆盖后会静默丢失——不报错，只是手感和分数悄悄变回上游。
 *   正确做法：逐条 diff，只搬上游新改的。详见 docs/donghai-fork.md。
 *   搬完必须跑 node tools/check-donghai-fork.mjs 确认本地改动还在。
 *
 * 【移植改动】原版是独立页面（脚本一加载就 resize + 跑动画循环），
 *   这里改成 mount(root) / unmount() 的挂载式，以便嵌进小程序全屏层：
 *     1. $ 改成在容器内查询，不再污染全局 document；
 *     2. resize 量容器尺寸而不是 window；
 *     3. el / canvas / ctx 改成 mount 时绑定；
 *     4. 事件监听包进 bindEvents()，避免 import 时就崩。
 *   玩法逻辑一行没动。
 */
import { ticketsPerCoin, roundScore, quantize, BASE_TICKETS_PER_COIN } from './scoring.js';
// ------------------------------------------------------------------ utils
const TAU = Math.PI * 2;
const PI = Math.PI;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeInOutSine = t => -(Math.cos(PI * t) - 1) / 2;
const nowMs = () => performance.now();
const fmt = n => String(Math.max(0, Math.floor(n)));
const comma = n => fmt(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

let seed = 0x1a2b3c4d;
function rand() {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a, b) => a + (b - a) * rand();
const pick = a => a[Math.floor(rand() * a.length)];

// 【为什么在 root 里查而不是 document】游戏 DOM 挂在宿主给的全屏容器内，
  //   全局 document.getElementById 会命中宿主外壳里同名的节点（比如 #scene）。
  let rootEl = document.body;
  const $ = id => rootEl.querySelector('#' + id);
// 【为什么 el 是 let 而不是 const】它引用的是 DOM 节点，
//   而 DOM 要等宿主 mount 之后才存在。所以先留空，在 bindEls() 里填。
let el = {};
function bindEls() {
  el = {
    scene: $('scene'),
    statCoins: $('statCoins'), statTickets: $('statTickets'),
    lvBlue: $('lvBlue'), lvYellow: $('lvYellow'), lvPurple: $('lvPurple'), tableCount: $('tableCount'),
    fire: $('fire'), coin: $('coin'), auto: $('auto'),
    screenCoins: $('screenCoins'), screenTickets: $('screenTickets'),
    startScreen: $('startScreen'), startBtn: $('startBtn'),
    helpModal: $('helpModal'), btnHelp: $('btnHelp'), closeHelp: $('closeHelp'), helpOk: $('helpOk'),
    btnSound: $('btnSound'), mascotBubble: $('mascotBubble'), mascotAvatar: $('mascotAvatar'), floats: $('floatLayer'),
    resultBanner: $('resultBanner'), rbTitle: $('rbTitle'), rbSub: $('rbSub'),
    // 结算相关
    settle: $('settle'), settleModal: $('settleModal'), closeSettle: $('closeSettle'),
    stCoins: $('stCoins'), stTickets: $('stTickets'), stAvg: $('stAvg'),
    stScore: $('stScore'), stQuant: $('stQuant'), stNote: $('stNote'), settleAgain: $('settleAgain'),
  };
  // canvas 与 2d 上下文都必须在 DOM 就绪后重新取
  canvas = el.scene;
  ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
}

// ------------------------------------------------------------------ state
const state = {
  started: false,
  paused: false,
  soundOn: true,
  pearls: 0,
  coinsSpent: 0,
  tickets: 0,
  ticketsRemaining: 0,
  total: 0,
  nextPrintAt: 0,
  shotTimes: [],
  lastRateToast: 0,
  pendingShot: false,
  lamps: { pearl: [false, false, false, false, false], ticket: [false, false, false, false, false] },
  activeRow: null,
  targetRow: 'pearl',
  targetIndex: 0,
  party: false,
  partyStart: 0,
  partyEnd: 0,
  nextPartyBall: 0,
  color: { blue: 0, yellow: 0, purple: 0 },
  partyLamp: { blue: false, purple: false, yellow: false },
  nextShot: 0,
  nextAuto: 0,
  holdFire: false,
  holdStart: 0,
  nextHold: 0,
  autoFire: false,
  pusherPhase: 0,
  plateFront: -1.5,
  plateVel: 0,
  tableBalls: [],
  pegBalls: [],
  falling: [],
  chuteBalls: [],
  discBalls: [],
  discSliders: [],
  discPending: [],
  discHoles: [],
  discRot: 0,
  slotAngle: 0,
  slotDir: -1,
  sparks: [],
  confetti: [],
  ticketPops: [],
  shotFalls: [],
  shots: 10000,
  lastFrame: 0,
  lastRenderAt: 0,
  hudClock: 0,
  displayClock: 0,
  cameraShake: 0,
  lastCoinToast: 0,
  resultTimer: 0,
  seedInfo: null
};

// ------------------------------------------------------------------ layout
const L = {
  table: { x0: -2.72, x1: 1.05, z0: -1.95, z1: 2.42 },
  deck: { x0: 0.98, x1: 3.95, z0: -0.42, z1: 2.88 },
  disc: { x: 2.55, z: 1.16, r: 1.5, holeR: 0.88, holeR2: 0.26 },
  pusher: { x0: -2.52, x1: 0.88, retreat: -1.5, advance: -0.58 },
  board: { cx: -0.72, w: 4.0, baseY: 0.9, baseZ: -2.1, topY: 3.18, topZ: -2.5 },
  holes: { base: 0.1875, dx: 0.375, count: 5 }
};
const HOLE_COLORS = ['blue', 'yellow', 'blue', 'yellow', 'blue', 'purple'];
const HOLE_NAMES = { blue: '蓝孔', yellow: '黄孔', purple: '紫孔' };
const HOLE_COL = { blue: '#4fd8ff', yellow: '#ffd65a', purple: '#c07bff' };
const HOLE_DARK = { blue: '#0b4c68', yellow: '#6b4a08', purple: '#3c1a62' };
// 转奖区奖励灯：每列 7 盏，从下往上递增
const REWARD_GRID = {
  blue:   [50, 40, 30, 20, 20, 10, 10],
  purple: [100, 80, 60, 50, 40, 30, 30],
  yellow: [80, 60, 50, 40, 30, 20, 20]
};
// rows 2-7 normal ladder, bottom-to-top; row 1 is the party value
const NORMAL_LADDER = {
  blue:   [10, 10, 20, 20, 30, 40],
  purple: [30, 30, 40, 50, 60, 80],
  yellow: [20, 20, 30, 40, 50, 60]
};
const PARTY_VALUE = { blue: 50, purple: 100, yellow: 80 };
const COLUMN_TYPES = ['none', 'pearl', 'ticket', 'pearl', 'dragon', 'pearl', 'ticket', 'pearl', 'none'];
const COLUMN_LABEL = { none: '无', pearl: '珍珠', ticket: '彩票', dragon: '龙珠' };
const COLUMN_COL = { none: '#628a96', pearl: '#5ff3ff', ticket: '#ff80df', dragon: '#ffc84d' };
const PEARL_ACCEL_MUL = 1.2;
const PEARL_RAIL_DUR = 0.34 / Math.sqrt(PEARL_ACCEL_MUL);
const SLOT_MAX = Math.PI / 6;
const SLOT_SPEED = 28 * Math.PI / 180;
function columnU(i) { return -1.6 + i * 0.4; }
// 边界判定：靠近槽位边界时，向“未亮灯”的一侧加权，降低凑满 5 灯进派对的概率
function resolveColumnIndex(u) {
  const idx = clamp(Math.round((u + 1.6) / 0.4), 0, 8);
  let k = clamp(Math.round((u + 1.4) / 0.4), 0, 7);
  const bu = -1.4 + k * 0.4;
  if (Math.abs(u - bu) > 0.05) return idx; // 明确落在中间，不改判定
  const li = k, ri = k + 1;
  const tl = COLUMN_TYPES[li], tr = COLUMN_TYPES[ri];
  const lampTypes = { pearl: 1, ticket: 1, dragon: 1 };
  if (!lampTypes[tl] || !lampTypes[tr]) return idx;
  const weight = (t) => {
    if (t === 'dragon') return 6;
    const arr = state.lamps[t];
    let unlit = 0;
    for (const v of arr) if (!v) unlit++;
    return unlit + 0.5;
  };
  const wl = weight(tl), wr = weight(tr);
  return Math.random() * (wl + wr) < wl ? li : ri;
}

function tableLeftAt(z) { return L.table.x0 - (z - L.table.z0) * 0.14; }

// 【为什么 canvas / ctx 也是 let】同上：DOM 在 mount 之后才有。
let canvas = null;
let ctx = null;
let W = 393, H = 873, DPR = 1, S = 49, CX = 186, CY = 465;
let GRAV = { x: 48, top: 166, bottom: 448, cx: 196, uScale: 70, holeY: 440, vScale: 91, lampY1: 388, lampY2: 412, dispY: 378, dispH: 40, rodTop: 422, rodBot: 444 };
let FRONT_Y = 568;
let bgGrad = null;

function resize() {
  // 【为什么要有这层保护】mount 时是先 bindEls 再 resize，
  //   但如果宿主在 DOM 还没挂好时就调用（或 unmount 之后残留的
  //   resize 事件迟到），canvas 会是 null，赋值直接 TypeError。
  //   这不是理论风险：预览里偶发过一次 "Cannot set properties of null"。
  if (!canvas || !ctx) return;
  // 【为什么量容器而不是 window】这个游戏是嵌在小程序全屏层里的，
  //   window.innerWidth 是整个 WebView 的宽，容器比它小（有 HUD 边距），
  //   量错了画布会溢出容器被裁掉。
  const box = rootEl.getBoundingClientRect();
  W = Math.max(320, Math.round(box.width) || window.innerWidth);
  H = Math.max(520, Math.round(box.height) || window.innerHeight);
  DPR = Math.min(window.devicePixelRatio || 1, 1.0);
  canvas.width = Math.floor(W * DPR);
  canvas.height = Math.floor(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  S = Math.min(W / 7.75, H / 17.0);
  CX = W * 0.46;
  CY = H * 0.58;
  FRONT_Y = project(0, 0, L.table.z1).y;
  const tableBack = project(0, 0, L.table.z0).y;
  const topLeft = project(L.table.x0, 0, L.table.z0);
  const topRight = project(L.table.x1, 0, L.table.z0);
  const top = Math.max(146, H * 0.19);
  const bottom = tableBack - 8;
  const holeY = bottom - 8;
  const rodTop = holeY - 18, rodBot = holeY + 4;
  const lampY1 = rodTop - 36;
  const panelX = topLeft.x + 4;
  const panelW = Math.max(150, topRight.x - topLeft.x - 8);
  GRAV = {
    x: panelX, w: panelW, top, bottom, cx: panelX + panelW / 2,
    uScale: (panelW - 14) / 4, holeY,
    vScale: (holeY - (top + 62)) / 2.31,
    lampY1, rodTop, rodBot,
    dispY: lampY1 - 12, dispH: 34
  };
  bgGrad = ctx.createRadialGradient(W * 0.5, H * 0.34, 20, W * 0.5, H * 0.45, Math.max(W, H) * 0.78);
  bgGrad.addColorStop(0, '#0b2632');
  bgGrad.addColorStop(0.45, '#07141f');
  bgGrad.addColorStop(1, '#02050a');
  initDiscHoles();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

function project(x, y, z) {
  return {
    x: CX + x * S + z * S * 0.14,
    y: CY + z * S * 0.56 - y * S * 0.82
  };
}
function boardPoint(u, v) {
  return {
    x: GRAV.cx + u * GRAV.uScale,
    y: GRAV.holeY - v * GRAV.vScale
  };
}
function holeU(row, index) {
  return (row === 'pearl' ? -1 : 1) * (L.holes.base + index * L.holes.dx);
}
function tableFrontY() { return project(0, 0, L.table.z1).y; }

function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function fillPoly(c, pts, fill, stroke, lw) {
  c.beginPath();
  c.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
  c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw || 1; c.stroke(); }
}

// ------------------------------------------------------------------ audio (tiny)
class Sound {
  constructor() { this.ctx = null; this.master = null; this.on = true; this.last = {}; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.on ? 0.65 : 0;
      this.master.connect(this.ctx.destination);
    } catch (e) { this.ctx = null; }
  }
  toggle() {
    this.on = !this.on;
    if (this.master) this.master.gain.setTargetAtTime(this.on ? 0.65 : 0, this.ctx.currentTime, 0.015);
    return this.on;
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }
  throttle(k, ms) { const t = nowMs(); if (this.last[k] && t - this.last[k] < ms) return false; this.last[k] = t; return true; }
  tone(freq, dur, type = 'sine', vol = 0.07, delay = 0, slide = null) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t0 = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(30, freq), t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  noise(dur = 0.06, vol = 0.03, freq = 1600, delay = 0) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx, t0 = c.currentTime + delay;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(); src.buffer = b;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t0);
  }
  fire() { this.tone(760, 0.05, 'square', 0.017, 0, 460); this.noise(0.02, 0.01, 2800); }
  peg() { if (this.throttle('peg', 55)) this.tone(950 + Math.random() * 480, 0.03, 'triangle', 0.01); }
  coin() { this.tone(1040, 0.055, 'square', 0.022); this.tone(1560, 0.075, 'square', 0.016, 0.05); }
  lamp() { [0, 0.06, 0.12].forEach((d, i) => this.tone(620 + i * 130, 0.11, 'sine', 0.032, d)); }
  ticket() { this.tone(1320, 0.07, 'triangle', 0.022); this.tone(1760, 0.1, 'sine', 0.018, 0.055); }
  party() {
    [523, 659, 784, 1047, 1319, 1568].forEach((n, i) => this.tone(n, 0.28, i % 2 ? 'triangle' : 'sine', 0.045, i * 0.085));
    [0, 0.18, 0.38].forEach((d, i) => this.tone(160 + i * 40, 0.16, 'sine', 0.04, d, 90 + i * 20));
  }
  good() { [523, 659, 784, 1047].forEach((n, i) => this.tone(n, 0.18, 'triangle', 0.032, i * 0.055)); }
  jackpot() {
    [523, 659, 784, 1047, 1319, 1568, 2093].forEach((n, i) => this.tone(n, 0.4, 'sine', 0.045, i * 0.07));
    [130, 196, 261].forEach((n, i) => this.tone(n, 0.6, 'sawtooth', 0.02, i * 0.04));
    this.noise(0.6, 0.022, 600);
  }
  drop() { if (this.throttle('drop', 100)) { this.tone(210, 0.08, 'sine', 0.025, 0, 120); this.noise(0.03, 0.012, 1300); } }
  fail() { this.tone(200, 0.09, 'sine', 0.02, 0, 150); }
  score() { this.tone(880, 0.08, 'triangle', 0.025); this.tone(1320, 0.12, 'sine', 0.02, 0.07); }
}
const sound = new Sound();
function haptic(ms = 9) {
  try {
    if (window.Android && window.Android.vibrate) window.Android.vibrate(ms);
    else if (navigator.vibrate) navigator.vibrate(ms);
  } catch (e) {}
}
function hapticParty() {
  try {
    if (window.Android && window.Android.hapticPattern) window.Android.hapticPattern();
    else if (navigator.vibrate) navigator.vibrate([0, 45, 35, 90, 30, 140]);
  } catch (e) {}
}

// ------------------------------------------------------------------ sprites
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function makeGlowSprite(color, size = 64) {
  const c = makeCanvas(size, size), g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.globalAlpha = 0.6;
  g.fillRect(0, 0, size, size);
  return c;
}
function makeDragonSprite(stars) {
  const size = 96, c = makeCanvas(size, size), g = c.getContext('2d');
  const cx = size / 2, cy = size / 2, r = 31;
  const glow = g.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 1.55);
  glow.addColorStop(0, 'rgba(255,145,36,.42)');
  glow.addColorStop(1, 'rgba(255,80,10,0)');
  g.fillStyle = glow; g.fillRect(0, 0, size, size);
  const grad = g.createRadialGradient(cx - 10, cy - 12, 2, cx, cy, r);
  grad.addColorStop(0, '#fff7bf');
  grad.addColorStop(0.17, '#ffd45e');
  grad.addColorStop(0.52, '#f18311');
  grad.addColorStop(0.83, '#ad2605');
  grad.addColorStop(1, '#5b0803');
  g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = grad; g.fill();
  g.strokeStyle = 'rgba(255,222,120,.8)'; g.lineWidth = 1.6; g.stroke();
  // specular
  g.beginPath(); g.arc(cx - 11, cy - 11, 9, 0, TAU);
  g.fillStyle = 'rgba(255,255,230,.28)'; g.fill();
  // stars
  const pts = [[0, 0], [-19, -18], [19, -18], [-20, 19], [20, 19], [0, -25], [0, 25]];
  for (let i = 0; i < stars; i++) {
    const [sx, sy] = pts[i];
    const R = i === 0 ? 8 : 4.4;
    g.save(); g.translate(cx + sx, cy + sy);
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -PI / 2 + k * PI / 5, q = k % 2 === 0 ? R : R * 0.42;
      const x = Math.cos(a) * q, y = Math.sin(a) * q;
      k === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath(); g.fillStyle = 'rgba(150,8,18,.92)'; g.fill();
    g.strokeStyle = 'rgba(255,214,100,.35)'; g.lineWidth = 0.8; g.stroke();
    g.restore();
  }
  return c;
}
function makePearlSprite() {
  const size = 36, c = makeCanvas(size, size), g = c.getContext('2d');
  const cx = size / 2, cy = size / 2, r = 12;
  const glow = g.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 1.7);
  glow.addColorStop(0, 'rgba(92,230,255,.3)'); glow.addColorStop(1, 'rgba(40,200,255,0)');
  g.fillStyle = glow; g.fillRect(0, 0, size, size);
  const grad = g.createRadialGradient(cx - 4, cy - 5, 1, cx, cy, r);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.3, '#d8f7ff'); grad.addColorStop(0.75, '#77afc4'); grad.addColorStop(1, '#2d5466');
  g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = grad; g.fill();
  g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 0.7; g.stroke();
  g.beginPath(); g.arc(cx - 4, cy - 5, 3, 0, TAU); g.fillStyle = 'rgba(255,255,255,.85)'; g.fill();
  return c;
}

function makePegSprite() {
  const c = makeCanvas(28, 28), g = c.getContext('2d');
  const grad = g.createRadialGradient(10, 9, 1, 14, 14, 12);
  grad.addColorStop(0, '#fff5c5'); grad.addColorStop(0.45, '#e4b64f'); grad.addColorStop(1, '#6d420f');
  g.fillStyle = grad; g.beginPath(); g.arc(14, 14, 11, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(255,239,174,.55)'; g.lineWidth = 1; g.stroke();
  return c;
}
function makeBulbSprite(color, lit) {
  const size = 32, c = makeCanvas(size, size), g = c.getContext('2d');
  if (lit) {
    const gl = g.createRadialGradient(16, 16, 1, 16, 16, 15);
    gl.addColorStop(0, color + 'cc'); gl.addColorStop(0.55, color + '33'); gl.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gl; g.fillRect(0, 0, size, size);
  }
  const grad = g.createRadialGradient(13, 12, 1, 16, 16, 8);
  if (lit) { grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.4, color); grad.addColorStop(1, '#244347'); }
  else { grad.addColorStop(0, '#667b7e'); grad.addColorStop(1, '#101d22'); }
  g.fillStyle = grad; g.beginPath(); g.arc(16, 16, 8, 0, TAU); g.fill();
  g.strokeStyle = lit ? 'rgba(255,255,255,.55)' : 'rgba(255,214,140,.2)'; g.lineWidth = 1; g.stroke();
  return c;
}
function makeRedDotSprite() {
  const c = makeCanvas(24, 24), g = c.getContext('2d');
  g.beginPath(); g.arc(12, 12, 11.5, 0, TAU); g.fillStyle = '#25070a'; g.fill();
  const grad = g.createRadialGradient(9, 9, 1, 12, 12, 8);
  grad.addColorStop(0, '#ffd7c6'); grad.addColorStop(0.35, '#ff4e42'); grad.addColorStop(1, '#9d0c10');
  g.beginPath(); g.arc(12, 12, 8, 0, TAU); g.fillStyle = grad; g.fill();
  return c;
}
const sprites = {
  dragons: Array.from({ length: 7 }, (_, i) => makeDragonSprite(i + 1)),
  pearl: makePearlSprite(),
  glowGold: makeGlowSprite('rgba(255,190,70,.7)', 64),
  glowCyan: makeGlowSprite('rgba(90,235,255,.7)', 64),
  glowPurple: makeGlowSprite('rgba(190,105,255,.7)', 64),
  peg: makePegSprite(),
  bulbPearlOn: makeBulbSprite('#5ff3ff', true), bulbPearlOff: makeBulbSprite('#5ff3ff', false),
  bulbTicketOn: makeBulbSprite('#ff80df', true), bulbTicketOff: makeBulbSprite('#ff80df', false),
  redDot: makeRedDotSprite()
};

// ------------------------------------------------------------------ seven segment
const SEG = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
  '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abfgcd', '-': 'g'
};
function drawDigit(c, x, y, w, h, ch, color) {
  const t = Math.max(2, w * 0.16);
  const x0 = x + w * 0.14, x1 = x + w * 0.86;
  const y0 = y + t * 0.55, y1 = y + h * 0.5, y2 = y + h - t * 0.55;
  const segs = {
    a: [x0 + t / 2, y0, x1 - t / 2, y0], b: [x1, y0 + t * 0.5, x1, y1 - t * 0.4],
    c: [x1, y1 + t * 0.4, x1, y2 - t * 0.5], d: [x0 + t / 2, y2, x1 - t / 2, y2],
    e: [x0, y1 + t * 0.4, x0, y2 - t * 0.5], f: [x0, y0 + t * 0.5, x0, y1 - t * 0.4],
    g: [x0 + t / 2, y1, x1 - t / 2, y1]
  };
  const on = SEG[ch] || '';
  c.lineCap = 'butt';
  for (const k of 'abcdefg') {
    const sg = segs[k], lit = on.includes(k);
    c.beginPath(); c.moveTo(sg[0], sg[1]); c.lineTo(sg[2], sg[3]);
    c.lineWidth = t * 0.78;
    if (lit) {
      c.globalAlpha = 1;
      c.strokeStyle = '#ff2b19';
    } else {
      c.globalAlpha = 0.11;
      c.strokeStyle = '#ff2b19';
    }
    c.stroke();
  }
  c.globalAlpha = 1;
}

function drawSevenSeg(c, x, y, w, h, value, digits, color, label) {
  color = '#ff2b19';
  c.fillStyle = '#050202';
  roundRect(c, x, y, w, h, 4); c.fill();
  c.strokeStyle = 'rgba(118,34,24,.55)'; c.lineWidth = 1; c.stroke();
  if (label) {
    c.fillStyle = 'rgba(255,104,82,.58)';
    c.font = '500 7px sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, x + w / 2, y + 7);
  }
  const s = fmt(value).padStart(digits, '0').slice(-digits);
  const top = label ? 12 : 4;
  const dh = h - top - 3;
  const dw = Math.min((w - 8) / digits - 2, dh * 0.55);
  const total = dw * digits + (digits - 1) * 2;
  let dx = x + (w - total) / 2;
  for (const ch of s) {
    drawDigit(c, dx, y + top, dw, dh, ch, color);
    dx += dw + 2;
  }
}

// ------------------------------------------------------------------ table simulation
// 【蓝色大龙珠尺寸 —— 与上游 v1.2.7 有意不同，见 docs/donghai-fork.md】
// 上游写的是 Math.cbrt(0.7 * 0.85)：0.85 乘在 cbrt 里面，等于体积 ×0.85，
//   半径只缩了 5.27%（0.334 → 0.316），肉眼几乎看不出。
// 而它要解决的问题是"大龙珠太占地方、把后面的珠子顶开"，
//   5% 完全不够。这里改成线性缩小 15%（半径 0.334 → 0.284），
//   也就是体积 ×0.614，才真的看得出变小。
const BIG_SIZE = Math.cbrt(0.7) * 0.85;
const BODY_R = { dragon: 0.235, pearl: 0.12, bigDragon: 0.376 * BIG_SIZE };
// 【为什么质量要跟着算】上游 BODY_M.bigDragon 是写死的 4.224，
//   而 4.224 = 2.64 * 1.6，跟 BIG_SIZE 无关。也就是说上游把大龙珠改小 5% 后，
//   它变轻了却没有变更"软"—— 体积小了、质量不变，撞起来像铅球。
//   这里按体积缩放：质量 ∝ 半径³。BIG_SIZE 相对原始值缩了 0.85 倍，
//   所以质量乘以 0.85³ = 0.614。
const BIG_VOL = 0.85 * 0.85 * 0.85;
const BODY_M = { dragon: 2.64, pearl: 0.9, bigDragon: 4.224 * BIG_VOL };
const BODY_REST = { dragon: 0.235, pearl: 0.12, bigDragon: 0.376 * BIG_SIZE };
const TABLE_INSET = 0.08;
const MAX_TABLE = 512;

function addTableBody(kind, x, z, opts = {}) {
  if (state.tableBalls.length >= MAX_TABLE) return null;
  const zz = clamp(z, L.table.z0 + 0.1, L.table.z1 - 0.02);
  const b = {
    kind,
    x: clamp(x, tableLeftAt(zz) + TABLE_INSET + BODY_R[kind], L.table.x1 - TABLE_INSET - BODY_R[kind]),
    z: zz,
    air: opts.air || 0,
    airVy: opts.airVy || 0,
    vx: opts.vx || 0,
    vz: opts.vz || 0,
    pushX: opts.pushX || 0,
    pushT: opts.pushT || 0,
    r: BODY_R[kind], mass: BODY_M[kind],
    born: nowMs(), variant: Math.floor(rand() * 7), spin: rand() * TAU,
    alive: true
  };
  state.tableBalls.push(b);
  return b;
}
function removeBody(b) {
  b.alive = false;
  const i = state.tableBalls.indexOf(b);
  if (i >= 0) state.tableBalls.splice(i, 1);
}

function seedTable() {
  // 初始机台 = 模拟 10,000 次投珠后的满盘状态。
  // 只模拟珠子存量，不把模拟产生的彩票发给玩家。
  //
  // 【为什么第一件事就是清盘】这个函数是"重新铺台"，不是"往台面加球"。
  //   原来只往里 push、从不清理，于是每调一次就叠一层：
  //   第二轮开始时上一轮的球还在，加上新铺的一层，
  //   转盘上方一下堆了七八颗龙珠，开局瞬间就掉进去变成几百彩票。
  //   让它自己清干净，就不用指望每个调用方都记得先清。
  state.tableBalls.length = 0;
  state.pegBalls.length = 0;
  state.chuteBalls.length = 0;
  state.discBalls.length = 0;
  state.discSliders.length = 0;
  state.discPending.length = 0;
  const SIM_PLAYS = 10000;
  state.shots = SIM_PLAYS;
  state.total = 0; // 模拟的 10,000 次投珠不计分、不计彩票
  state.tickets = 0;
  state.color = { blue: 0, yellow: 0, purple: 0 };

  let landed = 0, dragonHits = 0;
  for (let i = 0; i < SIM_PLAYS; i++) {
    if (rand() < 0.57) landed++;
    if (rand() < 0.026) dragonHits++;
  }
  const counts = { pearl: 110, dragon: 3 + Math.floor(Math.random() * 4) };
  const placed = [];
  function spot(kind) {
    const rad = BODY_R[kind];
    for (let tries = 0; tries < 60; tries++) {
      const z = rr(-1.1, L.table.z1 - rad - 0.04);
      const x = rr(tableLeftAt(z) + TABLE_INSET + rad, L.table.x1 - TABLE_INSET - rad);
      let ok = true;
      for (const p of placed) {
        if (Math.hypot(x - p.x, z - p.z) < Math.max(0.23, rad + p.r + 0.012)) { ok = false; break; }
      }
      if (ok) return { x, z, r: rad };
    }
    const z = rr(-1.05, L.table.z1 - rad - 0.04);
    return { x: rr(tableLeftAt(z) + TABLE_INSET + rad, L.table.x1 - TABLE_INSET - rad), z, r: rad };
  }
  for (const kind of ['pearl', 'dragon']) {
    for (let i = 0; i < counts[kind]; i++) {
      const p = spot(kind);
      addTableBody(kind, p.x, p.z, { vx: rr(-0.02, 0.02), vz: rr(-0.01, 0.01) });
      placed.push(p);
    }
  }
  const bx = (L.pusher.x0 + L.pusher.x1) / 2;
  // v1.2.7：出生点固定在挡板根部（pusher.retreat），不再跟随推板前后移动。
  //   跟着推板走会让奖励珠出生在推板前方，被推板推着跑，位置忽远忽近。
  const bz = clamp(L.pusher.retreat + BODY_R.bigDragon + 0.03, L.table.z0 + 0.2, L.table.z1 - 0.35);
  addTableBody('bigDragon', bx, bz, { air: 0, vx: 0, vz: 0 });
  state.seedInfo = { plays: SIM_PLAYS, landed, dragonHits, pearl: counts.pearl, dragon: counts.dragon };
  // 初始状态：奖励区灯与珍珠/彩票灯随机亮起
  state.color = {
    blue: Math.floor(Math.random() * 7),
    purple: Math.floor(Math.random() * 7),
    yellow: Math.floor(Math.random() * 7)
  };
  const pLit = Math.floor(Math.random() * 5); // 0~4，避免一开局就派对
  const tLit = Math.floor(Math.random() * 5);
  state.lamps.pearl = Array.from({ length: 5 }, (_, i) => i < pLit);
  state.lamps.ticket = Array.from({ length: 5 }, (_, i) => i < tLit);
  state.activeRow = pLit >= tLit ? 'pearl' : 'ticket';
}

function exitTable(b) {
  if (!b.alive) return;
  b.alive = false;
  const idx = state.tableBalls.indexOf(b);
  if (idx >= 0) state.tableBalls.splice(idx, 1);
  if (b.kind === 'dragon' || b.kind === 'bigDragon') {
    sendToChute(b, false);
  } else if (b.x > 0.62 && (state.chuteBalls.length > 0 || state.discBalls.length > 0 || state.discPending.length > 0) && rand() < 0.48) {
    // 最右侧掉落的珍珠有时会撞到龙珠，被挤进转奖区，按龙珠规则计奖。
    sendToChute(b, true);
    if (rand() < 0.35) toast('珍珠被挤入转奖区！', 'gold');
  } else {
    addTickets(1, null, true);
    floatScore('+1 彩票', 'cyan', { x: CX + rr(-20, 20), y: tableFrontY() + 10 });
    sound.drop();
  }
}

function sendToChute(b, pearlBonus) {
  const start = project(b.x, 0.15, b.z);
  const dc = discCenter(), rx = discRadiusPx(), ry = rx * 0.56;
  const entry = { x: dc.x + rx * 0.38, y: dc.y + ry * 0.76 };
  if (state.chuteBalls.length >= 28) state.chuteBalls.shift();
  state.chuteBalls.push({
    kind: b.kind,
    pearlBonus: !!pearlBonus,
    t: 0,
    dur: 0.48 + rand() * 0.12,
    sx: start.x, sy: start.y - 4,
    mx: (start.x + entry.x) / 2 + 32,
    my: Math.max(start.y, entry.y) + 8,
    ex: entry.x, ey: entry.y,
    size: b.kind === 'bigDragon' ? 0.51 * BIG_SIZE : b.kind === 'dragon' ? 0.32 : 0.22,
    variant: b.variant || 0
  });
  sound.drop();
}

function updateTable(dt) {
  const bodies = state.tableBalls;
  const pf = state.plateFront;
  // pusher contact
  for (const b of bodies) {
    if (b.air > 0.15) continue;
    if (b.x > L.pusher.x0 - 0.15 && b.x < L.pusher.x1 + 0.15) {
      if (b.z < pf + b.r) {
        b.z = pf + b.r + 0.001;
        if (state.plateVel > 0) b.vz = Math.max(b.vz, state.plateVel * 0.72 + 0.03);
        else b.vz = Math.max(b.vz, 0);
      }
    }
  }
  for (const b of bodies) {
    if (!b.alive) continue;
    if (b.air > 0) {
      b.airVy -= 9.8 * dt;
      b.air += b.airVy * dt;
      if (b.air <= 0) { b.air = 0; b.airVy = 0; sound.drop(); }
    }
    if (b.pushT > 0) { b.vx += b.pushX * dt; b.pushT -= dt; }
    const fric = b.kind === 'bigDragon' ? 2.45 * 1.2 * 1.6 : b.kind === 'dragon' ? 2.45 * 1.2 : 2.45 * 0.9;
    const fr = Math.exp(-fric * dt);
    b.vx *= fr; b.vz *= fr;
    if (Math.abs(b.vx) < 0.002) b.vx = 0;
    if (Math.abs(b.vz) < 0.002) b.vz = 0;
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    if (b.x < tableLeftAt(b.z) + TABLE_INSET + b.r) { b.x = tableLeftAt(b.z) + TABLE_INSET + b.r; if (b.vx < 0) b.vx *= -0.22; }
    if (b.x > L.table.x1 - TABLE_INSET - b.r) { b.x = L.table.x1 - TABLE_INSET - b.r; if (b.vx > 0) b.vx *= -0.22; }
    if (b.z < L.table.z0) { b.z = L.table.z0; if (b.vz < 0) b.vz *= -0.2; }
  }
  // pair collisions
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (!a.alive || a.air > 0.15) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (!b.alive || b.air > 0.15) continue;
        let dx = b.x - a.x, dz = b.z - a.z;
        const min = a.r + b.r;
        let d2 = dx * dx + dz * dz;
        if (d2 < min * min) {
          let d = Math.sqrt(d2);
          if (d < 0.0001) { dx = rr(-1, 1); dz = rr(-1, 1); d = Math.hypot(dx, dz) || 1; }
          const nx = dx / d, nz = dz / d, overlap = min - d, total = a.mass + b.mass;
          a.x -= nx * overlap * (b.mass / total);
          a.z -= nz * overlap * (b.mass / total);
          b.x += nx * overlap * (a.mass / total);
          b.z += nz * overlap * (a.mass / total);
          const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
          const vn = rvx * nx + rvz * nz;
          if (vn < 0) {
            const jm = -(1.06) * vn / (1 / a.mass + 1 / b.mass);
            a.vx -= jm * nx / a.mass; a.vz -= jm * nz / a.mass;
            b.vx += jm * nx / b.mass; b.vz += jm * nz / b.mass;
          }
        }
      }
    }
  }
  const drops = [];
  for (const b of bodies) {
    if (!b.alive) continue;
    b.x = clamp(b.x, tableLeftAt(b.z) + TABLE_INSET + b.r, L.table.x1 - TABLE_INSET - b.r);
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > 3.2) { b.vx *= 3.2 / sp; b.vz *= 3.2 / sp; }
    if (b.air < 0.12 && b.z > L.table.z1) drops.push(b);
  }
  for (const b of drops) exitTable(b);
}

// ------------------------------------------------------------------ peg gravity board
const pegs = [];
for (let r = 0; r < 6; r++) {
  const v = 1.92 - r * 0.23;
  const offset = r % 2 ? 0.25 : 0;
  for (let c = 0; c < 8; c++) {
    const u = -1.75 + c * 0.5 + offset;
    if (u > 1.79) continue;
    pegs.push({ u, v, r: 0.028 });
  }
}

const FIRE_DELAY_MS = 100;
function shoot() {
  if (!state.started || state.paused || state.pendingShot) return;
  if (nowMs() < state.nextShot) return;
  state.pendingShot = true;
  el.fire.classList.add('charging');
  setTimeout(() => {
    state.pendingShot = false;
    el.fire.classList.remove('charging');
    fireNow(); // 线下机台：按钮按下约 0.1 秒后才响应
  }, FIRE_DELAY_MS);
}

function fireNow() {
  if (!state.started || state.paused) return;
  const now = nowMs();
  if (now < state.nextShot) return;
  state.shotTimes = state.shotTimes.filter(t => now - t < 1000);
  if (state.shotTimes.length >= 2) {
    if (now - state.lastRateToast > 900) {
      state.lastRateToast = now;
      toast('1 秒内最多发射 2 颗珍珠', 'red');
    }
    return;
  }
  if (state.pegBalls.length >= 10) return;
  // 每日挑战的币数上限：到了就停，并提示去结算。
  // 【为什么提示"去结算"而不是"明天再来"】限额是挑战规则的一部分，
  //   打完限额正说明这局该结算了——玩家该拿成绩了，不是被罚站。
  if (coinLimit > 0 && state.coinsSpent >= coinLimit) {
    if (now - state.lastRateToast > 1500) {
      state.lastRateToast = now;
      toast('已到 ' + coinLimit + ' 币上限，点右上「结算」提交成绩', 'gold');
    }
    state.autoFire = false;
    return;
  }
  state.shotTimes.push(now);
  state.coinsSpent++;
  state.shots++;
  state.nextShot = now + 100;
  sound.init(); sound.fire(); haptic(6);
  const angle = state.party ? 0 : state.slotAngle;
  state.pegBalls.push({
    u: 0, v: 2.80, vu: 0, vv: 0, onRail: true, railT: 0, railAngle: angle,
    r: 0.068, life: 0, spark: 0, minV: 2.80, stallT: 0
  });
  updateHUD(now);
}

function updatePegBoard(dt) {
  const wall = L.board.w / 2 - 0.1;
  const steps = 2, sdt = dt / steps;
  for (let s = 0; s < steps; s++) {
    for (let i = state.pegBalls.length - 1; i >= 0; i--) {
      const b = state.pegBalls[i];
      b.life += sdt;
      if (b.onRail) {
        b.railT += sdt;
        const f = clamp(b.railT / PEARL_RAIL_DUR, 0, 1);
        const e = f * f; // 导轨上的加速
        const angle = state.party ? 0 : state.slotAngle;
        const outX = GRAV.cx, outY = GRAV.top + 16, pivotY = outY + 9;
        const endY = pivotY + 36 * Math.cos(angle);
        const yScreen = outY + (endY - outY) * e;
        let xScreen = outX;
        if (yScreen > pivotY) xScreen = outX - (yScreen - pivotY) * Math.tan(angle);
        b.u = (xScreen - GRAV.cx) / GRAV.uScale;
        b.v = (GRAV.holeY - yScreen) / GRAV.vScale;
        if (f >= 1) {
          b.onRail = false;
          b.vu = -Math.sin(angle) * 3.1;
          b.vv = -0.2;
          b.minV = b.v;
          b.stallT = 0;
        }
        continue;
      }
      if (b.v < b.minV - 0.04) { b.minV = b.v; b.stallT = 0; }
      else b.stallT += sdt;
      if (b.stallT > 0.45 && b.v > 0.24) { b.vv -= 4.5 * sdt; b.vu += rr(-0.35, 0.35) * sdt * 10; }
      if (b.stallT > 1.4) b.vv = Math.min(b.vv, -1.2);
      b.vv -= 6.8 * PEARL_ACCEL_MUL * sdt;
      b.u += b.vu * sdt;
      b.v += b.vv * sdt;
      if (b.u < -wall) { b.u = -wall; b.vu = Math.abs(b.vu) * 0.45; }
      if (b.u > wall) { b.u = wall; b.vu = -Math.abs(b.vu) * 0.45; }
      for (const p of pegs) {
        if (Math.abs(p.v - b.v) > 0.22) continue;
        const du = b.u - p.u, dv = b.v - p.v;
        const min = b.r + p.r, d2 = du * du + dv * dv;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 0.0001;
          const nu = du / d, nv = dv / d;
          b.u = p.u + nu * min;
          b.v = p.v + nv * min;
          const vn = b.vu * nu + b.vv * nv;
          if (vn < 0) {
            b.vu -= 1.22 * vn * nu;
            b.vv -= 1.22 * vn * nv;
            b.vu += rr(-0.38, 0.38);
            b.vv = Math.min(b.vv, 0.1);
            b.vv -= 0.06;
            b.spark = 1;
            sound.peg();
          }
          b.vu = clamp(b.vu, -2.3, 2.3);
          b.vv = clamp(b.vv, -3.2, 0.3);
        }
      }
      if (b.v < 0.24 && b.v > -0.2) {
        const idx = resolveColumnIndex(b.u);
        onColumnHit(idx, b.u, b.v);
        state.pegBalls.splice(i, 1);
        continue;
      }
      if (b.v < -0.1) {
        spawnShotPearlAtBaffle(b.u);
        spawnSparks(boardPoint(b.u, 0.1).x, boardPoint(b.u, 0.1).y, '#8ff4ff', 5);
        state.pegBalls.splice(i, 1);
        continue;
      }
      if (b.life > 5) {
        spawnShotPearlAtBaffle(b.u);
        state.pegBalls.splice(i, 1);
      }
    }
  }
}

function firstUnlit(row) {
  // 【为什么要有这层保护】lamps 只有 pearl / ticket 两组，
  //   龙珠槽没有灯组。传 'dragon' 进来会直接 TypeError 崩掉整个页面。
  //   原版只在内部调用、传的都是合法值，所以没暴露；一旦从外部（自动化、
  //   未来的 UI）传进来就会炸。这里挡掉非法值，返回 -1。
  const arr = state.lamps[row];
  if (!arr) return -1;
  for (let i = 0; i < 5; i++) if (!arr[i]) return i;
  return -1;
}
function selectRow(row) {
  if (state.party || !state.started || state.targetRow === row) return;
  // 同上：只接受有灯组的行
  if (!state.lamps[row]) return;
  state.targetRow = row;
  const i = firstUnlit(row);
  state.targetIndex = i >= 0 ? i : 0;
  sound.tone(620, 0.045, 'sine', 0.012);
  updateHUD(nowMs());
}
function cycleTarget(dir) {
  if (state.party || !state.started) return;
  const row = state.targetRow, unlit = [];
  if (!state.lamps[row]) return;
  for (let i = 0; i < 5; i++) if (!state.lamps[row][i]) unlit.push(i);
  if (!unlit.length) { toast('这一组灯已经全亮'); return; }
  let p = unlit.indexOf(state.targetIndex);
  if (p < 0) p = 0;
  p = (p + dir + unlit.length) % unlit.length;
  state.targetIndex = unlit[p];
  sound.tone(720 + p * 35, 0.04, 'sine', 0.012);
  updateHUD(nowMs());
}

// ------------------------------------------------------------------ lamps / party
function onHoleHit(row, index, u, v) {
  const scr = boardPoint(u, 0.16);
  const now = nowMs();
  if (state.party) {
    if (row === 'pearl') {
      addTickets(90 + Math.floor(rand() * 70), scr);
      addPearls(2, true);
      if (rand() < 0.24) spawnDragonBall(1);
      floatScore('+2 珍珠', 'cyan', { x: scr.x, y: scr.y - 15 });
    } else {
      const t = 170 + Math.floor(rand() * 110);
      addTickets(t, scr);
      if (rand() < 0.3) addPearls(1, true);
      if (rand() < 0.16) spawnDragonBall(1);
    }
    sound.good();
    spawnSparks(scr.x, scr.y, '#ffe08a', 14);
    return;
  }
  const was = state.activeRow;
  if (was && was !== row) {
    let had = false;
    for (const x of state.lamps[was]) if (x) had = true;
    if (had) {
      state.lamps[was] = [false, false, false, false, false];
      toast('亮一熄一 · ' + (was === 'pearl' ? '珍珠灯' : '彩票灯') + '熄灭', 'red');
      sound.tone(220, 0.2, 'sine', 0.028, 0, 130);
    }
  }
  state.activeRow = row;
  state.targetRow = row;
  if (!state.lamps[row][index]) {
    state.lamps[row][index] = true;
    if (row === 'pearl') {
      addTickets(8 + index * 2, scr);
      addPearls(1, true);
      if (rand() < 0.28) spawnDragonBall(1);
    } else {
      addTickets(14 + index * 3, scr);
      if (rand() < 0.28) addPearls(1, true);
      if (rand() < 0.16) spawnDragonBall(1);
    }
    sound.lamp(); haptic(16);
    spawnSparks(scr.x, scr.y, row === 'pearl' ? '#64f2ff' : '#ff83dd', 15);
    if (state.lamps[row].every(Boolean)) {
      startParty(row);
    } else {
      const n = firstUnlit(row);
      if (n >= 0) state.targetIndex = n;
      toast(row === 'pearl' ? '珍珠灯 +1' : '彩票灯 +1', row === 'pearl' ? '' : 'gold');
    }
  } else {
    addTickets(3, scr, true);
    floatScore('+3', 'cyan', scr);
    sound.tone(540, 0.06, 'triangle', 0.012);
  }
  updateHUD(now);
}

function lightBank(type) {
  if (state.party) return false;
  const other = type === 'pearl' ? 'ticket' : 'pearl';
  if (state.lamps[other].some(Boolean)) {
    state.lamps[other] = [false, false, false, false, false];
    toast('亮一熄一 · ' + (other === 'pearl' ? '珍珠灯' : '彩票灯') + '归零', 'red');
    sound.tone(220, 0.2, 'sine', 0.026, 0, 130);
  }
  state.activeRow = type;
  const idx = firstUnlit(type);
  if (idx < 0) return false;
  state.lamps[type][idx] = true;
  if (state.lamps[type].every(Boolean)) {
    startParty(type);
    return true;
  }
  return false;
}

function boardUToTableX(u, z) {
  const half = L.board.w / 2;
  const t = clamp((u + half) / (2 * half), 0, 1);
  return lerp(tableLeftAt(z) + TABLE_INSET + BODY_R.pearl, L.table.x1 - TABLE_INSET - BODY_R.pearl, t);
}
function spawnShotPearlAtBaffle(u) {
  const z = clamp(state.plateFront + BODY_R.pearl + 0.55, L.table.z0 + 0.15, L.table.z1 - 0.3);
  const x = boardUToTableX(u, z);
  const start = boardPoint(u, 0.12);
  const end = project(x, 0.2, z);
  state.shotFalls.push({
    t: 0, dur: 0.78, x, z,
    sx: start.x, sy: start.y - 2,
    ex: end.x, ey: end.y - 2,
    cx: (start.x + end.x) / 2 + (start.x - GRAV.cx) * 0.2,
    cy: Math.max(start.y, end.y) + 6
  });
  sound.drop();
}
function spawnRewardPearls(n) {
  for (let i = 0; i < n; i++) {
    const b = addTableBody('pearl', L.pusher.x0 + 0.32 + i * 0.1, clamp(L.pusher.retreat + BODY_R.pearl + 0.02, L.table.z0 + 0.15, L.table.z1 - 0.3), {
      air: 0, vx: 0.25, vz: rr(0.06, 0.16),
      pushX: 2.8, pushT: 0.95
    });
    if (!b) break;
  }
  sound.drop();
}
function dropPearlToPusher() {
  spawnRewardPearls(1);
}

function onColumnHit(index, u, v) {
  const type = COLUMN_TYPES[index];
  const scr = boardPoint(columnU(index), 0.12);
  const now = nowMs();
  // 发射的珍珠无论中哪个槽，都会落回推币区挡板，不能凭空消失
  spawnShotPearlAtBaffle(u);
  if (type === 'none') {
    spawnSparks(scr.x, scr.y, COLUMN_COL.none, 5);
    updateHUD(now);
    return;
  }
  if (type === 'pearl') {
    if (!state.party) lightBank('pearl');
    const n = 3 + Math.floor(rand() * 3); // 3~5
    spawnRewardPearls(n);
    floatScore('+' + n + ' 珍珠', 'cyan', scr);
    spawnSparks(scr.x, scr.y, COLUMN_COL.pearl, 12);
    sound.lamp(); haptic(12);
    if (!state.party) toast('珍珠灯 +1 · 奖励 ' + n + ' 珍珠', '');
  } else if (type === 'ticket') {
    if (!state.party) lightBank('ticket');
    const n = 1 + Math.floor(rand() * 3); // 1~3
    addTickets(n, scr);
    spawnSparks(scr.x, scr.y, COLUMN_COL.ticket, 12);
    sound.lamp(); haptic(12);
    if (!state.party) toast('彩票灯 +1 · 奖励 ' + n + ' 彩票', 'gold');
  } else {
    const spawned = grantDragonSlot();
    if (spawned) {
      floatScore('龙珠 +1', '', scr);
      toast('龙珠槽 +1 龙珠', 'gold');
    }
    spawnSparks(scr.x, scr.y, COLUMN_COL.dragon, 16);
    sound.good(); haptic(18);
  }
  updateHUD(now);
}

function startParty(row) {
  if (state.party) return;
  const now = nowMs();
  state.party = true;
  state.partyLamp = { blue: true, purple: true, yellow: true };
  state.color = { blue: 0, purple: 0, yellow: 0 };
  state.slotAngle = 0;
  state.slotDir = 0;
  state.partyStart = now;
  state.partyEnd = now + 10000;
  state.activeRow = row;
  state.lamps[row] = [true, true, true, true, true];
  state.lamps[row === 'pearl' ? 'ticket' : 'pearl'] = [false, false, false, false, false];
  for (const b of state.tableBalls) {
    b.vz += rr(0.8, 1.8);
    b.vx += rr(-0.14, 0.14);
  }
  sound.party(); hapticParty();
  addConfetti(100, ['#ffd65a', '#ff6246', '#5ff5ff', '#ff8ce1', '#fff1b8']);
  toast('派对时间 · 滑槽锁定 0°', 'gold');
  updateHUD(now);
}
function endParty() {
  if (!state.party) return;
  state.party = false;
  state.partyEnd = 0;
  state.slotAngle = 0;
  state.slotDir = -1;
  state.partyLamp = { blue: false, purple: false, yellow: false };
  state.lamps = { pearl: [false, false, false, false, false], ticket: [false, false, false, false, false] };
  state.activeRow = null;
  state.targetIndex = 0;
  el.fire.classList.remove('party');
  toast('派对结束 · 继续攒龙珠吧');
  sound.tone(300, 0.35, 'sine', 0.026, 0, 180);
  updateHUD(nowMs());
}
function updateParty(now) {
  if (!state.party) return;
  if (now >= state.partyEnd) { endParty(); return; }
}

function addPearls(n, silent = false) {
  state.pearls = Math.max(0, state.pearls + Math.floor(n));
  if (!silent) { sound.ticket(); haptic(6); }
}
function addTickets(n, screen = null, silent = false) {
  n = Math.max(0, Math.floor(n));
  if (n <= 0) return;
  if (screen) floatScore('+' + n, '', screen);
  if (!silent) sound.ticket();
  if (state.started) {
    state.ticketsRemaining += n;
    if (!state.nextPrintAt) state.nextPrintAt = nowMs() + 60;
  }
}
function tableDragonCount() {
  let n = 0;
  for (const b of state.tableBalls) if (b.kind === 'dragon' || b.kind === 'bigDragon') n++;
  return n;
}
function dropPearlBurst(n = 20) {
  spawnRewardPearls(n);
  const p = project(-2.0, 0.2, L.table.z0 + 0.3);
  spawnSparks(p.x, p.y, '#9ff7ff', 18);
}
function spawnDragonBall(count = 1) {
  let dragons = tableDragonCount();
  for (let i = 0; i < count; i++) {
    if (dragons >= 10) break;
    const b = addTableBody('dragon', L.pusher.x1 - 0.34, clamp(L.pusher.retreat + BODY_R.dragon + 0.02, L.table.z0 + 0.2, L.table.z1 - 0.35), {
      // v1.2.7：奖励龙珠生成时初始速度 ×3（从挡板右侧向左冲出）。
      //   原速太慢，龙珠刚冒头就被旁边的珠子挡住，看不出"冲出"的效果。
      air: 0, vx: -0.25 * 3, vz: rr(0.06, 0.18) * 3,
      pushX: -2.8, pushT: 1.0
    });
    if (!b) break;
    dragons++;
  }
  sound.tone(300, 0.16, 'triangle', 0.025, 0, 520);
}

function grantDragonSlot() {
  // 派对时间不再追加奖励龙珠；龙珠满 10 时同样改为混合奖励
  if (state.party || tableDragonCount() >= 10) {
    const p = 3 + Math.floor(Math.random() * 3); // 3~5
    const t = 3 + Math.floor(Math.random() * 3); // 3~5
    spawnRewardPearls(p);
    addTickets(t, null, true);
    toast((state.party ? '派对时间 · 不追加龙珠 · ' : '龙珠已满 · ') + p + ' 珍珠 + ' + t + ' 彩票', 'gold');
    floatScore('+' + p + ' 珍珠 +' + t + ' 票', 'gold', { x: GRAV.cx, y: GRAV.rodTop - 30 });
    return false;
  }
  spawnDragonBall(1);
  return true;
}

// ------------------------------------------------------------------ score disc (flat, 6 holes)
/**
 * 建立转盘孔位。
 * 【为什么要 force】原来只有 `if (state.discHoles.length) return` 的早退，
 *   孔位一旦建好就永不重建。而 discBalls / discSliders 在重开时是清空的，
 *   孔位上的 occupied / reserved / ball 却留着上一局的引用 —— 于是：
 *     1. 旧球还在 hole.ball 里，转到顶部又计一次分；
 *     2. hole.occupied 没释放，新球找不到空位，全堆在转盘口。
 *   重开时必须强制重建，把孔位状态和球一起清干净。
 */
function initDiscHoles(force) {
  if (state.discHoles.length && !force) return;
  state.discHoles = HOLE_COLORS.map((color, i) => ({
    color,
    base: i * TAU / 6,
    occupied: false,
    reserved: false,
    ball: null
  }));
  state.discRot = 0;
}
function freeHole() {
  const list = state.discHoles.filter(h => !h.occupied && !h.reserved);
  if (!list.length) return null;
  return pick(list);
}
function discEntryPoint() {
  const a = Math.PI * 0.25;
  return { x: L.disc.x + Math.cos(a) * L.disc.r * 0.78, z: L.disc.z + Math.sin(a) * L.disc.r * 0.78, a };
}
function spawnDiscSlider(kind, pearlBonus, variant) {
  const p = discEntryPoint();
  const dx = p.x - L.disc.x, dz = p.z - L.disc.z;
  const len = Math.hypot(dx, dz) || 1;
  // 入盘惯性：逆时针切向 + 少量向心
  const tx = dz / len, tz = -dx / len;
  const nx = -dx / len, nz = -dz / len;
  const isBig = kind === 'bigDragon';
  // 【龙珠入盘初速 = 珍珠的 3 倍】原实现写死 3.45，相对珍珠 1.35
  //   只有 2.56 倍，和 README 宣称的 ×3 对不上。
  //   这里改成显式倍数，改基准只要动 PEARL_SPEED 一处。
  const PEARL_SPEED = 1.35;
  const DRAGON_SPEED_MUL = 3;
  const sp = isBig
    ? PEARL_SPEED * DRAGON_SPEED_MUL * 1.6
    : kind === 'dragon' ? PEARL_SPEED * DRAGON_SPEED_MUL : PEARL_SPEED;
  const b = {
    kind, pearlBonus, variant,
    x: p.x, z: p.z,
    vx: tx * sp + nx * 0.22,
    vz: tz * sp + nz * 0.22,
    r: isBig ? 0.32 * BIG_SIZE : kind === 'dragon' ? 0.2 : 0.14,
    fric: isBig ? 0.95 * 1.6 : 0.95,
    state: 'slide', hole: null, attractT: 0, spin: rand() * TAU
  };
  state.discSliders.push(b);
  sound.drop();
  haptic(6);
  return b;
}
function holesFree() {
  return state.discHoles.filter(h => !h.occupied && !h.reserved);
}
function nearestFreeHole(x, z, maxDist) {
  let best = null, bd = maxDist;
  for (const h of state.discHoles) {
    if (h.occupied || h.reserved) continue;
    const p = discHolePos(h);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}
function settleSlider(b, hole) {
  hole.reserved = false;
  hole.occupied = true;
  const ball = {
    kind: b.kind, pearlBonus: b.pearlBonus, variant: b.variant,
    hole, t: 0, scored: false, color: hole.color
  };
  hole.ball = ball;
  state.discBalls.push(ball);
  const i = state.discSliders.indexOf(b);
  if (i >= 0) state.discSliders.splice(i, 1);
  sound.tone(620, 0.06, 'sine', 0.012);
}
function updateDiscSliders(dt) {
  const rimR = L.disc.r * 0.9;
  const sliders = state.discSliders;
  for (let i = sliders.length - 1; i >= 0; i--) {
    const b = sliders[i];
    if (b.state === 'attract') {
      const hp = discHolePos(b.hole);
      b.attractT += dt;
      const k = Math.min(1, dt * 11);
      b.x = lerp(b.x, hp.x, k);
      b.z = lerp(b.z, hp.z, k);
      const d = Math.hypot(hp.x - b.x, hp.z - b.z);
      if (d < 0.035 || b.attractT > 0.45) settleSlider(b, b.hole);
      continue;
    }
    // 惯性 + 向心力（弧线逆时针），摩擦逐渐减弱
    const dx = b.x - L.disc.x, dz = b.z - L.disc.z;
    const d = Math.hypot(dx, dz) || 1;
    b.vx += (-dx / d) * 1.15 * dt;
    b.vz += (-dz / d) * 1.15 * dt;
    const fr = Math.exp(-(b.fric || 0.95) * dt);
    b.vx *= fr; b.vz *= fr;
    b.x += b.vx * dt; b.z += b.vz * dt;
    // 外沿反弹
    const dd = Math.hypot(b.x - L.disc.x, b.z - L.disc.z);
    if (dd > rimR - b.r) {
      const nx = (b.x - L.disc.x) / dd, nz = (b.z - L.disc.z) / dd;
      b.x = L.disc.x + nx * (rimR - b.r);
      b.z = L.disc.z + nz * (rimR - b.r);
      const vn = b.vx * nx + b.vz * nz;
      if (vn > 0) { b.vx -= 1.5 * vn * nx; b.vz -= 1.5 * vn * nz; }
    }
    // 中央凸起：龙珠不能进入转盘中心
    const hubR = L.disc.r * 0.36;
    const hx = b.x - L.disc.x, hz = b.z - L.disc.z;
    const hd = Math.hypot(hx, hz);
    if (hd < hubR + b.r) {
      const nx = hx / (hd || 1), nz = hz / (hd || 1);
      b.x = L.disc.x + nx * (hubR + b.r);
      b.z = L.disc.z + nz * (hubR + b.r);
      const vn = b.vx * nx + b.vz * nz;
      if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vz -= 1.6 * vn * nz; }
    }
    // 与正在等待结算的球碰撞（等待球不可推动）
    for (const w of state.discBalls) {
      const hp = discHolePos(w.hole);
      const wr = w.kind === 'bigDragon' ? 0.288 * BIG_SIZE : 0.18;
      const rr2 = b.r + wr;
      const ddx = b.x - hp.x, ddz = b.z - hp.z;
      const dist = Math.hypot(ddx, ddz);
      if (dist < rr2 && dist > 0.0001) {
        const nx = ddx / dist, nz = ddz / dist;
        b.x = hp.x + nx * rr2;
        b.z = hp.z + nz * rr2;
        const vn = b.vx * nx + b.vz * nz;
        if (vn < 0) { b.vx -= 1.55 * vn * nx; b.vz -= 1.55 * vn * nz; }
      }
    }
    // 滑行球之间碰撞
    for (let j = i - 1; j >= 0; j--) {
      const o = sliders[j];
      if (o.state !== 'slide') continue;
      const ddx = b.x - o.x, ddz = b.z - o.z;
      const min = b.r + o.r;
      const dist = Math.hypot(ddx, ddz);
      if (dist < min && dist > 0.0001) {
        const nx = ddx / dist, nz = ddz / dist, overlap = (min - dist) / 2;
        b.x += nx * overlap; b.z += nz * overlap;
        o.x -= nx * overlap; o.z -= nz * overlap;
        const rvx = b.vx - o.vx, rvz = b.vz - o.vz;
        const vn = rvx * nx + rvz * nz;
        if (vn < 0) {
          const jm = -(1.2) * vn / 2;
          b.vx += jm * nx; b.vz += jm * nz;
          o.vx -= jm * nx; o.vz -= jm * nz;
        }
      }
    }
    // 惯性变弱且附近有空孔时吸附
    const sp = Math.hypot(b.vx, b.vz);
    if (sp < 0.36) {
      const hole = nearestFreeHole(b.x, b.z, 1.05);
      if (hole) {
        hole.reserved = true;
        b.hole = hole;
        b.state = 'attract';
        b.attractT = 0;
      }
    }
    // 极慢且没有孔时给一个小的逆时针推力，避免完全停死
    if (sp < 0.06 && b.state === 'slide') {
      const tx = dz / d, tz = -dx / d;
      b.vx += tx * 0.55;
      b.vz += tz * 0.55;
    }
  }
}

function updateChute(dt) {
  for (let i = state.chuteBalls.length - 1; i >= 0; i--) {
    const c = state.chuteBalls[i];
    c.t += dt;
    if (c.t >= c.dur) {
      spawnDiscSlider(c.kind, c.pearlBonus, c.variant);
      state.chuteBalls.splice(i, 1);
    }
  }
}
function angleNear(a, target, tol) {
  let d = (a - target + PI) % TAU;
  if (d < 0) d += TAU;
  d -= PI;
  return Math.abs(d) <= tol;
}
function updateDisc(dt) {
  state.discRot += dt * (state.party ? 2.15 : 1.22);
  if (state.discRot > TAU * 1000) state.discRot %= TAU;
  updateDiscSliders(dt);
  // scoring at the top/back of the disc
  for (const hole of state.discHoles) {
    if (!hole.ball || hole.ball.scored) continue;
    const a = hole.base + state.discRot;
    if (angleNear(a, -PI / 2, 0.20)) {
      scoreDiscBall(hole, hole.ball);
    }
  }
  // 检查球是否仍在盘上（简化：只按洞的状态）
}
function scoreDiscBall(hole, ball) {
  ball.scored = true;
  hole.occupied = false;
  hole.ball = null;
  const idx = state.discBalls.indexOf(ball);
  if (idx >= 0) state.discBalls.splice(idx, 1);
  const color = hole.color;
  const scr = discScreenBall(hole);
  let gain;
  const big = ball.kind === 'bigDragon';
  let baseGain;
  if (state.party) {
    baseGain = PARTY_VALUE[color];
    gain = big ? Math.round(baseGain * 1.5) : baseGain;
    showResult((big ? '大龙珠 · ' : '派对时间 · ') + HOLE_NAMES[color] + (big ? ' ×1.5' : ''), '+' + gain + ' 彩票');
  } else {
    if (state.color[color] >= 6) {
      state.color[color] = 0;
      state.partyLamp[color] = false;
    }
    const step = state.color[color];
    baseGain = NORMAL_LADDER[color][step];
    gain = big ? Math.round(baseGain * 1.5) : baseGain;
    state.color[color] = step + 1;
    showResult((big ? '大龙珠 · ' : '') + HOLE_NAMES[color] + (big ? ' ×1.5' : ''), '+' + gain + ' 彩票');
  }
  addTickets(gain, null, true);
  floatScore('+' + gain, color === 'purple' ? 'cyan' : '', scr);
  sound.score(); haptic(12);
  spawnSparks(scr.x, scr.y, HOLE_COL[color], 16);
  if (state.party) addConfetti(24, [HOLE_COL[color], '#ffe7a0', '#fff']);
  updateHUD(nowMs());
}
function discHolePos(hole) {
  const a = hole.base + state.discRot;
  return {
    x: L.disc.x + Math.cos(a) * L.disc.holeR,
    z: L.disc.z + Math.sin(a) * L.disc.holeR,
    a
  };
}
function discScreenBall(hole) {
  const p = discHolePos(hole);
  return project(p.x, 0.19, p.z);
}
function discCenter() { return project(L.disc.x, 0.16, L.disc.z); }
function discRadiusPx() { return L.disc.r * S; }

// ------------------------------------------------------------------ rotating outlet slots
function updateSlots(dt) {
  if (state.party) {
    state.slotAngle = lerp(state.slotAngle, 0, Math.min(1, dt * 9));
    state.slotDir = 0;
  } else {
    if (state.slotDir === 0) state.slotDir = -1;
    state.slotAngle += state.slotDir * SLOT_SPEED * dt;
    if (state.slotAngle <= -SLOT_MAX) { state.slotAngle = -SLOT_MAX; state.slotDir = 1; }
    else if (state.slotAngle >= SLOT_MAX) { state.slotAngle = SLOT_MAX; state.slotDir = -1; }
  }
}

// ------------------------------------------------------------------ pusher
function updatePusher(dt) {
  if (!state.started || state.paused) { state.plateVel = 0; return; }
  state.pusherPhase = (state.pusherPhase + dt / (state.party ? 3.2 : 5.3)) % 1;
  const p = state.pusherPhase;
  let front;
  if (p < 0.30) front = lerp(L.pusher.retreat, L.pusher.advance, easeInOutSine(p / 0.30));
  else if (p < 0.40) front = L.pusher.advance;
  else if (p < 0.92) front = lerp(L.pusher.advance, L.pusher.retreat, easeInOutSine((p - 0.40) / 0.52));
  else front = L.pusher.retreat;
  const prev = state.plateFront;
  state.plateFront = front;
  state.plateVel = clamp((front - prev) / Math.max(dt, 0.001), -3, 3);
}

// ------------------------------------------------------------------ particle helpers
function spawnSparks(x, y, color, n = 10) {
  for (let i = 0; i < n; i++) {
    state.sparks.push({
      x, y,
      vx: rr(-120, 120), vy: rr(-160, -20),
      life: rr(0.35, 0.75), max: 0.75,
      size: rr(1.2, 3.4), color
    });
  }
  if (state.sparks.length > 90) state.sparks.splice(0, state.sparks.length - 90);
}
function addConfetti(n, colors) {
  colors = colors || ['#ffd65a', '#ff6246', '#5ff5ff', '#ff8ce1', '#fff1b8'];
  for (let i = 0; i < n; i++) {
    state.confetti.push({
      x: W / 2 + rr(-26, 26), y: H * 0.36 + rr(-18, 18),
      vx: rr(-240, 240), vy: rr(-380, -80),
      rot: rr(0, TAU), vr: rr(-8, 8),
      w: rr(3, 8), h: rr(2, 5),
      color: pick(colors), life: rr(0.9, 1.7), max: 1.7
    });
  }
  if (state.confetti.length > 120) state.confetti.splice(0, state.confetti.length - 120);
}
function updateParticles(dt) {
  for (let i = state.sparks.length - 1; i >= 0; i--) {
    const p = state.sparks[i];
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 250 * dt;
    if (p.life <= 0) state.sparks.splice(i, 1);
  }
  for (let i = state.confetti.length - 1; i >= 0; i--) {
    const p = state.confetti[i];
    p.life -= dt;
    p.vy += 420 * dt;
    p.vx *= Math.exp(-0.4 * dt);
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.life <= 0 || p.y > H + 30) state.confetti.splice(i, 1);
  }
  for (let i = state.ticketPops.length - 1; i >= 0; i--) {
    const p = state.ticketPops[i];
    p.t += dt;
    if (p.t >= p.dur) state.ticketPops.splice(i, 1);
  }
  for (let i = state.shotFalls.length - 1; i >= 0; i--) {
    const f = state.shotFalls[i];
    f.t += dt;
    if (f.t >= f.dur) {
      addTableBody('pearl', f.x, clamp(f.z, L.table.z0 + 0.15, L.table.z1 - 0.3), {
        air: 0.1, vx: rr(-0.06, 0.06), vz: rr(0.12, 0.3)
      });
      sound.drop();
      state.shotFalls.splice(i, 1);
    }
  }
}

// ------------------------------------------------------------------ drawing: background / cabinet
const dust = Array.from({ length: 28 }, () => ({ x: rand(), y: rand(), s: rr(0.5, 1.8), p: rr(0, TAU), sp: rr(0.05, 0.2) }));

function drawBackground(now) {
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);
  // distant light rays
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 5; i++) {
    const x = W * (0.18 + i * 0.17) + Math.sin(now * 0.00008 + i) * 12;
    const g = ctx.createLinearGradient(x, 0, x + 30, H * 0.75);
    g.addColorStop(0, 'rgba(60,180,190,.055)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - 24, 0); ctx.lineTo(x + 20, 0); ctx.lineTo(x + 70, H * 0.8); ctx.lineTo(x + 10, H * 0.8);
    ctx.closePath(); ctx.fill();
  }
  // faint waves
  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = 'rgba(74,200,196,.06)';
  ctx.lineWidth = 1;
  for (let row = 0; row < 6; row++) {
    ctx.beginPath();
    for (let x = -10; x <= W + 10; x += 14) {
      const y = H * 0.29 + row * 38 + Math.sin(x * 0.02 + row * 0.8 + now * 0.00015) * 8;
      x === -10 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // dust
  for (const d of dust) {
    const x = d.x * W + Math.sin(now * 0.0002 * d.sp + d.p) * 12;
    const y = ((d.y * H + now * 0.004 * d.sp) % H);
    ctx.fillStyle = `rgba(130,223,226,${0.06 + d.s * 0.04})`;
    ctx.beginPath(); ctx.arc(x, y, d.s, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawCabinet(now) {
  // back wall
  const top = GRAV.top + 2;
  const bottom = FRONT_Y + 72;
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, '#2b080d');
  g.addColorStop(0.35, '#1a0710');
  g.addColorStop(0.75, '#0a1018');
  g.addColorStop(1, '#06090e');
  roundRect(ctx, 10, top - 6, W - 20, bottom - top + 12, 18);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(231,186,98,.33)'; ctx.lineWidth = 1.2; ctx.stroke();
  // side pillars
  const pg = ctx.createLinearGradient(0, top, 0, bottom);
  pg.addColorStop(0, '#5b2b16'); pg.addColorStop(0.5, '#2b120b'); pg.addColorStop(1, '#12080a');
  for (const x of [10, W - 22]) {
    roundRect(ctx, x, top - 2, 12, bottom - top + 6, 5);
    ctx.fillStyle = pg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,213,127,.26)'; ctx.stroke();
  }
  // neon strips
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = state.party ? 'rgba(255,152,55,.7)' : 'rgba(81,233,235,.32)';
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(17, top + 10); ctx.lineTo(17, bottom - 12); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - 17, top + 10); ctx.lineTo(W - 17, bottom - 12); ctx.stroke();
  ctx.restore();
  // soft top glow
  const gg = ctx.createRadialGradient(W / 2, top, 4, W / 2, top, W * 0.55);
  gg.addColorStop(0, 'rgba(255,164,56,.12)'); gg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gg; ctx.fillRect(0, top, W, 100);
}

function drawPayoutBoard(now) {
  const x = W - 94, y = CONSOLE.y + CONSOLE.h + 8;
  const w = 82, h = 124;
  roundRect(ctx, x, y, w, h, 7);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(8,24,32,.96)'); g.addColorStop(1, 'rgba(4,10,16,.96)');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(230,186,98,.5)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = 'rgba(255,225,158,.8)';
  ctx.font = '700 7px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('转奖倍率', x + w / 2, y + 10);
  const cols = [
    { key: 'blue', x: x + 16, color: HOLE_COL.blue, name: '蓝' },
    { key: 'yellow', x: x + 41, color: HOLE_COL.yellow, name: '黄' },
    { key: 'purple', x: x + 66, color: HOLE_COL.purple, name: '紫' }
  ];
  for (const col of cols) {
    const lv = Math.min(7, state.color[col.key]);
    ctx.fillStyle = col.color;
    ctx.font = '700 7px sans-serif';
    ctx.fillText(col.name, col.x, y + 22);
    for (let i = 0; i < 8; i++) {
      const val = PAY_TABLE[col.key][7 - i];
      const yy = y + 34 + i * 10.5;
      const active = (7 - i) === lv;
      if (active) {
        roundRect(ctx, col.x - 11, yy - 4, 22, 9, 3);
        ctx.fillStyle = col.color; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = col.color; ctx.lineWidth = 0.8; ctx.stroke();
      }
      ctx.fillStyle = active ? '#fff4ce' : 'rgba(180,210,215,.42)';
      ctx.font = active ? '800 7.5px sans-serif' : '600 6.6px sans-serif';
      ctx.fillText(String(val), col.x, yy);
    }
  }
  if (state.party) {
    ctx.strokeStyle = 'rgba(255,207,95,.7)'; ctx.lineWidth = 1.2;
    roundRect(ctx, x - 1, y - 1, w + 2, h + 2, 8); ctx.stroke();
  }
}

// ------------------------------------------------------------------ drawing: board
function drawBoard(now) {
  const b = L.board;
  const bl = boardPoint(-b.w / 2, 0), br = boardPoint(b.w / 2, 0);
  const tl = boardPoint(-b.w / 2, 2.4), tr = boardPoint(b.w / 2, 2.4);
  // frame
  fillPoly(ctx, [tl, tr, br, bl], '#07121b', 'rgba(231,186,98,.7)', 3);
  const g = ctx.createLinearGradient(0, tl.y, 0, bl.y);
  g.addColorStop(0, '#0b2635'); g.addColorStop(0.55, '#082631'); g.addColorStop(1, '#041019');
  fillPoly(ctx, [
    { x: tl.x + 4, y: tl.y + 4 }, { x: tr.x - 4, y: tr.y + 4 },
    { x: br.x - 4, y: br.y - 3 }, { x: bl.x + 4, y: bl.y - 3 }
  ], g);
  // inner frame
  ctx.strokeStyle = 'rgba(87,224,218,.16)'; ctx.lineWidth = 1;
  fillPoly(ctx, [
    { x: tl.x + 9, y: tl.y + 8 }, { x: tr.x - 9, y: tr.y + 8 },
    { x: br.x - 9, y: br.y - 7 }, { x: bl.x + 9, y: bl.y - 7 }
  ], null, 'rgba(87,224,218,.16)', 1);
  // title
  ctx.save();
  ctx.fillStyle = 'rgba(255,224,158,.55)';
  ctx.font = '600 7px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('GRAVITY PEG FIELD', (tl.x + tr.x) / 2, tl.y + 11);
  ctx.restore();
  // central divider
  const d0 = boardPoint(0, 0.42), d1 = boardPoint(0, 2.2);
  ctx.strokeStyle = 'rgba(255,209,117,.45)'; ctx.lineWidth = 1.4;
  ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(d0.x, d0.y); ctx.lineTo(d1.x, d1.y); ctx.stroke();
  ctx.setLineDash([]);
  // pegs
  for (const p of pegs) {
    const q = boardPoint(p.u, p.v);
    const rad = Math.max(1.8, p.r * S * 0.9);
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.arc(q.x + 1, q.y + 1.5, rad + 0.6, 0, TAU); ctx.fill();
    const sz = rad * 2.65;
    ctx.drawImage(sprites.peg, q.x - sz / 2, q.y - sz / 2, sz, sz);
  }
  // holes
  for (const row of ['pearl', 'ticket']) {
    for (let i = 0; i < 5; i++) {
      const q = boardPoint(holeU(row, i), 0.14);
      const color = row === 'pearl' ? '#61efff' : '#ff83dd';
      const lit = state.lamps[row][i];
      const isTarget = !state.party && state.targetRow === row && state.targetIndex === i;
      const rx = Math.max(4.2, 0.115 * S), ry = rx * 0.52;
      if (lit || isTarget) {
        const gr = ctx.createRadialGradient(q.x, q.y, 1, q.x, q.y, rx * 2.6);
        gr.addColorStop(0, color + '88'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gr; ctx.fillRect(q.x - rx * 2.6, q.y - rx * 2.6, rx * 5.2, rx * 5.2);
      }
      ctx.beginPath(); ctx.ellipse(q.x, q.y, rx, ry, 0, 0, TAU);
      ctx.fillStyle = '#010304'; ctx.fill();
      ctx.strokeStyle = lit ? color : isTarget ? '#ffffff' : 'rgba(120,190,195,.35)';
      ctx.lineWidth = lit ? 1.8 : 1;
      ctx.stroke();
    }
  }
  // target beam
  if (state.started && !state.party) {
    const tu = holeU(state.targetRow, state.targetIndex);
    const a = boardPoint(tu, 2.2), z = boardPoint(tu, 0.16);
    ctx.save();
    const pulse = 0.22 + Math.sin(now * 0.006) * 0.08;
    ctx.strokeStyle = `rgba(122,247,255,${pulse})`;
    ctx.setLineDash([2, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(z.x, z.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(z.x, z.y, 6 + Math.sin(now * 0.006) * 1.2, 3.2, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  // board balls
  for (const ball of state.pegBalls) {
    const q = boardPoint(ball.u, ball.v);
    const rad = 4.2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gl = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, rad * 3.2);
    gl.addColorStop(0, 'rgba(170,250,255,.42)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gl; ctx.fillRect(q.x - rad * 3.2, q.y - rad * 3.2, rad * 6.4, rad * 6.4);
    ctx.restore();
    const bg = ctx.createRadialGradient(q.x - 1.2, q.y - 1.4, 0.5, q.x, q.y, rad);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.4, '#d8fbff'); bg.addColorStop(1, '#5b9cac');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 0.6; ctx.stroke();
    if (ball.spark > 0) {
      ctx.strokeStyle = 'rgba(255,235,150,.45)'; ctx.beginPath(); ctx.arc(q.x, q.y, rad + 2, 0, TAU); ctx.stroke();
      ball.spark = Math.max(0, ball.spark - 0.05);
    }
  }
}

// ------------------------------------------------------------------ drawing: console
function drawConsole(now) {
  const C = CONSOLE;
  // frame
  roundRect(ctx, C.x - 1, C.y - 1, C.w + 2, C.h + 2, 15);
  ctx.fillStyle = '#4b1b0d'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,221,143,.55)'; ctx.lineWidth = 1.2; ctx.stroke();
  const g = ctx.createLinearGradient(0, C.y, 0, C.y + C.h);
  g.addColorStop(0, '#0a1a25'); g.addColorStop(0.55, '#08131d'); g.addColorStop(1, '#050a10');
  roundRect(ctx, C.x, C.y, C.w, C.h, 14);
  ctx.fillStyle = g; ctx.fill();
  // title
  const tg = ctx.createLinearGradient(0, C.y + 4, 0, C.y + 24);
  tg.addColorStop(0, '#fff4c8'); tg.addColorStop(0.5, '#f0c56b'); tg.addColorStop(1, '#b67620');
  ctx.fillStyle = tg;
  ctx.font = '900 21px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(255,175,60,.45)'; ctx.shadowBlur = 8;
  ctx.fillText('東 海 龍 珠', W / 2, C.y + 14);
  ctx.shadowBlur = 0;
  // displays
  const leftX = C.x + 9, rightX = C.x + C.w - 99;
  drawSevenSeg(ctx, leftX, C.y + 25, 82, 34, state.pearls, 3, '#5cefff', '余珠');
  drawSevenSeg(ctx, rightX, C.y + 25, 90, 34, state.tickets, 6, '#ffd06a', '余票');
  // bulbs middle
  const gapL = leftX + 84, gapR = rightX - 4;
  const cx1 = (gapL + gapR) / 2;
  const rows = [
    { row: 'pearl', y: C.y + 69, color: '#5ff3ff' },
    { row: 'ticket', y: C.y + 94, color: '#ff80df' }
  ];
  for (const row of rows) {
    ctx.fillStyle = 'rgba(200,230,232,.52)';
    ctx.font = '500 7px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(row.row === 'pearl' ? '珍珠灯' : '彩票灯', cx1 - 60, row.y);
    for (let i = 0; i < 5; i++) {
      const x = cx1 - 48 + i * 24;
      const lit = state.lamps[row.row][i];
      const isTarget = !state.party && state.targetRow === row.row && state.targetIndex === i;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.006 + i);
      const img = lit ? (row.row === 'pearl' ? sprites.bulbPearlOn : sprites.bulbTicketOn)
                      : (row.row === 'pearl' ? sprites.bulbPearlOff : sprites.bulbTicketOff);
      const bs = isTarget ? 17 + pulse * 2 : 15;
      ctx.drawImage(img, x - bs / 2, row.y - bs / 2, bs, bs);
      if (isTarget) {
        ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(x, row.y, 7.6, 0, TAU); ctx.stroke();
      }
    }
  }
  // party glow
  if (state.party) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const pg = ctx.createLinearGradient(C.x, C.y, C.x + C.w, C.y + C.h);
    pg.addColorStop(0, 'rgba(255,117,44,.16)'); pg.addColorStop(0.5, 'rgba(255,208,85,.1)'); pg.addColorStop(1, 'rgba(90,240,240,.12)');
    roundRect(ctx, C.x, C.y, C.w, C.h, 14); ctx.fillStyle = pg; ctx.fill();
    ctx.restore();
  }
}

// ------------------------------------------------------------------ drawing: roulette side zone
function drawRouletteZone(now) {
  const x = GRAV.x + GRAV.w + 7;
  const y = GRAV.top;
  const w = W - 12 - x;
  const h = GRAV.bottom - GRAV.top;
  if (w < 70) return;
  roundRect(ctx, x, y, w, h, 11);
  const bg = ctx.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, 'rgba(39,8,17,.95)'); bg.addColorStop(0.55, 'rgba(16,9,19,.96)'); bg.addColorStop(1, 'rgba(5,12,17,.97)');
  ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = 'rgba(231,186,98,.35)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = 'rgba(84,225,218,.12)'; ctx.lineWidth = 1;
  roundRect(ctx, x + 5, y + 5, w - 10, h - 10, 8); ctx.stroke();

  const titleGrad = ctx.createLinearGradient(0, y + 8, 0, y + 30);
  titleGrad.addColorStop(0, '#fff3c8'); titleGrad.addColorStop(0.55, '#f1c467'); titleGrad.addColorStop(1, '#a9691d');
  ctx.fillStyle = titleGrad;
  ctx.font = '900 18px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('东海龙珠', x + w / 2, y + 20);
  ctx.fillStyle = 'rgba(255,215,137,.45)';
  ctx.font = '500 5.8px sans-serif';
  ctx.fillText('转奖区奖励灯', x + w / 2, y + 34);

  const cols = [
    { key: 'blue', color: HOLE_COL.blue, x: x + w * 0.25, name: '蓝' },
    { key: 'purple', color: HOLE_COL.purple, x: x + w * 0.5, name: '紫' },
    { key: 'yellow', color: HOLE_COL.yellow, x: x + w * 0.75, name: '黄' }
  ];
  const startY = y + 49, stepY = Math.min(22.2, (h - 104) / 7);
  const sepY = startY + stepY * 0.55;
  for (let row = 0; row < 7; row++) {
    const yy = startY + row * stepY;
    for (const c of cols) {
      const level = 6 - row;
      const lit = row === 0 ? !!state.partyLamp[c.key] : state.color[c.key] > level;
      const value = REWARD_GRID[c.key][row];
      if (lit) {
        const gr = ctx.createRadialGradient(c.x, yy, 1, c.x, yy, 17);
        gr.addColorStop(0, c.color + 'aa'); gr.addColorStop(1, c.color + '00');
        ctx.fillStyle = gr; ctx.fillRect(c.x - 17, yy - 17, 34, 34);
      }
      const rr = 10.2;
      const bgr = ctx.createRadialGradient(c.x - 3, yy - 3, 1, c.x, yy, rr);
      if (lit) {
        bgr.addColorStop(0, '#ffffff'); bgr.addColorStop(0.35, c.color); bgr.addColorStop(1, '#20373c');
      } else if (c.key === 'blue') {
        bgr.addColorStop(0, '#12344a'); bgr.addColorStop(1, '#04101a');
      } else if (c.key === 'purple') {
        bgr.addColorStop(0, '#38204a'); bgr.addColorStop(1, '#100718');
      } else {
        bgr.addColorStop(0, '#4b3a12'); bgr.addColorStop(1, '#191303');
      }
      ctx.beginPath(); ctx.arc(c.x, yy, rr, 0, TAU); ctx.fillStyle = bgr; ctx.fill();
      ctx.strokeStyle = lit ? c.color : c.color + '77'; ctx.lineWidth = lit ? 1.4 : 0.9; ctx.stroke();
      if (lit) {
        ctx.fillStyle = '#fff7dc';
      } else {
        ctx.fillStyle = c.color;
        ctx.globalAlpha = 0.58;
      }
      ctx.font = lit ? '800 8px sans-serif' : '600 7.8px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(value), c.x, yy + 0.5);
      ctx.globalAlpha = 1;
    }
  }
  // divider: row 1 = party lamp, rows 2-7 = normal lamps
  ctx.strokeStyle = 'rgba(255,215,137,.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 12, sepY); ctx.lineTo(x + w - 12, sepY); ctx.stroke();
  ctx.fillStyle = 'rgba(255,215,137,.5)'; ctx.font = '500 5px sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText('派对', x + w - 12, sepY - 5);

  // columns labels: 蓝 紫 黄
  const labelY = y + h - 48;
  ctx.font = '700 8px sans-serif';
  for (const c of cols) {
    ctx.fillStyle = c.color;
    ctx.fillText(c.name, c.x, labelY);
  }
  ctx.strokeStyle = 'rgba(255,215,137,.2)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 12, labelY + 12); ctx.lineTo(x + w - 12, labelY + 12); ctx.stroke();
}

// ------------------------------------------------------------------ drawing: table
function drawTable(now) {
  const t = L.table;
  const bl = project(tableLeftAt(t.z1), 0, t.z1), br = project(t.x1, 0, t.z1);
  const tl = project(t.x0, 0, t.z0), tr = project(t.x1, 0, t.z0);
  // side / front thickness
  fillPoly(ctx, [bl, br, { x: br.x, y: br.y + 13 }, { x: bl.x, y: bl.y + 13 }], '#16080c');
  fillPoly(ctx, [tl, bl, { x: bl.x, y: bl.y + 10 }, { x: tl.x, y: tl.y + 10 }], '#1e0b0d');
  // top
  const g = ctx.createLinearGradient(0, tl.y, 0, bl.y);
  g.addColorStop(0, '#0b4441'); g.addColorStop(0.42, '#073a3b'); g.addColorStop(1, '#052127');
  fillPoly(ctx, [tl, tr, br, bl], g);
  // inlaid wave lines clipped to table
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y); ctx.closePath();
  ctx.clip();
  ctx.strokeStyle = 'rgba(84,218,199,.08)'; ctx.lineWidth = 2;
  for (let row = 0; row < 7; row++) {
    const y = tl.y + 16 + row * 18;
    ctx.beginPath();
    for (let x = tl.x - 15; x <= br.x + 15; x += 12) {
      const yy = y + Math.sin(x * 0.05 + row * 1.2 + now * 0.0003) * 4;
      x === tl.x - 15 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  // central gold dragon curve
  ctx.strokeStyle = 'rgba(232,190,98,.1)'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath();
  const mx = (tl.x + br.x) / 2, my = (tl.y + br.y) / 2;
  ctx.moveTo(mx - 70, my + 30); ctx.bezierCurveTo(mx - 30, my - 50, mx + 20, my + 55, mx + 66, my - 20);
  ctx.stroke();
  ctx.restore();
  // rails
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(222,176,88,.85)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(br.x, br.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tl.x, tl.y); ctx.lineTo(bl.x, bl.y); ctx.stroke();
  ctx.strokeStyle = 'rgba(84,238,232,.32)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tl.x + 4, tl.y + 4); ctx.lineTo(tr.x - 4, tr.y + 4); ctx.lineTo(br.x - 4, br.y - 4); ctx.stroke();
  // front drop trough
  const fy = bl.y;
  // black drop chute: pearls +1 ticket, dragon balls slide right on two steel rails
  const tg = ctx.createLinearGradient(0, fy - 8, 0, fy + 9);
  tg.addColorStop(0, 'rgba(0,0,0,.35)');
  tg.addColorStop(0.3, 'rgba(9,12,14,.96)');
  tg.addColorStop(0.72, 'rgba(4,6,8,.98)');
  tg.addColorStop(1, 'rgba(0,0,0,.98)');
  ctx.fillStyle = tg;
  ctx.fillRect(bl.x + 2, fy - 8, br.x - bl.x - 4, 17);
  ctx.strokeStyle = 'rgba(180,204,212,.38)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(bl.x + 6, fy - 7); ctx.lineTo(br.x - 6, fy - 7); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.1)';
  ctx.beginPath(); ctx.moveTo(bl.x + 8, fy + 5); ctx.lineTo(br.x - 8, fy + 5); ctx.stroke();
  ctx.fillStyle = 'rgba(220,235,240,.55)';
  for (let i = 0; i < 3; i++) {
    const x = br.x - 20 - i * 10, y = fy + 4;
    ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 2, y); ctx.lineTo(x - 3, y + 3); ctx.lineTo(x - 1, y); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = 'rgba(225,240,245,.72)';
  ctx.font = '600 6.5px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('掉落区 · 珍珠 +1彩票', bl.x + 10, fy - 12);
  ctx.textAlign = 'right';
  ctx.fillText('龙珠 → 钢导轨', br.x - 10, fy - 12);

  // right deck
  const d = L.deck;
  const dl = project(d.x0, -0.02, d.z0), dr = project(d.x1, -0.02, d.z0);
  const dfr = project(d.x1, -0.02, d.z1), dfl = project(d.x0, -0.02, d.z1);
  fillPoly(ctx, [dl, dr, dfr, dfl], '#06171c', 'rgba(229,185,97,.62)', 2.4);
  const dg = ctx.createLinearGradient(0, dl.y, 0, dfl.y);
  dg.addColorStop(0, '#0a3337'); dg.addColorStop(1, '#061d23');
  fillPoly(ctx, [
    { x: dl.x + 4, y: dl.y + 4 }, { x: dr.x - 4, y: dr.y + 4 },
    { x: dfr.x - 4, y: dfr.y - 4 }, { x: dfl.x + 4, y: dfl.y - 4 }
  ], dg);
  ctx.fillStyle = 'rgba(255,213,132,.45)';
  ctx.font = '600 6.5px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('转 奖 区', (dl.x + dr.x) / 2, dl.y + 9);
  // separator rail
  ctx.strokeStyle = 'rgba(232,187,98,.7)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(project(t.x1, 0, t.z0).x, project(t.x1, 0, t.z0).y); ctx.lineTo(br.x, br.y); ctx.stroke();

}

function drawOutlet(p, label, color) {
  ctx.save();
  const g = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, 18);
  g.addColorStop(0, color + '55'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(p.x - 18, p.y - 18, 36, 36);
  ctx.fillStyle = 'rgba(5,14,20,.85)';
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  roundRect(ctx, p.x - 14, p.y - 5, 28, 10, 4); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.font = '700 6px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(label, p.x, p.y - 7);
  ctx.restore();
}

function drawChuteRails() {
  const dc = discCenter();
  const rx = discRadiusPx(), ry = rx * 0.56;
  const a = project(L.table.x1 - 0.02, 0.02, L.table.z1 + 0.04);
  const e = { x: dc.x + rx * 0.38, y: dc.y + ry * 0.76 };
  const cp1 = { x: a.x + 58, y: a.y + 7 };
  const cp2 = { x: dc.x + rx * 0.08, y: dc.y + ry * 1.02 };
  for (const off of [-4.5, 4.5]) {
    const p0 = { x: a.x, y: a.y + off };
    const c1 = { x: cp1.x, y: cp1.y + off };
    const c2 = { x: cp2.x, y: cp2.y + off };
    const p3 = { x: e.x, y: e.y + off };
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 5.2;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y + 1.6); ctx.bezierCurveTo(c1.x, c1.y + 1.6, c2.x, c2.y + 1.6, p3.x, p3.y + 1.6); ctx.stroke();
    const sg = ctx.createLinearGradient(p0.x, 0, p3.x, 0);
    sg.addColorStop(0, '#6b7e87'); sg.addColorStop(0.35, '#e7f2f7'); sg.addColorStop(0.7, '#9cb1ba'); sg.addColorStop(1, '#f5fcff');
    ctx.strokeStyle = sg; ctx.lineWidth = 2.8;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p3.x, p3.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 0.75;
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y - 1); ctx.bezierCurveTo(c1.x, c1.y - 1, c2.x, c2.y - 1, p3.x, p3.y - 1); ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(215,235,242,.75)'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(e.x, e.y - 4.5); ctx.lineTo(e.x - 10, e.y - 13); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(e.x, e.y + 4.5); ctx.lineTo(e.x - 10, e.y - 4); ctx.stroke();
}

// ------------------------------------------------------------------ drawing: gravity upper section
function drawRedDot(x, y, r = 2.8, glow = false) {
  const size = r * 3;
  ctx.drawImage(sprites.redDot, x - size / 2, y - size / 2, size, size);
}

/**
 * 左上角八段管要显示的数字。
 *
 * 【为什么是函数而不是直接写 state.coinsSpent】挑战局有币数上限，
 *   玩家关心的是"还能投几颗"；普通局无上限，剩余数没有意义，仍显示已用币。
 */
/**
 * 外壳 HUD 卡片的底边（canvas 坐标系）。
 * 【为什么要实时量】卡片高度会随字体、安全区、机型变化，
 *   写死一个像素值在别的机型上又会压住。
 */
function hudSafeTop() {
  if (typeof document === 'undefined') return 0;
  // 【为什么取三块 HUD 的最大底边】机台上方压着两层 DOM：
  //   #status（已用币 / 得票卡片）和 #colorRow（蓝孔 / 紫孔 / 黄孔）。
  //   只避让第一层的话，八段管会正好落在第二层下面。
  let bottom = 0;
  for (const sel of ['#status', '#colorRow']) {
    const el = document.querySelector('.dh-root ' + sel);
    if (el) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  }
  return bottom;
}

/**
 * 左上角八段管要显示的数字。
 *
 * 【为什么挑战局显示"剩余"】挑战局的限额是 50/80/100/120 币，
 *   玩家关心的是"还能投几颗"；普通局无上限，剩余数没有意义，仍显示已用币。
 */
function tubeLeftValue() {
  if (coinLimit > 0) return Math.max(0, coinLimit - state.coinsSpent);
  return state.coinsSpent;
}

/** 与 tubeLeftValue 配套的标签 */
function tubeLeftLabel() {
  return coinLimit > 0 ? '剩余弹珠' : '已用币';
}

function drawTube3(x, y, value, color, label) {
  const cellW = 18, cellH = 27, gap = 2;
  const s = fmt(value).padStart(3, '0').slice(-3);
  for (let i = 0; i < 3; i++) {
    const tx = x + i * (cellW + gap);
    drawSevenSeg(ctx, tx, y, cellW, cellH, s[i], 1, color, '');
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.strokeRect(tx + .5, y + .5, cellW - 1, cellH - 1);
  }
  ctx.fillStyle = 'rgba(255,104,82,.62)';
  ctx.font = '600 7px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(label, x + (cellW * 3 + gap * 2) / 2, y + cellH + 2);
}
function drawGravity(now) {
  const gx = GRAV.x, gy = GRAV.top, gw = GRAV.w, gh = GRAV.bottom - GRAV.top;
  // back panel: deliberately flat / blueprint-like
  roundRect(ctx, gx, gy, gw, gh, 11);
  const bg = ctx.createLinearGradient(0, gy, 0, gy + gh);
  bg.addColorStop(0, '#071923'); bg.addColorStop(0.55, '#06151e'); bg.addColorStop(1, '#040d14');
  ctx.fillStyle = bg; ctx.fill();
  ctx.strokeStyle = 'rgba(76,218,221,.28)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = 'rgba(232,187,98,.18)'; ctx.lineWidth = 1;
  roundRect(ctx, gx + 5, gy + 5, gw - 10, gh - 10, 8); ctx.stroke();
  // subtle vertical guide lines
  ctx.save();
  ctx.strokeStyle = 'rgba(82,196,201,.045)'; ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    const x = gx + i * gw / 6;
    ctx.beginPath(); ctx.moveTo(x, gy + 6); ctx.lineTo(x, gy + gh - 6); ctx.stroke();
  }
  ctx.restore();

  // ---- top counts: 3 tubes | outlet | 3 tubes
  // 【为什么要用同一个 tubeY】两组 3 位管必须严格在同一水平线上，
  //   错开一格看着就是"没对齐的坏 UI"。
  // 【为什么不能写死 gy + 8】gy 是机台顶边，而外壳的「已用币 / 得票」卡片
  //   和「蓝孔 / 紫孔 / 黄孔」两行是 DOM 层（z-index 高于 canvas），
  //   底边在 183px 左右。画在机台顶部会被这两层压住，只露出一点红字。
  //   这里实时量它们的底边，两组共用同一个 Y。
  const tubeY = Math.max(gy + 8, hudSafeTop() - canvas.getBoundingClientRect().top + 6);
  drawTube3(gx + 2, tubeY, tubeLeftValue(), '#5cefff', tubeLeftLabel());
  drawTube3(gx + gw - 2 - (18 * 3 + 4), tubeY, state.ticketsRemaining, '#ffcf62', '剩余彩票');
  const outX = GRAV.cx, outY = gy + 16;
  // fixed square outlet
  ctx.strokeStyle = 'rgba(92,222,233,.75)'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(outX - 6, outY - 6); ctx.lineTo(outX + 6, outY - 6);
  ctx.lineTo(outX + 6, outY + 6); ctx.lineTo(outX - 6, outY + 6); ctx.closePath(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,220,150,.55)'; ctx.font = '600 5.5px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('出口', outX, outY - 10);
  // rotating twin slots
  const pivotY = outY + 9;
  const ang = state.party ? 0 : state.slotAngle;
  ctx.save();
  ctx.translate(outX, pivotY);
  ctx.rotate(ang);
  for (const lx of [-4.2, 4.2]) {
    ctx.strokeStyle = state.party ? 'rgba(255,214,120,.9)' : 'rgba(76,180,255,.9)';
    ctx.lineWidth = 2.1;
    ctx.shadowColor = state.party ? '#ffb84d' : '#43aaff';
    ctx.shadowBlur = 5;
    ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, 36); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(lx, 36, 1.2, 0, TAU); ctx.fillStyle = 'rgba(170,235,255,.75)'; ctx.fill();
  }
  // little angle arc
  ctx.strokeStyle = 'rgba(255,214,120,.35)'; ctx.lineWidth = .8;
  ctx.beginPath(); ctx.arc(0, 0, 20, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.stroke();
  ctx.restore();
  if (state.party) {
    ctx.fillStyle = 'rgba(255,221,140,.8)'; ctx.font = '600 5.5px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('LOCK 0°', outX, pivotY + 40);
  }

  // ---- peg matrix
  for (const p of pegs) {
    const q = boardPoint(p.u, p.v);
    // dark red halo makes the dot read at small sizes
    ctx.beginPath(); ctx.arc(q.x, q.y, 4.1, 0, TAU); ctx.fillStyle = 'rgba(70,8,10,.55)'; ctx.fill();
    drawRedDot(q.x, q.y, 2.6);
  }

  // ---- lamp strip between peg matrix and lower columns
  const stripY = GRAV.lampY1 + 10;
  const partyOn = state.party;
  // 派对倒计时只画在下方前面板，不再重复
  const pearlXs = [GRAV.cx - 64, GRAV.cx - 54, GRAV.cx - 44, GRAV.cx - 34, GRAV.cx - 24];
  const ticketXs = [GRAV.cx + 24, GRAV.cx + 34, GRAV.cx + 44, GRAV.cx + 54, GRAV.cx + 64];
  const activeNext = state.activeRow ? firstUnlit(state.activeRow) : -1;
  function drawLamp(x, row, i) {
    const lit = state.lamps[row][i];
    const isNext = !partyOn && state.activeRow === row && activeNext === i;
    const img = lit ? (row === 'pearl' ? sprites.bulbPearlOn : sprites.bulbTicketOn)
                    : (row === 'pearl' ? sprites.bulbPearlOff : sprites.bulbTicketOff);
    if (lit || isNext) {
      const col = row === 'pearl' ? '95,243,255' : '255,128,223';
      const gr = ctx.createRadialGradient(x, stripY, 1, x, stripY, isNext ? 16 : 12);
      gr.addColorStop(0, `rgba(${col},${isNext ? .28 : .42})`); gr.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = gr; ctx.fillRect(x - 16, stripY - 16, 32, 32);
    }
    const size = isNext ? 13 : 11;
    ctx.drawImage(img, x - size / 2, stripY - size / 2, size, size);
    if (isNext) {
      ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, stripY, 7, 0, TAU); ctx.stroke();
    }
  }
  for (let i = 0; i < 5; i++) { drawLamp(pearlXs[i], 'pearl', i); drawLamp(ticketXs[i], 'ticket', i); }
  // labels: 珍珠灯 | 派对时间 | 彩票灯
  ctx.fillStyle = 'rgba(216,238,238,.6)'; ctx.font = '600 7px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('珍珠灯', GRAV.cx - 44, GRAV.rodTop - 7);
  ctx.fillText('派对时间', GRAV.cx, GRAV.rodTop - 7);
  ctx.fillText('彩票灯', GRAV.cx + 44, GRAV.rodTop - 7);
  ctx.strokeStyle = 'rgba(255,213,132,.18)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(gx + 16, GRAV.rodTop - 1); ctx.lineTo(gx + gw - 16, GRAV.rodTop - 1); ctx.stroke();

  // ---- 8 pillars with 9 reward zones between them
  const zoneCenters = Array.from({ length: 9 }, (_, i) => GRAV.cx + (-1.6 + i * 0.4) * GRAV.uScale);
  const pillarXs = Array.from({ length: 8 }, (_, i) => GRAV.cx + (-1.4 + i * 0.4) * GRAV.uScale);
  const zoneEdges = [GRAV.x + 4, ...pillarXs, GRAV.x + GRAV.w - 4];
  for (let i = 0; i < 9; i++) {
    const type = COLUMN_TYPES[i];
    const col = COLUMN_COL[type];
    const l = zoneEdges[i], r = zoneEdges[i + 1];
    const zg = ctx.createLinearGradient(0, GRAV.rodTop - 4, 0, GRAV.rodBot + 4);
    zg.addColorStop(0, col + '20'); zg.addColorStop(0.55, col + '38'); zg.addColorStop(1, col + '10');
    ctx.fillStyle = zg;
    ctx.fillRect(l + 0.5, GRAV.rodTop - 4, Math.max(0, r - l - 1), GRAV.rodBot - GRAV.rodTop + 8);
    ctx.strokeStyle = col + '24'; ctx.lineWidth = 0.6;
    ctx.strokeRect(l + 0.5, GRAV.rodTop - 4, Math.max(0, r - l - 1), GRAV.rodBot - GRAV.rodTop + 8);
    ctx.fillStyle = col;
    ctx.font = '600 5.2px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(COLUMN_LABEL[type], zoneCenters[i], GRAV.rodTop + 9);
  }
  // pillars: blue lines only, no GeoGebra-style red points
  for (const x of pillarXs) {
    ctx.save();
    ctx.strokeStyle = 'rgba(68,164,255,.9)'; ctx.lineWidth = 2.2;
    ctx.shadowColor = '#2f93ff'; ctx.shadowBlur = 4;
    ctx.beginPath(); ctx.moveTo(x, GRAV.rodTop); ctx.lineTo(x, GRAV.rodBot); ctx.stroke();
    ctx.restore();
  }
  // 无 两侧不再加挡板/斜导轨
  // ---- balls falling through the peg matrix
  // 【为什么珠子要画到 6.2px 并带拖尾】原来只有 4.4px，在 390px 宽的屏上
  //   基本是个小点；而整段下落只有 0.3~0.4 秒，玩家点完发射看到的是
  //   "闪了一下就没了"，会以为卡住。放大 + 拖尾让落点看得见。
  for (const ball of state.pegBalls) {
    const q = boardPoint(ball.u, ball.v);
    const rad = 6.2;
    // 拖尾：沿速度反方向画 3 个渐隐小圆
    if (ball.vu !== 0 || ball.vv !== 0) {
      for (let k = 1; k <= 3; k++) {
        const tq = boardPoint(ball.u - ball.vu * 0.018 * k, ball.v - ball.vv * 0.018 * k);
        ctx.beginPath();
        ctx.arc(tq.x, tq.y, rad * (1 - k * 0.22), 0, TAU);
        ctx.fillStyle = 'rgba(150,240,255,' + (0.2 - k * 0.055) + ')';
        ctx.fill();
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gl = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, rad * 3.4);
    gl.addColorStop(0, 'rgba(170,250,255,.4)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gl; ctx.fillRect(q.x - rad * 3.4, q.y - rad * 3.4, rad * 6.8, rad * 6.8);
    ctx.restore();
    ctx.beginPath(); ctx.arc(q.x, q.y, rad + 1.2, 0, TAU); ctx.fillStyle = 'rgba(30,70,80,.5)'; ctx.fill();
    const bg = ctx.createRadialGradient(q.x - 1.4, q.y - 1.6, 0.5, q.x, q.y, rad);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.42, '#c8f8ff'); bg.addColorStop(1, '#4f8d9d');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(q.x, q.y, rad, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = .6; ctx.stroke();
  }
}

// ------------------------------------------------------------------ drawing: pusher / disc
function drawPusher(now) {
  const zf = state.plateFront;
  const z0 = L.table.z0 + 0.12;
  const x0 = L.pusher.x0, x1 = L.pusher.x1;
  const topY = 0.32;
  const a = project(x0, topY, z0), b = project(x1, topY, z0);
  const c = project(x1, topY, zf), d = project(x0, topY, zf);
  const df = project(x1, 0, zf), dg = project(x0, 0, zf);
  // top
  const g = ctx.createLinearGradient(0, a.y, 0, d.y);
  g.addColorStop(0, '#3c0d12'); g.addColorStop(0.55, '#23080d'); g.addColorStop(1, '#3a0d11');
  fillPoly(ctx, [a, b, c, d], g, 'rgba(226,178,86,.5)', 1.2);
  // front face
  const fg = ctx.createLinearGradient(0, d.y, 0, dg.y);
  fg.addColorStop(0, '#d5a54c'); fg.addColorStop(0.18, '#8e5b1d'); fg.addColorStop(0.45, '#4b1114'); fg.addColorStop(1, '#25070b');
  fillPoly(ctx, [d, c, df, dg], fg, 'rgba(255,224,145,.6)', 1.2);
  // gold top edge
  ctx.strokeStyle = 'rgba(255,218,133,.8)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(c.x, c.y); ctx.stroke();
  // ridges
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = lerp(d.x, c.x, t);
    const y = lerp(d.y, c.y, t);
    ctx.strokeStyle = 'rgba(255,221,148,.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y + 8); ctx.stroke();
  }
  // emblem
  const ex = (d.x + c.x) / 2, ey = (d.y + c.y) / 2 + 8;
  ctx.save();
  ctx.globalAlpha = 0.5; ctx.fillStyle = '#f8d781';
  ctx.font = '900 13px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('龍', ex, ey);
  ctx.restore();
  // side shadow
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.fillRect(a.x, a.y + 2, 3, d.y - a.y + 4);
}

function drawDisc(now) {
  const p = discCenter();
  const rx = discRadiusPx(), ry = rx * 0.56;
  // base shadow / side
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.beginPath(); ctx.ellipse(p.x + 3, p.y + 8, rx * 1.05, ry * 1.05, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2b1608';
  ctx.beginPath(); ctx.ellipse(p.x, p.y + 6, rx, ry, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(226,181,91,.8)'; ctx.lineWidth = 2; ctx.stroke();
  // top
  const g = ctx.createRadialGradient(p.x - rx * .25, p.y - ry * .35, 2, p.x, p.y, rx);
  g.addColorStop(0, '#124b4d'); g.addColorStop(0.55, '#092d33'); g.addColorStop(1, '#041318');
  ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(255,219,135,.55)'; ctx.lineWidth = 1.5; ctx.stroke();
  // colored sectors (soft)
  ctx.save();
  ctx.beginPath(); ctx.ellipse(p.x, p.y, rx * .92, ry * .92, 0, 0, TAU); ctx.clip();
  for (let i = 0; i < 6; i++) {
    const a0 = (i * TAU / 6) + state.discRot - Math.PI / 2;
    const a1 = a0 + TAU / 6;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.ellipse(p.x, p.y, rx * .92, ry * .92, 0, a0, a1);
    ctx.closePath();
    ctx.fillStyle = HOLE_COL[HOLE_COLORS[i]] + '12';
    ctx.fill();
    ctx.strokeStyle = HOLE_COL[HOLE_COLORS[i]] + '28';
    ctx.lineWidth = .8; ctx.stroke();
  }
  ctx.restore();
  // raised center hub (dragon balls physically cannot enter)
  const hubX = rx * 0.36, hubY = ry * 0.36, lift = 8;
  // base shadow
  ctx.beginPath(); ctx.ellipse(p.x + 2, p.y + lift + 2, hubX * 1.06, hubY * 1.06, 0, 0, TAU);
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill();
  // side wall
  ctx.beginPath();
  ctx.moveTo(p.x - hubX, p.y);
  ctx.lineTo(p.x - hubX, p.y + lift);
  ctx.ellipse(p.x, p.y + lift, hubX, hubY, 0, Math.PI, 0, true);
  ctx.lineTo(p.x + hubX, p.y);
  ctx.ellipse(p.x, p.y, hubX, hubY, 0, 0, Math.PI, true);
  ctx.closePath();
  const sideG = ctx.createLinearGradient(0, p.y, 0, p.y + lift + hubY);
  sideG.addColorStop(0, '#8e5b1c'); sideG.addColorStop(1, '#2b1605');
  ctx.fillStyle = sideG; ctx.fill();
  // top
  ctx.beginPath(); ctx.ellipse(p.x, p.y, hubX, hubY, 0, 0, TAU);
  const hg = ctx.createRadialGradient(p.x - hubX * .3, p.y - hubY * .4, 1, p.x, p.y, hubX);
  hg.addColorStop(0, '#fff0b4'); hg.addColorStop(0.35, '#d69a3a'); hg.addColorStop(0.75, '#6f4310'); hg.addColorStop(1, '#2a1504');
  ctx.fillStyle = hg; ctx.fill();
  ctx.strokeStyle = 'rgba(255,239,180,.8)'; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(p.x, p.y, hubX * .72, hubY * .72, 0, 0, TAU);
  ctx.strokeStyle = 'rgba(70,235,228,.3)'; ctx.lineWidth = .8; ctx.stroke();
  ctx.fillStyle = '#4a1308'; ctx.font = '900 12px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('龍', p.x, p.y + 0.5);
  // holes
  for (const hole of state.discHoles) {
    const hp = discHolePos(hole);
    const q = project(hp.x, 0.18, hp.z);
    const hr = L.disc.holeR2 * S * 0.92;
    const col = HOLE_COL[hole.color];
    ctx.beginPath(); ctx.ellipse(q.x, q.y, hr * 1.08, hr * .56, 0, 0, TAU);
    ctx.fillStyle = '#010203'; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
    if (!hole.ball && !hole.reserved) {
      ctx.beginPath(); ctx.ellipse(q.x, q.y, hr * .64, hr * .33, 0, 0, TAU);
      ctx.strokeStyle = col + '55'; ctx.lineWidth = .8; ctx.stroke();
    }
  }
  // rotation arrow
  ctx.strokeStyle = 'rgba(99,232,232,.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(p.x, p.y, rx + 7, ry + 4, 0, Math.PI * 0.95, Math.PI * 1.6); ctx.stroke();
  // label
  ctx.fillStyle = 'rgba(255,218,142,.65)'; ctx.font = '700 7px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('龙珠转奖圆盘 · 顺时针', p.x, p.y - ry - 7);
  ctx.restore();
}

// ------------------------------------------------------------------ drawing: balls / objects
function drawSprite(img, x, y, size, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = 1;
}
function drawBigDragon(x, y, size) {
  const r = size / 2;
  ctx.save();
  const glow = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 1.5);
  glow.addColorStop(0, 'rgba(70,210,255,.28)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
  const g = ctx.createRadialGradient(x - r * .28, y - r * .32, r * .08, x, y, r);
  g.addColorStop(0, '#f2ffff'); g.addColorStop(.16, '#a8f3ff'); g.addColorStop(.42, '#42b7ff');
  g.addColorStop(.72, '#1263d6'); g.addColorStop(.92, '#082f82'); g.addColorStop(1, '#03143e');
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(170,245,255,.8)'; ctx.lineWidth = Math.max(1, size * .035); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, r * .82, 0, TAU);
  ctx.strokeStyle = 'rgba(255,226,142,.35)'; ctx.lineWidth = Math.max(.7, size * .018); ctx.stroke();
  ctx.fillStyle = 'rgba(255,229,150,.9)'; ctx.font = '900 ' + Math.round(size * .34) + 'px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('龍', x, y + size * .02);
  ctx.beginPath(); ctx.ellipse(x - r * .32, y - r * .38, r * .2, r * .1, -0.6, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.fill();
  ctx.restore();
}

function drawTableBall(b, now) {
  const air = b.air > 0 ? b.air : 0;
  const p = project(b.x, BODY_REST[b.kind] + air, b.z);
  const ground = project(b.x, 0, b.z);
  const size = b.kind === 'bigDragon' ? b.r * S * 2.7 : b.kind === 'dragon' ? b.r * S * 2.55 : b.r * S * 2.45;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(ground.x, ground.y + 2.5, b.r * S * 0.9, b.r * S * 0.48, 0, 0, TAU); ctx.fill();
  ctx.restore();
  if (b.kind === 'bigDragon') drawBigDragon(p.x, p.y, size);
  else if (b.kind === 'dragon') drawSprite(sprites.dragons[b.variant % 7], p.x, p.y, size);
  else drawSprite(sprites.pearl, p.x, p.y, size);
}
function drawDiscBall(ball, now) {
  const q = discScreenBall(ball.hole);
  const size = ball.kind === 'bigDragon' ? 44 * BIG_SIZE : ball.kind === 'dragon' ? 28 : 18;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.beginPath(); ctx.ellipse(q.x, q.y + 5, 7, 3, 0, 0, TAU); ctx.fill();
  ctx.restore();
  if (ball.kind === 'bigDragon') drawBigDragon(q.x, q.y - 2, size);
  else if (ball.kind === 'dragon') drawSprite(sprites.dragons[ball.variant % 7], q.x, q.y - 2, size);
  else drawSprite(sprites.pearl, q.x, q.y - 2, size);
}
function drawChuteBall(c) {
  const t = easeOutCubic(clamp(c.t / c.dur, 0, 1));
  const x = (1 - t) * (1 - t) * c.sx + 2 * (1 - t) * t * c.mx + t * t * c.ex;
  const y = (1 - t) * (1 - t) * c.sy + 2 * (1 - t) * t * c.my + t * t * c.ey;
  const size = c.kind === 'bigDragon' ? 44 * BIG_SIZE : c.kind === 'dragon' ? 27 : 17;
  if (c.kind === 'bigDragon') drawBigDragon(x, y, size);
  else if (c.kind === 'dragon') drawSprite(sprites.dragons[c.variant % 7], x, y, size);
  else drawSprite(sprites.pearl, x, y, size);
}
function drawObjects(now) {
  const list = [];
  for (const b of state.tableBalls) {
    if (!b.alive) continue;
    const p = project(b.x, 0, b.z);
    list.push({ z: b.z, y: b.air, type: 'table', b, p });
  }
  for (const ball of state.discBalls) {
    const hp = discHolePos(ball.hole);
    list.push({ z: hp.z + 0.01, y: 0.25, type: 'disc', ball, p: project(hp.x, 0.2, hp.z) });
  }
  for (const sld of state.discSliders) {
    list.push({ z: sld.z, y: 0.26, type: 'slider', sld, p: project(sld.x, 0.26, sld.z) });
  }
  for (const c of state.chuteBalls) {
    const t = clamp(c.t / c.dur, 0, 1);
    const y = (1 - t) * (1 - t) * c.sy + 2 * (1 - t) * t * c.my + t * t * c.ey;
    const x = (1 - t) * (1 - t) * c.sx + 2 * (1 - t) * t * c.mx + t * t * c.ex;
    list.push({ z: L.disc.z + 0.4 - t * 0.4, y: 0, type: 'chute', c, p: { x, y } });
  }
  list.sort((a, b) => (a.z - b.z) || (a.y - b.y));
  for (const item of list) {
    if (item.type === 'table') drawTableBall(item.b, now);
    else if (item.type === 'disc') drawDiscBall(item.ball, now);
    else if (item.type === 'slider') {
      const sld = item.sld;
      const size = sld.kind === 'bigDragon' ? 46 * BIG_SIZE : sld.kind === 'dragon' ? 27 : 17;
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.ellipse(item.p.x, item.p.y + 5, 8, 3.4, 0, 0, TAU); ctx.fill();
      if (sld.kind === 'bigDragon') drawBigDragon(item.p.x, item.p.y, size);
      else if (sld.kind === 'dragon') drawSprite(sprites.dragons[sld.variant % 7], item.p.x, item.p.y, size);
      else drawSprite(sprites.pearl, item.p.x, item.p.y, size);
      // 逆时针惯性尾迹
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createRadialGradient(item.p.x, item.p.y, 1, item.p.x, item.p.y, size * .8);
      gr.addColorStop(0, 'rgba(100,235,255,.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(item.p.x - size, item.p.y - size, size * 2, size * 2);
      ctx.restore();
    }
    else drawChuteBall(item.c);
  }
  // 发射珍珠落入黑色落珠口后的下落动画
  for (const f of state.shotFalls) {
    const t = clamp(f.t / f.dur, 0, 1);
    const e = t * t;
    const x = (1 - e) * (1 - e) * f.sx + 2 * (1 - e) * e * f.cx + e * e * f.ex;
    const y = (1 - e) * (1 - e) * f.sy + 2 * (1 - e) * e * f.cy + e * e * f.ey;
    ctx.save();
    ctx.globalAlpha = 1 - Math.max(0, (t - 0.82) / 0.18);
    // 下落轨迹
    ctx.strokeStyle = 'rgba(150,240,255,.28)'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let k = Math.max(0, t - 0.22); k <= t; k += 0.035) {
      const e2 = k * k;
      const tx = (1 - e2) * (1 - e2) * f.sx + 2 * (1 - e2) * e2 * f.cx + e2 * e2 * f.ex;
      const ty = (1 - e2) * (1 - e2) * f.sy + 2 * (1 - e2) * e2 * f.cy + e2 * e2 * f.ey;
      k === Math.max(0, t - 0.22) ? ctx.moveTo(tx, ty) : ctx.lineTo(tx, ty);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.beginPath(); ctx.ellipse(x, y + 7, 5, 2.5, 0, 0, TAU); ctx.fill();
    drawSprite(sprites.pearl, x, y, 18);
    ctx.restore();
  }
  // 等待入盘的球
  if (state.discPending.length) {
    const p = discCenter();
    ctx.fillStyle = 'rgba(255,229,163,.8)';
    ctx.font = '700 7px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('排队 ×' + state.discPending.length, p.x + discRadiusPx() * .6, p.y - discRadiusPx() * .7);
  }
}

// ------------------------------------------------------------------ drawing: front / fx
function drawFront(now) {
  const top = tableFrontY() + 8;
  const height = Math.min(96, H - top - 128);
  const x = 14, w = W - 28;
  const g = ctx.createLinearGradient(0, top, 0, top + height);
  g.addColorStop(0, '#4b1018'); g.addColorStop(0.25, '#2c080e'); g.addColorStop(1, '#0d0306');
  roundRect(ctx, x, top, w, height, 10);
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(232,187,98,.45)'; ctx.lineWidth = 1; ctx.stroke();
  // gold trim
  ctx.strokeStyle = 'rgba(255,218,142,.24)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 8, top + 8); ctx.lineTo(x + w - 8, top + 8); ctx.stroke();
  // wave lines
  ctx.strokeStyle = 'rgba(78,222,211,.13)'; ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    for (let xx = x + 10; xx < x + w - 10; xx += 8) {
      const yy = top + 16 + k * 8 + Math.sin(xx * .08 + k) * 2;
      xx === x + 10 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
    }
    ctx.stroke();
  }
  const jpX = W / 2 - 78, jpY = top + 16;
  drawSevenSeg(ctx, jpX, jpY, 156, 38, state.ticketsRemaining, 5, '#ff6948', '剩余彩票 · REMAIN');
  drawSevenSeg(ctx, W / 2 + 86, jpY + 3, 44, 32, state.party ? Math.max(0, Math.ceil((state.partyEnd - now) / 1000)) : 0, 2, '#ff8ce1', '派对');
  // coin slot
  ctx.fillStyle = '#170b04';
  roundRect(ctx, x + 20, top + 26, 30, 20, 5); ctx.fill();
  ctx.strokeStyle = 'rgba(231,186,98,.5)'; ctx.stroke();
  ctx.fillStyle = 'rgba(70,255,160,.7)';
  roundRect(ctx, x + 33, top + 30, 3, 12, 1.5); ctx.fill();
  ctx.fillStyle = 'rgba(255,223,162,.5)'; ctx.font = '600 6px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('投币', x + 35, top + 52);
  // ticket dispenser (real arcade paper tickets)
  const slotW = 156, slotX = W / 2 - 78;
  const slotY = top + 64;
  roundRect(ctx, slotX, slotY - 11, slotW, 35, 5);
  const hg = ctx.createLinearGradient(0, slotY - 11, 0, slotY + 24);
  hg.addColorStop(0, '#3f3a32'); hg.addColorStop(0.45, '#181614'); hg.addColorStop(1, '#060505');
  ctx.fillStyle = hg; ctx.fill();
  ctx.strokeStyle = 'rgba(210,222,228,.4)'; ctx.lineWidth = 1; ctx.stroke();
  // printer mouth
  roundRect(ctx, slotX + 4, slotY, slotW - 8, 7, 3);
  ctx.fillStyle = '#010203'; ctx.fill();
  ctx.strokeStyle = 'rgba(220,235,240,.55)'; ctx.lineWidth = 1; ctx.stroke();
  for (let i = 0; i < 11; i++) {
    const tx = slotX + 12 + i * (slotW - 24) / 10;
    ctx.strokeStyle = 'rgba(210,225,232,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tx, slotY + 1); ctx.lineTo(tx, slotY + 6); ctx.stroke();
  }
  // red LED + label
  ctx.beginPath(); ctx.arc(slotX - 3, slotY + 3.5, 2.2, 0, TAU);
  ctx.fillStyle = 'rgba(255,54,32,.9)'; ctx.fill();
  ctx.fillStyle = 'rgba(255,224,170,.65)'; ctx.font = '600 5.5px sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('出票口', slotX + 4, slotY - 5);
  ctx.textAlign = 'right';
  ctx.fillText('TICKET', slotX + slotW - 4, slotY - 5);
  // paper tickets emerging downward from the mouth
  const nPops = state.ticketPops.length;
  for (let i = 0; i < nPops; i++) {
    const pop = state.ticketPops[i];
    const p = clamp(pop.t / pop.dur, 0, 1);
    const reveal = clamp(pop.t / 0.22, 0, 1);
    const alpha = p > 0.78 ? Math.max(0, (1 - p) / 0.22) : 1;
    const ww = 68, hh = 25;
    const px = W / 2 + pop.dx + (i - (nPops - 1) / 2) * 2;
    const py = slotY + 2 + (i % 3) * 1.2 + Math.sin(pop.t * 7) * 0.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.rect(slotX - 24, slotY + 1, slotW + 48, reveal * (hh + 3));
    ctx.clip();
    ctx.translate(px, py);
    ctx.rotate(pop.rot);
    // paper
    roundRect(ctx, -ww / 2, 0, ww, hh, 2);
    ctx.fillStyle = '#f2e7c6'; ctx.fill();
    ctx.strokeStyle = 'rgba(180,52,38,.7)'; ctx.lineWidth = 1; ctx.stroke();
    // perforation
    ctx.fillStyle = 'rgba(90,70,50,.45)';
    for (let k = 0; k < 4; k++) {
      ctx.beginPath(); ctx.arc(-ww / 2 + 3, 4 + k * 5.5, 1, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(ww / 2 - 3, 4 + k * 5.5, 1, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#a52a20'; ctx.font = '700 5px sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('东海龙珠 · TICKET', -ww / 2 + 7, 5);
    ctx.font = '800 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('+1', 2, 14);
    ctx.fillStyle = 'rgba(80,40,30,.65)'; ctx.font = '500 4px sans-serif';
    ctx.textAlign = 'right'; ctx.fillText('No.' + String(1000 + Math.floor(pop.t * 37) % 9000), ww / 2 - 7, 22);
    // barcode
    let bx = -ww / 2 + 8;
    while (bx < ww / 2 - 8) {
      const bw = 0.7 + ((i * 7 + Math.floor(bx)) % 3) * 0.55;
      ctx.fillStyle = 'rgba(45,35,28,.65)';
      ctx.fillRect(bx, 18.5, bw, 4);
      bx += bw + 1.2;
    }
    ctx.restore();
  }
  // sim note
  ctx.fillStyle = 'rgba(188,210,213,.28)'; ctx.font = '500 5.5px sans-serif';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText('初始机台 · 模拟 10,000 次投珠', x + w - 18, top + 91);
  // gold base
  ctx.fillStyle = 'rgba(217,171,83,.45)';
  ctx.fillRect(x, top + height - 4, w, 2);
}

function drawEffects(dt) {
  if (state.party) {
    ctx.save();
    const g = ctx.createRadialGradient(W / 2, H * .38, 20, W / 2, H * .38, W * .8);
    g.addColorStop(0, 'rgba(255,157,46,.08)'); g.addColorStop(0.6, 'rgba(255,84,42,.045)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of state.sparks) {
    const a = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a, 0, TAU); ctx.fill();
  }
  ctx.restore();
  for (const p of state.confetti) {
    ctx.save();
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
}

function render(now) {
  drawBackground(now);
  drawCabinet(now);
  drawGravity(now);
  drawRouletteZone(now);
  drawTable(now);
  drawPusher(now);
  drawDisc(now);
  drawChuteRails();
  drawObjects(now);
  drawFront(now);
  drawEffects(0);
}

// ------------------------------------------------------------------ UI helpers
let mascotTimer = 0;
function toast(text, type = '') {
  const b = el.mascotBubble;
  if (!b) return;
  b.textContent = text;
  b.className = 'mascot-bubble show' + (type ? ' ' + type : '');
  if (el.mascotAvatar) {
    el.mascotAvatar.classList.remove('talking');
    void el.mascotAvatar.offsetWidth;
    el.mascotAvatar.classList.add('talking');
  }
  clearTimeout(mascotTimer);
  mascotTimer = setTimeout(() => {
    b.classList.remove('show');
    if (el.mascotAvatar) el.mascotAvatar.classList.remove('talking');
  }, 2600);
}
/**
 * 结算：把「已用币 / 获得彩票」换算成本局成绩。
 *
 * 【为什么结算是"随时可点"而不是"打完才弹"】
 *   推币机没有终点——币是无限的，玩多久都行。所以结算是玩家自己
 *   决定"这一局到此为止"的动作，点了就按当前数据结算。
 *
 * 【为什么点完要重置盘面】用户明确要求"本局结束，盘面重置，
 *   可以立刻开下一局"。不重置的话，上一局攒的龙珠和灯会带到下一局，
 *   等于用别人的钱打自己的榜。
 */
/**
 * 结算回调，由宿主注入。
 * 【为什么用回调而不是让 game.js 直接 import stats】game.js 是移植来的
 *   纯玩法代码，不该知道"每日 3 次""周榜"这些小程序规则。
 *   宿主注入一个函数，游戏只管把成绩交出去，规则留在外面。
 */
let settleHandler = null;
export function setSettleHandler(fn) { settleHandler = fn; }

/**
 * 本局投币上限。
 * 【为什么要有上限】原版是无限投币的街机，玩多久都行。
 *   但每日挑战要公平比"每币回报率"，如果一个人能投 5000 币、
 *   另一个人只投 50 币，那前期盘面还没"养起来"的人必然吃亏——
 *   实测前 20 秒每币只有 1.18 张，2 分钟后才 4.5 张，
 *   盘面是越推越顺的。所以挑战局必须卡在同一个币数。
 * 【为什么是"上限"而不是"固定"】玩家可以中途结算（投得少但回报高也是本事），
 *   只是不能超过。
 */
let coinLimit = 0;
export function setCoinLimit(n) { coinLimit = Math.max(0, Math.floor(n || 0)); }

/**
 * 恢复本局已经消耗的额度。
 *
 * 【为什么需要这个】挑战局的进度是存在存档里的（save_42），
 *   重新进入机台时要把"这局已经投了几币"补回来，
 *   否则限额从 0 重算，玩家可以靠反复退出重进刷额度。
 *   盘面珠子不恢复——那是纯视觉的，重新落一遍就行。
 */
function restoreCoins(coins, tickets) {
  state.coinsSpent = Math.max(0, Math.floor(coins || 0));
  state.tickets = Math.max(0, Math.floor(tickets || 0));
  state.ticketsRemaining = state.tickets;
  updateHUD(nowMs());
}
export function getCoinLimit() { return coinLimit; }
export function isLimitReached() { return coinLimit > 0 && state.coinsSpent >= coinLimit; }

async function doSettle() {
  const coins = state.coinsSpent;
  // 【为什么要把没吐完的票算进来】ticketsRemaining 是"已经赢到、还没打印出来"
  //   的票。出票器每秒只吐 11.7 张，派对里一次中奖就是 170~280 张，
  //   攒下几百张很正常。原来只认 state.tickets（已吐出的），
  //   玩家赢了票却拿不到分 —— 这是对玩家不利的 bug。
  //   反过来，如果不在这里一次性结清，玩家可以先结算拿到低分记录、
  //   再让出票器慢慢吐，下一局凭空多出一堆票。
  //   两种方向都不对，所以结算时直接按"已得票 = 已吐 + 未吐"算。
  const tickets = state.tickets + Math.max(0, state.ticketsRemaining);
  if (coins === 0) {
    toast('还没投币，先打几颗珠子吧', 'red');
    return null;
  }
  const perCoin = ticketsPerCoin(coins, tickets);
  const score = roundScore(perCoin);
  const q = quantize(score);

  // 填弹窗
  el.stCoins.textContent = comma(coins);
  el.stTickets.textContent = comma(tickets);
  el.stAvg.textContent = perCoin.toFixed(3);
  el.stScore.textContent = score.toFixed(3);
  el.stQuant.textContent = q.toFixed(2);
  // 说明为什么是这个分
  const diff = score - BASE_TICKETS_PER_COIN;
  el.stNote.textContent = diff >= 0
    ? `每币 ${perCoin.toFixed(3)} 张，比基准 ${BASE_TICKETS_PER_COIN.toFixed(3)} 高 ${diff.toFixed(3)} 张，按对数加分。`
    : `每币 ${perCoin.toFixed(3)} 张，比基准 ${BASE_TICKETS_PER_COIN.toFixed(3)} 低 ${(-diff).toFixed(3)} 张，按比例折算。`;

  el.settleModal.classList.remove('hidden');
  state.paused = true;
  sound.tone(880, 0.12, 'sine', 0.02);

  const result = { coins, tickets, perCoin, score, q };
  // 交给宿主判断能否记入周榜
  if (settleHandler) {
    try {
      const res = await settleHandler(result);
      if (res && res.reason) {
        el.stNote.textContent = (el.stNote.textContent || '') + '\n' + res.reason;
        el.stNote.style.whiteSpace = 'pre-line';
      }
    } catch (e) {
      console.warn('[donghai] 结算回调失败', e);
    }
  }
  return result;
}

/** 关闭结算弹窗；restart=true 时重置盘面开新局 */
function closeSettle(restart) {
  el.settleModal.classList.add('hidden');
  if (restart) resetRound();
  else if (state.started) { state.paused = false; state.lastFrame = nowMs(); }
}

/**
 * 重置一局：清空盘面、币、票、灯，重新铺台。
 * 【为什么连 seedTable 一起调】台面上攒的珍珠和龙珠是上一局的资产，
 *   不清掉就等于新局白送一堆珠。重新铺台才是干净的起点。
 */
function resetRound() {
  state.coinsSpent = 0;
  state.tickets = 0;
  state.ticketsRemaining = 0;
  state.total = 0;
  state.pearls = 0;
  state.tableBalls.length = 0;
  state.pegBalls.length = 0;
  state.chuteBalls.length = 0;
  state.discBalls.length = 0;
  state.discSliders.length = 0;
  state.discPending.length = 0;
  state.lamps.pearl = [false, false, false, false, false];
  state.lamps.ticket = [false, false, false, false, false];
  state.activeRow = null;
  state.party = false;
  state.color = { blue: 0, yellow: 0, purple: 0 };
  state.partyLamp = { blue: false, purple: false, yellow: false };
  state.autoFire = false;
  state.nextPrintAt = 0;
  seedTable();
  initDiscHoles(true);
  refreshUI();
  state.paused = false;
  state.lastFrame = nowMs();
  toast('新的一局 · 祝你好运', 'gold');
}

function floatScore(text, cls = '', screen = null) {
  const d = document.createElement('div');
  d.className = 'float-score ' + cls;
  d.textContent = text;
  d.style.left = (screen ? screen.x : W / 2) + 'px';
  d.style.top = (screen ? screen.y : H * 0.43) + 'px';
  el.floats.appendChild(d);
  setTimeout(() => { try { d.remove(); } catch (e) {} }, 1250);
}
function showResult(title, sub) {
  el.rbTitle.textContent = title;
  el.rbSub.textContent = sub;
  el.resultBanner.classList.remove('hidden');
  el.resultBanner.classList.remove('jp');
  el.resultBanner.style.animation = 'none';
  void el.resultBanner.offsetWidth;
  el.resultBanner.style.animation = '';
  clearTimeout(state.resultTimer);
  state.resultTimer = setTimeout(() => el.resultBanner.classList.add('hidden'), 1500);
}
function setText(node, t) { if (node && node.textContent !== String(t)) node.textContent = String(t); }

function updateHUD(now) {
  setText(el.statCoins, comma(state.coinsSpent));
  setText(el.statTickets, comma(state.tickets));
  setText(el.screenCoins, comma(state.coinsSpent));
  setText(el.screenTickets, comma(state.tickets));
  setText(el.lvBlue, '×' + (state.party ? PARTY_VALUE.blue : NORMAL_LADDER.blue[state.color.blue % 6]));
  setText(el.lvPurple, '×' + (state.party ? PARTY_VALUE.purple : NORMAL_LADDER.purple[state.color.purple % 6]));
  setText(el.lvYellow, '×' + (state.party ? PARTY_VALUE.yellow : NORMAL_LADDER.yellow[state.color.yellow % 6]));
  let dragons = 0;
  for (const b of state.tableBalls) if (b.kind === 'dragon' || b.kind === 'bigDragon') dragons++;
  setText(el.tableCount, '盘面龙珠 ' + dragons);
  const partyOn = state.party && now < state.partyEnd;
  el.fire.classList.toggle('party', partyOn);
  el.auto.classList.toggle('on', state.autoFire);
  setText(el.auto.querySelector('b'), state.autoFire ? '开' : '关');
}


function insertCoin() {
  if (!state.started) return;
  sound.init();
  addPearls(10, true);
  sound.coin(); haptic(10);
  spawnSparks(W * 0.19, FRONT_Y + 34, '#54ffb0', 8);
  if (nowMs() - state.lastCoinToast > 1000) {
    state.lastCoinToast = nowMs();
    toast('补珠成功 · 珍珠 +10', 'gold');
  }
  updateHUD(nowMs());
}
function emptyAmmo() {
  if (nowMs() - state.lastCoinToast < 900) return;
  state.lastCoinToast = nowMs();
  toast('珍珠不足，点「补珠 +10」补充', 'red');
  sound.fail();
  if (el.coin.animate) el.coin.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }, { transform: 'scale(1)' }], { duration: 320, iterations: 2 });
  if (state.autoFire) state.autoFire = false;
}

function startGame() {
  if (state.started) return;
  sound.init(); sound.coin(); haptic(14);

  // 【为什么开局必须清一次】startGame 是"从开始界面进入一局"，
  //   而 state 是模块级的：上一局退出时只清了账目（见 unmount），
  //   盘面上的球还留着。不清就直接开局，等于白送上一局攒下的珠，
  //   转盘上方一下堆七八颗龙珠，开局瞬间掉进去变几百彩票。
  //   注意这里的顺序：先清账目，再 seedTable 重新铺台。
  //   restoreCoins 会在这之后把挑战局进度写回来，所以不能反过来。
  state.coinsSpent = 0;
  state.tickets = 0;
  state.ticketsRemaining = 0;
  state.total = 0;
  state.pearls = 0;
  state.holdFire = false;
  state.autoFire = false;
  state.party = false;
  state.over = false;
  state.tableBalls.length = 0;
  state.discBalls.length = 0;
  state.discSliders.length = 0;
  state.discPending.length = 0;
  seedTable();
  initDiscHoles(true);
  refreshUI();

  state.started = true;
  state.paused = false;
  state.lastFrame = nowMs();
  state.nextShot = nowMs() + 180;
  el.startScreen.classList.add('hidden');
  updateHUD(nowMs());
  toast('欢迎来到东海龙宫 · 开始投珠', 'gold');
  setTimeout(() => { if (state.started) toast('瞄准同一组灯洞，点亮 5 盏进入派对'); }, 3200);
  setTimeout(() => { if (state.started) toast('龙珠从右侧滑道进入转奖盘，紫孔倍率最高'); }, 7000);
  addConfetti(30, ['#ffd65a', '#6ff7ff', '#ff8ce1']);
}
function openHelp() {
  if (!state.started) return;
  state.paused = true;
  state.holdFire = false;
  el.helpModal.classList.remove('hidden');
}
function closeHelp() {
  el.helpModal.classList.add('hidden');
  if (state.started) {
    state.paused = false;
    state.lastFrame = nowMs();
    sound.resume();
  }
}

// ------------------------------------------------------------------ 宿主钩子
// 【为什么提到顶层】这三个是给小程序外壳调的（切后台暂停、返回键），
//   不能藏在 bindEvents 里面——那样外面 import 不到。
function donghaiPause() { state.paused = true; sound.suspend(); }
function donghaiResume() {
  if (state.started && el.helpModal && el.helpModal.classList.contains('hidden')) {
    state.paused = false; state.lastFrame = nowMs();
  }
  sound.resume();
}
function donghaiBack() {
  if (el.helpModal && !el.helpModal.classList.contains('hidden')) { closeHelp(); return true; }
  return !state.started;
}

// ------------------------------------------------------------------ input
// 【为什么整段包成 bindEvents】这些监听绑在 el.xxx 上，
//   而 el 要等 mount 之后才存在。放在模块顶层会在 import 时就崩。
function bindEvents() {
  // ------------------------------------------------------------------ input
  let holdStart = 0;
  el.fire.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (!state.started) return;
    sound.init();
    state.holdFire = true;
    holdStart = nowMs();
    state.nextHold = nowMs() + 270;
    el.fire.classList.add('pressed');
    try { el.fire.setPointerCapture(e.pointerId); } catch (err) {}
    shoot();
  });
  function endHold() { state.holdFire = false; el.fire.classList.remove('pressed'); }
  el.fire.addEventListener('pointerup', endHold);
  el.fire.addEventListener('pointercancel', endHold);
  el.fire.addEventListener('contextmenu', e => e.preventDefault());
  el.auto.addEventListener('click', () => {
    sound.init();
    if (!state.started) return;
    state.autoFire = !state.autoFire;
    state.nextAuto = nowMs() + 180;
    toast(state.autoFire ? '自动连发开启' : '自动连发关闭');
    sound.tone(state.autoFire ? 900 : 420, 0.07, 'triangle', 0.018);
    updateHUD(nowMs());
  });
  el.btnSound.addEventListener('click', () => {
    sound.init();
    const on = sound.toggle();
    state.soundOn = on;
    el.btnSound.classList.toggle('off', !on);
    toast(on ? '声音已开启' : '声音已关闭');
  });
  el.btnHelp.addEventListener('click', openHelp);
  el.closeHelp.addEventListener('click', closeHelp);
  el.helpOk.addEventListener('click', closeHelp);
  el.helpModal.addEventListener('click', e => { if (e.target === el.helpModal) closeHelp(); });
  el.startBtn.addEventListener('click', startGame);
  // 结算：随时可点，按当前「币 / 票」当场算分
  el.settle.addEventListener('click', () => {
    if (!state.started) { toast('先开始游戏吧', 'red'); return; }
    doSettle();
  });
  el.closeSettle.addEventListener('click', () => closeSettle(false));
  el.settleAgain.addEventListener('click', () => closeSettle(true));
  el.settleModal.addEventListener('click', e => { if (e.target === el.settleModal) closeSettle(false); });
  // 松手要能中断连发，但 window 上的监听不能在这里绑（见 bindGlobalEvents）
  endHoldRef = endHold;
}

/**
 * 全局监听：只绑一次。
 *
 * 【为什么必须和 bindEvents 分开】bindEvents 绑的是 el.xxx，也就是机台 DOM。
 *   退出时 root.remove() 会把那些元素连同监听一起销毁，所以每次进来都要重绑。
 *   但 window / document 是长生的：在这里再绑一次就是叠加，
 *   一次点击会触发两遍、三遍……表现是"投一币扣了好几币"。
 *   所以按宿主拆分：元素级每次都绑，全局级只绑一次。
 */
function bindGlobalEvents() {
  window.addEventListener('pointerup', () => { if (endHoldRef) endHoldRef(); });
  window.addEventListener('blur', () => { if (endHoldRef) endHoldRef(); });
  window.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    sound.init();
    if (e.code === 'Space') { e.preventDefault(); if (!state.started) startGame(); else shoot(); }
    else if (e.key === 'c' || e.key === 'C') insertCoin();
    else if (e.key === 'p' || e.key === 'P') { if (!state.party && state.started) startParty(state.targetRow); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { state.paused = true; sound.suspend(); }
    else if (el.helpModal && el.helpModal.classList.contains('hidden')) {
      if (state.started) { state.paused = false; state.lastFrame = nowMs(); }
      sound.resume();
    }
  });
  window.addEventListener('focus', () => {
    if (state.started && el.helpModal && el.helpModal.classList.contains('hidden')) {
      state.paused = false; state.lastFrame = nowMs();
    }
  });
}

function updateAuto(now) {
  if (!state.started || state.paused) return;
  if (state.holdFire && now - holdStart > 250 && now >= state.nextHold) {
    state.nextHold = now + 500;
    shoot();
  }
  if (state.autoFire) {
    if (now >= state.nextAuto) {
      state.nextAuto = now + 520;
      shoot();
    }
  }
}

// ------------------------------------------------------------------ ticket dispenser
function updateDispenser(now) {
  if (!state.started || state.paused) return;
  if (now < state.nextPrintAt) return;
  if (state.ticketsRemaining <= 0) { state.nextPrintAt = 0; return; }
  state.ticketsRemaining--;
  state.tickets++;
  state.total++;
  state.nextPrintAt = now + 85; // about 11.7 tickets / second
  state.ticketPops.push({ amount: 1, t: 0, dur: rr(1.05, 1.45), dx: rr(-5, 5), rot: rr(-0.08, 0.08) });
  if (state.ticketPops.length > 6) state.ticketPops.shift();
  if (sound.throttle('printer', 60)) { sound.noise(0.035, 0.01, 1300); sound.tone(210, 0.03, 'square', 0.006); }
  updateHUD(now);
}

// ------------------------------------------------------------------ main loop
function frame(now) {
  // 【这里不能再无条件 requestAnimationFrame】原版是自驱动的，
  //   末尾又加了一次，两处同时注册会让每帧的注册数翻倍（1→2→4→8…），
  //   几十帧后主线程直接卡死。现在只在末尾按 running 注册一次。
  if (!state.lastFrame) state.lastFrame = now;
  let dt = (now - state.lastFrame) / 1000;
  state.lastFrame = now;
  if (!isFinite(dt) || dt < 0) dt = 0;
  dt = Math.min(dt, 0.05);

  // 【为什么整段包 try】requestAnimationFrame 注册在函数最末尾，
  //   中间任何一处抛异常（比如某颗球的数据异常、某个 DOM 节点没取到），
  //   这一帧就中断了，末尾的注册不会执行 —— 动画循环永久停止，
  //   整个机台看起来就是"卡死"：画面冻住、点发射也没反应。
  //   线上真实出现过"按下发射就卡死"，而单帧异常正是最符合这个现象的原因。
  //   这里兜住异常：出错也保证下一帧继续跑，同时把错误记下来（只记前几条，
  //   避免刷屏把控制台拖垮）。
  try {
    if (state.started && !state.paused) {
      updatePusher(dt);
      updateTable(dt);
      updatePegBoard(dt);
      updateSlots(dt);
      updateChute(dt);
      updateDisc(dt);
      updateParty(now);
      updateDispenser(now);
      updateAuto(now);
    } else if (!state.started) {
      state.discRot += dt * 0.15;
      updateSlots(dt);
    }
    updateParticles(dt);
    if (now - state.hudClock > 100) {
      state.hudClock = now;
      updateHUD(now);
    }
    if (now - state.lastRenderAt >= 24) {
      state.lastRenderAt = now;
      render(now);
    }
  } catch (err) {
    // 同一个错误只记一次，避免每帧刷屏
    state.frameErrors = state.frameErrors || [];
    const msg = String(err && err.message || err);
    if (state.frameErrors.length < 5 && !state.frameErrors.some(e => e.msg === msg)) {
      state.frameErrors.push({ msg, stack: String(err && err.stack || '').split('\n').slice(0, 3).join(' | ') });
      console.error('[东海龙珠] 帧内异常（已兜住，动画继续）:', err);
    }
  } finally {
    // 无论上面发生什么，都必须注册下一帧，否则循环就断了
    if (running) rafId = requestAnimationFrame(frame);
  }
}

// ------------------------------------------------------------------ boot / debug
function refreshUI() {
  el.btnSound.classList.toggle('off', !state.soundOn);
  updateHUD(nowMs());
}

/**
 * 挂载到宿主给的容器上。
 * 【为什么不再自动启动】原来脚本一加载就 resize + requestAnimationFrame，
 *   那是"整页归我"的假设。嵌进小程序后，容器可能还没尺寸、也可能反复进出，
 *   所以改成显式 mount / unmount，由宿主决定什么时候开始。
 */
let running = false;
let rafId = 0;
/**
 * 松手回调的引用。
 * 【为什么要这个间接层】endHold 是 bindEvents 里的闭包，每次 mount 都是新的；
 *   window 上的 pointerup 只绑一次，必须能拿到"当前这一次"的 endHold。
 */
let endHoldRef = null;
/** 全局监听是否已绑（window / document 长生，只能绑一次） */
let globalBound = false;
function mount(root) {
  rootEl = root;
  // el 是模块级常量，依赖 DOM 已经存在，所以只能在 mount 之后重建
  bindEls();
  // 同一个容器反复进出时不要重复绑监听，否则一次点击会触发多次
  // 【为什么元素级必须每次都绑】退出时 root.remove() 把机台 DOM 连同监听
  //   一起销毁了，重新进来是全新的元素，不重绑就是"按钮全都没反应"。
  //   之前用一个 eventsBound 标志把整段都跳过了，表现正是
  //   "退出后再进卡在首页，开始游戏点不动"。
  bindEvents();
  if (!globalBound) { bindGlobalEvents(); globalBound = true; }
  resize();
  seedTable();
  initDiscHoles(true);
  refreshUI();
  running = true;
  state.lastFrame = nowMs();
  rafId = requestAnimationFrame(frame);
}
function unmount() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  sound.suspend && sound.suspend();

  // 【为什么必须在这里把局内状态清干净】state 是模块级的，退出机台只是
  //   停掉 raf，started / paused / 盘面都还留着。下次再进来时
  //   startGame() 里那句 el.startScreen.classList.add('hidden') 早就加过了，
  //   开始界面永远不出现 —— 玩家退出再进会直接落在半局的机台上，
  //   "参加周榜"按钮点不到（它长在开始界面上），挑战也没法开始。
  state.started = false;
  state.paused = false;
  state.over = false;
  state.coinsSpent = 0;
  state.tickets = 0;
  state.ticketsRemaining = 0;
  state.holdFire = false;
  state.frameErrors = [];
  coinLimit = 0;
}
window.addEventListener('resize', () => { if (running) resize(); });

const API = {
  state,
  start: startGame,
  shoot,
  insertCoin,
  startParty: () => startParty(state.activeRow || 'pearl'),
  addTickets,
  spawnDragonBall,
  selectRow,
  cycleTarget,
  openHelp,
  closeHelp,
  debug: {
    forceParty() {
      if (!state.started) startGame();
      state.lamps.pearl = [true, true, true, true, true];
      state.activeRow = 'pearl';
      state.targetRow = 'pearl';
      startParty('pearl');
    },
    addDragons(n = 3) { spawnDragonBall(n); },
    feedDisc(color, kind = 'dragon') {
      const hole = state.discHoles.find(h => h.color === color && !h.occupied && !h.reserved) ||
        state.discHoles.find(h => !h.occupied && !h.reserved);
      if (!hole) return false;
      hole.occupied = true;
      const ball = { kind, pearlBonus: kind !== 'dragon', variant: Math.floor(rand() * 7), hole, t: 0, scored: false, color: hole.color };
      hole.ball = ball;
      state.discBalls.push(ball);
      return true;
    },
    spawnSlider(kind = 'dragon') { return spawnDiscSlider(kind, kind !== 'dragon', Math.floor(rand() * 7)); },
    hitColumn(i) { onColumnHit(i, columnU(i), 0.2); },
    resolveColumn(u) { return resolveColumnIndex(u); },
    snapshot() {
      return {
        coinsSpent: state.coinsSpent, tickets: state.tickets, total: state.total,
        party: state.party, table: state.tableBalls.length,
        dragons: state.tableBalls.filter(b => b.kind === 'dragon').length,
        pegBalls: state.pegBalls.length, discBalls: state.discBalls.length,
        chute: state.chuteBalls.length, pending: state.discPending.length,
        discRotation: state.discRot
      };
    }
  }
};

// 【导出】宿主只需要 mount / unmount 两个生命周期，其余是给结算和调试用的
export { mount, unmount, API, state, donghaiPause, donghaiResume, donghaiBack, doSettle, resetRound, closeSettle, restoreCoins };
