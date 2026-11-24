#!/usr/bin/env node
/**
 * 流水入杯的引擎自测。
 *
 * 【为什么要在 Node 里跑而不是开浏览器点】物理引擎最容易出的错是"数值不对"：
 *   水珠不落、杯子装不满、机关不动。这些都能用脚本在 2 秒内验证，
 *   比手点十几遍可靠得多，也不会因为改了常量而悄悄回归。
 */
import { LEVELS } from '../src/tools/liushui/levels.js';
import { GameWorld, TOTAL_DROPS, TARGET_DROPS, DROP_RADIUS, CUP_W, CUP_H, WORLD_W, WORLD_H } from '../src/tools/liushui/engine.js';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function section(t) {
  console.log(`\n[${t}]`);
}

/** 跑一局：不画线，直接放水，看水珠会不会落到杯里 */
function simulate(level, seconds, lines = 0) {
  const w = new GameWorld(level, 12345);
  w.startWater();
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) w.update(dt);
  return w;
}

section('关卡数据');
ok('14 关全部存在', LEVELS.length === 14, `实际 ${LEVELS.length}`);
ok('每关都有名字', LEVELS.every((l) => l.name && l.name.length > 0));
ok('关卡索引 1..14 连续', LEVELS.every((l, i) => l.index === i + 1));
ok('所有坐标都在世界范围内',
  LEVELS.every((l) => l.faucetX > 0 && l.faucetX < WORLD_W && l.cupBottomY > 0.5 && l.cupBottomY <= 0.941));
ok('第十四关有 1 个毒水龙头', LEVELS[13].poisonFaucets.length === 1);

section('常量一致性');
ok('杯宽 0.222*sqrt(7/17)', Math.abs(CUP_W - 0.222 * Math.sqrt(7 / 17)) < 1e-12, CUP_W.toFixed(6));
ok('杯高 0.200*sqrt(7/17)', Math.abs(CUP_H - 0.2 * Math.sqrt(7 / 17)) < 1e-12, CUP_H.toFixed(6));
ok('水珠半径为正', DROP_RADIUS > 0.004 && DROP_RADIUS < 0.01, DROP_RADIUS.toFixed(5));

section('第一关：直落到底');
{
  const L = LEVELS[0];
  const w = new GameWorld(L, 7);
  ok('初始状态 ready', w.state === 'ready');
  ok('ready 阶段物理冻结', (() => {
    const before = w.physics.drops.length;
    for (let i = 0; i < 60; i++) w.update(1 / 60);
    return w.physics.drops.length === before && w.spawned === 0;
  })());
  w.startWater();
  ok('startWater 后 running', w.state === 'running');
  for (let i = 0; i < 60; i++) w.update(1 / 60);
  ok('1 秒内出水珠', w.spawned > 30 && w.spawned <= 50, `${w.spawned} 颗`);
}

section('整局模拟（每关 40 秒，不画线）');
// 【注意】不画线时大部分关卡本来就该失败——那正是"要玩家画线"的意思。
// 这里只验证物理没炸：数值有限、刚体还在、状态机合法。
for (const L of LEVELS) {
  const w = simulate(L, 40);
  const alive = w.physics.drops.filter((d) => !d.removed).length;
  const bars = w.physics.bars.length;
  const finite = w.physics.drops.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
  const barsFinite = w.physics.bars.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y));
  const legal = ['ready', 'running', 'won', 'lost'].includes(w.state);
  ok(
    `${L.name}：物理稳定`,
    w.spawned > 0 && bars > 0 && finite && barsFinite && legal && Number.isFinite(w.dropsInCup),
    `出水 ${w.spawned} 存活 ${alive} 入杯 ${w.dropsInCup} 刚体 ${bars} 状态 ${w.state}`,
  );
}

section('第一关完整结算（杯子正下方，不画线）');
{
  const w = simulate(LEVELS[0], 30);
  ok('水珠全部出完', w.spawned === TOTAL_DROPS, `${w.spawned}`);
  ok('有水流进杯子', w.dropsInCup > 0, `${w.dropsInCup} 颗`);
  ok('杯子没有被推走', !w.cupOffscreen(), `cup x=${w.cupBody.x.toFixed(3)}`);
}

section('画线功能');
{
  const w = new GameWorld(LEVELS[1], 99);
  const gl = w.addLinePath([0.15, 0.35], [0.35, 0.35], 2);
  ok('能加一根线', gl !== null);
  ok('线被记进 lines', w.lines.length === 1);
  ok('线有质量', gl && gl.mass > 0, gl ? gl.mass.toFixed(4) + ' kg' : '');
  ok('线长在 4.5cm..60.5cm 之间', gl && gl.length > 0.045 && gl.length <= 0.605, gl ? gl.length.toFixed(3) : '');

  const tooShort = w.addLinePath([0.15, 0.15], [0.35, 0.36], 2);
  ok('太短的线被拒绝', tooShort === null);

  w.addLinePath([0.1, 0.5], [0.5, 0.5], 2);
  w.addLinePath([0.1, 0.6], [0.5, 0.6], 2);
  const fourth = w.addLinePath([0.1, 0.7], [0.5, 0.7], 2);
  ok('第 4 根线被拒绝（上限 3）', fourth === null);

  w.clearLines();
  ok('清线后归零', w.lines.length === 0);
}

section('机关运动');
{
  // 第十一关有两个沿路径往返的挡板（motion.type=3）
  const L = LEVELS[10];
  const hasMover = [...L.supports, ...L.segments, ...L.circles].some((o) => o.motion);
  ok('第十一关含动态物体', hasMover, `${[...L.supports, ...L.segments, ...L.circles].filter((o) => o.motion).length} 个`);
  if (hasMover) {
    const w = new GameWorld(L, 3);
    w.startWater();
    const before = w.movers.map((m) => (m.circle ? { x: m.circle.cx, y: m.circle.cy } : { x: m.bar.x, y: m.bar.y }));
    for (let i = 0; i < 120; i++) w.update(1 / 60);
    const after = w.movers.map((m) => (m.circle ? { x: m.circle.cx, y: m.circle.cy } : { x: m.bar.x, y: m.bar.y }));
    const moved = before.some((b, i) => Math.hypot(after[i].x - b.x, after[i].y - b.y) > 1e-4);
    ok('动态物体确实在动', moved);
  }
}

section('火焰与毒水机制');
{
  // 第十四关：毒水龙头
  const L = LEVELS[13];
  ok('第十四关有 1 个毒水源', L.poisonFaucets.length === 1);
  const w = new GameWorld(L, 5);
  w.startWater();
  for (let i = 0; i < 300; i++) w.update(1 / 60);
  const poisonDrops = w.physics.drops.filter((d) => d.poison && !d.removed);
  ok('毒水龙头确实在滴毒水', poisonDrops.length > 0 || w.poisonDropsInCup > 0, `场上 ${poisonDrops.length} 颗`);
  ok('毒水与水接触生成泥土', w.mudBars.length > 0 || w.spawned === 0, `泥土 ${w.mudBars.length} 块`);
}

section('失败判定');
{
  const w = new GameWorld(LEVELS[0], 11);
  w.startWater();
  // 直接把杯子推出屏幕，验证 5 秒宽限后判负
  w.cupBody.x = -1;
  for (let i = 0; i < 60 * 6; i++) w.update(1 / 60);
  ok('杯子离屏 5 秒判负', w.state === 'lost', w.state);
  ok('失败原因已记录', w.failReason.includes('离开屏幕'), w.failReason);
}

section('时间与进度');
{
  const w = new GameWorld(LEVELS[0], 21);
  w.startWater();
  for (let i = 0; i < 60; i++) w.update(1 / 60);
  ok('runTime 约等于 1 秒', Math.abs(w.runTime - 1) < 0.05, w.runTime.toFixed(3));
  ok('percent 在 0..100', w.percent >= 0 && w.percent <= 100, w.percent.toFixed(1));
  w.requestManualEnd();
  ok('手动结束后有倒计时', w.manualEndTimer > 0 && w.manualEndRequested);
  for (let i = 0; i < 60 * 6; i++) w.update(1 / 60);
  ok('手动结束 5 秒后结算', w.state === 'won' || w.state === 'lost', w.state);
}

section('第一关可通关（关卡设计自检）');
{
  // 第一关是"规则关"：杯子正对水龙头，不画线也该满
  const w = simulate(LEVELS[0], 40);
  ok('第一关不画线也能通关', w.state === 'won', `状态 ${w.state}，入杯 ${w.dropsInCup} 颗`);
  ok('第一关入杯数达到 95%', w.dropsInCup >= TARGET_DROPS, `${w.dropsInCup} / ${TARGET_DROPS}`);
}

section('确定性（同 seed 同结果）');
{
  const a = simulate(LEVELS[3], 8);
  const b = simulate(LEVELS[3], 8);
  ok('相同 seed 出水数一致', a.spawned === b.spawned);
  ok('相同 seed 入杯数一致', a.dropsInCup === b.dropsInCup, `${a.dropsInCup} vs ${b.dropsInCup}`);
}

section('性能');
{
  const w = new GameWorld(LEVELS[11], 31); // 第十二关：9 个圆 + 7 根线，最重的一关
  w.startWater();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 300; i++) w.update(1 / 60);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const perFrame = ms / 300;
  ok('单帧物理 < 16ms（能跑满 60fps）', perFrame < 16, `${perFrame.toFixed(2)} ms/帧，5 秒共 ${ms.toFixed(0)} ms`);
}

console.log(`\n${'='.repeat(48)}`);
console.log(`通过 ${pass} / ${pass + fail}`);
if (fail) {
  console.log('失败项：');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
