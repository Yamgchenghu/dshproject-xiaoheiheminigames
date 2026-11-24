/**
 * 各小游戏的最高分 —— 全部压缩进**一个** value（save_18）。
 *
 * 【为什么只要 1 个 value】用户给的硬指标。技术上确实够：
 *   4 个游戏 × 3 种模式 = 12 个 (游戏,模式) 组合，每个只需要一个整数。
 *   最朴素的存法是 { "hb_minesweeper_small": 842, ... }，
 *   12 条大约 400 字节，连 16KB 的 3% 都用不到。
 *   所以这里**不做任何取巧**：不加简写、不加变长编码、不做位打包。
 *   为了省几百字节引入一套自定义二进制格式，换来的是以后没人看得懂
 *   这份存档、出问题没法手工修——完全不划算。
 *
 * 【为什么最高分不放进个人资料】个人资料里有成就、总时长、设置，
 *   每次改设置都会重写它。最高分是"最不该丢"的数据，
 *   单独放一个 value，被别的写入牵连的概率最低。
 *
 * 【为什么还要留本地副本】云端写入可能失败（VERSION_CONFLICT、断网）。
 *   最高分丢了用户是真的会生气的，所以本地 localStorage 同步留一份，
 *   云端读不到时用它兜底。
 */
import { readScope, writeScope, scopeUsage } from './save.js';
import { storageGet, storageSet } from '../sdk/hb.js';

const LOCAL_KEY = 'scores:local:v1';

/** 内存缓存：游戏结算时要同步知道"破没破纪录"，不能等异步 */
let cache = null;

/**
 * 丢掉内存里的最高分缓存。
 * 【为什么清空进度时必须调用】loadScores 把结果缓存在模块级变量里，
 *   清完云存档后缓存还是旧数据，读出来等于没清——榜上分数会"复活"。
 *   必须显式让缓存失效，下次读取才会重新走云端。
 */
export function resetScoresCache() {
  cache = null;
}
let loading = null;

/** 存储用的短键，避免把 hb_minesweeper_small 这种长 key 存 12 遍 */
const SHORT = {
  minesweeper: 'ms',
  fruitninja: 'fj',
  g2048: 'g2',
  snake: 'sn',
  watermelon: 'wm',
  // 流水入杯是关卡制，14 个关卡各存一条（键是 ls.lv1 … ls.lv14）
  liushui: 'ls',
  // 东海龙珠（推币机）：存的是"每币平均彩票"，量化后计入总分。
  // 【为什么这个键必须和 quantize.js 的 SHORT_KEYS 一致】总榜是用
  //   totalQuantized() 读 save_18 里各模式的最高分再累加的，
  //   它按 SHORT_KEYS.donghai = 'dh' 去取 'dh.classic'。
  //   这里原来漏了 donghai，recordBest 存出来的键是 'donghai.classic'，
  //   和 'dh.classic' 对不上 —— 结果推币机的分**从来没进过总分榜**，
  //   一直是 0，而且完全没有报错，静默失效了很久。
  //   test-quantize.mjs 的「短键与存档一致」断言就是防这个的，
  //   但它当时只比对了已登记的游戏，没覆盖到漏登记的情况。
  donghai: 'dh',
  // 流水入杯的「得分」（= 滴数 − 190），供综合总榜累加。
  // 【为什么不能直接用 ls.*】ls.* 存的是滴数，190 滴是"刚好达标"，
  //   当成 190 分会虚高；而且关卡解锁判定依赖滴数 >= 190，
  //   两者语义不同，必须分开存。
  liushui_q: 'lsq',
};

function shortKey(gameId, mode) {
  const g = SHORT[gameId] || gameId;
  return g + '.' + String(mode || 'default').replace(/[^A-Za-z0-9_]/g, '_');
}

export async function loadScores() {
  // 【为什么不能只判 cache 是否存在】空对象 {} 是 truthy。
  //   启动时如果存档还是空的（新玩家、刚清过缓存、云端还没回），
  //   这里会把 cache 锁成 {}，之后**整个会话都读不到新写入的成绩**：
  //   外面 recordBest 明明写进了 save_18，loadScores 却直接返回那个空对象。
  //   表现出来就是「基准分查询里我的最好永远是 —」、
  //   「打完一局排行榜没变化」，而且刷新页面才恢复。
  //   所以空对象也要重新读一次。
  if (cache && Object.keys(cache).length) return cache;
  // 【为什么 loading 用完必须清空】它是"正在读"的合并锁，只该防止并发重复读。
  //   原来赋值后从不重置，第二次调用会直接拿到那个**已经结束**的 Promise，
  //   里面是当时读到的（可能是空的）结果 —— 等于把第一次的空结果永久钉死。
  //   配合上面那条"空 cache 也要重读"，这里清空后才能真正重新读盘。
  if (!loading) {
    loading = (async () => {
      const raw = await readScope('scores');
      cache = (raw && raw.b && typeof raw.b === 'object') ? raw.b : {};
      // 云端是空的（首次运行或云端写入一直失败）→ 用本地兜底
      if (!Object.keys(cache).length) {
        const local = await storageGet(LOCAL_KEY, null);
        if (local && typeof local === 'object') cache = local;
      }
      return cache;
    })().finally(() => { loading = null; });
  }
  return loading;
}

/** 同步读某个 (游戏,模式) 的最高分；没加载过返回 0 */
export function getBestSync(gameId, mode) {
  if (!cache) return 0;
  return cache[shortKey(gameId, mode)] || 0;
}

/**
 * 同步取全部成绩的副本（键是存储短键，如 ms.small、lsq.lv1）。
 *
 * 【为什么需要它】「我的」页要显示综合总分，而总分是全部 33 个模式的函数。
 *   页面渲染是同步的（renderMineTab 不是 async），逐个 await 不现实；
 *   而 loadScores 在启动时就已经把数据读进 cache 了，这里直接给副本即可。
 *   返回副本是为了防止调用方误改缓存。
 */
export function getAllSync() {
  if (!cache) return {};
  return { ...cache };
}

/**
 * 记录一次成绩。
 * @returns {{ best:number, isNew:boolean }}
 */
/**
 * 这些游戏的分数是小数，必须保留精度。
 *
 * 【为什么不能一律取整】推币机的成绩是「每币平均彩票」，
 *   基准 5.625、正常发挥 5.3~5.73 —— 全落在 5 和 6 之间。
 *   Math.round 会把 5.3 和 5.73 一起变成 6，基准线当场失效：
 *   瞄准打得好和挂机随便打，存下来一模一样。
 *   其他游戏（扫雷、2048、贪吃蛇…）的分数本来就是整数，
 *   取整对它们没有损失，所以只给小数型游戏开这个口子。
 */
const FRACTIONAL_GAMES = new Set(['donghai']);

export async function recordBest(gameId, mode, score) {
  const all = await loadScores();
  if (!Number.isFinite(score) || score <= 0) {
    return { best: all[shortKey(gameId, mode)] || 0, isNew: false };
  }
  const k = shortKey(gameId, mode);
  const prev = all[k] || 0;
  // 小数型游戏保留 3 位（和 scoring.js 的 roundScore 一致），其余取整
  const rounded = FRACTIONAL_GAMES.has(gameId)
    ? Math.round(score * 1000) / 1000
    : Math.round(score);
  if (rounded <= prev) return { best: prev, isNew: false };

  all[k] = rounded;
  cache = all;
  // 先写本地：云端失败时这一份还在
  await storageSet(LOCAL_KEY, all);
  await writeScope('scores', { v: 1, b: all });
  return { best: rounded, isNew: true };
}

/** 某个游戏所有模式的最高分 */
export function bestOfGameSync(gameId) {
  if (!cache) return {};
  const prefix = (SHORT[gameId] || gameId) + '.';
  const out = {};
  for (const k of Object.keys(cache)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = cache[k];
  }
  return out;
}

/**
 * 作废东海龙珠的全部本地成绩。
 *
 * 【为什么要单独一个函数】推币机出过能刷分的 bug，旧数据不可信。
 *   作废要同时动三处，少一处就白做：
 *     1. save_18 里的最高分（dh.classic）—— 不删，界面还显示旧纪录；
 *     2. localStorage 副本 —— 云端读失败时会拿它兜底，旧分"复活"；
 *     3. 内存缓存 —— 不失效的话本次运行还是读到旧值。
 *
 * 【为什么不顺手提交云端总榜】总分是「读最高分 → 重算 → 提交」，
 *   清完最高分后下一次正常结算会自动把更低的总分覆盖上去。
 *   在这里强行提交，会在玩家没玩任何游戏时凭空改他的榜上成绩。
 */
export async function wipeGameScores(gameId) {
  const prefix = (SHORT[gameId] || gameId) + '.';
  const all = await loadScores();
  let removed = 0;
  for (const k of Object.keys(all)) {
    if (k.startsWith(prefix)) { delete all[k]; removed++; }
  }
  if (!removed) return 0;

  cache = all;
  await storageSet(LOCAL_KEY, all);
  await writeScope('scores', { v: 1, b: all });
  return removed;
}

export async function scoreUsage() {
  const u = await scopeUsage('scores');
  return { ...u, entries: cache ? Object.keys(cache).length : 0 };
}
