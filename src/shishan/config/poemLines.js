/**
 * poemLines.js：诗句分块的统一兜底入口
 * ------------------------------------------------------------
 * 为什么需要它：
 *  - 词牌（如梦令、水调歌头）与引语式古文（铁杵成针）里有很多顿号、冒号，
 *    自动按标点切句会切得又碎又乱，排序玩法容易出现「争渡」「曰」这种碎片块；
 *  - 所以 poem_db.json 支持可选字段 split_lines：作者手工把整首切成 3~6 块，
 *    玩法优先用它，没有该字段时再走 SortPoemScene 原来的自动断句。
 *
 * 约定：
 *  - split_lines 必须是两句以上的非空字符串数组；
 *  - 去掉标点后，各块拼接的汉字序列必须与 full_text 完全一致（顺序与字数都不许变），
 *    避免手工分块时漏字、多字或打乱原诗；
 *  - 校验不通过就返回 null，自动退回原来的自动断句，游戏不会因为数据写错而做不下去。
 */

import { getSplitLinesIssue } from '../data/poemLineRules.js';

/**
 * 取一首诗的手工分块；没有或不合法时返回 null。
 * @param {object|null|undefined} poem
 * @returns {string[]|null}
 */
export function getPoemSplitLines(poem) {
  if (!poem || typeof poem !== 'object') return null;
  const lines = poem.split_lines;
  if (!Array.isArray(lines)) return null;
  if (getSplitLinesIssue(poem)) return null;

  return lines.map((line) => String(line).trim());
}

export default getPoemSplitLines;
