/**
 * 四首 BGM 的编曲（乐谱生成）
 * ------------------------------------------------------------------
 * 每首曲子都导出 { bpm, beatsPerBar, bars, tracks, markers }，
 * tracks 里的 notes 用"拍"为单位，t 为起始拍，d 为时值。
 *
 * 循环设计：
 *   - 总小节数固定，所有声部的音符都落在 [0, bars*beatsPerBar) 内；
 *   - 每 8 小节一个乐句，A/B 段各 16 小节，整体 32 小节为一个大循环；
 *   - 结尾不做淡出，靠 renderSong 把混响尾巴折回开头。
 */

import { note, voicing, fold, mulberry32, SCALES } from './theory.mjs';

/* ------------------------------------------------------------------ */
/* 工具：把音阶索引变成音高                                             */
/* ------------------------------------------------------------------ */

/** 以 root 为主音、scale 为音阶，取第 deg 级（可超出 0..6，自动跨八度） */
function scaleNote(rootName, scaleName, deg, octave = 4) {
  const scale = SCALES[scaleName];
  const len = scale.length;
  const oct = Math.floor(deg / len);
  const idx = ((deg % len) + len) % len;
  const base = note(rootName + octave);
  return base + scale[idx] + oct * 12;
}

/** 和弦进行表：[根音, 和弦类型]，每个元素占一个小节 */
const PROG = {
  // 小调 i - VI - III - VII（冷静悬疑）
  minorEpic: [
    ['A', 'min'], ['F', 'maj'], ['C', 'maj'], ['G', 'maj'],
  ],
  // 小调 i - iv - VI - v（更紧张）
  minorTense: [
    ['A', 'min'], ['D', 'min'], ['F', 'maj'], ['E', 'min'],
  ],
  // 大调 I - V - vi - IV（明亮流行）
  majorPop: [
    ['C', 'maj'], ['G', 'maj'], ['A', 'min'], ['F', 'maj'],
  ],
  // 大调 I - vi - IV - V
  major50s: [
    ['C', 'maj'], ['A', 'min'], ['F', 'maj'], ['G', 'maj'],
  ],
  // 五声调式 I - IV - V - vi
  pentaBright: [
    ['D', 'maj'], ['G', 'maj'], ['A', 'maj'], ['B', 'min'],
  ],
  // lo-fi：Fmaj7 - Em7 - Dm7 - Cmaj7（下行，很舒缓）
  lofi: [
    ['F', 'maj7'], ['E', 'min7'], ['D', 'min7'], ['C', 'maj7'],
  ],
};

/* ================================================================== */
/* 1. minesweeper —— 冷静、悬疑的极简电子，A 小调，BPM 92              */
/* ================================================================== */

export function minesweeperOld() {
  const bpm = 92;
  const beatsPerBar = 4;
  const bars = 96; // 96 小节 × 4 拍 @92BPM ≈ 250 秒 ≈ 4:10
  const rnd = mulberry32(0x51ee9);
  const tracks = [];

  // ---- 和声骨架：每小节一个和弦，A 段用 minorEpic，B 段用 minorTense ----
  const chordAt = (bar) => {
    const section = Math.floor(bar / 16) % 2; // 0 = A 段, 1 = B 段
    const table = section === 0 ? PROG.minorEpic : PROG.minorTense;
    return table[bar % 4];
  };

  // ---- 声部 1：低频脉冲（心跳感） ----
  const pulseNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root] = chordAt(bar);
    const section = Math.floor(bar / 16) % 2;
    // A 段：每 2 拍一次；B 段：每拍一次，更紧
    const step = section === 0 ? 2 : 1;
    for (let b = 0; b < beatsPerBar; b += step) {
      const accent = b === 0 ? 112 : 78;
      pulseNotes.push({
        t: bar * beatsPerBar + b,
        d: step * 0.85,
        p: fold(note(root + '2'), 33, 45),
        v: accent,
        opts: { tau: section === 0 ? 0.22 : 0.16, gain: 0.42 },
      });
    }
  }
  tracks.push({ name: 'Sub Pulse', inst: 'pulse', gain: 1.0, notes: pulseNotes, reverb: 0.12 });

  // ---- 声部 2：拨弦琶音（悬疑的主动机） ----
  const pluckNotes = [];
  // 动机：以和弦内音为骨架的固定级数走向（0=根音, 2=五音, 4=高八度根音…）
  const motif = [0, 2, 4, 2, 3, 1, 0, 2];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const section = Math.floor(bar / 16) % 2;
    const chord = voicing(root, type, 57, 78);
    // A 段稀疏（每拍一个），B 段加密（八分音符）
    const density = section === 0 ? 1 : 2;
    for (let beat = 0; beat < beatsPerBar; beat++) {
      for (let s = 0; s < density; s++) {
        const mIdx = (bar * 4 + beat * density + s) % motif.length;
        const step = motif[mIdx];
        // 级数先折到和弦音数范围内，超出部分整体升高八度
        const oct = Math.floor(step / chord.length);
        const idx = step % chord.length;
        let pitch = fold(chord[idx] + oct * 12, 57, 81);
        // B 段偶尔升高八度，制造"警报"感
        if (section === 1 && rnd() < 0.16) pitch = fold(pitch + 12, 57, 86);
        const t = bar * beatsPerBar + beat + s / density;
        pluckNotes.push({
          t,
          d: 0.9 / density,
          p: pitch,
          v: Math.round(64 + rnd() * 28 + (beat === 0 ? 12 : 0)),
          opts: { decay: 1.5, damp: 0.9955, bright: 0.42, gain: 0.3 },
        });
      }
    }
  }
  tracks.push({
    name: 'Pluck Arp',
    inst: 'pluck',
    gain: 0.95,
    notes: pluckNotes,
    reverb: 0.5,
    delay: { time: (60 / bpm) * 0.75, feedback: 0.28, wet: 0.22, cutoff: 2400 },
  });

  // ---- 声部 3：钟琴点缀（稀疏、高音、留白） ----
  const bellNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const section = Math.floor(bar / 16) % 2;
    // A 段每两小节一次，B 段每小节一次
    if (section === 0 && bar % 2 !== 0) continue;
    if (section === 1 && bar % 2 !== 0) continue;
    const chord = voicing(root, type, 69, 88);
    const pitch = chord[Math.floor(rnd() * chord.length)];
    bellNotes.push({
      t: bar * beatsPerBar + (section === 0 ? 1.5 : 2.5),
      d: 2,
      p: fold(pitch + 12, 74, 93),
      v: 58 + Math.round(rnd() * 18),
      opts: { ratio: 3.01, index: 2.0, tau: 0.75, decay: 2.2, gain: 0.16 },
    });
  }
  tracks.push({ name: 'Music Box', inst: 'bell', gain: 0.8, notes: bellNotes, reverb: 0.62 });

  // ---- 声部 4：极简打击（只有轻柔的边击与沙锤，制造呼吸） ----
  const rimNotes = [];
  const shakerNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const section = Math.floor(bar / 16) % 2;
    if (section === 0) {
      // A 段：每小节第 3 拍一个边击，稀疏
      rimNotes.push({ t: bar * beatsPerBar + 2, d: 0.25, p: 60, v: 42, opts: { freq: 380, gain: 0.1 } });
      if (bar % 4 === 2) {
        rimNotes.push({ t: bar * beatsPerBar + 3.5, d: 0.25, p: 60, v: 34, opts: { freq: 320, gain: 0.08 } });
      }
    } else {
      // B 段：反拍沙锤，制造推进感
      for (let b = 0; b < beatsPerBar; b++) {
        shakerNotes.push({
          t: bar * beatsPerBar + b + 0.5,
          d: 0.2,
          p: 60,
          v: 30 + (b === 0 ? 8 : 0),
          opts: { decay: 0.028, hp: 5200, gain: 0.075 },
        });
      }
    }
  }
  tracks.push({ name: 'Rim', inst: 'rim', gain: 0.7, notes: rimNotes, reverb: 0.3 });
  tracks.push({ name: 'Shaker', inst: 'shaker', gain: 0.85, notes: shakerNotes, reverb: 0.28 });

  // ---- 声部 5：低频铺底 pad（A 段极弱，B 段渐强） ----
  const padNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const section = Math.floor(bar / 16) % 2;
    const chord = voicing(root, type, 48, 64);
    for (const p of chord) {
      padNotes.push({
        t: bar * beatsPerBar,
        d: beatsPerBar * 0.98,
        p,
        v: section === 0 ? 34 : 46,
        opts: { attack: 1.1, release: 1.4, cutoff: 900, gain: 0.1 },
      });
    }
  }
  tracks.push({ name: 'Pad', inst: 'pad', gain: 0.85, notes: padNotes, reverb: 0.55 });

  const markers = [];
  for (let bar = 0; bar < bars; bar += 16) {
    markers.push({ t: bar * beatsPerBar, name: Math.floor(bar / 16) % 2 === 0 ? 'A' : 'B' });
  }

  return {
    name: 'minesweeper',
    bpm,
    beatsPerBar,
    bars,
    seed: 0x51ee9,
    key: 'A 小调',
    tracks,
    markers,
    masterReverb: 0.75,
    reverbFeedback: 0.84,
    reverbDamp: 0.3,
  };
}

/* ================================================================== */
/* 2. fruitninja —— 轻快活泼，D 大调五声，BPM 124                      */
/* ================================================================== */

export function fruitninja() {
  const bpm = 124;
  const beatsPerBar = 4;
  const bars = 128; // 128 × 4 拍 @124BPM ≈ 248 秒 ≈ 4:08
  const rnd = mulberry32(0xf00d1);
  const tracks = [];

  // 两段和声都严格属于 D 大调：I - IV - V - vi / I - vi - IV - V
  const FRUIT_A = [['D', 'maj'], ['G', 'maj'], ['A', 'maj'], ['B', 'min']];
  const FRUIT_B = [['D', 'maj'], ['B', 'min'], ['G', 'maj'], ['A', 'maj']];
  const chordAt = (bar) => {
    const section = Math.floor(bar / 32) % 2;
    return (section === 0 ? FRUIT_A : FRUIT_B)[bar % 4];
  };

  // ---- 主旋律：马林巴，五声音阶，A/B 段不同动机 ----
  const leadNotes = [];
  const motifA = [
    [0, 2], [2, 1], [4, 1], [2, 1], [0, 1], [1, 1], [2, 2],
    [4, 2], [3, 1], [2, 1], [0, 2], [-1, 2],
  ];
  const motifB = [
    [4, 1], [4, 1], [3, 1], [2, 1], [1, 2], [2, 1], [4, 1],
    [5, 1], [4, 1], [2, 1], [1, 1], [0, 2], [-1, 2],
  ];
  for (let bar = 0; bar < bars; bar++) {
    const section = Math.floor(bar / 32) % 2;
    const phrase = Math.floor(bar / 8) % 4;
    const motif = section === 0 ? motifA : motifB;
    // 每 8 小节一个乐句，最后两小节留白（呼吸）
    if (phrase === 3 && bar % 8 >= 6) continue;
    const [root] = chordAt(bar);
    // 和弦根音在 D 大调中的级数（D=0 G=3 A=4 B=5），旋律按级数叠加，永远贴和弦
    const rootDeg = { D: 0, G: 3, A: 4, B: 5 }[root] ?? 0;
    let pos = 0;
    let i = 0;
    while (pos < beatsPerBar) {
      const [deg, len] = motif[i % motif.length];
      const pitch = scaleNote('D', 'major', rootDeg + deg, 4);
      if (pos + len <= beatsPerBar + 0.001) {
        leadNotes.push({
          t: bar * beatsPerBar + pos,
          d: len * 0.92,
          p: fold(pitch, 64, 86),
          v: 82 + Math.round(rnd() * 16),
          opts: { tau: 0.5, bright: 1.0, gain: 0.24 },
        });
      }
      pos += len;
      i++;
    }
  }
  tracks.push({
    name: 'Marimba Lead',
    inst: 'marimba',
    gain: 1.0,
    notes: leadNotes,
    reverb: 0.32,
    delay: { time: (60 / bpm) * 0.5, feedback: 0.22, wet: 0.16, cutoff: 3200 },
  });

  // ---- 副旋律：高八度木琴点缀（呼应句尾） ----
  const echoNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    if (bar % 2 !== 1) continue;
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 74, 90);
    for (let k = 0; k < 3; k++) {
      echoNotes.push({
        t: bar * beatsPerBar + 3 + k * 0.333,
        d: 0.3,
        p: fold(chord[k % chord.length], 74, 92),
        v: 54 + k * 5,
        opts: { tau: 0.3, bright: 1.2, gain: 0.14 },
      });
    }
  }
  tracks.push({ name: 'Xylo Echo', inst: 'marimba', gain: 0.75, notes: echoNotes, reverb: 0.45 });

  // ---- 贝斯：跳跃的根音 + 五度，配合轻快律动 ----
  const bassNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const section = Math.floor(bar / 32) % 2;
    const rootP = fold(note(root + '2'), 36, 48);
    const fifth = fold(rootP + 7, 36, 50);
    const pattern = section === 0
      ? [[0, 0], [1.5, 0], [2, 7], [3, 0], [3.5, 0]]
      : [[0, 0], [1, 0], [2, 7], [2.5, 12], [3, 7], [3.5, 0]];
    for (const [t, iv] of pattern) {
      bassNotes.push({
        t: bar * beatsPerBar + t,
        d: 0.42,
        p: fold(rootP + iv, 33, 50),
        v: t === 0 ? 100 : 82,
        opts: { tau: 0.5, gain: 0.3 },
      });
    }
  }
  tracks.push({ name: 'Bass', inst: 'bass', gain: 0.95, notes: bassNotes, reverb: 0.1 });

  // ---- 和弦伴奏：木琴分解和弦（每小节 8 个音） ----
  const compNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 55, 72);
    const seq = [0, 1, 2, 1, 2, 0, 1, 2];
    for (let k = 0; k < 8; k++) {
      compNotes.push({
        t: bar * beatsPerBar + k * 0.5,
        d: 0.42,
        p: chord[seq[k] % chord.length],
        v: k % 2 === 0 ? 62 : 48,
        opts: { tau: 0.34, bright: 0.75, gain: 0.13 },
      });
    }
  }
  tracks.push({ name: 'Marimba Comp', inst: 'marimba', gain: 0.8, notes: compNotes, reverb: 0.3 });

  // ---- 打击：轻快的 kick / snare / shaker ----
  const drumKick = [];
  const drumSnare = [];
  const drumShaker = [];
  const drumWood = [];
  for (let bar = 0; bar < bars; bar++) {
    const section = Math.floor(bar / 32) % 2;
    const fill = bar % 8 === 7;
    // kick：1、3 拍（B 段加 3.5 的反拍）
    drumKick.push({ t: bar * beatsPerBar, d: 0.2, p: 36, v: 106, opts: { gain: 0.4 } });
    drumKick.push({ t: bar * beatsPerBar + 2, d: 0.2, p: 36, v: 92, opts: { gain: 0.34 } });
    if (section === 1) {
      drumKick.push({ t: bar * beatsPerBar + 3.5, d: 0.2, p: 36, v: 74, opts: { gain: 0.28 } });
    }
    // snare：2、4 拍
    drumSnare.push({ t: bar * beatsPerBar + 1, d: 0.2, p: 38, v: 88, opts: { gain: 0.22 } });
    drumSnare.push({ t: bar * beatsPerBar + 3, d: 0.2, p: 38, v: 92, opts: { gain: 0.24 } });
    if (fill) {
      for (let k = 0; k < 4; k++) {
        drumSnare.push({ t: bar * beatsPerBar + 3 + k * 0.25, d: 0.1, p: 38, v: 60 + k * 10, opts: { gain: 0.2 } });
      }
    }
    // shaker：八分音符
    for (let k = 0; k < 8; k++) {
      drumShaker.push({
        t: bar * beatsPerBar + k * 0.5,
        d: 0.1,
        p: 60,
        v: k % 2 === 0 ? 52 : 34,
        opts: { decay: 0.026, hp: 6200, gain: 0.09 },
      });
    }
    // 木鱼点缀
    if (bar % 4 === 2) {
      drumWood.push({ t: bar * beatsPerBar + 2.75, d: 0.1, p: 60, v: 60, opts: { freq: 1180, gain: 0.1 } });
    }
  }
  tracks.push({ name: 'Kick', inst: 'kick', gain: 0.9, notes: drumKick, reverb: 0.08 });
  tracks.push({ name: 'Snare', inst: 'snare', gain: 0.8, notes: drumSnare, reverb: 0.22 });
  tracks.push({ name: 'Shaker', inst: 'shaker', gain: 0.85, notes: drumShaker, reverb: 0.2 });
  tracks.push({ name: 'Woodblock', inst: 'wood', gain: 0.7, notes: drumWood, reverb: 0.3 });

  const markers = [];
  for (let bar = 0; bar < bars; bar += 32) {
    markers.push({ t: bar * beatsPerBar, name: Math.floor(bar / 32) % 2 === 0 ? 'A' : 'B' });
  }

  return {
    name: 'fruitninja',
    bpm,
    beatsPerBar,
    bars,
    seed: 0xf00d1,
    key: 'D 大调（五声）',
    tracks,
    markers,
    masterReverb: 0.6,
    reverbFeedback: 0.78,
    reverbDamp: 0.2,
  };
}

/* ================================================================== */
/* 3. g2048 —— lo-fi 舒缓，C 大调，BPM 78                              */
/* ================================================================== */

export function g2048Old() {
  // 【为什么推倒重来】用户给了五首参考曲（雪原地表、飘雪世界、紫樱、
  //   荒竹笛版、斗罗大陆身入巴蜀），要求按这个曲风重新编曲。
  //   我对五首做了客观测量，共同特征非常一致：
  //
  //     曲目          BPM   频谱重心   低频(20-250Hz)占比
  //     雪原地表      121   3507Hz    约 4%
  //     飘雪世界       86   2245Hz    约 9%
  //     紫樱          101   2812Hz    约 76%
  //     荒竹笛版       88   3200Hz    约 45%
  //     斗罗大陆       78   2196Hz    约 61%
  //
  //   结论：**中慢速（78~121）、低频厚、没有打击乐**。
  //   我上一版是 100BPM + 底鼓 + 踩镲，恰恰是最不该有的两样东西——
  //   鼓点一进来，曲子就从"雪原"变成"跑酷"了。
  //
  // 【这一版的做法】去掉全部打击乐，改成钢琴/弦乐为主的抒情织体：
  //   - 主奏用 epiano（电钢）：参考曲的频谱重心都在 2000~3500Hz，
  //     木琴太干、太脆，电钢的柔和泛音才对得上；
  //   - 铺底用 strings 长音：这是日系抒情曲的骨架，
  //     飘雪世界和紫樱的低频厚重感就来自这里；
  //   - 低音用 bass 慢速走动，不抢；
  //   - 装饰用 musicBox（八音盒）点高音，对应参考曲里那些
  //     2~3kHz 的"亮但不刺"的泛音。
  //
  // 【调性为什么是 F 大调】雪原地表的音级占比 F 20.1% 排第一，
  //   紫樱是 C#/F#，荒竹笛是 C#/F#。F 和 F# 系在这些曲子里反复出现，
  //   说明这个调域最贴合它们的音色。取 F 大调，比原来的 C 大调
  //   低一个大三度，整体更沉。
  // 【为什么是 92】六首参考曲实测 BPM：雪原 92.3、飘雪 89.1、荒竹 89.1、
  //   斗罗 95.7、紫樱 103.4、数独 95.7。中位数 92.4，取 92。
  //   之前我按自己估的 84 编，偏慢了。
  const bpm = 92;
  const beatsPerBar = 4;
  // 84 BPM、64 小节 × 4 拍 = 183 秒 ≈ 3:03。
  // 【为什么比之前短】没有鼓点之后，重复的段落更容易被听出来，
  //   宁可短一点、内容密一点，也不要 4 分钟的注水。
  // 92 BPM、64 小节 = 167 秒 ≈ 2:47
  const bars = 64;
  const rnd = mulberry32(0x2048f);
  const tracks = [];

  // ---- 和声：F 大调，I - vi - IV - V 的抒情走向 ----
  // 【为什么用这组】参考曲都是「大调但带忧郁」的日系色彩，
  //   vi（Dm）和 IV（Bb）用得很多。这里每 2 小节换一次，
  //   慢速下 2 小节 = 5.7 秒，一个和弦持续近 6 秒，够它慢慢化开。
  const PROG = [
    ['F', 'maj'], ['D', 'min'], ['A#', 'maj'], ['C', 'maj'],
  ];
  const chordAt = (bar) => PROG[Math.floor(bar / 2) % PROG.length];

  // ---- 主旋律：电钢，长气息 ----
  // 【为什么旋律要长】参考曲的 BPM 都在 78~121，但它们的乐句很长，
  //   一个音常常挂 2~4 拍。上一版我给的是 0.5~1.5 拍的短音，
  //   节奏对但气息不对——那是游戏音乐，不是抒情曲。
  //   这一版最长音给到 4 拍，让旋律有"呼吸"。
  //
  // 记法：[音级, 时值]，音级是 F 大调音阶级数（0=F）。
  // 【为什么末音要 6 拍】gate 降到 0.62 后，4 拍的音只剩 2.5 拍，
  //   抒情曲的"长气息"就没了。把末音谱面时值拉到 6 拍，
  //   实际发声 3.7 拍，既有余音又有留白。
  // 【每句必须正好 16 拍（4 小节）】否则乐句会互相重叠。
  //   末音 6 拍，前面就只能是 10 拍。
  const PHRASES = [
    // A：主音起，级进上行到 5 级再回落。末音 6 拍是全曲最长的气息。
    [[0, 3], [2, 1], [4, 2], [5, 2], [4, 2], [0, 6]],
    // A'：同头，第 4 音推到 7（导音）制造张力，再解决。
    [[0, 3], [2, 1], [4, 2], [7, 2], [5, 3], [2, 6]],
    // B：对比句，高音区下行，附点让节奏不那么平。
    [[7, 1.5], [6, 0.5], [4, 2], [5, 2], [4, 1], [0, 6]],
    // A''：收束，音阶下行，末音挂满。
    [[5, 2], [4, 2], [2, 2], [0, 2], [4, 2], [0, 6]],
  ];
  const leadNotes = [];
  // 【为什么要留整句静默】实测发声占比 76%，而参考曲的乐句之间有
  //   明显的呼吸。抒情曲的空间就是内容——一直有声音反而累。
  //   做法：每 4 句（16 小节）之后空出 1 小节纯静默。
  //   16 句 × 4 小节 = 64 小节，再插 3 个空小节会超界，
  //   所以改成 12 句 + 3 处静默 = 51 小节内容，剩下的留给前奏/尾奏。
  // 16 句 × 4 小节 = 64 小节，正好铺满全曲。
  // 静默不额外占小节，而是把每段的最后一小节留给前一句的余音——
  // 这样既有呼吸，又不浪费曲子长度。
  for (let phrase = 0; phrase < 16; phrase++) {
    const steps = PHRASES[phrase % PHRASES.length];
    const bar0 = phrase * 4;
    let pos = 0;
    // 【音区为什么分三层】四句全在同一八度会发闷。
    //   第 2 句升八度（呼应），第 4 句降八度（收束），
    //   和参考曲里"高音点缀 + 低音铺底"的层次一致。
    const inSec = phrase % 4;
    const oct = inSec === 1 ? 12 : inSec === 3 ? -12 : 0;
    for (let k = 0; k < steps.length; k++) {
      const deg = steps[k][0];
      const len = steps[k][1];
      const p = scaleNote('F', 'major', deg, 4) + oct;
      // 【为什么 gate 从 0.85 降到 0.62】gate 是"音符实际发声时长 /
      //   谱面时值"。0.85 意味着几乎连奏，实测发声占比 76%，
      //   听起来是"一直在响"，没有呼吸。
      //   降到 0.62，每个音都留出 38% 的空隙——这就是参考曲那种
      //   "钢琴踏板半踩、余音未散下一个音又来了"的质感。
      const gate = len >= 2 ? 0.62 : 0.55;
      leadNotes.push({
        t: bar0 * beatsPerBar + pos,
        d: len * gate,
        p: fold(p, 55, 84),
        // 长音重、短音轻：抒情曲的动态全在这里
        v: Math.round((len >= 2 ? 76 : 62) + rnd() * 6),
        opts: { tau: len >= 2 ? 0.9 : 0.6, gain: 0.30, bright: 0.7 },
      });
      pos += len;
    }
  }
  // ---- 高八度叠层：补高频亮度 ----
  // 【为什么必须加】实测新编曲的频谱重心只有 1107Hz，
  //   而五首参考曲在 2196~3507Hz。差了整整一个八度以上，
  //   听感就是"闷在盒子里"。参考曲的高频来自钢琴琴槌的击弦噪声
  //   和弦乐的弓弦摩擦，我的合成器没有这些，
  //   所以用一层高八度的轻音来补。
  // 【为什么用 bell 而不是 epiano 叠高八度】实测各乐器在 11025Hz 下的
  //   频谱重心：epiano 1493Hz、bell 1644Hz、strings 865Hz。
  //   参考曲（同口径降采样后）是 1485~2768Hz。
  //   epiano 叠高八度只会让同一个音色更亮一点，重心提升有限；
  //   bell 本身泛音结构不同，能真正把高频补上去。
  const shimmerNotes = leadNotes.map((n) => ({
    t: n.t,
    d: Math.min(n.d, 1.2),
    p: n.p + 12,
    v: Math.round(n.v * 0.5),
    opts: { tau: 0.55, gain: 0.13, bright: 1.15 },
  }));
  tracks.push({ name: 'Bell Shimmer', inst: 'bell', gain: 0.48, notes: shimmerNotes, reverb: 0.80 });

  tracks.push({
    name: 'E.Piano Lead',
    inst: 'epiano',
    gain: 0.82,
    notes: leadNotes,
    reverb: 0.62,
    // 【为什么加延迟】参考曲的钢琴都有明显尾音扩散，
    //   这是"空间感"的来源。0.75 拍的延迟 = 附点八分，最自然的回声。
    delay: { time: (60 / bpm) * 0.75, feedback: 0.28, wet: 0.20, cutoff: 2200 },
  });

  // ---- 弦乐铺底：日系抒情的骨架 ----
  // 【为什么必须有】去掉鼓之后，如果只有钢琴会显得空。
  //   参考曲的低频厚重感（紫樱 76%、斗罗 61% 在 250Hz 以下）
  //   主要来自弦乐长音。这里用 strings 走和弦长音，
  //   每个和弦挂满 2 小节，音量压到 0.10，只做底色。
  const padNotes = [];
  for (let bar = 0; bar < bars; bar += 2) {
    const [root, type] = chordAt(bar);
    // 【音区为什么从 45-64 提到 64-79】实测 strings 在 11025Hz 下
    //   不同音高的 1k-2kHz 能量占比：
    //     C3 3.9% / G3 5.8% / C4 11.5% / G4 14.8% / C5 25.9% / E5 31.8%
    //   参考曲这个频段是 6%~31%，只有 C5/E5 音区才够。
    //   原来放在 45-64（C3~E4），等于把这个频段压没了。
    const chord = voicing(root, type, 64, 79);
    for (const pch of chord) {
      // 【为什么再叠一层高八度】单层弦乐即使力度提到 58，
      //   1k-2kHz 也只到 3.1%，参考曲是 6~31%。
      //   叠高八度不增加低频（不会糊），但让中频翻倍。
      padNotes.push({
        t: bar * beatsPerBar,
        d: beatsPerBar * 2 - 0.3,
        p: fold(pch + 12, 74, 91),
        v: 40 + Math.round(rnd() * 4),
        opts: { tau: 2.0, gain: 0.07 },
      });
      padNotes.push({
        t: bar * beatsPerBar,
        // 挂满 2 小节再留 0.3 拍缝，避免和下一个和弦糊在一起
        d: beatsPerBar * 2 - 0.3,
        p: fold(pch, 62, 84),
        // 【力度为什么从 30 提到 58】30/127 只有 0.24 的振幅，
        //   即使轨道增益 0.90，弦乐在混音里也几乎听不见——
        //   实测 1k-2kHz 只有 1.8%，而参考曲是 6~31%。
        //   提到 58，铺底才真的铺得住。
        v: 58 + Math.round(rnd() * 5),
        opts: { tau: 2.4, gain: 0.10 },
      });
    }
  }
  // 【音量为什么从 0.58 提到 0.90】实测各乐器的频段分布：
  //   epiano 在 1k-2kHz 是 0%（FM 调制比 14 把边带推得太远），
  //   而 strings 是 27%、pad 19%、arp 14%。
  //   参考曲在 1k-2kHz 有 6~31% 的能量，这个频段是"临场感"，
  //   缺了整首曲子就闷。原来我把 strings 压到 0.58，等于把最需要的频段压没了。
  tracks.push({ name: 'Strings', inst: 'strings', gain: 0.90, notes: padNotes, reverb: 0.72 });

  // ---- 低音：慢速走动，每 2 拍一个 ----
  // 【为什么不是每拍】84BPM 下每拍 0.71 秒，每拍一个低音太赶，
  //   会形成律动感——而参考曲没有律动，只有"底"。
  const bassNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root] = chordAt(bar);
    for (let b = 0; b < beatsPerBar; b += 2) {
      bassNotes.push({
        t: bar * beatsPerBar + b,
        d: 1.8,
        p: fold(note(root + '2') + (b === 2 ? 7 : 0), 33, 48),
        v: (b === 0 ? 70 : 54) + Math.round(rnd() * 5),
        opts: { tau: 0.7, gain: 0.26 },
      });
    }
  }
  tracks.push({ name: 'Bass', inst: 'bass', gain: 0.72, notes: bassNotes, reverb: 0.20 });

  // ---- 八音盒点缀：高音区的"雪" ----
  // 【为什么用八音盒】参考曲在 2~4kHz 有一层很轻的亮点
  //   （雪原地表 11%、飘雪世界 8%），那是钢琴高音区的泛音。
  //   八音盒的音色正好在这个频段，用它点几句，
  //   模拟"雪落在远处"的感觉。
  const bellNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    // 每 4 小节在句尾点一下，密度低到几乎察觉不到
    if (bar % 4 !== 3) continue;
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 72, 88);
    for (let k = 0; k < 2; k++) {
      bellNotes.push({
        t: bar * beatsPerBar + 2 + k * 0.5,
        d: 0.8,
        p: fold(chord[k % chord.length], 72, 91),
        v: 34 + Math.round(rnd() * 5),
        opts: { tau: 0.5, gain: 0.09, bright: 0.8 },
      });
    }
  }
  tracks.push({ name: 'Music Box', inst: 'musicBox', gain: 0.46, notes: bellNotes, reverb: 0.80 });

  // ---- 中频填充：竖琴式的琶音，只在 1k-2k 那一层 ----
  // 【为什么需要】epiano 的 1k-2k 是 0%，strings 虽然有 27% 但音量有限，
  //   整首曲子的"临场感"还是不够。arp 音色在 1k-2k 有 14%，
  //   而且音区高、音量低，正好填这个空档而不抢旋律。
  const fillNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 72, 88);
    // 每小节第 2、4 拍各一个，稀疏到几乎只是"空气"
    for (const b of [1, 3]) {
      fillNotes.push({
        t: bar * beatsPerBar + b,
        d: 0.9,
        p: fold(chord[(bar + b) % chord.length], 72, 91),
        v: 30 + Math.round(rnd() * 6),
        opts: { tau: 0.6, gain: 0.09 },
      });
    }
  }
  tracks.push({ name: 'Arp Fill', inst: 'arp', gain: 0.44, notes: fillNotes, reverb: 0.80 });

  const markers = [];
  for (let bar = 0; bar < bars; bar += 16) {
    markers.push({ t: bar * beatsPerBar, name: 'S' + (bar / 16 + 1) });
  }

  return {
    name: 'g2048',
    bpm,
    beatsPerBar,
    bars,
    seed: 0x2048f,
    key: 'F 大调',
    tracks,
    markers,
    masterReverb: 0.70,
    reverbFeedback: 0.84,
    reverbDamp: 0.42,
  };
}

/* ================================================================== */
/* 4. snake —— 复古 8-bit，E 小调，BPM 132                             */
/* ================================================================== */

export function snakeOld() {
  const bpm = 132;
  const beatsPerBar = 4;
  const bars = 132; // 132 × 4 拍 @132BPM ≈ 240 秒 = 4:00
  const rnd = mulberry32(0x5aa4e);
  const tracks = [];

  const chordAt = (bar) => {
    const section = Math.floor(bar / 33) % 2;
    const table = section === 0
      ? [['E', 'min'], ['C', 'maj'], ['G', 'maj'], ['D', 'maj']]
      : [['E', 'min'], ['A', 'min'], ['C', 'maj'], ['B', 'maj']];
    return table[bar % 4];
  };

  // ---- 主旋律：8-bit 方波，A/B 段不同主题 ----
  const leadNotes = [];
  const themeA = [
    [0, 0.5], [0, 0.5], [3, 1], [0, 0.5], [0, 0.5], [2, 1],
    [0, 0.5], [0, 0.5], [3, 1], [4, 1], [3, 1],
    [2, 0.5], [2, 0.5], [1, 1], [0, 1], [-1, 2],
  ];
  const themeB = [
    [4, 0.5], [4, 0.5], [3, 0.5], [2, 0.5], [1, 1], [2, 1],
    [3, 0.5], [3, 0.5], [2, 0.5], [1, 0.5], [0, 1], [1, 1],
    [2, 0.5], [3, 0.5], [4, 1], [5, 1], [4, 1],
  ];
  for (let bar = 0; bar < bars; bar++) {
    const section = Math.floor(bar / 33) % 2;
    const theme = section === 0 ? themeA : themeB;
    const phrase = bar % 8;
    // 每 8 小节，前 6 小节有旋律，后 2 小节休息（给打击与贝斯让位）
    if (phrase >= 6) continue;
    const [root] = chordAt(bar);
    const rootDeg = { E: 0, C: 5, G: 2, D: 6, A: 3, B: 4 }[root] ?? 0;
    let pos = 0;
    let i = 0;
    while (pos < beatsPerBar) {
      const [deg, len] = theme[i % theme.length];
      const pitch = scaleNote('E', 'minor', rootDeg + deg, 4);
      if (pos + len <= beatsPerBar + 0.001) {
        leadNotes.push({
          t: bar * beatsPerBar + pos,
          d: len * 0.88,
          p: fold(pitch, 64, 88),
          v: 92 + Math.round(rnd() * 10),
          opts: { duty: section === 0 ? 0.25 : 0.5, vib: 8, gain: 0.17 },
        });
      }
      pos += len;
      i++;
    }
  }
  tracks.push({
    name: 'Square Lead',
    inst: 'squareLead',
    gain: 0.95,
    notes: leadNotes,
    reverb: 0.28,
    delay: { time: (60 / bpm) * 0.5, feedback: 0.2, wet: 0.14, cutoff: 3600 },
  });

  // ---- 琶音层：16 分音符扫和弦（红白机标志性织体） ----
  const arpNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const section = Math.floor(bar / 33) % 2;
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 60, 76);
    const order = [0, 1, 2, 1, 0, 2, 1, 2];
    for (let k = 0; k < 16; k++) {
      if (section === 0 && bar % 4 === 3) continue; // A 段每 4 小节留白一次
      arpNotes.push({
        t: bar * beatsPerBar + k * 0.25,
        d: 0.2,
        p: chord[order[k % order.length] % chord.length],
        v: k % 4 === 0 ? 62 : 40,
        opts: { duty: 0.125, gain: 0.075 },
      });
    }
  }
  tracks.push({ name: 'Arp', inst: 'arp', gain: 0.85, notes: arpNotes, reverb: 0.3 });

  // ---- 贝斯：8-bit 三角波，跳跃的根音 ----
  const bassNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root] = chordAt(bar);
    const section = Math.floor(bar / 33) % 2;
    const rootP = fold(note(root + '2'), 33, 45);
    const pat = section === 0
      ? [[0, 0], [1.5, 0], [2, 0], [3, 7]]
      : [[0, 0], [1, 0], [2, 0], [2.5, 12], [3, 7], [3.5, 0]];
    for (const [t, iv] of pat) {
      bassNotes.push({
        t: bar * beatsPerBar + t,
        d: 0.4,
        p: fold(rootP + iv, 33, 52),
        v: t === 0 ? 108 : 88,
        opts: { release: 0.04, gain: 0.32 },
      });
    }
  }
  tracks.push({ name: 'Triangle Bass', inst: 'chipBass', gain: 0.9, notes: bassNotes, reverb: 0.06 });

  // ---- 打击：8-bit 噪声鼓组 ----
  const kickN = [];
  const snareN = [];
  const hatN = [];
  for (let bar = 0; bar < bars; bar++) {
    const section = Math.floor(bar / 33) % 2;
    // kick：1、3 拍
    kickN.push({ t: bar * beatsPerBar, d: 0.15, p: 36, v: 112, opts: { gain: 0.42 } });
    kickN.push({ t: bar * beatsPerBar + 2, d: 0.15, p: 36, v: 96, opts: { gain: 0.36 } });
    if (section === 1) {
      kickN.push({ t: bar * beatsPerBar + 3.5, d: 0.15, p: 36, v: 78, opts: { gain: 0.3 } });
    }
    // snare：2、4 拍
    snareN.push({ t: bar * beatsPerBar + 1, d: 0.15, p: 38, v: 96, opts: { gain: 0.24 } });
    snareN.push({ t: bar * beatsPerBar + 3, d: 0.15, p: 38, v: 100, opts: { gain: 0.26 } });
    if (bar % 8 === 7) {
      for (let k = 0; k < 4; k++) {
        snareN.push({ t: bar * beatsPerBar + 3 + k * 0.25, d: 0.08, p: 38, v: 70 + k * 12, opts: { gain: 0.22 } });
      }
    }
    // hat：八分音符
    for (let k = 0; k < 8; k++) {
      hatN.push({
        t: bar * beatsPerBar + k * 0.5,
        d: 0.06,
        p: 60,
        v: k % 2 === 0 ? 50 : 30,
        opts: { decay: 0.02, hp: 8000, gain: 0.07 },
      });
    }
  }
  tracks.push({ name: 'Noise Kick', inst: 'kick', gain: 0.85, notes: kickN, reverb: 0.06 });
  tracks.push({ name: 'Noise Snare', inst: 'snare', gain: 0.8, notes: snareN, reverb: 0.18 });
  tracks.push({ name: 'Hat', inst: 'hat', gain: 0.7, notes: hatN, reverb: 0.15 });

  const markers = [];
  for (let bar = 0; bar < bars; bar += 33) {
    markers.push({ t: bar * beatsPerBar, name: Math.floor(bar / 33) % 2 === 0 ? 'A' : 'B' });
  }

  return {
    name: 'snake',
    bpm,
    beatsPerBar,
    bars,
    seed: 0x5aa4e,
    key: 'E 小调',
    tracks,
    markers,
    masterReverb: 0.45,
    reverbFeedback: 0.74,
    reverbDamp: 0.18,
  };
}


/* ================================================================== */
/* 5. watermelon —— 八段锦风格，D 宫五声，BPM 66                      */
/* ================================================================== */

/**
 * 合成大西瓜的 BGM：八段锦风格。
 *
 * 【八段锦是什么】北宋传下来的八节导引功法（"双手托天理三焦"那一套），
 *   练的时候配的是缓慢、绵长、有呼吸感的音乐。它不是"古风"，
 *   也不是"禅意电子"，核心特征是：
 *     1. 慢 —— 一拍对应一次呼吸的伸展，不能有律动感；
 *     2. 五声 —— 宫商角徵羽，不用导音，听不出"要解决到主音"的紧张；
 *     3. 无鼓 —— 打点会把人从"数息"里拽出来；
 *     4. 留白 —— 句子之间有气口，音与音之间不填满。
 *
 * 【为什么用 D 宫】D 宫的频率落在人声舒适区，
 *   而且古琴正调（F 宫）太低、笛子常用调偏高，D 居中不压耳。
 *   五声音阶用 majorPent（宫商角徵羽 = 0 2 4 7 9）。
 *
 * 【和游戏的关系】合成大西瓜是"慢慢堆、等它合"的节奏，
 *   本来就不该配快曲子。八段锦的呼吸感正好对上"看水果往下掉"的松弛。
 */
export function watermelonOld() {
  // 【为什么跟着换曲风】用户给了五首参考曲，要求 2048 和大西瓜都按
  //   这个方向重新编曲。2048 那边我取了 F 大调 + 84BPM，
  //   大西瓜不能照抄，否则两个游戏听感重叠。
  //
  // 【参考数据怎么分配】
  //   五首参考曲的 BPM 跨度是 78~121，正好够分成两档：
  //     - 慢档（78~88）：飘雪世界 86、荒竹笛 88、斗罗大陆 78
  //     - 快档（101~121）：雪原地表 121、紫樱 101
  //   2048 是数字游戏，需要一点推进感，取 84（慢档里偏中）。
  //   大西瓜是"慢慢堆、等它合"，更该慢，取 76。
  //
  // 【调性怎么选】斗罗大陆的音级是 A 18%、E 15%、C 13%、B 12%，
  //   荒竹笛是 C# 15%、F# 12%、E 11%、A 11%——都偏向 A/E 这一带。
  //   取 A 大调，正好是这些曲子的重心，也和我之前那版同调，
  //   但织体完全不同。
  //
  // 【和 2048 的真正区别】
  //   - 2048 用 F 大调、84BPM、电钢主奏、弦乐铺底、有八音盒点缀；
  //   - 大西瓜用 A 大调、76BPM、钢琴（epiano 低八度）主奏、
  //     更厚的弦乐、没有八音盒，改用笛声质感的 bell 做远景。
  //   两首都不带鼓，都走低频厚的抒情路子，但速度和音区拉开。
  // 【为什么是 89】参考曲最慢的两首是飘雪 89.1、荒竹 89.1。
  //   大西瓜要比 2048（92）再慢一点，取 89，正好落在参考曲的最低档。
  const bpm = 89;
  const beatsPerBar = 4;
  // 76 BPM、56 小节 × 4 拍 = 177 秒 ≈ 2:57
  // 89 BPM、56 小节 = 151 秒 ≈ 2:31
  const bars = 56;
  const rnd = mulberry32(0x8d21f);
  const tracks = [];

  // ---- 和声：A 大调，加 ii 和 vi 让色彩更柔 ----
  // 【为什么多一个和弦】2048 用 4 个和弦循环，大西瓜用 6 个，
  //   因为它的速度更慢、和弦持续更久，需要更多色彩变化，
  //   否则 3 分钟里同一个和弦听太多遍。
  const PROG = [
    ['A', 'maj'], ['F#', 'min'], ['D', 'maj'], ['E', 'maj'],
    ['B', 'min'], ['E', 'maj'],
  ];
  const chordAt = (bar) => PROG[Math.floor(bar / 2) % PROG.length];

  // ---- 主旋律：钢琴，气息比 2048 更长 ----
  // 【为什么音更少、更长】76BPM 每拍 0.79 秒，比 2048 慢。
  //   这个速度下写短音会显得急躁。全曲主旋律只用了 6 个乐句，
  //   每句 4 小节，最长音挂 5 拍。
  //
  // 记法：[音级, 时值]，音级是 A 大调音阶级数（0=A）。
  const PHRASES = [
    // A：主音起，缓慢上行，像水果一颗颗落下
    [[0, 4], [2, 2], [3, 2], [2, 4], [0, 4]],
    // A'：抬高到 5 级，情绪上扬
    [[0, 4], [2, 2], [5, 2], [4, 4], [2, 4]],
    // B：从高音落下，附点制造轻微的迟疑
    [[5, 3], [4, 1], [3, 2], [2, 2], [0, 4]],
    // B'：继续下行，落到 6 级（下属），不完全解决
    [[4, 3], [3, 1], [2, 2], [1, 2], [0, 4]],
    // C：唯一一次上行跳进，作为全曲高点
    [[0, 2], [3, 2], [5, 2], [7, 2], [5, 4]],
    // A''：收束，回到主音，末音挂 5 拍
    [[3, 2], [2, 2], [1, 2], [0, 5]],
  ];
  const leadNotes = [];
  for (let phrase = 0; phrase < 14; phrase++) {
    const steps = PHRASES[phrase % PHRASES.length];
    const bar0 = phrase * 4;
    let pos = 0;
    // 音区三层：第 2 句高八度、第 5 句（高点）最高、其余原调
    const inCycle = phrase % 6;
    const oct = inCycle === 1 ? 12 : inCycle === 4 ? 12 : inCycle === 5 ? -12 : 0;
    for (let k = 0; k < steps.length; k++) {
      const deg = steps[k][0];
      const len = steps[k][1];
      const p = scaleNote('A', 'major', deg, 4) + oct;
      // 【为什么 gate 降到 0.60】同 2048：0.85 太连奏，听起来一直在响。
      //   大西瓜比 2048 更慢更静，gate 还要再低一点，
      //   让每个音都有明显的余音空间。
      const gate = len >= 3 ? 0.60 : 0.52;
      leadNotes.push({
        t: bar0 * beatsPerBar + pos,
        d: len * gate,
        p: fold(p, 52, 84),
        v: Math.round((len >= 3 ? 74 : 60) + rnd() * 6),
        opts: { tau: len >= 3 ? 1.0 : 0.65, gain: 0.28, bright: 0.65 },
      });
      pos += len;
    }
  }
  const shimmerNotes = leadNotes.map((n) => ({
    t: n.t,
    d: Math.min(n.d, 1.2),
    p: n.p + 12,
    v: Math.round(n.v * 0.46),
    opts: { tau: 0.55, gain: 0.12, bright: 1.1 },
  }));
  tracks.push({ name: 'Bell Shimmer', inst: 'bell', gain: 0.46, notes: shimmerNotes, reverb: 0.82 });

  tracks.push({
    name: 'Piano Lead',
    inst: 'epiano',
    gain: 0.80,
    notes: leadNotes,
    reverb: 0.68,
    // 延迟比 2048 更长（1.0 拍），回声更远，空间更大
    delay: { time: (60 / bpm) * 1.0, feedback: 0.30, wet: 0.22, cutoff: 2000 },
  });

  // ---- 弦乐：比 2048 更厚 ----
  // 【为什么加厚】大西瓜的画面是柔和的、圆的，声音也该更厚。
  //   这里每个和弦叠 4 个音（三和弦 + 根音低八度），
  //   2048 那边只叠 3 个。
  const padNotes = [];
  for (let bar = 0; bar < bars; bar += 2) {
    const [root, type] = chordAt(bar);
    // 【音区 43-62 → 62-79】理由同 2048：只有 C5/E5 音区才能在
    //   1k-2kHz 提供参考曲那种临场感。
    const chord = voicing(root, type, 62, 79);
    for (const pch of chord) {
      padNotes.push({
        t: bar * beatsPerBar,
        d: beatsPerBar * 2 - 0.4,
        p: fold(pch + 12, 72, 89),
        v: 42 + Math.round(rnd() * 4),
        opts: { tau: 2.2, gain: 0.08 },
      });
      padNotes.push({
        t: bar * beatsPerBar,
        d: beatsPerBar * 2 - 0.4,
        p: fold(pch, 60, 84),
        // 【力度 32 → 60】同 2048：力度太低等于没铺。
        v: 60 + Math.round(rnd() * 5),
        opts: { tau: 2.6, gain: 0.11 },
      });
    }
    // 根音低八度补厚
    padNotes.push({
      t: bar * beatsPerBar,
      d: beatsPerBar * 2 - 0.4,
      // 【为什么提到 55-64】原来补在 45-55（A2~G3），
      //   把整体频谱重心拖到 1032Hz，低于六首参考曲的最低值 1178Hz。
      //   提到 55-64（G3~E4），厚度还在，但不再往下坠。
      p: fold(note(root + '3'), 55, 64),
      v: 26 + Math.round(rnd() * 3),
      opts: { tau: 2.6, gain: 0.09 },
    });
  }
  // 【音量 0.62 → 0.92】理由同 2048：strings 是唯一在 1k-2kHz 有
  //   可观能量（27%）的柔和音色，压低它等于压掉临场感。
  tracks.push({ name: 'Strings', inst: 'strings', gain: 0.92, notes: padNotes, reverb: 0.76 });

  // ---- 低音：比 2048 更稀 ----
  // 【为什么每 4 拍才一个】76BPM 下 4 拍 = 3.2 秒。
  //   大西瓜的节奏本来就慢，低音再密就成了律动。
  const bassNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root] = chordAt(bar);
    bassNotes.push({
      t: bar * beatsPerBar,
      d: 3.6,
      p: fold(note(root + '2'), 31, 46),
      v: 66 + Math.round(rnd() * 5),
      opts: { tau: 0.9, gain: 0.24 },
    });
  }
  tracks.push({ name: 'Bass', inst: 'bass', gain: 0.70, notes: bassNotes, reverb: 0.22 });

  // ---- 远景：钟声质感的单音，模拟远处 ----
  // 【为什么用 bell 而不是八音盒】八音盒太"叮"，像玩具。
  //   大西瓜要的是"远处的钟"，bell 的衰减更长、更圆。
  const bellNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    // 每 8 小节才点一次，密度极低
    if (bar % 8 !== 7) continue;
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 67, 84);
    bellNotes.push({
      t: bar * beatsPerBar + 1,
      d: 2.5,
      p: fold(chord[0], 67, 88),
      v: 28 + Math.round(rnd() * 4),
      opts: { tau: 1.2, gain: 0.07, bright: 0.6 },
    });
  }
  tracks.push({ name: 'Bell', inst: 'bell', gain: 0.42, notes: bellNotes, reverb: 0.85 });

  // ---- 中频填充：比 2048 更稀，只在高音区点 ----
  // 【为什么更稀】大西瓜更慢、更静，填充太多会显得吵。
  //   每 2 小节才点 1 个音，音量也压得更低。
  const fillNotes = [];
  for (let bar = 0; bar < bars; bar += 2) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 69, 86);
    fillNotes.push({
      t: bar * beatsPerBar + 2,
      d: 1.4,
      p: fold(chord[bar % chord.length], 69, 88),
      v: 26 + Math.round(rnd() * 5),
      opts: { tau: 0.8, gain: 0.08 },
    });
  }
  tracks.push({ name: 'Arp Fill', inst: 'arp', gain: 0.38, notes: fillNotes, reverb: 0.84 });

  const markers = [];
  for (let bar = 0; bar < bars; bar += 14) {
    markers.push({ t: bar * beatsPerBar, name: 'S' + (bar / 14 + 1) });
  }

  return {
    name: 'watermelon',
    bpm,
    beatsPerBar,
    bars,
    seed: 0x8d21f,
    key: 'A 大调',
    tracks,
    markers,
    masterReverb: 0.74,
    reverbFeedback: 0.86,
    reverbDamp: 0.46,
  };
}


/* ================================================================== */
/* 曲风内核：从用户那首《Boarding Pass in the Clouds》里提炼出来的一套写法   */
/* ================================================================== */

/**
 * 这套内核是干什么的
 * ----------------------------------------------------------------
 * 用户自己调了几十遍做出一首曲子（_10plus.mid，9分16秒，17 轨 16 件乐器），
 * 说这个曲风他非常喜欢，要我把另外几首也写成同一个味道。
 * 光"听着像"不算数，得把它拆成能量化的特征，否则五首各写各的必然散架。
 *
 * 我实测了那首 MIDI，提取到这些硬指标（都是可复现的统计）：
 *
 *   调式     G 大调音阶，但主音是 D —— 也就是 D 混合利底亚。
 *           证据：各轨音级分布里 D 永远第一（钢琴 319、贝斯 113、吉他 322），
 *           G 第二，而且有 F 自然音（不是 F#）—— 混合利底亚的降七级特征。
 *   速度     88 BPM 起，四段渐慢到 65。循环曲不能渐慢，取 84 作为中间值。
 *   拍号     4/4。
 *   旋律     音程分布 0(114) +3(108) -3(107) +4(82) -4(60) -2(57)，
 *           即**几乎全是二度三度级进**，超过六度的大跳只有零星几次。
 *           这是吟唱式的、没有棱角的旋律线，也是这套曲风最核心的特征。
 *   钢琴     8.7 音/小节，8 分音符分解和弦打底，重音在每拍正拍。
 *   尼龙吉他 5.8 音/小节，正好是 8 分音符六连（0/2/4/6/10/12 十六分格）。
 *   铺底     Warm Pad 每小节 1 个长音，弦乐 3.4 音/小节长音。
 *   点缀     马林巴在反拍（2/6/10/14 十六分格）每小节 4 个音。
 *   打击     极轻。闭镲 960 次是绝对主力，底鼓 400，Ride 160，
 *           军鼓只有 40 —— 基本不用军鼓，没有流行鼓组的"啪"。
 *
 * 结论：这是一首**空灵、温暖、五声色彩的新世纪/治愈系**曲子。
 * 关键不是用了哪些乐器，而是：级进旋律 + 8分分解 + 长音铺底 + 反拍点缀 + 极轻打击。
 * 下面五个函数把这五点固化成工具，五个游戏共用，曲风才不会散。
 */

/**
 * 混合利底亚音阶取音。
 *
 * 【为什么要单独包一层】scaleNote 用的是 SCALES 里的音阶表，
 * 混合利底亚是 [0,2,4,5,7,9,10]（降七级）。参考曲的 F 自然音就来自这里。
 * 直接用 major 会得到 F#，味道立刻从"民谣治愈"变成"儿歌明亮"。
 */
function mixo(root, deg, octave = 4) {
  return scaleNote(root, 'mixolydian', deg, octave);
}

/**
 * 级进旋律生成器 —— 这套曲风的灵魂。
 *
 * 【为什么不能随便写音】参考曲的音程统计里，三度和二度占了 76%，
 * 六度以上大跳只有 7.5%。如果旋律里塞八度跳进，那一下就"出戏"了。
 *
 * 【为什么密度必须是每小节 5 个音】我实测参考曲钢琴高音区 763 个音，
 *   分布在小节上平均 5.09 个/小节，最多的密度是每小节 6 个（37 次）。
 *   第一版我写成"长音吟唱"（每小节 1 个音），听起来完全不是同一首曲子——
 *   参考曲的旋律其实是**密集的 4 分音符线条**，不是长音铺底。
 *   所以这里按"每小节 4~6 个音"来生成。
 *
 * 【三度为什么这么重要】参考曲三度占 47%，二度占 29%。
 *   也就是说它的旋律主要是"隔一个音跳"（1-3-5-3-1 这种），
 *   而不是"挨着走"（1-2-3-4-3）。这是五声调式的典型写法，
 *   也是这套曲风听起来"空"的原因。所以这里三度的权重最高。
 *
 * @param {number} startDeg  起始音级
 * @param {number} steps     要生成几个音
 * @param {object} o         { rnd, leap, span }
 * @returns {number[]} 音级序列
 */
function stepwise(startDeg, steps, o = {}) {
  const rnd = o.rnd || Math.random;
  const leap = o.leap ?? 0.06;   // 大跳概率，参考曲实测 7.5%
  const span = o.span ?? 5;      // 旋律活动范围（音级）
  const out = [];
  let deg = startDeg;
  for (let i = 0; i < steps; i++) {
    out.push(deg);
    // 【权重怎么来的】参考曲实测：三度 47%、二度 29%、同音 13%、大跳 7.5%。
    //   第一版我按"±1 二度 58%、±2 三度 28%"写，实测出来三度只有 14~22%，
    //   因为 ±1 走两步就抵消了统计上的"级进感"，听感变成"爬音阶"而不是"跳三度"。
    //   所以这里把三度的权重直接拉到 47%，二度压到 26%，让统计结果对上参考曲。
    //   这个比例直接决定"像不像"——差 25 个百分点就是两首不同的曲子。
    let move;
    if (rnd() < leap) {
      // 大跳只往上，且不超过五度——往下大跳会显得沉重，破坏轻盈感
      move = 4 + Math.floor(rnd() * 2);
    } else {
      const pick = rnd();
      if (pick < 0.13) move = 0;                          // 同音 13%
      else if (pick < 0.26) move = 1;                     // 上行二度 13%
      else if (pick < 0.39) move = -1;                    // 下行二度 13%
      else if (pick < 0.63) move = 2;                     // 上行三度 24%
      else if (pick < 0.87) move = -2;                    // 下行三度 24%
      else if (pick < 0.94) move = 3;                     // 上行四度 7%
      else move = -3;                                     // 下行四度 7%
    }
    // 【为什么先判断再移动，而不是移动完再拉回】
    //   原来写的是 deg += move 之后如果越界就 -= 3，结果会产生
    //   "73 → 81 → 73 → 81" 这种八度来回跳：越界拉回 8 个半音，
    //   下一轮又跳上去，来回震荡。听起来像卡带。
    //   正确做法是：移动前就检查，越界就改成反向的小步移动。
    const hi = startDeg + span;
    const lo = startDeg - span;
    if (deg + move > hi) {
      // 越上界：改成往下走三度或二度，而不是猛拉回来
      deg -= (rnd() < 0.5 ? 2 : 1);
    } else if (deg + move < lo) {
      deg += (rnd() < 0.5 ? 2 : 1);
    } else {
      deg += move;
    }
  }
  return out;
}

/**
 * 密集旋律：按小节生成，每小节 4~6 个音，用 4 分/8 分混合节奏。
 *
 * 【为什么不复用 stepwise】stepwise 只给音高级数，不给节奏。
 *   参考曲的节奏型实测是：正拍起、附点、切分混用（8:1.49 / 8:1.99 / 9:0.00）。
 *   所以这里给几种固定节奏型轮换，比随机生成更自然。
 *
 * @returns {{deg:number, pos:number, len:number}[]} 相对小节起点的音符
 */
function melodyBar(startDeg, rnd, o = {}) {
  // 节奏型：每种是一串 [时值]，总和 = 4 拍
  // 【为什么是这几种】从参考曲实测的落点分布反推出来的：
  //   正拍(0/4/8/12)最多，其次是半拍(2/6/10/14)，偶尔有 16 分切分。
  const RHYTHMS = [
    [1, 1, 1, 1],           // 四个 4 分音符（最常见）
    [1.5, 0.5, 1, 1],       // 附点 + 8 分
    [1, 0.5, 0.5, 1, 1],    // 切分
    [2, 1, 1],              // 两个 2 分 + 两个 4 分
    [1, 1, 2],              // 4 分 + 2 分
    [0.5, 0.5, 1, 1, 1],    // 8 分起头
  ];
  const rhy = RHYTHMS[Math.floor(rnd() * RHYTHMS.length)];
  const degs = stepwise(startDeg, rhy.length, { rnd, leap: o.leap ?? 0.06, span: o.span ?? 5 });
  const out = [];
  let pos = 0;
  for (let i = 0; i < rhy.length; i++) {
    out.push({ deg: degs[i], pos, len: rhy[i] });
    pos += rhy[i];
  }
  return out;
}
/**
 * 8 分音符分解和弦 —— 参考曲钢琴声部的核心织体。
 *
 * 【为什么是这几个音级】实测钢琴轨 8.7 音/小节，落点集中在
 * 正拍和半拍（十六分格 0/4/8/12），说明它就是标准的 8 分分解。
 * 音高走 根-五-八-五 的往返，是分解和弦最稳的形态。
 *
 * @returns {{t:number,d:number,p:number,v:number}[]} 相对小节起点的音符
 */
function brokenChord(rootName, type, bar, beatsPerBar, o = {}) {
  const rnd = o.rnd || Math.random;
  const lo = o.lo ?? 55;
  const hi = o.hi ?? 79;
  const gain = o.gain ?? 0.30;
  const chord = voicing(rootName, type, lo, hi);
  // 往返型：根 五 八 五 | 根 五 八 五，正好 8 个 8 分音符填满一小节
  const order = [0, 1, 2, 1, 0, 1, 2, 1];
  const out = [];
  for (let k = 0; k < 8; k++) {
    const p = chord[order[k] % chord.length];
    out.push({
      t: bar * beatsPerBar + k * 0.5,
      d: 0.42,
      p: fold(p, lo, hi),
      // 正拍重、反拍轻：这是"有呼吸"而不是"机械"的关键
      v: Math.round((k % 2 === 0 ? 52 : 38) + rnd() * 6),
      opts: { tau: 0.34, gain },
    });
  }
  return out;
}

/**
 * 反拍马林巴点缀 —— 参考曲的辨识度来源之一。
 *
 * 【为什么落在 2/6/10/14】实测马林巴 480 个音，100% 落在这四个十六分格，
 * 也就是每拍的"后半拍"。正拍留白、反拍点一下，是这套曲风轻盈感的来源。
 */
function offbeatMarimba(rootName, type, bar, beatsPerBar, o = {}) {
  const rnd = o.rnd || Math.random;
  const lo = o.lo ?? 64;
  const hi = o.hi ?? 81;
  const chord = voicing(rootName, type, lo, hi);
  const out = [];
  for (let k = 0; k < 4; k++) {
    // 反拍：每拍的 0.5 拍位置
    const p = chord[(k + 1) % chord.length];
    out.push({
      t: bar * beatsPerBar + k + 0.5,
      d: 0.30,
      p: fold(p, lo, hi),
      v: Math.round(34 + rnd() * 8),
      opts: { tau: 0.30, gain: 0.16 },
    });
  }
  return out;
}

/**
 * 极轻的打击层 —— 只有闭镲和零星底鼓，没有军鼓。
 *
 * 【为什么不用军鼓】参考曲 192 小节里军鼓只有 40 次，平均 5 小节才一下。
 * 而闭镲有 960 次（每小节 5 个）。这说明它根本不是一个"有节奏感"的鼓组，
 * 而是用闭镲做时间刻度、底鼓做心跳。加军鼓会立刻变成流行/摇滚。
 */
function softPercussion(bar, beatsPerBar, o = {}) {
  const rnd = o.rnd || Math.random;
  const out = [];
  const hatGain = o.hatGain ?? 0.10;
  const kickGain = o.kickGain ?? 0.30;
  // 闭镲：每拍一次，偶尔加一个反拍
  for (let b = 0; b < beatsPerBar; b++) {
    out.push({
      t: bar * beatsPerBar + b,
      d: 0.12,
      p: 42,
      v: Math.round((b === 0 ? 40 : 28) + rnd() * 6),
      inst: 'hat',
      opts: { tau: 0.045, gain: hatGain },
    });
    if (rnd() < 0.25) {
      out.push({
        t: bar * beatsPerBar + b + 0.5,
        d: 0.10,
        p: 42,
        v: Math.round(20 + rnd() * 5),
        inst: 'hat',
        opts: { tau: 0.04, gain: hatGain * 0.7 },
      });
    }
  }
  // 底鼓：第 1 拍必有，第 3 拍偶尔
  out.push({ t: bar * beatsPerBar, d: 0.4, p: 36, v: 84, inst: 'kick', opts: { tau: 0.16, gain: kickGain } });
  if (rnd() < 0.45) {
    out.push({ t: bar * beatsPerBar + 2, d: 0.3, p: 36, v: 62, inst: 'kick', opts: { tau: 0.14, gain: kickGain * 0.8 } });
  }
  return out;
}

/* ================================================================== */
/* 以下五首按用户参考曲的曲风重写（2026-11-24）                          */
/* 五首共用上面的曲风内核，只在调性、速度、配器侧重上区分。                */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/* 2. minesweeper —— 冷静但要"空"，不能有悬疑的紧张感                     */
/* ------------------------------------------------------------------ */
/*
 * 【为什么整首重写】旧版是 A 小调 + 心跳脉冲，走的是"悬疑"路线。
 *   但用户说他喜欢的是参考曲那种空灵治愈的味道，要五首都统一过去。
 *   扫雷本身是慢节奏的推理游戏，用这个曲风其实更合适——
 *   紧张感交给玩家自己的判断，音乐只负责让人坐得住。
 *
 * 【和参考曲怎么对齐】
 *   - 调性：参考曲是 D 混合利底亚。扫雷换到 A 混合利底亚（同一个调式），
 *     音区整体上移四度，和其他几首拉开距离。
 *   - 速度：参考曲 88 BPM，扫雷是思考型游戏，取 80，比参考曲更静。
 *   - 配器：钢琴主奏 + 弦乐铺底 + 马林巴反拍 + 极轻打击。
 *     参考曲里那些木管（Flute/Oboe）这里用 bell 替代，音色更冷一点，
 *     正好对应扫雷"一格一格推理"的冷静感。
 */
export function minesweeper() {
  const bpm = 80;
  const beatsPerBar = 4;
  // 64 小节 × 4 拍 @80BPM = 192 秒 = 3:12，循环起来够长，不会听腻
  const bars = 64;
  const rnd = mulberry32(0x51ee9);
  const tracks = [];

  // ---- 和声：A 混合利底亚，四级循环 ----
  // 【为什么是这四个】参考曲的根音序列是 E-C-G-D-G-E-A-D，
  //   本质是 I-VII-VI-VII 这种"不解决"的循环。这里取 A-G-D-A，
  //   同样是绕开导音的开放走向，听感上"一直没结束"，适合循环。
  const PROG = [
    ['A', 'maj'], ['G', 'maj'], ['D', 'maj'], ['A', 'maj'],
  ];
  const chordAt = (bar) => PROG[Math.floor(bar / 2) % PROG.length];

  // ---- 钢琴：8 分分解，参考曲的主力织体 ----
  const pianoNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    pianoNotes.push(...brokenChord(root, type, bar, beatsPerBar, {
      rnd, lo: 55, hi: 76, gain: 0.26,
    }));
  }
  tracks.push({
    name: 'Piano',
    inst: 'epiano',
    gain: 0.72,
    notes: pianoNotes,
    reverb: 0.66,
    delay: { time: (60 / bpm) * 0.75, feedback: 0.26, wet: 0.18, cutoff: 2200 },
  });

    // ---- 主旋律：密集线条，每小节 4~6 个音 ----
  // 【为什么按小节生成而不是按乐句】参考曲实测每小节平均 5.09 个音，
  //   按小节生成才能精确控制这个密度。按乐句生成容易变成"长音吟唱"，
  //   那是完全不同的曲风。
  const leadNotes = [];
  let degCursor = 0;
  for (let bar = 0; bar < bars; bar++) {
    // 每 4 小节换一次活动中心，避免旋律一直在原地打转
    if (bar % 4 === 0) degCursor = [0, 2, 4, 2, 3, 1, 4, 2][Math.floor(bar / 4) % 8];
    const mel = melodyBar(degCursor, rnd, { leap: 0.06, span: 5 });
    for (const n of mel) {
      degCursor = n.deg;
      leadNotes.push({
        t: bar * beatsPerBar + n.pos,
        d: n.len * 0.72,
        p: fold(mixo('A', n.deg, 5), 60, 84),
        v: Math.round((n.len >= 2 ? 70 : 56) + rnd() * 6),
        opts: { tau: n.len >= 2 ? 0.95 : 0.55, gain: 0.24, bright: 0.74 },
      });
    }
  }
tracks.push({
    name: 'Lead',
    inst: 'musicBox',
    gain: 0.56,
    notes: leadNotes,
    reverb: 0.78,
    delay: { time: (60 / bpm) * 1.0, feedback: 0.28, wet: 0.20, cutoff: 2000 },
  });

  // ---- 弦乐铺底：每小节长音 ----
  const padNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 60, 79);
    for (const pch of chord) {
      padNotes.push({
        t: bar * beatsPerBar,
        d: beatsPerBar - 0.3,
        p: fold(pch, 60, 82),
        v: 54 + Math.round(rnd() * 5),
        opts: { tau: 1.8, gain: 0.085 },
      });
    }
    padNotes.push({
      t: bar * beatsPerBar,
      d: beatsPerBar - 0.3,
      p: fold(note(root + '3'), 52, 62),
      v: 24 + Math.round(rnd() * 3),
      opts: { tau: 2.0, gain: 0.07 },
    });
  }
  tracks.push({ name: 'Strings', inst: 'strings', gain: 0.86, notes: padNotes, reverb: 0.76 });

  // ---- 马林巴反拍 ----
  const marNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    marNotes.push(...offbeatMarimba(root, type, bar, beatsPerBar, { rnd, lo: 64, hi: 81 }));
  }
  tracks.push({ name: 'Marimba', inst: 'marimba', gain: 0.50, notes: marNotes, reverb: 0.72 });

  // ---- 贝斯：每小节一个长音，很稀 ----
  const bassNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root] = chordAt(bar);
    bassNotes.push({
      t: bar * beatsPerBar,
      d: 3.4,
      p: fold(note(root + '2'), 31, 46),
      v: 62 + Math.round(rnd() * 5),
      opts: { tau: 0.85, gain: 0.22 },
    });
  }
  tracks.push({ name: 'Bass', inst: 'bass', gain: 0.66, notes: bassNotes, reverb: 0.20 });

  // ---- 打击：极轻，只有闭镲和底鼓 ----
  // 【为什么还要打击】完全没有打击会显得"塌"，参考曲有闭镲 960 次。
  //   但音量压到很低，只做时间刻度，不抢戏。
  const percNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    percNotes.push(...softPercussion(bar, beatsPerBar, { rnd, hatGain: 0.075, kickGain: 0.26 }));
  }
  tracks.push({ name: 'Perc', inst: 'hat', gain: 0.55, notes: percNotes, reverb: 0.18 });

  const markers = [];
  for (let bar = 0; bar < bars; bar += 16) {
    markers.push({ t: bar * beatsPerBar, name: 'S' + (bar / 16 + 1) });
  }

  return {
    name: 'minesweeper',
    bpm,
    beatsPerBar,
    bars,
    seed: 0x51ee9,
    key: 'A 混合利底亚',
    tracks,
    markers,
    masterReverb: 0.72,
    reverbFeedback: 0.84,
    reverbDamp: 0.44,
  };
}

/* ------------------------------------------------------------------ */
/* 3. g2048 —— 数字在长，音乐要跟着"一层层往上走"                       */
/* ------------------------------------------------------------------ */
/*
 * 【和扫雷怎么区分】两首都是混合利底亚、都是钢琴 + 弦乐 + 马林巴。
 *   如果只换调性，听感还是同一首。所以这里做三处硬区分：
 *     1. 调性换到 D 混合利底亚 —— 直接和参考曲同调，是用户最熟的那个味道；
 *     2. 速度提到 88，正好是参考曲的起始速度；
 *     3. 加一条竖琴琶音（参考曲有 Harp 轨），扫雷那边没有。
 *   竖琴的琶音是"往上爬"的，正好对应 2048 数字不断合并变大。
 */
export function g2048() {
  const bpm = 88;
  const beatsPerBar = 4;
  // 64 小节 @88BPM = 174 秒 ≈ 2:54
  const bars = 64;
  const rnd = mulberry32(0x2048a);
  const tracks = [];

  // ---- 和声：D 混合利底亚 ----
  // 【为什么是这组】参考曲根音走向 E-C-G-D 反复出现，是 I-bVII-IV-I 的变体。
  //   D 调上就是 D-C-G-D。保留 bVII（C 大调）是关键——
  //   它是混合利底亚的灵魂，去掉就变成普通大调了。
  const PROG = [
    ['D', 'maj'], ['C', 'maj'], ['G', 'maj'], ['D', 'maj'],
  ];
  const chordAt = (bar) => PROG[Math.floor(bar / 2) % PROG.length];

  // ---- 钢琴：8 分分解 ----
  const pianoNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    pianoNotes.push(...brokenChord(root, type, bar, beatsPerBar, {
      rnd, lo: 57, hi: 78, gain: 0.27,
    }));
  }
  tracks.push({
    name: 'Piano',
    inst: 'epiano',
    gain: 0.74,
    notes: pianoNotes,
    reverb: 0.68,
    delay: { time: (60 / bpm) * 0.75, feedback: 0.26, wet: 0.18, cutoff: 2200 },
  });

  // ---- 竖琴琶音：往上爬，对应数字合并 ----
  // 【为什么是上行】参考曲 Harp 轨只有 60 个音，落在 8/13/3 十六分格，
  //   是零星的刮奏。这里做成每 2 小节一次的上行琶音，
  //   既保留"零星点缀"的稀疏感，又给 2048 一个往上走的动势。
  const harpNotes = [];
  for (let bar = 0; bar < bars; bar += 2) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 60, 84);
    // 上行：根 三 五 八，四个音跨一个八度
    const seq = [chord[0], chord[1] ?? chord[0] + 4, chord[2] ?? chord[0] + 7, chord[0] + 12];
    for (let k = 0; k < seq.length; k++) {
      harpNotes.push({
        t: bar * beatsPerBar + k * 0.25,
        d: 0.5,
        p: fold(seq[k], 64, 88),
        v: Math.round(46 + k * 4 + rnd() * 4),
        opts: { tau: 0.5, gain: 0.14, bright: 0.9 },
      });
    }
  }
  tracks.push({ name: 'Harp', inst: 'pluck', gain: 0.52, notes: harpNotes, reverb: 0.80 });

    // ---- 主旋律：密集线条，每小节 4~6 个音 ----
  // 【为什么按小节生成而不是按乐句】参考曲实测每小节平均 5.09 个音，
  //   按小节生成才能精确控制这个密度。按乐句生成容易变成"长音吟唱"，
  //   那是完全不同的曲风。
  const leadNotes = [];
  let degCursor = 0;
  for (let bar = 0; bar < bars; bar++) {
    // 每 4 小节换一次活动中心，避免旋律一直在原地打转
    if (bar % 4 === 0) degCursor = [0, 2, 4, 2, 3, 1, 4, 2][Math.floor(bar / 4) % 8];
    const mel = melodyBar(degCursor, rnd, { leap: 0.06, span: 5 });
    for (const n of mel) {
      degCursor = n.deg;
      leadNotes.push({
        t: bar * beatsPerBar + n.pos,
        d: n.len * 0.72,
        p: fold(mixo('D', n.deg, 5), 62, 86),
        v: Math.round((n.len >= 2 ? 68 : 54) + rnd() * 6),
        opts: { tau: n.len >= 2 ? 0.9 : 0.52, gain: 0.23, bright: 0.74 },
      });
    }
  }
tracks.push({
    name: 'Lead',
    inst: 'musicBox',
    gain: 0.58,
    notes: leadNotes,
    reverb: 0.80,
    delay: { time: (60 / bpm) * 1.0, feedback: 0.28, wet: 0.20, cutoff: 2000 },
  });

  // ---- 弦乐铺底 ----
  const padNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 60, 79);
    for (const pch of chord) {
      padNotes.push({
        t: bar * beatsPerBar,
        d: beatsPerBar - 0.3,
        p: fold(pch, 60, 82),
        v: 56 + Math.round(rnd() * 5),
        opts: { tau: 1.8, gain: 0.088 },
      });
    }
    padNotes.push({
      t: bar * beatsPerBar,
      d: beatsPerBar - 0.3,
      p: fold(note(root + '3'), 52, 62),
      v: 25 + Math.round(rnd() * 3),
      opts: { tau: 2.0, gain: 0.072 },
    });
  }
  tracks.push({ name: 'Strings', inst: 'strings', gain: 0.88, notes: padNotes, reverb: 0.78 });

  // ---- 马林巴反拍 ----
  const marNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    marNotes.push(...offbeatMarimba(root, type, bar, beatsPerBar, { rnd, lo: 66, hi: 83 }));
  }
  tracks.push({ name: 'Marimba', inst: 'marimba', gain: 0.52, notes: marNotes, reverb: 0.74 });

  // ---- 贝斯 ----
  const bassNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root] = chordAt(bar);
    bassNotes.push({
      t: bar * beatsPerBar,
      d: 3.4,
      p: fold(note(root + '2'), 33, 48),
      v: 64 + Math.round(rnd() * 5),
      opts: { tau: 0.85, gain: 0.23 },
    });
  }
  tracks.push({ name: 'Bass', inst: 'bass', gain: 0.68, notes: bassNotes, reverb: 0.20 });

  // ---- 打击 ----
  const percNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    percNotes.push(...softPercussion(bar, beatsPerBar, { rnd, hatGain: 0.08, kickGain: 0.28 }));
  }
  tracks.push({ name: 'Perc', inst: 'hat', gain: 0.56, notes: percNotes, reverb: 0.18 });

  const markers = [];
  for (let bar = 0; bar < bars; bar += 16) {
    markers.push({ t: bar * beatsPerBar, name: 'S' + (bar / 16 + 1) });
  }

  return {
    name: 'g2048',
    bpm,
    beatsPerBar,
    bars,
    seed: 0x2048a,
    key: 'D 混合利底亚',
    tracks,
    markers,
    masterReverb: 0.73,
    reverbFeedback: 0.85,
    reverbDamp: 0.45,
  };
}

/* ------------------------------------------------------------------ */
/* 4. snake —— 唯一需要"动"的一首，但仍然不能有军鼓                     */
/* ------------------------------------------------------------------ */
/*
 * 【难点在哪】贪吃蛇是四首里唯一有实时节奏压力的游戏（蛇一直在走），
 *   但参考曲那套曲风的打击层极轻、没有军鼓，直接照搬会显得"拖不动"。
 *   解法不是加鼓，而是**加一层十六分音符的琶音**做速度感——
 *   参考曲的尼龙吉他正好是 5.8 音/小节、落在 8 分格，我把它加密到
 *   十六分，同样的音色、同样的调式，只是密度翻倍。
 *   这样速度感来自织体而不是打击，曲风不会跑。
 *
 * 【为什么调性用 G】参考曲本体就是 G 大调 / D 混合利底亚。
 *   贪吃蛇用 G 混合利底亚（主音 G），和参考曲同一个音阶，
 *   但主音不同，听感上是"同一家人，不同性格"。
 */
export function snake() {
  const bpm = 96;
  const beatsPerBar = 4;
  // 64 小节 @96BPM = 160 秒 = 2:40
  const bars = 64;
  const rnd = mulberry32(0x5a4e1);
  const tracks = [];

  // ---- 和声：G 混合利底亚，I-bVII-IV-I ----
  const PROG = [
    ['G', 'maj'], ['F', 'maj'], ['C', 'maj'], ['G', 'maj'],
  ];
  const chordAt = (bar) => PROG[Math.floor(bar / 2) % PROG.length];

  // ---- 十六分琶音：这一首的速度感来源 ----
  // 【为什么是十六分而不是加鼓】见上面的说明。
  //   用 pluck（拨弦）音色，短促、有颗粒感，参考曲的尼龙吉他也是这个质感。
  const arpNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 62, 84);
    // 六连往返：根 三 五 八 五 三，十六分音符，一小节 16 个音
    const pattern = [0, 1, 2, 3, 2, 1];
    for (let k = 0; k < 16; k++) {
      const idx = pattern[k % pattern.length];
      const p = chord[idx % chord.length] + (idx >= chord.length ? 12 : 0);
      arpNotes.push({
        t: bar * beatsPerBar + k * 0.25,
        d: 0.18,
        p: fold(p, 62, 88),
        // 【为什么正拍轻、反拍重】反拍重音会产生"向前推"的错觉，
        //   速度感更强，而且不会像正拍重音那样死板。
        v: Math.round((k % 4 === 0 ? 34 : 46) + rnd() * 6),
        opts: { tau: 0.16, gain: 0.13 },
      });
    }
  }
  tracks.push({ name: 'Arp', inst: 'pluck', gain: 0.60, notes: arpNotes, reverb: 0.70 });

  // ---- 钢琴：8 分分解，铺在琶音下面 ----
  const pianoNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    pianoNotes.push(...brokenChord(root, type, bar, beatsPerBar, {
      rnd, lo: 55, hi: 74, gain: 0.20,
    }));
  }
  tracks.push({
    name: 'Piano',
    inst: 'epiano',
    gain: 0.60,
    notes: pianoNotes,
    reverb: 0.64,
    delay: { time: (60 / bpm) * 0.5, feedback: 0.22, wet: 0.14, cutoff: 2400 },
  });

    // ---- 主旋律：密集线条，每小节 4~6 个音 ----
  // 【为什么按小节生成而不是按乐句】参考曲实测每小节平均 5.09 个音，
  //   按小节生成才能精确控制这个密度。按乐句生成容易变成"长音吟唱"，
  //   那是完全不同的曲风。
  const leadNotes = [];
  let degCursor = 0;
  for (let bar = 0; bar < bars; bar++) {
    // 每 4 小节换一次活动中心，避免旋律一直在原地打转
    if (bar % 4 === 0) degCursor = [0, 2, 4, 2, 3, 1, 4, 2][Math.floor(bar / 4) % 8];
    const mel = melodyBar(degCursor, rnd, { leap: 0.06, span: 5 });
    for (const n of mel) {
      degCursor = n.deg;
      leadNotes.push({
        t: bar * beatsPerBar + n.pos,
        d: n.len * 0.72,
        p: fold(mixo('G', n.deg, 5), 64, 88),
        v: Math.round((n.len >= 2 ? 66 : 52) + rnd() * 6),
        opts: { tau: n.len >= 2 ? 0.8 : 0.48, gain: 0.22, bright: 0.74 },
      });
    }
  }
tracks.push({
    name: 'Lead',
    inst: 'musicBox',
    gain: 0.54,
    notes: leadNotes,
    reverb: 0.76,
    delay: { time: (60 / bpm) * 0.75, feedback: 0.26, wet: 0.18, cutoff: 2100 },
  });

  // ---- 弦乐铺底 ----
  const padNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 60, 78);
    for (const pch of chord) {
      padNotes.push({
        t: bar * beatsPerBar,
        d: beatsPerBar - 0.3,
        p: fold(pch, 60, 80),
        v: 52 + Math.round(rnd() * 5),
        opts: { tau: 1.6, gain: 0.082 },
      });
    }
  }
  tracks.push({ name: 'Strings', inst: 'strings', gain: 0.82, notes: padNotes, reverb: 0.74 });

  // ---- 马林巴反拍 ----
  const marNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    marNotes.push(...offbeatMarimba(root, type, bar, beatsPerBar, { rnd, lo: 67, hi: 84 }));
  }
  tracks.push({ name: 'Marimba', inst: 'marimba', gain: 0.46, notes: marNotes, reverb: 0.70 });

  // ---- 贝斯：这首稍微密一点，跟着十六分琶音走 ----
  const bassNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root] = chordAt(bar);
    // 每 2 拍一个，比别的曲子密一倍，配合十六分琶音
    for (let b = 0; b < beatsPerBar; b += 2) {
      bassNotes.push({
        t: bar * beatsPerBar + b,
        d: 1.8,
        p: fold(note(root + '2'), 33, 48),
        v: Math.round((b === 0 ? 66 : 56) + rnd() * 5),
        opts: { tau: 0.7, gain: 0.22 },
      });
    }
  }
  tracks.push({ name: 'Bass', inst: 'bass', gain: 0.70, notes: bassNotes, reverb: 0.18 });

  // ---- 打击：比别的曲子稍重一点，但仍然没有军鼓 ----
  const percNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    percNotes.push(...softPercussion(bar, beatsPerBar, { rnd, hatGain: 0.095, kickGain: 0.32 }));
  }
  tracks.push({ name: 'Perc', inst: 'hat', gain: 0.60, notes: percNotes, reverb: 0.16 });

  const markers = [];
  for (let bar = 0; bar < bars; bar += 16) {
    markers.push({ t: bar * beatsPerBar, name: 'S' + (bar / 16 + 1) });
  }

  return {
    name: 'snake',
    bpm,
    beatsPerBar,
    bars,
    seed: 0x5a4e1,
    key: 'G 混合利底亚',
    tracks,
    markers,
    masterReverb: 0.70,
    reverbFeedback: 0.83,
    reverbDamp: 0.43,
  };
}

/* ------------------------------------------------------------------ */
/* 5. watermelon —— 最慢最柔的一首，水果一颗颗落下来                     */
/* ------------------------------------------------------------------ */
/*
 * 【和 2048 怎么区分】两首都是"慢 + 柔"，最容易撞。
 *   硬区分放在三处：
 *     1. 调性：大西瓜用 F 混合利底亚（降 B），2048 用 D；
 *     2. 速度：76，是五首里最慢的，2048 是 88；
 *     3. 织体：大西瓜**去掉十六分/八分琶音**，只用钢琴的 8 分分解，
 *        并且把反拍马林巴换成更稀的 vibraphone 长音。
 *   慢下来的关键是"减少事件数"，不是把同样的东西演奏得更慢。
 */
export function watermelon() {
  const bpm = 76;
  const beatsPerBar = 4;
  // 56 小节 @76BPM = 177 秒 ≈ 2:57
  const bars = 56;
  const rnd = mulberry32(0x8d21f);
  const tracks = [];

  // ---- 和声：F 混合利底亚，I-bVII-IV-I ----
  // 【为什么用 bVII 而不是 vi】vi 是"小调色彩"，会让曲子变忧郁。
  //   大西瓜要的是"柔和但明亮"，bVII（降E）保留大调感又带一点飘。
  const PROG = [
    ['F', 'maj'], ['D#', 'maj'], ['A#', 'maj'], ['F', 'maj'],
  ];
  const chordAt = (bar) => PROG[Math.floor(bar / 2) % PROG.length];

  // ---- 钢琴：8 分分解，但更轻更疏 ----
  // 【为什么 gain 只有 0.20】大西瓜是五首里最静的，
  //   钢琴只要"有声音在那"就够了，不能盖过画面。
  const pianoNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    pianoNotes.push(...brokenChord(root, type, bar, beatsPerBar, {
      rnd, lo: 53, hi: 74, gain: 0.20,
    }));
  }
  tracks.push({
    name: 'Piano',
    inst: 'epiano',
    gain: 0.62,
    notes: pianoNotes,
    reverb: 0.74,
    delay: { time: (60 / bpm) * 1.0, feedback: 0.30, wet: 0.22, cutoff: 1900 },
  });

    // ---- 主旋律：密集线条，每小节 4~6 个音 ----
  // 【为什么按小节生成而不是按乐句】参考曲实测每小节平均 5.09 个音，
  //   按小节生成才能精确控制这个密度。按乐句生成容易变成"长音吟唱"，
  //   那是完全不同的曲风。
  const leadNotes = [];
  let degCursor = 0;
  for (let bar = 0; bar < bars; bar++) {
    // 每 4 小节换一次活动中心，避免旋律一直在原地打转
    if (bar % 4 === 0) degCursor = [0, 2, 4, 2, 3, 1, 4, 2][Math.floor(bar / 4) % 8];
    const mel = melodyBar(degCursor, rnd, { leap: 0.06, span: 5 });
    for (const n of mel) {
      degCursor = n.deg;
      leadNotes.push({
        t: bar * beatsPerBar + n.pos,
        d: n.len * 0.72,
        p: fold(mixo('F', n.deg, 5), 60, 84),
        v: Math.round((n.len >= 2 ? 66 : 54) + rnd() * 6),
        opts: { tau: n.len >= 2 ? 1.1 : 0.7, gain: 0.22, bright: 0.74 },
      });
    }
  }
tracks.push({
    name: 'Lead',
    inst: 'musicBox',
    gain: 0.56,
    notes: leadNotes,
    reverb: 0.84,
    delay: { time: (60 / bpm) * 1.25, feedback: 0.30, wet: 0.22, cutoff: 1900 },
  });

  // ---- 弦乐铺底：最厚 ----
  const padNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 58, 78);
    for (const pch of chord) {
      padNotes.push({
        t: bar * beatsPerBar,
        d: beatsPerBar - 0.3,
        p: fold(pch, 58, 80),
        v: 58 + Math.round(rnd() * 5),
        opts: { tau: 2.0, gain: 0.095 },
      });
    }
    // 低八度补厚，但不下坠到 45 以下
    padNotes.push({
      t: bar * beatsPerBar,
      d: beatsPerBar - 0.3,
      p: fold(note(root + '3'), 50, 60),
      v: 26 + Math.round(rnd() * 3),
      opts: { tau: 2.2, gain: 0.078 },
    });
  }
  tracks.push({ name: 'Strings', inst: 'strings', gain: 0.92, notes: padNotes, reverb: 0.80 });

  // ---- 远景：稀疏的钟声，替代反拍马林巴 ----
  // 【为什么不用马林巴】马林巴是"点状"的，每拍一下会形成律动。
  //   大西瓜要的是"没有律动"，所以换成每 4 小节才响一次的 vibraphone，
  //   而且挂在长音上，听起来是远处的钟。
  const vibNotes = [];
  for (let bar = 0; bar < bars; bar += 4) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 67, 84);
    vibNotes.push({
      t: bar * beatsPerBar + 2,
      d: 2.6,
      p: fold(chord[0], 67, 88),
      v: 30 + Math.round(rnd() * 4),
      opts: { tau: 1.3, gain: 0.075, bright: 0.6 },
    });
  }
  tracks.push({ name: 'Vibes', inst: 'bell', gain: 0.44, notes: vibNotes, reverb: 0.86 });

  // ---- 贝斯：每 2 小节才一个音，极稀 ----
  const bassNotes = [];
  for (let bar = 0; bar < bars; bar += 2) {
    const [root] = chordAt(bar);
    bassNotes.push({
      t: bar * beatsPerBar,
      d: 7.0,
      p: fold(note(root + '2'), 29, 44),
      v: 60 + Math.round(rnd() * 5),
      opts: { tau: 1.4, gain: 0.22 },
    });
  }
  tracks.push({ name: 'Bass', inst: 'bass', gain: 0.62, notes: bassNotes, reverb: 0.24 });

  // ---- 打击：只有闭镲，没有底鼓 ----
  // 【为什么连底鼓都去掉】底鼓每小节一下就是"节拍"，
  //   大西瓜不需要节拍，只需要一点点空气感。所以只留闭镲，音量很低。
  const percNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let b = 0; b < beatsPerBar; b++) {
      percNotes.push({
        t: bar * beatsPerBar + b,
        d: 0.12,
        p: 42,
        v: Math.round(22 + rnd() * 6),
        inst: 'hat',
        opts: { tau: 0.05, gain: 0.055 },
      });
    }
  }
  tracks.push({ name: 'Air', inst: 'hat', gain: 0.42, notes: percNotes, reverb: 0.28 });

  const markers = [];
  for (let bar = 0; bar < bars; bar += 14) {
    markers.push({ t: bar * beatsPerBar, name: 'S' + (bar / 14 + 1) });
  }

  return {
    name: 'watermelon',
    bpm,
    beatsPerBar,
    bars,
    seed: 0x8d21f,
    key: 'F 混合利底亚',
    tracks,
    markers,
    masterReverb: 0.78,
    reverbFeedback: 0.87,
    reverbDamp: 0.47,
  };
}

/* ------------------------------------------------------------------ */
/* 6. donghai —— 推币机，五首里唯一"有光"的一首                          */
/* ------------------------------------------------------------------ */
/*
 * 【为什么它不能完全照搬参考曲的曲风】
 *   推币机是五首里唯一有"中奖时刻"的游戏：转盘进球、派对奖励、
 *   彩票哗啦啦吐出来，这些瞬间需要音乐能接住。
 *   参考曲那种全程平缓、没有任何起伏的写法，用在推币机上会显得
 *   "我中了大奖，音乐一点反应都没有"。
 *
 * 【怎么在保持曲风的前提下加光】三处改动，都不破坏内核：
 *   1. 调性用 C 混合利底亚 —— 比参考曲的 D 高一点，整体更亮；
 *   2. 加一条 bell 的高音层，只在每 4 小节的第一拍响，
 *      像机台上方的灯在闪。这是参考曲里 Celesta/Glockenspiel 的做法
 *      （全曲只有 18 和 4 个音，极稀疏），我把它稍微加密到可感知；
 *   3. 保留极轻打击，但底鼓改成"每拍一下"的心跳，
 *      对应推币机那个一直往前推的推板。
 *
 * 【速度为什么是 84】推币机节奏偏慢（推板一个来回约 3 秒），
 *   84 和参考曲的 88 接近，但略慢一点，不会显得赶。
 */
export function donghai() {
  const bpm = 84;
  const beatsPerBar = 4;
  // 64 小节 @84BPM = 183 秒 ≈ 3:03
  const bars = 64;
  const rnd = mulberry32(0xd0a9a1);
  const tracks = [];

  // ---- 和声：C 混合利底亚，I-bVII-IV-I ----
  // 【为什么是 C】参考曲是 D，五首里已经有两首用 D（2048、参考曲本身）。
  //   C 比 D 低一个大二度，整体音区偏亮偏暖，适合"中奖"的期待感。
  const PROG = [
    ['C', 'maj'], ['A#', 'maj'], ['F', 'maj'], ['C', 'maj'],
  ];
  const chordAt = (bar) => PROG[Math.floor(bar / 2) % PROG.length];

  // ---- 钢琴：8 分分解，主力织体 ----
  const pianoNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    pianoNotes.push(...brokenChord(root, type, bar, beatsPerBar, {
      rnd, lo: 55, hi: 76, gain: 0.26,
    }));
  }
  tracks.push({
    name: 'Piano',
    inst: 'epiano',
    gain: 0.72,
    notes: pianoNotes,
    reverb: 0.68,
    delay: { time: (60 / bpm) * 0.75, feedback: 0.26, wet: 0.18, cutoff: 2200 },
  });

  // ---- 灯光层：高音 bell，每 4 小节第一拍 ----
  // 【为什么是 bell】参考曲里 Celesta(18 音) + Glockenspiel(4 音) + Vibraphone(31 音)，
  //   三种钟琴类音色加起来才 53 个音，全曲 192 小节 —— 极稀疏的点缀。
  //   这里保持"稀疏"的原则（每 4 小节一次），但让它在混音里更靠前，
  //   因为推币机需要这个"灯在闪"的视觉对应。
  const bellNotes = [];
  for (let bar = 0; bar < bars; bar += 4) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 72, 91);
    // 每次点两个音，形成一个小音程，像灯闪两下
    bellNotes.push({
      t: bar * beatsPerBar,
      d: 1.8,
      p: fold(chord[0], 72, 91),
      v: 44 + Math.round(rnd() * 6),
      opts: { tau: 1.1, gain: 0.11, bright: 1.2 },
    });
    bellNotes.push({
      t: bar * beatsPerBar + 0.5,
      d: 1.4,
      p: fold(chord[2] ?? chord[0] + 7, 72, 91),
      v: 34 + Math.round(rnd() * 5),
      opts: { tau: 0.9, gain: 0.085, bright: 1.15 },
    });
  }
  tracks.push({ name: 'Lights', inst: 'bell', gain: 0.50, notes: bellNotes, reverb: 0.86 });

    // ---- 主旋律：密集线条，每小节 4~6 个音 ----
  // 【为什么按小节生成而不是按乐句】参考曲实测每小节平均 5.09 个音，
  //   按小节生成才能精确控制这个密度。按乐句生成容易变成"长音吟唱"，
  //   那是完全不同的曲风。
  const leadNotes = [];
  let degCursor = 0;
  for (let bar = 0; bar < bars; bar++) {
    // 每 4 小节换一次活动中心，避免旋律一直在原地打转
    if (bar % 4 === 0) degCursor = [0, 2, 4, 2, 3, 1, 4, 2][Math.floor(bar / 4) % 8];
    const mel = melodyBar(degCursor, rnd, { leap: 0.06, span: 5 });
    for (const n of mel) {
      degCursor = n.deg;
      leadNotes.push({
        t: bar * beatsPerBar + n.pos,
        d: n.len * 0.72,
        p: fold(mixo('C', n.deg, 5), 60, 84),
        v: Math.round((n.len >= 2 ? 70 : 56) + rnd() * 6),
        opts: { tau: n.len >= 2 ? 0.95 : 0.58, gain: 0.24, bright: 0.74 },
      });
    }
  }
tracks.push({
    name: 'Lead',
    inst: 'musicBox',
    gain: 0.58,
    notes: leadNotes,
    reverb: 0.80,
    delay: { time: (60 / bpm) * 1.0, feedback: 0.28, wet: 0.20, cutoff: 2000 },
  });

  // ---- 弦乐铺底 ----
  const padNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 60, 79);
    for (const pch of chord) {
      padNotes.push({
        t: bar * beatsPerBar,
        d: beatsPerBar - 0.3,
        p: fold(pch, 60, 82),
        v: 55 + Math.round(rnd() * 5),
        opts: { tau: 1.8, gain: 0.088 },
      });
    }
    padNotes.push({
      t: bar * beatsPerBar,
      d: beatsPerBar - 0.3,
      p: fold(note(root + '3'), 52, 62),
      v: 25 + Math.round(rnd() * 3),
      opts: { tau: 2.0, gain: 0.074 },
    });
  }
  tracks.push({ name: 'Strings', inst: 'strings', gain: 0.88, notes: padNotes, reverb: 0.78 });

  // ---- 马林巴反拍 ----
  const marNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    marNotes.push(...offbeatMarimba(root, type, bar, beatsPerBar, { rnd, lo: 64, hi: 83 }));
  }
  tracks.push({ name: 'Marimba', inst: 'marimba', gain: 0.50, notes: marNotes, reverb: 0.74 });

  // ---- 贝斯：跟着推板的节奏，每拍一下 ----
  // 【为什么每拍一下】推币机的推板是一直在动的，一个来回约 3 秒。
  //   84BPM 每拍 0.71 秒，四拍 2.86 秒 —— 正好对上推板一个来回。
  //   所以贝斯每拍一下，就是推板在推的听觉化。
  const bassNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root] = chordAt(bar);
    for (let b = 0; b < beatsPerBar; b++) {
      bassNotes.push({
        t: bar * beatsPerBar + b,
        d: 0.85,
        p: fold(note(root + '2'), 33, 48),
        v: Math.round((b === 0 ? 68 : 54) + rnd() * 5),
        opts: { tau: 0.55, gain: 0.21 },
      });
    }
  }
  tracks.push({ name: 'Bass', inst: 'bass', gain: 0.68, notes: bassNotes, reverb: 0.18 });

  // ---- 打击：闭镲 + 每拍底鼓（推板心跳）----
  const percNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    percNotes.push(...softPercussion(bar, beatsPerBar, { rnd, hatGain: 0.085, kickGain: 0.30 }));
  }
  tracks.push({ name: 'Perc', inst: 'hat', gain: 0.58, notes: percNotes, reverb: 0.18 });

  const markers = [];
  for (let bar = 0; bar < bars; bar += 16) {
    markers.push({ t: bar * beatsPerBar, name: 'S' + (bar / 16 + 1) });
  }

  return {
    name: 'donghai',
    bpm,
    beatsPerBar,
    bars,
    seed: 0xd0a9a1,
    key: 'C 混合利底亚',
    tracks,
    markers,
    masterReverb: 0.74,
    reverbFeedback: 0.85,
    reverbDamp: 0.45,
  };
}

/* ------------------------------------------------------------------ */
/* 7. liushui —— 流水入杯，水在流，音乐要"滴"起来                        */
/* ------------------------------------------------------------------ */
/*
 * 【为什么必须补这一首】流水入杯的 meta.bgm 写着 'liushui'，
 *   但 public/bgm/liushui.mp3 一直不存在 —— 进这个游戏时
 *   <audio> 会去请求一个 404，控制台报错、玩家听不到任何声音。
 *   这是一个一直存在但没人发现的 bug，这次一起补上。
 *
 * 【曲风怎么落地】水主题天然适合这套曲风：参考曲本身就是"空、远、流动"。
 *   具体做法：
 *     1. 调性用降 B 混合利底亚 —— 七首里唯一用这个调，避免和别的撞；
 *     2. 速度 72，比大西瓜的 76 还慢一点，像水慢慢淌；
 *     3. **加大量竖琴/拨弦的滴水音** —— 这是水声的听觉化，
 *        参考曲 Harp 轨只有 60 个音，这里加密到每小节 3 个，
 *        但每个都很轻，像水滴落在杯壁上。
 */
export function liushui() {
  const bpm = 72;
  const beatsPerBar = 4;
  // 56 小节 @72BPM = 187 秒 ≈ 3:07
  const bars = 56;
  const rnd = mulberry32(0x11a5);
  const tracks = [];

  // ---- 和声：降 B 混合利底亚，I-bVII-IV-I ----
  // 【降 B 怎么写成音名】theory.mjs 的 note() 只认 A-G 加 #，
  //   所以降 B 写成 A#。bVII 是 降A，写成 G#。
  const PROG = [
    ['A#', 'maj'], ['G#', 'maj'], ['D#', 'maj'], ['A#', 'maj'],
  ];
  const chordAt = (bar) => PROG[Math.floor(bar / 2) % PROG.length];

  // ---- 钢琴：8 分分解，水的底色 ----
  const pianoNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    pianoNotes.push(...brokenChord(root, type, bar, beatsPerBar, {
      rnd, lo: 55, hi: 76, gain: 0.22,
    }));
  }
  tracks.push({
    name: 'Piano',
    inst: 'epiano',
    gain: 0.66,
    notes: pianoNotes,
    reverb: 0.76,
    delay: { time: (60 / bpm) * 1.0, feedback: 0.30, wet: 0.22, cutoff: 2000 },
  });

  // ---- 滴水音：这一首的辨识度来源 ----
  // 【为什么每小节 3 个】水滴不能太密，密了就是"下雨"不是"滴水"。
  //   落在 2/4/6 十六分格（也就是第 1 拍后半、第 2 拍、第 2 拍后半），
  //   正好是参考曲钢琴声部出现最多的几个位置。
  const dropNotes = [];
  const DROP_POS = [1.5, 2.0, 2.5];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 67, 88);
    for (let k = 0; k < DROP_POS.length; k++) {
      dropNotes.push({
        t: bar * beatsPerBar + DROP_POS[k],
        d: 0.5,
        p: fold(chord[(k + bar) % chord.length], 67, 90),
        // 力度很小，水滴是点缀不是主角
        v: Math.round(30 + rnd() * 8),
        opts: { tau: 0.42, gain: 0.11, bright: 1.05 },
      });
    }
  }
  tracks.push({ name: 'Drops', inst: 'pluck', gain: 0.50, notes: dropNotes, reverb: 0.88 });

  // ---- 主旋律 ----
  const leadNotes = [];
  let degCursor = 0;
  for (let bar = 0; bar < bars; bar++) {
    if (bar % 4 === 0) degCursor = [0, 2, 4, 2, 3, 1, 4, 2][Math.floor(bar / 4) % 8];
    const mel = melodyBar(degCursor, rnd, { leap: 0.05, span: 5 });
    for (const n of mel) {
      degCursor = n.deg;
      leadNotes.push({
        t: bar * beatsPerBar + n.pos,
        d: n.len * 0.76,
        p: fold(mixo('A#', n.deg, 5), 60, 84),
        v: Math.round((n.len >= 2 ? 68 : 56) + rnd() * 6),
        opts: { tau: n.len >= 2 ? 1.0 : 0.62, gain: 0.23, bright: 0.68 },
      });
    }
  }
  tracks.push({
    name: 'Lead',
    inst: 'musicBox',
    gain: 0.56,
    notes: leadNotes,
    reverb: 0.84,
    delay: { time: (60 / bpm) * 1.25, feedback: 0.30, wet: 0.22, cutoff: 1900 },
  });

  // ---- 弦乐铺底 ----
  const padNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 58, 78);
    for (const pch of chord) {
      padNotes.push({
        t: bar * beatsPerBar,
        d: beatsPerBar - 0.3,
        p: fold(pch, 58, 80),
        v: 56 + Math.round(rnd() * 5),
        opts: { tau: 1.9, gain: 0.09 },
      });
    }
    padNotes.push({
      t: bar * beatsPerBar,
      d: beatsPerBar - 0.3,
      p: fold(note(root + '3'), 50, 60),
      v: 25 + Math.round(rnd() * 3),
      opts: { tau: 2.1, gain: 0.074 },
    });
  }
  tracks.push({ name: 'Strings', inst: 'strings', gain: 0.90, notes: padNotes, reverb: 0.80 });

  // ---- 贝斯：每 2 小节一个长音，几乎不动 ----
  const bassNotes = [];
  for (let bar = 0; bar < bars; bar += 2) {
    const [root] = chordAt(bar);
    bassNotes.push({
      t: bar * beatsPerBar,
      d: 7.0,
      p: fold(note(root + '2'), 31, 46),
      v: 60 + Math.round(rnd() * 5),
      opts: { tau: 1.3, gain: 0.21 },
    });
  }
  tracks.push({ name: 'Bass', inst: 'bass', gain: 0.62, notes: bassNotes, reverb: 0.24 });

  // ---- 打击：只有极轻的闭镲，水不需要节拍 ----
  const percNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let b = 0; b < beatsPerBar; b++) {
      percNotes.push({
        t: bar * beatsPerBar + b,
        d: 0.12,
        p: 42,
        v: Math.round(20 + rnd() * 6),
        inst: 'hat',
        opts: { tau: 0.05, gain: 0.05 },
      });
    }
  }
  tracks.push({ name: 'Air', inst: 'hat', gain: 0.40, notes: percNotes, reverb: 0.30 });

  const markers = [];
  for (let bar = 0; bar < bars; bar += 14) {
    markers.push({ t: bar * beatsPerBar, name: 'S' + (bar / 14 + 1) });
  }

  return {
    name: 'liushui',
    bpm,
    beatsPerBar,
    bars,
    seed: 0x11a5,
    key: '降B 混合利底亚',
    tracks,
    markers,
    masterReverb: 0.80,
    reverbFeedback: 0.88,
    reverbDamp: 0.48,
  };
}

/* ------------------------------------------------------------------ */
/* 8. yigan —— 一杆清台（台球），第七首                                    */
/* ------------------------------------------------------------------ */
/*
 * 【为什么要有这一首】台球桌是「安静的竞技」：出杆前要静，球进了才有声。
 *   如果铺一首热闹的曲子，反而破坏那种屏住呼吸的感觉。
 *   所以这首是全七首里最「克制」的一首：没有鼓，没有切分，
 *   只有一个慢速摇摆的 6/8 律动 + 台球碰撞般的木质敲击。
 *
 * 【曲风怎么落地】沿用参考曲那套混合利底亚：
 *   1. 调性用降 A 混合利底亚 —— 七首里唯一用这个调，和别的都不撞；
 *   2. 速度 84，比推币机的 84 一样但拍号感不同（这首是 6/8 摇摆感）；
 *   3. **用 wood 音色做「球碰球」** —— 参考曲没有这个，但台球的
 *      听觉记忆点就是那一声「嗒」，每 2 小节一次，像球在桌面上滚动碰撞。
 */
export function yigan() {
  const bpm = 84;
  const beatsPerBar = 4;
  // 48 小节 @84BPM = 137 秒 ≈ 2:17
  const bars = 48;
  const rnd = mulberry32(0x9c31);
  const tracks = [];

  // ---- 和声：降 A 混合利底亚，I - bVII - IV - I ----
  // 【为什么是降 A】前六首占了 A/D/G/F/C/降B，降A 还空着，
  //   而且降A 的亮度介于 F 和 降B 之间，正好配「安静但不沉闷」。
  const PROG = [
    ['G#', 'maj'], ['G#', 'maj'], ['C#', 'maj'], ['G#', 'maj'],
  ];
  const chordAt = (bar) => PROG[Math.floor(bar / 2) % PROG.length];

  // ---- 电钢：八分分解，这是整首曲子的底色 ----
  const pianoNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    pianoNotes.push(...brokenChord(root, type, bar, beatsPerBar, {
      rnd, lo: 52, hi: 74, gain: 0.20,
    }));
  }
  tracks.push({
    name: 'Piano',
    inst: 'epiano',
    gain: 0.62,
    notes: pianoNotes,
    reverb: 0.72,
    delay: { time: (60 / bpm) * 1.5, feedback: 0.26, wet: 0.18, cutoff: 1800 },
  });

  // ---- 球碰球：这一首的辨识度来源 ----
  // 【为什么用 wood 而不是 bell】台球是实木/树脂的碰撞，音色偏「闷」；
  //   bell 太亮会像风铃，wood 的短促衰减才对得上「嗒」这一声。
  //   每 2 小节一次，落在第 3 拍，像球滚过去撞到库边。
  const clickNotes = [];
  for (let bar = 0; bar < bars; bar += 2) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 64, 84);
    clickNotes.push({
      t: bar * beatsPerBar + 2,
      d: 0.25,
      p: fold(chord[(bar / 2) % chord.length], 62, 86),
      v: Math.round(34 + rnd() * 8),
      opts: { tau: 0.16, gain: 0.13, bright: 0.9 },
    });
  }
  tracks.push({ name: 'Click', inst: 'wood', gain: 0.44, notes: clickNotes, reverb: 0.66 });

  // ---- 主旋律：稀疏、留白多 ----
  // 【为什么密度低】参考曲每小节 5 个音，这首刻意压到 3 个左右。
  //   台球是回合制，旋律要「一句一停」，不能连着走。
  const leadNotes = [];
  let degCursor = 0;
  for (let bar = 0; bar < bars; bar++) {
    if (bar % 4 === 0) degCursor = [0, 3, 2, 4, 1, 3, 0, 2][Math.floor(bar / 4) % 8];
    // 【为什么这里不再人为留白】第一版我每 4 小节砍掉一小节的音，
    //   密度掉到 2.9，听起来断断续续不像旋律。呼吸感交给 Click 轨和
    //   弦乐的长音去做，旋律本身保持参考曲那种连续的 4 分音符线条。
    const mel = melodyBar(degCursor, rnd, { leap: 0.04, span: 4 });
    for (const n of mel) {
      degCursor = n.deg;
      leadNotes.push({
        t: bar * beatsPerBar + n.pos,
        d: n.len * 0.82,
        p: fold(mixo('G#', n.deg, 5), 58, 82),
        v: Math.round((n.len >= 2 ? 62 : 52) + rnd() * 6),
        opts: { tau: n.len >= 2 ? 0.95 : 0.58, gain: 0.20, bright: 0.62 },
      });
    }
  }
  tracks.push({
    name: 'Lead',
    inst: 'musicBox',
    gain: 0.52,
    notes: leadNotes,
    reverb: 0.80,
    delay: { time: (60 / bpm) * 1.0, feedback: 0.24, wet: 0.18, cutoff: 1700 },
  });

  // ---- 弦乐铺底 ----
  const padNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    const [root, type] = chordAt(bar);
    const chord = voicing(root, type, 56, 76);
    for (const pch of chord) {
      padNotes.push({
        t: bar * beatsPerBar,
        d: beatsPerBar - 0.3,
        p: fold(pch, 56, 78),
        v: 54 + Math.round(rnd() * 5),
        opts: { tau: 1.8, gain: 0.088 },
      });
    }
    padNotes.push({
      t: bar * beatsPerBar,
      d: beatsPerBar - 0.3,
      p: fold(note(root + '3'), 48, 58),
      v: 24 + Math.round(rnd() * 3),
      opts: { tau: 2.0, gain: 0.072 },
    });
  }
  tracks.push({ name: 'Strings', inst: 'strings', gain: 0.88, notes: padNotes, reverb: 0.78 });

  // ---- 贝斯：每 2 小节一个长音 ----
  const bassNotes = [];
  for (let bar = 0; bar < bars; bar += 2) {
    const [root] = chordAt(bar);
    bassNotes.push({
      t: bar * beatsPerBar,
      d: 7.0,
      p: fold(note(root + '2'), 30, 45),
      v: 58 + Math.round(rnd() * 5),
      opts: { tau: 1.25, gain: 0.20 },
    });
  }
  tracks.push({ name: 'Bass', inst: 'bass', gain: 0.60, notes: bassNotes, reverb: 0.22 });

  // ---- 打击：没有鼓组，只有极轻的闭镲当时间刻度 ----
  // 【为什么连底鼓都不要】台球桌旁边不该有心跳般的低频，那会抢戏。
  //   保留闭镲只是为了不让曲子「飘」，给一个极弱的脉冲。
  const percNotes = [];
  for (let bar = 0; bar < bars; bar++) {
    for (let b = 0; b < beatsPerBar; b += 2) {
      percNotes.push({
        t: bar * beatsPerBar + b,
        d: 0.10,
        p: 42,
        v: Math.round(16 + rnd() * 5),
        inst: 'hat',
        opts: { tau: 0.045, gain: 0.042 },
      });
    }
  }
  tracks.push({ name: 'Air', inst: 'hat', gain: 0.36, notes: percNotes, reverb: 0.28 });

  const markers = [];
  for (let bar = 0; bar < bars; bar += 12) {
    markers.push({ t: bar * beatsPerBar, name: 'S' + (bar / 12 + 1) });
  }

  return {
    name: 'yigan',
    bpm,
    beatsPerBar,
    bars,
    seed: 0x9c31,
    key: '降A 混合利底亚',
    tracks,
    markers,
    masterReverb: 0.78,
    reverbFeedback: 0.86,
    reverbDamp: 0.50,
  };
}

export const SONGS = { minesweeper, fruitninja, g2048, snake, watermelon, donghai, liushui, yigan };

/**
 * 不生成 mp3 的曲目。
 *
 * 【为什么留着 snake 的编曲却不出 mp3】贪吃蛇改用 snake-bgm.js 程序化合成
 *   （节奏要跟着吃的数量变，mp3 做不到），public/bgm/snake.mp3 已删除。
 *   编曲函数保留是为了以后想切回 mp3 时不用重写；
 *   gen-bgm 靠这张表跳过它，避免全量生成时又把 1.83MB 写回包里。
 */
export const NO_MP3 = new Set(['snake']);
