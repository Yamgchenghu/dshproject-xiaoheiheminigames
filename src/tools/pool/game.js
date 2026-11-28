(() => {
'use strict';

/* ============================================================
   一杆清台 · HTML5 台球
   单文件逻辑：物理、规则、AI、渲染、UI、大模型接入
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const WORLD = { w: 1000, h: 550 };
const TABLE = { x: 50, y: 50, w: 900, h: 450 };
const POCKETS = [
  { id: 'tl', name: '左上角袋', x: TABLE.x, y: TABLE.y, corner: true },
  { id: 'tm', name: '上中袋', x: TABLE.x + TABLE.w / 2, y: TABLE.y, corner: false },
  { id: 'tr', name: '右上角袋', x: TABLE.x + TABLE.w, y: TABLE.y, corner: true },
  { id: 'bl', name: '左下角袋', x: TABLE.x, y: TABLE.y + TABLE.h, corner: true },
  { id: 'bm', name: '下中袋', x: TABLE.x + TABLE.w / 2, y: TABLE.y + TABLE.h, corner: false },
  { id: 'br', name: '右下角袋', x: TABLE.x + TABLE.w, y: TABLE.y + TABLE.h, corner: true },
];
const POCKET_R = 23.5;
const PHYS = { friction: 470, cushion: 0.79, ballE: 0.945, capture: 0.82, contain: 0.9 };
const CUE_POWER_STEPS = 32;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const len = (x, y) => Math.hypot(x, y);
const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-6) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const mx = ox - cx, my = oy - cy;
  const b = mx * dx + my * dy;
  const c = mx * mx + my * my - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = -b - sq, t2 = -b + sq;
  if (t2 < 0) return null;
  return t1 >= 0 ? t1 : 0;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- providers ---------------- */
const PROVIDERS = {
  deepseek: { name: 'DeepSeek', short: 'DS', protocol: 'openai', base: 'https://api.deepseek.com/v1', models: ['deepseek-v4.1-flash', 'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-chat'] },
  zhipu: { name: '智谱 GLM', short: 'GLM', protocol: 'openai', base: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-5.3', 'glm-5.1', 'glm-4.7', 'glm-4.5'] },
  qwen: { name: '通义千问', short: 'Qwen', protocol: 'openai', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen3.8-flash', 'qwen3.8-max', 'qwen3.7-plus', 'qwen3.5-plus', 'qwen-long'] },
  volc: { name: '火山方舟', short: '火山', protocol: 'openai', base: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-seed-2-0-lite-260428', 'doubao-seed-2-0-pro-260215', 'doubao-seed-1-6-250615'] },
  moonshot: { name: '月之暗面 Kimi', short: 'Kimi', protocol: 'openai', base: 'https://api.moonshot.cn/v1', models: ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6', 'kimi-k2.5'] },
  step: { name: '阶跃 StepFun', short: 'Step', protocol: 'openai', base: 'https://api.stepfun.com/v1', models: ['step-5-preview', 'step-3.7-flash', 'step-3.5-flash', 'step-2-16k'] },
  mimo: { name: '小米 MiMo', short: 'MiMo', protocol: 'openai', base: 'https://api.xiaomimimo.com/v1', models: ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'] },
};
/* 【为什么只留这 7 家】小程序要求接入的域名必须完成 ICP 备案。
 *   OpenAI / Claude / Gemini 的接口域名都在境外，既过不了备案，
 *   在小程序 WebView 里也会被网络权限白名单直接拦掉。
 *   「自定义」允许填任意域名，等于绕过备案，所以一并去掉。
 *   剩下 7 家都是国内厂商，域名都在已备案清单里。
 *   加新服务商前先确认：域名已备案 + 已加进小程序网络权限白名单。 */


const DEFAULT_SETTINGS = {
  mode: '8ball',
  opponent: 'local',
  difficulty: 'normal',
  provider: 'deepseek',
  protocol: 'openai',
  baseUrl: PROVIDERS.deepseek.base,
  model: PROVIDERS.deepseek.models[0],
  apiKey: '',
  aim: true,
  sound: true,
  freeBallLocal: false,
  // 【1.4.25】沙箱总开关和上限。默认开、上限 null（跟着难度走）。
  // 关掉后 aiThinkRounds() 直接返回 0，一次都不推演，省 token。
  sandboxEnabled: true,
  sandboxLimit: null,
  developer: false,
  modelCache: {},
  aiProfiles: [],
  activeAiId: 'ai1',
  translateAiId: null,
  seats: null,
};

/* 【设置从哪来】完整版要求「用 1 个 value 存储 api、设置等」，
   所以设置不写 localStorage，而是由宿主页面（screen.js）从云端那 1 个
   value 读出来，在 boot 之前塞进 window.__poolPrefs（JSON 字符串）。
   game.js 只负责解析和校验，不关心存储细节——这样同一份代码既能跑
   在完整版（云端），也能跑在小游戏版（无存档）。 */
function loadSettings() {
  const s = { ...DEFAULT_SETTINGS };
  let raw = '';
  try {
    if (typeof window.__poolPrefs === 'string') raw = window.__poolPrefs;
  } catch (e) { /* ignore */ }
  if (raw) {
    try { Object.assign(s, JSON.parse(raw)); } catch (e) { /* ignore */ }
  }
  if (!PROVIDERS[s.provider]) s.provider = 'deepseek';
  if (!['8ball', '9ball', '10ball', 'rotation', 'snooker', 'snooker6'].includes(s.mode)) s.mode = '8ball';
  if (!['local', 'api', 'human', 'lan'].includes(s.opponent)) s.opponent = 'local';
  if (!['easy', 'normal', 'master'].includes(s.difficulty)) s.difficulty = 'normal';
  if (!['openai', 'anthropic'].includes(s.protocol)) s.protocol = 'openai';
  if (!Array.isArray(s.aiProfiles) || !s.aiProfiles.length) {
    s.aiProfiles = [{
      id: 'ai1', name: 'AI 1', provider: s.provider, protocol: s.protocol,
      baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey,
    }];
  }
  s.aiProfiles = s.aiProfiles.filter((p) => p && p.id).map((p, i) => ({
    id: p.id || ('ai' + (i + 1)), name: p.name || ('AI ' + (i + 1)),
    provider: p.provider || 'deepseek', protocol: p.protocol || 'openai',
    baseUrl: p.baseUrl || '', model: p.model || '', apiKey: p.apiKey || '',
  }));
  if (!s.aiProfiles.some((p) => p.id === s.activeAiId)) s.activeAiId = s.aiProfiles[0].id;
  if (!s.translateAiId || !s.aiProfiles.some((p) => p.id === s.translateAiId)) s.translateAiId = s.activeAiId;
  if (!Array.isArray(s.seats) || s.seats.length !== 2) {
    const diff = s.difficulty || 'normal';
    if (s.opponent === 'human') s.seats = [{ type: 'human', difficulty: diff, thinkLevel: 'none' }, { type: 'human', difficulty: diff, thinkLevel: 'none' }];
    else if (s.opponent === 'api') s.seats = [{ type: 'human', difficulty: diff, thinkLevel: 'none' }, { type: 'ai', aiId: s.activeAiId, difficulty: diff, thinkLevel: 'low' }];
    else if (s.opponent === 'lan') s.seats = [{ type: 'human', difficulty: diff, thinkLevel: 'none' }, { type: 'lan', difficulty: diff, thinkLevel: 'none' }];
    else s.seats = [{ type: 'human', difficulty: diff, thinkLevel: 'none' }, { type: 'local', difficulty: diff, thinkLevel: 'none' }];
  }
  s.seats = s.seats.slice(0, 2).map((seat, i) => {
    if (!seat || typeof seat !== 'object') seat = {};
    const type = ['human', 'local', 'ai', 'lan'].includes(seat.type) ? seat.type : (i === 0 ? 'human' : 'local');
    if (type === 'lan') seat.type = 'human';
    return {
      type: seat.type === 'lan' ? 'human' : type,
      aiId: seat.aiId && s.aiProfiles.some((p) => p.id === seat.aiId) ? seat.aiId : s.activeAiId,
      difficulty: ['easy', 'normal', 'master'].includes(seat.difficulty) ? seat.difficulty : s.difficulty,
      thinkLevel: ['none', 'low', 'high', 'max'].includes(seat.thinkLevel) ? seat.thinkLevel : (seat.think !== null && seat.think !== undefined && seat.think !== '' && Number.isFinite(Number(seat.think)) ? (Number(seat.think) <= 0 ? 'none' : Number(seat.think) <= 1 ? 'low' : Number(seat.think) <= 3 ? 'high' : 'max') : (type === 'ai' ? 'low' : 'none')),
    };
  });
  return s;
}

function getAiProfile(id) {
  return (S.aiProfiles || []).find((p) => p.id === id) || S.aiProfiles[0] || null;
}

function seatName(seat, index) {
  if (!seat) return index === 0 ? '你' : '对手';
  if (seat.type === 'human') return index === 0 ? '你' : '玩家 2';
  if (seat.type === 'lan') return '远程玩家';
  if (seat.type === 'local') return '本地 AI';
  const p = getAiProfile(seat.aiId);
  return p ? p.name : 'AI';
}


/* 【为什么是 let 不是 const】完整版的设置要等云端那个 value 读回来才知道，
   而模块顶层求值时云端还没回。所以先按默认值建一份，等 screen.js
   读到数据后调 __poolReloadSettings() 用 Object.assign 覆盖字段。
   【为什么不整个换掉对象】game.js 里有大量闭包直接引用了 S 的属性，
   换引用会让那些闭包看到旧对象。原地覆盖字段最安全。 */
let S = loadSettings();

/**
 * 用新的设置内容覆盖当前 S（云端读回来时调用）。
 * 【为什么用 Object.assign 而不是重新赋值】见上面 S 的注释。
 */
function reloadSettings(rawJson) {
  let parsed = null;
  try { parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson; } catch (e) { return false; }
  if (!parsed || typeof parsed !== 'object') return false;
  window.__poolPrefs = typeof rawJson === 'string' ? rawJson : JSON.stringify(parsed);
  const fresh = loadSettings();
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, fresh);
  MODEL_CACHE = (S.modelCache && typeof S.modelCache === 'object') ? S.modelCache : {};
  S.modelCache = MODEL_CACHE;
  return true;
}
window.__poolReloadSettings = () => {
  try {
    reloadSettings(window.__poolPrefs);
    if (booted) { updateWelcome(); updateHUD(); }
  } catch (e) { /* ignore */ }
};
let MODEL_CACHE = (S.modelCache && typeof S.modelCache === 'object') ? S.modelCache : {};
S.modelCache = MODEL_CACHE;
/* 【为什么只丢给宿主】设置写云端是异步的，而 saveSettings 在出杆、
   切模式、改难度这些高频路径上被调用；如果这里 await，游戏手感会被
   网络拖累。所以这里只把「要存什么」同步交给宿主，宿主自己防抖合并。 */
function saveSettings() {
  const raw = JSON.stringify(S);
  try { if (typeof window.__poolSavePrefs === 'function') window.__poolSavePrefs(raw); } catch (e) { /* ignore */ }
}

/* ---------------- game state ---------------- */
let G = null;
let paused = false;
let booted = false;
let audioCtx = null;
let noisePattern = null;
let bannerTimer = 0, toastTimer = 0, aiTimer = 0, aiToken = 0;
let SB = false;
let AI_THINK_OVERRIDE = null;
// 【固定步进】物理以 1/120 秒为单位推进，和帧率解耦。
let PHYS_ACC = 0;
const PHYS_STEP = 1 / 120;
let RECORDER = null;
let REPLAYS = [];
let REPLAY_ACTIVE = false;
let REPLAY_LIVE = null;
let REPLAY_STATE = null;
let REPLAY_ANIM = 0;
let REPLAY_TINT = null;
let REPLAY_THINK_MODE = null;
let REPLAY_THINK_CACHE = new Map();
let REPLAY_THINK_BUSY = false;
let REPLAY_THINK_RESERVE = 0;
let REPLAY_GUIDE_ENABLED = true;
let REPLAY_GUIDE = null;
const SANDBOX_TINTS = [
  { name: '蓝', color: '#2f74d0' },
  { name: '橙', color: '#e08a2e' },
  { name: '红', color: '#d4473f' },
  { name: '玫红', color: '#d84f8d' },
  { name: '紫', color: '#8452c8' },
];
let logSeq = 0;

// 【为什么改成延迟初始化】这个文件现在被 screen.js import 进来，
//   导入那一刻模板还没插进 DOM，#felt 还不存在。
//   原来这里直接 $('#felt').getContext() 会抛 null 错误，表现为白屏。
//   改成 boot() 里再取，那时 DOM 已经就位。
let canvas = null;
let ctx = null;
let tableCache = null;
let bgCache = null, vignetteCache = null, screenCacheKey = '';
const TABLE_CACHE_SCALE = 1.75;
let view = { scale: 1, ox: 0, oy: 0, dpr: 1, w: 0, h: 0 };
let dpr = 1;

const BALL_COLORS = {
  1: '#f0c84b', 2: '#2f71c9', 3: '#d64b43', 4: '#8e54b8', 5: '#e8873c',
  6: '#2f9b65', 7: '#8f3d42', 8: '#171b1a',
  9: '#f0c84b', 10: '#2f71c9', 11: '#d64b43', 12: '#8e54b8', 13: '#e8873c',
  14: '#2f9b65', 15: '#8f3d42',
};
const SNOOKER_COLORS = {
  red: '#c83232', yellow: '#e9c43f', green: '#2d8d4f', brown: '#7a4a26',
  blue: '#2868b5', pink: '#d98aa4', black: '#161a19',
};
const COLOR_VALUES = { yellow: 2, green: 3, brown: 4, blue: 5, pink: 6, black: 7 };

function isEightBall() { return G && G.mode === '8ball'; }
function isAI(player = G.current) {
  if (!G) return false;
  if (G.shellAI && G.shellAI[player] === true) return true;
  if (G.shellAI && G.shellAI[player] === false) return false;
  const seat = G.seats && G.seats[player];
  if (seat) return seat.type === 'local' || seat.type === 'ai';
  if (G.opponent === 'human' || G.opponent === 'lan') return false;
  return player === 1;
}

function currentSeat() {
  return G && G.seats ? G.seats[G.current] : null;
}

function seatDifficulty(player = G.current) {
  const seat = G && G.seats ? G.seats[player] : null;
  return (seat && seat.difficulty) || (G && G.aiLevel && G.aiLevel[player]) || (G && G.difficulty) || 'normal';
}

const THINK_LEVELS = { none: 0, low: 1, high: 3, max: 5 };
const THINK_LABELS = { none: '不思考', low: '低', high: '高', max: '最高' };

function seatThinkLevel(player = G.current) {
  const seat = G && G.seats ? G.seats[player] : null;
  if (!seat || seat.type !== 'ai') return 'none';
  const level = String(seat.thinkLevel || '').toLowerCase();
  if (THINK_LEVELS[level] !== undefined) return level;
  const n = Number(seat.think);
  if (Number.isFinite(n)) return n <= 0 ? 'none' : n <= 1 ? 'low' : n <= 3 ? 'high' : 'max';
  return 'low';
}

function seatThink(player = G.current) {
  if (!G || !G.seats || !G.seats[player] || G.seats[player].type !== 'ai') return null;
  return THINK_LEVELS[seatThinkLevel(player)] ?? 0;
}

function aiSandboxUsedFor(player = G.current) {
  if (!G) return 0;
  const v = G.aiSandboxUsed;
  return Array.isArray(v) ? (v[player] || 0) : (v || 0);
}

function setAiSandboxUsedFor(n, player = G.current) {
  if (!G) return;
  if (Array.isArray(G.aiSandboxUsed)) G.aiSandboxUsed[player] = n;
  else G.aiSandboxUsed = n;
}

/* 【API 失败分级】上游 1.4.23 的做法：把失败分成两类分别计数——
   连接类（超时 / DNS / TLS / fetch 直接抛错）说明网络或域名有问题，
   重试几次没意义，3 次就停；返回类（模型返回了但内容不合规）可能是
   偶发，给到 15 次。任一达标就本回合改用本地算法，避免无限重试把
   玩家的回合卡死。计数按「回合」重置，见 endShot 里的换手分支。 */
function apiConnCount(player = G.current) {
  if (!G) return 0;
  return Array.isArray(G.apiConnFailures) ? (G.apiConnFailures[player] || 0) : (G.apiConnFailures || 0);
}

function apiRespCount(player = G.current) {
  if (!G) return 0;
  return Array.isArray(G.apiRespFailures) ? (G.apiRespFailures[player] || 0) : (G.apiRespFailures || 0);
}

function apiFailureError(message, type) {
  const e = new Error(message);
  e.apiFailureType = type;
  return e;
}

function classifyApiFailure(err) {
  if (err && err.apiFailureType) return err.apiFailureType;
  const msg = String(err && err.message || err || '');
  if (/请求超时|timeout|timed out|network|failed to fetch|fetch failed|连接失败|无法连接|ECONN|ENOTFOUND|socket|TLS|GnuTLS/i.test(msg)) return 'connection';
  return 'response';
}

function recordApiFailure(error, player = G.current) {
  if (!G) return { type: 'response', connection: 0, response: 0, limit: false };
  const type = classifyApiFailure(error);
  if (type === 'connection') {
    if (!Array.isArray(G.apiConnFailures)) G.apiConnFailures = [0, 0];
    G.apiConnFailures[player] = (G.apiConnFailures[player] || 0) + 1;
  } else {
    if (!Array.isArray(G.apiRespFailures)) G.apiRespFailures = [0, 0];
    G.apiRespFailures[player] = (G.apiRespFailures[player] || 0) + 1;
  }
  if (!Array.isArray(G.apiFailureLog)) G.apiFailureLog = [[], []];
  if (!Array.isArray(G.apiFailureLog[player])) G.apiFailureLog[player] = [];
  G.apiFailureLog[player].push({ type, at: new Date().toISOString(), error: String(error && error.message || error || '').slice(0, 300) });
  if (G.apiFailureLog[player].length > 20) G.apiFailureLog[player].shift();
  return { type, connection: apiConnCount(player), response: apiRespCount(player), limit: apiConnCount(player) >= 3 || apiRespCount(player) >= 15 };
}

function seatProfile(player = G.current) {
  const seat = G && G.seats ? G.seats[player] : null;
  if (!seat || seat.type !== 'ai') return null;
  return getAiProfile(seat.aiId);
}
function isHumanTurn() {
  if (!G) return false;
  if (G.net) return !!G.net.connected && G.current === G.net.localPlayer && !G.net.pendingShot;
  return !isAI(G.current);
}
function cueBall() { return G ? G.balls.find((b) => b.id === 0) : null; }
function activeBalls() { return G ? G.balls.filter((b) => b.active) : []; }
function groupName(g) { return g === 'solid' ? '全色 1–7' : g === 'stripe' ? '花色 9–15' : '未分组'; }
function shortGroup(g) { return g === 'solid' ? '全色' : g === 'stripe' ? '花色' : '开放'; }
function modeName(mode = G && (G.replayMode || G.mode)) {
  return ({ '8ball': '经典八球', '9ball': '九球', '10ball': '十球', rotation: '轮转追分', snooker: '斯诺克', snooker6: '6 红球斯诺克' })[mode] || '经典八球';
}
function modeTag(mode = G && (G.replayMode || G.mode)) {
  return ({ '8ball': '经典八球 · 8-BALL', '9ball': '九球 · 9-BALL', '10ball': '十球 · 10-BALL', rotation: '轮转追分 · ROTATION', snooker: '斯诺克 · SNOOKER', snooker6: '6 红球斯诺克 · 6-RED' })[mode] || '经典八球 · 8-BALL';
}
function modeShortTag(mode = G && (G.replayMode || G.mode)) {
  return ({ '8ball': '8-BALL', '9ball': '9-BALL', '10ball': '10-BALL', rotation: 'ROTATION', snooker: 'SNOOKER', snooker6: '6-RED SNOOKER' })[mode] || '8-BALL';
}
function lowestActiveBall() {
  if (!G) return null;
  const balls = G.balls.filter((b) => b.active && b.id !== 0);
  if (!balls.length) return null;
  return balls.reduce((a, b) => (a.num <= b.num ? a : b));
}
function colorForBall(b) {
  if (b.type === 'cue') return '#f2eee1';
  if (b.type === 'red') return SNOOKER_COLORS.red;
  if (b.type === 'color') return SNOOKER_COLORS[b.colorName] || '#888';
  if (b.type === 'eight') return '#171b1a';
  return BALL_COLORS[b.num] || '#999';
}
function textColorFor(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 150 ? '#152018' : '#f7f4e8';
}

/* ---------------- rack / new game ---------------- */
function makeBall(id, num, type, x, y, extra = {}) {
  return {
    id, num, type, x, y, vx: 0, vy: 0, active: true, pocketed: false,
    x0: x, y0: y, ...extra,
  };
}

function rackEightBall(R) {
  const balls = [];
  const cueX = TABLE.x + TABLE.w * 0.22;
  const cueY = TABLE.y + TABLE.h / 2;
  balls.push(makeBall(0, 0, 'cue', cueX, cueY));

  const slots = new Array(15).fill(null);
  slots[4] = 8;
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7]);
  const stripes = shuffle([9, 10, 11, 12, 13, 14, 15]);
  slots[10] = solids.pop();
  slots[14] = stripes.pop();
  const rest = shuffle([...solids, ...stripes]);
  let k = 0;
  for (let i = 0; i < 15; i++) if (slots[i] === null) slots[i] = rest[k++];

  const apexX = TABLE.x + TABLE.w * 0.75;
  const cy = TABLE.y + TABLE.h / 2;
  const dx = 2 * R * 0.866 + 0.35;
  const dy = 2 * R + 0.45;
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let j = 0; j <= row; j++) {
      const num = slots[idx];
      const x = apexX + row * dx;
      const y = cy + (j - row / 2) * dy;
      const type = num === 8 ? 'eight' : num < 8 ? 'solid' : 'stripe';
      balls.push(makeBall(idx + 1, num, type, x, y));
      if (row === 0 && j === 0) balls.rackApexId = idx + 1;
      idx++;
    }
  }
  balls.rackApexId = 1; // 1..15 ids follow rack slots; slot 0 is apex
  return balls;
}

function rackNineBall(R) {
  const balls = [];
  const cy = TABLE.y + TABLE.h / 2;
  const cueX = TABLE.x + TABLE.w * 0.22;
  balls.push(makeBall(0, 0, 'cue', cueX, cy));

  const apexX = TABLE.x + TABLE.w * 0.75;
  const dx = 2 * R * 0.866 + 0.35;
  const dy = 2 * R + 0.45;
  const rows = [1, 2, 3, 2, 1];
  const positions = [];
  for (let row = 0; row < rows.length; row++) {
    for (let j = 0; j < rows[row]; j++) {
      positions.push({ x: apexX + row * dx, y: cy + (j - (rows[row] - 1) / 2) * dy });
    }
  }
  const order = new Array(9).fill(null);
  order[0] = 1;
  order[4] = 9;
  const rest = shuffle([2, 3, 4, 5, 6, 7, 8]);
  let k = 0;
  for (let i = 0; i < 9; i++) if (order[i] === null) order[i] = rest[k++];
  for (let i = 0; i < 9; i++) {
    const num = order[i];
    const type = num === 8 ? 'eight' : num < 8 ? 'solid' : 'stripe';
    balls.push(makeBall(num, num, type, positions[i].x, positions[i].y));
  }
  balls.rackApexId = 1;
  return balls;
}

function rackTenBall(R) {
  const balls = [];
  const cy = TABLE.y + TABLE.h / 2;
  const cueX = TABLE.x + TABLE.w * 0.22;
  balls.push(makeBall(0, 0, 'cue', cueX, cy));
  const apexX = TABLE.x + TABLE.w * 0.75;
  const dx = 2 * R * 0.866 + 0.35;
  const dy = 2 * R + 0.45;
  const rows = [1, 2, 3, 4];
  const positions = [];
  for (let row = 0; row < rows.length; row++) {
    for (let j = 0; j < rows[row]; j++) {
      positions.push({ x: apexX + row * dx, y: cy + (j - (rows[row] - 1) / 2) * dy });
    }
  }
  const order = new Array(10).fill(null);
  order[0] = 1;
  order[6] = 10;
  const rest = shuffle([2, 3, 4, 5, 6, 7, 8, 9]);
  let k = 0;
  for (let i = 0; i < 10; i++) if (order[i] === null) order[i] = rest[k++];
  for (let i = 0; i < 10; i++) {
    const num = order[i];
    const type = num === 8 ? 'eight' : num < 8 ? 'solid' : 'stripe';
    balls.push(makeBall(num, num, type, positions[i].x, positions[i].y));
  }
  balls.rackApexId = 1;
  return balls;
}

function rackRotation(R) {
  const balls = [];
  const cy = TABLE.y + TABLE.h / 2;
  const cueX = TABLE.x + TABLE.w * 0.22;
  balls.push(makeBall(0, 0, 'cue', cueX, cy));

  const slots = new Array(15).fill(null);
  slots[0] = 1;
  slots[4] = 15;
  slots[10] = 2;
  slots[14] = 3;
  const rest = shuffle([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  let k = 0;
  for (let i = 0; i < 15; i++) if (slots[i] === null) slots[i] = rest[k++];

  const apexX = TABLE.x + TABLE.w * 0.75;
  const dx = 2 * R * 0.866 + 0.35;
  const dy = 2 * R + 0.45;
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let j = 0; j <= row; j++) {
      const num = slots[idx];
      const type = num === 8 ? 'eight' : num < 8 ? 'solid' : 'stripe';
      balls.push(makeBall(num, num, type, apexX + row * dx, cy + (j - row / 2) * dy));
      idx++;
    }
  }
  balls.rackApexId = 1;
  return balls;
}

function rackSnooker(R, redCount = 15) {
  const balls = [];
  const cy = TABLE.y + TABLE.h / 2;
  const baulkX = TABLE.x + TABLE.w * 0.206;
  const dR = 74;
  const cueX = baulkX - 26, cueY = cy + 30;
  balls.push(makeBall(0, 0, 'cue', cueX, cueY));

  const pinkX = TABLE.x + TABLE.w * 0.75;
  const blackX = TABLE.x + TABLE.w * 0.925;
  const spots = {
    yellow: { x: baulkX, y: cy + dR },
    green: { x: baulkX, y: cy - dR },
    brown: { x: baulkX, y: cy },
    blue: { x: TABLE.x + TABLE.w * 0.5, y: cy },
    pink: { x: pinkX, y: cy },
    black: { x: blackX, y: cy },
  };

  let id = 1;
  const apexX = pinkX + 2 * R + 4;
  const dx = 2 * R * 0.866 + 0.3;
  const dy = 2 * R + 0.35;
  const redRows = redCount <= 6 ? 3 : 5;
  for (let row = 0; row < redRows; row++) {
    for (let j = 0; j <= row; j++) {
      balls.push(makeBall(id++, 0, 'red', apexX + row * dx, cy + (j - row / 2) * dy));
    }
  }
  const exposed = balls.filter((b) => b.type === 'red').sort((a, b) => (b.x + b.y * 0.2) - (a.x + a.y * 0.2))[0];
  if (exposed) balls.rackApexId = exposed.id;
  const order = ['yellow', 'green', 'brown', 'blue', 'pink', 'black'];
  for (const c of order) {
    balls.push(makeBall(id++, COLOR_VALUES[c], 'color', spots[c].x, spots[c].y, {
      colorName: c, spotX: spots[c].x, spotY: spots[c].y, value: COLOR_VALUES[c],
    }));
  }
  return balls;
}

function thinkPriority(level) {
  return ({ max: 4, high: 3, low: 2, none: 1 })[level] || 0;
}

function difficultyPriority(level) {
  return ({ master: 3, normal: 2, easy: 1 })[level] || 0;
}

function seatSuffix(n) {
  let s = '';
  n = Math.max(0, Math.floor(n));
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

function computeSeatNames(seats) {
  const bases = seats.map((seat, i) => seatName(seat, i));
  const groups = new Map();
  bases.forEach((base, i) => {
    const key = String(base).toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  const names = bases.slice();
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    idxs.sort((a, b) => {
      const sa = seats[a], sb = seats[b];
      return thinkPriority(seatThinkLevelForSeat(sb)) - thinkPriority(seatThinkLevelForSeat(sa)) ||
        difficultyPriority(sb.difficulty) - difficultyPriority(sa.difficulty) ||
        a - b;
    });
    idxs.forEach((idx, n) => { names[idx] = `${bases[idx]} ${seatSuffix(n)}`; });
  }
  return names;
}

function seatThinkLevelForSeat(seat) {
  if (!seat) return 'none';
  if (seat.type !== 'ai') return 'none';
  return ['none', 'low', 'high', 'max'].includes(seat.thinkLevel) ? seat.thinkLevel : 'low';
}

function seatDisplayName(index) {
  if (G && Array.isArray(G.seatNames) && G.seatNames[index]) return G.seatNames[index];
  return seatName(G && G.seats ? G.seats[index] : null, index);
}

function legacySeats(opponent) {
  const diff = S.difficulty || 'normal';
  const aiId = (S.aiProfiles && S.aiProfiles[0] && S.aiProfiles[0].id) || 'ai1';
  if (opponent === 'human') return [{ type: 'human', difficulty: diff, thinkLevel: 'none' }, { type: 'human', difficulty: diff, thinkLevel: 'none' }];
  if (opponent === 'api') return [{ type: 'human', difficulty: diff, thinkLevel: 'none' }, { type: 'ai', aiId, difficulty: diff, thinkLevel: 'low' }];
  if (opponent === 'lan') return [{ type: 'human', difficulty: diff, thinkLevel: 'none' }, { type: 'lan', difficulty: diff, thinkLevel: 'none' }];
  return [{ type: 'human', difficulty: diff, thinkLevel: 'none' }, { type: 'local', difficulty: diff, thinkLevel: 'none' }];
}

function seatsOpponent(seats) {
  if (seats.some((x) => x.type === 'lan')) return 'lan';
  if (seats.every((x) => x.type === 'human')) return 'human';
  if (seats.some((x) => x.type === 'ai')) return 'api';
  return 'local';
}

function newGame(opts = {}) {
  if (!opts.preview && !REPLAY_ACTIVE && RECORDER && !RECORDER.finalized) finalizeReplay(null);
  if (G && G.net && G.net.stateTimer) clearTimeout(G.net.stateTimer);
  clearTimeout(aiTimer);
  clearTimeout(bannerTimer);
  aiToken++;
  PHYS_ACC = 0;
  const requestedMode = opts.mode || S.mode;
  const mode = requestedMode === 'snooker6' ? 'snooker' : requestedMode;
  let seats;
  if (Array.isArray(opts.seats)) seats = opts.seats.map((x) => ({ ...x }));
  else if (opts.opponent) seats = legacySeats(opts.opponent);
  else if (Array.isArray(S.seats)) seats = S.seats.map((x) => ({ ...x }));
  else seats = legacySeats(S.opponent);
  const opponent = seatsOpponent(seats);
  const R = mode === 'snooker' ? 9.4 : 11.2;
  const balls = requestedMode === 'snooker6' ? rackSnooker(R, 6)
    : mode === 'snooker' ? rackSnooker(R)
    : mode === '10ball' ? rackTenBall(R)
    : mode === '9ball' ? rackNineBall(R)
    : mode === 'rotation' ? rackRotation(R)
    : rackEightBall(R);
  const seatNames = computeSeatNames(seats);
  const p0Name = seatNames[0];
  const p1Name = seatNames[1];
  G = {
    mode, replayMode: requestedMode, opponent, difficulty: seats[1].difficulty || S.difficulty, R,
    balls,
    seats,
    seatNames,
    players: [
      { name: p0Name, isAI: seats[0].type === 'local' || seats[0].type === 'ai', group: null, score: 0 },
      { name: p1Name, isAI: seats[1].type === 'local' || seats[1].type === 'ai', group: null, score: 0 },
    ],
    current: 0,
    // 回合横幅的「上次提示给谁」，null 表示还没提示过
    lastShownTurn: null,
    phase: 'aim',
    winner: null,
    breakShot: true,
    openTable: mode === '8ball',
    ballInHand: false,
    freeBallDrag: false,
    firstContact: null,
    pottedThisShot: [],
    pocketAnims: [],
    shotActive: false,
    shotIndex: 0,
    aimAngle: 0,
    fineDelta: 0,
    power: 0.1,
    aiThinking: false,
    aiPlan: null,
    aimHint: null,
    draggingCue: false,
    lastValidCue: null,
    log: [],
    snooker: null,
    paused: false,
    startedAt: Date.now(),
    resolvePending: false,
    shake: 0,
    targetsHit: 0,
    overReason: '',
    aiRetry: 0,
    shellAI: { 0: null, 1: null },
    aiLevel: { 0: seats[0].difficulty || S.difficulty, 1: seats[1].difficulty || S.difficulty },
    aiThinkLimit: AI_THINK_OVERRIDE,
    aiSandboxUsed: [0, 0],
    // 【为什么失败计数要在 newGame 里初始化】不初始化的话第一局读到的
    // 是 undefined，apiConnCount 会走 `|| 0` 兜底，看着没事；
    // 但 endShot 里换手时要按数组下标清零，undefined 会直接抛错。
    apiConnFailures: [0, 0],
    apiRespFailures: [0, 0],
    apiFailureLog: [[], []],
    _hintKey: null,
    _hint: null,
  };
  tableCache = null;
  if (mode === 'snooker') {
    G.snooker = {
      ballOn: 'red',
      redsLeft: requestedMode === 'snooker6' ? 6 : 15,
      colorsPhase: false,
      lastColor: false,
      breakScore: 0,
      bestBreak: 0,
    };
  }
  // aim at rack apex initially
  const cue = cueBall();
  const apex = balls.find((b) => b.id === balls.rackApexId) || balls.find((b) => b.active && b.id !== 0);
  if (apex && cue) G.aimAngle = Math.atan2(apex.y - cue.y, apex.x - cue.x);
  if (!opts.silent) {
    addLog(`新一局${modeName(mode)}，你先开球`, true);
    showToast(`${modeName(mode)} · 你先开球`);
  }
  updateHUD();
  updatePowerUI();
  saveSettings();
  drawStatic();
  if (!opts.preview && !REPLAY_ACTIVE) startReplayRecording(requestedMode, G.opponent);
  if (!opts.preview && !REPLAY_ACTIVE) setTimeout(() => maybeAi(), 220);
}

function apiShortName() {
  const p = PROVIDERS[S.provider] || PROVIDERS.deepseek;
  return 'AI · ' + (S.model || p.short).replace(/^.*\//, '').slice(0, 14);
}

/* ---------------- HUD ---------------- */
function updatePowerUI() {
  updateCueDock();
}

function ballChip(b, extraClass = '') {
  const col = colorForBall(b);
  if (b.type === 'stripe') {
    return `<span class="mini stripe ${extraClass}" style="--c:${col}"><span>${b.num}</span></span>`;
  }
  return `<span class="mini ${extraClass}" style="background:${col};color:${textColorFor(col)}">${b.num || ''}</span>`;
}

function countGroup(pidx, group) {
  return G.balls.filter((b) => b.active && b.type === group).length;
}

function activeReds() {
  return G.balls.filter((b) => b.active && b.type === 'red').length;
}

function activeColors() {
  return G.balls.filter((b) => b.active && b.type === 'color');
}

function lowestColor() {
  const cs = activeColors();
  if (!cs.length) return null;
  return cs.reduce((a, b) => (a.value <= b.value ? a : b));
}

function ballOnLabel() {
  if (!G) return '';
  if (G.mode === 'snooker') {
    const on = G.snooker.ballOn;
    if (on === 'red') return '红球';
    if (on === 'color') return '任意彩球';
    if (on === 'last-color') return '最后一颗红球后的彩球';
    const c = G.balls.find((b) => b.type === 'color' && b.value === on);
    if (c) return `${cnColor(c.colorName)}（${c.value} 分）`;
    return '彩球';
  }
  if (G.mode === '9ball' || G.mode === '10ball' || G.mode === 'rotation') {
    const low = lowestActiveBall();
    return low ? `${low.num} 号球` : '—';
  }
  const p = G.players[G.current];
  if (!p.group) return '任意非黑八球';
  if (countGroup(G.current, p.group) === 0) return '黑八';
  return groupName(p.group);
}

function cnColor(c) {
  return { yellow: '黄球', green: '绿球', brown: '咖啡球', blue: '蓝球', pink: '粉球', black: '黑球' }[c] || c;
}

function updateHUD() {
  if (!G || SB) return;
  $('#modeTag').textContent = modeTag();
  $('#ruleTag').textContent = modeShortTag();
  const board = $('#scoreboard');
  board.innerHTML = G.players.map((p, i) => {
    const active = G.current === i && G.phase !== 'over';
    const isAi = isAI(i);
    const isLocal = G.net ? i === G.net.localPlayer : i === 0;
    let tag = '', chips = '', big = '', small = '';
    if (G.mode === '8ball') {
      if (p.group) tag = `<span class="ptag ${p.group}">${shortGroup(p.group)}</span>`;
      else tag = `<span class="ptag">待分组</span>`;
      if (p.group) {
        const remain = G.balls.filter((b) => b.active && b.type === p.group).sort((a, b) => a.num - b.num);
        chips = remain.map((b) => ballChip(b)).join('');
        if (remain.length === 0) chips = ballChip(G.balls.find((b) => b.num === 8));
        big = String(remain.length === 0 ? 1 : remain.length);
        small = '剩余';
      } else {
        const solids = G.balls.filter((b) => b.active && b.type === 'solid').length;
        const stripes = G.balls.filter((b) => b.active && b.type === 'stripe').length;
        chips = `<span class="open-hint"><i style="background:#f0c84b"></i><em>${solids}</em><i style="background:#9ec8e8"></i><em>${stripes}</em></span>`;
        big = String(solids + stripes); small = '在台';
      }
    } else if (G.mode === 'snooker') {
      tag = `<span class="ptag">${isLocal ? '你' : isAi ? 'AI' : '玩家'}</span>`;
      const reds = activeReds();
      chips = `<span class="mini" style="background:${SNOOKER_COLORS.red};color:#fff">${reds}</span><span class="log-line" style="font-size:7.5px;color:#7f9489">红球剩余</span>`;
      big = String(p.score);
      small = '分';
    } else if (G.mode === '9ball' || G.mode === '10ball') {
      tag = `<span class="ptag">${G.mode === '10ball' ? '10 球' : '9 球'}</span>`;
      const remain = G.balls.filter((b) => b.active && b.id !== 0).sort((a, b) => a.num - b.num);
      chips = remain.map((b) => ballChip(b)).join('');
      big = String(remain.length);
      small = '剩余';
    } else {
      tag = `<span class="ptag">轮转</span>`;
      const low = lowestActiveBall();
      chips = `${low ? ballChip(low) : ''}<span class="log-line" style="font-size:7.5px;color:#7f9489">最低球</span>`;
      big = String(p.score);
      small = '分';
    }
    return `<div class="pcard ${active ? 'active' : ''} ${isAi ? 'ai' : ''} ${G.winner === i ? 'winner' : ''}">
      <div class="pava">${isAi ? 'AI' : isLocal ? '你' : (i === 0 ? 'P1' : 'P2')}</div>
      <div class="pmain">
        <div class="ptop"><b>${esc(p.name)}</b>${tag}</div>
        <div class="pballs">${chips}</div>
      </div>
      <div class="pnum"><b>${big}</b><small>${small}</small></div>
    </div>`;
  }).join('');

  const localIdx = G.net ? G.net.localPlayer : 0;
  const localTurn = isHumanTurn();
  const currentName = (G.players[G.current] && G.players[G.current].name) || '对手';
  let status = '';
  if (G.phase === 'over') {
    status = G.winner === -1 ? '平局' : G.winner === localIdx ? '你赢下了这一局' : `${G.players[G.winner].name} 获胜`;
  } else if (G.net && !G.net.connected) status = '联机已断开';
  else if (G.net && G.net.pendingShot) status = '等待主机确认…';
  else if (G.aiThinking) status = `${G.players[G.current].name} 正在思考…`;
  else if (G.phase === 'shooting') status = '球在滚动…';
  else if (G.ballInHand) status = (localTurn ? '自由球：拖动白球' : currentName + ' 自由球');
  else if (G.freeBallDrag) status = localTurn ? '自由球：可拖白球调整' : `${currentName} 自由球`;
  else if (G.breakShot) status = localTurn ? '你的回合 · 开球' : `${currentName} 开球`;
  else status = localTurn ? '你的回合' : `${currentName} 的回合`;
  if (G.mode === 'snooker' && G.phase !== 'over' && G.snooker.breakScore > 0) {
    status += ` · 本杆 ${G.snooker.breakScore}`;
  }
  $('#matchStatus').textContent = status;

  let dot = '#d9c08a';
  if (G.mode === 'snooker') {
    const on = G.snooker.ballOn;
    if (on === 'red') dot = SNOOKER_COLORS.red;
    else if (typeof on === 'number') {
      const c = G.balls.find((b) => b.type === 'color' && b.value === on);
      dot = c ? SNOOKER_COLORS[c.colorName] : '#ddd';
    } else dot = '#d9c08a';
  } else if (G.mode === '9ball' || G.mode === '10ball' || G.mode === 'rotation') {
    const low = lowestActiveBall();
    dot = low ? colorForBall(low) : '#d9c08a';
  } else if (G.players[G.current].group === 'solid') dot = '#f0c84b';
  else if (G.players[G.current].group === 'stripe') dot = '#9ec8e8';
  const onLabel = ballOnLabel();
  const redNote = G.mode === 'snooker' ? (onLabel === '红球' ? ` · 剩 ${activeReds()} 颗` : ` · 红球 ${activeReds()} 颗`) : '';
  $('#targetLine').innerHTML = `<span class="target-dot" style="background:${dot}"></span><span>目标：${esc(onLabel)}${redNote}</span>`;

  $('#btnAim').classList.toggle('on', S.aim);
  $('#btnAim').classList.toggle('off', !S.aim);
  $('#btnSound').classList.toggle('off', !S.sound);
  $('#btnSound').setAttribute('aria-pressed', String(!!S.sound));
  $('#btnAim').setAttribute('aria-pressed', String(!!S.aim));
  $('#handHint').classList.toggle('show', (G.ballInHand || G.freeBallDrag) && isHumanTurn() && G.phase !== 'over');
  $('#hintBar').classList.toggle('hide', G.phase === 'shooting' || G.aiThinking || G.phase === 'over');
  if (G.net && G.net.pendingShot) $('#hintBar').textContent = '等待主机确认击球…';
  else if (G.net && G.current !== G.net.localPlayer) $('#hintBar').textContent = '等待对方击球…';
  else if (G.ballInHand && isHumanTurn()) $('#hintBar').textContent = '拖动白球到合法位置，然后瞄准击球';
  else if (G.freeBallDrag && isHumanTurn()) $('#hintBar').textContent = '自由球：点白球可继续拖动调整，点其他地方瞄准';
  else if (G.aiThinking) $('#hintBar').textContent = 'AI 正在计算走位…';
  else $('#hintBar').textContent = '拖动桌面瞄准 · 右侧球杆下滑击球';
  // 【1.4.25 回合横幅】换手时弹一下「你的回合 / 对手的回合」。
  // 为什么需要：横屏球桌信息密度高，玩家很容易没注意到已经换人了，
  // 然后对着不是自己的回合干等。用一个只闪 1.1 秒的横幅提示，
  // 不挡视线，也不会像弹窗那样打断操作。
  // lastShownTurn 记住「上次提示的是谁」，同一回合不会反复弹。
  if (G.phase !== 'over' && !REPLAY_ACTIVE && !$('#welcome').classList.contains('show') && G.lastShownTurn !== G.current) {
    G.lastShownTurn = G.current;
    const myTurn = G.current === 0;
    const who = (G.players[G.current] && G.players[G.current].name) || '对手';
    showBanner(myTurn ? '你的回合' : `${who} 的回合`, myTurn ? '请击球' : '等待对方击球', myTurn ? 'good' : '', 1100);
    updatePowerUI();
    updateCueDock();
  }
  renderLog();
  renderAiBadge();
  updateCueDock();
  updateDevUI();
}

function renderLog() {
  if (SB) return;
  const el = $('#log');
  if (!G || !el) return;
  el.innerHTML = G.log.slice(-4).map((l) => `<div class="log-line">${l.hl ? '<b>' + esc(l.text) + '</b>' : esc(l.text)}</div>`).join('');
}

function addLog(text, hl = false) {
  if (!G) return;
  G.log.push({ text, hl, seq: ++logSeq });
  if (G.log.length > 30) G.log.shift();
  renderLog();
}

function renderAiBadge() {
  if (SB) return;
  const badge = $('#aiBadge');
  if (!G) { badge.classList.remove('show'); return; }
  const show = G.aiThinking;
  badge.classList.toggle('show', show);
  if (show) badge.querySelector('span').textContent = seatProfile(G.current) ? '大模型正在选杆…' : 'AI 正在计算…';
}

function showBanner(title, sub = '', tone = '', ms = 1700) {
  if (SB) return;
  const el = $('#banner');
  el.querySelector('b').textContent = title;
  el.querySelector('span').textContent = sub;
  el.className = 'banner show ' + tone;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function showToast(text, bad = false) {
  if (SB) return;
  const el = $('#toast');
  el.textContent = text;
  el.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------------- audio ---------------- */
function ensureAudio() {
  if (!S.sound) return null;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (e) { return null; }
}

function tone(freq, dur = 0.08, type = 'sine', vol = 0.08, slide = 0) {
  const ac = ensureAudio();
  if (!ac) return;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ac.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ac.currentTime + dur);
  g.gain.setValueAtTime(vol, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  o.connect(g).connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + dur + 0.02);
}

let lastClickSound = 0;
function sfx(name, power = 0.5) {
  if (SB || !S.sound) return;
  const now = performance.now();
  if (name === 'click') {
    if (now - lastClickSound < 28) return;
    lastClickSound = now;
    tone(560 + Math.random() * 260, 0.035, 'triangle', 0.025 + power * 0.05, -120);
  } else if (name === 'cushion') {
    tone(190 + Math.random() * 40, 0.07, 'sine', 0.035 + power * 0.04, -50);
  } else if (name === 'pocket') {
    tone(150, 0.16, 'sine', 0.08, -80);
    setTimeout(() => tone(82, 0.18, 'sine', 0.06, -20), 50);
  } else if (name === 'cue') {
    tone(920, 0.05, 'square', 0.035, -300);
    tone(220, 0.1, 'sine', 0.06, -80);
  } else if (name === 'foul') {
    tone(220, 0.16, 'sawtooth', 0.035, -80);
    setTimeout(() => tone(170, 0.2, 'sawtooth', 0.03, -50), 90);
  } else if (name === 'win') {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'sine', 0.07), i * 110));
  } else if (name === 'lose') {
    [330, 277, 220].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'sine', 0.055), i * 120));
  }
}

function vibrate(ms = 10) {
  if (SB) return;
  try { if (window.Android && window.Android.vibrate) window.Android.vibrate(ms); } catch (e) { /* ignore */ }
}

/* ============================================================
   物理引擎
   ============================================================ */
function resetShotTracking() {
  G.firstContact = null;
  G.pottedThisShot = [];
  G.resolvePending = false;
  G.targetsHit = 0;
}

function shoot(force = false) {
  if (!G || G.phase === 'over' || G.phase === 'shooting') return false;
  if (!force && !isHumanTurn()) return false;
  if (G.phase !== 'aim' && G.phase !== 'ai') return false;
  const cue = cueBall();
  if (!cue || !cue.active || G.ballInHand) return false;
  G.freeBallDrag = false;

  if (G.net && G.net.role === 'guest' && !G.net.applyingRemote) return lanGuestShoot();

  clampBallsToTable();
  startReplayShot();
  resetShotTracking();
  G.phase = 'shooting';
  PHYS_ACC = 0;
  G.shotActive = true;
  G.shotIndex++;
  G.aiPlan = null;
  G._hintKey = null;
  G._hint = null;
  const speed = 230 + G.power * 1270;
  cue.vx = Math.cos(G.aimAngle) * speed;
  cue.vy = Math.sin(G.aimAngle) * speed;
  if (G.net && G.net.role === 'host' && G.net.connected) {
    lanQueueEvent({ type: 'shot', angle: G.aimAngle, power: G.power, cue: { x: cue.x, y: cue.y } });
  }
  G.shake = G.power > 0.82 ? 4.5 : 1.5;
  G.shakeUntil = performance.now() + 220;
  sfx('cue', G.power);
  vibrate(G.power > 0.8 ? 18 : 8);
  updateHUD();
  return true;
}

function updatePhysics(dt) {
  if (!G || G.phase !== 'shooting') return;
  const moving = activeBalls().filter((b) => Math.hypot(b.vx, b.vy) > 0.5);
  if (!moving.length) {
    PHYS_ACC = 0;
    checkShotFinished();
    return;
  }
  // 【为什么改成固定步进】原来的步长是 dt 除以「按最快球速估的步数」，
  // 结果每一步的实际时长随帧率变——60Hz 和 120Hz 的手机会算出不同的球路，
  // 同一个角度在两台机器上进的球不一样。1.4.25 改成累加器：不管多少帧，
  // 物理永远以 1/120 秒为单位推进，两端一致。
  PHYS_ACC += Math.min(0.05, Math.max(0, dt));
  let steps = 0;
  const maxSteps = 60;
  while (PHYS_ACC >= PHYS_STEP && steps < maxSteps) {
    simulateStep(PHYS_STEP);
    PHYS_ACC -= PHYS_STEP;
    steps++;
  }
  // 卡顿太久（切后台回来）就别追了，否则一次要跑上千步直接卡死。
  if (steps >= maxSteps) PHYS_ACC = 0;
  checkShotFinished();
  replayRecordFrame();
}

function simulateStep(dt) {
  const balls = activeBalls();
  for (const b of balls) {
    if (!b.active) continue;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) {
      const dec = PHYS.friction * dt;
      if (sp <= dec) { b.vx = 0; b.vy = 0; }
      else { const ns = (sp - dec) / sp; b.vx *= ns; b.vy *= ns; }
    }
  }

  // pocket capture before cushion reflect
  for (const b of activeBalls()) {
    if (!b.active) continue;
    const p = nearestPocket(b.x, b.y);
    if (p && Math.hypot(b.x - p.x, b.y - p.y) < POCKET_R * PHYS.capture) {
      pocketBall(b, p);
    }
  }

  // ball-ball collisions
  const list = activeBalls();
  const e = PHYS.ballE;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.active) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b.active) continue;
      let dx = b.x - a.x, dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= 2 * G.R) continue;
      if (d < 0.0001) { dx = 0.01; dy = 0; d = 0.01; }
      const nx = dx / d, ny = dy / d;
      const overlap = 2 * G.R - d;
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
      const rel = rvx * nx + rvy * ny;
      if (rel < 0) {
        const imp = -(1 + e) * rel * 0.5;
        a.vx -= imp * nx;
        a.vy -= imp * ny;
        b.vx += imp * nx;
        b.vy += imp * ny;
        if (!G.firstContact && (a.id === 0 || b.id === 0)) {
          const other = a.id === 0 ? b : a;
          G.firstContact = other;
        }
        if (Math.abs(rel) > 40) sfx('click', Math.min(1, Math.abs(rel) / 900));
      }
    }
  }

  // cushions
  for (const b of activeBalls()) {
    if (!b.active) continue;
    // safety: if escaped table, put back
    if (b.x < TABLE.x - G.R * 2 || b.x > TABLE.x + TABLE.w + G.R * 2 ||
        b.y < TABLE.y - G.R * 2 || b.y > TABLE.y + TABLE.h + G.R * 2) {
      const p = nearestPocket(b.x, b.y);
      if (p && Math.hypot(b.x - p.x, b.y - p.y) < POCKET_R * 3.2) { pocketBall(b, p); continue; }
      b.x = clamp(b.x, TABLE.x + G.R, TABLE.x + TABLE.w - G.R);
      b.y = clamp(b.y, TABLE.y + G.R, TABLE.y + TABLE.h - G.R);
      b.vx = 0; b.vy = 0;
      continue;
    }
    let hit = false;
    const rest = PHYS.cushion;
    if (b.x < TABLE.x + G.R) { b.x = TABLE.x + G.R; b.vx = Math.abs(b.vx) * rest; hit = true; }
    if (b.x > TABLE.x + TABLE.w - G.R) { b.x = TABLE.x + TABLE.w - G.R; b.vx = -Math.abs(b.vx) * rest; hit = true; }
    if (b.y < TABLE.y + G.R) { b.y = TABLE.y + G.R; b.vy = Math.abs(b.vy) * rest; hit = true; }
    if (b.y > TABLE.y + TABLE.h - G.R) { b.y = TABLE.y + TABLE.h - G.R; b.vy = -Math.abs(b.vy) * rest; hit = true; }
    if (hit && Math.hypot(b.vx, b.vy) > 25) {
      sfx('cushion', Math.min(1, Math.hypot(b.vx, b.vy) / 900));
      G.targetsHit++;
    }
  }
  containBalls();
}

function clampBallsToTable() {
  if (!G) return;
  const R = G.R;
  for (const b of G.balls) {
    if (!b.active) continue;
    b.x = clamp(b.x, TABLE.x + R, TABLE.x + TABLE.w - R);
    b.y = clamp(b.y, TABLE.y + R, TABLE.y + TABLE.h - R);
  }
}

function containBalls() {
  const R = G.R;
  const minX = TABLE.x + R, maxX = TABLE.x + TABLE.w - R;
  const minY = TABLE.y + R, maxY = TABLE.y + TABLE.h - R;
  for (const b of activeBalls()) {
    if (!b.active) continue;
    const p = nearestPocket(b.x, b.y);
    if (p && Math.hypot(b.x - p.x, b.y - p.y) < POCKET_R * PHYS.contain) {
      pocketBall(b, p);
      continue;
    }
    if (!isFinite(b.x) || !isFinite(b.y)) {
      b.x = TABLE.x + TABLE.w * 0.5; b.y = TABLE.y + TABLE.h * 0.5;
      b.vx = 0; b.vy = 0;
      continue;
    }
    if (b.x < minX) { b.x = minX; b.vx = Math.abs(b.vx) * 0.4; }
    else if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * 0.4; }
    if (b.y < minY) { b.y = minY; b.vy = Math.abs(b.vy) * 0.4; }
    else if (b.y > maxY) { b.y = maxY; b.vy = -Math.abs(b.vy) * 0.4; }
  }
}

function nearestPocket(x, y) {
  let best = null, bd = Infinity;
  for (const p of POCKETS) {
    const d = Math.hypot(x - p.x, y - p.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function nearPocketMouth(x, y, extra = 0) {
  for (const p of POCKETS) {
    if (Math.hypot(x - p.x, y - p.y) < POCKET_R * 2.05 + extra) return true;
  }
  return false;
}

function pocketBall(b, p) {
  if (!b.active) return;
  b.active = false;
  b.pocketed = true;
  b.vx = 0; b.vy = 0;
  G.pottedThisShot.push(b);
  if (!SB) {
    G.pocketAnims.push({ ball: b, pocket: p, start: performance.now() });
    sfx('pocket');
    vibrate(6);
  }
}

function checkShotFinished() {
  if (!G || G.phase !== 'shooting' || G.resolvePending) return;
  const still = activeBalls().some((b) => Math.hypot(b.vx, b.vy) > 1.2);
  if (still) return;
  for (const b of activeBalls()) { b.vx = 0; b.vy = 0; }
  G.resolvePending = true;
  setTimeout(() => {
    if (!G || G.phase !== 'shooting') return;
    resolveShot();
  }, 240);
}

/* ============================================================
   规则
   ============================================================ */
function resolveShot() {
  if (!G) return;
  G.phase = 'resolving';
  G.shotActive = false;
  const potted = [...G.pottedThisShot];
  const cuePotted = potted.some((b) => b.id === 0);
  const replayFirst = G.firstContact;
  if (G.mode === 'snooker') resolveSnooker(potted, cuePotted);
  else if (G.mode === '9ball' || G.mode === '10ball') resolveNineBall(potted, cuePotted);
  else if (G.mode === 'rotation') resolveRotation(potted, cuePotted);
  else resolveEightBall(potted, cuePotted);
  if (!SB) {
    finishReplayShot({ first: replayFirst, potted });
    if (G.phase === 'over') finalizeReplay(G.winner);
  }
}

function numberedBeforeShot(objectPotted) {
  const activeNums = G.balls.filter((b) => b.active && b.id !== 0).map((b) => b.num);
  const pottedNums = objectPotted.map((b) => b.num);
  const nums = activeNums.concat(pottedNums);
  return nums.length ? Math.min(...nums) : null;
}

function resolveNineBall(potted, cuePotted) {
  const shooter = G.current;
  const opp = 1 - shooter;
  const player = G.players[shooter];
  const first = G.firstContact;
  const objectPotted = potted.filter((b) => b.id !== 0);
  const lowBefore = numberedBeforeShot(objectPotted);
  const targetNum = G.mode === '10ball' ? 10 : 9;
  const keyBall = objectPotted.find((b) => b.num === targetNum);
  let foul = false;
  const reasons = [];
  if (!first) { foul = true; reasons.push('空杆'); }
  else if (lowBefore !== null && first.num !== lowBefore) { foul = true; reasons.push(`应先碰 ${lowBefore} 号球`); }
  if (cuePotted) { foul = true; reasons.push('白球落袋'); }
  G.breakShot = false;

  if (keyBall && !foul) {
    winGame(shooter, `${targetNum} 号球入袋`);
    return;
  }
  if (foul) {
    if (keyBall) respotBall(keyBall);
    sfx('foul');
    playerFoul(shooter, reasons.join('、'), objectPotted.length);
    return endShot({ continueTurn: false, foul: true, ballInHand: true, banner: '犯规', sub: reasons.join('、') });
  }

  const cont = objectPotted.length > 0;
  if (cont) showBanner('好球', `入袋 ${objectPotted.length} 颗，继续击球`, 'good', 1200);
  else showBanner('未进球', '交换球权', '', 1000);
  endShot({ continueTurn: cont, foul: false, ballInHand: false });
}

function finishRotation() {
  const a = G.players[0].score, b = G.players[1].score;
  if (a === b) {
    G.phase = 'over';
    G.winner = -1;
    G.overReason = '轮转追分平局';
    addLog(`轮转平局 ${a}:${b}`, true);
    updateHUD();
    showOver();
    if (G.net && G.net.role === 'host') lanQueueStateSoon(100);
    if (G.net && G.net.role === 'guest') lanApplyPendingGuestState();
    return;
  }
  const w = a > b ? 0 : 1;
  endGame(w, `轮转 ${a}:${b}，${G.players[w].name} 获胜`);
}

function resolveRotation(potted, cuePotted) {
  const shooter = G.current;
  const opponent = 1 - shooter;
  const player = G.players[shooter];
  const first = G.firstContact;
  const objectPotted = potted.filter((b) => b.id !== 0);
  const lowBefore = numberedBeforeShot(objectPotted);
  let foul = false;
  const reasons = [];
  if (!first) { foul = true; reasons.push('空杆'); }
  else if (lowBefore !== null && first.num !== lowBefore) { foul = true; reasons.push(`应先碰 ${lowBefore} 号球`); }
  if (cuePotted) { foul = true; reasons.push('白球落袋'); }
  G.breakShot = false;

  if (foul) {
    // Balls potted on a foul are spotted back; no score.
    for (const b of objectPotted) respotBall(b);
    sfx('foul');
    playerFoul(shooter, reasons.join('、'), objectPotted.length);
    return endShot({ continueTurn: false, foul: true, ballInHand: true, banner: '犯规', sub: reasons.join('、') });
  }

  let points = 0;
  for (const b of objectPotted) {
    points += b.num;
    addLog(`${player.name} 打进 ${b.num} 号，得 ${b.num} 分`);
  }
  if (points > 0) {
    player.score += points;
    showBanner(`+${points} 分`, `${player.name}：${player.score} 分`, 'good', 1300);
  } else {
    showBanner('未进球', '交换球权', '', 1000);
  }

  if (player.score >= 61) {
    endGame(shooter, `轮转追分达到 ${player.score} 分，${player.name} 获胜`);
    return;
  }
  const remaining = G.balls.filter((b) => b.active && b.id !== 0);
  if (!remaining.length) {
    finishRotation();
    return;
  }

  endShot({ continueTurn: points > 0, foul: false, ballInHand: false });
}

function typeOfNum(num) {
  return num === 8 ? 'eight' : num < 8 ? 'solid' : 'stripe';
}

function resolveEightBall(potted, cuePotted) {
  const shooter = G.current;
  const opp = 1 - shooter;
  const player = G.players[shooter];
  const first = G.firstContact;
  const eight = potted.find((b) => b.num === 8 && b.id !== 0);
  const objectPotted = potted.filter((b) => b.id !== 0 && b.num !== 8);

  // break shot: black is spotted, no early loss
  if (G.breakShot) {
    let foul = false;
    const reasons = [];
    if (eight) { respotBall(eight); showBanner('黑八回摆', '开球黑八不判负', '', 1500); }
    if (!first) { foul = true; reasons.push('空杆'); }
    if (cuePotted) { foul = true; reasons.push('白球落袋'); }
    G.breakShot = false;
    if (foul) {
      sfx('foul');
      playerFoul(shooter, reasons.join('、'), objectPotted.length);
      return endShot({ continueTurn: false, foul: true, ballInHand: true, banner: '开球犯规', sub: reasons.join('、') });
    }
    const cont = objectPotted.length > 0;
    if (cont) showBanner('开球成功', `入袋 ${objectPotted.length} 颗，球桌仍开放`, 'good');
    else showBanner('开球完成', '球桌开放，继续进攻', '', 1200);
    return endShot({ continueTurn: cont, foul: false, ballInHand: false });
  }

  const group = player.group;
  const ownLeft = group ? countGroup(shooter, group) : 0;
  const cleared = !!group && ownLeft === 0;
  // Own group count at the START of this shot. The last group ball is allowed
  // to be hit first; only the next shot must hit the 8 first.
  const ownPottedBeforeCheck = group ? objectPotted.filter((b) => typeOfNum(b.num) === group).length : 0;
  const ownBefore = ownLeft + ownPottedBeforeCheck;

  if (eight) {
    if (cleared && !cuePotted && first && first.num === 8) {
      winGame(shooter, '黑八入袋，清台成功');
    } else {
      let why = '黑八提前入袋';
      if (cleared && cuePotted) why = '打黑八时白球落袋';
      else if (cleared && first && first.num !== 8) why = '打黑八时先碰了别的球';
      loseGame(shooter, why);
    }
    return;
  }

  let foul = false;
  const reasons = [];
  if (!first) { foul = true; reasons.push('空杆'); }
  else if (G.openTable && first.num === 8) { foul = true; reasons.push('开放球桌先碰黑八'); }
  else if (group) {
    if (ownBefore > 0) {
      if (typeOfNum(first.num) !== group) {
        foul = true;
        reasons.push(first.num === 8 ? '本组球未清，不能先碰黑八' : '先碰对方球');
      }
    } else if (first.num !== 8) {
      foul = true;
      reasons.push('应先碰黑八');
    }
  }
  if (cuePotted) { foul = true; reasons.push('白球落袋'); }

  if (!foul && G.openTable && objectPotted.length > 0) {
    const assigned = typeOfNum(objectPotted[0].num);
    player.group = assigned;
    G.players[opp].group = assigned === 'solid' ? 'stripe' : 'solid';
    G.openTable = false;
    showBanner('分组确定', `${player.name}：${groupName(assigned)}`, 'good', 1600);
  }

  if (objectPotted.length) {
    addLog(`${player.name} 打进 ${objectPotted.map((b) => targetName(b)).join('、')}`, false);
  }

  let ownPotted = 0, oppPotted = 0;
  for (const b of objectPotted) {
    if (player.group && typeOfNum(b.num) === player.group) ownPotted++;
    else if (player.group) oppPotted++;
  }

  if (foul) {
    sfx('foul');
    playerFoul(shooter, reasons.join('、'), objectPotted.length);
    return endShot({ continueTurn: false, foul: true, ballInHand: true, banner: '犯规', sub: reasons.join('、') });
  }

  const cont = ownPotted > 0;
  if (ownPotted > 0) showBanner('好球', `入袋 ${ownPotted} 颗${oppPotted ? '，另送对手 ' + oppPotted + ' 颗' : ''}`, 'good', 1400);
  else if (oppPotted > 0) showBanner('交换球权', `打进对手 ${oppPotted} 颗`, '', 1400);
  else if (!G.openTable) showBanner('未进球', '交换球权', '', 1100);
  endShot({ continueTurn: cont, foul: false, ballInHand: false, pottedOwn: ownPotted });
}

function playerFoul(shooter, reason, count) {
  G.lastFoul = reason;
  addLog(`犯规：${reason}`, true);
  vibrate(16);
}

function endShot({ continueTurn = false, foul = false, ballInHand = false, banner = '', sub = '', pottedOwn = 0 }) {
  if (!G || G.phase === 'over') return;
  const shooter = G.current;
  const opp = 1 - shooter;
  if (!continueTurn) {
    G.current = opp;
    // Sandbox budget is per turn: reset only when this player starts a new turn.
    if (Array.isArray(G.aiSandboxUsed)) G.aiSandboxUsed[opp] = 0;
    else G.aiSandboxUsed = 0;
    // 【失败计数也要按回合清零】和沙箱预算同理：上一回合已经决定「改用本地」，
    // 那是上一回合的判断，不能一直压在玩家头上。新回合重新给 API 机会。
    if (Array.isArray(G.apiConnFailures)) G.apiConnFailures[opp] = 0;
    else G.apiConnFailures = 0;
    if (Array.isArray(G.apiRespFailures)) G.apiRespFailures[opp] = 0;
    else G.apiRespFailures = 0;
    if (Array.isArray(G.apiFailureLog)) G.apiFailureLog[opp] = [];
    else G.apiFailureLog = [];
  }
  G.ballInHand = !!ballInHand;
  G.freeBallDrag = false;
  G.phase = G.ballInHand ? 'ballInHand' : 'aim';
  G.pottedThisShot = [];
  G.firstContact = null;
  G.resolvePending = false;
  G.aiPlan = null;
  G.aiThinking = false;
  G.aimHint = null;
  G.fineDelta = 0;
  G.power = 0.1;
  G._hintKey = null;
  G._hint = null;
  if (!continueTurn) {
    G.snooker && (G.snooker.breakScore = 0);
  }
  if (G.ballInHand) prepareCueForHand();
  if (G.mode === 'snooker' && !continueTurn) {
    G.snooker.lastColor = false;
    G.snooker.colorsPhase = activeReds() === 0;
    G.snooker.ballOn = G.snooker.colorsPhase ? (lowestColor()?.value ?? null) : 'red';
  }
  if (banner) showBanner(banner, sub, foul ? 'bad' : '');
  updateHUD();
  if (G.phase === 'over') return;
  maybeAi();
  if (G.net && G.net.role === 'host') lanQueueStateSoon();
  if (G.net && G.net.role === 'guest') lanApplyPendingGuestState();
}

/* ---------------- snooker rules ---------------- */
function snookerOnValue() {
  const on = G.snooker.ballOn;
  if (on === 'red') return 1;
  if (on === 'color' || on === 'last-color') return 7;
  return Number(on) || 1;
}

function ballMatchesOn(b) {
  const on = G.snooker.ballOn;
  if (!b) return false;
  if (on === 'red') return b.type === 'red';
  if (on === 'color' || on === 'last-color') return b.type === 'color';
  return b.type === 'color' && b.value === Number(on);
}

function resolveSnooker(potted, cuePotted) {
  G.breakShot = false;
  const shooter = G.current;
  const opp = 1 - shooter;
  const player = G.players[shooter];
  const sn = G.snooker;
  const first = G.firstContact;
  const on = sn.ballOn;
  const objectPotted = potted.filter((b) => b.id !== 0);
  const onVal = snookerOnValue();

  let foul = false;
  const reasons = [];
  if (!first) { foul = true; reasons.push('空杆'); }
  else if (!ballMatchesOn(first)) { foul = true; reasons.push('先碰错球'); }
  if (cuePotted) { foul = true; reasons.push('白球落袋'); }

  let wrongValue = 0;
  for (const b of objectPotted) {
    if (!ballMatchesOn(b)) { foul = true; wrongValue = Math.max(wrongValue, b.value || 1); }
  }
  if (on === 'color' || on === 'last-color') {
    const colorsPotted = objectPotted.filter((b) => b.type === 'color');
    if (colorsPotted.length > 1) { foul = true; reasons.push('一杆打进多颗彩球'); }
    if (objectPotted.some((b) => b.type === 'red')) { foul = true; }
  }
  if (on === 'red') {
    if (objectPotted.some((b) => b.type === 'color')) foul = true;
  }
  if (typeof on === 'number') {
    if (objectPotted.some((b) => b.type !== 'color' || b.value !== on)) foul = true;
  }

  if (foul) {
    const penalty = Math.max(4, onVal, wrongValue || 0);
    G.players[opp].score += penalty;
    // colors potted on a foul are respotted
    for (const b of objectPotted) if (b.type === 'color') respotColor(b, true);
    // if cue potted, it stays inactive until hand placement
    sfx('foul');
    addLog(`犯规：${reasons.join('、') || '击球犯规'}，对手 +${penalty} 分`, true);
    return endShot({
      continueTurn: false, foul: true, ballInHand: cuePotted,
      banner: '犯规', sub: `${reasons.join('、') || '击球犯规'} · 对手 +${penalty} 分`,
    });
  }

  // scoring
  let points = 0;
  if (on === 'red') {
    points = objectPotted.filter((b) => b.type === 'red').length;
  } else {
    points = objectPotted.reduce((s, b) => s + (b.value || 0), 0);
  }

  if (points > 0) {
    player.score += points;
    sn.breakScore += points;
    sn.bestBreak = Math.max(sn.bestBreak || 0, sn.breakScore);
    addLog(`${player.name} 打进 ${objectPotted.map((b) => targetName(b)).join('、')}，得 ${points} 分`, true);
    showBanner(`+${points} 分`, `本杆 ${sn.breakScore} 分`, 'good', 1200);
  } else {
    showBanner('未进球', '交换球权', '', 1000);
  }

  // next ball on + respot
  const redsNow = activeReds();
  if (on === 'red') {
    if (redsNow > 0) {
      sn.ballOn = 'color';
      sn.colorsPhase = false;
    } else {
      sn.ballOn = 'last-color';
      sn.lastColor = true;
      sn.colorsPhase = false;
    }
  } else if (on === 'color') {
    for (const b of objectPotted) if (b.type === 'color') respotColor(b, true);
    if (redsNow > 0) { sn.ballOn = 'red'; sn.colorsPhase = false; }
    else { sn.ballOn = 'last-color'; sn.lastColor = true; sn.colorsPhase = false; }
  } else if (on === 'last-color') {
    for (const b of objectPotted) if (b.type === 'color') respotColor(b, true);
    sn.lastColor = false;
    sn.colorsPhase = true;
    const low = lowestColor();
    if (!low) { finishSnookerFrame(); return; }
    sn.ballOn = low.value;
    addLog('红球清完，进入彩球阶段，按分值从低到高', true);
  } else {
    // colors phase: potted colors stay down
    sn.colorsPhase = true;
    const low = lowestColor();
    if (!low) { finishSnookerFrame(); return; }
    sn.ballOn = low.value;
  }

  const cont = points > 0;
  endShot({ continueTurn: cont, foul: false, ballInHand: false });
}

function finishSnookerFrame() {
  const a = G.players[0].score, b = G.players[1].score;
  if (a === b) {
    G.phase = 'over';
    G.winner = -1;
    G.overReason = '斯诺克平局';
    addLog('平局，斯诺克落下帷幕', true);
    updateHUD();
    showOver();
    if (G.net && G.net.role === 'host') lanQueueStateSoon(100);
    if (G.net && G.net.role === 'guest') lanApplyPendingGuestState();
    return;
  }
  const w = a > b ? 0 : 1;
  endGame(w, `斯诺克 ${G.players[w].score}:${G.players[1 - w].score}，${G.players[w].name} 获胜`);
}

function respotColor(b, force = false) {
  if (!force && b.active) return;
  b.active = true;
  b.pocketed = false;
  b.vx = 0; b.vy = 0;
  const pos = findFreeSpot(b.spotX, b.spotY, G.R, b);
  b.x = pos.x;
  b.y = pos.y;
}

function respotBall(b) {
  b.active = true;
  b.pocketed = false;
  b.vx = 0; b.vy = 0;
  const footX = TABLE.x + TABLE.w * 0.75;
  const footY = TABLE.y + TABLE.h / 2;
  const pos = findFreeSpot(footX, footY, G.R, b);
  b.x = pos.x; b.y = pos.y;
}

function findFreeSpot(px, py, R, ignore) {
  const margin = R + 2;
  const valid = (x, y) => {
    if (x < TABLE.x + margin || x > TABLE.x + TABLE.w - margin ||
        y < TABLE.y + margin || y > TABLE.y + TABLE.h - margin) return false;
    for (const b of G.balls) {
      if (!b.active || b === ignore) continue;
      if (Math.hypot(b.x - x, b.y - y) < 2 * R + 2) return false;
    }
    if (nearestPocket(x, y) && Math.hypot(x - nearestPocket(x, y).x, y - nearestPocket(x, y).y) < POCKET_R + R) return false;
    return true;
  };
  if (valid(px, py)) return { x: px, y: py };
  for (let r = 2 * R + 4; r < 260; r += 2 * R + 4) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
      const x = px + Math.cos(a) * r, y = py + Math.sin(a) * r;
      if (valid(x, y)) return { x, y };
    }
  }
  // last resort: center
  for (let y = TABLE.y + 80; y < TABLE.y + TABLE.h - 80; y += 12) {
    for (let x = TABLE.x + 80; x < TABLE.x + TABLE.w - 80; x += 12) {
      if (valid(x, y)) return { x, y };
    }
  }
  return { x: px, y: py };
}

function prepareCueForHand() {
  const cue = cueBall();
  if (!cue) return;
  if (!cue.active) {
    cue.active = true;
    cue.pocketed = false;
    cue.vx = 0; cue.vy = 0;
    let sx, sy;
    if (G.mode === 'snooker') {
      sx = TABLE.x + TABLE.w * 0.18;
      sy = TABLE.y + TABLE.h * 0.55;
    } else {
      sx = TABLE.x + TABLE.w * 0.25;
      sy = TABLE.y + TABLE.h * 0.5;
    }
    const pos = findFreeSpot(sx, sy, G.R, cue);
    cue.x = pos.x; cue.y = pos.y;
  }
  G.lastValidCue = { x: cue.x, y: cue.y };
}

function endGame(winner, reason) {
  if (!G) return;
  G.phase = 'over';
  G.winner = winner;
  G.overReason = reason || '';
  G.aiThinking = false;
  if (!SB && (!RECORDER || !RECORDER.currentShot)) finalizeReplay(winner);
  if (SB) { addLog(reason, true); return; }
  clearTimeout(aiTimer);
  aiToken++;
  addLog(reason, true);
  if (winner === 0) sfx('win'); else if (winner === 1) sfx('lose');
  updateHUD();
  showOver();
  if (G.net && G.net.role === 'host') lanQueueStateSoon(100);
  if (G.net && G.net.role === 'guest') lanApplyPendingGuestState();
}

function winGame(shooter, reason) {
  endGame(shooter, `${G.players[shooter].name}：${reason}`);
}

function loseGame(shooter, reason) {
  const winner = 1 - shooter;
  endGame(winner, `${G.players[shooter].name} ${reason}，${G.players[winner].name} 获胜`);
}

function showOver() {
  if (SB) return;
  const el = $('#overModal');
  $('#toast').classList.remove('show');
  $('#banner').classList.remove('show');
  let title, sub, emblem, score = '';
  const local = G.net ? G.net.localPlayer : 0;
  const draw = G.winner === -1;
  const win = !draw && G.winner === local;

  if (G.mode === 'snooker') {
    const a = G.players[local].score, b = G.players[1 - local].score;
    title = draw ? '平局' : win ? '你赢了' : G.players[G.winner].name + ' 获胜';
    sub = (G.replayMode === 'snooker6' ? '6 红球斯诺克' : '斯诺克') + ' · 红球清台';
    score = `${a} : ${b}`;
    emblem = draw ? '🤝' : win ? '🏆' : '🎱';
  } else if (G.mode === 'rotation') {
    const a = G.players[local].score, b = G.players[1 - local].score;
    title = draw ? '平局' : win ? '你赢了' : G.players[G.winner].name + ' 获胜';
    sub = '轮转追分 · ROTATION';
    score = `${a} : ${b}`;
    emblem = draw ? '🤝' : win ? '🏆' : '🎱';
  } else if (G.mode === '9ball' || G.mode === '10ball') {
    title = win ? '你赢了' : G.players[G.winner].name + ' 获胜';
    sub = G.mode === '10ball' ? '十球 · 10 号球入袋' : '九球 · 9 号球入袋';
    score = win ? 'VICTORY' : 'DEFEAT';
    emblem = win ? '🏆' : '🎱';
  } else {
    title = win ? '你赢了' : G.players[G.winner].name + ' 获胜';
    sub = G.overReason ? G.overReason.replace(/^.*?：/, '') : (win ? '黑八入袋，一杆清台' : '这一局属于对手');
    score = win ? 'VICTORY' : 'DEFEAT';
    emblem = win ? '🏆' : '🎱';
  }
  $('#overTitle').textContent = title;
  $('#overSub').textContent = sub;
  $('#overEmblem').textContent = emblem;
  $('#overScore').textContent = score;
  el.classList.add('show');
}

  // 【为什么用回调而不是直接 import】game.js 是 IIFE，
  //   拿不到 screen.js 的作用域，也不该知道排行榜怎么提交。
  //   这里只把「谁赢了、打了几杆」这些事实交出去，怎么算分是上层的事。
  try {
    if (typeof window.__poolOnOver === 'function') {
      window.__poolOnOver({
        mode: G.mode,
        winner: G.winner,
        difficulty: (G.seats && G.seats[0] && G.seats[0].difficulty) || 'normal',
        shots: G.shotIndex,
        players: G.players.map((p) => ({ name: p.name, score: p.score })),
        overReason: G.overReason || '',
        ballsTotal: G.balls.filter((b) => b.id !== 0).length,
      });
    }
  } catch (e) { console.warn('[pool] onOver failed', e); }

/* ============================================================
   本地 AI / 大模型对手
   ============================================================ */
function legalTargets() {
  if (!G) return [];
  const balls = activeBalls().filter((b) => b.id !== 0);
  if (G.mode === '9ball' || G.mode === '10ball' || G.mode === 'rotation') {
    const low = lowestActiveBall();
    return low ? [low] : [];
  }
  if (G.mode === '8ball') {
    const p = G.players[G.current];
    if (G.openTable || !p.group) {
      const nonEight = balls.filter((b) => b.num !== 8);
      return nonEight.length ? nonEight : balls.filter((b) => b.num === 8);
    }
    const remain = balls.filter((b) => b.type === p.group);
    return remain.length ? remain : balls.filter((b) => b.num === 8);
  }
  const on = G.snooker.ballOn;
  if (on === 'red') return balls.filter((b) => b.type === 'red');
  if (on === 'color' || on === 'last-color') return balls.filter((b) => b.type === 'color');
  if (typeof on === 'number') return balls.filter((b) => b.type === 'color' && b.value === on);
  return [];
}

function pathClear(ax, ay, bx, by, ignoreA, ignoreB, threshold) {
  for (const b of G.balls) {
    if (!b.active || b === ignoreA || b === ignoreB) continue;
    if (segDist(ax, ay, bx, by, b.x, b.y) < threshold) return false;
  }
  return true;
}

function potCandidate(cue, target, pocket, cueOverride) {
  const R = G.R;
  const ox = cueOverride ? cueOverride.x : cue.x;
  const oy = cueOverride ? cueOverride.y : cue.y;
  const objDir = norm(pocket.x - target.x, pocket.y - target.y);
  const ghost = { x: target.x - objDir.x * 2 * R, y: target.y - objDir.y * 2 * R };
  const margin = R + 1.5;
  if (ghost.x < TABLE.x + margin || ghost.x > TABLE.x + TABLE.w - margin ||
      ghost.y < TABLE.y + margin || ghost.y > TABLE.y + TABLE.h - margin) return null;
  const cueDir = norm(ghost.x - ox, ghost.y - oy);
  const cueDist = Math.hypot(ghost.x - ox, ghost.y - oy);
  if (cueDist < 2 * R) return null;
  const cutCos = cueDir.x * objDir.x + cueDir.y * objDir.y;
  const cut = Math.acos(clamp(cutCos, -1, 1));
  if (cut > (80 * Math.PI) / 180) return null;
  if (!pathClear(ox, oy, ghost.x, ghost.y, cue, target, 2 * R - 0.5)) return null;
  if (!pathClear(target.x, target.y, pocket.x, pocket.y, target, cue, 2 * R - 0.5)) return null;
  const objDist = Math.hypot(pocket.x - target.x, pocket.y - target.y);
  const cutDeg = (cut * 180) / Math.PI;

  // approximate cue deflection after impact (tangent line)
  let tangent = { x: cueDir.x - objDir.x * cutCos, y: cueDir.y - objDir.y * cutCos };
  const tl = Math.hypot(tangent.x, tangent.y);
  if (tl > 0.05) { tangent.x /= tl; tangent.y /= tl; } else { tangent = { x: 0, y: 0 }; }
  const cueEnd = { x: ghost.x + tangent.x * (50 + 120 * (1 - cutCos)), y: ghost.y + tangent.y * (50 + 120 * (1 - cutCos)) };

  let score = 1100 - cutDeg * 8.5 - cueDist * 0.18 - objDist * 0.3;
  if (!pocket.corner) score -= 14;
  if (G.mode === 'snooker') score += (target.value || 1) * 11;
  if (G.mode === '8ball' && target.num === 8) score += 220;
  // position: stay out of pockets and off the cushion
  const np = nearestPocket(cueEnd.x, cueEnd.y);
  const pd = np ? Math.hypot(cueEnd.x - np.x, cueEnd.y - np.y) : 999;
  if (pd < POCKET_R * 2.6) score -= 380;
  const edge = Math.min(cueEnd.x - TABLE.x, TABLE.x + TABLE.w - cueEnd.x,
    cueEnd.y - TABLE.y, TABLE.y + TABLE.h - cueEnd.y);
  if (edge < R * 1.8) score -= 35;
  const centerDist = Math.hypot(cueEnd.x - (TABLE.x + TABLE.w / 2), cueEnd.y - (TABLE.y + TABLE.h / 2));
  score += Math.max(0, 25 - centerDist * 0.025);
  const power = clamp(0.34 + (cueDist + objDist * 0.72) / 1950 + cutDeg / 320, 0.34, 0.9);
  return {
    type: 'pot', target, pocket, ghost, cueDir, objDir, cutDeg, cueDist, objDist,
    angle: Math.atan2(ghost.y - oy, ghost.x - ox), power, score, cueEnd,
    note: cutDeg < 8 ? '直线球' : cutDeg < 30 ? '小角度' : cutDeg < 55 ? '切球' : '大角度薄球',
  };
}

function safetyCandidates(cue) {
  const out = [];
  const targets = legalTargets();
  for (const t of targets) {
    const d = Math.hypot(t.x - cue.x, t.y - cue.y);
    if (d < 2 * G.R) continue;
    if (!pathClear(cue.x, cue.y, t.x, t.y, cue, t, 2 * G.R - 0.5)) continue;
    const a = Math.atan2(t.y - cue.y, t.x - cue.x);
    const p = clamp(0.26 + d / 2400, 0.26, 0.55);
    out.push({
      type: 'safe', target: t, pocket: null, angle: a, power: p,
      score: 330 - d * 0.08 + (G.mode === 'snooker' ? (t.value || 1) * 3 : 0),
      cutDeg: 0, cueDist: d, objDist: 0, note: '防守球',
    });
  }
  if (!out.length) {
    const kick = findKickShot(cue, targets);
    if (kick) out.push(kick);
  }
  return out;
}

function findKickShot(cue, targets) {
  const legal = new Set(targets.map((t) => t.id));
  let best = null;
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * Math.PI * 2;
    const hit = traceFirstHit(cue.x, cue.y, a, 1);
    if (hit && legal.has(hit.id)) {
      const score = 260 - Math.abs(Math.sin(a)) * 20;
      if (!best || score > best.score) {
        best = { type: 'kick', target: hit, pocket: null, angle: a, power: 0.55, score, note: '库边解球' };
      }
    }
  }
  return best;
}

function traceFirstHit(x, y, angle, bounces = 1) {
  let ox = x, oy = y, dx = Math.cos(angle), dy = Math.sin(angle);
  const R = G.R;
  for (let bounce = 0; bounce <= bounces; bounce++) {
    let bestT = Infinity, hit = null;
    for (const b of G.balls) {
      if (!b.active || b.id === 0) continue;
      const t = rayCircle(ox, oy, dx, dy, b.x, b.y, 2 * R);
      if (t !== null && t > 0.01 && t < bestT) { bestT = t; hit = b; }
    }
    let tx = Infinity, ty = Infinity;
    const minX = TABLE.x + R, maxX = TABLE.x + TABLE.w - R;
    const minY = TABLE.y + R, maxY = TABLE.y + TABLE.h - R;
    if (dx > 0.0001) tx = (maxX - ox) / dx;
    else if (dx < -0.0001) tx = (minX - ox) / dx;
    if (dy > 0.0001) ty = (maxY - oy) / dy;
    else if (dy < -0.0001) ty = (minY - oy) / dy;
    const wt = Math.min(tx, ty);
    if (hit && bestT < wt) return hit;
    if (!isFinite(wt) || wt < 0 || bounce >= bounces) return null;
    ox += dx * wt;
    oy += dy * wt;
    if (tx <= ty) dx = -dx; else dy = -dy;
    ox += dx * 0.8;
    oy += dy * 0.8;
  }
  return null;
}

function breakCandidate(cue) {
  if (!G.breakShot) return null;
  let apex = G.balls.find((b) => b.id === G.balls.rackApexId && b.active);
  if (!apex && G.mode === 'snooker') {
    apex = G.balls.filter((b) => b.active && b.type === 'red').sort((a, b) => (b.x + b.y * 0.2) - (a.x + a.y * 0.2))[0];
  }
  if (!apex) return null;
  let angle = Math.atan2(apex.y - cue.y, apex.x - cue.x);
  if (G.mode === 'snooker') angle -= 0.01;
  return [{
    type: 'break', target: apex, pocket: null, angle,
    power: G.mode === 'snooker' ? 0.55 : 1,
    score: 9999, cutDeg: 0, cueDist: Math.hypot(apex.x - cue.x, apex.y - cue.y), objDist: 0, note: '开球',
  }];
}

function buildCandidates(opts = {}) {
  if (!G) return [];
  const cue = opts.cue || cueBall();
  if (!cue || !cue.active) return [];
  const br = breakCandidate(cue);
  if (br) return br;
  const targets = legalTargets();
  const cands = [];
  for (const t of targets) {
    if (!t.active) continue;
    for (const p of POCKETS) {
      if (Math.hypot(p.x - t.x, p.y - t.y) < 2 * G.R) continue;
      const c = potCandidate(cue, t, p);
      if (c) cands.push(c);
    }
  }
  const safe = safetyCandidates(cue);
  if (!cands.length) cands.push(...safe);
  else cands.push(...safe.slice(0, 2));
  cands.sort((a, b) => b.score - a.score);
  for (let i = 0; i < cands.length; i++) cands[i].id = 'A' + (i + 1);
  return cands;
}

function chooseLocalShot(cands) {
  if (!cands.length) return null;
  const diff = seatDifficulty(G.current);
  const poolSize = diff === 'easy' ? 8 : diff === 'normal' ? 4 : 2;
  const pool = cands.slice(0, Math.min(poolSize, cands.length));
  let pick;
  if (diff === 'easy') {
    pick = Math.random() < 0.5 ? pool[Math.floor(Math.random() * pool.length)] : cands[Math.floor(Math.random() * Math.min(8, cands.length))];
  } else if (diff === 'normal') {
    pick = Math.random() < 0.7 ? pool[0] : pool[Math.floor(Math.random() * pool.length)];
  } else {
    pick = cands[0];
  }
  pick = { ...pick };
  if (pick.type === 'break') return pick;
  const err = diff === 'easy' ? 0.032 : diff === 'normal' ? 0.013 : 0.004;
  const perr = diff === 'easy' ? 0.14 : diff === 'normal' ? 0.06 : 0.02;
  pick.angle += (Math.random() * 2 - 1) * err;
  pick.power = clamp(pick.power + (Math.random() * 2 - 1) * perr, 0.22, 1);
  return pick;
}

function chooseAiCuePosition() {
  const cue = cueBall();
  if (!cue) return;
  const targets = legalTargets();
  let best = null;
  for (const t of targets) {
    for (const p of POCKETS) {
      if (Math.hypot(p.x - t.x, p.y - t.y) < 2 * G.R) continue;
      const objDir = norm(p.x - t.x, p.y - t.y);
      const ghost = { x: t.x - objDir.x * 2 * G.R, y: t.y - objDir.y * 2 * G.R };
      for (const back of [85, 125, 170, 220]) {
        const x = ghost.x - objDir.x * back;
        const y = ghost.y - objDir.y * back;
        if (!validCuePosition(x, y, cue)) continue;
        const c = potCandidate(cue, t, p, { x, y });
        if (c && (!best || c.score > best.score)) best = { x, y, score: c.score };
      }
    }
  }
  if (!best) {
    const fallback = G.mode === 'snooker'
      ? { x: TABLE.x + TABLE.w * 0.22, y: TABLE.y + TABLE.h * 0.58 }
      : { x: TABLE.x + TABLE.w * 0.3, y: TABLE.y + TABLE.h * 0.5 };
    const pos = findFreeSpot(fallback.x, fallback.y, G.R, cue);
    best = { x: pos.x, y: pos.y };
  }
  cue.x = best.x;
  cue.y = best.y;
  cue.vx = 0; cue.vy = 0;
  cue.active = true;
  G.lastValidCue = { x: cue.x, y: cue.y };
  G.ballInHand = false;
  G.freeBallDrag = false;
  G.phase = 'aim';
  addLog('AI 选择自由球位置');
}

function ballInHandPlacements(limit = 5) {
  const cue = cueBall();
  if (!cue) return [];
  const targets = legalTargets();
  const found = [];
  for (const t of targets) {
    for (const p of POCKETS) {
      if (Math.hypot(p.x - t.x, p.y - t.y) < 2 * G.R) continue;
      const objDir = norm(p.x - t.x, p.y - t.y);
      const ghost = { x: t.x - objDir.x * 2 * G.R, y: t.y - objDir.y * 2 * G.R };
      for (const back of [70, 110, 155, 205, 260]) {
        const x = ghost.x - objDir.x * back;
        const y = ghost.y - objDir.y * back;
        if (!validCuePosition(x, y, cue)) continue;
        const c = potCandidate(cue, t, p, { x, y });
        if (c) found.push({ x, y, score: c.score });
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const p of found) {
    if (picked.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > G.R * 1.8)) picked.push(p);
    if (picked.length >= limit) break;
  }
  return picked;
}

function buildBallInHandCandidates() {
  const cue = cueBall();
  if (!cue) return [];
  const original = { x: cue.x, y: cue.y };
  const placements = ballInHandPlacements();
  if (!placements.length) {
    const list = buildCandidates({ cue });
    for (const c of list) c.cue = { x: original.x, y: original.y };
    return list;
  }
  const all = [];
  for (const pl of placements) {
    cue.x = pl.x; cue.y = pl.y; cue.vx = 0; cue.vy = 0;
    const list = buildCandidates({ cue }).slice(0, 4);
    for (const c of list) {
      c.cue = { x: pl.x, y: pl.y };
      c.placementScore = pl.score;
      all.push(c);
    }
  }
  cue.x = original.x; cue.y = original.y; cue.vx = 0; cue.vy = 0;
  all.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of all) {
    const dup = picked.some((p) => p.target && c.target && p.target.id === c.target.id && p.pocket && c.pocket && p.pocket.name === c.pocket.name && Math.abs(p.angle - c.angle) < 0.02);
    if (!dup) picked.push(c);
    if (picked.length >= 10) break;
  }
  picked.forEach((c, i) => { c.id = 'A' + (i + 1); });
  return picked;
}

function applyCandidateCue(c) {
  if (!c || !c.cue) return;
  const cue = cueBall();
  if (!cue) return;
  if (!validCuePosition(c.cue.x, c.cue.y, cue)) return;
  cue.x = c.cue.x; cue.y = c.cue.y; cue.vx = 0; cue.vy = 0;
  cue.active = true; cue.pocketed = false;
  G.freeBallPlaced = true;
  G.ballInHand = false;
  G.freeBallDrag = false;
  G.phase = 'aim';
}

function validCuePosition(x, y, ignore) {
  const R = G.R;
  if (x < TABLE.x + R + 2 || x > TABLE.x + TABLE.w - R - 2 ||
      y < TABLE.y + R + 2 || y > TABLE.y + TABLE.h - R - 2) return false;
  for (const b of G.balls) {
    if (!b.active || b === ignore) continue;
    if (Math.hypot(b.x - x, b.y - y) < 2 * R + 2) return false;
  }
  for (const p of POCKETS) {
    if (Math.hypot(x - p.x, y - p.y) < POCKET_R + R + 2) return false;
  }
  return true;
}

function maybeAi() {
  if (SB || !G || G.phase === 'over' || paused) return;
  if (!isAI(G.current)) return;
  if (G.phase !== 'aim' && G.phase !== 'ballInHand') return;
  clearTimeout(aiTimer);
  const token = ++aiToken;
  aiTimer = setTimeout(() => {
    if (!G || token !== aiToken || paused) return;
    if (!isAI(G.current) || G.phase === 'over' || G.phase === 'shooting') return;
    aiTakeShot(token);
  }, 620);
}

function modelAngleCandidate(res) {
  if (!G || !res || !Number.isFinite(res.angle)) return null;
  const cue = cueBall();
  if (!cue || !cue.active) return null;
  let rad = res.angle * Math.PI / 180;
  rad = ((rad + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  const hit = traceFirstHit(cue.x, cue.y, rad, 2);
  const legal = legalTargets();
  if (!hit || !legal.some((t) => t.id === hit.id)) return null;
  let power = Number.isFinite(res.power) ? res.power : 0.55;
  if (power > 1) power /= 100;
  power = clamp(power, 0.18, 1);
  return {
    type: 'model', target: hit, angle: rad, power,
    score: 9999, cutDeg: 0, cueDist: Math.hypot(hit.x - cue.x, hit.y - cue.y),
    objDist: 0, note: '模型角度',
  };
}

function simulateShotInSandbox(angle, power) {
  if (!G) return { error: '没有对局' };
  const realG = G;
  const oldSB = SB;
  let clone;
  try {
    clone = JSON.parse(JSON.stringify(G));
  } catch (e) {
    return { error: '状态复制失败' };
  }
  clone.net = null;
  clone.opponent = 'human';
  clone.phase = 'shooting';
  clone.ballInHand = false;
  clone.resolvePending = true;
  clone.firstContact = null;
  clone.pottedThisShot = [];
  clone.pocketAnims = [];
  clone.lastFoul = null;
  clone.targetsHit = 0;
  clone.aiThinking = false;
  clone.aiPlan = null;
  clone.winner = null;
  clone.overReason = '';
  SB = true;
  G = clone;
  try {
    clampBallsToTable();
    const cue = cueBall();
    if (!cue || !cue.active) return { error: '白球不在台面' };
    cue.vx = Math.cos(angle) * (230 + clamp(power, 0.1, 1) * 1270);
    cue.vy = Math.sin(angle) * (230 + clamp(power, 0.1, 1) * 1270);
    const dt = 1 / 120;
    let steps = 0;
    const frames = [{ t: 0, balls: activeBalls().map((b) => [b.id, Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10]) }];
    let settled = false;
    const cap = 5000;
    while (steps < cap) {
      G = clone;
      const moving = activeBalls().some((b) => Math.hypot(b.vx, b.vy) > 1.2);
      if (!moving) { settled = true; break; }
      simulateStep(dt);
      steps++;
      if (steps % 2 === 0 || steps === cap) {
        frames.push({ t: Math.round(steps * 1000 / 120), balls: activeBalls().map((b) => [b.id, Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10]) });
      }
    }
    if (!settled) {
      for (const b of activeBalls()) { b.vx = 0; b.vy = 0; }
    }
    frames.push({ t: Math.round(steps * 1000 / 120), balls: activeBalls().map((b) => [b.id, Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10]) });
    const first = clone.firstContact
      ? { num: clone.firstContact.num, type: clone.firstContact.type, id: clone.firstContact.id, colorName: clone.firstContact.colorName }
      : null;
    const potted = clone.pottedThisShot.map((b) => ({
      id: b.id, num: b.num, type: b.type, colorName: b.colorName,
    }));
    const cuePotted = potted.some((b) => b.id === 0);
    clone.phase = 'shooting';
    clone.resolvePending = false;
    resolveShot();
    const foul = clone.lastFoul || '';
    return {
      shot: { angleDeg: Math.round(angle * 1800 / Math.PI) / 10, power: Math.round(clamp(power, 0.1, 1) * 100) },
      first,
      potted,
      cuePotted,
      foul: !!foul,
      foulReason: foul,
      winner: clone.winner,
      phase: clone.phase,
      nextPlayer: clone.current,
      ballInHand: !!clone.ballInHand,
      scores: clone.players.map((p) => p.score),
      balls: clone.balls.map((b) => ({
        id: b.id, num: b.num, type: b.type, active: !!b.active,
        pocketed: !!b.pocketed, x: Math.round(b.x), y: Math.round(b.y),
      })),
      log: clone.log.slice(-8).map((l) => l.text),
      frames,
      settled,
      steps,
    };
  } catch (e) {
    return { error: String(e && e.message || e) };
  } finally {
    G = realG;
    SB = oldSB;
  }
}

function simulateSandboxProposal(proposal) {
  const cue = cueBall();
  if (!cue || !proposal) return simulateShotInSandbox(proposal.angle, proposal.power);
  const old = { x: cue.x, y: cue.y };
  if (proposal.cue && validCuePosition(proposal.cue.x, proposal.cue.y, cue)) {
    cue.x = proposal.cue.x; cue.y = proposal.cue.y; cue.vx = 0; cue.vy = 0;
  }
  try { return simulateShotInSandbox(proposal.angle, proposal.power); }
  finally { cue.x = old.x; cue.y = old.y; cue.vx = 0; cue.vy = 0; }
}

async function askModelWithSandbox(cands, profile = null, thinkLevel = null, apiFailureLog = []) {
  const limit = aiThinkRounds();
  const feedback = [];
  let used = aiSandboxUsedFor(G.current);
  let best = null;
  let reason = '';
  let warned = false;
  const maxCalls = limit + 3;
  for (let call = 0; call < maxCalls; call++) {
    const sandbox = { used, limit, remaining: Math.max(0, limit - used) };
    let res;
    try {
      res = await askModel(cands, feedback, call, limit, sandbox, profile, thinkLevel, used, apiFailureLog);
    } catch (e) {
      const msg = String(e && e.message || e);
      replayRecordAi({ type: 'error', call: call + 1, error: msg });
      if (/JSON|json|解析/.test(msg) && call < maxCalls - 1) {
        feedback.push({ call: call + 1, error: msg, mustJson: true, sandbox });
        continue;
      }
      if (best) return { chosen: best, simulations: feedback, reason, sandboxUsed: used };
      throw e;
    }
    reason = res.reason || reason;
    replayRecordAi({
      type: 'decision', call: call + 1,
      sandbox: { used, limit, remaining: Math.max(0, limit - used) },
      angle: res.angle, power: res.power, id: res.id, try: res.trySandbox, reason: res.reason || '',
    });
    const proposal = resolveModelProposal(res, cands);
    if (!proposal) {
      replayRecordAi({ type: 'invalid', call: call + 1, error: '角度/候选不合法' });
      feedback.push({
        call: call + 1,
        error: '返回的角度/候选不合法，第一颗碰到的不是规则目标球，或 id 不存在',
        model: { angle: res.angle, id: res.id, power: res.power, try: res.trySandbox },
        sandbox,
      });
      if (call >= maxCalls - 1) break;
      continue;
    }
    best = proposal;

    if (!res.trySandbox) {
      return { chosen: proposal, simulations: feedback, reason, sandboxUsed: used };
    }

    if (used < limit) {
      const sim = simulateSandboxProposal(proposal);
      used++;
      setAiSandboxUsedFor(used, G.current);
      replayRecordSandbox({
        call: call + 1, used, limit,
        shot: { angleDeg: Math.round(proposal.angle * 1800 / Math.PI) / 10, power: Math.round(proposal.power * 100) },
        result: sim,
      });
      feedback.push({
        call: call + 1,
        shot: {
          angleDeg: Math.round(proposal.angle * 1800 / Math.PI) / 10,
          power: Math.round(proposal.power * 100),
          candidate: proposal.type === 'model' ? null : (proposal.note || ''),
        },
        simulation: sim,
        sandbox: { used, limit, remaining: Math.max(0, limit - used) },
      });
      const hit = sim.first ? (sim.first.num || sim.first.type) : '未碰球';
      addLog(`大模型沙箱推演 ${used}/${limit}：首碰 ${hit}${sim.cuePotted ? ' · 白球落袋' : ''}`, true);
      continue;
    }

    if (!warned) {
      warned = true;
      feedback.push({
        call: call + 1,
        limitReached: true,
        message: `沙箱次数已到上限 ${limit}，不能再跑了。请直接给最终击球，try=false。`,
        sandbox: { used, limit, remaining: 0 },
      });
      replayRecordAi({ type: 'limit', call: call + 1, limit, used, message: `沙箱次数已到上限 ${limit}，不能再跑` });
      addLog(`大模型请求沙箱，但次数已到上限 ${limit}`, true);
      continue;
    }

    addLog('大模型仍请求沙箱，已达上限，直接采用当前杆', true);
    return { chosen: proposal, simulations: feedback, reason, sandboxUsed: used, limitHit: true };
  }
  if (!best) throw new Error('模型没有给出合法击球');
  return { chosen: best, simulations: feedback, reason, sandboxUsed: used, limitHit: warned };
}

async function aiTakeShot(token) {
  if (!G || token !== aiToken) return;
  G.aiThinking = true;
  G.aiPlan = null;
  updateHUD();
  try {
    const wasInHand = G.phase === 'ballInHand';
    if (wasInHand) { chooseAiCuePosition(); G.freeBallPlaced = true; }
    let cands = wasInHand ? buildBallInHandCandidates() : buildCandidates();
    if (!cands.length) cands = safetyCandidates(cueBall());
    if (!cands.length) {
      showToast('AI 没有找到合法球路，尝试解球', true);
      const t = legalTargets()[0];
      if (!t) { endGame(0, '对手无球可打'); return; }
      cands = [{
        type: 'safe', target: t, angle: Math.atan2(t.y - cueBall().y, t.x - cueBall().x),
        power: 0.5, score: 1, note: '解球',
      }];
    }

    let chosen = null;
    let reason = '';
    const profile = seatProfile(G.current);
    const useLocalFreeBall = wasInHand && S.freeBallLocal !== false;
    // 【为什么要有失败上限】原来的写法是 try/catch 一次：失败就整回合交给本地。
    // 问题是网络抖一下就白丢一个回合，而真正连不上时（域名没备案被拦、
    // 断网）又会反复重试到卡死。上游 1.4.23 改成分类计数：
    //   连接类失败（超时 / DNS / TLS / fetch 抛错）重试 3 次就停；
    //   返回类失败（模型答了但不合规范）给到 15 次。
    // 任一达标就本回合改用本地算法，并在日志里说清楚为什么，
    // 玩家不会看到 AI 莫名其妙地变笨。
    const canTryApi = profile && !useLocalFreeBall && apiConnCount(G.current) < 3 && apiRespCount(G.current) < 15;
    if (canTryApi) {
      const top = cands.slice(0, 8);
      let attempt = 0;
      while (apiConnCount(G.current) < 3 && apiRespCount(G.current) < 15 && attempt < 20) {
        attempt++;
        try {
          const out = await askModelWithSandbox(top, profile, seatThinkLevel(G.current), G.apiFailureLog[G.current] || []);
          chosen = out.chosen;
          reason = out.reason || '';
          if (chosen.type === 'model') {
            addLog(`大模型选择：角度 ${(chosen.angle * 180 / Math.PI).toFixed(1)}° · 力度 ${Math.round(chosen.power * 100)}%`, true);
          } else {
            addLog(`大模型选择：${chosen.note}${chosen.target ? ' · ' + targetName(chosen.target) : ''}`, true);
          }
          replayRecordFinal(chosen, 'api:' + (profile.name || profile.id), reason);
          break;
        } catch (e) {
          const errMsg = String(e && e.message || e).slice(0, 160);
          const state = recordApiFailure(e, G.current);
          replayRecordAi({
            type: 'api-failure', call: attempt, failureType: state.type,
            connection: state.connection, response: state.response, limit: state.limit, error: errMsg,
          });
          const label = state.type === 'connection'
            ? `连接失败 ${state.connection}/3`
            : `返回失败 ${state.response}/15`;
          addLog(`API ${label}：${errMsg}`, true);
          showToast(`API ${label}${state.limit ? '，本回合改用本地' : '，正在提醒 AI 重试'}`, true);
          if (state.limit) break;
          await sleep(450);
          if (token !== aiToken || !G) return;
        }
      }
      if (!chosen) {
        chosen = chooseLocalShot(cands);
        const why = `API 本回合连接失败 ${apiConnCount(G.current)}/3、返回失败 ${apiRespCount(G.current)}/15，本地接管`;
        replayRecordFinal(chosen, 'local-fallback', why);
        addLog(why, true);
      }
    } else {
      chosen = chooseLocalShot(cands);
      const limitHit = apiConnCount(G.current) >= 3 || apiRespCount(G.current) >= 15;
      const source = useLocalFreeBall ? 'local-freeball' : (limitHit ? 'local-fallback' : 'local');
      const why = useLocalFreeBall ? '自由球交由本地算法处理' : (limitHit ? `API 本回合连接失败 ${apiConnCount(G.current)}/3、返回失败 ${apiRespCount(G.current)}/15，改用本地` : '');
      replayRecordFinal(chosen, source, why);
      if (useLocalFreeBall) addLog('自由球：本地算法选位/选杆', true);
      else if (limitHit) addLog(why, true);
    }

    if (!chosen) { endGame(0, '对手认输'); return; }
    if (token !== aiToken || !G) return;
    applyCandidateCue(chosen);
    G.freeBallPlaced = false;
    G.aimAngle = chosen.angle;
    G.fineDelta = 0;
    G.power = clamp(chosen.power, 0.1, 1);
    G.aiPlan = { ...chosen, until: performance.now() + 1500 };
    if (reason) {
      const clean = reason.replace(/\s+/g, ' ').slice(0, 46);
      addLog(`AI 思路：${clean}`);
    }
    updatePowerUI();
    updateHUD();
    await sleep(720);
    if (token !== aiToken || !G || G.phase === 'over') return;
    if (G.phase !== 'aim' || G.ballInHand) return;
    G.aiThinking = false;
    G.aiRetry = 0;
    shoot(true);
  } catch (e) {
    replayRecordAi({ type: 'error', error: String(e && e.message || e) });
    console.error(e);
    if (G) {
      G.aiThinking = false;
      G.aiRetry = (G.aiRetry || 0) + 1;
      updateHUD();
      if (G.aiRetry <= 2) {
        showToast('AI 计算出错，正在重试', true);
        clearTimeout(aiTimer);
        aiTimer = setTimeout(() => maybeAi(), 700);
      } else {
        showToast('AI 连续出错，交还击球权', true);
        G.current = 0;
        G.phase = 'aim';
        G.aiRetry = 0;
        updateHUD();
      }
    }
  }
}

function targetName(b) {
  if (!b) return '';
  if (G.mode === 'snooker') {
    if (b.type === 'red') return '红球';
    return cnColor(b.colorName);
  }
  return b.num === 8 ? '黑八' : b.num + ' 号';
}

/* ---------------- API ---------------- */
const pendingHttp = new Map();
let httpSeq = 0;

function b64ToText(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

window.__nativeHttpResult = function (id, status, b64) {
  const p = pendingHttp.get(id);
  if (!p) return;
  pendingHttp.delete(id);
  clearTimeout(p.timer);
  let text = '';
  try { text = b64ToText(b64); } catch (e) { text = ''; }
  p.resolve({ status, text });
};

/* ============================================================
 * 备案域名闸门 —— 所有出网请求的唯一入口
 *
 * 【为什么要有它】小程序要求接入的域名必须完成 ICP 备案。
 *   用户可以在设置页手填 baseUrl，如果填了一个没备案的域名，
 *   请求会在宿主 WebView 里被直接拦掉，返回一个含糊的网络错误，
 *   用户完全不知道发生了什么，只会觉得「这功能坏了」。
 *
 *   所以在发请求之前先自己判断一次，给出明确的中文提示，
 *   而不是把一个看不懂的网络异常抛到界面上。
 *
 * 【为什么用白名单而不是黑名单】备案是「允许什么」的问题，
 *   黑名单永远列不全。这里只放行确认已备案的域名，
 *   其余一律拒绝，漏掉的风险比误放行小得多。
 * ============================================================ */
const FILED_DOMAINS = [
  'api.deepseek.com',
  'open.bigmodel.cn',
  'dashscope.aliyuncs.com',
  'ark.cn-beijing.volces.com',
  'api.moonshot.cn',
  'api.stepfun.com',
  'api.xiaomimimo.com',
];

/** 判断一个 URL 的域名是否在已备案白名单里 */
function isFiledUrl(url) {
  let host = '';
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch (e) { return false; }
  return FILED_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
}

/**
 * 发请求前的统一检查。
 *
 * 【为什么返回布尔值而不是直接 throw】调用方有的在 try 里、有的不在，
 *   直接 throw 会变成未捕获异常，把整个 AI 回合卡死。
 *   返回 false 让调用方自己决定怎么收场（通常是提示 + 退回本地算法）。
 */
function guardFiledUrl(url) {
  if (isFiledUrl(url)) return true;
  // 【为什么用这个措辞】用户要求原话。
  //   它同时解释了「为什么不行」（不兼容无备案域名）和「你能做什么」（无法操作）。
  showToast('小黑盒小程序不兼容无备案的域名，无法操作', true);
  return false;
}

async function httpPost(url, headers, body) {
  // 【为什么要在这里拦】httpPost / httpGet 是所有出网请求的唯一出口，
  //   在这里拦一次，AI 对话、拉模型列表、连通性测试全都覆盖到了。
  //   放在各个调用点各拦一遍，迟早漏掉一处。
  if (!guardFiledUrl(url)) return Promise.reject(new Error('域名未备案'));
  const headerText = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  if (window.Android && typeof window.Android.httpPost === 'function') {
    const id = 'h' + (++httpSeq) + '_' + Math.random().toString(36).slice(2, 7);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingHttp.delete(id);
        reject(new Error('请求超时（30 秒）'));
      }, 30000);
      pendingHttp.set(id, { resolve, reject, timer });
      try {
        window.Android.httpPost(id, url, headerText, body);
      } catch (e) {
        clearTimeout(timer);
        pendingHttp.delete(id);
        reject(e);
      }
    });
  }
  // Browser fallback: most providers block CORS, but some allow it.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e) {
    throw new Error('浏览器直连失败（可能是 CORS）。请使用 APK 版本。');
  } finally {
    clearTimeout(timer);
  }
}

function apiConfig(profile = null) {
  const src = profile || apiOverride || S;
  const p = PROVIDERS[src.provider] || PROVIDERS.deepseek;
  let base = (src.baseUrl || p.base || '').trim().replace(/\/+$/, '');
  return {
    provider: src.provider || 'deepseek',
    providerName: p.name,
    protocol: src.protocol || p.protocol,
    base,
    model: (src.model || '').trim(),
    key: (src.apiKey || '').trim(),
  };
}

function endpointFor(cfg) {
  let base = cfg.base;
  if (!base) throw new Error('请填写 Base URL');
  if (cfg.protocol === 'anthropic') {
    if (/\/messages$/.test(base)) return base;
    if (/^https:\/\/api\.anthropic\.com\/?$/.test(base)) return base.replace(/\/$/, '') + '/v1/messages';
    return base + '/messages';
  }
  if (/\/chat\/completions$/.test(base)) return base;
  return base + '/chat/completions';
}

async function httpGet(url, headers = {}) {
  // 【为什么要在这里拦】httpPost / httpGet 是所有出网请求的唯一出口，
  //   在这里拦一次，AI 对话、拉模型列表、连通性测试全都覆盖到了。
  //   放在各个调用点各拦一遍，迟早漏掉一处。
  if (!guardFiledUrl(url)) return Promise.reject(new Error('域名未备案'));
  const headerText = Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  if (window.Android && typeof window.Android.httpGet === 'function') {
    const id = 'g' + (++httpSeq) + '_' + Math.random().toString(36).slice(2, 7);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingHttp.delete(id);
        reject(new Error('请求超时（30 秒）'));
      }, 30000);
      pendingHttp.set(id, { resolve, reject, timer });
      try {
        window.Android.httpGet(id, url, headerText);
      } catch (e) {
        clearTimeout(timer);
        pendingHttp.delete(id);
        reject(e);
      }
    });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    throw new Error('浏览器直连失败（可能是 CORS）。请使用 APK 版本。');
  } finally { clearTimeout(timer); }
}

function extractReasoning(data, protocol) {
  if (!data || typeof data !== 'object') return '';
  const out = [];
  const push = (v) => {
    if (!v) return;
    const s = typeof v === 'string' ? v : (v.text || v.thinking || v.summary || v.content || '');
    if (s) out.push(String(s));
  };
  if (protocol === 'anthropic') {
    for (const b of (data.content || [])) {
      if (b.type === 'thinking') push(b.thinking || b.text);
      else if (b.type === 'redacted_thinking') out.push('[redacted thinking]');
    }
  }
  const msg = data.choices?.[0]?.message || {};
  push(msg.reasoning_content); push(msg.reasoning); push(msg.analysis);
  if (Array.isArray(msg.reasoning_details)) msg.reasoning_details.forEach(push);
  if (Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (c && (c.type === 'thinking' || c.type === 'reasoning' || c.type === 'summary')) push(c);
    }
  }
  for (const cand of (data.candidates || [])) {
    for (const part of (cand.content?.parts || [])) {
      if (part && (part.thought || part.type === 'thinking')) push(part);
    }
  }
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item && (item.type === 'reasoning' || item.type === 'thinking')) {
        if (Array.isArray(item.summary)) item.summary.forEach(push);
        push(item);
      }
    }
  }
  return cleanModelText(out.join('\n\n')).trim().slice(0, 20000);
}

function recordApiCall(meta, cfg, bodyObj, attempt, started, res, data, text, error) {
  if (!meta || !RECORDER || RECORDER.finalized) return;
  if (!Array.isArray(RECORDER.apiCalls)) RECORDER.apiCalls = [];
  let responseText = '';
  try { responseText = String(res && res.text || '').slice(0, 80000); } catch (e) {}
  let request = null;
  try { request = JSON.parse(JSON.stringify(bodyObj)); } catch (e) { request = { error: 'body not serializable' }; }
  const reasoning = data ? extractReasoning(data, cfg.protocol) : '';
  const call = {
    id: 'api' + (RECORDER.apiCalls.length + 1) + '-' + Date.now().toString(36),
    at: new Date().toISOString(),
    player: meta.player,
    seat: meta.seat,
    shotIndex: meta.shotIndex,
    round: meta.round,
    call: meta.call,
    attempt,
    provider: cfg.provider,
    profile: meta.profileName || null,
    model: cfg.model,
    protocol: cfg.protocol,
    thinkLevel: meta.thinkLevel || null,
    sandbox: !!meta.sandbox,
    sandboxOrdinal: meta.sandboxOrdinal === null || meta.sandboxOrdinal === undefined ? null : meta.sandboxOrdinal,
    durationMs: Date.now() - started,
    status: res ? res.status : -1,
    request,
    responseText,
    reasoning: cleanModelText(reasoning),
    output: cleanModelText(text).slice(0, 8000),
    usage: data && data.usage ? data.usage : null,
    error: error ? String(error).slice(0, 2000) : '',
  };
  RECORDER.apiCalls.push(call);
}

async function callLLM(messages, maxTokens = 500, profile = null, thinkLevel = null, traceMeta = null) {
  const cfg = apiConfig(profile);
  if (!cfg.key) throw new Error('请先在设置中填写 API Key');
  if (!cfg.model) throw new Error('请填写模型名称');
  const url = endpointFor(cfg);
  let headers, bodyObj, body;
  if (cfg.protocol === 'anthropic') {
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': cfg.key,
      'anthropic-version': '2023-06-01',
    };
    bodyObj = {
      model: cfg.model,
      max_tokens: maxTokens,
      temperature: 0.2,
      system: messages[0].content,
      messages: messages.slice(1),
    };
    if (thinkLevel) {
      if (thinkLevel === 'none') {
        bodyObj.thinking = { type: 'disabled' };
      } else {
        bodyObj.thinking = { type: 'adaptive' };
        bodyObj.output_config = { effort: thinkLevel };
        bodyObj.max_tokens = Math.max(maxTokens, 4096);
        delete bodyObj.temperature;
      }
    }
    body = JSON.stringify(bodyObj);
  } else {
    headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + cfg.key,
    };
    const b = {
      model: cfg.model,
      messages,
      stream: false,
    };
    const m = cfg.model.toLowerCase();
    if (/^(o1|o3|o4|gpt-5)/.test(m)) {
      b.max_completion_tokens = maxTokens;
    } else {
      b.max_tokens = maxTokens;
      // DeepSeek reasoner / R1 reject temperature on some endpoints.
      if (!/reasoner|deepseek-r1|qwq/.test(m)) b.temperature = 0.2;
    }
    if (cfg.provider === 'deepseek' && thinkLevel === 'none') {
      b.thinking = { type: 'disabled' };
    } else {
      const effort = reasoningEffortFor(cfg, thinkLevel);
      if (effort) b.reasoning_effort = effort;
    }
    bodyObj = b;
    body = JSON.stringify(b);
  }
  let attempt = 1;
  let started = Date.now();
  let res;
  try {
    res = await httpPost(url, headers, body);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    recordApiCall(traceMeta, cfg, bodyObj, attempt, started, null, null, '', msg);
    // 【为什么要包一层】fetch 直接抛错说明连都没连上（DNS / TLS / 断网 /
    // 域名被拦）。这种错误和「模型答得不合规范」性质完全不同：前者重试
    // 再多也没用，后者值得再给机会。打个标记让上层分类计数。
    throw apiFailureError(msg, 'connection');
  }
  if ((res.status === 400 || res.status === 422) && (bodyObj.reasoning_effort || bodyObj.thinking || bodyObj.output_config)) {
    // Some OpenAI-compatible endpoints reject reasoning fields; keep the shot usable.
    recordApiCall(traceMeta, cfg, bodyObj, attempt, started, res, null, '', 'HTTP ' + res.status + '：思考参数被拒绝，已重试');
    delete bodyObj.reasoning_effort;
    delete bodyObj.thinking;
    delete bodyObj.output_config;
    if (cfg.protocol === 'anthropic') {
      bodyObj.max_tokens = maxTokens;
      bodyObj.temperature = 0.2;
    }
    body = JSON.stringify(bodyObj);
    attempt = 2;
    started = Date.now();
    try {
      res = await httpPost(url, headers, body);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      recordApiCall(traceMeta, cfg, bodyObj, attempt, started, null, null, '', msg);
      // 同上：连不上和答错要分开计数，这里的重试机会本来就只有一次。
      throw apiFailureError(msg, 'connection');
    }
  }
  if (res.status < 200 || res.status >= 300) {
    let msg = res.text || '';
    try {
      const j = JSON.parse(res.text);
      msg = j.error?.message || j.message || msg;
    } catch (e) { /* ignore */ }
    const err = `HTTP ${res.status}：${String(msg).slice(0, 160)}`;
    recordApiCall(traceMeta, cfg, bodyObj, attempt, started, res, null, '', err);
    throw new Error(err);
  }
  let data;
  try { data = JSON.parse(res.text.replace(/^\uFEFF/, '')); }
  catch (e) {
    recordApiCall(traceMeta, cfg, bodyObj, attempt, started, res, null, '', '模型返回的不是 JSON');
    throw new Error('模型返回的不是 JSON');
  }
  let text = '';
  if (cfg.protocol === 'anthropic') {
    text = (data.content || []).map((c) => c.text || '').join('');
  } else {
    const msg = data.choices?.[0]?.message || {};
    if (typeof msg.content === 'string') text = msg.content;
    else if (Array.isArray(msg.content)) text = msg.content.map((c) => c.text || '').join('');
    if (!text && msg.reasoning_content) text = msg.reasoning_content;
    if (!text && data.choices?.[0]?.text) text = data.choices[0].text;
  }
  if (!text) {
    recordApiCall(traceMeta, cfg, bodyObj, attempt, started, res, data, '', '模型没有返回内容');
    throw new Error('模型没有返回内容');
  }
  recordApiCall(traceMeta, cfg, bodyObj, attempt, started, res, data, text, '');
  return text;
}

function cleanModelText(text) {
  return String(text == null ? '' : text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, '');
}

function escapeJsonControls(text) {
  let out = '';
  let inStr = false, esc = false;
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0);
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && ch === '\n') { out += '\\n'; continue; }
    if (inStr && ch === '\r') { out += '\\r'; continue; }
    if (inStr && ch === '\t') { out += '\\t'; continue; }
    if (inStr && code < 0x20) { out += '\\u' + code.toString(16).padStart(4, '0'); continue; }
    out += ch;
  }
  return out;
}

function parseModelChoice(text) {
  let t = cleanModelText(text).replace(/```[a-zA-Z]*/g, '').replace(/```/g, '').trim();
  const normalize = (obj) => {
    const id = obj.id || obj.shotId || obj.candidate || obj.choice;
    let angle = Number(obj.angle ?? obj.angleDeg ?? obj.angle_deg);
    if (!Number.isFinite(angle) && Number.isFinite(Number(obj.angleRad ?? obj.angle_rad))) {
      angle = Number(obj.angleRad ?? obj.angle_rad) * 180 / Math.PI;
    }
    let power = Number(obj.power ?? obj.strength);
    if (!Number.isFinite(power) && Number.isFinite(Number(obj.powerPct ?? obj.strengthPct))) {
      power = Number(obj.powerPct ?? obj.strengthPct) / 100;
    }
    const reason = String(obj.reason || obj.why || obj.note || '').slice(0, 120);
    const hasAngle = Number.isFinite(angle);
    if (!id && !hasAngle) throw new Error('模型返回的内容里没有 angle/id');
    const tryRaw = obj.try ?? obj.sandbox ?? obj.simulate;
    const trySandbox = tryRaw === true || tryRaw === 1 || String(tryRaw).toLowerCase() === 'true' || String(tryRaw) === '1';
    return { id: id ? String(id).trim() : null, angle: hasAngle ? angle : null, power: Number.isFinite(power) ? power : null, trySandbox, reason };
  };

  const tryObject = (str) => {
    const cleaned = cleanModelText(str);
    try { return JSON.parse(cleaned); } catch (e) { /* retry repair */ }
    try { return JSON.parse(cleaned.replace(/,\s*([}\]])/g, '$1')); } catch (e) { /* retry control chars */ }
    try { return JSON.parse(escapeJsonControls(cleaned.replace(/,\s*([}\]])/g, '$1'))); } catch (e) { return null; }
  };

  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const obj = tryObject(t.slice(start, end + 1));
    if (obj) return normalize(obj);
  }

  // Some models answer "angle: 30, power: 0.6" without braces.
  const angleM = t.match(/angle(?:Deg|_deg)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  const powerM = t.match(/(?:power|strength)(?:Pct)?\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  const idM = t.match(/(?:id|shotId|candidate|choice)\s*[:=]\s*["']?([A-Za-z0-9_-]+)/i);
  const tryM = t.match(/try\s*[:=]\s*(true|false|1|0)/i);
  if (angleM || idM) {
    return normalize({
      angle: angleM ? Number(angleM[1]) : undefined,
      power: powerM ? Number(powerM[1]) : undefined,
      id: idM ? idM[1] : undefined,
      try: tryM ? tryM[1] : undefined,
      reason: '',
    });
  }
  throw new Error(`模型没有返回 JSON（开头：${t.slice(0, 36).replace(/\s+/g, ' ')}）`);
}

const SYSTEM_PROMPT = `你是职业台球选手，正在手机台球游戏中替 AI 方选杆。
本地引擎已经枚举了合法候选，你可以从候选里选一杆，也可以直接给出自己的角度和力度。
考虑：进球概率、切球角度、距离、走位、白球落袋风险、下一杆是否好打。
只输出一个 JSON 对象，不要 Markdown，不要解释，不要输出思考过程。整个回复第一个字符必须是 {，最后一个字符必须是 }。两种格式任选：
{"id":"A1","power":0.55,"reason":"不超过20字"}
{"angle":32.5,"power":0.62,"try":true,"reason":"不超过20字"}
angle 是击球角度（单位：度），0=向右，90=向下，-90=向上，范围 -180~180。
try 是布尔值：try=false 直接执行；try=true 请求引擎在沙箱里推演这一杆，消耗一次沙箱次数。
沙箱次数用完后，引擎会返回 limitReached 提示；此时必须给最终杆 try=false。
power 是力度，范围 0.18~1；也可以返回 powerPct（18~100）。
如果返回 angle，必须保证第一颗碰到的是规则允许的目标球；引擎会校验。
你会收到本杆全部沙箱推演历史（sandboxHistory），每条包含第一碰、进球、白球落袋、犯规、下一回合、分数和球位；必须综合全部历史修正下一杆，而不是只看最近一次。
如果候选里有开球或解球，按它的建议力度执行。
自由球（freeBall=true）时，候选里的 cueX/cueY 是该杆对应的白球位置；返回候选 id 时引擎会把白球放到该位置。优先返回 id，不要返回坐标，也不要要求再次移动白球；如果直接给 angle，则按当前 cue 位置执行。`;

function aiThinkRounds() {
  if (!G) return 0;
  if (G.aiThinkLimit !== null && Number.isFinite(G.aiThinkLimit)) {
    return clamp(Math.floor(G.aiThinkLimit), 0, 10);
  }
  // 【1.4.25】沙箱总开关：关掉就一次都不推演，省 token。
  // 放在 aiThinkLimit 之后：单局强制值优先于全局设置。
  if (S.sandboxEnabled === false) return 0;
  if (S.sandboxLimit !== null && S.sandboxLimit !== undefined && Number.isFinite(Number(S.sandboxLimit))) {
    return clamp(Math.floor(Number(S.sandboxLimit)), 0, 10);
  }
  const lvl = seatDifficulty(G.current);
  return lvl === 'master' ? 5 : lvl === 'normal' ? 1 : 0;
}

function reasoningEffortFor(cfg, level) {
  if (!level) return null;
  const provider = cfg.provider || 'deepseek';
  if (provider === 'deepseek') return ['none', 'low', 'high', 'max'].includes(level) ? level : null;
  if (provider === 'openai') return level;
  if (provider === 'gemini') return level === 'none' ? 'minimal' : level === 'max' ? 'high' : level;
  return level === 'max' ? 'high' : level;
}

function resolveModelProposal(res, cands) {
  if (!G || !res) return null;
  if (res.angle !== null && Number.isFinite(res.angle)) {
    const c = modelAngleCandidate(res);
    if (c) return c;
  }
  if (res.id) {
    const cand = cands.find((x) => x.id === res.id);
    if (!cand) return null;
    const shot = { ...cand };
    let power = Number.isFinite(res.power) ? res.power : shot.power;
    if (power > 1) power /= 100;
    shot.power = clamp(power, 0.18, 1);
    return shot;
  }
  return null;
}

function shortBallType(type) {
  return ({ solid: 'S', stripe: 'T', eight: 'E', cue: 'Q', red: 'R', color: 'C' })[type] || '?';
}

function compactFeedback(entry) {
  if (!entry) return null;
  // 【1.4.24 为什么把 sandbox 带进每一条反馈】模型只能看到最后一次结果时，
  // 容易反复踩同一个坑（比如一直用同一个角度撞库边）。把每一次的沙箱快照
  // 都留下来，模型才有机会看出「试过的都失败」，而不是重新试一遍。
  if (entry.limitReached) return { limitReached: true, message: entry.message, sandbox: entry.sandbox || null };
  if (entry.error) return { error: entry.error, mustJson: !!entry.mustJson, sandbox: entry.sandbox || null };
  const sim = entry.simulation;
  if (!sim) return null;
  return {
    shot: sim.shot ? [sim.shot.angleDeg, sim.shot.power] : undefined,
    first: sim.first ? [sim.first.num, shortBallType(sim.first.type)] : null,
    potted: (sim.potted || []).map((b) => b.num),
    cuePotted: !!sim.cuePotted,
    foul: !!sim.foul,
    foulReason: sim.foulReason || '',
    winner: sim.winner,
    next: sim.nextPlayer,
    inHand: !!sim.ballInHand,
    scores: sim.scores,
    balls: (sim.balls || []).filter((b) => b.active && b.id !== 0).map((b) => [b.id, b.num, b.x, b.y]),
    log: (sim.log || []).slice(-3),
    sandbox: entry.sandbox || null,
  };
}

function stateForModel(cands, feedback = [], sandbox = null) {
  const p = G.players[G.current];
  const last = feedback.length ? feedback[feedback.length - 1] : null;
  const active = G.balls.filter((b) => b.active);
  return {
    game: modeName(),
    ballFmt: '[id,num,type,x,y]',
    playerFmt: '[name,score,group,ai,level]',
    candFmt: '[id,target,pocket,cutDeg,powerPct,cueX,cueY]',
    you: p.name,
    target: ballOnLabel(),
    score: (G.mode === 'snooker' || G.mode === 'rotation') ? [G.players[0].score, G.players[1].score] : undefined,
    group: G.mode === '8ball' ? shortGroup(p.group) : undefined,
    redsLeft: G.mode === 'snooker' ? activeReds() : undefined,
    table: [TABLE.x, TABLE.y, TABLE.w, TABLE.h],
    cue: cueBall() ? [Math.round(cueBall().x), Math.round(cueBall().y)] : null,
    balls: active.map((b) => [b.id, b.num, shortBallType(b.type), Math.round(b.x), Math.round(b.y)]),
    potted: G.balls.filter((b) => !b.active && b.id !== 0).map((b) => b.num),
    players: G.players.map((pl, i) => [pl.name, pl.score, pl.group || '-', isAI(i) ? 1 : 0, G.aiLevel ? G.aiLevel[i] : G.difficulty]),
    pockets: POCKETS.map((pk) => [pk.name, pk.x, pk.y]),
    current: G.current,
    phase: G.phase,
    break: !!G.breakShot,
    open: !!G.openTable,
    inHand: !!G.ballInHand,
    freeBallPlaced: !!G.freeBallPlaced,
    freeBall: (G.freeBallPlaced || G.ballInHand) ? {
      active: true, cuePlaced: !!G.freeBallPlaced,
      cue: cueBall() ? [Math.round(cueBall().x), Math.round(cueBall().y)] : null,
      note: '自由球：候选的 cueX/cueY 是该杆对应的白球位置；返回候选 id 时引擎会把白球放到该位置。不要返回坐标，也不要要求再次摆球。',
      placements: [...new Set(cands.filter((c) => c.cue).map((c) => `${Math.round(c.cue.x)},${Math.round(c.cue.y)}`))].slice(0, 8),
    } : undefined,
    R: G.R,
    physics: { friction: PHYS.friction, cushion: PHYS.cushion, ballE: PHYS.ballE, capture: PHYS.capture, contain: PHYS.contain },
    dev: {
      thinkLimit: G.aiThinkLimit,
      sandboxMax: aiThinkRounds(),
      sandboxUsed: aiSandboxUsedFor(G.current),
      sandboxLeft: Math.max(0, aiThinkRounds() - aiSandboxUsedFor(G.current)),
      shellAI: G.shellAI,
      levels: G.aiLevel,
      developerMode: devEnabled(),
      rootUnlocked: rootActive(),
    },
    snooker: G.snooker ? [G.snooker.ballOn, G.snooker.redsLeft, G.snooker.colorsPhase, G.snooker.breakScore] : undefined,
    legal: legalTargets().map((t) => t.num),
    candidates: cands.slice(0, 6).map((c) => [
      c.id,
      c.target ? (c.target.num || c.target.type) : 'break',
      c.pocket ? c.pocket.name : '-',
      Math.round(c.cutDeg || 0),
      Math.round((c.power || 0.5) * 100),
      c.cue ? Math.round(c.cue.x) : null,
      c.cue ? Math.round(c.cue.y) : null,
    ]),
    sandbox,
    // 【1.4.24】把本杆到目前为止的所有沙箱推演按时间顺序全给模型。
    // 只给 lastFeedback 时，模型看不见「前两次同样的打法都失败了」，
    // 会反复重试同一个方向。给全部历史，它才有机会换思路。
    sandboxHistory: feedback.map(compactFeedback).filter(Boolean),
    lastFeedback: compactFeedback(last),
  };
}

async function askModel(cands, simulations = [], round = 0, limit = 0, sandbox = null, profile = null, thinkLevel = null, sandboxOrdinal = null) {
  const state = stateForModel(cands, simulations, sandbox);
  let user = `当前局面：\n${JSON.stringify(state)}\n\n`;
  if (simulations.length) {
    user += `本杆已有 ${simulations.length} 次反馈，全部按时间顺序放在 sandboxHistory（沙箱结果、错误或 limitReached）；必须综合全部历史修正，不能只看最近一次。lastFeedback 只是最后一条的快捷引用。\n`;
  }
  const lastFb = simulations.length ? simulations[simulations.length - 1] : null;
  if (lastFb && lastFb.mustJson) user += '上一次回复不是合法 JSON。这次必须只输出一个 JSON 对象，第一个字符必须是 {，最后一个字符是 }，不要解释。\n';
  user += `这是第 ${round + 1} 次判断。沙箱已用 ${sandbox ? sandbox.used : 0}/${limit}，剩余 ${sandbox ? sandbox.remaining : limit} 次。\n`;
  if (G.freeBallPlaced || G.ballInHand) user += '这是自由球：白球位置由候选 cueX/cueY 给出；请优先返回候选 id，不要返回坐标，也不要要求再次移动白球。\n';
  user += `请返回 {"angle":角度,"power":力度,"try":true|false} 或 {"id":"候选号","power":力度,"try":true|false}。try=false 直接执行，try=true 请求沙箱推演。只输出 JSON。`;
  const traceMeta = {
    player: G ? G.current : null,
    seat: G ? seatDisplayName(G.current) : null,
    shotIndex: RECORDER && !RECORDER.finalized ? RECORDER.shots.length : null,
    round,
    call: round + 1,
    thinkLevel,
    sandboxOrdinal,
    profileName: profile ? (profile.name || profile.id) : (activeAiProfile() ? activeAiProfile().name : null),
    sandbox: !!sandbox,
  };
  const raw = await callLLM([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ], 1200, profile, thinkLevel, traceMeta);
  try { return parseModelChoice(raw); }
  catch (e) { e.rawText = raw; throw e; }
}

async function testApiConnection() {
  const status = $('#apiStatus');
  status.className = '';
  status.textContent = '连接中…';
  try {
    const text = await callLLM([
      { role: 'system', content: '你是 API 连通性测试助手。' },
      { role: 'user', content: '只回复 OK 两个字母。' },
    ], 120);
    status.className = 'ok';
    status.textContent = '连接成功 · ' + text.replace(/\s+/g, ' ').slice(0, 30);
  } catch (e) {
    status.className = 'bad';
    status.textContent = e.message.slice(0, 90);
  }
}

/* ============================================================
   渲染
   ============================================================ */
function roundRectPath(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function mixHex(a, b, t) {
  const pa = a.replace('#', ''), pb = b.replace('#', '');
  const ar = parseInt(pa.slice(0, 2), 16), ag = parseInt(pa.slice(2, 4), 16), ab = parseInt(pa.slice(4, 6), 16);
  const br = parseInt(pb.slice(0, 2), 16), bg = parseInt(pb.slice(2, 4), 16), bb = parseInt(pb.slice(4, 6), 16);
  const to = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return '#' + to(lerp(ar, br, t)) + to(lerp(ag, bg, t)) + to(lerp(ab, bb, t));
}

/* ============================================================
 * 横屏 —— 球桌世界是 1000×550 的横版，小程序只有竖屏
 *
 * 【为什么必须转】球桌宽高比 16:9，竖屏里塞不下。
 *   不转的话要么把球桌压扁（球变成椭圆、碰撞点全错），
 *   要么只用到屏幕中间一条，两侧大片留黑。
 *
 * 【怎么做】把 #poolApp 整体旋转 90°，再用 translate 拉回原位。
 *   旋转后它的「宽」对应屏幕的「高」，所以 width 取 innerHeight、
 *   height 取 innerWidth —— 这两个值互换是整件事的核心。
 *
 * 【为什么写 inline style 而不是 CSS 类】.pool-root .app 已经设了
 *   display:flex，CSS 类里的 transform 会被布局计算干扰；
 *   而且这里要读实时视口尺寸，只有 JS 能算。
 * ============================================================ */
function layoutLandscape() {
  const app = document.getElementById('poolApp');
  if (!app) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  app.style.position = 'absolute';
  app.style.left = '50%';
  app.style.top = '50%';
  // 【关键】宽高互换：旋转 90° 后，元素的 width 变成屏幕的竖向长度。
  app.style.width = vh + 'px';
  app.style.height = vw + 'px';
  app.style.transform = 'translate(-50%, -50%) rotate(90deg)';
  app.style.transformOrigin = 'center center';
  app.style.overflow = 'hidden';
}

/**
 * 屏幕坐标 → 应用坐标。
 *
 * 【推导】设屏幕点 (sx, sy)，应用点 (ax, ay)，屏幕尺寸 W×H。
 *   顺时针转 90° 后，应用的 +x 轴指向屏幕的 +y 方向，
 *   应用的 +y 轴指向屏幕的 -x 方向。反解得：
 *     ax = sy
 *     ay = W - sx
 *   所以拿到 clientX/clientY 后要交换再取反，不能直接用。
 *
 * 【漏掉会怎样】不转义的表现是「点左边打到下边」——
 *   整个交互偏了 90°，但界面看起来完全正常，极难自查。
 */
function toAppPoint(clientX, clientY) {
  return { x: clientY, y: window.innerWidth - clientX };
}

function resizeCanvas() {
  // 【为什么用 clientWidth 而不是 getBoundingClientRect】旋转 90° 后，
  //   getBoundingClientRect() 返回的是「旋转后的外接矩形」，宽高互换。
  //   直接拿它算会得到 390×654 而不是 654×390，球桌被算小一半，
  //   表现为球桌缩在角落、点击位置全偏。clientWidth 不受 transform 影响。
  layoutLandscape();
  const w = Math.max(1, canvas.parentElement.clientWidth);
  const h = Math.max(1, canvas.parentElement.clientHeight);
  dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
    bgCache = null;
    vignetteCache = null;
  }
  const top = 42, bottom = 12;
  const availH = Math.max(40, h - top - bottom);
  const dockW = 54;
  const thinkPad = REPLAY_ACTIVE ? (REPLAY_THINK_RESERVE || 0) : 0;
  const availW = Math.max(120, w - dockW - 24 - thinkPad);
  const scale = Math.min(availW / WORLD.w, availH / WORLD.h);
  view = {
    scale: Math.max(0.2, scale),
    ox: thinkPad + (availW - WORLD.w * scale) / 2 + 6,
    oy: top + (availH - WORLD.h * scale) / 2,
    dpr, w, h,
  };
}

function drawBackground() {
  const { w, h } = view;
  const g = ctx.createRadialGradient(w * 0.4, h * 0.42, 10, w * 0.4, h * 0.42, Math.max(w, h) * 0.8);
  g.addColorStop(0, '#0d2018');
  g.addColorStop(0.55, '#07130e');
  g.addColorStop(1, '#030806');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // subtle light cones
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lg = ctx.createLinearGradient(0, 0, 0, h);
  lg.addColorStop(0, 'rgba(82,150,117,.08)');
  lg.addColorStop(0.5, 'rgba(82,150,117,0)');
  ctx.fillStyle = lg;
  ctx.beginPath();
  ctx.moveTo(w * 0.2, 0); ctx.lineTo(w * 0.72, 0); ctx.lineTo(w * 0.58, h); ctx.lineTo(w * 0.08, h);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function feltTexture() {
  if (noisePattern) return noisePattern;
  const n = document.createElement('canvas');
  n.width = n.height = 96;
  const nc = n.getContext('2d');
  const img = nc.createImageData(96, 96);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v;
    img.data[i + 3] = 18;
  }
  nc.putImageData(img, 0, 0);
  noisePattern = ctx.createPattern(n, 'repeat');
  return noisePattern;
}

function drawTable() {
  const outer = { x: 16, y: 16, w: 968, h: 518 };
  ctx.save();
  // shadow
  ctx.shadowColor = 'rgba(0,0,0,.7)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 12;
  roundRectPath(ctx, outer.x, outer.y, outer.w, outer.h, 28);
  ctx.fillStyle = '#160e09';
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // wood rail
  const wg = ctx.createLinearGradient(outer.x, outer.y, outer.x + outer.w, outer.y + outer.h);
  wg.addColorStop(0, '#6b432b');
  wg.addColorStop(0.2, '#4a2c1b');
  wg.addColorStop(0.5, '#382013');
  wg.addColorStop(0.8, '#4f2f1d');
  wg.addColorStop(1, '#2a170d');
  roundRectPath(ctx, outer.x, outer.y, outer.w, outer.h, 28);
  ctx.fillStyle = wg;
  ctx.fill();

  // wood grain
  ctx.save();
  roundRectPath(ctx, outer.x, outer.y, outer.w, outer.h, 28);
  ctx.clip();
  ctx.globalAlpha = 0.09;
  ctx.strokeStyle = '#f2d8a8';
  for (let i = 0; i < 16; i++) {
    const y = outer.y + 8 + i * 32;
    ctx.lineWidth = 0.8 + (i % 3) * 0.4;
    ctx.beginPath();
    ctx.moveTo(outer.x + 4, y);
    ctx.bezierCurveTo(outer.x + 260, y + (i % 2 ? 7 : -5), outer.x + 650, y + (i % 3 ? -4 : 6), outer.x + outer.w - 4, y + 2);
    ctx.stroke();
  }
  ctx.restore();

  // gold inlay
  roundRectPath(ctx, outer.x + 7, outer.y + 7, outer.w - 14, outer.h - 14, 23);
  ctx.strokeStyle = 'rgba(227,193,115,.32)';
  ctx.lineWidth = 2;
  ctx.stroke();
  roundRectPath(ctx, outer.x + 13, outer.y + 13, outer.w - 26, outer.h - 26, 20);
  ctx.strokeStyle = 'rgba(0,0,0,.45)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // felt base
  roundRectPath(ctx, 30, 30, 940, 490, 18);
  const fg = ctx.createRadialGradient(470, 250, 30, 500, 275, 560);
  fg.addColorStop(0, '#116b4f');
  fg.addColorStop(0.55, '#0c5a42');
  fg.addColorStop(1, '#063a2a');
  ctx.fillStyle = fg;
  ctx.fill();

  // texture
  ctx.save();
  roundRectPath(ctx, 30, 30, 940, 490, 18);
  ctx.clip();
  const pat = feltTexture();
  if (pat) { ctx.globalAlpha = 0.5; ctx.fillStyle = pat; ctx.fillRect(30, 30, 940, 490); }
  ctx.restore();

  // cushions
  const cush = '#0a4a36';
  const cushTop = '#0f5a41';
  ctx.save();
  ctx.fillStyle = cush;
  // top/bottom
  ctx.fillRect(34, 34, 932, 17);
  ctx.fillRect(34, 499, 932, 17);
  // left/right
  ctx.fillRect(34, 34, 17, 482);
  ctx.fillRect(949, 34, 17, 482);
  // bevel noses
  ctx.strokeStyle = 'rgba(77,196,151,.28)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(55, 51); ctx.lineTo(945, 51); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(55, 499); ctx.lineTo(945, 499); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(51, 55); ctx.lineTo(51, 495); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(949, 55); ctx.lineTo(949, 495); ctx.stroke();
  // inner shadow on cushion
  const sg = ctx.createLinearGradient(0, 34, 0, 55);
  sg.addColorStop(0, 'rgba(0,0,0,.35)');
  sg.addColorStop(0.7, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(34, 34, 932, 21);
  ctx.restore();

  // rail sights
  drawSights();

  // markings
  ctx.save();
  ctx.strokeStyle = 'rgba(220,240,225,.14)';
  ctx.lineWidth = 1.2;
  if (G && G.mode === 'snooker') {
    const bx = TABLE.x + TABLE.w * 0.206;
    ctx.beginPath(); ctx.moveTo(bx, TABLE.y); ctx.lineTo(bx, TABLE.y + TABLE.h); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, TABLE.y + TABLE.h / 2, 74, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
    ctx.fillStyle = 'rgba(220,240,225,.22)';
    for (const b of G.balls) {
      if (b.type === 'color') {
        ctx.beginPath(); ctx.arc(b.spotX, b.spotY, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  } else {
    const hx = TABLE.x + TABLE.w * 0.25;
    ctx.beginPath(); ctx.moveTo(hx, TABLE.y + 4); ctx.lineTo(hx, TABLE.y + TABLE.h - 4); ctx.stroke();
    ctx.fillStyle = 'rgba(220,240,225,.2)';
    ctx.beginPath(); ctx.arc(TABLE.x + TABLE.w * 0.75, TABLE.y + TABLE.h / 2, 2.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // center mark
  ctx.save();
  ctx.globalAlpha = 0.055;
  ctx.fillStyle = '#eaf6ee';
  ctx.font = '600 34px "Noto Sans SC",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('一杆清台', TABLE.x + TABLE.w / 2, TABLE.y + TABLE.h / 2 + 2);
  ctx.font = '500 11px sans-serif';
  ctx.fillText('Y I G A N   Q I N G T A I', TABLE.x + TABLE.w / 2, TABLE.y + TABLE.h / 2 + 30);
  ctx.restore();

  // pockets
  for (const p of POCKETS) drawPocket(p);

  // table edge light
  ctx.strokeStyle = 'rgba(227,193,115,.18)';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, 49, 49, 902, 452, 8);
  ctx.stroke();
  ctx.restore();
}

function drawSights() {
  ctx.save();
  ctx.fillStyle = 'rgba(238,224,188,.72)';
  ctx.shadowColor = 'rgba(0,0,0,.5)';
  ctx.shadowBlur = 2;
  const longY = [25, 525];
  for (const y of longY) {
    for (let i = 1; i <= 7; i++) {
      if (i === 4) continue;
      const x = TABLE.x + (TABLE.w / 8) * i;
      diamond(x, y, 4.2, 2.8);
    }
  }
  const sideX = [25, 975];
  for (const x of sideX) {
    for (const i of [1, 2, 3]) {
      const y = TABLE.y + (TABLE.h / 4) * i;
      diamond(x, y, 2.8, 4.2);
    }
  }
  ctx.restore();
}

function diamond(x, y, rx, ry) {
  ctx.beginPath();
  ctx.moveTo(x, y - ry); ctx.lineTo(x + rx, y); ctx.lineTo(x, y + ry); ctx.lineTo(x - rx, y);
  ctx.closePath(); ctx.fill();
}

function drawPocket(p) {
  const corner = p.corner;
  const rr = corner ? 30 : 27;
  ctx.save();
  const rim = ctx.createRadialGradient(p.x - 4, p.y - 4, 3, p.x, p.y, rr);
  rim.addColorStop(0, '#20120a');
  rim.addColorStop(0.65, '#6f4a2a');
  rim.addColorStop(0.86, '#c19a58');
  rim.addColorStop(1, '#24140c');
  ctx.fillStyle = rim;
  ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.fill();
  const hole = ctx.createRadialGradient(p.x, p.y, 1, p.x, p.y, rr * 0.74);
  hole.addColorStop(0, '#000');
  hole.addColorStop(0.65, '#020403');
  hole.addColorStop(1, '#07100b');
  ctx.fillStyle = hole;
  ctx.beginPath(); ctx.arc(p.x, p.y, rr * 0.74, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,224,166,.15)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(p.x, p.y, rr * 0.75, Math.PI * 1.05, Math.PI * 1.85); ctx.stroke();
  ctx.restore();
}

const ballSprites = new Map();

function paintBallBody(b, cx, cy, R, mode) {
  const col = colorForBall(b);
  // shadow (baked into sprite)
  ctx.fillStyle = 'rgba(0,0,0,.32)';
  ctx.beginPath();
  ctx.ellipse(cx + 2.2, cy + 3.4, R * 1.02, R * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  if (b.type === 'cue') {
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.05);
    g.addColorStop(0, '#fffdf4');
    g.addColorStop(0.45, '#f2eee0');
    g.addColorStop(0.85, '#d8d2c1');
    g.addColorStop(1, '#b4ae9f');
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  } else if (b.type === 'stripe') {
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R * 1.05);
    g.addColorStop(0, '#fffdf7');
    g.addColorStop(0.55, '#f5f1e4');
    g.addColorStop(1, '#c9c4b6');
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    const band = ctx.createLinearGradient(cx, cy - R * 0.52, cx, cy + R * 0.52);
    band.addColorStop(0, mixHex(col, '#ffffff', 0.25));
    band.addColorStop(0.45, col);
    band.addColorStop(0.8, mixHex(col, '#000000', 0.3));
    band.addColorStop(1, mixHex(col, '#000000', 0.45));
    ctx.fillStyle = band;
    ctx.fillRect(cx - R, cy - R * 0.46, 2 * R, R * 0.92);
  } else {
    const light = mixHex(col, '#ffffff', 0.46);
    const dark = mixHex(col, '#000000', 0.52);
    const g = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.43, R * 0.08, cx, cy, R * 1.08);
    g.addColorStop(0, light);
    g.addColorStop(0.38, col);
    g.addColorStop(0.82, dark);
    g.addColorStop(1, mixHex(col, '#000000', 0.7));
    ctx.fillStyle = g;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
  }

  const sh = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.05, cx, cy, R * 1.15);
  sh.addColorStop(0, 'rgba(255,255,255,.10)');
  sh.addColorStop(0.55, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(0,0,0,.35)');
  ctx.fillStyle = sh;
  ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

  if (mode === '8ball' && (b.type === 'solid' || b.type === 'stripe' || b.type === 'eight')) {
    const nr = R * 0.56;
    ctx.fillStyle = '#f7f2e4';
    ctx.beginPath(); ctx.arc(cx, cy, nr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.34)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.fillStyle = '#16211a';
    ctx.font = `900 ${R * 0.78}px "Noto Sans SC","Noto Sans CJK SC","Source Han Sans SC","PingFang SC",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(b.num), cx, cy + R * 0.035);
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(0,0,0,.36)';
  ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.arc(cx, cy, R - 0.4, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.beginPath();
  ctx.ellipse(cx - R * 0.38, cy - R * 0.42, R * 0.24, R * 0.15, -0.65, 0, Math.PI * 2);
  ctx.fill();
}

function getBallSprite(b) {
  const R = G.R;
  const mode = G.mode;
  const key = [mode, b.type, b.num, b.colorName || '', R].join('|');
  let sprite = ballSprites.get(key);
  if (sprite) return sprite;
  const S = 4;
  const pad = R * 0.58;
  const world = 2 * R + 2 * pad;
  const c = document.createElement('canvas');
  c.width = Math.ceil(world * S);
  c.height = Math.ceil(world * S);
  const octx = c.getContext('2d');
  octx.setTransform(S, 0, 0, S, 0, 0);
  const main = ctx;
  ctx = octx;
  try {
    paintBallBody(b, pad + R, pad + R, R, mode);
  } finally {
    ctx = main;
  }
  sprite = { canvas: c, pad, world };
  ballSprites.set(key, sprite);
  return sprite;
}

function drawBall(b, alpha = 1) {
  const sprite = getBallSprite(b);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite.canvas, b.x - sprite.pad - G.R, b.y - sprite.pad - G.R, sprite.world, sprite.world);
  ctx.restore();
}

function wallDistance(x, y, dx, dy) {
  const R = G.R;
  const minX = TABLE.x + R, maxX = TABLE.x + TABLE.w - R;
  const minY = TABLE.y + R, maxY = TABLE.y + TABLE.h - R;
  let tx = Infinity, ty = Infinity;
  if (dx > 0.00001) tx = (maxX - x) / dx;
  else if (dx < -0.00001) tx = (minX - x) / dx;
  if (dy > 0.00001) ty = (maxY - y) / dy;
  else if (dy < -0.00001) ty = (minY - y) / dy;
  return { t: Math.min(tx, ty), axis: tx <= ty ? 'x' : 'y' };
}

function aimPreview(angle) {
  const cue = cueBall();
  if (!cue || !cue.active) return null;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const R = G.R;
  let bestT = Infinity, hit = null;
  for (const b of G.balls) {
    if (!b.active || b.id === 0) continue;
    const t = rayCircle(cue.x, cue.y, dx, dy, b.x, b.y, 2 * R);
    if (t !== null && t > 0.01 && t < bestT) { bestT = t; hit = b; }
  }
  const wall = wallDistance(cue.x, cue.y, dx, dy);
  if (hit && bestT < wall.t) {
    const gx = cue.x + dx * bestT, gy = cue.y + dy * bestT;
    const objDir = norm(hit.x - gx, hit.y - gy);
    const dot = dx * objDir.x + dy * objDir.y;
    const tx = dx - objDir.x * dot, ty = dy - objDir.y * dot;
    const tl = Math.hypot(tx, ty);
    const cueDeflect = tl > 0.045 ? { x: tx / tl, y: ty / tl } : null;
    return { cue, dx, dy, ghost: { x: gx, y: gy }, hit, objDir, cueDeflect, end: { x: gx, y: gy }, bounce: null };
  }
  const ex = cue.x + dx * wall.t, ey = cue.y + dy * wall.t;
  let rdx = dx, rdy = dy;
  if (wall.axis === 'x') rdx = -rdx; else rdy = -rdy;
  const end2 = { x: ex + rdx * 140, y: ey + rdy * 140 };
  return { cue, dx, dy, ghost: null, hit: null, end: { x: ex, y: ey }, bounce: { dx: rdx, dy: rdy, end: end2 } };
}

function drawAim(now) {
  if (!G) return;
  const aiPlan = G.aiPlan && now < G.aiPlan.until;
  const humanAim = G.phase === 'aim' && isHumanTurn() && !G.ballInHand && !G.aiThinking;
  if (!humanAim && !aiPlan) return;
  if (!S.aim && !aiPlan) return;
  const cue = cueBall();
  if (!cue || !cue.active) return;
  const angle = aiPlan ? G.aimAngle : G.aimAngle;
  const pv = aimPreview(angle);
  if (!pv) return;
  const gold = aiPlan ? 'rgba(227,193,115,' : 'rgba(235,248,240,';
  ctx.save();
  ctx.lineCap = 'round';

  // cue path
  ctx.setLineDash([9, 9]);
  ctx.lineDashOffset = -(now / 55) % 18;
  ctx.strokeStyle = gold + '0.78)';
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  const sx = cue.x + pv.dx * (G.R + 1), sy = cue.y + pv.dy * (G.R + 1);
  ctx.moveTo(sx, sy);
  if (pv.hit) ctx.lineTo(pv.ghost.x, pv.ghost.y);
  else {
    ctx.lineTo(pv.end.x, pv.end.y);
    if (pv.bounce) {
      ctx.moveTo(pv.end.x, pv.end.y);
      ctx.lineTo(pv.bounce.end.x, pv.bounce.end.y);
    }
  }
  ctx.stroke();

  if (pv.hit) {
    // ghost cue ball
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = gold + '0.8)';
    ctx.beginPath(); ctx.arc(pv.ghost.x, pv.ghost.y, G.R, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    ctx.fill();
    // object ball direction
    const lenArrow = 88;
    const ax = pv.hit.x + pv.objDir.x * lenArrow, ay = pv.hit.y + pv.objDir.y * lenArrow;
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(227,193,115,.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(pv.hit.x, pv.hit.y); ctx.lineTo(ax, ay); ctx.stroke();
    drawArrow(ax, ay, Math.atan2(pv.objDir.y, pv.objDir.x), 7, 'rgba(227,193,115,.7)');
    // contact line
    ctx.strokeStyle = 'rgba(255,255,255,.20)';
    ctx.beginPath(); ctx.moveTo(pv.ghost.x, pv.ghost.y); ctx.lineTo(pv.hit.x, pv.hit.y); ctx.stroke();

    // cue-ball deflection: first 3 cm highlighted, faint tail shows direction
    if (pv.cueDeflect) {
      const guide = Math.max((3 / 254) * TABLE.w, 20); // 3 cm on a 254 cm table (min for visibility)
      const tail = 92;
      const gx = pv.ghost.x + pv.cueDeflect.x * guide;
      const gy = pv.ghost.y + pv.cueDeflect.y * guide;
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(126,224,236,.45)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(pv.ghost.x + pv.cueDeflect.x * tail, pv.ghost.y + pv.cueDeflect.y * tail);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(126,224,236,.98)';
      ctx.lineWidth = 2.4;
      ctx.shadowColor = 'rgba(104,210,226,.65)';
      ctx.shadowBlur = 7;
      ctx.beginPath();
      ctx.moveTo(pv.ghost.x, pv.ghost.y);
      ctx.lineTo(gx, gy);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(196,248,252,.98)';
      ctx.beginPath(); ctx.arc(gx, gy, 2.2, 0, Math.PI * 2); ctx.fill();
    }
  }

  ctx.restore();
}

function drawArrow(x, y, angle, size, color) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(-size, size * 0.55); ctx.lineTo(-size, -size * 0.55);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawCueStick() {
  if (!G || G.ballInHand || G.phase === 'over' || G.phase === 'shooting') return;
  if (!isHumanTurn() && !G.aiThinking) return;
  const cue = cueBall();
  if (!cue || !cue.active) return;
  const d = { x: Math.cos(G.aimAngle), y: Math.sin(G.aimAngle) };
  const pull = 4 + G.power * 62;
  const gap = G.R + 12 + pull;
  const tip = { x: cue.x - d.x * gap, y: cue.y - d.y * gap };
  const butt = { x: tip.x - d.x * 236, y: tip.y - d.y * 236 };
  const nx = -d.y, ny = d.x;
  ctx.save();
  // shadow
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(tip.x + 3, tip.y + 4); ctx.lineTo(butt.x + 3, butt.y + 4); ctx.stroke();
  // shaft polygon
  const g = ctx.createLinearGradient(tip.x, tip.y, butt.x, butt.y);
  g.addColorStop(0, '#e7d3a8');
  g.addColorStop(0.45, '#c49a5d');
  g.addColorStop(0.7, '#8a5a31');
  g.addColorStop(0.86, '#3a2417');
  g.addColorStop(1, '#1c110a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(tip.x + nx * 2.1, tip.y + ny * 2.1);
  ctx.lineTo(butt.x + nx * 5.3, butt.y + ny * 5.3);
  ctx.lineTo(butt.x - nx * 5.3, butt.y - ny * 5.3);
  ctx.lineTo(tip.x - nx * 2.1, tip.y - ny * 2.1);
  ctx.closePath(); ctx.fill();
  // highlight
  ctx.strokeStyle = 'rgba(255,240,205,.35)';
  ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(tip.x + nx * 0.9, tip.y + ny * 0.9); ctx.lineTo(butt.x + nx * 2.6, butt.y + ny * 2.6); ctx.stroke();
  // tip
  ctx.strokeStyle = '#276b82';
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(tip.x - d.x * 1, tip.y - d.y * 1);
  ctx.lineTo(tip.x + d.x * 4, tip.y + d.y * 4);
  ctx.stroke();
  // butt cap
  ctx.strokeStyle = '#c8a05c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(butt.x + d.x * 2, butt.y + d.y * 2);
  ctx.lineTo(butt.x + d.x * 8, butt.y + d.y * 8);
  ctx.stroke();
  ctx.restore();
}

function drawBallInHand(now) {
  if (!G || (!G.ballInHand && !G.freeBallDrag)) return;
  const cue = cueBall();
  if (!cue) return;
  const pulse = 0.5 + 0.5 * Math.sin(now / 220);
  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = `rgba(227,193,115,${0.35 + pulse * 0.35})`;
  ctx.beginPath(); ctx.arc(cue.x, cue.y, G.R + 7 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  if (G.draggingCue) {
    const ok = G.handValid;
    ctx.strokeStyle = ok ? 'rgba(84,214,162,.9)' : 'rgba(224,106,98,.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cue.x, cue.y, G.R + 2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = ok ? 'rgba(84,214,162,.10)' : 'rgba(224,106,98,.12)';
    ctx.fill();
  }
  ctx.restore();
}


function drawTargetMarkers(now) {
  if (!G || G.phase === 'over' || G.phase === 'shooting') return;
  if (G.mode !== 'snooker' && G.mode !== '9ball' && G.mode !== '10ball' && G.mode !== 'rotation') return;
  const targets = legalTargets();
  if (!targets.length) return;
  const pulse = 0.5 + 0.5 * Math.sin(now / 300);
  const single = targets.length === 1;
  ctx.save();
  for (const b of targets) {
    const r = G.R + 4.5 + pulse * 1.4;
    if (single) {
      ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(227,193,115,${0.55 + pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(227,193,115,.5)';
      ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(227,193,115,${0.6 + pulse * 0.3})`;
      ctx.font = '600 8px "Noto Sans SC",sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('目标', b.x, b.y - r - 2);
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = `rgba(227,193,115,${0.34 + pulse * 0.28})`;
      ctx.lineWidth = 1.35;
      ctx.beginPath(); ctx.arc(b.x, b.y, G.R + 3.6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(246,219,152,${0.65 + pulse * 0.3})`;
      ctx.beginPath(); ctx.arc(b.x, b.y - G.R - 5.4, 2.1, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function drawPocketAnims(now) {
  if (!G) return;
  for (let i = G.pocketAnims.length - 1; i >= 0; i--) {
    const a = G.pocketAnims[i];
    const t = (now - a.start) / 420;
    if (t >= 1) { G.pocketAnims.splice(i, 1); continue; }
    const e = 1 - Math.pow(1 - t, 2);
    const x = lerp(a.ball.x, a.pocket.x, e);
    const y = lerp(a.ball.y, a.pocket.y, e);
    const tmp = { ...a.ball, x, y };
    const scale = 1 - e * 0.75;
    ctx.save();
    ctx.translate(x, y); ctx.scale(scale, scale); ctx.translate(-x, -y);
    ctx.globalAlpha = 1 - e * 0.35;
    drawBall(tmp, 1 - e * 0.35);
    ctx.restore();
  }
}



function drawVignette() {
  const { w, h } = view;
  const vg = ctx.createRadialGradient(w * 0.45, h * 0.5, Math.min(w, h) * 0.25, w * 0.45, h * 0.5, Math.max(w, h) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,.42)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

function buildScreenCaches() {
  const key = `${view.w}x${view.h}@${dpr}`;
  if (bgCache && vignetteCache && screenCacheKey === key) return;
  const bg = document.createElement('canvas');
  bg.width = canvas.width; bg.height = canvas.height;
  const bctx = bg.getContext('2d');
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const main = ctx;
  ctx = bctx;
  try { drawBackground(); } finally { ctx = main; }

  const vg = document.createElement('canvas');
  vg.width = canvas.width; vg.height = canvas.height;
  const vctx = vg.getContext('2d');
  vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx = vctx;
  try { drawVignette(); } finally { ctx = main; }
  bgCache = bg;
  vignetteCache = vg;
  screenCacheKey = key;
}

function buildTableCache() {
  if (!G) return;
  const off = document.createElement('canvas');
  off.width = Math.ceil(WORLD.w * TABLE_CACHE_SCALE);
  off.height = Math.ceil(WORLD.h * TABLE_CACHE_SCALE);
  const octx = off.getContext('2d');
  octx.setTransform(TABLE_CACHE_SCALE, 0, 0, TABLE_CACHE_SCALE, 0, 0);
  const main = ctx;
  ctx = octx;
  noisePattern = null;
  try {
    drawTable();
  } finally {
    ctx = main;
  }
  tableCache = { canvas: off, mode: G.mode };
}

function render(now) {
  if (!ctx) return;
  const { w, h } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!bgCache || !vignetteCache) buildScreenCaches();
  if (bgCache) ctx.drawImage(bgCache, 0, 0, w, h);

  if (G) {
    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);
    let shakeX = 0, shakeY = 0;
    if (G.shakeUntil && now < G.shakeUntil) {
      const k = (G.shakeUntil - now) / 220;
      shakeX = (Math.random() * 2 - 1) * G.shake * k;
      shakeY = (Math.random() * 2 - 1) * G.shake * k;
    }
    ctx.translate(shakeX, shakeY);
    if (!tableCache || tableCache.mode !== G.mode) buildTableCache();
    if (tableCache) ctx.drawImage(tableCache.canvas, 0, 0, WORLD.w, WORLD.h);
    if (REPLAY_ACTIVE && REPLAY_TINT) {
      ctx.save();
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = REPLAY_TINT;
      ctx.fillRect(TABLE.x, TABLE.y, TABLE.w, TABLE.h);
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = REPLAY_TINT;
      ctx.lineWidth = 3;
      ctx.strokeRect(TABLE.x - 2, TABLE.y - 2, TABLE.w + 4, TABLE.h + 4);
      ctx.restore();
    }
    if (REPLAY_ACTIVE) drawReplayGuide(now);
    drawAim(now);
    drawCueStick();
    for (const b of G.balls) {
      if (b.active) drawBall(b, 1);
    }
    drawTargetMarkers(now);
    drawPocketAnims(now);
    drawBallInHand(now);
    ctx.restore();
  }

  // vignette
  if (vignetteCache) ctx.drawImage(vignetteCache, 0, 0, w, h);
}


/* ============================================================
 * 局域网联机 —— 整块删除
 *
 * 【为什么删】原版靠 PeerJS（网页端）或 Android 原生桥（APK 端）
 *   在局域网里直连两台设备。小程序里两条路都走不通：
 *     - CSP 是 default-src 'none'，加载不了 peerjs.min.js；
 *     - 没有 Android 原生桥，window.Android 不存在。
 *   留着只会让「局域网」按钮点下去必然失败。
 *
 * 【删了影响什么】只影响联机。本地 AI、同机双人、回放、开发者终端
 *   都不依赖这块，全部照常工作。
 * ============================================================ */

// 【为什么这个函数要救回来】它原本夹在 LAN 那一大块中间（原版 L3803），
//   按区块整段删除时被一起删掉了。但回放录制、开发者终端、
//   本地 AI 推演全都在用 gameSnapshot()，删了会直接 ReferenceError。
//   教训：删大块前要按「函数定义」扫一遍被删范围内的非 LAN 函数。
function gameSnapshot() {
  const phase = G.phase === 'shooting' ? 'aim' : G.phase;
  return {
    mode: G.mode,
    R: G.R,
    balls: G.balls.map((b) => ({
      id: b.id, num: b.num, type: b.type, x: b.x, y: b.y, vx: 0, vy: 0,
      active: b.active, pocketed: b.pocketed, colorName: b.colorName,
      value: b.value, spotX: b.spotX, spotY: b.spotY,
    })),
    seats: G.seats ? G.seats.map((s) => ({ ...s })) : undefined,
    players: G.players.map((p) => ({ name: p.name, isAI: false, group: p.group, score: p.score })),
    current: G.current,
    phase,
    winner: G.winner,
    overReason: G.overReason,
    breakShot: G.breakShot,
    openTable: G.openTable,
    ballInHand: G.ballInHand,
    snooker: G.snooker ? { ...G.snooker } : null,
    physics: { ...PHYS },
    log: G.log.slice(-10),
  };
}

/* 【局域网联机已整块删除】上游每次发版都会带着这一大块 LAN 代码（约 630 行），
   三方合并时必然和我们的删除相冲突。
   为什么坚持删：小程序里没有 WebRTC 信令通道，也没有 Android 局域网桥，
   留着就是永远走不到的死代码，还会让「这游戏能不能联机」变得含糊。
   合并时遇到这段冲突，直接保留删除即可——下面这块内容不要恢复。 */

/* ============================================================
   回放录制
   ============================================================ */
function replayClone(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
}

function startReplayRecording(mode, opponent) {
  if (!G || REPLAY_ACTIVE) return;
  RECORDER = {
    format: 'yigan-replay',
    version: APP_VERSION,
    createdAt: new Date().toISOString(),
    mode,
    opponent,
    difficulty: G.difficulty,
    R: G.R,
    physics: { ...PHYS },
    shellAI: { ...G.shellAI },
    aiLevel: { ...G.aiLevel },
    aiThinkLimit: G.aiThinkLimit,
    aiSandboxUsed: G.aiSandboxUsed ? (Array.isArray(G.aiSandboxUsed) ? [...G.aiSandboxUsed] : G.aiSandboxUsed) : null,
    developerMode: devEnabled(),
    rootUnlocked: rootActive(),
    seats: G.seats ? G.seats.map((s) => ({ ...s })) : undefined,
    players: G.players.map((p) => ({ name: p.name, group: p.group, score: p.score })),
    initial: replayClone(gameSnapshot()),
    shots: [],
    pendingAi: [],
    pendingSandbox: [],
    apiCalls: [],
    currentShot: null,
    completed: false,
    winner: null,
    endedAt: null,
    finalState: null,
    finalized: false,
  };
  updateReplayUI();
}

function replayRecordAi(ev) {
  if (!RECORDER || SB) return;
  try {
    if (!Array.isArray(RECORDER.pendingAi)) RECORDER.pendingAi = [];
    RECORDER.pendingAi.push({ ...replayClone(ev), at: new Date().toISOString(), shot: RECORDER.shots.length });
  } catch (e) {
    console.warn('replay ai record failed', e);
  }
}

function replayRecordSandbox(ev) {
  if (!RECORDER || SB) return;
  try {
    if (!Array.isArray(RECORDER.pendingSandbox)) RECORDER.pendingSandbox = [];
    RECORDER.pendingSandbox.push({ ...replayClone(ev), at: new Date().toISOString(), shotIndex: RECORDER.shots.length });
  } catch (e) {
    console.warn('replay sandbox record failed', e);
  }
}

function replayRecordFinal(shot, source, reason = '') {
  if (!shot) return;
  try {
  replayRecordAi({
    type: 'final', source,
    angle: shot.angle, power: shot.power, id: shot.id || null,
    target: shot.target ? (shot.target.num || shot.target.type) : null,
    note: shot.note || '', reason,
  });
  } catch (e) { console.warn('replay final record failed', e); }
}

function replayRecordFrame() {
  if (!RECORDER || !RECORDER.currentShot || SB || REPLAY_ACTIVE) return;
  const shot = RECORDER.currentShot;
  if (shot.frames.length >= 240) return;
  const t = Date.now() - shot.at;
  const balls = G.balls.filter((b) => b.active).map((b) => [b.id, Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10]);
  const last = shot.frames[shot.frames.length - 1];
  if (last && last.t === t) return;
  shot.frames.push({ t, balls });
}

function startReplayShot() {
  if (!RECORDER || RECORDER.finalized || REPLAY_ACTIVE || RECORDER.currentShot) return;
  const cue = cueBall();
  const shot = {
    index: RECORDER.shots.length,
    at: Date.now(),
    player: G.current,
    playerName: G.players[G.current] ? G.players[G.current].name : '',
    angle: G.aimAngle,
    power: G.power,
    cue: cue ? [cue.x, cue.y] : null,
    before: replayClone(gameSnapshot()),
    frames: [],
    ai: RECORDER.pendingAi.splice(0),
    sandbox: RECORDER.pendingSandbox.splice(0),
    after: null,
    first: null,
    potted: [],
    cuePotted: false,
    foul: '',
    winner: null,
    current: G.current,
    phase: G.phase,
    scores: G.players.map((p) => p.score),
    log: [],
  };
  RECORDER.shots.push(shot);
  RECORDER.currentShot = shot;
  replayRecordFrame();
  updateReplayUI();
}

function finishReplayShot(meta = {}) {
  if (!RECORDER || !RECORDER.currentShot) return;
  const shot = RECORDER.currentShot;
  const after = replayClone(gameSnapshot());
  replayRecordFrame();
  const first = meta.first || G.firstContact;
  const potted = meta.potted || G.pottedThisShot;
  shot.after = after;
  shot.first = first ? { id: first.id, num: first.num, type: first.type, colorName: first.colorName } : null;
  shot.potted = (potted || []).filter((b) => b.id !== 0).map((b) => ({ id: b.id, num: b.num, type: b.type, colorName: b.colorName }));
  shot.pottedNums = shot.potted.map((b) => b.num);
  shot.cuePotted = (potted || []).some((b) => b.id === 0);
  shot.foul = G.lastFoul || '';
  shot.winner = G.winner;
  shot.current = G.current;
  shot.phase = G.phase;
  shot.scores = G.players.map((p) => p.score);
  shot.log = G.log.slice(-8).map((l) => l.text);
  shot.endedAt = new Date().toISOString();
  RECORDER.currentShot = null;
}

function finalizeReplay(winner = null) {
  if (!RECORDER || RECORDER.finalized) return;
  if (RECORDER.currentShot) finishReplayShot();
  const won = winner !== null && winner !== undefined ? winner : (G ? G.winner : null);
  RECORDER.completed = !!(G && G.phase === 'over');
  RECORDER.winner = won;
  RECORDER.endedAt = new Date().toISOString();
  RECORDER.finalState = G ? replayClone(gameSnapshot()) : null;
  RECORDER.finalized = true;
  if (RECORDER.shots.length && !REPLAYS.includes(RECORDER)) {
    REPLAYS.push(RECORDER);
    if (REPLAYS.length > 30) REPLAYS.shift();
    archiveReplay(RECORDER);
  }
  updateReplayUI();
}

let FILE_SEQ = 0;
const FILE_PENDING = new Map();

window.__nativeFileResult = function (payload) {
  try {
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const p = FILE_PENDING.get(data.id);
    if (!p) return;
    FILE_PENDING.delete(data.id);
    clearTimeout(p.timer);
    p.resolve({
      ok: !!data.ok,
      name: data.name || '',
      text: data.b64 ? b64ToUtf8(data.b64) : '',
      error: data.error || '',
    });
  } catch (e) { /* ignore */ }
};

/* 【为什么删掉 window.Android 分支】那套原生文件桥只存在于上游的
   Android 壳里；小黑盒小程序是网页沙箱，window.Android 永远是 undefined，
   留着只是死代码。这里统一走浏览器原生 <a download> / <input type=file>。 */
function pickSaveFile(name, content, mime) {
  try {
    const blob = new Blob([content], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    return Promise.resolve({ ok: true, name });
  } catch (e) { return Promise.resolve({ ok: false, error: String(e) }); }
}

function pickOpenFile(mime) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = mime && mime !== '*/*' ? mime : '.json,.yigan,application/json,application/octet-stream';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) { resolve({ ok: false, error: 'canceled' }); return; }
      const reader = new FileReader();
      reader.onload = () => resolve({ ok: true, name: f.name, text: String(reader.result || '') });
      reader.onerror = () => resolve({ ok: false, error: '读取失败' });
      reader.readAsText(f);
    };
    input.click();
  });
}

function bytesToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function b64ToBytes(str) {
  const bin = atob(String(str || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64ToUtf8(str) {
  return new TextDecoder().decode(b64ToBytes(str));
}

async function deriveArchiveKey(password, salt) {
  if (!window.crypto || !crypto.subtle) throw new Error('当前环境不支持加密');
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

async function encryptReplayText(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveArchiveKey(password, salt);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return JSON.stringify({
    format: 'yigan-replay-encrypted',
    version: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: bytesToB64(salt) },
    cipher: { name: 'AES-GCM', iv: bytesToB64(iv) },
    payload: bytesToB64(cipher),
  }, null, 2);
}

async function decryptReplayText(text, password) {
  const env = JSON.parse(text);
  if (!env || env.format !== 'yigan-replay-encrypted') throw new Error('不是加密回放存档');
  const salt = b64ToBytes(env.kdf && env.kdf.salt);
  const iv = b64ToBytes(env.cipher && env.cipher.iv);
  const key = await deriveArchiveKey(password, salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b64ToBytes(env.payload));
  return new TextDecoder().decode(plain);
}

let PASSWORD_RESOLVE = null;
function askPassword(title, desc) {
  const modal = $('#passwordModal');
  if (!modal) return Promise.resolve(null);
  $('#passwordTitle').textContent = title || '存档密码';
  $('#passwordDesc').textContent = desc || '设置一个密码。忘记密码将无法恢复存档。';
  $('#passwordInput').value = '';
  modal.classList.add('show');
  $('#passwordInput').focus();
  return new Promise((resolve) => { PASSWORD_RESOLVE = resolve; });
}

function finishPassword(value) {
  const modal = $('#passwordModal');
  if (modal) modal.classList.remove('show');
  const resolve = PASSWORD_RESOLVE;
  PASSWORD_RESOLVE = null;
  if (resolve) resolve(value);
}

function compactReplay(replay) {
  const out = JSON.parse(JSON.stringify(replay));
  out.compact = 'keyframes-v1';
  const cut = (frames) => {
    if (!Array.isArray(frames) || frames.length <= 2) return frames;
    const picked = [frames[0]];
    let lastT = frames[0].t || 0;
    for (const f of frames) {
      if ((f.t || 0) - lastT >= 100) { picked.push(f); lastT = f.t || 0; }
    }
    const last = frames[frames.length - 1];
    if (picked[picked.length - 1] !== last) picked.push(last);
    return picked;
  };
  for (const shot of (out.shots || [])) {
    shot.frames = cut(shot.frames);
    for (const sb of (shot.sandbox || [])) if (sb.result) sb.result.frames = cut(sb.result.frames);
  }
  return out;
}

function expandCompactReplay(replay) {
  if (!replay || replay.compact !== 'keyframes-v1') return replay;
  const expand = (frames) => {
    if (!Array.isArray(frames) || frames.length < 2) return frames || [];
    const out = [];
    for (let i = 0; i < frames.length - 1; i++) {
      const a = frames[i], b = frames[i + 1];
      const t0 = a.t || 0, t1 = b.t || t0 + 16;
      const mapA = new Map((a.balls || []).map((x) => [x[0], x]));
      const mapB = new Map((b.balls || []).map((x) => [x[0], x]));
      const ids = new Set([...mapA.keys(), ...mapB.keys()]);
      const steps = Math.max(1, Math.round((t1 - t0) / 16));
      for (let s = 0; s < steps; s++) {
        const k = s / steps;
        const balls = [];
        for (const id of ids) {
          const x = mapA.get(id), y = mapB.get(id);
          if (!y) continue;
          balls.push([id, x ? x[1] + (y[1] - x[1]) * k : y[1], x ? x[2] + (y[2] - x[2]) * k : y[2]]);
        }
        out.push({ t: t0 + Math.round((t1 - t0) * k), balls });
      }
    }
    out.push(frames[frames.length - 1]);
    return out;
  };
  for (const shot of (replay.shots || [])) {
    shot.frames = expand(shot.frames);
    for (const sb of (shot.sandbox || [])) if (sb.result) sb.result.frames = expand(sb.result.frames);
  }
  replay.compact = false;
  return replay;
}

const REPLAY_RETENTION_DAYS = 30;
let REPLAY_ARCHIVE_DIR = '';

function replayArchiveStamp(replay) {
  const d = new Date(replay.createdAt || Date.now());
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

/* 【为什么不自动存档】用户实测一局回放 2.47 MB，而单个云端 value
   上限只有 16 KB，差两个数量级——塞进 value 必然写失败，还会连累同一份
   存档里的其他数据。localStorage 同样有 5 MB 总配额，几局就满。
   所以改成：回放只活在内存里（本次打开期间可看），要留就由用户
   主动「保存加密存档」导出成文件，下次用「导入存档」读回来。
   这个函数保留成空实现，是因为调用点遍布出杆流程，
   删掉会牵连一片，留个明确的空壳最省事也最不容易出错。 */
function archiveReplay(replay) {
  if (!replay || !replay.shots || !replay.shots.length) return;
  replay.savedAt = new Date().toISOString();
}

/* 回放不再有任何持久化来源，启动时列表必然是空的，
   只做一次界面刷新即可（保留函数是为了不打断调用点）。 */
function loadReplayArchives() {
  REPLAYS.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  updateReplayUI();
}

function updateReplayUI() {
  const btn = $('#menuReplay');
  if (!btn) return;
  btn.hidden = !(REPLAYS.length || (RECORDER && RECORDER.shots.length));
}

/* ============================================================
   回放播放 / 导出
   ============================================================ */
function replayListAll() {
  const list = REPLAYS.slice();
  if (RECORDER && RECORDER.shots.length && !list.includes(RECORDER)) list.push(RECORDER);
  return list;
}

function buildReplaySegments(replay, mode) {
  const segs = [];
  for (let i = 0; i < replay.shots.length; i++) {
    const shot = replay.shots[i];
    if (mode === 'thinking') {
      (shot.sandbox || []).forEach((sb, j) => {
        segs.push({
          type: 'sandbox', shotIndex: i, shot, sandbox: sb,
          ordinal: j, color: SANDBOX_TINTS[j % SANDBOX_TINTS.length],
        });
      });
    }
    segs.push({ type: 'shot', shotIndex: i, shot });
  }
  return segs;
}

function replayAllApiCalls(replay) {
  const calls = [];
  if (Array.isArray(replay.apiCalls)) calls.push(...replay.apiCalls);
  for (const shot of (replay.shots || [])) {
    if (Array.isArray(shot.apiCalls)) calls.push(...shot.apiCalls);
  }
  return calls;
}

function replayCallsForShot(replay, index) {
  return replayAllApiCalls(replay).filter((c) => Number(c.shotIndex) === Number(index) && c.reasoning);
}

function replaysForSegmentSafe(replay, seg) {
  try { return replayCallsForSegment(replay, seg); } catch (e) { return []; }
}

function replayCallsForSegment(replay, seg) {
  const calls = replayAllApiCalls(replay).filter((c) => Number(c.shotIndex) === Number(seg.shotIndex) && c.reasoning);
  if (!seg || seg.type !== 'sandbox') return calls;
  const ord = Number(seg.ordinal);
  return calls.filter((c) => Number.isFinite(Number(c.sandboxOrdinal)) && Number(c.sandboxOrdinal) <= ord);
}

function replayThinkingEnglish(replay) {
  const text = replayAllApiCalls(replay).map((c) => c.reasoning || '').join('\n');
  const han = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return latin > 80 && latin > han * 4;
}

function updateReplayThinkLayout() {
  const active = !!(REPLAY_ACTIVE && REPLAY_THINK_MODE && REPLAY_THINK_MODE !== 'hide');
  const w = window.innerWidth || 800;
  const reserve = active ? Math.min(380, Math.max(190, Math.min(330, w * 0.42) + 22)) : 0;
  if (reserve !== REPLAY_THINK_RESERVE) {
    REPLAY_THINK_RESERVE = reserve;
    resizeCanvas();
  }
}

function hideReplayThinkUI() {
  const p = $('#replayThinkPrompt'); if (p) p.hidden = true;
  const panel = $('#replayThinkPanel'); if (panel) panel.hidden = true;
  updateReplayThinkLayout();
}

function beginReplayThinking(replay) {
  REPLAY_THINK_MODE = null;
  REPLAY_THINK_BUSY = false;
  REPLAY_THINK_CACHE = new Map();
  const calls = replayAllApiCalls(replay).filter((c) => c.reasoning);
  if (!calls.length) { hideReplayThinkUI(); return; }
  updateReplayThinkLayout();
  const prompt = $('#replayThinkPrompt');
  const text = $('#replayThinkPromptText');
  if (!prompt) return;
  if (text) text.textContent = `本回放有 ${calls.length} 条模型思考片段，是否在空白处显示？`;
  const tr = $('#replayThinkTranslate');
  if (tr) tr.hidden = !replayThinkingEnglish(replay);
  prompt.hidden = false;
  const panel = $('#replayThinkPanel'); if (panel) panel.hidden = true;
  updateReplayThinkLayout();
}

function setReplayThinkMode(mode) {
  REPLAY_THINK_MODE = mode;
  const prompt = $('#replayThinkPrompt'); if (prompt) prompt.hidden = true;
  if (mode === 'hide') {
    const panel = $('#replayThinkPanel'); if (panel) panel.hidden = true;
    updateReplayThinkLayout();
    return;
  }
  renderReplayThinking();
}

async function translateReplayText(call) {
  if (REPLAY_THINK_CACHE.has(call.id)) return REPLAY_THINK_CACHE.get(call.id);
  const profile = getAiProfile(S.translateAiId) || activeAiProfile();
  if (!profile || !profile.apiKey) throw new Error('所选翻译模型未配置 API Key');
  const src = String(call.reasoning || '').slice(0, 6000);
  const raw = await callLLM([
    { role: 'system', content: '把下面的模型思考片段翻译成简体中文，保留代码、JSON、数字和专有名词，只输出译文。' },
    { role: 'user', content: src },
  ], 1600, profile, null, null);
  const out = String(raw || '').trim();
  REPLAY_THINK_CACHE.set(call.id, out);
  return out;
}

async function renderReplayThinking() {
  if (!REPLAY_STATE) return;
  const panel = $('#replayThinkPanel');
  if (!panel) return;
  if (!REPLAY_THINK_MODE || REPLAY_THINK_MODE === 'hide' || REPLAY_STATE.index < 0) { panel.hidden = true; updateReplayThinkLayout(); return; }
  const seg = (REPLAY_STATE.segments || [])[REPLAY_STATE.index];
  const calls = replaysForSegmentSafe(REPLAY_STATE.replay, seg);
  if (!calls.length) { panel.hidden = true; updateReplayThinkLayout(); return; }
  panel.hidden = false;
  updateReplayThinkLayout();
  $('#replayThinkTitle').textContent = seg && seg.type === 'sandbox' ? `模型思考 · 沙箱 ${seg.ordinal + 1}/${(seg.shot.sandbox || []).length}` : `模型思考 · 第 ${REPLAY_STATE.index + 1} 杆`;
  $('#replayThinkMeta').textContent = `${calls.length} 条 · ${REPLAY_THINK_MODE === 'translate' ? '中文翻译' : '原始片段'}`;
  const body = $('#replayThinkBody');
  if (REPLAY_THINK_MODE === 'translate') {
    body.textContent = '翻译中…';
    if (REPLAY_THINK_BUSY) return;
    REPLAY_THINK_BUSY = true;
    try {
      for (const call of calls) await translateReplayText(call);
    } catch (e) {
      REPLAY_THINK_BUSY = false;
      body.textContent = '翻译失败：' + (e && e.message ? e.message : e);
      showToast('思考翻译失败，已保留原文', true);
      REPLAY_THINK_MODE = 'show';
      renderReplayThinking();
      return;
    }
    REPLAY_THINK_BUSY = false;
  }
  body.innerHTML = calls.map((call) => {
    const text = REPLAY_THINK_MODE === 'translate' ? (REPLAY_THINK_CACHE.get(call.id) || '（翻译为空）') : (call.reasoning || '');
    const meta = [call.model, call.thinkLevel, call.call ? '第' + call.call + '次调用' : ''].filter(Boolean).join(' · ');
    return `<div class="rtp-call"><b>${esc(meta || 'API 思考')}</b>${esc(text)}</div>`;
  }).join('');
}

function openReplay() {
  if (REPLAY_ACTIVE) return;
  const list = replayListAll();
  if (!list.length) { showToast('还没有可回放的对局', true); return; }
  clearTimeout(aiTimer);
  aiToken++;
  if (G && G.aiThinking) G.aiThinking = false;
  const welcomeWasOpen = $('#welcome').classList.contains('show');
  clearTimeout(toastTimer);
  const toastEl = $('#toast');
  if (toastEl) toastEl.classList.remove('show');
  REPLAY_LIVE = { G, paused, base: null, welcomeWasOpen };
  hideWelcome();
  REPLAY_STATE = {
    list,
    replay: list[list.length - 1],
    mode: 'match',
    segments: [],
    index: -1,
    playing: false,
    anim: 0,
    base: replayClone(G),
    timer: 0,
  };
  closeAllModals();
  paused = true;
  REPLAY_ACTIVE = true;
  document.body.classList.add('replay-mode');
  resizeCanvas();
  $('#replayModal').classList.add('show');
  $('#replaySound') && ($('#replaySound').textContent = '');
  $('#replaySelect').innerHTML = list.map((r, i) => {
    const d = new Date(r.createdAt);
    const date = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `<option value="${i}">${esc(date)} · ${esc(modeName(r.mode))} · ${r.shots.length}杆</option>`;
  }).join('');
  $('#replaySelect').value = String(list.length - 1);
  $$('.replay-modes button').forEach((b) => b.classList.toggle('active', b.dataset.rmode === 'match'));
  replayLoad(list[list.length - 1]);
}

function closeReplay() {
  if (!REPLAY_ACTIVE) return;
  replayStopAnim();
  REPLAY_STATE.playing = false;
  $('#replayModal').classList.remove('show');
  document.body.classList.remove('replay-mode');
  resizeCanvas();
  const live = REPLAY_LIVE;
  REPLAY_ACTIVE = false;
  G = live ? live.G : G;
  paused = false;
  const welcomeWasOpen = !!(live && live.welcomeWasOpen);
  REPLAY_LIVE = null;
  REPLAY_STATE = null;
  REPLAY_TINT = null;
  hideReplayThinkUI();
  REPLAY_THINK_MODE = null;
  REPLAY_THINK_RESERVE = 0;
  REPLAY_GUIDE = null;
  tableCache = null;
  if (welcomeWasOpen) showWelcome();
  updateHUD();
  updateCueDock();
  if (!welcomeWasOpen && G && G.phase === 'over') showOver();
  else if (!welcomeWasOpen && G && !anyModalOpen()) maybeAi();
}

function replayLoad(replay) {
  if (!REPLAY_STATE || !replay) return;
  REPLAY_STATE.replay = replay;
  REPLAY_STATE.segments = buildReplaySegments(replay, REPLAY_STATE.mode);
  REPLAY_STATE.index = -1;
  REPLAY_STATE.playing = false;
  replayStopAnim();
  const d = new Date(replay.createdAt);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  $('#replayTitle').textContent = `${modeName(replay.mode)} · ${date}`;
  $('#replayRange').max = String(REPLAY_STATE.segments.length);
  $('#replayRange').value = '0';
  REPLAY_TINT = null;
  replayShowShot(-1, false);
  replayUpdateControls();
  beginReplayThinking(replay);
}

function replayGameFromSnapshot(snap) {
  if (!snap || !REPLAY_STATE) return null;
  const g = replayClone(REPLAY_STATE.base) || {};
  g.mode = snap.mode || g.mode;
  g.R = snap.R || g.R;
  g.balls = (snap.balls || []).map((b) => ({ ...b, vx: 0, vy: 0 }));
  g.balls.rackApexId = g.balls[0] ? g.balls[0].id : undefined;
  g.players = (snap.players || []).map((p) => ({ ...p, isAI: false }));
  g.current = snap.current === 1 ? 1 : 0;
  g.winner = snap.winner === undefined ? null : snap.winner;
  g.overReason = snap.overReason || '';
  g.breakShot = !!snap.breakShot;
  g.openTable = !!snap.openTable;
  g.ballInHand = false;
  g.snooker = snap.snooker ? { ...snap.snooker } : null;
  g.log = Array.isArray(snap.log) ? snap.log.slice(-10) : [];
  g.phase = 'shooting';
  g.net = null;
  g.opponent = 'human';
  g.aiThinking = false;
  g.aiPlan = null;
  g.aimHint = null;
  g.pocketAnims = [];
  g.draggingCue = false;
  g.firstContact = null;
  g.pottedThisShot = [];
  g.resolvePending = false;
  g.shotActive = false;
  g.power = 0.1;
  g.fineDelta = 0;
  g.aimAngle = 0;
  g.shake = 0;
  g.shakeUntil = 0;
  g.lastFoul = '';
  g.cueStrike = 0;
  return g;
}

function replayShowSnapshot(snap) {
  const g = replayGameFromSnapshot(snap);
  if (!g) return;
  G = g;
  paused = true;
  // Keep the table cache across replay steps; only the balls/log change.
}

function replayShowFrame(frame) {
  if (!G || !frame) return;
  const map = new Map((frame.balls || []).map((b) => [b[0], b]));
  for (const b of G.balls) {
    const f = map.get(b.id);
    if (!f) { b.active = false; continue; }
    b.active = true;
    b.x = f[1];
    b.y = f[2];
    b.vx = 0; b.vy = 0;
  }
}

function replayStopAnim() {
  if (!REPLAY_STATE) return;
  REPLAY_STATE.anim++;
  clearTimeout(REPLAY_STATE.timer);
  REPLAY_STATE.timer = 0;
}

function replaySandboxShot(sb) {
  const own = sb && sb.shot && typeof sb.shot === 'object' ? sb.shot : null;
  const sim = sb && sb.result && sb.result.shot ? sb.result.shot : null;
  const src = own || sim || {};
  const angle = Number(src.angleDeg ?? src.angle);
  const power = Number(src.power ?? src.powerPct);
  return {
    angleDeg: Number.isFinite(angle) ? angle : null,
    power: Number.isFinite(power) ? (power <= 1 ? Math.round(power * 100) : Math.round(power)) : null,
  };
}

function setReplayGuide(seg) {
  if (!seg || !REPLAY_STATE) { REPLAY_GUIDE = null; return; }
  const replay = REPLAY_STATE.replay;
  let angle = null, power = 0.5, before = null;
  if (seg.type === 'sandbox') {
    const sb = seg.sandbox || {};
    const sbShot = replaySandboxShot(sb);
    const deg = sbShot.angleDeg;
    if (Number.isFinite(deg)) angle = deg * Math.PI / 180;
    power = (sbShot.power || 50) / 100;
    before = sb.before || (seg.shot && seg.shot.before) || replay.initial;
  } else if (seg.shot) {
    angle = Number(seg.shot.angle);
    power = Number(seg.shot.power) || 0.5;
    before = seg.shot.before || replay.initial;
  }
  if (!Number.isFinite(angle) || !before) { REPLAY_GUIDE = null; return; }
  REPLAY_GUIDE = { angle, power: clamp(power, 0.05, 1), before, type: seg.type };
}

function clearReplayGuide() {
  REPLAY_GUIDE = null;
}

function drawReplayGuide(now) {
  if (!REPLAY_ACTIVE || !REPLAY_GUIDE_ENABLED || !REPLAY_GUIDE) return;
  const g = REPLAY_GUIDE;
  const snap = g.before;
  const cue = (snap.balls || []).find((b) => b.id === 0 && b.active);
  if (!cue) return;
  const R = snap.R || (G && G.R) || 11.2;
  const dx = Math.cos(g.angle), dy = Math.sin(g.angle);
  let bestT = Infinity, hit = null;
  for (const b of (snap.balls || [])) {
    if (!b.active || b.id === 0) continue;
    const t = rayCircle(cue.x, cue.y, dx, dy, b.x, b.y, 2 * R);
    if (t !== null && t > 0.01 && t < bestT) { bestT = t; hit = b; }
  }
  const minX = TABLE.x + R, maxX = TABLE.x + TABLE.w - R;
  const minY = TABLE.y + R, maxY = TABLE.y + TABLE.h - R;
  let tx = Infinity, ty = Infinity;
  if (dx > 0.00001) tx = (maxX - cue.x) / dx; else if (dx < -0.00001) tx = (minX - cue.x) / dx;
  if (dy > 0.00001) ty = (maxY - cue.y) / dy; else if (dy < -0.00001) ty = (minY - cue.y) / dy;
  const wallT = Math.min(tx, ty);
  const useHit = hit && bestT < wallT;
  const endT = useHit ? bestT : wallT;
  if (!Number.isFinite(endT)) return;
  const end = { x: cue.x + dx * endT, y: cue.y + dy * endT };
  const ghost = useHit ? { x: cue.x + dx * bestT, y: cue.y + dy * bestT } : null;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.setLineDash([9, 9]);
  ctx.lineDashOffset = -(now / 55) % 18;
  ctx.strokeStyle = 'rgba(126,224,236,.72)';
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  ctx.moveTo(cue.x + dx * (R + 1), cue.y + dy * (R + 1));
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  if (ghost) {
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(126,224,236,.8)';
    ctx.beginPath(); ctx.arc(ghost.x, ghost.y, R, 0, Math.PI * 2); ctx.stroke();
    const ox = hit.x - ghost.x, oy = hit.y - ghost.y;
    const od = Math.hypot(ox, oy) || 1;
    const arrow = { x: hit.x + (ox / od) * 88, y: hit.y + (oy / od) * 88 };
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(227,193,115,.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(hit.x, hit.y); ctx.lineTo(arrow.x, arrow.y); ctx.stroke();
    drawArrow(arrow.x, arrow.y, Math.atan2(oy, ox), 7, 'rgba(227,193,115,.75)');
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.beginPath(); ctx.moveTo(ghost.x, ghost.y); ctx.lineTo(hit.x, hit.y); ctx.stroke();
  } else {
    const nx = dx > 0 ? -1 : 1, ny = dy > 0 ? -1 : 1;
    ctx.strokeStyle = 'rgba(126,224,236,.32)';
    ctx.beginPath();
    if (Math.abs(dx) >= Math.abs(dy)) ctx.moveTo(end.x, end.y); else ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x + (Math.abs(dx) >= Math.abs(dy) ? nx * 120 : 0), end.y + (Math.abs(dx) >= Math.abs(dy) ? 0 : ny * 120));
    ctx.stroke();
  }
  ctx.restore();
}

function replaySandboxAfter(base, sb) {
  const snap = replayClone(base) || {};
  const r = sb.result || {};
  if (Array.isArray(r.balls) && Array.isArray(snap.balls)) {
    const map = new Map(r.balls.map((b) => [b.id, b]));
    snap.balls = snap.balls.map((b) => {
      const x = map.get(b.id);
      if (!x) return { ...b, active: false, pocketed: true };
      return { ...b, x: x.x, y: x.y, active: !!x.active, pocketed: !!x.pocketed };
    });
  }
  if (Array.isArray(r.scores)) snap.players = (snap.players || []).map((p, i) => ({ ...p, score: r.scores[i] ?? p.score }));
  if (r.nextPlayer !== undefined) snap.current = r.nextPlayer;
  if (r.winner !== undefined) snap.winner = r.winner;
  snap.ballInHand = !!r.ballInHand;
  if (Array.isArray(r.log)) snap.log = r.log.map((text) => ({ text, hl: false }));
  return snap;
}

function replayShowShot(i, animate, done) {
  if (!REPLAY_STATE) return;
  const replay = REPLAY_STATE.replay;
  const segs = REPLAY_STATE.segments || [];
  i = clamp(Math.round(i), -1, segs.length - 1);
  replayStopAnim();
  REPLAY_STATE.index = i;
  $('#replayRange').value = String(i + 1);
  $('#replayCounter').textContent = `${i < 0 ? 0 : i + 1} / ${segs.length}`;
  replayRenderInfo();
  replayRenderTrace();
  replayRenderCaption();
  renderReplayThinking();
  replayUpdateControls();
  if (i < 0) {
    REPLAY_TINT = null;
    clearReplayGuide();
    replayShowSnapshot(replay.initial);
    if (done) done();
    return;
  }
  const seg = segs[i];
  let before, after, frames, tint;
  if (seg.type === 'sandbox') {
    const sb = seg.sandbox || {};
    before = sb.before || seg.shot.before || replay.initial;
    after = replaySandboxAfter(before, sb);
    frames = (sb.result && sb.result.frames) || [];
    tint = seg.color ? seg.color.color : null;
  } else {
    const shot = seg.shot;
    before = shot.before || replay.initial;
    after = shot.after || before;
    frames = shot.frames || [];
    tint = null;
  }
  REPLAY_TINT = tint;
  replayShowSnapshot(before);
  setReplayGuide(seg);
  if (!animate) {
    replayShowSnapshot(after);
    if (done) done();
    return;
  }
  const id = ++REPLAY_STATE.anim;
  const needHold = animate && (seg.type === 'sandbox' || (seg.type === 'shot' && segs[i - 1] && segs[i - 1].type === 'sandbox'));
  const playFrames = () => {
    if (!REPLAY_ACTIVE || !REPLAY_STATE || REPLAY_STATE.anim !== id) return;
    if (frames.length < 2) {
      replayShowSnapshot(after);
      if (done) done();
      return;
    }
    const started = performance.now();
    const lastT = Math.max(1, frames[frames.length - 1].t || 1);
    const duration = clamp(lastT, 450, 3800);
    const step = (now) => {
      if (!REPLAY_ACTIVE || !REPLAY_STATE || REPLAY_STATE.anim !== id) return;
      const elapsed = now - started;
      // Each replay turn starts at half speed for its first 0.3s.
      const mapped = elapsed < 300 ? elapsed * 0.5 : elapsed - 150;
      let frame = frames[0];
      for (const f of frames) { if (f.t <= mapped + 30) frame = f; else break; }
      replayShowFrame(frame);
      if (mapped < duration) {
        requestAnimationFrame(step);
      } else {
        replayShowSnapshot(after);
        REPLAY_TINT = tint;
        if (done) done();
      }
    };
    requestAnimationFrame(step);
  };
  if (needHold) {
    REPLAY_STATE.timer = setTimeout(() => {
      if (!REPLAY_ACTIVE || !REPLAY_STATE || REPLAY_STATE.anim !== id) return;
      REPLAY_STATE.timer = 0;
      playFrames();
    }, 1000);
    return;
  }
  playFrames();
}

function replayUpdateControls() {
  if (!REPLAY_STATE) return;
  $('#replayPlay').textContent = REPLAY_STATE.playing ? 'Ⅱ' : '▶';
  $('#replayPrev').disabled = REPLAY_STATE.index < 0;
  $('#replayNext').disabled = REPLAY_STATE.index >= (REPLAY_STATE.segments || []).length - 1;
}

function replayTogglePlay() {
  if (!REPLAY_STATE) return;
  if (REPLAY_STATE.playing) {
    REPLAY_STATE.playing = false;
    replayStopAnim();
    replayUpdateControls();
    return;
  }
  if (REPLAY_STATE.index >= (REPLAY_STATE.segments || []).length - 1) {
    REPLAY_STATE.index = -1;
  }
  REPLAY_STATE.playing = true;
  replayUpdateControls();
  replayPlayNext();
}

function replayPlayNext() {
  if (!REPLAY_STATE || !REPLAY_STATE.playing) return;
  const next = REPLAY_STATE.index + 1;
  if (next >= (REPLAY_STATE.segments || []).length) {
    REPLAY_STATE.playing = false;
    replayUpdateControls();
    return;
  }
  replayShowShot(next, true, () => {
    if (!REPLAY_STATE || !REPLAY_STATE.playing) return;
    REPLAY_STATE.timer = setTimeout(() => {
      if (REPLAY_STATE && REPLAY_STATE.playing) replayPlayNext();
    }, 620);
  });
}

function replayStep(delta) {
  if (!REPLAY_STATE) return;
  REPLAY_STATE.playing = false;
  replayStopAnim();
  replayShowShot(REPLAY_STATE.index + delta, false);
}

function setReplayMode(mode) {
  if (!REPLAY_STATE) return;
  REPLAY_STATE.mode = mode;
  $$('.replay-modes button').forEach((b) => b.classList.toggle('active', b.dataset.rmode === mode));
  REPLAY_STATE.playing = false;
  replayStopAnim();
  REPLAY_STATE.segments = buildReplaySegments(REPLAY_STATE.replay, mode);
  REPLAY_STATE.index = -1;
  $('#replayRange').max = String(REPLAY_STATE.segments.length);
  $('#replayRange').value = '0';
  REPLAY_TINT = null;
  replayShowShot(-1, false);
}

function replayBallLabel(b, mode) {
  if (!b) return '';
  if (mode === 'snooker') {
    if (b.type === 'red') return '红球';
    if (b.type === 'color') return cnColor(b.colorName || '');
  }
  if (b.num === 8) return '黑八';
  return b.num ? `${b.num} 号` : (b.type || '球');
}

function replayRenderCaption() {
  const el = $('#replayCaption');
  if (!el || !REPLAY_STATE) return;
  const i = REPLAY_STATE.index;
  if (i < 0) { el.textContent = '开球前 · 按播放看这局怎么打'; return; }
  const seg = (REPLAY_STATE.segments || [])[i];
  if (!seg) { el.textContent = ''; return; }
  if (seg.type === 'sandbox') {
    const total = (seg.shot.sandbox || []).length;
    el.textContent = `沙箱试打 ${seg.ordinal + 1}/${total} · ${seg.color ? seg.color.name : ''}色 · 不是正式击球`;
  } else {
    const name = (REPLAY_STATE.replay.players && REPLAY_STATE.replay.players[seg.shot.player]) ? REPLAY_STATE.replay.players[seg.shot.player].name : seg.shot.playerName;
    el.textContent = `第 ${seg.shotIndex + 1} 杆 · ${name} 正式击球`;
  }
}

function replayRenderInfo() {
  if (!REPLAY_STATE) return;
  const el = $('#replayInfo');
  const replay = REPLAY_STATE.replay;
  const segs = REPLAY_STATE.segments || [];
  const i = REPLAY_STATE.index;
  const shots = replay.shots || [];
  if (i < 0) {
    el.innerHTML = `<div class="ri-shot">开球前 · ${shots.length} 杆对局</div>
      <div class="ri-row">${esc(modeName(replay.mode))} · ${esc(replay.opponent === 'api' ? '大模型' : replay.opponent === 'lan' ? '局域网' : replay.opponent === 'human' ? '双人' : '本地 AI')}</div>
      <div class="ri-row">点击 ▶ 开始播放；右上角切换“对局 / 对局+沙箱”。</div>`;
    return;
  }
  const seg = segs[i];
  if (!seg) return;
  if (seg.type === 'sandbox') {
    const sb = seg.sandbox || {};
    const r = sb.result || {};
    const shotNo = seg.shotIndex + 1;
    const total = (seg.shot.sandbox || []).length;
    const potted = (r.potted || []).filter((b) => b.id !== 0).map((b) => replayBallLabel(b, replay.mode)).join('、') || '无';
    const first = r.first ? replayBallLabel(r.first, replay.mode) : '未碰球';
    const nextName = (replay.players && replay.players[r.nextPlayer]) ? replay.players[r.nextPlayer].name : '—';
    el.innerHTML = `<div class="ri-shot" style="color:${seg.color ? seg.color.color : 'var(--gold)'}">沙箱试打 ${seg.ordinal + 1} / ${total} · ${seg.color ? seg.color.name : ''}色 · 第 ${shotNo} 杆</div>
      <div class="ri-row"><b>这是 AI 在试打，不是正式击球。</b></div>
      <div class="ri-row">输入：角度 <b>${replaySandboxShot(sb).angleDeg ?? '—'}°</b> · 力度 <b>${replaySandboxShot(sb).power ?? '—'}%</b></div>
      <div class="ri-row">试打结果：首碰 <b>${esc(String(first))}</b> · 进球 <b>${esc(potted)}</b></div>
      <div class="ri-row">${r.cuePotted ? '白球落袋 · ' : ''}${r.foul ? '犯规：' + esc(r.foulReason || '') : '无犯规'} · 下一位 <b>${esc(String(nextName))}</b></div>`;
    return;
  }
  const s = seg.shot;
  const p = (replay.players && replay.players[s.player]) ? replay.players[s.player].name : s.playerName;
  const potted = (s.potted || []).map((b) => replayBallLabel(b, replay.mode)).join('、') || '无';
  const nextName = (s.current != null && replay.players && replay.players[s.current]) ? replay.players[s.current].name : '—';
  const winnerName = s.winner != null ? ((replay.players[s.winner] || {}).name || ('P' + s.winner)) : '';
  el.innerHTML = `<div class="ri-shot">正式击球 · 第 ${seg.shotIndex + 1} / ${shots.length} 杆 · ${esc(p)}</div>
    <div class="ri-row">角度 <b>${s.angle == null ? '—' : (s.angle * 180 / Math.PI).toFixed(1) + '°'}</b> · 力度 <b>${Math.round((s.power || 0) * 100)}%</b></div>
    <div class="ri-row">首碰：<b>${s.first ? replayBallLabel(s.first, replay.mode) : '未碰球'}</b> · 入袋：<b>${esc(String(potted))}</b></div>
    <div class="ri-row">${s.cuePotted ? '白球落袋 · ' : ''}${s.foul ? '犯规：' + esc(s.foul) : '无犯规'}${winnerName ? ' · 胜者：' + esc(winnerName) : ' · 下一位：' + esc(String(nextName))}</div>`;
}

function replayRenderTrace() {
  if (!REPLAY_STATE) return;
  const el = $('#replayTrace');
  const i = REPLAY_STATE.index;
  if (i < 0) {
    el.innerHTML = '<div class="replay-empty">点播放后，这里会说明每杆是谁打的、AI 怎么选、沙箱试打结果。</div>';
    return;
  }
  const replay = REPLAY_STATE.replay;
  const seg = (REPLAY_STATE.segments || [])[i];
  if (!seg) return;
  const s = seg.shot;
  const showSandbox = REPLAY_STATE.mode === 'thinking';
  const ai = s.ai || [];
  const sandbox = s.sandbox || [];
  const parts = [];
  for (const ev of ai) {
    if (!ev) continue;
    if (ev.type === 'decision') {
      const act = ev.try ? '要求沙箱试打' : '直接执行';
      parts.push(`<div class="rt-line rt-ai">第 ${ev.call || '?'} 次判断 · ${act} · 角度 ${Number.isFinite(ev.angle) ? ev.angle.toFixed(1) : '—'}° · 力度 ${Number.isFinite(ev.power) ? Math.round((ev.power > 1 ? ev.power / 100 : ev.power) * 100) : '—'}%${ev.reason ? ' · ' + esc(ev.reason) : ''}${ev.sandbox ? ` · 已用沙箱 ${ev.sandbox.used}/${ev.sandbox.limit}` : ''}</div>`);
    } else if (ev.type === 'final') {
      const src = String(ev.source || '').startsWith('api:') ? '大模型最终选择' : (ev.source === 'local-fallback' ? '大模型失败，本地接管' : '本地算法最终选择');
      parts.push(`<div class="rt-line rt-ai">${src} · 角度 ${Number.isFinite(ev.angle) ? (ev.angle * 180 / Math.PI).toFixed(1) + '°' : '—'} · 力度 ${Math.round((ev.power || 0) * 100)}%${ev.reason ? ' · ' + esc(ev.reason) : ''}</div>`);
    } else if (ev.type === 'error' || ev.type === 'invalid') {
      parts.push(`<div class="rt-line rt-err">${ev.type === 'invalid' ? '输出不合法' : '模型错误'}：${esc(ev.error || '')}</div>`);
    } else if (ev.type === 'limit') {
      parts.push(`<div class="rt-line rt-err">沙箱已到上限 ${ev.limit} 次，这一杆不能再试打。</div>`);
    }
  }
  if (showSandbox) {
    const legend = SANDBOX_TINTS.map((c, n) => `<span style="color:${c.color}">● ${c.name}</span>`).join(' ');
    parts.push(`<div class="rt-line rt-legend">沙箱颜色：${legend} · 每种颜色代表一次试打</div>`);
    for (let sj = 0; sj < sandbox.length; sj++) {
      const ev = sandbox[sj];
      const color = SANDBOX_TINTS[sj % SANDBOX_TINTS.length];
      const r = ev.result || {};
      const first = r.first ? replayBallLabel(r.first, replay.mode) : '未碰球';
      const potted = (r.potted || []).filter((b) => b.id !== 0).map((b) => replayBallLabel(b, replay.mode)).join('、') || '无';
      const nextName = (replay.players && replay.players[r.nextPlayer]) ? replay.players[r.nextPlayer].name : '—';
      parts.push(`<div class="rt-line rt-sb" style="color:${color.color}">${color.name}色沙箱 #${sj + 1} · ${replaySandboxShot(ev).angleDeg != null ? replaySandboxShot(ev).angleDeg + '° / ' + replaySandboxShot(ev).power + '%' : ''} → 首碰 ${esc(String(first))} · 进球 ${esc(potted)}${r.cuePotted ? ' · 白球落袋' : ''}${r.foul ? ' · 犯规 ' + esc(r.foulReason || '') : ''} · 下一位 ${esc(String(nextName))}</div>`);
    }
  }
  if (!parts.length) {
    const who = replay.players && replay.players[s.player] ? replay.players[s.player].name : s.playerName;
    el.innerHTML = `<div class="replay-empty">这杆由 ${esc(who || '本地 AI')} 计算，没有调用大模型${showSandbox ? '，也没有沙箱试打' : '；切到“对局+沙箱”可看沙箱记录'}。</div>`;
  } else {
    el.innerHTML = `<div class="rt-head">${showSandbox ? '这杆 AI 怎么选 · 含沙箱试打' : '这杆 AI 怎么选'}</div>` + parts.join('');
  }
}

function openExportModal() {
  if (!REPLAY_STATE) { showToast('没有可导出的回放', true); return; }
  openModal('exportModal');
}

function buildExportPayload(replay, opts) {
  const out = JSON.parse(JSON.stringify(replay));
  const shots = out.shots || [];
  if (!opts.sandbox) {
    for (const shot of shots) delete shot.sandbox;
    delete out.pendingSandbox;
  }
  if (!opts.frames) {
    for (const shot of shots) {
      delete shot.frames;
      for (const sb of (shot.sandbox || [])) {
        if (sb.result) delete sb.result.frames;
      }
    }
  }
  const calls = Array.isArray(out.apiCalls) ? out.apiCalls : [];
  if (!opts.api && !opts.thinking) {
    delete out.apiCalls;
  } else {
    for (const c of calls) {
      if (!opts.thinking) { delete c.reasoning; }
      if (!opts.api) {
        delete c.request;
        delete c.responseText;
        delete c.output;
        delete c.usage;
        delete c.status;
        delete c.attempt;
      }
    }
    out.apiCalls = calls;
  }
  out.exportOptions = {
    match: true,
    sandbox: !!opts.sandbox,
    thinking: !!opts.thinking,
    api: !!opts.api,
    frames: !!opts.frames,
    exportedAt: new Date().toISOString(),
  };
  return out;
}

async function exportReplay() {
  if (!REPLAY_STATE) return;
  const replay = REPLAY_STATE.replay;
  const opts = {
    sandbox: !!($('#exportSandbox') && $('#exportSandbox').checked),
    thinking: !!($('#exportThinking') && $('#exportThinking').checked),
    api: !!($('#exportApi') && $('#exportApi').checked),
    frames: !!($('#exportFrames') && $('#exportFrames').checked),
  };
  const json = JSON.stringify(buildExportPayload(replay, opts), null, 2);
  const d = new Date(replay.createdAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const name = `yigan-replay-${stamp}-export.json`;
  const res = await pickSaveFile(name, json, 'application/json');
  if (!res.ok) {
    if (res.error !== 'canceled') showToast('导出失败：' + (res.error || '未选择位置'), true);
    return;
  }
  showToast('已导出：' + (res.name || name));
}

async function saveEncryptedArchive() {
  if (!REPLAY_STATE) { showToast('没有可保存的回放', true); return; }
  const password = await askPassword('保存加密存档', '设置一个密码。完整沙箱、模型思考、API 调用都会保留。');
  if (!password) return;
  if (String(password).length < 4) { showToast('密码至少 4 位', true); return; }
  try {
    const compact = !!($('#archiveCompact') && $('#archiveCompact').checked);
    const replay = compact ? compactReplay(REPLAY_STATE.replay) : REPLAY_STATE.replay;
    const text = JSON.stringify(replay);
    const encrypted = await encryptReplayText(text, String(password));
    const d = new Date(replay.createdAt);
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const res = await pickSaveFile(`yigan-replay-${stamp}${compact ? '-compact' : ''}.yigan`, encrypted, 'application/octet-stream');
    if (!res.ok) {
      if (res.error !== 'canceled') showToast('存档失败：' + (res.error || '未选择位置'), true);
      return;
    }
    showToast('加密存档已保存：' + (res.name || ''));
  } catch (e) {
    showToast('存档加密失败：' + (e && e.message ? e.message : e), true);
  }
}

async function importReplayArchive() {
  const file = await pickOpenFile('*/*');
  if (!file.ok) {
    if (file.error !== 'canceled') showToast('导入失败：' + (file.error || '无法读取'), true);
    return;
  }
  try {
    let text = file.text || '';
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('不是 JSON 存档'); }
    if (obj && obj.format === 'yigan-replay-encrypted') {
      const password = await askPassword('解密回放存档', '输入保存时设置的密码。');
      if (!password) return;
      text = await decryptReplayText(text, String(password));
      obj = JSON.parse(text);
    }
    if (!obj || obj.format !== 'yigan-replay' || !Array.isArray(obj.shots)) {
      throw new Error('不是有效的回放存档');
    }
    expandCompactReplay(obj);
    obj.archiveName = '';
    obj.importedAt = new Date().toISOString();
    REPLAYS.push(obj);
    REPLAYS.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (REPLAYS.length > 30) REPLAYS.splice(0, REPLAYS.length - 30);
    archiveReplay(obj);
    updateReplayUI();
    closeModal('exportModal');
    if (REPLAY_ACTIVE && REPLAY_STATE) {
      REPLAY_STATE.list = replayListAll();
      $('#replaySelect').innerHTML = REPLAY_STATE.list.map((r, i) => {
        const d = new Date(r.createdAt);
        const date = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        return `<option value="${i}">${esc(date)} · ${esc(modeName(r.mode))} · ${r.shots.length}杆</option>`;
      }).join('');
      $('#replaySelect').value = String(REPLAY_STATE.list.length - 1);
      replayLoad(REPLAY_STATE.list[REPLAY_STATE.list.length - 1]);
    } else {
      openReplay();
    }
    showToast('存档已导入');
  } catch (e) {
    showToast('导入失败：' + (e && e.message ? e.message : e), true);
  }
}

function bindReplay() {
  $('#menuReplay').addEventListener('click', openReplay);
  $('#replayClose').addEventListener('click', closeReplay);
  $('#replayPlay').addEventListener('click', replayTogglePlay);
  $('#replayPrev').addEventListener('click', () => replayStep(-1));
  $('#replayNext').addEventListener('click', () => replayStep(1));
  $('#replayRange').addEventListener('input', (e) => {
    if (!REPLAY_STATE) return;
    REPLAY_STATE.playing = false;
    replayStopAnim();
    replayShowShot(Number(e.target.value) - 1, false);
  });
  $$('.replay-modes button').forEach((b) => b.addEventListener('click', () => setReplayMode(b.dataset.rmode)));
  $('#replaySelect').addEventListener('change', (e) => {
    if (!REPLAY_STATE) return;
    const idx = Number(e.target.value);
    const r = REPLAY_STATE.list[idx];
    if (r) { REPLAY_STATE.playing = false; replayStopAnim(); replayLoad(r); }
  });
  $('#replayGuide').addEventListener('click', () => {
    REPLAY_GUIDE_ENABLED = !REPLAY_GUIDE_ENABLED;
    $('#replayGuide').classList.toggle('active', REPLAY_GUIDE_ENABLED);
    if (!REPLAY_GUIDE_ENABLED) clearReplayGuide();
    else if (REPLAY_STATE && REPLAY_STATE.index >= 0) setReplayGuide((REPLAY_STATE.segments || [])[REPLAY_STATE.index]);
    showToast(REPLAY_GUIDE_ENABLED ? '辅助线已开启' : '辅助线已关闭');
  });
  $('#replayExport').addEventListener('click', openExportModal);
  $('#exportGo').addEventListener('click', () => { exportReplay(); closeModal('exportModal'); });
  $('#archiveSave').addEventListener('click', saveEncryptedArchive);
  $('#archiveImport').addEventListener('click', importReplayArchive);
  $('#passwordOk').addEventListener('click', () => finishPassword($('#passwordInput').value));
  $('#passwordCancel').addEventListener('click', () => finishPassword(null));
  $('#passwordCancel2').addEventListener('click', () => finishPassword(null));
  $('#passwordInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') finishPassword($('#passwordInput').value); });
  $('#replayThinkShow').addEventListener('click', () => setReplayThinkMode('show'));
  $('#replayThinkHide').addEventListener('click', () => setReplayThinkMode('hide'));
  $('#replayThinkTranslate').addEventListener('click', () => setReplayThinkMode('translate'));
  $('#replayThinkClose').addEventListener('click', () => setReplayThinkMode('hide'));
  $('#overReplay').addEventListener('click', () => {
    $('#overModal').classList.remove('show');
    openReplay();
  });
}

/* ============================================================
   开发者终端 $shell / #root
   仅游戏内控制台，不涉及 Android 系统权限。
   ============================================================ */
const APP_VERSION = '1.4.46';
const ROOT_TOTP_SECRET = 'W7C2KZRUDJR5WZ7ZAO6O57OUIAQWJYCS';
const ROOT_TOTP_PERIOD = 100; // seconds
const ROOT_UNLOCK_MS = 30 * 60 * 1000;
const PHYS_DEFAULTS = { friction: 470, cushion: 0.79, ballE: 0.945, capture: 0.82, contain: 0.9 };
const DEV = {
  rootUntil: 0,
  pendingRoot: false,
  taps: 0,
  tapTimer: 0,
  history: [],
  historyIndex: 0,
  consoleSnapshot: null,
  consolePhys: null,
  consoleShellAI: null,
  consoleAiLevel: null,
  consoleThinkLimit: null,
  consoleThinkOverride: null,
  consoleSandboxUsed: null,
};

/* ---- RFC 6238 TOTP (player brings their own authenticator) ---- */
function rotl32(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }
function sha1Bytes(bytes) {
  const ml = bytes.length * 8;
  const total = (((bytes.length + 9) + 63) >> 6) << 6;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor(ml / 0x100000000) >>> 0, false);
  dv.setUint32(total - 4, ml >>> 0, false);
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const w = new Uint32Array(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 80; i++) w[i] = rotl32(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | ((~b) & d); k = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const tmp = (rotl32(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl32(b, 30); b = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, h0, false); odv.setUint32(4, h1, false);
  odv.setUint32(8, h2, false); odv.setUint32(12, h3, false);
  odv.setUint32(16, h4, false);
  return out;
}
function hmacSha1(key, msg) {
  let k = key;
  if (k.length > 64) k = sha1Bytes(k);
  const ipad = new Uint8Array(64 + msg.length);
  const opad = new Uint8Array(64 + 20);
  for (let i = 0; i < 64; i++) ipad[i] = (k[i] || 0) ^ 0x36;
  ipad.set(msg, 64);
  const inner = sha1Bytes(ipad);
  for (let i = 0; i < 64; i++) opad[i] = (k[i] || 0) ^ 0x5c;
  opad.set(inner, 64);
  return sha1Bytes(opad);
}
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input).toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}
function totpAt(secret, timeMs) {
  const key = base32Decode(secret);
  const counter = Math.floor(timeMs / 1000 / ROOT_TOTP_PERIOD);
  const msg = new Uint8Array(8);
  const dv = new DataView(msg.buffer);
  dv.setUint32(4, counter >>> 0, false);
  const h = hmacSha1(key, msg);
  const off = h[h.length - 1] & 0x0f;
  const bin = (((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]) >>> 0;
  return String(bin % 1000000).padStart(6, '0');
}
function totpVerify(secret, code, timeMs = Date.now()) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  for (const step of [-1, 0, 1]) {
    if (totpAt(secret, timeMs + step * ROOT_TOTP_PERIOD * 1000) === c) return true;
  }
  return false;
}

/* ---- terminal ---- */
function devEnabled() { return !!(S.developer); }
function rootActive() { return Date.now() < DEV.rootUntil; }
function lanOnline() { return !!(G && G.net); }
function shellAllowed() { return devEnabled() && !lanOnline(); }
function rootAllowed() { return rootActive() && (!lanOnline() || G.net.role === 'host'); }
function termLine(text, cls = '') {
  const log = $('#termLog');
  if (!log) return;
  const div = document.createElement('div');
  div.className = 'term-line ' + cls;
  const span = document.createElement('span');
  span.className = 'p';
  span.textContent = cls === 'cmd' ? (rootActive() ? '#' : '$') : '';
  div.appendChild(span);
  div.appendChild(document.createTextNode(String(text)));
  log.appendChild(div);
  while (log.children.length > 220) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}
function termEcho(cmd) {
  const log = $('#termLog');
  if (!log) return;
  const div = document.createElement('div');
  div.className = 'term-line cmd';
  const p = document.createElement('span');
  p.className = 'p' + (rootAllowed() ? ' root' : '');
  p.textContent = DEV.pendingRoot ? 'code>' : (rootAllowed() ? '#' : '$');
  div.appendChild(p);
  div.appendChild(document.createTextNode(cmd));
  log.appendChild(div);
  while (log.children.length > 220) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}
function termPromptUpdate() {
  const prompt = DEV.pendingRoot ? 'code>' : (rootAllowed() ? '#' : '$');
  const p = $('#termPrompt');
  if (p) { p.textContent = prompt; p.classList.toggle('root', rootAllowed()); }
  const title = $('#termTitle');
  if (title) title.textContent = rootAllowed() ? '#root' : '$shell';
  const hint = $('#termHint');
  if (hint) hint.textContent = DEV.pendingRoot ? '输入 6 位 TOTP 验证码 · 100 秒周期' : lanOnline() ? (G.net.role === 'host' ? '联机房主 · shell 不生效，root 可用' : '联机客机 · shell/root 不生效') : (rootAllowed() ? 'root 已解锁 · 输入 help' : '开发者模式 · 输入 #root 获取更高权限');
  const meta = document.querySelector('.term-meta');
  if (meta) meta.textContent = 'UTF-8 · 100s TOTP';
}
function termBanner() {
  if ($('#termLog').children.length) return;
  termLine(`一杆清台 ${APP_VERSION} · 游戏内控制台（非系统 shell/root）`, 'dim');
  termLine('输入 help 查看命令；输入 #root 进入 root 模式。', 'dim');
  if (lanOnline()) {
    termLine(G.net.role === 'host' ? '联机模式：$shell 全部不生效；#root 仅房主可用。' : '联机模式：$shell 不生效，root 仅房主可用。', 'err');
  }
}
function openTerminal() {
  if (!devEnabled()) { showToast('需要先在设置里开启开发者模式', true); return; }
  DEV.pendingRoot = false;
  DEV.consoleSnapshot = (G && !lanOnline() && G.phase !== 'shooting') ? gameSnapshot() : null;
  DEV.consolePhys = { ...PHYS };
  DEV.consoleShellAI = G ? { ...G.shellAI } : null;
  DEV.consoleAiLevel = G ? { ...G.aiLevel } : null;
  DEV.consoleThinkLimit = G ? G.aiThinkLimit : null;
  DEV.consoleThinkOverride = AI_THINK_OVERRIDE;
  DEV.consoleSandboxUsed = G ? (Array.isArray(G.aiSandboxUsed) ? [...G.aiSandboxUsed] : (G.aiSandboxUsed || 0)) : 0;
  openModal('terminalModal');
  termBanner();
  termPromptUpdate();
  setTimeout(() => { const i = $('#termInput'); if (i) i.focus(); }, 80);
}
function updateDevUI() {
  const dev = devEnabled();
  const menuTerm = $('#menuTerm');
  if (menuTerm) menuTerm.hidden = !dev;
  const openBtn = $('#devOpenTerm');
  if (openBtn) openBtn.hidden = !dev;
  const state = $('#devState');
  if (state) {
    state.textContent = dev ? '开发者模式已开启' : '开发者模式未开启';
    state.classList.toggle('on', dev);
  }
  const ver = $('#versionTap');
  if (ver) ver.textContent = 'v' + APP_VERSION;
}
function handleVersionTap() {
  if (devEnabled()) { showToast('开发者模式已开启 · 菜单 → 开发者终端'); return; }
  DEV.taps++;
  clearTimeout(DEV.tapTimer);
  DEV.tapTimer = setTimeout(() => { DEV.taps = 0; }, 4000);
  if (DEV.taps >= 7) {
    DEV.taps = 0;
    S.developer = true;
    saveSettings();
    updateDevUI();
    showToast('开发者模式已开启：菜单 → 开发者终端');
    vibrate(20);
  } else {
    showToast(`再点 ${7 - DEV.taps} 次开启开发者模式`);
  }
}

function findConsoleBall(token) {
  if (!G) return null;
  const t = String(token || '').toLowerCase();
  if (t === 'cue') return cueBall();
  if (/^#\d+$/.test(t)) return G.balls.find((b) => b.id === Number(t.slice(1)));
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return G.balls.find((b) => b.active && b.num === n) || G.balls.find((b) => b.num === n);
  }
  return null;
}
const TERM_READONLY = new Set(['help', 'clear', 'exit', 'quit', 'status', 'balls', 'shell', '$shell']);
const TERM_ROOT_CMDS = new Set(['physics', 'set', 'shoot', 'speed', 'freeze', 'radius', 'resetphysics', 'dev']);

function termDeniedMessage() {
  if (!lanOnline()) return '需要开发者模式';
  if (G.net.role === 'guest') return '联机客机：shell 不生效，root 仅房主可用。';
  if (!rootAllowed()) return '联机房主：shell 不生效，输入 #root 解锁 root。';
  return '联机中 shell 不生效；这里只能使用 root 命令。';
}

function setShellAi(p, on, level) {
  if (!G || (p !== 0 && p !== 1)) return;
  G.shellAI[p] = !!on;
  if (level) { G.aiLevel[p] = level; if (G.seats && G.seats[p]) G.seats[p].difficulty = level; }
  if (!on && G.current === p) {
    clearTimeout(aiTimer);
    G.aiThinking = false;
    G.aiRetry = 0;
    if (G.phase !== 'shooting' && G.phase !== 'over') G.phase = 'aim';
  }
  updateHUD();
  if (isAI(G.current)) maybeAi();
}

function rootTouched() {
  if (G && G.net && G.net.role === 'host') lanQueueStateSoon(120);
}

function consoleHelp() {
  if (lanOnline()) {
    termLine(G.net.role === 'host' ? '联机模式：$shell 不生效；root 命令仅房主可用。' : '联机模式：shell/root 均不生效。', 'err');
  } else {
    termLine('shell 命令：', 'ok');
    termLine('  status / balls / aim <度> / power <10-100> / turn <0|1>');
    termLine('  score <0|1> <分> / ballinhand <0|1>');
    termLine('  player <0|1> name|score|group|ai|level ...');
    termLine('  command <0|1> <命令> / ai <0|1> <on|off|easy|normal|master>');
    termLine('  move <cue|号码|#id> <x> <y> / pocket <球> / respot <球>');
    termLine('  mode <8ball|9ball|10ball|rotation|snooker|snooker6> / reset / resetmods');
    termLine('  win <0|1> / clear / exit');
  }
  if (rootAllowed()) {
    termLine('root 命令：', 'ok');
    termLine('  physics / set <friction|cushion|ballE|capture|contain|aiThink> <值>');
    termLine('  shoot <度> <10-100> / speed <球> <vx> <vy> / freeze');
    termLine('  radius <6-18> / resetphysics');
  } else if (!lanOnline() || G.net.role === 'host') {
    termLine('  #root  （需要 100 秒周期 TOTP 验证码）', 'dim');
  }
}
function consoleStatus() {
  termLine(`${modeName()} | 回合 ${G.current} | 阶段 ${G.phase} | R ${G.R}`, 'ok');
  termLine(`比分 ${G.players[0].score}:${G.players[1].score} | 球权 ${G.ballInHand ? '自由球' : '正常'} | 开球 ${G.breakShot ? '是' : '否'}`);
  termLine(`AI P0=${isAI(0) ? 'ON' : 'off'}(${G.aiLevel[0]}) P1=${isAI(1) ? 'ON' : 'off'}(${G.aiLevel[1]}) · 思考轮数 ${aiThinkRounds()}${G.aiThinkLimit === null ? '' : ' (root覆盖)'}`, 'dim');
  termLine(`物理 friction=${PHYS.friction} cushion=${PHYS.cushion} ballE=${PHYS.ballE} capture=${PHYS.capture} contain=${PHYS.contain}`, 'dim');
}
function consoleBalls() {
  const list = G.balls.filter((b) => b.active).map((b) => `${b.id === 0 ? 'cue' : (b.num || b.type)}@${Math.round(b.x)},${Math.round(b.y)}`).join('  ');
  termLine(list || '无球', 'dim');
}

function restoreConsoleSnapshot() {
  if (!G || !DEV.consoleSnapshot) return false;
  if (G.net) return false;
  const snap = DEV.consoleSnapshot;
  G.mode = snap.mode || G.mode;
  G.R = snap.R || G.R;
  G.balls = (snap.balls || []).map((b) => ({ ...b, vx: 0, vy: 0 }));
  G.balls.rackApexId = G.balls[0] ? G.balls[0].id : undefined;
  if (snap.seats) G.seats = snap.seats.map((s) => ({ ...s }));
  G.players = (snap.players || []).map((p) => ({ ...p, isAI: false }));
  G.current = snap.current === 1 ? 1 : 0;
  G.phase = snap.phase === 'shooting' ? 'aim' : (snap.phase || 'aim');
  G.winner = snap.winner === undefined ? null : snap.winner;
  G.overReason = snap.overReason || '';
  G.breakShot = !!snap.breakShot;
  G.openTable = !!snap.openTable;
  G.ballInHand = !!snap.ballInHand;
  G.freeBallDrag = false;
  G.snooker = snap.snooker ? { ...snap.snooker } : null;
  if (snap.physics) Object.assign(PHYS, snap.physics);
  G.log = Array.isArray(snap.log) ? snap.log.slice(-10) : [];
  G.power = 0.1;
  G.fineDelta = 0;
  G.aiThinking = false;
  G.aiPlan = null;
  G.aimHint = null;
  G.pocketAnims = [];
  G.draggingCue = false;
  G.firstContact = null;
  G.pottedThisShot = [];
  G.resolvePending = false;
  if (DEV.consoleShellAI) G.shellAI = { ...DEV.consoleShellAI };
  if (DEV.consoleAiLevel) G.aiLevel = { ...DEV.consoleAiLevel };
  G.aiThinkLimit = DEV.consoleThinkLimit;
  AI_THINK_OVERRIDE = DEV.consoleThinkOverride;
  G.aiSandboxUsed = DEV.consoleSandboxUsed === null ? [0, 0] : (Array.isArray(DEV.consoleSandboxUsed) ? [...DEV.consoleSandboxUsed] : DEV.consoleSandboxUsed);
  clearTimeout(aiTimer);
  G.aiThinking = false;
  G.aiRetry = 0;
  Object.assign(PHYS, DEV.consolePhys || PHYS_DEFAULTS);
  tableCache = null;
  const cue = cueBall();
  if (cue) G.lastValidCue = { x: cue.x, y: cue.y };
  const targets = legalTargets();
  if (cue && cue.active && targets.length) G.aimAngle = Math.atan2(targets[0].y - cue.y, targets[0].x - cue.x);
  updateHUD();
  if (G.phase === 'over') showOver(); else $('#overModal').classList.remove('show');
  if (isAI(G.current)) setTimeout(() => maybeAi(), 120);
  return true;
}

function runTerminalCommand(raw) {
  termPromptUpdate();
  if (!G) { termLine('当前没有对局', 'err'); return; }
  const cmd = raw.trim();
  if (!cmd) return;
  termEcho(cmd);
  DEV.history.push(cmd);
  DEV.historyIndex = DEV.history.length;

  if (DEV.pendingRoot) {
    if (totpVerify(ROOT_TOTP_SECRET, cmd)) {
      DEV.rootUntil = Date.now() + ROOT_UNLOCK_MS;
      DEV.pendingRoot = false;
      termLine('root 验证通过，已解锁 30 分钟。', 'ok');
    } else {
      DEV.pendingRoot = false;
      termLine('TOTP 验证失败。', 'err');
    }
    termPromptUpdate();
    return;
  }

  const m = cmd.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const name = (m ? m[1] : '').toLowerCase();
  const args = m && m[2] ? m[2].trim().split(/\s+/) : [];

  if (name === '#root' || (name === 'root' && !args.length)) {
    if (lanOnline() && G.net.role !== 'host') { termLine('root 仅房主可用。', 'err'); return; }
    if (rootActive()) { termLine('已经是 root。', 'dim'); return; }
    DEV.pendingRoot = true;
    termLine('输入 6 位 TOTP 验证码（100 秒周期）。', 'dim');
    termPromptUpdate();
    return;
  }
  if (name === 'root' && args.length) {
    if (lanOnline() && G.net.role !== 'host') { termLine('root 仅房主可用。', 'err'); return; }
    if (totpVerify(ROOT_TOTP_SECRET, args[0])) {
      DEV.rootUntil = Date.now() + ROOT_UNLOCK_MS;
      termLine('root 验证通过，已解锁 30 分钟。', 'ok');
    } else {
      termLine('TOTP 验证失败。', 'err');
    }
    termPromptUpdate();
    return;
  }
  if (lanOnline() && !TERM_READONLY.has(name)) {
    const allowedRoot = TERM_ROOT_CMDS.has(name) && rootAllowed();
    if (!allowedRoot) { termLine(termDeniedMessage(), 'err'); return; }
  }
  if (!lanOnline() && !shellAllowed()) { termLine('需要开发者模式', 'err'); return; }

  if (name === 'help') { consoleHelp(); return; }
  if (name === 'clear') { $('#termLog').innerHTML = ''; return; }
  if (name === 'exit' || name === 'quit') { closeModal('terminalModal'); return; }
  if (name === 'status') { consoleStatus(); return; }
  if (name === 'balls') { consoleBalls(); return; }
  if (name === 'shell' || name === '$shell') { termLine('当前已是 shell。输入 #root 提权。', 'dim'); return; }

  if (name === 'aim') {
    const deg = Number(args[0]);
    if (!Number.isFinite(deg)) { termLine('用法：aim <角度>', 'err'); return; }
    G.aimAngle = deg * Math.PI / 180;
    termLine(`瞄准角 ${deg}°`, 'ok');
    return;
  }
  if (name === 'power') {
    const p = Number(args[0]);
    if (!Number.isFinite(p)) { termLine('用法：power <10-100>', 'err'); return; }
    G.power = clamp(p / 100, 0.1, 1);
    updatePowerUI();
    termLine(`力度 ${Math.round(G.power * 100)}`, 'ok');
    return;
  }
  if (name === 'turn') {
    const p = Number(args[0]);
    if (p !== 0 && p !== 1) { termLine('用法：turn <0|1>', 'err'); return; }
    G.current = p;
    updateHUD();
    termLine(`轮到玩家 ${p}`, 'ok');
    return;
  }
  if (name === 'score') {
    const p = Number(args[0]), n = Number(args[1]);
    if ((p !== 0 && p !== 1) || !Number.isFinite(n)) { termLine('用法：score <0|1> <分>', 'err'); return; }
    G.players[p].score = n;
    updateHUD();
    termLine(`玩家 ${p} 分数 ${n}`, 'ok');
    return;
  }
  if (name === 'ballinhand') {
    const on = args[0] === undefined ? true : (args[0] === '1' || args[0] === 'on');
    G.ballInHand = on;
    G.phase = on ? 'ballInHand' : 'aim';
    if (on) prepareCueForHand();
    updateHUD();
    termLine(on ? '已开启自由球' : '已关闭自由球', 'ok');
    return;
  }
  if (name === 'move') {
    const b = findConsoleBall(args[0]);
    const x = Number(args[1]), y = Number(args[2]);
    if (!b || !Number.isFinite(x) || !Number.isFinite(y)) { termLine('用法：move <cue|号码|#id> <x> <y>', 'err'); return; }
    b.active = true; b.pocketed = false;
    b.x = clamp(x, TABLE.x + G.R, TABLE.x + TABLE.w - G.R);
    b.y = clamp(y, TABLE.y + G.R, TABLE.y + TABLE.h - G.R);
    b.vx = 0; b.vy = 0;
    updateHUD();
    termLine(`移动 ${b.id === 0 ? '白球' : b.num || b.type} 到 ${Math.round(b.x)},${Math.round(b.y)}`, 'ok');
    return;
  }
  if (name === 'pocket') {
    const b = findConsoleBall(args[0]);
    if (!b) { termLine('找不到球', 'err'); return; }
    b.active = false; b.pocketed = true; b.vx = 0; b.vy = 0;
    updateHUD();
    termLine(`已移除 ${b.id === 0 ? '白球' : b.num || b.type}`, 'ok');
    return;
  }
  if (name === 'respot') {
    const b = findConsoleBall(args[0]);
    if (!b) { termLine('找不到球', 'err'); return; }
    respotBall(b);
    updateHUD();
    termLine('已重摆', 'ok');
    return;
  }
  if (name === 'mode') {
    const mode = (args[0] || '').toLowerCase();
    if (!['8ball', '9ball', '10ball', 'rotation', 'snooker', 'snooker6'].includes(mode)) { termLine('用法：mode <8ball|9ball|10ball|rotation|snooker|snooker6>', 'err'); return; }
    if (G.net) { termLine('联机中不能切换模式', 'err'); return; }
    newGame({ mode, seats: G.seats });
    termLine(`新一局：${modeName()}`, 'ok');
    return;
  }
  if (name === 'reset') {
    if (G.net) { termLine('联机中不能重置', 'err'); return; }
    newGame({ mode: G.mode, seats: G.seats });
    termLine('已重新开局', 'ok');
    return;
  }
  if (name === 'player') {
    const p = Number(args[0]);
    if (p !== 0 && p !== 1) { termLine('用法：player <0|1> name|score|group|ai|level ...', 'err'); return; }
    const action = (args[1] || 'show').toLowerCase();
    const value = args.slice(2).join(' ');
    const pl = G.players[p];
    if (action === 'name') {
      if (!value) { termLine('用法：player <0|1> name <名字>', 'err'); return; }
      pl.name = value.slice(0, 20);
    } else if (action === 'score') {
      const n = Number(value);
      if (!Number.isFinite(n)) { termLine('用法：player <0|1> score <分>', 'err'); return; }
      pl.score = n;
    } else if (action === 'group') {
      if (G.mode !== '8ball') { termLine('只有八球有分组', 'err'); return; }
      const g = value.toLowerCase();
      if (!['solid', 'stripe', 'none'].includes(g)) { termLine('用法：player <0|1> group solid|stripe|none', 'err'); return; }
      pl.group = g === 'none' ? null : g;
      if (g !== 'none') G.players[1 - p].group = g === 'solid' ? 'stripe' : 'solid';
      G.openTable = !G.players[0].group && !G.players[1].group;
    } else if (action === 'ai') {
      const v = value.toLowerCase();
      if (!['on', 'off', '1', '0'].includes(v)) { termLine('用法：player <0|1> ai on|off', 'err'); return; }
      const on = v === 'on' || v === '1';
      setShellAi(p, on);
      termLine(`玩家 ${p} AI ${on ? '开启' : '关闭'}`, 'ok');
      return;
    } else if (action === 'level') {
      const lvl = value.toLowerCase();
      if (!['easy', 'normal', 'master'].includes(lvl)) { termLine('用法：player <0|1> level easy|normal|master', 'err'); return; }
      G.aiLevel[p] = lvl;
      if (G.seats && G.seats[p]) G.seats[p].difficulty = lvl;
      updateHUD();
      termLine(`玩家 ${p} AI 等级 ${lvl}`, 'ok');
      return;
    } else if (action === 'think') {
      const lvl = value.toLowerCase();
      if (THINK_LEVELS[lvl] === undefined) { termLine('用法：player <0|1> think none|low|high|max', 'err'); return; }
      if (G.seats && G.seats[p]) G.seats[p].thinkLevel = lvl;
      if (G.aiLevel) G.aiLevel[p] = seatDifficulty(p);
      updateHUD();
      termLine(`玩家 ${p} 思考等级 ${THINK_LABELS[lvl]}`, 'ok');
      return;
    } else if (action !== 'show') {
      termLine('用法：player <0|1> name|score|group|ai|level|show', 'err'); return;
    }
    updateHUD();
    termLine(`P${p} ${pl.name} · ${pl.score}分 · ${isAI(p) ? 'AI' : '玩家'} · ${G.aiLevel[p]}`, 'ok');
    return;
  }

  if (name === 'command') {
    const p = Number(args[0]);
    const rest = args.slice(1).join(' ');
    if ((p !== 0 && p !== 1) || !rest) { termLine('用法：command <0|1> <shell 命令>', 'err'); return; }
    if (rest.toLowerCase().startsWith('command ')) { termLine('不能嵌套 command', 'err'); return; }
    G.current = p;
    updateHUD();
    termLine(`以玩家 ${p} 身份执行`, 'dim');
    runTerminalCommand(rest);
    return;
  }

  if (name === 'ai') {
    if (args[0] === '0' || args[0] === '1') {
      const p = Number(args[0]);
      const action = (args[1] || 'show').toLowerCase();
      if (action === 'show') {
        termLine(`玩家 ${p} AI=${isAI(p) ? 'ON' : 'OFF'} · 等级 ${G.aiLevel[p]}`, 'ok');
        return;
      }
      if (action === 'on' || action === 'off') {
        setShellAi(p, action === 'on');
        termLine(`玩家 ${p} AI ${action === 'on' ? '开启' : '关闭'}`, 'ok');
        return;
      }
      if (['easy', 'normal', 'master'].includes(action)) {
        setShellAi(p, true, action);
        termLine(`玩家 ${p} AI 开启 · 等级 ${action}`, 'ok');
        return;
      }
      termLine('用法：ai <0|1> on|off|easy|normal|master', 'err');
      return;
    }
    const d = args[0];
    if (!['easy', 'normal', 'master'].includes(d)) { termLine('用法：ai <0|1> <on|off|easy|normal|master> 或 ai <easy|normal|master>', 'err'); return; }
    G.difficulty = d; S.difficulty = d; G.aiLevel[0] = d; G.aiLevel[1] = d; if (G.seats) G.seats.forEach((seat) => seat.difficulty = d); saveSettings();
    updateHUD();
    termLine(`AI 难度 ${d}`, 'ok');
    return;
  }
  if (name === 'win') {
    const p = Number(args[0]);
    if (p !== 0 && p !== 1) { termLine('用法：win <0|1>', 'err'); return; }
    endGame(p, `调试：玩家 ${p} 获胜`);
    termLine(`已判定玩家 ${p} 获胜`, 'ok');
    return;
  }

  if (name === 'resetmods' || name === 'undo') {
    if (G.net) { termLine('联机中不能重置本地修改', 'err'); return; }
    if (!DEV.consoleSnapshot) { termLine('没有可用快照（开终端时球在滚动），请用 reset 开新局。', 'err'); return; }
    if (restoreConsoleSnapshot()) termLine('已还原：打开终端前的球局与物理参数。', 'ok');
    else termLine('还原失败', 'err');
    return;
  }

  if (!rootAllowed()) {
    if (['physics', 'set', 'shoot', 'speed', 'freeze', 'radius', 'resetphysics', 'dev'].includes(name)) {
      termLine('需要 root：输入 #root 并通过 TOTP 验证。', 'err');
      return;
    }
    termLine(`未知命令：${name}。输入 help。`, 'err');
    return;
  }

  // root commands
  if (name === 'physics') { consoleStatus(); return; }
  if (name === 'resetphysics') {
    Object.assign(PHYS, PHYS_DEFAULTS);
    termLine('物理参数已恢复默认', 'ok');
    rootTouched();
    return;
  }
  if (name === 'set') {
    const key = args[0], val = Number(args[1]);
    if (!key || !Number.isFinite(val)) { termLine('用法：set <friction|cushion|ballE|capture|contain|aiThink> <值>', 'err'); return; }
    if (key === 'aiThink' || key === 'aithink') {
      G.aiThinkLimit = clamp(Math.floor(val), 0, 10);
      AI_THINK_OVERRIDE = G.aiThinkLimit;
      termLine(`AI 思考轮数上限 = ${G.aiThinkLimit}`, 'ok');
      return;
    }
    if (key === 'friction') PHYS.friction = clamp(val, 0, 5000);
    else if (key === 'cushion') PHYS.cushion = clamp(val, 0, 1.2);
    else if (key === 'ballE') PHYS.ballE = clamp(val, 0, 1.2);
    else if (key === 'capture') PHYS.capture = clamp(val, 0.1, 1.5);
    else if (key === 'contain') PHYS.contain = clamp(val, 0.1, 1.5);
    else { termLine('未知物理项', 'err'); return; }
    termLine(`${key} = ${Number(PHYS[key]).toFixed(3)}`, 'ok');
    rootTouched();
    return;
  }
  if (name === 'shoot') {
    const deg = Number(args[0]), p = Number(args[1]);
    if (!Number.isFinite(deg) || !Number.isFinite(p)) { termLine('用法：shoot <度> <10-100>', 'err'); return; }
    G.aimAngle = deg * Math.PI / 180;
    G.power = clamp(p / 100, 0.1, 1);
    G.ballInHand = false; G.phase = 'aim';
    const ok = shoot(true);
    termLine(ok ? '已强制击球' : '无法击球', ok ? 'ok' : 'err');
    return;
  }
  if (name === 'speed') {
    const b = findConsoleBall(args[0]);
    const vx = Number(args[1]), vy = Number(args[2]);
    if (!b || !Number.isFinite(vx) || !Number.isFinite(vy)) { termLine('用法：speed <球> <vx> <vy>', 'err'); return; }
    resetShotTracking();
    G.phase = 'shooting';
    G.shotActive = true;
    b.vx = vx; b.vy = vy;
    termLine('已施加速度', 'ok');
    rootTouched();
    return;
  }
  if (name === 'freeze') {
    for (const b of G.balls) { b.vx = 0; b.vy = 0; }
    G.phase = 'aim'; G.resolvePending = false;
    updateHUD();
    termLine('已冻结所有球', 'ok');
    rootTouched();
    return;
  }
  if (name === 'radius') {
    const r = Number(args[0]);
    if (!Number.isFinite(r) || r < 6 || r > 18) { termLine('用法：radius <6-18>', 'err'); return; }
    G.R = r;
    clampBallsToTable();
    tableCache = null;
    updateHUD();
    termLine(`球半径 = ${r}`, 'ok');
    rootTouched();
    return;
  }
  if (name === 'dev') {
    if (args[0] === 'off') {
      S.developer = false; saveSettings(); updateDevUI(); closeModal('terminalModal'); showToast('开发者模式已关闭');
    } else {
      termLine('用法：dev off', 'dim');
    }
    return;
  }
  termLine(`未知命令：${name}。输入 help。`, 'err');
}

function bindTerminal() {
  $('#versionTap').addEventListener('click', handleVersionTap);
  $('#devOpenTerm').addEventListener('click', openTerminal);
  $('#menuTerm').addEventListener('click', openTerminal);
  $('#termRun').addEventListener('click', () => {
    const input = $('#termInput');
    const value = input.value;
    if (!value.trim()) return;
    runTerminalCommand(value);
    input.value = '';
    input.focus();
  });
  $('#termToolbar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-term-key]');
    if (!b) return;
    const input = $('#termInput');
    const key = b.dataset.termKey;
    if (!input) return;
    if (key === 'clear') {
      $('#termLog').innerHTML = '';
      termBanner();
    } else if (key === 'up' || key === 'down') {
      if (!DEV.history.length) return;
      DEV.historyIndex = key === 'up'
        ? Math.max(0, DEV.historyIndex - 1)
        : Math.min(DEV.history.length, DEV.historyIndex + 1);
      input.value = DEV.history[DEV.historyIndex] || '';
      input.setSelectionRange(input.value.length, input.value.length);
    } else if (key === 'left' || key === 'right') {
      const pos = input.selectionStart == null ? input.value.length : input.selectionStart;
      const next = clamp(pos + (key === 'left' ? -1 : 1), 0, input.value.length);
      input.setSelectionRange(next, next);
    } else if (key === 'tab') {
      const pos = input.selectionStart == null ? input.value.length : input.selectionStart;
      input.value = input.value.slice(0, pos) + '  ' + input.value.slice(input.selectionEnd == null ? pos : input.selectionEnd);
      input.setSelectionRange(pos + 2, pos + 2);
    }
    input.focus();
  });
  $('#termInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const input = $('#termInput');
      const value = input.value;
      if (!value.trim()) return;
      runTerminalCommand(value);
      input.value = '';
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!DEV.history.length) return;
      DEV.historyIndex = Math.max(0, DEV.historyIndex - 1);
      $('#termInput').value = DEV.history[DEV.historyIndex] || '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      DEV.historyIndex = Math.min(DEV.history.length, DEV.historyIndex + 1);
      $('#termInput').value = DEV.history[DEV.historyIndex] || '';
    }
  });
  updateDevUI();
}

/* ============================================================
   交互 / 界面
   ============================================================ */
let appSuspended = false;
let pointerActive = false;
let pointerId = null;

function canvasPoint(ev) {
  // 【为什么要过 toAppPoint】#poolApp 被旋转了 90°，
  //   事件里的 clientX/clientY 是屏幕坐标，不能直接减去 rect。
  //   先转成应用坐标，再减画布原点、除以缩放。
  const p = toAppPoint(ev.clientX, ev.clientY);
  return {
    x: (p.x - view.ox) / view.scale,
    y: (p.y - view.oy) / view.scale,
  };
}

function setAimFromPoint(p) {
  const cue = cueBall();
  if (!cue) return;
  const dx = p.x - cue.x, dy = p.y - cue.y;
  if (Math.hypot(dx, dy) < 2) return;
  G.aimAngle = Math.atan2(dy, dx);
  G.fineDelta = 0;
  G._hintKey = null;
  G._hint = null;
  updateFineUI();
}

function onPointerDown(ev) {
  if (ev.button !== undefined && ev.button !== 0) return;
  if (!G || paused || appSuspended || G.phase === 'over' || G.phase === 'shooting' || G.aiThinking) return;
  if (!isHumanTurn()) return;
  if (anyModalOpen() || $('#welcome').classList.contains('show')) return;
  ev.preventDefault();
  ensureAudio();
  const p = canvasPoint(ev);
  const cueNow = cueBall();
  const nearCue = cueNow && Math.hypot(p.x - cueNow.x, p.y - cueNow.y) <= G.R * 2.6;
  if (G.ballInHand || (G.freeBallDrag && G.phase === 'aim' && nearCue)) {
    pointerActive = true;
    pointerId = ev.pointerId;
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    G.draggingCue = true;
    G.lastValidCue = { x: cueBall().x, y: cueBall().y };
    moveCueTo(p);
    updateHUD();
    return;
  }
  if (G.phase !== 'aim') return;
  pointerActive = true;
  pointerId = ev.pointerId;
  try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  setAimFromPoint(p);
}

function onPointerMove(ev) {
  if (!pointerActive || !G) return;
  if (G.draggingCue) {
    moveCueTo(canvasPoint(ev));
  } else if (G.phase === 'aim' && isHumanTurn() && !G.ballInHand) {
    setAimFromPoint(canvasPoint(ev));
  }
}

function onPointerUp(ev) {
  if (!pointerActive || !G) return;
  pointerActive = false;
  try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  if (G.draggingCue) {
    if (G.handValid) {
      G.ballInHand = false;
      G.draggingCue = false;
      G.phase = 'aim';
      G.freeBallDrag = true;
      G._hintKey = null;
      addLog('自由球已放置', true);
      showToast('自由球已放置，可继续拖动白球或直接瞄准');
    } else {
      const lv = G.lastValidCue;
      if (lv) { cueBall().x = lv.x; cueBall().y = lv.y; }
      G.draggingCue = false;
      showToast('这个位置会压球或贴袋，换个位置', true);
    }
    updateHUD();
    render(performance.now());
  }
}

function moveCueTo(p) {
  const cue = cueBall();
  if (!cue) return;
  const R = G.R;
  const x = clamp(p.x, TABLE.x + R + 1, TABLE.x + TABLE.w - R - 1);
  const y = clamp(p.y, TABLE.y + R + 1, TABLE.y + TABLE.h - R - 1);
  cue.x = x; cue.y = y;
  cue.vx = 0; cue.vy = 0;
  G.handValid = validCuePosition(x, y, cue);
  if (G.handValid) G.lastValidCue = { x, y };
}

function adjustAim(delta) {
  if (!G || G.phase !== 'aim' || !isHumanTurn() || G.aiThinking || G.ballInHand) return;
  const prev = G.fineDelta || 0;
  const next = clamp(prev + delta, -0.35, 0.35);
  G.aimAngle += next - prev;
  G.fineDelta = next;
  G._hintKey = null;
  G._hint = null;
  updateFineUI();
  updateCueDock();
}


/* ---------------- right-side cue dock ---------------- */
function canUseCueDock() {
  if (!G || paused || appSuspended) return false;
  if ($('#welcome').classList.contains('show')) return false;
  if (anyModalOpen()) return false;
  return G.phase === 'aim' && !G.ballInHand && !G.aiThinking && isHumanTurn();
}

function fineDegrees() {
  return ((G && G.fineDelta) || 0) * 180 / Math.PI;
}

function updateFineUI() {
  const knob = $('#fineKnob');
  if (!knob || !G) return;
  const deg = fineDegrees();
  knob.style.transform = `rotate(${deg * 1.55}deg)`;
  knob.setAttribute('aria-valuenow', String(Math.round(deg)));
}

function updateCueDock() {
  const dock = $('#cueDock');
  if (!dock || !G) return;
  const ready = canUseCueDock();
  dock.classList.toggle('disabled', !ready);
  const p = Math.round(G.power * 100);
  const fill = $('#cueFill');
  if (fill) fill.style.height = clamp(p, 8, 100) + '%';
  const trackEl = $('#cueTrack');
  if (trackEl) {
    const edge = clamp(p, 3, 100);
    trackEl.style.background = `linear-gradient(0deg, rgba(227,193,115,.22) 0%, rgba(227,193,115,.14) ${edge}%, rgba(0,0,0,.36) ${edge}%, rgba(0,0,0,.36) 100%)`;
  }
  const track = $('#cueTrack');
  if (track) track.setAttribute('aria-valuenow', String(p));
  updateFineUI();
  let hint = '下滑击球';
  if (G.phase === 'over') hint = '对局结束';
  else if (G.net && !G.net.connected) hint = '联机断开';
  else if (G.net && G.net.pendingShot) hint = '等待主机';
  else if (G.net && G.current !== G.net.localPlayer) hint = '对方回合';
  else if (G.ballInHand) hint = isHumanTurn() ? '先摆白球' : 'AI 摆球';
  else if (G.phase === 'shooting') hint = '球在滚动';
  else if (G.aiThinking || isAI()) hint = 'AI 回合';
  else if (paused) hint = '已暂停';
  const h = $('#dockHint');
  if (h) h.textContent = hint;
}

let cueDrag = null;
let fineDrag = null;

function bindCueDock() {
  const dock = $('#cueDock');
  const track = $('#cueTrack');
  const knob = $('#fineKnob');
  const reset = $('#fineReset');
  if (!dock || !track || !knob) return;

  track.addEventListener('pointerdown', (e) => {
    if (!canUseCueDock()) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    ensureAudio();
    // 【为什么要转义】球杆是竖的，但屏幕转了 90°——
    //   用户在屏幕上「向下滑」，在应用坐标里是「向左滑」。
    //   取 .x（应用横向）才是球杆的蓄力方向。
    cueDrag = { id: e.pointerId, startY: toAppPoint(e.clientX, e.clientY).y, moved: 0 };
    dock.classList.add('dragging');
    try { track.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  track.addEventListener('pointermove', (e) => {
    if (!cueDrag || e.pointerId !== cueDrag.id) return;
    e.preventDefault();
    const dy = Math.max(0, toAppPoint(e.clientX, e.clientY).y - cueDrag.startY);
    cueDrag.moved = dy;
    const raw = clamp(0.1 + (dy / 150) * 0.9, 0.1, 1);
    const step = clamp(Math.round(((raw - 0.1) / 0.9) * CUE_POWER_STEPS), 0, CUE_POWER_STEPS);
    G.power = 0.1 + (step / CUE_POWER_STEPS) * 0.9;
    dock.style.setProperty('--pull', Math.min(72, (step / CUE_POWER_STEPS) * 72) + 'px');
    updatePowerUI();
  });
  const endCueDrag = (e) => {
    if (!cueDrag || (e && e.pointerId !== cueDrag.id)) return;
    const moved = cueDrag.moved;
    cueDrag = null;
    dock.classList.remove('dragging');
    dock.style.removeProperty('--pull');
    if (moved >= 8 && canUseCueDock()) {
      dock.classList.add('striking');
      setTimeout(() => dock.classList.remove('striking'), 240);
      shoot();
    } else if (moved < 8) {
      G.power = 0.1;
      showToast('在球杆上向下滑动蓄力');
    }
    updateCueDock();
  };
  track.addEventListener('pointerup', endCueDrag);
  track.addEventListener('pointercancel', () => {
    cueDrag = null;
    dock.classList.remove('dragging');
    dock.style.removeProperty('--pull');
    if (G) G.power = 0.1;
    updateCueDock();
  });

  knob.addEventListener('pointerdown', (e) => {
    if (!canUseCueDock()) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    ensureAudio();
    fineDrag = {
      id: e.pointerId, startY: toAppPoint(e.clientX, e.clientY).y,
      startAim: G.aimAngle, startFine: G.fineDelta || 0,
    };
    knob.classList.add('active');
    try { knob.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  knob.addEventListener('pointermove', (e) => {
    if (!fineDrag || e.pointerId !== fineDrag.id) return;
    e.preventDefault();
    const next = clamp(fineDrag.startFine + (toAppPoint(e.clientX, e.clientY).y - fineDrag.startY) * 0.0016, -0.35, 0.35);
    G.aimAngle = fineDrag.startAim + (next - fineDrag.startFine);
    G.fineDelta = next;
    G._hintKey = null;
    G._hint = null;
    updateFineUI();
  });
  const endFineDrag = () => {
    if (!fineDrag) return;
    fineDrag = null;
    knob.classList.remove('active');
    updateFineUI();
  };
  knob.addEventListener('pointerup', endFineDrag);
  knob.addEventListener('pointercancel', endFineDrag);

  if (reset) {
    reset.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!G || !canUseCueDock()) return;
      const delta = G.fineDelta || 0;
      G.aimAngle -= delta;
      G.fineDelta = 0;
      G._hintKey = null;
      G._hint = null;
      updateFineUI();
      updateCueDock();
      showToast('角度已归零');
    });
  }
}

function anyModalOpen() {
  return $$('.overlay.show').some((el) => el.id !== 'welcome');
}

function closeAllModals() {
  $$('.overlay.show').forEach((el) => { if (el.id !== 'welcome') el.classList.remove('show'); });
}

function openModal(id) {
  if (!G) return;
  clearTimeout(aiTimer);
  aiToken++;
  if (G.aiThinking) { G.aiThinking = false; }
  G.aiPlan = null;
  paused = true;
  closeAllModals();
  const el = $('#' + id);
  if (el) el.classList.add('show');
  updateHUD();
}

function closeModal(id) {
  const el = $('#' + id);
  if (el) el.classList.remove('show');
  const welcome = $('#welcome').classList.contains('show');
  if (!anyModalOpen() && !welcome) {
    paused = false;
    updateHUD();
    if (G && G.phase !== 'over') maybeAi();
  }
}

function hideWelcome() {
  $('#welcome').classList.remove('show');
}

function showWelcome() {
  $('#welcome').classList.add('show');
  clearTimeout(aiTimer);
  aiToken++;
  paused = true;
  if (G) { G.aiThinking = false; updateHUD(); }
  updateWelcome();
}

function seatTypeOptions(index) {
  const opts = [['human', '玩家'], ['local', '本地算法']];
  (S.aiProfiles || []).forEach((p) => opts.push(['ai:' + p.id, p.name || p.id]));
  return opts;
}

function seatToValue(seat) {
  if (!seat) return 'human';
  if (seat.type === 'ai') return 'ai:' + (seat.aiId || 'ai1');
  return seat.type;
}

function valueToSeat(value, old) {
  if (String(value).startsWith('ai:')) return { ...old, type: 'ai', aiId: String(value).slice(3) };
  return { ...old, type: value };
}

function seatThinkOptions() {
  return ['none', 'low', 'high', 'max'].map((v) => `<option value="${v}">${THINK_LABELS[v]}</option>`).join('');
}

function renderSeatSelectors() {
  if (!S.seats) return;
  for (let i = 0; i < 2; i++) {
    const typeSel = $('#seat' + i + 'Type');
    const diffSel = $('#seat' + i + 'Difficulty');
    const thinkSel = $('#seat' + i + 'Think');
    if (!typeSel) continue;
    typeSel.innerHTML = seatTypeOptions(i).map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
    typeSel.value = seatToValue(S.seats[i]);
    if (!typeSel.value) typeSel.value = 'human';
    diffSel.value = S.seats[i].difficulty || 'normal';
    thinkSel.innerHTML = seatThinkOptions();
    thinkSel.value = THINK_LEVELS[S.seats[i].thinkLevel] !== undefined ? S.seats[i].thinkLevel : (S.seats[i].type === 'ai' ? 'low' : 'none');
  }
  syncSeatControls();
}

function syncSeatControls() {
  for (let i = 0; i < 2; i++) {
    const type = $('#seat' + i + 'Type');
    const diff = $('#seat' + i + 'Difficulty');
    const think = $('#seat' + i + 'Think');
    if (!type) continue;
    const v = type.value;
    const ai = String(v).startsWith('ai:');
    const local = v === 'local';
    if (diff) diff.disabled = !(ai || local);
    if (think) think.disabled = !ai;
  }
}

function readSeatsFromUI() {
  const out = [];
  for (let i = 0; i < 2; i++) {
    const typeEl = $('#seat' + i + 'Type');
    const diffEl = $('#seat' + i + 'Difficulty');
    const thinkEl = $('#seat' + i + 'Think');
    if (!typeEl) { out.push(S.seats[i]); continue; }
    const old = S.seats[i] || { type: 'human', difficulty: 'normal', thinkLevel: 'none' };
    let seat = valueToSeat(typeEl.value, old);
    seat.difficulty = diffEl ? diffEl.value : (seat.difficulty || 'normal');
    seat.thinkLevel = thinkEl ? thinkEl.value : (seat.type === 'ai' ? 'low' : 'none');
    out.push(seat);
  }
  if (out[1] && out[1].type === 'lan' && out[0].type !== 'human') {
    out[0] = { ...out[0], type: 'human' };
  }
  return out;
}

function updateSeatNote() {
  const note = $('#welcomeApiNote');
  if (!note) return;
  const seats = S.seats || [];
  const display = computeSeatNames(seats);
  const parts = seats.map((seat, i) => {
    const name = display[i] || (i === 0 ? 'P1' : 'P2');
    if (seat.type === 'human') return name;
    if (seat.type === 'lan') return name;
    if (seat.type === 'local') return `${name}·${difficultyName(seat.difficulty)}`;
    return `${name}·${difficultyName(seat.difficulty)}·思考${THINK_LABELS[seat.thinkLevel] || '低'}（API）`;
  });
  note.textContent = parts.join('  ｜  ');
}

function difficultyName(d) {
  return d === 'easy' ? '休闲' : d === 'master' ? '专家' : '标准';
}

function updateWelcome() {
  $$('.mode-seg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === S.mode));
  renderSeatSelectors();
  updateSeatNote();
}

function startGame() {
  S.seats = readSeatsFromUI().map((seat) => seat.type === 'lan' ? { ...seat, type: 'human' } : seat);
  S.opponent = seatsOpponent(S.seats);
  S.difficulty = S.seats[1].difficulty || S.difficulty;
  for (const seat of S.seats) {
    if (seat.type !== 'ai') continue;
    const p = getAiProfile(seat.aiId);
    if (!p || !p.baseUrl || !p.model || !p.apiKey) {
      S.activeAiId = p ? p.id : (S.aiProfiles[0] || {}).id;
      showToast('先完整配置 ' + (p ? p.name : 'AI') + ' 的 API', true);
      openSettings();
      return;
    }
  }
  saveSettings();
  hideWelcome();
  closeAllModals();
  paused = false;
  newGame({ mode: S.mode, seats: S.seats });
  /* 【观战模式】两个座位都是 AI（本地或大模型）时，对局无人可操作，
     这里给出明确提示，避免用户误以为是卡死。双 AI 会自动轮流出杆。 */
  if (G && G.seats && G.seats.every((s) => s.type === 'ai' || s.type === 'local')) {
    const a = G.seatNames ? G.seatNames[0] : 'A';
    const b = G.seatNames ? G.seatNames[1] : 'B';
    showToast('观战模式：' + a + ' vs ' + b);
  }
}

function populateProviders() {
  const sel = $('#setProvider');
  sel.innerHTML = Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('');
}

function getModelList(key) {
  const cached = MODEL_CACHE[key];
  if (Array.isArray(cached) && cached.length) return cached;
  return ((PROVIDERS[key] || PROVIDERS.deepseek).models || []).slice();
}

function renderModelOptions(models) {
  const el = $('#modelOptions');
  if (!el) return;
  el.innerHTML = (models || []).map((m) => `<option value="${esc(m)}"></option>`).join('');
}

function renderModelChips(p, models = null) {
  const list = models || p.models || [];
  const el = $('#modelChips');
  if (el) el.innerHTML = list.map((m) => `<button type="button" data-model="${esc(m)}">${esc(m)}</button>`).join('');
  renderModelOptions(list);
}

function providerDefaults(key, setFields = true) {
  const p = PROVIDERS[key] || PROVIDERS.deepseek;
  if (!setFields) return p;
  $('#setProtocol').value = p.protocol;
  $('#setBase').value = p.base;
  const models = getModelList(key);
  $('#setModel').value = models[0] || '';
  renderModelChips(p, models);
  return p;
}

async function fetchAvailableModels() {
  const f = formConfig();
  if (!f.baseUrl || !f.apiKey) {
    showToast('先填 Base URL 和 API Key', true);
    return;
  }
  const p = PROVIDERS[f.provider] || PROVIDERS.deepseek;
  let base = f.baseUrl.replace(/\/+$/, '');
  let url = /\/models$/.test(base) ? base : base + '/models';
  if (f.protocol === 'anthropic') url += (url.includes('?') ? '&' : '?') + 'limit=100';
  const headers = { 'Accept': 'application/json' };
  if (f.protocol === 'anthropic') {
    headers['x-api-key'] = f.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers['Authorization'] = 'Bearer ' + f.apiKey;
  }
  const status = $('#apiStatus');
  status.className = '';
  status.textContent = '正在拉取模型…';
  try {
    let res = await httpGet(url, headers);
    if (res.status === 404 && f.protocol === 'openai' && /\/v1$/.test(base)) {
      res = await httpGet(base.slice(0, -3) + '/models', headers);
    }
    // 【为什么删掉这里】原版有一句「失败就用 Gemini 的 models 接口重试」，
    //   那是唯一一处硬编码境外域名的地方。Gemini 已整块去掉，这句也失去意义，
    //   留着既过不了备案，也会在真机上被网络白名单拦成 403。
    if (res.status < 200 || res.status >= 300) {
      throw new Error('HTTP ' + res.status + '：' + String(res.text || '').slice(0, 120));
    }
    let obj;
    try { obj = JSON.parse(res.text); } catch (e) { throw new Error('返回不是 JSON'); }
    const raw = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.models) ? obj.models : Array.isArray(obj) ? obj : [];
    const seen = new Set();
    const list = [];
    for (const item of raw) {
      let id = typeof item === 'string' ? item : (item.id || item.name || item.model || '');
      if (!id) continue;
      id = String(id).replace(/^models\//, '');
      if (!id || seen.has(id)) continue;
      if (/embedding|embed-|tts|asr|whisper|rerank|moderation|dall-e|audio/i.test(id)) continue;
      seen.add(id);
      list.push(id);
      if (list.length >= 80) break;
    }
    if (!list.length) throw new Error('接口没有返回可用模型');
    MODEL_CACHE[f.provider] = list;
    S.modelCache = MODEL_CACHE;
    saveSettings();
    renderModelChips(p, list);
    $('#setModel').value = list.includes($('#setModel').value.trim()) ? $('#setModel').value.trim() : (list[0] || '');
    status.className = 'ok';
    status.textContent = `已获取 ${list.length} 个模型 · 点上方模型名或输入框选择`;
  } catch (e) {
    status.className = 'bad';
    status.textContent = '拉取失败：' + String(e.message || e).slice(0, 120);
  }
}

function switchSettingsTab(name) {
  $$('#settingsTabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.settings-scroll [data-pane]').forEach((sec) => sec.classList.toggle('pane-hidden', sec.dataset.pane !== name));
}

function activeAiProfile() {
  return getAiProfile(S.activeAiId) || (S.aiProfiles && S.aiProfiles[0]) || null;
}

function populateAiProfileSelect() {
  const sel = $('#aiProfileSelect');
  if (!sel) return;
  sel.innerHTML = (S.aiProfiles || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`).join('');
  sel.value = S.activeAiId || (S.aiProfiles[0] || {}).id || '';
}

function populateTranslateSelect() {
  const tr = $('#setTranslateAi');
  if (!tr) return;
  tr.innerHTML = (S.aiProfiles || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)} · ${esc(p.model || p.provider || '')}</option>`).join('');
  tr.value = (S.aiProfiles || []).some((p) => p.id === S.translateAiId) ? S.translateAiId : (S.activeAiId || (S.aiProfiles[0] || {}).id || '');
}

function fillAiProfileForm(profile) {
  if (!profile) return;
  const p = PROVIDERS[profile.provider] || PROVIDERS.deepseek;
  $('#setAiName').value = profile.name || '';
  $('#setProvider').value = profile.provider || 'deepseek';
  $('#setProtocol').value = profile.protocol || p.protocol;
  $('#setBase').value = profile.baseUrl || '';
  $('#setModel').value = profile.model || '';
  $('#setKey').value = profile.apiKey || '';
  $('#setKey').type = 'password';
  $('#toggleKey').textContent = '显示';
  $('#setModel').placeholder = (p.models && p.models[0]) || 'model-id';
  renderModelChips(p, getModelList(profile.provider));
}

function collectAiProfileForm() {
  const f = formConfig();
  const existing = activeAiProfile();
  return {
    ...(existing || {}),
    name: ($('#setAiName').value.trim() || (existing && existing.name) || 'AI').slice(0, 24),
    ...f,
  };
}

function saveActiveAiProfile() {
  const profile = activeAiProfile();
  if (!profile) return;
  const data = collectAiProfileForm();
  Object.assign(profile, data);
  S.provider = profile.provider;
  S.protocol = profile.protocol;
  S.baseUrl = profile.baseUrl || (PROVIDERS[profile.provider] || PROVIDERS.deepseek).base;
  S.model = profile.model || ((PROVIDERS[profile.provider] || PROVIDERS.deepseek).models[0] || '');
  S.apiKey = profile.apiKey;
  saveSettings();
  populateAiProfileSelect();
  renderSeatSelectors();
  updateSeatNote();
}

function switchAiProfile(nextId) {
  if (!nextId || nextId === S.activeAiId) return;
  const cur = activeAiProfile();
  if (cur) {
    Object.assign(cur, collectAiProfileForm());
  }
  S.activeAiId = nextId;
  populateAiProfileSelect();
  fillAiProfileForm(activeAiProfile());
}

function addAiProfile() {
  const cur = activeAiProfile();
  if (cur) Object.assign(cur, collectAiProfileForm());
  let n = 1;
  const ids = new Set((S.aiProfiles || []).map((p) => p.id));
  while (ids.has('ai' + n)) n++;
  const p = {
    id: 'ai' + n, name: 'AI ' + n, provider: 'deepseek', protocol: 'openai',
    baseUrl: PROVIDERS.deepseek.base, model: PROVIDERS.deepseek.models[0], apiKey: '',
  };
  S.aiProfiles.push(p);
  S.activeAiId = p.id;
  populateAiProfileSelect();
  populateTranslateSelect();
  fillAiProfileForm(p);
  renderSeatSelectors();
  updateSeatNote();
  saveSettings();
}

function deleteAiProfile() {
  if (!S.aiProfiles || S.aiProfiles.length <= 1) { showToast('至少保留一个 AI 配置', true); return; }
  const id = S.activeAiId;
  S.aiProfiles = S.aiProfiles.filter((p) => p.id !== id);
  S.aiProfiles.forEach((p, i) => { if (!p.name) p.name = 'AI ' + (i + 1); });
  S.seats = (S.seats || []).map((seat) => seat.type === 'ai' && seat.aiId === id ? { ...seat, type: 'local' } : seat);
  S.activeAiId = S.aiProfiles[0].id;
  if (S.translateAiId === id) S.translateAiId = S.activeAiId;
  populateAiProfileSelect();
  populateTranslateSelect();
  fillAiProfileForm(activeAiProfile());
  renderSeatSelectors();
  updateSeatNote();
  saveSettings();
}

function fillSettingsForm() {
  $('#setMode').value = S.mode;
  $('#setOpponent').value = seatsOpponent(S.seats || legacySeats(S.opponent));
  $('#setDifficulty').value = S.difficulty;
  $('#setAim').checked = !!S.aim;
  $('#setSound').checked = !!S.sound;
  $('#setFreeBallLocal').checked = S.freeBallLocal !== false;
  $('#setSandboxEnabled').checked = S.sandboxEnabled !== false;
  $('#setSandboxLimit').value = (S.sandboxLimit === null || S.sandboxLimit === undefined) ? '' : String(S.sandboxLimit);
  populateProviders();
  populateAiProfileSelect();
  fillAiProfileForm(activeAiProfile());
  populateTranslateSelect();
  $('#apiStatus').textContent = 'Key 仅保存在本机';
  $('#apiStatus').className = '';
  syncApiSection();
}

function syncApiSection() {
  const isApi = (S.seats || []).some((seat) => seat.type === 'ai') || $('#setOpponent').value === 'api';
  const sec = $('.api-section');
  if (sec) sec.style.opacity = isApi ? '1' : '.62';
}

function openSettings() {
  if (!G) return;
  fillSettingsForm();
  switchSettingsTab((S.seats || []).some((seat) => seat.type === 'ai') ? 'api' : 'match');
  openModal('settingsModal');
}

function formConfig() {
  const provider = $('#setProvider').value;
  const p = PROVIDERS[provider] || PROVIDERS.deepseek;
  return {
    provider,
    protocol: $('#setProtocol').value || p.protocol,
    baseUrl: $('#setBase').value.trim(),
    model: $('#setModel').value.trim(),
    apiKey: $('#setKey').value.trim(),
  };
}

let apiOverride = null;

async function withFormConfig(fn) {
  const old = apiOverride;
  apiOverride = formConfig();
  try { return await fn(); }
  finally { apiOverride = old; }
}

async function saveSettingsAndStart() {
  saveActiveAiProfile();
  S.seats = readSeatsFromUI();
  S.mode = $('#setMode').value;
  S.difficulty = $('#setDifficulty').value;
  S.aim = $('#setAim').checked;
  S.sound = $('#setSound').checked;
  S.freeBallLocal = $('#setFreeBallLocal').checked;
  S.sandboxEnabled = $('#setSandboxEnabled').checked;
  // 【为什么空字符串要转 null】空输入框的 value 是 ''，Number('') 是 0，
  // 直接存下去等于「上限 0 次」，玩家会以为沙箱坏了。空 = 跟随难度。
  {
    const raw = $('#setSandboxLimit').value.trim();
    const n = raw === '' ? null : Number(raw);
    S.sandboxLimit = (n === null || !Number.isFinite(n)) ? null : clamp(Math.floor(n), 0, 10);
  }
  if ($('#setTranslateAi') && $('#setTranslateAi').value) S.translateAiId = $('#setTranslateAi').value;
  const opp = $('#setOpponent').value;
  /* 【局域网已移除】上游的 lan 分支连同 openLanModal 一起删掉了，
     这里不留 if (false) 空壳，免得后人以为还有联机功能。 */
  if (opp !== seatsOpponent(S.seats)) S.seats = legacySeats(opp);
  S.seats = S.seats.map((seat) => seat.type === 'lan' ? { ...seat, type: 'human' } : seat);
  S.opponent = seatsOpponent(S.seats);
  S.difficulty = S.seats[1].difficulty || S.difficulty;
  saveSettings();
  updateWelcome();
  for (const seat of S.seats) {
    if (seat.type !== 'ai') continue;
    const p = getAiProfile(seat.aiId);
    if (!p || !p.baseUrl || !p.model || !p.apiKey) {
      S.activeAiId = p ? p.id : (S.aiProfiles[0] || {}).id;
      showToast('先完整配置 ' + (p ? p.name : 'AI') + ' 的 API', true);
      fillSettingsForm();
      switchSettingsTab('api');
      return;
    }
  }
  if (G && G.net) lanLeave();
  hideWelcome();
  closeAllModals();
  paused = false;
  newGame({ mode: S.mode, seats: S.seats });
}

function returnHome() {
  clearTimeout(aiTimer);
  aiToken++;
  if (G) { G.aiThinking = false; G.aiPlan = null; }
  closeAllModals();
  $('#overModal').classList.remove('show');
  showWelcome();
  updateWelcome();
}

/* ---------------- event wiring ---------------- */
function bindEvents() {
  bindCueDock();
  bindTerminal();
  bindReplay();
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  canvas.addEventListener('pointermove', onPointerMove, { passive: false });
  canvas.addEventListener('pointerup', onPointerUp, { passive: false });
  canvas.addEventListener('pointercancel', (ev) => {
    if (G && G.draggingCue) {
      G.draggingCue = false;
      const lv = G.lastValidCue;
      if (lv) { cueBall().x = lv.x; cueBall().y = lv.y; }
      updateHUD();
    }
    pointerActive = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /* 【为什么这里没有退出按钮】用户明确要求完整版不要退出按钮。
     小程序里没有 API 能关掉宿主（SDK 查过，没有 exit / close 一类），
     所以「退出」无处可去，留个按钮只会让人以为点了能出去。
     这份代码也不再挂 window.__poolOnExit。 */
  $('#btnSound').addEventListener('click', () => {
    S.sound = !S.sound;
    saveSettings();
    updateHUD();
    if (S.sound) { ensureAudio(); tone(660, 0.08, 'sine', 0.05); }
  });
  $('#btnAim').addEventListener('click', () => {
    S.aim = !S.aim;
    saveSettings();
    G._hintKey = null;
    updateHUD();
  });
  $('#btnMenu').addEventListener('click', () => {
    if (!G) return;
    openModal('menuModal');
  });
  $('#resumeBtn').addEventListener('click', () => closeModal('menuModal'));
  $('#menuNew').addEventListener('click', () => {
    if (G && G.net) {
      if (G.net.role === 'host') { closeAllModals(); lanHostRestart(); }
      else showToast('等待房主重新开局', true);
      return;
    }
    closeAllModals(); paused = false; newGame();
  });
  $('#menuSettings').addEventListener('click', openSettings);
  $('#menuRules').addEventListener('click', () => openModal('rulesModal'));
  // 【为什么菜单里也去掉退出】用户要求完整版不要退出按钮。
  //   小程序关不掉宿主，这个菜单项点了只会回到欢迎页——
  //   那和「新局」有什么区别？留着反而让人以为退出了。
  //   模板里的 #menuExit 一并删掉（见 mount.js 的 menu-list）。
  $('#menuExit') && $('#menuExit').addEventListener('click', () => {
    // 兜底：万一模板里还留着这个按钮，至少别让它点了没反应。
    closeAllModals(); paused = true; showWelcome();
  });
  $('#btnNew').addEventListener('click', () => {
    if (G && G.net) {
      if (G.net.role === 'host') lanHostRestart();
      else showToast('等待房主重新开局', true);
      return;
    }
    newGame();
  });
  $('#btnSettings').addEventListener('click', openSettings);

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(b.dataset.close)));
  $$('.overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => {
      if (e.target !== ov) return;
      if (ov.id === 'welcome' || ov.id === 'overModal') return;
      closeModal(ov.id);
    });
  });

  $$('.mode-seg button').forEach((b) => b.addEventListener('click', () => {
    S.mode = b.dataset.mode;
    updateWelcome();
  }));
  $$('.opp-seg button').forEach((b) => b.addEventListener('click', () => {
    S.opponent = b.dataset.opp;
    updateWelcome();
  }));
  ['0', '1'].forEach((i) => {
    ['#seat' + i + 'Type', '#seat' + i + 'Difficulty', '#seat' + i + 'Think'].forEach((sel) => {
      const el = $(sel);
      if (el) el.addEventListener('change', () => {
        const prevType = S.seats && S.seats[i] ? S.seats[i].type : null;
        S.seats = readSeatsFromUI();
        const nextType = S.seats[i] ? S.seats[i].type : 'human';
        if (nextType === 'ai' && prevType !== 'ai') {
          S.seats[i].thinkLevel = 'low';
          const thinkEl = $('#seat' + i + 'Think');
          if (thinkEl) thinkEl.value = 'low';
        } else if (nextType !== 'ai') {
          S.seats[i].thinkLevel = 'none';
          const thinkEl = $('#seat' + i + 'Think');
          if (thinkEl) thinkEl.value = 'none';
        }
        S.opponent = seatsOpponent(S.seats);
        S.difficulty = S.seats[1].difficulty || S.difficulty;
        syncSeatControls();
        updateSeatNote();
        saveSettings();
      });
    });
  });
  $('#aiProfileSelect').addEventListener('change', (e) => switchAiProfile(e.target.value));
  $('#aiProfileAdd').addEventListener('click', addAiProfile);
  $('#aiProfileDel').addEventListener('click', deleteAiProfile);
  $('#startGame').addEventListener('click', startGame);
  $('#welcomeReplay').addEventListener('click', openReplay);
  $('#welcomeImport').addEventListener('click', importReplayArchive);
  $('#settingsHome').addEventListener('click', returnHome);
  $('#welcomeSettings').addEventListener('click', openSettings);

  // settings
  $('#settingsTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) switchSettingsTab(b.dataset.tab);
  });
  $('#setOpponent').addEventListener('change', () => {
    syncApiSection();
    if ($('#setOpponent').value === 'api') switchSettingsTab('api');
  });
  $('#setProvider').addEventListener('change', () => {
    const key = $('#setProvider').value;
    const p = providerDefaults(key);
    // 【为什么这里不再判断 custom】原来有个「选自定义时别清空输入框」的分支，
    //   自定义服务商已经整块去掉（备案要求），这个判断永远不会成立。
    //   留着会让后来的人以为还存在自定义入口。
    const models = getModelList(key);
    $('#setBase').value = p.base;
    $('#setModel').value = models[0] || '';
    $('#setProtocol').value = p.protocol;
    renderModelChips(p, models);
  });
  $('#fetchModels').addEventListener('click', fetchAvailableModels);
  $('#modelChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-model]');
    if (b) $('#setModel').value = b.dataset.model;
  });
  $('#toggleKey').addEventListener('click', () => {
    const input = $('#setKey');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('#toggleKey').textContent = show ? '隐藏' : '显示';
  });
  $('#testApi').addEventListener('click', () => {
    withFormConfig(testApiConnection);
  });
  $('#saveSettings').addEventListener('click', saveSettingsAndStart);

  // LAN —— 【小程序版】整块删除。没有 PeerJS、没有原生桥，
  //   这些按钮在模板里也已经去掉，绑定它们会拿到 null。

  // over
  $('#overAgain').addEventListener('click', () => {
    if (G && G.net) {
      if (G.net.role === 'host') { $('#overModal').classList.remove('show'); lanHostRestart(); }
      else showToast('等待房主重新开局', true);
      return;
    }
    $('#overModal').classList.remove('show');
    paused = false;
    closeAllModals();
    newGame();
  });
  $('#overMenu').addEventListener('click', () => {
    $('#overModal').classList.remove('show');
    if (G && G.net) { lanLeave(); return; }
    showWelcome();
  });

  window.addEventListener('resize', () => { resizeCanvas(); });
  if (window.ResizeObserver) {
    try { new ResizeObserver(() => resizeCanvas()).observe($('#stage')); } catch (e) { /* ignore */ }
  }
  document.addEventListener('visibilitychange', () => {
    appSuspended = document.hidden;
    if (!appSuspended && G && G.phase !== 'over' && !paused) maybeAi();
  });
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'ArrowLeft') { adjustAim(-0.0025); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { adjustAim(0.0025); e.preventDefault(); }
    else if (e.key === 'Escape') { window.appBack(); }
  });
}

/* ---------------- lifecycle ---------------- */
function drawStatic() {
  resizeCanvas();
  tableCache = null;
}

function loop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - (loop._last || now)) / 1000));
  loop._last = now;
  if (!paused && !appSuspended && G && G.phase === 'shooting') updatePhysics(dt);
  try { render(now); } catch (e) { console.error('render error', e); }
  requestAnimationFrame(loop);
}

function boot() {
  if (booted) return;
  booted = true;
  // 【必须先取 canvas 再做任何事】后面 populateProviders / bindEvents
  //   都可能碰到 #felt，ctx 为 null 会连锁报错。
  canvas = $('#felt');
  if (!canvas) { console.error('[pool] 找不到 #felt，模板没插进 DOM？'); return; }
  ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  populateProviders();
  bindEvents();
  resizeCanvas();
  updateWelcome();
  loadReplayArchives();

  // preview table behind the welcome card
  newGame({ mode: S.mode, opponent: S.opponent, silent: true, preview: true });
  paused = true;
  $('#welcome').classList.add('show');
  updateHUD();
  requestAnimationFrame((t) => { loop._last = t; loop(t); });
}

window.appBack = function () {
  if (REPLAY_ACTIVE) { closeReplay(); return true; }
  const over = $('#overModal').classList.contains('show');
  if (over) {
    $('#overModal').classList.remove('show');
    showWelcome();
    return true;
  }
  const opened = $$('.overlay.show').filter((el) => el.id !== 'welcome');
  if (opened.length) {
    const top = opened[opened.length - 1];
    closeModal(top.id);
    return true;
  }
  if ($('#welcome').classList.contains('show')) return false;
  if (G && G.phase !== 'over') {
    openModal('menuModal');
    return true;
  }
  return false;
};

window.appPause = function () {
  appSuspended = true;
  clearTimeout(aiTimer);
};
window.appResume = function () {
  appSuspended = false;
  resizeCanvas();
  if (G && G.phase !== 'over' && !paused) maybeAi();
};

// 【为什么改成显式钩子】这个文件现在被 screen.js import 进来，
//   导入那一刻模板还没插进 DOM，自动 boot() 会拿到 null 的元素，
//   表现为「白屏但没报错」。改由 screen.js 在插入 DOM 后叫醒。
//   直接双击打开原版 index.html 的老用法仍然可用：那里的 load 会调它。
window.__poolBoot = boot;
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  // 【为什么还要留这条】保留原版 index.html 直接打开时的行为。
  //   screen.js 会先把 #poolApp 插进 DOM 再调 __poolBoot，
  //   这时 readyState 可能已经是 complete，所以上面那行必须留着。
}

// debug / test hooks
window.__billiards = {
  get game() { return G; },
  newGame, shoot, buildCandidates, legalTargets, resolveShot, updatePhysics,
  chooseAiCuePosition, aiTakeShot, maybeAi, aimPreview, simulateStep, callLLM, askModel, parseModelChoice, modelAngleCandidate, isAI, isHumanTurn, simulateShotInSandbox, aiThinkRounds, stateForModel, askModelWithSandbox,
  runTerminalCommand, endShot, DEV, PHYS,
  get recorder() { return RECORDER; }, get replays() { return REPLAYS; }, get replayActive() { return REPLAY_ACTIVE; }, openReplay, closeReplay,
  get paused() { return paused; },
  get view() { return view; },
  moveCueTo, prepareCueForHand,
  setPaused(v) { paused = !!v; },
  S, encryptReplayText, decryptReplayText, compactReplay, expandCompactReplay,
  buildBallInHandCandidates, ballInHandPlacements, chooseAiCuePosition, applyCandidateCue, stateForModel, compactFeedback,
  // 1.4.23 的 API 失败分级，测试要能直接调
  apiConnCount, apiRespCount, classifyApiFailure, recordApiFailure, apiFailureError,
};

})();
