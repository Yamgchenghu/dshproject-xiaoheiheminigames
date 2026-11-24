/**
 * 乐理与通用工具函数（全部中文注释）
 * ------------------------------------------------------------------
 * 提供：音名解析、频率换算、音阶、和弦排列、确定性伪随机数。
 * 所有随机均使用固定种子，保证脚本可重复、幂等。
 */

/** 音名 -> 音级（0=C） */
const NAME_TO_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

/** 常用音阶（相对主音的半音数） */
export const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],        // 自然小调
  major: [0, 2, 4, 5, 7, 9, 11],        // 自然大调
  minorPent: [0, 3, 5, 7, 10],          // 小调五声
  majorPent: [0, 2, 4, 7, 9],           // 大调五声
  dorian: [0, 2, 3, 5, 7, 9, 10],       // 多利亚
  mixolydian: [0, 2, 4, 5, 7, 9, 10],   // 混合利底亚
};

/** 和弦音程表 */
export const CHORDS = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  maj9: [0, 4, 7, 11, 14],
  min9: [0, 3, 7, 10, 14],
  add9: [0, 4, 7, 14],
  min6: [0, 3, 7, 9],
  '6': [0, 4, 7, 9],
  '7sus4': [0, 5, 7, 10],
  min11: [0, 3, 7, 10, 14, 17],
};

/** "A#3" / "C4" / "F#5" -> MIDI 音高编号（C4 = 60） */
export function note(name) {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(name).trim());
  if (!m) throw new Error('无法解析音名: ' + name);
  const pc = NAME_TO_PC[m[1].toUpperCase() + m[2]];
  if (pc === undefined) throw new Error('无法解析音名: ' + name);
  return (Number(m[3]) + 1) * 12 + pc;
}

/** 音高编号 -> 频率（Hz），A4=69=440Hz */
export function freq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 音名 -> 音级（0..11） */
export function pcOf(name) {
  return NAME_TO_PC[String(name).replace(/-?\d+$/, '')];
}

/**
 * 和弦排列：把和弦音塞进 [low, high] 音域内，返回升序数组。
 * 用于 pad / 电钢 / 木琴等需要固定音区的声部。
 */
export function voicing(rootName, type, low = 55, high = 76) {
  const iv = CHORDS[type];
  if (!iv) throw new Error('未知和弦类型: ' + type);
  let root = pcOf(rootName);
  while (root < low) root += 12;
  while (root - 12 >= low) root -= 12;
  const out = iv.map((i) => {
    let n = root + i;
    while (n > high) n -= 12;
    return n;
  });
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

/** 把任意音高折到 [low, high] 区间 */
export function fold(midi, low, high) {
  let n = midi;
  while (n < low) n += 12;
  while (n > high) n -= 12;
  return n;
}

/** 确定性伪随机数（mulberry32），同种子 -> 同结果 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 线性插值 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** 限制范围 */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 一拍对应的秒数 */
export function secPerBeat(bpm) {
  return 60 / bpm;
}
