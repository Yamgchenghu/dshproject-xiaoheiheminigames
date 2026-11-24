/**
 * PoemMatch3Scene：诗句三消玩法（独立场景）
 * ------------------------------------------------------------
 * 玩法（重点：不是「同字消除」）：
 *  1. 读一首 poem，按标点拆成一句句「诗句行」，再把整首诗的字打散铺成方格棋盘，
 *     混入少量不属于这首诗的干扰汉字；
 *  2. 玩家拖动 / 点选交换上下左右相邻的两个字块；
 *  3. 只有当某一整行（或某一整列）连续的字块，从头到尾刚好等于一句完整的
 *     目标诗句时，才会自动消除、加分；任何「差一个字」的连字都不会消除；
 *  4. 把本屏所有目标诗句都消掉就通过这一屏；干扰字可以一直留在棋盘上；
 *  5. 关卡总步数有限，每交换一次扣 1 步；每清空一屏额外奖励步数；
 *     步数耗尽仍未通关即判定失败；
 *  6. 通关走与「看图猜诗」同一套结算：ProgressManager.markPoemComplete
 *     （诗卡 / 星级 / 错题清除 / 轶事 / 藏品 / 章节解锁）；失败写入错题本；
 *  7. 支持「重置棋盘」（重新打散剩余字块，不耗步数）与「毛笔提示」
 *     （消耗 1 支毛笔，点亮一个正确的字位）。
 *
 * 复用：
 *  - BaseScene（背景、头部、吐司、弹窗、转场）
 *  - ProgressManager / AudioManager
 *  - ui/components、ui/background、ui/ScrollPanel
 *
 * 入口：
 *  - { poemId, returnScene? }；开发预览：路径加 `?match3=1`（见 main.js）
 *  - 不依赖、也不修改任何原有场景
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

// ---------------------------------------------------------
// 布局常量（1280 × 720 设计分辨率）
// ---------------------------------------------------------
// 棋盘纸卡：x / y 是纸卡中心，整块占 44~796 宽、160~620 高
const BOARD = { x: 420, y: 390, width: 752, height: 460 };
const PANEL = { x: 1030, y: 390, width: 420, height: 460 };

const BOARD_PADDING = 20; // 棋盘纸卡内边距
const CELL_MAX = 76; // 单格最大边长（保证大字清晰）
const CELL_MIN = 54;
const CELL_GAP = 8;

const ROW_HEIGHT = 34;
const ROW_START_OFFSET = 80;
const ROW_STEP = 40;

// 诗句拆分 / 分屏
const MIN_LINE_LEN = 3; // 少于 3 个字的碎片并入相邻句
const MAX_LINE_LEN = 10; // 单句最长格子数（横向要放得下）
const MAX_BOARD_CHARS = 32; // 单屏目标字数上限
const MIN_BOARD_COLS = 5;
const MAX_BOARD_COLS = 10;
const MIN_BOARD_ROWS = 3;
const MAX_BOARD_ROWS = 6;
const MIN_DISTRACTORS = 3;
const WANT_DISTRACTORS = 4;

// 步数 / 星级
const MOVES_FACTOR = 2.6;
const MOVES_BASE = 16;
const BOARD_CLEAR_BONUS = 8;
const STAR_THREE_RATIO = 0.4;
const STAR_TWO_RATIO = 0.15;

const SPLIT_PUNCTUATION = '，,、；;：:。！？!?…·';
const TRIM_CHARS = /[“”"'‘’「」『』（）()【】〈〉《》\s]/g;
const FALLBACK_DISTRACTORS = '风花雪月山水云天春夏秋冬江河湖海诗书琴画';

// ---------------------------------------------------------
// 文本工具（纯函数，便于验收脚本直接引用）
// ---------------------------------------------------------

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * 把 full_text 拆成「诗句行」：按标点切句，去掉标点与引号，
 * 太短的碎片（例如「鹅」「鹅」「鹅」或「可也」）并入相邻句，
 * 过长的古文句子再对半拆开，保证单句长度在 3 ~ 10 字之间。
 * @param {string} fullText
 * @returns {string[]}
 */
export function splitPoemLines(fullText) {
  const clean = String(fullText || '')
    .replace(TRIM_CHARS, '')
    .replace(/\s+/g, '');
  if (!clean) return [];

  const fragments = [];
  let buffer = '';
  for (const char of clean) {
    if (SPLIT_PUNCTUATION.includes(char)) {
      if (buffer) {
        fragments.push(buffer);
        buffer = '';
      }
      continue;
    }
    buffer += char;
  }
  if (buffer) fragments.push(buffer);

  const merged = [];
  let pending = '';
  fragments.forEach((fragment) => {
    if (fragment.length < MIN_LINE_LEN) {
      // 短碎片优先并入上一句；开头还没有上一句就先攒着，等下一句一起用
      if (merged.length > 0) {
        merged[merged.length - 1] += fragment;
      } else {
        pending += fragment;
        if (pending.length >= MIN_LINE_LEN) {
          merged.push(pending);
          pending = '';
        }
      }
      return;
    }
    merged.push(pending ? `${pending}${fragment}` : fragment);
    pending = '';
  });
  if (pending) {
    if (merged.length > 0) merged[merged.length - 1] += pending;
    else merged.push(pending);
  }

  // 超长句对半拆，避免一屏放不下
  const lines = [];
  merged.forEach((line) => {
    if (line.length <= MAX_LINE_LEN) {
      lines.push(line);
      return;
    }
    let rest = line;
    while (rest.length > MAX_LINE_LEN) {
      const headLength = Math.ceil(rest.length / 2);
      lines.push(rest.slice(0, headLength));
      rest = rest.slice(headLength);
    }
    if (rest.length >= MIN_LINE_LEN) lines.push(rest);
    else if (lines.length > 0) lines[lines.length - 1] += rest;
    else lines.push(rest);
  });

  return lines.filter((line) => line.length > 0);
}

/** 单格边长：宽高都要放得下，最小 54、最大 76 */
export function cellSizeFor(cols, rows) {
  const innerWidth = BOARD.width - BOARD_PADDING * 2;
  const innerHeight = BOARD.height - BOARD_PADDING * 2;
  const widthFit = (innerWidth - CELL_GAP * (cols - 1)) / cols;
  const heightFit = (innerHeight - CELL_GAP * (rows - 1)) / rows;
  return clamp(Math.floor(Math.min(widthFit, heightFit)), CELL_MIN, CELL_MAX);
}

/**
 * 把整首诗切成若干「屏」：每屏目标字数不超过 MAX_BOARD_CHARS，
 * 再按最长的一句决定列数，按字数 + 干扰字决定行数。
 * @param {string} fullText
 * @returns {Array<{index:number, lines:Array<{text:string, completed:boolean}>, chars:number, cols:number, rows:number, distractorCount:number}>}
 */
export function planPoemBoards(fullText) {
  const lines = splitPoemLines(fullText);
  if (lines.length === 0) return [];

  const groups = [];
  let current = null;
  lines.forEach((text) => {
    if (!current || (current.lines.length > 0 && current.chars + text.length > MAX_BOARD_CHARS)) {
      current = { lines: [], chars: 0 };
      groups.push(current);
    }
    current.lines.push(text);
    current.chars += text.length;
  });

  return groups.map((group, index) => {
    const maxLine = group.lines.reduce((max, text) => Math.max(max, text.length), 0);
    let cols = clamp(maxLine, MIN_BOARD_COLS, MAX_BOARD_COLS);
    let rows = Math.max(MIN_BOARD_ROWS, Math.ceil((group.chars + WANT_DISTRACTORS) / cols));

    // 列数不够（格子被压得太小 / 行数过多）时，加宽棋盘
    let guard = 0;
    while (guard < 12 && (rows > MAX_BOARD_ROWS || cellSizeFor(cols, rows) < CELL_MIN)) {
      if (cols >= MAX_BOARD_COLS) break;
      cols += 1;
      rows = Math.max(MIN_BOARD_ROWS, Math.ceil((group.chars + WANT_DISTRACTORS) / cols));
      guard += 1;
    }

    let distractorCount = cols * rows - group.chars;
    while (distractorCount < MIN_DISTRACTORS && rows < MAX_BOARD_ROWS) {
      rows += 1;
      distractorCount = cols * rows - group.chars;
    }
    if (distractorCount < 0) distractorCount = 0;

    return {
      index,
      lines: group.lines.map((text) => ({ text, completed: false })),
      chars: group.chars,
      cols,
      rows,
      distractorCount,
    };
  });
}

export default class PoemMatch3Scene extends BaseScene {
  constructor() {
    super(SCENES.POEM_MATCH3);
  }

  // ---------------------------------------------------------
  // 生命周期
  // ---------------------------------------------------------
  init(data = {}) {
    this.poemId = Number(data.poemId) || 0;
    this.returnScene = data.returnScene || null;

    this._solved = false;
    this._failed = false;
    this._resultShown = false;
    this._leaving = false;
    this._hintModalOpen = false;

    this.poem = null;
    this.boards = [];
    this.boardIndex = 0;
    this.boardLines = [];
    this.boardLayout = null;
    this.grid = [];
    this.busy = false;

    this.movesLeft = 0;
    this.movesBudget = 0;
    this.score = 0;
    this.brushHintUsed = false;

    this.drag = null;
    this.selected = null;
    this._pressedCell = null;
    this._hintLayer = null;
    this._selectionLayer = null;

    this._targetRows = [];
    this.result = null;
  }

  create() {
    this.prepareScene();
    this._bindBoardInput();
    this.addBackground('mist', { petals: true });
    this.addGrain(0.1);
    audio.playBgm('level');

    const poem = dataManager.getPoemById(this.poemId) || dataManager.getAllPoems()[0];
    if (!poem) {
      showToast(this, '诗卷里还没有数据，先回主菜单看看吧。', { y: 360 });
      this.time.delayedCall(900, () => this.goTo(SCENES.MENU));
      return;
    }

    this.poem = poem;
    this.poemId = poem.id;
    this.difficulty = getDifficultyConfig(progress.getDifficulty());
    this.boards = planPoemBoards(poem.full_text);
    if (this.boards.length === 0) {
      showToast(this, '这首诗暂时排不出棋盘，先换一首吧。', { y: 320, tone: 'warn' });
      this.time.delayedCall(1200, () => this._leaveToMap());
      return;
    }

    const totalChars = this.boards.reduce((sum, board) => sum + board.chars, 0);
    this.movesBudget = Math.round(totalChars * MOVES_FACTOR) + MOVES_BASE;
    this.movesLeft = this.movesBudget;

    this.addHeader({
      title: '诗句三消',
      subtitle: `${getChapterName(poem.chapter)} / ${poem.area} · 把打散的字块换一换，连成完整的一句就消除`,
      onBack: () => this._requestLeave(),
      backLabel: '返回',
    });

    this._buildPoemBar();
    this._buildBoardFrame();
    this._buildTargetPanel();
    this._buildBottomBar();

    this._startBoard(0);
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

    const typeTag = createTag(this, 0, y, this.poem.type === 'core' ? '课内' : '拓展', {
      fill: C.pineLight,
      textColor: S.pineDeep,
      height: 30,
      fontSize: 14,
      depth: 1005,
    });
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

    addSeal(this, 1150, y, '笔', 34, C.pineDeep).setDepth(1005);
    this.brushText = makeText(this, 1172, y, '', {
      size: 15,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(1005);
  }

  // ---------------------------------------------------------
  // 棋盘纸卡
  // ---------------------------------------------------------
  _buildBoardFrame() {
    createPaperPanel(this, {
      x: BOARD.x,
      y: BOARD.y,
      width: BOARD.width,
      height: BOARD.height,
      radius: 30,
      fill: C.paperSoft,
      fillAlpha: 0.96,
      depth: 10,
    });

    // 很淡的装订线，让棋盘像一页摊开的字帖
    const line = this.add.graphics().setDepth(11).setScrollFactor(0);
    line.lineStyle(1, C.gold, 0.22);
    line.beginPath();
    line.moveTo(BOARD.x - BOARD.width / 2 + 30, BOARD.y - BOARD.height / 2 + 16);
    line.lineTo(BOARD.x + BOARD.width / 2 - 30, BOARD.y - BOARD.height / 2 + 16);
    line.strokePath();

    this.boardCaption = makeText(this, 0, 0, '', {
      size: 13,
      color: S.inkFaint,
      origin: [0, 0.5],
    }).setDepth(12);

    this._selectionLayer = this.add.container(0, 0).setDepth(1100).setScrollFactor(0);
    this._hintLayer = this.add.container(0, 0).setDepth(1200).setScrollFactor(0);
  }

  // ---------------------------------------------------------
  // 右侧：目标诗句 / 进度 / 步数 / 得分
  // ---------------------------------------------------------
  _buildTargetPanel() {
    createPaperPanel(this, {
      x: PANEL.x,
      y: PANEL.y,
      width: PANEL.width,
      height: PANEL.height,
      radius: 26,
      fill: C.paperSoft,
      fillAlpha: 0.96,
      depth: 10,
    });

    const top = PANEL.y - PANEL.height / 2;
    addSeal(this, PANEL.x - PANEL.width / 2 + 38, top + 36, '目', 32, C.pineDeep).setDepth(12);
    makeText(this, PANEL.x + 6, top + 36, '目标诗句', {
      size: 23,
      color: S.ink,
      origin: [0.5, 0.5],
    }).setDepth(12);

    const divider = this.add.graphics().setDepth(12).setScrollFactor(0);
    divider.lineStyle(1.2, C.gold, 0.34);
    divider.beginPath();
    divider.moveTo(PANEL.x - PANEL.width / 2 + 30, top + 64);
    divider.lineTo(PANEL.x + PANEL.width / 2 - 30, top + 64);
    divider.strokePath();

    const rowStart = top + ROW_START_OFFSET;
    for (let i = 0; i < 6; i += 1) {
      const container = this.add.container(PANEL.x, rowStart + i * ROW_STEP).setDepth(20).setScrollFactor(0);
      const bg = this.add.graphics();
      const text = makeText(this, -PANEL.width / 2 + 46, 0, '', {
        size: 20,
        color: S.ink,
        origin: [0, 0.5],
      });
      const check = makeText(this, PANEL.width / 2 - 46, 0, '✓', {
        size: 19,
        color: S.pineDeep,
        origin: [0.5, 0.5],
      });
      check.setVisible(false);
      container.add([bg, text, check]);
      this._targetRows.push({ container, bg, text, check });
    }

    this.progressText = makeText(this, PANEL.x, top + 332, '', {
      size: 15,
      color: S.inkSoft,
      origin: [0.5, 0.5],
      align: 'center',
      wrap: PANEL.width - 60,
      lineSpacing: 5,
    }).setDepth(20);

    this.movesText = makeText(this, PANEL.x, top + 372, '', {
      size: 26,
      color: S.ink,
      origin: [0.5, 0.5],
    }).setDepth(20);

    this.scoreText = makeText(this, PANEL.x, top + 402, '', {
      size: 17,
      color: S.inkSoft,
      origin: [0.5, 0.5],
    }).setDepth(20);

    this.tipText = makeText(this, PANEL.x, top + 436, '换相邻两块，凑成整句才会消失', {
      size: 13,
      color: S.inkFaint,
      origin: [0.5, 0.5],
      align: 'center',
      wrap: PANEL.width - 60,
      lineSpacing: 4,
    }).setDepth(20);
  }

  // ---------------------------------------------------------
  // 底部：返回 / 重置 / 毛笔提示
  // ---------------------------------------------------------
  _buildBottomBar() {
    this._backBtn = createButton(this, {
      x: 150,
      y: 676,
      width: 200,
      height: 58,
      radius: 22,
      label: '返回地图',
      variant: 'secondary',
      fontSize: 20,
      depth: 1050,
      onClick: () => this._requestLeave(),
    });

    this._resetBtn = createButton(this, {
      x: 396,
      y: 676,
      width: 216,
      height: 58,
      radius: 22,
      label: '重置棋盘',
      variant: 'soft',
      fontSize: 20,
      depth: 1050,
      onClick: () => this._onReset(),
    });

    this._hintBtn = createButton(this, {
      x: 660,
      y: 676,
      width: 248,
      height: 58,
      radius: 22,
      label: '毛笔提示',
      variant: 'gold',
      fontSize: 20,
      depth: 1050,
      onClick: () => this._onHint(),
    });

    this.statusText = makeText(this, 806, 676, '', {
      size: 14,
      color: S.inkSoft,
      origin: [0, 0.5],
      align: 'left',
      wrap: 430,
      lineSpacing: 4,
    }).setDepth(1050);
  }

  // ---------------------------------------------------------
  // 开始 / 重开一屏
  // ---------------------------------------------------------
  _startBoard(index) {
    const board = this.boards[index];
    if (!board) return;

    this.boardIndex = index;
    this.boardLines = board.lines;
    this.boardLines.forEach((line) => {
      line.completed = false;
    });

    const { cols, rows } = board;
    const cellSize = cellSizeFor(cols, rows);
    const gridWidth = cols * cellSize + (cols - 1) * CELL_GAP;
    const gridHeight = rows * cellSize + (rows - 1) * CELL_GAP;
    this.boardLayout = {
      cols,
      rows,
      cellSize,
      gridWidth,
      gridHeight,
      originX: BOARD.x - gridWidth / 2,
      originY: BOARD.y - gridHeight / 2,
    };

    this.busy = true;
    this._clearHint();
    this._clearSelection();

    const chars = [];
    board.lines.forEach((line) => {
      [...line.text].forEach((char) => chars.push({ char }));
    });
    this._pickDistractors(board.distractorCount).forEach((char) => chars.push({ char }));

    this._layoutTiles(this._shuffleMatrix(chars));
    this._refreshTargets();
    this._refreshHud();

    if (this.boardCaption) {
      const room = this.boardLayout.originY - (BOARD.y - BOARD.height / 2);
      if (room >= 34) {
        this.boardCaption.setVisible(true);
        this.boardCaption.setPosition(
          this.boardLayout.originX,
          BOARD.y - BOARD.height / 2 + 22,
        );
        this.boardCaption.setText(
          `第 ${index + 1} 屏 · ${board.lines.length} 句 · 目标 ${board.chars} 字`,
        );
      } else {
        this.boardCaption.setVisible(false);
      }
    }

    if (index > 0) {
      showToast(this, `第 ${index + 1} 屏 · 继续把诗句排完整吧`, { y: 320, duration: 1600 });
    }

    this.time.delayedCall(640, () => {
      if (!this.scene.isActive()) return;
      this.busy = false;
      this._refreshHud();
    });
  }

  /**
   * 干扰字：只从「其它诗篇」里挑，而且必须不属于本诗用到的字。
   * 这样任何含干扰字的连续格子都不可能凑成一句目标诗句，
   * 从根上杜绝「错误连句被消除」。
   */
  _pickDistractors(count) {
    if (count <= 0) return [];
    const poemChars = new Set(
      this.boards
        .map((board) => board.lines.map((line) => line.text).join(''))
        .join('')
        .split(''),
    );

    const groups = [[], [], []];
    const seen = new Set();
    dataManager
      .getAllPoems()
      .filter((poem) => poem.id !== this.poem.id)
      .forEach((poem) => {
        const rank = poem.area === this.poem.area ? 0 : poem.chapter === this.poem.chapter ? 1 : 2;
        splitPoemLines(poem.full_text)
          .join('')
          .split('')
          .forEach((char) => {
            if (poemChars.has(char) || seen.has(char)) return;
            seen.add(char);
            groups[rank].push(char);
          });
      });

    const picked = [];
    groups.forEach((group) => {
      shuffle(group).forEach((char) => {
        if (picked.length < count) picked.push(char);
      });
    });

    if (picked.length < count) {
      const fallback = FALLBACK_DISTRACTORS.split('').filter((char) => !poemChars.has(char));
      let cursor = 0;
      while (picked.length < count && fallback.length > 0 && cursor < 200) {
        picked.push(fallback[cursor % fallback.length]);
        cursor += 1;
      }
    }
    return picked;
  }

  /** 把字块随机铺到棋盘上，保证开局没有任何一句已经成行 */
  _shuffleMatrix(chars) {
    const { rows, cols } = this.boardLayout;
    const slots = Array.from({ length: rows * cols }, (_, index) => index);
    const build = () => {
      const matrix = Array.from({ length: rows }, () => new Array(cols).fill(null));
      shuffle(slots)
        .slice(0, chars.length)
        .forEach((slot, index) => {
          matrix[Math.floor(slot / cols)][slot % cols] = chars[index].char;
        });
      return matrix;
    };
    const hasLine = (matrix) => this._matchWindows(
      this.boardLines,
      (r, c) => matrix[r][c] || '',
    ).length > 0;

    let matrix = build();
    for (let attempt = 0; attempt < 60 && hasLine(matrix); attempt += 1) {
      matrix = build();
    }

    // 兜底：随机两两交换，直到棋盘上不再有成句（只换位置，字块集合不变）
    for (let step = 0; step < 240 && hasLine(matrix); step += 1) {
      const filled = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          if (matrix[r][c]) filled.push({ r, c });
        }
      }
      if (filled.length < 2) break;
      const first = filled[Math.floor(Math.random() * filled.length)];
      const second = filled[Math.floor(Math.random() * filled.length)];
      if (first.r === second.r && first.c === second.c) continue;
      const temp = matrix[first.r][first.c];
      matrix[first.r][first.c] = matrix[second.r][second.c];
      matrix[second.r][second.c] = temp;
    }
    return matrix;
  }

  // ---------------------------------------------------------
  // 字块渲染
  // ---------------------------------------------------------
  _layoutTiles(matrix) {
    this._clearTiles();
    const { rows, cols } = this.boardLayout;
    this.grid = Array.from({ length: rows }, () => new Array(cols).fill(null));

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const char = matrix[r]?.[c];
        if (!char) continue;
        const center = this._cellCenter(r, c);
        this.grid[r][c] = this._createTile(char, center.x, center.y, r + c);
      }
    }
  }

  _createTile(char, x, y, delayIndex) {
    const size = this.boardLayout.cellSize;
    const radius = Math.round(size * 0.22);
    const container = this.add.container(x, y).setDepth(60).setScrollFactor(0);

    const graphics = this.add.graphics();
    // 纸片投影
    graphics.fillStyle(0x6f6050, 0.12);
    roundedRectPath(graphics, -size / 2 + 1, -size / 2 + 5, size, size, radius);
    graphics.fillPath();
    // 纸面
    graphics.fillStyle(C.paper, 0.99);
    roundedRectPath(graphics, -size / 2, -size / 2, size, size, radius);
    graphics.fillPath();
    // 描边
    graphics.lineStyle(2, C.inkLine, 0.85);
    roundedRectPath(graphics, -size / 2, -size / 2, size, size, radius);
    graphics.strokePath();
    // 内侧高光
    graphics.lineStyle(1, 0xffffff, 0.6);
    roundedRectPath(graphics, -size / 2 + 4, -size / 2 + 4, size - 8, size - 8, radius - 3);
    graphics.strokePath();

    const text = makeText(this, 0, 1, char, {
      size: Math.round(size * 0.56),
      color: S.ink,
      origin: [0.5, 0.5],
    });

    container.add([graphics, text]);
    container.setScale(0.5).setAlpha(0);
    this.tweens.add({
      targets: container,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: 260,
      delay: Math.min(360, delayIndex * 18),
      ease: 'Back.easeOut',
    });

    return {
      char,
      container,
      text,
      graphics,
      baseX: x,
      baseY: y,
    };
  }

  _clearTiles() {
    this.grid.forEach((row) => {
      row.forEach((tile) => {
        if (tile && tile.container) tile.container.destroy(true);
      });
    });
    this.grid = [];
  }

  _cellCenter(r, c) {
    const { originX, originY, cellSize } = this.boardLayout;
    return {
      x: originX + c * (cellSize + CELL_GAP) + cellSize / 2,
      y: originY + r * (cellSize + CELL_GAP) + cellSize / 2,
    };
  }

  /** 把指针坐标换算成格子；落在缝隙里也算最近的一格，手指更容易点中 */
  _cellAt(pointer) {
    if (!this.boardLayout) return null;
    const { cols, rows, cellSize, originX, originY } = this.boardLayout;
    const pitch = cellSize + CELL_GAP;
    const localX = pointer.x - originX;
    const localY = pointer.y - originY;
    if (localX < 0 || localY < 0) return null;
    const c = Math.floor(localX / pitch);
    const r = Math.floor(localY / pitch);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    return { r, c };
  }

  _isAdjacent(a, b) {
    if (!a || !b) return false;
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  }

  // ---------------------------------------------------------
  // 触屏交互：拖拽 / 点选
  // ---------------------------------------------------------
  _bindBoardInput() {
    this.input.on('pointerdown', (pointer) => this._onPointerDown(pointer));
    this.input.on('pointermove', (pointer) => this._onPointerMove(pointer));
    this.input.on('pointerup', (pointer) => this._onPointerUp(pointer));
    this.input.on('pointerupoutside', (pointer) => this._onPointerUp(pointer));
  }

  _canPlay() {
    return Boolean(
      this.scene.isActive()
      && !this._solved
      && !this._failed
      && !this._resultShown
      && !this._hintModalOpen
      && !this._leaving
      && this.boardLayout,
    );
  }

  _onPointerDown(pointer) {
    if (!this._canPlay() || this.busy) return;
    const cell = this._cellAt(pointer);
    if (!cell) return;

    this._clearHint();
    this.drag = { id: pointer.id, cell, x: pointer.x, y: pointer.y };
    this._pressedCell = cell;

    const tile = this.grid[cell.r][cell.c];
    if (tile) {
      this.tweens.add({
        targets: tile.container,
        scaleX: 1.08,
        scaleY: 1.08,
        duration: 90,
        ease: 'Sine.easeOut',
      });
    }
  }

  _onPointerMove(pointer) {
    if (!this.drag || pointer.id !== this.drag.id) return;
    if (!this._canPlay() || this.busy) return;

    const dx = pointer.x - this.drag.x;
    const dy = pointer.y - this.drag.y;
    const threshold = Math.max(18, this.boardLayout.cellSize * 0.3);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return;

    const from = this.drag.cell;
    const target = Math.abs(dx) > Math.abs(dy)
      ? { r: from.r, c: from.c + (dx > 0 ? 1 : -1) }
      : { r: from.r + (dy > 0 ? 1 : -1), c: from.c };

    const { rows, cols } = this.boardLayout;
    if (target.r < 0 || target.r >= rows || target.c < 0 || target.c >= cols) return;

    this.drag = null;
    this._trySwap(from, target);
  }

  _onPointerUp(pointer) {
    const drag = this.drag;
    this.drag = null;

    const pressed = this._pressedCell;
    this._pressedCell = null;
    if (pressed) {
      const tile = this.grid[pressed.r]?.[pressed.c];
      if (tile && tile.container && tile.container.scene) {
        this.tweens.add({
          targets: tile.container,
          scaleX: 1,
          scaleY: 1,
          duration: 130,
          ease: 'Back.easeOut',
        });
      }
    }

    if (!drag) return;
    if (!this._canPlay() || this.busy) return;

    const cell = this._cellAt(pointer);
    if (!cell) return;

    // 手指从 A 抬到相邻的 B：直接交换
    if (!(cell.r === drag.cell.r && cell.c === drag.cell.c)) {
      if (this._isAdjacent(drag.cell, cell)) {
        this._clearSelection();
        this._trySwap(drag.cell, cell);
      }
      return;
    }

    // 原地轻点：点第二下相邻格 → 交换；重复点同一格 → 取消选中
    if (this.selected && this.selected.r === cell.r && this.selected.c === cell.c) {
      this._clearSelection();
      return;
    }
    if (this.selected && this._isAdjacent(this.selected, cell)) {
      const from = this.selected;
      this._clearSelection();
      this._trySwap(from, cell);
      return;
    }
    this._selectCell(cell);
  }

  _selectCell(cell) {
    this.selected = cell;
    this._drawSelectionRing();
    audio.playClick();
  }

  _clearSelection() {
    this.selected = null;
    if (this._selectionLayer) this._selectionLayer.removeAll(true);
  }

  _drawSelectionRing() {
    if (!this._selectionLayer) return;
    this._selectionLayer.removeAll(true);
    if (!this.selected || !this.boardLayout) return;

    const { cellSize } = this.boardLayout;
    const center = this._cellCenter(this.selected.r, this.selected.c);
    const radius = Math.round(cellSize * 0.24);
    const ring = this.add.graphics();
    ring.lineStyle(3, C.gold, 0.95);
    roundedRectPath(
      ring,
      center.x - cellSize / 2 - 4,
      center.y - cellSize / 2 - 4,
      cellSize + 8,
      cellSize + 8,
      radius,
    );
    ring.strokePath();
    this._selectionLayer.add(ring);
  }

  // ---------------------------------------------------------
  // 交换 / 判定
  // ---------------------------------------------------------
  _trySwap(a, b) {
    if (!this._canPlay() || this.busy) return false;
    if (!this._isAdjacent(a, b)) return false;

    const tileA = this.grid[a.r][a.c];
    const tileB = this.grid[b.r][b.c];
    if (!tileA && !tileB) return false;

    this.busy = true;
    this._clearHint();
    this._clearSelection();

    // 每交换一次消耗 1 步（即使没凑成句，也算一步）
    this.movesLeft = Math.max(0, this.movesLeft - 1);
    this._refreshHud();
    audio.playPage();

    const targetA = this._cellCenter(b.r, b.c);
    const targetB = this._cellCenter(a.r, a.c);
    const duration = 170;

    if (tileA) {
      tileA.baseX = targetA.x;
      tileA.baseY = targetA.y;
      this.tweens.add({
        targets: tileA.container,
        x: targetA.x,
        y: targetA.y,
        scaleX: 1,
        scaleY: 1,
        duration,
        ease: 'Cubic.easeOut',
      });
    }
    if (tileB) {
      tileB.baseX = targetB.x;
      tileB.baseY = targetB.y;
      this.tweens.add({
        targets: tileB.container,
        x: targetB.x,
        y: targetB.y,
        scaleX: 1,
        scaleY: 1,
        duration,
        ease: 'Cubic.easeOut',
      });
    }

    // 模型立即交换，补间只是视觉
    this.grid[a.r][a.c] = tileB;
    this.grid[b.r][b.c] = tileA;

    this.time.delayedCall(duration + 40, () => {
      if (!this.scene.isActive()) return;
      this._evaluateBoard();
    });
    return true;
  }

  /** 交换后统一判定：只认「整行/整列刚好等于一句完整诗句」 */
  _evaluateBoard() {
    const matches = this._matchWindows(
      this.boardLines,
      (r, c) => (this.grid[r]?.[c] ? this.grid[r][c].char : ''),
    );

    if (matches.length === 0) {
      this.busy = false;
      this._afterMove();
      return;
    }
    this._processMatches(matches, 1);
  }

  /**
   * 找出所有「刚好等于某句未完成目标诗句」的连续横/竖格子。
   * charAt(r,c) 返回空格时给空字符串，永远不等于诗句里的字，
   * 所以差一个字、顺序错、含干扰字都不会被判成完整诗句。
   */
  _matchWindows(lines, charAt) {
    if (!this.boardLayout) return [];
    const { rows, cols } = this.boardLayout;
    const raw = [];

    lines
      .filter((line) => !line.completed)
      .forEach((line) => {
        const text = line.text;
        const length = text.length;
        if (length < 1) return;

        for (let r = 0; r < rows; r += 1) {
          for (let start = 0; start + length <= cols; start += 1) {
            const cells = [];
            let ok = true;
            for (let i = 0; i < length; i += 1) {
              if (charAt(r, start + i) !== text[i]) {
                ok = false;
                break;
              }
              cells.push({ r, c: start + i });
            }
            if (ok) raw.push({ line, cells, orientation: 'row' });
          }
        }

        for (let c = 0; c < cols; c += 1) {
          for (let start = 0; start + length <= rows; start += 1) {
            const cells = [];
            let ok = true;
            for (let i = 0; i < length; i += 1) {
              if (charAt(start + i, c) !== text[i]) {
                ok = false;
                break;
              }
              cells.push({ r: start + i, c });
            }
            if (ok) raw.push({ line, cells, orientation: 'col' });
          }
        }
      });

    // 同一句只消一次，同一格也不会被两句重复占用
    const accepted = [];
    const usedCells = new Set();
    const usedLines = new Set();
    raw.forEach((match) => {
      if (usedLines.has(match.line)) return;
      if (match.cells.some(({ r, c }) => usedCells.has(`${r},${c}`))) return;
      usedLines.add(match.line);
      match.cells.forEach(({ r, c }) => usedCells.add(`${r},${c}`));
      accepted.push(match);
    });
    return accepted;
  }

  _processMatches(matches, depth = 1) {
    this.busy = true;
    const combo = matches.length;
    let gained = 0;

    matches.forEach((match, index) => {
      match.line.completed = true;
      const lineScore = match.line.text.length * 20;
      const multiplier = 1 + index * 0.5;
      const lineGain = Math.round(lineScore * multiplier);
      gained += lineGain;

      this._floatElimination(match, lineGain);

      match.cells.forEach(({ r, c }) => {
        const tile = this.grid[r][c];
        if (!tile) return;
        this.grid[r][c] = null;
        this.tweens.killTweensOf(tile.container);
        this.tweens.add({
          targets: tile.container,
          scaleX: 0.15,
          scaleY: 0.15,
          alpha: 0,
          angle: 12,
          duration: 260,
          ease: 'Back.easeIn',
          onComplete: () => {
            if (tile.container.scene) tile.container.destroy(true);
          },
        });
      });
    });

    this.score += gained;
    audio.playCorrect();
    if (combo > 1) {
      showToast(this, `一下凑成 ${combo} 句，得分有加成！`, { y: 320, duration: 1600 });
    }
    this._refreshTargets();
    this._refreshHud();

    this.time.delayedCall(340, () => {
      if (!this.scene.isActive()) return;
      this._applyGravity();
      this.time.delayedCall(270, () => {
        if (!this.scene.isActive()) return;
        this._cascade(depth);
      });
    });
  }

  /** 消除后的下落：每列的字块向下补位，空位留在顶部 */
  _applyGravity() {
    const { rows, cols } = this.boardLayout;
    for (let c = 0; c < cols; c += 1) {
      const stack = [];
      for (let r = rows - 1; r >= 0; r -= 1) {
        const tile = this.grid[r][c];
        if (tile) stack.push(tile);
      }
      for (let r = rows - 1, index = 0; r >= 0; r -= 1, index += 1) {
        const tile = stack[index] || null;
        this.grid[r][c] = tile;
        if (!tile) continue;
        const center = this._cellCenter(r, c);
        if (tile.baseX !== center.x || tile.baseY !== center.y) {
          tile.baseX = center.x;
          tile.baseY = center.y;
          this.tweens.add({
            targets: tile.container,
            x: center.x,
            y: center.y,
            duration: 200,
            ease: 'Cubic.easeOut',
          });
        }
      }
    }
  }

  _cascade(depth) {
    const matches = this._matchWindows(
      this.boardLines,
      (r, c) => (this.grid[r]?.[c] ? this.grid[r][c].char : ''),
    );

    if (matches.length > 0 && depth <= 3) {
      this._processMatches(matches, depth + 1);
      return;
    }

    if (this.boardLines.every((line) => line.completed)) {
      this._onBoardClear();
      return;
    }

    this.busy = false;
    this._refreshHud();
    this._afterMove();
  }

  _afterMove() {
    if (this._solved || this._failed || this._resultShown) return;
    if (this.movesLeft <= 0) {
      this.time.delayedCall(180, () => {
        if (!this.scene.isActive()) return;
        this._fail();
      });
    }
  }

  /** 一屏全部消完：有下一屏就奖励步数继续，没有就通关 */
  _onBoardClear() {
    if (this._solved || this._failed || this._resultShown) return;

    const nextIndex = this.boardIndex + 1;
    if (nextIndex >= this.boards.length) {
      this._handleSolved();
      return;
    }

    this.movesLeft += BOARD_CLEAR_BONUS;
    this.score += 100;
    this._refreshHud();
    audio.playCorrect();
    showToast(this, `这一屏排好啦！步数 +${BOARD_CLEAR_BONUS}`, { y: 320, duration: 1800 });

    this.time.delayedCall(800, () => {
      if (!this.scene.isActive()) return;
      this._startBoard(nextIndex);
    });
  }

  // ---------------------------------------------------------
  // 字号浮动 / 得分飘字
  // ---------------------------------------------------------
  _floatElimination(match, gained) {
    const centers = match.cells.map(({ r, c }) => this._cellCenter(r, c));
    const x = centers.reduce((sum, point) => sum + point.x, 0) / centers.length;
    const y = centers.reduce((sum, point) => sum + point.y, 0) / centers.length;

    const ring = this.add.graphics().setDepth(1250).setScrollFactor(0);
    ring.lineStyle(3, C.gold, 0.7);
    ring.strokeCircle(x, y, this.boardLayout.cellSize * 0.5);
    this.tweens.add({
      targets: ring,
      alpha: 0,
      duration: 520,
      ease: 'Sine.easeOut',
      onComplete: () => ring.destroy(),
    });

    const label = makeText(this, x, y, `${match.line.text} +${gained}`, {
      size: 20,
      color: S.gold,
      origin: [0.5, 0.5],
    }).setDepth(1300).setScrollFactor(0);
    label.setStroke('#fffdf8', 4);
    this.tweens.add({
      targets: label,
      y: y - 44,
      alpha: 0,
      duration: 900,
      ease: 'Sine.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  // ---------------------------------------------------------
  // 提示
  // ---------------------------------------------------------
  /** 在「当前最接近成句」的一组格子里，找一个放错位置的字，并点亮它的正确位置 */
  _buildHint() {
    if (!this.boardLayout) return null;
    const { rows, cols } = this.boardLayout;
    const candidates = this.boardLines.filter((line) => !line.completed);
    if (candidates.length === 0) return null;

    let best = null;
    const evaluate = (line, cells) => {
      const text = line.text;
      let score = 0;
      cells.forEach(({ r, c }, index) => {
        const tile = this.grid[r][c];
        if (tile && tile.char === text[index]) score += 1;
      });
      if (!best || score > best.score) best = { line, cells, score };
    };

    candidates.forEach((line) => {
      const length = line.text.length;
      for (let r = 0; r < rows; r += 1) {
        for (let start = 0; start + length <= cols; start += 1) {
          evaluate(line, Array.from({ length }, (_, i) => ({ r, c: start + i })));
        }
      }
      for (let c = 0; c < cols; c += 1) {
        for (let start = 0; start + length <= rows; start += 1) {
          evaluate(line, Array.from({ length }, (_, i) => ({ r: start + i, c })));
        }
      }
    });

    if (!best) return null;
    const text = best.line.text;
    const mismatchIndex = best.cells.findIndex(({ r, c }, index) => {
      const tile = this.grid[r][c];
      return !tile || tile.char !== text[index];
    });
    if (mismatchIndex < 0) return null;

    const targetCell = best.cells[mismatchIndex];
    const needChar = text[mismatchIndex];

    let sourceCell = null;
    let bestDistance = Infinity;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const tile = this.grid[r][c];
        if (!tile || tile.char !== needChar) continue;
        if (r === targetCell.r && c === targetCell.c) continue;
        const distance = Math.abs(r - targetCell.r) + Math.abs(c - targetCell.c);
        if (distance < bestDistance) {
          bestDistance = distance;
          sourceCell = { r, c };
        }
      }
    }

    return {
      line: best.line,
      cells: best.cells,
      targetCell,
      sourceCell,
      char: needChar,
    };
  }

  _onHint() {
    if (!this._canPlay() || this.busy || this._hintModalOpen) return;
    if (this._solved || this._failed || this._resultShown) return;

    const brush = progress.getBrushCount();
    if (brush <= 0) {
      showToast(this, '毛笔用完啦，通关后还会再得到一支。', { y: 320, tone: 'warn' });
      return;
    }

    const hint = this._buildHint();
    if (!hint) {
      showToast(this, '这一屏的字已经排得很顺啦，自己换一换试试。', { y: 320 });
      return;
    }

    this._hintModalOpen = true;
    this.showModal({
      title: '用一支毛笔换提示？',
      sealText: '笔',
      message: `毛笔还剩 ${brush} 支。\n用了之后会点亮一个正确的字位：\n金色虚影是要放过去的位置，红色圈住的是该拿的字。\n本题最多只能拿到 2 颗星。`,
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
        this._refreshHud();
      },
    });
  }

  _applyHint() {
    if (this._solved || this._failed || this._resultShown) return;
    const hint = this._buildHint();
    if (!hint) {
      showToast(this, '这一屏已经排得很顺啦，自己换一换试试。', { y: 320 });
      return;
    }
    if (!progress.consumeBrush()) {
      showToast(this, '毛笔不够啦。', { y: 320, tone: 'warn' });
      return;
    }

    this.brushHintUsed = true;
    this._refreshHud();
    this._drawHint(hint);
    audio.playClick();

    if (this.tipText) {
      this.tipText.setText(`把「${hint.char}」移到金色虚影那一格`);
      this.tipText.setColor(S.gold);
    }
    showToast(this, `提示：把「${hint.char}」移到金色虚影那一格`, { y: 320, duration: 2200 });
  }

  _drawHint(hint) {
    this._clearHint();
    if (!this._hintLayer) return;

    const { cellSize } = this.boardLayout;
    const radius = Math.round(cellSize * 0.24);
    const target = this._cellCenter(hint.targetCell.r, hint.targetCell.c);

    const ghost = this.add.graphics();
    ghost.fillStyle(C.goldLight, 0.35);
    roundedRectPath(ghost, target.x - cellSize / 2, target.y - cellSize / 2, cellSize, cellSize, radius);
    ghost.fillPath();
    ghost.lineStyle(3, C.gold, 0.95);
    roundedRectPath(
      ghost,
      target.x - cellSize / 2 - 4,
      target.y - cellSize / 2 - 4,
      cellSize + 8,
      cellSize + 8,
      radius,
    );
    ghost.strokePath();
    this._hintLayer.add(ghost);

    const ghostText = makeText(this, target.x, target.y + 1, hint.char, {
      size: Math.round(cellSize * 0.56),
      color: S.gold,
      origin: [0.5, 0.5],
    }).setAlpha(0.8);
    this._hintLayer.add(ghostText);

    if (hint.sourceCell) {
      const source = this._cellCenter(hint.sourceCell.r, hint.sourceCell.c);
      const ring = this.add.graphics();
      ring.lineStyle(3, C.peachDeep, 0.95);
      roundedRectPath(
        ring,
        source.x - cellSize / 2 - 4,
        source.y - cellSize / 2 - 4,
        cellSize + 8,
        cellSize + 8,
        radius,
      );
      ring.strokePath();
      this._hintLayer.add(ring);
      this.tweens.add({
        targets: ring,
        alpha: { from: 1, to: 0.4 },
        duration: 620,
        yoyo: true,
        repeat: 3,
        ease: 'Sine.easeInOut',
      });
    }

    this.tweens.add({
      targets: ghost,
      alpha: { from: 1, to: 0.35 },
      duration: 620,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
    });

    this._hintTimer = this.time.delayedCall(3000, () => this._clearHint());
  }

  _clearHint() {
    if (this._hintTimer) {
      this._hintTimer.remove(false);
      this._hintTimer = null;
    }
    if (this._hintLayer) this._hintLayer.removeAll(true);
    if (this.tipText) {
      this.tipText.setText('换相邻两块，凑成整句才会消失');
      this.tipText.setColor(S.inkFaint);
    }
  }

  // ---------------------------------------------------------
  // 重置棋盘
  // ---------------------------------------------------------
  _onReset() {
    if (!this._canPlay() || this.busy) return;

    const chars = [];
    this.grid.forEach((row) => {
      row.forEach((tile) => {
        if (tile) chars.push({ char: tile.char });
      });
    });
    if (chars.length === 0) {
      showToast(this, '棋盘上的字已经都排好啦。', { y: 320 });
      return;
    }

    this.busy = true;
    this._clearHint();
    this._clearSelection();
    this._layoutTiles(this._shuffleMatrix(chars));
    this._refreshTargets();
    this._refreshHud();
    audio.playPage();
    showToast(this, '棋盘重新打散啦，这一步不消耗步数', { y: 320, duration: 1600 });

    this.time.delayedCall(360, () => {
      if (!this.scene.isActive()) return;
      this.busy = false;
      this._refreshHud();
    });
  }

  // ---------------------------------------------------------
  // HUD
  // ---------------------------------------------------------
  _refreshTargets() {
    if (!this.boardLines || this._targetRows.length === 0) return;
    const total = this.boardLines.length;
    const done = this.boardLines.filter((line) => line.completed).length;

    this._targetRows.forEach((row, index) => {
      const line = this.boardLines[index];
      if (!line) {
        row.container.setVisible(false);
        return;
      }
      row.container.setVisible(true);
      row.text.setText(line.text);
      row.text.setColor(line.completed ? S.mute : S.ink);
      row.check.setVisible(line.completed);

      row.bg.clear();
      row.bg.fillStyle(line.completed ? C.pineLight : C.paperDeep, line.completed ? 0.8 : 0.5);
      roundedRectPath(
        row.bg,
        -PANEL.width / 2 + 22,
        -ROW_HEIGHT / 2,
        PANEL.width - 44,
        ROW_HEIGHT,
        12,
      );
      row.bg.fillPath();
    });

    if (this.progressText) {
      const doneAll = this.boards.reduce(
        (sum, board) => sum + board.lines.filter((line) => line.completed).length,
        0,
      );
      const totalAll = this.boards.reduce((sum, board) => sum + board.lines.length, 0);
      this.progressText.setText(
        `第 ${this.boardIndex + 1} / ${this.boards.length} 屏 · 本屏 ${done} / ${total} 句\n全诗进度 ${doneAll} / ${totalAll} 句`,
      );
    }
  }

  _refreshHud() {
    if (this.brushText) this.brushText.setText(`毛笔 × ${progress.getBrushCount()}`);

    if (this.movesText) {
      this.movesText.setText(`步数 ${this.movesLeft} / ${this.movesBudget}`);
      this.movesText.setColor(this.movesLeft <= 10 ? S.danger : S.ink);
    }
    if (this.scoreText) this.scoreText.setText(`得分 ${this.score}`);

    const locked = this._solved || this._failed || this._resultShown;
    if (this._hintBtn) {
      this._hintBtn.setDisabled(locked || progress.getBrushCount() <= 0);
    }
    if (this._resetBtn) this._resetBtn.setDisabled(locked);

    if (this.statusText) {
      const remaining = this.boardLines.filter((line) => !line.completed).length;
      this.statusText.setText(
        `本屏还剩 ${remaining} 句 · 干扰字可以留在棋盘上\n只剩 ${this.movesLeft} 步时，要抓紧凑成整句啦`,
      );
    }
  }

  // ---------------------------------------------------------
  // 星级 / 结算（与现有玩法同一套）
  // ---------------------------------------------------------
  _calcStars() {
    const ratio = this.movesBudget > 0 ? this.movesLeft / this.movesBudget : 0;
    let stars = 1;
    if (ratio >= STAR_THREE_RATIO) stars = 3;
    else if (ratio >= STAR_TWO_RATIO) stars = 2;
    if (this.brushHintUsed) stars = Math.min(stars, 2);
    return Math.max(1, Math.min(3, stars));
  }

  _handleSolved() {
    if (this._solved || this._resultShown) return;
    this._solved = true;
    this.busy = true;
    this._clearHint();
    this._clearSelection();

    const stars = this._calcStars();
    this.result = progress.markPoemComplete(this.poem.id, stars);
    console.info('[诗句三消] 结算：', {
      poem: this.poem.title,
      boards: this.boards.length,
      stars,
      score: this.score,
      movesLeft: this.movesLeft,
      movesBudget: this.movesBudget,
      brushHintUsed: this.brushHintUsed,
      result: this.result,
    });

    if (!this.result) {
      showToast(this, '结算时没有找到这首诗，请回到地图重试。', { y: 320, tone: 'warn' });
      return;
    }

    this._refreshHud();
    audio.playUnlock();
    this.time.delayedCall(360, () => {
      if (!this.scene.isActive()) return;
      this._showResult();
    });
  }

  _showResult() {
    if (this._resultShown) return;
    this._resultShown = true;
    this._hintBtn?.setDisabled(true);
    this._resetBtn?.setDisabled(true);

    const root = this.add.container(0, 0).setDepth(3000).setScrollFactor(0);
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

    root.add(addSeal(this, 250, 142, this.result.newCard ? '得' : '通', 52, C.peachDeep));

    root.add(
      makeText(
        this,
        GAME_WIDTH / 2 + 20,
        124,
        this.result.newCard ? '三消通关 · 诗卡入卷' : '又通关啦 · 诗句更熟',
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
    cursorY += pinyin.height + 4;
    scroll.layout(cursorY);
    scroll.scrollToTop();

    root.add(
      makeText(
        this,
        GAME_WIDTH / 2,
        398,
        `本局得分 ${this.score}　·　剩余步数 ${this.movesLeft} / ${this.movesBudget}　·　毛笔提示 ${this.brushHintUsed ? '用过 1 次' : '未使用'}`,
        { size: 16, color: S.gold, origin: [0.5, 0.5] },
      ),
    );

    const lines = [];
    if (this.result.newCard) {
      lines.push(`✦ 新诗卡《${this.poem.title}》已收入图鉴`);
    } else {
      lines.push(`✦ 诗卡星级更新为 ${this.result.stars} ★`);
    }
    if (!this.brushHintUsed && this.result.stars >= 3) {
      lines.push('✦ 一次通关、没借毛笔，三颗星全收下');
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
      lines.push(`✦ 新诗路解锁：${getChapterName(chapterId)}`);
    });

    let rewardLines = lines;
    if (rewardLines.length > 5) {
      rewardLines = [...rewardLines.slice(0, 4), '✦ 其余收获已自动记入图鉴、逸闻册与陈列馆'];
    }

    root.add(
      makeText(this, GAME_WIDTH / 2, 426, rewardLines.join('\n'), {
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
      label: '再玩一次',
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
  // 步数耗尽
  // ---------------------------------------------------------
  _fail() {
    if (this._failed || this._solved || this._resultShown) return;
    this._failed = true;
    this.busy = true;
    this._clearHint();
    this._clearSelection();
    this.drag = null;

    audio.playWrong();
    progress.addWrongRecord(this.poem.id);
    this._refreshHud();

    const remaining = this.boardLines.filter((line) => !line.completed).length;
    this.showModal({
      title: '步数用完了',
      sealText: '惜',
      message: `这一屏还剩 ${remaining} 句没有排好。\n别灰心：先读一读右边的目标诗句，再把相邻两个字块换一换，\n让它们从头到尾连成完整的一句，就会自动消除。\n\n本局得分 ${this.score} · 已记进错题书斋，下次再来挑战。`,
      actions: [
        {
          label: '再试一次',
          variant: 'primary',
          onClick: () => {
            this.scene.restart({ poemId: this.poemId, returnScene: this.returnScene });
          },
        },
        {
          label: '返回地图',
          variant: 'secondary',
          onClick: () => this._leaveToMap(),
        },
      ],
    });
  }

  // ---------------------------------------------------------
  // 离开
  // ---------------------------------------------------------
  _requestLeave() {
    if (this._leaving) return;
    if (this._solved || this._failed) {
      this._leaveToMap();
      return;
    }

    this._leaving = true;
    this.showModal({
      title: '先离开这一关吗？',
      sealText: '问',
      message: '棋盘还没有排完。\n离开后这一关的步数不会保存，下次可以重新开始。',
      actions: [
        { label: '继续三消', variant: 'primary' },
        { label: '先离开', variant: 'secondary', onClick: () => this._leaveToMap() },
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
}
