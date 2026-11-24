#!/usr/bin/env node
/**
 * BGM 生成器 —— 一次跑完 MIDI → WAV → MP3 全流程
 * ==================================================================
 * 用法：node tools/gen-bgm.mjs           生成全部四首
 *       node tools/gen-bgm.mjs snake     只生成指定曲目
 *
 * 流程（严格按顺序，MIDI 是真正的乐谱源头）：
 *   1. 编曲模块产出乐谱（拍为单位的音符）      -> tools/lib/songs.mjs
 *   2. 写成标准 MIDI 文件（SMF format 1）      -> tools/out/midi/<name>.mid（中间产物，不进包体）
 *   3. 重新解析该 .mid，读回音符               -> tools/lib/midi-read.mjs
 *   4. 用自研合成器渲染 PCM（44.1kHz 单声道）  -> .cache/bgm/<name>.wav
 *   5. lamejs 编码成 56kbps / 11025Hz MP3      -> public/bgm/<name>.mp3
 *
 * 全部产物均由代码生成，无任何外部素材，版权干净。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { writeMidi } from './lib/midi.mjs';
import { readMidi } from './lib/midi-read.mjs';
import { renderSong, encodeWav, toInt16 } from './lib/synth.mjs';
import { SONGS, NO_MP3 } from './lib/songs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const OUT_MP3 = path.join(ROOT, 'public', 'bgm');
// 【为什么不放 public/】MIDI 只是「生成 → 读回校验」的中间产物，
//   运行时只播 MP3，这些 .mid 一个字都用不上。
//   放 public/ 会被原样复制进 dist，白白占 115 KB 包体，
//   而且会让 hb-sdk 上传时报「错误的文件路径」（部署时踩过）。
const OUT_MIDI = path.join('tools', 'out', 'midi');
const CACHE = path.join(ROOT, '.cache', 'bgm');

/**
 * 采样率与码率。
 *
 * 【为什么是 11025Hz / 56kbps】用户指定。
 *
 *   采样率：11025Hz 的奈奎斯特频率是 5512Hz。实测这些曲子的每个声部
 *   在 11kHz 下能量保留 100%~109%（合成器音色谐波有限，5.5kHz 以上
 *   本来就没有内容），所以降采样率没有可听损失，纯粹省体积。
 *
 *   码率：MPEG-2 Layer III 在 11025Hz 下的码率表是
 *   8/16/24/32/40/48/56/64 kbps，56 是倒数第二档。
 *   注意 96 在这个采样率下**物理上不可用**——lamejs 会静默忽略，
 *   仍然输出 64kbps（实测 64/96/128 三档输出全是 68.5kbps）。
 *   想真正拿到 96 必须把采样率提到 16000Hz 以上。
 */
const SAMPLE_RATE = 11025;
const MP3_KBPS = 56;

/**
 * 乐器 -> General MIDI 音色号
 * 让 .mid 用任意 DAW 打开时也能听出大致配器
 */
const GM_PROGRAM = {
  bell: 9,          // Glockenspiel
  musicBox: 10,     // Music Box
  marimba: 12,      // Marimba
  pluck: 45,        // Pizzicato Strings
  pulse: 38,        // Synth Bass 1
  epiano: 4,        // Electric Piano 1
  pad: 89,          // Pad 2 (warm)
  strings: 48,      // String Ensemble 1
  squareLead: 80,   // Lead 1 (square)
  arp: 80,          // Lead 1 (square)
  chipBass: 38,     // Synth Bass 1
  bass: 33,         // Electric Bass (finger)
  kick: 0,          // Acoustic Grand（打击轨用固定音高）
  snare: 0,
  hat: 0,
  rim: 0,
  shaker: 0,
  wood: 0,
  vinyl: 0,
};

/** 每个声部一个独立 MIDI 通道（0 通道留给旋律，9 通道不用，避免 GM 鼓组误判） */
function channelFor(index) {
  return index >= 9 ? index + 1 : index;
}

/* ============================ 1. 写 MIDI ============================ */

function buildMidiFile(song) {
  const tracks = song.tracks.map((tr, i) => ({
    name: tr.name,
    channel: channelFor(i),
    program: GM_PROGRAM[tr.inst] ?? 0,
    volume: 100,
    pan: 64,
    reverb: Math.round((tr.reverb ?? 0.3) * 127),
    notes: tr.notes.map((n) => ({ t: n.t, d: n.d, p: n.p, v: n.v })),
  }));
  return writeMidi({
    bpm: song.bpm,
    beatsPerBar: song.beatsPerBar,
    tracks,
    markers: song.markers,
  });
}

/* ============================ 2. 读回 MIDI ============================ */

/**
 * 从 MIDI 还原"可渲染的乐谱"：把 MIDI 的音符按轨道顺序，
 * 配回编曲模块里的乐器与音色参数（这些属于合成器而非 MIDI 标准）。
 */
function scoreFromMidi(midiBuf, song) {
  const parsed = readMidi(midiBuf);
  const byName = new Map(song.tracks.map((t) => [t.name, t]));

  const tracks = parsed.tracks.map((tr) => {
    const orig = byName.get(tr.name);
    if (!orig) throw new Error(`MIDI 中的轨道 "${tr.name}" 在编曲里找不到`);
    // 把原始 opts 按 (起始拍, 音高) 匹配回去，保留音色细节
    const optIndex = new Map();
    for (const n of orig.notes) {
      const key = `${n.t.toFixed(4)}|${n.p}`;
      if (!optIndex.has(key)) optIndex.set(key, n.opts || {});
    }
    const notes = tr.notes.map((n) => {
      const key = `${n.t.toFixed(4)}|${n.p}`;
      return { ...n, opts: optIndex.get(key) || {} };
    });
    return { ...orig, notes };
  });

  return {
    ...song,
    bpm: parsed.bpm,
    beatsPerBar: parsed.beatsPerBar,
    tracks,
  };
}

/* ============================ 3. MP3 编码 ============================ */

/**
 * lamejs 是浏览器风格的脚本，直接 require 会因作用域问题报
 * "MPEGMode is not defined"。这里把 lame.all.js 放进 vm 沙箱执行，
 * 拿到完整的 lamejs 对象再使用（纯 JS，无原生依赖）。
 */
function loadLame() {
  const lamePath = path.join(ROOT, 'node_modules', 'lamejs', 'lame.all.js');
  if (!fs.existsSync(lamePath)) return null;
  const src = fs.readFileSync(lamePath, 'utf8');
  const sandbox = {
    console,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    JSON,
    isNaN,
    parseInt,
    parseFloat,
    Float32Array,
    Float64Array,
    Int8Array,
    Uint8Array,
    Uint16Array,
    Int16Array,
    Int32Array,
    Uint32Array,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'lame.all.js' });
  return sandbox.lamejs || null;
}

/** 把 Int16 PCM 编码成 MP3 Buffer */
function encodeMp3(lamejs, pcm, sampleRate, kbps) {
  const enc = new lamejs.Mp3Encoder(1, sampleRate, kbps);
  const blockSize = 1152; // MP3 帧长
  const chunks = [];
  for (let i = 0; i < pcm.length; i += blockSize) {
    const slice = pcm.subarray(i, Math.min(i + blockSize, pcm.length));
    const buf = enc.encodeBuffer(slice);
    if (buf.length > 0) chunks.push(Buffer.from(buf));
  }
  const tail = enc.flush();
  if (tail.length > 0) chunks.push(Buffer.from(tail));
  return Buffer.concat(chunks);
}

/* ============================ 4. 主流程 ============================ */

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return (bytes / 1024).toFixed(1) + ' KB';
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  // 【为什么默认要排除 NO_MP3】贪吃蛇已改用程序化合成，
  //   全量生成时如果又把 snake.mp3 写回 public/，包体会白涨 1.83MB，
  //   而且运行时根本不会读它。显式指定 snake 时仍然允许生成（便于对比）。
  const names = only.length ? only : Object.keys(SONGS).filter((n) => !NO_MP3.has(n));
  for (const n of names) {
    if (!SONGS[n]) {
      console.error(`未知曲目: ${n}（可选: ${Object.keys(SONGS).join(', ')}）`);
      process.exit(1);
    }
  }

  fs.mkdirSync(OUT_MIDI, { recursive: true });
  fs.mkdirSync(CACHE, { recursive: true });

  const lamejs = loadLame();
  if (!lamejs) {
    console.warn('⚠ 未找到 lamejs，将只输出 WAV（请先执行 npm i -D lamejs）');
  }

  const report = [];
  const t0 = Date.now();

  for (const name of names) {
    const song = SONGS[name]();
    const loopSeconds = (song.bars * song.beatsPerBar * 60) / song.bpm;
    console.log(`\n▶ ${name}  ${song.bpm} BPM · ${song.key} · ${song.bars} 小节 · 循环 ${fmtTime(loopSeconds)}`);

    // --- 步骤 1：乐谱 -> MIDI 二进制 ---
    const midiBuf = buildMidiFile(song);
    const midiPath = path.join(OUT_MIDI, `${name}.mid`);
    fs.writeFileSync(midiPath, midiBuf);
    console.log(`  [1/4] MIDI  ${fmtSize(midiBuf.length)}  (${song.tracks.reduce((a, t) => a + t.notes.length, 0)} 个音符, ${song.tracks.length} 轨)`);

    // --- 步骤 2：读回 MIDI，确保合成的是文件里的内容 ---
    const score = scoreFromMidi(midiBuf, song);
    const noteCount = score.tracks.reduce((a, t) => a + t.notes.length, 0);

    // --- 步骤 3：合成 PCM + 写 WAV ---
    const rendered = renderSong(score, {
      sampleRate: SAMPLE_RATE,
      tailSeconds: Math.max(4, song.bars * song.beatsPerBar * (60 / song.bpm) * 0.02),
    });
    const wav = encodeWav(rendered.samples, SAMPLE_RATE);
    const wavPath = path.join(CACHE, `${name}.wav`);
    fs.writeFileSync(wavPath, wav);
    console.log(
      `  [2/4] WAV   ${fmtSize(wav.length)}  (峰值 ${rendered.peakDb.toFixed(1)} dBFS · RMS ${rendered.rmsDb.toFixed(1)} dBFS` +
        ` · 原始峰值 ${rendered.rawPeak.toFixed(2)}${rendered.limited ? ' 已软限幅' : ''})`
    );

    // --- 步骤 4：编码 MP3 ---
    let mp3Bytes = 0;
    let mp3Path = null;
    if (lamejs) {
      const pcm = toInt16(rendered.samples);
      const mp3 = encodeMp3(lamejs, pcm, SAMPLE_RATE, MP3_KBPS);
      mp3Path = path.join(OUT_MP3, `${name}.mp3`);
      fs.writeFileSync(mp3Path, mp3);
      mp3Bytes = mp3.length;
      console.log(`  [3/4] MP3   ${fmtSize(mp3.length)}  (${MP3_KBPS}kbps 单声道)`);
    } else {
      // 退化方案：把 wav 也放到 public，保证页面能播
      mp3Path = path.join(OUT_MP3, `${name}.wav`);
      fs.writeFileSync(mp3Path, wav);
      mp3Bytes = wav.length;
      console.log(`  [3/4] WAV   ${fmtSize(wav.length)}  (lamejs 不可用，退化为 WAV)`);
    }

    // --- 步骤 5：清理可能残留的旧格式文件 ---
    for (const stale of [`${name}.wav`, `${name}.mp3`]) {
      const p = path.join(OUT_MP3, stale);
      if (p !== mp3Path && fs.existsSync(p)) fs.unlinkSync(p);
    }

    report.push({
      name,
      bpm: song.bpm,
      key: song.key,
      bars: song.bars,
      loopSeconds,
      midiBytes: midiBuf.length,
      wavBytes: wav.length,
      mp3Bytes,
      notes: noteCount,
      peakDb: rendered.peakDb,
      rmsDb: rendered.rmsDb,
      ext: lamejs ? 'mp3' : 'wav',
    });
    console.log(`  [4/4] 完成 ✓`);
  }

  // ---- 汇总 ----
  console.log('\n' + '='.repeat(64));
  let total = 0;
  for (const r of report) {
    total += r.mp3Bytes;
    console.log(
      `${r.name.padEnd(12)} ${fmtTime(r.loopSeconds)}  ${String(r.bpm).padStart(3)} BPM  ${r.key.padEnd(14)} ` +
        `${r.ext} ${fmtSize(r.mp3Bytes).padStart(8)}  midi ${fmtSize(r.midiBytes).padStart(7)}`
    );
  }
  console.log('-'.repeat(64));
  // 【这里以前写的是「上限 10 MB」】那个数字是拍脑袋写的，平台没有这条限制。
  //   真实约束只有一个：小程序整包 100 MiB（见 docs/requirements.md）。
  //   音频只是包体的一部分，字体、代码、图片都在抢同一份额度。
  //   所以这里只报体积和占比，不设人为上限——真要管，应该看整包。
  const PKG_LIMIT = 100 * 1024 * 1024;
  console.log(
    `音频合计 ${fmtSize(total)}（占整包额度 ${((total / PKG_LIMIT) * 100).toFixed(1)}%，整包上限 100 MiB）`
  );
  console.log(`总耗时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  console.log('='.repeat(64));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
