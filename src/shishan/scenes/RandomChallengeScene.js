/**
 * RandomChallengeScene：综合试炼房（独立场景）
 * ------------------------------------------------------------
 * 玩法：
 *  1. 诗会雅厅里连闯 5 小关，每关从「已经做好的玩法池」里随机抽一种：
 *     看图猜诗 / 诗句排序 / 诗意匹配 / 诗句接龙；
 *  2. 每关的诗都从 poem_db 随机抽（可限定难度区间：全部 1~5 / 入门 1~2 / 进阶 3~5），
 *     一局内尽量不重复同一首诗，相邻两关也不会重复同一种玩法；
 *  3. 连续闯关：答错可以重试（错的选项会被收走），只有全部 5 关走完才算完成；
 *  4. 提示是「共用一份池子」：毛笔来自全局存档，温和模式每局另有 2 次免费提示；
 *     池子空了就不能再提示，不再区分是哪一关；
 *  5. 不解锁诗卡：不调用 progress.markPoemComplete，只把答错的诗记进错题书斋；
 *     走完五关奖励「文房藏品碎片」（折戟而归则不发），五关全部一次答对再 +1 片；
 *  6. 结算展示答对数量、一次答对的关数、重试与提示消耗、五关回顾、碎片奖励；
 *  7. 国风雅厅 UI：匾额「诗会 · 五关试炼」、两盏宫灯、香炉与纸卡舞台，
 *     小书童以对话气泡念上半句，玩法标签与关卡圆点像诗会签牌。
 *
 * 复用（不修改任何原有场景）：
 *  - 题目生成直接调用各玩法已经导出的纯函数：
 *      GuessPoem      → dataManager.buildTitleOptions()（看图猜诗原本的出题逻辑）
 *      SortPoemScene  → splitPoemLines()
 *      MeaningMatch   → buildMeaningOptions()
 *      PoemChain      → buildChainRounds() / buildChainOptions() / chainFirstChar()
 *  - BaseScene / ProgressManager / AudioManager / ui 组件 / ScrollPanel
 *
 * 入口：
 *  - { range?: 'all'|'intro'|'advanced', returnScene?, chapterId? }
 *  - 开发预览：/?trial=1（见 main.js），可加 &range=intro
 */

import { SCENES } from '../config/constants.js';
import { C, S } from '../config/theme.js';
import { dataManager } from '../data/DataManager.js';
import { sceneNoteOf } from '../data/poemSceneNote.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import { getDifficultyConfig } from '../config/difficulty.js';
import BaseScene from '../ui/BaseScene.js';
import {
  createButton,
  createPaperPanel,
  createTag,
  makeText,
} from '../ui/components.js';
import { addSeal, roundedRectPath } from '../ui/background.js';
import { ScrollPanel } from '../ui/ScrollPanel.js';
// 复用三个玩法已经导出的出题 / 拆句逻辑
import { splitPoemLines } from './SortPoemScene.js';
import { buildMeaningOptions } from './MeaningMatchScene.js';
import { buildChainRounds, buildChainOptions, chainFirstChar } from './PoemChainScene.js';
import { grantTrialCollection } from '../gameplay/collectionRewards.js';

// ---------------------------------------------------------
// 布局常量（1280 × 720 设计分辨率）
// ---------------------------------------------------------
const TOP_Y = 128;
const DOT = { startX: 300, gap: 44, r: 17 }; // 圆点排在左侧，给中间的匾额让位

const LOBBY_PANEL = { x: 640, y: 396, width: 1120, height: 440 }; // 176..616
const STAGE = { x: 640, y: 390, width: 1160, height: 420 }; // 180..600
const FEEDBACK = { guessX: 900, guessY: 548, guessWrap: 600, y: 548, wrap: 1060 };

const GUESS_OPTIONS = { x: 900, ys: [276, 348, 420, 492], width: 600, height: 64 };
const MEANING_OPTIONS = { xs: [380, 900], ys: [396, 506], width: 500, height: 104 };
const CHAIN_OPTIONS = { xs: [380, 900], ys: [418, 514], width: 540, height: 86 };
const ORDER_CHIPS = { ys4: [286, 340, 394, 448], ys3: [300, 356, 412], ys2: [332, 392], width: 700, height: 50 };
const ORDER_SLOT = { y: 512, height: 44, totalWidth: 1000, gap: 14 };

const RESULT_PANEL = { x: 640, y: 364, width: 960, height: 600 }; // 64..664
const RESULT_REVIEW = { x: 232, y: 402, width: 816, height: 150 };

const TRIAL_LEVEL_COUNT = 5;
const GENTLE_FREE_HINTS = 2; // 温和模式每局额外 2 次免费提示（共用同一个池子）
const ORDER_MIN_BLOCKS = 2;
const ORDER_MAX_BLOCKS = 4;
const ORDER_MAX_CHARS = 12; // 排序块最长字数（要放进格子里）
const CHAIN_MAX_CHARS = 18; // 接龙句式最长字数（选项按钮要放得下）
const NEXT_DELAY = 820;
const RESULT_DELAY = 520;

const PUNCT_MARKS = /[，。！？；：、,.!?;:\s“”"'‘’「」『』（）()【】〈〉《》·—…]/g;

/** 只算汉字，用于长度判断 */
function bareLength(text) {
  return String(text || '').replace(PUNCT_MARKS, '').length;
}

function clampText(text, max = 48) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** 可注入随机源的洗牌，方便自动化验收 */
function shuffleWith(list, random = Math.random) {
  const array = [...list];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function pickWith(list, random = Math.random) {
  if (!list || list.length === 0) return null;
  return list[Math.floor(random() * list.length)];
}

// ---------------------------------------------------------
// 玩法池与难度区间
// ---------------------------------------------------------
export const TRIAL_TYPES = [
  { key: 'guess', name: '看图猜诗', glyph: '画' },
  { key: 'order', name: '诗句排序', glyph: '序' },
  { key: 'meaning', name: '诗意匹配', glyph: '意' },
  { key: 'chain', name: '诗句接龙', glyph: '接' },
];

export const TRIAL_RANGES = [
  { key: 'all', name: '全部 1~5', short: '全部', min: 1, max: 5 },
  { key: 'intro', name: '入门 1~2', short: '入门', min: 1, max: 2 },
  { key: 'advanced', name: '进阶 3~5', short: '进阶', min: 3, max: 5 },
];

export const TRIAL_LEVEL_TOTAL = TRIAL_LEVEL_COUNT;

export function getTrialType(key) {
  return TRIAL_TYPES.find((type) => type.key === key) || TRIAL_TYPES[0];
}

export function getTrialRange(key) {
  return TRIAL_RANGES.find((range) => range.key === key) || TRIAL_RANGES[0];
}

/** 某难度区间里可抽的课内 / 拓展诗（隐藏诗卡不参与，避免剧透） */
export function getTrialPoems(rangeKey = 'all', poems = dataManager.getAllPoems()) {
  const range = getTrialRange(rangeKey);
  return poems.filter(
    (poem) => !poem.is_hidden
      && Number(poem.difficulty) >= range.min
      && Number(poem.difficulty) <= range.max,
  );
}

/**
 * 判断一首诗能不能出某一种玩法的题。
 * 每种玩法都直接借用它自己的出题函数来判断，避免抽到做不下去的关。
 */
export function isTrialPoemUsable(poem, typeKey) {
  if (!poem || !poem.full_text) return false;

  if (typeKey === 'guess') {
    return Boolean(poem.ai_prompt) && dataManager.getDistractorPoems(poem.id, 3).length >= 3;
  }

  if (typeKey === 'order') {
    const blocks = splitPoemLines(poem.full_text);
    if (blocks.length < ORDER_MIN_BLOCKS || blocks.length > ORDER_MAX_BLOCKS) return false;
    return blocks.every((block) => bareLength(block) <= ORDER_MAX_CHARS);
  }

  if (typeKey === 'meaning') {
    const question = buildMeaningOptions(poem.id, 0);
    return Boolean(question && question.options && question.options.length === 4);
  }

  if (typeKey === 'chain') {
    const rounds = buildChainRounds(poem.full_text, 4);
    if (rounds.length === 0) return false;
    return rounds.every((round) => {
      if (bareLength(round.answer) > CHAIN_MAX_CHARS) return false;
      const options = buildChainOptions(poem, round, 4);
      return options.length === 4
        && options.every((option) => bareLength(option.text) <= CHAIN_MAX_CHARS);
    });
  }

  return false;
}

// ---------------------------------------------------------
// 抽题（纯函数，供自动化验收）
// ---------------------------------------------------------
/** 五关的玩法顺序：四种玩法全部出现，且相邻两关不重复 */
export function buildTrialTypes(count = TRIAL_LEVEL_COUNT, random = Math.random) {
  const keys = TRIAL_TYPES.map((type) => type.key);
  const sequence = shuffleWith(keys, random);
  while (sequence.length < count) {
    const candidates = keys.filter((key) => key !== sequence[sequence.length - 1]);
    sequence.push(pickWith(candidates, random));
  }
  return sequence.slice(0, Math.max(1, count));
}

function createTrialLevel(type, poem, random) {
  const base = {
    index: 0,
    typeKey: type.key,
    typeName: type.name,
    glyph: type.glyph,
    poemId: poem.id,
    title: poem.title,
    author: poem.author || '',
    dynasty: poem.dynasty || '',
    difficulty: poem.difficulty,
    tip: poem.tip || '',
    aiPrompt: poem.ai_prompt || '',
    sceneNote: sceneNoteOf(poem),
  };

  if (type.key === 'guess') {
    const options = dataManager.buildTitleOptions(poem.id).map((option) => ({
      title: option.poem.title,
      author: option.poem.author,
      dynasty: option.poem.dynasty,
      correct: Boolean(option.correct),
    }));
    if (options.length !== 4) return null;
    return { ...base, options };
  }

  if (type.key === 'order') {
    const blocks = splitPoemLines(poem.full_text);
    if (blocks.length < ORDER_MIN_BLOCKS || blocks.length > ORDER_MAX_BLOCKS) return null;
    const shuffled = shuffleWith(blocks, random);
    if (shuffled.join('|') === blocks.join('|')) shuffled.push(shuffled.shift());
    return { ...base, blocks, shuffled };
  }

  if (type.key === 'meaning') {
    const first = buildMeaningOptions(poem.id, 0);
    if (!first) return null;
    const lineIndex = Math.floor(random() * Math.max(1, first.totalLines));
    const question = lineIndex === 0 ? first : buildMeaningOptions(poem.id, lineIndex);
    if (!question) return null;
    const options = question.options.map((option) => ({
      text: option.text,
      correct: Boolean(option.correct),
    }));
    if (options.length !== 4) return null;
    return {
      ...base,
      question: { line: question.line, lineIndex: question.lineIndex, options },
    };
  }

  if (type.key === 'chain') {
    const rounds = buildChainRounds(poem.full_text, 4);
    if (rounds.length === 0) return null;
    const round = pickWith(rounds, random);
    const options = buildChainOptions(poem, round, 4).map((option) => ({
      text: option.text,
      correct: Boolean(option.correct),
    }));
    if (options.length !== 4) return null;
    return {
      ...base,
      prompt: round.prompt,
      answer: round.answer,
      options,
    };
  }

  return null;
}

/**
 * 抽一整局五关。
 * @param {object} options { rangeKey, count, poems, random }
 * @returns {Array} 关卡数组（每关带 typeKey / poemId / 题目数据）
 */
export function buildTrialLevels(options = {}) {
  const {
    rangeKey = 'all',
    count = TRIAL_LEVEL_COUNT,
    poems = dataManager.getAllPoems(),
    random = Math.random,
  } = options;

  const pool = getTrialPoems(rangeKey, poems);
  if (pool.length === 0) return [];

  const typeKeys = buildTrialTypes(count, random);
  const used = new Set();
  const levels = [];
  let lastPoemId = 0;

  typeKeys.forEach((typeKey) => {
    const type = getTrialType(typeKey);
    const usable = pool.filter((poem) => isTrialPoemUsable(poem, typeKey));
    let candidates = usable.filter((poem) => poem.id !== lastPoemId && !used.has(poem.id));
    if (candidates.length === 0) candidates = usable.filter((poem) => poem.id !== lastPoemId);
    if (candidates.length === 0) candidates = usable;
    if (candidates.length === 0) return;

    // 万一某首诗凑不出完整选项，就换下一首继续试，别让一局少一关
    for (const poem of shuffleWith(candidates, random)) {
      const level = createTrialLevel(type, poem, random);
      if (!level) continue;

      used.add(poem.id);
      lastPoemId = poem.id;
      levels.push({ ...level, index: levels.length + 1 });
      break;
    }
  });

  return levels;
}

/** 某关的选项（看图 / 诗意 / 接龙三种玩法共用） */
export function trialOptionsOf(level) {
  if (!level) return [];
  if (Array.isArray(level.options)) return level.options;
  if (level.question && Array.isArray(level.question.options)) return level.question.options;
  return [];
}

/** 某关正确答案的条数（正常应为 1，供验收断言） */
export function countTrialCorrect(level) {
  return trialOptionsOf(level).filter((option) => option.correct).length;
}

// ---------------------------------------------------------
// 场景
// ---------------------------------------------------------
export default class RandomChallengeScene extends BaseScene {
  constructor() {
    super(SCENES.RANDOM_CHALLENGE);
  }

  // ---------------------------------------------------------
  // 生命周期
  // ---------------------------------------------------------
  init(data = {}) {
    this.returnScene = data.returnScene || null;
    this.chapterId = Number(data.chapterId) || 1;
    this.rangeKey = getTrialRange(data.range).key;

    this.phase = 'lobby'; // lobby | playing | over
    this.levels = [];
    this.levelIndex = 0;
    this.level = null;
    this.levelState = null;
    this.passed = [];
    this.summary = [];

    this.solvedLevels = 0;
    this.perfectCount = 0;
    this.retryCount = 0;
    this.hintsUsed = 0;
    this.brushHints = 0;
    this.freeHintsUsed = 0;
    this.freeHintLeft = 0;

    this.result = null;
    this.busy = false;
    this._resultShown = false;
    this._modalOpen = false;
    this._leaving = false;

    this.optionButtons = [];
    this.feedbackText = null;
    this.hintButton = null;
    this.giveUpButton = null;
    this.resultButtons = null;
    this.dotLabels = [];
    this._levelObjects = [];
    this._lobbyObjects = [];
    this._lobbyButtons = [];
    this.rangeButtons = [];
  }

  create() {
    this.prepareScene();
    this.addBackground('paper', { petals: true });
    this.addGrain(0.1);
    audio.playBgm('level');

    this.difficulty = getDifficultyConfig(progress.getDifficulty());
    this.gentle = this.difficulty.gentleNudge;

    this.addHeader({
      title: '综合试炼房',
      subtitle: '诗会五关 · 四种玩法随机抽题 · 答错可以重试',
      backLabel: '返回地图',
      onBack: () => this._requestLeave(),
    });
    this._drawHall();
    this._buildTopBar();
    this._refreshHud();
    this._buildLobby();

    audio.playPage();
    console.info('[试炼房] 模式：', this.difficulty.name, '· 碎片：', progress.getTrialFragments());
  }

  // ---------------------------------------------------------
  // 雅厅装饰
  // ---------------------------------------------------------
  _drawHall() {
    const decor = this.add.graphics().setDepth(12);

    // 匾额
    decor.fillStyle(C.pineDeep, 0.92);
    roundedRectPath(decor, 490, 133, 300, 42, 10);
    decor.fillPath();
    decor.lineStyle(1.6, C.gold, 0.8);
    roundedRectPath(decor, 494, 137, 292, 34, 8);
    decor.strokePath();

    // 两盏宫灯（挂在画面左右留白里，垂在纸卡两旁，不压住顶栏与按钮）
    [34, 1246].forEach((x) => {
      decor.lineStyle(1.6, C.gold, 0.55);
      decor.beginPath();
      decor.moveTo(x, 104);
      decor.lineTo(x, 190);
      decor.strokePath();
      decor.fillStyle(C.blossom, 0.95);
      roundedRectPath(decor, x - 18, 190, 36, 36, 16);
      decor.fillPath();
      decor.lineStyle(1.4, C.peachDeep, 0.55);
      roundedRectPath(decor, x - 18, 190, 36, 36, 16);
      decor.strokePath();
      decor.fillStyle(C.goldLight, 0.92);
      decor.fillRect(x - 22, 188, 44, 5);
      decor.fillRect(x - 22, 223, 44, 5);
      decor.lineStyle(1.2, C.peachDeep, 0.5);
      decor.beginPath();
      decor.moveTo(x, 228);
      decor.lineTo(x, 238);
      decor.strokePath();
      decor.fillStyle(C.peachDeep, 0.75);
      decor.fillCircle(x, 240, 3);
    });

    // 香炉（右下角）
    decor.fillStyle(C.paperDeep, 0.85);
    decor.fillEllipse(1200, 684, 96, 26);
    decor.fillStyle(C.inkSoft, 0.3);
    roundedRectPath(decor, 1162, 656, 76, 30, 14);
    decor.fillPath();
    decor.lineStyle(1.4, C.gold, 0.55);
    roundedRectPath(decor, 1162, 656, 76, 30, 14);
    decor.strokePath();
    decor.lineStyle(1.6, C.inkFaint, 0.45);
    [[1184, 650], [1200, 642], [1216, 650]].forEach(([x, y], index) => {
      decor.beginPath();
      decor.moveTo(x, y);
      decor.lineTo(x + (index - 1) * 5, y - 26);
      decor.strokePath();
    });

    makeText(this, 640, 154, '诗会 · 五关试炼', { size: 19, color: S.white }).setDepth(13);
  }

  // ---------------------------------------------------------
  // 顶栏：关卡圆点 / 答对数 / 提示池 / 模式
  // ---------------------------------------------------------
  _buildTopBar() {
    addSeal(this, 78, TOP_Y, '试', 44, C.peachDeep).setDepth(905);
    this.stageText = makeText(this, 110, TOP_Y, '试炼房 · 前厅', {
      size: 22,
      color: S.ink,
      origin: [0, 0.5],
    }).setDepth(910);

    this.dotGfx = this.add.graphics().setDepth(906);
    this.dotLabels = [];
    for (let i = 0; i < TRIAL_LEVEL_COUNT; i += 1) {
      const label = makeText(this, DOT.startX + i * DOT.gap, TOP_Y, String(i + 1), {
        size: 14,
        color: S.mute,
        origin: [0.5, 0.5],
      }).setDepth(910);
      this.dotLabels.push(label);
    }

    this.scoreText = makeText(this, 806, TOP_Y, '', {
      size: 18,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(910);
    this.hintText = makeText(this, 920, TOP_Y, '', {
      size: 17,
      color: S.gold,
      origin: [0, 0.5],
    }).setDepth(910);

    this.modeButton = createButton(this, {
      x: 1155,
      y: TOP_Y,
      width: 190,
      height: 46,
      radius: 18,
      label: this.gentle ? '切到挑战版' : '切到温和版',
      variant: 'soft',
      fontSize: 17,
      depth: 940,
      onClick: () => this._onSwitchMode(),
    });
  }

  _drawDots() {
    const g = this.dotGfx;
    if (!g) return;
    g.clear();
    for (let i = 0; i < TRIAL_LEVEL_COUNT; i += 1) {
      const x = DOT.startX + i * DOT.gap;
      const passed = Boolean(this.passed && this.passed[i]);
      const current = this.phase === 'playing' && i === this.levelIndex;
      if (passed) {
        g.fillStyle(C.pineDeep, 0.9);
        g.fillCircle(x, TOP_Y, DOT.r);
      } else if (current) {
        g.fillStyle(C.goldLight, 0.95);
        g.fillCircle(x, TOP_Y, DOT.r);
        g.lineStyle(2.4, C.gold, 0.95);
        g.strokeCircle(x, TOP_Y, DOT.r);
      } else {
        g.fillStyle(C.paperDeep, 0.9);
        g.fillCircle(x, TOP_Y, DOT.r);
        g.lineStyle(1.2, C.inkLine, 0.8);
        g.strokeCircle(x, TOP_Y, DOT.r);
      }
      const label = this.dotLabels[i];
      if (label) {
        label.setText(passed ? '✓' : String(i + 1));
        label.setColor(passed ? S.white : current ? S.gold : S.mute);
      }
    }
  }

  _hintPoolLeft() {
    return Math.max(0, this.freeHintLeft) + progress.getBrushCount();
  }

  _refreshHud() {
    const lobby = this.phase === 'lobby';
    const over = this.phase === 'over';
    if (this.stageText) {
      this.stageText.setText(
        lobby ? '试炼房 · 前厅' : over ? '试炼结束' : `第 ${this.levelIndex + 1} / ${this.levels.length} 关`,
      );
    }
    if (this.scoreText) this.scoreText.setText(lobby ? '' : `答对 ${this.solvedLevels}`);
    if (this.hintText) this.hintText.setText(lobby ? '' : `提示 × ${this._hintPoolLeft()}`);
    if (this.modeButton) {
      this.modeButton.setLabel(this.gentle ? '切到挑战版' : '切到温和版');
      this.modeButton.setDisabled(this.phase === 'playing');
    }
    this._drawDots();
    this._refreshPlayingButtons();
  }

  _refreshPlayingButtons() {
    if (!this.hintButton) return;
    const left = this._hintPoolLeft();
    this.hintButton.setLabel(`毛笔提示 · 剩 ${left}`);
    this.hintButton.setDisabled(!(this._canAct() && left > 0));
    if (this.giveUpButton) {
      this.giveUpButton.setDisabled(!(this.phase === 'playing' && this.levelState && !this.levelState.solved));
    }
  }

  _canAct() {
    return this.phase === 'playing'
      && Boolean(this.levelState)
      && !this.levelState.solved
      && !this.busy
      && !this._modalOpen;
  }

  // ---------------------------------------------------------
  // 前厅（诗台）
  // ---------------------------------------------------------
  _buildLobby() {
    this.phase = 'lobby';
    this._clearLobby();

    this._trackLobby(createPaperPanel(this, {
      x: LOBBY_PANEL.x,
      y: LOBBY_PANEL.y,
      width: LOBBY_PANEL.width,
      height: LOBBY_PANEL.height,
      depth: 900,
    }));
    this._trackLobby(addSeal(this, 214, 208, '会', 62, C.peachDeep).setDepth(905));

    this._trackLobby(makeText(this, 640, 208, '综合试炼房 · 诗会五关', {
      size: 33,
      color: S.ink,
    }).setDepth(910));
    this._trackLobby(makeText(
      this,
      640,
      250,
      '四种玩法随机抽题，连闯五关；答错可以重试，提示共用一份毛笔池。',
      { size: 17, color: S.inkSoft, wrap: 940, lineSpacing: 6 },
    ).setDepth(910));

    TRIAL_TYPES.forEach((type, index) => {
      const tag = createTag(this, [370, 550, 730, 910][index], 300, `${type.glyph} · ${type.name}`, {
        fill: C.pineLight,
        textColor: S.pineDeep,
        strokeColor: C.pine,
        fontSize: 15,
        height: 32,
        paddingX: 16,
        depth: 912,
      });
      this._trackLobby(tag.container);
    });

    this._trackLobby(makeText(this, 640, 356, '诗句难度区间（决定会抽到哪几首诗）', {
      size: 15,
      color: S.inkSoft,
    }).setDepth(912));

    this.rangeButtons = TRIAL_RANGES.map((range, index) => {
      const button = createButton(this, {
        x: [400, 640, 880][index],
        y: 394,
        width: 200,
        height: 50,
        radius: 18,
        label: range.name,
        variant: range.key === this.rangeKey ? 'primary' : 'secondary',
        fontSize: 17,
        depth: 940,
        onClick: () => this._pickRange(range.key),
      });
      this._trackLobby(button);
      this._lobbyButtons.push(button);
      return { key: range.key, button };
    });

    this.lobbyRangeText = makeText(this, 640, 436, '', {
      size: 15,
      color: S.inkSoft,
    }).setDepth(912);
    this._trackLobby(this.lobbyRangeText);

    this.lobbyHintText = makeText(this, 640, 466, '', {
      size: 15,
      color: S.inkSoft,
    }).setDepth(912);
    this._trackLobby(this.lobbyHintText);

    this.lobbyFragmentsText = makeText(this, 640, 500, '', {
      size: 17,
      color: S.gold,
    }).setDepth(912);
    this._trackLobby(this.lobbyFragmentsText);

    const start = createButton(this, {
      x: 470,
      y: 550,
      width: 340,
      height: 62,
      radius: 22,
      label: '开始试炼',
      subLabel: '五关连闯 · 抽到什么算什么',
      variant: 'gold',
      fontSize: 24,
      subFontSize: 13,
      depth: 940,
      onClick: () => this._startRun(),
    });
    this._trackLobby(start);
    this._lobbyButtons.push(start);

    const back = createButton(this, {
      x: 810,
      y: 550,
      width: 300,
      height: 62,
      radius: 22,
      label: '返回地图',
      variant: 'secondary',
      fontSize: 22,
      depth: 940,
      onClick: () => this._leaveToMap(),
    });
    this._trackLobby(back);
    this._lobbyButtons.push(back);

    this._trackLobby(makeText(
      this,
      640,
      602,
      '试炼房不点亮诗卡；答错的诗会记进错题书斋，方便以后复习。',
      { size: 13, color: S.inkFaint, wrap: 900 },
    ).setDepth(912));

    this._refreshLobbyInfo();
    this._refreshHud();
  }

  _refreshLobbyInfo() {
    const poems = getTrialPoems(this.rangeKey);
    const range = getTrialRange(this.rangeKey);
    if (this.lobbyRangeText) {
      this.lobbyRangeText.setText(`这一档能抽 ${poems.length} 首诗（难度 ${range.min}~${range.max}）· 每关玩法随机`);
    }
    if (this.lobbyHintText) {
      const brush = progress.getBrushCount();
      this.lobbyHintText.setText(
        `本局提示：毛笔 × ${brush}${this.gentle ? ' ＋ 温和免费 2' : ''}　（五关共用这一份池子）`,
      );
    }
    if (this.lobbyFragmentsText) {
      this.lobbyFragmentsText.setText(
        `文房藏品碎片 × ${progress.getTrialFragments()}　·　走完五关 +1 片，五关全部一次答对再 +1 片`,
      );
    }
  }

  _pickRange(key) {
    if (this.rangeKey === key) return;
    this.rangeKey = key;
    this.rangeButtons.forEach((item) => {
      item.button.setVariant(item.key === key ? 'primary' : 'secondary');
    });
    this._refreshLobbyInfo();
    audio.playPage();
  }

  _trackLobby(item) {
    this._lobbyObjects.push(item);
    return item;
  }

  _clearLobby() {
    this._lobbyObjects.forEach((item) => {
      if (!item) return;
      if (typeof item.destroy === 'function') {
        item.destroy();
      } else if (item.container && typeof item.container.destroy === 'function') {
        item.container.destroy();
      }
    });
    this._lobbyObjects = [];
    this._lobbyButtons = [];
    this.rangeButtons = [];
    this.lobbyRangeText = null;
    this.lobbyHintText = null;
    this.lobbyFragmentsText = null;
  }

  // ---------------------------------------------------------
  // 开局
  // ---------------------------------------------------------
  _startRun() {
    if (this.phase === 'playing') return;

    const levels = buildTrialLevels({ rangeKey: this.rangeKey, count: TRIAL_LEVEL_COUNT });
    if (levels.length < TRIAL_LEVEL_COUNT) {
      this.showToast('这一档凑不出五关，先换成「全部 1~5」试试。', { y: 620 });
      return;
    }

    this.levels = levels;
    this.levelIndex = 0;
    this.level = null;
    this.levelState = null;
    this.solvedLevels = 0;
    this.perfectCount = 0;
    this.retryCount = 0;
    this.hintsUsed = 0;
    this.brushHints = 0;
    this.freeHintsUsed = 0;
    this.freeHintLeft = this.gentle ? GENTLE_FREE_HINTS : 0;
    this.summary = [];
    this.passed = new Array(TRIAL_LEVEL_COUNT).fill(false);
    this.result = null;
    this._resultShown = false;
    this._modalOpen = false;
    this.busy = false;
    this.phase = 'playing';

    this._clearLobby();
    this._buildPlayingButtons();
    this._startLevel();
    this._refreshHud();
    audio.playPage();
    console.info(
      '[试炼房] 抽题：',
      levels.map((level) => `${level.typeName}·《${level.title}》`).join(' / '),
    );
  }

  _buildPlayingButtons() {
    this.hintButton = createButton(this, {
      x: 470,
      y: 676,
      width: 340,
      height: 60,
      radius: 22,
      label: '毛笔提示 · 剩 3',
      variant: 'gold',
      fontSize: 21,
      depth: 940,
      onClick: () => this._onHint(),
    });
    this.giveUpButton = createButton(this, {
      x: 850,
      y: 676,
      width: 340,
      height: 60,
      radius: 22,
      label: '放弃这一局',
      variant: 'secondary',
      fontSize: 20,
      depth: 940,
      onClick: () => this._onGiveUp(),
    });
  }

  _startLevel() {
    this.level = this.levels[this.levelIndex];
    this.levelState = {
      attempts: 0,
      hintUsed: false,
      eliminated: new Set(),
      order: [],
      chips: [],
      slotGfx: null,
      slotTexts: [],
      slotZones: [],
      chipButtons: [],
      solved: false,
      wrongRecorded: false,
    };
    this.busy = false;
    this._buildLevel();
    this._setFeedback(this._introFor(this.level), 'normal');
    this._refreshHud();
  }

  _introFor(level) {
    if (level.typeKey === 'guess') return '看看画卷里的景与物，选出画的是哪一首诗。';
    if (level.typeKey === 'order') return '按原来的顺序，把诗句一句一句点进下面的格子里。';
    if (level.typeKey === 'meaning') return '读一读这句诗，选出它最接近的意思。';
    return '小书童念了上半句，你来接下半句。';
  }

  _levelTitle(level) {
    if (level.typeKey === 'guess') return '这幅画卷写的是哪一首诗？';
    if (level.typeKey === 'order') return '把诗句排回原来的顺序';
    if (level.typeKey === 'meaning') return '这句诗是什么意思？';
    return '上半句已经念出，下句该接什么？';
  }

  /** 看图关不能露出诗题，其余玩法温和模式可以标出诗题与作者 */
  _sourceFor(level) {
    if (level.typeKey === 'guess') return `难度 ${level.difficulty}`;
    if (this.gentle) return `《${level.title}》· ${level.author} · ${level.dynasty}`;
    return `难度 ${level.difficulty}`;
  }

  // ---------------------------------------------------------
  // 关卡画面
  // ---------------------------------------------------------
  _buildLevel() {
    this._clearLevel();
    const level = this.level;

    this._track(createPaperPanel(this, {
      x: STAGE.x,
      y: STAGE.y,
      width: STAGE.width,
      height: STAGE.height,
      depth: 900,
    }));

    const tag = createTag(this, 176, 212, level.typeName, {
      fill: C.goldLight,
      textColor: S.gold,
      strokeColor: C.gold,
      strokeAlpha: 0.6,
      fontSize: 16,
      height: 34,
      paddingX: 18,
      depth: 906,
    });
    this._track(tag);

    this._track(makeText(this, 260, 212, this._levelTitle(level), {
      size: 23,
      color: S.ink,
      origin: [0, 0.5],
    }).setDepth(906));

    this._track(makeText(this, 1150, 212, this._sourceFor(level), {
      size: 15,
      color: S.inkSoft,
      origin: [1, 0.5],
    }).setDepth(906));

    if (level.typeKey === 'guess') this._buildGuessLevel();
    else if (level.typeKey === 'order') this._buildOrderLevel();
    else if (level.typeKey === 'meaning') this._buildMeaningLevel();
    else this._buildChainLevel();
  }

  _track(item) {
    this._levelObjects.push(item);
    return item;
  }

  _clearLevel() {
    this._levelObjects.forEach((item) => {
      if (!item) return;
      if (typeof item.destroy === 'function') {
        item.destroy();
      } else if (item.container && typeof item.container.destroy === 'function') {
        item.container.destroy();
      }
    });
    this._levelObjects = [];
    this.optionButtons = [];
    this.feedbackText = null;
  }

  _createFeedback(x, y, wrap) {
    const text = makeText(this, x, y, '', {
      size: 16,
      color: S.inkSoft,
      origin: [0.5, 0],
      wrap,
      lineSpacing: 5,
    }).setDepth(950);
    this.feedbackText = text;
    this._track(text);
    return text;
  }

  /** 统一的提示 / 鼓励 / 纠错文案 */
  _setFeedback(text, tone = 'normal') {
    if (!this.feedbackText) return;
    const color = tone === 'correct'
      ? S.pineDeep
      : tone === 'warn'
        ? S.danger
        : tone === 'hint'
          ? S.gold
          : S.inkSoft;
    this.feedbackText.setText(text);
    this.feedbackText.setColor(color);
  }

  // ---------------------------------------------------------
  // 玩法一：看图猜诗（画卷 + 四个诗题）
  // ---------------------------------------------------------
  _buildGuessLevel() {
    const level = this.level;
    const art = this.add.graphics().setDepth(904);
    this._drawScrollArt(art, 100, 244, 460, 288);
    this._track(art);
    this._track(makeText(this, 146, 262, '画卷', {
      size: 14,
      color: S.inkFaint,
      origin: [0, 0.5],
    }).setDepth(906));
    this._track(makeText(this, 360, 548, `诗里的意境：${clampText(level.sceneNote, 90)}`, {
      size: 14,
      color: S.inkSoft,
      origin: [0.5, 0],
      wrap: 440,
      lineSpacing: 4,
    }).setDepth(906));

    this._createFeedback(FEEDBACK.guessX, FEEDBACK.guessY, FEEDBACK.guessWrap);

    level.options.forEach((option, index) => {
      const button = createButton(this, {
        x: GUESS_OPTIONS.x,
        y: GUESS_OPTIONS.ys[index],
        width: GUESS_OPTIONS.width,
        height: GUESS_OPTIONS.height,
        radius: 20,
        label: option.title,
        subLabel: this.gentle ? `${option.dynasty} · ${option.author}` : '',
        variant: 'secondary',
        fontSize: 24,
        subFontSize: 13,
        depth: 940,
        onClick: () => this._onGuessPick(index),
      });
      this._track(button);
      this.optionButtons.push(button);
    });
  }

  /** 淡彩山水「画卷」占位图（与看图猜诗的配图占位同一套画面语言） */
  _drawScrollArt(g, x, y, w, h) {
    g.fillStyle(C.sky, 1);
    roundedRectPath(g, x, y, w, h, 18);
    g.fillPath();

    g.fillStyle(C.dusk, 0.55);
    g.fillEllipse(x + w * 0.26, y + h * 0.3, w * 0.52, h * 0.34);
    g.fillStyle(C.moss, 0.34);
    g.fillEllipse(x + w * 0.18, y + h * 0.66, w * 0.62, h * 0.5);
    g.fillEllipse(x + w * 0.72, y + h * 0.7, w * 0.72, h * 0.54);
    g.fillStyle(0xa9c396, 0.4);
    g.fillEllipse(x + w * 0.48, y + h * 0.86, w * 0.8, h * 0.3);

    g.fillStyle(C.goldLight, 0.92);
    g.fillCircle(x + w * 0.76, y + h * 0.24, Math.min(w, h) * 0.08);

    g.fillStyle(C.water, 0.8);
    g.fillEllipse(x + w * 0.62, y + h * 0.82, w * 0.66, h * 0.16);
    g.lineStyle(1.5, C.waterDeep, 0.35);
    for (let i = 0; i < 3; i += 1) {
      const lineY = y + h * (0.78 + i * 0.05);
      g.beginPath();
      g.moveTo(x + w * 0.36, lineY);
      g.lineTo(x + w * 0.5, lineY - 3);
      g.lineTo(x + w * 0.62, lineY);
      g.lineTo(x + w * 0.74, lineY - 3);
      g.lineTo(x + w * 0.86, lineY);
      g.strokePath();
    }

    g.lineStyle(2.4, C.pine, 0.42);
    [0.14, 0.22, 0.88].forEach((ratio, index) => {
      const baseX = x + w * ratio;
      const baseY = y + h * (0.88 - index * 0.02);
      g.beginPath();
      g.moveTo(baseX, baseY);
      g.lineTo(baseX + (index % 2 === 0 ? -8 : 8), baseY - h * 0.26);
      g.strokePath();
    });

    g.lineStyle(1.6, C.inkSoft, 0.45);
    [[0.62, 0.16, 9], [0.7, 0.22, 7], [0.54, 0.26, 6]].forEach(([rx, ry, size]) => {
      const bx = x + w * rx;
      const by = y + h * ry;
      g.beginPath();
      g.moveTo(bx - size, by);
      g.lineTo(bx - size * 0.5, by - size * 0.55);
      g.lineTo(bx, by);
      g.lineTo(bx + size * 0.5, by - size * 0.55);
      g.lineTo(bx + size, by);
      g.strokePath();
    });

    g.lineStyle(1.6, C.inkFaint, 0.5);
    roundedRectPath(g, x, y, w, h, 18);
    g.strokePath();
  }

  // ---------------------------------------------------------
  // 玩法二：诗句排序（点诗句填格，可点格子取回）
  // ---------------------------------------------------------
  _buildOrderLevel() {
    const level = this.level;
    const state = this.levelState;
    const total = level.shuffled.length;
    const chipYs = total >= 4
      ? ORDER_CHIPS.ys4
      : total === 3 ? ORDER_CHIPS.ys3 : ORDER_CHIPS.ys2;

    level.shuffled.forEach((line, index) => {
      const button = createButton(this, {
        x: 640,
        y: chipYs[index],
        width: ORDER_CHIPS.width,
        height: ORDER_CHIPS.height,
        radius: 18,
        label: line,
        variant: 'secondary',
        fontSize: 21,
        depth: 940,
        onClick: () => this._placeLine(index),
      });
      this._track(button);
      state.chipButtons.push(button);
    });

    state.slotGfx = this.add.graphics().setDepth(906);
    this._track(state.slotGfx);

    const slotW = (ORDER_SLOT.totalWidth - ORDER_SLOT.gap * (total - 1)) / total;
    const startX = 640 - ORDER_SLOT.totalWidth / 2;
    for (let i = 0; i < total; i += 1) {
      const cx = startX + slotW / 2 + i * (slotW + ORDER_SLOT.gap);
      const text = makeText(this, cx, ORDER_SLOT.y, `第 ${i + 1} 句`, {
        size: 16,
        color: S.mute,
        wrap: slotW - 16,
      }).setDepth(908);
      this._track(text);
      state.slotTexts.push({ cx, width: slotW, text });

      const zone = this.add
        .zone(cx, ORDER_SLOT.y, slotW, ORDER_SLOT.height)
        .setDepth(909)
        .setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => this._removeFromOrder(i));
      this._track(zone);
      state.slotZones.push(zone);
    }

    this._renderOrderSlots();
    this._createFeedback(640, 552, FEEDBACK.wrap);
  }

  _renderOrderSlots() {
    const state = this.levelState;
    if (!state || !state.slotGfx) return;
    const g = state.slotGfx;
    g.clear();
    const total = this.level.blocks.length;
    const top = ORDER_SLOT.y - ORDER_SLOT.height / 2;
    state.slotTexts.forEach((slot, i) => {
      const filled = i < state.order.length;
      const chipIndex = state.order[i];
      g.fillStyle(filled ? C.goldLight : C.paperDeep, filled ? 0.92 : 0.45);
      roundedRectPath(g, slot.cx - slot.width / 2, top, slot.width, ORDER_SLOT.height, 12);
      g.fillPath();
      g.lineStyle(1.4, filled ? C.gold : C.inkLine, filled ? 0.85 : 0.6);
      roundedRectPath(g, slot.cx - slot.width / 2, top, slot.width, ORDER_SLOT.height, 12);
      g.strokePath();
      const text = filled ? this.level.shuffled[chipIndex] : `第 ${i + 1} 句`;
      slot.text.setText(text);
      slot.text.setColor(filled ? S.ink : S.mute);
    });
    // 还没填的格子继续显示序号
    if (state.order.length >= total) {
      state.slotTexts.forEach((slot, i) => {
        if (i >= state.order.length) slot.text.setText(`第 ${i + 1} 句`);
      });
    }
  }

  _placeLine(chipIndex) {
    if (!this._canAct()) return;
    const state = this.levelState;
    const button = state.chipButtons[chipIndex];
    if (!button || button.isDisabled) return;
    if (state.order.includes(chipIndex)) return;

    state.order.push(chipIndex);
    button.setVisible(false);
    button.setDisabled(true);
    this._renderOrderSlots();

    if (state.order.length === this.level.blocks.length) {
      this.busy = true;
      this._refreshPlayingButtons();
      this.time.delayedCall(240, () => this._checkOrder());
    } else {
      this._setFeedback('排好的句子会落到下面的格子里；点格子还能取回来。', 'normal');
    }
  }

  _removeFromOrder(slotIndex) {
    if (!this._canAct()) return;
    const state = this.levelState;
    if (slotIndex < 0 || slotIndex >= state.order.length) return;
    const chipIndex = state.order.splice(slotIndex, 1)[0];
    const button = state.chipButtons[chipIndex];
    if (button) {
      button.setVisible(true);
      button.setDisabled(false);
      button.setVariant('secondary');
    }
    this._renderOrderSlots();
    this._setFeedback('换一句试试，注意诗句谁在前、谁在后。', 'normal');
  }

  _checkOrder() {
    const state = this.levelState;
    if (!state || state.solved) return;
    const chosen = state.order.map((index) => this.level.shuffled[index]);
    const correct = chosen.join('|') === this.level.blocks.join('|');
    if (correct) {
      this._onLevelSolved();
      return;
    }
    this.busy = false;
    this._registerWrong('顺序还没对，再比一比前后。');
    this.busy = true;
    this._refreshPlayingButtons();
    this.time.delayedCall(360, () => {
      if (!this.levelState || this.levelState.solved) return;
      this._resetOrder();
      this.busy = false;
      this._refreshPlayingButtons();
    });
  }

  _resetOrder() {
    const state = this.levelState;
    state.order = [];
    state.chipButtons.forEach((button) => {
      if (!button) return;
      button.setVisible(true);
      button.setDisabled(false);
      button.setVariant('secondary');
    });
    this._renderOrderSlots();
  }

  // ---------------------------------------------------------
  // 玩法三：诗意匹配（诗句 + 四条文意）
  // ---------------------------------------------------------
  _buildMeaningLevel() {
    const level = this.level;
    const question = level.question;

    this._track(makeText(this, 640, 290, `「${question.line}」`, {
      size: 30,
      color: S.ink,
      wrap: 1000,
    }).setDepth(906));
    if (this.gentle) {
      this._track(makeText(this, 640, 328, `—— 《${level.title}》· ${level.author}`, {
        size: 15,
        color: S.inkSoft,
      }).setDepth(906));
    }

    this._createFeedback(640, 570, FEEDBACK.wrap);

    question.options.forEach((option, index) => {
      const button = createButton(this, {
        x: MEANING_OPTIONS.xs[index % 2],
        y: MEANING_OPTIONS.ys[Math.floor(index / 2)],
        width: MEANING_OPTIONS.width,
        height: MEANING_OPTIONS.height,
        radius: 22,
        label: option.text,
        variant: 'secondary',
        fontSize: 18,
        depth: 940,
        onClick: () => this._onMeaningPick(index),
      });
      this._track(button);
      this.optionButtons.push(button);
    });
  }

  // ---------------------------------------------------------
  // 玩法四：诗句接龙（书童上半句 + 四句下句）
  // ---------------------------------------------------------
  _buildChainLevel() {
    const level = this.level;

    const bubble = this.add.graphics().setDepth(904);
    bubble.fillStyle(C.paperDeep, 0.5);
    roundedRectPath(bubble, 118, 246, 1044, 100, 22);
    bubble.fillPath();
    bubble.fillStyle(C.paperSoft, 1);
    roundedRectPath(bubble, 114, 242, 1044, 100, 22);
    bubble.fillPath();
    bubble.lineStyle(1.6, C.pine, 0.35);
    roundedRectPath(bubble, 114, 242, 1044, 100, 22);
    bubble.strokePath();
    bubble.fillStyle(C.pineLight, 1);
    bubble.fillCircle(158, 292, 26);
    bubble.lineStyle(1.4, C.pine, 0.5);
    bubble.strokeCircle(158, 292, 26);
    this._track(bubble);

    this._track(makeText(this, 158, 292, '童', {
      size: 22,
      color: S.pineDeep,
    }).setDepth(906));
    this._track(makeText(this, 196, 268, '小书童 · 阿砚　念上半句', {
      size: 14,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(906));
    this._track(makeText(this, 640, 312, `「${level.prompt}」`, {
      size: 28,
      color: S.ink,
      wrap: 900,
    }).setDepth(906));

    this._createFeedback(640, 570, FEEDBACK.wrap);

    level.options.forEach((option, index) => {
      const button = createButton(this, {
        x: CHAIN_OPTIONS.xs[index % 2],
        y: CHAIN_OPTIONS.ys[Math.floor(index / 2)],
        width: CHAIN_OPTIONS.width,
        height: CHAIN_OPTIONS.height,
        radius: 22,
        label: option.text,
        variant: 'secondary',
        fontSize: 22,
        depth: 940,
        onClick: () => this._onChainPick(index),
      });
      this._track(button);
      this.optionButtons.push(button);
    });
  }

  // ---------------------------------------------------------
  // 作答
  // ---------------------------------------------------------
  _onGuessPick(index) {
    if (!this._canAct()) return;
    const option = this.level.options[index];
    if (!option) return;
    if (this.levelState.eliminated.has(index)) return;
    const button = this.optionButtons[index];

    if (option.correct) {
      if (button) button.setVariant('correct');
      this._onLevelSolved();
      return;
    }
    if (button) {
      button.setVariant('muted');
      button.setDisabled(true);
    }
    this.levelState.eliminated.add(index);
    this._registerWrong(
      this.gentle ? '还不是这一首，看看画里最醒目的东西。' : '再想一想：这幅画写的是哪一首？',
    );
  }

  _onMeaningPick(index) {
    if (!this._canAct()) return;
    const option = this.level.question.options[index];
    if (!option) return;
    if (this.levelState.eliminated.has(index)) return;
    const button = this.optionButtons[index];

    if (option.correct) {
      if (button) button.setVariant('correct');
      this._onLevelSolved();
      return;
    }
    if (button) {
      button.setVariant('muted');
      button.setDisabled(true);
    }
    this.levelState.eliminated.add(index);
    this._registerWrong(
      this.gentle ? '这个意思还不太贴，换一条读读看。' : '再想想：这句诗在说什么？',
    );
  }

  _onChainPick(index) {
    if (!this._canAct()) return;
    const option = this.level.options[index];
    if (!option) return;
    if (this.levelState.eliminated.has(index)) return;
    const button = this.optionButtons[index];

    if (option.correct) {
      if (button) button.setVariant('correct');
      this._onLevelSolved();
      return;
    }
    if (button) {
      button.setVariant('muted');
      button.setDisabled(true);
    }
    this.levelState.eliminated.add(index);
    this._registerWrong(
      this.gentle ? '这一句接不上呢，读一读哪句最顺口。' : '再想想：哪一句能和上半句接上？',
    );
  }

  _registerWrong(message) {
    const state = this.levelState;
    if (!state) return;
    state.attempts += 1;
    this.retryCount += 1;
    audio.playWrong();
    if (!state.wrongRecorded) {
      progress.addWrongRecord(this.level.poemId);
      state.wrongRecorded = true;
    }
    this._setFeedback(`${message}${this.gentle ? '　小诗童说：不着急。' : ''}`, 'warn');
    this._refreshHud();
  }

  _onLevelSolved() {
    const state = this.levelState;
    if (!state || state.solved) return;
    state.solved = true;
    this.busy = true;
    this.solvedLevels += 1;

    const perfect = state.attempts === 0 && !state.hintUsed;
    if (perfect) this.perfectCount += 1;
    this.passed[this.levelIndex] = true;
    this.summary.push({
      index: this.levelIndex + 1,
      typeName: this.level.typeName,
      typeKey: this.level.typeKey,
      title: this.level.title,
      poemId: this.level.poemId,
      perfect,
      attempts: state.attempts,
      hintUsed: state.hintUsed,
    });

    audio.playCorrect();
    this._disableAllOptions();
    this._setFeedback(
      perfect
        ? `答对啦！《${this.level.title}》一遍就对，接着闯。`
        : `答对啦！《${this.level.title}》继续下一关。`,
      'correct',
    );
    this._refreshHud();

    this.time.delayedCall(NEXT_DELAY, () => {
      if (this.levelIndex + 1 >= this.levels.length) {
        this._finishRun();
        return;
      }
      this.levelIndex += 1;
      this._startLevel();
    });
  }

  _disableAllOptions() {
    this.optionButtons.forEach((button) => button && button.setDisabled(true));
    if (this.levelState && this.levelState.chipButtons) {
      this.levelState.chipButtons.forEach((button) => button && button.setDisabled(true));
    }
    if (this.levelState && this.levelState.slotZones) {
      this.levelState.slotZones.forEach((zone) => zone && zone.disableInteractive());
    }
  }

  // ---------------------------------------------------------
  // 毛笔提示（五关共用一个池子）
  // ---------------------------------------------------------
  _onHint() {
    if (!this._canAct()) return;
    const state = this.levelState;
    if (!state || state.solved) return;

    if (this._hintPoolLeft() <= 0) {
      this.showToast('提示用完了。答完这一关就进下一关，先自己想一想。', { y: 620 });
      return;
    }

    let free = false;
    if (this.freeHintLeft > 0) {
      this.freeHintLeft -= 1;
      this.freeHintsUsed += 1;
      free = true;
    } else if (progress.consumeBrush()) {
      this.brushHints += 1;
    } else {
      this.showToast('毛笔不够啦，提示池已经见底。', { y: 620 });
      return;
    }

    this.hintsUsed += 1;
    state.hintUsed = true;
    audio.playPage();

    if (this.level.typeKey === 'guess') {
      this._eliminateOption();
      this._setFeedback(`小贴士：${clampText(this.level.tip, 42)}`, 'hint');
    } else if (this.level.typeKey === 'meaning') {
      this._eliminateOption();
      this._setFeedback('提示：已经帮你划掉一个不对的意思。', 'hint');
    } else if (this.level.typeKey === 'chain') {
      this._eliminateOption();
      const first = chainFirstChar(this.level.answer);
      this._setFeedback(`提示：下句从「${first}」起头。`, 'hint');
    } else {
      const need = this.level.blocks[state.order.length];
      const chipIndex = this.level.shuffled.findIndex(
        (line, index) => line === need && !state.order.includes(index),
      );
      if (chipIndex >= 0 && state.chipButtons[chipIndex]) {
        state.chipButtons[chipIndex].setVariant('gold');
      }
      this._setFeedback(`提示：第 ${state.order.length + 1} 句是「${need}」`, 'hint');
    }

    this._refreshHud();
    if (!free) this.showToast('用掉一支毛笔，提示池少一格。', { y: 620, duration: 1400 });
  }

  /** 划掉一个还活着的错误选项（不会划到正确答案） */
  _eliminateOption() {
    const options = trialOptionsOf(this.level);
    const state = this.levelState;
    for (let i = 0; i < options.length; i += 1) {
      if (options[i].correct) continue;
      if (state.eliminated.has(i)) continue;
      const button = this.optionButtons[i];
      if (!button) continue;
      state.eliminated.add(i);
      button.setVariant('muted');
      button.setDisabled(true);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------
  // 结束与结算
  // ---------------------------------------------------------
  _onGiveUp() {
    if (this.phase !== 'playing') return;
    if (this._modalOpen) return;
    this._modalOpen = true;
    this.showModal({
      title: '要放弃这一局吗？',
      sealText: '止',
      message: `已经答对 ${this.solvedLevels} / ${this.levels.length} 关。\n放弃后这一局不会得到文房藏品碎片。`,
      actions: [
        { label: '再试试', variant: 'secondary' },
        {
          label: '放弃这局',
          variant: 'danger',
          onClick: () => this._finishRun({ abandoned: true }),
        },
      ],
      onClose: () => {
        this._modalOpen = false;
      },
    });
  }

  _finishRun({ abandoned = false } = {}) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.busy = true;
    this._modalOpen = false;
    this._clearLevel();
    if (this.hintButton) this.hintButton.setVisible(false);
    if (this.giveUpButton) this.giveUpButton.setVisible(false);

    const completed = !abandoned && this.solvedLevels >= this.levels.length;
    const perfectRun = completed && this.perfectCount >= this.levels.length;
    const gain = completed ? (perfectRun ? 2 : 1) : 0;
    const totalFragments = gain > 0 ? progress.addTrialFragments(gain) : progress.getTrialFragments();

    this.result = {
      completed,
      perfectRun,
      abandoned,
      solved: this.solvedLevels,
      total: this.levels.length,
      perfect: this.perfectCount,
      retries: this.retryCount,
      hints: this.hintsUsed,
      brushHints: this.brushHints,
      freeHints: this.freeHintsUsed,
      gain,
      totalFragments,
      rangeKey: this.rangeKey,
      rangeName: getTrialRange(this.rangeKey).name,
      levels: this.summary.slice(),
    };

    if (completed) audio.playUnlock();
    else audio.playWrong();
    this._refreshHud();
    console.info('[试炼房] 结算：', this.result);
    this.time.delayedCall(RESULT_DELAY, () => this._showResult());
  }

  _showResult() {
    if (this._resultShown) return;
    this._resultShown = true;
    const result = this.result;

    this.add
      .rectangle(640, 360, 1280, 720, 0x33423b, 0.42)
      .setDepth(2998)
      .setInteractive();

    createPaperPanel(this, {
      x: RESULT_PANEL.x,
      y: RESULT_PANEL.y,
      width: RESULT_PANEL.width,
      height: RESULT_PANEL.height,
      depth: 3000,
    });

    const sealText = result.perfectRun ? '满' : result.completed ? '成' : '止';
    addSeal(this, 232, 110, sealText, 74, result.completed ? C.peachDeep : C.pine).setDepth(3002);

    makeText(this, 640, 152, result.completed
      ? (result.perfectRun ? '五关全胜 · 满堂彩' : '五关闯过 · 试炼完成')
      : '这局先到这儿', {
      size: 34,
      color: S.ink,
    }).setDepth(3002);

    makeText(this, 640, 196, result.completed
      ? '答错可以重试，能一口气走完五关就很了不起。'
      : '已经答对的关卡不会换成诗卡与碎片，下次再来。', {
      size: 16,
      color: S.inkSoft,
      wrap: 860,
    }).setDepth(3002);

    makeText(this, 640, 242, `答对 ${result.solved} / ${result.total} 关`, {
      size: 32,
      color: S.gold,
    }).setDepth(3002);

    makeText(
      this,
      640,
      284,
      `一次答对 ${result.perfect} 关 · 答错重试 ${result.retries} 次 · 用掉提示 ${result.hints} 次（毛笔 ${result.brushHints} · 免费 ${result.freeHints}）`,
      { size: 17, color: S.inkSoft },
    ).setDepth(3002);

    makeText(this, 640, 320, `文房藏品碎片 +${result.gain}　·　现共 ${result.totalFragments} 片`, {
      size: 19,
      color: S.gold,
    }).setDepth(3002);

    makeText(
      this,
      640,
      348,
      '走完五关 +1 片，五关全部一次答对再 +1 片；碎片可在图鉴兑换文房藏品（后续开放）。',
      { size: 14, color: S.inkFaint, wrap: 880 },
    ).setDepth(3002);

    makeText(this, 640, 382, '五关回顾', {
      size: 15,
      color: S.inkSoft,
    }).setDepth(3002);

    const scroll = new ScrollPanel(this, {
      x: RESULT_REVIEW.x,
      y: RESULT_REVIEW.y,
      width: RESULT_REVIEW.width,
      height: RESULT_REVIEW.height,
      radius: 16,
      depth: 3003,
    });
    let cursor = 4;
    result.levels.forEach((entry) => {
      const line = makeText(
        this,
        14,
        cursor,
        `${entry.index}. ${entry.typeName} ·《${entry.title}》　${entry.perfect ? '一次答对' : '重试过'}${entry.hintUsed ? ' · 用过提示' : ''}`,
        { size: 16, color: entry.perfect ? S.pineDeep : S.inkSoft, origin: [0, 0], align: 'left', wrap: 760 },
      );
      scroll.add(line);
      cursor += 30;
    });
    scroll.layout(cursor + 6);
    scroll.scrollToTop();

    const again = createButton(this, {
      x: 430,
      y: 596,
      width: 340,
      height: 58,
      radius: 22,
      label: '再来一局',
      subLabel: '重新抽五关',
      variant: 'gold',
      fontSize: 22,
      subFontSize: 13,
      depth: 3004,
      onClick: () => this.scene.restart({
        range: this.rangeKey,
        returnScene: this.returnScene,
        chapterId: this.chapterId,
      }),
    });

    const toMap = createButton(this, {
      x: 850,
      y: 596,
      width: 320,
      height: 58,
      radius: 22,
      label: '返回地图',
      variant: 'primary',
      fontSize: 22,
      depth: 3004,
      onClick: () => this._leaveToMap(),
    });

    makeText(this, 640, 646, '试炼房不会点亮诗卡，只把碎片收进书箧。', {
      size: 13,
      color: S.inkFaint,
    }).setDepth(3002);

    // 结算按钮保持引用，便于调试与验收
    this.resultButtons = { again, toMap };

    // 支线奖励：五关通关发一件典藏藏品（只发一次，见 collectionRewards.js）
    if (result.completed) {
      grantTrialCollection(this, { delay: 1300 });
    }
  }

  // ---------------------------------------------------------
  // 返回 / 切换模式
  // ---------------------------------------------------------
  _requestLeave() {
    if (this._leaving) return;
    if (this.phase === 'lobby' || this._resultShown) {
      this._leaveToMap();
      return;
    }
    if (this.phase === 'over' || this._modalOpen) return;

    this._modalOpen = true;
    this.showModal({
      title: '先离开试炼房吗？',
      sealText: '离',
      message: '这一局已经答对的关卡和碎片都不会留下，\n下次可以从头再抽五关。',
      actions: [
        { label: '继续闯关', variant: 'secondary' },
        { label: '先离开', variant: 'primary', onClick: () => this._leaveToMap() },
      ],
      onClose: () => {
        this._modalOpen = false;
      },
    });
  }

  _onSwitchMode() {
    if (this._modalOpen) return;
    if (this.phase === 'playing') {
      this.showToast('对局中先不换模式，等这一局结束吧。', { y: 620 });
      return;
    }
    const next = this.gentle ? 'challenge' : 'gentle';
    this._modalOpen = true;
    this.showModal({
      title: this.gentle ? '切到挑战模式？' : '切到温和模式？',
      sealText: '境',
      message: this.gentle
        ? '挑战模式不标作者朝代，答错时不再给温柔提示。\n切换后会回前厅重新抽题。'
        : '温和模式会标出作者朝代，并有 2 次免费提示。\n切换后会回前厅重新抽题。',
      actions: [
        { label: '保持现在', variant: 'secondary' },
        {
          label: '切换并重来',
          variant: 'primary',
          onClick: () => {
            progress.setDifficulty(next);
            this.scene.restart({
              range: this.rangeKey,
              returnScene: this.returnScene,
              chapterId: this.chapterId,
            });
          },
        },
      ],
      onClose: () => {
        this._modalOpen = false;
      },
    });
  }

  _leaveToMap() {
    if (this._leaving) return;
    this._leaving = true;

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

    this.scene.start(SCENES.MAP, { chapterId: this.chapterId });
  }
}
