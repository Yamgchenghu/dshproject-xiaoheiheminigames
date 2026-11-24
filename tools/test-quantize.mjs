/**
 * 成绩量化测试。
 *
 * 【为什么这些断言必须存在】量化公式一旦写错，玩家的总分就会系统性偏差，
 *   而且这种偏差"看起来正常"——榜上有数、能排序，只是数是错的。
 *   用户给了 5 个具体示例，正好当验收标准。
 */
import {
  quantize, rawForQuant, liushuiBase, baseOf,
  totalQuantized, MODE_KEYS, BASES, Q_CAP,
  liushuiRawScore, liushuiMaxScore, LIUSHUI_TARGET_DROPS, LIUSHUI_TOTAL_DROPS,
} from '../src/core/quantize.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail += 1;
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}`);
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) {
    throw new Error(`${msg || '数值不接近'}：实际 ${a}，期望 ${b}（容差 ${tol}）`);
  }
}

console.log('=== 用户给的 5 个示例（基准 20）===');

const B = 20;

check('得 18 分 → 量化 90（低于基准走线性）', () => {
  near(quantize(18, B), 90, 0.01);
});

check('得 30 分 → 量化 105.85（超过基准走对数）', () => {
  near(quantize(30, B), 105.85, 0.01);
});

check('得 40 分 → 量化 110（翻倍正好 +10）', () => {
  near(quantize(40, B), 110, 0.01);
});

check('得 42 分 → 量化 110.70', () => {
  near(quantize(42, B), 110.70, 0.01);
});

check('想要 105 分 → 需要约 28.284 分（反解）', () => {
  near(rawForQuant(105, B), 28.284, 0.01);
});

console.log('\n=== 边界与防错 ===');

check('正好等于基准 → 100 分', () => {
  near(quantize(B, B), 100, 0.001);
});

check('没玩过（0 分）→ 0 分，不是 100 分', () => {
  ok(quantize(0, B) === 0, '记 100 会让没玩过的人白拿分');
});

check('null / undefined / NaN 都记 0 分', () => {
  ok(quantize(null, B) === 0);
  ok(quantize(undefined, B) === 0);
  ok(quantize(NaN, B) === 0);
  ok(quantize('abc', B) === 0);
});

check('负分记 0 分', () => {
  ok(quantize(-5, B) === 0);
});

check('基准为 0 时返回 0，不产生 Infinity', () => {
  ok(quantize(100, 0) === 0);
});

check('极端高分被封顶', () => {
  ok(quantize(1e12, 1) <= Q_CAP, '不能让异常分数拉爆总分');
});

check('量化分随原始分单调不减', () => {
  let prev = -1;
  for (let s = 0; s <= 400; s += 1) {
    const q = quantize(s, B);
    ok(q >= prev, `原始分 ${s} 时量化分反而下降了`);
    prev = q;
  }
});

check('翻倍规律：每翻一倍稳定 +10', () => {
  // 【注意】这里 k 是"翻几倍"（2 的指数），量化分 = 100 + 10·k。
  //   基准 20 翻 16 倍 = 320 分，量化分 100+10×4=140，不是 100+10×16。
  for (const k of [1, 2, 3, 4, 5]) {
    near(quantize(B * Math.pow(2, k), B), 100 + 10 * k, 0.01);
  }
});

console.log('\n=== 流水入杯基准 ===');

check('14 关基准 = 28×(14+1.5)+3 = 437', () => {
  // 437 是公式部分，另加 水球释放量 560 × 80% = 448
  near(liushuiBase(14), 437 + 448, 0.001);
});

check('关卡数变化时基准跟着变', () => {
  // 公式部分随关数变（28×(n+1.5)+3），水球部分与关数无关、恒为 448
  near(liushuiBase(10), 28 * 11.5 + 3 + 448, 0.001);
});

check('baseOf 对流水走专用公式', () => {
  // 437（公式）+ 448（水球 560×80%）= 885
  near(baseOf('liushui', 'lv1', 14), 885, 0.001);
});

check('baseOf 对其他游戏走 BASES 表', () => {
  ok(baseOf('minesweeper', 'small') === BASES['minesweeper:small']);
});

console.log('\n=== 流水入杯单关得分 ===');

check('完美局 225 滴全入杯 → 35 分', () => {
  near(liushuiRawScore(LIUSHUI_TOTAL_DROPS), 35, 0.001);
});

check('正好达标 190 滴 → 0 分（保本）', () => {
  near(liushuiRawScore(LIUSHUI_TARGET_DROPS), 0, 0.001);
});

check('接得不够（150 滴）→ 负分', () => {
  ok(liushuiRawScore(150) < 0, '打崩了应该有代价');
  near(liushuiRawScore(150), -40, 0.001);
});

check('14 关满分 = 1050（含水球额外 560）', () => {
  near(liushuiMaxScore(14), 1050, 0.001);
});

check('满分高于基准（基准是"好成绩"不是"满分"）', () => {
  // 【为什么满分不是 14×35=490】机关水球额外放水珠，不占每关 225 的配额。
  // 第 9 关 +214、第 13 关 +302，14 关合计 +560，满分 = 14×225+560−14×190 = 1050。
  ok(liushuiMaxScore(14) > liushuiBase(14), '基准若高于满分，量化分永远上不了 100');
  near(liushuiMaxScore(14), 490 + 560, 0.001);
});

check('单关完美 14 次 → 总分 490 → 量化约 101.6', () => {
  const q = quantize(490, 437);
  ok(q > 100, '全完美应该超过基准');
  near(q, 101.6, 0.2);
});

console.log('\n=== 总分累加 ===');

check('全新玩家总分 = 0（全部模式记 0）', () => {
  const r = totalQuantized({});
  ok(r.total === 0, `实际 ${r.total}`);
  // 【为什么改成从 MODE_KEYS 推导而不是写死 21】
  //   每加一个游戏/模式，这里的硬编码就要改一次，忘了就红。
  //   而测试真正要守的是"每个非流水模式各占一个单元、流水 14 关合并成 1 个"，
  //   这个关系可以直接从表算出来。
  const expect = Object.keys(MODE_KEYS)
    .reduce((n, g) => n + (g === 'liushui' ? 1 : MODE_KEYS[g].length), 0);
  ok(r.parts.length === expect, `组合数应为 ${expect}，实际 ${r.parts.length}`);
});

check('只玩一个模式达到基准 → 总分 100', () => {
  const r = totalQuantized({ 'ms.small': BASES['minesweeper:small'] });
  near(r.total, 100, 0.01);
});

check('玩两个模式都达基准 → 总分 200', () => {
  const r = totalQuantized({
    'ms.small': BASES['minesweeper:small'],
    'g2.classic': BASES['g2048:classic'],
  });
  near(r.total, 200, 0.01);
});

check('玩得越广总分越高（广度有价值）', () => {
  const one = totalQuantized({ 'ms.small': BASES['minesweeper:small'] }).total;
  const two = totalQuantized({
    'ms.small': BASES['minesweeper:small'],
    'fj.classic': BASES['fruitninja:classic'],
  }).total;
  ok(two > one, '多玩一个模式应该加分');
});

check('流水读的是 lsq.* 而不是滴数 ls.*', () => {
  // ls.* 是滴数（190 达标）。若被当成得分，会得到虚高的量化分。
  const r = totalQuantized({ 'ls.lv1': 190 });
  const lv = r.parts.find((p) => p.gameId === 'liushui');
  ok(lv.q === 0, `190 滴应得 0 分（达标即保本），实际 ${lv.q}`);
});

check('流水 14 关合并成一个模式累加', () => {
  const r = totalQuantized({ 'lsq.lv1': 35 });
  const lv = r.parts.find((p) => p.gameId === 'liushui');
  ok(lv, '应该有一个 liushui 组合');
  ok(lv.mode === 'all', `流水的模式标识应为 all，实际 ${lv.mode}`);
  ok(lv.raw === 35, `单关 35 分应累加为 35，实际 ${lv.raw}`);
});

check('流水 14 关全完美 → 量化约 102.5（与别的游戏同量级）', () => {
  // 满分 1050 / 基准 885 = 1.186 倍 → 100 + 10×log2(1.186) ≈ 102.5
  const full = {};
  for (let i = 1; i <= 14; i += 1) full['lsq.lv' + i] = 1050 / 14;
  const r = totalQuantized(full);
  const lv = r.parts.find((p) => p.gameId === 'liushui');
  ok(Math.abs(lv.raw - 1050) < 0.01, `满分应为 1050，实际 ${lv.raw}`);
  near(lv.q, 102.5, 0.2);
});

check('流水不能因为单关基准错配而变成鸡肋', () => {
  // 回归：曾把基准 437 套在单关上，导致单关满分 35 只有 8 分，
  // 14 关全完美才 112 分，还不如扫雷一个模式。
  const full = {};
  for (let i = 1; i <= 14; i += 1) full['lsq.lv' + i] = 1050 / 14;
  const r = totalQuantized(full);
  const lv = r.parts.find((p) => p.gameId === 'liushui');
  ok(lv.q > 100, `全完美应超过基准 100 分，实际 ${lv.q}`);
});

check('流水的负分不会抵消别的模式', () => {
  // 流水打崩 + 扫雷达基准：总分仍应 >= 100
  const r = totalQuantized({
    'ms.small': BASES['minesweeper:small'],
    'lsq.lv1': -40,
  });
  ok(r.total >= 100, `负分不该拖累其他模式，实际 ${r.total}`);
});

check('玩得越深总分越高（深度有价值）', () => {
  const b = BASES['minesweeper:small'];
  const at = totalQuantized({ 'ms.small': b }).total;
  const deep = totalQuantized({ 'ms.small': b * 2 }).total;
  near(deep - at, 10, 0.01);
});

console.log('\n=== 模式表完整性 ===');

check('流水 14 关合并成 1 个量化单元，其余模式各占一个', () => {
  let n = 0;
  for (const g of Object.keys(MODE_KEYS)) n += MODE_KEYS[g].length;
  // 关系式：总数 - 流水关卡数 + 1（合并单元）= 量化单元数
  const units = n - MODE_KEYS.liushui.length + 1;
  ok(units > 0, '量化单元数应为正');
  ok(MODE_KEYS.liushui.length === 14, `流水应为 14 关，实际 ${MODE_KEYS.liushui.length}`);
});

check('每个非流水模式都有基准分', () => {
  for (const g of Object.keys(MODE_KEYS)) {
    if (g === 'liushui') continue;
    for (const m of MODE_KEYS[g]) {
      ok(BASES[g + ':' + m] > 0, `${g}:${m} 缺基准分`);
    }
  }
});

check('BASES 里没有多余的键', () => {
  const valid = new Set();
  for (const g of Object.keys(MODE_KEYS)) {
    if (g === 'liushui') continue;
    for (const m of MODE_KEYS[g]) valid.add(g + ':' + m);
  }
  for (const k of Object.keys(BASES)) {
    ok(valid.has(k), `${k} 不在模式表里`);
  }
});

console.log('\n' + '='.repeat(50));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  for (const f of failures) console.log(`  ${f.name}: ${f.error.message}`);
  process.exit(1);
}
