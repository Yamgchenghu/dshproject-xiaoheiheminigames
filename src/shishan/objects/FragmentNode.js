/**
 * FragmentNode：地图上的「逸闻碎片」拾取点。
 * 淡彩宣纸碎片占位图（程序化绘制，不依赖美术资源），轻轻悬浮，
 * 玩家走进触发半径即自动拾取，拾取后节点立即消失（不会重复获取）。
 *
 * 是否已被拾取由 ProgressManager 的碎片存档决定，重新进入地图也不会再出现。
 */

import { C, S } from '../config/theme.js';
import { progress } from '../managers/ProgressManager.js';
import { makeText } from '../ui/components.js';
import { roundedRectPath } from '../ui/background.js';

const LABEL_TEXT = '逸闻碎片';

export class FragmentNode {
  constructor(scene, definition) {
    this.scene = scene;
    this.def = definition;
    this.anecdoteId = definition.anecdoteId;
    this.fragmentIndex = definition.fragmentIndex;
    this.fragmentKey = definition.fragmentKey;
    this.collected = progress.hasAnecdoteFragment(this.anecdoteId, this.fragmentIndex);
    this.active = !this.collected;
    this.triggerRadius = definition.triggerRadius || 78;
    this.appearsRadius = definition.appearsRadius || 300;

    this.root = null;
    this.paper = null;
    this.label = null;

    if (this.collected) return; // 已经拾取过的碎片，不再出现在地图上
    this._build();
  }

  _build() {
    const scene = this.scene;
    const { x, y } = this.def;

    this.root = scene.add.container(x, y).setDepth(Math.round(y) + 40);

    // 脚下淡光：告诉小朋友这里可以捡
    const glow = scene.add.graphics();
    glow.fillStyle(C.goldLight, 0.3);
    glow.fillEllipse(0, -8, 92, 34);
    glow.lineStyle(1.6, C.gold, 0.45);
    glow.strokeEllipse(0, -8, 92, 34);
    this.root.add(glow);

    // 碎片本体：优先用 node_fragment 纹理（可整张换成画师稿）；
    // 纹理不存在时才退回下面这段程序化绘制（正常流程里 generateTextures 会补上）。
    if (scene.textures.exists('node_fragment')) {
      this.paper = scene.add.image(0, -46, 'node_fragment').setOrigin(0.5, 0.5);
      this.root.add(this.paper);
    } else {
      this.paper = scene.add.container(0, -46);

      const back = scene.add.graphics();
      back.fillStyle(C.paperDeep, 0.95);
      roundedRectPath(back, -24, -26, 46, 54, 7);
      back.fillPath();
      back.lineStyle(1.4, C.inkLine, 0.75);
      roundedRectPath(back, -24, -26, 46, 54, 7);
      back.strokePath();
      this.paper.add(back);
      back.setAngle(13).setAlpha(0.9);

      const face = scene.add.graphics();
      face.fillStyle(0x4b4130, 0.1);
      roundedRectPath(face, -22, -23, 46, 54, 8);
      face.fillPath();
      face.fillStyle(C.paperSoft, 0.99);
      roundedRectPath(face, -24, -28, 46, 54, 8);
      face.fillPath();
      face.lineStyle(1.6, C.gold, 0.62);
      roundedRectPath(face, -24, -28, 46, 54, 8);
      face.strokePath();
      // 纸上的两道墨痕（像没写完的诗句）
      face.lineStyle(1.4, C.inkFaint, 0.55);
      face.beginPath();
      face.moveTo(-14, -12);
      face.lineTo(12, -12);
      face.moveTo(-14, -2);
      face.lineTo(6, -2);
      face.strokePath();
      this.paper.add(face);

      const seal = scene.add.graphics();
      seal.fillStyle(C.peachDeep, 0.86);
      roundedRectPath(seal, 2, 4, 16, 16, 4);
      seal.fillPath();
      this.paper.add(seal);
      this.paper.add(
        makeText(scene, 10, 12, '闻', { size: 11, color: '#fff8ef', origin: [0.5, 0.5] }),
      );

      this.root.add(this.paper);
    }

    // 悬浮的小光点
    this.sparks = [];
    [[-34, -60], [30, -80], [18, -24]].forEach(([sx, sy], index) => {
      const spark = scene.add.circle(sx, sy, index === 1 ? 2.6 : 1.9, C.gold, 0.85);
      this.root.add(spark);
      this.sparks.push(spark);
      scene.tweens.add({
        targets: spark,
        alpha: { from: 0.85, to: 0.2 },
        duration: 900 + index * 260,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    });

    // 名牌
    this.label = scene.add.container(0, -104);
    const labelBg = scene.add.graphics();
    const text = makeText(scene, 0, 0, LABEL_TEXT, {
      size: 16,
      color: S.gold,
      origin: [0.5, 0.5],
    });
    const labelWidth = Math.max(96, text.width + 30);
    const labelHeight = text.height + 12;
    labelBg.fillStyle(0x4b4130, 0.08);
    roundedRectPath(labelBg, -labelWidth / 2 + 1, -labelHeight / 2 + 3, labelWidth, labelHeight, labelHeight / 2);
    labelBg.fillPath();
    labelBg.fillStyle(C.paperSoft, 0.95);
    roundedRectPath(labelBg, -labelWidth / 2, -labelHeight / 2, labelWidth, labelHeight, labelHeight / 2);
    labelBg.fillPath();
    labelBg.lineStyle(1.2, C.gold, 0.5);
    roundedRectPath(labelBg, -labelWidth / 2, -labelHeight / 2, labelWidth, labelHeight, labelHeight / 2);
    labelBg.strokePath();
    this.label.add([labelBg, text]);
    this.root.add(this.label);

    // 悬浮动画
    scene.tweens.add({
      targets: this.paper,
      y: -54,
      angle: { from: -2, to: 3 },
      duration: 1800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    scene.tweens.add({
      targets: this.label,
      y: -110,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    scene.tweens.add({
      targets: glow,
      alpha: { from: 0.55, to: 1 },
      scaleX: { from: 0.94, to: 1.06 },
      scaleY: { from: 0.94, to: 1.06 },
      duration: 1700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** 每帧由地图场景调用：走进触发半径就自动拾取 */
  update(playerX, playerY) {
    if (!this.active || !this.root) return;

    // 走远时名牌淡一点，走近再亮起来，减少画面噪声
    const distance = this.getDistance(playerX, playerY);
    if (this.label) {
      const near = distance <= this.appearsRadius;
      this.label.setAlpha(near ? 1 : 0.35);
    }

    if (distance <= this.triggerRadius) this.collect();
  }

  collect() {
    if (!this.active) return;
    this.active = false;

    const scene = this.scene;
    const root = this.root;

    if (this.label) scene.tweens.add({ targets: this.label, alpha: 0, y: this.label.y - 12, duration: 220 });
    if (this.paper) {
      scene.tweens.add({
        targets: this.paper,
        scaleX: 1.35,
        scaleY: 1.35,
        alpha: 0,
        y: this.paper.y - 26,
        duration: 320,
        ease: 'Back.easeIn',
      });
    }
    this.sparks.forEach((spark) => {
      scene.tweens.add({
        targets: spark,
        alpha: 0,
        scaleX: 2.2,
        scaleY: 2.2,
        duration: 260,
      });
    });
    if (root) {
      scene.time.delayedCall(340, () => {
        if (root.scene) root.destroy(true);
      });
    }
    this.root = null;

    if (typeof scene.onFragmentCollected === 'function') {
      scene.onFragmentCollected(this);
    }
  }

  getDistance(x, y) {
    return Math.hypot(this.def.x - x, this.def.y - y);
  }

  destroy() {
    this.active = false;
    if (this.root) {
      this.root.destroy(true);
      this.root = null;
    }
  }
}
