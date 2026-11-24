/**
 * poemLineRules.js：split_lines 字段的数据规则（纯函数，数据校验与玩法共用）
 * ------------------------------------------------------------
 * 规则：
 *  1. split_lines 是可选字段；没写就代表「按标点自动断句即可」；
 *  2. 写了就必须是 2 行以上的非空字符串数组；
 *  3. 去掉标点后，各块拼起来的汉字序列必须与 full_text 完全一致，
 *     既不能漏字、多字，也不能打乱顺序——这样排序玩法才不会判定错位。
 */

const HAN_ONLY = /[^\u3400-\u9fff]/g;

/** 手工分块的最少行数 */
export const MIN_SPLIT_LINES = 2;

/**
 * 检查一首诗的 split_lines，返回问题描述；没问题（或没写该字段）返回 null。
 * @param {object} poem
 * @returns {string|null}
 */
export function getSplitLinesIssue(poem) {
  if (!poem || typeof poem !== 'object' || !('split_lines' in poem)) return null;

  const lines = poem.split_lines;
  if (!Array.isArray(lines)) return 'split_lines 不是数组';
  if (lines.length < MIN_SPLIT_LINES) return `split_lines 少于 ${MIN_SPLIT_LINES} 行`;
  if (lines.some((line) => !String(line ?? '').trim())) return 'split_lines 含空行';

  const joined = lines.join('').replace(HAN_ONLY, '');
  const source = String(poem.full_text || '').replace(HAN_ONLY, '');
  if (joined !== source) return 'split_lines 与 full_text 文字不一致';

  return null;
}

export default getSplitLinesIssue;
