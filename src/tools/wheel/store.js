/**
 * 云海转盘的持久化 —— 对齐原 APK 的「完整版 ZIP（2.0）」结构。
 *
 * 【为什么不是随便拆几个 key】原 APK 导出的 2.0 包里有明确的四类东西：
 *   转盘本体（选项/权重/分组/避重/抽取记录）、跳转规则（rules）、
 *   自动指令（script）、以及全局设置。这里按同样的四类分域存，
 *   导出时能 1:1 拼回原 APK 能吃的格式，导入时也能直接吃原 APK 的包。
 *   用户已有的转盘数据不会因为我换了个实现就变成孤岛。
 *
 * 【为什么按用户给的 value 数分配】用户给了硬指标：
 *   转盘数据 ≤6 个 value、跳转数据 ≤4 个、自动指令 ≤4 个、合计 ≤14 个。
 *   按 16KB/个算就是 96KB / 64KB / 64KB。分配如下：
 *     - wheel.lib    6 个 value（save_4..save_9）   转盘本体 + 分类
 *     - wheel.goto   4 个 value（save_10..save_13） 跳转规则 + 抽取记录
 *     - wheel.script 4 个 value（save_14..save_17） 自动指令（Python）
 *   抽取记录（drawn/counts）放跳转域，因为它跟"抽完之后跳到哪"是同一件事，
 *   而且它增长最快，独占一块不会把转盘本体挤爆。
 *
 * 【为什么自动指令只能有 1 份】这是小程序侧的额外限制（原 APK 没限制）。
 *   原因很实际：自动指令是**会执行**的代码，多份并存时"到底跑哪一份"
 *   在 UI 上极难表达清楚，用户很容易在错误的指令下抽奖然后困惑。
 *   1 份 + 明确的当前生效提示，比 10 份藏在列表里更安全。
 */
import { readScope, writeScope, scopeUsage, scopeCapacity, clearScope } from '../../core/save.js';
import { shrinkBundle, restoreSource } from '../../core/shrink.js';
import { utf8Length } from '../../core/pack.js';
import { createWheel, uid } from './engine.js';
import { storageGet, storageSet } from '../../sdk/hb.js';

export const VERSION = '0.2.3.1';

/* ---------------- 各域配额 ---------------- */

export const WHEEL_SCOPES = {
  lib: { scope: 'wheel.lib', values: 6, label: '转盘数据' },
  goto: { scope: 'wheel.goto', values: 4, label: '跳转数据' },
  script: { scope: 'wheel.script', values: 4, label: '自动指令' },
};

/** 自动指令只能存 1 份（见文件头注释） */
export const SCRIPT_LIMIT = 1;

export const DEFAULT_CONFIG = {
  voice: false, // 朗读：Web 用 speechSynthesis，没有就静默
  voiceRate: 1,
  /**
   * 朗读模板。默认「抽到{result}」，和原 APK 的 `抽到 {result}` 一致。
   *
   * 【为什么要模板而不是写死一句话】用户想要的念法差别很大：
   *   有人只想听结果（{result}），有人想连"第几次抽"一起听（{count}），
   *   有人要报时间（{time}）。写死任何一种都会有人不满意，
   *   而模板只多一个输入框，却能把所有念法都覆盖掉。
   *
   * 支持的占位符见 templateVars()：result / value / count / last / time / total。
   */
  voiceTemplate: '抽到 {result}',
  /** 念结果之前是否先念一句"本次结果"（预生成的固定短语，音色更自然） */
  voicePrefix: false,
  fontScale: 1,
  pageSize: 60,
  autoResetSec: 3,
  autoGoto: true, // 原 APK 的 settings.autoGoto
  avoidReset: 0, // 原 APK 的 settings.avoidReset
  defaultAvoid: false,
};

export function sampleLibrary() {
  return [
    createWheel({
      name: '今天吃什么',
      category: '生活',
      items: [
        { text: '火锅', weight: 100, group: 0 },
        { text: '烧烤', weight: 100, group: 0 },
        { text: '日料', weight: 80, group: 0 },
        { text: '麻辣烫', weight: 120, group: 0 },
        { text: '炒饭', weight: 100, group: 0 },
        { text: '沙拉（减肥）', weight: 20, group: 0 },
      ],
    }),
    createWheel({
      name: '谁来干活',
      category: '生活',
      items: [
        { text: '我', weight: 100, group: 0 },
        { text: '你', weight: 100, group: 0 },
        { text: '他', weight: 100, group: 0 },
        { text: '下次一定', weight: 30, group: 0 },
      ],
    }),
    createWheel({
      name: '真心话大冒险',
      category: '聚会',
      items: [
        { text: '真心话', weight: 100, group: 1 },
        { text: '大冒险', weight: 100, group: 1 },
        { text: '喝一杯', weight: 60, group: 2 },
        { text: '免罚一次', weight: 20, group: 2 },
      ],
    }),
  ];
}

/* ---------------- 转盘库 ---------------- */

let libCache = null;

export async function loadLibrary() {
  if (libCache) return libCache;
  const raw = await readScope('wheel.lib');
  if (raw && Array.isArray(raw.w) && raw.w.length) {
    libCache = raw.w.map((w) => createWheel(w));
    return libCache;
  }
  const seed = sampleLibrary();
  libCache = seed;
  await saveLibrary(seed);
  return seed;
}

export async function saveLibrary(wheels) {
  libCache = wheels;
  // 只存"盘"本身。抽取记录和跳转规则分别存 goto 域，
  // 否则每抽一次都要重写整个库（几百 KB），手机上会卡。
  const slim = wheels.map(slimWheel);
  return writeScope('wheel.lib', { v: 2, w: slim, c: categoriesOf(wheels) });
}

function slimWheel(w) {
  return {
    id: w.id,
    name: w.name,
    category: w.category,
    items: w.items.map((it) => ({
      id: it.id,
      text: it.text,
      weight: it.weight,
      group: it.group,
      disabled: !!it.disabled,
    })),
    avoid: !!w.avoid,
    autogoto: w.autogoto !== false,
    createdAt: w.createdAt || 0,
    updatedAt: w.updatedAt || 0,
  };
}

function categoriesOf(wheels) {
  const set = new Set();
  for (const w of wheels) if (w.category) set.add(w.category);
  return [...set];
}

/* ---------------- 跳转 + 抽取记录 ---------------- */

let gotoCache = null;

/**
 * 跳转域结构：
 *   { r: [规则...], d: {wheelId: [itemId...]}, n: {wheelId: {itemId: 次数}} }
 * r = rules（跳转规则），d = drawn（已抽出的选项，避重用），n = counts（抽取统计）
 */
export async function loadGotoData() {
  if (gotoCache) return gotoCache;
  const raw = await readScope('wheel.goto');
  gotoCache = {
    rules: (raw && Array.isArray(raw.r)) ? raw.r : [],
    drawn: (raw && raw.d) || {},
    counts: (raw && raw.n) || {},
    lastResult: (raw && raw.l) || {},
  };
  return gotoCache;
}

export async function saveGotoData(data) {
  gotoCache = data;
  return writeScope('wheel.goto', {
    r: data.rules || [],
    d: data.drawn || {},
    n: data.counts || {},
    l: data.lastResult || {},
  });
}

/** 把跳转数据合并进转盘对象（渲染时用） */
export function mergeGoto(wheels, data) {
  const byId = new Map();
  for (const r of data.rules || []) {
    if (!byId.has(r.wheelId)) byId.set(r.wheelId, []);
    byId.get(r.wheelId).push(r);
  }
  return wheels.map((w) => ({
    ...w,
    rules: byId.get(w.id) || [],
    drawn: (data.drawn || {})[w.id] || [],
    counts: (data.counts || {})[w.id] || {},
    lastResult: (data.lastResult || {})[w.id] || '',
  }));
}

/* ---------------- 自动指令 ---------------- */

let scriptCache = null;

/**
 * 自动指令域：{ s: { 指令名: 源码 } }
 * 结构上支持多份（原 APK 就是多份），但 SCRIPT_LIMIT 把它限成 1 份。
 * 这样导入原 APK 的多指令包时能读进来，只是 UI 会让你选一份保留。
 */
export async function loadScripts() {
  if (scriptCache) return scriptCache;
  const raw = await readScope('wheel.script');
  const map = (raw && raw.m) || {};
  const src = (raw && raw.s) || {};
  const out = {};
  for (const name of Object.keys(src)) {
    const code = restoreSource(src[name] || '', map);
    if (code && code.trim()) out[name] = code;
  }
  scriptCache = out;
  return out;
}

export async function saveScripts(scripts) {
  const names = Object.keys(scripts || {});
  if (names.length > SCRIPT_LIMIT) {
    return { ok: false, error: 'SCRIPT_LIMIT', limit: SCRIPT_LIMIT };
  }
  let bytes = 0;
  for (const n of names) bytes += utf8Length(scripts[n] || '');
  const capacity = scopeCapacity('wheel.script');
  if (bytes > capacity * 0.8) {
    return { ok: false, error: 'OVER_BUDGET', bytes, capacity };
  }
  scriptCache = scripts;
  const { codes, map } = shrinkBundle(scripts);
  const res = await writeScope('wheel.script', { v: 2, m: map, s: codes });
  if (!res.ok) return { ok: false, error: res.error, bytes, capacity };
  return { ok: true, bytes, capacity, packed: res.bytes };
}

/** 当前生效的那一份（没有就 null） */
export async function activeScript() {
  const all = await loadScripts();
  const names = Object.keys(all);
  if (!names.length) return null;
  return { name: names[0], code: all[names[0]] };
}

/* ---------------- 记录（本地，不占云配额） ---------------- */

/**
 * 抽取历史留在**本地** storage，不上云。
 * 【为什么】它是日志，不是数据：丢了不影响任何转盘的正确性，
 *   而且每天都在长，放云存档会持续挤占用户宝贵的云配额（转盘三域合计 17 个 value）。
 */
const LOG_KEY = 'wheel:log:v1';

export async function loadLog() {
  return (await storageGet(LOG_KEY, [])) || [];
}

export async function appendLog(entry) {
  const log = (await storageGet(LOG_KEY, [])) || [];
  log.unshift({ ...entry, id: uid(), at: Date.now() });
  // 只留最近 500 条：再多也没人会翻
  await storageSet(LOG_KEY, log.slice(0, 500));
}

export async function clearLog() {
  await storageSet(LOG_KEY, []);
}

/* ---------------- 设置 ---------------- */

const CFG_KEY = 'wheel:cfg:v1';

/**
 * 【为什么设置要存两份】本地一份、云存档一份。
 *
 *   只存本地：换手机、重装、清数据就全没了。朗读模板是用户一条一条敲出来的，
 *     丢了会很难受——尤其原 APK 是跟着数据一起导出的。
 *   只存云：每次改个开关都要写云存档，而云存档有 16 KB/键的限制和
 *     写入配额，开关这种高频小改动不值得占。
 *
 *   所以：本地存全量（即时、无成本），云存档存一份副本（换设备能恢复）。
 *   读取时以本地为准，本地没有才用云端的。
 */
const CFG_CLOUD_KEY = 'wheel:cfg:cloud:v1';

export async function loadConfig() {
  const local = (await storageGet(CFG_KEY, null)) || null;
  if (local) return { ...DEFAULT_CONFIG, ...local };
  // 本地没有（新设备/清过数据）→ 试云存档
  try {
    const cloud = (await storageGet(CFG_CLOUD_KEY, null)) || null;
    if (cloud) {
      await storageSet(CFG_KEY, cloud); // 顺手写回本地，下次不用再读云
      return { ...DEFAULT_CONFIG, ...cloud };
    }
  } catch {
    /* 云存档读不到就用默认值，不影响使用 */
  }
  return { ...DEFAULT_CONFIG };
}

export async function saveConfig(cfg) {
  await storageSet(CFG_KEY, cfg);
  // 云副本失败不该让调用方以为没存上——本地已经存好了
  try {
    await storageSet(CFG_CLOUD_KEY, cfg);
  } catch {
    /* 忽略：云存档不可用时本地副本仍然有效 */
  }
}

/* ---------------- 用量 ---------------- */

export async function wheelUsage() {
  const [lib, go, sc] = await Promise.all([
    scopeUsage('wheel.lib'),
    scopeUsage('wheel.goto'),
    scopeUsage('wheel.script'),
  ]);
  return {
    lib: { ...lib, values: WHEEL_SCOPES.lib.values, label: '转盘数据' },
    goto: { ...go, values: WHEEL_SCOPES.goto.values, label: '跳转数据' },
    script: { ...sc, values: WHEEL_SCOPES.script.values, label: '自动指令' },
  };
}

export async function clearAll() {
  await clearScope('wheel.lib');
  await clearScope('wheel.goto');
  await clearScope('wheel.script');
  libCache = null;
  gotoCache = null;
  scriptCache = null;
}
