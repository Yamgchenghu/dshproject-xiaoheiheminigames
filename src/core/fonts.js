/**
 * 画布字体常量。
 *
 * 【为什么要有这个文件】canvas 的 ctx.font 只认字面量字体名，
 *   不认 CSS 变量，也不会继承 body 的 font-family。
 *   所以每个游戏都得自己写一遍字体名——结果是 5 个游戏写了 5 种不同写法：
 *   'sans-serif'、'-apple-system, sans-serif'、'-apple-system, "PingFang SC"...'。
 *   这些都退回「设备默认无衬线」，在安卓上常落到老旧的黑体甚至衬线体上，
 *   和界面里的 Roboto / 思源黑体明显不是一套字，看着像样式漏了。
 *
 * 【怎么保证和界面一致】这里的字面量必须与 styles.css 的 --font-body 对齐。
 *   两边没法共用一份定义（CSS 变量进不了 canvas），所以用
 *   tools/test-fonts.mjs 断言它们内容一致——改了一边忘了另一边，测试会失败。
 */

/**
 * 正文/UI 字体，对应 CSS 的 --font-body。
 *
 * 【顺序必须和 CSS 的 --font-body 一致】用户要求内置字体优先，
 *   所以 CSS 和 canvas 都把 TWKai 排在 Roboto 前面，汉字、数字、英文
 *   全部用内置字体渲染，不再让数字回落到系统 Roboto。
 *   canvas 无法用 unicode-range 做按码位回退，只能整串生效，
 *   正好与「字体优先」的要求一致。
 */
export const CANVAS_FONT_BODY =
  "'TWKai', 'Roboto', 'Noto Sans CJK SC', 'PingFang SC', 'Microsoft YaHei', sans-serif";

/** 等宽字体，对应 CSS 的 --font-mono */
export const CANVAS_FONT_MONO =
  "'Roboto Mono', 'SF Mono', 'Cascadia Code', Consolas, monospace";

/**
 * 拼一个 canvas 字体串。
 * @param {number|string} weight 字重，可省略（省略时不写，交给浏览器默认 400）
 * @param {number} px 像素大小
 * @param {'body'|'mono'} kind 字体族
 */
export function canvasFont(px, weight, kind) {
  const family = kind === 'mono' ? CANVAS_FONT_MONO : CANVAS_FONT_BODY;
  const w = weight ? String(weight) + ' ' : '';
  return w + px + 'px ' + family;
}
