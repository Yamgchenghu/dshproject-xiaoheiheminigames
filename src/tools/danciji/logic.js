/*
 * 单词机纯逻辑层（无 DOM / 无 Android 依赖）
 * ==========================================================
 * 判分口径、答案变体、提示、词表解析全部集中在这里：
 *   - APK 的 WebView 界面直接用 window.WGLogic
 *   - Node 单测用 require('../web/logic.js')
 * 这些函数刻意照抄 server/scoring.js 与 server/llm.js 的规则，
 * 保证「学习时敲对」与「考试判对」不会出现两套口径。
 */
/*
 * 【为什么把 UMD 外壳换成直接导出】原版要在 Android WebView 里同时支持
 *   <script>（挂 window.WGLogic）和 Node 单测（module.exports），
 *   所以套了一层 UMD。小程序这边只有 Vite 的 ESM 一种消费方式，
 *   保留 UMD 反而会让打包器把整个文件当成 CommonJS 处理，
 *   和主包的 ESM 混在一起容易出现重复实例。
 */
function factory() {
  'use strict';

  /** 判分归一化：小写；标点当空格；压缩空白；保留字母/数字/汉字/撇号/连字符 */
  function norm(s) {
    if (typeof s !== 'string') return '';
    return s
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[^a-z0-9\u3400-\u9fff'\- \t\n\r]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isCorrect(input, answer) {
    const target = norm(answer);
    if (!target) return false;
    return norm(input) === target;
  }

  /** 同一答案的多种可接受写法：/ 或 = 并列、去掉括号内容 */
  function answerVariants(answer) {
    const raw = String(answer == null ? '' : answer);
    const out = [];
    const push = (s) => {
      const v = norm(s);
      if (v && out.indexOf(v) < 0) out.push(v);
    };
    const add = (s) => {
      push(s);
      // 括号是可选成分：在归一化之前去掉，否则标点先变空格就再也认不出来了
      const noParen = String(s).replace(/\([^)]*\)/g, ' ');
      if (noParen !== s) push(noParen);
    };
    // 整串也算一种写法：学习页会把 "a = b" 整串显示出来，照着抄必须判对
    add(raw);
    for (const part of raw.split(/[\/=]/)) add(part);
    return out;
  }

  function isCorrectAny(input, answer) {
    const got = norm(input);
    if (!got) return false;
    return answerVariants(answer).indexOf(got) >= 0;
  }

  /**
   * 第一次答错后的提示：单词给首字母；词组给「从头到第一个错误点所在单词末尾」。
   * 与 server/scoring.js 的 makeHint 逐字符一致。
   */
  function makeHint(answer, typed) {
    if (typeof answer !== 'string') return '';
    const first = String(answer).split(/[\/=]/)[0].trim() || answer;
    const words = first.split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    if (words.length === 1) return words[0][0];
    const got = norm(typed == null ? '' : typed);
    if (!got) return words[0];
    const want = norm(first);
    let i = 0;
    while (i < got.length && i < want.length && got[i] === want[i]) i++;
    let end = i;
    while (end < want.length && want[end] !== ' ') end++;
    const hint = want.slice(0, end).replace(/\s+$/, '');
    return hint || words[0];
  }

  function round2(x) {
    return Math.round(Number(x) * 100) / 100;
  }

  /** 单词 id：英文原文小写、空白归一化（与服务器 storage.wordId 同义） */
  function wordId(en) {
    return String(en == null ? '' : en).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function countWords(en) {
    return String(en == null ? '' : en).trim().split(/\s+/).filter(Boolean).length;
  }

  function countChars(en) {
    return String(en == null ? '' : en).replace(/\s+/g, '').length;
  }

  /** 去掉行首编号：1. / 1、 / 1) / 1） */
  function stripNumbering(line) {
    return String(line == null ? '' : line).replace(/^\s*\d{1,4}\s*[.、)）]\s*/, '');
  }

  const HAN = /[\u3400-\u9fff]/;

  /**
   * 本地解析一关文本（契约 §3，不依赖 AI）：
   *   ① 去行首编号；② 有 TAB 按首个 TAB 切；③ 否则按第一个中文字符切；
   *   ④ 中文在前时退化为「找第一段英文」；⑤ 无中文则中文留空。
   * 返回 [{en, zh}]（已去重）。
   */
  function parseLevelText(text) {
    const raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const lines = raw.split('\n');
    const out = [];
    const seen = Object.create(null);

    for (let line of lines) {
      line = stripNumbering(line).trim();
      if (!line) continue;
      if (!/[A-Za-z]/.test(line)) continue;

      let en = '';
      let zh = '';
      const tab = line.indexOf('\t');
      if (tab >= 0) {
        en = line.slice(0, tab).trim();
        zh = line.slice(tab + 1).trim();
      } else {
        const firstHan = line.search(HAN);
        if (firstHan < 0) {
          en = line.trim();
        } else if (firstHan > 0) {
          en = line.slice(0, firstHan).trim();
          zh = line.slice(firstHan).trim();
        } else {
          // 中文在前：找第一段英文当词条，前面的中文当释义
          const m = /[A-Za-z][A-Za-z0-9'’\-.()\/= ]*/.exec(line);
          if (!m) continue;
          en = m[0].trim();
          zh = line.slice(0, m.index).trim();
        }
      }

      en = en.replace(/\s+/g, ' ').trim();
      zh = zh.replace(/\s+/g, ' ').trim();
      if (!en || !/[A-Za-z]/.test(en)) continue;
      const key = wordId(en);
      if (!key || seen[key]) continue;
      seen[key] = 1;
      out.push({ en: en, zh: zh });
    }
    return out;
  }

  /** 给词条补上 wid / 词数 / 字母数，并再按 wid 去重 */
  function decorateWords(list) {
    const out = [];
    const seen = Object.create(null);
    for (const w of list || []) {
      const en = String((w && w.en) || '').replace(/\s+/g, ' ').trim();
      const zh = String((w && w.zh) || '').replace(/\s+/g, ' ').trim();
      if (!en || !/[A-Za-z]/.test(en)) continue;
      const wid = wordId(en);
      if (!wid || seen[wid]) continue;
      seen[wid] = 1;
      out.push({ wid: wid, en: en, zh: zh, wordCount: countWords(en), charCount: countChars(en) });
    }
    return out;
  }

  /** 合并两组词（按 wid 去重，保留已有顺序） */
  function mergeWords(base, extra) {
    const out = decorateWords(base || []);
    const seen = Object.create(null);
    for (const w of out) seen[w.wid] = 1;
    for (const w of decorateWords(extra || [])) {
      if (seen[w.wid]) continue;
      seen[w.wid] = 1;
      out.push(w);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // 背课文：整句解析、配对、严格判对
  // ------------------------------------------------------------------
  const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

  /** 句末标点/换行切句；中文标点直接断，英文标点后要有空白（避免切开 3.14） */
  function splitSentenceUnits(raw) {
    let s = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n');
    s = s.replace(/([.!?…])\s+/g, '$1\n');
    s = s.replace(/([。！？；])/g, '$1\n');
    s = s.replace(/\n+/g, '\n');
    return s.split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  function dedupeSentences(list) {
    const out = [];
    const seen = Object.create(null);
    for (const it of list || []) {
      const en = String((it && it.en) || '').replace(/\s+/g, ' ').trim();
      const zh = String((it && it.zh) || '').replace(/\s+/g, ' ').trim();
      if (!en || !/[A-Za-z]/.test(en)) continue;
      const sid = wordId(en);
      if (!sid || seen[sid]) continue;
      seen[sid] = 1;
      out.push({ en: en, zh: zh });
    }
    return out;
  }

  /**
   * 课文解析（照抄 server/textstore.parseTextLevel 的三段策略）：
   *   ① 有 TAB 的行 → en<TAB>zh
   *   ② 无 TAB 但 ≥2 行且每行都有英文字母 → 走单词表行解析
   *   ③ 否则当整段散文：切句 → 按中文字符占比分英文/中文两列 → 按顺序配对
   */
  function parseTextLevel(text) {
    const raw = String(text == null ? '' : text);
    const lines = raw.replace(/\r\n?/g, '\n').split('\n')
      .map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return [];

    if (lines.some((l) => l.indexOf('\t') >= 0)) {
      const out = [];
      for (const l of lines) {
        const i = l.indexOf('\t');
        out.push({
          en: (i < 0 ? l : l.slice(0, i)).trim(),
          zh: i < 0 ? '' : l.slice(i + 1).trim()
        });
      }
      const got = dedupeSentences(out);
      if (got.length) return got;
    }

    if (lines.length >= 2 && lines.every((l) => /[A-Za-z]/.test(l))) {
      const got = dedupeSentences(parseLevelText(raw).map((x) => ({ en: x.en, zh: x.zh })));
      if (got.length) return got;
    }

    const units = splitSentenceUnits(raw);
    const engs = [];
    const zhs = [];
    for (const u of units) {
      const cjkCount = (u.match(/[\u3400-\u9fff]/g) || []).length;
      const latinCount = (u.match(/[A-Za-z]/g) || []).length;
      if (CJK_RE.test(u) && cjkCount > latinCount / 4) zhs.push(u);
      else if (/[A-Za-z]/.test(u)) engs.push(u);
    }
    const out = [];
    const n = Math.max(engs.length, zhs.length);
    for (let i = 0; i < n; i++) out.push({ en: engs[i] || '', zh: zhs[i] || '' });
    return dedupeSentences(out);
  }

  /** 给课文句子补 sid / 词数 / 字母数，并按 sid 去重 */
  function decorateSentences(list) {
    const out = [];
    const seen = Object.create(null);
    for (const s of list || []) {
      const en = String((s && s.en) || '').replace(/\s+/g, ' ').trim();
      const zh = String((s && s.zh) || '').replace(/\s+/g, ' ').trim();
      if (!en || !/[A-Za-z]/.test(en)) continue;
      const sid = wordId(en);
      if (!sid || seen[sid]) continue;
      seen[sid] = 1;
      out.push({
        sid: sid,
        en: en,
        zh: zh,
        wordCount: countWords(en),
        charCount: countChars(en)
      });
    }
    return out;
  }

  function mergeSentences(base, extra) {
    const out = decorateSentences(base || []);
    const seen = Object.create(null);
    for (const s of out) seen[s.sid] = 1;
    for (const s of decorateSentences(extra || [])) {
      if (seen[s.sid]) continue;
      seen[s.sid] = 1;
      out.push(s);
    }
    return out;
  }

  /** 课文判对：只归一大小写/标点/空白，不拆 / 和 =（and/or、km/h 是字面写法） */
  function isCorrectText(input, answer) {
    const target = norm(answer);
    if (!target) return false;
    return norm(input) === target;
  }

  /** 课文提示：与单词相同的前缀提示，但不按 / 或 = 拆第一种写法 */
  function makeTextHint(answer, typed) {
    const first = String(answer == null ? '' : answer).trim();
    const words = first.split(/\s+/).filter(Boolean);
    if (!words.length) return '';
    if (words.length === 1) return words[0][0];
    const got = norm(typed == null ? '' : typed);
    if (!got) return words[0];
    const want = norm(first);
    let i = 0;
    while (i < got.length && i < want.length && got[i] === want[i]) i++;
    let end = i;
    while (end < want.length && want[end] !== ' ') end++;
    const hint = want.slice(0, end).replace(/\s+$/, '');
    return hint || words[0];
  }

  /** 从模型输出里抠 JSON：剥 markdown 围栏 + 括号配对扫描 */
  function extractJson(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) throw new Error('模型返回为空');
    const fence = /^\s*`{3}[A-Za-z0-9_-]*\s*([\s\S]*?)\s*`{3}\s*$/.exec(s);
    const body = fence ? fence[1].trim() : s;
    try {
      return JSON.parse(body);
    } catch (e) { /* 继续括号提取 */ }
    const start = body.search(/[\[{]/);
    if (start < 0) throw new Error('模型返回里找不到 JSON 起点');
    const open = body[start];
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < body.length; i++) {
      const c = body[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(body.slice(start, i + 1));
          } catch (e) {
            throw new Error('模型返回的 JSON 无法解析：' + e.message);
          }
        }
      }
    }
    throw new Error('模型返回的 JSON 括号不闭合');
  }

  /** 模型可能给 [{en,zh}] / {words:[...]} / {map:{en:zh}} / 裸对象，统一成 [{en,zh}] */
  function normalizeAiWords(raw) {
    let arr = [];
    if (Array.isArray(raw)) arr = raw;
    else if (raw && Array.isArray(raw.words)) arr = raw.words;
    else if (raw && Array.isArray(raw.items)) arr = raw.items;
    else if (raw && Array.isArray(raw.list)) arr = raw.list;
    else if (raw && raw.map && typeof raw.map === 'object') {
      arr = Object.keys(raw.map).map((k) => ({ en: k, zh: raw.map[k] }));
    } else if (raw && typeof raw === 'object') {
      arr = Object.keys(raw).map((k) => ({ en: k, zh: raw[k] }));
    }
    const list = [];
    for (const it of arr) {
      let en;
      let zh;
      if (it && typeof it === 'object') {
        en = it.en != null ? it.en : (it.word != null ? it.word : it.english);
        zh = it.zh != null ? it.zh
          : (it.cn != null ? it.cn
            : (it.chinese != null ? it.chinese
              : (it.meaning != null ? it.meaning : it.translation)));
      } else if (typeof it === 'string') {
        // 模型偶尔不按约定返回对象，而是直接给一行 "abandon 放弃"
        const one = parseLevelText(it)[0];
        en = one ? one.en : it;
        zh = one ? one.zh : '';
      }
      en = stripNumbering(String(en == null ? '' : en)).replace(/\s+/g, ' ').trim();
      zh = String(zh == null ? '' : zh).replace(/\s+/g, ' ').trim();
      if (!en || !/[A-Za-z]/.test(en)) continue;
      list.push({ en: en, zh: zh });
    }
    return decorateWords(list);
  }

  function shuffle(arr, rng) {
    const a = (arr || []).slice();
    const r = rng || Math.random;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function chunk(arr, size) {
    const out = [];
    const n = Math.max(1, Number(size) || 10);
    for (let i = 0; i < (arr || []).length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  /** 学习顺序：与考试顺序（0..n-1）不同的随机排列 */
  function studyOrderOf(n, rng) {
    const seq = [];
    for (let i = 0; i < n; i++) seq.push(i);
    if (n <= 1) return seq;
    let best = shuffle(seq, rng);
    for (let t = 0; t < 20; t++) {
      let same = true;
      for (let i = 0; i < n; i++) if (best[i] !== i) { same = false; break; }
      if (!same) return best;
      best = shuffle(seq, rng);
    }
    return best;
  }

  /**
   * 本组结算（照抄 server/scoring.js computeGroup；APK 无积分，points 仍返回便于展示）。
   * items:   [{wid, borrowed?}]
   * answers: [{wid, correctAt:0|1|2}]
   */
  function computeGroup(input) {
    const opts = input || {};
    const list = Array.isArray(opts.items) ? opts.items : [];
    const given = Array.isArray(opts.answers) ? opts.answers : [];
    const byWid = Object.create(null);
    for (const a of given) if (a && typeof a.wid === 'string') byWid[a.wid] = a;

    let score = 0;
    const firstTry = [];
    const secondTry = [];
    for (const item of list) {
      if (!item || typeof item.wid !== 'string') continue;
      const ans = byWid[item.wid];
      const at = ans ? ans.correctAt : 0;
      const borrowed = item.borrowed === true;
      if (at === 1) {
        score += 10;
        if (!borrowed) firstTry.push(item.wid);
      } else if (at === 2) {
        score += borrowed ? 5 : 7;
        if (!borrowed) secondTry.push(item.wid);
      }
    }
    const fullMark = list.length * 10;
    const passed = fullMark > 0 && round2(score) >= round2(fullMark * 0.85);
    if (!passed) {
      return { score: score, fullMark: fullMark, passed: false, firstTry: [], secondTry: [] };
    }
    return { score: score, fullMark: fullMark, passed: true, firstTry: firstTry, secondTry: secondTry };
  }

  function maskKey(key) {
    const k = String(key || '');
    if (!k) return '<无 Key>';
    return k.slice(0, 6) + '***';
  }

  function uid(prefix) {
    const rnd = Math.random().toString(36).slice(2, 10);
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + rnd;
  }

  return {
    norm: norm,
    isCorrect: isCorrect,
    answerVariants: answerVariants,
    isCorrectAny: isCorrectAny,
    makeHint: makeHint,
    round2: round2,
    wordId: wordId,
    countWords: countWords,
    countChars: countChars,
    stripNumbering: stripNumbering,
    parseLevelText: parseLevelText,
    decorateWords: decorateWords,
    mergeWords: mergeWords,
    splitSentenceUnits: splitSentenceUnits,
    parseTextLevel: parseTextLevel,
    decorateSentences: decorateSentences,
    mergeSentences: mergeSentences,
    isCorrectText: isCorrectText,
    makeTextHint: makeTextHint,
    extractJson: extractJson,
    normalizeAiWords: normalizeAiWords,
    shuffle: shuffle,
    chunk: chunk,
    studyOrderOf: studyOrderOf,
    computeGroup: computeGroup,
    maskKey: maskKey,
    uid: uid,
  };
}

const WGLogic = factory();

export default WGLogic;
export const {
  norm, isCorrect, answerVariants, isCorrectAny, makeHint, round2, wordId,
  countWords, countChars, stripNumbering, parseLevelText, decorateWords,
  mergeWords, splitSentenceUnits, parseTextLevel, decorateSentences,
  mergeSentences, isCorrectText, makeTextHint, extractJson, normalizeAiWords,
  shuffle, chunk, studyOrderOf, computeGroup, maskKey, uid,
} = WGLogic;
