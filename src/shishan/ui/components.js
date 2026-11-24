/**
 * 通用 UI 组件：按钮、纸卡、进度条、星星、标签、弹窗、吐司。
 * 设计原则：按钮大、圆角、间距宽松，适合小学生手指点触。
 */

import { C, FONT_FAMILY, FONT_SIZE, S, UI } from '../config/theme.js';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/constants.js';
import { audio } from '../managers/AudioManager.js';
import { addSeal, roundedRectPath } from './background.js';

// ---------------------------------------------------------
// 基础文本
// ---------------------------------------------------------
export function makeText(scene, x, y, content, options = {}) {
  const {
    size = FONT_SIZE.md,
    color = S.ink,
    align = 'center',
    wrap = 0,
    origin = [0.5, 0.5],
    lineSpacing,
    bold = false,
  } = options;

  const style = {
    fontFamily: FONT_FAMILY,
    fontSize: `${size}px`,
    color,
    align,
    fontStyle: bold ? 'bold' : 'normal',
    lineSpacing: lineSpacing ?? Math.round(size * 0.38),
  };
  // 保护：宽度必须能放下至少两个字符，否则 Phaser 会自动换行失败并抛
  // "wordWrapWidth < a single character"。窄按钮 / 圆形图标按钮不需要换行。
  if (wrap > 0 && wrap >= size * 1.6) {
    style.wordWrap = { width: wrap, useAdvancedWrap: true };
  }

  const text = scene.add.text(x, y, content, style).setOrigin(origin[0], origin[1]);
  text.setResolution(2);
  text.setShadow(0, 1, 'rgba(78, 67, 48, 0.12)', 2, false, true);
  return text;
}

// ---------------------------------------------------------
// 按钮
// ---------------------------------------------------------
const BUTTON_VARIANTS = {
  primary: {
    fill: C.pineDeep,
    stroke: C.gold,
    strokeAlpha: 0.7,
    text: S.white,
    subText: '#dfeae2',
    shadow: 0x36594b,
  },
  secondary: {
    fill: C.paperSoft,
    stroke: C.inkFaint,
    strokeAlpha: 0.75,
    text: S.ink,
    shadow: 0x8f8068,
  },
  soft: {
    fill: C.pineLight,
    stroke: C.pine,
    strokeAlpha: 0.55,
    text: S.pineDeep,
    shadow: 0x7b9182,
  },
  gold: {
    fill: C.goldLight,
    stroke: C.gold,
    strokeAlpha: 0.8,
    text: '#7e6230',
    shadow: 0x9a7c47,
  },
  danger: {
    fill: 0xf6e2dd,
    stroke: C.danger,
    strokeAlpha: 0.7,
    text: S.danger,
    shadow: 0x9d6b62,
  },
  ghost: {
    fill: 0xffffff,
    fillAlpha: 0.001,
    stroke: C.inkFaint,
    strokeAlpha: 0.4,
    text: S.inkSoft,
    shadow: 0x000000,
  },
  correct: {
    fill: C.pineLight,
    stroke: C.pineDeep,
    strokeAlpha: 0.9,
    text: S.pineDeep,
    shadow: 0x6d8d7c,
  },
  muted: {
    fill: C.paperDeep,
    stroke: C.inkLine,
    strokeAlpha: 0.6,
    text: S.mute,
    shadow: 0x9e927d,
  },
  tabActive: {
    fill: C.pineDeep,
    stroke: C.pineDeep,
    strokeAlpha: 1,
    text: S.white,
    subText: '#dcebe2',
    shadow: 0x36594b,
  },
  tab: {
    fill: C.paperSoft,
    stroke: C.inkLine,
    strokeAlpha: 0.7,
    text: S.inkSoft,
    shadow: 0x8f8068,
  },
};

// ---------------------------------------------------------
// 对话框皮肤（可选覆盖）：public/assets/images/scene/ui_*.png
// ---------------------------------------------------------
// 皮肤存在时，按钮 / 纸卡 / 弹窗 / 吐司改用九宫格贴图当底，文字排版、颜色、
// 点击热区与缩放反馈全部保持原样；贴图不存在时继续用下面的 Graphics 绘制。
// 生成与替换方式见 docs/art-scene-rebuild/README.md。
const BUTTON_SKIN_KEYS = {
  primary: 'ui_btn_primary',
  secondary: 'ui_btn_secondary',
  soft: 'ui_btn_soft',
  gold: 'ui_btn_gold',
  danger: 'ui_btn_danger',
  ghost: 'ui_btn_ghost',
  correct: 'ui_btn_correct',
  muted: 'ui_btn_muted',
  tabActive: 'ui_btn_tab_active',
  tab: 'ui_btn_tab',
};

const OUTLINE_SKIN_KEY = 'ui_btn_ghost';
const PANEL_SKIN_KEY = 'ui_panel';
const TOAST_SKIN_KEYS = { normal: 'ui_toast', warn: 'ui_toast_warn' };

// 九宫格切边必须与脚本 sceneArtSpecs.mjs 的 UI_SLICES 完全一致
const BUTTON_SKIN_INSET = 20;
const PANEL_SKIN_INSET = 28;
const TOAST_SKIN_INSET = 24;

/**
 * NineSlice 只在 WebGL 下渲染；如果浏览器回退到 Canvas，皮肤会整块不显示。
 * 因此先判断渲染器，Canvas 时继续用 Graphics，保证两种渲染器都能玩。
 */
function canUseTextureSkin(scene) {
  const renderer = scene?.game?.renderer;
  // Phaser.WEBGL === 2；同时确认 nineslice 工厂存在（3.60+）
  return Boolean(renderer) && renderer.type === 2 && typeof scene.add.nineslice === 'function';
}

/**
 * 创建大号圆角按钮。
 * @param {Phaser.Scene} scene
 * @param {object} options
 */
export function createButton(scene, options = {}) {
  const {
    x = 0,
    y = 0,
    width = 320,
    height = 82,
    radius = UI.radius.lg,
    label = '',
    subLabel = '',
    variant = 'secondary',
    fontSize = FONT_SIZE.lg,
    subFontSize = FONT_SIZE.xs,
    icon = '',
    depth = 1000,
    scrollFactor = 0,
    disabled = false,
    onClick = null,
    align = 'center',
  } = options;

  const container = scene.add
    .container(x, y)
    .setDepth(depth)
    .setScrollFactor(scrollFactor);

  const graphics = scene.add.graphics();
  container.add(graphics);

  // 副标题贴着按钮下沿放；按钮矮的时候自动收进来，避免文字压到边框外面
  const subY = Math.min(22, height / 2 - 14);
  const labelText = makeText(scene, align === 'center' ? 0 : -width / 2 + 38, subLabel ? -10 : 0, label, {
    size: fontSize,
    color: S.ink,
    origin: [align === 'center' ? 0.5 : 0, 0.5],
    wrap: width - 48,
    lineSpacing: 6,
  });
  const subText = subLabel
    ? makeText(scene, align === 'center' ? 0 : -width / 2 + 38, subY, subLabel, {
        size: subFontSize,
        color: S.inkSoft,
        origin: [align === 'center' ? 0.5 : 0, 0.5],
        wrap: width - 48,
      })
    : null;
  const iconText = icon
    ? makeText(scene, -width / 2 + 40, 0, icon, {
        size: fontSize + 4,
        color: S.inkSoft,
        origin: [0.5, 0.5],
      })
    : null;

  // 把文字放在按钮中间；带图标时整体略微右移
  if (iconText && align === 'center') {
    labelText.setPosition(18, subLabel ? -10 : 0);
    if (subText) subText.setPosition(18, subY);
    container.add(iconText);
  }
  container.add(labelText);
  if (subText) container.add(subText);

  // 注意：热区必须和容器同样设为 scrollFactor(0)。
  // Phaser 的命中检测会用「子对象」自己的 scrollFactor 反算屏幕坐标，
  // 地图这类镜头会滚动的场景里，如果热区仍是 1，点击就永远点不中。
  const zone = scene.add
    .zone(0, 0, width, height)
    .setScrollFactor(scrollFactor)
    .setInteractive({ useHandCursor: true });
  container.add(zone);

  let currentVariant = variant;
  let isDisabled = disabled;
  let pressed = false;
  let destroyed = false;

  // 圆形小按钮（×）保留幽灵皮肤；其它按钮按 variant 取对应底图。
  // 皮肤太小的按钮（短边不足两条切边）无法九宫格，继续用 Graphics。
  const roundSkin = width === height && radius >= width / 2 - 1;
  let skin = null;

  const resolveSkinKey = () => {
    if (roundSkin) return currentVariant === 'ghost' ? OUTLINE_SKIN_KEY : null;
    return BUTTON_SKIN_KEYS[currentVariant] || null;
  };

  const ensureSkin = () => {
    const key = resolveSkinKey();
    const usable = Boolean(key)
      && canUseTextureSkin(scene)
      && scene.textures.exists(key)
      && width >= BUTTON_SKIN_INSET * 2 + 2
      && height >= BUTTON_SKIN_INSET * 2 + 2;
    if (!usable) {
      if (skin) skin.setVisible(false);
      return null;
    }
    if (!skin) {
      // 放在阴影 Graphics 之上、文字与热区之下
      skin = scene.add.nineslice(
        0, 0, key, undefined,
        width, height,
        BUTTON_SKIN_INSET, BUTTON_SKIN_INSET, BUTTON_SKIN_INSET, BUTTON_SKIN_INSET,
      );
      container.addAt(skin, 1);
    } else {
      if (skin.texture.key !== key) skin.setTexture(key);
      skin.setSlices(
        width, height,
        BUTTON_SKIN_INSET, BUTTON_SKIN_INSET, BUTTON_SKIN_INSET, BUTTON_SKIN_INSET,
      );
      skin.setVisible(true);
    }
    return skin;
  };

  const draw = () => {
    const style = BUTTON_VARIANTS[currentVariant] || BUTTON_VARIANTS.secondary;
    const skinObject = ensureSkin();
    graphics.clear();

    if (!isDisabled) {
      graphics.fillStyle(UI.shadow.color, UI.shadow.alpha);
      roundedRectPath(
        graphics,
        -width / 2 + UI.shadow.offsetX,
        -height / 2 + UI.shadow.offsetY,
        width,
        height,
        radius,
      );
      graphics.fillPath();
    }

    // 有皮肤时只保留阴影；没有皮肤（或渲染器不支持）时保持原来的纸片绘制
    if (!skinObject) {
      graphics.fillStyle(style.fill, style.fillAlpha ?? 1);
      roundedRectPath(graphics, -width / 2, -height / 2, width, height, radius);
      graphics.fillPath();
      graphics.lineStyle(
        currentVariant === 'primary' ? UI.stroke.bold : UI.stroke.base,
        style.stroke,
        style.strokeAlpha,
      );
      roundedRectPath(graphics, -width / 2, -height / 2, width, height, radius);
      graphics.strokePath();

      // 内侧一圈很淡的高光，模拟彩绘纸片的厚度
      graphics.lineStyle(UI.stroke.hair, 0xffffff, currentVariant === 'primary' ? 0.22 : 0.5);
      roundedRectPath(graphics, -width / 2 + 5, -height / 2 + 5, width - 10, height - 10, radius - 4);
      graphics.strokePath();
    }

    labelText.setColor(style.text);
    // 深色按钮（墨绿底）上的副标题用浅色，否则棕灰小字几乎看不见
    if (subText) subText.setColor(style.subText || S.inkSoft);
    if (iconText) iconText.setColor(style.text);

    container.setAlpha(isDisabled ? 0.55 : 1);
  };

  const release = () => {
    if (destroyed) return;
    pressed = false;
    scene.tweens.add({
      targets: container,
      scaleX: 1,
      scaleY: 1,
      duration: 120,
      ease: 'Back.easeOut',
    });
  };

  zone.on('pointerover', () => {
    if (destroyed || isDisabled || pressed) return;
    scene.tweens.add({ targets: container, scaleX: 1.025, scaleY: 1.025, duration: 120 });
  });
  zone.on('pointerout', () => {
    if (destroyed) return;
    release();
  });
  zone.on('pointerdown', () => {
    if (destroyed || isDisabled) return;
    pressed = true;
    audio.unlock();
    audio.playClick();
    scene.tweens.add({ targets: container, scaleX: 0.96, scaleY: 0.96, duration: 70 });
  });
  zone.on('pointerup', () => {
    if (destroyed || isDisabled || !pressed) return;
    pressed = false;
    scene.tweens.add({
      targets: container,
      scaleX: 1,
      scaleY: 1,
      duration: 120,
      ease: 'Back.easeOut',
    });
    if (onClick) onClick();
  });

  draw();
  if (isDisabled) zone.disableInteractive();

  const controller = {
    container,
    zone,
    labelText,
    subText,
    graphics,
    setLabel(text) {
      labelText.setText(text);
    },
    setSubLabel(text) {
      if (subText) subText.setText(text);
    },
    setVariant(nextVariant) {
      currentVariant = nextVariant;
      draw();
    },
    setDisabled(disabledValue) {
      isDisabled = Boolean(disabledValue);
      if (isDisabled) {
        zone.disableInteractive();
        container.setAlpha(0.55);
        container.setScale(1);
      } else {
        zone.setInteractive({ useHandCursor: true });
        container.setAlpha(1);
      }
      draw();
    },
    setVisible(visible) {
      container.setVisible(visible);
      if (visible) {
        if (!isDisabled) zone.setInteractive({ useHandCursor: true });
      } else {
        zone.disableInteractive();
      }
    },
    get isDisabled() {
      return isDisabled;
    },
    markDestroyed() {
      destroyed = true;
    },
    destroy() {
      destroyed = true;
      container.destroy(true);
    },
  };

  container.once('destroy', () => {
    destroyed = true;
  });

  return controller;
}

/** 圆形小按钮（返回、关闭） */
export function createIconButton(scene, options = {}) {
  const { size = 64, icon = '×', variant = 'secondary', x = 0, y = 0, onClick, depth } = options;
  return createButton(scene, {
    x,
    y,
    width: size,
    height: size,
    radius: size / 2,
    label: icon,
    fontSize: Math.round(size * 0.4),
    variant,
    onClick,
    depth,
  });
}

// ---------------------------------------------------------
// 纸卡 / 标签 / 进度条 / 星星
// ---------------------------------------------------------
export function createPaperPanel(scene, options = {}) {
  const {
    x = GAME_WIDTH / 2,
    y = GAME_HEIGHT / 2,
    width = 800,
    height = 500,
    radius = UI.radius.xl,
    fill = UI.panel.fill,
    fillAlpha = UI.panel.fillAlpha,
    stroke = UI.panel.stroke,
    strokeAlpha = UI.panel.strokeAlpha,
    depth = 10,
    scrollFactor = 0,
    shadow = true,
  } = options;

  // 面板皮肤只覆盖「默认纸色」：调用方自定义过填充 / 描边色时仍用 Graphics，
  // 避免把有语义的彩色纸卡画成统一纸色。
  const skinUsable = canUseTextureSkin(scene)
    && scene.textures.exists(PANEL_SKIN_KEY)
    && fill === UI.panel.fill
    && stroke === UI.panel.stroke;

  if (skinUsable) {
    const container = scene.add
      .container(x, y)
      .setDepth(depth)
      .setScrollFactor(scrollFactor);

    if (shadow) {
      const shadowGraphics = scene.add.graphics();
      shadowGraphics.fillStyle(UI.shadow.color, UI.shadow.alpha);
      roundedRectPath(
        shadowGraphics,
        -width / 2 + UI.shadow.offsetX,
        -height / 2 + UI.shadow.offsetY,
        width,
        height,
        radius,
      );
      shadowGraphics.fillPath();
      container.add(shadowGraphics);
    }

    // 九宫格最小尺寸是两条切边之和（58px）。比这更扁的小条（菜单底部的存档概览
    // 只有 46px 高）先按最小尺寸建图、再等比压扁，这样不会被撑高后压到别的内容。
    const drawWidth = Math.max(width, PANEL_SKIN_INSET * 2 + 2);
    const drawHeight = Math.max(height, PANEL_SKIN_INSET * 2 + 2);
    const skin = scene.add
      .nineslice(
        0, 0, PANEL_SKIN_KEY, undefined,
        drawWidth, drawHeight,
        PANEL_SKIN_INSET, PANEL_SKIN_INSET, PANEL_SKIN_INSET, PANEL_SKIN_INSET,
      )
      .setAlpha(fillAlpha);
    if (drawWidth !== width || drawHeight !== height) {
      skin.setScale(width / drawWidth, height / drawHeight);
    }
    container.add(skin);
    return container;
  }

  const graphics = scene.add
    .graphics({ x, y })
    .setDepth(depth)
    .setScrollFactor(scrollFactor);

  if (shadow) {
    graphics.fillStyle(UI.shadow.color, UI.shadow.alpha);
    roundedRectPath(
      graphics,
      -width / 2 + UI.shadow.offsetX,
      -height / 2 + UI.shadow.offsetY,
      width,
      height,
      radius,
    );
    graphics.fillPath();
  }

  graphics.fillStyle(fill, fillAlpha);
  roundedRectPath(graphics, -width / 2, -height / 2, width, height, radius);
  graphics.fillPath();
  graphics.lineStyle(UI.stroke.base, stroke, strokeAlpha);
  roundedRectPath(graphics, -width / 2, -height / 2, width, height, radius);
  graphics.strokePath();
  graphics.lineStyle(UI.stroke.hair, UI.panel.innerStroke, UI.panel.innerStrokeAlpha);
  roundedRectPath(
    graphics,
    -width / 2 + UI.panel.inset,
    -height / 2 + UI.panel.inset,
    width - UI.panel.inset * 2,
    height - UI.panel.inset * 2,
    Math.max(6, radius - 6),
  );
  graphics.strokePath();

  // 四角小点，像手工装订的诗集
  graphics.fillStyle(C.gold, 0.36);
  [[-width / 2 + 20, -height / 2 + 20], [width / 2 - 20, -height / 2 + 20],
    [-width / 2 + 20, height / 2 - 20], [width / 2 - 20, height / 2 - 20]].forEach(([px, py]) => {
    graphics.fillCircle(px, py, 2.5);
  });

  return graphics;
}

export function createTag(scene, x, y, label, options = {}) {
  const {
    fill = C.pineLight,
    textColor = S.pineDeep,
    fontSize = FONT_SIZE.xs,
    height = 32,
    paddingX = 16,
    depth = 20,
    strokeColor = C.pine,
    strokeAlpha = 0.35,
  } = options;

  const container = scene.add.container(x, y).setDepth(depth).setScrollFactor(0);
  const text = makeText(scene, 0, 0, label, { size: fontSize, color: textColor, origin: [0.5, 0.5] });
  const width = Math.max(50, text.width + paddingX * 2);
  const graphics = scene.add.graphics();
  graphics.fillStyle(fill, 0.92);
  roundedRectPath(graphics, -width / 2, -height / 2, width, height, height / 2);
  graphics.fillPath();
  graphics.lineStyle(1.2, strokeColor, strokeAlpha);
  roundedRectPath(graphics, -width / 2, -height / 2, width, height, height / 2);
  graphics.strokePath();

  container.add([graphics, text]);
  return { container, width, setLabel: (value) => text.setText(value) };
}

export function createProgressBar(scene, options = {}) {
  const {
    x = 0,
    y = 0,
    width = 320,
    height = 14,
    percent = 0,
    color = C.pine,
    trackColor = C.paperShade,
    showLabel = false,
    labelSize = FONT_SIZE.xs,
    depth = 20,
  } = options;

  const container = scene.add.container(x, y).setDepth(depth).setScrollFactor(0);
  const graphics = scene.add.graphics();
  container.add(graphics);

  const label = showLabel
    ? makeText(scene, width / 2 + 52, 0, `${Math.round(percent)}%`, {
        size: labelSize,
        color: S.inkSoft,
        origin: [0.5, 0.5],
      })
    : null;
  if (label) container.add(label);

  let value = Math.max(0, Math.min(100, Number(percent) || 0));

  const draw = () => {
    graphics.clear();
    graphics.fillStyle(trackColor, 0.9);
    roundedRectPath(graphics, -width / 2, -height / 2, width, height, height / 2);
    graphics.fillPath();
    if (value > 0) {
      const fillWidth = Math.max(height, (width - 4) * (value / 100));
      graphics.fillStyle(color, 1);
      roundedRectPath(graphics, -width / 2 + 2, -height / 2 + 2, fillWidth, height - 4, (height - 4) / 2);
      graphics.fillPath();
    }
    graphics.lineStyle(1, 0xffffff, 0.55);
    roundedRectPath(graphics, -width / 2 + 1, -height / 2 + 1, width - 2, height - 2, height / 2);
    graphics.strokePath();
    if (label) label.setText(`${Math.round(value)}%`);
  };

  draw();

  return {
    container,
    setPercent(next, animate = false) {
      const target = Math.max(0, Math.min(100, Number(next) || 0));
      if (!animate) {
        value = target;
        draw();
        return;
      }
      scene.tweens.addCounter({
        from: value,
        to: target,
        duration: 420,
        ease: 'Sine.easeOut',
        onUpdate: (tween) => {
          value = tween.getValue();
          draw();
        },
      });
    },
  };
}

export function createStarRow(scene, options = {}) {
  const {
    x = 0,
    y = 0,
    stars = 0,
    max = 3,
    size = 22,
    gap = 4,
    depth = 30,
    animate = false,
  } = options;

  const container = scene.add.container(x, y).setDepth(depth).setScrollFactor(0);
  let current = Math.max(0, Math.min(max, Math.round(stars)));

  const rebuild = () => {
    container.removeAll(true);
    const totalWidth = max * size + (max - 1) * gap;
    for (let i = 0; i < max; i += 1) {
      const lit = i < current;
      const star = makeText(scene, -totalWidth / 2 + size / 2 + i * (size + gap), 0, '★', {
        size,
        color: lit ? S.goldSoft : S.mute,
        origin: [0.5, 0.5],
      }).setAlpha(lit ? 1 : 0.42);
      container.add(star);
      if (animate && lit) {
        star.setScale(0);
        scene.tweens.add({
          targets: star,
          scaleX: 1,
          scaleY: 1,
          duration: 280,
          delay: 80 * i,
          ease: 'Back.easeOut',
        });
      }
    }
  };

  rebuild();

  return {
    container,
    setStars(value) {
      current = Math.max(0, Math.min(max, Math.round(value)));
      rebuild();
    },
  };
}

// ---------------------------------------------------------
// 头部
// ---------------------------------------------------------
export function createHeader(scene, options = {}) {
  const {
    title = '',
    subtitle = '',
    onBack = null,
    backLabel = '返回',
    rightText = '',
    showLine = true,
  } = options;

  const container = scene.add.container(0, 0).setDepth(1000).setScrollFactor(0);

  if (onBack) {
    const back = createButton(scene, {
      x: 21 + 66,
      y: 22 + 32,
      width: 132,
      height: 64,
      radius: 22,
      label: `‹ ${backLabel}`,
      variant: 'secondary',
      fontSize: FONT_SIZE.md,
      onClick: onBack,
      depth: 1001,
    });
    container.add(back.container);
  }

  const titleX = onBack ? 178 : 60;
  const titleText = makeText(scene, titleX, 40, title, {
    size: FONT_SIZE.xl,
    color: S.ink,
    origin: [0, 0.5],
  });
  container.add(titleText);

  if (subtitle) {
    const subtitleText = makeText(scene, titleX + 3, 72, subtitle, {
      size: FONT_SIZE.xs,
      color: S.inkSoft,
      origin: [0, 0.5],
      wrap: 760,
    });
    container.add(subtitleText);
  }

  if (rightText) {
    const chip = createTag(scene, GAME_WIDTH - 150, 52, rightText, {
      fill: C.paperSoft,
      textColor: S.inkSoft,
      fontSize: FONT_SIZE.xs,
      height: 38,
      paddingX: 20,
      strokeColor: C.inkLine,
    });
    chip.container.setPosition(GAME_WIDTH - chip.width / 2 - 60, 52);
    container.add(chip.container);
  }

  if (showLine) {
    const line = scene.add.graphics().setDepth(1000).setScrollFactor(0);
    line.lineStyle(1.5, C.inkFaint, 0.38);
    line.beginPath();
    line.moveTo(60, 103);
    line.lineTo(GAME_WIDTH - 60, 103);
    line.strokePath();
    line.fillStyle(C.gold, 0.5);
    line.fillCircle(GAME_WIDTH / 2, 103, 3);
    container.add(line);
  }

  return { container, titleText };
}

// ---------------------------------------------------------
// 吐司
// ---------------------------------------------------------
export function showToast(scene, message, options = {}) {
  const {
    y = 618,
    duration = 1800,
    depth = UI.depth.toast,
    tone = 'normal',
  } = options;

  if (scene._activeToast) {
    scene._activeToast.destroy(true);
    scene._activeToast = null;
  }
  if (scene._toastTimer) {
    scene._toastTimer.remove(false);
    scene._toastTimer = null;
  }

  const container = scene.add.container(GAME_WIDTH / 2, y).setDepth(depth).setScrollFactor(0);
  const fill = tone === 'warn' ? 0xf6e4de : C.paperSoft;
  const textColor = tone === 'warn' ? S.danger : S.ink;

  const text = makeText(scene, 0, 0, message, {
    size: FONT_SIZE.sm,
    color: textColor,
    wrap: 760,
    origin: [0.5, 0.5],
    lineSpacing: 7,
  });
  const width = Math.max(220, Math.min(860, text.width + 72));
  const height = text.height + 34;

  const skinKey = TOAST_SKIN_KEYS[tone] || TOAST_SKIN_KEYS.normal;
  const skinUsable = canUseTextureSkin(scene)
    && scene.textures.exists(skinKey)
    && width >= TOAST_SKIN_INSET * 2 + 2
    && height >= TOAST_SKIN_INSET * 2 + 2;

  const graphics = scene.add.graphics();
  if (skinUsable) {
    // 皮肤自带纸底与描边，这里只画投影
    graphics.fillStyle(UI.shadow.color, UI.shadow.alpha);
    roundedRectPath(graphics, -width / 2 + 2, -height / 2 + 5, width, height, height / 2);
    graphics.fillPath();
    container.add(graphics);

    const skinHeight = Math.max(height, TOAST_SKIN_INSET * 2 + 2);
    const skin = scene.add
      .nineslice(
        0, 0, skinKey, undefined,
        width, skinHeight,
        TOAST_SKIN_INSET, TOAST_SKIN_INSET, TOAST_SKIN_INSET, TOAST_SKIN_INSET,
      )
      .setAlpha(0.97);
    container.add(skin);
  } else {
    graphics.fillStyle(UI.shadow.color, UI.shadow.alpha);
    roundedRectPath(graphics, -width / 2 + 2, -height / 2 + 5, width, height, height / 2);
    graphics.fillPath();
    graphics.fillStyle(fill, 0.97);
    roundedRectPath(graphics, -width / 2, -height / 2, width, height, height / 2);
    graphics.fillPath();
    graphics.lineStyle(UI.stroke.thin, UI.panel.innerStroke, 0.4);
    roundedRectPath(graphics, -width / 2, -height / 2, width, height, height / 2);
    graphics.strokePath();
    container.add(graphics);
  }

  container.add(text);
  container.setAlpha(0);
  container.y = y + 14;

  scene._activeToast = container;
  scene.tweens.add({
    targets: container,
    alpha: 1,
    y,
    duration: 220,
    ease: 'Sine.easeOut',
  });
  scene._toastTimer = scene.time.delayedCall(duration, () => {
    if (!container.scene) return;
    scene.tweens.add({
      targets: container,
      alpha: 0,
      y: y - 10,
      duration: 260,
      onComplete: () => {
        if (scene._activeToast === container) scene._activeToast = null;
        container.destroy(true);
      },
    });
  });

  return container;
}

// ---------------------------------------------------------
// 通用弹窗
// ---------------------------------------------------------
/**
 * 展示一个纸卡弹窗。
 * @param {Phaser.Scene} scene
 * @param {object} options { title, message, actions:[{label,variant,onClick,close}], width, depth, sealText }
 */
export function showModal(scene, options = {}) {
  const {
    title = '',
    message = '',
    actions = [{ label: '知道了', variant: 'primary' }],
    width = 760,
    depth = UI.depth.modal,
    sealText = '',
    titleColor = S.ink,
    onClose = null,
  } = options;

  const root = scene.add.container(0, 0).setDepth(depth).setScrollFactor(0);
  const blocker = scene.add
    .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, UI.overlay.color, UI.overlay.alpha)
    .setOrigin(0)
    .setScrollFactor(0)
    .setInteractive();
  root.add(blocker);

  const wrapWidth = width - 104;
  const msgText = makeText(scene, 0, 0, message, {
    size: FONT_SIZE.md,
    color: S.inkSoft,
    align: 'left',
    wrap: wrapWidth,
    origin: [0, 0],
    lineSpacing: 10,
  });

  const hasHorizontalActions = actions.length <= 2;
  const actionHeight = actions.length === 0
    ? 0
    : hasHorizontalActions
      ? 78
      : actions.length * 70 + (actions.length - 1) * 12;
  const panelHeight = Math.max(
    300,
    Math.min(636, 156 + msgText.height + actionHeight + 46),
  );
  const panelWidth = width;
  const cx = GAME_WIDTH / 2;
  const cy = GAME_HEIGHT / 2;

  const panelSkinUsable = canUseTextureSkin(scene)
    && scene.textures.exists(PANEL_SKIN_KEY)
    && panelWidth >= PANEL_SKIN_INSET * 2 + 2
    && panelHeight >= PANEL_SKIN_INSET * 2 + 2;

  const panel = scene.add.graphics();
  panel.fillStyle(UI.shadow.color, UI.shadow.alpha);
  roundedRectPath(
    panel,
    cx - panelWidth / 2 + UI.shadow.offsetX,
    cy - panelHeight / 2 + UI.shadow.offsetY,
    panelWidth,
    panelHeight,
    UI.radius.xl,
  );
  panel.fillPath();

  if (!panelSkinUsable) {
    panel.fillStyle(UI.panel.fill, 0.985);
    roundedRectPath(panel, cx - panelWidth / 2, cy - panelHeight / 2, panelWidth, panelHeight, UI.radius.xl);
    panel.fillPath();
    panel.lineStyle(UI.stroke.base, UI.panel.stroke, UI.panel.strokeAlpha);
    roundedRectPath(panel, cx - panelWidth / 2, cy - panelHeight / 2, panelWidth, panelHeight, UI.radius.xl);
    panel.strokePath();
    panel.lineStyle(UI.stroke.hair, UI.panel.innerStroke, UI.panel.innerStrokeAlpha);
    roundedRectPath(
      panel,
      cx - panelWidth / 2 + UI.panel.inset,
      cy - panelHeight / 2 + UI.panel.inset,
      panelWidth - UI.panel.inset * 2,
      panelHeight - UI.panel.inset * 2,
      UI.radius.lg,
    );
    panel.strokePath();
  }
  root.add(panel);

  if (panelSkinUsable) {
    const panelSkin = scene.add
      .nineslice(
        cx, cy, PANEL_SKIN_KEY, undefined,
        panelWidth, panelHeight,
        PANEL_SKIN_INSET, PANEL_SKIN_INSET, PANEL_SKIN_INSET, PANEL_SKIN_INSET,
      )
      .setAlpha(0.985);
    root.add(panelSkin);
  }

  if (sealText) {
    root.add(addSeal(scene, cx - panelWidth / 2 + 56, cy - panelHeight / 2 + 54, sealText, 44));
  }

  const titleX = sealText ? cx + 14 : cx;
  const titleText = makeText(scene, titleX, cy - panelHeight / 2 + 58, title, {
    size: FONT_SIZE.xl,
    color: titleColor,
    origin: [0.5, 0.5],
    wrap: panelWidth - 140,
  });
  root.add(titleText);

  const line = scene.add.graphics();
  line.lineStyle(1.4, C.gold, 0.38);
  line.beginPath();
  line.moveTo(cx - panelWidth / 2 + 64, cy - panelHeight / 2 + 94);
  line.lineTo(cx + panelWidth / 2 - 64, cy - panelHeight / 2 + 94);
  line.strokePath();
  root.add(line);

  msgText.setPosition(cx - wrapWidth / 2, cy - panelHeight / 2 + 118);
  root.add(msgText);

  const close = () => {
    if (!root.scene) return;
    root.destroy(true);
    if (onClose) onClose();
  };

  if (actions.length > 0) {
    const startY = cy + panelHeight / 2 - 46 - actionHeight + 39;
    actions.forEach((action, index) => {
      let buttonX;
      let buttonY;
      let buttonWidth;
      if (hasHorizontalActions) {
        const gap = 24;
        buttonWidth = (panelWidth - 128 - gap) / 2;
        buttonX = actions.length === 1
          ? cx
          : cx - buttonWidth / 2 - gap / 2 + index * (buttonWidth + gap);
        buttonY = startY + 4;
      } else {
        buttonWidth = panelWidth - 140;
        buttonX = cx;
        buttonY = startY + index * 82;
      }

      const button = createButton(scene, {
        x: buttonX,
        y: buttonY,
        width: buttonWidth,
        height: 66,
        label: action.label,
        variant: action.variant || (index === 0 ? 'primary' : 'secondary'),
        fontSize: FONT_SIZE.md,
        depth: depth + 2,
        onClick: () => {
          if (action.onClick) action.onClick();
          if (action.close !== false) close();
        },
      });
      root.add(button.container);
    });
  }

  // 右上角小关闭按钮
  const xButton = createIconButton(scene, {
    x: cx + panelWidth / 2 - 42,
    y: cy - panelHeight / 2 + 42,
    size: 46,
    icon: '×',
    variant: 'ghost',
    onClick: close,
    depth: depth + 2,
  });
  root.add(xButton.container);

  return { root, close, messageText: msgText };
}

/** 把数字格式化成 2 位 */
export function pad2(value) {
  return String(value).padStart(2, '0');
}
