/**
 * PreloadScene：资源预加载。
 * 背景、角色等图形由 Canvas 程序化生成；
 * 绘本插画由 scripts/art/generate-art.mjs 批量出图后，
 * 依据 src/data/artManifest.json 在这里统一预加载（没有图时场景回退到占位画）。
 *
 * 场景美术（地图底图 / 人物 / 地图物品 / 对话框皮肤）同理：
 * 依据 src/data/sceneArtManifest.json 预加载同名纹理，纹理存在时 textures.js
 * 会跳过程序化绘制；删掉图片并刷新 manifest 即可回到程序化效果。
 */

import Phaser from 'phaser';

import { SCENES, GAME_WIDTH } from '../config/constants.js';
import { FONT_FAMILY, S } from '../config/theme.js';
import { audio } from '../managers/AudioManager.js';
import { listArtItems } from '../gameplay/artLibrary.js';
import { generateTextures } from '../world/textures.js';
import sceneArtManifest from '../data/sceneArtManifest.json';
import { shishanAsset } from '../asset-base.js';

export default class PreloadScene extends Phaser.Scene {
  constructor() {
    super(SCENES.PRELOAD);
  }

  preload() {
    this._buildLoadingView();

    // ---------------------------------------------------------
    // 绘本插画：由 scripts/art/generate-art.mjs 生成，manifest 里有什么就加载什么
    // （没有生成过插画时 manifest.items 为空，各场景会自动回退到占位画）
    // ---------------------------------------------------------
    const artworks = listArtItems();
    artworks.forEach((item) => {
      // 图片实际放在 public/shishan/assets/images/ 下，manifest 里是相对路径
      if (item && item.key && item.file) this.load.image(item.key, shishanAsset(item.file));
    });

    // ---------------------------------------------------------
    // 场景美术覆盖图：manifest 只登记真实存在的图，没登记的 key 继续程序化绘制
    // （文件由 scripts/art-scene/import-scene-art.mjs 导入，见 docs/art-scene-rebuild/）
    // ---------------------------------------------------------
    const sceneArtItems = Array.isArray(sceneArtManifest?.items) ? sceneArtManifest.items : [];
    sceneArtItems.forEach((item) => {
      if (item && item.key && item.file) this.load.image(item.key, shishanAsset(item.file));
    });

    if (artworks.length > 0 || sceneArtItems.length > 0) {
      const parts = [];
      if (artworks.length > 0) parts.push(`${artworks.length} 张绘本插画`);
      if (sceneArtItems.length > 0) parts.push(`${sceneArtItems.length} 张场景贴图`);
      this.statusText.setText(`正在铺开 ${parts.join('、')}……`);
    }

    // ---------------------------------------------------------
    // 背景音乐：默认用 AudioManager 的程序化古琴小曲（离线、零素材）。
    // 想换成真实 mp3 时，把文件放进 public/assets/audio/ 并打开下面注释即可，
    // key 必须是 bgm_<曲目名>（见 managers/AudioManager.js 的 BGM_TRACKS）：
    // bgm_menu / bgm_chapter1~bgm_chapter6 / bgm_level / bgm_festival
    // 没有加载到文件时 AudioManager 会自动回退到合成曲，不会报错。
    // ---------------------------------------------------------
    // this.load.audio('bgm_menu', 'assets/audio/bgm_menu.mp3');
    // this.load.audio('bgm_chapter1', 'assets/audio/bgm_chapter1.mp3');
    // this.load.audio('bgm_level', 'assets/audio/bgm_level.mp3');
    // this.load.audio('bgm_festival', 'assets/audio/bgm_festival.mp3');

    this.load.on('progress', (value) => {
      this._setProgress(value);
    });
  }

  create() {
    this._setProgress(0.6);
    generateTextures(this);
    this._setProgress(0.85);

    this.statusText.setText('诗卷铺好了，准备出发……');
    this._setProgress(1);

    this.time.delayedCall(420, () => {
      audio.playBgm('menu');
      this.scene.start(SCENES.MENU);
    });
  }

  _buildLoadingView() {
    const graphics = this.add.graphics();
    graphics.fillGradientStyle(0xfbf8ee, 0xfbf8ee, 0xf1e8d5, 0xe7f0df, 1);
    graphics.fillRect(0, 0, GAME_WIDTH, this.scale.height);
    graphics.fillStyle(0x9db79e, 0.1);
    graphics.fillEllipse(260, 580, 720, 260);
    graphics.fillEllipse(990, 620, 740, 280);
    graphics.fillStyle(0xe5d2a3, 0.24);
    graphics.fillCircle(1036, 142, 62);
    graphics.lineStyle(2, 0x7d9d8b, 0.16);
    graphics.beginPath();
    graphics.moveTo(300, 500);
    graphics.lineTo(480, 350);
    graphics.lineTo(640, 480);
    graphics.lineTo(820, 320);
    graphics.lineTo(1000, 490);
    graphics.strokePath();

    this.add
      .text(640, 316, '铺开纸，研好墨', {
        fontFamily: FONT_FAMILY,
        fontSize: '32px',
        color: S.ink,
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2);

    this.statusText = this.add
      .text(640, 370, '正在准备画笔与诗卡……', {
        fontFamily: FONT_FAMILY,
        fontSize: '17px',
        color: S.inkSoft,
      })
      .setOrigin(0.5);

    const barWidth = 340;
    this.bar = this.add.graphics();
    this.bar.fillStyle(0xe4d9c4, 0.8);
    this.bar.fillRoundedRect(640 - barWidth / 2, 418, barWidth, 9, 4);

    this.fill = this.add.graphics();
  }

  _setProgress(value) {
    if (!this.fill) return;
    const barWidth = 340;
    const width = Math.max(7, barWidth * Phaser.Math.Clamp(value, 0, 1));
    this.fill.clear();
    this.fill.fillStyle(0x7d9d8b, 1);
    this.fill.fillRoundedRect(640 - barWidth / 2, 418, width, 9, 4);
  }
}
