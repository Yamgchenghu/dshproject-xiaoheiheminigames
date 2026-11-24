/**
 * GuessPoemModule：「看图猜诗」玩法。
 * ------------------------------------------------------------
 * 读取单条 poem 数据：
 *  - 左侧展示 poem.artKey 对应的配图占位（图片后续放入 public/assets/images）
 *  - 右侧四个诗题选项（正确项 + 3 个干扰项，由 DataManager 构建）
 *  - 温和模式会标出作者朝代；挑战模式不标
 *  - 答错：写入错题、柔和提示音、温和鼓励
 *  - 毛笔提示：消耗一支毛笔，排除一个错误项并给出诗句小贴士
 *
 * 本模块不直接写通关进度，答对后交给 LevelScene 统一结算，
 * 这样后续其他玩法也能复用同一套结算与存档逻辑。
 */

import { C, S, FONT_SIZE } from '../config/theme.js';
import { dataManager } from '../data/DataManager.js';
import { sceneNoteOf } from '../data/poemSceneNote.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import { getDifficultyConfig } from '../config/difficulty.js';
import { roundedRectPath } from '../ui/background.js';
import { addArtwork, hasArtwork } from '../ui/artwork.js';
import {
  createButton,
  createTag,
  makeText,
  showModal,
  showToast,
} from '../ui/components.js';

/** 截断过长的提示文字，避免撑破卡片 */
function clampText(text, max = 64) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export class GuessPoemModule {
  /**
   * @param {object} context
   * @param {Phaser.Scene} context.scene 关卡宿主场景（LevelScene）
   * @param {Phaser.GameObjects.Container} context.layer 玩法图层
   * @param {object} context.poem 诗篇数据
   * @param {boolean} context.review 是否来自错题复习
   * @param {function} context.onSolved 答对回调 ({ stars, mistakes, hintUsed })
   */
  constructor(context) {
    this.scene = context.scene;
    this.layer = context.layer;
    this.poem = context.poem;
    this.context = context;
    this.difficulty = getDifficultyConfig(progress.getDifficulty());
    this.options = [];
    this.optionButtons = [];
    this.mistakes = 0;
    this.hintUsed = false;
    this.eliminated = new Set();
    this.solved = false;
    this.hintModalOpen = false;
  }

  mount() {
    this._buildArtCard();
    this._buildQuestionArea();
  }

  // ---------------------------------------------------------
  // 左侧：配图占位
  // ---------------------------------------------------------
  _buildArtCard() {
    const scene = this.scene;
    const left = 48;
    const top = 120;
    const width = 474;
    const height = 524;

    const panel = scene.add.graphics();
    panel.fillStyle(0x6f6050, 0.1);
    roundedRectPath(panel, left + 3, top + 7, width, height, 24);
    panel.fillPath();
    panel.fillStyle(C.paperSoft, 0.98);
    roundedRectPath(panel, left, top, width, height, 24);
    panel.fillPath();
    panel.lineStyle(1.8, C.inkFaint, 0.55);
    roundedRectPath(panel, left, top, width, height, 24);
    panel.strokePath();
    panel.lineStyle(1, C.gold, 0.3);
    roundedRectPath(panel, left + 8, top + 8, width - 16, height - 16, 18);
    panel.strokePath();
    this.layer.add(panel);

    // 画框：有绘本插画就铺真图，没有就回退到程序化占位画
    const artX = left + 20;
    const artY = top + 52;
    const artW = width - 40;
    const artH = 300;
    const hasArt = hasArtwork(scene, this.poem.artKey);

    // 画卷不题诗名：题名了就等于把答案摆在画上，猜诗题也就没意义了
    const title = makeText(
      scene,
      left + width / 2,
      top + 30,
      hasArt ? '画卷' : '画卷 · 画师还在赶工',
      { size: 17, color: S.inkSoft, origin: [0.5, 0.5] },
    );
    this.layer.add(title);

    if (hasArt) {
      addArtwork(scene, {
        key: this.poem.artKey,
        x: artX,
        y: artY,
        width: artW,
        height: artH,
        radius: 16,
        parent: this.layer,
      });

      const frame = scene.add.graphics();
      frame.lineStyle(2, C.inkFaint, 0.5);
      roundedRectPath(frame, artX, artY, artW, artH, 16);
      frame.strokePath();
      frame.lineStyle(1, C.gold, 0.32);
      roundedRectPath(frame, artX + 7, artY + 7, artW - 14, artH - 14, 11);
      frame.strokePath();
      this.layer.add(frame);

      const tag = makeText(scene, artX + artW - 14, artY + artH - 14, '绘本插画', {
        size: 12,
        color: S.inkFaint,
        origin: [1, 1],
      });
      this.layer.add(tag);
    } else {
      this._drawPlaceholderArt(artX, artY, artW, artH);
      const keyText = makeText(scene, left + width / 2, artY + artH + 20, '这一页的画还在绘制中', {
        size: 14,
        color: S.inkFaint,
        origin: [0.5, 0.5],
      });
      this.layer.add(keyText);

      const pathText = makeText(
        scene,
        left + width / 2,
        artY + artH + 42,
        '先读读下面的意境小注，也能猜出是哪一首诗',
        { size: 12, color: S.inkFaint, origin: [0.5, 0.5] },
      );
      this.layer.add(pathText);
    }

    const line = scene.add.graphics();
    line.lineStyle(1, C.gold, 0.3);
    line.beginPath();
    line.moveTo(left + 28, artY + artH + 60);
    line.lineTo(left + width - 28, artY + artH + 60);
    line.strokePath();
    this.layer.add(line);

    // 意境小注：一句话概述这首诗想表达什么（不贴出图提示词，也不许露出诗题）
    const promptLabel = makeText(scene, left + 28, artY + artH + 70, '诗里的意境', {
      size: 12,
      color: S.gold,
      origin: [0, 0],
    });
    this.layer.add(promptLabel);

    const note = sceneNoteOf(this.poem) || '这一句小注还在写，先看看画吧。';
    const promptText = makeText(scene, left + 28, artY + artH + 90, clampText(note, 120), {
      size: 12,
      color: S.inkSoft,
      origin: [0, 0],
      align: 'left',
      wrap: width - 56,
      lineSpacing: 5,
    });
    this.layer.add(promptText);
  }

  /**
   * 画一张通用的淡彩山水占位图。
   * 骨架阶段不生成真实图片，只保留画面语言与资源 key。
   */
  _drawPlaceholderArt(x, y, width, height) {
    const g = this.scene.add.graphics();

    g.fillStyle(C.sky, 1);
    roundedRectPath(g, x, y, width, height, 16);
    g.fillPath();

    // 天空与远山
    g.fillStyle(C.dusk, 0.55);
    g.fillEllipse(x + width * 0.24, y + height * 0.28, width * 0.5, height * 0.34);
    g.fillStyle(C.moss, 0.32);
    g.fillEllipse(x + width * 0.18, y + height * 0.66, width * 0.62, height * 0.5);
    g.fillEllipse(x + width * 0.72, y + height * 0.7, width * 0.72, height * 0.54);
    g.fillStyle(0xa9c396, 0.42);
    g.fillEllipse(x + width * 0.48, y + height * 0.86, width * 0.78, height * 0.3);

    // 日 / 月
    g.fillStyle(C.goldLight, 0.9);
    g.fillCircle(x + width * 0.76, y + height * 0.24, Math.min(width, height) * 0.075);

    // 溪水
    g.fillStyle(C.water, 0.8);
    g.fillEllipse(x + width * 0.62, y + height * 0.82, width * 0.66, height * 0.16);
    g.lineStyle(1.5, C.waterDeep, 0.35);
    for (let i = 0; i < 3; i += 1) {
      const lineY = y + height * (0.78 + i * 0.05);
      g.beginPath();
      g.moveTo(x + width * 0.36, lineY);
      g.lineTo(x + width * 0.5, lineY - 3);
      g.lineTo(x + width * 0.62, lineY);
      g.lineTo(x + width * 0.74, lineY - 3);
      g.lineTo(x + width * 0.86, lineY);
      g.strokePath();
    }

    // 竹 / 芦苇
    g.lineStyle(2.5, C.pine, 0.42);
    [0.14, 0.22, 0.88].forEach((ratio, index) => {
      const baseX = x + width * ratio;
      const baseY = y + height * (0.88 - index * 0.02);
      g.beginPath();
      g.moveTo(baseX, baseY);
      g.lineTo(baseX + (index % 2 === 0 ? -8 : 8), baseY - height * 0.26);
      g.strokePath();
    });

    // 飞鸟（用折线画成很轻的“人”字）
    g.lineStyle(1.6, C.inkSoft, 0.45);
    [[0.62, 0.16, 9], [0.7, 0.22, 7], [0.54, 0.26, 6]].forEach(([rx, ry, size]) => {
      const bx = x + width * rx;
      const by = y + height * ry;
      g.beginPath();
      g.moveTo(bx - size, by);
      g.lineTo(bx - size * 0.5, by - size * 0.55);
      g.lineTo(bx, by);
      g.lineTo(bx + size * 0.5, by - size * 0.55);
      g.lineTo(bx + size, by);
      g.strokePath();
    });

    // 画框与“待补图”角标
    g.lineStyle(1.6, C.inkFaint, 0.5);
    roundedRectPath(g, x, y, width, height, 16);
    g.strokePath();
    g.fillStyle(C.paperSoft, 0.9);
    roundedRectPath(g, x + 12, y + height - 38, 132, 26, 13);
    g.fillPath();
    g.lineStyle(1, C.gold, 0.4);
    roundedRectPath(g, x + 12, y + height - 38, 132, 26, 13);
    g.strokePath();

    this.layer.add(g);

    const badge = makeText(this.scene, x + 78, y + height - 25, '待补绘卷', {
      size: 12,
      color: S.gold,
      origin: [0.5, 0.5],
    });
    this.layer.add(badge);
  }

  // ---------------------------------------------------------
  // 右侧：题目与选项
  // ---------------------------------------------------------
  _buildQuestionArea() {
    const scene = this.scene;
    const columnX = 900;

    const instruction = makeText(scene, columnX, 142, '这幅画，写的是哪一首诗？', {
      size: 24,
      color: S.ink,
      origin: [0.5, 0.5],
    });
    this.layer.add(instruction);

    const modeTag = createTag(scene, columnX, 180, this.context.review
      ? '错题复习'
      : `${this.difficulty.name} · 难度 ${this.poem.difficulty}`, {
      fill: this.context.review ? C.goldLight : C.pineLight,
      textColor: this.context.review ? S.gold : S.pineDeep,
      fontSize: 14,
      height: 30,
      paddingX: 16,
      strokeColor: this.context.review ? C.gold : C.pine,
    });
    modeTag.container.setDepth(0);
    this.layer.add(modeTag.container);

    // 四个选项
    this.options = dataManager.buildTitleOptions(this.poem.id);
    const optionYs = [226, 316, 406, 496];
    const optionHeight = 78;
    const optionWidth = 620;

    this.options.forEach((option, index) => {
      const subLabel = this.difficulty.showOptionMeta
        ? `${option.poem.dynasty} · ${option.poem.author}`
        : '';
      const button = createButton(scene, {
        x: columnX,
        y: optionYs[index],
        width: optionWidth,
        height: optionHeight,
        radius: 22,
        label: option.poem.title,
        subLabel,
        variant: 'secondary',
        fontSize: 26,
        subFontSize: 14,
        depth: 0,
        onClick: () => this._choose(option, button, index),
      });
      this.layer.add(button.container);
      this.optionButtons.push(button);
    });

    // 温和/错误提示文字
    this.feedbackText = makeText(scene, columnX, 544, '', {
      size: 16,
      color: S.inkSoft,
      origin: [0.5, 0],
      align: 'center',
      wrap: 620,
      lineSpacing: 5,
    });
    this.layer.add(this.feedbackText);

    // 毛笔提示按钮
    this.hintButton = createButton(scene, {
      x: 672,
      y: 618,
      width: 220,
      height: 56,
      radius: 20,
      label: '毛笔提示',
      variant: 'gold',
      fontSize: 20,
      depth: 0,
      onClick: () => this._onHint(),
    });
    this.layer.add(this.hintButton.container);

    this.brushText = makeText(scene, 800, 618, '', {
      size: 14,
      color: S.inkSoft,
      origin: [0, 0.5],
      align: 'left',
      wrap: 390,
      lineSpacing: 4,
    });
    this.layer.add(this.brushText);
    this._refreshBrush();
  }

  _refreshBrush() {
    if (!this.brushText) return;
    const count = progress.getBrushCount();
    this.brushText.setText(
      `毛笔 × ${count}　·　可排除一个错误诗题\n答对新的诗题会再得一支毛笔`,
    );
    if (this.hintButton) {
      this.hintButton.setDisabled(count <= 0 || this.solved);
    }
  }

  // ---------------------------------------------------------
  // 作答
  // ---------------------------------------------------------
  _choose(option, button, index) {
    if (this.solved) return;
    if (this.eliminated.has(index)) return;

    if (option.correct) {
      this._onCorrect(button);
      return;
    }

    // 答错：温和提示，不直接公布答案
    this.mistakes += 1;
    audio.playWrong();
    progress.addWrongRecord(this.poem.id);
    button.setVariant('muted');
    button.setDisabled(true);
    this._refreshBrush();

    const gentle = this.difficulty.gentleNudge;
    const encourage = gentle
      ? '小诗童说：不着急，先看看画里的水、山和小动物，再读一读每个诗题。'
      : '再想一想：画出这个场景的诗，会是谁写的呢？';
    this._setFeedback(`再想一想 · 已经记进错题书斋\n${encourage}`, 'wrong');
  }

  _onCorrect(button) {
    this.solved = true;
    audio.playCorrect();
    button.setVariant('correct');

    // 其余选项变淡，防止重复点击
    this.optionButtons.forEach((btn) => {
      if (btn !== button) {
        btn.setDisabled(true);
      }
    });
    if (this.hintButton) this.hintButton.setDisabled(true);

    const stars = this._calcStars();
    this._setFeedback(`答对啦！${'★'.repeat(stars)}　这首诗是《${this.poem.title}》`, 'correct');

    this.scene.time.delayedCall(750, () => {
      if (typeof this.context.onSolved === 'function') {
        this.context.onSolved({
          stars,
          mistakes: this.mistakes,
          hintUsed: this.hintUsed,
        });
      }
    });
  }

  /** 3 星为满分；错一次扣一星，用过毛笔再扣一星，最低 1 星 */
  _calcStars() {
    let stars = 3;
    stars -= this.mistakes;
    if (this.hintUsed) stars -= 1;
    return Math.max(1, stars);
  }

  _setFeedback(text, tone = 'normal') {
    if (!this.feedbackText) return;
    const color = tone === 'correct' ? S.pineDeep : tone === 'wrong' ? S.peach : S.inkSoft;
    this.feedbackText.setText(text);
    this.feedbackText.setColor(color);
  }

  // ---------------------------------------------------------
  // 毛笔提示
  // ---------------------------------------------------------
  _onHint() {
    if (this.solved || this.hintModalOpen) return;
    if (progress.getBrushCount() <= 0) {
      showToast(this.scene, '毛笔用完了。答对新的诗题，会再得一支毛笔。', {
        y: 660,
        duration: 2400,
      });
      return;
    }

    this.hintModalOpen = true;
    showModal(this.scene, {
      title: '用一支毛笔换提示？',
      sealText: '笔',
      message: '毛笔会帮你排除一个错误诗题，\n还会悄悄告诉你这首诗的小贴士。\n\n用掉后，本题最多只能得到 2 颗星。',
      actions: [
        { label: '先自己想想', variant: 'secondary' },
        {
          label: '用一支毛笔',
          variant: 'primary',
          onClick: () => this._applyHint(),
        },
      ],
      onClose: () => {
        this.hintModalOpen = false;
      },
    });
  }

  _applyHint() {
    if (this.solved) return;
    if (!progress.consumeBrush()) {
      showToast(this.scene, '毛笔不够啦。', { y: 660, duration: 1600 });
      return;
    }
    this.hintUsed = true;
    this._eliminateOneWrongOption();
    this._setFeedback(`小贴士：${clampText(this.poem.tip, 58)}`, 'normal');
    audio.playPage();
    if (this.scene.refreshBrush) this.scene.refreshBrush();
    this._refreshBrush();

    showToast(this.scene, `提示：${clampText(this.poem.tip, 48)}`, {
      y: 660,
      duration: 4200,
    });
  }

  /** 排除一个仍然可选的错误项 */
  _eliminateOneWrongOption() {
    const candidates = this.options
      .map((option, index) => ({ option, index }))
      .filter(({ option, index }) => !option.correct && !this.eliminated.has(index));

    if (candidates.length === 0) return;
    const pick = candidates[0];
    this.eliminated.add(pick.index);
    const button = this.optionButtons[pick.index];
    if (!button) return;
    button.setLabel(`（已排除）${pick.option.poem.title}`);
    button.setVariant('muted');
    button.setDisabled(true);
  }
}
