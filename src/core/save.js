/**
 * 云端存档：把一份 JSON 连续地写进若干个 16KB 的云存档 value。
 *
 * 【为什么必须连续存、不能按字段拆】云存储每个 key 的上限是 16KB，但更麻烦的是
 *   **每个 key 都是整值替换**：把"转盘数据"和"跳转数据"拆成不同 key，
 *   任何一处改动都要同时写两个 key，一旦其中一个失败（VERSION_CONFLICT、
 *   网络抖动），存档就处于"转盘是新的、跳转是旧的"的撕裂状态。
 *   连续存成一个流，只有"整份成功"或"整份失败"两种结果，不存在中间态。
 *
 * 【为什么切块是安全的】packPayload 的输出全部落在可打印 ASCII（0x21..0x7E），
 *   每个字符恰好 1 个 UTF-8 字节。所以"按字节切"等于"按字符切"，
 *   永远不会把中文或 emoji 切成半个，每块都是合法的 UTF-8 字符串。
 *
 * 【为什么每块只写 16000 而不是 16384】上限是 16384 字节，但 SDK 可能给
 *   字符串加引号/转义，服务端也可能按 JSON 序列化后的长度校验。
 *   留 384 字节余量，宁可少存一点，也不要写入失败。
 *
 * 【块头】第 0 块前面带一个 ASCII 头：S1|<总字节>|<块数>|<校验>|
 *   读取时先读第 0 块拿元信息，再按块数读剩下的。校验用 FNV-1a，
 *   能挡住"写了一半就断电"这类损坏，而不是把坏数据当成正常存档解析。
 */
import { cloudGet, cloudSet, cloudRemove, cloudKeys } from '../sdk/hb.js';
import { packPayload, unpackPayload } from './pack.js';

/** 每块有效载荷上限。见文件头注释：留了 384 字节余量。 */
export const CHUNK_BYTES = 16000;

/**
 * 各个存档域的 key 分配。
 *
 * 【为什么集中在这里定义】用户要求 key 就叫 save_1、save_2……，
 *   那么多份存档共用一个命名空间，就必须有一张"谁用哪几号"的总表。
 *   散落在各模块里迟早撞号——撞号的后果是两份完全不同的数据互相覆盖，
 *   而且因为都带着合法块头，读的时候不会报错，只会悄悄丢档。
 */
export const SCOPES = {
  // Python 注入器（模组）源码：3 个 value → save_1..save_3
  // 【用户要求扩到 8 个 value】多出的 5 个追加在 save_30..save_34（见 extra），
  //   不动 start/count，老存档里的 save_1..save_3 照常能读。
  //   扩的理由：模组是完整 Python 脚本，32000 字节的上限对写复杂玩法太紧，
  //   扩到 8 个 value（128KB 容量）后源码上限提到 88000 字节左右。
  mod: { start: 1, count: 3, label: '模组脚本', extra: ['save_30', 'save_31', 'save_32', 'save_33', 'save_34'] },
  // 云海转盘拆三域，合计 14 个 value → save_4..save_17
  // 【为什么拆】转盘本体（96KB）和自动指令（64KB）大小差一个量级，
  //   合在一起时"写一条指令"要连几百 KB 的转盘库一起重写，手机上会明显卡。
  // 【用户要求转盘数据 +2 value】追加 save_35..save_36。
  'wheel.lib': { start: 4, count: 6, label: '转盘数据', extra: ['save_35', 'save_36'] },
  'wheel.goto': { start: 10, count: 4, label: '跳转数据' },
  // 【用户要求自动指令 +1 value】追加 save_37。
  'wheel.script': { start: 14, count: 4, label: '自动指令', extra: ['save_37'] },
  // 所有小游戏的最高分：1 个 value → save_18
  scores: { start: 18, count: 1, label: '最高分' },
  // 个人资料：设置、成就、游玩记录：1 个 value → save_19
  profile: { start: 19, count: 1, label: '个人资料' },
  // 诗山寻踪的进度：2 个 value → save_20..save_21（合计 32 KB）
  // 【为什么给 2 个】用户要求「进度最大给 24K」。满进度实测 15.4 KB，
  //   1 个 value（16 KB）只剩 600 字节余量，随便多解锁几枚节气诗笺就溢出。
  //   给 2 个（32 KB）后，即使 74 首诗全满 + 80 枚节气 + 40 条错题，
  //   压缩后也只有几 KB，余量充足。多占 1 个 value 换来不会写满，值得。
  shishan: { start: 20, count: 2, label: '诗山进度' },
  // ---- 单词机：按用户新规格拆成三个域，共 8 个 value → save_22..save_29 ----
  //
  // 用户给的额度（逐字）：
  //   「词表最多3个，课文最多2个，词表总计最多48K；课文48K；
  //     词表记录最多24K（要保证能记录所有自设词表和示例词表）」
  //
  // 拆成三个域而不是两个，是因为这三类数据的「写入频率」完全不同：
  //   - 词表正文（custom）：用户手动导入时才变，一次几十 KB
  //   - 课文正文（texts）：同上
  //   - 学习记录（levels/vocab/recite）：每答一个词就变，但很小
  // 如果混在一个 key 里，答对一个词就要把几十 KB 的词表整体重写，
  // 手机上会有明显卡顿，而且一次写入失败会把词表一起拖坏。
  // 分开后，高频的小写入只碰 save_28..save_29，碰不到正文。

  // 词表正文：3 个 value → save_22..save_24（合计 48 KB）
  // 【为什么正好 3 个】用户说「词表最多 3 个」，48K / 16K = 3，
  //   和「最多 3 个词表」在数字上对齐，不会出现「放得下 4 个但只让存 3 个」
  //   这种让人困惑的状态。
  // 【用户要求单词机三个域各 +1 value】分别追加 save_38 / save_39 / save_40。
  'word.lists': { start: 22, count: 3, label: '词表', extra: ['save_38'] },
  // 课文正文：3 个 value → save_25..save_27（合计 48 KB）
  // 【为什么是 3 个而不是 2 个】用户说「课文最多 2 个，课文 48K」。
  //   2 篇课文用 48K，平均每篇 24K；如果只给 2 个 value（32K），
  //   每篇只有 16K，长课文（上百个分句 + 逐句译文）会写不下。
  //   按「总量 48K」这个硬指标给 3 个 value，篇数上限由业务逻辑
  //   卡在 2 篇（见 danciji/save-bridge.js 的 TEXT_MAX）。
  'word.texts': { start: 25, count: 3, label: '课文', extra: ['save_39'] },
  // 学习记录（生词本 + 关卡进度 + 背诵进度）：2 个 value → save_28..save_29（24 KB）
  // 【为什么要单独一份】用户要求「词表记录最多 24K，要保证能记录所有
  //   自设词表和示例词表」。记录里存的是「每个词掌握到什么程度」，
  //   词越多记录越大；24K 对应 2 个 value（32K 容量，业务上卡 24K）。
  'word.records': { start: 28, count: 2, label: '词表记录', extra: ['save_40'] },
  // 东海龙珠（推币机）的每日挑战与周榜：1 个 value → save_41（16 KB）
  // 【为什么 1 个够】存的只是「今天挑战了几次、当日最好多少、
  //   本周每天各多少分」——一周 7 个数字加几个计数，几百字节。
  //   16 KB 能存十几年的周榜，不用扩。
  donghai: { start: 41, count: 1, label: '推币机战绩' },
  // 【为什么单独一个 value】战绩（save_41）只记"每日次数 / 本周分"，
  //   是跨局累加的统计。挑战局本身还有"这局投了几币、剩多少额度、
  //   盘面状态"这些局内数据，玩家中途退出去看榜再回来必须能接上，
  //   混进 save_41 会让那份统计的语义变脏。
  'donghai.run': { start: 42, count: 1, label: '推币机挑战进度' },
  // 存档版本号：1 个 value → save_43
  // 【为什么要它】推币机出过一个能刷分的 bug（重开不清盘 + 转盘孔位不重建），
  //   被刷出来的成绩已经写进最高分和云端总分榜了。修完 bug 光发新版不够——
  //   旧数据还在，刷分的人照样排在前面。
  //   用一个独立的 value 记"这份存档是哪个版本写的"，
  //   新版本读到没有版本号的存档，就知道那是 bug 时代的数据，作废重算。
  // 【为什么单独一个 value】它要能在读任何业务数据之前先读到。
  //   混进 scores 或 profile 里，就得先把那份数据解析出来才知道要不要信它，
  //   而解析本身就可能碰到脏数据。
  savever: { start: 43, count: 1, label: '存档版本号' },
};

/**
 * 某个存档域实际使用的云端 key 列表。
 *
 * 【为什么要有 extra 这一层】SCOPES 里的 start/count 决定了每个域占哪几个
 *   save_N。如果直接改 count 来扩容，后面所有域的 start 都得跟着往后挪，
 *   老用户已经写进 save_18 的数据就会被新代码当成别的域来读——直接错位。
 *   所以扩容一律走 extra：把新增的 value 追加到整个编号表的末尾，
 *   原有域的 start/count 一个都不动，老存档照常读得到。
 */
export function scopeKeys(scope) {
  const def = SCOPES[scope];
  if (!def) throw new Error('未知的存档域：' + scope);
  const base = Array.from({ length: def.count }, (_, i) => 'save_' + (def.start + i));
  return base.concat(def.extra || []);
}

export function scopeCapacity(scope) {
  // 【必须用 scopeKeys 的长度，不能用 count】扩容走的是 extra，
  //   count 只反映最初那一段。用 count 算会把容量少报一大截，
  //   而 writeScope 内部是按 scopeKeys 切的——两边不一致就会出现
  //   "明明还有空间却报 TOO_LARGE"。这里统一从实际键表推。
  return scopeKeys(scope).length * CHUNK_BYTES;
}

/* ---------------- 校验 ---------------- */

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const HEADER_RE = /^S1\|(\d+)\|(\d+)\|([0-9a-z]+)\|/;

/* ---------------- 写 ---------------- */

/**
 * 写一份存档。
 * 返回 { ok, bytes, chunks, capacity, percent, error }
 */
export async function writeScope(scope, obj) {
  const keys = scopeKeys(scope);
  const capacity = keys.length * CHUNK_BYTES;
  const packed = packPayload(obj);
  const total = packed.text.length;

  if (total > capacity) {
    return {
      ok: false,
      error: 'TOO_LARGE',
      bytes: total,
      capacity,
      chunks: keys.length,
      percent: 100,
      jsonBytes: packed.json,
    };
  }

  const header = `S1|${total}|${Math.ceil(total / CHUNK_BYTES)}|${fnv1a(packed.text)}|`;
  // 头只放在第 0 块前面，它会占用第 0 块的容量，所以按"头 + 内容"重新切
  const chunks = [];
  let pos = 0;
  const firstCap = CHUNK_BYTES - header.length;
  chunks.push(header + packed.text.slice(0, firstCap));
  pos = firstCap;
  while (pos < total) {
    chunks.push(packed.text.slice(pos, pos + CHUNK_BYTES));
    pos += CHUNK_BYTES;
  }

  // 先写非 0 块，最后写第 0 块：第 0 块是"提交标记"。
  // 如果中途失败，头还是旧的，读到的是上一份完整存档，而不是半份新数据。
  for (let i = chunks.length - 1; i >= 0; i--) {
    const res = await cloudSet(keys[i], chunks[i]);
    if (!res.ok) {
      return { ok: false, error: res.code || 'WRITE_FAILED', bytes: total, capacity, chunks: chunks.length, percent: Math.round((total / capacity) * 100) };
    }
  }
  // 清理上一份更长时残留的尾块，否则下次读会把旧尾巴拼进来
  for (let i = chunks.length; i < keys.length; i++) {
    await cloudRemove(keys[i]);
  }

  return {
    ok: true,
    bytes: total,
    jsonBytes: packed.json,
    mode: packed.mode,
    chunks: chunks.length,
    capacity,
    percent: Math.round((total / capacity) * 100),
  };
}

/* ---------------- 读 ---------------- */

export async function readScope(scope) {
  const keys = scopeKeys(scope);
  const head = await cloudGet(keys[0]);
  if (!head) return null;

  const m = HEADER_RE.exec(head);
  if (!m) {
    // 没有块头：可能是更早版本写的裸数据，尽力解析
    try {
      return unpackPayload(head);
    } catch {
      return null;
    }
  }
  const total = Number(m[1]);
  const count = Number(m[2]);
  const expect = m[3];
  const body = [head.slice(m[0].length)];

  for (let i = 1; i < count && i < keys.length; i++) {
    const part = await cloudGet(keys[i]);
    if (part === undefined || part === null) {
      // 中间缺块 = 存档不完整。宁可当作没有，也不要返回半份数据。
      return null;
    }
    body.push(part);
  }
  const text = body.join('').slice(0, total);
  if (fnv1a(text) !== expect) return null;
  try {
    return unpackPayload(text);
  } catch {
    return null;
  }
}

/** 删掉某个域的全部块（清空存档用） */
export async function clearScope(scope) {
  for (const k of scopeKeys(scope)) await cloudRemove(k);
}

/**
 * 诊断：这个存档域当前占了多少字节、用了几个 value。
 * 设置页会显示它，让用户心里有数——配额是看不见的，看不见就会踩。
 */
export async function scopeUsage(scope) {
  const keys = scopeKeys(scope);
  const head = await cloudGet(keys[0]);
  const capacity = keys.length * CHUNK_BYTES;
  if (!head) {
    return { used: 0, capacity, chunks: 0, totalChunks: keys.length, percent: 0, empty: true };
  }
  const m = HEADER_RE.exec(head);
  const total = m ? Number(m[1]) : head.length;
  const chunks = m ? Number(m[2]) : 1;
  return {
    used: total,
    capacity,
    chunks,
    totalChunks: keys.length,
    percent: Math.round((total / capacity) * 100),
    empty: false,
  };
}

/** 列出本小程序在云端实际存在的所有 key（排查"为什么说超配额"用） */
export async function allCloudKeys() {
  return cloudKeys();
}

/** 人类可读的字节数 */
export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
