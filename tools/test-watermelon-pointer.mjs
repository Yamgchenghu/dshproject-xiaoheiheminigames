/**
 * 合成大西瓜指针坐标换算测试。
 *
 * 【为什么要单独测这个】用户报过「手机点了没反应」，根因是坐标约定不一致：
 *   game-screen 的 toLogical 返回 0..1 归一化值，
 *   而 watermelon.pointer 期待的是画布 CSS 像素（它内部用 viewK/viewOx 反算），
 *   传 0..1 进去会被减成负数，clamp 后永远落在最左边。
 *   这种 bug 在真机上表现为「完全点不动」，但代码看每一行都没错，
 *   所以必须把约定钉成断言。
 */
import { create } from '../src/games/index.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

section('pointer 接受画布 CSS 像素');
const g = create('watermelon', { mode: 'classic' });
g.start();
// 模拟 draw 时的变换：逻辑 360x520 等比缩放居中
// 画布 390x790 → k = min(390/360, 790/520) = min(1.083, 1.519) = 1.083
// ox = (390 - 360*1.083)/2 = 0, oy = (790 - 520*1.083)/2 = 113
g.draw({ save(){}, restore(){}, translate(){}, scale(){}, fillRect(){}, fillStyle:'', beginPath(){}, arc(){}, fill(){}, stroke(){}, moveTo(){}, lineTo(){}, strokeStyle:'', lineWidth:0, globalAlpha:1, setLineDash(){}, closePath(){}, createLinearGradient(){return {addColorStop(){}};}, ellipse(){}, rect(){}, clip(){}, rotate(){}, font:'', fillText(){}, measureText(){return {width:0};}, textAlign:'', textBaseline:'' }, 390, 790);

const aimAt = (cssX) => { g.pointer(cssX, 400, true); return g.mods.aim.x; };

// 画布中心 195px → 逻辑中心 180
ok('画布中心映射到逻辑中心', Math.abs(aimAt(195) - 180) < 2, String(aimAt(195)));
// 左边 10% → 逻辑约 36
ok('左侧 10% 映射正确', Math.abs(aimAt(39) - 36) < 3, String(aimAt(39)));
// 右边 90% → 逻辑约 324
ok('右侧 90% 映射正确', Math.abs(aimAt(351) - 324) < 3, String(aimAt(351)));

section('传 0..1 归一化值会坏掉（回归防护）');
// 这是修复前的错误用法，必须保证它不会静默地「看起来能用」
const wrong = (() => { const g2 = create('watermelon', { mode: 'classic' }); g2.start();
  g2.draw({ save(){}, restore(){}, translate(){}, scale(){}, fillRect(){}, fillStyle:'', beginPath(){}, arc(){}, fill(){}, stroke(){}, moveTo(){}, lineTo(){}, strokeStyle:'', lineWidth:0, globalAlpha:1, setLineDash(){}, closePath(){}, createLinearGradient(){return {addColorStop(){}};}, ellipse(){}, rect(){}, clip(){}, rotate(){}, font:'', fillText(){}, measureText(){return {width:0};}, textAlign:'', textBaseline:'' }, 390, 790);
  g2.pointer(0.9, 0.5, true); return g2.mods.aim.x; })();
ok('传 0.9 会落到最左边（说明必须传像素）', wrong < 5, 'aim=' + wrong.toFixed(1));

section('落果与计分');
const g3 = create('watermelon', { mode: 'classic' });
g3.start();
const fakeCtx = { save(){}, restore(){}, translate(){}, scale(){}, fillRect(){}, fillStyle:'', beginPath(){}, arc(){}, fill(){}, stroke(){}, moveTo(){}, lineTo(){}, strokeStyle:'', lineWidth:0, globalAlpha:1, setLineDash(){}, closePath(){}, createLinearGradient(){return {addColorStop(){}};}, ellipse(){}, rect(){}, clip(){}, rotate(){}, font:'', fillText(){}, measureText(){return {width:0};}, textAlign:'', textBaseline:'' };
g3.draw(fakeCtx, 390, 790);
// 抬起（isDown=false）才落果
// 抬起（isDown=false）才落果。
// 【为什么要固定 seed 和落点】这一条原来用 10 个不同横坐标 + 随机 tier，
//   只有恰好落到相邻且同级的两个球才会合并出分，实测 20 次里有 2 次是 0 分。
//   那是测试自己在赌运气，不是游戏坏了。固定种子 + 同一个落点之后，
//   落果序列是确定的，第 3 颗必然和第 2 颗同级合并——score 稳定在 110。
//   注意种子不能随便挑：12345 的序列在前 12 颗里一次都没重样，会是 0 分。
const g4 = create('watermelon', { mode: 'classic', seed: 1 });
g4.start();
g4.draw(fakeCtx, 390, 790);
for (let i = 0; i < 6; i++) {
  g4.pointer(195, 400, true);
  g4.pointer(195, 400, false);
  for (let k = 0; k < 40; k++) g4.tick(1 / 60);
}
ok('连续落果能产生分数', g4.score > 0, 'score=' + g4.score);

console.log('\n' + '='.repeat(50));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail > 0) process.exit(1);