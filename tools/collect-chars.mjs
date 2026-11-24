/**
 * 扫描源码，收集小程序真正会显示出来的字符。
 *
 * 【为什么要做这件事】中文字体动辄几 MB、两万个字形，直接打进小程序包
 *   会把包体撑爆。而这个小程序的全部界面文案都是我们自己写的，
 *   用到的汉字撑死两千个——裁掉剩下的，字体能小一个数量级。
 *
 * 【为什么只收 CJK 和 ASCII】源码里有一堆 \u 转义、数学字母（𝐢𝐦𝐨𝐫𝐭）、
 *   emoji，它们要么是转义残留，要么根本不需要字体提供字形（emoji 走系统
 *   emoji 字体）。收进来只会让字体白白变大。
 *
 * 输出：tools/chars.txt（一行，去重排序）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** 递归收集 .js/.css/.html 的文本 */
function collect(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) collect(p, out);
    else if (/\.(js|mjs|css|html|json)$/.test(ent.name)) out.push(fs.readFileSync(p, 'utf8'));
  }
}

const texts = [];
collect(path.join(ROOT, 'src'), texts);
collect(path.join(ROOT, 'tools'), texts);
texts.push(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
for (const f of ['package.json']) {
  try { texts.push(fs.readFileSync(path.join(ROOT, f), 'utf8')); } catch { /* 可选 */ }
}

const set = new Set();

/*
 * 字符集要覆盖哪些范围。
 *
 * 【为什么要按 Unicode 区块整段收，而不是只收源码里出现的字】
 *   字体是给**用户输入**用的：转盘选项、模组注释、玩家昵称都可能是
 *   用户自己敲的。只收界面文案的话，用户一输入就掉字回落到系统字体，
 *   同一行里出现两种字形，比干脆不用自定义字体还难看。
 *
 * 【为什么这些区块】逐个说：
 *   U+0020–U+007E  ASCII 可打印：拉丁字母、阿拉伯数字、半角标点
 *   U+00A0–U+00FF  拉丁补充：°、×、÷、§、©、® 这些西文常用符号
 *   U+0100–U+017F  拉丁扩展 A：ā é ñ ü 之类带变音的字母（拼音、人名）
 *   U+2000–U+206F  通用标点：— – … “ ” ‘ ’ • ‰ ′ ″ 这些
 *   U+20A0–U+20CF  货币符号：¥ € £ ₩
 *   U+2100–U+214F  字母式符号：№ ™ Ω
 *   U+2190–U+21FF  箭头：→ ← ↑ ↓ ↔
 *   U+2200–U+22FF  数学运算符：± × ÷ ≤ ≥ ≠ ∞ ∑ √
 *   U+2460–U+24FF  带圈数字：① ② ⑩ （转盘编号常用）
 *   U+25A0–U+25FF  几何图形：■ □ ▲ ▶ ● ○
 *   U+2600–U+26FF  杂项符号：★ ☆ ♪ ⚙ ⚠
 *   U+3000–U+303F  CJK 标点：、。「」【】《》〈〉— …
 *   U+3400–U+4DBF  CJK 扩展 A
 *   U+4E00–U+9FFF  CJK 基本区（简繁都在这里）
 *   U+FF00–U+FFEF  全角字符：，。！？：；（）ＡＢＣ１２３
 *
 * 【为什么不收 emoji】emoji 走系统 emoji 字体，自定义字体里没有彩色字形，
 *   收进来只会得到黑白轮廓或豆腐块，反而更丑。
 */
const RANGES = [
  [0x0020, 0x007e], // ASCII 可打印
  [0x00a0, 0x00ff], // 拉丁补充
  [0x0100, 0x017f], // 拉丁扩展 A
  [0x2000, 0x206f], // 通用标点
  [0x20a0, 0x20cf], // 货币符号
  [0x2100, 0x214f], // 字母式符号
  [0x2190, 0x21ff], // 箭头
  [0x2200, 0x22ff], // 数学运算符
  [0x2460, 0x24ff], // 带圈数字
  [0x25a0, 0x25ff], // 几何图形
  [0x2600, 0x26ff], // 杂项符号
  [0x3000, 0x303f], // CJK 标点
  [0x3400, 0x4dbf], // CJK 扩展 A
  [0x4e00, 0x9fff], // CJK 基本区
  [0xff00, 0xffef], // 全角字符
];

function inRanges(cp) {
  for (const [a, b] of RANGES) if (cp >= a && cp <= b) return true;
  return false;
}

// 1) 源码里实际出现的字符（先收，保证界面文案 100% 有字形）
for (const t of texts) {
  for (const ch of t) {
    if (inRanges(ch.codePointAt(0))) set.add(ch);
  }
}

// 2) 运行时动态拼出来的字符：数字、单位、进度条、按钮符号
const EXTRA = '0123456789:.,+-%×÷±°′″‰→←↑↓↔▶◀▲▼●○◎◇◆★☆■□△▽♪♫✓✔✕✖⚠⚙⏸⏵⏮⏭　、。「」【】…—·《》〈〉';
for (const ch of EXTRA) set.add(ch);

// 3) 上面那些区块**整段**补齐：用户输入的文字也要有字形，不能只覆盖界面文案。
//    这一步会显著增大字体（见 docs/fonts.md 的实测表），是刻意的取舍。
if (!process.argv.includes('--min')) {
  for (const [a, b] of RANGES) {
    // ASCII 已经在源码里全收了，跳过避免重复遍历
    if (a === 0x0020) continue;
    for (let cp = a; cp <= b; cp++) {
      // 跳过代理区（emoji 等增补平面字符不在这些区块内，这里只是防御）
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      set.add(String.fromCodePoint(cp));
    }
  }
}

/*
 * 兜底字库：GBK 全量汉字（20902 个）。
 *
 * 【为什么是 GBK 而不是 GB2312】GB2312 只有 6763 个**简体**字，
 *   繁体字（裡、著、臺灣、體驗）根本不在里面。用户明确要求支持繁体中文，
 *   所以必须用 GBK——它是 GB2312 的超集，含 20902 个汉字，简繁都有，
 *   也是 Windows 中文环境的默认编码。
 *
 * 【为什么不做「常用字」筛选】听起来能省体积，实际不可行：
 *   繁体常用字没有统一标准（台湾常用国字 4808、香港常用字 4941、
 *   大陆《通用规范汉字表》繁体部分 3000+，三套清单互不相同）。
 *   挑一套就等于赌用户说的是哪套，漏掉的字会直接掉字。
 *   GBK 全量本身就是「中文世界实际会用到哪些字」的经验边界，
 *   两款字体对它都是 100% 覆盖（已实测，见 docs/fonts.md），
 *   没有掉字风险，代价只是包体。
 *
 * 【包体够不够】上限 100 MiB，BGM 占 7.6 MB，字体全量约 15 MB，
 *   合计不到 25 MiB，占四分之一。够用。
 *
 * 想要更小的包体：node tools/collect-chars.mjs --min（只收界面文案用字）。
 */
const MIN = process.argv.includes('--min');
const FULL = !MIN;

const GBK_HANZI = !FULL ? [] : (() => {
  const out = [];
  const dec = new TextDecoder('gbk');
  // GBK 双字节区：首字节 0x81–0xFE，尾字节 0x40–0xFE（跳过 0x7F）
  for (let hi = 0x81; hi <= 0xfe; hi++) {
    for (let lo = 0x40; lo <= 0xfe; lo++) {
      if (lo === 0x7f) continue;
      let ch;
      try { ch = dec.decode(new Uint8Array([hi, lo])); } catch { continue; }
      if (ch.length !== 1 || ch === '\ufffd') continue;
      const cp = ch.codePointAt(0);
      // 只要汉字（含扩展 A），标点和符号由上面的规则收
      if (cp >= 0x3400 && cp <= 0x9fff) out.push(ch);
    }
  }
  return out;
})();
for (const ch of GBK_HANZI) set.add(ch);

const chars = [...set].sort();
const cjk = chars.filter((c) => c.codePointAt(0) > 0x2000);
fs.writeFileSync(path.join(ROOT, 'tools', 'chars.txt'), chars.join(''), 'utf8');

console.log('总字符数', chars.length, '| 其中非 ASCII', cjk.length);
console.log(FULL
  ? 'GBK 全量汉字补充 ' + GBK_HANZI.length + '（简繁全覆盖）'
  : '只覆盖界面文案（--min 模式）');
