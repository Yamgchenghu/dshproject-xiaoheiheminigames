/**
 * 程序化生成绘本纹理。
 * 骨架阶段不依赖任何外部图片，所有角色、石碑、树木都用 Canvas 画出来；
 *
 * 换图机制：PreloadScene 会按 src/data/sceneArtManifest.json 预加载
 * public/assets/images/scene/<key>.png，纹理 key 与下面的程序化纹理同名。
 * createCanvasTexture 发现同名纹理已经存在就跳过绘制，于是「有图用图、没图用画」，
 * 玩法代码（碰撞体 / 原点 / 尺寸）完全不用改。
 * 施工单见 docs/art-scene-rebuild/README.md。
 */

// 石碑、朱印上的字是画进 canvas 纹理的，字体必须和界面文字一致，
// 否则同一屏里会出现两种字体（界面是楷体、纹理里是黑体），很出戏。
import { FONT_FAMILY } from '../config/theme.js';

/** 只在纹理不存在时创建，避免热更新或图片覆盖时重复生成 */
function createCanvasTexture(scene, key, width, height, draw) {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, width, height);
  if (!texture) return;
  const ctx = texture.getContext();
  ctx.clearRect(0, 0, width, height);
  draw(ctx, width, height);
  texture.refresh();
}

/** 兼容性圆角矩形路径 */
function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const OUTLINE = '#4b473e';

function drawPoemBoy(ctx, width, height, frame = 0) {
  const cx = width / 2;
  const baseY = height - 10;
  const step = frame === 1 ? 3 : frame === 2 ? -3 : 0;
  const bob = frame === 2 ? -1 : 0;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.4;

  // 小布鞋
  ctx.fillStyle = '#6f5a43';
  roundRect(ctx, cx - 17 + step, baseY - 10, 15, 10, 4);
  ctx.fill();
  ctx.stroke();
  roundRect(ctx, cx + 2 - step, baseY - 10, 15, 10, 4);
  ctx.fill();
  ctx.stroke();

  // 袍身
  ctx.beginPath();
  ctx.moveTo(cx - 17, 60 + bob);
  ctx.quadraticCurveTo(cx - 27, 82 + bob, cx - 25, baseY - 12);
  ctx.quadraticCurveTo(cx, baseY - 5, cx + 25, baseY - 12);
  ctx.quadraticCurveTo(cx + 27, 82 + bob, cx + 17, 60 + bob);
  ctx.closePath();
  ctx.fillStyle = '#92b4a2';
  ctx.fill();
  ctx.stroke();

  // 衣襟与下摆
  ctx.beginPath();
  ctx.moveTo(cx - 18, 60 + bob);
  ctx.quadraticCurveTo(cx, 80 + bob, cx + 18, 60 + bob);
  ctx.lineTo(cx + 7, 66 + bob);
  ctx.quadraticCurveTo(cx, 74 + bob, cx - 7, 66 + bob);
  ctx.closePath();
  ctx.fillStyle = '#f5ecda';
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - 25, baseY - 14);
  ctx.quadraticCurveTo(cx, baseY - 7, cx + 25, baseY - 14);
  ctx.strokeStyle = '#e9dcc2';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.4;

  // 金色腰带
  ctx.fillStyle = '#c8a45e';
  roundRect(ctx, cx - 20, 82 + bob, 40, 8, 4);
  ctx.fill();
  ctx.stroke();

  // 袖子
  ctx.fillStyle = '#a4c4b2';
  ctx.beginPath();
  ctx.ellipse(cx - 23, 72 + bob, 10, 15, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx + 23, 72 + bob, 10, 15, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 手
  ctx.fillStyle = '#f6d7b9';
  ctx.beginPath();
  ctx.arc(cx - 17, 82 + bob, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + 17, 82 + bob, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 手持小诗卷
  ctx.save();
  ctx.translate(cx, 77 + bob);
  ctx.rotate(-0.12);
  ctx.fillStyle = '#f8eed9';
  roundRect(ctx, -14, -9, 28, 18, 4);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#c9a45c';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-9, -4);
  ctx.lineTo(7, -4);
  ctx.moveTo(-9, 1);
  ctx.lineTo(9, 1);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.4;

  // 头
  ctx.fillStyle = '#f8ddc4';
  ctx.beginPath();
  ctx.arc(cx, 38 + bob, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 头发
  ctx.fillStyle = '#3e3a34';
  ctx.beginPath();
  ctx.arc(cx, 35 + bob, 20.5, Math.PI * 1.02, Math.PI * 1.98);
  ctx.quadraticCurveTo(cx + 20, 26 + bob, cx + 16, 36 + bob);
  ctx.quadraticCurveTo(cx, 29 + bob, cx - 16, 36 + bob);
  ctx.quadraticCurveTo(cx - 20, 26 + bob, cx - 20.5, 35 + bob);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 发髻与红丝带
  ctx.fillStyle = '#3e3a34';
  ctx.beginPath();
  ctx.arc(cx, 13 + bob, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#cf7d72';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 7, 13 + bob);
  ctx.quadraticCurveTo(cx - 2, 9 + bob, cx + 6, 11 + bob);
  ctx.stroke();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.4;

  // 五官
  ctx.fillStyle = '#3b3530';
  ctx.beginPath();
  ctx.arc(cx - 7, 41 + bob, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 7, 41 + bob, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7e554c';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, 45 + bob, 5, 0.4, Math.PI - 0.4);
  ctx.stroke();

  // 腮红
  ctx.fillStyle = 'rgba(233, 157, 143, 0.55)';
  ctx.beginPath();
  ctx.ellipse(cx - 13, 46 + bob, 4.5, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + 13, 46 + bob, 4.5, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawCowherd(ctx, width, height) {
  const cx = width / 2;
  const baseY = height - 10;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.4;

  // 脚
  ctx.fillStyle = '#6f5a43';
  roundRect(ctx, cx - 15, baseY - 10, 14, 10, 4);
  ctx.fill();
  ctx.stroke();
  roundRect(ctx, cx + 1, baseY - 10, 14, 10, 4);
  ctx.fill();
  ctx.stroke();

  // 短袍
  ctx.beginPath();
  ctx.moveTo(cx - 16, 62);
  ctx.quadraticCurveTo(cx - 24, 86, cx - 21, baseY - 12);
  ctx.quadraticCurveTo(cx, baseY - 6, cx + 21, baseY - 12);
  ctx.quadraticCurveTo(cx + 24, 86, cx + 16, 62);
  ctx.closePath();
  ctx.fillStyle = '#a9b98b';
  ctx.fill();
  ctx.stroke();

  // 腰带
  ctx.fillStyle = '#8d6c4e';
  roundRect(ctx, cx - 18, 86, 36, 7, 3);
  ctx.fill();
  ctx.stroke();

  // 手臂
  ctx.fillStyle = '#b9c89e';
  ctx.beginPath();
  ctx.ellipse(cx - 21, 76, 8, 14, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx + 21, 76, 8, 14, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 竹笛
  ctx.save();
  ctx.translate(cx, 80);
  ctx.rotate(-0.5);
  ctx.strokeStyle = '#7c6845';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-28, 0);
  ctx.lineTo(28, 0);
  ctx.stroke();
  ctx.strokeStyle = '#4b473e';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-10, -2.5);
  ctx.lineTo(-10, 2.5);
  ctx.moveTo(0, -2.5);
  ctx.lineTo(0, 2.5);
  ctx.moveTo(10, -2.5);
  ctx.lineTo(10, 2.5);
  ctx.stroke();
  ctx.restore();

  // 手
  ctx.fillStyle = '#f3d3b3';
  ctx.beginPath();
  ctx.arc(cx - 13, 78, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + 12, 84, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 头
  ctx.fillStyle = '#f7d9bb';
  ctx.beginPath();
  ctx.arc(cx, 42, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 斗笠
  ctx.fillStyle = '#e2c589';
  ctx.beginPath();
  ctx.ellipse(cx, 28, 28, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 18, 27);
  ctx.quadraticCurveTo(cx, 2, cx + 18, 27);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#b9975a';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - 13, 21);
  ctx.quadraticCurveTo(cx, 12, cx + 13, 21);
  ctx.stroke();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.4;

  // 五官
  ctx.fillStyle = '#3b3530';
  ctx.beginPath();
  ctx.arc(cx - 6, 44, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 6, 44, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7e554c';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, 48, 4.5, 0.4, Math.PI - 0.4);
  ctx.stroke();

  // 腮红
  ctx.fillStyle = 'rgba(233, 157, 143, 0.5)';
  ctx.beginPath();
  ctx.ellipse(cx - 12, 49, 4, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + 12, 49, 4, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawStele(ctx, width, height, hidden = false) {
  const cx = width / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 底座
  ctx.fillStyle = 'rgba(86, 75, 55, 0.16)';
  ctx.beginPath();
  ctx.ellipse(cx, height - 12, 42, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b8ad95';
  roundRect(ctx, cx - 42, height - 24, 84, 16, 7);
  ctx.fill();
  ctx.strokeStyle = '#7c7364';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 石碑主体
  ctx.fillStyle = hidden ? '#b8b9a4' : '#d2cab6';
  ctx.strokeStyle = '#7c7364';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx - 35, height - 26);
  ctx.lineTo(cx - 35, 34);
  ctx.quadraticCurveTo(cx - 35, 16, cx, 16);
  ctx.quadraticCurveTo(cx + 35, 16, cx + 35, 34);
  ctx.lineTo(cx + 35, height - 26);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 石碑内框
  ctx.strokeStyle = 'rgba(124, 115, 100, 0.5)';
  ctx.lineWidth = 1.4;
  roundRect(ctx, cx - 28, 30, 56, height - 63, 8);
  ctx.stroke();

  // 苔藓
  ctx.fillStyle = hidden ? 'rgba(126, 155, 116, 0.7)' : 'rgba(143, 169, 127, 0.45)';
  ctx.beginPath();
  ctx.ellipse(cx - 26, 100, 13, 8, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx + 25, height - 36, 11, 7, 0.4, 0, Math.PI * 2);
  ctx.fill();

  if (hidden) {
    // 隐藏石碑：只有隐约的云纹与问号
    ctx.strokeStyle = 'rgba(84, 95, 77, 0.55)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(cx, 76, 8, Math.PI * 0.15, Math.PI * 1.25);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, 84);
    ctx.lineTo(cx, 87);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, 94, 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 画轴纸面
    ctx.fillStyle = '#f7eedb';
    roundRect(ctx, cx - 22, 42, 44, height - 88, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(124, 115, 100, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // 画轴两端
    ctx.fillStyle = '#b48b5e';
    roundRect(ctx, cx - 26, 38, 52, 6, 3);
    ctx.fill();
    roundRect(ctx, cx - 26, height - 48, 52, 6, 3);
    ctx.fill();

    // 淡淡的山水画
    ctx.strokeStyle = 'rgba(93, 112, 96, 0.65)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - 16, 100);
    ctx.quadraticCurveTo(cx - 8, 82, cx, 96);
    ctx.quadraticCurveTo(cx + 9, 78, cx + 16, 100);
    ctx.stroke();
    ctx.fillStyle = 'rgba(201, 164, 92, 0.7)';
    ctx.beginPath();
    ctx.arc(cx + 10, 64, 4, 0, Math.PI * 2);
    ctx.fill();

    // 朱红小印
    ctx.fillStyle = 'rgba(190, 104, 92, 0.85)';
    roundRect(ctx, cx + 8, height - 64, 9, 9, 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawSignpost(ctx, width, height) {
  const cx = width / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.4;

  // 落地阴影
  ctx.fillStyle = 'rgba(86, 75, 55, 0.16)';
  ctx.beginPath();
  ctx.ellipse(cx, height - 10, 32, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // 木柱（带木纹）
  ctx.fillStyle = '#b79a72';
  roundRect(ctx, cx - 7, 36, 14, height - 48, 5);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(124, 105, 73, 0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 2, 52);
  ctx.lineTo(cx - 2, height - 20);
  ctx.stroke();

  // 木牌
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.4;
  ctx.fillStyle = '#ead7b3';
  roundRect(ctx, cx - 37, 46, 74, 42, 8);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(124, 105, 73, 0.5)';
  ctx.lineWidth = 1.2;
  roundRect(ctx, cx - 31, 52, 62, 30, 5);
  ctx.stroke();

  // 指向箭头
  ctx.strokeStyle = '#7c6949';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx - 16, 67);
  ctx.lineTo(cx + 14, 67);
  ctx.moveTo(cx + 7, 60);
  ctx.lineTo(cx + 15, 67);
  ctx.lineTo(cx + 7, 74);
  ctx.stroke();

  // 牌顶小飘带 + 挂穗，让路牌更醒目
  ctx.strokeStyle = '#cf7d72';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx + 26, 88);
  ctx.lineTo(cx + 26, 103);
  ctx.stroke();
  ctx.fillStyle = 'rgba(224, 132, 120, 0.9)';
  ctx.beginPath();
  ctx.moveTo(cx - 34, 44);
  ctx.quadraticCurveTo(cx - 26, 30, cx - 14, 42);
  ctx.quadraticCurveTo(cx - 24, 44, cx - 34, 44);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * 节气 / 节日限时诗碑：
 * 在普通诗碑基础上加红绸、灯笼与「节」字牌，远远就能认出来。
 */
function drawFestivalStele(ctx, width, height) {
  const cx = width / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 光晕
  ctx.fillStyle = 'rgba(201, 164, 92, 0.16)';
  ctx.beginPath();
  ctx.ellipse(cx, height - 30, 58, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  // 底座
  ctx.fillStyle = 'rgba(86, 75, 55, 0.18)';
  ctx.beginPath();
  ctx.ellipse(cx, height - 12, 46, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c0b49a';
  roundRect(ctx, cx - 46, height - 26, 92, 17, 7);
  ctx.fill();
  ctx.strokeStyle = '#7c7364';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 碑身
  ctx.fillStyle = '#e0d6bf';
  ctx.strokeStyle = '#7c7364';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx - 36, height - 28);
  ctx.lineTo(cx - 36, 36);
  ctx.quadraticCurveTo(cx - 36, 16, cx, 16);
  ctx.quadraticCurveTo(cx + 36, 16, cx + 36, 36);
  ctx.lineTo(cx + 36, height - 28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 内框
  ctx.strokeStyle = 'rgba(124, 115, 100, 0.45)';
  ctx.lineWidth = 1.4;
  roundRect(ctx, cx - 28, 32, 56, height - 70, 8);
  ctx.stroke();

  // 红绸斜披
  ctx.fillStyle = 'rgba(196, 96, 84, 0.78)';
  ctx.beginPath();
  ctx.moveTo(cx - 38, 44);
  ctx.quadraticCurveTo(cx - 6, 62, cx + 38, 40);
  ctx.lineTo(cx + 38, 52);
  ctx.quadraticCurveTo(cx - 6, 74, cx - 38, 56);
  ctx.closePath();
  ctx.fill();

  // 灯笼
  const lanternY = 52;
  ctx.strokeStyle = '#7c6845';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx + 44, 20);
  ctx.lineTo(cx + 44, lanternY - 14);
  ctx.stroke();
  ctx.fillStyle = '#d97a6c';
  ctx.beginPath();
  ctx.ellipse(cx + 44, lanternY, 12, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#a85a4e';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 233, 214, 0.7)';
  ctx.beginPath();
  ctx.moveTo(cx + 44, lanternY - 13);
  ctx.lineTo(cx + 44, lanternY + 13);
  ctx.stroke();
  ctx.fillStyle = '#e9c47c';
  roundRect(ctx, cx + 40, lanternY - 17, 8, 4, 2);
  ctx.fill();
  roundRect(ctx, cx + 40, lanternY + 13, 8, 4, 2);
  ctx.fill();
  ctx.strokeStyle = '#d9b06a';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx + 44, lanternY + 17);
  ctx.lineTo(cx + 44, lanternY + 25);
  ctx.stroke();

  // 「节」字小牌
  ctx.fillStyle = '#f8efd9';
  roundRect(ctx, cx - 21, 82, 42, 46, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(124, 115, 100, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.fillStyle = '#b0503f';
  ctx.font = `bold 30px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('节', cx, 106);

  // 碑脚小花
  ctx.fillStyle = 'rgba(201, 164, 92, 0.6)';
  ctx.beginPath();
  ctx.arc(cx - 30, height - 40, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 30, height - 44, 3.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawTreeRound(ctx, width, height, variant = 0) {
  const cx = width / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#6f825f';
  ctx.lineWidth = 2.4;

  // 影子
  ctx.fillStyle = 'rgba(76, 91, 65, 0.12)';
  ctx.beginPath();
  ctx.ellipse(cx, height - 12, 78, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  // 树干
  ctx.fillStyle = '#9a7c5d';
  ctx.beginPath();
  ctx.moveTo(cx - 12, height - 18);
  ctx.quadraticCurveTo(cx - 6, height - 90, cx - 3, height - 150);
  ctx.lineTo(cx + 7, height - 150);
  ctx.quadraticCurveTo(cx + 10, height - 90, cx + 15, height - 18);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#7a634e';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 树冠层次
  const canopies = [
    { x: cx - 60, y: 120, rx: 75, ry: 58, color: '#bdd6ad' },
    { x: cx + 64, y: 118, rx: 76, ry: 60, color: '#b3cfa5' },
    { x: cx, y: 82, rx: 90, ry: 66, color: '#c8ddb8' },
    { x: cx - 26, y: 154, rx: 72, ry: 54, color: '#abc99d' },
    { x: cx + 40, y: 158, rx: 64, ry: 48, color: '#b9d3aa' },
  ];
  canopies.forEach((canopy) => {
    ctx.fillStyle = canopy.color;
    ctx.beginPath();
    ctx.ellipse(canopy.x, canopy.y, canopy.rx, canopy.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(105, 132, 92, 0.55)';
    ctx.lineWidth = 1.8;
    ctx.stroke();
  });

  // 高光与小花
  ctx.fillStyle = 'rgba(232, 242, 210, 0.55)';
  ctx.beginPath();
  ctx.ellipse(cx - 28, 62, 42, 22, -0.3, 0, Math.PI * 2);
  ctx.fill();
  if (variant === 1) {
    ctx.fillStyle = 'rgba(243, 198, 189, 0.85)';
    for (let i = 0; i < 12; i += 1) {
      const px = cx - 80 + ((i * 37) % 160);
      const py = 90 + ((i * 53) % 100);
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawTreePine(ctx, width, height) {
  const cx = width / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.fillStyle = 'rgba(76, 91, 65, 0.12)';
  ctx.beginPath();
  ctx.ellipse(cx, height - 12, 66, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  // 树干
  ctx.fillStyle = '#8a6d52';
  roundRect(ctx, cx - 11, height - 130, 22, 118, 6);
  ctx.fill();
  ctx.strokeStyle = '#6f5742';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 三层松冠
  const layers = [
    { y: 70, w: 92, h: 74, color: '#7fa08e' },
    { y: 122, w: 122, h: 86, color: '#8fae9a' },
    { y: 178, w: 152, h: 98, color: '#9dbba4' },
  ];
  layers.forEach((layer) => {
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(cx, layer.y - layer.h);
    ctx.quadraticCurveTo(cx + layer.w * 0.2, layer.y - layer.h * 0.3, cx + layer.w / 2, layer.y);
    ctx.quadraticCurveTo(cx, layer.y + 10, cx - layer.w / 2, layer.y);
    ctx.quadraticCurveTo(cx - layer.w * 0.2, layer.y - layer.h * 0.3, cx, layer.y - layer.h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(84, 112, 93, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // 针叶细节
  ctx.strokeStyle = 'rgba(79, 111, 87, 0.45)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 9; i += 1) {
    const y = 92 + i * 13;
    const half = 22 + i * 6;
    ctx.beginPath();
    ctx.moveTo(cx - half, y);
    ctx.quadraticCurveTo(cx, y - 8, cx + half, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRock(ctx, width, height) {
  const cx = width / 2;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#7f7767';
  ctx.lineWidth = 2.2;

  ctx.fillStyle = 'rgba(86, 75, 55, 0.14)';
  ctx.beginPath();
  ctx.ellipse(cx, height - 9, 48, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#c8c1af';
  ctx.beginPath();
  ctx.moveTo(cx - 48, height - 12);
  ctx.quadraticCurveTo(cx - 46, height - 62, cx - 20, height - 72);
  ctx.quadraticCurveTo(cx + 8, height - 88, cx + 30, height - 62);
  ctx.quadraticCurveTo(cx + 52, height - 40, cx + 44, height - 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = 'rgba(127, 119, 103, 0.5)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - 20, height - 66);
  ctx.quadraticCurveTo(cx - 2, height - 50, cx + 12, height - 62);
  ctx.moveTo(cx - 30, height - 38);
  ctx.quadraticCurveTo(cx - 10, height - 30, cx + 16, height - 40);
  ctx.stroke();

  ctx.fillStyle = 'rgba(143, 169, 127, 0.55)';
  ctx.beginPath();
  ctx.ellipse(cx - 24, height - 48, 14, 8, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawReed(ctx, width, height) {
  const cx = width / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#7f9469';
  ctx.lineWidth = 2.2;
  for (let i = 0; i < 5; i += 1) {
    const offset = (i - 2) * 9;
    const topX = cx + offset + (i % 2 ? 8 : -6);
    ctx.beginPath();
    ctx.moveTo(cx + offset, height - 6);
    ctx.quadraticCurveTo(cx + offset + 2, height - 66, topX, 30 + (i % 3) * 12);
    ctx.stroke();
    ctx.fillStyle = i % 2 ? '#c7a779' : '#b69568';
    ctx.beginPath();
    ctx.ellipse(topX, 28 + (i % 3) * 12, 3.5, 10, -0.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPetal(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, 'rgba(251, 220, 214, 0.95)');
  gradient.addColorStop(1, 'rgba(240, 178, 168, 0.9)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(width / 2, 1);
  ctx.bezierCurveTo(width - 1, height * 0.28, width * 0.72, height - 1, width / 2, height - 2);
  ctx.bezierCurveTo(width * 0.28, height - 1, 1, height * 0.28, width / 2, 1);
  ctx.fill();
  ctx.strokeStyle = 'rgba(203, 138, 130, 0.35)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function drawPavilion(ctx, width, height) {
  const cx = width / 2;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#5f6151';
  ctx.lineWidth = 2.6;

  // 影子
  ctx.fillStyle = 'rgba(79, 82, 64, 0.13)';
  ctx.beginPath();
  ctx.ellipse(cx, height - 16, 124, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  // 台基
  ctx.fillStyle = '#ddd3bd';
  roundRect(ctx, cx - 108, height - 58, 216, 40, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e9dfca';
  roundRect(ctx, cx - 92, height - 74, 184, 20, 4);
  ctx.fill();
  ctx.stroke();

  // 柱子
  ctx.fillStyle = '#a97f66';
  [-74, -25, 25, 74].forEach((offset) => {
    roundRect(ctx, cx + offset - 5, 122, 10, height - 186, 4);
    ctx.fill();
    ctx.stroke();
  });

  // 栏杆
  ctx.strokeStyle = 'rgba(111, 89, 67, 0.7)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 88, height - 82);
  ctx.lineTo(cx + 88, height - 82);
  ctx.stroke();

  // 屋顶
  ctx.fillStyle = '#7a9a87';
  ctx.beginPath();
  ctx.moveTo(cx - 128, 120);
  ctx.quadraticCurveTo(cx - 90, 78, cx - 12, 64);
  ctx.quadraticCurveTo(cx, 52, cx + 12, 64);
  ctx.quadraticCurveTo(cx + 90, 78, cx + 128, 120);
  ctx.quadraticCurveTo(cx + 70, 136, cx, 130);
  ctx.quadraticCurveTo(cx - 70, 136, cx - 128, 120);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 屋脊与翘角
  ctx.strokeStyle = '#5c7565';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 128, 120);
  ctx.quadraticCurveTo(cx - 142, 112, cx - 150, 104);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 128, 120);
  ctx.quadraticCurveTo(cx + 142, 112, cx + 150, 104);
  ctx.stroke();
  ctx.fillStyle = '#c9a45c';
  ctx.beginPath();
  ctx.arc(cx, 55, 5, 0, Math.PI * 2);
  ctx.fill();

  // 屋顶纹理
  ctx.strokeStyle = 'rgba(226, 237, 222, 0.5)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 5; i += 1) {
    ctx.beginPath();
    ctx.moveTo(cx - 110 + i * 12, 121 - i * 5);
    ctx.quadraticCurveTo(cx, 138 - i * 9, cx + 110 - i * 12, 121 - i * 5);
    ctx.stroke();
  }

  // 内部墙面与匾额
  ctx.fillStyle = 'rgba(249, 240, 220, 0.78)';
  roundRect(ctx, cx - 48, 126, 96, 58, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(95, 97, 81, 0.5)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = '#8d6c4e';
  roundRect(ctx, cx - 27, 107, 54, 18, 4);
  ctx.fill();
  ctx.strokeStyle = '#5f6151';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.restore();
}

/**
 * 逸闻碎片：两张错开的旧宣纸小片 + 淡墨痕 + 朱印「闻」。
 * 64×64 单独成纹理，便于整张替换成画师稿；找不到图时仍用这段程序化绘制。
 */
function drawFragment(ctx, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 后面一张略向右下错开的旧纸
  ctx.fillStyle = '#efe4d0';
  roundRect(ctx, cx - 22, cy - 24, 44, 52, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(124, 115, 100, 0.7)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 前面一张浅米纸
  ctx.fillStyle = '#4b4130';
  ctx.globalAlpha = 0.08;
  roundRect(ctx, cx - 22, cy - 26, 44, 52, 7);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fdf9f0';
  roundRect(ctx, cx - 24, cy - 28, 44, 52, 7);
  ctx.fill();
  ctx.strokeStyle = 'rgba(201, 164, 92, 0.62)';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // 没写完的两道墨痕
  ctx.strokeStyle = 'rgba(185, 172, 149, 0.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy - 12);
  ctx.lineTo(cx + 12, cy - 12);
  ctx.moveTo(cx - 14, cy - 2);
  ctx.lineTo(cx + 6, cy - 2);
  ctx.stroke();

  // 朱印「闻」
  ctx.fillStyle = 'rgba(201, 123, 110, 0.86)';
  roundRect(ctx, cx + 2, cy + 4, 16, 16, 4);
  ctx.fill();
  ctx.fillStyle = '#fff8ef';
  ctx.font = `bold 11px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('闻', cx + 10, cy + 12);

  ctx.restore();
}

/** 生成全部骨架阶段需要的纹理 */
export function generateTextures(scene) {
  // 宣纸纸纹
  createCanvasTexture(scene, 'paper_grain', 160, 160, (ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    let seed = 20251026;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 900; i += 1) {
      const x = rand() * width;
      const y = rand() * height;
      const a = 0.018 + rand() * 0.05;
      ctx.fillStyle = `rgba(92, 78, 55, ${a})`;
      ctx.fillRect(x, y, 0.6 + rand() * 1.8, 0.6 + rand() * 1.8);
    }
    ctx.strokeStyle = 'rgba(120, 102, 74, 0.045)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 22; i += 1) {
      ctx.beginPath();
      ctx.moveTo(rand() * width, rand() * height);
      ctx.lineTo(rand() * width, rand() * height);
      ctx.stroke();
    }
  });

  // 小诗童：站立 / 走路两帧
  createCanvasTexture(scene, 'poem_boy_idle', 100, 120, (ctx, width, height) => {
    drawPoemBoy(ctx, width, height, 0);
  });
  createCanvasTexture(scene, 'poem_boy_walk_1', 100, 120, (ctx, width, height) => {
    drawPoemBoy(ctx, width, height, 1);
  });
  createCanvasTexture(scene, 'poem_boy_walk_2', 100, 120, (ctx, width, height) => {
    drawPoemBoy(ctx, width, height, 2);
  });

  // 牧童 NPC
  createCanvasTexture(scene, 'npc_cowherd', 100, 120, drawCowherd);

  // 石碑 / 隐藏石碑 / 路牌
  createCanvasTexture(scene, 'node_stele', 110, 150, (ctx, width, height) => {
    drawStele(ctx, width, height, false);
  });
  createCanvasTexture(scene, 'node_stele_hidden', 110, 150, (ctx, width, height) => {
    drawStele(ctx, width, height, true);
  });
  createCanvasTexture(scene, 'node_signpost', 96, 140, drawSignpost);

  // 节气 / 节日限时诗碑（红绸 + 灯笼，和普通诗碑区分开）
  createCanvasTexture(scene, 'node_festival_stele', 120, 160, drawFestivalStele);

  // 逸闻碎片（地图拾取点本体，64×64 便于整张替换）
  createCanvasTexture(scene, 'node_fragment', 64, 64, drawFragment);

  // 地图装饰
  createCanvasTexture(scene, 'tree_round', 260, 300, (ctx, width, height) => {
    drawTreeRound(ctx, width, height, 0);
  });
  createCanvasTexture(scene, 'tree_blossom', 260, 300, (ctx, width, height) => {
    drawTreeRound(ctx, width, height, 1);
  });
  createCanvasTexture(scene, 'tree_pine', 240, 320, drawTreePine);
  createCanvasTexture(scene, 'rock', 140, 100, drawRock);
  createCanvasTexture(scene, 'reed', 120, 160, drawReed);
  createCanvasTexture(scene, 'petal', 18, 14, drawPetal);
  createCanvasTexture(scene, 'pavilion', 320, 260, drawPavilion);

  // 给玩家创建走路动画
  if (!scene.anims.exists('poem_boy_walk')) {
    scene.anims.create({
      key: 'poem_boy_walk',
      frames: [{ key: 'poem_boy_walk_1' }, { key: 'poem_boy_idle' }, { key: 'poem_boy_walk_2' }, { key: 'poem_boy_idle' }],
      frameRate: 7,
      repeat: -1,
    });
  }
}
