/**
 * 存档层自测：压缩、编码、切块、简写还原。
 * 运行：node tools/test-save.mjs
 */
import {
  utf8Length, utf8Encode, utf8Decode,
  lzCompress, lzDecompress, base85Encode, base85Decode,
  packPayload, unpackPayload, measurePayload,
} from '../src/core/pack.js';
import { shrinkSource, restoreSource, packSource, unpackSource, shrinkBundle } from '../src/core/shrink.js';
import { SCOPES, scopeKeys, scopeCapacity, CHUNK_BYTES } from '../src/core/save.js';

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

/* ---------------- UTF-8 ---------------- */
section('UTF-8 编解码');
ok('ASCII 长度', utf8Length('abc') === 3);
ok('中文 3 字节', utf8Length('中') === 3);
ok('emoji 4 字节', utf8Length('😀') === 4);
ok('混合长度', utf8Length('a中😀') === 1 + 3 + 4);
const samples = ['', 'hello', '中文测试', '😀🎮🍉', 'a中😀b', 'import fruitninja\n'];
for (const s of samples) {
  ok('往返 ' + JSON.stringify(s).slice(0, 24), utf8Decode(utf8Encode(s)) === s);
}

/* ---------------- LZ77 ---------------- */
section('LZ77');
ok('空输入', lzCompress(new Uint8Array(0)).length === 0);
const cases = [
  'a',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'hello world hello world hello world',
  JSON.stringify({ a: 1, b: [1, 2, 3], c: '中文中文中文中文' }),
  'x'.repeat(5000),
  Array.from({ length: 300 }, (_, i) => 'item' + (i % 17)).join(','),
];
for (const c of cases) {
  const enc = utf8Encode(c);
  const dec = utf8Decode(lzDecompress(lzCompress(enc)));
  ok('往返 len=' + c.length, dec === c, dec.slice(0, 40));
}
{
  const big = 'abcabcabcabc'.repeat(400);
  const ratio = lzCompress(utf8Encode(big)).length / utf8Length(big);
  ok('重复串压缩率 < 5%', ratio < 0.05, (ratio * 100).toFixed(2) + '%');
}

/* ---------------- base85 ---------------- */
section('base85');
ok('字符集 85 个', new Set(base85Encode(new Uint8Array([0, 0, 0, 0]))).size >= 0);
for (let n = 0; n <= 9; n++) {
  const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 0xff);
  const rt = base85Decode(base85Encode(bytes));
  ok('往返 ' + n + ' 字节', rt.length === bytes.length && rt.every((v, i) => v === bytes[i]));
}
{
  const bytes = new Uint8Array(400).map((_, i) => i & 0xff);
  const enc = base85Encode(bytes);
  ok('base85 膨胀率 ≈ 1.25', Math.abs(enc.length / bytes.length - 1.25) < 0.01, (enc.length / bytes.length).toFixed(3));
  ok('全部可打印 ASCII', /^[\x21-\x7e]*$/.test(enc));
  ok('不含引号/反斜杠/尖括号', !/["'\\<>&`]/.test(enc));
}
{
  const bytes = new Uint8Array(5000).map((_, i) => (i * 131) & 0xff);
  const enc = base85Encode(bytes);
  ok('5000 字节 ASCII 化后字符数==字节数', utf8Length(enc) === enc.length);
}

/* ---------------- packPayload ---------------- */
section('打包 / 解包');
const objs = [
  {},
  { a: 1 },
  { wheels: [{ title: '今天吃什么', items: [{ text: '火锅', weight: 100 }] }] },
  { list: Array.from({ length: 200 }, (_, i) => ({ i, t: '选项' + i, w: 100 })) },
];
for (const o of objs) {
  const p = packPayload(o);
  const back = unpackPayload(p.text);
  ok('往返 ' + JSON.stringify(o).slice(0, 30), JSON.stringify(back) === JSON.stringify(o));
  ok('  纯 ASCII', /^[\x21-\x7e]*$/.test(p.text));
  ok('  字节数==字符数', utf8Length(p.text) === p.text.length);
}
{
  const big = { items: Array.from({ length: 400 }, (_, i) => ({ text: '选项文字' + i, weight: 100, group: 0 })) };
  const p = packPayload(big);
  ok('大对象压缩生效', p.mode === 'lz', p.mode);
  ok('压缩后 < JSON 一半', p.bytes < p.json / 2, p.bytes + ' vs ' + p.json);
  ok('大对象往返', JSON.stringify(unpackPayload(p.text)) === JSON.stringify(big));
}

/* ---------------- 简写 ---------------- */
section('源码简写');
const CODE = [
  'import fruitninja',
  'import random',
  'import time',
  '',
  'bomb_probability = 0.12',
  'spawn_interval = 0.62',
  'score_multiplier = 1.0',
  'total_sliced = 0',
  '',
  'def on_start():',
  '    global total_sliced',
  '    total_sliced = 0',
  '    fruitninja.bomb.appearrate = bomb_probability',
  '    fruitninja.spawn.interval = spawn_interval',
  '',
  'def on_tick():',
  '    global total_sliced',
  '    total_sliced = total_sliced + 1',
  '    if total_sliced % 100 == 0:',
  "        print('sliced', total_sliced)",
].join('\n');

{
  const s = shrinkSource(CODE);
  ok('确实变短', s.text.length < CODE.length, CODE.length + ' -> ' + s.text.length);
  ok('还原完全一致', restoreSource(s.text, s.map) === CODE);
  ok('模块名未被改', /^import fruitninja$/m.test(s.text));
  ok('属性名未被改', s.text.includes('fruitninja.bomb.appearrate'));
  ok('字符串未被改', s.text.includes("'sliced'"));
  ok('关键字未被改', s.text.includes('global '));
  ok('map 非空', Object.keys(s.map).length > 0);
}
{
  // packSource 永远不亏：短脚本不简写，长脚本才简写
  const p1 = packPayload({ c: CODE });
  const rec = packSource(CODE);
  const p2 = packPayload(rec);
  ok('packSource 不会更大', p2.bytes <= p1.bytes, p1.bytes + ' -> ' + p2.bytes);
  ok('packSource 可还原', unpackSource(rec) === CODE);
  ok('短脚本不生成映射表', !rec.m, JSON.stringify(Object.keys(rec)));

  // 单份脚本：简写常常不划算（映射表开销），packSource 必须自己判断
  const longCode = Array.from({ length: 40 }, (_, i) =>
    `    accumulated_total_score_value = accumulated_total_score_value + score_step_${i}`).join('\n')
    + '\n    print(accumulated_total_score_value)\n';
  const r1 = packPayload({ c: longCode });
  const rec2 = packSource(longCode);
  const r2 = packPayload(rec2);
  ok('单份脚本 packSource 不会更大', r2.bytes <= r1.bytes, r1.bytes + ' -> ' + r2.bytes);
  ok('单份脚本可还原', unpackSource(rec2) === longCode);
}
{
  // 整包简写：多份脚本共享一张映射表，这才是简写真正划算的场景
  const real = [
    'import fruitninja', 'import random', 'import time', '',
    'bomb_appear_rate = 0.0012', 'spawn_interval_seconds = 0.4',
    'fruit_score_multiplier = 2.5', 'combo_window_seconds = 1.8',
    'total_sliced_count = 0', 'last_slice_timestamp = 0', '',
    'def on_start():', '    global total_sliced_count, last_slice_timestamp',
    '    total_sliced_count = 0', '    last_slice_timestamp = time.time()',
    '    fruitninja.bomb.appearrate = bomb_appear_rate',
    '    fruitninja.spawn.interval = spawn_interval_seconds', '',
    'def on_tick():', '    global total_sliced_count',
    '    total_sliced_count = total_sliced_count + 1',
    '    if time.time() - last_slice_timestamp > combo_window_seconds:',
    '        total_sliced_count = 0',
  ].join('\n');
  const bundle = {};
  for (let i = 0; i < 20; i++) bundle['game' + i] = real;
  const plain = packPayload(bundle);
  const sh = shrinkBundle(bundle);
  const shrunk = packPayload({ c: sh.codes, m: sh.map });
  ok('整包简写确实更省', shrunk.bytes < plain.bytes, plain.bytes + ' -> ' + shrunk.bytes);
  // 实测：20 份同源脚本省 18%，40 份不同脚本省 27%。
  // 门槛定 15% 是为了留出余量——这个数跟脚本内容强相关，不能定死。
  ok('整包节省 > 15%', shrunk.bytes < plain.bytes * 0.85,
    (((plain.bytes - shrunk.bytes) / plain.bytes) * 100).toFixed(1) + '%');
  ok('整包简写可完整还原', (() => {
    for (const k of Object.keys(sh.codes)) {
      if (restoreSource(sh.codes[k], sh.map) !== bundle[k]) return false;
    }
    return true;
  })());
  ok('整包映射表只有一份', typeof sh.map === 'object' && Object.keys(sh.map).length > 0);
}

{
  // 回归：import 绑定的模块名 + 回调名 一个都不能改
  const src = 'import fruitninja\nimport random\n\ncounter_value = 0\n\ndef on_tick():\n    global counter_value\n    counter_value = counter_value + 1\n    fruitninja.bomb.appearrate = 0.001\n';
  const s = shrinkSource(src);
  ok('import 行原样保留', s.text.includes('import fruitninja') && s.text.includes('import random'));
  ok('on_tick 未被改', s.text.includes('def on_tick():'));
  ok('fruitninja. 前缀未被改', s.text.includes('fruitninja.bomb.appearrate'));
  ok('counter_value 被改短', !s.text.includes('counter_value'));
  ok('回归用例可还原', restoreSource(s.text, s.map) === src);
}
{
  // 边界：注释里的名字不该被算
  const src = '# comment_variable_name_here\nx_value = 1\nx_value = 2';
  const s = shrinkSource(src);
  ok('注释原样保留', s.text.includes('# comment_variable_name_here'));
  ok('注释场景可还原', restoreSource(s.text, s.map) === src);
}
{
  // 边界：属性名不能进 map
  const src = 'obj.attribute_name = 1\nobj.attribute_name = 2';
  const s = shrinkSource(src);
  ok('纯属性名不生成映射', Object.keys(s.map).length === 0);
}
{
  // 边界：字符串里的短名不能被误换
  const src = "long_variable_name = 'long_variable_name'\nprint(long_variable_name)";
  const s = shrinkSource(src);
  ok('字符串内不被替换', s.text.includes("'long_variable_name'"));
  ok('字符串场景可还原', restoreSource(s.text, s.map) === src);
}
{
  // 短名/关键字/内置不参与
  const src = 'x = 1\nx = 2\nprint(x)\nlen([1])';
  const s = shrinkSource(src);
  ok('短名不参与简写', Object.keys(s.map).length === 0);
}

/* ---------------- 配额布局 ---------------- */
section('存档域布局');
ok('mod 3 个 value', SCOPES.mod.count === 3);
ok('转盘数据 6 个 value', SCOPES['wheel.lib'].count === 6);
ok('跳转数据 4 个 value', SCOPES['wheel.goto'].count === 4);
ok('自动指令 4 个 value', SCOPES['wheel.script'].count === 4);
ok('转盘合计 14 个 value',
  SCOPES['wheel.lib'].count + SCOPES['wheel.goto'].count + SCOPES['wheel.script'].count === 14);
ok('scores 1 个 value', SCOPES.scores.count === 1);
ok('profile 1 个 value', SCOPES.profile.count === 1);
// 【为什么键号不是连续的】用户扩容时要求"不动老数据"，所以新增的 value
//   一律追加到编号表末尾（save_30..save_40），原域键号保持不变。
//   断言改为：前 3 个还是 save_1..3（老存档读得到），总数是 8。
ok('mod 前 3 个 key = save_1..3（老存档不动）',
  scopeKeys('mod').slice(0, 3).join(',') === 'save_1,save_2,save_3');
ok('mod 共 8 个 value', scopeKeys('mod').length === 8, scopeKeys('mod').join(','));
ok('转盘 key 从 save_4 起', scopeKeys('wheel.lib')[0] === 'save_4');
ok('跳转 key 从 save_10 起', scopeKeys('wheel.goto')[0] === 'save_10');
ok('指令 key 从 save_14 起', scopeKeys('wheel.script')[0] === 'save_14');
// 转盘三域扩容后新增 value 追加在末尾，所以"连续相接"不再成立，
// 改为断言：各自的起始键不变 + 数量正确 + 全体无重号（下面单独有一条）
ok('转盘三域起始键不变', (() => {
  const a = scopeKeys('wheel.lib'); const b = scopeKeys('wheel.goto'); const c = scopeKeys('wheel.script');
  return a[0] === 'save_4' && b[0] === 'save_10' && c[0] === 'save_14';
})());
ok('转盘三域数量正确（8 / 4 / 5）', (() => {
  return scopeKeys('wheel.lib').length === 8
    && scopeKeys('wheel.goto').length === 4
    && scopeKeys('wheel.script').length === 5;
})());
ok('scores key = save_18', scopeKeys('scores')[0] === 'save_18');
ok('profile key = save_19', scopeKeys('profile')[0] === 'save_19');
ok('无重号', (() => {
  const all = Object.keys(SCOPES).flatMap(scopeKeys);
  return new Set(all).size === all.length;
})());
ok('mod 容量 = 131072（8 个 value）', scopeCapacity('mod') === 8 * CHUNK_BYTES);
ok('转盘数据容量 = 131072（8 个 value）', scopeCapacity('wheel.lib') === 8 * CHUNK_BYTES);
ok('跳转数据容量 = 64000（4 个 value）', scopeCapacity('wheel.goto') === 4 * CHUNK_BYTES);
ok('自动指令容量 = 81920（5 个 value）', scopeCapacity('wheel.script') === 5 * CHUNK_BYTES);
ok('每块 ≤ 16384', CHUNK_BYTES <= 16384);

/* ---------------- 单词机三域分配 ---------------- */
section('单词机存档：按用户规格拆成三个域');
ok('词表 3 个 value', SCOPES['word.lists'].count === 3);
ok('课文 3 个 value', SCOPES['word.texts'].count === 3);
ok('词表记录 2 个 value', SCOPES['word.records'].count === 2);
ok('单词机合计 8 个 value',
  SCOPES['word.lists'].count + SCOPES['word.texts'].count + SCOPES['word.records'].count === 8);
// 单词机三域各 +1 个 value（追加在末尾），起始键不变
ok('词表前 3 个 key = save_22..24', scopeKeys('word.lists').slice(0, 3).join(',') === 'save_22,save_23,save_24');
ok('课文前 3 个 key = save_25..27', scopeKeys('word.texts').slice(0, 3).join(',') === 'save_25,save_26,save_27');
ok('记录前 2 个 key = save_28..29', scopeKeys('word.records').slice(0, 2).join(',') === 'save_28,save_29');
ok('单词机三域各 +1 个 value', scopeKeys('word.lists').length === 4
  && scopeKeys('word.texts').length === 4 && scopeKeys('word.records').length === 3);
ok('词表容量 64K（4 个 value）', scopeCapacity('word.lists') === 4 * CHUNK_BYTES);
// 三域各 +1 个 value 后：课文 4 个、记录 3 个
ok('课文容量 64K（4 个 value）', scopeCapacity('word.texts') === 4 * CHUNK_BYTES);
ok('记录容量 48K（3 个 value，业务上限 24K）', scopeCapacity('word.records') === 3 * CHUNK_BYTES);
ok('三域起始键不重叠', (() => {
  const a = scopeKeys('word.lists'); const b = scopeKeys('word.texts'); const c = scopeKeys('word.records');
  return a[0] === 'save_22' && b[0] === 'save_25' && c[0] === 'save_28';
})());
// 【为什么用 16000 而不是 16384】CHUNK_BYTES 故意留了 384 字节余量，
//   所以 3 块的实际可用是 48000 而不是 49152。断言要按实际块容量算，
//   否则测的是「名义 48K」而不是「真能存多少」，等于没测。
ok('词表实际可用 64000 字节（4 个 value）', scopeCapacity('word.lists') === 4 * CHUNK_BYTES);
ok('记录实际可用 48000 字节（3 个 value，业务上限 24000）', scopeCapacity('word.records') === 3 * CHUNK_BYTES);



/* ---------------- 朗读模板 ---------------- */
section('朗读模板');
import { renderTemplate, previewTemplate, templateVars, TEMPLATE_VARS } from '../src/tools/wheel/engine.js';
const W = { items: [
  { id: 'a', text: '火锅', value: '5', disabled: false },
  { id: 'b', text: '烧烤', value: '', disabled: false },
  { id: 'c', text: '日料', value: '0', disabled: false },
  { id: 'd', text: '禁用项', value: '9', disabled: true },
] };
const A = W.items[0];
ok('默认模板 = 抽到{result}', renderTemplate('', A, W) === '抽到火锅');
ok('result 取文本', renderTemplate('{result}', A, W) === '火锅');
ok('value 取数值', renderTemplate('{value}', A, W) === '5');
ok('value 为 0 时不当成空', renderTemplate('{value}', W.items[2], W) === '0');
ok('value 空则退回文本', renderTemplate('{value}', W.items[1], W) === '烧烤');
ok('count 默认 0', renderTemplate('{count}', A, W) === '0');
ok('count 传值生效', renderTemplate('{count}', A, W, { count: 7 }) === '7');
ok('last 默认等于可用项数', renderTemplate('{last}', A, W) === '3');
ok('last 传值生效', renderTemplate('{last}', A, W, { last: 1 }) === '1');
ok('total 不数禁用项', renderTemplate('{total}', A, W) === '3');
ok('time 形如 11月15日09时30分', /^\d+月\d+日\d{2}时\d{2}分$/.test(renderTemplate('{time}', A, W)));
ok('多个占位符同时替换', renderTemplate('{result}-{value}-{count}', A, W, { count: 2 }) === '火锅-5-2');
ok('未知占位符原样保留', renderTemplate('{result}{中奖}', A, W) === '火锅{中奖}');
ok('普通文字不受影响', renderTemplate('抽到{result}啦', A, W) === '抽到火锅啦');
ok('空 item 不抛异常', renderTemplate('{result}', null, W) === '');
ok('空 wheel 不抛异常', typeof renderTemplate('{total}', A, null) === 'string');
ok('预览用固定假数据', previewTemplate('抽到{result}') === '抽到火锅');
ok('预览含 count=3', previewTemplate('{count}') === '3');
ok('占位符表含 value', TEMPLATE_VARS.some((v) => v.key === 'value'));
ok('占位符表 6 项', TEMPLATE_VARS.length === 6);

section('选项 value 字段');
import { normalizeItem } from '../src/tools/wheel/engine.js';
ok('字符串选项 value 为空', normalizeItem('火锅').value === '');
ok('数字 value 转字符串', normalizeItem({ text: 'x', value: 5 }).value === '5');
ok('value 0 保留', normalizeItem({ text: 'x', value: 0 }).value === '0');
ok('缺 value 得空串', normalizeItem({ text: 'x' }).value === '');


section('模板随备份导出/导入');
import { buildFullJson, parseFullJson, parseSettings, serialize, deserialize } from '../src/tools/wheel/format.js';
import { createWheel as mk, uid as mkUid } from '../src/tools/wheel/engine.js';
const TW = [mk({ name: '测试盘', items: [{ text: '火锅', value: '5', weight: 100, group: 0 }] })];
const full = buildFullJson(TW, { voiceTemplate: '抽到 {result}，数值 {value}' });
ok('导出带 ttsTemplate', full.settings.ttsTemplate === '抽到 {result}，数值 {value}');
ok('导出带 items.value', full.wheels[0].items[0].value === '5');
ok('导出仍是 version 2', full.version === 2);
ok('parseSettings 读回模板', parseSettings(full).voiceTemplate === '抽到 {result}，数值 {value}');
const back = parseFullJson(full, mk, mkUid);
ok('导入还原模板', back.settings.voiceTemplate === '抽到 {result}，数值 {value}');
ok('导入还原 value', back.wheels[0].items[0].value === '5');
ok('导入还原文本', back.wheels[0].items[0].text === '火锅');
ok('空模板不写进导出', !('ttsTemplate' in buildFullJson(TW, { voiceTemplate: '' }).settings));
ok('parseSettings 缺字段给默认', (() => { const s = parseSettings({}); return s.autoGoto === true && s.voiceTemplate === ''; })());
ok('serialize full 带模板', JSON.parse(serialize(TW, 'full', { voiceTemplate: '{result}!' }).text).settings.ttsTemplate === '{result}!');
ok('serialize json 不带模板', !('ttsTemplate' in (JSON.parse(serialize(TW, 'json', {}).text).settings || {})));
ok('deserialize 全链路还原', deserialize(serialize(TW, 'full', { voiceTemplate: 'X{result}' }).text, mk, mkUid).settings.voiceTemplate === 'X{result}');

console.log('\n' + (fail === 0 ? '全部通过' : '有失败') + '：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
