/**
 * 观战模式与贪吃蛇多人结算的回归测试。
 *
 * 【为什么单独一个文件】这两件事都是"看起来能跑、实际行为错"的类型：
 *   观战模式如果不计分没生效，排行榜会被 0 分刷屏；
 *   多人局如果玩家死后不结算，玩家会以为游戏卡死。
 *   都必须在无人值守的情况下自动验出来。
 */
import { GAMES, create } from '../src/games/index.js';
import { MODE_KEYS, BASES, totalQuantized } from '../src/core/quantize.js';

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// ---------- 观战模式：注册与不计分 ----------
section('观战模式注册');
const WATCHABLE = ['snake', 'g2048', 'fruitninja', 'watermelon'];
for (const id of WATCHABLE) {
  const g = GAMES.find((x) => x.id === id);
  ok(id + ' 已注册', !!g);
  const w = g && g.modes.find((m) => m.value === 'watch');
  ok(id + ' 有 watch 模式', !!w, g ? g.modes.map((m) => m.value).join(',') : '');
  if (w) {
    ok(id + ' watch 标记了 spectate', w.spectate === true);
    ok(id + ' watch 满分是 0', w.fullMark === 0, String(w.fullMark));
  }
}

section('观战模式不进量化表');
for (const id of WATCHABLE) {
  const keys = MODE_KEYS[id] || [];
  ok(id + ' 的量化表里没有 watch', !keys.includes('watch'), keys.join(','));
  ok(id + ' 的量化表里没有 watch 基准分', !BASES[id + ':watch']);
}

// ---------- 观战局：分数恒为 0 ----------
section('观战局不计分');
for (const id of WATCHABLE) {
  const game = create(id, { mode: 'watch', seed: 42 });
  game.start();
  // 跑一段时间，让 AI 自己玩出点动静
  for (let i = 0; i < 60 * 20; i++) {
    game.tick(1 / 60);
    if (game.status === 'over') break;
  }
  ok(id + ' 标记为观战模式', game.isSpectateMode === true);
  ok(id + ' 分数恒为 0', game.score === 0, String(game.score));
  const st = game.stats;
  ok(id + ' 结果标记 ranked=false', st.ranked === false);
  ok(id + ' 结果分数为 0', st.score === 0, String(st.score));
}

// ---------- 非观战模式不受影响 ----------
section('普通模式不受影响');
const normalModes = { snake: 'classic', g2048: 'classic', fruitninja: 'classic', watermelon: 'classic' };
for (const [id, mode] of Object.entries(normalModes)) {
  const game = create(id, { mode, seed: 42 });
  ok(id + ':' + mode + ' 不是观战', !game.isSpectateMode);
  ok(id + ':' + mode + ' 有 ranked 之外的正常结构', typeof game.stats === 'object');
}

// ---------- 贪吃蛇多人局：玩家死即结算 ----------
section('贪吃蛇多人局：自己死即结算');
for (const mode of ['b2', 'b3', 'b5', 'b8']) {
  let ended = 0;
  const game = create('snake', { mode, seed: 7, onEnd: () => { ended++; } });
  game.start();
  // 一直朝右撞墙，玩家必死
  let died = false;
  for (let i = 0; i < 60 * 120; i++) {
    if (i % 6 === 0) game.key('right');
    game.tick(1 / 60);
    if (game.status === 'over') { died = true; break; }
  }
  ok(mode + ' 玩家死后本局结束', died);
  ok(mode + ' onEnd 恰好触发一次', ended === 1, String(ended));
  const st = game.stats;
  ok(mode + ' 结果有排名', typeof st.extra?.rank === 'number', JSON.stringify(st.extra));
  ok(mode + ' 结果标记为未获胜', st.won === false);
}

section('贪吃蛇多人局：继续观战');
{
  const game = create('snake', { mode: 'b4', seed: 9 });
  game.start();
  for (let i = 0; i < 60 * 120; i++) {
    if (i % 6 === 0) game.key('right');
    game.tick(1 / 60);
    if (game.status === 'over') break;
  }
  ok('玩家已死、游戏已结束', game.status === 'over');
  const okSpectate = game.startSpectate();
  const aliveLeft = game.mods.alive;
  ok('还有活着的 AI 时能继续观战', aliveLeft > 0 ? okSpectate === true : okSpectate === false);
  if (okSpectate) {
    ok('继续观战后回到 playing', game.status === 'playing');
    // 再跑一会，确认真的在推进
    const before = game.elapsedMs;
    for (let i = 0; i < 60; i++) game.tick(1 / 60);
    ok('继续观战后时间在走', game.elapsedMs > before);
  }
}

// ---------- 贪吃蛇纯观战：加 NPC 与地图扩容 ----------
section('贪吃蛇纯观战：批量加 NPC');
{
  const game = create('snake', { mode: 'watch', seed: 3 });
  game.start();
  ok('开局是观战模式', game.isSpectateMode === true);
  const before = game.mods.players;
  const added = game.addNpcs(5);
  ok('一次加了 5 条', added === 5, String(added));
  ok('总条数增加了 5', game.mods.players === before + 5, before + ' -> ' + game.mods.players);
  // 地图要跟着峰值放大：读 battle 的 cols
  const side1 = game.battle.cols;
  ok('地图边长已按峰值放大', side1 >= 19, String(side1));
  game.addNpcs(20);
  const side2 = game.battle.cols;
  ok('继续加人地图继续放大', side2 >= side1, side1 + ' -> ' + side2);
  ok('观战局分数仍为 0', game.score === 0, String(game.score));
}

section('观战模式不影响总分累加');
{
  // 只填观战模式不该产生任何分数
  const t = totalQuantized({ 'sn.watch': 99999, 'g2.watch': 99999, 'wm.watch': 99999, 'fj.watch': 99999 });
  ok('全填观战模式总分仍为 0', t.total === 0, String(t.total));
}

console.log('\n' + '='.repeat(50));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail > 0) process.exit(1);
