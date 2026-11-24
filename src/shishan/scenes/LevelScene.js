/**
 * LevelScene：通用关卡跳板（叠加在来源场景之上）。
 * ------------------------------------------------------------
 * 职责：
 *  - 画关卡纸卡外壳（遮罩、标题、毛笔数量、返回）
 *  - 从玩法注册表加载具体玩法（当前只有「看图猜诗」）
 *  - 统一结算：答对后调用 ProgressManager.markPoemComplete 自动存档
 *  - 展示星级、诗卡、轶事、藏品、新章节等收获
 *  - 关闭时恢复（resume）来源场景，让地图/错题书斋刷新
 *
 * 后续新增玩法模块时，这里基本不需要改动。
 */

import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH, SCENES } from '../config/constants.js';
import { C, S } from '../config/theme.js';
import { dataManager } from '../data/DataManager.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import { getChapterConfig, getChapterName } from '../config/chapters.js';
import { getDifficultyConfig } from '../config/difficulty.js';
import {
  createButton,
  createIconButton,
  createPaperPanel,
  createStarRow,
  makeText,
  showModal,
  showToast,
} from '../ui/components.js';
import { addSeal, addDimOverlay } from '../ui/background.js';
import { ScrollPanel } from '../ui/ScrollPanel.js';
import { addRecitationButton } from '../ui/poemRecitation.js';
import { createLevelModule, getLevelModule } from '../gameplay/levelRegistry.js';
import { maybeDropAnecdoteFragment } from '../gameplay/anecdoteFragments.js';
import { maybeDropCollection } from '../gameplay/collectionRewards.js';

export default class LevelScene extends Phaser.Scene {
  constructor() {
    super(SCENES.LEVEL);
  }

  init(data = {}) {
    this.poemId = Number(data.poemId);
    this.returnScene = data.returnScene || SCENES.MAP;
    this.mode = data.mode || 'guess_poem';
    this.review = Boolean(data.review);

    this._solved = false;
    this._resultShown = false;
    this._closing = false;
    this._confirmOpen = false;
    this.result = null;
    this.module = null;
  }

  create() {
    const poem = dataManager.getPoemById(this.poemId);
    if (!poem) {
      showToast(this, '这首诗还没有收进诗卷，先回地图看看吧。', { y: 620, depth: 9700 });
      this.time.delayedCall(900, () => this.closeLevel());
      return;
    }
    this.poem = poem;

    // 关卡遮罩：挡住下方场景，同时压暗画面，让注意力集中在诗题上
    this.dim = addDimOverlay(this, 0.5, 0x2e3a34, 880);
    this.dim.setInteractive();

    // 纸卡外壳
    createPaperPanel(this, {
      x: GAME_WIDTH / 2,
      y: 360,
      width: 1216,
      height: 664,
      radius: 30,
      fill: C.paperSoft,
      fillAlpha: 0.985,
      depth: 900,
    });

    this._buildHeader();

    // 玩法图层
    this.moduleLayer = this.add.container(0, 0).setDepth(920).setScrollFactor(0);
    const context = {
      scene: this,
      layer: this.moduleLayer,
      poem,
      review: this.review,
      onSolved: (payload) => this._handleSolved(payload),
    };
    this.module = createLevelModule(this.mode, context);

    if (!this.module) {
      this._showComingSoon();
      return;
    }
    this.module.mount();

    this._setupKeyboard();
    audio.playSceneBgm('LevelScene');
    audio.playPage();
  }

  // ---------------------------------------------------------
  // 外壳
  // ---------------------------------------------------------
  _buildHeader() {
    const header = this.add.container(0, 0).setDepth(910).setScrollFactor(0);
    const moduleConfig = getLevelModule(this.mode);
    const difficulty = getDifficultyConfig(progress.getDifficulty());

    header.add(addSeal(this, 92, 72, '题', 46, C.peachDeep));

    header.add(
      makeText(this, 126, 58, moduleConfig ? moduleConfig.name : '诗题小关卡', {
        size: 28,
        color: S.ink,
        origin: [0, 0.5],
      }),
    );

    const subtitle = this.review
      ? `错题复习 · ${getChapterName(this.poem.chapter)} / ${this.poem.area}`
      : `${difficulty.name} · ${getChapterName(this.poem.chapter)} / ${this.poem.area}`;
    header.add(
      makeText(this, 128, 90, subtitle, {
        size: 14,
        color: S.inkSoft,
        origin: [0, 0.5],
      }),
    );

    header.add(addSeal(this, 946, 72, '笔', 34, C.pineDeep));
    this.brushText = makeText(this, 970, 72, '', {
      size: 15,
      color: S.inkSoft,
      origin: [0, 0.5],
    });
    header.add(this.brushText);
    this.refreshBrush();

    // 古诗朗诵：先听一遍，再动笔答题
    this.recitation = addRecitationButton(this, {
      x: 1112,
      y: 72,
      poem: this.poem,
      width: 104,
      height: 44,
      depth: 0,
    });
    header.add(this.recitation.button.container);

    const closeButton = createIconButton(this, {
      x: 1212,
      y: 72,
      size: 50,
      icon: '×',
      variant: 'ghost',
      depth: 0,
      onClick: () => this._requestClose(),
    });
    header.add(closeButton.container);

    const line = this.add.graphics();
    line.lineStyle(1.2, C.gold, 0.35);
    line.beginPath();
    line.moveTo(64, 108);
    line.lineTo(GAME_WIDTH - 64, 108);
    line.strokePath();
    header.add(line);
  }

  /** 供玩法模块在消耗毛笔后刷新 */
  refreshBrush() {
    if (this.brushText) {
      this.brushText.setText(`毛笔 × ${progress.getBrushCount()}`);
    }
  }

  _setupKeyboard() {
    if (!this.input.keyboard) return;
    this.input.keyboard.on('keydown-ESC', () => this._requestClose());
  }

  _showComingSoon() {
    const config = getLevelModule(this.mode);
    showModal(this, {
      title: `${config?.name || '这个玩法'} · 营造中`,
      message: '这个玩法还在细细打磨，暂时没有开放。\n\n现在可以先玩「看图猜诗」，等它做好了再来玩这一页吧。',
      sealText: '筑',
      actions: [
        {
          label: '先回地图',
          variant: 'primary',
          onClick: () => this.closeLevel(),
        },
      ],
      onClose: () => {
        if (!this._closing) this.closeLevel();
      },
    });
  }

  // ---------------------------------------------------------
  // 结算
  // ---------------------------------------------------------
  _handleSolved({ stars, mistakes, hintUsed }) {
    if (this._solved) return;
    this._solved = true;

    // 答对后这首诗会被移出错题书斋，这里先记下，结算面板里说清楚
    this._clearedWrong = Boolean(progress.getWrongRecord(this.poem.id));

    // 统一在这里落盘：诗卡、星级、错题清除、轶事、藏品、章节解锁
    this.result = progress.markPoemComplete(this.poem.id, stars);
    console.info('[关卡] 结算：', {
      poem: this.poem.title,
      stars,
      mistakes,
      hintUsed,
      result: this.result,
    });

    if (!this.result) {
      showToast(this, '结算时没有找到这首诗，请回到地图重试。', { y: 620, depth: 9700 });
      return;
    }

    audio.playLevelClear();
    this.time.delayedCall(300, () => {
      if (!this.scene.isActive()) return;
      this._showResult();
    });
  }

  _showResult() {
    if (this._resultShown) return;
    this._resultShown = true;
    this.moduleLayer.setVisible(false);

    const root = this.add.container(0, 0).setDepth(940).setScrollFactor(0);
    this.resultRoot = root;

    const blocker = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x2e3a34, 0.5)
      .setOrigin(0)
      .setScrollFactor(0)
      .setInteractive();
    root.add(blocker);

    const panel = createPaperPanel(this, {
      x: GAME_WIDTH / 2,
      y: 372,
      width: 920,
      height: 600,
      radius: 28,
      fill: C.paperSoft,
      depth: 0,
    });
    root.add(panel);

    root.add(addSeal(this, 250, 142, this.result.newCard ? '得' : '温', 52, C.peachDeep));

    root.add(
      makeText(
        this,
        GAME_WIDTH / 2 + 20,
        124,
        this.result.newCard ? '答对啦 · 诗卡入卷' : '重温完成 · 诗意更熟',
        { size: 34, color: S.ink, origin: [0.5, 0.5] },
      ),
    );

    const stars = createStarRow(this, {
      x: GAME_WIDTH / 2,
      y: 178,
      stars: this.result.stars,
      size: 36,
      gap: 8,
      animate: true,
      depth: 0,
    });
    root.add(stars.container);

    root.add(
      makeText(this, GAME_WIDTH / 2, 218, `《${this.poem.title}》`, {
        size: 27,
        color: S.ink,
        origin: [0.5, 0.5],
      }),
    );

    root.add(
      makeText(this, GAME_WIDTH / 2, 250, `${this.poem.dynasty} · ${this.poem.author}　·　${getChapterName(this.poem.chapter)} / ${this.poem.area}`, {
        size: 15,
        color: S.inkSoft,
        origin: [0.5, 0.5],
      }),
    );

    // 全诗与拼音：可拖动阅读，长诗也不会撑破纸卡
    const scroll = new ScrollPanel(this, {
      x: 270,
      y: 268,
      width: 740,
      height: 132,
      radius: 14,
      depth: 945,
    });
    let cursorY = 0;
    const fullText = makeText(this, 0, cursorY, this.poem.full_text, {
      size: 20,
      color: S.ink,
      origin: [0, 0],
      align: 'left',
      wrap: 700,
      lineSpacing: 8,
    });
    scroll.add(fullText);
    cursorY += fullText.height + 8;
    const pinyin = makeText(this, 0, cursorY, this.poem.pinyin_text, {
      size: 13,
      color: S.inkFaint,
      origin: [0, 0],
      align: 'left',
      wrap: 700,
      lineSpacing: 5,
    });
    scroll.add(pinyin);
    cursorY += pinyin.height + 4;
    scroll.layout(cursorY);
    scroll.scrollToTop();

    // 本次收获
    const lines = [];
    if (this.result.newCard) {
      lines.push(`✦ 新诗卡《${this.poem.title}》已收入图鉴`);
    } else {
      lines.push(`✦ 诗卡星级更新为 ${this.result.stars} ★`);
    }
    this.result.newAchievements.forEach((item) => {
      lines.push(`✦ 典藏成就「${item.title}」达成`);
    });
    this.result.newAnecdotes.forEach((item) => {
      lines.push(`✦ 轶事《${item.title}》已收入逸闻册`);
    });
    this.result.newCollection.forEach((item) => {
      lines.push(`✦ 文房藏品「${item.name}」已入陈列馆`);
    });
    if (this._clearedWrong) {
      lines.push('✦ 答对啦，这首诗已从错题书斋移出');
    }
    if (this.result.brushGained > 0) {
      lines.push(`✦ 毛笔 +${this.result.brushGained}，现有 ${progress.getBrushCount()} 支`);
    }
    this.result.newlyUnlockedChapters.forEach((chapterId) => {
      const chapter = getChapterConfig(chapterId);
      if (chapter) lines.push(`✦ 新诗路解锁：${chapter.name}`);
    });

    let rewardLines = lines;
    if (rewardLines.length > 5) {
      rewardLines = [...rewardLines.slice(0, 4), '✦ 其余收获已自动记入图鉴、逸闻册与陈列馆'];
    }

    root.add(
      makeText(this, GAME_WIDTH / 2, 414, rewardLines.join('\n'), {
        size: 15,
        color: S.pineDeep,
        origin: [0.5, 0],
        align: 'center',
        wrap: 780,
        lineSpacing: 5,
      }),
    );

    const backLabel = this.returnScene === SCENES.MAP
      ? '回到诗山地图'
      : this.returnScene === SCENES.REVIEW
        ? '回到错题书斋'
        : '回到诗卷';

    const backButton = createButton(this, {
      x: GAME_WIDTH / 2,
      y: 602,
      width: 380,
      height: 66,
      radius: 24,
      label: backLabel,
      variant: 'primary',
      fontSize: 24,
      depth: 0,
      onClick: () => this.closeLevel(),
    });
    root.add(backButton.container);

    root.add(
      makeText(this, GAME_WIDTH / 2, 648, '进度已自动保存在本机 · 不联网、不上传', {
        size: 12,
        color: S.inkFaint,
        origin: [0.5, 0.5],
      }),
    );

    // 支线奖励：关卡通关按概率额外掉一片逸闻碎片
    // 开关与概率都在 config/anecdoteFragments.js 里，不参与章节进度
    if (!this.review) {
      maybeDropAnecdoteFragment(this, { source: 'level', delay: 1100 });
      // 另一条支线：按概率掉一件文房藏品（整件解锁，见 collectionRewards.js）
      // 弹窗会等桌面空下来再出现，不会和碎片弹窗叠在一起
      maybeDropCollection(this, { source: 'level', delay: 2400 });
    }
  }

  // ---------------------------------------------------------
  // 关闭
  // ---------------------------------------------------------
  _requestClose() {
    if (this._closing) return;
    if (this._solved) {
      this.closeLevel();
      return;
    }
    if (this._confirmOpen) return;

    this._confirmOpen = true;
    audio.playPage();
    showModal(this, {
      title: '先离开这一题吗？',
      sealText: '问',
      message: '这道诗题还没有答完。\n离开后进度会留在原地，下次还可以再来读。',
      actions: [
        { label: '继续答题', variant: 'primary' },
        {
          label: '先离开',
          variant: 'secondary',
          onClick: () => this.closeLevel(),
        },
      ],
      onClose: () => {
        this._confirmOpen = false;
      },
    });
  }

  /** 关闭关卡并恢复来源场景（地图 / 错题书斋） */
  closeLevel() {
    if (this._closing) return;
    this._closing = true;

    const target = this.returnScene;
    if (target && this.scene.isPaused(target)) {
      this.scene.resume(target);
    }
    this.scene.stop();
  }
}
