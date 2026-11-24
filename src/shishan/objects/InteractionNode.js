/**
 * InteractionNode：地图上的可交互对象。
 * 支持画卷石碑、牧童 NPC、隐藏诗碑、指路木牌、玩法触发点与下一章路口。
 */

import { C, S } from '../config/theme.js';
import { progress } from '../managers/ProgressManager.js';
import { makeText } from '../ui/components.js';
import { roundedRectPath } from '../ui/background.js';

const NODE_VISUALS = {
  scroll: { texture: 'node_stele', height: 150, width: 130 },
  npc: { texture: 'npc_cowherd', height: 120, width: 120 },
  sign: { texture: 'node_signpost', height: 140, width: 110 },
  hiddenStele: { texture: 'node_stele_hidden', height: 150, width: 130 },
  festival: { texture: 'node_festival_stele', height: 160, width: 130 },
  // 玩法触发点：复用诗碑剪影，用暖色 tint + 「弈」图标和普通诗碑区分开
  game: { texture: 'node_stele', height: 150, width: 130, tint: 0xf2e0bb },
  // 主路尽头的下一章路牌：用木牌造型，牌面写下一章名字
  gate: { texture: 'node_signpost', height: 150, width: 120 },
};

/** 节点头顶的圆形交互图标：一眼看出这里能做什么 */
const NODE_ICONS = {
  scroll: { text: '诗', fill: C.pineDeep, stroke: C.gold },
  hiddenStele: { text: '？', fill: 0x8c9484, stroke: C.gold },
  npc: { text: '话', fill: 0x7f9a8a, stroke: C.paperSoft },
  sign: { text: '路', fill: 0xb99a63, stroke: C.paperSoft },
  festival: { text: '节', fill: 0xb0624f, stroke: C.goldLight },
  game: { text: '弈', fill: 0xb08348, stroke: C.paperSoft },
  gate: { text: '往', fill: C.pineDeep, stroke: C.goldLight },
};

export class InteractionNode {
  constructor(scene, definition) {
    this.scene = scene;
    this.def = definition;
    this.poem = definition.poem;
    this.poemId = definition.poemId;
    this.isHidden = Boolean(definition.isHidden);
    this.discovered = !this.isHidden;
    this.festivalId = definition.festivalId || null;
    // 下一章路口：用 nextChapterId 判断「这一章是否已经达标」
    this.nextChapterId = definition.nextChapterId || null;
    this.isGate = definition.kind === 'gate';
    this.completed = this.festivalId
      ? progress.hasFestival(this.festivalId)
      : this.poemId
        ? progress.isPoemCompleted(this.poemId)
        : false;
    this.active = false;

    const visual = NODE_VISUALS[definition.kind] || NODE_VISUALS.scroll;
    this.visual = visual;
    this.root = scene.add.container(definition.x, definition.y).setDepth(definition.y);

    // 脚下的淡光，提示这里可以互动
    this.glow = scene.add.graphics();
    this.glow.lineStyle(2, C.gold, 0.36);
    this.glow.strokeEllipse(0, -4, visual.width * 0.72, 28);
    this.glow.fillStyle(C.goldLight, 0.12);
    this.glow.fillEllipse(0, -4, visual.width * 0.72, 28);
    this.root.add(this.glow);

    this.sprite = scene.add
      .sprite(0, 0, visual.texture)
      .setOrigin(0.5, 1)
      .setDepth(1);
    this.root.add(this.sprite);

    if (visual.tint) this.sprite.setTint(visual.tint);

    if (definition.kind === 'npc') {
      scene.tweens.add({
        targets: this.sprite,
        y: -3,
        duration: 1400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // 名牌
    this.label = scene.add.container(0, -visual.height - 26);
    this.labelBg = scene.add.graphics();
    this.labelText = makeText(scene, 0, 0, this._buildLabelText(), {
      size: definition.kind === 'npc' ? 19 : 18,
      color: definition.kind === 'npc' ? S.pineDeep : S.ink,
      origin: [0.5, 0.5],
      wrap: 190,
    });
    this.icon = this._buildIcon(definition.kind);
    this.label.add([this.labelBg, this.labelText, this.icon]);
    this.root.add(this.label);
    this._applyGateLook();
    this._redrawLabelBg();

    // 点击热区
    this.zone = scene.add
      .zone(0, -visual.height / 2, visual.width, visual.height + 34)
      .setInteractive({ useHandCursor: true });
    this.zone.on('pointerdown', () => {
      if (!this.scene.scene.isActive()) return;
      this.scene.onNodeTapped(this);
    });
    this.root.add(this.zone);

    // 已通关的小印
    this.badge = null;
    this._refreshBadge();

    this._applyHiddenState(true, true);

    // 路口的光晕由 _applyGateLook 按解锁状态控制，不参与呼吸动画
    if (!this.isHidden && !this.isGate) {
      scene.tweens.add({
        targets: this.glow,
        alpha: { from: 0.5, to: 1 },
        scaleX: { from: 0.96, to: 1.04 },
        scaleY: { from: 0.96, to: 1.04 },
        duration: 1900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  /** 头顶圆形小图标：诗 / 话 / 路 / ？ / 节 */
  _buildIcon(kind) {
    const meta = NODE_ICONS[kind] || NODE_ICONS.scroll;
    const container = this.scene.add.container(0, 0);
    const radius = 17;
    const graphics = this.scene.add.graphics();
    graphics.fillStyle(0x4b4130, 0.1);
    graphics.fillCircle(0, 3, radius);
    graphics.fillStyle(meta.fill, 0.94);
    graphics.fillCircle(0, 0, radius);
    graphics.lineStyle(1.6, meta.stroke, 0.7);
    graphics.strokeCircle(0, 0, radius - 2);
    const text = makeText(this.scene, 0, 1, meta.text, {
      size: 19,
      color: S.white,
      origin: [0.5, 0.5],
    });
    container.add([graphics, text]);
    // 路口节点需要按解锁状态换字（往 / 封），留个引用
    this.iconText = text;
    return container;
  }

  _buildLabelText() {
    if (this.isHidden && !this.completed && !this.discovered) return '？';
    if (this.poemId && this.completed) {
      const stars = progress.getPoemRecord(this.poemId)?.stars || 0;
      return `${this.def.label}  ★${stars}`;
    }
    if (this.festivalId && this.completed) return `已收下 · ${this.def.label}`;
    if (this.isGate) {
      return this.gateUnlocked ? this.def.label : `${this.def.label} · 未开放`;
    }
    return this.def.label;
  }

  _redrawLabelBg() {
    this.labelText.setText(this._buildLabelText());
    const width = Math.max(96, this.labelText.width + 30);
    const height = this.labelText.height + 14;
    this.labelBg.clear();
    this.labelBg.fillStyle(0x4b4130, 0.1);
    roundedRectPath(this.labelBg, -width / 2 + 1, -height / 2 + 3, width, height, height / 2);
    this.labelBg.fillPath();
    this.labelBg.fillStyle(C.paperSoft, 0.94);
    roundedRectPath(this.labelBg, -width / 2, -height / 2, width, height, height / 2);
    this.labelBg.fillPath();
    this.labelBg.lineStyle(1.2, this.def.kind === 'npc' ? C.pine : C.gold, 0.45);
    roundedRectPath(this.labelBg, -width / 2, -height / 2, width, height, height / 2);
    this.labelBg.strokePath();

    // 小图标挂在名牌左侧，随名牌一起显隐
    if (this.icon) this.icon.setPosition(-width / 2 - 20, 0);
  }

  _refreshBadge() {
    if (!this.poemId && !this.festivalId) return;
    this.completed = this.festivalId
      ? progress.hasFestival(this.festivalId)
      : progress.isPoemCompleted(this.poemId);
    if (this.badge) {
      this.badge.destroy(true);
      this.badge = null;
    }

    if (this.completed) {
      this.badge = this.scene.add.container(this.visual.width * 0.32, -this.visual.height + 16);
      const seal = this.scene.add.graphics();
      seal.fillStyle(C.pineDeep, 0.92);
      seal.fillCircle(0, 0, 15);
      seal.lineStyle(1.5, C.goldLight, 0.7);
      seal.strokeCircle(0, 0, 12);
      const check = makeText(this.scene, 0, 1, '✓', {
        size: 17,
        color: '#fffdf6',
        origin: [0.5, 0.5],
      });
      this.badge.add([seal, check]);
      this.root.add(this.badge);
    }

    this._redrawLabelBg();
    this._applyHiddenState(false);
  }

  refresh() {
    this._refreshBadge();
    // 路口没有绑诗，_refreshBadge 会提前返回；这里单独刷新「往 / 封」与名牌
    if (this.isGate) {
      this._applyGateLook();
      this._redrawLabelBg();
    }
  }

  /**
   * 下一章路牌的外观：开放时木牌原色、图标「往」；未开放时木牌发灰、
   * 名牌后面补「· 未开放」。回到地图时 refresh() 会重新算一遍，
   * 所以刚读完最后一首课内诗，路牌会当场亮起来。
   */
  _applyGateLook() {
    if (!this.isGate) return;
    const unlocked = Boolean(this.nextChapterId) && progress.isChapterUnlocked(this.nextChapterId);
    this.gateUnlocked = unlocked;
    if (unlocked) this.sprite.clearTint();
    else this.sprite.setTint(0xb7bcb2);
    if (this.iconText) this.iconText.setText('往');
    if (this.glow) this.glow.setAlpha(unlocked ? 1 : 0.4);
  }

  _applyHiddenState(immediate = false, initial = false) {
    if (!this.isHidden || this.completed) {
      this.root.setAlpha(1);
      this.label.setVisible(true);
      return;
    }

    if (this.discovered) {
      this.root.setAlpha(0.95);
      this.label.setVisible(true);
      return;
    }

    if (initial) {
      this.root.setAlpha(0);
      this.label.setVisible(false);
    }
  }

  /** 玩家接近隐藏诗碑时，石碑慢慢显形 */
  updateVisibility(playerX, playerY) {
    if (!this.isHidden || this.completed) return;
    const distance = this.getDistance(playerX, playerY);
    const near = distance <= (this.def.appearsRadius || 300);

    if (near && !this.discovered) {
      this.discovered = true;
      this.labelText.setText('？');
      this._redrawLabelBg();
      this.scene.tweens.add({
        targets: this.root,
        alpha: 0.92,
        duration: 700,
        ease: 'Sine.easeOut',
      });
      this.label.setVisible(true);
      this.scene.tweens.add({
        targets: this.label,
        alpha: { from: 0, to: 1 },
        y: { from: this.label.y + 8, to: this.label.y },
        duration: 520,
      });
    } else if (!near && this.discovered && distance > (this.def.appearsRadius || 300) + 130) {
      // 走远后重新隐去，保留“曾经发现”的惊喜感
      this.discovered = false;
      this.scene.tweens.add({
        targets: this.root,
        alpha: 0,
        duration: 500,
        onComplete: () => {
          if (!this.discovered) this.label.setVisible(false);
        },
      });
    }
  }

  setHighlight(active) {
    if (this.active === active) return;
    this.active = active;
    this.scene.tweens.add({
      targets: this.label,
      scaleX: active ? 1.06 : 1,
      scaleY: active ? 1.06 : 1,
      duration: 160,
      ease: 'Sine.easeOut',
    });
    if (this.glow) this.glow.setAlpha(active ? 1 : 0.8);
    if (active && this.isHidden && !this.completed) {
      this.discovered = true;
      this.label.setVisible(true);
      this.scene.tweens.add({ targets: this.root, alpha: 0.95, duration: 260 });
    }
  }

  /** 隐藏诗碑被触碰时，正式显形 */
  revealHidden() {
    if (!this.isHidden || this.completed) return;
    this.discovered = true;
    this.root.setAlpha(1);
    this.label.setVisible(true);
    this.labelText.setText(this.def.label);
    this._redrawLabelBg();
  }

  getDistance(x, y) {
    return Math.hypot(this.def.x - x, this.def.y - y);
  }

  /**
   * 底座碰撞盒（世界坐标）：石碑 / 木牌 / 牧童 / 诗台都是立在地上的实体，
   * 角色不能从碑面上穿过去（以前没有碰撞，走到跟前会整个人穿进碑里）。
   * 隐藏诗碑是半埋的苔痕石，没显形时不能变成一堵隐形墙，所以不给碰撞。
   */
  solidBounds() {
    if (this.isHidden || this.def.kind === 'hiddenStele') return null;
    const width = Math.round((this.visual.width || 120) * 0.52);
    return { x: this.root.x, y: this.root.y - 9, width, height: 18 };
  }

  get isPoemNode() {
    return Boolean(this.poemId);
  }

  get isSign() {
    return this.def.kind === 'sign';
  }

  get isFestival() {
    return this.def.kind === 'festival';
  }
}
