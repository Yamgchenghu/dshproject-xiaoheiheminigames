/**
 * 东海龙珠 · 计分与挑战规则
 *
 * 【为什么单独一个文件】这里的每一行都是用户定的规则，不是实现细节：
 *   分数怎么算、每日几次、限额多少、周榜怎么刷新。
 *   塞进 2700 行的 game.js 里，改规则就得翻半天，也没法单独测。
 */

/**
 * 基准：每币 45/8 = 5.625 张彩票 = 100 分。
 *
 * 【为什么写成 45/8 而不是 5.625】用户给的就是分数形式。写成分数，
 *   一眼能看出它是"45 张票 / 8 个币"这个具体场景，不是随手拍的小数；
 *   也避免手抄 5.625 时抄错成 5.65 或 5.6 —— 基准错 1% 全服分数都偏。
 *
 * 【为什么定在 5.625】实测：自动连发不瞄准 5.3 张、瞄准彩票槽 5.73 张。
 *   5.625 正好卡在两者之间 —— 不瞄准约 94 分，瞄准到位刚过 100。
 *   这个基准意味着"必须瞄准才够 100"，挂机刷不到。
 */
export const BASE_TICKETS_PER_COIN = 45 / 8;

/**
 * 每币平均彩票。
 * 【为什么要这个而不是总彩票】总彩票高只说明玩得久、币投得多，
 *   推币机本来就是个吃币的东西——比谁币多没有意义。
 *   每币能换回多少张票，才是这台机器的"回报率"，这才是水平。
 */
export function ticketsPerCoin(coinsSpent, tickets) {
  const coins = Math.max(0, Math.floor(coinsSpent));
  if (coins === 0) return 0;
  return Math.max(0, tickets) / coins;
}

/**
 * 本局原始分。
 * 【为什么保留三位小数】基准是 12.000，小数点后三位是用户给的精度。
 *   四舍五入到整数会让 11.999 和 12.000 没区别，而它们对应的
 *   量化分是 99.99 和 100，差一档。
 */
export function roundScore(perCoin) {
  return Math.round(perCoin * 1000) / 1000;
}

/**
 * 量化分：把"每币彩票"换算成和别的游戏可比的分数。
 *
 * 【为什么复用项目里的公式】综合总分榜是把所有游戏的量化分累加的，
 *   推币机如果自己另搞一套，它在总榜里就没有可比性。
 *   公式见 core/quantize.js：达到基准 100，超出按对数，不足按线性。
 *
 * 【这里为什么自己实现一份而不是 import】quantize.js 依赖整个游戏注册表
 *   （会连带加载所有游戏模块）。这个小游戏要能独立测，不拖进半个项目。
 *   公式和 quantize.js 保持一致，有测试对拍。
 */
export const Q_CAP = 200;
export function quantize(score, base = BASE_TICKETS_PER_COIN) {
  if (!(score > 0) || !(base > 0)) return 0;
  const q = score >= base
    ? 100 + 10 * Math.log2(score / base)
    : 100 * (score / base);
  return Math.min(Q_CAP, Math.round(q * 100) / 100);
}

/** 每日挑战的限额档位（币）。每天随机取一档。 */
export const CHALLENGE_LIMITS = Object.freeze([50, 80, 100, 120]);

/** 每人每日可挑战次数 */
export const DAILY_ATTEMPTS = 3;

/**
 * 计入周榜所需的最少投币数。
 *
 * 【为什么必须有这条】成绩是「票数 ÷ 币数」，分母小的时候比值会爆炸。
 *   实测过一条刷分路径：反复重开把盘面堆满（一堆大龙珠和珍珠），
 *   然后只投 1 币、恰好触发 10 秒派对，让转盘里的球全落下去 ——
 *   1 币换回两三百张票，每币 200+，量化分直接顶到 150 以上，
 *   而正常瞄准打一整局才 5.7 张/币。
 *
 *   分母小到 1、2 的时候，这个比值衡量的是「运气」，不是「水平」。
 *   所以设一个下限：投币数不够的局可以玩、可以看成绩，
 *   但不进周榜，也不占当天的挑战次数。
 *
 * 【为什么是 20】用户定的门槛：至少 20 币才算成绩。
 *   基准是 45 张票 / 8 个币，20 币对应约 112 张票的正常产出。
 *   一次派对的产出（170~280 张）在 20 币的基数上仍能把比值抬到 2~3 倍，
 *   所以这条门槛只挡掉「投 1~2 币靠一次派对吃满」的极端情况，
 *   挡不住「20 币 + 全程派对」的运气局。
 *   后者要靠另外两条修复兜底：
 *     1. seedTable 每次重开都清盘 —— 盘面堆不到几十颗大龙珠；
 *     2. 转盘孔位重建 —— 残留球不会重复计分。
 *   三条一起，刷分路径才算真正堵死。
 */
export const MIN_COINS_FOR_RANK = 20;

/**
 * 当天是哪一档限额。
 * 【为什么要确定性】同一台机器所有人当天必须玩同一档，
 *   否则榜上 50 币和 120 币的成绩混在一起，没法比。
 *   用日期做种，所有人算出同一个值，也不需要服务器下发。
 */
export function dailyLimit(dateKey) {
  const n = hashDate(dateKey);
  return CHALLENGE_LIMITS[n % CHALLENGE_LIMITS.length];
}

/** 把 YYYY-MM-DD 哈希成一个稳定正整数 */
function hashDate(dateKey) {
  let h = 0x811c9dc5;
  const s = String(dateKey);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 本地日期键 YYYY-MM-DD（按设备本地时区，不是 UTC） */
export function dateKeyOf(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

/**
 * 本周的周一日期键。
 * 【为什么用周一而不是周日】"每周刷新"的直觉是"这周开始了"，
 *   而用户说的"每周日推币榜"指的是周日结算/刷新。
 *   按 ISO 习惯，周一为一周之始，周日是这一周的最后一天——
 *   周日照常玩，成绩计入本周；周一零点清零。
 */
export function weekStartKey(d = new Date()) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (t.getDay() + 6) % 7; // 周一=0
  t.setDate(t.getDate() - dow);
  return dateKeyOf(t);
}

/**
 * 每日挑战的进度。
 * 【为什么要存「已用次数 + 最好成绩」而不是只存最好成绩】
 *   3 次机会用完了要能拦住第 4 次；而榜上只记最好那次。
 *   两个信息缺一不可。
 */
export function emptyDaily(dateKey) {
  return { date: dateKey, used: 0, best: 0, limit: dailyLimit(dateKey) };
}

/**
 * 更新当日进度。
 * @returns 新的进度对象（不改原对象）
 */
export function applyAttempt(daily, dateKey, score) {
  const base = daily && daily.date === dateKey ? daily : emptyDaily(dateKey);
  const used = base.used + 1;
  return {
    date: dateKey,
    used,
    limit: base.limit,
    best: Math.max(base.best || 0, score || 0),
  };
}

/** 今天还能挑战几次 */
export function attemptsLeft(daily, dateKey) {
  if (!daily || daily.date !== dateKey) return DAILY_ATTEMPTS;
  return Math.max(0, DAILY_ATTEMPTS - (daily.used || 0));
}

/**
 * 周榜数据：{ week: '2026-11-17', days: { '2026-11-17': 95.2, ... }, total }
 *
 * 【为什么"每日累加"】用户要求"排行榜每日累加，每周刷新"。
 *   也就是本周每天的当日最好成绩相加，周一清零。
 *   不是"取本周最高的一天"——那样玩一天就够了。
 */
export function emptyWeek(weekKey) {
  return { week: weekKey, days: {}, total: 0 };
}

export function applyDayScore(week, weekKey, dateKey, score) {
  const base = week && week.week === weekKey ? week : emptyWeek(weekKey);
  const days = { ...base.days };
  // 同一天多次挑战，只留最好的那次
  days[dateKey] = Math.max(days[dateKey] || 0, score || 0);
  let total = 0;
  for (const k of Object.keys(days)) total += days[k];
  return { week: weekKey, days, total: Math.round(total * 1000) / 1000 };
}

/**
 * 云榜提交值的编码：周次 × 10000 + 周总分。
 *
 * 【为什么要把周次编进分数】平台云榜只有"取最高分"语义，没有清零、
 *   也没有按 extra 过滤的能力（getList 只接受 key/limit/cursor）。
 *   如果直接把周总分交上去，第 1 周攒了 45.5，第 2 周只玩了两天得 13.6，
 *   云上仍然是 45.5 —— 新一周的榜显示的其实是上一周的成绩。
 *   把周次放大 10000 倍放在高位，云上"最高分"自然就是"最新的周"，
 *   旧周的分数因为周次更小，永远比不过新周，等价于自动清零。
 *
 * 【为什么是 10000】周总分是"每天每币平均彩票"的累加，7 天满打满算
 *   也就几十到一两百（基准 12、一天 3 次机会）。10000 给足了余量，
 *   同时保证编码后的整数不溢出（周次约 2900，乘 10000 是 2900 万，
 *   远在 Number 安全整数范围内）。
 */
export const WEEK_ENCODE_BASE = 10000;

/** 日期 → 周序号（从 1970-01-05 那个周一起算第 0 周） */
export function weekIndex(dateKey) {
  // 【为什么要用 UTC 做差】直接用本地时间做差，遇到夏令时会差一小时，
  //   Math.floor 之后就少一天，周次会算错。这里统一按 UTC 零点算。
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  // 1970-01-05 是星期一
  const base = Date.UTC(1970, 0, 5);
  return Math.floor((t - base) / (7 * 86400000));
}

/** 周总分 → 云榜提交值 */
export function encodeWeekly(weekIdx, total) {
  // 周总分保留三位小数，乘以 1000 变成整数再拼周次
  const scaled = Math.round(Math.max(0, total) * 1000);
  return weekIdx * WEEK_ENCODE_BASE * 1000 + scaled;
}

/** 云榜提交值 → { weekIdx, total } */
export function decodeWeekly(encoded) {
  const n = Math.max(0, Math.floor(Number(encoded) || 0));
  const weekIdx = Math.floor(n / (WEEK_ENCODE_BASE * 1000));
  const scaled = n - weekIdx * WEEK_ENCODE_BASE * 1000;
  return { weekIdx, total: scaled / 1000 };
}
