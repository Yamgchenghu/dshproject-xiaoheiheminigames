/**
 * PoemChainScene：诗句接龙（接下句）玩法（独立场景）
 * ------------------------------------------------------------
 * 玩法：
 *  1. 把 poem_db.json 里的 full_text 按「，。；！？」切成一句一句，
 *     相邻两句组成一轮接龙：NPC（小书童 / 诗人）念出上半句，
 *     玩家从 4 个大按钮里挑出正确的下句；
 *  2. 一首诗取 2~4 轮，按诗句顺序连续接下去；一轮答错只把那条选项收走，
 *     可以继续重试，直到接对为止；
 *  3. 毛笔提示：直接把下句的第一个字告诉你；温和模式自带 2 次免费首字提示；
 *  4. 全部接对通关，走与「看图猜诗」完全一致的结算：progress.markPoemComplete
 *     （诗卡 / 星级 / 错题清除 / 轶事 / 藏品 / 章节解锁）；
 *     每次答错都会 progress.addWrongRecord，通关后由结算统一清除；
 *  5. 星级只看提示消耗：没用毛笔 3 星、用 1 次 2 星、用 2 次及以上 1 星；
 *     温和模式的免费首字提示不消耗毛笔、也不扣星；
 *  6. 国风对话气泡 + 宽大选项按钮，适合小学生手指点触。
 *
 * 复用：
 *  - BaseScene（背景、头部、吐司、弹窗、转场）
 *  - ProgressManager / AudioManager
 *  - ui/components（按钮、纸卡、标签、星星、弹窗）、ui/background、ui/ScrollPanel
 *
 * 入口：
 *  - { poemId, returnScene? }；开发预览：路径加 `?chain=1`（见 main.js）
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
} from '../ui/components.js';
import { addSeal, roundedRectPath } from '../ui/background.js';
import { ScrollPanel } from '../ui/ScrollPanel.js';

// ---------------------------------------------------------
// 布局常量（1280 × 720 设计分辨率）
// ---------------------------------------------------------
const STAGE = { x: 640, y: 292, width: 1180, height: 236 }; // 对话纸卡（中心点）
const BUBBLE = { x: 214, top: 206, width: 966, height: 176 }; // 对话气泡（左上角）
const NPC = { x: 136, y: 292, radius: 46 }; // NPC 头像
const HINT_LINE_Y = BUBBLE.top + 158;
const OPTION = { width: 520, height: 84, xs: [350, 930], ys: [474, 570] };

const GENTLE_FREE_HINTS = 2; // 温和模式提示次数 +2
const MIN_ROUNDS = 2;
const MAX_ROUNDS = 4;
const OPTION_COUNT = 4;
const MIN_CHAIN_CHARS = 3; // 短于此长度的碎句并入上一句（「鹅，」这类）
const LENGTH_TOLERANCE = 3; // 干扰项优先挑字数相近的
const ROUND_DELAY = 880;

const PUNCT = '，,、；;：:。！？!?…·';
const TRIM_MARKS = /[“”"'‘’「」『』（）()【】〈〉《》\s]/g;

/** NPC 台词库（书童 / 诗人共用，随机挑一句，避免每轮都一样） */
const DIALOGUE = {
  intro: [
    '我先起一句，你来接下一句。',
    '听好上半句 —— 下句该接什么？',
    '来，我们对一对诗：',
    '这一句的下半句，你可记得？',
  ],
  praise: [
    '接得顺！正是这一句。',
    '好句子，跟你对诗真开心。',
    '一个字都没错，继续往下接。',
    '对上了，音韵也合。',
  ],
  wrong: [
    '这一句接不上呢，再想想。',
    '嗯……读着不太顺，换一条试试。',
    '别急，看看哪一句的韵脚能接上。',
  ],
  finish: [
    '整首诗都接完啦，诗卡收进你的图鉴。',
    '全对上了！这首诗你记得很牢。',
  ],
  hintFree: ['悄悄告诉你：下句的头一个字是「{char}」。', '温和提示：下句从「{char}」开始。'],
  hintBrush: ['借你毛笔一用：下句的头一个字是「{char}」。', '笔尖点一下 —— 下句第一个字是「{char}」。'],
};

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

// ---------------------------------------------------------
// 文本工具（纯函数，便于复用到其它玩法与自动化验收）
// ---------------------------------------------------------
function splitKeepPunctuation(text, enders) {
  const raw = [];
  let buffer = '';
  for (const char of String(text || '')) {
    buffer += char;
    if (enders.includes(char)) {
      raw.push(buffer);
      buffer = '';
    }
  }
  if (buffer.trim()) raw.push(buffer);
  return raw.map((segment) => segment.trim()).filter(Boolean);
}

/** 去掉引号 / 括号 / 空白，保留句读标点，用于展示 */
function stripMarks(text) {
  return String(text || '').replace(TRIM_MARKS, '').replace(/\s+/g, '').trim();
}

/** 只留汉字，用于比较与长度判断 */
function bareText(text) {
  return stripMarks(text).replace(new RegExp(`[${PUNCT}]`, 'g'), '');
}

/** 取一句的第一个汉字（毛笔提示用） */
export function chainFirstChar(text) {
  const match = stripMarks(text).match(/[\u4e00-\u9fa5]/);
  return match ? match[0] : '';
}

/**
 * 把 full_text 拆成「接龙单元」：按句读切开，并把过短的碎句（如「鹅，」）
 * 并入上一句，避免出现只有一两个字的选项。
 * @param {string} fullText
 * @returns {string[]} 带标点的句子
 */
export function splitChainLines(fullText) {
  const text = String(fullText || '').replace(/\r?\n/g, '');
  if (!text.trim()) return [];

  const segments = splitKeepPunctuation(text, PUNCT);
  const merged = [];
  segments.forEach((segment) => {
    if (merged.length > 0 && bareText(segment).length < MIN_CHAIN_CHARS) {
      merged[merged.length - 1] += segment;
      return;
    }
    merged.push(segment);
  });

  return merged
    .map((segment) => stripMarks(segment))
    .filter((segment) => bareText(segment).length >= 2);
}

/** 兜底：整首诗只有一句时，从中间的停顿处一分为二 */
function splitIntoHalf(text) {
  const body = stripMarks(text).replace(/[。！？]$/, '');
  if (body.length < 4) return null;
  const pauses = [];
  for (let i = 0; i < body.length; i += 1) {
    if ('，、；：'.includes(body[i])) pauses.push(i);
  }
  const middle = body.length / 2;
  const cut = pauses.length > 0
    ? pauses.reduce((best, position) => (
      Math.abs(position - middle) < Math.abs(best - middle) ? position : best
    ), pauses[0])
    : Math.floor(body.length / 2);
  if (cut < 1 || cut >= body.length - 1) return null;
  return [`${body.slice(0, cut + 1)}`, `${body.slice(cut + 1)}。`];
}

/**
 * 规划一首诗的接龙轮次：相邻两句一轮，取 2~4 轮（按诗句顺序连续接）。
 * @param {string} fullText
 * @param {number} maxRounds
 * @returns {Array<{ index: number, prompt: string, answer: string }>}
 */
export function buildChainRounds(fullText, maxRounds = MAX_ROUNDS) {
  const lines = splitChainLines(fullText);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 1) {
    pairs.push({ index: i, prompt: lines[i], answer: lines[i + 1] });
  }

  const limit = Phaser.Math.Clamp(Number(maxRounds) || MAX_ROUNDS, MIN_ROUNDS, MAX_ROUNDS);
  if (pairs.length >= MIN_ROUNDS) return pairs.slice(0, Math.min(pairs.length, limit));

  const halves = splitIntoHalf(lines.join(''));
  if (halves) return [{ index: 0, prompt: halves[0], answer: halves[1] }];
  return pairs.slice(0, 1);
}

/**
 * 为某一轮生成 4 个选项：正确下句 + 3 条来自其它诗篇的句子。
 * 干扰项优先挑「字数接近」「首字不同」的句子，看起来才像同一体例的下句。
 * @param {object} poem 当前诗
 * @param {{ prompt: string, answer: string }} round
 * @param {number} optionCount
 */
export function buildChainOptions(poem, round, optionCount = OPTION_COUNT) {
  if (!poem || !round) return [];
  const correct = String(round.answer || '');
  const correctBare = bareText(correct);
  if (!correctBare) return [];

  const promptBare = bareText(round.prompt);
  const seen = new Set([correctBare, promptBare]);
  const others = dataManager
    .getAllPoems()
    .filter((item) => item.id !== poem.id && !item.is_hidden);

  const pool = [];
  others.forEach((item) => {
    splitChainLines(item.full_text).forEach((line) => {
      const bare = bareText(line);
      if (!bare || seen.has(bare)) return;
      seen.add(bare);
      pool.push({ text: line, length: bare.length, source: item.title });
    });
  });

  // 兜底：其它诗篇凑不满时，用本诗别的句子（只作为干扰项）
  const local = [];
  splitChainLines(poem.full_text).forEach((line) => {
    const bare = bareText(line);
    if (!bare || seen.has(bare)) return;
    seen.add(bare);
    local.push({ text: line, length: bare.length, source: poem.title });
  });

  const first = chainFirstChar(correct);
  const correctLength = correctBare.length;
  const tiers = [
    pool.filter((item) => Math.abs(item.length - correctLength) <= LENGTH_TOLERANCE
      && chainFirstChar(item.text) !== first),
    pool.filter((item) => Math.abs(item.length - correctLength) <= LENGTH_TOLERANCE),
    pool.filter((item) => Math.abs(item.length - correctLength) > LENGTH_TOLERANCE),
    local,
  ];

  const picked = [];
  const fillFrom = (list) => {
    shuffle(list).forEach((item) => {
      if (picked.length >= optionCount - 1) return;
      if (picked.some((chosen) => bareText(chosen.text) === bareText(item.text))) return;
      picked.push(item);
    });
  };
  tiers.forEach((tier) => {
    if (picked.length < optionCount - 1) fillFrom(tier);
  });
  if (picked.length < optionCount - 1) return [];

  return shuffle([
    { text: correct, correct: true },
    ...picked.map((item) => ({ text: item.text, correct: false, source: item.source })),
  ]);
}

// ---------------------------------------------------------
// 场景
// ---------------------------------------------------------
export default class PoemChainScene extends BaseScene {
  constructor() {
    super(SCENES.POEM_CHAIN);
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
    this._roundSolved = false;
    this._navigating = false;
    this.busy = false;

    this.rounds = [];
    this.roundIndex = 0;
    this.round = null;
    this.optionButtons = [];
    this.eliminated = new Set();

    this.mistakes = 0;
    this.brushHints = 0;
    this.freeHintsUsed = 0;
    this.brushHintUsed = false;
    this.freeHintLeft = 0;
    this.hintShown = false;
    this.speaker = 'boy';
    this.result = null;
  }

  create() {
    this.prepareScene();
    this.addBackground('garden', { petals: true });
    this.addGrain(0.1);
    audio.playBgm('level');

    const poem = dataManager.getPoemById(this.poemId) || dataManager.getAllPoems()[0];
    if (!poem) {
      this.showToast('诗卷里还没有数据，先回主菜单看看吧。', { y: 360 });
      this.time.delayedCall(900, () => this.goTo(SCENES.MENU));
      return;
    }
    this.poem = poem;
    this.poemId = poem.id;
    this.difficulty = getDifficultyConfig(progress.getDifficulty());
    // 温和模式提示次数 +2（免费首字提示，不消耗毛笔、不扣星）
    this.freeHintLeft = this.difficulty.gentleNudge ? GENTLE_FREE_HINTS : 0;

    this.rounds = buildChainRounds(poem.full_text, MAX_ROUNDS);
    if (this.rounds.length === 0) {
      this.showModal({
        title: '这首诗还接不起来',
        sealText: '短',
        message: '这一篇暂时拆不出上下句，先去读别的诗吧。',
        actions: [{ label: '返回地图', variant: 'primary', onClick: () => this._leaveToMap() }],
      });
      return;
    }

    this.addHeader({
      title: '诗句接龙',
      subtitle: `${getChapterName(poem.chapter)} / ${poem.area} · 听上半句，从四句里挑出正确的下句`,
      onBack: () => this._requestLeave(),
      backLabel: '返回',
    });

    this._buildPoemBar();
    this._buildStage();
    this._buildOptionLabel();
    this._buildBottomBar();
    this._startRound(0);
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
  // 对话舞台：纸卡 + NPC 头像 + 气泡
  // ---------------------------------------------------------
  _buildStage() {
    createPaperPanel(this, {
      x: STAGE.x,
      y: STAGE.y,
      width: STAGE.width,
      height: STAGE.height,
      radius: 30,
      fill: C.paperSoft,
      fillAlpha: 0.96,
      depth: 10,
    });

    const g = this.add.graphics().setDepth(900).setScrollFactor(0);

    // 气泡本体（淡淡的影子 + 纸面 + 金线 + 内侧高光）
    g.fillStyle(0x6f6050, 0.08);
    roundedRectPath(g, BUBBLE.x + 2, BUBBLE.top + 6, BUBBLE.width, BUBBLE.height, 26);
    g.fillPath();
    g.fillStyle(C.paper, 0.98);
    roundedRectPath(g, BUBBLE.x, BUBBLE.top, BUBBLE.width, BUBBLE.height, 26);
    g.fillPath();
    g.lineStyle(1.6, C.gold, 0.45);
    roundedRectPath(g, BUBBLE.x, BUBBLE.top, BUBBLE.width, BUBBLE.height, 26);
    g.strokePath();
    g.lineStyle(1, 0xffffff, 0.5);
    roundedRectPath(g, BUBBLE.x + 6, BUBBLE.top + 6, BUBBLE.width - 12, BUBBLE.height - 12, 20);
    g.strokePath();

    // 气泡小尾巴，指向左边的 NPC
    g.fillStyle(C.paper, 0.98);
    g.fillTriangle(
      BUBBLE.x - 18,
      BUBBLE.top + 96,
      BUBBLE.x + 2,
      BUBBLE.top + 74,
      BUBBLE.x + 2,
      BUBBLE.top + 118,
    );

    // NPC 头像：圆形纸片 + 楷体字
    g.fillStyle(C.paper, 1);
    g.fillCircle(NPC.x, NPC.y, NPC.radius);
    g.lineStyle(2, C.gold, 0.6);
    g.strokeCircle(NPC.x, NPC.y, NPC.radius);
    g.lineStyle(1, 0xffffff, 0.8);
    g.strokeCircle(NPC.x, NPC.y, NPC.radius - 5);

    this.npcCharText = makeText(this, NPC.x, NPC.y, '童', {
      size: 38,
      color: S.pineDeep,
    }).setDepth(901);

    this.nameText = makeText(this, BUBBLE.x + 26, BUBBLE.top + 30, '小书童 · 阿砚', {
      size: 16,
      color: S.pineDeep,
      origin: [0, 0.5],
    }).setDepth(901);

    this.introText = makeText(this, BUBBLE.x + 26, BUBBLE.top + 60, '', {
      size: 16,
      color: S.inkSoft,
      origin: [0, 0],
      wrap: 700,
      lineSpacing: 6,
    }).setDepth(901);

    this.promptText = makeText(this, BUBBLE.x + 26, BUBBLE.top + 112, '', {
      size: 32,
      color: S.ink,
      origin: [0, 0.5],
      wrap: 730,
      lineSpacing: 10,
    }).setDepth(901);

    this.hintText = makeText(this, BUBBLE.x + 26, HINT_LINE_Y, '', {
      size: 17,
      color: S.gold,
      origin: [0, 0.5],
      wrap: 730,
    }).setDepth(901);

    this.roundChip = createTag(this, 0, 0, '第 1 / 3 轮', {
      fill: C.pineLight,
      textColor: S.pineDeep,
      height: 30,
      fontSize: 14,
      depth: 902,
    });
    this._placeRoundChip();

    this._dotsG = this.add.graphics().setDepth(902).setScrollFactor(0);
  }

  _placeRoundChip() {
    if (!this.roundChip) return;
    const right = BUBBLE.x + BUBBLE.width - 22;
    this.roundChip.container.setPosition(right - this.roundChip.width / 2, BUBBLE.top + 30);
  }

  _refreshDots() {
    if (!this._dotsG) return;
    const g = this._dotsG;
    g.clear();
    const total = this.rounds.length;
    const right = BUBBLE.x + BUBBLE.width - 22 - this.roundChip.width - 18;
    for (let i = 0; i < total; i += 1) {
      const x = right - (total - 1 - i) * 20;
      const y = BUBBLE.top + 30;
      const solved = i < this.roundIndex || (i === this.roundIndex && this._roundSolved);
      const current = i === this.roundIndex && !this._roundSolved;
      g.fillStyle(solved ? C.pine : current ? C.goldLight : C.paperDeep, solved || current ? 1 : 0.9);
      g.fillCircle(x, y, 6);
      g.lineStyle(1.4, solved ? C.pineDeep : current ? C.gold : C.inkLine, 0.9);
      g.strokeCircle(x, y, 6);
    }
  }

  _buildOptionLabel() {
    // 放在对话纸卡内侧的下沿，和选项区留出空隙，避免压住纸卡边框
    makeText(this, 88, 396, '选一句接下去 ——', {
      size: 15,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(1005);

    makeText(this, 1192, 396, '一轮可以重试，答错会记进错题书斋', {
      size: 14,
      color: S.inkFaint,
      origin: [1, 0.5],
    }).setDepth(1005);
  }

  // ---------------------------------------------------------
  // 底部：返回 / 提示 / 状态
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

    this._hintBtn = createButton(this, {
      x: 390,
      y: 676,
      width: 260,
      height: 58,
      radius: 22,
      label: '毛笔提示 · 首字',
      variant: 'gold',
      fontSize: 20,
      depth: 1050,
      onClick: () => this._onHint(),
    });

    this.statusText = makeText(this, 540, 676, '', {
      size: 15,
      color: S.inkSoft,
      origin: [0, 0.5],
      align: 'left',
      wrap: 660,
      lineSpacing: 6,
    }).setDepth(1050);
  }

  // ---------------------------------------------------------
  // 一轮接龙
  // ---------------------------------------------------------
  _startRound(index) {
    const round = this.rounds[index];
    if (!round) return;

    this.busy = true;
    this.roundIndex = index;
    this._roundSolved = false;
    this.hintShown = false;
    this.eliminated.clear();
    this._clearOptions();
    this._clearHintChip();

    const options = buildChainOptions(this.poem, round, OPTION_COUNT);
    if (options.length < OPTION_COUNT) {
      this.busy = false;
      this.showToast('这一轮凑不出 4 个选项，先回地图换一首吧。', { y: 320, tone: 'warn' });
      return;
    }

    this.round = { ...round, options };
    // 前两轮是小书童捧哏，后几轮换诗人本人来考你
    this._setSpeaker(index >= 2 ? 'poet' : 'boy');
    this._npcSay(pickOne(DIALOGUE.intro));
    this.promptText.setText(round.prompt);
    this.promptText.setColor(S.ink);
    this.promptText.setFontSize(32);
    this.roundChip.setLabel(`第 ${index + 1} / ${this.rounds.length} 轮`);
    this._placeRoundChip();
    this._buildOptionButtons();
    this._refreshDots();
    this._refreshHud();

    this.time.delayedCall(360, () => {
      this.busy = false;
      this._refreshHud();
    });
  }

  _buildOptionButtons() {
    this.round.options.forEach((option, index) => {
      const button = createButton(this, {
        x: OPTION.xs[index % 2],
        y: OPTION.ys[Math.floor(index / 2)],
        width: OPTION.width,
        height: OPTION.height,
        radius: 24,
        label: option.text,
        variant: 'secondary',
        fontSize: option.text.length > 16 ? 19 : 22,
        depth: 940,
        onClick: () => this._choose(index),
      });
      button.container.setAlpha(0);
      this.tweens.add({
        targets: button.container,
        alpha: 1,
        duration: 220,
        delay: index * 60,
        ease: 'Sine.easeOut',
      });
      this.optionButtons.push(button);
    });
  }

  _clearOptions() {
    this.optionButtons.forEach((button) => button.destroy());
    this.optionButtons = [];
  }

  _setSpeaker(kind) {
    const isPoet = kind === 'poet';
    this.speaker = kind;
    this.npcCharText.setText(isPoet ? '诗' : '童');
    this.npcCharText.setColor(isPoet ? S.peach : S.pineDeep);
    this.nameText.setText(isPoet ? `${this.poem.author}` : '小书童 · 阿砚');
    this.nameText.setColor(isPoet ? S.peach : S.pineDeep);
  }

  _npcSay(text) {
    if (!this.introText || !text) return;
    this.introText.setText(text);
    this.tweens.killTweensOf(this.introText);
    this.introText.setAlpha(0);
    this.tweens.add({
      targets: this.introText,
      alpha: 1,
      duration: 240,
      ease: 'Sine.easeOut',
    });
  }

  // ---------------------------------------------------------
  // 作答
  // ---------------------------------------------------------
  _canAnswer() {
    return this.scene.isActive()
      && Boolean(this.round)
      && !this._solved
      && !this._resultShown
      && !this._leaving
      && !this._hintModalOpen
      && !this._roundSolved
      && !this.busy;
  }

  _choose(index) {
    if (!this._canAnswer()) return;
    const option = this.round.options[index];
    const button = this.optionButtons[index];
    if (!option || !button || this.eliminated.has(index)) return;

    if (option.correct) {
      this._onCorrect(button);
      return;
    }

    // 答错：收走这一条，记错题，但不公布答案，可以继续重试
    this.mistakes += 1;
    audio.playWrong();
    progress.addWrongRecord(this.poem.id);
    this.eliminated.add(index);
    button.setLabel(`✕ ${option.text}`);
    button.setVariant('muted');
    button.setDisabled(true);
    this._npcSay(pickOne(DIALOGUE.wrong));
    this._refreshHud();
    this.showToast('这一句接不上，再看看别的', { y: 320, tone: 'warn', duration: 1700 });
  }

  _onCorrect(button) {
    if (this._roundSolved || this._solved) return;
    this._roundSolved = true;
    this._clearHintChip();
    audio.playCorrect();
    button.setVariant('correct');

    const correctIndex = this.round.options.findIndex((option) => option.correct);
    this.optionButtons.forEach((btn, index) => {
      if (index !== correctIndex) btn.setDisabled(true);
    });

    // 把「上半句 + 下句」连起来展示，读完再进入下一轮
    this.promptText.setText(`${this.round.prompt}${this.round.answer}`);
    this.promptText.setColor(S.pineDeep);
    this.promptText.setFontSize(28);
    this._npcSay(pickOne(DIALOGUE.praise));
    this._refreshDots();
    this._refreshHud();

    this.time.delayedCall(ROUND_DELAY, () => {
      if (!this.scene.isActive() || this._solved || this._resultShown) return;
      if (this.roundIndex + 1 < this.rounds.length) {
        this._startRound(this.roundIndex + 1);
      } else {
        this._handleSolved();
      }
    });
  }

  // ---------------------------------------------------------
  // 提示：给出下句首字
  // ---------------------------------------------------------
  _onHint() {
    if (!this._canAnswer()) return;

    if (this.hintShown) {
      this.showToast('这一轮已经给过首字啦，顺着读一读，自己选一条。', { y: 320, duration: 1900 });
      return;
    }

    if (this.freeHintLeft > 0) {
      this._hintModalOpen = true;
      this.showModal({
        title: '用一次温和提示？',
        sealText: '温',
        message: `温和模式本次还有 ${this.freeHintLeft} 次免费提示。\n会告诉你下句的第一个字，不消耗毛笔，也不扣星星。`,
        actions: [
          { label: '先自己想想', variant: 'secondary' },
          {
            label: '告诉我首字',
            variant: 'primary',
            onClick: () => this._applyHint('free'),
          },
        ],
        onClose: () => {
          this._hintModalOpen = false;
          this._refreshHud();
        },
      });
      return;
    }

    if (progress.getBrushCount() <= 0) {
      this.showToast('毛笔用完啦，把这首诗接完会再得到一支。', { y: 320, tone: 'warn' });
      return;
    }

    this._hintModalOpen = true;
    this.showModal({
      title: '用一支毛笔看首字？',
      sealText: '笔',
      message: `毛笔还剩 ${progress.getBrushCount()} 支。\n用了之后会告诉你下句的第一个字，\n本关最多只能拿到 2 颗星。`,
      actions: [
        { label: '先自己想想', variant: 'secondary' },
        { label: '用一支毛笔', variant: 'primary', onClick: () => this._applyHint('brush') },
      ],
      onClose: () => {
        this._hintModalOpen = false;
        this._refreshHud();
      },
    });
  }

  /**
   * 落实首字提示。
   * @param {'free'|'brush'} source
   */
  _applyHint(source) {
    // 弹窗按钮回调执行时 _hintModalOpen 还是 true，这里不能用 _canAnswer()
    if (!this.round || this._solved || this._resultShown || this._roundSolved || this.hintShown) return;

    if (source === 'brush') {
      if (!progress.consumeBrush()) {
        this.showToast('毛笔不够啦。', { y: 320, tone: 'warn' });
        return;
      }
      this.brushHints += 1;
      this.brushHintUsed = true;
    } else {
      if (this.freeHintLeft <= 0) return;
      this.freeHintLeft -= 1;
      this.freeHintsUsed += 1;
    }

    const first = chainFirstChar(this.round.answer);
    this.hintShown = true;
    this._showHintChip(first);
    this._npcSay(
      pickOne(source === 'brush' ? DIALOGUE.hintBrush : DIALOGUE.hintFree).replace('{char}', first),
    );
    audio.playPage();
    this._refreshHud();
    this.showToast(`下句的第一个字是「${first}」`, { y: 320, duration: 1800 });
  }

  _showHintChip(first) {
    if (!this.hintText) return;
    this.hintText.setText(`提示：下句的第一个字是「${first}」—— 哪一句从这个字开始？`);
    this.tweens.killTweensOf(this.hintText);
    this.hintText.setAlpha(0);
    this.tweens.add({
      targets: this.hintText,
      alpha: 1,
      duration: 240,
      ease: 'Sine.easeOut',
    });
  }

  _clearHintChip() {
    if (!this.hintText) return;
    this.tweens.killTweensOf(this.hintText);
    this.hintText.setText('');
    this.hintText.setAlpha(1);
  }

  // ---------------------------------------------------------
  // 星级 / HUD
  // ---------------------------------------------------------
  /** 星级只看提示消耗：没用毛笔 3 星，用 1 次 2 星，用 2 次及以上 1 星 */
  _stars() {
    return Math.max(1, 3 - Math.min(2, this.brushHints));
  }

  _refreshHud() {
    if (this.brushText) this.brushText.setText(`毛笔 × ${progress.getBrushCount()}`);

    if (this._hintBtn) {
      const hasFree = this.freeHintLeft > 0;
      const hasBrush = progress.getBrushCount() > 0;
      this._hintBtn.setLabel(hasFree ? '毛笔提示 · 首字免费' : '毛笔提示 · 首字');
      // 一轮只给一次首字；给过之后按钮就收起来，避免重复消耗
      this._hintBtn.setDisabled(!this._canAnswer() || this.hintShown || (!hasFree && !hasBrush));
    }

    if (!this.statusText) return;
    const stars = this._stars();
    const solvedCount = this.roundIndex + (this._roundSolved ? 1 : 0);
    const line1 = `第 ${Math.min(this.roundIndex + 1, this.rounds.length)} / ${this.rounds.length} 轮`
      + `　·　已接 ${solvedCount} 句　·　答错 ${this.mistakes} 次`;
    const line2 = `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`
      + `　·　毛笔 × ${progress.getBrushCount()}　·　温和首字 × ${this.freeHintLeft}`;
    this.statusText.setText(`${line1}\n${line2}`);
  }

  // ---------------------------------------------------------
  // 结算（与现有玩法同一套）
  // ---------------------------------------------------------
  _handleSolved() {
    if (this._resultShown || this._solved) return;
    this._solved = true;
    const stars = this._stars();
    this.result = progress.markPoemComplete(this.poemId, stars);
    console.info('[诗句接龙] 结算：', {
      poem: this.poem.title,
      rounds: this.rounds.length,
      mistakes: this.mistakes,
      brushHints: this.brushHints,
      freeHintsUsed: this.freeHintsUsed,
      stars,
      result: this.result,
    });

    if (!this.result) {
      this.showToast('结算时没有找到这首诗，请回到地图重试。', { y: 320, tone: 'warn' });
      return;
    }

    this._npcSay(pickOne(DIALOGUE.finish));
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
    this._clearOptions();
    this._refreshHud();

    const root = this.add.container(0, 0).setDepth(3000).setScrollFactor(0);
    root.add(
      this.add
        .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x2e3a34, 0.5)
        .setOrigin(0)
        .setScrollFactor(0)
        .setInteractive(),
    );
    root.add(
      createPaperPanel(this, {
        x: GAME_WIDTH / 2,
        y: 372,
        width: 920,
        height: 600,
        radius: 30,
        fill: C.paperSoft,
        depth: 3001,
      }),
    );

    root.add(addSeal(this, 250, 142, this.result.newCard ? '得' : '温', 52, C.peachDeep));
    root.add(
      makeText(
        this,
        GAME_WIDTH / 2 + 20,
        124,
        this.result.newCard ? '接龙通关 · 诗卡入卷' : '又接完啦 · 对答更顺',
        { size: 34, color: S.ink },
      ).setDepth(3002),
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
      }).setDepth(3002),
    );

    root.add(
      makeText(
        this,
        GAME_WIDTH / 2,
        250,
        `${this.poem.dynasty} · ${this.poem.author}　·　${getChapterName(this.poem.chapter)} / ${this.poem.area}`,
        { size: 15, color: S.inkSoft },
      ).setDepth(3002),
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
        `共 ${this.rounds.length} 轮　·　答错 ${this.mistakes} 次　·　`
        + `毛笔提示 ${this.brushHints} 次　·　温和首字 ${this.freeHintsUsed} 次`,
        { size: 16, color: S.gold, origin: [0.5, 0.5], wrap: 780 },
      ).setDepth(3002),
    );

    const lines = [];
    if (this.result.newCard) {
      lines.push(`✦ 新诗卡《${this.poem.title}》已收入图鉴`);
    } else {
      lines.push(`✦ 诗卡星级更新为 ${this.result.stars} ★`);
    }
    if (this.mistakes === 0 && this.brushHints === 0) {
      lines.push('✦ 一句没错、也没借毛笔，三星全收下');
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
      makeText(this, GAME_WIDTH / 2, 428, rewardLines.join('\n'), {
        size: 15,
        color: S.pineDeep,
        origin: [0.5, 0],
        align: 'center',
        wrap: 780,
        lineSpacing: 5,
      }).setDepth(3002),
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
      }).setDepth(3002),
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
      title: '先离开这一首吗？',
      sealText: '问',
      message: '这几句还没有接完。\n离开后这几轮的进度不会保存，下次可以重新开始。',
      actions: [
        { label: '继续接龙', variant: 'primary' },
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
