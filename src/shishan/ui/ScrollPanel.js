/**
 * ScrollPanel：纸卡内可拖拽滚动的容器。
 * 支持手指拖动与鼠标滚轮，供图鉴详情、错题列表、轶事列表使用。
 */

import Phaser from 'phaser';

import { C } from '../config/theme.js';

export class ScrollPanel {
  constructor(scene, options = {}) {
    const {
      x = 200,
      y = 160,
      width = 880,
      height = 400,
      radius = 20,
      depth = 120,
      onScroll = null,
      scrollbarOffset = 0,
    } = options;

    this.scene = scene;
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.radius = radius;
    this.depth = depth;
    // 滚动条跟着窗口右沿画；内容贴边时可把它往外挪几像素，免得压住卡片
    this.scrollbarOffset = scrollbarOffset;
    this.contentHeight = height;
    this.scrollY = 0;
    this.dragging = false;
    this.dragPointerId = null;
    this.destroyed = false;
    // 滚动回调：调用方可以据此裁掉窗口外的条目（避免「看不见却能点到」）
    this.onScroll = onScroll;

    // 内容容器（调用方往里加对象时使用相对坐标，从 0,0 开始）
    this.content = scene.add
      .container(x, y)
      .setDepth(depth)
      .setScrollFactor(0);

    // 遮罩：只显示纸卡内部
    this.maskShape = scene.make.graphics({ x: 0, y: 0, add: false });
    this.maskShape.fillStyle(0xffffff);
    this.maskShape.fillRoundedRect(x, y, width, height, radius);
    this.mask = this.maskShape.createGeometryMask();
    this.content.setMask(this.mask);

    // 滚动条
    this.scrollbar = scene.add.graphics().setDepth(depth + 2).setScrollFactor(0);

    // 拖拽热区放在内容下方，避免挡住卡片里的按钮
    this.zone = scene.add
      .zone(x + width / 2, y + height / 2, width, height)
      .setDepth(depth - 1)
      .setScrollFactor(0)
      .setInteractive();

    this.onPointerDown = (pointer) => {
      this.dragging = true;
      this.dragPointerId = pointer.id;
      this.dragStartY = pointer.y;
      this.dragStartScroll = this.scrollY;
    };
    this.onPointerMove = (pointer) => {
      if (!this.dragging || pointer.id !== this.dragPointerId) return;
      const delta = pointer.y - this.dragStartY;
      this._setScroll(this.dragStartScroll - delta);
    };
    this.onPointerUp = (pointer) => {
      if (pointer.id !== this.dragPointerId) return;
      this.dragging = false;
      this.dragPointerId = null;
    };
    this.onWheel = (pointer, gameObjects, deltaX, deltaY) => {
      const inside =
        pointer.x >= this.x &&
        pointer.x <= this.x + this.width &&
        pointer.y >= this.y &&
        pointer.y <= this.y + this.height;
      if (!inside) return;
      this._setScroll(this.scrollY + deltaY * 0.4);
    };

    this.zone.on('pointerdown', this.onPointerDown);
    scene.input.on('pointermove', this.onPointerMove);
    scene.input.on('pointerup', this.onPointerUp);
    scene.input.on('wheel', this.onWheel);

    scene.events.once('shutdown', () => this.destroy());
  }

  _maxScroll() {
    return Math.max(0, this.contentHeight - this.height);
  }

  _setScroll(value) {
    if (this.destroyed) return;
    this.scrollY = Phaser.Math.Clamp(value, 0, this._maxScroll());
    this.content.y = this.y - this.scrollY;
    this._drawScrollbar();
    if (this.onScroll) this.onScroll(this.scrollY);
  }

  _drawScrollbar() {
    if (this.destroyed) return;
    this.scrollbar.clear();
    const max = this._maxScroll();
    if (max <= 0) return;

    const trackX = this.x + this.width - 7 + this.scrollbarOffset;
    const trackY = this.y + 8;
    const trackHeight = this.height - 16;
    const thumbHeight = Math.max(34, (this.height / this.contentHeight) * trackHeight);
    const thumbY = trackY + (this.scrollY / max) * (trackHeight - thumbHeight);

    this.scrollbar.fillStyle(C.inkFaint, 0.22);
    this.scrollbar.fillRoundedRect(trackX - 2, trackY, 4, trackHeight, 2);
    this.scrollbar.fillStyle(C.pine, 0.55);
    this.scrollbar.fillRoundedRect(trackX - 3, thumbY, 6, thumbHeight, 3);
  }

  /** 添加对象到滚动内容中（对象会被重新挂载到 content 容器） */
  add(...objects) {
    this.content.add(objects);
    return this;
  }

  /** 设置完整内容高度并重排 */
  layout(contentHeight, { reset = false } = {}) {
    this.contentHeight = Math.max(this.height, contentHeight);
    if (reset) this.scrollY = 0;
    this._setScroll(this.scrollY);
    return this;
  }

  scrollToTop() {
    this._setScroll(0);
  }

  /** 外部（例如图鉴网格自己处理的拖动）设置滚动位置，会自动夹在合法范围内 */
  setScroll(value) {
    this._setScroll(value);
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    this.zone.off('pointerdown', this.onPointerDown);
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerup', this.onPointerUp);
    this.scene.input.off('wheel', this.onWheel);

    if (this.mask) this.mask.destroy();
    if (this.maskShape) this.maskShape.destroy();
    if (this.content) this.content.destroy(true);
    if (this.scrollbar) this.scrollbar.destroy();
    if (this.zone) this.zone.destroy();
  }
}
