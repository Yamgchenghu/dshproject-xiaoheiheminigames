/**
 * SortPoemScene：诗句拖拽排序玩法（独立场景）
 * ------------------------------------------------------------
 * 玩法：
 *  1. 从 poem_db.json 读取单首诗词，把 full_text 拆成「诗句块」并打乱；
 *  2. 小朋友用触屏把诗句块拖到下方目标槽位，还原正确顺序；
 *  3. 「重置」重新打乱；「毛笔提示」消耗 1 支毛笔，帮他把其中一句放到正确位置；
 *  4. 全部排对即通关：写入存档（诗卡 / 星级 / 错题清除 / 轶事 / 藏品 / 章节解锁），
 *     排错只给温和提示并写入错题本，不公布答案；
 *  5. 通关后可「返回地图」。
 *
 * 复用：
 *  - BaseScene（统一背景、头部、吐司、弹窗、转场）
 *  - ProgressManager（进度与存档）、AudioManager（风铃 / 柔和提示音）
 *  - ui/components 与 ui/background 的国风绘本组件
 *
 * 入口：
 *  - 本场景不依赖任何原有场景即可运行，启动参数 { poemId, returnScene? }
 *  - 开发预览：路径加 `?sort=1` 即可（见 main.js 的独立玩法入口，不改动原有场景）
 *  - 从地图 / 关卡跳板进入时，传入 returnScene 即可在离开时恢复原场景
 */

import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH, SCENES } from '../config/constants.js';
import { C, S } from '../config/theme.js';
import { dataManager, shuffle } from '../data/DataManager.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import { getChapterName } from '../config/chapters.js';
import { getDifficultyConfig } from '../config/difficulty.js';
import BaseScene from '../ui/BaseScene.js';
import {
  createButton,
  createPaperPanel,
  createStarRow,
  createTag,
  makeText,
  showModal,
  showToast,
} from '../ui/components.js';
import { addSeal, roundedRectPath } from '../ui/background.js';
import { ScrollPanel } from '../ui/ScrollPanel.js';
import { getPoemSplitLines } from '../config/poemLines.js';

// ---------------------------------------------------------
// 拆句工具（纯函数，方便后续复用到别的玩法）
// ---------------------------------------------------------
const SENTENCE_END = '。！？；';
const CLAUSE_END = '，。！？；：';
const CLOSING_MARKS = '”’」』）】';

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八'];
const MAX_BLOCKS = 6; // 一块最多 6 句，再多就不适合小学生拖拽了
const BLOCK_HEIGHT = 52;
const TRAY_TOP = 198;
const TRAY_LEFT = 96;
const TRAY_MAX_WIDTH = 1088;
const SLOT_LEFT = 140;
const SLOT_WIDTH = 1030;
const SLOT_BOTTOM = 630;

/** 按指定标点切分，并保留标点；被引号带走的收尾符号会并回上一句 */
function splitKeepPunctuation(text, enders) {
  const raw = [];
  let buffer = '';

  for (const char of text) {
    buffer += char;
    if (enders.includes(char)) {
      raw.push(buffer);
      buffer = '';
    }
  }
  if (buffer.trim()) raw.push(buffer);

  // 例：「善哉乎鼓琴，巍巍乎若太山。”少选之间……」→ 把 ” 并回上一句
  const merged = [];
  raw.forEach((segment) => {
    const lead = segment.match(new RegExp(`^[${CLOSING_MARKS}]+`));
    if (lead && merged.length > 0) {
      merged[merged.length - 1] += lead[0];
      const rest = segment.slice(lead[0].length);
      if (rest.trim()) merged.push(rest);
    } else {
      merged.push(segment);
    }
  });

  return merged.map((segment) => segment.trim()).filter(Boolean);
}

/** 去掉标点，只留文字，用来判断两段是不是“同一句” */
function stripPunctuation(text) {
  return text.replace(/[，,。.！!？?；;：:、”“\s]/g, '');
}

/** 把相邻且内容相同的短句合并（例如《咏鹅》开头的「鹅，鹅，鹅，」） */
function mergeAdjacentDuplicates(list) {
  const out = [];
  let lastCore = null;
  list.forEach((segment) => {
    const core = stripPunctuation(segment);
    if (out.length > 0 && core && core === lastCore) {
      out[out.length - 1] += segment;
    } else {
      out.push(segment);
      lastCore = core;
    }
  });
  return out;
}

/** 块数过多时，把相邻最短的两块合并，直到不超过 limit（内容不丢失） */
function mergeToLimit(list, limit = MAX_BLOCKS) {
  const out = [...list];
  while (out.length > limit) {
    let bestIndex = 0;
    let bestLength = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < out.length - 1; i += 1) {
      const length = out[i].length + out[i + 1].length;
      if (length < bestLength) {
        bestLength = length;
        bestIndex = i;
      }
    }
    out.splice(bestIndex, 2, out[bestIndex] + out[bestIndex + 1]);
  }
  return out;
}

/**
 * 把一首诗拆成可拖拽的诗句块。
 * 优先用 poem_db 里手工分好的 split_lines（词牌、文言等特殊分句），
 * 没有该字段时才自动断句：短诗按逗号拆成单句（四句绝句 → 4 块），
 * 古文等长文本则按句拆并合并到 6 块以内。
 * @param {string} fullText
 * @param {object} [poem] 可选：传入诗篇对象时优先使用其 split_lines
 * @returns {string[]}
 */
export function splitPoemLines(fullText, poem = null) {
  const raw = String(fullText || '').trim();
  if (!raw) return [];

  // 数据里写好的手工分块（已校验过字数与顺序），直接采用
  const preset = getPoemSplitLines(poem);
  if (preset) return preset;

  // 数据里若已经按行排版，直接按行用
  const explicitLines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (explicitLines.length >= 2) return mergeToLimit(explicitLines);

  const sentences = mergeAdjacentDuplicates(splitKeepPunctuation(raw, SENTENCE_END));
  const clauses = mergeAdjacentDuplicates(splitKeepPunctuation(raw, CLAUSE_END));

  // 短诗：按逗号细分成单句，最适合排序
  if (clauses.length >= 2 && clauses.length <= MAX_BLOCKS) return clauses;
  // 长文：按句末标点拆，仍然过多就合并相邻短句
  if (sentences.length >= 2) return mergeToLimit(sentences);

  return mergeToLimit(clauses);
}

export default class SortPoemScene extends BaseScene {
  constructor() {
    super(SCENES.SORT_POEM);
  }

  // ---------------------------------------------------------
  // 生命周期
  // ---------------------------------------------------------
  init(data = {}) {
    this.poemId = Number(data.poemId) || 0;
    this.returnScene = data.returnScene || null;

    this._solved = false;
    this._resultShown = false;
    this._leaving = false;
    this._validating = false;
    this._hintModalOpen = false;
    this._autoTimer = null;
    this._drag = null;

    this.mistakes = 0;
    this.hintUsed = false;
    this.result = null;

    this.blocks = new Map();
    this.items = [];
    this.lines = [];
    this.trayItems = [];
    this.slotItems = [];
    this.slotRects = [];
  }

  create() {
    this.prepareScene();
    this.addBackground('garden', { petals: true });
    this.addGrain(0.12);
    audio.playBgm('level');

    const poem = dataManager.getPoemById(this.poemId) || dataManager.getAllPoems()[0];
    if (!poem) {
      showToast(this, '诗卷里还没有数据，先回主菜单看看吧。', { y: 360 });
      this.time.delayedCall(900, () => this.goTo(SCENES.MENU));
      return;
    }
    this.poem = poem;
    this.poemId = poem.id;

    this.addHeader({
      title: '诗句排序',
      subtitle: `${getChapterName(poem.chapter)} / ${poem.area} · 把打乱的诗句，拖回它原来的顺序`,
      onBack: () => this._requestLeave(),
      backLabel: '返回',
    });

    this._buildPoemBar();
    this._buildBoard();
    this._buildButtons();

    if (!this._buildPuzzle()) return;

    this._layoutAll(false);
    this._refreshBrush();
    this._refreshButtons();
    this._setupInput();
    audio.playPage();
  }

  // ---------------------------------------------------------
  // 顶部：诗名 / 作者 / 标签 / 毛笔
  // ---------------------------------------------------------
  _buildPoemBar() {
    const y = 128;

    const titleText = makeText(this, 64, y, `《${this.poem.title}》`, {
      size: 27,
      color: S.ink,
      origin: [0, 0.5],
    }).setDepth(1005);

    const authorText = makeText(
      this,
      64 + titleText.width + 14,
      y + 3,
      `${this.poem.dynasty} · ${this.poem.author}`,
      { size: 17, color: S.inkSoft, origin: [0, 0.5] },
    ).setDepth(1005);

    let x = 64 + titleText.width + 14 + authorText.width + 22;

    const typeTag = createTag(
      this,
      0,
      y,
      this.poem.type === 'core' ? '课内' : '拓展',
      {
        fill: C.pineLight,
        textColor: S.pineDeep,
        height: 30,
        fontSize: 14,
        depth: 1005,
      },
    );
    typeTag.container.setPosition(x + typeTag.width / 2, y);
    x += typeTag.width + 10;

    if (this.poem.is_hidden) {
      const hiddenTag = createTag(this, 0, y, '隐藏', {
        fill: C.paperDeep,
        textColor: S.peach,
        height: 30,
        fontSize: 14,
        strokeColor: C.peach,
        depth: 1005,
      });
      hiddenTag.container.setPosition(x + hiddenTag.width / 2, y);
      x += hiddenTag.width + 10;
    }

    const diffTag = createTag(this, 0, y, `难度 ${this.poem.difficulty}`, {
      fill: C.paperDeep,
      textColor: S.inkSoft,
      height: 30,
      fontSize: 14,
      strokeColor: C.gold,
      depth: 1005,
    });
    diffTag.container.setPosition(x + diffTag.width / 2, y);

    // 毛笔提示道具（右上角）
    addSeal(this, 1150, y, '笔', 34, C.pineDeep).setDepth(1005);
    this.brushText = makeText(this, 1172, y, '', {
      size: 15,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(1005);
  }

  // ---------------------------------------------------------
  // 中部：纸卡 / 反馈行 / 槽位 / 诗句块图层
  // ---------------------------------------------------------
  _buildBoard() {
    createPaperPanel(this, {
      x: GAME_WIDTH / 2,
      y: 406,
      width: 1180,
      height: 476,
      radius: 30,
      fill: C.paperSoft,
      fillAlpha: 0.96,
      depth: 10,
    });

    this.feedbackText = makeText(
      this,
      GAME_WIDTH / 2,
      180,
      '读一读打乱的诗句，把它们拖到下面正确的位置里。',
      {
        size: 15,
        color: S.inkSoft,
        origin: [0.5, 0.5],
        wrap: 1040,
        lineSpacing: 5,
      },
    ).setDepth(1006);

    this.slotLayer = this.add.container(0, 0).setDepth(900).setScrollFactor(0);
    this.blockLayer = this.add.container(0, 0).setDepth(940).setScrollFactor(0);
    this.fxLayer = this.add.container(0, 0).setDepth(946).setScrollFactor(0);

    this.slotTitle = makeText(this, 96, 330, '按顺序排好', {
      size: 15,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(1006);

    this.slotCountText = makeText(this, 1184, 330, '', {
      size: 15,
      color: S.inkFaint,
      origin: [1, 0.5],
    }).setDepth(1006);
  }

  // ---------------------------------------------------------
  // 底部按钮
  // ---------------------------------------------------------
  _buildButtons() {
    this._backBtn = createButton(this, {
      x: 170,
      y: 676,
      width: 220,
      height: 60,
      radius: 22,
      label: '返回地图',
      variant: 'secondary',
      fontSize: 21,
      depth: 1050,
      onClick: () => this._requestLeave(),
    });

    this._resetBtn = createButton(this, {
      x: 430,
      y: 676,
      width: 180,
      height: 60,
      radius: 22,
      label: '重置',
      variant: 'secondary',
      fontSize: 21,
      depth: 1050,
      onClick: () => this._resetPuzzle(),
    });

    this._hintBtn = createButton(this, {
      x: 650,
      y: 676,
      width: 220,
      height: 60,
      radius: 22,
      label: '毛笔提示',
      variant: 'gold',
      fontSize: 21,
      depth: 1050,
      onClick: () => this._onHint(),
    });

    this._validateBtn = createButton(this, {
      x: 1000,
      y: 676,
      width: 300,
      height: 60,
      radius: 22,
      label: '看看排得对不对',
      variant: 'primary',
      fontSize: 22,
      depth: 1050,
      disabled: true,
      onClick: () => this._validate(true),
    });
  }

  // ---------------------------------------------------------
  // 题目数据
  // ---------------------------------------------------------
  _buildPuzzle() {
    this.lines = splitPoemLines(this.poem.full_text, this.poem);

    if (this.lines.length < 2) {
      showModal(this, {
        title: '这首诗有点短',
        sealText: '短',
        message: '这一篇不足两句，暂时还排不起来。\n先去读别的诗吧。',
        actions: [
          { label: '返回地图', variant: 'primary', onClick: () => this._leaveToMap() },
        ],
      });
      return false;
    }

    this.items = this.lines.map((text, index) => ({
      id: `line_${index}`,
      text,
      correctIndex: index,
    }));

    this.slotItems = new Array(this.lines.length).fill(null);
    this.trayItems = this._shuffleItems(this.items);

    this.items.forEach((item) => this._createBlock(item));
    return true;
  }

  /** 打乱诗句块；保证开局不是正确顺序，避免“没动就通关” */
  _shuffleItems(items) {
    let next = shuffle(items);
    let guard = 0;
    while (next.every((item, index) => item.correctIndex === index) && guard < 8) {
      next = shuffle(items);
      guard += 1;
    }
    if (next.every((item, index) => item.correctIndex === index)) {
      next = [...next.slice(1), next[0]];
    }
    return next;
  }

  /** 创建一块可拖拽的诗句 */
  _createBlock(item) {
    const container = this.add.container(-9999, -9999).setScrollFactor(0);
    const graphics = this.add.graphics();
    const label = makeText(this, 0, 0, item.text, {
      size: 18,
      color: S.ink,
      origin: [0.5, 0.5],
    });
    if (label.width > 980) label.setFontSize(15);

    const zone = this.add
      .zone(0, 0, 200, BLOCK_HEIGHT)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });

    container.add([graphics, label, zone]);

    const block = {
      item,
      container,
      graphics,
      label,
      zone,
      width: 200,
      height: BLOCK_HEIGHT,
      naturalWidth: Math.max(190, Math.round(label.width + 54)),
    };

    zone.on('pointerdown', (pointer) => this._onBlockPointerDown(block, pointer));

    this.blockLayer.add(container);
    this.blocks.set(item.id, block);
    this._resizeBlock(block, block.naturalWidth, BLOCK_HEIGHT);
    return block;
  }

  /** 重新绘制诗句块（拖拽区偏窄、槽位里偏宽，尺寸会变化） */
  _resizeBlock(block, width, height) {
    const w = Math.max(120, Math.round(width));
    const h = Math.max(30, Math.round(height));
    block.width = w;
    block.height = h;

    block.label.setFontSize(block.item.text.length > 26 ? 15 : 18);

    const graphics = block.graphics;
    graphics.clear();

    // 淡淡的纸片阴影
    graphics.fillStyle(0x6f6050, 0.1);
    roundedRectPath(graphics, -w / 2 + 1, -h / 2 + 4, w, h, 14);
    graphics.fillPath();

    // 纸色底
    graphics.fillStyle(C.paperSoft, 0.985);
    roundedRectPath(graphics, -w / 2, -h / 2, w, h, 14);
    graphics.fillPath();

    // 描边
    graphics.lineStyle(1.8, C.gold, 0.55);
    roundedRectPath(graphics, -w / 2, -h / 2, w, h, 14);
    graphics.strokePath();

    // 左侧书页签，像一张夹在诗集里的纸条
    graphics.fillStyle(C.pine, 0.3);
    roundedRectPath(graphics, -w / 2 + 9, -h / 2 + 9, 5, h - 18, 3);
    graphics.fillPath();

    // 内圈高光
    graphics.lineStyle(1, 0xffffff, 0.45);
    roundedRectPath(graphics, -w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 10);
    graphics.strokePath();

    block.label.setPosition(0, 0);
    block.zone.setSize(w, h);
  }

  // ---------------------------------------------------------
  // 布局
  // ---------------------------------------------------------
  _computeLayout() {
    const gapX = 10;
    const gapY = 8;

    const trayPositions = new Map();
    let cursorX = TRAY_LEFT;
    let row = 0;
    let rowTop = TRAY_TOP;

    this.trayItems.forEach((item) => {
      const block = this.blocks.get(item.id);
      const width = Math.min(TRAY_MAX_WIDTH, block ? block.naturalWidth : 240);

      if (cursorX + width > TRAY_LEFT + TRAY_MAX_WIDTH && cursorX > TRAY_LEFT) {
        cursorX = TRAY_LEFT;
        row += 1;
        rowTop = TRAY_TOP + row * (BLOCK_HEIGHT + gapY);
      }

      trayPositions.set(item.id, {
        x: cursorX + width / 2,
        y: rowTop + BLOCK_HEIGHT / 2,
        width,
      });
      cursorX += width + gapX;
    });

    const rows = this.trayItems.length > 0 ? row + 1 : 0;
    const trayBottom =
      TRAY_TOP + rows * BLOCK_HEIGHT + Math.max(0, rows - 1) * gapY;
    const slotsLabelY = trayBottom + 22;
    const slotsTop = slotsLabelY + 20;

    const count = this.lines.length;
    const slotGap = 6;
    let slotHeight = (SLOT_BOTTOM - slotsTop - slotGap * (count - 1)) / count;
    slotHeight = Phaser.Math.Clamp(slotHeight, 34, 58);

    const totalHeight = slotHeight * count + slotGap * (count - 1);
    const startY = slotsTop + Math.max(0, (SLOT_BOTTOM - slotsTop - totalHeight) / 2);

    const slots = [];
    for (let index = 0; index < count; index += 1) {
      slots.push({
        x: SLOT_LEFT,
        y: startY + index * (slotHeight + slotGap),
        width: SLOT_WIDTH,
        height: slotHeight,
      });
    }

    return { trayPositions, slotsLabelY, slots };
  }

  /** 重新排版：槽位、待排区、已放入槽位的诗句块 */
  _layoutAll(animate = true) {
    const layout = this._computeLayout();
    this.slotRects = layout.slots;

    this._drawSlots();

    layout.trayPositions.forEach((position, itemId) => {
      const block = this.blocks.get(itemId);
      if (!block) return;
      this._resizeBlock(block, position.width, BLOCK_HEIGHT);
      this._moveBlock(block, position.x, position.y, animate);
    });

    this.slotItems.forEach((item, index) => {
      if (!item) return;
      const rect = layout.slots[index];
      const block = this.blocks.get(item.id);
      if (!block) return;
      this._resizeBlock(block, rect.width - 18, rect.height - 8);
      this._moveBlock(block, rect.x + rect.width / 2, rect.y + rect.height / 2, animate);
    });

    this.slotTitle.setPosition(96, layout.slotsLabelY);
    this.slotCountText.setPosition(1184, layout.slotsLabelY);
    this._refreshSlotCount();
  }

  _moveBlock(block, x, y, animate) {
    this.tweens.killTweensOf(block.container);
    if (!animate) {
      block.container.setPosition(x, y);
      block.container.setScale(1);
      block.container.setAlpha(1);
      return;
    }
    this.tweens.add({
      targets: block.container,
      x,
      y,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: 150,
      ease: 'Sine.easeOut',
    });
  }

  /** 画目标槽位；solved = true 时换成完成后的青绿色 */
  _drawSlots(solved = false) {
    this.slotLayer.removeAll(true);

    const graphics = this.add.graphics();
    this.slotRects.forEach((rect) => {
      graphics.fillStyle(solved ? C.pineLight : C.paper, solved ? 0.82 : 0.55);
      roundedRectPath(graphics, rect.x, rect.y, rect.width, rect.height, 14);
      graphics.fillPath();
      graphics.lineStyle(solved ? 2 : 1.6, solved ? C.pine : C.inkLine, solved ? 0.85 : 0.9);
      roundedRectPath(graphics, rect.x, rect.y, rect.width, rect.height, 14);
      graphics.strokePath();
    });
    this.slotLayer.add(graphics);

    this.slotRects.forEach((rect, index) => {
      const number = makeText(
        this,
        rect.x - 26,
        rect.y + rect.height / 2,
        NUMERALS[index] || String(index + 1),
        {
          size: 17,
          color: solved ? S.pineDeep : S.inkFaint,
          origin: [0.5, 0.5],
        },
      );
      this.slotLayer.add(number);
    });
  }

  // ---------------------------------------------------------
  // 拖拽
  // ---------------------------------------------------------
  _setupInput() {
    this._handlePointerMove = (pointer) => {
      const drag = this._drag;
      if (!drag || pointer.id !== drag.pointerId) return;
      if (Math.hypot(pointer.x - drag.startX, pointer.y - drag.startY) > 4) {
        drag.moved = true;
      }
      drag.block.container.setPosition(pointer.x + drag.offX, pointer.y + drag.offY);
    };

    this._handlePointerUp = (pointer) => {
      const drag = this._drag;
      if (!drag || pointer.id !== drag.pointerId) return;
      this._drag = null;

      const slotIndex = this._slotIndexAt(pointer.x, pointer.y);
      if (slotIndex >= 0) {
        this._assignToSlot(drag.item, slotIndex);
      } else {
        this._assignToTray(drag.item);
      }
    };

    this.input.on('pointermove', this._handlePointerMove);
    this.input.on('pointerup', this._handlePointerUp);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointermove', this._handlePointerMove);
      this.input.off('pointerup', this._handlePointerUp);
      this._clearAutoTimer();
    });

    if (this.input.keyboard) {
      this.input.keyboard.on('keydown-ESC', () => this._requestLeave());
    }
  }

  _onBlockPointerDown(block, pointer) {
    if (this._solved || this._validating || this._resultShown || this._drag) return;

    this._clearAutoTimer();

    this._drag = {
      block,
      item: block.item,
      pointerId: pointer.id,
      offX: block.container.x - pointer.x,
      offY: block.container.y - pointer.y,
      startX: pointer.x,
      startY: pointer.y,
      moved: false,
    };

    this.blockLayer.bringToTop(block.container);
    block.container.setAlpha(0.96);
    this.tweens.add({
      targets: block.container,
      scaleX: 1.035,
      scaleY: 1.035,
      duration: 110,
      ease: 'Sine.easeOut',
    });

    audio.unlock();
    this._setFeedback('松手放进下面的空位，就排好一句啦。');
  }

  /** 指针下方的槽位序号，没落在槽位里返回 -1 */
  _slotIndexAt(x, y) {
    for (let index = 0; index < this.slotRects.length; index += 1) {
      const rect = this.slotRects[index];
      if (
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y - 6 &&
        y <= rect.y + rect.height + 6
      ) {
        return index;
      }
    }
    return -1;
  }

  /** 放进槽位：同步槽位占用 / 交换 */
  _assignToSlot(item, slotIndex) {
    const fromSlot = this.slotItems.indexOf(item);
    if (fromSlot === slotIndex) {
      this._layoutAll();
      return;
    }

    const occupant = this.slotItems[slotIndex];

    if (occupant && occupant.id !== item.id) {
      if (fromSlot >= 0) {
        // 两个槽位互换，最符合直觉
        this.slotItems[fromSlot] = occupant;
      } else {
        // 从待排区换下一个句子，原占用的句子回到待排区
        this.trayItems.push(occupant);
      }
    } else if (fromSlot >= 0) {
      this.slotItems[fromSlot] = null;
    }

    this.slotItems[slotIndex] = item;
    this.trayItems = this.trayItems.filter((entry) => entry.id !== item.id);

    audio.playClick();
    this._layoutAll();
    this._refreshButtons();
    this._setFeedback('排好一句啦，接着找下一句。');

    if (this.slotItems.every(Boolean)) {
      this._scheduleValidate();
    }
  }

  /** 拖回待排区 */
  _assignToTray(item) {
    const fromSlot = this.slotItems.indexOf(item);
    if (fromSlot >= 0) this.slotItems[fromSlot] = null;
    if (!this.trayItems.some((entry) => entry.id === item.id)) {
      this.trayItems.push(item);
    }
    if (fromSlot >= 0) audio.playClick();
    this._layoutAll();
    this._refreshButtons();
  }

  // ---------------------------------------------------------
  // 重置 / 提示
  // ---------------------------------------------------------
  _resetPuzzle() {
    if (this._solved) return;

    this._clearAutoTimer();
    this._drag = null;

    this.slotItems = new Array(this.lines.length).fill(null);
    this.trayItems = this._shuffleItems(this.items);

    audio.playPage();
    this._layoutAll();
    this._refreshButtons();
    this._setFeedback('诗句又打乱啦，重新排一遍吧。');
    showToast(this, '已经重新打乱诗句', { y: 320, duration: 1200 });
  }

  _onHint() {
    if (this._solved || this._resultShown) return;

    if (progress.getBrushCount() <= 0) {
      showToast(this, '毛笔用完啦，读完这首诗会再得到一支。', { y: 320, tone: 'warn' });
      return;
    }
    if (this._hintModalOpen) return;

    this._hintModalOpen = true;
    this.showModal({
      title: '用一支毛笔换提示？',
      sealText: '笔',
      message: `毛笔还剩 ${progress.getBrushCount()} 支。\n用了之后，会帮你把其中一句放到正确的位置上，星级也会少一颗。`,
      actions: [
        { label: '先自己想想', variant: 'secondary' },
        {
          label: '用一支毛笔',
          variant: 'primary',
          onClick: () => this._applyHint(),
        },
      ],
      onClose: () => {
        this._hintModalOpen = false;
      },
    });
  }

  _applyHint() {
    if (this._solved) return;

    const candidates = this.lines
      .map((_, index) => index)
      .filter((index) => this.slotItems[index]?.correctIndex !== index);

    if (candidates.length === 0) return;

    if (!progress.consumeBrush()) {
      showToast(this, '毛笔不够啦。', { y: 320, tone: 'warn' });
      return;
    }

    // 从左到右第一个不对的位置：最容易被小朋友理解
    const slotIndex = candidates[0];
    const item = this.items[slotIndex];
    const fromSlot = this.slotItems.indexOf(item);
    const occupant = this.slotItems[slotIndex];

    if (fromSlot >= 0) {
      this.slotItems[fromSlot] = occupant;
    } else {
      this.trayItems = this.trayItems.filter((entry) => entry.id !== item.id);
      if (occupant) this.trayItems.push(occupant);
    }
    this.slotItems[slotIndex] = item;

    this.hintUsed = true;
    this._refreshBrush();
    this._layoutAll();
    this._refreshButtons();
    this._flashSlot(slotIndex);
    audio.playClick();

    this._setFeedback(
      `第${NUMERALS[slotIndex] || slotIndex + 1}句已经帮你放好啦，读一读它前后的句子。`,
    );
    showToast(this, `第${NUMERALS[slotIndex] || slotIndex + 1}句归位啦`, {
      y: 320,
      duration: 1500,
    });
  }

  /** 提示后给槽位一个柔和的高亮 */
  _flashSlot(slotIndex) {
    const rect = this.slotRects[slotIndex];
    if (!rect) return;

    const highlight = this.add.graphics();
    highlight.fillStyle(C.goldLight, 0.5);
    roundedRectPath(highlight, rect.x, rect.y, rect.width, rect.height, 14);
    highlight.fillPath();
    highlight.setAlpha(0.9);
    this.fxLayer.add(highlight);

    this.tweens.add({
      targets: highlight,
      alpha: 0,
      duration: 900,
      ease: 'Sine.easeOut',
      onComplete: () => highlight.destroy(),
    });
  }

  // ---------------------------------------------------------
  // 判定
  // ---------------------------------------------------------
  _scheduleValidate() {
    this._clearAutoTimer();
    this._autoTimer = this.time.delayedCall(700, () => {
      this._autoTimer = null;
      this._validate(false);
    });
  }

  _clearAutoTimer() {
    if (this._autoTimer) {
      this._autoTimer.remove(false);
      this._autoTimer = null;
    }
  }

  /** @param {boolean} manual 是否小朋友主动点了「看看排得对不对」 */
  _validate(manual = false) {
    if (this._solved || this._validating) return;
    this._clearAutoTimer();

    if (this.slotItems.some((item) => !item)) {
      if (manual) {
        showToast(this, '还有几个位置空着，先把每一句都放好吧。', { y: 320 });
      }
      return;
    }

    const correct = this.slotItems.every(
      (item, index) => item.text === this.lines[index],
    );

    if (correct) {
      this._solve();
      return;
    }

    // 排错：温和提示 + 写入错题本，但不公布正确顺序
    this.mistakes += 1;
    this._validating = true;
    progress.addWrongRecord(this.poem.id);
    audio.playWrong();

    const difficulty = getDifficultyConfig(progress.getDifficulty());
    const message = difficulty.gentleNudge
      ? '顺序还差一点点，别急，小诗童陪你从头读一遍。'
      : '顺序还差一点点，再读一读，想想哪一句该在最前面。';

    this._setFeedback(message, true);
    showToast(this, message, { y: 320, tone: 'warn', duration: 2200 });
    this._shakeBlocks();

    this.time.delayedCall(560, () => {
      this._validating = false;
    });
  }

  /** 排错时整排诗句轻轻摇一下，比直接标红更温柔 */
  _shakeBlocks() {
    this.tweens.killTweensOf(this.blockLayer);
    this.blockLayer.x = 0;
    this.tweens.add({
      targets: this.blockLayer,
      x: { from: -7, to: 7 },
      duration: 85,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        this.blockLayer.x = 0;
      },
    });
  }

  _solve() {
    if (this._solved) return;
    this._solved = true;
    this._clearAutoTimer();

    const stars = this._calcStars();
    audio.playCorrect();
    this._setFeedback('顺序排对啦！这一首，你已经读顺了。');
    this._drawSlots(true);
    this._refreshButtons();

    this.blocks.forEach((block) => block.zone.disableInteractive());

    // 槽位里的诗句换成淡淡的完成色
    this.time.delayedCall(520, () => {
      if (!this.scene.isActive()) return;
      this._handleSolved(stars);
    });
  }

  _calcStars() {
    const penalty = this.mistakes + (this.hintUsed ? 1 : 0);
    return Math.max(1, Math.min(3, 3 - penalty));
  }

  _handleSolved(stars) {
    this.result = progress.markPoemComplete(this.poem.id, stars);
    console.info('[诗句排序] 结算：', {
      poem: this.poem.title,
      stars,
      mistakes: this.mistakes,
      hintUsed: this.hintUsed,
      result: this.result,
    });

    if (!this.result) {
      showToast(this, '结算时没有找到这首诗，请回到地图重试。', { y: 320, tone: 'warn' });
      return;
    }

    audio.playUnlock();
    this.time.delayedCall(320, () => {
      if (!this.scene.isActive()) return;
      this._showResult();
    });
  }

  // ---------------------------------------------------------
  // 结算面板
  // ---------------------------------------------------------
  _showResult() {
    if (this._resultShown) return;
    this._resultShown = true;

    const root = this.add.container(0, 0).setDepth(3000).setScrollFactor(0);
    this._resultRoot = root;

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
      depth: 3001,
    });
    root.add(panel);

    root.add(addSeal(this, 250, 142, this.result.newCard ? '得' : '温', 52, C.peachDeep));

    root.add(
      makeText(
        this,
        GAME_WIDTH / 2 + 20,
        124,
        this.result.newCard ? '排对啦 · 诗卡入卷' : '又排对啦 · 诗意更熟',
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
      depth: 3002,
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
      makeText(
        this,
        GAME_WIDTH / 2,
        250,
        `${this.poem.dynasty} · ${this.poem.author}　·　${getChapterName(this.poem.chapter)} / ${this.poem.area}`,
        { size: 15, color: S.inkSoft, origin: [0.5, 0.5] },
      ),
    );

    // 全诗与拼音：可拖动阅读，长诗也不会撑破纸卡
    const scroll = new ScrollPanel(this, {
      x: 270,
      y: 268,
      width: 740,
      height: 118,
      radius: 14,
      depth: 3010,
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
    scroll.layout(cursorY);
    scroll.scrollToTop();

    // 本次收获
    const lines = [];
    if (this.result.newCard) {
      lines.push(`✦ 新诗卡《${this.poem.title}》已收入图鉴`);
    } else {
      lines.push(`✦ 诗卡星级更新为 ${this.result.stars} ★`);
    }
    if (this.mistakes === 0 && !this.hintUsed) {
      lines.push('✦ 一次排对，三颗星全收下');
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
    if (this.result.brushGained > 0) {
      lines.push(`✦ 毛笔 +${this.result.brushGained}，现有 ${progress.getBrushCount()} 支`);
    }
    this.result.newlyUnlockedChapters.forEach((chapterId) => {
      const name = getChapterName(chapterId);
      if (name) lines.push(`✦ 新诗路解锁：${name}`);
    });

    let rewardLines = lines;
    if (rewardLines.length > 5) {
      rewardLines = [...rewardLines.slice(0, 4), '✦ 其余收获已自动记入图鉴、逸闻册与陈列馆'];
    }

    root.add(
      makeText(this, GAME_WIDTH / 2, 402, rewardLines.join('\n'), {
        size: 15,
        color: S.pineDeep,
        origin: [0.5, 0],
        align: 'center',
        wrap: 780,
        lineSpacing: 5,
      }),
    );

    const againButton = createButton(this, {
      x: 440,
      y: 570,
      width: 300,
      height: 66,
      radius: 24,
      label: '再排一次',
      variant: 'secondary',
      fontSize: 23,
      depth: 3002,
      onClick: () => {
        this.scene.restart({ poemId: this.poemId, returnScene: this.returnScene });
      },
    });
    root.add(againButton.container);

    const mapButton = createButton(this, {
      x: 840,
      y: 570,
      width: 340,
      height: 66,
      radius: 24,
      label: '返回地图',
      variant: 'primary',
      fontSize: 24,
      depth: 3002,
      onClick: () => this._leaveToMap(),
    });
    root.add(mapButton.container);

    root.add(
      makeText(this, GAME_WIDTH / 2, 624, '进度已自动保存在本机 · 不联网、不上传', {
        size: 12,
        color: S.inkFaint,
        origin: [0.5, 0.5],
      }),
    );
  }

  // ---------------------------------------------------------
  // 离开
  // ---------------------------------------------------------
  _requestLeave() {
    if (this._leaving) return;
    if (this._solved) {
      this._leaveToMap();
      return;
    }

    this._leaving = true;
    showModal(this, {
      title: '先离开这一题吗？',
      sealText: '问',
      message: '这首诗还没有排完。\n离开后进度会留在原地，下次还可以再来排。',
      actions: [
        { label: '继续排句', variant: 'primary' },
        {
          label: '先离开',
          variant: 'secondary',
          onClick: () => this._leaveToMap(),
        },
      ],
      onClose: () => {
        this._leaving = false;
      },
    });
  }

  /** 回到来源场景；没有来源（例如从 URL 直接进入）就回到对应章节地图 */
  _leaveToMap() {
    if (this._navigating) return;
    this._navigating = true;

    const target = this.returnScene;
    if (target && target !== this.scene.key) {
      if (this.scene.isPaused(target)) {
        this.scene.resume(target);
        this.scene.stop();
        return;
      }
      if (this.scene.isActive(target)) {
        this.scene.stop();
        return;
      }
    }

    this.scene.start(SCENES.MAP, { chapterId: this.poem ? this.poem.chapter : 1 });
  }

  // ---------------------------------------------------------
  // 小工具
  // ---------------------------------------------------------
  _setFeedback(text, warn = false) {
    if (!this.feedbackText) return;
    this.feedbackText.setText(text);
    this.feedbackText.setColor(warn ? S.danger : S.inkSoft);
  }

  _refreshBrush() {
    if (this.brushText) {
      this.brushText.setText(`毛笔 × ${progress.getBrushCount()}`);
    }
  }

  _refreshSlotCount() {
    if (!this.slotCountText) return;
    const placed = this.slotItems.filter(Boolean).length;
    this.slotCountText.setText(`已排 ${placed} / ${this.lines.length}`);
  }

  _refreshButtons() {
    const solved = this._solved;
    const full = this.slotItems.every(Boolean);

    if (this._resetBtn) this._resetBtn.setDisabled(solved);
    if (this._hintBtn) this._hintBtn.setDisabled(solved);
    if (this._validateBtn) this._validateBtn.setDisabled(solved || !full);
    this._refreshSlotCount();
  }
}
