/**
 * 诗山寻踪的存档桥：把原版的 localStorage 换成小黑盒云存档。
 *
 * 【为什么只存进度】原版把「自由诗笺摘抄」也写进同一份存档，而摘抄是
 *   最多 30 张、每张 60 笔 × 400 点的手绘坐标，实测满 30 张要 2.8 MB，
 *   理论最坏 62 MB。云存档单 value 只有 16 KB，整份根本放不下。
 *   但摘抄本身是可以随时重画的娱乐内容，不是进度，所以：
 *     进入摘抄页时弹窗告知「本次抄写不会保存」，摘抄只留在内存里。
 *   去掉摘抄后，满进度（74 首诗 + 12 轶闻 + 24 藏品 + 14 章 + 80 节气）
 *   实测只有 15.4 KB，压进 2 个 value（32 KB）留足余量。
 *
 * 【为什么复用现有 save.js 而不是自己写】主工程已经有「连续分块 + LZ77 +
 *   base85 + FNV 校验 + 先写尾块最后写头」这一整套，且被 131 项测试覆盖。
 *   诗山只是多一个存档域，没必要再造一套。
 */
import { readScope, writeScope, clearScope, scopeCapacity } from '../core/save.js';
import { measurePayload } from '../core/pack.js';

/** 存档域名字。要在 core/save.js 的 SCOPES 里登记（save_20..save_21）。 */
export const SHISHAN_SCOPE = 'shishan';

/**
 * 云存档里的 key 名。原版是 localStorage 的一个固定字符串，
 * 这里保留同样的语义，只是底层换成了云存档域。
 */
export const SAVE_KEY = 'poem_mountain_trail_save_v1';
export const SAVE_VERSION = 1;

/** 本次会话是否已经提示过「摘抄不存档」，避免每次进都弹。 */
let excerptNoticeShown = false;

export function shouldShowExcerptNotice() {
  return !excerptNoticeShown;
}

export function markExcerptNoticeShown() {
  excerptNoticeShown = true;
}

/**
 * 读出存档对象。
 * 返回 null 表示「云端没有存档」，调用方应该用默认存档。
 * 【为什么要区分 null 和默认值】默认存档带 createdAt=now，
 *   如果读失败也返回默认值，就会把「读取失败」当成「新玩家」，
 *   下次写入直接覆盖掉云端的真实进度。所以这里宁可返回 null。
 */
export async function loadShishanSave() {
  try {
    const data = await readScope(SHISHAN_SCOPE);
    if (!data || typeof data !== 'object') return null;
    if (Number(data.version) !== SAVE_VERSION) return null;
    return data;
  } catch (error) {
    console.warn('[诗山存档] 读取失败：', error);
    return null;
  }
}

/**
 * 写回存档。返回 { ok, bytes, capacity, percent, error }。
 * 【为什么每次都整份写】进度数据只有十几 KB，整份写的代价远小于
 *   「按字段拆开、结果撕裂成半新半旧」的风险。和主工程其它域一致。
 */
export async function saveShishanSave(save) {
  const result = await writeScope(SHISHAN_SCOPE, save);
  if (!result.ok) {
    console.warn('[诗山存档] 写入失败：', result.error, result.bytes + '/' + result.capacity);
  }
  return result;
}

/** 估算一份存档要占多少字节（给设置页显示用）。 */
/**
 * 估算诗山存档打包后的字节数。
 *
 * 【为什么参数可以省略】设置页只想知道"现在占了多少"，手上没有 save 对象，
 *   于是调用时不传参。原来这里直接 measurePayload(undefined)，
 *   JSON.stringify(undefined) 返回 undefined，往下走 utf8Length 就抛
 *   "Cannot read properties of undefined (reading 'length')"，
 *   整个云存储用量面板变成一行报错。
 *   现在不传参时自动读当前存档，调用方怎么写都不会崩。
 */
export function measureShishanSave(save) {
  if (save === undefined || save === null) {
    return loadShishanSave().then((s) => measurePayload(s));
  }
  return measurePayload(save);
}

export function shishanCapacity() {
  return scopeCapacity(SHISHAN_SCOPE);
}

/** 清空云端存档（设置页「重置进度」用）。 */
export async function clearShishanSave() {
  await clearScope(SHISHAN_SCOPE);
}
