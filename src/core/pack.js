/**
 * 存档的压缩与编码。
 *
 * 【为什么需要这一层】工坊云存档（cloud.storage）单个 value 只能写 16KB 的
 *   UTF-8 字符串，而且写入是按"整值替换"来的。一个转盘库、一份 Python 模组
 *   源码都很容易超过 16KB，必须自己切块。
 *
 * 【为什么输出必须是纯 ASCII】切块要按字节切，如果切在 UTF-8 多字节字符中间，
 *   这一块就不再是合法的 UTF-8 字符串，写进云存档会直接失败或者读出乱码。
 *   让打包结果全部落在可打印 ASCII（0x21..0x7E）里，"字节数 == 字符数"，
 *   切块就是简单的字符串切片，永远不会切坏中文。
 *
 * 【为什么自己写 LZ 而不用 CompressionStream】
 *   1. 小程序 WebView 对 CompressionStream 的支持参差不齐，部分安卓 WebView 没有；
 *   2. 它是异步流式接口，读存档时用起来很别扭，而读存档必须是"同步拿到才能渲染"；
 *   3. 这个 LZ77 只有一百多行，同步、零依赖、任何环境都能跑。
 *   对 JSON 文本的压缩率通常在 2~4 倍，足够把一份转盘库压进预算里。
 *
 * 【为什么用 base85 而不是 base64】
 *   16KB 是硬上限：base64 每 3 字节变 4 字符，有效载荷只剩 12288 字节；
 *   base85 每 4 字节变 5 字符，有效载荷 13107 字节，多出 6.7%。
 *   在"一个字节都要省"的场景里，这 6.7% 往往就是能不能少申请一个 key 的区别。
 */

/* ============================ UTF-8 ============================ */

/** 字符串的 UTF-8 字节数——云存档的配额按这个算，不是按字符数 */
export function utf8Length(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++; // 代理对的后半部分
    } else n += 3;
  }
  return n;
}

export function utf8Encode(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = str.charCodeAt(++i);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

export function utf8Decode(bytes) {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b < 0xf0) {
      s += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f),
      );
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12)
        | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const v = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
  }
  return s;
}

/* ============================ LZ77 ============================ */

const WINDOW = 4096;
const MIN_MATCH = 3;
const MAX_MATCH = 130; // 控制字节低 7 位最多表示 130
const HASH_SIZE = 1 << 13;

/**
 * LZ77 压缩。
 *
 * 输出是一串"控制字节 + 附加数据"：
 *   c <  0x80 → 字面量段，长度 = c + 1，后面跟这么多原始字节
 *   c >= 0x80 → 匹配，长度 = (c & 0x7f) + 3，后面跟 varint 编码的"距离 - 1"
 *
 * 【为什么距离用 varint】近处的匹配占绝大多数，1 字节就能表示 0..127 的距离；
 *   固定 2 字节会让短匹配变得比字面量还贵。
 */
export function lzCompress(input) {
  const n = input.length;
  const out = [];
  if (n === 0) return new Uint8Array(0);

  const head = new Int32Array(HASH_SIZE).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const hashAt = (i) => ((input[i] << 10) ^ (input[i + 1] << 5) ^ input[i + 2]) & (HASH_SIZE - 1);

  let i = 0;
  let litStart = 0;

  const flushLiteral = (end) => {
    let p = litStart;
    while (p < end) {
      const len = Math.min(128, end - p);
      out.push(len - 1);
      for (let k = 0; k < len; k++) out.push(input[p + k]);
      p += len;
    }
  };

  while (i < n) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + MIN_MATCH <= n) {
      const h = hashAt(i);
      let cand = head[h];
      let chain = 0;
      while (cand >= 0 && chain < 24 && i - cand <= WINDOW) {
        let len = 0;
        const maxLen = Math.min(MAX_MATCH, n - i);
        while (len < maxLen && input[cand + len] === input[i + len]) len++;
        if (len > bestLen) {
          bestLen = len;
          bestDist = i - cand;
          if (len >= MAX_MATCH) break;
        }
        cand = prev[cand];
        chain++;
      }
      prev[i] = head[h];
      head[h] = i;
    }

    if (bestLen >= MIN_MATCH) {
      flushLiteral(i);
      out.push(0x80 | (bestLen - MIN_MATCH));
      let d = bestDist - 1;
      while (d >= 0x80) {
        out.push((d & 0x7f) | 0x80);
        d >>>= 7;
      }
      out.push(d);
      // 匹配区间内每个位置都要进哈希链，否则后续找不到重叠匹配
      for (let k = 1; k < bestLen; k++) {
        const p = i + k;
        if (p + MIN_MATCH <= n) {
          const h2 = hashAt(p);
          prev[p] = head[h2];
          head[h2] = p;
        }
      }
      i += bestLen;
      litStart = i;
    } else i++;
  }
  flushLiteral(n);
  return new Uint8Array(out);
}

export function lzDecompress(input) {
  const out = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i++];
    if (c < 0x80) {
      const len = c + 1;
      for (let k = 0; k < len; k++) out.push(input[i++]);
    } else {
      const len = (c & 0x7f) + MIN_MATCH;
      let dist = 0;
      let shift = 0;
      for (;;) {
        const b = input[i++];
        dist |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
      }
      dist += 1;
      const start = out.length - dist;
      for (let k = 0; k < len; k++) out.push(out[start + k]);
    }
  }
  return new Uint8Array(out);
}

/* ============================ base85 ============================ */

// 85 个可打印 ASCII。刻意排除引号、反斜杠、尖括号、& 和反引号：
// 这些字符在 HTML 属性、JSON 字符串、shell 里都可能被转义或清洗。
const B85 = (() => {
  const skip = new Set(['"', "'", '\\', '<', '>', '&', '`']);
  const chars = [];
  for (let c = 0x21; c <= 0x7e && chars.length < 85; c++) {
    const ch = String.fromCharCode(c);
    if (!skip.has(ch)) chars.push(ch);
  }
  return chars.join('');
})();

const B85_INDEX = (() => {
  const m = new Map();
  for (let i = 0; i < B85.length; i++) m.set(B85[i], i);
  return m;
})();

export function base85Encode(bytes) {
  const n = bytes.length;
  const out = [];
  let i = 0;
  while (i < n) {
    const remain = n - i;
    let chunk;
    let size;
    if (remain >= 4) {
      chunk = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
      size = 4;
      i += 4;
    } else {
      size = remain;
      let b = 0;
      for (let k = 0; k < 4; k++) b = (b << 8) | (k < remain ? bytes[i + k] : 0);
      chunk = b >>> 0;
      i += remain;
    }
    const enc = new Array(5);
    let v = chunk;
    for (let k = 4; k >= 0; k--) {
      enc[k] = B85[v % 85];
      v = Math.floor(v / 85);
    }
    // 末尾不足 4 字节时只写必要字符数：size 字节 → size+1 字符
    const take = size === 4 ? 5 : size + 1;
    for (let k = 0; k < take; k++) out.push(enc[k]);
  }
  return out.join('');
}

export function base85Decode(str) {
  const out = [];
  let i = 0;
  const n = str.length;
  while (i < n) {
    const remain = n - i;
    const take = remain >= 5 ? 5 : remain;
    let v = 0;
    for (let k = 0; k < 5; k++) {
      const ch = k < take ? str[i + k] : B85[84];
      const d = B85_INDEX.get(ch);
      if (d === undefined) throw new Error('base85 解码失败：非法字符 ' + JSON.stringify(ch));
      v = v * 85 + d;
    }
    i += take;
    const bytes = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    const emit = take === 5 ? 4 : take - 1;
    for (let k = 0; k < emit; k++) out.push(bytes[k]);
  }
  return new Uint8Array(out);
}

/* ============================ 打包 / 解包 ============================ */

const MODE_PLAIN = 'B'; // base85(utf8(json))，不压缩
const MODE_LZ = 'Z'; // base85(lz(utf8(json)))

/**
 * 把任意可 JSON 化的对象打成**纯 ASCII** 字符串。
 *
 * 【为什么两种模式都要试】压缩有固定开销（控制字节 + 哈希表建立的代价），
 *   几十字节的小对象压完反而更大。两个都算一遍挑小的，永远不亏。
 */
export function packPayload(obj) {
  const json = JSON.stringify(obj);
  const rawBytes = utf8Length(json);
  const plain = MODE_PLAIN + base85Encode(utf8Encode(json));
  let best = { text: plain, bytes: plain.length, json: rawBytes, mode: 'plain' };
  try {
    const comp = lzCompress(utf8Encode(json));
    const enc = MODE_LZ + base85Encode(comp);
    if (enc.length < best.bytes) best = { text: enc, bytes: enc.length, json: rawBytes, mode: 'lz' };
  } catch {
    /* 压缩失败就退回不压缩，不能因为省字节而丢数据 */
  }
  return best;
}

export function unpackPayload(text) {
  if (!text) return null;
  const mode = text[0];
  const body = text.slice(1);
  if (mode === MODE_PLAIN) return JSON.parse(utf8Decode(base85Decode(body)));
  if (mode === MODE_LZ) return JSON.parse(utf8Decode(lzDecompress(base85Decode(body))));
  // 兼容没有模式标记的旧数据
  return JSON.parse(text);
}

/** 只算大小不真的存，用于界面上"已用 X / 上限 Y"的实时提示 */
export function measurePayload(obj) {
  const p = packPayload(obj);
  return { bytes: p.bytes, json: p.json, mode: p.mode };
}
