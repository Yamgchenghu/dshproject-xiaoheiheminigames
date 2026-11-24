/**
 * 模组（Python 注入）脚本的存取。
 *
 * 【为什么单独占一个存档域】脚本可能几万字节，塞进个人资料里会让
 *   每记一次成绩都重写整份脚本，既慢又容易写失败。
 *
 * 【为什么是 8 个 value 却只让存 96000 字节】这是算出来的，不是拍脑袋：
 *   源码是 UTF-8 文本，存档层要把它压成**纯 ASCII** 才能安全切块
 *   （见 core/pack.js 的注释）。base85 最坏情况膨胀 1.25 倍，
 *   96000 字节源码 → 最坏 120000 字节打包结果。8 个 value 是 131072 字节，
 *   留出约 11000 字节余量给块头、映射表和压不动的情况。
 *   所以对用户说的上限是 96000（源码字节），实际能兜住的是 131072（打包字节）。
 *
 * 【为什么从 3 个 value 扩到 8 个】用户要求「模组源码给到 8 个 value」。
 *   原先 32000 字节的额度写复杂玩法很紧（一个带 UI 的小游戏脚本就要
 *   两三万字节）。扩容后额度约三倍，够放多份完整脚本。
 *   新增的 5 个 value 是 save_30..save_34，追加在编号表末尾，
 *   原有 save_1..save_3 的键号没变，老存档照常读得到。
 *
 * 【为什么按整包简写】见 core/shrink.js 里 shrinkBundle 的注释：
 *   单份脚本简写反而更大，整包共享一张映射表才省。实测 40KB 的脚本集合
 *   能省 27%，也就是白送用户一万多字节的额度。
 */
import { readScope, writeScope, scopeUsage, scopeCapacity, clearScope, CHUNK_BYTES } from '../core/save.js';
import { shrinkBundle, restoreSource } from '../core/shrink.js';
import { utf8Length } from '../core/pack.js';

/** 用户可见的源码上限（字节）。见文件头注释的推算。 */
export const MOD_BUDGET = 96000;

/** 存档里记录格式版本，将来改结构时能识别旧档 */
const FORMAT = 1;

let cache = null; // { scripts: {gameId: code}, map: {}, disabled: [gameId], usage: {...} }
let loading = null;

/* ---------------- 读 ---------------- */

export async function loadMods() {
  if (cache) return cache.scripts;
  if (!loading) {
    loading = (async () => {
      const raw = await readScope('mod');
      cache = decode(raw);
      return cache.scripts;
    })();
  }
  return loading;
}

function decode(raw) {
  const scripts = {};
  let map = {};
  // 【为什么要存"禁用列表"而不是"启用列表"】默认全部启用更符合直觉：
  //   用户写完脚本就期望它生效，不该再点一次开关。
  //   所以只记录被显式关掉的游戏，新增脚本天然是启用的。
  //   这也让旧存档（没有 d 字段）自动兼容成"全部启用"。
  let disabled = [];
  if (raw && typeof raw === 'object') {
    map = raw.m || {};
    if (Array.isArray(raw.d)) disabled = raw.d.filter((x) => typeof x === 'string');
    const src = raw.s || {};
    for (const id of Object.keys(src)) {
      const code = restoreSource(src[id] || '', map);
      if (code && code.trim()) scripts[id] = code;
    }
  }
  return { scripts, map, disabled, usage: usageOf(scripts) };
}

/* ---------------- 用量 ---------------- */

/** 源码原始字节数（用户看到的就是这个数） */
export function usageOf(scripts) {
  let used = 0;
  for (const id of Object.keys(scripts)) used += utf8Length(scripts[id] || '');
  return { used, budget: MOD_BUDGET, percent: Math.min(100, Math.round((used / MOD_BUDGET) * 100)) };
}

export function modUsage() {
  if (!cache) return { used: 0, budget: MOD_BUDGET, percent: 0 };
  return usageOf(cache.scripts);
}

/** 云端打包后实际占用（设置页诊断用） */
export async function modCloudUsage() {
  const u = await scopeUsage('mod');
  return { ...u, capacity: scopeCapacity('mod'), chunkBytes: CHUNK_BYTES };
}

/* ---------------- 写 ---------------- */

/**
 * 保存某个游戏的脚本。code 为空则删除该游戏的脚本。
 * @returns {{ ok:boolean, error?:string, usage:{used,budget,percent}, removed?:boolean }}
 */
export async function saveMod(gameId, code) {
  const scripts = { ...(await loadMods()) };
  if (code && code.trim()) scripts[gameId] = code;
  else delete scripts[gameId];

  const usage = usageOf(scripts);
  if (usage.used > MOD_BUDGET) {
    // 不静默截断：截断会让用户的代码在不知情的情况下少一半，跑出莫名其妙的结果
    return { ok: false, error: 'OVER_BUDGET', usage };
  }

  const { codes, map } = shrinkBundle(scripts);
  // 【禁用列表要跟着脚本一起存】它和脚本是同一份业务数据：
  //   只存脚本不存开关状态，换台设备登录后"关掉的模组又自己开了"，
  //   用户会以为开关没生效。存进同一个 payload 才能一起同步。
  const disabled = (cache?.disabled || []).filter((id) => scripts[id]);
  const payload = { v: FORMAT, m: map, s: codes, d: disabled };
  const res = await writeScope('mod', payload);

  if (!res.ok) {
    const fallback = await scopeUsage('mod');
    return {
      ok: false,
      error: res.error === 'TOO_LARGE' ? 'OVER_BUDGET' : res.error,
      usage,
      packed: res.bytes,
      capacity: res.capacity,
      cloud: fallback,
    };
  }

  cache = { scripts, map, disabled, usage };
  return { ok: true, usage, packed: res.bytes, capacity: res.capacity };
}

/**
 * 同步读取（已加载过才有值）。
 *
 * 【为什么禁用判断放在这里，而不是让调用方自己查】这是"模组是否生效"的
 *   唯一入口——游戏启动时只问这一个函数。把禁用逻辑收在这里，
 *   以后任何新调用方都自动遵守开关，不会出现"某个入口忘了检查"的漏洞。
 */
export function getModSource(gameId) {
  if (!cache) return null;
  if (isModDisabled(gameId)) return null;
  const code = cache.scripts[gameId];
  return code && code.trim() ? code : null;
}

/** 这个游戏的模组是否被用户关掉了 */
export function isModDisabled(gameId) {
  return !!(cache && cache.disabled && cache.disabled.includes(gameId));
}

/** 已保存脚本的游戏 id 列表（实验室用来决定显示哪些开关） */
export function modGameIds() {
  return cache ? Object.keys(cache.scripts) : [];
}

/**
 * 启用 / 禁用某个游戏的模组。
 *
 * 【为什么禁用不删脚本】用户想的是"暂时别让它跑"，不是"把代码删掉"。
 *   删了再写一遍代价太大，而且很容易误删。禁用只是让它不生效，
 *   源码、用量、字节数全都保留。
 */
export async function setModEnabled(gameId, enabled) {
  const scripts = { ...(await loadMods()) };
  if (!scripts[gameId]) return { ok: false, error: 'NO_SCRIPT' };
  const cur = cache?.disabled || [];
  const next = enabled
    ? cur.filter((id) => id !== gameId)
    : (cur.includes(gameId) ? cur : cur.concat(gameId));

  const { codes, map } = shrinkBundle(scripts);
  const payload = { v: FORMAT, m: map, s: codes, d: next };
  const res = await writeScope('mod', payload);
  if (!res.ok) {
    return { ok: false, error: res.error, packed: res.bytes, capacity: res.capacity };
  }
  cache = { scripts, map, disabled: next, usage: usageOf(scripts) };
  return { ok: true, enabled };
}

/**
 * 这个游戏当前是否有"生效中"的模组。
 * 【为什么要遵守禁用】UI 上用它决定要不要显示"带模组"标记。
 *   如果禁用后还返回 true，玩家会以为模组在跑，实际没跑。
 */
export function hasMod(gameId) {
  return !!getModSource(gameId);
}

/** 有脚本但被关掉了——UI 用来显示"已禁用"而不是"没有模组" */
export function hasModDisabled(gameId) {
  return !!(cache && cache.scripts[gameId] && isModDisabled(gameId));
}

export function allMods() {
  return cache ? cache.scripts : {};
}

export async function clearAllMods() {
  await clearScope('mod');
  cache = { scripts: {}, map: {}, disabled: [], usage: usageOf({}) };
  return cache.scripts;
}

export function preloadMods() {
  return loadMods();
}

/**
 * 模组编辑器里那句必须原样显示的提示。
 * 【为什么写死在模块里而不是各页面各写一遍】用户明确要求这句话一字不差，
 *   分散在多个页面就会慢慢走样（有人改个标点、有人加个"约"字）。
 */
export function budgetBanner(used) {
  return `由于工坊云存档限制，你只能保存最多${MOD_BUDGET}字节的mod源码，超出部分请手动保存 当前已使用${used}/${MOD_BUDGET}字节`;
}
