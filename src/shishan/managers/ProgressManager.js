/**
 * ProgressManager：全局进度与存档系统
 * ------------------------------------------------------------
 * 所有进度只写入本机 localStorage，不联网、不上传任何隐私信息。
 *
 * 存档结构（SAVE_VERSION = 1）：
 * {
 *   version, createdAt, updatedAt,
 *   difficulty: 'gentle' | 'challenge',
 *   settings: { sfx, bgm },
 *   brush: number,
 *   trialFragments: number,           // 综合试炼房奖励的「文房藏品碎片」
 *   poems: { "<poemId>": { stars, completedAt } },
 *   unlockedCards: [poemId...],
 *   wrongRecords: [{ poemId, count, lastWrongAt }],
 *   anecdotes: [anecdoteId...],
 *   anecdoteFragments: { "<anecdoteId>": [1, 2, 3] },  // 逸闻碎片：每段轶事 3 片
 *   collection: [itemId...],           // 老藏品（章节典藏成就，config/collection.js）
 *   collectionItems: ["collection_id"...],  // 文房藏品（collection_db.json，整件解锁）
 *   collectionRewards: { anecdoteAll:true, trial:true, "chapter:1":true }, // 保底渠道发放标记
 *   achievements: [chapterId...],
 *   chapters: { "<chapterId>": { unlocked, coreProgress, coreCompleted, coreTotal, ... } },
 *   stats: { totalStars, totalCorrect, totalWrong }
 * }
 *
 * 章节解锁硬规则：
 * - 只看当前章节 type === 'core' 篇目的完成度，达到 60% 即解锁下一章；
 * - extend 拓展篇目与 is_hidden 隐藏诗卡不参与解锁门槛；
 * - 100% 完成课内篇目 + 收齐本章轶事 → 解锁本章典藏成就。
 */

import { CHAPTERS, CORE_UNLOCK_THRESHOLD } from '../config/chapters.js';
import { COLLECTION_ITEMS } from '../config/collection.js';
import {
  FRAGMENT_PER_ANECDOTE,
  isFragmentListComplete,
  parseFragmentKey,
} from '../config/anecdoteFragments.js';
import { loadShishanSave, saveShishanSave } from '../save-bridge.js';

export const SAVE_KEY = 'poem_mountain_trail_save_v1';
export const SAVE_VERSION = 1;
export const INITIAL_BRUSH = 3;
export const MAX_BRUSH = 9;

function createDefaultSave() {
  const now = Date.now();
  return {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    difficulty: 'gentle',
    settings: { sfx: true, bgm: true },
    brush: INITIAL_BRUSH,
    trialFragments: 0,
    poems: {},
    unlockedCards: [],
    wrongRecords: [],
    anecdotes: [],
    anecdoteFragments: {},
    collection: [],
    collectionItems: [],
    collectionRewards: {},
    festivals: [],
    excerpts: [],
    achievements: [],
    chapters: {},
    stats: { totalStars: 0, totalCorrect: 0, totalWrong: 0 },
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 把插画摘抄的笔画坐标限制在 0~1（归一化坐标，换屏幕尺寸也不会跑偏） */
function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.min(1, Math.max(0, num));
}

export class ProgressManager {
  constructor() {
    this.data = null;
    this.save = createDefaultSave();
    this.storageAvailable = true;
    this.lastStorageError = null;
    // 测试页专用：本次会话临时解锁全部章节（只影响运行时判断，不写进存档）
    this.devUnlockAll = false;
  }

  /**
   * 测试用：临时解锁 / 收回全部章节。
   * 只改内存标记：存档里的 chapters 仍是真实进度，刷新页面就恢复。
   */
  setDevUnlockAll(enabled = true) {
    this.devUnlockAll = Boolean(enabled);
  }

  isDevUnlockAll() {
    return Boolean(this.devUnlockAll);
  }

  /**
   * 由 BootScene 在数据仓库初始化后调用。
   * 【为什么是 async】原版读 localStorage 是同步的，云存档是异步的。
   *   读不到时返回 null（而不是默认存档），这样「云端没有存档」和
   *   「读取失败」不会混为一谈，避免把读取失败当成新玩家而覆盖真实进度。
   */
  async init(dataManager) {
    this.data = dataManager;
    const loaded = await this._readSave();
    this.save = loaded || createDefaultSave();
    this._repairSave();
    this.refresh();
    return this.save;
  }

  // ---------------------------------------------------------
  // 云存档（小黑盒 cloud.storage，经 save-bridge 分块压缩）
  // ---------------------------------------------------------
  /** 读出存档；返回 null 表示云端没有存档或读失败 */
  async _readSave() {
    try {
      const parsed = await loadShishanSave();
      if (!parsed) return null;
      if (!isPlainObject(parsed)) throw new Error('存档格式不正确');
      if (Number(parsed.version) !== SAVE_VERSION) {
        console.warn('[存档] 版本不匹配，将使用新存档。');
        return null;
      }
      return parsed;
    } catch (error) {
      this.storageAvailable = false;
      this.lastStorageError = error;
      console.warn('[存档] 读取失败，已启用临时内存存档：', error);
      return null;
    }
  }

  /**
   * 写回存档。
   * 【为什么摘抄要在这里剔掉】用户明确要求「只存进度，摘抄不存档」。
   *   摘抄的手绘坐标最多 30 张 × 60 笔 × 400 点，实测 2.8 MB，
   *   云存档单 value 只有 16 KB，写进去必然失败，还会连累整份进度写不进去。
   *   所以序列化前把它摘掉，只留在内存里（本次会话内仍然能看能画）。
   */
  _write() {
    this.save.updatedAt = Date.now();
    const forCloud = { ...this.save, excerpts: [] };
    // 先把状态标成「正在写」，避免同一帧内重复触发
    this.storageAvailable = true;
    saveShishanSave(forCloud).then((res) => {
      this.storageAvailable = res.ok;
      this.lastStorageError = res.ok ? null : res.error;
    }).catch((error) => {
      this.storageAvailable = false;
      this.lastStorageError = error;
      console.warn('[存档] 写入失败：', error);
    });
  }

  /** 修复不完整/被手动修改过度的存档，保证游戏不会崩 */
  _repairSave() {
    if (!isPlainObject(this.save)) this.save = createDefaultSave();

    const base = createDefaultSave();
    this.save.version = SAVE_VERSION;
    this.save.createdAt = Number(this.save.createdAt) || base.createdAt;
    this.save.difficulty = ['gentle', 'challenge'].includes(this.save.difficulty)
      ? this.save.difficulty
      : 'gentle';

    const settings = isPlainObject(this.save.settings) ? this.save.settings : {};
    this.save.settings = {
      sfx: settings.sfx !== false,
      bgm: settings.bgm !== false,
    };

    const brush = Number(this.save.brush);
    this.save.brush = Number.isFinite(brush)
      ? Math.min(MAX_BRUSH, Math.max(0, Math.floor(brush)))
      : INITIAL_BRUSH;

    const trialFragments = Number(this.save.trialFragments);
    this.save.trialFragments = Number.isFinite(trialFragments)
      ? Math.max(0, Math.floor(trialFragments))
      : 0;

    const validPoemIds = new Set(this.data.getAllPoems().map((poem) => poem.id));
    const rawPoems = isPlainObject(this.save.poems) ? this.save.poems : {};
    const poems = {};
    Object.entries(rawPoems).forEach(([key, record]) => {
      const poemId = Number(key);
      if (!validPoemIds.has(poemId) || !isPlainObject(record)) return;
      const stars = Math.min(3, Math.max(1, Math.floor(Number(record.stars) || 1)));
      poems[String(poemId)] = {
        stars,
        completedAt: Number(record.completedAt) || Date.now(),
      };
    });
    this.save.poems = poems;

    const completedIds = Object.keys(poems).map(Number);
    const cardIds = Array.isArray(this.save.unlockedCards)
      ? this.save.unlockedCards.map(Number).filter((id) => validPoemIds.has(id))
      : [];
    this.save.unlockedCards = [...new Set([...cardIds, ...completedIds])].sort((a, b) => a - b);

    const validAnecdoteIds = new Set(this.data.getAllAnecdotes().map((item) => item.anecdote_id));
    this.save.anecdotes = Array.isArray(this.save.anecdotes)
      ? [...new Set(this.save.anecdotes.map(Number).filter((id) => validAnecdoteIds.has(id)))]
      : [];

    // 逸闻碎片：只保留合法轶事的 1~3 片；已经解锁的轶事自动补齐 3 片（兼容老存档）
    const rawFragments = isPlainObject(this.save.anecdoteFragments) ? this.save.anecdoteFragments : {};
    const fragments = {};
    Object.entries(rawFragments).forEach(([key, value]) => {
      const anecdoteId = Number(key);
      if (!validAnecdoteIds.has(anecdoteId) || !Array.isArray(value)) return;
      const list = [...new Set(value
        .map(Number)
        .filter((index) => Number.isInteger(index) && index >= 1 && index <= FRAGMENT_PER_ANECDOTE))]
        .sort((a, b) => a - b);
      if (list.length > 0) fragments[String(anecdoteId)] = list;
    });
    this.save.anecdotes.forEach((anecdoteId) => {
      fragments[String(anecdoteId)] = [...Array(FRAGMENT_PER_ANECDOTE)].map((item, index) => index + 1);
    });
    this.save.anecdoteFragments = fragments;

    const wrong = Array.isArray(this.save.wrongRecords) ? this.save.wrongRecords : [];
    this.save.wrongRecords = wrong
      .filter((item) => isPlainObject(item) && validPoemIds.has(Number(item.poemId)))
      .map((item) => ({
        poemId: Number(item.poemId),
        count: Math.max(1, Math.floor(Number(item.count) || 1)),
        lastWrongAt: Number(item.lastWrongAt) || Date.now(),
      }));

    const validCollection = new Set(COLLECTION_ITEMS.map((item) => item.id));
    this.save.collection = Array.isArray(this.save.collection)
      ? [...new Set(this.save.collection.filter((id) => validCollection.has(id)))]
      : [];

    // 文房藏品：只保留 collection_db.json 里存在的 collection_id（整件解锁，不拆碎片）
    const validCollectionItems = new Set(
      this.data.getAllCollections().map((item) => item.collection_id),
    );
    this.save.collectionItems = Array.isArray(this.save.collectionItems)
      ? [...new Set(this.save.collectionItems
        .map((id) => String(id || '').trim())
        .filter((id) => validCollectionItems.has(id)))]
      : [];

    const validChapterIds = new Set(CHAPTERS.map((chapter) => chapter.id));
    this.save.achievements = Array.isArray(this.save.achievements)
      ? [...new Set(this.save.achievements.map(Number).filter((id) => validChapterIds.has(id)))]
      : [];

    // 保底渠道标记：只保留 true，键须为已知渠道（anecdoteAll / trial / chapter:<章节>），
    // 这样即使存档被手改，也不会重复补发同一件藏品。
    const rawRewards = isPlainObject(this.save.collectionRewards)
      ? this.save.collectionRewards
      : {};
    const rewards = {};
    Object.entries(rawRewards).forEach(([key, value]) => {
      if (!value) return;
      if (!this._isValidCollectionRewardKey(key, validChapterIds)) return;
      rewards[key] = true;
    });
    this.save.collectionRewards = rewards;

    // 节气 / 节日诗笺：只保留有 id 与名字的记录，最多 80 枚
    const rawFestivals = Array.isArray(this.save.festivals) ? this.save.festivals : [];
    this.save.festivals = rawFestivals
      .filter((item) => isPlainObject(item) && String(item.id || '').trim())
      .slice(0, 80)
      .map((item) => ({
        id: String(item.id).trim(),
        name: String(item.name || '').trim() || String(item.id),
        poemId: validPoemIds.has(Number(item.poemId)) ? Number(item.poemId) : null,
        dateLabel: String(item.dateLabel || '').trim(),
        collectedAt: Number(item.collectedAt) || Date.now(),
      }));

    // 自由诗笺摘抄：校验纸张 / 墨色 / 笔画数据，最多保留 30 张
    const paperSet = new Set(['plain', 'bamboo', 'cloud']);
    const inkSet = new Set(['ink', 'cinnabar', 'indigo']);
    const rawExcerpts = Array.isArray(this.save.excerpts) ? this.save.excerpts : [];
    this.save.excerpts = rawExcerpts
      .filter((item) => isPlainObject(item) && validPoemIds.has(Number(item.poemId)))
      .slice(0, 30)
      .map((item) => ({
        id: String(item.id || `ex_${Number(item.createdAt) || Date.now()}`),
        poemId: Number(item.poemId),
        line: String(item.line || '').slice(0, 60),
        paper: paperSet.has(item.paper) ? item.paper : 'plain',
        ink: inkSet.has(item.ink) ? item.ink : 'ink',
        strokes: Array.isArray(item.strokes)
          ? item.strokes
            .filter((stroke) => Array.isArray(stroke) && stroke.length > 0)
            .slice(0, 400)
            .map((stroke) => stroke
              .filter((point) => Array.isArray(point) && point.length >= 2)
              .slice(0, 400)
              .map((point) => [
                clamp01(point[0]),
                clamp01(point[1]),
              ]))
          : [],
        createdAt: Number(item.createdAt) || Date.now(),
      }));

    const stats = isPlainObject(this.save.stats) ? this.save.stats : {};
    this.save.stats = {
      totalStars: Math.max(0, Number(stats.totalStars) || 0),
      totalCorrect: Math.max(0, Number(stats.totalCorrect) || 0),
      totalWrong: Math.max(0, Number(stats.totalWrong) || 0),
    };

    if (!isPlainObject(this.save.chapters)) this.save.chapters = {};
  }

  // ---------------------------------------------------------
  // 章节进度与解锁
  // ---------------------------------------------------------
  /** 计算本章课内 core 完成百分比（0-100，只统计 type === 'core'） */
  getChapterCoreProgress(chapterId) {
    const corePoems = this.data.getCorePoemsByChapter(chapterId);
    if (corePoems.length === 0) return 0;
    const completed = corePoems.filter((poem) => this.isPoemCompleted(poem.id)).length;
    return Math.round((completed / corePoems.length) * 100);
  }

  /**
   * 判断章节是否解锁。
   * 标准规则：上一章课内进度 ≥ 60% 即解锁。
   * 数据兜底：个别章节没有课内篇目（如第三章、第五章），
   * 此时以「上一章全部可见篇目完成」作为通行条件；
   * 若上一章完全没有篇目，则沿用上一章的解锁状态（不产生死锁）。
   */
  checkChapterUnlock(chapterId) {
    const id = Number(chapterId);
    if (!CHAPTERS.some((chapter) => chapter.id === id)) return false;
    // 测试模式（?unlock=all）：本次会话全部章节可游历，不写存档
    if (this.devUnlockAll) return true;
    return this._realChapterUnlock(id);
  }

  /**
   * 真实解锁规则（忽略测试标记）。
   * 存档里的 chapters 状态只按这条规则计算，测试解锁不会污染存档。
   */
  _realChapterUnlock(chapterId) {
    const id = Number(chapterId);
    if (id === 1) return true;

    const prevId = id - 1;
    const prevCore = this.data.getCorePoemsByChapter(prevId);
    if (prevCore.length > 0) {
      const completed = prevCore.filter((poem) => this.isPoemCompleted(poem.id)).length;
      return completed / prevCore.length >= CORE_UNLOCK_THRESHOLD;
    }

    const prevVisible = this.data.getVisiblePoemsByChapter(prevId);
    if (prevVisible.length === 0) return this._realChapterUnlock(prevId);
    return prevVisible.every((poem) => this.isPoemCompleted(poem.id));
  }

  /** 重新计算并保存章节状态（不直接写盘，供 refresh 使用） */
  _computeChapterStates() {
    const states = {};
    CHAPTERS.forEach((chapter) => {
      const id = chapter.id;
      const corePoems = this.data.getCorePoemsByChapter(id);
      const visiblePoems = this.data.getVisiblePoemsByChapter(id);
      const coreCompleted = corePoems.filter((poem) => this.isPoemCompleted(poem.id)).length;
      const visibleCompleted = visiblePoems.filter((poem) => this.isPoemCompleted(poem.id)).length;

      states[String(id)] = {
        unlocked: this._realChapterUnlock(id),
        coreTotal: corePoems.length,
        coreCompleted,
        coreProgress: this.getChapterCoreProgress(id),
        visibleTotal: visiblePoems.length,
        visibleCompleted,
        masteryUnlocked: this.save.achievements.includes(id),
        updatedAt: Date.now(),
      };
    });
    this.save.chapters = states;
    return states;
  }

  /** 获得本章所有关联轶事 id */
  _getChapterAnecdoteIds(chapterId) {
    return this.data.getAnecdotesByChapter(chapterId).map((item) => item.anecdote_id);
  }

  /** 判定并发放典藏成就 */
  _evaluateAchievements() {
    const newlyUnlocked = [];

    CHAPTERS.forEach((chapter) => {
      const config = chapter.mastery;
      if (!config || this.save.achievements.includes(chapter.id)) return;

      let done = false;
      if (config.requiresAllPrevious) {
        const previous = CHAPTERS.filter((item) => item.id < chapter.id);
        done = previous.length > 0 && previous.every((item) => this.save.achievements.includes(item.id));
      } else {
        const corePoems = this.data.getCorePoemsByChapter(chapter.id);
        const visiblePoems = this.data.getVisiblePoemsByChapter(chapter.id);
        const targetPoems = corePoems.length > 0 ? corePoems : visiblePoems;
        if (targetPoems.length === 0) return;
        const poemsDone = targetPoems.every((poem) => this.isPoemCompleted(poem.id));
        const anecdoteIds = this._getChapterAnecdoteIds(chapter.id);
        const anecdotesDone = anecdoteIds.every((id) => this.save.anecdotes.includes(id));
        done = poemsDone && anecdotesDone;
      }

      if (done) {
        this.save.achievements.push(chapter.id);
        newlyUnlocked.push({
          chapterId: chapter.id,
          title: config.title,
          desc: config.desc,
        });
      }
    });

    return newlyUnlocked;
  }

  /** 判定并发放文房藏品 */
  _evaluateCollection() {
    const newlyUnlocked = [];

    COLLECTION_ITEMS.forEach((item) => {
      if (this.save.collection.includes(item.id)) return;

      let done = false;
      switch (item.rule.type) {
        case 'mastery':
          done = this.save.achievements.includes(Number(item.rule.chapterId));
          break;
        case 'poem':
          done = this.isPoemCompleted(item.rule.poemId);
          break;
        case 'hiddenPoem':
          done = this.data
            .getAllPoems()
            .some((poem) => poem.is_hidden && this.isPoemCompleted(poem.id));
          break;
        case 'allPoems':
          done =
            this.data.getAllPoems().length > 0 &&
            this.data.getAllPoems().every((poem) => this.isPoemCompleted(poem.id));
          break;
        default:
          break;
      }

      if (done) {
        this.save.collection.push(item.id);
        newlyUnlocked.push(item);
      }
    });

    return newlyUnlocked;
  }

  /**
   * 重算全部章节状态、成就与藏品，并可选写盘。
   * @returns {{newlyUnlockedChapters:Array, newAchievements:Array, newCollection:Array}}
   */
  refresh({ write = true } = {}) {
    const beforeUnlocked = this.getUnlockedChapterIds();
    const beforeAchievements = [...this.save.achievements];
    const beforeCollection = [...this.save.collection];

    this._computeChapterStates();
    const newAchievements = this._evaluateAchievements();
    // 成就可能刚刚解锁，藏品判定需要在成就之后
    const newCollection = this._evaluateCollection();

    // 重新计算一遍，让 masteryUnlocked 与章节展示状态同步
    this._computeChapterStates();

    this.save.stats.totalStars = this.getTotalStars();

    if (write) this._write();

    return {
      newlyUnlockedChapters: this.getUnlockedChapterIds().filter(
        (id) => !beforeUnlocked.includes(id),
      ),
      newAchievements,
      newCollection: newCollection.filter((item) => !beforeCollection.includes(item.id)),
      previousAchievements: beforeAchievements,
    };
  }

  // ---------------------------------------------------------
  // 查询
  // ---------------------------------------------------------
  isPoemCompleted(poemId) {
    return Boolean(this.save.poems[String(Number(poemId))]);
  }

  getPoemRecord(poemId) {
    return this.save.poems[String(Number(poemId))] || null;
  }

  getUnlockedCardIds() {
    return [...this.save.unlockedCards];
  }

  isCardUnlocked(poemId) {
    return this.save.unlockedCards.includes(Number(poemId));
  }

  getUnlockedChapterIds() {
    return CHAPTERS.filter((chapter) => this.isChapterUnlocked(chapter.id)).map(
      (chapter) => chapter.id,
    );
  }

  /** 当前章节是否解锁（优先读运行时状态，避免频繁计算） */
  isChapterUnlocked(chapterId) {
    if (this.devUnlockAll) return true;
    const state = this.save.chapters[String(Number(chapterId))];
    if (state) return Boolean(state.unlocked);
    return this.checkChapterUnlock(chapterId);
  }

  /** 供章节选择界面使用的完整状态 */
  getChapterStatus(chapterId) {
    const id = Number(chapterId);
    const chapter = CHAPTERS.find((item) => item.id === id);
    // 总数与完成数一律按当前诗库现算：旧存档里缓存的 coreCompleted /
    // coreProgress 是上一版诗库的快照，数据一改就会出现「2 / 7 首 · 20%」
    // 这种自相矛盾的显示（2/7 应该是 29%）。
    const corePoems = this.data.getCorePoemsByChapter(id);
    const visiblePoems = this.data.getVisiblePoemsByChapter(id);
    const coreCompleted = corePoems.filter((poem) => this.isPoemCompleted(poem.id)).length;
    const visibleCompleted = visiblePoems.filter((poem) => this.isPoemCompleted(poem.id)).length;
    const coreProgress = corePoems.length > 0
      ? Math.round((coreCompleted / corePoems.length) * 100)
      : 0;
    const visibleProgress = visiblePoems.length > 0
      ? Math.round((visibleCompleted / visiblePoems.length) * 100)
      : 0;
    const anecdotes = this._getChapterAnecdoteIds(id);

    return {
      chapterId: id,
      unlocked: this.devUnlockAll ? true : this._realChapterUnlock(id),
      coreTotal: corePoems.length,
      coreCompleted,
      coreProgress,
      visibleTotal: visiblePoems.length,
      visibleCompleted,
      visibleProgress,
      masteryTitle: chapter?.mastery?.title || '',
      masteryDesc: chapter?.mastery?.desc || '',
      masteryUnlocked: this.save.achievements.includes(id),
      anecdoteTotal: anecdotes.length,
      anecdoteCollected: anecdotes.filter((item) => this.save.anecdotes.includes(item)).length,
    };
  }

  getWrongRecords() {
    return [...this.save.wrongRecords].sort((a, b) => b.lastWrongAt - a.lastWrongAt);
  }

  getWrongRecord(poemId) {
    return this.save.wrongRecords.find((item) => item.poemId === Number(poemId)) || null;
  }

  getWrongCount() {
    return this.save.wrongRecords.length;
  }

  getAnecdoteIds() {
    return [...this.save.anecdotes];
  }

  hasAnecdote(anecdoteId) {
    return this.save.anecdotes.includes(Number(anecdoteId));
  }

  // ---------------------------------------------------------
  // 逸闻碎片（支线收集，不影响章节解锁与课内进度）
  // ---------------------------------------------------------
  /** 某段轶事已收集的碎片序号（升序，1~3） */
  getAnecdoteFragmentList(anecdoteId) {
    const list = this.save.anecdoteFragments[String(Number(anecdoteId))];
    return Array.isArray(list) ? [...list] : [];
  }

  hasAnecdoteFragment(anecdoteId, fragmentIndex) {
    return this.getAnecdoteFragmentList(anecdoteId).includes(Number(fragmentIndex));
  }

  /** 某段轶事是否已经集齐 3 片（会顺带补齐「已解锁」标记，但不重算进度） */
  checkAnecdoteComplete(anecdoteId) {
    const id = Number(anecdoteId);
    const anecdote = this.data.getAnecdoteById(id);
    if (!anecdote) return false;
    const complete = isFragmentListComplete(this.getAnecdoteFragmentList(id));
    if (complete && !this.save.anecdotes.includes(id)) {
      this.save.anecdotes.push(id);
      this._write();
    }
    return complete;
  }

  /** 全部轶事的碎片总览：{ collectedFragments, totalFragments, unlockedAnecdotes, totalAnecdotes } */
  getAnecdoteFragmentTotals() {
    const anecdotes = this.data.getAllAnecdotes();
    let collectedFragments = 0;
    anecdotes.forEach((item) => {
      collectedFragments += this.getAnecdoteFragmentList(item.anecdote_id).length;
    });
    return {
      collectedFragments,
      totalFragments: anecdotes.length * FRAGMENT_PER_ANECDOTE,
      unlockedAnecdotes: this.save.anecdotes.length,
      totalAnecdotes: anecdotes.length,
    };
  }

  /**
   * 收集一片轶闻碎片。
   * @param {string} fragmentKey 形如 "102_fragment_1"
   * @returns {{
   *   anecdote, anecdoteId, fragmentIndex, fragmentKey,
   *   alreadyOwned:boolean, collected:boolean,
   *   list:number[], count:number, total:number, remaining:number,
   *   complete:boolean, newlyUnlocked:boolean
   * } | null}
   */
  collectAnecdoteFragment(fragmentKey) {
    const parsed = parseFragmentKey(fragmentKey);
    if (!parsed) {
      console.warn('[逸闻] 碎片标识不合法：', fragmentKey);
      return null;
    }

    const anecdote = this.data.getAnecdoteById(parsed.anecdoteId);
    if (!anecdote) {
      console.warn('[逸闻] 找不到对应轶事：', parsed.anecdoteId);
      return null;
    }

    const key = String(parsed.anecdoteId);
    const list = this.getAnecdoteFragmentList(parsed.anecdoteId);
    const alreadyOwned = list.includes(parsed.fragmentIndex);
    const wasUnlocked = this.save.anecdotes.includes(parsed.anecdoteId);

    if (!alreadyOwned) {
      list.push(parsed.fragmentIndex);
      list.sort((a, b) => a - b);
      this.save.anecdoteFragments[key] = list;
      this._write();
    }

    const complete = this.checkAnecdoteComplete(parsed.anecdoteId);
    const nextList = this.getAnecdoteFragmentList(parsed.anecdoteId);

    return {
      anecdote,
      anecdoteId: parsed.anecdoteId,
      fragmentIndex: parsed.fragmentIndex,
      fragmentKey: parsed.fragmentKey,
      alreadyOwned,
      collected: !alreadyOwned,
      list: nextList,
      count: nextList.length,
      total: FRAGMENT_PER_ANECDOTE,
      remaining: Math.max(0, FRAGMENT_PER_ANECDOTE - nextList.length),
      complete,
      newlyUnlocked: complete && !wasUnlocked,
    };
  }

  /** 调试用：一次补齐某段轶事的全部碎片，返回收集结果数组 */
  collectAllAnecdoteFragments(anecdoteId) {
    const id = Number(anecdoteId);
    if (!this.data.getAnecdoteById(id)) return [];
    const results = [];
    for (let index = 1; index <= FRAGMENT_PER_ANECDOTE; index += 1) {
      const info = this.collectAnecdoteFragment(`${id}_fragment_${index}`);
      if (info && !info.alreadyOwned) results.push(info);
    }
    return results;
  }

  /** 给某段轶事补齐碎片列表（仅供内部复用：诗篇通关自动收录轶事时调用） */
  _fillAnecdoteFragments(anecdoteId) {
    const id = Number(anecdoteId);
    if (!this.data.getAnecdoteById(id)) return;
    this.save.anecdoteFragments[String(id)] = [...Array(FRAGMENT_PER_ANECDOTE)]
      .map((item, index) => index + 1);
  }

  // ---------------------------------------------------------
  // 文房藏品（collection_db.json，整件解锁的支线收集）
  // 不点亮诗卡、不参与章节解锁与课内进度计算。
  // ---------------------------------------------------------
  /** 保底渠道标记是否合法：anecdoteAll / trial / chapter:<章节id> */
  _isValidCollectionRewardKey(key, validChapterIds = null) {
    const name = String(key || '');
    if (name === 'anecdoteAll' || name === 'trial') return true;
    if (!name.startsWith('chapter:')) return false;
    const id = Number(name.slice('chapter:'.length));
    const ids = validChapterIds || new Set(CHAPTERS.map((chapter) => chapter.id));
    return ids.has(id);
  }

  getCollectionItemIds() {
    return [...this.save.collectionItems];
  }

  getCollectionItemCount() {
    return this.save.collectionItems.length;
  }

  getCollectionTotal() {
    return this.data.getCollectionCount();
  }

  /** 是否已经拥有某件藏品（防止重复获取） */
  hasCollectionItem(collection_id) {
    if (!collection_id) return false;
    return this.save.collectionItems.includes(String(collection_id).trim());
  }

  /**
   * 记录获得一件藏品，并立刻写入 localStorage。
   * @param {string} collection_id
   * @returns {{
   *   collection, collectionId, name, rarity,
   *   alreadyOwned:boolean, added:boolean, count:number, total:number
   * } | null} 找不到藏品时返回 null
   */
  addCollectionItem(collection_id) {
    const id = String(collection_id || '').trim();
    const collection = id ? this.data.getCollectionById(id) : null;
    if (!collection) {
      console.warn('[藏品] 找不到对应藏品：', collection_id);
      return null;
    }

    const alreadyOwned = this.save.collectionItems.includes(id);
    if (!alreadyOwned) {
      this.save.collectionItems.push(id);
      this._write();
    }

    return {
      collection,
      collectionId: id,
      name: collection.name,
      rarity: collection.rarity,
      alreadyOwned,
      added: !alreadyOwned,
      count: this.getCollectionItemCount(),
      total: this.getCollectionTotal(),
    };
  }

  /** 调试用：一次解锁全部藏品，返回本次新获得的藏品列表 */
  collectAllCollectionItems() {
    const gained = [];
    this.data.getAllCollections().forEach((item) => {
      const info = this.addCollectionItem(item.collection_id);
      if (info && info.added) gained.push(info);
    });
    return gained;
  }

  /** 保底渠道是否已经发过奖（用于幂等，避免重复补发） */
  hasCollectionReward(key) {
    return Boolean(this.save.collectionRewards[String(key || '')]);
  }

  /** 标记保底渠道已发奖；第一次标记返回 true */
  markCollectionReward(key) {
    const name = String(key || '');
    if (!this._isValidCollectionRewardKey(name)) {
      console.warn('[藏品] 未知的发放渠道：', key);
      return false;
    }
    if (this.save.collectionRewards[name]) return false;
    this.save.collectionRewards[name] = true;
    this._write();
    return true;
  }


  getCollectionIds() {
    return [...this.save.collection];
  }

  // ---------------------------------------------------------
  // 节气 / 节日诗笺（限时彩蛋）
  // ---------------------------------------------------------
  getFestivalRecords() {
    return [...this.save.festivals].sort((a, b) => b.collectedAt - a.collectedAt);
  }

  hasFestival(id) {
    const target = String(id || '').trim();
    if (!target) return false;
    return this.save.festivals.some((item) => item.id === target);
  }

  /**
   * 收下一枚节气 / 节日诗笺。
   * @param {{id:string, name:string, poemId:number, dateLabel?:string}} record
   * @returns {{added:boolean, record:object|null, count:number}}
   */
  collectFestival(record = {}) {
    const id = String(record.id || '').trim();
    if (!id) return { added: false, record: null, count: this.save.festivals.length };
    if (this.hasFestival(id)) {
      return {
        added: false,
        record: this.save.festivals.find((item) => item.id === id) || null,
        count: this.save.festivals.length,
      };
    }
    const entry = {
      id,
      name: String(record.name || id),
      poemId: Number(record.poemId) || null,
      dateLabel: String(record.dateLabel || ''),
      collectedAt: Date.now(),
    };
    this.save.festivals.push(entry);
    this._write();
    return { added: true, record: entry, count: this.save.festivals.length };
  }

  // ---------------------------------------------------------
  // 自由诗笺摘抄
  // ---------------------------------------------------------
  getExcerpts() {
    return [...this.save.excerpts].sort((a, b) => b.createdAt - a.createdAt);
  }

  getExcerptCount() {
    return this.save.excerpts.length;
  }

  /**
   * 保存一张手抄诗笺（最多 30 张，超出时挤掉最旧的一张）。
   * @param {{poemId:number, line:string, paper:string, ink:string, strokes:Array}} payload
   */
  addExcerpt(payload = {}) {
    const poemId = Number(payload.poemId);
    const poem = this.data ? this.data.getPoemById(poemId) : null;
    if (!poem) return null;

    const paperSet = new Set(['plain', 'bamboo', 'cloud']);
    const inkSet = new Set(['ink', 'cinnabar', 'indigo']);
    const strokes = Array.isArray(payload.strokes)
      ? payload.strokes
        .filter((stroke) => Array.isArray(stroke) && stroke.length > 0)
        .slice(0, 400)
        .map((stroke) => stroke
          .filter((point) => Array.isArray(point) && point.length >= 2)
          .slice(0, 400)
          .map((point) => [clamp01(point[0]), clamp01(point[1])]))
      : [];

    const record = {
      id: `ex_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      poemId,
      line: String(payload.line || '').slice(0, 60),
      paper: paperSet.has(payload.paper) ? payload.paper : 'plain',
      ink: inkSet.has(payload.ink) ? payload.ink : 'ink',
      strokes,
      createdAt: Date.now(),
    };
    this.save.excerpts.unshift(record);
    if (this.save.excerpts.length > 30) this.save.excerpts = this.save.excerpts.slice(0, 30);
    this._write();
    return record;
  }

  removeExcerpt(id) {
    const target = String(id || '');
    const before = this.save.excerpts.length;
    this.save.excerpts = this.save.excerpts.filter((item) => item.id !== target);
    if (this.save.excerpts.length !== before) this._write();
    return this.save.excerpts.length !== before;
  }

  getAchievementIds() {
    return [...this.save.achievements];
  }

  getBrushCount() {
    return this.save.brush;
  }

  /** 综合试炼房攒下的「文房藏品碎片」数量 */
  getTrialFragments() {
    return this.save.trialFragments;
  }

  getDifficulty() {
    return this.save.difficulty;
  }

  getSettings() {
    return { ...this.save.settings };
  }

  getTotalStars() {
    return Object.values(this.save.poems).reduce((sum, record) => sum + record.stars, 0);
  }

  getCompletedPoemCount() {
    return Object.keys(this.save.poems).length;
  }

  getTotalPoemCount() {
    return this.data.getAllPoems().length;
  }

  getUpdatedAt() {
    return this.save.updatedAt;
  }

  getStorageAvailable() {
    return this.storageAvailable;
  }

  // ---------------------------------------------------------
  // 进度修改（全部自动持久化）
  // ---------------------------------------------------------
  /**
   * 标记诗词通关。
   * @param {number} poemId
   * @param {number} star 1-3 星
   * @returns 本次通关带来的所有新变化，供关卡结果页展示
   */
  markPoemComplete(poemId, star = 1) {
    const poem = this.data.getPoemById(poemId);
    if (!poem) {
      console.warn('[进度] 未找到诗篇：', poemId);
      return null;
    }

    const id = poem.id;
    const safeStars = Math.min(3, Math.max(1, Math.floor(Number(star) || 1)));
    const firstTime = !this.isPoemCompleted(id);
    const previousRecord = this.getPoemRecord(id);

    const beforeUnlocked = this.getUnlockedChapterIds();
    const beforeAchievements = [...this.save.achievements];
    const beforeCollection = [...this.save.collection];
    const beforeAnecdotes = [...this.save.anecdotes];

    this.save.poems[String(id)] = {
      stars: Math.max(previousRecord?.stars || 0, safeStars),
      completedAt: Date.now(),
    };
    if (!this.save.unlockedCards.includes(id)) {
      this.save.unlockedCards.push(id);
      this.save.unlockedCards.sort((a, b) => a - b);
    }

    let brushGained = 0;
    if (firstTime) {
      this.save.stats.totalCorrect += 1;
      if (this.save.brush < MAX_BRUSH) {
        this.save.brush += 1;
        brushGained = 1;
      }
    }

    // 答对后该诗篇从错题书斋移除
    this.save.wrongRecords = this.save.wrongRecords.filter((item) => item.poemId !== id);

    // 自动收集关联轶事
    const newAnecdotes = [];
    if (poem.anecdote_id !== null && poem.anecdote_id !== undefined) {
      const anecdote = this.data.getAnecdoteById(poem.anecdote_id);
      if (anecdote && !this.save.anecdotes.includes(anecdote.anecdote_id)) {
        this.save.anecdotes.push(anecdote.anecdote_id);
        // 轶事由诗篇直接收录时，碎片也一并记满，逸闻册里不会出现「已解锁却只显示 0/3」
        this._fillAnecdoteFragments(anecdote.anecdote_id);
        newAnecdotes.push(anecdote);
      }
    }

    const changed = this.refresh();

    return {
      poem,
      firstTime,
      stars: safeStars,
      brushGained,
      newCard: firstTime,
      newAnecdotes,
      newAchievements: changed.newAchievements.filter(
        (item) => !beforeAchievements.includes(item.chapterId),
      ),
      newCollection: changed.newCollection,
      newlyUnlockedChapters: changed.newlyUnlockedChapters,
      previousCollection: beforeCollection,
      previousAnecdotes: beforeAnecdotes,
    };
  }

  /** 写入错题（同一首诗只保留一条，累计错误次数） */
  addWrongRecord(poemId) {
    const poem = this.data.getPoemById(poemId);
    if (!poem) return 0;

    const id = poem.id;
    const existing = this.save.wrongRecords.find((item) => item.poemId === id);
    if (existing) {
      existing.count += 1;
      existing.lastWrongAt = Date.now();
    } else {
      this.save.wrongRecords.push({
        poemId: id,
        count: 1,
        lastWrongAt: Date.now(),
      });
    }
    this.save.stats.totalWrong += 1;
    this._write();
    return existing ? existing.count : 1;
  }

  /** 单独清除某首诗的错题记录 */
  clearWrongRecord(poemId) {
    const id = Number(poemId);
    const before = this.save.wrongRecords.length;
    this.save.wrongRecords = this.save.wrongRecords.filter((item) => item.poemId !== id);
    if (this.save.wrongRecords.length !== before) {
      this._write();
      return true;
    }
    return false;
  }

  /** 收集轶事（诗篇通关时的自动收录入口），返回是否为新收集 */
  collectAnecdote(anecdoteId) {
    const anecdote = this.data.getAnecdoteById(anecdoteId);
    if (!anecdote) return false;
    if (this.save.anecdotes.includes(anecdote.anecdote_id)) return false;

    this.save.anecdotes.push(anecdote.anecdote_id);
    this._fillAnecdoteFragments(anecdote.anecdote_id);
    this.refresh();
    return true;
  }

  /** 消耗毛笔（提示道具） */
  consumeBrush(amount = 1) {
    const count = Math.max(1, Math.floor(Number(amount) || 1));
    if (this.save.brush < count) return false;
    this.save.brush -= count;
    this._write();
    return true;
  }

  addBrush(amount = 1) {
    const count = Math.max(1, Math.floor(Number(amount) || 1));
    this.save.brush = Math.min(MAX_BRUSH, this.save.brush + count);
    this._write();
    return this.save.brush;
  }

  /**
   * 试炼房奖励：累计「文房藏品碎片」。
   * 碎片不点亮诗卡、不参与章节解锁，只是试炼房的纪念收集。
   * @param {number} amount
   * @returns {number} 累计后的碎片数
   */
  addTrialFragments(amount = 1) {
    const count = Math.max(1, Math.floor(Number(amount) || 1));
    this.save.trialFragments += count;
    this._write();
    return this.save.trialFragments;
  }

  setDifficulty(mode) {
    if (!['gentle', 'challenge'].includes(mode)) return;
    this.save.difficulty = mode;
    this._write();
  }

  setSetting(key, value) {
    if (!(key in this.save.settings)) return;
    this.save.settings[key] = Boolean(value);
    this._write();
  }

  toggleSetting(key) {
    if (!(key in this.save.settings)) return false;
    this.save.settings[key] = !this.save.settings[key];
    this._write();
    return this.save.settings[key];
  }

  /** 清除存档：二次确认后由设置界面调用 */
  resetAll() {
    this.save = createDefaultSave();
    this._repairSave();
    this.refresh();
    this._write();
    return this.save;
  }
}

/** 单例：BootScene 中 init；各场景直接 import 使用 */
export const progress = new ProgressManager();
