/**
 * MenuScene：主菜单。
 * 开始游历 / 诗卡图鉴 / 逸闻册 / 错题书斋 / 藏品陈列馆 / 设置
 */

import { GAME_WIDTH, SCENES } from '../config/constants.js';
import { CHAPTERS } from '../config/chapters.js';
import { C, FONT_SIZE, S } from '../config/theme.js';
import { audio } from '../managers/AudioManager.js';
import { progress } from '../managers/ProgressManager.js';
import BaseScene from '../ui/BaseScene.js';
import { addSeal } from '../ui/background.js';
import {
  createButton,
  createPaperPanel,
  makeText,
} from '../ui/components.js';
import { addDebugTools } from '../ui/devTools.js';

export default class MenuScene extends BaseScene {
  constructor() {
    super(SCENES.MENU);
  }

  create() {
    this.prepareScene();
    this.addBackground('garden', { petals: true });
    audio.playSceneBgm('MenuScene');

    this._buildHero();
    this._buildButtons();
    // 调试快捷入口：仅开发环境出现，打包后自动隐藏
    addDebugTools(this);
  }

  _buildHero() {
    // 标题与印章
    addSeal(this, 92, 92, '诗', 52, C.peachDeep).setDepth(10);
    makeText(this, 78, 156, '诗山寻踪', {
      size: 76,
      color: S.ink,
      origin: [0, 0.5],
      bold: true,
    }).setDepth(10);

    makeText(this, 84, 218, '跟着古诗，去山野里走一走', {
      size: 22,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(10);

    const line = this.add.graphics().setDepth(10);
    line.lineStyle(1.5, C.gold, 0.55);
    line.beginPath();
    line.moveTo(84, 248);
    line.lineTo(448, 248);
    line.strokePath();
    line.fillStyle(C.gold, 0.7);
    line.fillCircle(466, 248, 3);

    makeText(this, 84, 278, '读一首诗，走一段山路。', {
      size: 20,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(10);

    // 绘本小景
    if (this.textures.exists('tree_round')) {
      this.add
        .image(36, 712, 'tree_round')
        .setOrigin(0.5, 1)
        .setScale(0.78)
        .setDepth(5);
    }
    if (this.textures.exists('pavilion')) {
      this.add
        .image(560, 704, 'pavilion')
        .setOrigin(0.5, 1)
        .setScale(1.05)
        .setDepth(6);
    }
    if (this.textures.exists('poem_boy_idle')) {
      const boy = this.add
        .image(360, 682, 'poem_boy_idle')
        .setOrigin(0.5, 1)
        .setScale(1.35)
        .setDepth(12);
      this.tweens.add({
        targets: boy,
        y: 676,
        duration: 1500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    if (this.textures.exists('petal')) {
      this.add
        .image(486, 350, 'petal')
        .setAlpha(0.65)
        .setScale(1.6)
        .setAngle(24)
        .setDepth(11);
      this.add
        .image(620, 300, 'petal')
        .setAlpha(0.45)
        .setScale(1.1)
        .setAngle(-36)
        .setDepth(11);
    }

    // 左下角存档说明
    makeText(this, 72, 680, '离线单机 · 存档只保存在本机', {
      size: 13,
      color: S.inkFaint,
      origin: [0, 0.5],
    }).setDepth(20);

    makeText(this, GAME_WIDTH - 34, 34, '离线版 · 不联网', {
      size: 13,
      color: S.inkFaint,
      origin: [1, 0.5],
    }).setDepth(20);
  }

  _buildButtons() {
    const columnX = 970;
    const totalCompleted = progress.getCompletedPoemCount();
    const totalPoems = progress.getTotalPoemCount();

    createButton(this, {
      x: columnX,
      y: 138,
      width: 520,
      height: 86,
      label: totalCompleted > 0 ? '继续游历' : '开始游历',
      subLabel: '青芽谷 · 溪边草甸',
      variant: 'primary',
      fontSize: 29,
      subFontSize: 15,
      onClick: () => this.goTo(SCENES.CHAPTER_SELECT, {}),
      depth: 100,
    });

    const items = [
      {
        label: '诗卡图鉴',
        subLabel: `已点亮 ${progress.getUnlockedCardIds().length} / ${totalPoems}`,
        action: () => this.goTo(SCENES.POEM_BOOK, {}),
      },
      {
        label: '自由诗笺',
        subLabel: `已抄 ${progress.getExcerptCount()} 张 · 节气诗笺 ${progress.getFestivalRecords().length} 枚`,
        action: () => this.goTo(SCENES.EXCERPT, {}),
      },
      {
        label: '逸闻册',
        subLabel: `已收集 ${progress.getAnecdoteIds().length} 段文人轶事`,
        action: () => this.goTo(SCENES.ANECDOTE, {}),
      },
      {
        label: '错题书斋',
        subLabel:
          progress.getWrongCount() > 0
            ? `有 ${progress.getWrongCount()} 首诗等你再读`
            : '书斋里干干净净',
        action: () => this.goTo(SCENES.REVIEW, {}),
      },
      {
        label: '藏品陈列馆',
        subLabel: '看看寻到的文房小物',
        action: () => this.goTo(SCENES.COLLECTION, {}),
      },
      {
        label: '设置',
        subLabel: '难度 · 音效 · 存档',
        action: () => this.goTo(SCENES.SETTING, {}),
      },
    ];

    items.forEach((item, index) => {
      createButton(this, {
        x: columnX,
        y: 238 + index * 70,
        width: 520,
        height: 62,
        label: item.label,
        subLabel: item.subLabel,
        variant: 'secondary',
        fontSize: FONT_SIZE.md,
        subFontSize: 13,
        onClick: item.action,
        depth: 100,
      });
    });

    // 存档概览
    const summary = createPaperPanel(this, {
      x: columnX,
      y: 662,
      width: 520,
      height: 46,
      radius: 20,
      fill: C.paperSoft,
      fillAlpha: 0.72,
      depth: 90,
      shadow: false,
    });
    summary.setAlpha(0.9);

    const overall = this._getOverallProgress();
    makeText(
      this,
      columnX,
      662,
      `课内总进度 ${overall.percent}%　·　毛笔 × ${progress.getBrushCount()}　·　错题 ${progress.getWrongCount()}`,
      { size: 14, color: S.inkSoft, origin: [0.5, 0.5] },
    ).setDepth(100);
  }

  _getOverallProgress() {
    let total = 0;
    let completed = 0;
    CHAPTERS.forEach((chapter) => {
      const status = progress.getChapterStatus(chapter.id);
      total += status.coreTotal;
      completed += status.coreCompleted;
    });
    return {
      total,
      completed,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  }
}


