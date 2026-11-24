/**
 * 成就与游玩记录。
 *
 * 【为什么统计口径写在这里而不是各游戏里】成就判断需要跨局累计数据
 *   （总时长、总场次、最佳成绩），散在游戏里会互相覆盖。
 *   游戏只负责产出"这一局发生了什么"，累计由这里统一算。
 */
import { GAMES } from '../games/index.js';
import { storageGet, storageSet } from '../sdk/hb.js';
import { readScope, writeScope, scopeUsage } from './save.js';

/** 本地副本的 key。云端是权威，本地只做断网兜底。 */
const LOCAL_KEY = 'profile:local:v1';

export const emptyProfile = () => ({
  games: {}, // gameId -> { plays, totalMs, best: {mode: score}, bestAt, lastPlayed }
  achievements: {}, // achId -> { at, gameId }
  totals: { plays: 0, totalMs: 0, modRuns: 0 },
  settings: {
    bgm: true,
    sfx: true,
    bgmVolume: 0.5,
    reduceMotion: false,
  },
  createdAt: Date.now(),
});

let cache = null;

/**
 * 读个人资料。
 * 【为什么云端优先、本地兜底】云存档跟着小黑盒账号走，换设备能同步，
 *   这是用户明确要求"本地存档都走小黑盒"的落点。
 *   但云端可能读不到（首次运行、断网、写入冲突），
 *   所以本地永远留一份完整副本，读不到就用它。
 */
export async function loadProfile() {
  if (cache) return cache;
  const raw = await readScope('profile');
  if (raw && raw.g) {
    cache = normalize(raw.g);
    // 顺手把本地副本对齐，避免下次断网时用的是旧数据
    storageSet(LOCAL_KEY, cache).catch(() => {});
    return cache;
  }
  const local = await storageGet(LOCAL_KEY, null);
  cache = normalize(local);
  return cache;
}

function normalize(raw) {
  const base = emptyProfile();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    games: { ...base.games, ...(raw.games || {}) },
    achievements: { ...base.achievements, ...(raw.achievements || {}) },
    totals: { ...base.totals, ...(raw.totals || {}) },
    settings: { ...base.settings, ...(raw.settings || {}) },
  };
}

/**
 * 写个人资料。
 * 【为什么先写本地再写云】云写入会失败（冲突/断网/配额），
 *   而这份数据里有时长和成就——丢了用户会心疼。
 *   先落本地，云端失败也只是"暂时没同步"，不是"数据没了"。
 */
export async function saveProfile(p) {
  cache = p;
  await storageSet(LOCAL_KEY, p);
  await writeScope('profile', { v: 1, g: p });
  return p;
}

/** 个人资料在云端的占用（设置页诊断用） */
export async function profileUsage() {
  return scopeUsage('profile');
}

export function getProfileSync() {
  return cache;
}

/**
 * 记录一局。
 * 【关键】modded 对局仍然计入"游玩时长/场次"，但**不计入最佳成绩**，
 *   因为模组可以任意改分，用它刷最佳会让记录失去意义。
 */
export async function recordRun({ gameId, mode, score, timeMs, modded }) {
  const p = await loadProfile();
  const g = p.games[gameId] || { plays: 0, totalMs: 0, best: {}, lastPlayed: 0 };
  g.plays += 1;
  g.totalMs += Math.max(0, timeMs || 0);
  g.lastPlayed = Date.now();
  if (!modded) {
    const prev = g.best[mode] || 0;
    if (score > prev) {
      g.best[mode] = Math.round(score);
      g.bestAt = Date.now();
    }
  }
  p.games[gameId] = g;
  p.totals.plays += 1;
  p.totals.totalMs += Math.max(0, timeMs || 0);
  if (modded) p.totals.modRuns += 1;

  const unlocked = checkAchievements(p, gameId);
  await saveProfile(p);
  return { profile: p, unlocked };
}

/** 成就判定：用累计数据喂给各游戏自己的 check 函数 */
function checkAchievements(p, gameId) {
  const meta = GAMES.find((g) => g.id === gameId);
  if (!meta || !meta.achievements) return [];
  const g = p.games[gameId] || {};
  const bestScore = Math.max(0, ...Object.values(g.best || {}));
  const stat = {
    plays: g.plays || 0,
    totalMs: g.totalMs || 0,
    bestScore,
    wins: g.wins || 0,
    maxTile: g.maxTile || 0,
    maxLen: g.maxLen || 0,
    totalFood: g.totalFood || 0,
    bestTimeSmall: (g.bestTimes || {}).small || 0,
    bestTimeWide: (g.bestTimes || {}).wide || 0,
    noFlagWin: !!g.noFlagWin,
    bestSlice: g.bestSlice || 0,
    cleanRun: !!g.cleanRun,
  };
  const newly = [];
  for (const a of meta.achievements) {
    if (p.achievements[a.id]) continue;
    let ok = false;
    try {
      ok = !!a.check(stat);
    } catch {
      ok = false;
    }
    if (ok) {
      p.achievements[a.id] = { at: Date.now(), gameId };
      newly.push(a);
    }
  }
  return newly;
}

/** 把一局里的额外统计合并进 profile（如最大方块、最长蛇） */
export async function mergeGameStats(gameId, extra = {}) {
  const p = await loadProfile();
  const g = p.games[gameId] || { plays: 0, totalMs: 0, best: {}, lastPlayed: 0 };
  if (extra.maxTile && extra.maxTile > (g.maxTile || 0)) g.maxTile = extra.maxTile;
  if (extra.maxLen && extra.maxLen > (g.maxLen || 0)) g.maxLen = extra.maxLen;
  if (extra.totalFood) g.totalFood = (g.totalFood || 0) + extra.totalFood;
  if (extra.bestSlice && extra.bestSlice > (g.bestSlice || 0)) g.bestSlice = extra.bestSlice;
  if (extra.won) g.wins = (g.wins || 0) + 1;
  if (extra.bestTime) {
    g.bestTimes = g.bestTimes || {};
    const cur = g.bestTimes[extra.bestTime.mode] || Infinity;
    if (extra.bestTime.ms < cur) g.bestTimes[extra.bestTime.mode] = extra.bestTime.ms;
  }
  p.games[gameId] = g;
  await saveProfile(p);
  return p;
}
