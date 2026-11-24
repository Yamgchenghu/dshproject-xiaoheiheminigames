/**
 * 存档版本号 —— 用来识别并作废「带 bug 时代」写下的成绩。
 *
 * 【为什么需要这个东西】推币机出过两个能刷分的 bug：
 *   1. 重开不清盘，上一局的龙珠还留在转盘上，重开一次就白捡一堆票；
 *   2. 转盘孔位不重建，残留球转到顶部会重复计分。
 *   实测 50 币能刷出 4000 多彩票（基准是每币 5.625 张，正常一局 100 分上下）。
 *
 *   修完 bug 只发新版是不够的 —— 已经写进 save_18 的最高分、
 *   已经提交到 hb_total_quantized 的总分都还在。不改数据，
 *   刷分的人照样排在老实玩家前面。
 *
 * 【为什么用「有没有版本号」判断，而不是记一个时间点】
 *   时间点要跟着服务器时间走，用户改系统时间就绕过去了；
 *   而「这份存档是不是新版本写的」是本地事实，伪造不了。
 *   老版本根本没写 save_43，所以它必然是空的。
 *
 * 【为什么只作废东海龙珠，不整个清空】别的游戏没受影响，
 *   把玩家扫雷、2048 的成绩一起抹掉是误伤。只清推币机那一格。
 */
import { readScope, writeScope } from './save.js';

/**
 * 当前存档格式版本。
 * 【什么时候要加】只要某次改动会让「旧数据不再可信」（改了计分口径、
 *   修了能刷分的 bug），就必须 +1，让旧数据被识别出来。
 *   仅仅加功能、旧数据依然有效时不要动它 —— 那会白白作废玩家成绩。
 */
export const SAVE_VERSION = 2;

/** 版本号在 save_43 里的字段名 */
const FIELD = 'v';

/**
 * 读存档版本号。
 * @returns {Promise<number>} 没有版本号（老存档）时返回 0
 */
export async function readSaveVersion() {
  try {
    const raw = await readScope('savever');
    const v = raw && raw[FIELD];
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch (e) {
    // 读失败一律当成老存档：宁可作废一次成绩，也不要让刷来的分留着
    return 0;
  }
}

/**
 * 写入当前版本号。
 * 【为什么要写 updatedAt】排查「玩家反馈成绩没了」时，
 *   需要知道这份存档是什么时候被作废/升级的。
 */
export async function writeSaveVersion(v = SAVE_VERSION) {
  try {
    await writeScope('savever', { [FIELD]: v, t: Date.now() });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 检查并升级存档。
 *
 * 老存档（没有版本号）→ 作废东海龙珠成绩，然后打上新版本号。
 * 已经是新版本的 → 什么都不做，直接返回。
 *
 * @param {{ wipeDonghai:()=>Promise<void> }} hooks
 *   作废动作由调用方注入：本模块只管版本判断，
 *   不该知道「成绩存在哪、怎么清」，否则以后换存储就得改这里。
 * @returns {Promise<{ from:number, to:number, wiped:boolean }>}
 */
export async function migrateSave(hooks = {}) {
  const from = await readSaveVersion();
  if (from >= SAVE_VERSION) return { from, to: from, wiped: false };

  // 【为什么 from === 0 才清】版本号存在但比当前小，说明是「更早的、
  //   但已经带版本号的版本」，那种情况下面可以逐版本迁移；
  //   0 表示根本没写过版本号，就是 bug 时代的数据。
  let wiped = false;
  if (from === 0 && typeof hooks.wipeDonghai === 'function') {
    try {
      await hooks.wipeDonghai();
      wiped = true;
    } catch (e) {
      console.warn('[save] 作废推币机成绩失败', e);
    }
  }

  // 【为什么即使 wipe 失败也要写版本号】不写的话每次启动都重试作废，
  //   而 wipe 失败通常是云端不可用，玩家会看到成绩反复消失又出现。
  //   写完之后这局就算升过级了，成绩留在原处但不参与排名。
  await writeSaveVersion(SAVE_VERSION);
  return { from, to: SAVE_VERSION, wiped };
}
