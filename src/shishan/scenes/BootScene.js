/**
 * BootScene：启动与数据装载。
 * 1. 读取 poem_db.json / anecdote_db.json / collection_db.json
 * 2. 初始化 DataManager
 * 3. 初始化 ProgressManager 并校验/修复本地存档
 * 4. 交给 PreloadScene 生成纹理资源
 */

import Phaser from 'phaser';

import { SCENES, GAME_WIDTH } from '../config/constants.js';
import { FONT_FAMILY, S } from '../config/theme.js';
import { dataManager } from '../data/DataManager.js';
import { progress } from '../managers/ProgressManager.js';
import { POEM_DB, ANECDOTE_DB, COLLECTION_DB } from '../data-bundle.js';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENES.BOOT);
  }

  preload() {
    this._buildLoadingScreen();

    this.load.on('progress', (value) => {
      this._setProgress(value);
    });

    this.load.on('loaderror', (file) => {
      console.error('[启动] 资源读取失败：', file?.src || file?.key);
      // 藏品是支线数据：缺文件只提示，不影响诗篇与轶事正常进入
      if (file?.key !== 'collection_db') this._loadError = true;
    });

    // 【为什么这里不再 this.load.json】小程序 CSP 的 connect-src 不放行
    //   普通 HTTP 请求，Phaser loader 读 JSON 会被拒绝。数据改为打包进
    //   JS 模块（见 data-bundle.js），preload 阶段无事可做。
  }

  create() {
    // 【为什么 create 是 async】存档现在在云端，读取是异步的。
    //   必须等 progress.init 真正读完再 start 下一个场景，
    //   否则 PreloadScene/MenuScene 会读到还没赋值的 save，显示成全新进度。
    this._boot();
  }

  async _boot() {
    if (this._loadError) {
      this._showFatal('诗卷没有打开', '古诗数据没有装载成功。\n请检查 data-bundle.js 里的三个数据文件是否完整。');
      return;
    }

    // 数据来自打包进 bundle 的 JS 模块，不再经过网络
    const poems = POEM_DB;
    const anecdotes = ANECDOTE_DB;
    const collections = COLLECTION_DB;

    if (!Array.isArray(poems)) {
      this._showFatal('诗卷内容为空', '古诗数据格式不正确（应为数组）。\n请检查 poem_db.json 的内容。');
      return;
    }

    const issues = dataManager.init(
      poems,
      Array.isArray(anecdotes) ? anecdotes : [],
      // 藏品是支线数据：读不到也只是展柜空着，不阻塞主线
      Array.isArray(collections) ? collections : [],
    );
    if (!dataManager.ready) {
      this._showFatal('诗山还未成形', '诗词数据为空，无法开始游历。');
      return;
    }

    // 初始化存档：内部会校验、修复旧数据，并计算章节解锁状态。
    // 云端读取失败时 progress 会回退到默认存档，不会卡住启动。
    try {
      await progress.init(dataManager);
    } catch (error) {
      console.warn('[启动] 存档初始化失败，使用默认进度：', error);
    }

    this._printDataReport(issues);

    // 短暂的“落笔”停顿，避免画面闪跳
    this.time.delayedCall(260, () => {
      this.scene.start(SCENES.PRELOAD, { issues });
    });
  }

  _buildLoadingScreen() {
    const graphics = this.add.graphics();
    graphics.fillGradientStyle(0xfbf8ee, 0xfbf8ee, 0xf1e8d5, 0xe8efdf, 1);
    graphics.fillRect(0, 0, GAME_WIDTH, this.scale.height);
    graphics.fillStyle(0x9db79e, 0.12);
    graphics.fillEllipse(260, 560, 700, 260);
    graphics.fillEllipse(980, 600, 760, 300);
    graphics.fillStyle(0xc9a45c, 0.25);
    graphics.fillCircle(1040, 140, 54);

    // 很轻的墨点
    for (let i = 0; i < 30; i += 1) {
      graphics.fillStyle(0x746b5b, 0.05);
      graphics.fillCircle((i * 173 + 90) % 1280, (i * 97 + 140) % 720, 1 + (i % 4));
    }

    this.loadingText = this.add
      .text(640, 320, '正在展开诗卷……', {
        fontFamily: FONT_FAMILY,
        fontSize: '34px',
        color: S.ink,
      })
      .setOrigin(0.5);
    this.loadingText.setResolution(2);

    this.add
      .text(640, 372, '诗山寻踪 · 离线国风古诗游历', {
        fontFamily: FONT_FAMILY,
        fontSize: '17px',
        color: S.inkSoft,
      })
      .setOrigin(0.5);

    const barWidth = 360;
    this.loadingBar = this.add.graphics();
    this.loadingBar.fillStyle(0xe4d9c4, 0.8);
    this.loadingBar.fillRoundedRect(640 - barWidth / 2, 420, barWidth, 10, 5);

    this.loadingFill = this.add.graphics();
    this._setProgress(0);
  }

  _setProgress(value) {
    if (!this.loadingFill) return;
    const barWidth = 360;
    const width = Math.max(8, barWidth * Phaser.Math.Clamp(value, 0, 1));
    this.loadingFill.clear();
    this.loadingFill.fillStyle(0x7d9d8b, 1);
    this.loadingFill.fillRoundedRect(640 - barWidth / 2, 420, width, 10, 5);
  }

  _showFatal(title, message) {
    if (this.loadingText) this.loadingText.setText(title);
    this.add
      .text(640, 380, message, {
        fontFamily: FONT_FAMILY,
        fontSize: '19px',
        color: S.inkSoft,
        align: 'center',
        lineSpacing: 12,
        wordWrap: { width: 720, useAdvancedWrap: true },
      })
      .setOrigin(0.5, 0);
  }

  _printDataReport(issues) {
    const collectionText = dataManager.getCollectionCount() > 0
      ? `，${dataManager.getCollectionCount()} 件文房藏品`
      : '';
    if (!issues || issues.length === 0) {
      console.info(`[诗山] 数据载入完成：${dataManager.getAllPoems().length} 首诗，${dataManager.getAllAnecdotes().length} 段轶事${collectionText}。`);
      return;
    }
    console.group('[诗山] 数据校验提示');
    issues.forEach((issue) => {
      if (issue.level === 'error') console.error(issue.message);
      else console.warn(issue.message);
    });
    console.groupEnd();
  }
}
