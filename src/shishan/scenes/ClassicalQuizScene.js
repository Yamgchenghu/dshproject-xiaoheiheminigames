/**
 * ClassicalQuizScene：文言文意问答（独立场景）
 * ------------------------------------------------------------
 * 玩法：
 *  1. 只挑 poem_db.json 里的「古文」条目（tags 含「古文 / 文言 / 寓言」，
 *     或正文汉字数 ≥ 40 的长篇），左侧纸卡展示古文原文；
 *  2. 左侧两个开关：拼音开关（原文逐句配拼音）、白话译文切换（原文 ↔ 译文）；
 *     正文按句分行、行距宽松、字号充足，超出纸卡可上下拖动阅读；
 *  3. 右侧每轮一题，题干问「谁做了什么 / 他为什么这样做 / 明白什么道理」，
 *     四个宽大的单选选项，全部用小学生读得懂的话提问与作答；
 *  4. 答对进入下一题，答错只给温和引导（提示读哪一句、想什么），
 *     绝不直接公布答案；本轮答错的选项会被收走，可以继续重试；
 *  5. 毛笔提示只「缩小选项范围」：至少保留 1 条错误项，不会把答案送到眼前；
 *     温和模式自带 2 次免费提示（各排除 1 项），毛笔提示一次排除 2 项；
 *  6. 全部题目答对通关，走与「看图猜诗」一致的结算：progress.markPoemComplete
 *     （诗卡 / 星级 / 错题清除 / 轶事 / 藏品 / 章节解锁）；
 *     每次答错都会 progress.addWrongRecord，通关后由结算统一清除；
 *  7. 星级：错一次扣一星，用过毛笔再扣一星，最低 1 星；免费提示不扣星。
 *
 * 复用：
 *  - BaseScene（背景、头部、吐司、弹窗、转场）
 *  - ProgressManager / AudioManager
 *  - ui/components（按钮、纸卡、标签、星星、弹窗）、ui/background、ui/ScrollPanel
 *
 * 入口：
 *  - { poemId, returnScene? }；开发预览：路径加 `?classical=6`（见 main.js）
 *  - 不依赖、也不修改任何原有场景
 */

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
  showToast,
} from '../ui/components.js';
import { addSeal } from '../ui/background.js';
import { ScrollPanel } from '../ui/ScrollPanel.js';

// ---------------------------------------------------------
// 布局常量（1280 × 720 设计分辨率）
// ---------------------------------------------------------
const TEXT_PANEL = { x: 320, y: 372, width: 560, height: 466 }; // 左侧原文纸卡
const SCROLL = { x: 56, y: 232, width: 528, height: 340 }; // 原文滚动区
const QUIZ_PANEL = { x: 930, y: 196, width: 620, height: 116 }; // 右侧题干纸卡
const OPTION = { x: 930, width: 620, height: 76, ys: [290, 376, 462, 548] };
const FEEDBACK_Y = 600;
const TEXT_WIDTH = SCROLL.width - 28; // 500

const GENTLE_FREE_HINTS = 2; // 温和模式提示次数 +2
const OPTION_COUNT = 4;
const SENTENCE_END = '。！？；';
const PAUSE_MARKS = '，、；：。！？';
const CLOSING_MARKS = '”’」』）】';
const QUESTION_DELAY = 1200; // 答对后留给小朋友读解释的时间
const CLASSICAL_TAGS = /古文|文言|寓言/;
const CLASSICAL_MIN_CHARS = 40; // 长得像文言文的长篇也算

// ---------------------------------------------------------
// 纯函数：识别古文 / 拆句 / 拼音对齐 / 出题
// ---------------------------------------------------------

/** 是不是古文条目：tags 带「古文 / 文言 / 寓言」，或正文很长（文言文一般都长） */
export function isClassicalPoem(poem) {
  if (!poem) return false;
  const tags = Array.isArray(poem.tags) ? poem.tags.join('') : '';
  if (CLASSICAL_TAGS.test(tags)) return true;
  const chars = (String(poem.full_text || '').match(/[\u4e00-\u9fa5]/g) || []).length;
  return chars >= CLASSICAL_MIN_CHARS;
}

/** 数据里全部古文条目 */
export function getClassicalPoems(poems = dataManager.getAllPoems()) {
  return (poems || []).filter(isClassicalPoem);
}

/**
 * 选一首能出题的古文：
 *  - 传入的就是古文 → 直接用；
 *  - 传入的是普通古诗 → 换成同章节的古文，没有就换第一篇古文（并提示）。
 */
export function pickClassicalPoem(poemId, poems = dataManager.getAllPoems()) {
  const list = getClassicalPoems(poems);
  if (list.length === 0) return { poem: null, fallback: false, requested: null };

  const requested = (poems || []).find((item) => item.id === Number(poemId)) || null;
  if (requested && isClassicalPoem(requested)) {
    return { poem: requested, fallback: false, requested };
  }
  const sameChapter = requested ? list.find((item) => item.chapter === requested.chapter) : null;
  return { poem: sameChapter || list[0], fallback: Boolean(requested), requested };
}

/** 按句末标点切分并保留标点；被引号带走的收尾符号并回上一句 */
export function splitClassicSentences(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const explicit = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (explicit.length >= 2) return explicit;

  const parts = [];
  let buffer = '';
  for (const char of raw) {
    buffer += char;
    if (SENTENCE_END.includes(char)) {
      parts.push(buffer.trim());
      buffer = '';
    }
  }
  if (buffer.trim()) parts.push(buffer.trim());

  const merged = [];
  parts.forEach((segment) => {
    const lead = segment.match(new RegExp(`^[${CLOSING_MARKS}]+`));
    if (lead && merged.length > 0) {
      merged[merged.length - 1] += lead[0];
      const rest = segment.slice(lead[0].length).trim();
      if (rest) merged.push(rest);
    } else if (segment) {
      merged.push(segment);
    }
  });
  return merged;
}

/**
 * 把原文与拼音按句配对：句数相同时逐句配对；
 * 句数不同时（拼音多/少切了一句）退回「整段拼音 + 原句」，不硬凑错位。
 */
export function pairClassicSentences(fullText, pinyinText) {
  const lines = splitClassicSentences(fullText);
  const pinyinLines = splitClassicSentences(pinyinText);
  const aligned = pinyinLines.length === lines.length && lines.length > 0;

  return {
    aligned,
    lines: lines.map((text, index) => ({
      text,
      pinyin: aligned ? pinyinLines[index] : '',
    })),
    pinyinBlock: aligned ? '' : pinyinLines.join(' '),
  };
}

/**
 * 把一段中文按「停顿处 + 字数上限」预先折行。
 * Phaser 的自动换行会按字符硬断，容易把「，」甩到行首；
 * 这里先在逗号 / 句号处断开，再拼成不超过 maxChars 的行，读起来更顺。
 */
export function wrapClassicText(text, maxChars = 20) {
  const value = String(text || '').trim();
  if (!value) return '';

  const atoms = [];
  let buffer = '';
  for (const char of value) {
    buffer += char;
    if (PAUSE_MARKS.includes(char) || buffer.length >= maxChars) {
      atoms.push(buffer);
      buffer = '';
    }
  }
  if (buffer) atoms.push(buffer);

  const lines = [];
  let line = '';
  atoms.forEach((atom) => {
    if (line && line.length + atom.length > maxChars) {
      lines.push(line);
      line = atom;
    } else {
      line += atom;
    }
  });
  if (line) lines.push(line);
  return lines.join('\n');
}

/** 截一段白话文成一句，作为选项也不显得很长 */
function shortenSentence(text, max = 36) {
  const value = String(text || '').replace(/\s+/g, '').trim();
  if (!value) return '';
  if (value.length <= max) return value;
  let cut = -1;
  for (let i = 0; i < value.length && i <= max; i += 1) {
    if ('，、；：'.includes(value[i])) cut = i;
  }
  return `${value.slice(0, cut > 10 ? cut : max)}。`;
}

/**
 * 手写题库：古文条目少，逐题写最稳，措辞也最贴近小学生。
 * 每条：tag（题目标签）、stem（题干）、correct / wrongs（选项）、
 *      guide（答错后的温和引导，不提答案）、explain（答对后的解释）。
 */
export const CLASSIC_BANK = {
  6: {
    // 《伯牙鼓琴》
    questions: [
      {
        tag: '谁做了什么',
        stem: '伯牙弹琴的时候，锺子期听出了什么？',
        correct: '听出琴声里想的是高山，还是流水',
        wrongs: ['听出这张琴是用什么木头做的', '听出伯牙今天的心情好不好', '听出伯牙哪个音弹错了'],
        guide: '想一想：锺子期听完说「巍巍乎若太山」，他是在说琴声像什么？',
        explain: '锺子期一边听一边说出了伯牙心里想的高山和流水，他是真的听懂了。',
      },
      {
        tag: '后来怎样了',
        stem: '锺子期去世以后，伯牙做了什么？',
        correct: '摔了琴、断了弦，一辈子不再弹琴',
        wrongs: ['换一把新琴，继续弹给别人听', '把琴收进箱子，只在过节时弹', '把琴送给锺子期的家人'],
        guide: '读一读最后一句：「破琴绝弦，终身不复鼓琴」，这几个字在说他做什么？',
        explain: '原文说「破琴绝弦，终身不复鼓琴」——他觉得世上再没有能听懂他琴声的人了。',
      },
      {
        tag: '明白什么道理',
        stem: '这个故事最想告诉我们什么？',
        correct: '真正懂自己的朋友很难得，要好好珍惜',
        wrongs: ['弹琴要天天练习，才能弹出好听的曲子', '山和水是最好的听众，要常常亲近自然', '朋友之间要少见面，才不会互相打扰'],
        guide: '想一想：伯牙为什么一辈子不再弹琴？他失去的是一位什么样的朋友？',
        explain: '一个弹、一个懂，这样的朋友叫「知音」。这个故事说的就是懂自己的人很难得。',
      },
    ],
  },
  7: {
    // 《掩耳盗铃》
    questions: [
      {
        tag: '谁做了什么',
        stem: '那个人怕别人听见钟声，做了一件什么事？',
        correct: '捂住自己的耳朵，以为别人也听不见',
        wrongs: ['把钟敲得更响，让大家都知道', '请人一起把钟抬走', '把耳朵贴在钟上，听听里面有什么'],
        guide: '读一读「遽掩其耳」——「掩」是用手做一个什么动作？',
        explain: '他捂住了自己的耳朵，以为这样别人就听不见钟声了。',
      },
      {
        tag: '他为什么这样做',
        stem: '那个人为什么要用锤子把钟敲碎？',
        correct: '钟太大背不动，他想敲碎了再拿走',
        wrongs: ['他觉得钟声太吵，想让钟安静下来', '他想试试新买的锤子好不好用', '他想把钟修一修，送给邻居'],
        guide: '读一读「钟大不可负」——「负」在这里是背着走的意思。',
        explain: '钟太大背不动，他才想敲碎了带走，结果一敲就发出了很大的响声。',
      },
      {
        tag: '明白什么道理',
        stem: '「掩耳盗铃」这个故事告诉我们什么？',
        correct: '自己骗自己是没有用的',
        wrongs: ['偷东西之前要先看看四周有没有人', '捂住耳朵，人就真的听不见声音了', '遇到难事要大声喊人来帮忙'],
        guide: '想一想：他捂住了自己的耳朵，旁边的人还听得见钟声吗？',
        explain: '他捂住的只是自己的耳朵，别人照样听得见钟声——骗得了自己，骗不了别人。',
      },
    ],
  },
};

/** 把一条题库记录整理成可玩的题目（选项打乱） */
function toQuestion(source) {
  const options = shuffle([
    { text: source.correct, correct: true },
    ...source.wrongs.map((text) => ({ text, correct: false })),
  ]);
  return {
    tag: source.tag,
    stem: source.stem,
    guide: source.guide || '再读一读左边古文里和这道题有关的那一句。',
    explain: source.explain || '',
    options,
  };
}

/**
 * 为指定古文生成题目：
 *  - 题库里有的（《伯牙鼓琴》《掩耳盗铃》）用手写题；
 *  - 新加入的古文自动出题：只用 poem_db 自带的白话译文 / 小贴士，
 *    干扰项取自其它诗篇，保证不出现晦涩术语。
 */
export function buildClassicalQuestions(poem, optionCount = OPTION_COUNT) {
  if (!poem) return [];

  const bank = CLASSIC_BANK[poem.id];
  if (bank && bank.questions.length > 0) {
    return bank.questions
      .map((source) => toQuestion(source))
      .filter((question) => question.options.length === optionCount);
  }

  const normalize = (text) => String(text || '').replace(/[。！？，、；：\s]/g, '');
  const others = dataManager
    .getAllPoems()
    .filter((item) => item.id !== poem.id && !item.is_hidden);

  const pickDistractors = (getter, correct, minLength) => {
    const wanted = normalize(correct);
    const picked = [];
    shuffle(others).forEach((other) => {
      if (picked.length >= optionCount - 1) return;
      const text = getter(other);
      if (!text || text.length < minLength) return;
      if (normalize(text) === wanted) return;
      if (picked.some((item) => normalize(item) === normalize(text))) return;
      picked.push(text);
    });
    return picked;
  };

  const questions = [];

  const meaning = shortenSentence(poem.translation, 38);
  if (meaning) {
    questions.push({
      tag: '这段古文讲了什么',
      stem: '读一读这段古文，下面哪种说法最接近它的意思？',
      guide: '再读一读左边的白话译文，看看故事里发生了什么事。',
      explain: `这段古文的意思是：${meaning}`,
      options: shuffle([
        { text: meaning, correct: true },
        ...pickDistractors((other) => shortenSentence(other.translation, 38), meaning, 10)
          .map((text) => ({ text, correct: false })),
      ]),
    });
  }

  const tip = String(poem.tip || '').trim();
  if (tip.length >= 4) {
    questions.push({
      tag: '明白什么道理',
      stem: '这段古文想让我们明白什么？',
      guide: '想一想：故事里的人做对了什么、做错了什么？',
      explain: tip,
      options: shuffle([
        { text: tip, correct: true },
        ...pickDistractors((other) => String(other.tip || '').trim(), tip, 4)
          .map((text) => ({ text, correct: false })),
      ]),
    });
  }

  return questions.filter((question) => question.options.length === optionCount);
}

export default class ClassicalQuizScene extends BaseScene {
  constructor() {
    super(SCENES.CLASSICAL_QUIZ);
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
    this._questionSolved = false;
    this._navigating = false;
    this.busy = false;

    this.questions = [];
    this.questionIndex = 0;
    this.question = null;
    this.optionButtons = [];
    this.eliminated = new Set();

    this.mistakes = 0;
    this.brushHints = 0;
    this.freeHintsUsed = 0;
    this.brushHintUsed = false;
    this.freeHintLeft = 0;

    this.pinyinOn = true;
    this.showTranslation = false;
    this._panelLines = { aligned: false, lines: [], pinyinBlock: '' };

    this.result = null;
  }

  create() {
    this.prepareScene();
    this.addBackground('garden', { petals: true });
    this.addGrain(0.1);
    audio.playBgm('level');

    const picked = pickClassicalPoem(this.poemId);
    if (!picked.poem) {
      this.showModal({
        title: '还没有古文',
        sealText: '短',
        message: '诗卷里暂时没有文言文篇目，先去读读古诗吧。',
        actions: [{ label: '返回地图', variant: 'primary', onClick: () => this._leaveToMap() }],
      });
      return;
    }

    this.poem = picked.poem;
    this.poemId = this.poem.id;
    this.difficulty = getDifficultyConfig(progress.getDifficulty());
    // 温和模式提示次数 +2（免费，不耗毛笔、不扣星）
    this.freeHintLeft = this.difficulty.gentleNudge ? GENTLE_FREE_HINTS : 0;
    this._panelLines = pairClassicSentences(this.poem.full_text, this.poem.pinyin_text);

    this.questions = buildClassicalQuestions(this.poem, OPTION_COUNT);
    if (this.questions.length === 0) {
      this.showModal({
        title: '这一篇还出不了题',
        sealText: '短',
        message: '这段古文暂时配不出四个选项，先去读别的篇目吧。',
        actions: [{ label: '返回地图', variant: 'primary', onClick: () => this._leaveToMap() }],
      });
      return;
    }

    this.addHeader({
      title: '文言文意问答',
      subtitle: `${getChapterName(this.poem.chapter)} / ${this.poem.area} · 读懂古文里的故事和道理`,
      onBack: () => this._requestLeave(),
      backLabel: '返回',
    });

    this._buildPoemBar();
    this._buildTextPanel();
    this._buildQuizPanel();
    this._buildBottomBar();

    if (!this._startQuestion(0)) return;
    audio.playPage();

    // 传进来的不是古文（例如误点古诗石碑）：换篇并温柔说明
    if (picked.fallback && picked.requested) {
      this.time.delayedCall(200, () => {
        if (!this.scene.isActive()) return;
        this.showToast(
          `《${picked.requested.title}》不是文言文，先一起读《${this.poem.title}》吧`,
          { y: 330, duration: 2400 },
        );
      });
    }
  }

  // ---------------------------------------------------------
  // 顶部：篇名 / 作者 / 标签 / 毛笔
  // ---------------------------------------------------------
  _buildPoemBar() {
    const y = 124;

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

    const classicTag = createTag(this, 0, y, '文言文', {
      fill: C.goldLight,
      textColor: S.gold,
      height: 30,
      fontSize: 14,
      depth: 1005,
    });
    classicTag.container.setPosition(x + classicTag.width / 2, y);
    x += classicTag.width + 10;

    const typeTag = createTag(this, 0, y, this.poem.type === 'core' ? '课内' : '拓展', {
      fill: C.pineLight,
      textColor: S.pineDeep,
      height: 30,
      fontSize: 14,
      depth: 1005,
    });
    typeTag.container.setPosition(x + typeTag.width / 2, y);
    x += typeTag.width + 10;

    const diffTag = createTag(this, 0, y, `难度 ${this.poem.difficulty}`, {
      fill: C.paperDeep,
      textColor: S.inkSoft,
      height: 30,
      fontSize: 14,
      strokeColor: C.gold,
      depth: 1005,
    });
    diffTag.container.setPosition(x + diffTag.width / 2, y);

    addSeal(this, 1150, y, '问', 34, C.pineDeep).setDepth(1005);
    this.brushText = makeText(this, 1172, y, '', {
      size: 15,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(1005);
  }

  // ---------------------------------------------------------
  // 左侧：古文原文 / 译文（拼音开关 + 译文切换 + 滚动）
  // ---------------------------------------------------------
  _buildTextPanel() {
    createPaperPanel(this, {
      x: TEXT_PANEL.x,
      y: TEXT_PANEL.y,
      width: TEXT_PANEL.width,
      height: TEXT_PANEL.height,
      radius: 26,
      fill: C.paperSoft,
      fillAlpha: 0.96,
      depth: 900,
    });

    addSeal(this, 74, 166, '文', 32, C.pineDeep).setDepth(1002);
    this.panelTitleText = makeText(this, 96, 166, '古文原文 · 分行阅读', {
      size: 15,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(1002);

    this._pinyinBtn = createButton(this, {
      x: 131,
      y: 199,
      width: 150,
      height: 44,
      radius: 16,
      label: '拼音：开',
      variant: 'soft',
      fontSize: 17,
      depth: 1050,
      onClick: () => this._togglePinyin(),
    });

    this._translateBtn = createButton(this, {
      x: 406,
      y: 199,
      width: 310,
      height: 44,
      radius: 16,
      label: '看白话译文',
      variant: 'gold',
      fontSize: 17,
      depth: 1050,
      onClick: () => this._toggleTranslation(),
    });

    this.scroll = new ScrollPanel(this, {
      x: SCROLL.x,
      y: SCROLL.y,
      width: SCROLL.width,
      height: SCROLL.height,
      radius: 14,
      depth: 930,
    });
    this._renderTextPanel();

    makeText(this, SCROLL.x, 589, '上下拖动可以读完整段', {
      size: 13,
      color: S.inkFaint,
      origin: [0, 0.5],
    }).setDepth(1002);
  }

  /** 重画滚动内容（拼音 / 译文切换时调用） */
  _renderTextPanel() {
    if (!this.scroll) return;

    this.scroll.content.removeAll(true);
    this.scroll.scrollToTop();

    let cursorY = 0;

    if (this.showTranslation) {
      const translation = makeText(this, 0, cursorY, wrapClassicText(this.poem.translation, 23) || '（这一段还没有白话译文）', {
        size: 21,
        color: S.ink,
        origin: [0, 0],
        align: 'left',
        wrap: TEXT_WIDTH,
        lineSpacing: 16,
      });
      this.scroll.add(translation);
      cursorY += translation.height + 20;

      if (this.poem.tip) {
        const tip = makeText(this, 0, cursorY, `小贴士：${wrapClassicText(this.poem.tip, 30)}`, {
          size: 15,
          color: S.gold,
          origin: [0, 0],
          align: 'left',
          wrap: TEXT_WIDTH,
          lineSpacing: 8,
        });
        this.scroll.add(tip);
        cursorY += tip.height + 8;
      }
    } else {
      if (!this._panelLines.aligned && this._panelLines.pinyinBlock) {
        const pinyinBlock = makeText(this, 0, cursorY, this._panelLines.pinyinBlock, {
          size: 14,
          color: S.inkFaint,
          origin: [0, 0],
          align: 'left',
          wrap: TEXT_WIDTH,
          lineSpacing: 6,
        });
        this.scroll.add(pinyinBlock);
        cursorY += pinyinBlock.height + 16;
      }

      this._panelLines.lines.forEach((line) => {
        if (this.pinyinOn && line.pinyin) {
          const pinyin = makeText(this, 0, cursorY, line.pinyin, {
            size: 14,
            color: S.inkFaint,
            origin: [0, 0],
            align: 'left',
            wrap: TEXT_WIDTH,
            lineSpacing: 4,
          });
          this.scroll.add(pinyin);
          cursorY += pinyin.height + 4;
        }

        const body = makeText(this, 0, cursorY, wrapClassicText(line.text, 20), {
          size: 24,
          color: S.ink,
          origin: [0, 0],
          align: 'left',
          wrap: TEXT_WIDTH,
          lineSpacing: 12,
        });
        this.scroll.add(body);
        cursorY += body.height + 16;
      });
    }

    this.scroll.layout(Math.max(cursorY, SCROLL.height), { reset: true });
  }

  _refreshTextButtons() {
    if (this.panelTitleText) {
      this.panelTitleText.setText(this.showTranslation ? '白话译文 · 分行阅读' : '古文原文 · 分行阅读');
    }
    if (this._pinyinBtn) {
      this._pinyinBtn.setLabel(this.pinyinOn ? '拼音：开' : '拼音：关');
      this._pinyinBtn.setVariant(this.pinyinOn ? 'soft' : 'secondary');
      this._pinyinBtn.setDisabled(this.showTranslation);
    }
    if (this._translateBtn) {
      this._translateBtn.setLabel(this.showTranslation ? '回到古文原文' : '看白话译文');
      this._translateBtn.setVariant(this.showTranslation ? 'soft' : 'gold');
    }
  }

  _togglePinyin() {
    if (this.showTranslation) return;
    this.pinyinOn = !this.pinyinOn;
    audio.playClick();
    this._refreshTextButtons();
    this._renderTextPanel();
  }

  _toggleTranslation() {
    this.showTranslation = !this.showTranslation;
    audio.playClick();
    this._refreshTextButtons();
    this._renderTextPanel();
  }

  // ---------------------------------------------------------
  // 右侧：题干 + 四个选项
  // ---------------------------------------------------------
  _buildQuizPanel() {
    createPaperPanel(this, {
      x: QUIZ_PANEL.x,
      y: QUIZ_PANEL.y,
      width: QUIZ_PANEL.width,
      height: QUIZ_PANEL.height,
      radius: 24,
      fill: C.paperSoft,
      fillAlpha: 0.97,
      depth: 900,
    });

    this.tagText = makeText(this, 650, 160, '', {
      size: 15,
      color: S.gold,
      origin: [0, 0.5],
    }).setDepth(1002);

    this.questionText = makeText(this, QUIZ_PANEL.x, 207, '', {
      size: 22,
      color: S.ink,
      origin: [0.5, 0.5],
      align: 'center',
      wrap: 560,
      lineSpacing: 10,
    }).setDepth(1002);

    this.feedbackText = makeText(this, OPTION.x, FEEDBACK_Y, '', {
      size: 16,
      color: S.inkSoft,
      origin: [0.5, 0],
      align: 'center',
      wrap: OPTION.width - 20,
      lineSpacing: 6,
    }).setDepth(1006);
  }

  // ---------------------------------------------------------
  // 底部：返回 / 提示 / 本局统计
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

    this.statusText = makeText(this, 640, 676, '', {
      size: 15,
      color: S.inkSoft,
      origin: [0, 0.5],
      align: 'left',
      wrap: 590,
      lineSpacing: 5,
    }).setDepth(1050);
  }

  // ---------------------------------------------------------
  // 出题
  // ---------------------------------------------------------
  _startQuestion(index) {
    if (!this.questions[index]) return false;

    this.questionIndex = index;
    this.question = this.questions[index];
    this._questionSolved = false;
    this.eliminated.clear();
    this._clearOptions();

    this.tagText.setText(
      `第 ${index + 1} / ${this.questions.length} 题　·　${this.question.tag}`,
    );
    this.questionText.setText(this.question.stem);

    this.question.options.forEach((option, optionIndex) => {
      const button = createButton(this, {
        x: OPTION.x,
        y: OPTION.ys[optionIndex],
        width: OPTION.width,
        height: OPTION.height,
        radius: 22,
        label: option.text,
        variant: 'secondary',
        fontSize: option.text.length > 18 ? 19 : 22,
        depth: 940,
        onClick: () => this._choose(optionIndex),
      });
      this.optionButtons.push(button);
    });

    this._setFeedback('读一读左边的古文，再选一个最合适的答案。');
    this._refreshHud();

    // 换题时短暂锁一下，避免上一题的连点误触新选项
    this.busy = true;
    this.time.delayedCall(240, () => {
      if (!this.scene.isActive()) return;
      this.busy = false;
      this._refreshHud();
    });
    return true;
  }

  _clearOptions() {
    this.optionButtons.forEach((button) => button?.destroy());
    this.optionButtons = [];
  }

  _canAnswer() {
    return Boolean(
      this.scene.isActive()
      && this.question
      && !this._solved
      && !this._resultShown
      && !this._leaving
      && !this._hintModalOpen
      && !this._questionSolved
      && !this.busy,
    );
  }

  // ---------------------------------------------------------
  // 作答
  // ---------------------------------------------------------
  _choose(index) {
    if (!this._canAnswer()) return;
    const option = this.question.options[index];
    const button = this.optionButtons[index];
    if (!option || !button || this.eliminated.has(index)) return;

    if (option.correct) {
      this._onCorrect(button);
      return;
    }

    // 答错：只给温和引导，不公布答案
    this.mistakes += 1;
    audio.playWrong();
    progress.addWrongRecord(this.poem.id);

    button.setLabel(`✕ ${option.text}`);
    button.setVariant('muted');
    button.setDisabled(true);
    this.eliminated.add(index);
    this._shakeOptions();

    this._setFeedback(
      `这一条不太像哦 · 已经记进错题书斋\n${this.question.guide}`,
      'wrong',
    );
    this._refreshHud();
    showToast(this, '这一条不太像哦，再读一读古文', { y: 330, tone: 'warn', duration: 1800 });
  }

  _onCorrect(button) {
    if (this._questionSolved || this._solved) return;
    this._questionSolved = true;
    audio.playCorrect();

    button.setVariant('correct');
    this.optionButtons.forEach((other) => {
      if (other && other !== button) other.setDisabled(true);
    });
    this._setFeedback(`答对啦！${this.question.explain}`, 'correct');
    this._refreshHud();

    this.time.delayedCall(QUESTION_DELAY, () => {
      if (!this.scene.isActive()) return;
      const next = this.questionIndex + 1;
      if (next < this.questions.length) {
        this._startQuestion(next);
      } else {
        this._handleSolved();
      }
    });
  }

  _setFeedback(text, tone = 'normal') {
    if (!this.feedbackText) return;
    const color = tone === 'correct' ? S.pineDeep : tone === 'wrong' ? S.peach : S.inkSoft;
    this.feedbackText.setText(text);
    this.feedbackText.setColor(color);
  }

  /** 答错时选项轻轻晃一下，比标红更温柔 */
  _shakeOptions() {
    const targets = this.optionButtons.filter(Boolean).map((button) => button.container);
    if (targets.length === 0) return;
    this.tweens.killTweensOf(targets);
    this.tweens.add({
      targets,
      x: { from: OPTION.x - 6, to: OPTION.x + 6 },
      duration: 80,
      yoyo: true,
      repeat: 2,
      ease: 'Sine.easeInOut',
      onComplete: () => targets.forEach((container) => container.setX(OPTION.x)),
    });
  }

  // ---------------------------------------------------------
  // 提示：只缩小选项范围
  // ---------------------------------------------------------
  _onHint() {
    if (!this._canAnswer() || this._hintModalOpen) return;

    const removable = this._hintRemovableCount();
    if (removable <= 0) {
      showToast(this, '这一题已经帮你排除到最少啦，慢慢读一读，自己选一条吧。', {
        y: 330,
        duration: 2000,
      });
      return;
    }

    if (this.freeHintLeft > 0) {
      this._hintModalOpen = true;
      this.showModal({
        title: '用一次温和提示？',
        sealText: '温',
        message: `温和模式本次还有 ${this.freeHintLeft} 次免费提示。\n帮你排除 1 个不太像的选项，不消耗毛笔，也不扣星星。`,
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
          this._refreshHud();
        },
      });
      return;
    }

    if (progress.getBrushCount() <= 0) {
      showToast(this, '毛笔用完啦，读完这段古文会再得到一支。', { y: 330, tone: 'warn' });
      return;
    }

    const brushRemove = Math.min(2, removable);
    this._hintModalOpen = true;
    this.showModal({
      title: '用一支毛笔换提示？',
      sealText: '笔',
      message: `毛笔还剩 ${progress.getBrushCount()} 支。\n用了之后，会先帮你收走 ${brushRemove} 个不太像的选项，\n本题最多只能拿到 2 颗星。`,
      actions: [
        { label: '先自己想想', variant: 'secondary' },
        { label: '用一支毛笔', variant: 'primary', onClick: () => this._applyHint(2, 'brush') },
      ],
      onClose: () => {
        this._hintModalOpen = false;
        this._refreshHud();
      },
    });
  }

  /** 仍可选择的错误选项数量（已排除 / 已点错的都不算） */
  _remainingWrongCount() {
    if (!this.question) return 0;
    return this.question.options.filter(
      (option, index) => !option.correct && !this.eliminated.has(index),
    ).length;
  }

  /** 本次提示最多能收走几条（始终保留 1 条错误项，不直接给答案） */
  _hintRemovableCount() {
    return Math.max(0, this._remainingWrongCount() - 1);
  }

  _applyHint(removeCount, source) {
    if (!this.question || this._solved || this._resultShown || this._questionSolved || this.busy) return;

    const allowed = Math.min(removeCount, this._hintRemovableCount());
    if (allowed <= 0) {
      showToast(this, '这一题已经帮你排除到最少啦，自己选一条试试。', { y: 330, duration: 1800 });
      return;
    }

    if (source === 'brush') {
      if (!progress.consumeBrush()) {
        showToast(this, '毛笔不够啦。', { y: 330, tone: 'warn' });
        return;
      }
      this.brushHints += 1;
      this.brushHintUsed = true;
    } else {
      if (this.freeHintLeft <= 0) return;
      this.freeHintLeft -= 1;
      this.freeHintsUsed += 1;
    }

    const removed = this._eliminateWrongOptions(allowed);
    audio.playPage();
    this._refreshHud();
    this._setFeedback(
      removed > 0
        ? `已收起 ${removed} 条不太像的选项，剩下的再读一读。`
        : '已经只剩最像的几条啦，选一条试试。',
    );
    if (removed > 0) {
      showToast(this, `收起了 ${removed} 条不太像的选项`, { y: 330, duration: 1600 });
    }
  }

  _eliminateWrongOptions(count) {
    if (!this.question) return 0;
    const candidates = this.question.options
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

  _refreshHud() {
    const brush = progress.getBrushCount();
    if (this.brushText) this.brushText.setText(`毛笔 × ${brush}`);

    if (this._hintBtn) {
      const hasFree = this.freeHintLeft > 0;
      this._hintBtn.setLabel(hasFree ? '提示 · 排除一项（免费）' : '毛笔提示 · 排除两项');
      this._hintBtn.setDisabled(
        !this._canAnswer()
        || this._hintRemovableCount() <= 0
        || (!hasFree && brush <= 0),
      );
    }

    if (this.statusText) {
      const lines = [
        `第 ${this.questionIndex + 1} / ${this.questions.length} 题　·　答错 ${this.mistakes} 次`,
        this.freeHintLeft > 0
          ? `毛笔 × ${brush}　·　温和提示 × ${this.freeHintLeft}`
          : `毛笔 × ${brush}　·　温和提示已用完`,
      ];
      this.statusText.setText(lines.join('\n'));
    }
  }

  // ---------------------------------------------------------
  // 结算（与现有玩法同一套）
  // ---------------------------------------------------------
  /** 错一次扣一星、用过毛笔再扣一星（免费提示不扣星），最低 1 星 */
  _calcStars() {
    const penalty = Math.min(2, this.mistakes) + (this.brushHintUsed ? 1 : 0);
    return Math.max(1, Math.min(3, 3 - penalty));
  }

  _handleSolved() {
    if (this._resultShown || this._solved) return;
    this._solved = true;
    const stars = this._calcStars();
    this.result = progress.markPoemComplete(this.poem.id, stars);

    console.info('[文言文意问答] 结算：', {
      poem: this.poem.title,
      questions: this.questions.length,
      stars,
      mistakes: this.mistakes,
      brushHints: this.brushHints,
      freeHintsUsed: this.freeHintsUsed,
      result: this.result,
    });

    if (!this.result) {
      showToast(this, '结算时没有找到这一篇，请回到地图重试。', { y: 330, tone: 'warn' });
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
        this.result.newCard ? '读懂了 · 诗卡入卷' : '又读懂啦 · 文意更通',
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

    // 原文 + 拼音 + 译文：可拖动阅读，长古文也不会撑破纸卡
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
      size: 19,
      color: S.ink,
      origin: [0, 0],
      align: 'left',
      wrap: 700,
      lineSpacing: 8,
    });
    scroll.add(fullText);
    cursorY += fullText.height + 6;

    const pinyin = makeText(this, 0, cursorY, this.poem.pinyin_text, {
      size: 13,
      color: S.inkFaint,
      origin: [0, 0],
      align: 'left',
      wrap: 700,
      lineSpacing: 5,
    });
    scroll.add(pinyin);
    cursorY += pinyin.height + 6;

    const translation = makeText(this, 0, cursorY, `白话译文：${this.poem.translation}`, {
      size: 15,
      color: S.pineDeep,
      origin: [0, 0],
      align: 'left',
      wrap: 700,
      lineSpacing: 6,
    });
    scroll.add(translation);
    cursorY += translation.height + 4;
    scroll.layout(cursorY);
    scroll.scrollToTop();

    root.add(
      makeText(
        this,
        GAME_WIDTH / 2,
        398,
        `共 ${this.questions.length} 题　·　答错 ${this.mistakes} 次　·　`
        + `毛笔提示 ${this.brushHints} 次　·　温和提示 ${this.freeHintsUsed} 次`,
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
      lines.push('✦ 一题没错、也没借毛笔，三星全收下');
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
      label: '再读一次',
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
    if (this._resultShown) {
      this._leaveToMap();
      return;
    }

    this._leaving = true;
    this.showModal({
      title: '先离开这一篇吗？',
      sealText: '问',
      message: '还有题目没有答完。\n离开后这一篇的进度不会保存，下次可以重新开始。',
      actions: [
        { label: '继续答题', variant: 'primary' },
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
