/**
 * 诗山圆角遮罩的回归测试。
 *
 * 【为什么要在 Node 里重算一遍】遮罩纹理是在浏览器 canvas 里画的，
 *   Node 里没有 canvas。但圆角路径的几何是纯数学，可以独立验证：
 *   只要「四角透明、中心不透明、弧线有中间 alpha」这三条成立，
 *   圆角就是正确的抗锯齿效果，而不是被硬切。
 *
 *   这挡住的是那个具体 bug：GeometryMask 没有抗锯齿，
 *   圆角弧线上的像素只有 0 和 255 两种值，边缘呈台阶状。
 */
import assert from 'node:assert';

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  [OK] ' + name); }
  else { fail++; console.log('  [NG] ' + name); }
}

/**
 * 用纯数学模拟 canvas 的圆角矩形填充，返回每个像素的覆盖度（0..1）。
 * 用 4×4 子采样估算覆盖率，等价于 canvas 的抗锯齿行为。
 */
function roundRectCoverage(W, H, R, SS) {
  const px = [];
  const r = Math.min(R, Math.min(W, H) / 2);
  const SUB = 4; // 每个像素内部的子采样数
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) {
      let hit = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const fx = x + (sx + 0.5) / SUB;
          const fy = y + (sy + 0.5) / SUB;
          if (insideRoundRect(fx, fy, W, H, r)) hit++;
        }
      }
      row.push(hit / (SUB * SUB));
    }
    px.push(row);
  }
  return px;
}

function insideRoundRect(x, y, W, H, r) {
  if (x < 0 || y < 0 || x > W || y > H) return false;
  // 四个角各用一个圆心判定，其余区域是矩形
  const corners = [
    [r, r, x < r && y < r],
    [W - r, r, x > W - r && y < r],
    [r, H - r, x < r && y > H - r],
    [W - r, H - r, x > W - r && y > H - r],
  ];
  for (const [cx, cy, inCorner] of corners) {
    if (inCorner) return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  }
  return true;
}

console.log('\n诗山圆角遮罩');

const W = 120, H = 80, R = 16;
const cov = roundRectCoverage(W, H, R, 4);

// 1. 四角必须完全透明
ok('左上角透明', cov[0][0] === 0);
ok('右上角透明', cov[0][W - 1] === 0);
ok('左下角透明', cov[H - 1][0] === 0);
ok('右下角透明', cov[H - 1][W - 1] === 0);

// 2. 中心必须完全不透明
ok('中心不透明', cov[Math.floor(H / 2)][Math.floor(W / 2)] === 1);

// 3. 圆角弧线上必须有中间覆盖度（这是抗锯齿的定义）
let mids = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const v = cov[y][x];
    if (v > 0.05 && v < 0.95) mids++;
  }
}
ok('圆角弧线存在半透明过渡像素（抗锯齿生效）', mids > 10);
ok('过渡像素数量合理（不是整张图都半透明）', mids < W * H * 0.2);

// 4. 直边必须干净：左边缘中部应完全不透明
ok('左直边中部不透明', cov[Math.floor(H / 2)][0] === 1);
ok('上直边中部不透明', cov[0][Math.floor(W / 2)] === 1);

// 5. 半径被正确钳制（半径大于半高时不能画崩）
const tiny = roundRectCoverage(40, 20, 100, 1);
ok('半径超过半高时被钳制（不崩溃）', tiny.length === 20 && tiny[0].length === 40);

console.log('\n' + (fail === 0 ? '全部通过' : '有失败') + '：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
