/**
 * 插画索引：读取由 `node scripts/art/generate-art.mjs` 生成的 manifest。
 *
 * manifest 与 DataManager.artKey 一一对应：
 *   poem_card_<id> / anecdote_<id> / collection_<collection_id>
 * 图片文件放在 public/assets/images/art/，由 PreloadScene 统一预加载。
 * 没有对应图时，各场景自动回退到原来的程序化占位画。
 */

import manifest from '../data/artManifest.json';

const items = Array.isArray(manifest.items) ? manifest.items : [];
const byKey = new Map(items.map((item) => [String(item.key), item]));

/** 取某条插画的 manifest 记录（没有则 null） */
export function getArtEntry(key) {
  if (!key) return null;
  return byKey.get(String(key)) || null;
}

/** manifest 里是否有这张图 */
export function hasArtEntry(key) {
  return byKey.has(String(key));
}

/** 图片相对路径（public 根目录下），没有图时返回空串 */
export function getArtUrl(key) {
  const entry = getArtEntry(key);
  return entry ? entry.file : '';
}

/** 全部插画记录（PreloadScene 用来批量加载） */
export function listArtItems() {
  return items;
}

export function getArtCount() {
  return items.length;
}
