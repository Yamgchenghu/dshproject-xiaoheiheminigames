/**
 * 单词机存档桥 —— 把单词机原来存在 Android 私有目录 state.json 里的数据，
 * 搬到小程序的云存档层（save_22..save_29）。
 *
 * 【为什么拆成三个域】用户给的三条额度是分开的：
 *   「词表最多3个，课文最多2个，词表总计最多48K；课文48K；
 *     词表记录最多24K（要保证能记录所有自设词表和示例词表）」
 *   三者的写入频率差得很远：
 *     - 词表正文：用户手动导入时才变，一次几十 KB
 *     - 课文正文：同上
 *     - 学习记录：每答一个词就变，但总量很小
 *   混在一个域里，答对一个词就要把几十 KB 正文整体重写，
 *   手机上会明显卡；而且一次写入失败会把正文一起拖坏。
 *   分开后高频小写入只碰 word.records，碰不到正文。
 *
 * 【为什么不直接存 app.js 里那份 state】
 *   原版 state 里混了三样东西：用户数据（生词本、课文、进度）、
 *   设备身份（deviceId）、AI/TTS 的 Key。
 *   前两样属于本机，不该跟着云存档跑到别的设备上；
 *   Key 更是绝对不能进云存档——云存档是明文可读的。
 *   所以这里只挑「学习进度」那一部分上行，其余留在本地 storage。
 */
import { writeScope, readScope, clearScope, scopeUsage, scopeCapacity } from '../../core/save.js';

/** 词表正文域：用户自建词表 */
export const LIST_SCOPE = 'word.lists';
/** 课文正文域：课文原文 + 断句 + 译文 */
export const TEXT_SCOPE = 'word.texts';
/** 学习记录域：生词本 + 关卡进度 + 背诵进度 */
export const RECORD_SCOPE = 'word.records';

/** 业务上限（用户口径，和存档容量分开管：容量是物理上限，这些是产品上限） */
export const LIST_MAX = 3;      // 词表最多 3 个
export const TEXT_MAX = 2;      // 课文最多 2 个
export const LIST_BYTES = 48 * 1024;   // 词表总计 48K
export const TEXT_BYTES = 48 * 1024;   // 课文总计 48K
export const RECORD_BYTES = 24 * 1024; // 词表记录 24K

/**
 * 学习记录的结构。
 * 字段名刻意和原版 state.json 保持一致，这样从 APK 导出的数据能直接灌进来，
 * 不用写一层转换——转换层是 bug 的温床，能省就省。
 */
export function emptyRecordSave() {
  return {
    v: 2,
    // 生词本：{ [wid]: { en, zh, box, due, wrong, right, lastAt } }
    // box 是间隔重复的档位，due 是下次该复习的时间戳
    vocab: {},
    // 每关的完成情况：{ [num]: { done, best, at, completed: [wid...] } }
    // completed 记录「哪些词一次答对过」，这是原版 level.completed 的口径：
    //   一次答对才算真掌握，二次答对只是这次蒙对了，下次还要考。
    //   没有这个数组就分不清「学了 43 个词」和「掌握了 12 个词」。
    levels: {},
    // 三玖当前关（离线包里那份快照的编号）
    sanjNum: 0,
    // 每份词表各自学到哪了：{ [listId]: { levels: {...}, vocab: {...} } }
    // 【为什么要按词表分开】用户有多份自设词表，各自的关卡进度必须独立。
    //   混在一个 levels 里，换一份词表会看到上一份的进度，
    //   甚至把两边的词混进同一关。
    perList: {},
  };
}

export function emptyListSave() {
  return {
    v: 2,
    // 用户自建词表：[{ id, name, words: [{en, zh}], createdAt, updatedAt }]
    custom: [],
    // 当前选中的词表 id（空字符串表示用离线内置的示例词表）
    currentId: '',
  };
}

export function emptyTextSave() {
  return {
    v: 2,
    // 课文库：[{ id, name, sentences: [{en,zh}], completed, createdAt, updatedAt, aiNotes, aiVersion }]
    texts: [],
    // 当前课文编号
    curNum: 0,
    // 背诵进度：{ [sid]: { box, due, wrong, right } }
    recite: {},
  };
}

/* ---------------- 归一化 ---------------- */

/**
 * 【为什么每个字段都要兜底】云存档可能来自旧版本、也可能被用户手动改坏。
 *   少一个兜底，界面上就会出现 undefined.length 这种崩溃，
 *   而且崩溃点离真正的原因（一条脏数据）很远，很难查。
 */
function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

export function normalizeRecordSave(raw) {
  const base = emptyRecordSave();
  if (!raw || typeof raw !== 'object') return base;

  const vocab = raw.vocab && typeof raw.vocab === 'object' ? raw.vocab : {};
  for (const [wid, w] of Object.entries(vocab)) {
    if (!w || typeof w !== 'object') continue;
    base.vocab[wid] = {
      en: String(w.en || wid),
      zh: String(w.zh || ''),
      box: Math.max(0, Math.min(9, num(w.box, 0))),
      due: num(w.due, 0),
      wrong: Math.max(0, num(w.wrong, 0)),
      right: Math.max(0, num(w.right, 0)),
      lastAt: num(w.lastAt, 0),
    };
  }

  const levels = raw.levels && typeof raw.levels === 'object' ? raw.levels : {};
  for (const [k, v] of Object.entries(levels)) {
    if (!v || typeof v !== 'object') continue;
    // completed 可能是数组，也可能是旧版的 {wid:1} 映射，统一成数组
    let completed = [];
    if (Array.isArray(v.completed)) completed = v.completed.map(String);
    else if (v.completed && typeof v.completed === 'object') completed = Object.keys(v.completed);
    base.levels[k] = {
      done: !!v.done,
      best: Math.max(0, num(v.best, 0)),
      at: num(v.at, 0),
      completed,
    };
  }

  // 按词表分开的进度：逐份清洗，结构同上
  const perList = raw.perList && typeof raw.perList === 'object' ? raw.perList : {};
  for (const [lid, one] of Object.entries(perList)) {
    if (!one || typeof one !== 'object') continue;
    const lv = {};
    for (const [k, v] of Object.entries(one.levels || {})) {
      if (!v || typeof v !== 'object') continue;
      let completed = [];
      if (Array.isArray(v.completed)) completed = v.completed.map(String);
      else if (v.completed && typeof v.completed === 'object') completed = Object.keys(v.completed);
      lv[k] = { done: !!v.done, best: Math.max(0, num(v.best, 0)), at: num(v.at, 0), completed };
    }
    const vb = {};
    for (const [wid, w] of Object.entries(one.vocab || {})) {
      if (!w || typeof w !== 'object') continue;
      vb[wid] = {
        en: String(w.en || wid),
        zh: String(w.zh || ''),
        box: Math.max(0, Math.min(9, num(w.box, 0))),
        due: num(w.due, 0),
        wrong: Math.max(0, num(w.wrong, 0)),
        right: Math.max(0, num(w.right, 0)),
        lastAt: num(w.lastAt, 0),
      };
    }
    base.perList[String(lid)] = { levels: lv, vocab: vb };
  }

  base.sanjNum = num(raw.sanjNum, 0);
  return base;
}

export function normalizeListSave(raw) {
  const base = emptyListSave();
  if (!raw || typeof raw !== 'object') return base;

  base.custom = (Array.isArray(raw.custom) ? raw.custom : [])
    .filter((c) => c && typeof c === 'object')
    .map((c) => ({
      id: String(c.id || ''),
      name: String(c.name || '未命名词表'),
      words: (Array.isArray(c.words) ? c.words : [])
        .filter((w) => w && w.en)
        .map((w) => ({ en: String(w.en), zh: String(w.zh || '') })),
      createdAt: num(c.createdAt, 0),
      updatedAt: num(c.updatedAt, 0),
    }))
    .filter((c) => c.id)
    // 【为什么要截断而不是报错】用户导入第 4 份时，前面 3 份已经存好了，
    //   直接拒绝会让「导入」这个动作整个失败，用户以为程序坏了。
    //   保留前 LIST_MAX 份、丢掉多出来的，并在 UI 上提示，行为更可预期。
    .slice(0, LIST_MAX);

  base.currentId = String(raw.currentId || '');
  return base;
}

export function normalizeTextSave(raw) {
  const base = emptyTextSave();
  if (!raw || typeof raw !== 'object') return base;

  base.texts = (Array.isArray(raw.texts) ? raw.texts : [])
    .filter((t) => t && typeof t === 'object')
    .map((t) => ({
      id: String(t.id || ''),
      name: String(t.name || '未命名课文'),
      sentences: (Array.isArray(t.sentences) ? t.sentences : [])
        .filter((s) => s && s.en)
        .map((s) => ({ en: String(s.en), zh: String(s.zh || '') })),
      completed: (Array.isArray(t.completed) ? t.completed : []).map(String),
      createdAt: num(t.createdAt, 0),
      updatedAt: num(t.updatedAt, 0),
      // AI 速记只在版本号对得上时才作数，否则内容可能已经和课文对不上了
      aiNotes: t.aiNotes && typeof t.aiNotes === 'object' ? t.aiNotes : null,
      aiVersion: String(t.aiVersion || ''),
    }))
    .filter((t) => t.id)
    .slice(0, TEXT_MAX);

  const recite = raw.recite && typeof raw.recite === 'object' ? raw.recite : {};
  for (const [sid, r] of Object.entries(recite)) {
    if (!r || typeof r !== 'object') continue;
    base.recite[sid] = {
      box: Math.max(0, Math.min(9, num(r.box, 0))),
      due: num(r.due, 0),
      wrong: Math.max(0, num(r.wrong, 0)),
      right: Math.max(0, num(r.right, 0)),
    };
  }

  base.curNum = num(raw.curNum, 0);
  return base;
}

/* ---------------- 读写 ---------------- */

export async function loadRecordSave() {
  const r = await readScope(RECORD_SCOPE);
  if (!r || !r.ok) return emptyRecordSave();
  return normalizeRecordSave(r.data);
}

export async function saveRecordSave(save) {
  return writeScope(RECORD_SCOPE, normalizeRecordSave(save));
}

export async function loadListSave() {
  const r = await readScope(LIST_SCOPE);
  if (!r || !r.ok) return emptyListSave();
  return normalizeListSave(r.data);
}

export async function saveListSave(save) {
  return writeScope(LIST_SCOPE, normalizeListSave(save));
}

export async function loadTextSave() {
  const r = await readScope(TEXT_SCOPE);
  if (!r || !r.ok) return emptyTextSave();
  return normalizeTextSave(r.data);
}

export async function saveTextSave(save) {
  return writeScope(TEXT_SCOPE, normalizeTextSave(save));
}

export async function clearRecordSave() { return clearScope(RECORD_SCOPE); }
export async function clearListSave() { return clearScope(LIST_SCOPE); }
export async function clearTextSave() { return clearScope(TEXT_SCOPE); }

/** 三个域各自用了多少字节（设置页要显示） */
export async function wordUsage() {
  const [l, t, r] = await Promise.all([
    scopeUsage(LIST_SCOPE), scopeUsage(TEXT_SCOPE), scopeUsage(RECORD_SCOPE),
  ]);
  return {
    lists: { ...l, capacity: scopeCapacity(LIST_SCOPE), limit: LIST_BYTES },
    texts: { ...t, capacity: scopeCapacity(TEXT_SCOPE), limit: TEXT_BYTES },
    records: { ...r, capacity: scopeCapacity(RECORD_SCOPE), limit: RECORD_BYTES },
  };
}

/** 估一份数据会占多少字节（写之前先拦，避免写超了才发现） */
export function measureRecordSave(save) {
  try { return new TextEncoder().encode(JSON.stringify(normalizeRecordSave(save))).length; } catch { return 0; }
}

export function measureListSave(save) {
  try { return new TextEncoder().encode(JSON.stringify(normalizeListSave(save))).length; } catch { return 0; }
}

export function measureTextSave(save) {
  try { return new TextEncoder().encode(JSON.stringify(normalizeTextSave(save))).length; } catch { return 0; }
}
