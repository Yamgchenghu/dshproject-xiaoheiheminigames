/**
 * BaseScene：所有常规场景的父类。
 * 统一转场、返回按钮、吐司、弹窗、关卡跳板与音效入口，
 * 让后续新增片区/玩法时只需要关心自己的内容。
 */

import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH, SCENES } from '../config/constants.js';
import { audio } from '../managers/AudioManager.js';
import { addGrainOverlay, addPaperBackground } from './background.js';
import { createHeader, showModal, showToast } from './components.js';

export default class BaseScene extends Phaser.Scene {
  constructor(key) {
    super({ key });
    this.sceneKey = key;
    this._navigating = false;
  }

  /** 每个场景 create() 开头调用：淡入 + 首次触摸唤醒音频 */
  prepareScene() {
    this.cameras.main.fadeIn(220, 248, 242, 228);
    this.input.once('pointerdown', () => audio.unlock());
    this._navigating = false;
  }

  addBackground(palette = 'garden', options = {}) {
    return addPaperBackground(this, palette, options);
  }

  addHeader(options = {}) {
    return createHeader(this, options);
  }

  playClick() {
    audio.playClick();
  }

  /**
   * 淡出并切换到目标场景。
   * 带 _navigating 锁，防止小朋友连点导致重复切换。
   */
  goTo(key, data = {}, options = {}) {
    const { fade = true, duration = 200 } = options;
    if (this._navigating) return;
    this._navigating = true;
    audio.playPage();

    if (!fade) {
      this.scene.start(key, data);
      return;
    }

    const camera = this.cameras.main;
    camera.fadeOut(duration, 248, 242, 228);
    camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this._navigating = false;
      this.scene.start(key, data);
    });
  }

  /**
   * 打开通用关卡跳板（默认看图猜诗），当前场景暂停。
   * @param {number} poemId
   * @param {object} options { mode, review }
   */
  openLevel(poemId, options = {}) {
    if (this._navigating) return;
    const returnScene = this.scene.key;
    this.scene.launch(SCENES.LEVEL, {
      poemId,
      returnScene,
      mode: options.mode || 'guess_poem',
      review: Boolean(options.review),
    });
    this.scene.bringToTop(SCENES.LEVEL);
    this.scene.pause();
  }

  showToast(message, options = {}) {
    return showToast(this, message, options);
  }

  showModal(options = {}) {
    return showModal(this, options);
  }

  /** 兼容其他场景的布局常量 */
  get width() {
    return GAME_WIDTH;
  }

  get height() {
    return GAME_HEIGHT;
  }

  addGrain(alpha = 0.16) {
    return addGrainOverlay(this, 880, alpha);
  }
}
