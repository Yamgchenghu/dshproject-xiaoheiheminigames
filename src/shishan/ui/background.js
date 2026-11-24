/**
 * 绘本风背景绘制工具。
 * 所有场景共用一套淡彩纸纹、远山、云与落花的视觉语言。
 */

import { C, UI, FONT_FAMILY } from '../config/theme.js';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/constants.js';

const PALETTES = {
  garden: {
    top: 0xf8f8ec,
    bottom: 0xe7f0dc,
    sun: 0xf6e5bd,
    hillFar: 0xd7e5c8,
    hillNear: 0xc4d8b2,
    wash: 0x8fac94,
  },
  peach: {
    top: 0xfcf4ec,
    bottom: 0xf3e0d2,
    sun: 0xf5d8bd,
    hillFar: 0xefd3c3,
    hillNear: 0xe4bfab,
    wash: 0xbd8c7c,
  },
  pine: {
    top: 0xf6f8f0,
    bottom: 0xe0ebe0,
    sun: 0xf2e6c8,
    hillFar: 0xd2e2d2,
    hillNear: 0xbcd2be,
    wash: 0x78927f,
  },
  mist: {
    top: 0xf8faf6,
    bottom: 0xe4eee9,
    sun: 0xf4ecd6,
    hillFar: 0xd8e6df,
    hillNear: 0xc7dad2,
    wash: 0x7f9e94,
  },
  maple: {
    top: 0xfcf5eb,
    bottom: 0xf1ddcd,
    sun: 0xf6dcb6,
    hillFar: 0xecd3c4,
    hillNear: 0xdfb9a4,
    wash: 0xb58a72,
  },
  star: {
    top: 0xf5f2eb,
    bottom: 0xe8e3ea,
    sun: 0xf0e7c9,
    hillFar: 0xdad5e2,
    hillNear: 0xc9c3d6,
    wash: 0x8d879c,
  },
  paper: {
    top: 0xfbf7ed,
    bottom: 0xf0e7d5,
    sun: 0xf4e7c4,
    hillFar: 0xe6dbc4,
    hillNear: 0xd9ccb2,
    wash: 0xa79a80,
  },
};

/** 圆角矩形路径（不依赖 roundRect，兼容性更稳） */
export function roundedRectPath(graphics, x, y, width, height, radius) {
  const r = Math.min(radius, Math.min(width, height) / 2);
  graphics.beginPath();
  graphics.moveTo(x + r, y);
  graphics.lineTo(x + width - r, y);
  graphics.arc(x + width - r, y + r, r, -Math.PI / 2, 0, false);
  graphics.lineTo(x + width, y + height - r);
  graphics.arc(x + width - r, y + height - r, r, 0, Math.PI / 2, false);
  graphics.lineTo(x + r, y + height);
  graphics.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI, false);
  graphics.lineTo(x, y + r);
  graphics.arc(x + r, y + r, r, Math.PI, (Math.PI * 3) / 2, false);
  graphics.closePath();
}

/** 画一朵淡云 */
function drawCloud(graphics, x, y, scale = 1, alpha = 0.65) {
  graphics.fillStyle(0xfffdf6, alpha);
  graphics.fillEllipse(x, y, 150 * scale, 54 * scale);
  graphics.fillEllipse(x + 62 * scale, y + 8 * scale, 96 * scale, 42 * scale);
  graphics.fillEllipse(x - 66 * scale, y + 12 * scale, 84 * scale, 38 * scale);
  graphics.fillEllipse(x + 12 * scale, y - 18 * scale, 74 * scale, 52 * scale);
}

/** 画层叠远山 */
function drawHills(graphics, palette) {
  graphics.fillStyle(palette.hillFar, 0.85);
  graphics.fillEllipse(150, 640, 620, 380);
  graphics.fillEllipse(620, 670, 760, 430);
  graphics.fillEllipse(1090, 635, 680, 390);

  graphics.fillStyle(palette.hillNear, 0.7);
  graphics.fillEllipse(300, 720, 820, 390);
  graphics.fillEllipse(840, 742, 860, 400);
  graphics.fillEllipse(1260, 714, 620, 350);

  // 很淡的水墨山脊
  graphics.lineStyle(3, palette.wash, 0.16);
  graphics.beginPath();
  graphics.moveTo(-40, 560);
  graphics.lineTo(170, 430);
  graphics.lineTo(320, 540);
  graphics.lineTo(520, 390);
  graphics.lineTo(710, 548);
  graphics.lineTo(930, 420);
  graphics.lineTo(1120, 520);
  graphics.lineTo(1320, 400);
  graphics.strokePath();
}

/**
 * 添加绘本纸纹背景。
 * @param {Phaser.Scene} scene
 * @param {string} paletteName garden|peach|pine|mist|maple|star|paper
 * @param {object} options { grain, hills, sun, clouds, petals, depth }
 */
export function addPaperBackground(scene, paletteName = 'garden', options = {}) {
  const {
    grain = true,
    hills = true,
    sun = true,
    clouds = true,
    petals = false,
    depth = -1000,
  } = options;
  const palette = PALETTES[paletteName] || PALETTES.garden;

  const graphics = scene.add.graphics().setDepth(depth);
  graphics.fillGradientStyle(palette.top, palette.top, palette.bottom, palette.bottom, 1);
  graphics.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  if (sun) {
    graphics.fillStyle(palette.sun, 0.5);
    graphics.fillCircle(1044, 140, 76);
    graphics.fillStyle(palette.sun, 0.28);
    graphics.fillCircle(1044, 140, 108);
    graphics.lineStyle(2, 0xffffff, 0.4);
    graphics.strokeCircle(1044, 140, 82);
  }

  if (clouds) {
    drawCloud(graphics, 200, 142, 1.05, 0.5);
    drawCloud(graphics, 870, 232, 0.7, 0.35);
    drawCloud(graphics, 1130, 318, 0.55, 0.28);
  }

  if (hills) drawHills(graphics, palette);

  // 角落的淡墨点，增加宣纸手绘感
  graphics.fillStyle(palette.wash, 0.05);
  for (let i = 0; i < 26; i += 1) {
    const x = (i * 197 + 83) % GAME_WIDTH;
    const y = (i * 131 + 57) % GAME_HEIGHT;
    graphics.fillCircle(x, y, 2 + (i % 3));
  }

  if (grain && scene.textures.exists('paper_grain')) {
    scene.add
      .tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, 'paper_grain')
      .setOrigin(0)
      .setAlpha(0.32)
      .setDepth(depth + 2);
  }

  if (petals) addFloatingPetals(scene, depth + 3);

  return graphics;
}

/** 飘落的淡花瓣，只用在菜单/章节选择这类静态页面 */
export function addFloatingPetals(scene, depth = -990, count = 9) {
  if (!scene.textures.exists('petal')) return;
  for (let i = 0; i < count; i += 1) {
    const x = 80 + Math.random() * (GAME_WIDTH - 160);
    const startY = -40 - Math.random() * 260;
    const duration = 9000 + Math.random() * 7000;
    const petal = scene.add
      .image(x, startY, 'petal')
      .setAlpha(0.45 + Math.random() * 0.3)
      .setScale(0.7 + Math.random() * 0.8)
      .setDepth(depth)
      .setAngle(Math.random() * 180);

    scene.tweens.add({
      targets: petal,
      y: GAME_HEIGHT + 60,
      x: x + (Math.random() > 0.5 ? 90 : -90),
      angle: petal.angle + 240,
      duration,
      delay: Math.random() * 5000,
      repeat: -1,
      onRepeat: () => {
        petal.x = 80 + Math.random() * (GAME_WIDTH - 160);
        petal.y = -40;
      },
    });
  }
}

/** 半透明纸纹遮罩，用于地图与弹窗，让画面更统一 */
export function addGrainOverlay(scene, depth = 900, alpha = 0.18) {
  if (!scene.textures.exists('paper_grain')) return null;
  return scene.add
    .tileSprite(0, 0, GAME_WIDTH, GAME_HEIGHT, 'paper_grain')
    .setOrigin(0)
    .setAlpha(alpha)
    .setDepth(depth)
    .setScrollFactor(0);
}

/** 做一个简单的“纸色渐变遮罩”，用在关卡弹窗背景 */
export function addDimOverlay(scene, alpha = UI.overlay.alpha, color = UI.overlay.color, depth = 800) {
  return scene.add
    .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, color, alpha)
    .setOrigin(0)
    .setDepth(depth)
    .setScrollFactor(0);
}

/** 装饰性墨色小印章 */
export function addSeal(scene, x, y, text, size = 46, color = C.peachDeep) {
  const container = scene.add.container(x, y);
  const seal = scene.add.graphics();
  seal.fillStyle(color, 0.9);
  roundedRectPath(seal, -size / 2, -size / 2, size, size, 8);
  seal.fillPath();
  seal.lineStyle(2, 0xfff8ef, 0.55);
  seal.strokeRect(-size / 2 + 5, -size / 2 + 5, size - 10, size - 10);
  container.add(seal);

  const label = scene.add
    .text(0, 1, text, {
      // 统一走主题里的 FONT_FAMILY，别在这里再写一份字体栈，
      // 否则换字体时总会漏掉一两处（这里之前就漏了）。
      fontFamily: FONT_FAMILY,
      fontSize: `${Math.round(size * 0.48)}px`,
      color: '#fff8ef',
      align: 'center',
    })
    .setOrigin(0.5);
  container.add(label);
  return container;
}

export { PALETTES };
