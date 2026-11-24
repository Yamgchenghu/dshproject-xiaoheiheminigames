/**
 * VirtualJoystick：左下角虚拟摇杆。
 * 支持手指拖动，输出 -1..1 的方向向量；桌面上仍可用方向键/WASD。
 */

import Phaser from 'phaser';

import { C } from '../config/theme.js';
import { makeText } from '../ui/components.js';

export class VirtualJoystick {
  constructor(scene, options = {}) {
    const {
      x = 150,
      y = 608,
      radius = 70,
      knobRadius = 30,
      depth = 2200,
    } = options;

    this.scene = scene;
    this.centerX = x;
    this.centerY = y;
    this.radius = radius;
    this.knobRadius = knobRadius;
    this.maxDistance = radius - 10;
    this.deadZone = 0.18;
    this.vector = { x: 0, y: 0 };
    this.activePointerId = null;
    this.destroyed = false;

    this.root = scene.add.container(x, y).setDepth(depth).setScrollFactor(0);

    const base = scene.add.graphics();
    base.fillStyle(C.paperSoft, 0.55);
    base.fillCircle(0, 0, radius + 9);
    base.lineStyle(2, C.pine, 0.35);
    base.strokeCircle(0, 0, radius + 9);
    base.fillStyle(C.paper, 0.9);
    base.fillCircle(0, 0, radius);
    base.lineStyle(2, C.pine, 0.42);
    base.strokeCircle(0, 0, radius);
    base.lineStyle(1, 0xffffff, 0.65);
    base.strokeCircle(0, 0, radius - 5);

    // 四个很轻的方向刻痕
    base.fillStyle(C.pine, 0.28);
    [
      [0, -radius + 16, 0],
      [0, radius - 16, Math.PI],
      [-radius + 16, 0, Math.PI / 2],
      [radius - 16, 0, -Math.PI / 2],
    ].forEach(([ax, ay, rotation]) => {
      base.save();
      base.translateCanvas(ax, ay);
      base.rotateCanvas(rotation);
      base.fillTriangle(0, -7, -6, 4, 6, 4);
      base.restore();
    });

    this.knob = scene.add.graphics();
    this._drawKnob(false);

    const hint = makeText(scene, 0, radius + 30, '游历', {
      size: 15,
      color: '#746b5b',
    }).setAlpha(0.7);

    const zone = scene.add
      .zone(0, 0, (radius + 36) * 2, (radius + 36) * 2)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });

    this.root.add([base, this.knob, hint, zone]);
    this.zone = zone;

    this.onPointerDown = (pointer) => {
      if (this.activePointerId !== null) return;
      this.activePointerId = pointer.id;
      this._drawKnob(true);
      this._updateFromPointer(pointer);
    };
    this.onPointerMove = (pointer) => {
      if (pointer.id !== this.activePointerId) return;
      this._updateFromPointer(pointer);
    };
    this.onPointerUp = (pointer) => {
      if (pointer.id !== this.activePointerId) return;
      this.reset();
    };

    zone.on('pointerdown', this.onPointerDown);
    scene.input.on('pointermove', this.onPointerMove);
    scene.input.on('pointerup', this.onPointerUp);
    scene.input.on('pointerupoutside', this.onPointerUp);

    scene.events.once('shutdown', () => this.destroy());
  }

  _drawKnob(active) {
    this.knob.clear();
    this.knob.fillStyle(0x4c6052, active ? 0.18 : 0.12);
    this.knob.fillCircle(0, 5, this.knobRadius);
    this.knob.fillStyle(active ? C.pineDeep : C.pine, 0.92);
    this.knob.fillCircle(0, 0, this.knobRadius);
    this.knob.lineStyle(2, 0xfffdf6, 0.62);
    this.knob.strokeCircle(0, 0, this.knobRadius - 3);
    this.knob.fillStyle(0xffffff, 0.3);
    this.knob.fillEllipse(-8, -8, 16, 9);
  }

  _updateFromPointer(pointer) {
    let dx = pointer.x - this.centerX;
    let dy = pointer.y - this.centerY;
    const distance = Math.hypot(dx, dy);

    if (distance > this.maxDistance) {
      dx = (dx / distance) * this.maxDistance;
      dy = (dy / distance) * this.maxDistance;
    }

    this.knob.setPosition(dx, dy);

    const nx = dx / this.maxDistance;
    const ny = dy / this.maxDistance;
    const magnitude = Math.hypot(nx, ny);
    if (magnitude < this.deadZone) {
      this.vector.x = 0;
      this.vector.y = 0;
    } else {
      // 死区内缩，随后按比例恢复到 0..1
      const remapped = (magnitude - this.deadZone) / (1 - this.deadZone);
      this.vector.x = (nx / magnitude) * remapped;
      this.vector.y = (ny / magnitude) * remapped;
    }
  }

  getVector() {
    return { ...this.vector };
  }

  reset() {
    this.activePointerId = null;
    this.vector.x = 0;
    this.vector.y = 0;
    this.knob.setPosition(0, 0);
    this._drawKnob(false);
  }

  setVisible(visible) {
    this.root.setVisible(visible);
    this.zone.setActive(visible);
    if (!visible) this.reset();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.zone.off('pointerdown', this.onPointerDown);
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerup', this.onPointerUp);
    this.scene.input.off('pointerupoutside', this.onPointerUp);
    this.root.destroy(true);
  }
}
