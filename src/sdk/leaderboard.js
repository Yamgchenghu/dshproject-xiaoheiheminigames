/**
 * 排行榜：小黑盒云端榜单 + 本地降级榜。
 *
 * 【为什么每个游戏每种模式一个 key】用户明确要求"不混榜"。
 *   混榜会让「扫雷 9×9 的 120 秒」和「35×25 的 600 秒」直接比大小，
 *   既不公平也没意义。key 规则：hb_<gameId>_<mode>，只用 [A-Za-z0-9_-]。
 *
 * 【为什么本地也要有一份榜】浏览器预览/客户端未创建榜单时会拿不到数据，
 *   直接白屏是最糟的体验。本地榜只用于展示"我自己的成绩"，并且明确标注来源。
 */
import hbSDK from '@heybox/hb-sdk';
import { getMode, getUser, storageGet, storageSet } from './hb.js';
import { getPath } from '../core/util.js';

const LOCAL_KEY = 'leaderboard:local';
const CACHE_TTL = 60 * 1000; // 平台侧 5 分钟缓存，本地再挡一层 1 分钟

/**
 * 云端榜只允许存在 3 个（平台硬限制：每个小程序最多创建 3 个排行榜）。
 *
 * 【这个限制是怎么发现的】原本按「每个游戏每种模式一个榜」设计了 33 个 key，
 *   批量创建时全部返回「每个小程序最多创建 3 个排行榜」。平台没有提供
 *   按 extra 过滤的查询能力（getList 只接受 key/limit/cursor），
 *   所以不能把多个模式塞进一个榜再在前端筛——那样所有人的成绩会混在一起排序，
 *   扫雷 9×9 的 120 秒会和 35×25 的 600 秒直接比大小，榜单失去意义。
 *
 * 【最终解法：量化 + 一个总榜】见 core/quantize.js。
 *   把每个模式的最高分按各自基准折算成可比分数（基准=100，
 *   超过基准每翻倍 +10，低于基准线性，没玩过记 0），
 *   再把全部 33 个模式累加，得到一个总分。
 *   这样 1 个榜就能公平地容纳所有游戏所有模式，
 *   玩得广和玩得深都能加分，3 个名额也不用再纠结给谁。
 *   剩余的 2 个名额留空，未来有需要再用。
 *
 * 【为什么用常量表而不是拼字符串】一旦有人给别的模式提交成绩，
 *   会因为没有对应的云端榜而拿到 LEADERBOARD_DEFAULT_NOT_FOUND。
 *   用白名单显式列出来，未知模式直接走本机，行为可预期。
 */
export const CLOUD_BOARDS = Object.freeze({
  // 综合总分榜：把玩家全部 33 个模式的最高分量化后累加。
  // 【为什么这是唯一正确的解法】平台只给 3 个榜的名额，而我们有 33 个组合。
  //   逐个模式开榜不可能，把不同模式原始分混在一起排又不公平
  //   （扫雷几百分、2048 几千分，直接相加等于比谁玩的项目分数量级大）。
  //   量化成同一把尺子后，一个榜就能公平容纳所有模式。
  'total:all': 'hb_total_quantized',
  // 推币机周榜：本周每天当日最好成绩累加，每周一清零。
  // 【为什么单独开一个榜】它的分数是"每币平均彩票"，和综合总分
  //   不是同一个量纲（综合总分是量化后累加）。混在一起排没有意义。
  //   占用第 2 个名额，还剩 1 个。
  'donghai:weekly': 'hb_donghai_weekly',
});

/** 该「游戏×模式」有没有云端榜；没有就只记本机 */
export function hasCloudBoard(gameId, mode) {
  return Object.prototype.hasOwnProperty.call(CLOUD_BOARDS, `${gameId}:${mode}`);
}

/**
 * 排行榜 key。
 * 【注意】这里仍然返回一个稳定的 key，用于本机榜的键名（本机不受 3 个的限制）。
 *   云端提交前必须先过 hasCloudBoard()。
 */
export function boardKey(gameId, mode) {
  const clean = String(mode || 'default').replace(/[^A-Za-z0-9_-]/g, '_');
  return `hb_${gameId}_${clean}`.slice(0, 64);
}

/** 云端榜 key；没有云端榜时返回 null */
export function cloudBoardKey(gameId, mode) {
  return CLOUD_BOARDS[`${gameId}:${mode}`] || null;
}

const memCache = new Map();

/**
 * 提交成绩。
 * 【关键规则】带模组（Python 注入）的对局不计入排行榜 —— 见 modEnabled 参数。
 *   这不是技术限制而是公平性要求：模组可以任意改分数，允许上榜等于榜单作废。
 */
export async function submitScore({ gameId, mode, score, extra = {}, modded = false }) {
  if (modded) return { ok: false, reason: 'modded' };
  if (!Number.isFinite(score) || score <= 0) return { ok: false, reason: 'invalid' };
  const key = boardKey(gameId, mode);
  const rounded = Math.round(score);

  // 无论平台是否可用，先写本地记录：离线时用户也想看到自己的最好成绩
  await recordLocal(key, { score: rounded, at: Date.now(), extra });

  // 逐模式的云端榜已经取消（3 个名额让给了综合总榜），
  // 所以单模式成绩只记本机，用于「我的」页展示和历史对比。
  const cloudKey = cloudBoardKey(gameId, mode);
  if (!cloudKey) {
    return { ok: true, local: true, score: rounded, reason: 'local-only' };
  }
  if (getMode() !== 'host') {
    return { ok: true, local: true, score: rounded, reason: 'hostless' };
  }
  try {
    const entry = await hbSDK.cloud.leaderboard.submit({ key: cloudKey, score: rounded, extra });
    memCache.delete(cloudKey);
    return { ok: true, entry, score: entry.score, rank: entry.rank, ranked: entry.ranked };
  } catch (e) {
    const code = (e && e.code) || String(e);
    return {
      ok: false,
      reason: code === 'UNAUTHORIZED' ? 'not-logged-in' : code,
      code,
      local: true,
      score: rounded,
    };
  }
}

/**
 * 提交综合总分榜。
 *
 * 【为什么单独一个函数】逐模式榜和总榜的数据来源不同：
 *   单模式用"这一局的分数"，总榜必须用"全部 33 个模式的最高分重新累加"。
 *   每局结束都要重算，因为这一局可能刷新了某个模式的最高分。
 *
 * 【为什么要在写完之后再读一次最高分】recordLocal 是异步的，
 *   而且云端最高分可能比本地新（换设备场景）。所以先把本局成绩写进
 *   save_18 的最高分表，再从那张表重新累加，才是权威值。
 */
export async function submitTotalScore({ extra = {}, modded = false } = {}) {
  if (modded) {
    // 带模组的对局不计入总榜：模组能改分数，允许上榜等于榜单作废
    return { ok: false, reason: 'modded' };
  }
  const cloudKey = cloudBoardKey('total', 'all');
  if (!cloudKey) return { ok: false, reason: 'no-board' };

  // 延迟 import，避免 leaderboard.js 与 scores.js 形成循环依赖
  const [{ loadScores }, { totalQuantized }] = await Promise.all([
    import('../core/scores.js'),
    import('../core/quantize.js'),
  ]);
  const scores = await loadScores();
  const { total, parts } = totalQuantized(scores || {});
  if (!(total > 0)) {
    // 一分没得（全新玩家或全部 0 分）不提交，避免刷出一堆 0 分记录
    return { ok: false, reason: 'empty', total: 0 };
  }

  const payload = {
    ...extra,
    // extra 只放公开展示需要的字段，且不参与排序
    modes: parts.filter((p) => p.q > 0).length,
  };

  if (getMode() !== 'host') {
    return { ok: true, local: true, total, reason: 'hostless' };
  }
  try {
    const entry = await hbSDK.cloud.leaderboard.submit({
      key: cloudKey,
      // 平台要求 score 是有限安全数字；总分保留 2 位小数足够，取整避免浮点尾数
      score: Math.round(total),
      extra: payload,
    });
    memCache.delete(cloudKey);
    return { ok: true, entry, total, rank: entry.rank, ranked: entry.ranked };
  } catch (e) {
    const code = (e && e.code) || String(e);
    return {
      ok: false,
      reason: code === 'UNAUTHORIZED' ? 'not-logged-in' : code,
      code,
      total,
    };
  }
}

export async function fetchBoard({ gameId, mode, limit = 20, cursor }) {
  const key = boardKey(gameId, mode);
  const cacheKey = key + ':' + limit + ':' + (cursor || '');
  const hit = memCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;

  const cloudKey = cloudBoardKey(gameId, mode);
  let value;
  if (cloudKey && getMode() === 'host') {
    try {
      const page = await hbSDK.cloud.leaderboard.getList({ key: cloudKey, limit, ...(cursor ? { cursor } : {}) });
      value = {
        source: 'cloud',
        entries: (page.entries || []).map((e) => ({
          rank: e.rank,
          score: e.score,
          name: (e.extra && e.extra.nick) || '玩家',
          avatar: (e.extra && e.extra.avatar) || '',
          extra: e.extra || {},
          self: false,
        })),
        cursor: page.cursor,
        hasMore: !!page.hasMore,
      };
    } catch (e) {
      const code = (e && e.code) || String(e);
      value = {
        source: 'local',
        entries: await localBoard(key, limit),
        error: code === 'UNAUTHORIZED' ? 'not-logged-in' : code,
        code,
      };
    }
  } else {
    value = { source: 'local', entries: await localBoard(key, limit) };
  }
  memCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

export async function fetchMyEntry({ gameId, mode }) {
  const key = boardKey(gameId, mode);
  const cloudKey = cloudBoardKey(gameId, mode);
  if (cloudKey && getMode() === 'host') {
    try {
      const e = await hbSDK.cloud.leaderboard.getCurrentUserEntry({ key: cloudKey });
      return e ? { score: e.score, rank: e.rank, ranked: e.ranked } : null;
    } catch {
      /* 落到本地 */
    }
  }
  const all = (await storageGet(LOCAL_KEY, {})) || {};
  const mine = all[key];
  return mine ? { score: mine.score, rank: 0, ranked: false, local: true } : null;
}

async function localBoard(key, limit) {
  const all = (await storageGet(LOCAL_KEY, {})) || {};
  const mine = all[key];
  if (!mine) return [];
  const me = await getUser();
  return [
    {
      rank: 1,
      score: mine.score,
      name: me ? me.nick : '我（本机）',
      avatar: me ? me.avatar : '',
      extra: mine.extra || {},
      self: true,
    },
  ].slice(0, limit);
}

async function recordLocal(key, rec) {
  const all = (await storageGet(LOCAL_KEY, {})) || {};
  const prev = all[key];
  if (!prev || rec.score > prev.score) all[key] = rec;
  await storageSet(LOCAL_KEY, all);
}

/** 排行榜条目里可能出现的昵称/头像字段（extra 是自由 JSON，做一次容错读取） */
export function pickNick(entry) {
  return getPath(entry, 'extra.nick') || entry.name || '玩家';
}
