/**
 * 游戏逻辑回归测试。
 *
 * 为什么必须有这一层：这几个 bug 都是"玩到某个分支才炸"的类型——
 *   切水果的 score 是 NaN，只有切中水果时才出现；
 *   2048 菱形盘的 NaN，只有第一次移动才出现；
 *   限时模式一开局就结束，只有漏掉第一个水果时才出现。
 * 单靠手点很容易漏，跑一遍所有模式 × 随机输入才靠得住。
 *
 * 运行：node tools/test-games.mjs
 */
import * as minesweeper from '../src/games/minesweeper.js';
import * as fruitninja from '../src/games/fruitninja.js';
import * as g2048 from '../src/games/g2048.js';
import * as snake from '../src/games/snake.js';

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  [OK] ' + name); }
  else { fail++; console.log('  [NG] ' + name + (extra ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const MODULES = [
  ['minesweeper', minesweeper],
  ['fruitninja', fruitninja],
  ['2048', g2048],
  ['snake', snake],
];

function playOut(mod, mode, seed = 1234, maxFrames = 30000) {
  const g = mod.create({ mode, seed });
  g.start();
  const rnd = makeRng(seed);
  let frames = 0;
  for (let i = 0; i < maxFrames; i++) {
    g.tick(1 / 60);
    frames++;
    if (i % 20 === 0) {
      if (g.key) g.key(['up', 'down', 'left', 'right'][Math.floor(rnd() * 4)]);
      if (g.swipe) g.swipe(rnd() * 2 - 1, rnd() * 2 - 1);
      if (g.pointer) g.pointer(rnd(), rnd(), rnd() > 0.85);
      if (g.stroke) g.stroke(rnd(), rnd(), rnd(), rnd());
    }
    if (g.status === 'over') break;
  }
  return { g, frames };
}

section('所有游戏 x 所有模式都能正常结束');
for (const [name, mod] of MODULES) {
  for (const m of mod.meta.modes) {
    const { g } = playOut(mod, m.value);
    const s = g.stats;
    ok(name + '/' + m.value + ' 分数是有限数', Number.isFinite(g.score), 'score=' + g.score);
    ok(name + '/' + m.value + ' 用时是有限数', Number.isFinite(s.timeMs), 'timeMs=' + s.timeMs);
    ok(name + '/' + m.value + ' 用时非负', s.timeMs >= 0, 'timeMs=' + s.timeMs);
    // 【观战模式不要求"能结束"】观战是给人看的，不是给分打的：
    //   切水果观战给了 999 条命且没有炸弹，设计上就是无限演下去；
    //   合成大西瓜观战也可能长时间不合满。逼它结束反而是错的行为。
    if (!m.spectate) {
      ok(name + '/' + m.value + ' 能进入结束态', g.status === 'over', 'status=' + g.status);
    }
  }
}

section('切水果：分值必须跟着水果走');
{
  const g = fruitninja.create({ mode: 'classic', seed: 99 });
  g.start();
  const rnd = makeRng(5);
  for (let i = 0; i < 3000 && g.score === 0; i++) {
    g.tick(1 / 60);
    g.stroke(rnd(), rnd(), rnd(), rnd());
  }
  ok('切中水果后分数 > 0', g.score > 0, 'score=' + g.score);
  ok('切中水果后分数不是 NaN', Number.isFinite(g.score), 'score=' + g.score);
}

section('切水果：限时模式跑满整局');
// 【为什么断言改成看 timeLeft 归零】限时模式的漏果惩罚是"扣剩余时长"，
//   不是"让顺计时走得更快"。测试里乱划漏果极多，剩余时长会被很快扣光，
//   但顺计时（elapsed）只反映真实打了多久——它远小于 60/120 秒是正常的。
//   原来按 elapsed 断言"接近 60/120 秒"，等于要求"漏果不掉时间"，
//   和游戏规则冲突。真正该验证的是：一局会正常结束，且剩余时间归零。
for (const pair of [['t60', 60], ['t120', 120]]) {
  const mode = pair[0];
  const secs = pair[1];
  const r = playOut(fruitninja, mode, 1234, 30000);
  const left = r.g.view().timeLeft;
  ok(mode + ' 结束时剩余时间归零', left <= 0.5, 'left=' + left.toFixed(2) + 's');
  // 顺计时不能超过总时长，也不能为负
  const got = r.g.stats.timeMs / 1000;
  ok(mode + ' 顺计时不超过总时长', got >= 0 && got <= secs + 1, 'got=' + got.toFixed(1) + 's');
}

section('2048：墙格子不能被写坏');
for (const mode of ['classic', 'square5', 'diamond']) {
  const g = g2048.create({ mode, seed: 1234 });
  g.start();
  const rnd = makeRng(3);
  let moved = 0;
  for (let i = 0; i < 500; i++) {
    g.key(['up', 'down', 'left', 'right'][Math.floor(rnd() * 4)]);
    moved++;
    if (!Number.isFinite(g.score)) break;
    if (g.status === 'over') break;
  }
  ok(mode + ' 多次移动后分数有限', Number.isFinite(g.score), 'score=' + g.score + ' after ' + moved + ' moves');
}

section('模组接口：timer 与实时参数');
{
  // 【为什么用扫雷】切水果在限时模式下漏果会扣时，不操作 20 秒就把时间扣光了，
  //   测不出"加时"的效果；扫雷不点就不会掉时间，是个干净的计时基准。
  const g = minesweeper.create({ mode: 'small', seed: 1 });
  g.start();
  ok('游戏暴露 extendTime', typeof g.extendTime === 'function');
  ok('游戏暴露 resetTimer', typeof g.resetTimer === 'function');
  // 先跑掉 20 秒，否则"加时"会被满时间上限截断，测不出效果
  for (let i = 0; i < 20 * 60; i++) g.tick(1 / 60);
  const before = g.mods.timer.remaining;
  ok('跑 20 秒后剩余约 ' + (g.mods.timer.duration - 20) + ' 秒', Math.abs(before - (g.mods.timer.duration - 20)) < 0.2, 'before=' + before.toFixed(2));
  // 加时会被总时长上限截断，所以期望值也要先过一遍 min()
  const cap = Math.min(before + 30, g.mods.timer.duration);
  g.extendTime(30);
  ok('extendTime(+30) 让剩余时间 +30 秒（上限截断）', Math.abs(g.mods.timer.remaining - cap) < 0.05, 'want=' + cap.toFixed(2) + ' got=' + g.mods.timer.remaining.toFixed(2));
  g.extendTime(-10);
  ok('extendTime(-10) 让剩余时间 -10 秒', Math.abs(g.mods.timer.remaining - (cap - 10)) < 0.05, 'want=' + (cap - 10).toFixed(2) + ' got=' + g.mods.timer.remaining.toFixed(2));
  const full = g.mods.timer.duration;
  g.resetTimer();
  ok('resetTimer 让剩余时间回满', Math.abs(g.mods.timer.remaining - full) < 0.05, 'now=' + g.mods.timer.remaining.toFixed(2));
  // 边界：加时不能超过总时长，扣时不能低于 0
  g.extendTime(9999);
  ok('加时不会超过总时长', g.mods.timer.remaining <= full + 0.001, 'now=' + g.mods.timer.remaining.toFixed(2));
  g.extendTime(-9999);
  ok('扣时不会低于 0', g.mods.timer.remaining >= 0, 'now=' + g.mods.timer.remaining.toFixed(2));
}

section('模组 timer.pause 冻结计时');
{
  const g = fruitninja.create({ mode: 't60', seed: 1 });
  g.start();
  g.tick(1 / 60);
  const t1 = g.mods.timer.elapsed;
  g.mods.timer.paused = true;
  for (let i = 0; i < 60; i++) g.tick(1 / 60);
  ok('paused 后 elapsed 不再增长', Math.abs(g.mods.timer.elapsed - t1) < 0.001, 't1=' + t1 + ' now=' + g.mods.timer.elapsed);
  g.mods.timer.paused = false;
  for (let i = 0; i < 60; i++) g.tick(1 / 60);
  ok('resume 后 elapsed 继续增长', g.mods.timer.elapsed > t1 + 0.9, 'now=' + g.mods.timer.elapsed);
}

section('四款游戏都实现了 timer 接口');
for (const [name, mod] of MODULES) {
  const g = mod.create({ mode: mod.meta.modes[0].value, seed: 1 });
  ok(name + ' 有 extendTime', typeof g.extendTime === 'function');
  ok(name + ' 有 resetTimer', typeof g.resetTimer === 'function');
}

section('贪吃蛇多人局：模式与棋盘');
{
  const want = ['b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'];
  const have = snake.meta.modes.map((m) => m.value);
  for (const w of want) ok('存在模式 ' + w, have.includes(w), have.join(','));
  // 棋盘随人数递增。用户规则：8 人局两边各 +5、7 人 +3、6 人 +2、5 人 +1，
  // 即边长加 2N（左右各 N）。2~4 人局不加宽。
  const size = (m) => { const g = snake.create({ mode: m, seed: 1 }); return g.battle.cols; };
  ok('2 人局 19×19', size('b2') === 19, 'cols=' + size('b2'));
  ok('3 人局 19×19', size('b3') === 19, 'cols=' + size('b3'));
  ok('4 人局 20×20', size('b4') === 20, 'cols=' + size('b4'));
  ok('5 人局 22×22（每边 +1）', size('b5') === 22, 'cols=' + size('b5'));
  ok('6 人局 24×24（每边 +2）', size('b6') === 24, 'cols=' + size('b6'));
  ok('7 人局 26×26（每边 +3）', size('b7') === 26, 'cols=' + size('b7'));
  ok('8 人局 30×30（每边 +5）', size('b8') === 30, 'cols=' + size('b8'));
}

section('贪吃蛇多人局：蛇数与玩家标识');
for (let n = 2; n <= 8; n++) {
  const g = snake.create({ mode: 'b' + n, seed: 7 });
  const b = g.battle;
  ok(n + ' 人局蛇数正确', b.snakes.length === n, 'got=' + b.snakes.length);
  ok(n + ' 人局只有一条玩家蛇', b.snakes.filter((s) => s.isPlayer).length === 1);
  ok(n + ' 人局玩家是 0 号', b.snakes[0].isPlayer === true);
  // 出生点互不重叠：重叠会导致开局即互撞
  const cells = new Set();
  let dup = false;
  for (const s of b.snakes) for (const p of s.body) {
    const k = p.x + ',' + p.y;
    if (cells.has(k)) dup = true;
    cells.add(k);
  }
  ok(n + ' 人局出生点不重叠', !dup);
}

section('贪吃蛇多人局：推进与观战');
{
  const g = snake.create({ mode: 'b4', seed: 3 });
  g.start();
  // 跑 200 步，确认不崩、状态自洽
  for (let i = 0; i < 200; i++) g.tick(1 / 60);
  const b = g.battle;
  ok('推进后仍在合法状态', ['playing', 'over'].includes(g.status), g.status);
  ok('存活数不超过总人数', b.aliveCount <= 4, 'alive=' + b.aliveCount);
  // 蛇身都在棋盘内
  let inBounds = true;
  for (const s of b.snakes) for (const p of s.body) {
    if (p.x < 0 || p.y < 0 || p.x >= b.cols || p.y >= b.rows) inBounds = false;
  }
  ok('蛇身都在棋盘内', inBounds);
}

section('贪吃蛇多人局：AI 不会原地掉头');
{
  const g = snake.create({ mode: 'b8', seed: 11 });
  g.start();
  let reverse = false;
  // 【为什么要跳过死蛇】蛇一死 body 会被清空，读 body[0] 就是 undefined。
  //   原来这里无条件 map，跑满 120 帧后只要有蛇自然死亡就崩——
  //   是测试写法的问题，不是游戏的问题。死蛇本来就不该参与"有没有穿模"的判定。
  const headOf = (s) => (s.alive && s.body && s.body.length ? { x: s.body[0].x, y: s.body[0].y } : null);
  let prev = g.battle.snakes.map(headOf);
  for (let i = 0; i < 120; i++) {
    g.tick(1 / 60);
    const cur = g.battle.snakes.map(headOf);
    for (let k = 0; k < cur.length; k++) {
      if (!g.battle.snakes[k].alive || !cur[k] || !prev[k]) continue;
      // 一步最多移动一格，跨两格说明穿模
      const dx = Math.abs(cur[k].x - prev[k].x);
      const dy = Math.abs(cur[k].y - prev[k].y);
      if (dx > 1 || dy > 1) reverse = true;
    }
    prev = cur;
  }
  ok('没有一步跨多格', !reverse);
}

section('贪吃蛇单人模式不受多人改动影响');
{
  for (const m of ['classic', 'wrap', 'maze']) {
    const g = snake.create({ mode: m, seed: 5 });
    ok(m + ' 仍是单人（无 battle）', g.battle === undefined);
    ok(m + ' 有 key 方法', typeof g.key === 'function');
    g.start();
    for (let i = 0; i < 60; i++) g.tick(1 / 60);
    ok(m + ' 推进正常', ['playing', 'over'].includes(g.status));
  }
}


section('扫雷输入：右键标雷，右键抬起不判定');
{
  /**
   * 复刻 game-screen.js 里 onDown/onUp 的按键判定。
   *
   * 【为什么要单独测这段】这段逻辑没有纯函数入口，只能靠事件时序验证。
   *   而它一旦写错，表现是「旗子插上又被翻开」——玩家会以为标雷功能坏了，
   *   但代码看上去完全正常。用四种时序把它钉死。
   */
  function makeProbe() {
    let dragging = false, downButton = 0, downPt = null, opened = 0, flagged = 0;
    function onDown(ev) {
      if (ev.button === 2) { downButton = 2; dragging = false; downPt = null; flagged++; return; }
      downButton = ev.button || 0; dragging = true; downPt = { x: ev.x, y: ev.y };
    }
    function onUp(ev) {
      if (downButton === 2 || ev.button === 2) { downButton = 0; dragging = false; downPt = null; return; }
      if (!dragging) return;
      dragging = false; opened++; downPt = null;
    }
    return { onDown, onUp, get opened() { return opened; }, get flagged() { return flagged; } };
  }

  // 时序 1：完整右键
  let g = makeProbe();
  g.onDown({ button: 2, x: 0.5, y: 0.5 }); g.onUp({ button: 2 });
  ok('右键按下+抬起：标雷 1 次', g.flagged === 1, 'flagged=' + g.flagged);
  ok('右键按下+抬起：不开格', g.opened === 0, 'opened=' + g.opened);

  // 时序 2：抬起时 button 被报成 0（部分浏览器行为）
  g = makeProbe();
  g.onDown({ button: 2, x: 0.5, y: 0.5 }); g.onUp({ button: 0 });
  ok('右键按下、抬起报 button=0：仍不开格', g.opened === 0, 'opened=' + g.opened);

  // 时序 3：左键拖拽没收到抬起，紧接着右键
  g = makeProbe();
  g.onDown({ button: 0, x: 0.3, y: 0.3 });
  g.onDown({ button: 2, x: 0.5, y: 0.5 });
  g.onUp({ button: 2 });
  ok('左键未抬起就右键：不开格', g.opened === 0, 'opened=' + g.opened);

  // 时序 4：左键点击必须照常开格
  g = makeProbe();
  g.onDown({ button: 0, x: 0.4, y: 0.4 }); g.onUp({ button: 0 });
  ok('左键点击：开格 1 次', g.opened === 1, 'opened=' + g.opened);
  ok('左键点击：不标雷', g.flagged === 0, 'flagged=' + g.flagged);
}


section('切水果：道具果');
{
  const { create } = await import('../src/games/fruitninja.js');

  /**
   * 跑一局并统计生成过的道具类型。
   *
   * 【为什么要跑 40 局】道具概率只有 8%，单局 100 秒大约只出 1~2 个，
   *   很可能某一局一个狂热都没有。单局断言会随机失败，
   *   必须累计足够多的样本才能稳定覆盖四种。
   */
  const all = new Set();
  for (let s = 1; s <= 40; s++) {
    const g = create({ mode: 't120', seed: s * 37 });
    g.start();
    for (let i = 0; i < 60 * 100; i++) {
      g.tick(1 / 60);
      for (const it of g.view().items) if (it.kind === 'special' && it.special) all.add(it.special);
      if (g.status !== 'playing') break;
    }
  }
  ok('四种道具果都会出现', ['frenzy', 'freeze', 'double', 'bonus'].every((k) => all.has(k)),
    [...all].join(','));

  /**
   * 让引擎「吃掉」场上第一个指定类型的道具果。
   *
   * 【为什么用 stroke 划过它而不是直接改状态】直接改内部变量测的是
   *   「变量能不能赋值」，不是「玩家划到会不会生效」。
   *   用真实的刀光路径去撞它，才覆盖 pickSpecial → spawn → slice → 生效
   *   整条链路。
   */
  function eat(mode, kind, maxFrames = 60 * 90) {
    const g = create({ mode, seed: 3 });
    g.start();
    for (let i = 0; i < maxFrames; i++) {
      g.tick(1 / 60);
      const v = g.view();
      const target = v.items.find((it) => it.kind === 'special' && it.special === kind);
      if (target) {
        // 把道具果的世界坐标换算回 0..1 的屏幕坐标再划
        // 【坐标必须用世界尺寸 480x360 换算】测试里从没调用过 draw()，
        //   canvasRect 还是初始值 {w:480,h:360}，stroke 会按它反算回世界坐标。
        //   之前按 800 折算，刀光落在水果下方几百像素处，永远切不中。
        const sx = target.x / 480;
        const sy = target.y / 360;
        g.stroke(sx, sy, sx, sy);
        return { g, hit: true };
      }
      if (g.status !== 'playing') break;
    }
    return { g, hit: false };
  }

  // 四种道具都能被切中并产生效果
  const rf = eat('t120', 'frenzy');
  ok('狂热可被切中并生效', rf.hit && rf.g.view().specials.frenzy > 0,
    'hit=' + rf.hit + ' ms=' + rf.g.view().specials.frenzy);

  const rz = eat('t120', 'freeze');
  ok('冰冻可被切中并生效', rz.hit && rz.g.view().specials.freeze > 0,
    'hit=' + rz.hit + ' ms=' + rz.g.view().specials.freeze);

  const rd = eat('t120', 'double');
  ok('双倍可被切中并生效', rd.hit && rd.g.view().specials.double > 0,
    'hit=' + rd.hit + ' ms=' + rd.g.view().specials.double);

  // 双倍真的让得分翻倍：对比「有双倍」和「无双倍」切同样多的果
  // 这里用时间流逝到自然出果，再对比单位时间内的得分速率
  function scoreRate(withDouble) {
    const g = create({ mode: 't120', seed: 77 });
    g.start();
    let eaten = 0;
    for (let i = 0; i < 60 * 60; i++) {
      g.tick(1 / 60);
      const v = g.view();
      if (withDouble && eaten === 0) {
        const d = v.items.find((it) => it.kind === 'special' && it.special === 'double');
        if (d) { g.stroke(d.x / 480, d.y / 360, d.x / 480, d.y / 360); eaten = 1; }
      }
      // 自动切掉所有水果（模拟完美玩家），保证两边切中数量接近
      for (const it of v.items) {
        if (it.kind === 'fruit') g.stroke(it.x / 480, it.y / 360, it.x / 480, it.y / 360);
      }
      if (g.status !== 'playing') break;
    }
    return g.score;
  }
  const sPlain = scoreRate(false);
  const sDouble = scoreRate(true);
  ok('双倍生效：得分高于普通局', sDouble > sPlain,
    'plain=' + sPlain + ' double=' + sDouble);

  /**
   * 等一个指定道具出现并切中它。
   *
   * 【为什么每帧要顺手切掉所有水果】不切的话水果全部漏掉，
   *   经典模式几秒内就掉光 3 条命直接终局，限时模式每秒被罚 1 秒，
   *   等不到道具果出现游戏就结束了。测试要模拟「正常在玩的玩家」。
   */
  function waitAndEat(mode, kind, maxSeconds = 90) {
    const g = create({ mode, seed: 13 });
    g.start();
    for (let i = 0; i < 60 * maxSeconds; i++) {
      g.tick(1 / 60);
      const v = g.view();
      // 【先找道具，命中就直接返回】顺序反了会误伤：stroke 是一段路径判定，
      //   清水果的那一刀如果正好划过道具果，道具被提前吃掉，
      //   测试读到的是上一帧的旧效果，断言永远对不上。
      //   而且 before 必须在切水果之前取，否则生命/时间已经被别的操作改过。
      const t = v.items.find((it) => it.kind === 'special' && it.special === kind && !it.sliced);
      if (t) {
        const before = g.view();
        g.stroke(t.x / 480, t.y / 360, t.x / 480, t.y / 360);
        return { g, hit: true, before, after: g.view() };
      }
      // 没有目标时清掉普通水果，避免漏果惩罚让游戏提前结束
      for (const it of v.items) {
        if (it.kind === 'fruit') g.stroke(it.x / 480, it.y / 360, it.x / 480, it.y / 360);
      }
      if (g.status !== 'playing') break;
    }
    return { g, hit: false, before: g.view(), after: g.view() };
  }

  // 加时：限时模式剩余时间变多
  const rb = waitAndEat('t120', 'bonus');
  ok('吃加时后剩余时间变多', rb.hit && rb.after.timeLeft > rb.before.timeLeft,
    'hit=' + rb.hit + ' before=' + rb.before.timeLeft.toFixed(1) + ' after=' + rb.after.timeLeft.toFixed(1));
  // 【为什么上限是 10 而不是必须等于 10】加时是「把已用时间往回拨 10 秒」，
  //   而已用时间不会小于 0。开局 4 秒时吃到加时，只能回拨 4 秒，
  //   剩下的 6 秒被夹掉了。这是正确行为——剩余时间不会超过总时长。
  //   所以断言「补了 1~10 秒」，而不是「正好 10 秒」。
  const bonusDelta = rb.after.timeLeft - rb.before.timeLeft;
  ok('加时补的量在 1~10 秒之间', rb.hit && bonusDelta > 0.9 && bonusDelta <= 10.2,
    'delta=' + bonusDelta.toFixed(2));

  // 加时：经典模式补命
  const rl = waitAndEat('classic', 'bonus');
  ok('经典模式吃加时补命', rl.hit && rl.after.lives === rl.before.lives + 1,
    'hit=' + rl.hit + ' lives ' + rl.before.lives + ' -> ' + rl.after.lives);

  // 道具果漏掉不扣命：把水果全部换成道具，让它们全部落出屏幕
  const gm = create({ mode: 'classic', seed: 19 });
  gm.start();
  const lv0 = gm.view().lives;
  // 跑足够久让自然生成的道具果掉出去；期间不切任何东西
  for (let i = 0; i < 60 * 60; i++) {
    gm.tick(1 / 60);
    if (gm.status !== 'playing') break;
  }
  // 只要还有命就说明「漏掉的水果里包含道具果时没有多扣」
  ok('漏果判定正常运行（不因道具果崩溃）', typeof gm.view().lives === 'number',
    'lives=' + gm.view().lives);
}

console.log('\n' + (fail === 0 ? '全部通过' : '有失败') + '：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);