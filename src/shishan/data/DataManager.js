/**
 * DataManager：诗词、轶事与藏品数据仓库。
 * 负责读取 BootScene 载入的三份 JSON，提供查询接口与数据校验。
 * 字段严格对接：
 *  poem_db: id,title,author,dynasty,chapter,area,type,difficulty,full_text,
 *           pinyin_text,translation,tip,scene_note,anecdote_id,is_hidden,tags,ai_prompt
 *           （scene_note = 看图猜诗画卷下面的一句话意境，不含诗题；ai_prompt 只用于出图）
 *  anecdote_db: anecdote_id,title,content,ai_prompt
 *  collection_db: collection_id,name,desc,ai_prompt,rarity（普通/稀有/典藏）,channel
 */

import { normalizeCollectionChannel, normalizeRarity } from '../config/collections.js';
import { getSplitLinesIssue } from './poemLineRules.js';

const REQUIRED_POEM_FIELDS = [
  'id',
  'title',
  'author',
  'dynasty',
  'chapter',
  'area',
  'type',
  'difficulty',
  'full_text',
  'pinyin_text',
  'translation',
  'tip',
  'anecdote_id',
  'is_hidden',
  'tags',
  'ai_prompt',
];

const REQUIRED_ANECDOTE_FIELDS = ['anecdote_id', 'title', 'content', 'ai_prompt'];

const REQUIRED_COLLECTION_FIELDS = ['collection_id', 'name', 'desc', 'ai_prompt', 'rarity'];

export class DataManager {
  constructor() {
    this.poems = [];
    this.anecdotes = [];
    this.collections = [];
    this.poemMap = new Map();
    this.anecdoteMap = new Map();
    this.collectionMap = new Map();
    this.ready = false;
    this.issues = [];
  }

  /**
   * 初始化数据仓库。
   * @param {Array} poems 原始 poem_db 数组
   * @param {Array} anecdotes 原始 anecdote_db 数组
   * @param {Array} collections 原始 collection_db 数组（可选，缺失时藏品为空）
   */
  init(poems, anecdotes, collections = []) {
    this.poems = Array.isArray(poems) ? poems : [];
    this.anecdotes = Array.isArray(anecdotes) ? anecdotes : [];
    this.collections = Array.isArray(collections) ? collections : [];

    // 给每首诗词补充运行时字段（不修改原始 JSON 的语义）
    this.poems = this.poems.map((poem) => ({
      ...poem,
      id: Number(poem.id),
      chapter: Number(poem.chapter),
      difficulty: Number(poem.difficulty || 1),
      is_hidden: Boolean(poem.is_hidden),
      tags: Array.isArray(poem.tags) ? poem.tags : [],
      anecdote_id: poem.anecdote_id === null || poem.anecdote_id === undefined
        ? null
        : Number(poem.anecdote_id),
      // 资源 key 约定：图片后续放入 assets/images/poem_card_<id>.png
      artKey: `poem_card_${Number(poem.id)}`,
    }));

    this.anecdotes = this.anecdotes.map((anecdote) => ({
      ...anecdote,
      anecdote_id: Number(anecdote.anecdote_id),
      artKey: `anecdote_${Number(anecdote.anecdote_id)}`,
    }));

    this.collections = this.collections.map((item) => ({
      ...item,
      collection_id: String(item.collection_id || '').trim(),
      rarity: normalizeRarity(item.rarity),
      // channel 决定主要产出渠道（level / chapter / anecdote / trial）
      channel: normalizeCollectionChannel(item.channel),
      // 资源 key 约定：图片后续放入 assets/images/collection_<collection_id>.png
      artKey: `collection_${String(item.collection_id || '').trim()}`,
    })).filter((item) => item.collection_id);

    this.poemMap = new Map(this.poems.map((poem) => [poem.id, poem]));
    this.anecdoteMap = new Map(this.anecdotes.map((item) => [item.anecdote_id, item]));
    this.collectionMap = new Map(this.collections.map((item) => [item.collection_id, item]));

    this.issues = this.validate();
    this.ready = this.poems.length > 0;
    return this.issues;
  }

  /** 校验两份数据，返回问题列表；不阻塞游戏，但会输出到控制台方便排查 */
  validate() {
    const issues = [];

    if (this.poems.length === 0) {
      issues.push({ level: 'error', message: 'poem_db.json 为空或读取失败。' });
    }
    if (this.anecdotes.length === 0) {
      issues.push({ level: 'warn', message: 'anecdote_db.json 为空或读取失败。' });
    }

    const seenIds = new Set();
    this.poems.forEach((poem, index) => {
      REQUIRED_POEM_FIELDS.forEach((field) => {
        if (!(field in poem)) {
          issues.push({
            level: 'error',
            message: `诗篇第 ${index + 1} 条缺少字段：${field}`,
          });
        }
      });
      if (seenIds.has(poem.id)) {
        issues.push({ level: 'error', message: `诗篇 id 重复：${poem.id}` });
      }
      seenIds.add(poem.id);

      if (!['core', 'extend'].includes(poem.type)) {
        issues.push({
          level: 'warn',
          message: `《${poem.title}》type 不是 core/extend：${poem.type}`,
        });
      }
      if (poem.chapter < 1 || poem.chapter > 6) {
        issues.push({
          level: 'warn',
          message: `《${poem.title}》chapter 超出 1-6：${poem.chapter}`,
        });
      }
      if (poem.anecdote_id !== null && !this.anecdoteMap.has(poem.anecdote_id)) {
        issues.push({
          level: 'warn',
          message: `《${poem.title}》关联的轶事 ${poem.anecdote_id} 不存在。`,
        });
      }

      // split_lines 是排序玩法的兜底分块：写错时只提示，玩法会自动退回断句
      const splitIssue = getSplitLinesIssue(poem);
      if (splitIssue) {
        issues.push({
          level: 'warn',
          message: `《${poem.title}》split_lines 有问题：${splitIssue}（将退回自动断句）`,
        });
      }

      // scene_note 是看图猜诗画卷下面的一句话小注：缺了会退回译文，写了诗题则失去悬念
      const sceneNote = String(poem.scene_note || '').trim();
      if (!sceneNote) {
        issues.push({
          level: 'warn',
          message: `《${poem.title}》缺少 scene_note（看图猜诗的一句话小注），将退回译文第一句。`,
        });
      } else {
        const baseTitle = String(poem.title || '').replace(/（[^）]*）/g, '').replace(/[·・]/g, '').trim();
        if (baseTitle.length >= 2 && sceneNote.includes(baseTitle)) {
          issues.push({
            level: 'warn',
            message: `《${poem.title}》的 scene_note 写出了诗题，看图猜诗会直接送答案。`,
          });
        }
      }
    });

    this.anecdotes.forEach((item) => {
      REQUIRED_ANECDOTE_FIELDS.forEach((field) => {
        if (!(field in item)) {
          issues.push({
            level: 'error',
            message: `轶事 ${item.anecdote_id ?? '?'} 缺少字段：${field}`,
          });
        }
      });
    });

    // 藏品是支线内容：数据缺失只提示，不阻塞游戏
    if (this.collections.length === 0) {
      issues.push({ level: 'warn', message: 'collection_db.json 为空或读取失败，藏品陈列馆会没有展品。' });
    }
    const seenCollectionIds = new Set();
    this.collections.forEach((item, index) => {
      REQUIRED_COLLECTION_FIELDS.forEach((field) => {
        if (!(field in item)) {
          issues.push({
            level: 'warn',
            message: `藏品第 ${index + 1} 条缺少字段：${field}`,
          });
        }
      });
      if (seenCollectionIds.has(item.collection_id)) {
        issues.push({ level: 'warn', message: `藏品 collection_id 重复：${item.collection_id}` });
      }
      seenCollectionIds.add(item.collection_id);
    });

    return issues;
  }

  /** 取单首诗词 */
  getPoemById(poemId) {
    return this.poemMap.get(Number(poemId)) || null;
  }

  getAllPoems() {
    return [...this.poems];
  }

  getPoemsByChapter(chapterId) {
    return this.poems.filter((poem) => poem.chapter === Number(chapterId));
  }

  getPoemsByArea(area) {
    return this.poems.filter((poem) => poem.area === area);
  }

  getCorePoemsByChapter(chapterId) {
    return this.getPoemsByChapter(chapterId).filter((poem) => poem.type === 'core');
  }

  getVisiblePoemsByChapter(chapterId) {
    return this.getPoemsByChapter(chapterId).filter((poem) => !poem.is_hidden);
  }

  getHiddenPoemsByChapter(chapterId) {
    return this.getPoemsByChapter(chapterId).filter((poem) => poem.is_hidden);
  }

  /** 统计本章课内篇目总数（章节解锁只看 core） */
  getCoreCount(chapterId) {
    return this.getCorePoemsByChapter(chapterId).length;
  }

  getAnecdoteById(anecdoteId) {
    return this.anecdoteMap.get(Number(anecdoteId)) || null;
  }

  getAllAnecdotes() {
    return [...this.anecdotes];
  }

  /** 本章关联的轶事（由诗篇 anecdote_id 反推） */
  getAnecdotesByChapter(chapterId) {
    const ids = [
      ...new Set(
        this.getPoemsByChapter(chapterId)
          .map((poem) => poem.anecdote_id)
          .filter((id) => id !== null && id !== undefined),
      ),
    ];
    return ids.map((id) => this.getAnecdoteById(id)).filter(Boolean);
  }

  /** 某首诗词被哪些诗篇引用（在轶事详情中展示出处） */
  getPoemsByAnecdote(anecdoteId) {
    return this.poems.filter((poem) => poem.anecdote_id === Number(anecdoteId));
  }

  // ---------------------------------------------------------
  // 藏品（collection_db.json）
  // ---------------------------------------------------------
  getCollectionById(collectionId) {
    return this.collectionMap.get(String(collectionId || '').trim()) || null;
  }

  getAllCollections() {
    return [...this.collections];
  }

  getCollectionsByRarity(rarity) {
    return this.collections.filter((item) => item.rarity === rarity);
  }

  /** 某一产出渠道的藏品（channel 已在 init 时归一） */
  getCollectionsByChannel(channel) {
    return this.collections.filter((item) => item.channel === channel);
  }

  getCollectionCount() {
    return this.collections.length;
  }

  /**
   * 生成「看图猜诗」的干扰项。
   * 优先同章节，其次同难度，最后其他诗篇；不把隐藏诗篇当成干扰项，避免提前剧透。
   */
  getDistractorPoems(poemId, count = 3) {
    const target = this.getPoemById(poemId);
    if (!target) return [];

    const pool = this.poems.filter(
      (poem) => poem.id !== target.id && !poem.is_hidden && poem.title !== target.title,
    );
    const sameChapter = pool.filter((poem) => poem.chapter === target.chapter);
    const sameDifficulty = pool.filter(
      (poem) => poem.chapter !== target.chapter && poem.difficulty === target.difficulty,
    );
    const rest = pool.filter(
      (poem) => poem.chapter !== target.chapter && poem.difficulty !== target.difficulty,
    );

    return [...shuffle(sameChapter), ...shuffle(sameDifficulty), ...shuffle(rest)].slice(0, count);
  }

  /** 构建题目的四个选项：正确项 + 三个干扰项，随机排序 */
  buildTitleOptions(poemId) {
    const target = this.getPoemById(poemId);
    if (!target) return [];
    const distractors = this.getDistractorPoems(poemId, 3);
    return shuffle([
      { poem: target, correct: true },
      ...distractors.map((poem) => ({ poem, correct: false })),
    ]);
  }

  /** 章节内全部诗篇数量（含拓展与隐藏，用于图鉴与成就展示） */
  getChapterPoemCount(chapterId) {
    return this.getPoemsByChapter(chapterId).length;
  }

  /** 全部诗篇数量（图鉴收藏度使用） */
  getTotalPoemCount() {
    return this.poems.length;
  }
}

/** Fisher–Yates 洗牌，返回新数组 */
export function shuffle(list) {
  const array = [...list];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/** 单例：BootScene 载入 JSON 后调用 init */
export const dataManager = new DataManager();
