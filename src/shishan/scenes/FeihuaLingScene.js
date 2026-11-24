/**
 * FeihuaLingScene：人机对战飞花令（独立场景）
 * ------------------------------------------------------------
 * 玩法：
 *  1. 先在「诗台」挑一个关键字（月 / 山 / 水 / 春 / 花 ……），挑好就开局；
 *  2. 回合制：玩家先说一句带关键字的诗句，小书童（AI NPC）接一句，两人轮流，
 *     同一句诗不能重复；
 *  3. 题库以 poem_db.json 全库为主（课内 / 拓展分开标注，隐藏诗卡不参与，
 *     避免剧透），另配一小份常见名句补充 —— 否则「月」「春」这类字在现有
 *     8 首诗里只剩一句，根本对不起来；
 *  4. 每回合可用一次毛笔提示：直接把一句带关键字的候选诗句指给你；
 *     温和模式每局另有 2 次免费提示（不耗毛笔），挑战模式只能花毛笔；
 *  5. 想不出（认输）、说重复、诗句不含关键字、关键字不在指定字位 → 这一局落败；
 *     小书童凑不出可用诗句时算玩家赢；
 *  6. 简单版只校验「句子里有这个字」；进阶版要求关键字落在指定字位
 *     （例如「月」必须是第 3 个字）。版本与设置里的温和 / 挑战模式联动，
 *     场景里也能直接切换（切换后会重新开一局）；
 *  7. 不绑定任何单首诗的通关与星级，属于自由挑战玩法；结算后可以
 *     「换个关键字再来」（回到诗台）或「返回地图」。毛笔消耗走 ProgressManager。
 *
 * 复用：
 *  - BaseScene（背景、头部、吐司、弹窗、转场）
 *  - ProgressManager（getDifficulty / getBrushCount / consumeBrush / setDifficulty）
 *  - AudioManager（点击 / 翻页 / 答对 / 答错 / 解锁）
 *  - ui/components（按钮、纸卡、标签、文本、吐司、弹窗）、ui/background、ui/ScrollPanel
 *
 * 入口：
 *  - { keyword?, returnScene?, chapterId? }；开发预览：`?feihua=1`（可加 `&keyword=月`）
 *  - 不依赖、也不修改任何原有场景
 */

import { SCENES } from '../config/constants.js';
import { C, S } from '../config/theme.js';
import { dataManager, shuffle } from '../data/DataManager.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import { getDifficultyConfig } from '../config/difficulty.js';
import BaseScene from '../ui/BaseScene.js';
import {
  createButton,
  createPaperPanel,
  createTag,
  makeText,
  showToast,
} from '../ui/components.js';
import { addSeal, roundedRectPath } from '../ui/background.js';
import { ScrollPanel } from '../ui/ScrollPanel.js';

// ---------------------------------------------------------
// 布局（1280 × 720 设计分辨率）
// ---------------------------------------------------------
const TOP_Y = 128;
const LOBBY_PANEL = { x: 640, y: 384, width: 1100, height: 486 };
const CHIP = { width: 154, height: 66, xs: [205, 359, 513, 667, 821, 975], ys: [292, 368] };
const CHAT_PANEL = { x: 358, y: 377, width: 604, height: 480 };
const CHAT_SCROLL = { x: 78, y: 166, width: 560, height: 434 };
const STATUS_PANEL = { x: 957, y: 194, width: 534, height: 112 };
const CARD = { x: 957, width: 534, height: 74, ys: [316, 398, 480, 562] };
const FEEDBACK_Y = 630;
const BOTTOM_Y = 676;

const GENTLE_FREE_HINTS = 2; // 温和模式每局免费提示次数
const VALID_CANDIDATES = 3; // 每回合最多给 3 句合规候选
const TRAP_CANDIDATES = 1; // 再掺 1 句不合规的，让小朋友自己读清楚
const MIN_KEYWORD_SUPPLY = 6; // 至少 6 句才开放这个关键字
const MIN_POSITION_SUPPLY = 3; // 进阶版字位至少 3 句才敢用
const AI_THINK_DELAY = 900;
const NEXT_DELAY = 760;
const RESULT_DELAY = 460;

/** 可选关键字（全部在诗库里凑得出足够的句子） */
export const FEIHUA_KEYWORDS = ['月', '山', '水', '春', '花', '风', '云', '雪', '鸟', '人', '白', '江'];

/**
 * 常见名句补充库：只补 poem_db 里太少的单字（月 / 春 / 风 / 云 ……）。
 * 每句都注明出自哪首诗，气泡里会标成「名句」，和课内 / 拓展区分开。
 */
export const FEIHUA_EXTRA_BANK = [
  // 月
  { text: '床前明月光', title: '静夜思', author: '李白', dynasty: '唐' },
  { text: '举头望明月', title: '静夜思', author: '李白', dynasty: '唐' },
  { text: '举杯邀明月', title: '月下独酌', author: '李白', dynasty: '唐' },
  { text: '海上生明月', title: '望月怀远', author: '张九龄', dynasty: '唐' },
  { text: '明月松间照', title: '山居秋暝', author: '王维', dynasty: '唐' },
  { text: '月落乌啼霜满天', title: '枫桥夜泊', author: '张继', dynasty: '唐' },
  { text: '明月来相照', title: '竹里馆', author: '王维', dynasty: '唐' },
  { text: '二十四桥明月夜', title: '寄扬州韩绰判官', author: '杜牧', dynasty: '唐' },
  { text: '秦时明月汉时关', title: '出塞', author: '王昌龄', dynasty: '唐' },
  { text: '月是故乡明', title: '月夜忆舍弟', author: '杜甫', dynasty: '唐' },
  // 山
  { text: '白日依山尽', title: '登鹳雀楼', author: '王之涣', dynasty: '唐' },
  { text: '一览众山小', title: '望岳', author: '杜甫', dynasty: '唐' },
  { text: '山重水复疑无路', title: '游山西村', author: '陆游', dynasty: '宋' },
  { text: '青山遮不住', title: '菩萨蛮 · 书江西造口壁', author: '辛弃疾', dynasty: '宋' },
  { text: '两岸青山相对出', title: '望天门山', author: '李白', dynasty: '唐' },
  { text: '山光悦鸟性', title: '题破山寺后禅院', author: '常建', dynasty: '唐' },
  { text: '千山鸟飞绝', title: '江雪', author: '柳宗元', dynasty: '唐' },
  { text: '山外青山楼外楼', title: '题临安邸', author: '林升', dynasty: '宋' },
  // 水
  { text: '桃花潭水深千尺', title: '赠汪伦', author: '李白', dynasty: '唐' },
  { text: '碧水东流至此回', title: '望天门山', author: '李白', dynasty: '唐' },
  { text: '春来江水绿如蓝', title: '忆江南', author: '白居易', dynasty: '唐' },
  { text: '一水护田将绿绕', title: '书湖阴先生壁', author: '王安石', dynasty: '宋' },
  { text: '水光潋滟晴方好', title: '饮湖上初晴后雨', author: '苏轼', dynasty: '宋' },
  { text: '遥望洞庭山水翠', title: '望洞庭', author: '刘禹锡', dynasty: '唐' },
  // 春
  { text: '春风又绿江南岸', title: '泊船瓜洲', author: '王安石', dynasty: '宋' },
  { text: '春色满园关不住', title: '游园不值', author: '叶绍翁', dynasty: '宋' },
  { text: '春江水暖鸭先知', title: '惠崇春江晚景', author: '苏轼', dynasty: '宋' },
  { text: '当春乃发生', title: '春夜喜雨', author: '杜甫', dynasty: '唐' },
  { text: '春风花草香', title: '绝句', author: '杜甫', dynasty: '唐' },
  { text: '春风吹又生', title: '赋得古原草送别', author: '白居易', dynasty: '唐' },
  { text: '二月春风似剪刀', title: '咏柳', author: '贺知章', dynasty: '唐' },
  { text: '春潮带雨晚来急', title: '滁州西涧', author: '韦应物', dynasty: '唐' },
  { text: '春风送暖入屠苏', title: '元日', author: '王安石', dynasty: '宋' },
  { text: '春去花还在', title: '画', author: '', dynasty: '唐' },
  // 花
  { text: '人间四月芳菲尽', title: '大林寺桃花', author: '白居易', dynasty: '唐' },
  { text: '山寺桃花始盛开', title: '大林寺桃花', author: '白居易', dynasty: '唐' },
  { text: '还来就菊花', title: '过故人庄', author: '孟浩然', dynasty: '唐' },
  { text: '千树万树梨花开', title: '白雪歌送武判官归京', author: '岑参', dynasty: '唐' },
  { text: '飞入菜花无处寻', title: '宿新市徐公店', author: '杨万里', dynasty: '宋' },
  { text: '牧童遥指杏花村', title: '清明', author: '杜牧', dynasty: '唐' },
  { text: '花重锦官城', title: '春夜喜雨', author: '杜甫', dynasty: '唐' },
  { text: '竹外桃花三两枝', title: '惠崇春江晚景', author: '苏轼', dynasty: '宋' },
  { text: '花间一壶酒', title: '月下独酌', author: '李白', dynasty: '唐' },
  // 风
  { text: '风吹草低见牛羊', title: '敕勒歌', author: '', dynasty: '北朝' },
  { text: '大风起兮云飞扬', title: '大风歌', author: '刘邦', dynasty: '汉' },
  { text: '风急天高猿啸哀', title: '登高', author: '杜甫', dynasty: '唐' },
  { text: '随风潜入夜', title: '春夜喜雨', author: '杜甫', dynasty: '唐' },
  { text: '春风不度玉门关', title: '凉州词', author: '王之涣', dynasty: '唐' },
  // 云
  { text: '云深不知处', title: '寻隐者不遇', author: '贾岛', dynasty: '唐' },
  { text: '千里黄云白日曛', title: '别董大', author: '高适', dynasty: '唐' },
  { text: '白云千载空悠悠', title: '黄鹤楼', author: '崔颢', dynasty: '唐' },
  { text: '不畏浮云遮望眼', title: '登飞来峰', author: '王安石', dynasty: '宋' },
  { text: '孤云独去闲', title: '独坐敬亭山', author: '李白', dynasty: '唐' },
  { text: '云想衣裳花想容', title: '清平调', author: '李白', dynasty: '唐' },
  // 雪
  { text: '独钓寒江雪', title: '江雪', author: '柳宗元', dynasty: '唐' },
  { text: '遥知不是雪', title: '梅花', author: '王安石', dynasty: '宋' },
  { text: '窗含西岭千秋雪', title: '绝句', author: '杜甫', dynasty: '唐' },
  { text: '燕山雪花大如席', title: '北风行', author: '李白', dynasty: '唐' },
  { text: '夜深知雪重', title: '夜雪', author: '白居易', dynasty: '唐' },
  { text: '天山雪后海风寒', title: '从军北征', author: '李益', dynasty: '唐' },
  { text: '五月天山雪', title: '塞下曲', author: '李白', dynasty: '唐' },
  // 鸟
  { text: '月出惊山鸟', title: '鸟鸣涧', author: '王维', dynasty: '唐' },
  { text: '众鸟高飞尽', title: '独坐敬亭山', author: '李白', dynasty: '唐' },
  { text: '人来鸟不惊', title: '画', author: '', dynasty: '唐' },
  { text: '鸟宿池边树', title: '题李凝幽居', author: '贾岛', dynasty: '唐' },
  { text: '恨别鸟惊心', title: '春望', author: '杜甫', dynasty: '唐' },
  { text: '鸟向檐上飞', title: '山中杂诗', author: '吴均', dynasty: '南朝' },
  // 人
  { text: '深林人不知', title: '竹里馆', author: '王维', dynasty: '唐' },
  { text: '对影成三人', title: '月下独酌', author: '李白', dynasty: '唐' },
  { text: '人闲桂花落', title: '鸟鸣涧', author: '王维', dynasty: '唐' },
  { text: '野渡无人舟自横', title: '滁州西涧', author: '韦应物', dynasty: '唐' },
  { text: '人生自古谁无死', title: '过零丁洋', author: '文天祥', dynasty: '宋' },
  // 白
  { text: '白头搔更短', title: '春望', author: '杜甫', dynasty: '唐' },
  { text: '白雪却嫌春色晚', title: '春雪', author: '韩愈', dynasty: '唐' },
  { text: '白日放歌须纵酒', title: '闻官军收河南河北', author: '杜甫', dynasty: '唐' },
  // 江
  { text: '千里江陵一日还', title: '早发白帝城', author: '李白', dynasty: '唐' },
  { text: '一江春水向东流', title: '虞美人', author: '李煜', dynasty: '五代' },
  { text: '江南可采莲', title: '江南', author: '', dynasty: '汉' },
  { text: '江枫渔火对愁眠', title: '枫桥夜泊', author: '张继', dynasty: '唐' },
  { text: '江碧鸟逾白', title: '绝句二首', author: '杜甫', dynasty: '唐' },
  { text: '江南好', title: '忆江南', author: '白居易', dynasty: '唐' },
];

// 去标点 / 引号 / 空白，只留汉字（用于比较与字位判断）
const BARE_MARKS = /[“”"'‘’「」『』（）()【】〈〉《》、，。！？；：,.!?;:\s·]/g;
const LINE_ENDERS = '，。！？；：';

/** 去掉标点引号，只保留内容 */
export function bareChars(text) {
  return String(text || '').replace(BARE_MARKS, '');
}

/**
 * 把一首（或一篇）诗拆成可以单独说出口的句子。
 * 按「，。！？；：」断句，去掉标点，丢弃不足 3 字的碎片（咏鹅开头那三个「鹅」）。
 */
export function splitFeihuaLines(text) {
  const raw = [];
  let buffer = '';
  for (const char of String(text || '')) {
    buffer += char;
    if (LINE_ENDERS.includes(char)) {
      raw.push(buffer);
      buffer = '';
    }
  }
  if (buffer.trim()) raw.push(buffer);
  return raw.map((segment) => bareChars(segment)).filter((line) => line.length >= 3);
}

/**
 * 构建全局飞花令题库。
 * @param {Array} poems poem_db 全库
 * @param {Array} extras 名句补充库
 * @param {object} options { includeHidden }
 */
export function buildFeihuaPool(poems = dataManager.getAllPoems(), extras = FEIHUA_EXTRA_BANK, options = {}) {
  const { includeHidden = false } = options;
  const pool = [];
  const seen = new Set();

  const push = (entry) => {
    const chars = bareChars(entry.text);
    if (chars.length < 3 || seen.has(chars)) return;
    seen.add(chars);
    pool.push({ ...entry, text: entry.text, chars });
  };

  poems.forEach((poem) => {
    if (!includeHidden && poem.is_hidden) return;
    const source = poem.type === 'core' ? 'core' : 'extend';
    splitFeihuaLines(poem.full_text).forEach((line) => {
      push({
        text: line,
        source,
        sourceLabel: source === 'core' ? '课内' : '拓展',
        title: poem.title,
        author: poem.author || '',
        dynasty: poem.dynasty || '',
        poemId: poem.id,
      });
    });
  });

  extras.forEach((entry) => {
    push({
      text: entry.text,
      source: 'extra',
      sourceLabel: '名句',
      title: entry.title || '',
      author: entry.author || '',
      dynasty: entry.dynasty || '',
      poemId: null,
    });
  });

  return pool;
}

/** 题库里带某个关键字的全部句子 */
export function filterByKeyword(pool, keyword) {
  const key = String(keyword || '');
  if (!key) return [];
  return pool.filter((line) => line.chars.includes(key));
}

/** 关键字是否满足校验条件（position = 0 表示简单版：句中有字即可） */
export function matchesFeihuaRule(text, { keyword, position = 0 } = {}) {
  const chars = bareChars(text);
  if (!chars.includes(keyword)) return false;
  if (position > 0 && chars.indexOf(keyword) + 1 !== position) return false;
  return true;
}

/**
 * 挑一个「句子最多」的字位，供进阶版使用。
 * 找不到 3 句以上就返回 position = 0（退回简单版）。
 */
export function pickFeihuaPosition(pool, keyword, minSupply = MIN_POSITION_SUPPLY) {
  const counts = new Map();
  filterByKeyword(pool, keyword).forEach((line) => {
    const position = line.chars.indexOf(keyword) + 1;
    counts.set(position, (counts.get(position) || 0) + 1);
  });

  let best = { position: 0, count: 0 };
  counts.forEach((count, position) => {
    if (count > best.count) best = { position, count };
  });
  return best.count >= minSupply ? best : { position: 0, count: 0 };
}

/** 可供选择的关键字（句数够多才开放） */
export function getFeihuaKeywords(pool, minSupply = MIN_KEYWORD_SUPPLY) {
  return FEIHUA_KEYWORDS.filter((keyword) => filterByKeyword(pool, keyword).length >= minSupply);
}

/**
 * 把 said 里的任意一条记录统一成「去掉标点的句子」。
 * 场景里存的是 { side, line, round }，纯函数测试里可能直接传字符串或 { text }，
 * 这里一起兼容，避免去重时取到 undefined 而失效。
 * @param {string|{text?:string, line?:string|{text?:string}}} item
 * @returns {string}
 */
export function saidCharsOf(item) {
  if (!item) return '';
  if (typeof item === 'string') return bareChars(item);
  if (typeof item.text === 'string') return bareChars(item.text);
  if (typeof item.line === 'string') return bareChars(item.line);
  if (item.line && typeof item.line.text === 'string') return bareChars(item.line.text);
  return '';
}

/** 把 said 归一化成「已说过句子」的集合 */
export function saidSetOf(said = []) {
  const set = new Set();
  (Array.isArray(said) ? said : []).forEach((item) => {
    const chars = saidCharsOf(item);
    if (chars) set.add(chars);
  });
  return set;
}

/**
 * 判定一句诗是否合格。
 * @returns {{ok: boolean, reason: 'ok'|'empty'|'repeat'|'keyword'|'position'}}
 */
export function judgeFeihuaLine(text, { keyword, position = 0, said = [] } = {}) {
  const chars = bareChars(text);
  if (chars.length < 2) return { ok: false, reason: 'empty' };
  if (saidSetOf(said).has(chars)) return { ok: false, reason: 'repeat' };
  if (!chars.includes(keyword)) return { ok: false, reason: 'keyword' };
  if (position > 0 && chars.indexOf(keyword) + 1 !== position) return { ok: false, reason: 'position' };
  return { ok: true, reason: 'ok' };
}

/** AI 挑一句还没说过、且符合规则的诗句；没有就返回 null */
export function pickFeihuaLine(pool, { keyword, position = 0, said = [] } = {}, random = Math.random) {
  const saidChars = saidSetOf(said);
  const valid = pool.filter(
    (line) => !saidChars.has(line.chars) && matchesFeihuaRule(line.text, { keyword, position }),
  );
  if (valid.length === 0) return null;
  return valid[Math.min(valid.length - 1, Math.floor(random() * valid.length))];
}

/**
 * 给玩家发一手「诗句卡」：3 句合规 + 1 句不合规（进阶版就是字位不对的）。
 * 让小朋友自己读一读、比一比，把飞花令的校验真正玩出来。
 * 合规卡一定是「带关键字（进阶版还要字位对）且这一局还没说过」的句子，
 * 所以在还有库存时，这一手至少会给出 1 句能安全说出口的答案。
 */
export function buildFeihuaCandidates(pool, options = {}) {
  const {
    keyword,
    position = 0,
    said = [],
    validCount = VALID_CANDIDATES,
    trapCount = TRAP_CANDIDATES,
  } = options;

  const saidChars = saidSetOf(said);
  const remaining = pool.filter((line) => !saidChars.has(line.chars));
  const valid = remaining.filter((line) => matchesFeihuaRule(line.text, { keyword, position }));
  const traps = remaining.filter((line) => !matchesFeihuaRule(line.text, { keyword, position }));

  const picked = shuffle(valid)
    .slice(0, validCount)
    .map((line) => ({ line, ok: true }));

  // 进阶版的陷阱优先挑「有这个字、但字位不对」的句子，让小朋友比一比字位
  const nearTraps = position > 0 ? traps.filter((line) => line.chars.includes(keyword)) : [];
  shuffle(nearTraps.length >= trapCount ? nearTraps : traps)
    .slice(0, trapCount)
    .forEach((line) => picked.push({ line, ok: false }));

  return { candidates: shuffle(picked), validLeft: valid.length };
}

export default class FeihuaLingScene extends BaseScene {
  constructor() {
    super(SCENES.FEIHUA_LING);
  }

  // ---------------------------------------------------------
  // 生命周期
  // ---------------------------------------------------------
  init(data = {}) {
    this.returnScene = data.returnScene || null;
    this.chapterId = Number(data.chapterId) || 1;
    this.requestedKeyword = typeof data.keyword === 'string' ? data.keyword.trim() : '';

    this.phase = 'lobby'; // lobby 诗台 | playing 对战中 | over 已结算
    this.busy = false;
    this._leaving = false;
    this._modalOpen = false;
    this._resultShown = false;
    this._navigating = false;

    this.keyword = '';
    this.round = 1;
    this.said = []; // [{ side, line, round }]
    this.playerCount = 0;
    this.aiCount = 0;
    this.sourceCount = { core: 0, extend: 0, extra: 0 };
    this.brushHints = 0;
    this.freeHintsUsed = 0;
    this.freeHintsLeft = 0;
    this.hintUsedThisRound = false;
    this.turn = 'player';
    this.matchOver = false;
    this.winner = null;
    this.loseReason = '';
    this.rulePosition = 0;
    this.ruleFallback = false;

    this._cards = [];
    this._cardItems = [];
    this._lobbyObjects = [];
    this._lobbyButtons = [];
    this.chat = null;
    this.chatCursor = 8;
  }

  create() {
    this.prepareScene();
    this.addBackground('peach', { petals: true });
    this.addGrain(0.1);
    audio.playBgm('level');

    this.difficulty = getDifficultyConfig(progress.getDifficulty());
    this.advanced = !this.difficulty.gentleNudge; // 温和 → 简单版；挑战 → 进阶版
    this.pool = buildFeihuaPool();
    this.availableKeywords = getFeihuaKeywords(this.pool);
    this.keywordPool = this.availableKeywords.length > 0 ? this.availableKeywords : FEIHUA_KEYWORDS;

    this.addHeader({
      title: '飞花令',
      subtitle: '和小书童轮流说带关键字的诗句 · 说重复、想不出就输一局',
      backLabel: '返回地图',
      onBack: () => this._requestLeave(),
    });

    this._buildTopBar();
    this._refreshHud();

    if (this.requestedKeyword && this.keywordPool.includes(this.requestedKeyword)) {
      this._startMatch(this.requestedKeyword);
    } else {
      this._buildLobby();
      if (this.requestedKeyword) {
        this.showToast(`「${this.requestedKeyword}」凑不出一局，先挑一个别的字吧。`, {
          y: 660,
          tone: 'warn',
          duration: 2200,
        });
      }
    }

    audio.playPage();
    console.info('[飞花令] 题库：', this.pool.length, '句 · 可选关键字：', this.availableKeywords.join('、'));
  }

  get modeLabel() {
    return this.advanced ? '挑战模式 · 进阶版' : '温和模式 · 简单版';
  }

  // ---------------------------------------------------------
  // 顶栏（两个阶段共用）
  // ---------------------------------------------------------
  _buildTopBar() {
    this._trackLobby(addSeal(this, 78, TOP_Y, '令', 36, C.peachDeep).setDepth(910));

    this.keywordText = makeText(this, 110, TOP_Y, '', {
      size: 25,
      color: S.ink,
      origin: [0, 0.5],
    }).setDepth(911);

    this.ruleText = makeText(this, 400, TOP_Y, '', {
      size: 16,
      color: S.inkSoft,
      origin: [0, 0.5],
      wrap: 210,
    }).setDepth(911);

    this.roundText = makeText(this, 640, TOP_Y, '', {
      size: 16,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(911);

    this.scoreText = makeText(this, 790, TOP_Y, '', {
      size: 16,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(911);

    this.brushText = makeText(this, 990, TOP_Y, '', {
      size: 16,
      color: S.gold,
      origin: [0, 0.5],
    }).setDepth(911);

    this.modeButton = createButton(this, {
      x: 1155,
      y: TOP_Y,
      width: 190,
      height: 46,
      radius: 20,
      label: '切到温和版',
      fontSize: 15,
      variant: 'soft',
      depth: 912,
      onClick: () => this._onSwitchMode(),
    });
  }

  // ---------------------------------------------------------
  // 诗台：挑关键字
  // ---------------------------------------------------------
  _buildLobby() {
    const panel = createPaperPanel(this, {
      x: LOBBY_PANEL.x,
      y: LOBBY_PANEL.y,
      width: LOBBY_PANEL.width,
      height: LOBBY_PANEL.height,
      radius: 30,
      fill: C.paperSoft,
      fillAlpha: 0.97,
      depth: 900,
    });
    this._trackLobby(panel);

    this._trackLobby(
      addSeal(this, LOBBY_PANEL.x - LOBBY_PANEL.width / 2 + 56, LOBBY_PANEL.y - LOBBY_PANEL.height / 2 + 54, '台', 40, C.pineDeep)
        .setDepth(902),
    );

    this._trackLobby(
      makeText(this, 640, 186, '挑一个关键字，开始飞花令', {
        size: 26,
        color: S.ink,
      }).setDepth(902),
    );

    this._trackLobby(
      makeText(this, 640, 222, '诗句来自 poem_db 的课内、拓展篇目，再加一小份常见名句。同一个字说的人越多，这一局就越长。', {
        size: 15,
        color: S.inkSoft,
        wrap: 940,
      }).setDepth(902),
    );

    this.keywordPool.forEach((keyword, index) => {
      const count = filterByKeyword(this.pool, keyword).length;
      const chip = createButton(this, {
        x: CHIP.xs[index % CHIP.xs.length],
        y: CHIP.ys[Math.floor(index / CHIP.xs.length)] || CHIP.ys[CHIP.ys.length - 1],
        width: CHIP.width,
        height: CHIP.height,
        radius: 20,
        label: keyword,
        subLabel: `${count} 句`,
        fontSize: 26,
        subFontSize: 13,
        variant: 'secondary',
        depth: 920,
        onClick: () => this._startMatch(keyword),
      });
      this._lobbyButtons.push(chip);
    });

    this._trackLobby(
      createTag(this, 640, 428, `当前：${this.modeLabel}`, {
        fill: C.pineLight,
        textColor: S.pineDeep,
        fontSize: 16,
        height: 38,
        paddingX: 24,
        depth: 912,
      }).container,
    );

    this._lobbyButtons.push(
      createButton(this, {
        x: 400,
        y: 492,
        width: 320,
        height: 56,
        radius: 22,
        label: '切换温和 / 挑战',
        fontSize: 18,
        variant: 'soft',
        depth: 921,
        onClick: () => this._onSwitchMode(),
      }),
    );

    this._lobbyButtons.push(
      createButton(this, {
        x: 880,
        y: 492,
        width: 320,
        height: 56,
        radius: 22,
        label: '随机关键字 · 开始',
        fontSize: 18,
        variant: 'gold',
        depth: 921,
        onClick: () => this._startMatch(this.keywordPool[Math.floor(Math.random() * this.keywordPool.length)]),
      }),
    );

    this._trackLobby(
      makeText(this, 640, 560, `每回合可以用一次毛笔提示 · ${this.advanced ? '挑战版只能花毛笔' : `温和版每局另有 ${GENTLE_FREE_HINTS} 次免费提示`}`, {
        size: 15,
        color: S.gold,
        wrap: 900,
      }).setDepth(902),
    );

    this._lobbyButtons.push(
      createButton(this, {
        x: 170,
        y: BOTTOM_Y,
        width: 220,
        height: 60,
        radius: 22,
        label: '返回地图',
        fontSize: 19,
        variant: 'secondary',
        depth: 921,
        onClick: () => this._requestLeave(),
      }),
    );
  }

  _trackLobby(object) {
    if (object) this._lobbyObjects.push(object);
    return object;
  }

  _clearLobby() {
    this._lobbyButtons.forEach((button) => button && button.destroy && button.destroy());
    this._lobbyButtons = [];
    this._lobbyObjects.forEach((object) => object && object.destroy && object.destroy());
    this._lobbyObjects = [];
  }

  // ---------------------------------------------------------
  // 对局界面
  // ---------------------------------------------------------
  _startMatch(keyword) {
    if (this.phase !== 'lobby' || this.matchOver) return;

    this._clearLobby();
    this.keyword = keyword;
    this.phase = 'playing';
    this.round = 1;
    this.said = [];
    this.playerCount = 0;
    this.aiCount = 0;
    this.sourceCount = { core: 0, extend: 0, extra: 0 };
    this.brushHints = 0;
    this.freeHintsUsed = 0;
    this.freeHintsLeft = this.difficulty.gentleNudge ? GENTLE_FREE_HINTS : 0;
    this.hintUsedThisRound = false;
    this.busy = false;
    this.turn = 'player';
    this.matchOver = false;
    this.winner = null;
    this.loseReason = '';

    const best = this.advanced ? pickFeihuaPosition(this.pool, keyword) : { position: 0, count: 0 };
    this.rulePosition = best.position;
    this.ruleFallback = this.advanced && best.position === 0;

    this._buildPlaying();
    this._pushSystem(`关键字「${keyword}」 · 第 1 回合`);
    this._startPlayerTurn();
    audio.playPage();
  }

  _buildPlaying() {
    // 左：对诗记录（可滚动对话气泡）
    createPaperPanel(this, {
      x: CHAT_PANEL.x,
      y: CHAT_PANEL.y,
      width: CHAT_PANEL.width,
      height: CHAT_PANEL.height,
      radius: 26,
      fill: C.paperSoft,
      fillAlpha: 0.96,
      depth: 900,
    });

    makeText(this, 78, 148, '对诗记录', {
      size: 16,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(911);

    makeText(this, 640 - 44, 148, '上下拖动可以翻看', {
      size: 13,
      color: S.inkFaint,
      origin: [1, 0.5],
    }).setDepth(911);

    this.chat = new ScrollPanel(this, {
      x: CHAT_SCROLL.x,
      y: CHAT_SCROLL.y,
      width: CHAT_SCROLL.width,
      height: CHAT_SCROLL.height,
      radius: 18,
      depth: 930,
    });
    this.chatCursor = 8;

    // 右：回合状态卡
    createPaperPanel(this, {
      x: STATUS_PANEL.x,
      y: STATUS_PANEL.y,
      width: STATUS_PANEL.width,
      height: STATUS_PANEL.height,
      radius: 22,
      fill: C.paperSoft,
      fillAlpha: 0.96,
      depth: 900,
    });

    this.statusName = makeText(this, 700, 166, '轮到你说了', {
      size: 22,
      color: S.pineDeep,
      origin: [0, 0.5],
    }).setDepth(911);

    this.statusHint = makeText(this, 700, 202, '', {
      size: 16,
      color: S.inkSoft,
      origin: [0, 0],
      wrap: 510,
      lineSpacing: 6,
    }).setDepth(911);

    this.statusStat = makeText(this, 700, 234, '', {
      size: 14,
      color: S.inkFaint,
      origin: [0, 0.5],
    }).setDepth(911);

    makeText(this, 700, 268, '点一张诗句卡说出去 ——', {
      size: 15,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(911);

    this.feedbackText = makeText(this, 640, FEEDBACK_Y, '', {
      size: 16,
      color: S.inkSoft,
      wrap: 1140,
      align: 'center',
    }).setDepth(950);

    this.hintButton = createButton(this, {
      x: 470,
      y: BOTTOM_Y,
      width: 320,
      height: 60,
      radius: 22,
      label: '毛笔提示 · 想一句',
      fontSize: 18,
      variant: 'gold',
      depth: 940,
      onClick: () => this._onHint(),
    });

    this.resignButton = createButton(this, {
      x: 840,
      y: BOTTOM_Y,
      width: 340,
      height: 60,
      radius: 22,
      label: '我说不出 · 认输',
      fontSize: 18,
      variant: 'secondary',
      depth: 940,
      onClick: () => this._onResign(),
    });

    createButton(this, {
      x: 170,
      y: BOTTOM_Y,
      width: 220,
      height: 60,
      radius: 22,
      label: '返回地图',
      fontSize: 19,
      variant: 'secondary',
      depth: 940,
      onClick: () => this._requestLeave(),
    });
  }

  // ---------------------------------------------------------
  // 回合
  // ---------------------------------------------------------
  _startPlayerTurn() {
    if (this.matchOver || this.phase !== 'playing') return;

    this.turn = 'player';
    this.busy = true;
    this.hintUsedThisRound = false;
    this._clearCards();

    const { candidates, validLeft } = buildFeihuaCandidates(this.pool, {
      keyword: this.keyword,
      position: this.rulePosition,
      said: this._saidTexts(),
    });

    if (!candidates.some((item) => item.ok) || validLeft <= 0) {
      this._endMatch('ai', 'exhaust');
      return;
    }

    this._buildCards(candidates);
    this._setTurnStatus();
    this._setFeedback(`读一读，挑一句带「${this.keyword}」、还没说过的诗句。`);
    this.busy = false;
    this._refreshHud();
  }

  _buildCards(candidates) {
    this._cardItems = candidates;
    this._cards = candidates.map((item, index) => createButton(this, {
      x: CARD.x,
      y: CARD.ys[Math.min(index, CARD.ys.length - 1)],
      width: CARD.width,
      height: CARD.height,
      radius: 18,
      label: item.line.text,
      subLabel: this._lineMeta(item.line),
      fontSize: 19,
      subFontSize: 12,
      variant: 'secondary',
      depth: 940,
      onClick: () => this._onPickCard(index),
    }));
  }

  _clearCards() {
    this._cards.forEach((card) => card && card.destroy && card.destroy());
    this._cards = [];
    this._cardItems = [];
  }

  _onPickCard(index) {
    if (!this._canAct()) return;
    const item = this._cardItems[index];
    if (!item) return;

    const judge = judgeFeihuaLine(item.line.text, {
      keyword: this.keyword,
      position: this.rulePosition,
      said: this._saidTexts(),
    });

    if (!judge.ok) {
      this.busy = true;
      this._cards.forEach((card) => card.setDisabled(true));
      this.said.push({ side: 'player', line: item.line, round: this.round, foul: true });
      this._pushBubble({
        side: 'player',
        line: item.line,
        note: this._reasonMessage(judge.reason),
        tone: 'foul',
      });
      this._setFeedback(this._reasonMessage(judge.reason), 'warn');
      this._refreshHud();
      this._endMatch('ai', judge.reason);
      return;
    }

    this.busy = true;
    this._cards.forEach((card) => card.setDisabled(true));
    this.said.push({ side: 'player', line: item.line, round: this.round });
    this.playerCount += 1;
    this.sourceCount[item.line.source] += 1;
    this._pushBubble({ side: 'player', line: item.line });
    this._setFeedback('接上啦！这句说得漂亮。', 'correct');
    this._refreshHud();
    audio.playCorrect();

    this.time.delayedCall(NEXT_DELAY, () => this._startAiTurn());
  }

  _startAiTurn() {
    if (this.matchOver || this.phase !== 'playing') return;

    this.turn = 'ai';
    this.busy = true;
    this._setTurnStatus();
    this._setFeedback(`小书童正在想带「${this.keyword}」的诗句……`);
    this._refreshHud();

    this.time.delayedCall(AI_THINK_DELAY, () => {
      if (this.matchOver || this.phase !== 'playing') return;

      const line = pickFeihuaLine(this.pool, {
        keyword: this.keyword,
        position: this.rulePosition,
        said: this._saidTexts(),
      });

      if (!line) {
        this._setFeedback('小书童想不出下一句了……', 'correct');
        this._endMatch('player', 'ai_stuck');
        return;
      }

      this.said.push({ side: 'ai', line, round: this.round });
      this.aiCount += 1;
      this.sourceCount[line.source] += 1;
      this._pushBubble({ side: 'ai', line });
      this._setFeedback(`小书童接上了「${line.text}」。轮到你了！`, 'correct');
      audio.playPage();
      this._refreshHud();

      this.time.delayedCall(NEXT_DELAY, () => {
        if (this.matchOver || this.phase !== 'playing') return;
        this.round += 1;
        this._pushSystem(`第 ${this.round} 回合 · 轮到你`);
        this._startPlayerTurn();
      });
    });
  }

  _canAct() {
    return this.phase === 'playing'
      && !this.matchOver
      && this.turn === 'player'
      && !this.busy
      && !this._modalOpen;
  }

  _saidTexts() {
    return this.said.map((entry) => entry.line.text);
  }

  _lineMeta(line) {
    const author = line.author && !String(line.author).startsWith('《') ? ` ${line.author}` : '';
    return `${line.sourceLabel} ·《${line.title}》${author}`;
  }

  _reasonMessage(reason) {
    switch (reason) {
      case 'repeat':
        return `这一句刚才已经说过啦，飞花令里同一句不能说两遍。`;
      case 'keyword':
        return `这一句里没有「${this.keyword}」哦，要说带关键字的诗句。`;
      case 'position':
        return `「${this.keyword}」要落在第 ${this.rulePosition} 个字，这一句差了一点点。`;
      case 'empty':
        return '还没说出完整的诗句呢。';
      case 'exhaust':
        return `诗库里带「${this.keyword}」的句子都被说完了，这一局先到这儿。`;
      case 'resign':
        return '这一轮你说了「我说不出」，认输也是飞花令的一部分。';
      case 'ai_stuck':
        return `小书童想不出带「${this.keyword}」的句子了，这一局你接得漂亮！`;
      default:
        return '这一轮接不上啦，下次再来。';
    }
  }

  // ---------------------------------------------------------
  // 提示 / 认输 / 切换难度
  // ---------------------------------------------------------
  _onHint() {
    if (!this._canAct()) return;
    if (this.hintUsedThisRound) {
      this.showToast('这一回合已经提示过啦，下一回合再来。', { y: 660, duration: 1700 });
      return;
    }

    // 只提示「真能说出口」的那张卡：带关键字（进阶版还要字位对）且这一局没说过
    const saidTexts = this._saidTexts();
    const index = this._cardItems.findIndex((item) => (
      judgeFeihuaLine(item.line.text, {
        keyword: this.keyword,
        position: this.rulePosition,
        said: saidTexts,
      }).ok
    ));
    if (index < 0) {
      this.hintUsedThisRound = true;
      this._setFeedback('这一手没有能用的句子，这一局诗库已经接不上了。', 'warn');
      this.showToast('这一手没有能用的句子，点「认输这一局」换一局吧。', { y: 660, tone: 'warn', duration: 2100 });
      this._refreshHud();
      return;
    }

    const useFree = this.freeHintsLeft > 0;
    if (!useFree && progress.getBrushCount() <= 0) {
      this.showToast('毛笔用完啦，先自己想一想。', { y: 660, tone: 'warn', duration: 1900 });
      return;
    }

    if (useFree) {
      this.freeHintsLeft -= 1;
      this.freeHintsUsed += 1;
    } else {
      progress.consumeBrush();
      this.brushHints += 1;
    }

    this.hintUsedThisRound = true;
    const card = this._cards[index];
    if (card) card.setVariant('gold');
    const text = this._cardItems[index].line.text;
    const ruleNote = this.rulePosition > 0 ? `（第 ${this.rulePosition} 个字就是它）` : '';
    this._setFeedback(
      `提示：这一句带「${this.keyword}」${ruleNote}，而且还没说过 ——「${text}」。`
        + `${useFree ? '（本次免费）' : '（用了一支毛笔）'}`,
      'hint',
    );
    audio.playPage();
    this._refreshHud();
  }

  _onResign() {
    if (!this._canAct() || this._modalOpen) return;

    this._modalOpen = true;
    this.showModal({
      title: '这一局要先认输吗？',
      sealText: '问',
      message: '飞花令里说不出就要认输哦。\n认输后这一局结束，回到诗台可以重新挑关键字。',
      actions: [
        { label: '再想想', variant: 'primary' },
        {
          label: '认输这一局',
          variant: 'secondary',
          onClick: () => {
            this._modalOpen = false;
            this._endMatch('ai', 'resign');
          },
        },
      ],
      onClose: () => {
        this._modalOpen = false;
        this._refreshHud();
      },
    });
  }

  _onSwitchMode() {
    if (this._modalOpen || this._resultShown) return;

    this._modalOpen = true;
    const next = this.advanced ? 'gentle' : 'challenge';
    const nextLabel = next === 'gentle' ? '温和模式（简单版）' : '挑战模式（进阶版）';

    this.showModal({
      title: `切换到${nextLabel}？`,
      sealText: '设',
      message: next === 'gentle'
        ? '温和模式只要句子里有关键字就算接上，每局还有 2 次免费提示。\n切换后这一局会重新开始。'
        : '挑战模式要求关键字落在指定的字位上，每局只能靠毛笔提示。\n切换后这一局会重新开始。',
      actions: [
        { label: '保持现在', variant: 'secondary' },
        {
          label: '切换并重来',
          variant: 'primary',
          onClick: () => {
            this._modalOpen = false;
            progress.setDifficulty(next);
            audio.playClick();
            this.scene.restart({ returnScene: this.returnScene, chapterId: this.chapterId });
          },
        },
      ],
      onClose: () => {
        this._modalOpen = false;
      },
    });
  }

  // ---------------------------------------------------------
  // 结算
  // ---------------------------------------------------------
  _endMatch(winner, reason) {
    if (this.matchOver) return;

    this.matchOver = true;
    this.phase = 'over';
    this.busy = true;
    this.winner = winner;
    this.loseReason = reason;
    this._clearCards();
    this._refreshHud();

    if (winner === 'player') audio.playUnlock();
    else audio.playWrong();

    this.time.delayedCall(RESULT_DELAY, () => this._showResult());
  }

  _showResult() {
    if (this._resultShown || !this.scene) return;
    this._resultShown = true;

    const win = this.winner === 'player';
    const total = this.said.length;

    this.add
      .rectangle(0, 0, 1280, 720, 0x2e3a34, 0.34)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(2998)
      .setInteractive();

    createPaperPanel(this, {
      x: 640,
      y: 366,
      width: 920,
      height: 600,
      radius: 30,
      fill: C.paperSoft,
      depth: 3000,
    });

    addSeal(this, 236, 120, win ? '胜' : '惜', 44, win ? C.pineDeep : C.peachDeep).setDepth(3001);

    makeText(this, 640, 172, win ? '你赢啦 · 飞花令小能手' : '这一局小书童赢了', {
      size: 32,
      color: win ? S.pineDeep : S.peach,
    }).setDepth(3002);

    makeText(this, 640, 214, this._reasonMessage(this.loseReason), {
      size: 15,
      color: S.inkSoft,
      wrap: 780,
      lineSpacing: 8,
    }).setDepth(3002);

    makeText(this, 640, 252, `关键字「${this.keyword}」 · ${this.modeLabel} · 共 ${this.round} 回合`, {
      size: 17,
      color: S.gold,
    }).setDepth(3002);

    makeText(this, 640, 280, '这一局说过的诗句', {
      size: 14,
      color: S.inkFaint,
    }).setDepth(3002);

    const review = new ScrollPanel(this, {
      x: 270,
      y: 296,
      width: 740,
      height: 140,
      radius: 16,
      depth: 3003,
    });

    let cursor = 6;
    if (this.said.length === 0) {
      const none = makeText(this, 370, cursor, '这次还没说上诗句呢，下次再来试试。', {
        size: 15,
        color: S.inkFaint,
        origin: [0, 0],
      });
      review.add(none);
      cursor += none.height + 8;
    }
    this.said.forEach((entry, index) => {
      const who = entry.side === 'player' ? '你' : '书童';
      const text = makeText(
        this,
        20,
        cursor,
        `${index + 1}. ${who}：${entry.line.text}　（${entry.line.sourceLabel} ·《${entry.line.title}》）`,
        {
          size: 16,
          color: entry.foul ? S.danger : S.ink,
          origin: [0, 0],
          wrap: 690,
          lineSpacing: 6,
        },
      );
      review.add(text);
      cursor += text.height + 8;
    });
    review.layout(cursor + 4);

    makeText(
      this,
      640,
      458,
      `共说 ${total} 句 · 你 ${this.playerCount} 句 / 小书童 ${this.aiCount} 句 · 毛笔提示 ${this.brushHints} 次 · 免费提示 ${this.freeHintsUsed} 次`,
      { size: 16, color: S.inkSoft, wrap: 800 },
    ).setDepth(3002);

    makeText(
      this,
      640,
      486,
      `课内 ${this.sourceCount.core} 句 · 拓展 ${this.sourceCount.extend} 句 · 名句 ${this.sourceCount.extra} 句`,
      { size: 15, color: S.inkFaint },
    ).setDepth(3002);

    createButton(this, {
      x: 430,
      y: 570,
      width: 340,
      height: 60,
      radius: 22,
      label: '换个关键字再来',
      fontSize: 19,
      variant: 'gold',
      depth: 3004,
      onClick: () => {
        audio.playPage();
        this.scene.restart({ returnScene: this.returnScene, chapterId: this.chapterId });
      },
    });

    createButton(this, {
      x: 850,
      y: 570,
      width: 320,
      height: 60,
      radius: 22,
      label: '返回地图',
      fontSize: 19,
      variant: 'primary',
      depth: 3004,
      onClick: () => this._leaveToMap(),
    });

    makeText(this, 640, 626, '进度已自动保存在本机 · 不联网、不上传', {
      size: 12,
      color: S.inkFaint,
    }).setDepth(3002);

    console.info('[飞花令] 结算：', {
      keyword: this.keyword,
      advanced: this.advanced,
      winner: this.winner,
      reason: this.loseReason,
      rounds: this.round,
      player: this.playerCount,
      ai: this.aiCount,
      brushHints: this.brushHints,
      freeHints: this.freeHintsUsed,
    });
  }

  // ---------------------------------------------------------
  // 对话气泡
  // ---------------------------------------------------------
  _pushBubble({ side, line, note = '', tone = 'normal' }) {
    if (!this.chat) return;

    const isPlayer = side === 'player';
    const padX = 16;
    const padY = 11;
    const maxWidth = 376;
    const wrap = maxWidth - padX * 2 - 8;

    const nameText = makeText(this, 0, 0, isPlayer ? '你 · 小诗童' : '小书童 · 阿砚', {
      size: 13,
      color: tone === 'foul' ? S.danger : isPlayer ? S.peach : S.pine,
      origin: [0, 0],
    });
    const lineText = makeText(this, 0, 0, line.text, {
      size: 21,
      color: S.ink,
      origin: [0, 0],
      wrap,
      lineSpacing: 8,
    });
    const metaText = makeText(this, 0, 0, this._lineMeta(line), {
      size: 12,
      color: S.inkFaint,
      origin: [0, 0],
      wrap,
    });
    const noteText = note
      ? makeText(this, 0, 0, note, {
          size: 13,
          color: S.danger,
          origin: [0, 0],
          wrap,
          lineSpacing: 5,
        })
      : null;

    let cursor = padY;
    nameText.setPosition(padX + 10, cursor);
    cursor += nameText.height + 4;
    lineText.setPosition(padX + 10, cursor);
    cursor += lineText.height + 5;
    metaText.setPosition(padX + 10, cursor);
    cursor += metaText.height;
    if (noteText) {
      cursor += 5;
      noteText.setPosition(padX + 10, cursor);
      cursor += noteText.height;
    }

    const width = Math.max(
      240,
      Math.max(lineText.width, metaText.width, noteText ? noteText.width : 0) + padX * 2 + 14,
    );
    const height = cursor + padY;

    const graphics = this.add.graphics();
    const border = tone === 'foul' ? C.danger : isPlayer ? C.peachDeep : C.pine;
    graphics.fillStyle(0x6f6050, 0.07);
    roundedRectPath(graphics, 2, 5, width, height, 18);
    graphics.fillPath();
    graphics.fillStyle(isPlayer ? 0xfbeee7 : C.paperSoft, 0.99);
    roundedRectPath(graphics, 0, 0, width, height, 18);
    graphics.fillPath();
    graphics.lineStyle(1.6, border, 0.55);
    roundedRectPath(graphics, 0, 0, width, height, 18);
    graphics.strokePath();
    graphics.fillStyle(border, 0.45);
    roundedRectPath(graphics, 0, 9, 5, Math.max(10, height - 18), 3);
    graphics.fillPath();

    const container = this.add.container(isPlayer ? CHAT_SCROLL.width - 6 - width : 6, this.chatCursor);
    container.add([graphics, nameText, lineText, metaText]);
    if (noteText) container.add(noteText);
    this.chat.add(container);

    this.chatCursor += height + 10;
    this.chat.layout(this.chatCursor + 4);
    this.chat._setScroll(this.chat.contentHeight);
  }

  _pushSystem(text) {
    if (!this.chat) return;
    const label = makeText(this, CHAT_SCROLL.width / 2, this.chatCursor + 2, `—— ${text} ——`, {
      size: 13,
      color: S.inkFaint,
      wrap: 460,
    });
    this.chat.add(label);
    this.chatCursor += label.height + 14;
    this.chat.layout(this.chatCursor + 4);
    this.chat._setScroll(this.chat.contentHeight);
  }

  // ---------------------------------------------------------
  // 状态刷新
  // ---------------------------------------------------------
  _setTurnStatus() {
    if (!this.statusName) return;

    if (this.turn === 'player') {
      this.statusName.setText('轮到你说了').setColor(S.pineDeep);
      this.statusHint.setText(
        this.rulePosition > 0
          ? `说一句带「${this.keyword}」、还没说过的诗句，「${this.keyword}」要在第 ${this.rulePosition} 个字。`
          : `说一句带「${this.keyword}」的诗句，别和刚才重复。`,
      );
    } else {
      this.statusName.setText('小书童正在想…').setColor(S.inkSoft);
      this.statusHint.setText('听一听，他接上的是哪一句。');
    }

    this.statusStat.setText(
      `第 ${this.round} 回合 · 已说 ${this.said.length} 句 · 你 ${this.playerCount} / 小书童 ${this.aiCount}`,
    );
  }

  _setFeedback(text, tone = 'normal') {
    if (!this.feedbackText) return;
    const color = tone === 'warn'
      ? S.danger
      : tone === 'hint'
        ? S.gold
        : tone === 'correct'
          ? S.pineDeep
          : S.inkSoft;
    this.feedbackText.setText(text);
    this.feedbackText.setColor(color);
  }

  _refreshHud() {
    const brush = progress.getBrushCount();
    if (this.brushText) this.brushText.setText(`毛笔 × ${brush}`);
    if (this.modeButton) this.modeButton.setLabel(this.advanced ? '切到温和版' : '切到挑战版');

    if (this.phase === 'lobby') {
      this.keywordText.setText('飞花令 · 诗台');
      this.ruleText.setText(`当前：${this.modeLabel}`);
      this.roundText.setText('');
      this.scoreText.setText('');
      return;
    }

    this.keywordText.setText(`关键字「${this.keyword}」`);
    if (this.ruleFallback) this.ruleText.setText('进阶版 · 这个字太少，按简单版算');
    else if (this.rulePosition > 0) this.ruleText.setText(`进阶版 · 第 ${this.rulePosition} 字是「${this.keyword}」`);
    else this.ruleText.setText('简单版 · 句中有字');

    this.roundText.setText(`第 ${this.round} 回合`);
    this.scoreText.setText(`你 ${this.playerCount} · 书童 ${this.aiCount}`);

    if (this.hintButton) {
      const canHint = this._canAct() && !this.hintUsedThisRound;
      this.hintButton.setDisabled(!canHint);
      if (this.hintUsedThisRound) this.hintButton.setLabel('毛笔提示 · 已用');
      else if (this.freeHintsLeft > 0) this.hintButton.setLabel(`毛笔提示 · 免费 ${this.freeHintsLeft}`);
      else this.hintButton.setLabel('毛笔提示 · 想一句');
    }
    if (this.resignButton) {
      this.resignButton.setDisabled(!this._canAct());
    }
    if (this.modeButton) {
      this.modeButton.setDisabled(this._resultShown || this._modalOpen);
    }
  }

  // ---------------------------------------------------------
  // 离开
  // ---------------------------------------------------------
  _requestLeave() {
    if (this._navigating) return;
    if (this.phase !== 'playing' || this._resultShown) {
      this._leaveToMap();
      return;
    }
    if (this._modalOpen) return;

    this._modalOpen = true;
    this.showModal({
      title: '先离开这场飞花令吗？',
      sealText: '问',
      message: '这一局还没结束。\n离开后可以回到诗台重新挑一个关键字。',
      actions: [
        { label: '继续对诗', variant: 'primary' },
        { label: '先离开', variant: 'secondary', onClick: () => this._leaveToMap() },
      ],
      onClose: () => {
        this._modalOpen = false;
        this._refreshHud();
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

    this.scene.start(SCENES.MAP, { chapterId: this.chapterId });
  }
}
