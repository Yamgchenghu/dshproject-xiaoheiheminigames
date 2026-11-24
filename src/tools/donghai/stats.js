/**
 * 东海龙珠的战绩存档：每日挑战进度 + 本周榜。
 *
 * 【为什么单独一层，而不是直接在 screen.js 里读写】存档域是有容量上限的
 *   （1 个 value = 16 KB），而周榜会随天数增长。这一层负责两件事：
 *     1. 只保留本周，跨周自动丢掉上周数据（否则一年后会写满）；
 *     2. 同一份数据既要给"今日剩余次数"用，也要给"周榜总分"用，
 *        读一次缓存住，避免每次渲染都打一次存储。
 */
import { readScope, writeScope, clearScope } from '../../core/save.js';
import {
  dateKeyOf, weekStartKey, emptyDaily, emptyWeek,
  applyAttempt, applyDayScore, attemptsLeft, dailyLimit, DAILY_ATTEMPTS,
  weekIndex, encodeWeekly, decodeWeekly,
} from './scoring.js';
import { submitScore, fetchBoard, fetchMyEntry } from '../../sdk/leaderboard.js';
import { accountForBoard } from '../../sdk/account.js';

/**
 * 云端一次拉多少条。
 * 【为什么不是 50】云榜"最高分永久保留"，历史周的编码值更大、会长期占前排。
 *   只拉 50 条时，本周成绩可能一条都进不去，过滤完就是空榜。
 *   平台 rankLimit 是 500，这里取 200 留余量（拉太多流量也浪费）。
 */
const CLOUD_FETCH_LIMIT = 200;

const SCOPE = 'donghai';
/** 局内进度（挑战局进行中：已投币数、剩余额度） */
const RUN_SCOPE = 'donghai.run';

/** 内存缓存：{ daily, week } */
let cache = null;
let loading = null;

/**
 * 作废推币机的全部战绩与局内进度。
 *
 * 【为什么这个必须存在】推币机出过能刷分的 bug（重开不清盘、转盘孔位不重建），
 *   已经写进 save_41 的「今日最好 / 本周累计」都不可信。修完 bug 不清数据，
 *   刷分的人照样排在老实玩家前面。
 *
 * 【为什么连 save_42 一起清】那是挑战局的局内进度（投了几币、剩多少额度）。
 *   留着的话玩家升级后进来会"接上"一局用 bug 打出来的进度，
 *   额度已经用掉大半，等于凭空少一次机会。
 *
 * 【为什么必须清内存缓存】loadDonghaiStats 把结果缓存在模块级 cache 里，
 *   不置空的话本次运行读到的还是旧数据，界面显示旧分、提交也按旧分算。
 */
export async function wipeDonghaiStats() {
  cache = null;
  loading = null;
  try { await clearScope(SCOPE); } catch (e) { /* 本来就没有，忽略 */ }
  try { await clearScope(RUN_SCOPE); } catch (e) { /* 同上 */ }
}

/**
 * 读取战绩。
 * 【为什么跨周要清空】"每周刷新"是用户明确要求。判断依据是 week 字段
 *   和当前周起始日是否一致——不一致说明跨周了，直接给一份空的。
 *   这里不做"保留历史"的加法，历史周榜没有展示位，留着只是占容量。
 */
export async function loadDonghaiStats() {
  if (cache) return cache;
  if (!loading) {
    loading = (async () => {
      let raw = null;
      try { raw = await readScope(SCOPE); } catch (e) { raw = null; }
      const today = dateKeyOf();
      const week = weekStartKey();

      const savedDaily = raw && raw.daily;
      const savedWeek = raw && raw.week;

      cache = {
        // 当天没玩过 → 给一份全新的（剩余 3 次）
        daily: savedDaily && savedDaily.date === today
          ? { date: today, used: savedDaily.used || 0, best: savedDaily.best || 0, limit: dailyLimit(today) }
          : emptyDaily(today),
        // 跨周 → 清空
        week: savedWeek && savedWeek.week === week
          ? { week, days: savedWeek.days || {}, total: savedWeek.total || 0 }
          : emptyWeek(week),
      };
      return cache;
    })();
  }
  return loading;
}

/**
 * 记录一次挑战成绩。
 * @param {number} score 本局成绩（每币平均彩票）
 * @returns 更新后的战绩
 */
export async function recordDonghaiRun(score) {
  const stats = await loadDonghaiStats();
  const today = dateKeyOf();
  const week = weekStartKey();

  stats.daily = applyAttempt(stats.daily, today, score);
  stats.week = applyDayScore(stats.week, week, today, score);

  try {
    await writeScope(SCOPE, { daily: stats.daily, week: stats.week });
  } catch (e) {
    // 【为什么吞掉异常】存储失败不该让玩家丢掉这一局——
    //   内存里的 stats 已经更新了，本局分数照常显示。
    console.warn('[donghai] 战绩写入失败', e);
  }
  return stats;
}

/** 今天还能挑战几次（同步，供渲染用；调用前需先 loadDonghaiStats） */
export function todayAttemptsLeft() {
  if (!cache) return DAILY_ATTEMPTS;
  return attemptsLeft(cache.daily, dateKeyOf());
}

/** 今日限额档位 */
export function todayLimit() {
  return dailyLimit(dateKeyOf());
}

/** 本周榜（同步） */
export function thisWeek() {
  return cache ? cache.week : emptyWeek(weekStartKey());
}

/** 今日进度（同步） */
export function todayDaily() {
  return cache ? cache.daily : emptyDaily(dateKeyOf());
}

/** 测试用：清缓存 */
export function resetDonghaiCache() {
  cache = null;
  loading = null;
}

/**
 * 把本周总分提交到云端周榜。
 *
 * 【提交的是编码值，不是总分】见 scoring.js 的 encodeWeekly：
 *   周次在高位，所以"取最高分"等价于"取最新周"。旧周成绩不会被显示出来。
 *
 * 【为什么要 try/catch 吞掉】没登录、离线、平台抽风都可能失败。
 *   周榜上不去不该让玩家丢掉这一局——本地记录已经写好了。
 */
export async function submitWeeklyBoard() {
  const stats = await loadDonghaiStats();
  const total = stats.week.total || 0;
  if (total <= 0) return { ok: false, reason: 'empty' };
  const wk = weekIndex(weekStartKey());
  const encoded = encodeWeekly(wk, total);
  try {
    const res = await submitScore({
      gameId: 'donghai',
      mode: 'weekly',
      score: encoded,
      extra: accountForBoard(),
    });
    return res;
  } catch (e) {
    console.warn('[donghai] 周榜提交失败', e);
    return { ok: false, reason: String(e) };
  }
}

/**
 * 读取云端周榜（前 50 名）。
 *
 * 【为什么要过滤】云榜里可能留着别的周的成绩（别的玩家上周提交的）。
 *   这里按当前周次筛一遍，只留本周的。旧周的条目不显示——
 *   这正是"每周刷新"在客户端的体现。
 *
 * @returns {{ entries: Array, weekIdx: number, error?: string }}
 */
export async function fetchWeeklyBoard(limit = 50) {
  const wk = weekIndex(weekStartKey());
  try {
    // 【为什么要多拉】云榜是"最高分永久保留、不重置"，而周榜靠把周序号编进分数
    //   来区分周次。历史周的成绩编码值可能比本周任何成绩都大，会长期霸占前排。
    //   只拉 50 条的话，某周玩家提交的分可能一条都进不了前 50，
    //   拉回来过滤本周之后就是空榜——看着像"周榜坏了"。
    //   多拉一批，给历史周留出足够的挤压空间。
    const board = await fetchBoard({ gameId: 'donghai', mode: 'weekly', limit: CLOUD_FETCH_LIMIT });
    const entries = [];
    for (const e of board.entries || []) {
      const d = decodeWeekly(e.score);
      // 只保留本周的
      if (d.weekIdx !== wk) continue;
      entries.push({
        rank: e.rank,
        total: d.total,
        name: e.name,
        avatar: e.avatar,
        self: e.self,
      });
    }
    // 过滤后名次会断档，重排一遍
    entries.sort((a, b) => b.total - a.total);
    const top = entries.slice(0, limit);
    top.forEach((e, i) => { e.rank = i + 1; });

    // 【为什么还要单独查自己】getList 返回的 self 恒为 false —— 平台不告诉我们
    //   "哪条是你"。getCurrentUserEntry 才是权威来源。
    //   它返回 undefined 表示本周没记录，返回 { ranked:false, rank:0 } 表示有记录
    //   但超出展示范围，这两种都不是错误。
    let me = null;
    if (board.source === 'cloud') {
      try {
        const mine = await fetchMyEntry({ gameId: 'donghai', mode: 'weekly' });
        if (mine && Number.isFinite(mine.score)) {
          const d = decodeWeekly(mine.score);
          me = { total: d.total, weekIdx: d.weekIdx, ranked: mine.ranked !== false, rank: mine.rank || 0, inWeek: d.weekIdx === wk };
          // 自己在本周且在展示范围内，就把 self 标到对应那条上
          if (me.inWeek && me.ranked) {
            const hit = top.find(e => e.total === me.total);
            if (hit) hit.self = true;
          }
        }
      } catch (e) {
        // 未登录 / 网络失败都不影响看榜，静默跳过
      }
    }

    return { entries: top, weekIdx: wk, source: board.source, error: board.error, me };
  } catch (e) {
    return { entries: [], weekIdx: wk, error: String(e) };
  }
}


/* ---------------- 挑战局进行中的存档 ---------------- */

/**
 * 保存进行中的挑战局。
 *
 * 【为什么需要它】挑战局有币数上限（50/80/100/120），一局要投几十上百颗珠子。
 *   玩家中途退出去看周榜、切个页面、被电话打断，回来必须接着投——
 *   否则限额从 0 重新算，等于白送一次机会。
 *
 * 【为什么只存这几个字段】盘面上的珠子位置是纯视觉的，重开时由物理
 *   重新落一遍就行；真正影响公平的是"这一局已经投掉多少额度"。
 *   只存这个，既够用又不会让存档膨胀。
 */
export async function saveRunState(run) {
  if (!run) return;
  try {
    await writeScope(RUN_SCOPE, {
      date: dateKeyOf(),
      joined: !!run.joined,
      coinsSpent: Math.max(0, Math.floor(run.coinsSpent || 0)),
      limit: Math.max(0, Math.floor(run.limit || 0)),
      tickets: Math.max(0, Math.floor(run.tickets || 0)),
      at: Date.now(),
    });
  } catch (e) {
    console.warn('[donghai] 挑战进度写入失败', e);
  }
}

/**
 * 读取进行中的挑战局。
 * 【为什么跨天就丢掉】限额是按天算的，昨天的"已投 30 币"今天没有意义。
 */
export async function loadRunState() {
  try {
    const raw = await readScope(RUN_SCOPE);
    if (!raw) return null;
    if (raw.date !== dateKeyOf()) return null;
    return raw;
  } catch (e) {
    return null;
  }
}

/** 一局结算或退出后清掉进度 */
export async function clearRunState() {
  try {
    await writeScope(RUN_SCOPE, { date: dateKeyOf(), joined: false, coinsSpent: 0, limit: 0, tickets: 0, at: Date.now() });
  } catch (e) {
    // 清不掉不影响玩，下次读会因为 coinsSpent=0 自然等价于"没开始"
  }
}
