/**
 * MeaningMatchScene：诗意配对玩法（独立场景）
 * ------------------------------------------------------------
 * 玩法：
 *  1. 读取单首 poem，把 full_text 拆成「诗句」（按句末标点，一句一块）；
 *  2. 左侧随机取其中一句展示，右侧给 4 条文意描述，只有 1 条是这一句的意思；
 *  3. 点选作答：答对通关；答错只给温和提示（不公布答案），并写入错题本；
 *  4. 提示：温和模式自带 2 次免费提示（每次排除 1 个错误项）；
 *     免费次数用完后，消耗 1 支毛笔可排除 2 个错误项（本题最多 2 星）；
 *  5. 通关走与「看图猜诗」完全一致的结算：ProgressManager.markPoemComplete
 *     （诗卡 / 星级 / 错题清除 / 轶事 / 藏品 / 章节解锁），答错 addWrongRecord。
 *
 * 复用：
 *  - BaseScene（背景、头部、吐司、弹窗、转场）
 *  - ProgressManager / AudioManager
 *  - ui/components、ui/background、ui/ScrollPanel
 *
 * 入口：
 *  - { poemId, returnScene? }；开发预览：路径加 `?match=1`（见 main.js）
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
const BOARD = { x: 640, y: 406, width: 1180, height: 476 };
const CARD = { x: 246, top: 196, width: 336, bottom: 584 };
const OPTION_X = 820;
const OPTION_WIDTH = 700;
const OPTION_HEIGHT = 84;
const OPTION_YS = [214, 310, 406, 502];
const FEEDBACK_Y = 562;

const GENTLE_FREE_HINTS = 2; // 温和模式提示次数 +2
const SENTENCE_END = '。！？；';
const CLAUSE_END = '，、：；';
const CLOSING_MARKS = '”’」』）】';
const MAX_MEANING_LENGTH = 46;
const MIN_TIP_LENGTH = 12; // 短于此长度的 tip 只是口号，改写成干扰项会显得突兀

// ---------------------------------------------------------
// 文本工具（纯函数，便于复用到其它玩法）
// ---------------------------------------------------------

/** 按指定标点切分并保留标点；被引号带走的收尾符号并回上一句 */
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

/** 统一成一句通顺的话：收尾标点规整、去掉多余空白 */
function toSentence(text) {
  const value = String(text || '')
    .replace(/\s+/g, '')
    .replace(/[，、；：]+$/, '。')
    .trim();
  if (!value) return '';
  // 已经以句末标点收尾（后面可能还跟着引号 / 括号）就不要再补句号
  if (/[。！？]$/.test(value) || /[。！？][”’」』）】]$/.test(value)) return value;
  return `${value}。`;
}

/** 把 full_text 拆成「诗句」：绝句 → 2 句，古文 → 按句拆 */
export function splitPoemSentences(fullText) {
  const raw = String(fullText || '').trim();
  if (!raw) return [];

  const explicit = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (explicit.length >= 2) return explicit.map(toSentence);

  const sentences = splitKeepPunctuation(raw, SENTENCE_END).map(toSentence).filter(Boolean);
  if (sentences.length >= 2) return sentences;

  // 只有一句时按逗号再拆一次，至少给出 2 块
  const clauses = splitKeepPunctuation(raw, `${CLAUSE_END}${SENTENCE_END}`).map(toSentence).filter(Boolean);
  return clauses.length > 0 ? clauses : [toSentence(raw)];
}

/** 把译文拆成句，作为「文意」的最小单位 */
export function splitMeaningSentences(translation) {
  return splitKeepPunctuation(translation, SENTENCE_END).map(toSentence).filter(Boolean);
}

/**
 * 把整首诗的译文对齐到每一句诗上。
 * - 译文句数多于诗句：合并最短的相邻两句（保留内容）；
 * - 译文句数少于诗句：拆开最长的一句（按逗号/顿号/冒号，找不到就按长度平分）。
 * @param {string[]} lines 诗句
 * @param {string} translation 译文
 * @returns {string[]} 与 lines 一一对应的文意
 */
export function alignLineMeanings(lines, translation) {
  const count = Array.isArray(lines) ? lines.length : 0;
  if (count === 0) return [];

  const parts = splitMeaningSentences(translation);
  if (parts.length === 0) return new Array(count).fill('');

  while (parts.length > count) {
    let bestIndex = 0;
    let bestLength = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const length = parts[i].length + parts[i + 1].length;
      if (length < bestLength) {
        bestLength = length;
        bestIndex = i;
      }
    }
    const merged = `${parts[bestIndex].replace(/[。！？]$/, '')}，${parts[bestIndex + 1]}`;
    parts.splice(bestIndex, 2, toSentence(merged));
  }

  while (parts.length < count) {
    let longestIndex = 0;
    parts.forEach((part, index) => {
      if (part.length > parts[longestIndex].length) longestIndex = index;
    });
    const target = parts[longestIndex];
    const body = target.replace(/[。！？]$/, '');
    // 找最靠近中间的停顿处切开，避免切出「这就太糊涂了。」这种过短的一段
    // （正确项明显比干扰项短会泄露答案）
    const pauses = [];
    for (let i = 0; i < body.length; i += 1) {
      if (CLAUSE_END.includes(body[i])) pauses.push(i);
    }
    const middle = body.length / 2;
    let cut = -1;
    if (pauses.length > 0) {
      cut = pauses.reduce(
        (best, position) => (Math.abs(position - middle) < Math.abs(best - middle) ? position : best),
        pauses[0],
      );
    }
    if (cut <= 0) cut = Math.floor(body.length / 2);
    if (cut < 1 || cut >= body.length - 1) break;
    parts.splice(
      longestIndex,
      1,
      toSentence(body.slice(0, cut)),
      toSentence(body.slice(cut + 1)),
    );
  }

  const aligned = parts.slice(0, count);
  while (aligned.length < count) aligned.push('');
  return aligned;
}

/** 极轻的改写：清洗套话、压缩长度，让干扰项与正确项文体一致 */
function polishMeaning(text) {
  let value = toSentence(String(text || '').replace(/^(这首诗|本诗|全诗)[是为]?/, ''));
  if (value.length > MAX_MEANING_LENGTH) {
    const cut = Math.max(value.lastIndexOf('，', MAX_MEANING_LENGTH), 12);
    value = toSentence(value.slice(0, cut > 12 ? cut : MAX_MEANING_LENGTH));
  }
  return value;
}

/** 每首诗「诗句 → 文意」的对齐结果做一次缓存 */
const meaningCache = new Map();

function alignedMeaningsOf(poem) {
  if (!poem) return { lines: [], meanings: [] };
  const cached = meaningCache.get(poem.id);
  if (cached) return cached;

  const lines = splitPoemSentences(poem.full_text);
  const meanings = alignLineMeanings(lines, poem.translation).map((item) => polishMeaning(item));
  const entry = { lines, meanings };
  meaningCache.set(poem.id, entry);
  return entry;
}

/** 干扰项来源池：同片区优先，其次同章节、同难度，最后其他诗篇；不用隐藏诗，避免剧透 */
export function getMeaningDistractorPoems(poem) {
  if (!poem) return [];
  const pool = dataManager
    .getAllPoems()
    .filter((item) => item.id !== poem.id && !item.is_hidden);

  const sameArea = pool.filter((item) => item.area === poem.area);
  const sameChapter = pool.filter((item) => item.chapter === poem.chapter && item.area !== poem.area);
  const sameDifficulty = pool.filter(
    (item) => item.chapter !== poem.chapter && item.difficulty === poem.difficulty && item.area !== poem.area,
  );
  const rest = pool.filter(
    (item) =>
      item.chapter !== poem.chapter
      && item.difficulty !== poem.difficulty
      && item.area !== poem.area,
  );

  const seen = new Set();
  const ordered = [];
  [...shuffle(sameArea), ...shuffle(sameChapter), ...shuffle(sameDifficulty), ...shuffle(rest)]
    .forEach((item) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      ordered.push(item);
    });
  return ordered;
}

/**
 * 构建一轮「诗意配对」题目。
 * @param {number} poemId
 * @param {number} lineIndex 目标诗句下标
 * @param {number} optionCount 选项数量（默认 4）
 * @returns {{ poem: object, lineIndex: number, line: string, correct: string, options: Array }}
 */
export function buildMeaningOptions(poemId, lineIndex = 0, optionCount = 4) {
  const poem = dataManager.getPoemById(poemId);
  if (!poem) return null;

  const { lines, meanings } = alignedMeaningsOf(poem);
  if (lines.length === 0) return null;

  const safeIndex = Phaser.Math.Clamp(Number(lineIndex) || 0, 0, lines.length - 1);
  const correct = meanings[safeIndex] || '';
  if (!correct) return null;
  const normalize = (text) => String(text).replace(/[。！？，、；：]/g, '');

  // 干扰项：优先取「同片区 / 同章节 / 同难度」其他诗篇的 tip，改写成一两句话的文意；
  // tip 过短（只剩一句口号，读起来不像文意）时，退用该诗逐句译文，保证总能凑满 3 条。
  const candidates = [];
  getMeaningDistractorPoems(poem).forEach((other) => {
    if (candidates.length >= optionCount - 1) return;

    const fromTip = polishMeaning(other.tip);
    const otherData = alignedMeaningsOf(other);
    const pool = otherData.meanings.filter((item) => item && item.length >= MIN_TIP_LENGTH);
    // 退路：优先挑长度与正确项接近的文意，读起来才像同类选项
    const sorted = [...pool].sort(
      (a, b) => Math.abs(a.length - correct.length) - Math.abs(b.length - correct.length),
    );
    const fallback = sorted[Math.min(Math.max(sorted.length - 1, 0), Math.floor(Math.random() * 2))];

    const text = fromTip.length >= MIN_TIP_LENGTH ? fromTip : polishMeaning(fallback);
    if (!text) return;
    if (text.length < MIN_TIP_LENGTH) return;
    if (normalize(text) === normalize(correct)) return;
    if (candidates.some((item) => normalize(item.text) === normalize(text))) return;
    candidates.push({ text, poem: other });
  });

  const options = shuffle([
    { text: correct, correct: true, poem },
    ...candidates.slice(0, optionCount - 1).map((item) => ({ ...item, correct: false })),
  ]);

  return {
    poem,
    lineIndex: safeIndex,
    line: lines[safeIndex],
    correct,
    totalLines: lines.length,
    options,
  };
}

export default class MeaningMatchScene extends BaseScene {
  constructor() {
    super(SCENES.MEANING_MATCH);
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

    this.mistakes = 0;
    this.brushHintUsed = false;
    this.freeHintLeft = 0;
    this.eliminated = new Set();
    this.optionButtons = [];
    this.round = null;
    this.result = null;
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
    this.difficulty = getDifficultyConfig(progress.getDifficulty());
    // 温和模式提示次数 +2（免费、不扣星）
    this.freeHintLeft = this.difficulty.gentleNudge ? GENTLE_FREE_HINTS : 0;

    this.addHeader({
      title: '诗意配对',
      subtitle: `${getChapterName(poem.chapter)} / ${poem.area} · 读一读左边的诗句，选出它的意思`,
      onBack: () => this._requestLeave(),
      backLabel: '返回',
    });

    this._buildPoemBar();
    this._buildBoard();
    this._buildBottomBar();

    if (!this._buildRound()) return;

    this._refreshHintInfo();
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

    const authorText = makeText(this, 64 + titleText.width + 14, y + 3, `${this.poem.dynasty} · ${this.poem.author}`, {
      size: 17,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(1005);

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
  // 纸卡底板
  // ---------------------------------------------------------
  _buildBoard() {
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

    // 左侧诗句卡：单独一张小纸片，像从诗集里抽出来的一页
    const g = this.add.graphics().setDepth(900);
    g.fillStyle(0x6f6050, 0.08);
    roundedRectPath(g, CARD.x - CARD.width / 2 + 2, CARD.top + 6, CARD.width, CARD.bottom - CARD.top, 22);
    g.fillPath();
    g.fillStyle(C.paper, 0.96);
    roundedRectPath(g, CARD.x - CARD.width / 2, CARD.top, CARD.width, CARD.bottom - CARD.top, 22);
    g.fillPath();
    g.lineStyle(1.6, C.gold, 0.5);
    roundedRectPath(g, CARD.x - CARD.width / 2, CARD.top, CARD.width, CARD.bottom - CARD.top, 22);
    g.strokePath();
    g.lineStyle(1, 0xffffff, 0.5);
    roundedRectPath(
      g,
      CARD.x - CARD.width / 2 + 6,
      CARD.top + 6,
      CARD.width - 12,
      CARD.bottom - CARD.top - 12,
      17,
    );
    g.strokePath();

    // 诗句卡内部的装订线
    g.lineStyle(1, C.gold, 0.32);
    g.beginPath();
    g.moveTo(CARD.x - CARD.width / 2 + 32, 478);
    g.lineTo(CARD.x + CARD.width / 2 - 32, 478);
    g.strokePath();

    addSeal(this, CARD.x - CARD.width / 2 + 40, CARD.top + 34, '诗', 34, C.pineDeep).setDepth(901);

    this.lineHintText = makeText(this, CARD.x + 20, CARD.top + 34, '读一读这一句', {
      size: 15,
      color: S.inkSoft,
      origin: [0.5, 0.5],
    }).setDepth(901);

    this.lineText = makeText(this, CARD.x, 360, '', {
      size: 34,
      color: S.ink,
      origin: [0.5, 0.5],
      align: 'center',
      wrap: 280,
      lineSpacing: 14,
    }).setDepth(901);

    this.lineMetaText = makeText(this, CARD.x, 510, '', {
      size: 15,
      color: S.inkSoft,
      origin: [0.5, 0.5],
      align: 'center',
      wrap: 280,
      lineSpacing: 6,
    }).setDepth(901);

    this.feedbackText = makeText(this, OPTION_X, FEEDBACK_Y, '', {
      size: 16,
      color: S.inkSoft,
      origin: [0.5, 0],
      align: 'center',
      wrap: OPTION_WIDTH,
      lineSpacing: 6,
    }).setDepth(1006);
  }

  // ---------------------------------------------------------
  // 底部：返回 / 提示 / 余量
  // ---------------------------------------------------------
  _buildBottomBar() {
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

    this._hintBtn = createButton(this, {
      x: 470,
      y: 676,
      width: 300,
      height: 60,
      radius: 22,
      label: '提示',
      variant: 'gold',
      fontSize: 21,
      depth: 1050,
      onClick: () => this._onHint(),
    });

    this.hintInfoText = makeText(this, 646, 676, '', {
      size: 15,
      color: S.inkSoft,
      origin: [0, 0.5],
      align: 'left',
      wrap: 540,
      lineSpacing: 5,
    }).setDepth(1050);
  }

  // ---------------------------------------------------------
  // 题目
  // ---------------------------------------------------------
  _buildRound() {
    const { lines } = alignedMeaningsOf(this.poem);
    if (lines.length < 1) {
      showModal(this, {
        title: '这首诗还没排好',
        sealText: '短',
        message: '这一篇暂时配对不起来，先去读别的诗吧。',
        actions: [{ label: '返回地图', variant: 'primary', onClick: () => this._leaveToMap() }],
      });
      return false;
    }

    // 每次进来随机抽一句（抽到出不了 4 个选项的句子就换下一句），避免只练第一句
    this.round = null;
    for (const index of shuffle(lines.map((_, i) => i))) {
      const round = buildMeaningOptions(this.poem.id, index, 4);
      if (round && round.options.length === 4) {
        this.round = round;
        break;
      }
    }
    if (!this.round) {
      showToast(this, '这首诗暂时出不了题，先换一首吧。', { y: 320, tone: 'warn' });
      return false;
    }
    this.lineIndex = this.round.lineIndex;

    this.lineText.setText(this.round.line);
    this.lineMetaText.setText(`——《${this.poem.title}》· 第${this.lineIndex + 1}句 / 共${this.round.totalLines}句`);

    this.round.options.forEach((option, index) => {
      const button = createButton(this, {
        x: OPTION_X,
        y: OPTION_YS[index],
        width: OPTION_WIDTH,
        height: OPTION_HEIGHT,
        radius: 22,
        label: option.text,
        variant: 'secondary',
        fontSize: option.text.length > 30 ? 19 : 22,
        depth: 940,
        onClick: () => this._choose(option, button, index),
      });
      this.optionButtons.push(button);
    });

    this._setFeedback('点一点右边最符合这一句意思的那一条。');
    return true;
  }

  // ---------------------------------------------------------
  // 作答
  // ---------------------------------------------------------
  _choose(option, button, index) {
    if (this._solved || this._resultShown) return;
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
    this.eliminated.add(index);
    this._shakeOptionColumn();

    const gentle = this.difficulty.gentleNudge;
    const hint = gentle
      ? '别急，小诗童陪你慢慢读：这一句里写了什么景物、什么人、什么动作？'
      : '再想想：这一句里的关键字，在哪个选项里也出现过？';
    this._setFeedback(`这一条不太像哦 · 已经记进错题书斋\n${hint}`, 'wrong');
    this._refreshHintInfo();
    showToast(this, '这一条不太像哦，再看看别的', { y: 320, tone: 'warn', duration: 1800 });
  }

  _onCorrect(button) {
    if (this._solved) return;
    this._solved = true;
    audio.playCorrect();
    button.setVariant('correct');
    this.optionButtons.forEach((btn) => {
      if (btn !== button) btn.setDisabled(true);
    });
    if (this._hintBtn) this._hintBtn.setDisabled(true);

    this._setFeedback(`配对啦！这一句的意思是：${this.round.correct}`, 'correct');
    const stars = this._calcStars();

    this.time.delayedCall(560, () => {
      if (!this.scene.isActive()) return;
      this._handleSolved(stars);
    });
  }

  /** 与「看图猜诗」统一：错一次扣一星，用过毛笔再扣一星，最低 1 星 */
  _calcStars() {
    const penalty = this.mistakes + (this.brushHintUsed ? 1 : 0);
    return Math.max(1, Math.min(3, 3 - penalty));
  }

  _setFeedback(text, tone = 'normal') {
    if (!this.feedbackText) return;
    const color = tone === 'correct' ? S.pineDeep : tone === 'wrong' ? S.peach : S.inkSoft;
    this.feedbackText.setText(text);
    this.feedbackText.setColor(color);
  }

  /** 答错时右侧选项轻轻晃一下，比标红更温柔 */
  _shakeOptionColumn() {
    const targets = this.optionButtons.map((btn) => btn.container);
    this.tweens.killTweensOf(targets);
    this.tweens.add({
      targets,
      x: { from: OPTION_X - 6, to: OPTION_X + 6 },
      duration: 80,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
      onComplete: () => targets.forEach((container) => container.setX(OPTION_X)),
    });
  }

  // ---------------------------------------------------------
  // 提示
  // ---------------------------------------------------------
  _onHint() {
    if (this._solved || this._resultShown || this._hintModalOpen) return;

    // 提示只缩小范围，不能把答案直接送到眼前：
    // 至少要留 1 条错误项可选，所以可排除数量 = 剩余错误项 - 1。
    const removable = this._hintRemovableCount();
    if (removable <= 0) {
      showToast(this, '这一题已经帮你排除到最少啦，慢慢读一读，自己选一条吧。', {
        y: 320,
        duration: 2000,
      });
      return;
    }

    if (this.freeHintLeft > 0) {
      this._hintModalOpen = true;
      this.showModal({
        title: '用一次温和提示？',
        sealText: '温',
        message: `温和模式本次还有 ${this.freeHintLeft} 次免费提示。\n帮你排除 1 个错误选项，不消耗毛笔，也不扣星星。`,
        actions: [
          { label: '先自己想想', variant: 'secondary' },
          {
            label: '排除一个选项',
            variant: 'primary',
            onClick: () => this._applyHint(1, 'free'),
          },
        ],
        onClose: () => {
          this._hintModalOpen = false;
        },
      });
      return;
    }

    if (progress.getBrushCount() <= 0) {
      showToast(this, '毛笔用完啦，读完这首诗会再得到一支。', { y: 320, tone: 'warn' });
      return;
    }

    const brushRemove = Math.min(2, removable);
    this._hintModalOpen = true;
    this.showModal({
      title: '用一支毛笔换提示？',
      sealText: '笔',
      message: `毛笔还剩 ${progress.getBrushCount()} 支。\n用了之后，会先帮你收走 ${brushRemove} 个错误选项，\n本题最多只能拿到 2 颗星。`,
      actions: [
        { label: '先自己想想', variant: 'secondary' },
        { label: '用一支毛笔', variant: 'primary', onClick: () => this._applyHint(2, 'brush') },
      ],
      onClose: () => {
        this._hintModalOpen = false;
      },
    });
  }

  /** 仍可选择的错误选项数量（已排除 / 已点错的都不算） */
  _remainingWrongCount() {
    if (!this.round) return 0;
    return this.round.options.filter((option, index) => !option.correct && !this.eliminated.has(index))
      .length;
  }

  /** 本次提示最多能收走几条（始终保留 1 条错误项） */
  _hintRemovableCount() {
    return Math.max(0, this._remainingWrongCount() - 1);
  }

  /**
   * 提示应用：缩小选项范围。
   * @param {number} removeCount 收走几个错误选项
   * @param {'free'|'brush'} source
   */
  _applyHint(removeCount, source) {
    if (this._solved) return;

    const allowed = Math.min(removeCount, this._hintRemovableCount());
    if (allowed <= 0) {
      showToast(this, '这一题已经帮你排除到最少啦，自己选一条试试。', { y: 320, duration: 1800 });
      return;
    }

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

    const removed = this._eliminateWrongOptions(allowed);
    audio.playPage();
    this._refreshHintInfo();
    this._refreshBrush();
    this._setFeedback(
      removed > 0
        ? `已收起 ${removed} 条不太像的选项，剩下的再读一读。`
        : '已经只剩最像的几条啦，选一条试试。',
    );
    if (removed > 0) {
      showToast(this, `收起了 ${removed} 条不太像的选项`, { y: 320, duration: 1600 });
    }
  }

  /** 收走若干个仍然可选的错误项，并保证至少留 1 条错误项（不直接给答案） */
  _eliminateWrongOptions(count) {
    const candidates = this.round.options
      .map((option, index) => ({ option, index }))
      .filter(({ option, index }) => !option.correct && !this.eliminated.has(index));

    let removed = 0;
    candidates.slice(0, Math.max(0, count)).forEach(({ option, index }) => {
      this.eliminated.add(index);
      const button = this.optionButtons[index];
      if (!button) return;
      button.setLabel(`（已排除）${option.text}`);
      button.setVariant('muted');
      button.setDisabled(true);
      removed += 1;
    });
    return removed;
  }

  _refreshHintInfo() {
    const brush = progress.getBrushCount();
    if (this.brushText) this.brushText.setText(`毛笔 × ${brush}`);

    if (this.hintInfoText) {
      const lines = [`毛笔 × ${brush}`];
      if (this.freeHintLeft > 0) lines.push(`温和提示 × ${this.freeHintLeft}`);
      this.hintInfoText.setText(lines.join('　·　'));
    }

    if (this._hintBtn) {
      const label = this.freeHintLeft > 0
        ? '提示 · 排除一项'
        : '毛笔提示 · 排除两项';
      this._hintBtn.setLabel(label);
      this._hintBtn.setDisabled(
        this._solved
        || (this.freeHintLeft <= 0 && brush <= 0)
        || this._hintRemovableCount() <= 0,
      );
    }
  }

  _refreshBrush() {
    if (this.brushText) this.brushText.setText(`毛笔 × ${progress.getBrushCount()}`);
  }

  // ---------------------------------------------------------
  // 结算（与现有玩法同一套）
  // ---------------------------------------------------------
  _handleSolved(stars) {
    if (this._resultShown) return;
    this.result = progress.markPoemComplete(this.poem.id, stars);
    console.info('[诗意配对] 结算：', {
      poem: this.poem.title,
      line: this.round.line,
      stars,
      mistakes: this.mistakes,
      brushHintUsed: this.brushHintUsed,
      freeHintLeft: this.freeHintLeft,
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

  _showResult() {
    if (this._resultShown) return;
    this._resultShown = true;
    this._hintBtn?.setDisabled(true);

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

    root.add(addSeal(this, 250, 142, this.result.newCard ? '得' : '温', 52, C.peachDeep));

    root.add(
      makeText(
        this,
        GAME_WIDTH / 2 + 20,
        124,
        this.result.newCard ? '配对啦 · 诗卡入卷' : '又配对啦 · 诗意更熟',
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

    const lines = [];
    if (this.result.newCard) {
      lines.push(`✦ 新诗卡《${this.poem.title}》已收入图鉴`);
    } else {
      lines.push(`✦ 诗卡星级更新为 ${this.result.stars} ★`);
    }
    if (this.mistakes === 0 && !this.brushHintUsed) {
      lines.push('✦ 一次配对成功，三颗星全收下');
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
      title: '先离开这一题吗？',
      sealText: '问',
      message: '这一句还没有配对完。\n离开后进度会留在原地，下次还可以再来。',
      actions: [
        { label: '继续配对', variant: 'primary' },
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
