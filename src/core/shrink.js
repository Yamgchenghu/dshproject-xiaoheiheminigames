/**
 * 源码的"标识符简写"：保存时把变量名/函数名换成短名，读取时原样还原。
 *
 * 【为什么压缩之后还要做这件事】LZ77 擅长"同一个长名字出现很多次"，
 *   第二处之后都变成 2~3 字节的匹配引用。但**第一次出现永远是字面量**：
 *   `bomb_probability` 第一次出现就实打实占 16 字节。换成 `a` 只剩 1 字节，
 *   同时后面的匹配引用也更短。几千字节的脚本通常还能再省 3%~8%。
 *
 * 【为什么必须保守到近乎胆小】改名字等于"改写用户代码"，改错一次，
 *   读回来的脚本就跑不起来了，而且用户根本不会想到是存档层干的。
 *   所以下面每一条保护都是被真实的失败逼出来的：
 *
 *   1. **import 绑定的名字不能动**。`import fruitninja` 之后所有
 *      `fruitninja.bomb.appearrate` 都靠这个名字找模块。把它改成 `a`，
 *      而 import 行还是 `import fruitninja`，运行时就找不到模块了。
 *      同理 `import x as y` 绑的是 y，`from m import a, b` 绑的是 a、b。
 *   2. **回调函数名不能动**。运行时是**按名字**从模块全局里取 on_start /
 *      on_tick 来调用的，改了名字等于这个回调消失了。
 *   3. **属性名不能动**。`bomb.appearrate` 里的 appearrate 是字典键，
 *      改了游戏就读不到参数（而且不会报错，只是"设置无效"）。
 *   4. **字符串和注释一个字都不能动**。用户可能在字符串里存了名字。
 *   5. **短名字不换**。3 个字符的名字换成 1 个字符只省 2 字节，
 *      却让代码彻底没法读，不划算。
 *
 * 【为什么保存的是映射表】短名是按"省字节最多"排序分配的，还原时这个排序
 *   信息已经没有了，必须把 map 一起存下来。
 */

import { packPayload } from './pack.js';

const KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for',
  'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or',
  'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

const BUILTINS = new Set([
  'print', 'len', 'range', 'int', 'float', 'str', 'bool', 'list', 'dict', 'set',
  'tuple', 'abs', 'min', 'max', 'sum', 'round', 'sorted', 'enumerate', 'zip',
  'type', 'isinstance', 'super', 'open', 'map', 'filter', 'any', 'all',
  'reversed', 'pow', 'divmod', 'repr', 'format', 'id', 'self', 'cls',
]);

/**
 * 运行时按名字调用的回调。这些名字是"接口"，不是"变量"，绝对不能改。
 * 与 src/mod/interp.js 里的回调约定保持一致。
 */
export const CALLBACKS = new Set([
  'on_start', 'on_tick', 'on_end', 'on_pause', 'on_resume',
  'on_input', 'on_draw', 'on_score', 'on_key', 'on_swipe',
]);

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

function shortNames(n) {
  const out = [];
  for (const ch of ALPHABET) {
    if (!KEYWORDS.has(ch) && !BUILTINS.has(ch)) out.push(ch);
  }
  for (const a of ALPHABET) {
    for (const b of ALPHABET) {
      const s = a + b;
      if (!KEYWORDS.has(s) && !BUILTINS.has(s)) out.push(s);
      if (out.length >= n) return out.slice(0, n);
    }
  }
  return out.slice(0, n);
}

/* ---------------- 词法切分（保留原始文本） ---------------- */

/**
 * 把源码切成 [{type:'code'|'str'|'comment', text, at}]，
 * at 是该片段在原文里的起始偏移，用来判断"这个名字在哪一行"。
 */
function split(src) {
  const parts = [];
  let buf = '';
  let bufAt = 0;
  let i = 0;
  const n = src.length;

  const flush = (end) => {
    if (buf) {
      parts.push({ type: 'code', text: buf, at: bufAt });
      buf = '';
    }
  };

  while (i < n) {
    const ch = src[i];
    if (ch === '#') {
      flush(i);
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      parts.push({ type: 'comment', text: src.slice(i, j), at: i });
      i = j;
      continue;
    }
    const strInfo = matchStringStart(src, i);
    if (strInfo) {
      flush(i);
      const end = scanString(src, i, strInfo);
      parts.push({ type: 'str', text: src.slice(i, end), at: i });
      i = end;
      continue;
    }
    if (!buf) bufAt = i;
    buf += ch;
    i++;
  }
  flush(n);
  return parts;
}

function matchStringStart(src, i) {
  let j = i;
  let prefix = '';
  while (j < i + 2 && 'rbfuRBFU'.includes(src[j])) {
    prefix += src[j];
    j++;
  }
  if (src[j] === '"' || src[j] === "'") {
    return { quote: src[j], triple: src.startsWith(src[j].repeat(3), j), start: j };
  }
  return null;
}

function scanString(src, i, info) {
  const q = info.quote;
  let j = info.start + (info.triple ? 3 : 1);
  while (j < src.length) {
    if (src[j] === '\\') {
      j += 2;
      continue;
    }
    if (info.triple) {
      if (src.startsWith(q.repeat(3), j)) return j + 3;
    } else if (src[j] === q) return j + 1;
    else if (src[j] === '\n') return j;
    j++;
  }
  return src.length;
}

/* ---------------- 行信息 ---------------- */

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function lineText(src, starts, idx) {
  const s = starts[idx];
  const e = idx + 1 < starts.length ? starts[idx + 1] - 1 : src.length;
  return src.slice(s, e);
}

/* ---------------- import 绑定 ---------------- */

const IMPORT_BIND_RE = /^\s*import\s+(.+)$/;
const FROM_BIND_RE = /^\s*from\s+\S+\s+import\s+(.+)$/;

/**
 * 收集所有被 import 绑定到本模块全局的名字。
 * 这些名字是"模块句柄"，改了就会找不到模块。
 */
export function importBindings(src) {
  const starts = lineIndex(src);
  const bound = new Set();
  for (let i = 0; i < starts.length; i++) {
    const line = lineText(src, starts, i);
    const m1 = IMPORT_BIND_RE.exec(line);
    if (m1) {
      for (const piece of m1[1].split(',')) {
        const p = piece.trim();
        if (!p) continue;
        const asMatch = /^\S+\s+as\s+([A-Za-z_]\w*)$/.exec(p);
        if (asMatch) bound.add(asMatch[1]);
        else if (/^[A-Za-z_]\w*$/.test(p)) bound.add(p);
      }
      continue;
    }
    const m2 = FROM_BIND_RE.exec(line);
    if (m2) {
      for (const piece of m2[1].replace(/[()]/g, '').split(',')) {
        const p = piece.trim();
        if (!p) continue;
        const asMatch = /^\S+\s+as\s+([A-Za-z_]\w*)$/.exec(p);
        if (asMatch) bound.add(asMatch[1]);
        else if (/^[A-Za-z_]\w*$/.test(p)) bound.add(p);
      }
    }
  }
  return bound;
}

/* ---------------- 遍历标识符 ---------------- */

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * 遍历所有"可以作为变量名改写"的标识符位置。
 * callback(name, absOffset, lineNo) 返回替换文本，或返回 undefined 表示不改。
 */
function walkIdents(src, callback) {
  const parts = split(src);
  const starts = lineIndex(src);
  const out = [];
  for (const p of parts) {
    if (p.type !== 'code') {
      out.push(p.text);
      continue;
    }
    let replaced = '';
    let last = 0;
    IDENT_RE.lastIndex = 0;
    let m;
    while ((m = IDENT_RE.exec(p.text))) {
      const name = m[0];
      const at = p.at + m.index;
      // 属性名：前一个非空白字符是点号
      const before = src.slice(Math.max(0, at - 40), at).trimEnd();
      if (before.slice(-1) === '.') continue;
      const line = lineOf(starts, at);
      const sub = callback(name, at, line, starts);
      if (sub === undefined || sub === name) continue;
      replaced += p.text.slice(last, m.index) + sub;
      last = m.index + name.length;
    }
    if (last === 0) out.push(p.text);
    else out.push(replaced + p.text.slice(last));
  }
  return out.join('');
}

/* ---------------- 主逻辑 ---------------- */

/**
 * 生成简写版本。
 * @returns {{ text: string, map: Record<string,string>, saved: number }}
 */
export function shrinkSource(src) {
  if (!src || typeof src !== 'string') return { text: src || '', map: {}, saved: 0 };

  const bound = importBindings(src);
  const starts = lineIndex(src);
  const counts = new Map();

  walkIdents(src, (name, at, line) => {
    if (name.length < 4) return undefined;
    if (name.startsWith('_')) return undefined;
    if (KEYWORDS.has(name) || BUILTINS.has(name)) return undefined;
    if (bound.has(name) || CALLBACKS.has(name)) return undefined;
    counts.set(name, (counts.get(name) || 0) + 1);
    return undefined;
  });

  const candidates = [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] * (b[0].length - 1) - a[1] * (a[0].length - 1));

  if (!candidates.length) return { text: src, map: {}, saved: 0 };

  const names = shortNames(candidates.length);
  const map = {};
  const reverse = new Map();
  candidates.forEach(([name], i) => {
    const s = names[i];
    if (!s || s.length >= name.length) return;
    map[name] = s;
    reverse.set(name, s);
  });
  if (!reverse.size) return { text: src, map: {}, saved: 0 };

  const text = walkIdents(src, (name) => {
    if (!reverse.has(name)) return undefined;
    return reverse.get(name);
  });

  return { text, map, saved: src.length - text.length };
}

/**
 * 用映射表还原。
 * 【注意】必须跳过属性位置，否则把 a 还原成 total_sliced 时
 *   会把 other.a 里的 a 也换掉。
 */
export function restoreSource(text, map) {
  if (!map || !Object.keys(map).length) return text;
  const reverse = new Map();
  for (const [long, short] of Object.entries(map)) reverse.set(short, long);
  if (!reverse.size) return text;
  return walkIdents(text, (name) => (reverse.has(name) ? reverse.get(name) : undefined));
}

/**
 * 整包简写：多份源码共用一张映射表。
 *
 * 【为什么一定要整包做】这是实测出来的结论，不是猜的：
 *   单份真实脚本（1.3KB）简写后打包 815 字节，比直接打包 729 字节**更大**——
 *   因为映射表本身要占 80 多字节，而 LZ77 已经把这份脚本内部的重复吃干净了。
 *   但把 30 份脚本放一起（40KB）时，简写+共享映射表只要 1473 字节，
 *   直接打包要 2030 字节，**省 27%**。差别全在"映射表摊薄"上。
 *   所以映射表按整包摊，而不是每份脚本各带一张。
 *
 * @param {Record<string,string>} codes  gameId -> 源码
 * @returns {{ codes: Record<string,string>, map: Record<string,string>, saved: number }}
 */
export function shrinkBundle(codes) {
  const ids = Object.keys(codes);
  const total = ids.reduce((n, k) => n + (codes[k] || '').length, 0);
  if (!total) return { codes, map: {}, saved: 0 };

  // 把所有源码拼起来统计，这样"同名变量出现在不同脚本里"也只占一条映射
  const bound = new Set();
  const counts = new Map();
  for (const id of ids) {
    const src = codes[id] || '';
    for (const b of importBindings(src)) bound.add(b);
    walkIdents(src, (name) => {
      if (name.length < 4) return undefined;
      if (name.startsWith('_')) return undefined;
      if (KEYWORDS.has(name) || BUILTINS.has(name)) return undefined;
      if (bound.has(name) || CALLBACKS.has(name)) return undefined;
      counts.set(name, (counts.get(name) || 0) + 1);
      return undefined;
    });
  }

  const candidates = [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] * (b[0].length - 1) - a[1] * (a[0].length - 1));
  if (!candidates.length) return { codes, map: {}, saved: 0 };

  const names = shortNames(candidates.length);
  const map = {};
  const reverse = new Map();
  candidates.forEach(([name], i) => {
    const s = names[i];
    if (!s || s.length >= name.length) return;
    map[name] = s;
    reverse.set(name, s);
  });
  if (!reverse.size) return { codes, map: {}, saved: 0 };

  const out = {};
  let saved = 0;
  for (const id of ids) {
    const src = codes[id] || '';
    const t = walkIdents(src, (name) => (reverse.has(name) ? reverse.get(name) : undefined));
    out[id] = t;
    saved += src.length - t.length;
  }
  return { codes: out, map, saved };
}

/**
 * 存盘用的源码打包：**自动选更省的那种**。
 *
 * 【为什么不能无脑简写】映射表本身要占字节。短脚本（几百字节）里
 *   一个名字最多出现两三次，省下的还没 map 多，简写反而更大。
 *   所以这里把两种形态都真的打包一遍，谁小用谁——
 *   反正打包函数本来就是纯计算，多算一次不影响体验。
 *
 * @returns {{ c: string, m?: Record<string,string> }}
 *   c = 源码（可能已简写）；m = 还原用的映射表（没简写时不存在）
 */
export function packSource(code) {
  if (!code) return { c: '' };
  const plain = { c: code };
  const shrunk = shrinkSource(code);
  if (!shrunk.saved || !Object.keys(shrunk.map).length) return plain;

  const withMap = { c: shrunk.text, m: shrunk.map };
  const a = packPayloadSize(plain);
  const b = packPayloadSize(withMap);
  // 只有真的更省才用简写；相等时用原文，因为可读性更好（用户导出时能直接看）
  return b < a ? withMap : plain;
}

/** 从存档记录还原源码 */
export function unpackSource(rec) {
  if (!rec) return '';
  if (typeof rec === 'string') return rec;
  return restoreSource(rec.c || '', rec.m);
}

/** 只量字节，避免为了比较而真的生成字符串（packPayload 会真的生成，但量级小） */
function packPayloadSize(obj) {
  return packPayload(obj).bytes;
}

