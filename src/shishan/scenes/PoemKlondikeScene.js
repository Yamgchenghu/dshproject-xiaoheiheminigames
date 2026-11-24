/**
 * PoemKlondikeScene：诗句华容道（滑块解谜，独立场景）
 * ------------------------------------------------------------
 * 玩法：
 *  1. 读一首 poem，按标点拆成「诗句」，再按整句打包成若干「屏」；
 *     每一屏的目标诗句被拆成单个汉字，铺进一个带空位的方格滑块面板；
 *     开局从「排好的状态」随机走若干合法步打乱（因此一定有解、不会死局）；
 *  2. 点一下空位旁边的汉字块，字块就滑进空位；也可以从字块往空位方向拖，
 *     或从空位往字块方向拖，都算滑动；
 *  3. 目标：把汉字按顺序排成完整诗句（读序从左到右、从上到下，与目标面板一致）；
 *  4. 用「步数」评星：步数越少星级越高；另有「重置棋盘」（重新打乱，不返还步数）
 *     与「毛笔提示」（照参考解法指出下一步该移动哪个字块、往哪边滑）；
 *  5. 温和模式自带 2 次免费提示（不耗毛笔、不扣星），用完后改用毛笔提示（本关封顶 2 星）；
 *  6. 通关走与「看图猜诗」完全一致的结算：ProgressManager.markPoemComplete
 *     （诗卡 / 星级 / 错题清除 / 轶事 / 藏品 / 章节解锁）；
 *     排很久或反复重置会被记进错题书斋（通关后自动清除）。
 *
 * 复用：
 *  - BaseScene（背景、头部、吐司、弹窗、转场）
 *  - ProgressManager / AudioManager
 *  - ui/components、ui/background、ui/ScrollPanel
 *
 * 入口：
 *  - { poemId, returnScene? }；开发预览：路径加 `?klondike=1`（见 main.js）
 *  - 不依赖、也不修改任何原有场景
 */

import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH, SCENES } from '../config/constants.js';
import { C, S } from '../config/theme.js';
import { dataManager } from '../data/DataManager.js';
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
import { hintKlondikeMove, KLONDIKE_DIRECTION_CN } from '../game/klondikeSolver.js';

// ---------------------------------------------------------
// 布局常量（1280 × 720 设计分辨率）
// ---------------------------------------------------------
// 滑块面板纸卡：x / y 是纸卡中心，整块占 44~796 宽、160~620 高
const BOARD = { x: 420, y: 390, width: 752, height: 460 };
// 右侧目标面板纸卡
const PANEL = { x: 1030, y: 390, width: 420, height: 460 };

const BOARD_PADDING = 24; // 纸卡内边距
const CELL_GAP = 10;
const CELL_MAX = 132; // 字块最大边长（方块大、看得清）
const CELL_MIN = 72;

// 诗句拆分 / 分屏
const MIN_LINE_LEN = 3; // 少于 3 个字的碎片并入相邻句
const MAX_LINE_LEN = 10; // 单句最长（横向要放得下）
const MAX_SCREEN_CHARS = 10; // 单屏目标字数上限
const MAX_BLANKS = 2; // 单屏最多留 2 个空位（至少 1 个）

// 步数 / 星级
const MOVES_PER_CHAR = 12;
const MOVES_BASE = 30;
const STAR_TWO_RATIO = 1.7; // 步数 ≤ 预算 × 1.7 给 2 星，其余 1 星
const GENTLE_FREE_HINTS = 2; // 温和模式提示次数 +2

// 交互
const SWIPE_MIN = 18; // 拖拽判定距离（设计像素）
const HINT_DURATION = 6000; // 毛笔提示停留时间（要够玩家看清方向再动手）

const SPLIT_PUNCTUATION = '，,、；;：:。！？!?…·';
const TRIM_CHARS = /[“”"'‘’「」『』（）()【】〈〉《》\s]/g;

/**
 * 方格形状表：格子数 = 汉字数 + 空位数（空位 1~2 个）。
 * 只列横屏好看的矩形，保证字块够大。
 */
const GRID_SHAPES = [
  { cols: 2, rows: 2 },
  { cols: 3, rows: 2 },
  { cols: 2, rows: 3 },
  { cols: 4, rows: 2 },
  { cols: 2, rows: 4 },
  { cols: 3, rows: 3 },
  { cols: 5, rows: 2 },
  { cols: 2, rows: 5 },
  { cols: 4, rows: 3 },
  { cols: 3, rows: 4 },
  { cols: 5, rows: 3 },
  { cols: 3, rows: 5 },
  { cols: 4, rows: 4 },
];

const clamp = (value, min, max) => Phaser.Math.Clamp(value, min, max);

// ---------------------------------------------------------
// 文本 / 棋盘工具（纯函数，便于验收脚本直接引用）
// ---------------------------------------------------------

/**
 * 把 full_text 拆成「诗句行」：按标点切句、去掉标点与引号，
 * 太短的碎片并入相邻句，超长句对半拆，保证 3 ~ 10 字。
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

/** 单格边长：宽高都要放得下，最小 72、最大 132 */
export function cellSizeFor(cols, rows) {
  const innerWidth = BOARD.width - BOARD_PADDING * 2;
  const innerHeight = BOARD.height - BOARD_PADDING * 2;
  const widthFit = (innerWidth - CELL_GAP * (cols - 1)) / cols;
  const heightFit = (innerHeight - CELL_GAP * (rows - 1)) / rows;
  return clamp(Math.floor(Math.min(widthFit, heightFit)), CELL_MIN, CELL_MAX);
}

/**
 * 按汉字数量选方格形状：格子数 ≥ 汉字数 + 1（至少留一个空位），
 * 空位尽量少（1 个最佳），同分时优先横向更好看的矩形。
 * @param {number} charCount
 * @returns {{cols:number, rows:number, cells:number, blanks:number}}
 */
export function pickGridShape(charCount) {
  const count = Math.max(2, Math.floor(Number(charCount) || 0));
  const need = count + 1;

  let best = null;
  GRID_SHAPES.forEach((shape) => {
    const cells = shape.cols * shape.rows;
    if (cells < need) return;
    const blanks = cells - count;
    if (blanks > MAX_BLANKS) return;

    const score = [cells, blanks, shape.rows > shape.cols ? 1 : 0];
    const better = !best
      || score[0] < best.score[0]
      || (score[0] === best.score[0] && score[1] < best.score[1])
      || (score[0] === best.score[0] && score[1] === best.score[1] && score[2] < best.score[2]);
    if (better) best = { shape, score };
  });

  // 兜底：找不到「空位 ≤ 2」的矩形时，退回最小的能装下的矩形
  if (!best) {
    const fallback = GRID_SHAPES
      .filter((shape) => shape.cols * shape.rows >= need)
      .sort((a, b) => a.cols * a.rows - b.cols * b.rows)[0];
    if (!fallback) return { cols: count + 1, rows: 1, cells: count + 1, blanks: 1 };
    best = { shape: fallback, score: [fallback.cols * fallback.rows, 0, 0] };
  }

  const { cols, rows } = best.shape;
  return { cols, rows, cells: cols * rows, blanks: cols * rows - count };
}

/**
 * 把整首诗切成若干「屏」：按整句打包，单屏汉字数不超过 MAX_SCREEN_CHARS。
 * @param {string} fullText
 * @returns {Array<{index:number, lines:string[], chars:string, charCount:number,
 *   cols:number, rows:number, cells:number, blanks:number}>}
 */
export function planPoemPuzzles(fullText) {
  const lines = splitPoemLines(fullText);
  if (lines.length === 0) return [];

  const groups = [];
  let current = null;
  lines.forEach((text) => {
    // 单句超长（正常数据不会出现）时单独成屏，避免挤爆面板
    if (text.length > MAX_SCREEN_CHARS) {
      groups.push({ lines: [text] });
      return;
    }
    if (!current || (current.lines.length > 0 && current.chars + text.length > MAX_SCREEN_CHARS)) {
      current = { lines: [], chars: 0 };
      groups.push(current);
    }
    current.lines.push(text);
    current.chars += text.length;
  });

  return groups.map((group, index) => {
    const chars = group.lines.join('');
    const shape = pickGridShape(chars.length);
    return {
      index,
      lines: [...group.lines],
      chars,
      charCount: chars.length,
      cols: shape.cols,
      rows: shape.rows,
      cells: shape.cells,
      blanks: shape.blanks,
    };
  });
}

/** 单屏步数预算：字数 × 12 + 30（3 星门槛） */
export function movesBudgetFor(puzzle) {
  const chars = Number(puzzle?.charCount) || 0;
  return Math.max(MOVES_BASE, Math.round(chars * MOVES_PER_CHAR) + MOVES_BASE);
}

export default class PoemKlondikeScene extends BaseScene {
  constructor() {
    super(SCENES.POEM_KLONDIKE);
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
    this._hintModalOpen = false;
    this._screenSolved = false;
    this.busy = false;

    this.poem = null;
    this.screens = [];
    this.screenIndex = 0;
    this.puzzle = null;
    this.goalChars = [];
    this.grid = [];
    this._layout = null;

    this.movesUsed = 0;
    this.screenMoves = 0;
    this.resets = 0;
    this.totalBudget = 0;
    this.brushHintUsed = false;
    this.freeHintLeft = 0;
    this.stuckNoted = false;

    this._drag = null;
    this._pressedTile = null;
    this._hintLayer = null;
    this._hintTimer = null;
    this._hintCache = null; // { signature, hint }
    this._goalCells = [];
    this._miniCell = 44;

    this.result = null;
  }

  create() {
    this.prepareScene();
    this._bindInput();
    this.addBackground('paper', { petals: true });
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
    // 温和模式提示次数 +2（免费、不扣星）
    this.freeHintLeft = this.difficulty.gentleNudge ? GENTLE_FREE_HINTS : 0;

    this.screens = planPoemPuzzles(poem.full_text);
    if (this.screens.length === 0) {
      showToast(this, '这首诗暂时排不出滑块盘，先换一首吧。', { y: 320, tone: 'warn' });
      this.time.delayedCall(1200, () => this._leaveToMap());
      return;
    }
    this.totalBudget = this.screens.reduce((sum, screen) => sum + movesBudgetFor(screen), 0);

    this.addHeader({
      title: '诗句华容道',
      subtitle: `${getChapterName(poem.chapter)} / ${poem.area} · 点一下空位旁边的字块，把诗句排回原位`,
      onBack: () => this._requestLeave(),
      backLabel: '返回',
    });

    this._buildPoemBar();
    this._buildBoardFrame();
    this._buildGoalPanel();
    this._buildBottomBar();

    this._startScreen(0);
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
  // 滑块面板纸卡
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

    // 很淡的装订线，让面板像一页摊开的字帖
    const line = this.add.graphics().setDepth(11).setScrollFactor(0);
    line.lineStyle(1, C.gold, 0.22);
    line.beginPath();
    line.moveTo(BOARD.x - BOARD.width / 2 + 30, BOARD.y - BOARD.height / 2 + 10);
    line.lineTo(BOARD.x + BOARD.width / 2 - 30, BOARD.y - BOARD.height / 2 + 10);
    line.strokePath();

    this._slotGraphics = this.add.graphics().setDepth(12).setScrollFactor(0);
    this.boardCaption = makeText(this, 0, 0, '', {
      size: 13,
      color: S.inkFaint,
      origin: [0, 0.5],
    }).setDepth(13);

    this._hintLayer = this.add.container(0, 0).setDepth(1200).setScrollFactor(0);
  }

  // ---------------------------------------------------------
  // 右侧：目标排布 / 进度 / 步数 / 星级
  // ---------------------------------------------------------
  _buildGoalPanel() {
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

    const top = PANEL.y - PANEL.height / 2; // 160

    addSeal(this, PANEL.x - PANEL.width / 2 + 44, top + 32, '目', 32, C.pineDeep).setDepth(20);
    makeText(this, PANEL.x + 12, top + 32, '目标排布', {
      size: 21,
      color: S.ink,
      origin: [0.5, 0.5],
    }).setDepth(20);

    const divider = this.add.graphics().setDepth(20).setScrollFactor(0);
    divider.lineStyle(1, C.gold, 0.34);
    divider.beginPath();
    divider.moveTo(PANEL.x - PANEL.width / 2 + 34, top + 62);
    divider.lineTo(PANEL.x + PANEL.width / 2 - 34, top + 62);
    divider.strokePath();

    this._goalTop = top + 78;
    this._goalHost = this.add.container(0, 0).setDepth(20).setScrollFactor(0);

    const divider2 = this.add.graphics().setDepth(20).setScrollFactor(0);
    divider2.lineStyle(1, C.gold, 0.28);
    divider2.beginPath();
    divider2.moveTo(PANEL.x - PANEL.width / 2 + 34, top + 238);
    divider2.lineTo(PANEL.x + PANEL.width / 2 - 34, top + 238);
    divider2.strokePath();

    this.progressText = makeText(this, PANEL.x, top + 260, '', {
      size: 16,
      color: S.inkSoft,
      origin: [0.5, 0.5],
      align: 'center',
      wrap: PANEL.width - 70,
      lineSpacing: 6,
    }).setDepth(20);

    this.movesText = makeText(this, PANEL.x, top + 304, '', {
      size: 26,
      color: S.ink,
      origin: [0.5, 0.5],
      align: 'center',
      wrap: PANEL.width - 70,
    }).setDepth(20);

    this.starsText = makeText(this, PANEL.x, top + 344, '', {
      size: 15,
      color: S.gold,
      origin: [0.5, 0.5],
      align: 'center',
      wrap: PANEL.width - 70,
      lineSpacing: 5,
    }).setDepth(20);

    this.tipText = makeText(this, PANEL.x, top + 410, '点一下空位旁边的字块，就能把字滑过去', {
      size: 13,
      color: S.inkFaint,
      origin: [0.5, 0.5],
      align: 'center',
      wrap: PANEL.width - 80,
      lineSpacing: 5,
    }).setDepth(20);
  }

  // ---------------------------------------------------------
  // 底部：返回 / 重置 / 毛笔提示 / 状态
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
      lineSpacing: 5,
    }).setDepth(1050);
  }

  // ---------------------------------------------------------
  // 一屏的开始：打乱 + 铺字块
  // ---------------------------------------------------------
  _startScreen(index) {
    this._clearHint();
    this.screenIndex = index;
    this.screenMoves = 0;
    this._screenSolved = false;
    this.busy = true;

    this.puzzle = this.screens[index];
    this.goalChars = [...this.puzzle.chars];
    this._layout = this._computeLayout(this.puzzle);

    this._clearTiles();
    this._drawBoardSlots();
    this._buildGoalGrid();
    this._buildTiles(this._scrambleModel());
    this._refreshGoalGrid();
    this._refreshHud();
    this._updateCaption();

    this.time.delayedCall(320, () => {
      this.busy = false;
      this._refreshHud();
    });
  }

  _computeLayout(puzzle) {
    const { cols, rows } = puzzle;
    const cell = cellSizeFor(cols, rows);
    const stride = cell + CELL_GAP;
    const gridW = cols * cell + (cols - 1) * CELL_GAP;
    const gridH = rows * cell + (rows - 1) * CELL_GAP;
    return {
      cols,
      rows,
      cell,
      gap: CELL_GAP,
      stride,
      gridW,
      gridH,
      firstX: BOARD.x - gridW / 2 + cell / 2,
      firstY: BOARD.y - gridH / 2 + cell / 2,
    };
  }

  _updateCaption() {
    const puzzle = this.puzzle;
    if (!puzzle || !this.boardCaption) return;
    const topGap = (this._layout.firstY - this._layout.cell / 2) - (BOARD.y - BOARD.height / 2);
    if (topGap < 30) {
      this.boardCaption.setVisible(false);
      return;
    }
    this.boardCaption.setVisible(true);
    this.boardCaption.setPosition(
      BOARD.x - BOARD.width / 2 + 30,
      BOARD.y - BOARD.height / 2 + 22,
    );
    this.boardCaption.setText(
      `第 ${this.screenIndex + 1} / ${this.screens.length} 屏 · 本屏 ${puzzle.charCount} 字 · 空位 ${puzzle.blanks} 个`,
    );
  }

  /** 画棋盘底格：外框 + 每个空位（字块盖在上面） */
  _drawBoardSlots() {
    const g = this._slotGraphics;
    if (!g || !this._layout) return;
    const { cell, cols, rows, gridW, gridH, firstX, firstY } = this._layout;
    const left = firstX - cell / 2;
    const top = firstY - cell / 2;
    const slot = cell - 6;

    g.clear();
    g.fillStyle(C.paper, 0.5);
    roundedRectPath(g, left - 12, top - 12, gridW + 24, gridH + 24, 22);
    g.fillPath();
    g.lineStyle(1.6, C.gold, 0.32);
    roundedRectPath(g, left - 12, top - 12, gridW + 24, gridH + 24, 22);
    g.strokePath();

    for (let index = 0; index < cols * rows; index += 1) {
      const center = this._cellCenter(index);
      g.fillStyle(C.paperDeep, 0.45);
      roundedRectPath(g, center.x - slot / 2, center.y - slot / 2, slot, slot, 16);
      g.fillPath();
      g.lineStyle(1, C.inkLine, 0.4);
      roundedRectPath(g, center.x - slot / 2, center.y - slot / 2, slot, slot, 16);
      g.strokePath();
    }
  }

  /** 某个格子（下标从 0 开始，按行铺）的中心坐标 */
  _cellCenter(index) {
    const { cols, firstX, firstY, stride } = this._layout;
    const row = Math.floor(index / cols);
    const col = index % cols;
    return {
      x: firstX + col * stride,
      y: firstY + row * stride,
    };
  }

  /** 相邻格子（上下左右） */
  _neighbors(index) {
    const { cols, rows } = this.puzzle;
    const row = Math.floor(index / cols);
    const col = index % cols;
    const list = [];
    if (col > 0) list.push(index - 1);
    if (col < cols - 1) list.push(index + 1);
    if (row > 0) list.push(index - cols);
    if (row < rows - 1) list.push(index + cols);
    return list;
  }

  /**
   * 从「排好的状态」随机走若干合法步打乱。
   * 因此打乱后的局面一定有解（普通随机排列有一半是死局，滑块谜题不能那样打乱）。
   * @returns {Array<{char:string}|null>}
   */
  _scrambleModel() {
    const { cells, charCount } = this.puzzle;
    const board = new Array(cells).fill(null);
    for (let i = 0; i < charCount; i += 1) board[i] = { char: this.goalChars[i] };

    let last = null;
    const walkOneStep = () => {
      const moves = [];
      for (let i = 0; i < cells; i += 1) {
        if (board[i]) continue;
        this._neighbors(i).forEach((from) => {
          if (!board[from]) return;
          // 不走回头路，避免原地来回挪
          if (last && last.from === i && last.to === from) return;
          moves.push({ from, to: i });
        });
      }
      if (moves.length === 0) return false;
      const pick = moves[Math.floor(Math.random() * moves.length)];
      board[pick.to] = board[pick.from];
      board[pick.from] = null;
      last = pick;
      return true;
    };

    const steps = Math.max(24, charCount * 8);
    for (let step = 0; step < steps; step += 1) {
      if (!walkOneStep()) break;
    }

    // 同字多的诗句打乱后可能恰好还是「排好」的样子，继续挪几步，
    // 顺便保证开局至少有半数汉字不在原位，别让小朋友一上来就赢
    const misplaced = () => {
      let count = 0;
      for (let i = 0; i < charCount; i += 1) {
        if (!board[i] || board[i].char !== this.goalChars[i]) count += 1;
      }
      return count;
    };
    let guard = 0;
    while (
      guard < 200
      && (this._isModelSolved(board) || misplaced() < Math.ceil(charCount / 2))
    ) {
      if (!walkOneStep()) break;
      guard += 1;
    }
    return board;
  }

  /** 模型层面是否已经排好（与 _isSolved 一致，但只看字，不看容器） */
  _isModelSolved(board) {
    const { charCount } = this.puzzle;
    for (let i = 0; i < charCount; i += 1) {
      if (!board[i] || board[i].char !== this.goalChars[i]) return false;
    }
    return true;
  }

  /** 铺字块（带入场动画） */
  _buildTiles(model) {
    const { cells } = this.puzzle;
    this.grid = new Array(cells).fill(null);
    model.forEach((item, index) => {
      if (!item) return;
      this.grid[index] = this._createTile(item.char, index, index * 16);
    });
  }

  _createTile(char, index, delay = 0) {
    const { cell } = this._layout;
    const size = cell - 6;
    const center = this._cellCenter(index);

    const container = this.add.container(center.x, center.y).setDepth(60).setScrollFactor(0);
    const graphics = this.add.graphics();
    // 投影 + 纸面 + 描边 + 内高光，像一枚摊在纸上的字块
    graphics.fillStyle(0x6f6050, 0.16);
    roundedRectPath(graphics, -size / 2 + 2, -size / 2 + 5, size, size, 16);
    graphics.fillPath();
    graphics.fillStyle(C.paper, 1);
    roundedRectPath(graphics, -size / 2, -size / 2, size, size, 16);
    graphics.fillPath();
    graphics.lineStyle(2, C.inkLine, 0.95);
    roundedRectPath(graphics, -size / 2, -size / 2, size, size, 16);
    graphics.strokePath();
    graphics.lineStyle(1, 0xffffff, 0.7);
    roundedRectPath(graphics, -size / 2 + 5, -size / 2 + 5, size - 10, size - 10, 12);
    graphics.strokePath();

    const text = makeText(this, 0, 1, char, {
      size: Math.round(size * 0.52),
      color: S.ink,
      origin: [0.5, 0.5],
    });

    container.add([graphics, text]);
    container.setAlpha(0);
    container.setScale(0.6);
    this.tweens.add({
      targets: container,
      alpha: 1,
      scale: 1,
      duration: 220,
      delay,
      ease: 'Back.easeOut',
    });

    return { char, container, index };
  }

  _clearTiles() {
    this.grid.forEach((tile) => {
      if (!tile) return;
      this.tweens.killTweensOf(tile.container);
      tile.container.destroy(true);
    });
    this.grid = [];
  }

  // ---------------------------------------------------------
  // 目标面板：把诗句排成与棋盘同样形状的小格子
  // ---------------------------------------------------------
  _buildGoalGrid() {
    if (this._goalHost) this._goalHost.removeAll(true);
    this._goalCells = [];

    const { cols, rows, charCount } = this.puzzle;
    const miniGap = 6;
    this._miniCell = clamp(
      Math.floor(Math.min(58, (PANEL.width - 130) / cols, 138 / rows)),
      30,
      58,
    );
    const mini = this._miniCell;
    const width = cols * mini + (cols - 1) * miniGap;
    const firstX = PANEL.x - width / 2 + mini / 2;
    const firstY = this._goalTop + mini / 2;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        const char = index < charCount ? this.goalChars[index] : '';
        const x = firstX + col * (mini + miniGap);
        const y = firstY + row * (mini + miniGap);

        const container = this.add.container(x, y).setDepth(20).setScrollFactor(0);
        const graphics = this.add.graphics();
        const text = makeText(this, 0, 0, char, {
          size: Math.round(mini * 0.6),
          color: char ? S.inkSoft : S.inkFaint,
          origin: [0.5, 0.5],
        });
        container.add([graphics, text]);
        this._goalHost.add(container);
        this._goalCells.push({ container, graphics, text, index, char });
      }
    }
  }

  _drawGoalCell(cell, state) {
    const mini = this._miniCell;
    const g = cell.graphics;
    g.clear();
    const hit = state === 'correct';
    g.fillStyle(hit ? C.pineLight : C.paper, hit ? 0.95 : 0.8);
    roundedRectPath(g, -mini / 2, -mini / 2, mini, mini, 10);
    g.fillPath();
    g.lineStyle(1.4, hit ? C.pine : C.inkLine, hit ? 0.9 : 0.6);
    roundedRectPath(g, -mini / 2, -mini / 2, mini, mini, 10);
    g.strokePath();
    // 已归位：右上角点一枚小绿点（比打勾不挤字）
    if (hit) {
      g.fillStyle(C.pineDeep, 0.9);
      g.fillCircle(mini / 2 - 7, -mini / 2 + 7, 4);
    }
  }

  /** 目标面板随棋盘实时刷新：已经归位的字位变成淡绿 */
  _refreshGoalGrid() {
    if (!this.puzzle) return;
    const { charCount } = this.puzzle;
    let correct = 0;
    this._goalCells.forEach((cell) => {
      if (!cell.char) {
        this._drawGoalCell(cell, 'blank');
        return;
      }
      const tile = this.grid[cell.index];
      const hit = Boolean(tile) && tile.char === cell.char;
      if (hit) correct += 1;
      this._drawGoalCell(cell, hit ? 'correct' : 'idle');
      cell.text.setColor(hit ? S.pineDeep : S.inkSoft);
      cell.text.setText(cell.char);
    });

    if (this.progressText) {
      const indexInfo = this.screens.length > 1
        ? `第 ${this.screenIndex + 1} / ${this.screens.length} 屏 · `
        : '';
      this.progressText.setText(`${indexInfo}已归位 ${correct} / ${charCount} 字`);
    }
  }

  // ---------------------------------------------------------
  // 交互
  // ---------------------------------------------------------
  _bindInput() {
    this.input.on('pointerdown', (pointer) => this._onPointerDown(pointer));
    this.input.on('pointerup', (pointer) => this._onPointerUp(pointer));
    this.input.on('pointerupoutside', (pointer) => this._onPointerUp(pointer));
  }

  _canPlay() {
    return Boolean(
      this.scene.isActive()
      && this.puzzle
      && this._layout
      && !this._solved
      && !this._resultShown
      && !this._leaving
      && !this._hintModalOpen
      && !this._screenSolved
      && !this.busy,
    );
  }

  /** 屏幕坐标 → 格子下标（缝隙按最近的格子算，手指点偏一点也能命中） */
  _cellAt(pointer) {
    if (!this._layout) return null;
    const { cols, rows, cell, gap, firstX, firstY, stride } = this._layout;
    const half = cell / 2 + gap / 2;
    const col = Math.round((pointer.x - firstX) / stride);
    const row = Math.round((pointer.y - firstY) / stride);
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    const cx = firstX + col * stride;
    const cy = firstY + row * stride;
    if (Math.abs(pointer.x - cx) > half || Math.abs(pointer.y - cy) > half) return null;
    return row * cols + col;
  }

  _onPointerDown(pointer) {
    if (!this._canPlay()) return;
    const index = this._cellAt(pointer);
    if (index === null) {
      this._drag = null;
      return;
    }
    audio.unlock();
    this._drag = { index, x: pointer.x, y: pointer.y };

    const tile = this.grid[index];
    if (tile) {
      this._pressedTile = tile;
      tile.container.setScale(0.94);
    }
  }

  _onPointerUp(pointer) {
    const drag = this._drag;
    this._drag = null;
    if (this._pressedTile) {
      this._pressedTile.container.setScale(1);
      this._pressedTile = null;
    }
    if (!drag || !this._canPlay()) return;

    const dx = pointer.x - drag.x;
    const dy = pointer.y - drag.y;
    if (Math.hypot(dx, dy) >= SWIPE_MIN) {
      const direction = Math.abs(dx) >= Math.abs(dy)
        ? (dx > 0 ? 'right' : 'left')
        : (dy > 0 ? 'down' : 'up');
      const neighbor = this._neighborInDirection(drag.index, direction);
      if (neighbor === null) return;

      // 字块往空位拖，或从空位往字块拖，都算一次滑动
      if (this.grid[drag.index] && !this.grid[neighbor]) {
        this._trySlide(drag.index, neighbor);
      } else if (!this.grid[drag.index] && this.grid[neighbor]) {
        this._trySlide(neighbor, drag.index);
      }
      return;
    }

    this._onTapCell(drag.index);
  }

  _neighborInDirection(index, direction) {
    const { cols, rows } = this.puzzle;
    const row = Math.floor(index / cols);
    const col = index % cols;
    if (direction === 'left') return col > 0 ? index - 1 : null;
    if (direction === 'right') return col < cols - 1 ? index + 1 : null;
    if (direction === 'up') return row > 0 ? index - cols : null;
    if (direction === 'down') return row < rows - 1 ? index + cols : null;
    return null;
  }

  /** 轻点：字块挨着空位就滑过去，否则轻轻晃一下并给一句提示 */
  _onTapCell(index) {
    const tile = this.grid[index];
    if (!tile) return; // 点到空位，不算错

    const blanks = this._neighbors(index).filter((neighbor) => !this.grid[neighbor]);
    if (blanks.length === 0) {
      audio.playClick();
      this.tweens.killTweensOf(tile.container);
      this.tweens.add({
        targets: tile.container,
        scaleX: 0.96,
        duration: 60,
        yoyo: true,
        ease: 'Sine.easeInOut',
        onComplete: () => tile.container.setScale(1),
      });
      this._setTip('字块要紧挨着空位才能滑动，先把它旁边的字挪开一格');
      return;
    }

    this._trySlide(index, blanks[0]);
  }

  /** 把字块从 from 滑到 to（to 必须是空位） */
  _trySlide(from, to) {
    if (!this._canPlay()) return false;
    const tile = this.grid[from];
    if (!tile || this.grid[to]) return false;

    this._clearHint();

    this.grid[from] = null;
    this.grid[to] = tile;
    tile.index = to;

    const center = this._cellCenter(to);
    this.tweens.killTweensOf(tile.container);
    this.tweens.add({
      targets: tile.container,
      x: center.x,
      y: center.y,
      duration: 140,
      ease: 'Sine.easeOut',
    });

    this.movesUsed += 1;
    this.screenMoves += 1;
    audio.playPage();

    this._refreshGoalGrid();
    this._refreshHud();

    if (this._isSolved()) {
      this._onScreenSolved();
    } else if (this.movesUsed > this.totalBudget * STAR_TWO_RATIO * 2) {
      this._noteStuck('步数远超预算');
    }
    return true;
  }

  _isSolved() {
    const { charCount } = this.puzzle;
    for (let i = 0; i < charCount; i += 1) {
      const tile = this.grid[i];
      if (!tile || tile.char !== this.goalChars[i]) return false;
    }
    return true;
  }

  _countCorrect() {
    const { charCount } = this.puzzle;
    let correct = 0;
    for (let i = 0; i < charCount; i += 1) {
      const tile = this.grid[i];
      if (tile && tile.char === this.goalChars[i]) correct += 1;
    }
    return correct;
  }

  // ---------------------------------------------------------
  // 一屏排好 / 整首通关
  // ---------------------------------------------------------
  _onScreenSolved() {
    if (this._screenSolved) return;
    this._screenSolved = true;
    this._clearHint();
    audio.playCorrect();

    this.grid.forEach((tile) => {
      if (!tile) return;
      this.tweens.add({
        targets: tile.container,
        scale: 1.08,
        duration: 190,
        yoyo: true,
        ease: 'Sine.easeInOut',
      });
    });

    const last = this.screenIndex >= this.screens.length - 1;
    if (last) {
      this.time.delayedCall(520, () => {
        if (!this.scene.isActive()) return;
        this._handleSolved();
      });
      return;
    }

    showToast(this, `第 ${this.screenIndex + 1} 屏排好啦 · 继续下一屏`, {
      y: 320,
      duration: 1500,
    });
    this.time.delayedCall(900, () => {
      if (!this.scene.isActive() || this._solved) return;
      this._startScreen(this.screenIndex + 1);
    });
  }

  // ---------------------------------------------------------
  // 重置 / 提示
  // ---------------------------------------------------------
  _onReset() {
    if (!this._canPlay()) return;
    this.resets += 1;
    this._clearHint();
    this._clearTiles();
    this._buildTiles(this._scrambleModel());
    this._refreshGoalGrid();
    this._refreshHud();
    audio.playPage();
    showToast(this, '棋盘重新打乱了，已走的步数会保留', { y: 320, duration: 1500 });
    if (this.resets >= 3) this._noteStuck('连续重置棋盘');
  }

  /** 当前棋盘的字块签名（用于缓存参考解法） */
  _boardSignature() {
    return this.grid.map((tile) => (tile ? tile.char : '·')).join('');
  }

  /**
   * 参考解法提示：按 A* 求解（见 src/game/klondikeSolver.js），
   * 告诉玩家「下一步该动哪一块、往哪边滑」，而不是「这个字该去哪一格」。
   * 同一局面只求一次解，点开弹窗再确认时直接用缓存。
   */
  _findMoveHint() {
    if (!this.puzzle || !this.grid || this.grid.length < this.puzzle.cells) return null;
    if (this._isSolved()) return null;

    const signature = this._boardSignature();
    if (this._hintCache && this._hintCache.signature === signature) return this._hintCache.hint;

    const board = this.grid.map((tile) => (tile ? tile.char : null));
    const hint = hintKlondikeMove(board, this.goalChars, this.puzzle.cols, this.puzzle.rows);
    this._hintCache = { signature, hint };
    return hint;
  }

  _onHint() {
    if (!this._canPlay() || this._hintModalOpen) return;
    const hint = this._findMoveHint();
    if (!hint) {
      showToast(this, '这一屏已经排好了，等一等下一屏吧。', { y: 320, duration: 1600 });
      return;
    }

    if (this.freeHintLeft > 0) {
      this._hintModalOpen = true;
      this.showModal({
        title: '用一次温和提示？',
        sealText: '温',
        message: `温和模式本次还有 ${this.freeHintLeft} 次免费提示。\n会照参考解法告诉你下一步该移动哪个字块、往哪边滑，\n不消耗毛笔，也不扣星星。`,
        actions: [
          { label: '先自己想想', variant: 'secondary' },
          {
            label: '提示下一步',
            variant: 'primary',
            onClick: () => this._applyHint('free'),
          },
        ],
        onClose: () => {
          this._hintModalOpen = false;
          // 弹窗开着的时候按钮会被锁住，关掉后要把「重置 / 提示」放开
          this._refreshHud();
        },
      });
      return;
    }

    if (progress.getBrushCount() <= 0) {
      showToast(this, '毛笔用完啦，读完这首诗会再得到一支。', { y: 320, tone: 'warn' });
      return;
    }

    this._hintModalOpen = true;
    this.showModal({
      title: '用一支毛笔换提示？',
      sealText: '笔',
      message: `毛笔还剩 ${progress.getBrushCount()} 支。\n会照参考解法告诉你下一步该移动哪个字块、往哪边滑，\n并标出这一步会滑进哪一格。\n用了之后，本关最多只能拿到 2 颗星。`,
      actions: [
        { label: '先自己想想', variant: 'secondary' },
        {
          label: '用一支毛笔',
          variant: 'primary',
          onClick: () => this._applyHint('brush'),
        },
      ],
      onClose: () => {
        this._hintModalOpen = false;
        this._refreshHud();
      },
    });
  }

  /**
   * 应用提示。
   * @param {'free'|'brush'} source
   */
  _applyHint(source) {
    if (this._solved || this._resultShown || !this.puzzle || this._screenSolved) return;
    const hint = this._findMoveHint();
    if (!hint) return;

    if (source === 'brush') {
      if (!progress.consumeBrush()) {
        showToast(this, '毛笔不够啦。', { y: 320, tone: 'warn' });
        return;
      }
      this.brushHintUsed = true;
    } else {
      if (this.freeHintLeft <= 0) return;
      this.freeHintLeft -= 1;
    }

    audio.playPage();
    this._drawHint(hint);
    this._refreshHud();
  }

  /**
   * 参考解法提示：
   *  - 桃色粗框圈出「下一步该动的那个字块」；
   *  - 箭头指向它这一步要滑进去的空位（金色虚影）；
   *  - 文案直接写「把『字』往某边滑一格」，并说明照参考解法还剩几步。
   */
  _drawHint(hint) {
    this._clearHint();
    if (!this._hintLayer || !this._layout) return;

    const { cell } = this._layout;
    const size = cell - 6;
    const source = this._cellCenter(hint.from);
    const target = this._cellCenter(hint.to);
    const dirCn = KLONDIKE_DIRECTION_CN[hint.direction] || '';

    // 这一步会滑进哪一格（金色虚影）
    const ghost = this.add.graphics();
    ghost.fillStyle(C.goldLight, 0.55);
    roundedRectPath(ghost, target.x - size / 2, target.y - size / 2, size, size, 16);
    ghost.fillPath();
    ghost.lineStyle(3, C.gold, 0.95);
    roundedRectPath(ghost, target.x - size / 2, target.y - size / 2, size, size, 16);
    ghost.strokePath();

    // 下一步要动的字块（桃色粗框）
    const ring = this.add.graphics();
    ring.lineStyle(5, C.peachDeep, 0.98);
    roundedRectPath(ring, source.x - size / 2 - 6, source.y - size / 2 - 6, size + 12, size + 12, 18);
    ring.strokePath();

    // 方向箭头：两格连线的中点，指向滑入的那一格
    const arrow = this.add.graphics();
    const angle = Math.atan2(target.y - source.y, target.x - source.x);
    const head = Math.min(30, cell * 0.26);
    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;
    arrow.fillStyle(C.peachDeep, 0.96);
    arrow.fillTriangle(
      midX + Math.cos(angle) * head, midY + Math.sin(angle) * head,
      midX + Math.cos(angle + 2.4) * head * 0.82, midY + Math.sin(angle + 2.4) * head * 0.82,
      midX + Math.cos(angle - 2.4) * head * 0.82, midY + Math.sin(angle - 2.4) * head * 0.82,
    );

    this._hintLayer.add([ghost, ring, arrow]);
    this.tweens.add({
      targets: [ghost, arrow],
      alpha: { from: 0.5, to: 1 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.tweens.add({
      targets: ring,
      alpha: { from: 0.55, to: 1 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const remain = hint.steps ? `照参考解法还要 ${hint.steps} 步排好` : '照参考解法，先走这一步';
    this._setTip(`下一步：把「${hint.char}」往${dirCn}滑一格（桃色框里的那块）\n${remain}`);
    showToast(this, `下一步移动「${hint.char}」，往${dirCn}滑一格`, { y: 320, duration: 2200 });

    this._hintTimer = this.time.delayedCall(HINT_DURATION, () => {
      this._hintTimer = null;
      this._clearHint();
    });
  }

  _clearHint() {
    if (this._hintTimer) {
      this._hintTimer.remove(false);
      this._hintTimer = null;
    }
    if (this._hintLayer && this._hintLayer.length > 0) {
      this._hintLayer.each((child) => this.tweens.killTweensOf(child));
      this._hintLayer.removeAll(true);
    }
    this._setTip('点一下空位旁边的字块，就能把字滑过去');
  }

  _setTip(text) {
    if (this.tipText) this.tipText.setText(text);
  }

  // ---------------------------------------------------------
  // HUD
  // ---------------------------------------------------------
  _stars() {
    let stars = 1;
    if (this.totalBudget > 0) {
      if (this.movesUsed <= this.totalBudget) stars = 3;
      else if (this.movesUsed <= this.totalBudget * STAR_TWO_RATIO) stars = 2;
    }
    // 用过毛笔封顶 2 星（与其它玩法统一）
    if (this.brushHintUsed) stars = Math.min(stars, 2);
    return Math.max(1, Math.min(3, stars));
  }

  _refreshHud() {
    if (!this.puzzle) return;

    const brush = progress.getBrushCount();
    if (this.brushText) this.brushText.setText(`毛笔 × ${brush}`);

    if (this.movesText) {
      this.movesText.setText(`步数 ${this.movesUsed} / ${this.totalBudget}`);
      this.movesText.setColor(this.movesUsed > this.totalBudget ? S.peach : S.ink);
    }

    if (this.starsText) {
      const stars = this._stars();
      const cap = this.brushHintUsed ? '用过毛笔，最多 2 星' : `不超 ${this.totalBudget} 步可拿 3 星`;
      this.starsText.setText(`按当前步数：${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}\n${cap}`);
    }

    if (this._hintBtn) {
      this._hintBtn.setLabel(this.freeHintLeft > 0 ? '温和提示 · 免费' : '毛笔提示');
      this._hintBtn.setDisabled(
        !this._canPlay() || (this.freeHintLeft <= 0 && brush <= 0) || this._isSolved(),
      );
    }
    if (this._resetBtn) this._resetBtn.setDisabled(!this._canPlay());

    if (this.statusText) {
      const correct = this._countCorrect();
      const { charCount } = this.puzzle;
      this.statusText.setText(
        `本屏已归位 ${correct} / ${charCount} 字 · 本屏走了 ${this.screenMoves} 步\n`
        + '字块只往空位滑，绕远一点也没关系，慢慢来',
      );
    }

    this._updateCaption();
  }

  // ---------------------------------------------------------
  // 卡住提示（与错题书斋统一）
  // ---------------------------------------------------------
  _noteStuck(reason) {
    if (this.stuckNoted || this._solved) return;
    this.stuckNoted = true;
    progress.addWrongRecord(this.poem.id);
    console.info('[诗句华容道] 记为卡住：', {
      poem: this.poem.title,
      reason,
      movesUsed: this.movesUsed,
      totalBudget: this.totalBudget,
      resets: this.resets,
    });
    showToast(this, '这一首排得有点久，已记进错题书斋\n通关后会消掉，先读一读再回来', {
      y: 320,
      tone: 'warn',
      duration: 2400,
    });
  }

  // ---------------------------------------------------------
  // 结算（与现有玩法同一套）
  // ---------------------------------------------------------
  _handleSolved() {
    if (this._solved || this._resultShown) return;
    this._solved = true;
    this.busy = true;
    this._screenSolved = true;
    this._clearHint();
    this._refreshHud();

    const stars = this._stars();
    this.result = progress.markPoemComplete(this.poem.id, stars);
    console.info('[诗句华容道] 结算：', {
      poem: this.poem.title,
      screens: this.screens.length,
      stars,
      movesUsed: this.movesUsed,
      totalBudget: this.totalBudget,
      resets: this.resets,
      brushHintUsed: this.brushHintUsed,
      result: this.result,
    });

    if (!this.result) {
      showToast(this, '结算时没有找到这首诗，请回到地图重试。', { y: 320, tone: 'warn' });
      return;
    }

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
        this.result.newCard ? '华容道通关 · 诗卡入卷' : '又通关啦 · 诗句更熟',
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
        `共 ${this.movesUsed} 步（3 星线 ${this.totalBudget} 步）　·　${this.screens.length} 屏　·　`
        + `毛笔提示 ${this.brushHintUsed ? '用过，本关封顶 2 星' : '未用'}　·　重置 ${this.resets} 次`,
        { size: 16, color: S.gold, origin: [0.5, 0.5], wrap: 780 },
      ),
    );

    const lines = [];
    if (this.result.newCard) {
      lines.push(`✦ 新诗卡《${this.poem.title}》已收入图鉴`);
    } else {
      lines.push(`✦ 诗卡星级更新为 ${this.result.stars} ★`);
    }
    if (!this.brushHintUsed && this.result.stars >= 3) {
      lines.push('✦ 步数漂亮、没借毛笔，三颗星全收下');
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
  // 离开
  // ---------------------------------------------------------
  _requestLeave() {
    if (this._leaving) return;
    if (this._solved) {
      this._leaveToMap();
      return;
    }

    this._leaving = true;
    this.showModal({
      title: '先离开这一关吗？',
      sealText: '问',
      message: '诗句还没有排回原位。\n离开后这一关的步数不会保存，下次可以重新开始。',
      actions: [
        { label: '继续排字', variant: 'primary' },
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
