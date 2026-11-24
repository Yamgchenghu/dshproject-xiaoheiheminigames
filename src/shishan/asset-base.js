/**
 * 诗山寻踪的资源根路径。
 *
 * 【为什么需要这个常量】原版诗山是独立站点，资源就在站点根目录下
 *   （assets/images/...、data/...）。并入小程序后它们被放进 public/shishan/，
 *   所有相对路径都要多一层前缀。写死字符串容易漏改，所以集中一处。
 *
 * 【为什么用 import.meta.env.BASE_URL】小程序的 vite 配置里 base 是 './'，
 *   直接写 '/shishan/' 在子路径部署时会 404。BASE_URL 由构建器注入，
 *   开发和生产都对。
 */
const BASE = import.meta.env.BASE_URL || './';

/** 形如 "./shishan/" 或 "/shishan/" */
export const SHISHAN_BASE = BASE.endsWith('/') ? BASE + 'shishan/' : BASE + '/shishan/';

/** 给 manifest 里的相对路径（assets/images/xxx.webp）补前缀 */
export function shishanAsset(relPath) {
  return SHISHAN_BASE + String(relPath || '').replace(/^\.?\//, '');
}
