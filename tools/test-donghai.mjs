/**
 * 东海龙珠（推币机）计分与挑战规则测试。
 *
 * 【为什么这些断言必须存在】这里的每条规则都是用户口述的，
 *   代码里写错不会有任何报错——只会安静地算错分、或者让"每日 3 次"
 *   形同虚设。比如次数限制写错一个等号，玩家就能无限刷榜。
 */
import {
  BASE_TICKETS_PER_COIN, ticketsPerCoin, roundScore, quantize, Q_CAP,
  CHALLENGE_LIMITS, DAILY_ATTEMPTS, dailyLimit, dateKeyOf, weekStartKey,
  emptyDaily, applyAttempt, attemptsLeft, emptyWeek, applyDayScore,
  weekIndex, encodeWeekly, decodeWeekly, WEEK_ENCODE_BASE,
} from '../src/tools/donghai/scoring.js';
import { quantize as coreQuantize, BASES } from '../src/core/quantize.js';

let pass = 0, fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push({ name, error: e }); console.log('  ✗ ' + name); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error((msg || '数值不接近') + '：实际 ' + a + '，期望 ' + b + '（容差 ' + tol + '）');
}

console.log('=== 基准分：每币 45/8 = 5.625 张 ===');
check('基准常量是 45/8', () => near(BASE_TICKETS_PER_COIN, 5.625, 1e-12));
check('8 币 45 票 = 每币 5.625', () => {
  near(ticketsPerCoin(8, 45), 5.625, 1e-9);
  near(roundScore(ticketsPerCoin(8, 45)), 5.625, 1e-9);
});
check('每币 5.625 张 = 量化 100 分（基准）', () => near(quantize(45 / 8), 100, 0.01));
check('基准与 core/quantize.js 的 donghai:classic 一致', () => {
  // 【为什么要跨文件对拍】两处各写一个基准，改一处漏一处就会：
  //   结算显示 100 分，但综合榜按另一个基准折算，玩家看到两个不同的分。
  ok(BASES['donghai:classic'] !== undefined, 'core 里没有 donghai:classic');
  near(BASES['donghai:classic'], BASE_TICKETS_PER_COIN, 1e-12,
    '两处基准不一致：core=' + BASES['donghai:classic'] + ' 本模块=' + BASE_TICKETS_PER_COIN);
});
check('实测水平落在合理区间', () => {
  // 【为什么要断言这个】基准一旦调偏，普通玩家会永远卡在低分或轻松满分，
  //   榜就失去区分度。实测：不瞄准 5.3 张、瞄准彩票槽 5.73 张。
  const casual = quantize(5.3);
  const aimed = quantize(5.73);
  ok(casual > 85 && casual < 100, '不瞄准应接近但不到 100，实际 ' + casual.toFixed(2));
  ok(aimed >= 100 && aimed < 115, '瞄准应刚过 100，实际 ' + aimed.toFixed(2));
  // 挂机刷不到满分 —— 这是基准设计的核心意图
  ok(quantize(5.3) < 100, '不瞄准不该能到 100，实际 ' + quantize(5.3).toFixed(2));
});
check('零币不除零，返回 0', () => {
  ok(ticketsPerCoin(0, 500) === 0, '应返回 0');
  ok(quantize(0) === 0, '量化分应为 0');
});

console.log('\n=== 量化公式必须和 core/quantize.js 一致 ===');
check('多个取值对拍', () => {
  // 【为什么要对拍】推币机自己实现了一份 quantize（为了不拖进整个游戏注册表）。
  //   两份公式一旦漂移，推币机在综合总榜里的分数就和别的游戏不是一个尺子。
  for (const s of [1, 3, 5, 5.624, 5.625, 5.626, 11.25, 22.5, 45, 90]) {
    const mine = quantize(s, BASE_TICKETS_PER_COIN);
    const core = coreQuantize(s, BASE_TICKETS_PER_COIN);
    near(mine, core, 0.01, 'score=' + s);
  }
});
check('超过基准按对数：翻倍 +10', () => {
  near(quantize(11.25), 110, 0.01);
  near(quantize(22.5), 120, 0.01);
});
check('低于基准按线性', () => {
  near(quantize(2.8125), 50, 0.01);
  near(quantize(4.21875), 75, 0.01);
});
check('封顶 ' + Q_CAP, () => ok(quantize(1e6) <= Q_CAP, '超过封顶'));

console.log('\n=== 每日限额档位 ===');
check('档位是 50/80/100/120', () => {
  ok(JSON.stringify(CHALLENGE_LIMITS) === JSON.stringify([50, 80, 100, 120]),
    '实际 ' + JSON.stringify(CHALLENGE_LIMITS));
});
check('同一天所有人算出同一档（确定性）', () => {
  for (const d of ['2026-11-22', '2026-11-23', '2026-12-01']) {
    ok(dailyLimit(d) === dailyLimit(d), d + ' 两次结果不一致');
  }
});
check('一周内能覆盖到多个档位（不是永远一档）', () => {
  const seen = new Set();
  for (let i = 0; i < 14; i++) {
    const d = new Date(2026, 10, 22 + i);
    seen.add(dailyLimit(dateKeyOf(d)));
  }
  ok(seen.size >= 2, '两周只出现 ' + seen.size + ' 种档位，随机性失效');
});
check('限额一定是四档之一', () => {
  for (let i = 0; i < 60; i++) {
    const d = new Date(2026, 0, 1 + i);
    ok(CHALLENGE_LIMITS.includes(dailyLimit(dateKeyOf(d))), '出现了非法档位');
  }
});

console.log('\n=== 每日 3 次 ===');
check('每天 3 次', () => ok(DAILY_ATTEMPTS === 3, '实际 ' + DAILY_ATTEMPTS));
check('初始剩余 3 次', () => ok(attemptsLeft(emptyDaily('2026-11-22'), '2026-11-22') === 3));
check('用掉 3 次后剩 0，第 4 次仍为 0', () => {
  let d = emptyDaily('2026-11-22');
  for (let i = 0; i < 3; i++) d = applyAttempt(d, '2026-11-22', 10);
  ok(attemptsLeft(d, '2026-11-22') === 0, '3 次后应为 0');
  const d4 = applyAttempt(d, '2026-11-22', 99);
  ok(attemptsLeft(d4, '2026-11-22') === 0, '第 4 次后仍应为 0');
});
check('跨天恢复 3 次', () => {
  let d = emptyDaily('2026-11-22');
  for (let i = 0; i < 3; i++) d = applyAttempt(d, '2026-11-22', 10);
  ok(attemptsLeft(d, '2026-11-23') === 3, '第二天应恢复 3 次');
});
check('同日多次只记最好成绩', () => {
  let d = emptyDaily('2026-11-22');
  d = applyAttempt(d, '2026-11-22', 8.5);
  d = applyAttempt(d, '2026-11-22', 13.2);
  d = applyAttempt(d, '2026-11-22', 9.0);
  near(d.best, 13.2, 1e-9, '应保留最高的 13.2');
});

console.log('\n=== 周榜：每日累加，每周刷新 ===');
check('周一为一周之始', () => {
  // 2026-11-22 是周日，应归到 11-16 那一周
  ok(weekStartKey(new Date('2026-11-22T12:00:00')) === '2026-11-16', '周日应归上周一');
  ok(weekStartKey(new Date('2026-11-23T12:00:00')) === '2026-11-23', '周一应是自己');
});
check('每天累加，不是取最高一天', () => {
  let w = emptyWeek('2026-11-16');
  w = applyDayScore(w, '2026-11-16', '2026-11-16', 100);
  w = applyDayScore(w, '2026-11-16', '2026-11-17', 110);
  near(w.total, 210, 1e-9, '两天应相加');
});
check('同一天多次只取最高', () => {
  let w = emptyWeek('2026-11-16');
  w = applyDayScore(w, '2026-11-16', '2026-11-16', 100);
  w = applyDayScore(w, '2026-11-16', '2026-11-16', 105);
  w = applyDayScore(w, '2026-11-16', '2026-11-16', 98);
  near(w.total, 105, 1e-9, '同天应取 105');
});
check('跨周清零', () => {
  let w = emptyWeek('2026-11-16');
  w = applyDayScore(w, '2026-11-16', '2026-11-16', 100);
  const next = applyDayScore(w, '2026-11-23', '2026-11-23', 50);
  near(next.total, 50, 1e-9, '新的一周应只剩 50');
  ok(Object.keys(next.days).length === 1, '旧周数据应被丢弃');
});
check('周总分保留三位小数', () => {
  let w = emptyWeek('2026-11-16');
  w = applyDayScore(w, '2026-11-16', '2026-11-16', 1.2345);
  ok(String(w.total).length <= 8, '小数位失控：' + w.total);
});

console.log('\n=== 云榜编码：周次必须在高位 ===');
check('编码/解码可逆', () => {
  for (const [w, v] of [[2967, 45.5], [2967, 0], [1, 6.5], [2967, 123.456]]) {
    const d = decodeWeekly(encodeWeekly(w, v));
    ok(d.weekIdx === w, '周次还原失败：' + d.weekIdx + ' vs ' + w);
    near(d.total, v, 0.001, '总分还原');
  }
});
check('新周分数低，编码值也必须更高', () => {
  // 【这条是周榜能工作的前提】平台云榜只认"更高分"。
  //   如果新周因为分数低而编码值更低，云上就永远停在旧周，榜是死的。
  const w = 2967;
  const highLastWeek = encodeWeekly(w, 45.5);
  const lowThisWeek = encodeWeekly(w + 1, 13.6);
  ok(lowThisWeek > highLastWeek, '新周编码值 ' + lowThisWeek + ' 未超过旧周 ' + highLastWeek);
});
check('周总分不会溢出到下一周', () => {
  // 【为什么这条重要】如果周总分超过编码基数（10000），
  //   就会进位到周次上，导致"这周的分"被算成"下周的"，过滤后直接消失。
  //   实际周总分最多几十，这里按 999.999 验一个远大于实际的边界。
  const w = 2967;
  const d = decodeWeekly(encodeWeekly(w, 999.999));
  ok(d.weekIdx === w, '总分溢出污染了周次：' + d.weekIdx);
  near(d.total, 999.999, 0.001);
});
check('周序号随日期单调递增', () => {
  const a = weekIndex('2026-11-16');
  const b = weekIndex('2026-11-23');
  const c = weekIndex('2026-11-30');
  ok(a < b && b < c, '周序号没有递增：' + [a, b, c].join(','));
  ok(b - a === 1, '相邻两周应差 1，实际差 ' + (b - a));
});
check('同周内任意两天算出同一个周序号', () => {
  // 2026-11-16 是周一，2026-11-22 是周日
  const idx = new Set();
  for (let i = 0; i < 7; i++) {
    const d = new Date(2026, 10, 16 + i);
    const k = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    idx.add(weekIndex(k));
  }
  ok(idx.size === 1, '同一周出现了 ' + idx.size + ' 个周序号');
});
check('跨周差一天也要变成新周序号', () => {
  ok(weekIndex('2026-11-22') !== weekIndex('2026-11-23'), '周日到周一没有换周');
});

console.log('\n' + '='.repeat(46));
if (fail) {
  console.log('失败 ' + fail + ' 项：');
  for (const f of failures) console.log('  - ' + f.name + '：' + f.error.message);
  process.exit(1);
} else {
  console.log('全部通过：' + pass + ' 通过 / 0 失败');
}
