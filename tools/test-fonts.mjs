// 字体一致性测试。
//
// 【为什么值得单测】canvas 的 ctx.font 不认 CSS 变量，字体名只能抄一遍。
//   抄完就没人管了——这次发现 5 个游戏用了 5 种写法（sans-serif、
//   -apple-system...），画布上的字和界面明显不是一套。
//   这里断言两边内容一致，以后改 --font-body 忘了改 canvas 就会红。
import { readFileSync } from 'node:fs';
import { CANVAS_FONT_BODY, CANVAS_FONT_MONO, canvasFont } from '../src/core/fonts.js';

let pass = 0;
let fail = 0;
/**
 * 断言：ok(说明, 条件)。
 *
 * 【为什么参数顺序必须是"说明在前"】2026-11-18 发现这四个测试文件的
 *   签名是 ok(cond, msg)，但所有调用都按 ok('说明', 条件) 写。
 *   字符串永远是真值，于是断言全部静默通过——等于没有测试。
 *   四个游戏漏 import canvasFont 就是这么漏到线上的。
 *   改成"说明在前"，是因为绝大多数调用本来就那么写，改签名比改 50 处调用安全。
 */
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/** 从 CSS 里抽出某个变量的值，去掉引号和多余空格 */
function cssVar(name) {
  const m = new RegExp(name.replace(/-/g, '\\-') + ':\\s*([^;]+);').exec(css);
  if (!m) return null;
  return m[1].trim();
}

/** 归一化字体串：统一引号、压空格，便于比较 */
function norm(s) {
  return String(s).replace(/["']/g, '').replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ').trim();
}

section('canvas 字体与 CSS 变量一致');
const bodyVar = cssVar('--font-body');
const monoVar = cssVar('--font-mono');
ok('CSS 里有 --font-body', !!bodyVar, String(bodyVar));
ok('canvas 正文体 = --font-body', norm(CANVAS_FONT_BODY) === norm(bodyVar),
  'canvas=' + norm(CANVAS_FONT_BODY) + ' css=' + norm(bodyVar));
ok('canvas 等宽体 = --font-mono', norm(CANVAS_FONT_MONO) === norm(monoVar),
  'canvas=' + norm(CANVAS_FONT_MONO) + ' css=' + norm(monoVar));

section('内置字体优先于系统字体');
// 【为什么锁这个】用户要求「字体优先」——随包分发的字体要盖过设备字体，
//   包括数字和英文。一旦有人把 Roboto 挪到前面，或给 @font-face 加
//   unicode-range 把拉丁字母让出去，页面就会悄悄变回系统字体。
ok('--font-body 以 TWKai 开头', /^TWKai/.test(norm(bodyVar)), String(bodyVar));
ok('--font-title 以 WXSJT 开头', /^WXSJT/.test(norm(cssVar('--font-title'))), String(cssVar('--font-title')));
ok('canvas 正文体也以 TWKai 开头', /^TWKai/.test(norm(CANVAS_FONT_BODY)), String(CANVAS_FONT_BODY));
// Roboto 允许留在栈里做兜底，但必须排在内置字体之后
ok('Roboto 在内置字体之后', bodyVar.indexOf('Roboto') > bodyVar.indexOf('TWKai'), String(bodyVar));
// 【为什么要排除注释】styles.css 里有一段注释解释"为什么不写 unicode-range"，
//   直接 match(/unicode-range/) 会把注释里的说明也算成一处，永远报红。
//   先把注释剥掉，再数真正的 CSS 声明。
const cssNoComment = css.replace(/\/\*[\s\S]*?\*\//g, '');
const ranges = cssNoComment.match(/unicode-range\s*:/g) || [];
ok('@font-face 不限制 unicode-range', ranges.length === 0, '发现 ' + ranges.length + ' 处');

section('canvasFont 拼接');
ok('带字重', canvasFont(16, 700).startsWith('700 16px '));
ok('不带字重', canvasFont(16).startsWith('16px '));
ok('等宽', canvasFont(12, 400, 'mono').includes('Roboto Mono'));
ok('默认是正文体', canvasFont(16).includes('Roboto'));

section('游戏源码里不再有裸 sans-serif');
// 这些写法会退回设备默认字体，和界面脱节。
const files = ['fruitninja', 'g2048', 'minesweeper', 'snake-battle'];
for (const f of files) {
  const src = readFileSync(new URL('../src/games/' + f + '.js', import.meta.url), 'utf8');
  const bad = src.match(/ctx\.font\s*=\s*[^;]*(sans-serif|-apple-system)/g) || [];
  ok(f + ' 没有裸字体名', bad.length === 0, bad.join(' / '));
  ok(f + ' 用了 canvasFont', src.includes('canvasFont'));
  // 【为什么还要查 import】2026-11-18 的线上事故：四个游戏都改成了
  //   canvasFont(...)，但忘了 import，draw() 每帧抛 ReferenceError，
  //   画面直接冻住、玩家看到的是"运行几秒就不动了"。
  //   只查"用没用"是查不出这个的，必须确认它真被导进来了。
  const imported = /import\s*\{[^}]*canvasFont[^}]*\}\s*from\s*['"][^'"]*core\/fonts\.js['"]/.test(src);
  ok(imported, f + ' 确实 import 了 canvasFont');
}

section('流水入杯用共享常量');
const ls = readFileSync(new URL('../src/tools/liushui/screen.js', import.meta.url), 'utf8');
ok('引了 CANVAS_FONT_BODY', ls.includes('CANVAS_FONT_BODY'));
ok('不再写死楷体', !ls.includes("'TWKai', 'PingFang SC'"));

console.log('\n' + (fail === 0 ? '全部通过：' : '存在失败：') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
