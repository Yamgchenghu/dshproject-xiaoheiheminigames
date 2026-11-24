/**
 * 看图猜诗 · 画面小注
 * ------------------------------------------------------------
 * 关卡画卷下面展示的应当是「这首诗想表达什么」，而不是画图的画面要求
 * （`ai_prompt` 属于插画出图规范，放进关卡会直接把诗题演出来）。
 *
 * 数据来源：poem_db.json 的 `scene_note`（一句话，≤ 48 字，不含诗题）。
 * 老数据没有这个字段时，退回译文的第一句，并用 `stripPoemTitle()` 去掉诗题，
 * 保证任何情况下都不会在描述里直接露出答案。
 */

/** 去掉首尾的空格与零散标点（句末的 。！？ 保留给正文用） */
function trimEdges(text) {
  return String(text || '')
    .replace(/^[\s，、；：！？,.;:!?《》〈〉“”"'「」]+/, '')
    .replace(/[\s，、；：,;:]+$/, '')
    .trim();
}

/**
 * 从一段文字里删掉诗题（含书名号写法与去掉副标题的简称）。
 * 单个字的诗题（如《画》）命中率太高，不参与删除，避免把正文改坏。
 * @param {string} text 原文
 * @param {string} title 诗题
 * @returns {string} 去掉诗题后的文字
 */
export function stripPoemTitle(text, title) {
  let value = String(text || '');
  const rawTitle = String(title || '').trim();
  if (!rawTitle) return trimEdges(value);

  const variants = [
    rawTitle,
    rawTitle.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').replace(/[·・]/g, '').trim(),
  ].filter((item) => item && item.length >= 2);

  variants.sort((a, b) => b.length - a.length);
  variants.forEach((variant) => {
    value = value.split(`《${variant}》`).join('');
    value = value.split(variant).join('');
  });
  return trimEdges(value);
}

/**
 * 取一首诗的「画面小注」：一句话概述诗想表达的内容，且不包含诗题。
 * @param {object} poem poem_db 里的一条诗
 * @returns {string} 可直接展示的一句话
 */
export function sceneNoteOf(poem) {
  if (!poem) return '';
  const authored = String(poem.scene_note || '').trim();
  if (authored) return stripPoemTitle(authored, poem.title);

  // 兜底：译文第一句，去掉诗题后再补个句号
  const firstSentence = String(poem.translation || '').split('。')[0];
  const note = stripPoemTitle(firstSentence, poem.title);
  return note ? `${note}。` : '';
}
