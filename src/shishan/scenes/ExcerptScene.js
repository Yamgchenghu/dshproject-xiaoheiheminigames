/**
 * ExcerptScene：自由诗笺摘抄。
 * ------------------------------------------------------------
 * 玩法（轻量、不赶时间）：
 *  - 左边挑一首诗，右边挑一句喜欢的话；
 *  - 换一张纸（素纸 / 竹纸 / 云笺），换一种墨（墨 / 朱 / 靛）；
 *  - 用鼠标或手指在纸上随手写，写完可以收进「我的诗笺」；
 *  - 每张诗笺都以归一化坐标保存，换屏幕大小也不会跑偏；最多留 30 张。
 *
 * 全部离线：只写入本机 localStorage，不上传任何书写内容。
 */

import Phaser from 'phaser';

import { GAME_WIDTH, SCENES } from '../config/constants.js';
import { C, FONT_SIZE, S, UI } from '../config/theme.js';
import { dataManager } from '../data/DataManager.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import BaseScene from '../ui/BaseScene.js';
import { roundedRectPath } from '../ui/background.js';
import {
  createButton,
  createIconButton,
  createPaperPanel,
  createTag,
  makeText,
  showModal,
} from '../ui/components.js';
import { shouldShowExcerptNotice, markExcerptNoticeShown } from '../save-bridge.js';
import { splitRecitationLines } from '../gameplay/recitation.js';

// 左侧诗选面板
const LIST_PANEL = { x: 24, y: 124, width: 320, height: 504 };
const LIST_PAGE_SIZE = 6;
const LIST_ITEM_HEIGHT = 52;
const LIST_ITEM_GAP = 6;

// 右侧字纸
const CANVAS = { x: 368, y: 288, width: 880, height: 298 };
const CONTROL_Y = 616;

const PAPER_STYLES = {
  plain: { name: '素纸', fill: 0xfdf9f0, line: 0xd7c9b0, pattern: null },
  bamboo: { name: '竹纸', fill: 0xf4eeda, line: 0xc9b98f, pattern: 'bamboo' },
  cloud: { name: '云笺', fill: 0xeef1ea, line: 0xb8c9c0, pattern: 'cloud' },
};

const INK_STYLES = {
  ink: { name: '墨', color: 0x3f3b33, text: S.ink },
  cinnabar: { name: '朱', color: 0xb0503f, text: S.danger },
  indigo: { name: '靛', color: 0x4a5a7a, text: '#4a5a7a' },
};

const MAX_LINES = 6;

export default class ExcerptScene extends BaseScene {
  constructor() {
    super(SCENES.EXCERPT);
  }

  init(data = {}) {
    this.initialPoemId = Number(data.poemId) || null;
    this.initialLine = String(data.line || '');
    this.page = 0;
    this.paper = 'plain';
    this.ink = 'ink';
    this.strokes = [];
    this.drawing = false;
    this.galleryRoot = null;
    this.lineButtons = [];
    this.listButtons = [];
    this.lineText = '';
  }

  create() {
    this.prepareScene();
    this.addBackground('paper', { petals: true });
    audio.playSceneBgm('ExcerptScene');

    this.addHeader({
      title: '自由诗笺',
      subtitle: '挑一句喜欢的诗，慢慢抄在纸上',
      onBack: () => this.goTo(SCENES.MENU, {}),
      backLabel: '主页',
      showLine: true,
    });

    this.countTag = createTag(this, 0, 0, '', {
      fill: C.paperSoft,
      textColor: S.inkSoft,
      fontSize: FONT_SIZE.xs,
      height: 38,
      paddingX: 20,
      depth: 1001,
      strokeColor: C.inkLine,
    });
    this.countTag.container.setPosition(GAME_WIDTH - this.countTag.width / 2 - 60, 52);
    this._refreshCount();

    this._buildPoemList();
    this._buildPoemHeader();
    this._buildCanvas();
    this._buildControls();
    this._setupDrawing();

    const poem = this._currentPoem();
    if (poem) this._selectPoem(poem, { keepPage: true, initialLine: this.initialLine });

    this.events.once('shutdown', () => {
      this.strokes = [];
      this.galleryRoot = null;
    });

    // 【为什么这里要弹窗】用户明确要求「摘抄不存档，进入时弹窗提示」。
    //   摘抄的手绘坐标体积太大（30 张实测 2.8 MB，理论上限 62 MB），
    //   云存档单 value 只有 16 KB，存不下。与其让它默默写失败，
    //   不如一进来就说清楚：这次的抄写只在本次游玩里有效。
    //   每次启动只弹一次，同一个会话里反复进出不再打扰。
    if (shouldShowExcerptNotice()) {
      markExcerptNoticeShown();
      this.time.delayedCall(420, () => {
        if (!this.scene.isActive()) return;
        showModal(this, {
          title: '诗笺不留档',
          message: '这里的抄写不会保存，退出后就会消失。\n\n'
            + '想留下喜欢的句子，可以截图，或者去「诗卷」里收藏这首诗。\n'
            + '你的学习进度（诗卷、章节、成就、藏品）都会正常保存。',
          sealText: '存',
          actions: [{ label: '知道了', variant: 'primary' }],
        });
      });
    }
  }

  // ---------------------------------------------------------
  // 左侧：诗选（分页，避免一次塞进 70 多首）
  // ---------------------------------------------------------
  _buildPoemList() {
    this.listPanel = createPaperPanel(this, {
      x: LIST_PANEL.x + LIST_PANEL.width / 2,
      y: LIST_PANEL.y + LIST_PANEL.height / 2,
      width: LIST_PANEL.width,
      height: LIST_PANEL.height,
      radius: UI.radius.lg,
      depth: 90,
    });

    makeText(this, LIST_PANEL.x + 22, LIST_PANEL.y + 28, '挑一首诗', {
      size: 22,
      color: S.ink,
      origin: [0, 0.5],
    }).setDepth(110);

    this.pageText = makeText(this, LIST_PANEL.x + LIST_PANEL.width - 24, LIST_PANEL.y + 28, '', {
      size: 13,
      color: S.inkFaint,
      origin: [1, 0.5],
    }).setDepth(110);

    this.prevButton = createButton(this, {
      x: LIST_PANEL.x + 74,
      y: LIST_PANEL.y + LIST_PANEL.height - 34,
      width: 112,
      height: 44,
      label: '‹ 上一页',
      variant: 'tab',
      fontSize: 15,
      depth: 110,
      onClick: () => this._turnPage(-1),
    });

    this.nextButton = createButton(this, {
      x: LIST_PANEL.x + LIST_PANEL.width - 74,
      y: LIST_PANEL.y + LIST_PANEL.height - 34,
      width: 112,
      height: 44,
      label: '下一页 ›',
      variant: 'tab',
      fontSize: 15,
      depth: 110,
      onClick: () => this._turnPage(1),
    });
  }

  _turnPage(delta) {
    const poems = dataManager.getAllPoems();
    const maxPage = Math.max(0, Math.ceil(poems.length / LIST_PAGE_SIZE) - 1);
    const next = Phaser.Math.Clamp(this.page + delta, 0, maxPage);
    if (next === this.page) return;
    this.page = next;
    this._renderPoemList();
  }

  _renderPoemList() {
    (this.listButtons || []).forEach((button) => button.destroy());
    this.listButtons = [];

    const poems = dataManager.getAllPoems();
    const maxPage = Math.max(0, Math.ceil(poems.length / LIST_PAGE_SIZE) - 1);
    this.page = Math.min(this.page, maxPage);
    const start = this.page * LIST_PAGE_SIZE;
    const visible = poems.slice(start, start + LIST_PAGE_SIZE);

    visible.forEach((poem, index) => {
      const active = this.poem && poem.id === this.poem.id;
      const button = createButton(this, {
        x: LIST_PANEL.x + LIST_PANEL.width / 2,
        y: LIST_PANEL.y + 78 + index * (LIST_ITEM_HEIGHT + LIST_ITEM_GAP) + LIST_ITEM_HEIGHT / 2,
        width: LIST_PANEL.width - 36,
        height: LIST_ITEM_HEIGHT,
        label: poem.title,
        subLabel: `${poem.dynasty} · ${poem.author}`,
        variant: active ? 'tabActive' : 'tab',
        fontSize: 18,
        subFontSize: 12,
        depth: 110,
        onClick: () => this._selectPoem(poem),
      });
      this.listButtons.push(button);
    });

    this.pageText.setText(`${this.page + 1} / ${maxPage + 1}`);
    const canPrev = this.page > 0;
    const canNext = this.page < maxPage;
    this.prevButton.setDisabled(!canPrev);
    this.nextButton.setDisabled(!canNext);
  }

  _currentPoem() {
    if (this.poem) return this.poem;
    if (this.initialPoemId) {
      const found = dataManager.getPoemById(this.initialPoemId);
      if (found) return found;
    }
    const all = dataManager.getAllPoems();
    return all[0] || null;
  }

  // ---------------------------------------------------------
  // 右侧：诗题与选句
  // ---------------------------------------------------------
  _buildPoemHeader() {
    this.poemTitle = makeText(this, 368, 132, '', {
      size: 27,
      color: S.ink,
      origin: [0, 0.5],
    }).setDepth(110);

    this.poemMeta = makeText(this, 368, 160, '', {
      size: 14,
      color: S.inkFaint,
      origin: [0, 0.5],
    }).setDepth(110);

    makeText(this, 368, 188, '选一句想抄的话', {
      size: 14,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(110);

    this.lineLayer = this.add.container(0, 0).setDepth(112).setScrollFactor(0);
  }

  _selectPoem(poem, options = {}) {
    if (!poem) return;
    const changed = !this.poem || this.poem.id !== poem.id;
    this.poem = poem;
    this.poemTitle.setText(poem.title);
    this.poemMeta.setText(`${poem.dynasty} · ${poem.author}　·　${poem.area}`);
    this._renderPoemList();
    this._renderLines(options.initialLine || '');

    if (changed && this.strokes.length > 0) {
      this.strokes = [];
      this._redrawInk();
    }
    if (changed) this._updateGuide();
  }

  _renderLines(initialLine = '') {
    this.lineLayer.removeAll(true);
    this.lineButtons = [];

    const lines = splitRecitationLines(this.poem).slice(0, MAX_LINES);
    this.availableLines = lines;

    const chosen = initialLine && lines.includes(initialLine) ? initialLine : lines[0] || '';
    if (chosen) this.lineText = chosen;

    const columns = lines.length > 3 ? 3 : lines.length;
    const buttonWidth = columns === 3 ? 282 : 430;
    const gap = 16;
    const rowCount = Math.ceil(lines.length / 3);
    const startY = rowCount > 1 ? 212 : 218;

    lines.forEach((line, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const countInRow = Math.min(3, lines.length - row * 3);
      const rowWidth = countInRow * buttonWidth + (countInRow - 1) * gap;
      const rowStartX = CANVAS.x + (CANVAS.width - rowWidth) / 2 + buttonWidth / 2;
      const button = createButton(this, {
        x: rowStartX + column * (buttonWidth + gap),
        y: startY + row * 46,
        width: buttonWidth,
        height: 40,
        radius: UI.radius.sm,
        label: line,
        variant: line === chosen ? 'gold' : 'tab',
        fontSize: 16,
        depth: 113,
        onClick: () => this._selectLine(line),
      });
      this.lineLayer.add(button.container);
      this.lineButtons.push({ line, button });
    });

    if (lines.length >= MAX_LINES) {
      makeText(this, CANVAS.x + CANVAS.width - 4, 188, '长诗先挑最喜欢的一句', {
        size: 12,
        color: S.inkFaint,
        origin: [1, 0.5],
      }).setDepth(110);
    }

    this._updateGuide();
  }

  _selectLine(line) {
    this.lineText = line;
    this.lineButtons.forEach(({ line: value, button }) => {
      button.setVariant(value === line ? 'gold' : 'tab');
    });
    this._updateGuide();
    audio.playBrush();
  }

  _updateGuide() {
    if (!this.guideText) return;
    this.guideText.setText(this.lineText || '');
  }

  // ---------------------------------------------------------
  // 字纸与手写
  // ---------------------------------------------------------
  _buildCanvas() {
    this.paperGfx = this.add.graphics().setDepth(100).setScrollFactor(0);
    this.inkGfx = this.add.graphics().setDepth(104).setScrollFactor(0);
    this._paintPaper();

    // 淡淡的「描红」示范句
    this.guideText = makeText(this, CANVAS.x + CANVAS.width / 2, CANVAS.y + 46, '', {
      size: 24,
      color: S.inkFaint,
      origin: [0.5, 0.5],
      wrap: CANVAS.width - 120,
    }).setDepth(102).setScrollFactor(0).setAlpha(0.42);

    makeText(this, CANVAS.x + CANVAS.width / 2, CANVAS.y + CANVAS.height - 26, '在这里随手写 · 写得慢一点也没关系', {
      size: 12,
      color: S.inkFaint,
      origin: [0.5, 0.5],
    }).setDepth(102).setScrollFactor(0).setAlpha(0.6);
  }

  _paintPaper() {
    const style = PAPER_STYLES[this.paper];
    const g = this.paperGfx;
    g.clear();

    g.fillStyle(UI.shadow.color, UI.shadow.alpha);
    roundedRectPath(g, CANVAS.x + 3, CANVAS.y + 8, CANVAS.width, CANVAS.height, UI.radius.lg);
    g.fillPath();
    g.fillStyle(style.fill, 0.98);
    roundedRectPath(g, CANVAS.x, CANVAS.y, CANVAS.width, CANVAS.height, UI.radius.lg);
    g.fillPath();
    g.lineStyle(UI.stroke.base, style.line, 0.6);
    roundedRectPath(g, CANVAS.x, CANVAS.y, CANVAS.width, CANVAS.height, UI.radius.lg);
    g.strokePath();
    g.lineStyle(UI.stroke.hair, C.gold, 0.26);
    roundedRectPath(
      g,
      CANVAS.x + UI.panel.inset,
      CANVAS.y + UI.panel.inset,
      CANVAS.width - UI.panel.inset * 2,
      CANVAS.height - UI.panel.inset * 2,
      UI.radius.md,
    );
    g.strokePath();

    if (style.pattern === 'bamboo') {
      g.lineStyle(1, 0xc2ac82, 0.16);
      for (let i = 0; i < 16; i += 1) {
        const x = CANVAS.x + 26 + i * 54;
        g.beginPath();
        g.moveTo(x, CANVAS.y + 14);
        g.lineTo(x, CANVAS.y + CANVAS.height - 14);
        g.strokePath();
      }
    } else if (style.pattern === 'cloud') {
      g.lineStyle(2, 0xa9c0b5, 0.14);
      [{ x: 120, y: 70 }, { x: 760, y: 90 }, { x: 420, y: 232 }].forEach(({ x, y }) => {
        g.beginPath();
        g.arc(CANVAS.x + x, CANVAS.y + y, 34, Math.PI * 0.15, Math.PI * 0.85);
        g.strokePath();
        g.beginPath();
        g.arc(CANVAS.x + x + 34, CANVAS.y + y, 26, Math.PI * 0.2, Math.PI * 0.8);
        g.strokePath();
      });
    } else {
      g.lineStyle(1, 0xd7c9b0, 0.2);
      for (let i = 0; i < 4; i += 1) {
        const y = CANVAS.y + 70 + i * 58;
        g.beginPath();
        g.moveTo(CANVAS.x + 30, y);
        g.lineTo(CANVAS.x + CANVAS.width - 30, y);
        g.strokePath();
      }
    }
  }

  _setupDrawing() {
    const inside = (pointer) => pointer.x >= CANVAS.x
      && pointer.x <= CANVAS.x + CANVAS.width
      && pointer.y >= CANVAS.y
      && pointer.y <= CANVAS.y + CANVAS.height;

    this.input.on('pointerdown', (pointer) => {
      if (this.galleryRoot || !inside(pointer)) return;
      if (this.strokes.length >= 60) return;
      this.drawing = true;
      const stroke = [this._normalize(pointer)];
      this.strokes.push(stroke);
      this._lastPoint = { x: pointer.x, y: pointer.y };
      this.inkGfx.lineStyle(4, INK_STYLES[this.ink].color, 0.92);
      this.inkGfx.fillStyle(INK_STYLES[this.ink].color, 0.92);
      this.inkGfx.fillCircle(pointer.x, pointer.y, 2);
    });

    this.input.on('pointermove', (pointer) => {
      if (!this.drawing || this.galleryRoot) return;
      if (!pointer.isDown) {
        this.drawing = false;
        return;
      }
      const stroke = this.strokes[this.strokes.length - 1];
      if (!stroke || stroke.length >= 400) return;
      const point = this._normalize(pointer);
      stroke.push(point);
      const last = this._lastPoint;
      if (last) {
        this.inkGfx.lineStyle(4, INK_STYLES[this.ink].color, 0.92);
        this.inkGfx.beginPath();
        this.inkGfx.moveTo(last.x, last.y);
        this.inkGfx.lineTo(pointer.x, pointer.y);
        this.inkGfx.strokePath();
      }
      this._lastPoint = { x: pointer.x, y: pointer.y };
    });

    const stop = () => {
      this.drawing = false;
      this._lastPoint = null;
    };
    this.input.on('pointerup', stop);
    this.input.on('pointerupoutside', stop);
  }

  /** 归一化到 0~1，存档时不依赖屏幕尺寸 */
  _normalize(pointer) {
    const x = (pointer.x - CANVAS.x) / CANVAS.width;
    const y = (pointer.y - CANVAS.y) / CANVAS.height;
    return [
      Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000,
      Math.round(Math.min(1, Math.max(0, y)) * 1000) / 1000,
    ];
  }

  _redrawInk() {
    const g = this.inkGfx;
    g.clear();
    this.strokes.forEach((stroke) => {
      if (!stroke || stroke.length === 0) return;
      g.lineStyle(4, INK_STYLES[this.ink].color, 0.92);
      g.fillStyle(INK_STYLES[this.ink].color, 0.92);
      const points = stroke.map(([nx, ny]) => ({
        x: CANVAS.x + nx * CANVAS.width,
        y: CANVAS.y + ny * CANVAS.height,
      }));
      if (points.length === 1) {
        g.fillCircle(points[0].x, points[0].y, 2);
        return;
      }
      g.beginPath();
      g.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => g.lineTo(point.x, point.y));
      g.strokePath();
    });
  }

  // ---------------------------------------------------------
  // 底部工具条
  // ---------------------------------------------------------
  _buildControls() {
    const paperKeys = Object.keys(PAPER_STYLES);
    this.paperButtons = {};
    paperKeys.forEach((key, index) => {
      const button = createButton(this, {
        x: CANVAS.x + 39 + index * 86,
        y: CONTROL_Y,
        width: 78,
        height: 44,
        radius: UI.radius.sm,
        label: PAPER_STYLES[key].name,
        variant: key === this.paper ? 'tabActive' : 'tab',
        fontSize: 15,
        depth: 110,
        onClick: () => this._setPaper(key),
      });
      this.paperButtons[key] = button;
    });

    const inkKeys = Object.keys(INK_STYLES);
    this.inkButtons = {};
    inkKeys.forEach((key, index) => {
      const button = createButton(this, {
        x: CANVAS.x + 328 + index * 60,
        y: CONTROL_Y,
        width: 52,
        height: 44,
        radius: UI.radius.sm,
        label: INK_STYLES[key].name,
        variant: key === this.ink ? 'tabActive' : 'tab',
        fontSize: 16,
        depth: 110,
        onClick: () => this._setInk(key),
      });
      this.inkButtons[key] = button;
    });

    createButton(this, {
      x: 888,
      y: CONTROL_Y,
      width: 88,
      height: 44,
      radius: UI.radius.sm,
      label: '清空',
      variant: 'muted',
      fontSize: 16,
      depth: 110,
      onClick: () => this._clearCanvas(),
    });

    createButton(this, {
      x: 1006,
      y: CONTROL_Y,
      width: 136,
      height: 44,
      radius: UI.radius.sm,
      label: '我的诗笺',
      variant: 'soft',
      fontSize: 16,
      depth: 110,
      onClick: () => this._openGallery(),
    });

    createButton(this, {
      x: 1162,
      y: CONTROL_Y,
      width: 150,
      height: 44,
      radius: UI.radius.sm,
      label: '收进诗笺册',
      variant: 'primary',
      fontSize: 16,
      depth: 110,
      onClick: () => this._saveExcerpt(),
    });
  }

  _setPaper(key) {
    if (this.paper === key) return;
    this.paper = key;
    Object.entries(this.paperButtons).forEach(([name, button]) => {
      button.setVariant(name === key ? 'tabActive' : 'tab');
    });
    this._paintPaper();
    this._redrawInk();
    audio.playPage();
  }

  _setInk(key) {
    if (this.ink === key) return;
    this.ink = key;
    Object.entries(this.inkButtons).forEach(([name, button]) => {
      button.setVariant(name === key ? 'tabActive' : 'tab');
    });
    this._redrawInk();
    audio.playBrush();
  }

  _clearCanvas() {
    if (this.strokes.length === 0) {
      this.showToast('纸上还是空的，先写几个字吧。', { y: 660 });
      return;
    }
    this.strokes = [];
    this.inkGfx.clear();
    audio.playPage();
    this.showToast('纸已经换新，可以重新写了。', { y: 660 });
  }

  _refreshCount() {
    if (!this.countTag) return;
    this.countTag.setLabel(`诗笺 ${progress.getExcerptCount()} / 30`);
  }

  _saveExcerpt() {
    if (!this.poem) return;
    if (this.strokes.length === 0) {
      audio.playWrong();
      this.showToast('还没动笔呢。先在纸上写下你选的那句话吧。', { y: 660 });
      return;
    }
    const record = progress.addExcerpt({
      poemId: this.poem.id,
      line: this.lineText,
      paper: this.paper,
      ink: this.ink,
      strokes: this.strokes,
    });
    if (!record) {
      this.showToast('这张诗笺没有存下来，再试一次吧。', { tone: 'warn', y: 660 });
      return;
    }
    audio.playBrush();
    this._refreshCount();
    this.showToast('诗笺收好啦，点「我的诗笺」就能再看到它。', { y: 660, duration: 2200 });
    this.strokes = [];
    this.inkGfx.clear();
  }

  // ---------------------------------------------------------
  // 我的诗笺（画廊）
  // ---------------------------------------------------------
  _openGallery() {
    if (this.galleryRoot) return;
    audio.playPage();

    const root = this.add.container(0, 0).setDepth(9300).setScrollFactor(0);
    this.galleryRoot = root;

    const blocker = this.add
      .rectangle(0, 0, GAME_WIDTH, 720, UI.overlay.color, UI.overlay.alpha)
      .setOrigin(0)
      .setScrollFactor(0)
      .setInteractive();
    root.add(blocker);

    const panel = createPaperPanel(this, {
      x: GAME_WIDTH / 2,
      y: 360,
      width: 1000,
      height: 580,
      radius: UI.radius.xl,
      depth: 0,
    });
    root.add(panel);

    root.add(
      makeText(this, GAME_WIDTH / 2, 106, '我的诗笺', {
        size: 30,
        color: S.ink,
        origin: [0.5, 0.5],
      }),
    );
    root.add(
      makeText(this, GAME_WIDTH / 2, 136, '写过的诗句都留在这里 · 最多 30 张', {
        size: 13,
        color: S.inkFaint,
        origin: [0.5, 0.5],
      }),
    );

    const close = createIconButton(this, {
      x: GAME_WIDTH / 2 + 478,
      y: 96,
      size: 44,
      icon: '×',
      variant: 'ghost',
      depth: 0,
      onClick: () => this._closeGallery(),
    });
    root.add(close.container);

    const records = progress.getExcerpts().slice(0, 6);
    if (records.length === 0) {
      root.add(
        makeText(this, GAME_WIDTH / 2, 330, '还没有诗笺。\n挑一句喜欢的诗，写在纸上，就是你的第一张诗笺。', {
          size: 20,
          color: S.inkSoft,
          origin: [0.5, 0.5],
          lineSpacing: 10,
        }),
      );
    } else {
      const rowY = [268, 480];
      records.forEach((record, index) => {
        const column = index % 3;
        const row = Math.floor(index / 3);
        const x = GAME_WIDTH / 2 - 466 + 150 + column * 316;
        this._buildGalleryCard(root, record, x, rowY[row]);
      });
    }

    root.add(
      makeText(this, GAME_WIDTH / 2, 620, `共 ${progress.getExcerptCount()} 张 · 点卡片右上角的小叉可以删掉`, {
        size: 12,
        color: S.inkFaint,
        origin: [0.5, 0.5],
      }),
    );
  }

  _buildGalleryCard(root, record, x, y) {
    const poem = dataManager.getPoemById(record.poemId);
    const card = this.add.container(x, y).setDepth(9310).setScrollFactor(0);
    const paper = PAPER_STYLES[record.paper] || PAPER_STYLES.plain;
    const inkColor = (INK_STYLES[record.ink] || INK_STYLES.ink).color;

    const cardGraphics = this.add.graphics();
    cardGraphics.fillStyle(UI.shadow.color, 0.1);
    roundedRectPath(cardGraphics, -148, -97, 300, 204, UI.radius.md);
    cardGraphics.fillPath();
    cardGraphics.fillStyle(paper.fill, 0.98);
    roundedRectPath(cardGraphics, -150, -102, 300, 204, UI.radius.md);
    cardGraphics.fillPath();
    cardGraphics.lineStyle(UI.stroke.base, paper.line, 0.6);
    roundedRectPath(cardGraphics, -150, -102, 300, 204, UI.radius.md);
    cardGraphics.strokePath();

    // 缩略笔画：归一化坐标映射到卡片上半区
    const area = { x: -138, y: -94, width: 276, height: 128 };
    (record.strokes || []).forEach((stroke) => {
      if (!stroke || stroke.length === 0) return;
      cardGraphics.lineStyle(2.4, inkColor, 0.9);
      cardGraphics.fillStyle(inkColor, 0.9);
      const points = stroke.map(([nx, ny]) => ({
        x: area.x + nx * area.width,
        y: area.y + ny * area.height,
      }));
      if (points.length === 1) {
        cardGraphics.fillCircle(points[0].x, points[0].y, 1.6);
        return;
      }
      cardGraphics.beginPath();
      cardGraphics.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => cardGraphics.lineTo(point.x, point.y));
      cardGraphics.strokePath();
    });
    card.add(cardGraphics);

    const title = makeText(this, -132, 52, poem ? `《${poem.title}》` : '未收录的诗', {
      size: 15,
      color: S.ink,
      origin: [0, 0.5],
      wrap: 200,
    });
    card.add(title);

    const line = makeText(this, -132, 78, record.line || '（只写了字，没有选句）', {
      size: 12,
      color: S.inkSoft,
      origin: [0, 0.5],
      wrap: 268,
    });
    card.add(line);

    const deleteButton = createIconButton(this, {
      x: 138,
      y: -90,
      size: 26,
      icon: '×',
      variant: 'ghost',
      depth: 9311,
      onClick: () => this._deleteExcerpt(record.id),
    });
    card.add(deleteButton.container);

    root.add(card);
  }

  _deleteExcerpt(id) {
    const removed = progress.removeExcerpt(id);
    if (!removed) return;
    audio.playConfirm();
    this._closeGallery();
    this._refreshCount();
    this.showToast('这张诗笺已经删掉了。', { y: 660 });
  }

  _closeGallery() {
    if (!this.galleryRoot) return;
    this.galleryRoot.destroy(true);
    this.galleryRoot = null;
    audio.playClick();
  }
}
