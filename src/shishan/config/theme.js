/**
 * 全局视觉主题：淡彩国风绘本 / 圆角 / 楷体
 * - C：给 Phaser Graphics 用的数值色
 * - S：给 Text 用的 CSS 字符串色
 */

/**
 * 诗山用的字体。
 *
 * 【为什么不再用系统楷体】原来写的是 "Kaiti SC","STKaiti","KaiTi","楷体"，
 *   指望系统里有楷体。但小黑盒客户端内嵌 WebView 的字体随平台而定：
 *   安卓上通常根本没有楷体，会一路 fallback 到 serif，
 *   也就是变成黑体——整个诗山的国风感就没了，
 *   而且和外面小程序界面的字体完全割裂（界面是 Roboto / 思源黑体，
 *
 * 【为什么现在能放心用】TWKai 已经随包打进来（styles.css 里 @font-face 注册），
 *   29083 个字形，覆盖全部古诗用字，不依赖系统。
 *   注意：诗山是刻意保留国风的，它的楷体/瘦金体不跟随 --font-body，
 *   这是设计选择而不是遗漏——游戏内的其它 5 个画布已经统一成无衬线。
 *   但 canvas 里的文字不会自动等字体就绪——见 shishan-entry.js 里的
 *   document.fonts.load()，那里必须先把字体拉进内存再启动 Phaser，
 *   否则第一屏会用 fallback 字体画完就再也不变了。
 *
 * 【为什么把 TWKai 放最前、系统楷体留在后面】万一字体加载失败
 *   （比如存储被清），后面的系统楷体仍然能顶一阵，不会直接掉到黑体。
 */
export const FONT_FAMILY =
  '"TWKai","Kaiti SC","STKaiti","KaiTi","楷体","Songti SC","Noto Serif CJK SC",serif';

/**
 * 标题字体：瘦金体。
 *
 * 【为什么标题和正文要分开】瘦金体笔画细瘦、起收笔锋芒外露，
 *   写「诗山寻踪」这类大字极有国风气质；但它的笔画太细，
 *   小字号（副标题、说明文字）会糊成一片、几乎不可读。
 *   所以只在标题级字号上用，正文继续用楷体。
 *
 * 【为什么带 fallback】瘦金体是 21399 字的子集，万一某个生僻字
 *   不在里面，会掉到楷体，不会变成方框或空白。
 */
export const FONT_TITLE =
  '"WXSJT","TWKai","Kaiti SC","STKaiti","KaiTi","楷体",serif';

/**
 * UI 尺寸 / 描边 / 遮罩统一口径。
 * 所有新面板、按钮、弹窗都从这里取值，避免各场景各写一套圆角与描边。
 */
export const UI = {
  radius: { sm: 12, md: 18, lg: 24, xl: 30, pill: 999 },
  stroke: { hair: 1, thin: 1.4, base: 2, bold: 2.6 },
  overlay: { color: 0x2e3a34, alpha: 0.44 },
  shadow: { color: 0x4b4130, alpha: 0.12, offsetX: 3, offsetY: 8 },
  panel: {
    fill: 0xfdf9f0,
    fillAlpha: 0.98,
    stroke: 0xd7c9b0,
    strokeAlpha: 0.5,
    innerStroke: 0xc9a45c,
    innerStrokeAlpha: 0.28,
    inset: 9,
  },
  depth: {
    background: -1000,
    sceneContent: 100,
    hud: 1000,
    modal: 9200,
    toast: 9600,
  },
};

export const C = {
  paper: 0xf8f2e4,
  paperSoft: 0xfdf9f0,
  paperDeep: 0xefe4d0,
  paperShade: 0xe6d8bf,
  ink: 0x3f3b33,
  inkSoft: 0x746b5b,
  inkFaint: 0xb9ac95,
  inkLine: 0xd7c9b0,
  pine: 0x7d9d8b,
  pineDeep: 0x537567,
  pineLight: 0xdde9df,
  moss: 0xa8bda1,
  peach: 0xe8aaa0,
  peachDeep: 0xc97b6e,
  blossom: 0xf3c6bd,
  gold: 0xc9a45c,
  goldLight: 0xf1e3bd,
  water: 0xbfdad5,
  waterDeep: 0x93bfb8,
  mist: 0xdde8e4,
  sky: 0xf2f6ec,
  dusk: 0xe9ddc9,
  white: 0xfffdf8,
  danger: 0xb9655b,
  shadow: 0x000000,
};

export const S = {
  ink: '#3f3b33',
  inkSoft: '#746b5b',
  inkFaint: '#a99b84',
  paper: '#fdf9f0',
  pine: '#537567',
  pineDeep: '#3f6154',
  peach: '#c97b6e',
  gold: '#b58c43',
  goldSoft: '#c9a45c',
  white: '#fffdf8',
  danger: '#b9655b',
  mute: '#b7aa93',
};

export const FONT_SIZE = {
  xs: 15,
  sm: 17,
  md: 21,
  lg: 26,
  xl: 32,
  xxl: 40,
  title: 58,
  giant: 76,
};

/**
 * 标题级字号的下限。
 * 【为什么是 40】瘦金体笔画极细，实测 32px 以下的小字会糊成一团，
 *   40px 以上才立得住。这个阈值和 FONT_SIZE.xxl 对齐，
 *   于是「xxl / title / giant」自动成为标题，其余保持楷体。
 */
const TITLE_SIZE_MIN = 40;

/** 给文字统一加一点国风留白与行距 */
export const textStyle = (size = FONT_SIZE.md, color = S.ink) => ({
  // 按字号自动选字体：大标题用瘦金体，正文用楷体。
  // 这样不用去改几十处调用点，也不会漏改。
  fontFamily: size >= TITLE_SIZE_MIN ? FONT_TITLE : FONT_FAMILY,
  fontSize: `${size}px`,
  color,
  align: 'center',
  lineSpacing: Math.round(size * 0.38),
});

/** 文字阴影：让楷体在淡彩背景上更清晰，但不显得生硬 */
export function addSoftTextShadow(text) {
  text.setShadow(0, 1, 'rgba(84, 72, 52, 0.12)', 2, false, true);
  return text;
}
