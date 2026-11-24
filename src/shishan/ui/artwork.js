/**
 * 插图绘制小工具：把预加载好的插画纹理铺进画面里的圆角画框。
 *
 * - 有图：等比例「cover」裁切 + 圆角遮罩，画面不变形；
 * - 没图：返回 null，调用方继续用原来的程序化占位画。
 *
 * 只用于固定不滚动的画框（关卡画卷、详情弹窗）。
 *
 * 【圆角是抗锯齿的】早期版本用 GeometryMask，那是模板缓冲遮罩，
 *   逐像素判定在不在路径里、没有抗锯齿，圆角弧线会露出台阶状锯齿，
 *   看起来就像「边缘没做透明，被硬切了一刀」。
 *   现在改成 4 倍超采样的 canvas 遮罩纹理 + BitmapMask，
 *   边缘有 4 个像素的柔和过渡，在任何底色上都干净。
 */

import Phaser from 'phaser';

import { roundedRectPath } from './background.js';

/**
 * 生成一张「抗锯齿圆角」遮罩纹理。
 *
 * 【为什么要自己画一张，而不是直接用 GeometryMask】
 *   原来用 scene.make.graphics() + createGeometryMask()，那是模板缓冲遮罩，
 *   逐像素判定「在不在路径里」——没有抗锯齿。
 *   圆角弧线上的像素只有两种命运：整个保留，或整个丢弃。
 *   结果就是弧边出现台阶状锯齿，看上去像「圆角边缘没有透明，而是被硬切了一刀」。
 *   在浅色纸背景上尤其明显，因为锯齿的高光和纸色对比强。
 *
 * 【为什么用 4 倍超采样】Canvas 2D 的 arc 本身是抗锯齿的，
 *   但遮罩是按纹理尺寸逐像素采样的，纹理只有 1 倍时边缘仍然只有
 *   一个像素的过渡，放大到屏幕上就是一条硬线。
 *   先按 4 倍画、再交给显卡缩小采样，能得到 4 个像素的柔和过渡。
 *   4 倍是经验值：再高对视觉没有增益，只会让显存占用翻倍。
 *
 * 【为什么白色 + alpha】BitmapMask 只看遮罩纹理的 alpha 通道：
 *   alpha 为 1 处保留原图，为 0 处透明，中间值就是半透明过渡。
 *   所以必须让抗锯齿产生真正的中间 alpha，而不是画一个白圆角矩形。
 */
function createRoundMaskTexture(scene, width, height, radius, key) {
  if (scene.textures.exists(key)) return key;

  const SS = 4; // 超采样倍率
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const canvas = document.createElement('canvas');
  canvas.width = w * SS;
  canvas.height = h * SS;

  const ctx = canvas.getContext('2d');
  const r = Math.min(radius, Math.min(w, h) / 2) * SS;

  // 圆角矩形路径（顺时针）
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w * SS - r, 0);
  ctx.arcTo(w * SS, 0, w * SS, r, r);
  ctx.lineTo(w * SS, h * SS - r);
  ctx.arcTo(w * SS, h * SS, w * SS - r, h * SS, r);
  ctx.lineTo(r, h * SS);
  ctx.arcTo(0, h * SS, 0, h * SS - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  scene.textures.addCanvas(key, canvas);
  return key;
}

/** 纹理是否真的加载进了 Phaser 纹理管理器 */
export function hasArtwork(scene, key) {
  if (!scene || !key) return false;
  return scene.textures.exists(String(key));
}

/**
 * 在 (x, y) 左上角、width × height 的画框里铺一张插画。
 * @returns {{ container, image, mask } | null}
 */
export function addArtwork(scene, options = {}) {
  const {
    key,
    x,
    y,
    width,
    height,
    radius = 14,
    depth = 0,
    parent = null,
  } = options;

  if (!hasArtwork(scene, key)) return null;

  const textureKey = String(key);
  const texture = scene.textures.get(textureKey);
  const source = texture ? texture.getSourceImage() : null;
  const sourceWidth = source?.width || width;
  const sourceHeight = source?.height || height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);

  const container = scene.add.container(0, 0);
  const image = scene.add.image(x + width / 2, y + height / 2, textureKey).setScale(scale);
  container.add(image);

  // 圆角遮罩：用抗锯齿的 canvas 纹理 + BitmapMask，而不是 GeometryMask。
  // 原因见上面 createRoundMaskTexture 的注释：GeometryMask 没有抗锯齿。
  const maskKey = 'mask_round_' + Math.round(width) + 'x' + Math.round(height) + '_' + Math.round(radius);
  createRoundMaskTexture(scene, width, height, radius, maskKey);

  // BitmapMask 的遮罩图必须入显示列表才能被采样，但又不能真的画出来，
  // 所以设为不可见。它自身的位置要和被遮罩的图完全重合，
  // 否则遮罩会整体偏移（这是 BitmapMask 最常见的一个坑）。
  const maskImage = scene.make.image({
    x: x + width / 2,
    y: y + height / 2,
    key: maskKey,
    add: false,
  });
  maskImage.setDisplaySize(width, height);
  maskImage.setVisible(false);

  // 【必须判断渲染器】BitmapMask 只在 WebGL 下有效：
  //   Canvas 渲染器会直接忽略它，图片变成直角矩形——比锯齿更难看。
  //   Phaser.AUTO 在极少数设备（WebGL 被禁用、上下文创建失败）上会回退到
  //   Canvas，所以这里要两条路都留着：
  //     WebGL  → 抗锯齿 BitmapMask（首选）
  //     Canvas → 退回 GeometryMask（有锯齿，但至少是圆角）
  const useWebGL = scene.game && scene.game.renderer && scene.game.renderer.type === Phaser.WEBGL;

  let mask;
  if (useWebGL) {
    mask = new Phaser.Display.Masks.BitmapMask(scene, maskImage);
    // 【为什么要 invertAlpha=false】默认就是 false，这里写出来是为了明确语义：
    //   遮罩图 alpha 为 1 的地方显示原图，为 0 的地方透明。
    mask.invertAlpha = false;
    image.setMask(mask);
  } else {
    // Canvas 兜底：几何遮罩。没有抗锯齿，但不会让圆角整个消失。
    const maskGraphics = scene.make.graphics({ x: 0, y: 0, add: false });
    roundedRectPath(maskGraphics, x, y, width, height, radius);
    maskGraphics.fillStyle(0xffffff, 1);
    maskGraphics.fillPath();
    image.setMask(maskGraphics.createGeometryMask());
    mask = maskGraphics;
    // 这张遮罩图在 Canvas 分支用不到，销毁掉免得占纹理
    if (maskImage.scene) maskImage.destroy();
  }

  container.setDepth(depth);
  if (parent) parent.add(container);

  container.once('destroy', () => {
    // 遮罩对象不在显示列表里，必须手动销毁，否则每次进出页面都漏一张纹理。
    if (mask && mask.scene) mask.destroy();
  });

  return { container, image, mask };
}
