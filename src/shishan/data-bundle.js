/**
 * 诗山寻踪的数据包（打包进 JS，不走网络请求）。
 *
 * 【为什么要把 JSON 变成 JS 模块】小程序的 CSP 里 connect-src 只放行了
 *   SDK 自己的日志端点，Phaser 的 loader 用 fetch/XHR 读 public/data/*.json
 *   会被直接拒绝（实测报 "violates the following Content Security Policy"）。
 *   这三个文件一共 119 KB，作为 ES 模块 import 进来由构建器打进 bundle，
 *   既绕开了网络限制，也少三次请求。
 *
 * 【为什么源文件放在 src/shishan/data-json/ 而不是 public/】
 *   public/ 下的文件是原样拷贝、运行时按 URL 取，仍然要走网络；
 *   src/ 下的 JSON 由构建器在打包期解析成 JS 对象，运行时零请求。
 *   代价是数据进了 JS bundle（约 +119 KB），换来的是绝不会被 CSP 拦。
 */
import poemDb from './data-json/poem_db.json';
import anecdoteDb from './data-json/anecdote_db.json';
import collectionDb from './data-json/collection_db.json';

export const POEM_DB = poemDb;
export const ANECDOTE_DB = anecdoteDb;
export const COLLECTION_DB = collectionDb;
