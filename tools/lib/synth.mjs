/**
 * 合成器引擎 —— 从 MIDI 乐谱渲染 PCM（全部中文注释，无任何音频库依赖）
 * ------------------------------------------------------------------
 * 组成：
 *   1. 振荡器：正弦 / 三角 / 方波(可变占空比) / 锯齿 / FM / 噪声
 *   2. 包络：ADSR（起音与释放均 >= 3ms，杜绝爆音）
 *   3. 滤波器：二阶低通（Biquad）、一阶高通，用于 pad 与打击乐塑形
 *   4. 效果：Schroeder 混响（4 梳状 + 2 全通）、低通反馈延迟
 *   5. 循环：多渲染一段"尾巴"，再折回开头，实现无缝循环
 */

import { freq as midiToFreq } from './theory.mjs';

export const TAU = Math.PI * 2;

/* ============================ 基础数学 ============================ */

/** 指数衰减包络：从 1 衰减到 0，时间常数为 tau */
function expDecay(t, tau) {
  return Math.exp(-t / tau);
}

/** 平滑淡入淡出（避免任何硬切） */
function fade(x, n) {
  return x < n ? x / n : 1;
}

/* ============================ 振荡器 ============================ */

/** 正弦波（相位 0..1） */
function sinOsc(ph) {
  return Math.sin(ph * TAU);
}

/** 三角波（相位 0..1） */
function triOsc(ph) {
  const p = ph - Math.floor(ph);
  return 4 * Math.abs(p - 0.5) - 1;
}

/** 方波 / 脉冲波，duty 为占空比（0.5 = 标准方波，0.25 = 细脉冲） */
function pulseOsc(ph, duty = 0.5) {
  const p = ph - Math.floor(ph);
  return p < duty ? 1 : -1;
}

/** 锯齿波（带轻度 polyBLEP 抗混叠） */
function sawOsc(ph, dt = 0) {
  const p = ph - Math.floor(ph);
  let v = 2 * p - 1;
  if (dt > 0) {
    // polyBLEP：在跳变处做一小段平滑，减少高频毛刺
    if (p < dt) {
      const t = p / dt;
      v -= t + t - t * t - 1;
    } else if (p > 1 - dt) {
      const t = (p - 1) / dt;
      v -= t * t + t + t + 1;
    }
  }
  return v;
}

/* ============================ 滤波器 ============================ */

/**
 * 二阶低通（RBJ biquad），系数在构造时按截止频率算好。
 * 用于 pad 的温暖感、噪声打击乐的音色塑造。
 */
class Lowpass {
  constructor(sr, cutoff, q = 0.707) {
    this.sr = sr;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(cutoff, q);
  }
  set(cutoff, q = 0.707) {
    const w0 = (TAU * Math.min(cutoff, this.sr * 0.45)) / this.sr;
    const cosw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const b0 = (1 - cosw) / 2;
    const b1 = 1 - cosw;
    const b2 = (1 - cosw) / 2;
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cosw) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** 一阶高通（用于噪声打击乐去掉低频轰鸣） */
class Highpass {
  constructor(sr, cutoff) {
    this.sr = sr;
    this.prevX = 0;
    this.prevY = 0;
    this.set(cutoff);
  }
  set(cutoff) {
    const rc = 1 / (TAU * cutoff);
    const dt = 1 / this.sr;
    this.alpha = rc / (rc + dt);
  }
  process(x) {
    const y = this.alpha * (this.prevY + x - this.prevX);
    this.prevX = x;
    this.prevY = y;
    return y;
  }
}

/* ============================ 乐器（声部） ============================ */
/*
 * 每个乐器是一个函数：
 *   (buf, sr, start, dur, f, vel, rnd, opts) => void
 * 直接叠加写进 buf（单声道 Float32Array）。
 * dur 是"音符时值"，实际发声长度可略长（自然衰减），由实现决定。
 */

/** 统一 ADSR 包络求值：t 为距音符起点秒数，sus 为持续段电平 */
function adsr(t, dur, a, d, s, r) {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 + (s - 1) * ((t - a) / d);
  if (t < dur) return s;
  const rt = t - dur;
  if (rt < r) return s * (1 - rt / r);
  return 0;
}

/**
 * 通用：把一段临时缓冲按增益叠加进主缓冲
 * 末尾统一做 6ms 淡出 —— 一次性乐器的衰减往往不会精确归零，
 * 若直接截断会在音符结束处产生可听见的咔哒声。
 */
const TAIL_FADE_SEC = 0.006;
function mixIn(buf, tmp, start, gain) {
  const n = Math.min(tmp.length, buf.length - start);
  const fadeN = Math.min(n, Math.round(TAIL_FADE_SEC * 44100));
  for (let i = 0; i < n; i++) {
    let v = tmp[i];
    if (i >= n - fadeN) v *= (n - i) / fadeN;
    buf[start + i] += v * gain;
  }
}

/** 钟琴 / 钢片琴：非谐波 FM，金属质感，衰减快 */
function instBell(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const len = Math.ceil(Math.min(opts.decay ?? 1.6, 2.4) * sr);
  const tmp = new Float32Array(len);
  const ratio = opts.ratio ?? 3.01;
  const index = opts.index ?? 2.2;
  const tau = opts.tau ?? 0.55;
  const attack = 0.003;
  let pc = 0;
  let pm = 0;
  const fc = (f * TAU) / sr;
  const fm = (f * ratio * TAU) / sr;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const modEnv = index * expDecay(t, tau * 0.55);
    const ampEnv = Math.min(fade(t, attack), expDecay(t, tau));
    const s = Math.sin(pc + modEnv * Math.sin(pm));
    tmp[i] = s * ampEnv;
    pc += fc;
    pm += fm;
    if (pc > TAU) pc -= TAU;
    if (pm > TAU) pm -= TAU;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.22));
}

/** 马林巴 / 木琴：基频 + 4 次谐波 + 高频"木头"瞬态 */
function instMarimba(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const tau = opts.tau ?? 0.42;
  const bright = opts.bright ?? 1;
  const len = Math.ceil(Math.min(3.2, dur + tau * 5) * sr);
  const tmp = new Float32Array(len);
  // 相位累加器（不要用 f*i，长音符会因浮点精度产生颗粒噪声）
  const d1 = (f * TAU) / sr;
  const d2 = (f * 3.99 * TAU) / sr;
  const d3 = (f * 9.2 * TAU) / sr;
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const e1 = expDecay(t, tau);
    const e2 = expDecay(t, tau * 0.32);
    const e3 = expDecay(t, tau * 0.12);
    const atk = fade(t, 0.0025);
    const s =
      Math.sin(p1) * e1 +
      Math.sin(p2) * e2 * 0.32 * bright +
      Math.sin(p3) * e3 * 0.1 * bright;
    tmp[i] = s * atk;
    p1 += d1;
    p2 += d2;
    p3 += d3;
    if (p1 > TAU) p1 -= TAU;
    if (p2 > TAU) p2 -= TAU;
    if (p3 > TAU) p3 -= TAU;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.28));
}

/** 拨弦：Karplus-Strong 物理建模，弦的质感 */
function instPluck(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const damp = opts.damp ?? 0.996;
  const bright = opts.bright ?? 0.5;
  const n = Math.max(2, Math.round(sr / f));
  const line = new Float32Array(n);
  // 激励：噪声经两级一阶低通，削掉近奈奎斯特的刺耳成分
  const cut = 2200 + bright * 3200;
  const k = 1 - Math.exp((-TAU * cut) / sr);
  let prev = 0;
  let prev2 = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1;
    prev += (w - prev) * k;
    prev2 += (prev - prev2) * k;
    line[i] = prev2;
  }
  // 激励归一化，保证不同音高的响度一致
  let mx = 1e-9;
  for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(line[i]));
  for (let i = 0; i < n; i++) line[i] /= mx;
  const decayTime = opts.decay ?? 1.8;
  // 衰减到 -60dB 所需的长度，保证自然收尾（配合 mixIn 的淡出）
  const len = Math.ceil(Math.min(6.0, Math.max(decayTime * 4, dur + 0.3)) * sr);
  const tmp = new Float32Array(len);
  let idx = 0;
  // 每周期损失一点能量，模拟琴弦衰减
  const loss = Math.pow(damp, 1);
  for (let i = 0; i < len; i++) {
    const cur = line[idx];
    const nxt = line[(idx + 1) % n];
    const v = (cur + nxt) * 0.5 * loss;
    line[idx] = v;
    tmp[i] = cur;
    idx = (idx + 1) % n;
  }
  // 整体包络：起音 3ms，长尾
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    tmp[i] *= fade(t, 0.003) * Math.min(1, expDecay(t, decayTime * 0.55));
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.3));
}

/** 低频脉冲：正弦 + 轻微下滑音，冷静的电子心跳 */
function instPulse(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const tau = opts.tau ?? 0.28;
  const len = Math.ceil((dur + tau * 4) * sr);
  const tmp = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const glide = 1 + 0.02 * Math.exp(-t / 0.03);
    const env = fade(t, 0.006) * Math.min(1, expDecay(t, tau)) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / (tau * 3)));
    tmp[i] = Math.sin(ph) * env;
    ph += (f * glide * TAU) / sr;
    if (ph > TAU) ph -= TAU;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.34));
}

/** 电钢琴：2 算子 FM（DX7 E.Piano 风格），带轻微颤音 */
function instEPiano(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const tau = opts.tau ?? 1.1;
  const len = Math.ceil((dur + 0.7) * sr);
  const tmp = new Float32Array(len);
  const ratio = 14.0;
  // 【为什么加 bright 参数】FM 的调制指数决定泛音多少，也就是亮度。
  //   默认值是按普通电钢调的，频谱重心约 1493Hz；
  //   但参考曲（雪原地表、飘雪世界等）在 1~2kHz 有 6~31% 的能量，
  //   而默认电钢只有 2%，听起来"闷在盒子里"。
  //   bright 直接放大调制指数，把泛音推上去。
  const idx0 = (2.6 * (vel / 127) + 0.8) * (opts.bright ?? 1);
  const fc = (f * TAU) / sr;
  const fm = (f * ratio * TAU) / sr;
  let pc = 0;
  let pm = 0;
  const trem = 4.6;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const modEnv = idx0 * expDecay(t, 0.22);
    const ampEnv =
      fade(t, 0.008) *
      (0.62 + 0.38 * expDecay(t, tau * 0.35)) *
      (t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.55));
    const tremolo = 1 - 0.08 * (0.5 + 0.5 * Math.sin(t * trem * TAU)) * Math.min(1, t / 0.6);
    tmp[i] = Math.sin(pc + modEnv * Math.sin(pm)) * ampEnv * tremolo;
    pc += fc;
    pm += fm;
    if (pc > TAU) pc -= TAU;
    if (pm > TAU) pm -= TAU;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.2));
}

/** 暖 pad：三个失谐锯齿 + 三角，慢起音，低通滤波 */
function instPad(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const attack = opts.attack ?? 0.55;
  const release = opts.release ?? 0.9;
  const cutoff = opts.cutoff ?? 1400;
  const len = Math.ceil((dur + release) * sr);
  const tmp = new Float32Array(len);
  const lp = new Lowpass(sr, cutoff, 0.9);
  const det = [-7, 0, 7, 12].map((c) => Math.pow(2, c / 1200));
  const phases = [rnd(), rnd(), rnd(), rnd()];
  const lfoRate = 0.13 + rnd() * 0.1;
  let lfoPh = rnd() * TAU;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const lfo = 1 + 0.06 * Math.sin(lfoPh);
    lfoPh += (lfoRate * TAU) / sr;
    if (lfoPh > TAU) lfoPh -= TAU;
    let s = 0;
    for (let k = 0; k < 3; k++) {
      const inc = (f * det[k] * lfo * TAU) / sr;
      s += sawOsc(phases[k], (f * det[k]) / sr) * 0.33;
      phases[k] += inc / TAU;
    }
    s += triOsc(phases[3]) * 0.22;
    phases[3] += (f * det[3] * 0.5 * TAU) / sr / TAU;
    const env = adsr(t, dur, attack, 0.35, 0.82, release);
    tmp[i] = lp.process(s) * env;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.14));
}

/** 8-bit 方波主旋律：可变占空比 + 延迟颤音 + 轻微滑音 */
function instSquareLead(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const duty = opts.duty ?? 0.25;
  const release = opts.release ?? 0.06;
  const len = Math.ceil((dur + release) * sr);
  const tmp = new Float32Array(len);
  let ph = rnd() * 0.1;
  const vibRate = 5.6;
  const vibDepth = (opts.vib ?? 9) / 1200;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const vib = t > 0.14 ? Math.sin((t - 0.14) * vibRate * TAU) * vibDepth * Math.min(1, (t - 0.14) / 0.2) : 0;
    const env = adsr(t, dur, 0.005, 0.06, 0.72, release);
    // 8-bit 采样保持式量化，增加颗粒感
    const s = pulseOsc(ph, duty);
    tmp[i] = s * env;
    ph += (f * (1 + vib) * TAU) / sr / TAU;
  }
  // 轻低通，削掉方波最刺耳的边角
  const lp = new Lowpass(sr, Math.min(7000, f * 6), 0.7);
  for (let i = 0; i < len; i++) tmp[i] = lp.process(tmp[i]);
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.16));
}

/** 8-bit 三角波贝斯（NES 风格） */
function instChipBass(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const release = opts.release ?? 0.05;
  const len = Math.ceil((dur + release) * sr);
  const tmp = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = adsr(t, dur, 0.004, 0.05, 0.85, release);
    tmp[i] = triOsc(ph) * env;
    ph += (f * TAU) / sr / TAU;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.3));
}

/** 圆润贝斯：正弦为主 + 少量方波，颗粒感适中 */
function instBass(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const tau = opts.tau ?? 0.9;
  const len = Math.ceil((dur + 0.25) * sr);
  const tmp = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = fade(t, 0.008) * Math.min(1, expDecay(t, tau * 3)) * (t < dur ? 1 : Math.max(0, 1 - (t - dur) / 0.2));
    tmp[i] = (Math.sin(ph) * 0.85 + triOsc(ph / TAU) * 0.15) * env;
    ph += (f * TAU) / sr;
    if (ph > TAU) ph -= TAU;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.34));
}

/** 大鼓：正弦下滑 + 瞬态咔哒 */
function instKick(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const len = Math.ceil(0.42 * sr);
  const tmp = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const fr = 48 + 118 * Math.exp(-t / 0.028);
    const env = Math.min(1, expDecay(t, 0.13)) * fade(t, 0.0015);
    tmp[i] = Math.sin(ph) * env;
    ph += (fr * TAU) / sr;
    if (ph > TAU) ph -= TAU;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.5));
}

/** 军鼓：噪声（高通）+ 一点体腔音 */
function instSnare(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const len = Math.ceil(0.26 * sr);
  const tmp = new Float32Array(len);
  const hp = new Highpass(sr, 900);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = expDecay(t, 0.075) * fade(t, 0.002);
    const noise = rnd() * 2 - 1;
    const body = Math.sin(ph) * expDecay(t, 0.05) * 0.5;
    tmp[i] = (hp.process(noise) * 0.9 + body) * env;
    ph += (185 * TAU) / sr;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.3));
}

/** 踩镲 / 沙锤：高通噪声，极短 */
function instHat(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const decay = opts.decay ?? 0.045;
  const len = Math.ceil(decay * 6 * sr);
  const tmp = new Float32Array(len);
  const hp = new Highpass(sr, opts.hp ?? 6200);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = expDecay(t, decay) * fade(t, 0.0015);
    tmp[i] = hp.process(rnd() * 2 - 1) * env;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.14));
}

/** 木鱼 / 响板：短促的木质敲击 */
function instWood(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const len = Math.ceil(0.09 * sr);
  const tmp = new Float32Array(len);
  const base = opts.freq ?? 880;
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = expDecay(t, 0.018) * fade(t, 0.001);
    tmp[i] = (Math.sin(p1) * 0.7 + Math.sin(p2) * 0.3) * env;
    p1 += (base * TAU) / sr;
    p2 += (base * 2.7 * TAU) / sr;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.16));
}

/** 柔和铺底弦乐：多锯齿 + 慢起音（用于 lo-fi 的副声部） */
function instStrings(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const attack = opts.attack ?? 0.28;
  const release = opts.release ?? 0.6;
  const len = Math.ceil((dur + release) * sr);
  const tmp = new Float32Array(len);
  const lp = new Lowpass(sr, opts.cutoff ?? 2200, 0.6);
  const dets = [-9, -3, 4, 10];
  const phs = dets.map(() => rnd());
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = 0;
    for (let k = 0; k < dets.length; k++) {
      const fr = f * Math.pow(2, dets[k] / 1200);
      s += sawOsc(phs[k], fr / sr) * 0.25;
      phs[k] += (fr * TAU) / sr / TAU;
    }
    tmp[i] = lp.process(s) * adsr(t, dur, attack, 0.3, 0.85, release);
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.1));
}

/** 音乐盒：明亮但柔软，适合悬疑场景的点缀 */
function instMusicBox(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const len = Math.ceil(1.9 * sr);
  const tmp = new Float32Array(len);
  const d1 = (f * TAU) / sr;
  const d2 = (f * 2.0 * TAU) / sr;
  const d3 = (f * 5.4 * TAU) / sr;
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const e1 = expDecay(t, 0.5);
    const e2 = expDecay(t, 0.24);
    const e3 = expDecay(t, 0.09);
    tmp[i] = (Math.sin(p1) * e1 + Math.sin(p2) * e2 * 0.18 + Math.sin(p3) * e3 * 0.07) * fade(t, 0.002);
    p1 += d1;
    p2 += d2;
    p3 += d3;
    if (p1 > TAU) p1 -= TAU;
    if (p2 > TAU) p2 -= TAU;
    if (p3 > TAU) p3 -= TAU;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.2));
}

/** 沙锤 / 细碎噪声打击：带通感的柔和噪声 */
function instShaker(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const decay = opts.decay ?? 0.03;
  const len = Math.ceil(decay * 7 * sr);
  const tmp = new Float32Array(len);
  const hp = new Highpass(sr, opts.hp ?? 4200);
  const lp = new Lowpass(sr, opts.lp ?? 11000, 0.7);
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = expDecay(t, decay) * fade(t, 0.0012);
    const w = rnd() * 2 - 1;
    prev = prev * 0.35 + w * 0.65; // 轻微平滑，去掉最尖的颗粒
    tmp[i] = lp.process(hp.process(prev)) * env;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.1));
}

/** 边击 / 木鼓边：短、干、有音高 */
function instRim(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const len = Math.ceil(0.12 * sr);
  const tmp = new Float32Array(len);
  const hp = new Highpass(sr, 1200);
  const base = opts.freq ?? 420;
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = expDecay(t, 0.016) * fade(t, 0.001);
    tmp[i] = (Math.sin(p1) * 0.6 + hp.process(rnd() * 2 - 1) * 0.5 + Math.sin(p2) * 0.25) * env;
    p1 += (base * TAU) / sr;
    p2 += (base * 1.58 * TAU) / sr;
    if (p1 > TAU) p1 -= TAU;
    if (p2 > TAU) p2 -= TAU;
  }
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.16));
}

/**
 * 黑胶底噪：整段连续的细微噪声 + 随机"噼啪"，lo-fi 氛围的关键
 * 这里 dur 表示持续整段长度，由渲染器按小节长度传入。
 */
function instVinyl(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const len = Math.min(Math.ceil(dur * sr), buf.length - start);
  if (len <= 0) return;
  const hp = new Highpass(sr, 1800);
  const lp = new Lowpass(sr, 7000, 0.6);
  const gain = (vel / 127) * (opts.gain ?? 0.05);
  let smooth = 0;
  let click = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // 极轻微的嘶声底噪
    smooth = smooth * 0.9 + (rnd() * 2 - 1) * 0.1;
    let v = lp.process(hp.process(smooth)) * 0.35;
    // 随机爆豆
    if (rnd() < 0.00035) click = 0.35 + rnd() * 0.5;
    if (click > 0.001) {
      v += (rnd() * 2 - 1) * click;
      click *= 0.55;
    }
    // 首尾各 80ms 淡入淡出，避免循环点爆音
    const env = Math.min(fade(t, 0.08), fade(dur - t, 0.08));
    buf[start + i] += v * gain * env;
  }
}

/** 8-bit 快速琶音：细脉冲，16 分音符扫和弦，红白机味 */
function instArp(buf, sr, start, dur, f, vel, rnd, opts = {}) {
  const duty = opts.duty ?? 0.125;
  const release = 0.02;
  const len = Math.ceil((dur + release) * sr);
  const tmp = new Float32Array(len);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = adsr(t, dur, 0.003, 0.02, 0.55, release);
    tmp[i] = pulseOsc(ph, duty) * env;
    ph += (f * TAU) / sr / TAU;
  }
  const lp = new Lowpass(sr, Math.min(9000, f * 8), 0.7);
  for (let i = 0; i < len; i++) tmp[i] = lp.process(tmp[i]);
  mixIn(buf, tmp, start, (vel / 127) * (opts.gain ?? 0.07));
}

export const INSTRUMENTS = {
  bell: instBell,
  marimba: instMarimba,
  pluck: instPluck,
  pulse: instPulse,
  epiano: instEPiano,
  pad: instPad,
  squareLead: instSquareLead,
  chipBass: instChipBass,
  bass: instBass,
  kick: instKick,
  snare: instSnare,
  hat: instHat,
  wood: instWood,
  strings: instStrings,
  musicBox: instMusicBox,
  shaker: instShaker,
  rim: instRim,
  vinyl: instVinyl,
  arp: instArp,
};

/* ============================ 效果器 ============================ */

/** Schroeder 混响：并联梳状 + 串联全通，单声道 */
class Reverb {
  constructor(sr, opts = {}) {
    const scale = sr / 44100;
    const combDelays = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round(d * scale));
    const apDelays = [556, 441, 341, 225].map((d) => Math.round(d * scale));
    this.feedback = opts.feedback ?? 0.82;
    this.damp = opts.damp ?? 0.22;
    this.combs = combDelays.map((d) => ({
      buf: new Float32Array(d),
      idx: 0,
      store: 0,
    }));
    this.aps = apDelays.map((d) => ({ buf: new Float32Array(d), idx: 0 }));
  }
  process(input, out) {
    const n = input.length;
    const combs = this.combs;
    const aps = this.aps;
    const fb = this.feedback;
    const damp = this.damp;
    for (let i = 0; i < n; i++) {
      const x = input[i] * 0.15;
      let acc = 0;
      for (let c = 0; c < combs.length; c++) {
        const cb = combs[c];
        const y = cb.buf[cb.idx];
        cb.store = y * (1 - damp) + cb.store * damp;
        cb.buf[cb.idx] = x + cb.store * fb;
        cb.idx = (cb.idx + 1) % cb.buf.length;
        acc += y;
      }
      let v = acc;
      for (let a = 0; a < aps.length; a++) {
        const ap = aps[a];
        const bufOut = ap.buf[ap.idx];
        ap.buf[ap.idx] = v + bufOut * 0.5;
        ap.idx = (ap.idx + 1) % ap.buf.length;
        v = bufOut - v;
      }
      out[i] += v;
    }
  }
}

/** 低通反馈延迟（制造空间感，不糊） */
class Delay {
  constructor(sr, timeSec, feedback = 0.32, cutoff = 2400) {
    this.buf = new Float32Array(Math.max(1, Math.round(timeSec * sr)));
    this.idx = 0;
    this.fb = feedback;
    this.lp = new Lowpass(sr, cutoff, 0.6);
  }
  process(input, out, wet = 0.3) {
    const b = this.buf;
    for (let i = 0; i < input.length; i++) {
      const d = b[this.idx];
      const y = this.lp.process(d);
      b[this.idx] = input[i] + y * this.fb;
      this.idx = (this.idx + 1) % b.length;
      out[i] += d * wet;
    }
  }
}

/* ============================ 渲染主流程 ============================ */

/**
 * 渲染一首曲子的 PCM
 * @param {object} song
 *   song.bpm            速度
 *   song.beatsPerBar    每小节拍数
 *   song.bars           循环总小节数（必须是整数，保证首尾对齐）
 *   song.tracks         [{ name, inst, notes:[{t,d,p,v,opts}], gain, delay?, reverb? }]
 *   song.masterReverb   主混响量 0..1
 * @param {object} cfg
 *   cfg.sampleRate      采样率
 *   cfg.tailSeconds     额外渲染的尾巴长度（用于折回，保证循环无缝）
 */
export function renderSong(song, cfg = {}) {
  const sr = cfg.sampleRate ?? 44100;
  const tailSec = cfg.tailSeconds ?? 6;
  const spb = 60 / song.bpm;
  const loopSeconds = song.bars * song.beatsPerBar * spb;
  const loopSamples = Math.round(loopSeconds * sr);
  const tailSamples = Math.round(tailSec * sr);
  const total = loopSamples + tailSamples;

  const master = new Float32Array(total);
  const wet = new Float32Array(total);
  const rng = (() => {
    // 每首歌用固定种子，保证可重复
    let a = (song.seed ?? 12345) >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  for (const tr of song.tracks) {
    const fn = INSTRUMENTS[tr.inst];
    if (!fn) throw new Error('未知乐器: ' + tr.inst);
    const bus = new Float32Array(total);
    for (const n of tr.notes) {
      const start = Math.round(n.t * spb * sr);
      if (start >= total) continue;
      const dur = Math.max(0.03, n.d * spb);
      const f = midiToFreq(n.p);
      fn(bus, sr, start, dur, f, n.v ?? 96, rng, n.opts || {});
    }
    // 声部级增益
    const g = tr.gain ?? 1;
    for (let i = 0; i < total; i++) bus[i] *= g;
    // 声部级延迟
    if (tr.delay) {
      const d = new Delay(sr, tr.delay.time ?? spb * 0.75, tr.delay.feedback ?? 0.3, tr.delay.cutoff ?? 2600);
      d.process(bus, bus, tr.delay.wet ?? 0.25);
    }
    // 汇总到干声与混响发送
    const send = tr.reverb ?? 0.3;
    for (let i = 0; i < total; i++) {
      master[i] += bus[i];
      wet[i] += bus[i] * send;
    }
  }

  // 主混响
  const rv = new Reverb(sr, { feedback: song.reverbFeedback ?? 0.82, damp: song.reverbDamp ?? 0.25 });
  const rvOut = new Float32Array(total);
  rv.process(wet, rvOut);
  const rvGain = song.masterReverb ?? 0.9;
  for (let i = 0; i < total; i++) master[i] += rvOut[i] * rvGain;

  // 尾巴最后 150ms 淡出到 0，避免折回时产生接缝
  const fadeN = Math.round(0.08 * sr);
  for (let i = 0; i < fadeN; i++) {
    const k = 1 - i / fadeN;
    master[total - 1 - i] *= k;
  }

  // 把尾巴折回开头 —— 这一步是"无缝循环"的关键
  for (let i = 0; i < tailSamples; i++) {
    master[i] += master[loopSamples + i];
  }

  // 只保留一个循环长度
  const loop = master.subarray(0, loopSamples);

  // ---- 电平处理 ----
  // 1) 先看原始峰值：只有确实过载（>1.0）时才做温和软限幅，
  //    否则纯线性缩放，绝不引入失真。
  let rawPeak = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = Math.abs(loop[i]);
    if (a > rawPeak) rawPeak = a;
  }
  if (rawPeak > 1.0) {
    // 过载时用 tanh 软拐点，避免硬削波的刺耳谐波
    const drive = 1.0 / rawPeak;
    for (let i = 0; i < loop.length; i++) loop[i] = Math.tanh(loop[i] * drive * 1.35) / 1.35;
  }
  // 2) 线性归一化到 -3dBFS（峰值 0.7079，绝不削波）
  let peak = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = Math.abs(loop[i]);
    if (a > peak) peak = a;
  }
  const target = Math.pow(10, -3 / 20); // -3 dBFS ≈ 0.7079
  const norm = peak > 0 ? target / peak : 1;
  for (let i = 0; i < loop.length; i++) loop[i] *= norm;

  // 统计
  let sumSq = 0;
  for (let i = 0; i < loop.length; i++) sumSq += loop[i] * loop[i];
  const rms = Math.sqrt(sumSq / loop.length);
  const rmsDb = 20 * Math.log10(rms || 1e-9);

  return {
    samples: loop,
    sampleRate: sr,
    loopSeconds,
    peak: peak * norm,
    rawPeak,
    limited: rawPeak > 1.0,
    rms,
    rmsDb,
    peakDb: 20 * Math.log10(peak * norm || 1e-9),
  };
}

/** 把 Float32 单声道 PCM 编码成 16bit WAV */
export function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const dataBytes = n * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt 块长度
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // 单声道
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // 字节率
  buf.writeUInt16LE(2, 32); // 块对齐
  buf.writeUInt16LE(16, 34); // 位深
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.round(samples[i] * 32767);
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    buf.writeInt16LE(v, 44 + i * 2);
  }
  return buf;
}

/** 转成 lamejs 需要的 Int16Array */
export function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let v = Math.round(samples[i] * 32767);
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    out[i] = v;
  }
  return out;
}
