// 切水果的道具果 / 计时 / 休闲模式规则测试。
//
// 【为什么单独一个文件】这些规则都是用户逐条提的需求，每条都有明确的
//   数值（-95%、-99.7%、-50%、×0.05、10 条命、5 秒免伤）。
//   写死成断言，以后谁改代码动了这些数字，测试立刻报错。
import { create } from '../src/games/fruitninja.js';

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

section("休闲模式：无炸弹 / 10 条命 / 道具果保留");
{
  const g = create({ mode: 'casual', seed: 5 });
  g.start();
  ok(g.view().lives === 10, '初始 10 条命', 'got=' + g.view().lives);
  let bombs = 0;
  for (let i = 0; i < 60 * 60; i++) {
    g.tick(1 / 60);
    for (const it of g.view().items) if (it.kind === 'bomb') bombs++;
    if (g.status !== 'playing') break;
  }
  ok('休闲模式从不生成炸弹', bombs === 0, 'bombs=' + bombs);
}

{
  const g = create({ mode: 'casual', seed: 21 });
  g.start();
  let sawSpecial = false;
  for (let i = 0; i < 60 * 120; i++) {
    g.tick(1 / 60);
    for (const it of g.view().items) if (it.kind === 'special') sawSpecial = true;
    if (g.status !== 'playing') break;
  }
  ok('休闲模式仍会出道具果', sawSpecial);
}

section("休闲模式：狂热期间 + 结束后 5 秒漏果不扣血");
{
  const g = create({ mode: 'casual', seed: 33 });
  g.start();
  let ate = false;
  for (let i = 0; i < 60 * 120 && !ate; i++) {
    g.tick(1 / 60);
    const v = g.view();
    const t = v.items.find((it) => it.kind === 'special' && it.special === 'frenzy' && !it.sliced);
    if (t) { g.stroke(t.x / 480, t.y / 360, t.x / 480, t.y / 360); ate = true; }
    if (g.status !== 'playing') break;
  }
  ok('能吃到狂热果', ate);
  if (ate) {
    const livesBefore = g.view().lives;
    for (let i = 0; i < 60 * 20; i++) {
      g.tick(1 / 60);
      if (g.view().specials.frenzy === 0) break;
    }
    ok('狂热会自然结束', g.view().specials.frenzy === 0);
    for (let i = 0; i < 60 * 4; i++) g.tick(1 / 60);
    ok('狂热结束后 5 秒内漏果不扣血', g.view().lives === livesBefore,
      'lives ' + livesBefore + ' -> ' + g.view().lives);
  }
}

section("顺计时与剩余时长互不影响");
{
  const g = create({ mode: 't60', seed: 7 });
  g.start();
  for (let i = 0; i < 60 * 5; i++) g.tick(1 / 60);
  const elapsedBefore = g.stats.timeMs / 1000;
  const leftBefore = g.view().timeLeft;
  g.extendTime?.(10);
  const elapsedAfter = g.stats.timeMs / 1000;
  const leftAfter = g.view().timeLeft;
  ok('加时不改变顺计时', Math.abs(elapsedAfter - elapsedBefore) < 0.1,
    'elapsed ' + elapsedBefore.toFixed(2) + ' -> ' + elapsedAfter.toFixed(2));
  ok('加时让剩余时长变多', leftAfter > leftBefore,
    'left ' + leftBefore.toFixed(2) + ' -> ' + leftAfter.toFixed(2));
}

section("冰冻让剩余时长流逝 ×0.05");
{
  const g = create({ mode: 't120', seed: 9 });
  g.start();
  let ate = false;
  for (let i = 0; i < 60 * 120 && !ate; i++) {
    g.tick(1 / 60);
    const v = g.view();
    const t = v.items.find((it) => it.kind === 'special' && it.special === 'freeze' && !it.sliced);
    if (t) { g.stroke(t.x / 480, t.y / 360, t.x / 480, t.y / 360); ate = true; }
    if (g.status !== 'playing') break;
  }
  ok("能吃到冰冻果", ate);
  if (ate) {
    const before = g.view().timeLeft;
    const elBefore = g.stats.timeMs / 1000;
    for (let i = 0; i < 60; i++) g.tick(1 / 60);
    const after = g.view().timeLeft;
    const elAfter = g.stats.timeMs / 1000;
    const drop = before - after;
    ok('冰冻期间剩余时长几乎不流逝', drop < 0.25, 'drop=' + drop.toFixed(3) + 's');
    ok('冰冻不影响顺计时', Math.abs((elAfter - elBefore) - 1) < 0.15,
      'elapsed 涨了 ' + (elAfter - elBefore).toFixed(2) + 's');
  }
}

console.log('\n' + (fail === 0 ? '全部通过：' : '存在失败：') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
