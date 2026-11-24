/**
 * AudioManager：音效与 BGM 的统一入口。
 * ------------------------------------------------------------
 * 设计目标：整包离线可用，不依赖任何音频文件。
 *
 * 1) 音效：全部用 WebAudio 合成柔和音色
 *    - 点击 / 翻页 / 答对 / 答错 / 拾取碎片 / 获得藏品 / 通关 / 节气诗碑 / 落笔
 *    - 音量克制、尾巴长，适合小朋友长时间听
 *
 * 2) BGM：六章差异化「古琴小曲」，用程序化音乐生成
 *    - 菜单、第一~六章、关卡、节气各有一套调式 / 速度 / 音色
 *    - 若 public/assets/audio 里放了同名 mp3，会自动优先播放真实音频
 *    - 受「设置 · 背景音乐」开关控制
 *
 * 3) 朗诵：由 gameplay/recitation.js 调用浏览器语音合成，不在本文件
 */

import { progress } from './ProgressManager.js';

/** BGM 曲目表：程序化曲风参数 + 可选的真实音频文件路径 */
export const BGM_TRACKS = {
  menu: {
    title: '诗山清晨', path: 'assets/audio/bgm_menu.mp3',
    bpm: 66, root: 293.66, scale: [0, 2, 4, 7, 9, 12, 14], density: 0.5, timbre: 'guqin', drone: 0.34,
  },
  chapter1: {
    title: '溪边草甸', path: 'assets/audio/bgm_chapter1.mp3',
    bpm: 74, root: 293.66, scale: [0, 2, 4, 7, 9, 12, 16], density: 0.55, timbre: 'guqin', drone: 0.3,
  },
  chapter2: {
    title: '清溪渡口', path: 'assets/audio/bgm_chapter2.mp3',
    bpm: 82, root: 392.0, scale: [0, 2, 5, 7, 9, 12, 14], density: 0.58, timbre: 'pluck', drone: 0.26,
  },
  chapter3: {
    title: '松风书院', path: 'assets/audio/bgm_chapter3.mp3',
    bpm: 64, root: 220.0, scale: [0, 3, 5, 7, 10, 12, 15], density: 0.42, timbre: 'guqin', drone: 0.4,
  },
  chapter4: {
    title: '云涧古观', path: 'assets/audio/bgm_chapter4.mp3',
    bpm: 56, root: 329.63, scale: [0, 2, 4, 7, 9, 12, 17], density: 0.34, timbre: 'bell', drone: 0.44,
  },
  chapter5: {
    title: '云麓文庄', path: 'assets/audio/bgm_chapter5.mp3',
    bpm: 78, root: 261.63, scale: [0, 2, 4, 7, 9, 11, 14], density: 0.5, timbre: 'pluck', drone: 0.3,
  },
  chapter6: {
    title: '凌霄诗台', path: 'assets/audio/bgm_chapter6.mp3',
    bpm: 88, root: 440.0, scale: [0, 2, 4, 7, 9, 12, 16], density: 0.62, timbre: 'pluck', drone: 0.22,
  },
  level: {
    title: '猜诗小调', path: 'assets/audio/bgm_level.mp3',
    bpm: 96, root: 392.0, scale: [0, 2, 4, 7, 9, 12, 14], density: 0.66, timbre: 'pluck', drone: 0.18,
  },
  festival: {
    title: '节气诗碑', path: 'assets/audio/bgm_festival.mp3',
    bpm: 58, root: 349.23, scale: [0, 2, 4, 7, 9, 11, 14], density: 0.3, timbre: 'bell', drone: 0.5,
  },
};

/** 场景 → BGM 的默认映射（地图会按章节取 chapter1~6） */
const SCENE_BGM = {
  MenuScene: 'menu',
  ChapterSelectScene: 'menu',
  PoemBookScene: 'menu',
  AnecdoteScene: 'menu',
  ReviewScene: 'menu',
  CollectionScene: 'menu',
  SettingScene: 'menu',
  ExcerptScene: 'menu',
  MapScene: 'chapter1',
  LevelScene: 'level',
  SortPoemScene: 'level',
  MeaningMatchScene: 'level',
  PoemMatch3Scene: 'level',
  PoemKlondikeScene: 'level',
  PoemChainScene: 'level',
  ClassicalQuizScene: 'level',
  FeihuaLingScene: 'level',
  RandomChallengeScene: 'level',
};

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** BGM 的基础增益（再乘 masterVolume，两者都受「压低」影响） */
const BGM_SYNTH_GAIN = 0.22;
const BGM_FILE_GAIN = 0.28;
/** 朗诵时把 BGM 压到原来的两成左右，人声更清楚，又不会突然静音 */
export const BGM_DUCK_FACTOR = 0.2;
/** 压低 / 恢复的过渡时间（秒） */
const BGM_DUCK_RAMP = 0.5;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class AudioManager {
  constructor() {
    this.ctx = null;
    this.game = null;
    this.bgm = null;
    this.bgmKey = null;
    this.pendingBgm = null;
    this._warnedBgm = new Set();
    this.masterVolume = 0.55;
    this._synth = null;
    // 需要「临时压低 BGM」的次数（朗诵等），>0 时 BGM 降到 BGM_DUCK_FACTOR
    this.ducking = 0;
  }

  /** main.js 创建 Phaser.Game 后注入，用于播放音频文件形式的 BGM */
  setGame(game) {
    this.game = game;
    if (this.pendingBgm) {
      const key = this.pendingBgm;
      this.pendingBgm = null;
      this.playBgm(key);
    }
  }

  _sfxEnabled() {
    return progress.getSettings().sfx !== false;
  }

  _bgmEnabled() {
    return progress.getSettings().bgm !== false;
  }

  _ensureContext() {
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        this.ctx = new Ctx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch (error) {
      console.warn('[音频] 初始化失败：', error);
      return null;
    }
  }

  /**
   * 播放一个柔和的合成音。
   * @param {object} options
   */
  _tone({
    freq = 660,
    duration = 0.5,
    type = 'sine',
    gain = 0.04,
    delay = 0,
    slideTo = null,
    harmonic = false,
  } = {}) {
    const ctx = this._ensureContext();
    if (!ctx) return;

    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), start + duration);
    }

    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + 0.035);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(env);
    env.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.05);

    if (harmonic) {
      const osc2 = ctx.createOscillator();
      const env2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 2.01, start);
      env2.gain.setValueAtTime(0.0001, start);
      env2.gain.exponentialRampToValueAtTime(gain * 0.22, start + 0.05);
      env2.gain.exponentialRampToValueAtTime(0.0001, start + duration * 0.7);
      osc2.connect(env2);
      env2.connect(ctx.destination);
      osc2.start(start);
      osc2.stop(start + duration);
    }
  }

  // ---------------------------------------------------------
  // 音效
  // ---------------------------------------------------------
  /** 答对：风铃轻响（C6 - E6 - G6） */
  playCorrect() {
    if (!this._sfxEnabled()) return;
    [1046.5, 1318.5, 1568.0].forEach((freq, index) => {
      this._tone({
        freq,
        duration: 1.15,
        delay: index * 0.085,
        gain: 0.042,
        harmonic: true,
      });
    });
  }

  /** 答错：柔和提示音，不刺耳 */
  playWrong() {
    if (!this._sfxEnabled()) return;
    this._tone({ freq: 392, duration: 0.48, type: 'triangle', gain: 0.035, slideTo: 311 });
    this._tone({
      freq: 261.6,
      duration: 0.6,
      delay: 0.12,
      type: 'sine',
      gain: 0.024,
    });
  }

  /** 点击：轻木声 */
  playClick() {
    if (!this._sfxEnabled()) return;
    this._tone({ freq: 587.3, duration: 0.1, type: 'sine', gain: 0.025 });
    this._tone({
      freq: 880,
      duration: 0.07,
      delay: 0.025,
      type: 'triangle',
      gain: 0.012,
    });
  }

  /** 收集碎片 / 拾取小物：清亮短音，比答对更轻，不打断阅读 */
  playCollect() {
    if (!this._sfxEnabled()) return;
    this._tone({ freq: 880, duration: 0.32, gain: 0.03, harmonic: true });
    this._tone({
      freq: 1318.5,
      duration: 0.42,
      delay: 0.075,
      gain: 0.024,
      harmonic: true,
    });
  }

  /** 解锁诗卡 / 成就：五声音阶上行 */
  playUnlock() {
    if (!this._sfxEnabled()) return;
    [523.3, 659.3, 784.0, 1046.5].forEach((freq, index) => {
      this._tone({
        freq,
        duration: 1.0,
        delay: index * 0.11,
        gain: 0.04,
        harmonic: index === 3,
      });
    });
  }

  /** 获得文房藏品：木鱼 + 小铜钟，比普通收集更「贵重」 */
  playCollection() {
    if (!this._sfxEnabled()) return;
    this._tone({ freq: 196, duration: 1.5, type: 'sine', gain: 0.05, harmonic: true });
    [659.3, 784.0, 987.8, 1318.5].forEach((freq, index) => {
      this._tone({
        freq,
        duration: 0.9,
        delay: 0.16 + index * 0.1,
        type: 'triangle',
        gain: 0.03,
        harmonic: true,
      });
    });
  }

  /** 通关：小鼓点 + 五声上行，短促有精神 */
  playLevelClear() {
    if (!this._sfxEnabled()) return;
    this._tone({ freq: 130.8, duration: 0.28, type: 'triangle', gain: 0.05, slideTo: 98 });
    this._tone({ freq: 174.6, duration: 0.22, delay: 0.18, type: 'triangle', gain: 0.04, slideTo: 130 });
    [523.3, 659.3, 784.0, 1046.5, 1318.5].forEach((freq, index) => {
      this._tone({
        freq,
        duration: 0.9,
        delay: 0.36 + index * 0.09,
        gain: 0.042,
        harmonic: index >= 3,
      });
    });
  }

  /** 节气诗碑 / 节日：远处钟声 + 风铃 */
  playFestival() {
    if (!this._sfxEnabled()) return;
    this._tone({ freq: 261.6, duration: 2.4, type: 'sine', gain: 0.045, harmonic: true });
    this._tone({ freq: 392, duration: 1.8, delay: 0.3, type: 'sine', gain: 0.028 });
    [1046.5, 1174.7, 1568.0].forEach((freq, index) => {
      this._tone({
        freq,
        duration: 1.2,
        delay: 0.5 + index * 0.16,
        gain: 0.026,
        harmonic: true,
      });
    });
  }

  /** 落笔 / 研墨：很轻的纸面摩擦感 */
  playBrush() {
    if (!this._sfxEnabled()) return;
    const ctx = this._ensureContext();
    if (!ctx) return;
    const start = ctx.currentTime;
    for (let i = 0; i < 5; i += 1) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 900 + i * 260;
      filter.Q.value = 0.8;
      osc.type = 'triangle';
      osc.frequency.value = 2100 + i * 460;
      env.gain.setValueAtTime(0.0001, start + i * 0.035);
      env.gain.exponentialRampToValueAtTime(0.006, start + i * 0.035 + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, start + i * 0.035 + 0.16);
      osc.connect(filter);
      filter.connect(env);
      env.connect(ctx.destination);
      osc.start(start + i * 0.035);
      osc.stop(start + i * 0.035 + 0.2);
    }
  }

  /** 确认 / 收下：短双音 */
  playConfirm() {
    if (!this._sfxEnabled()) return;
    this._tone({ freq: 784, duration: 0.22, gain: 0.03 });
    this._tone({ freq: 1046.5, duration: 0.34, delay: 0.12, gain: 0.028, harmonic: true });
  }

  /** 翻页 / 切换 */
  playPage() {
    if (!this._sfxEnabled()) return;
    this._tone({ freq: 740, duration: 0.16, type: 'sine', gain: 0.018 });
    this._tone({ freq: 554, duration: 0.2, delay: 0.05, type: 'sine', gain: 0.014 });
  }

  /** 统一入口：按名字播放音效（供调试与外部场景调用） */
  playSfx(name) {
    const map = {
      click: 'playClick',
      page: 'playPage',
      correct: 'playCorrect',
      wrong: 'playWrong',
      collect: 'playCollect',
      unlock: 'playUnlock',
      collection: 'playCollection',
      clear: 'playLevelClear',
      festival: 'playFestival',
      brush: 'playBrush',
      confirm: 'playConfirm',
    };
    const method = map[name];
    if (method && typeof this[method] === 'function') this[method]();
  }

  // ---------------------------------------------------------
  // BGM
  // ---------------------------------------------------------
  /**
   * BGM 播放入口。
   * 优先播放已加载的音频文件；没有文件时改用程序化古琴小曲。
   */
  playBgm(key) {
    const track = BGM_TRACKS[key] || BGM_TRACKS.menu;
    if (!track) return;
    const resolvedKey = BGM_TRACKS[key] ? key : 'menu';

    if (!this._bgmEnabled()) {
      this.bgmKey = resolvedKey;
      this._stopSynth();
      return;
    }

    if (this.bgmKey === resolvedKey) {
      if (this._synth || (this.bgm && this.bgm.isPlaying)) return;
    }

    this.stopBgm();

    // 1) 真实音频文件（把 mp3 放进 public/assets/audio 并在 PreloadScene 加载）
    const fileKey = `bgm_${resolvedKey}`;
    if (this.game?.cache?.audio?.exists(fileKey)) {
      try {
        this.bgm = this.game.sound.add(fileKey, {
          loop: true,
          volume: BGM_FILE_GAIN * this.masterVolume * this._duckFactor(),
        });
        this.bgm.play();
        this.bgmKey = resolvedKey;
        return;
      } catch (error) {
        console.warn('[音频] BGM 文件播放失败，改用合成小曲：', error);
      }
    }

    // 2) 程序化 BGM（离线可用）
    this._startSynth(track, resolvedKey);
    this.bgmKey = resolvedKey;
  }

  /** 按场景名自动选曲：地图按章节切歌，其余按场景表 */
  playSceneBgm(sceneKey, options = {}) {
    const chapterId = Number(options.chapterId) || 1;
    let key = SCENE_BGM[sceneKey] || 'menu';
    if (sceneKey === 'MapScene' || sceneKey === 'ChapterSelectScene') {
      key = `chapter${Math.min(6, Math.max(1, chapterId))}`;
      if (!BGM_TRACKS[key]) key = 'menu';
    }
    this.playBgm(key);
    return key;
  }

  _startSynth(track, key) {
    const ctx = this._ensureContext();
    if (!ctx) return;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, BGM_SYNTH_GAIN * this.masterVolume * this._duckFactor()),
      ctx.currentTime + 1.2,
    );
    gain.connect(ctx.destination);

    const rng = mulberry32(hashString(key));
    this._synth = {
      key,
      track,
      gain,
      rng,
      step: 0,
      nextTime: ctx.currentTime + 0.2,
      beat: 60 / track.bpm,
      melodyIndex: 3,
      timer: null,
    };
    this._synth.timer = setInterval(() => this._scheduleSynth(), 320);
    this._scheduleSynth();
  }

  _scheduleSynth() {
    const ctx = this.ctx;
    const state = this._synth;
    if (!ctx || !state) return;
    const { track } = state;
    const stepDur = state.beat / 2;

    // 提前 1.2 秒把音符排进时间轴，避免 setInterval 抖动导致断音
    while (state.nextTime < ctx.currentTime + 1.2) {
      this._scheduleStep(state, state.nextTime, stepDur);
      state.nextTime += stepDur;
      state.step += 1;
    }
  }

  _scheduleStep(state, time, stepDur) {
    const ctx = this.ctx;
    const { track, gain, rng } = state;
    const step = state.step;
    const beatsPerBar = 8; // 每 8 个八分音符一小节

    // 每两小节落一个低音「地气」，像古琴的空弦
    if (step % (beatsPerBar * 2) === 0) {
      this._synthNote(ctx, gain, {
        time,
        freq: track.root / 2,
        duration: stepDur * 7,
        type: 'sine',
        gain: 0.28 * track.drone,
        attack: 0.4,
      });
      this._synthNote(ctx, gain, {
        time: time + stepDur * 0.4,
        freq: (track.root / 2) * 1.5,
        duration: stepDur * 6,
        type: 'sine',
        gain: 0.16 * track.drone,
        attack: 0.5,
      });
    }

    // 旋律：五声音阶里做小步游走，偶尔留白
    if (rng() > track.density) return;

    const scale = track.scale;
    const move = rng();
    if (move < 0.3) state.melodyIndex = Math.max(0, state.melodyIndex - 1);
    else if (move > 0.7) state.melodyIndex = Math.min(scale.length - 1, state.melodyIndex + 1);
    else if (move > 0.55) state.melodyIndex = Math.floor(rng() * scale.length);

    const degree = scale[state.melodyIndex];
    const octave = rng() > 0.86 ? 2 : 1;
    const freq = track.root * octave * (2 ** (degree / 12));

    const pluck = track.timbre === 'pluck';
    const bell = track.timbre === 'bell';
    this._synthNote(ctx, gain, {
      time,
      freq,
      duration: bell ? stepDur * 6 : stepDur * 3.2,
      type: bell ? 'sine' : pluck ? 'triangle' : 'sine',
      gain: bell ? 0.1 : pluck ? 0.16 : 0.14,
      attack: bell ? 0.02 : 0.015,
      harmonic: !pluck || rng() > 0.6,
    });
  }

  _synthNote(ctx, dest, { time, freq, duration, type = 'sine', gain = 0.1, attack = 0.02, harmonic = false }) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(gain, time + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(env);
    env.connect(dest);
    osc.start(time);
    osc.stop(time + duration + 0.05);

    if (harmonic) {
      const osc2 = ctx.createOscillator();
      const env2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 2.005, time);
      env2.gain.setValueAtTime(0.0001, time);
      env2.gain.exponentialRampToValueAtTime(gain * 0.2, time + attack + 0.02);
      env2.gain.exponentialRampToValueAtTime(0.0001, time + duration * 0.7);
      osc2.connect(env2);
      env2.connect(dest);
      osc2.start(time);
      osc2.stop(time + duration);
    }
  }

  _stopSynth() {
    const state = this._synth;
    if (!state) return;
    this._synth = null;
    if (state.timer) clearInterval(state.timer);
    try {
      const ctx = this.ctx;
      if (ctx && state.gain) {
        state.gain.gain.cancelScheduledValues(ctx.currentTime);
        state.gain.gain.setValueAtTime(state.gain.gain.value || 0.0001, ctx.currentTime);
        state.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
        setTimeout(() => state.gain.disconnect(), 900);
      }
    } catch (error) {
      // 忽略音频节点关闭时的异常
    }
  }

  stopBgm() {
    if (this.bgm) {
      try {
        this.bgm.stop();
        this.bgm.destroy();
      } catch (error) {
        // 忽略销毁时的异常
      }
      this.bgm = null;
    }
    this._stopSynth();
    this.bgmKey = null;
  }

  // ---------------------------------------------------------
  // 临时压低 BGM（朗诵等人声内容）
  // ---------------------------------------------------------
  /** 当前 BGM 倍数：平时是 1，压低时是 BGM_DUCK_FACTOR */
  _duckFactor() {
    return this.ducking > 0 ? BGM_DUCK_FACTOR : 1;
  }

  /**
   * 临时压低 BGM，可以嵌套调用（每次 beginDucking 都要配一次 endDucking）。
   * 朗诵时用：BGM 不中断，只是变轻，人声更清楚。
   */
  beginDucking() {
    this.ducking += 1;
    if (this.ducking === 1) this._applyBgmDuck();
  }

  /** 结束一次压低，计数归零时把 BGM 音量补回来 */
  endDucking() {
    if (this.ducking <= 0) return;
    this.ducking -= 1;
    if (this.ducking === 0) this._applyBgmDuck();
  }

  /** 兜底：无论嵌套了几层，直接恢复 BGM（切换场景 / 关面板时用） */
  clearDucking() {
    if (this.ducking === 0) return;
    this.ducking = 0;
    this._applyBgmDuck();
  }

  isDucking() {
    return this.ducking > 0;
  }

  /** 把当前倍数落到正在播放的 BGM 上（0.5 秒过渡，不会「啪」一下变小） */
  _applyBgmDuck() {
    const factor = this._duckFactor();

    // 1) 程序化 BGM：调总线增益
    const state = this._synth;
    const ctx = this.ctx;
    if (state && ctx && state.gain) {
      try {
        const param = state.gain.gain;
        const now = ctx.currentTime;
        const target = Math.max(0.0001, BGM_SYNTH_GAIN * this.masterVolume * factor);
        param.cancelScheduledValues(now);
        param.setValueAtTime(Math.max(0.0001, param.value), now);
        param.exponentialRampToValueAtTime(target, now + BGM_DUCK_RAMP);
      } catch (error) {
        // 忽略音频节点关闭过程中的异常
      }
    }

    // 2) 真实音频文件 BGM：补间 volume
    if (this.bgm) {
      const target = BGM_FILE_GAIN * this.masterVolume * factor;
      const tweens = this.game?.tweens;
      if (tweens) {
        try {
          tweens.killTweensOf(this.bgm);
          tweens.add({
            targets: this.bgm,
            volume: target,
            duration: BGM_DUCK_RAMP * 1000,
            ease: 'Sine.easeInOut',
          });
        } catch (error) {
          this.bgm.volume = target;
        }
      } else {
        this.bgm.volume = target;
      }
    }
  }

  /** 设置改变后同步 BGM 开关 */
  syncBgmSetting() {
    if (!this._bgmEnabled()) {
      this.stopBgm();
    } else if (this.bgmKey) {
      const key = this.bgmKey;
      this.bgmKey = null;
      this.playBgm(key);
    }
  }

  /** 首次触摸时调用，唤醒 WebAudio */
  unlock() {
    this._ensureContext();
  }

  /** 调试 / 验收用：当前 BGM 状态 */
  getBgmDebug() {
    const filePlaying = Boolean(this.bgm && this.bgm.isPlaying);
    return {
      key: this.bgmKey,
      playing: Boolean(this._synth || filePlaying),
      mode: this._synth ? 'synth' : filePlaying ? 'file' : 'idle',
      title: this.bgmKey ? BGM_TRACKS[this.bgmKey]?.title || '' : '',
      ctxState: this.ctx ? this.ctx.state : 'none',
      volume: this.masterVolume,
      ducked: this.ducking > 0,
      duckFactor: this._duckFactor(),
      gain: this._synth?.gain ? Number(this._synth.gain.gain.value.toFixed(4)) : null,
    };
  }

  isBgmPlaying() {
    return Boolean(this._synth || (this.bgm && this.bgm.isPlaying));
  }
}

export const audio = new AudioManager();
