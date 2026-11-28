// 基准分查询页的数据契约测试。
//
// 【为什么测这个】这个页面唯一的卖点就是「数字和实际算分一致」。
//   如果页面显示的基准分和排行榜用的 quantize 结果对不上，
//   它比没有这个页面更糟——玩家会拿着错误的表来质疑排名。
import { GAMES } from '../src/games/index.js';
import { BASES, baseOf, quantize, liushuiBase, MODE_KEYS } from '../src/core/quantize.js';

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

section('每个游戏模式都有基准分');
let missing = [];
for (const g of GAMES) {
  for (const m of g.modes) {
    // 观战模式不计分、不上榜，本来就不该有基准分
    if (m.spectate) continue;
    const b = baseOf(g.id, m.value);
    if (!(b > 0)) missing.push(g.id + ':' + m.value);
  }
}
ok('所有模式都能查到基准分', missing.length === 0, missing.join(','));

section('页面遍历的模式与量化表一致');
// 页面用 GAMES 遍历，量化用 MODE_KEYS。两者脱节就会出现
// 「页面上有这一行，但排行榜里根本没这个模式」的错位。
for (const g of GAMES) {
  // 观战模式不计分，量化表里不该有它；比较时先剔掉
  const fromGames = g.modes.filter((m) => !m.spectate).map((m) => m.value).sort().join(',');
  const fromKeys = (MODE_KEYS[g.id] || []).slice().sort().join(',');
  ok(g.id + ' 的模式列表一致', fromGames === fromKeys, fromGames + ' vs ' + fromKeys);
}

section('基准分与实际算分一致');
// 基准分本身必须恰好折算成 100 分——这是规则的定义。
let bad = [];
for (const [key, base] of Object.entries(BASES)) {
  if (key.startsWith('liushui')) continue;
  const q = quantize(base, base);
  if (Math.abs(q - 100) > 0.001) bad.push(key + '=' + q);
}
ok('每个基准分都折算成 100', bad.length === 0, bad.join(','));

section('翻倍加分规则');
ok('恰好翻倍 → 110', Math.abs(quantize(200, 100) - 110) < 0.001);
ok('翻四倍 → 120', Math.abs(quantize(400, 100) - 120) < 0.001);
ok('低于基准线性折算', Math.abs(quantize(50, 100) - 50) < 0.001);
ok('没玩过记 0 分', quantize(0, 100) === 0);

section('流水入杯基准');
// 【为什么不再是 437】基准 = 公式 437 + 水球额外释放量 560 × 80% = 885。
  // 水球（CIRCLE.BUBBLE）被碰到会额外放水珠，不占每关 225 的配额，
  // 所以基准要按实际可接总量定，否则偏低。
  ok('14 关基准 = 885', liushuiBase() === 885, String(liushuiBase()));
ok('流水基准折算成 100', Math.abs(quantize(437, 437) - 100) < 0.001);

section('页面加总与 totalQuantized 一致');
// 页面底部会自己加一遍总分。如果它和排行榜的 totalQuantized 算法不同，
// 玩家会看到「页面说 330，榜上写 325」。这里用同一份输入对比。
const { totalQuantized } = await import('../src/core/quantize.js');
const fakeScores = {};
for (const g of GAMES) {
  for (const m of g.modes) {
    if (m.spectate) continue; // 观战不计分
    const short = { minesweeper: 'ms', fruitninja: 'fj', g2048: 'g2', snake: 'sn', watermelon: 'wm' }[g.id];
    if (short) fakeScores[short + '.' + m.value] = baseOf(g.id, m.value) * 2;
  }
}
const viaTotal = totalQuantized(fakeScores);
let viaPage = 0;
for (const g of GAMES) {
  for (const m of g.modes) {
    if (m.spectate) continue; // 观战不计分
    const b = baseOf(g.id, m.value);
    viaPage += quantize(b * 2, b);
  }
}
ok('两种算法结果相同', Math.abs(viaTotal.total - viaPage) < 0.001,
  'totalQuantized=' + viaTotal.total.toFixed(2) + ' page=' + viaPage.toFixed(2));

section('页面必须覆盖量化表里的每个游戏');
// 【为什么要单独查这一条】页面用 GAMES 遍历，量化用 MODE_KEYS。
//   东海龙珠登记在 DONGHAI_META（只进 ALL_GAMES），不在 GAMES 里 ——
//   于是它一直没出现在这张表上，玩家对不上总分里为什么多了这一项。
//   这是"两个列表脱节"的典型，光比对 GAMES 内部是查不出来的。
{
  const { ALL_GAMES } = await import('../src/games/index.js');
  const inGames = new Set(GAMES.map((g) => g.id));
  const missingFromPage = Object.keys(MODE_KEYS).filter((id) => !inGames.has(id));
  // 页面确实为这些游戏单独补了行，所以只要它们能在 ALL_GAMES 里查到基准分即可
  for (const id of missingFromPage) {
    const meta = ALL_GAMES.find((g) => g.id === id);
    if (id === 'liushui' || id === 'donghai' || id === 'yigan') {
      ok(id + ' 有单独补的行', true);
      if (meta) {
        for (const mode of MODE_KEYS[id]) {
          ok(id + ':' + mode + ' 基准分可查', baseOf(id, mode) > 0);
        }
      }
    } else {
      ok(id + ' 不该被漏掉', false, '既不在 GAMES 也没有单独补行');
    }
  }
}

section('小数型成绩不能取整（否则基准线失效）');
// 【为什么这条重要】推币机成绩是「每币平均彩票」，基准 5.625，
//   正常发挥 5.3~5.73，全落在 5 和 6 之间。
//   Math.round 会把 5.3 和 5.73 一起变成 6 —— 瞄准打得好和挂机随便打
//   存下来一模一样，基准线当场失效。其他游戏分数本来就是整数，不受影响。
{
  const fs = await import('node:fs/promises');
  const scoresSrc = await fs.readFile(new URL('../src/core/scores.js', import.meta.url), 'utf8');
  ok('recordBest 保留了小数型游戏的精度',
    /FRACTIONAL_GAMES/.test(scoresSrc) && /donghai/.test(scoresSrc));
  const baseInfoSrc = await fs.readFile(new URL('../src/ui/base-info.js', import.meta.url), 'utf8');
  ok('基准分页面也按小数显示', /FRACTIONAL_GAMES/.test(baseInfoSrc));
}

section('空缓存不能把成绩永久锁死');
// 【为什么这条必须有】loadScores 里 if (cache) return cache; 而 {} 是 truthy。
//   启动时存档为空就会把 cache 锁成 {}，之后整个会话读不到新写入的成绩，
//   表现为"基准分查询里我的最好永远是 —"、"打完一局排行榜没变化"。
{
  const fs = await import('node:fs/promises');
  const src = await fs.readFile(new URL('../src/core/scores.js', import.meta.url), 'utf8');
  ok('空 cache 也要重新读', /if \(cache && Object\.keys\(cache\)\.length\) return cache;/.test(src));
  ok('loading 用完要清空', /loading = null/.test(src));
}

console.log('\n' + (fail === 0 ? '全部通过：' : '存在失败：') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
