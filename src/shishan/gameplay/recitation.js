/**
 * recitation.js：古诗朗诵。
 * ------------------------------------------------------------
 * 逐句朗读一首诗。原来只用浏览器自带的 speechSynthesis，
 * 现在优先走在线 TTS（音色统一、朗读更自然），
 * 没配 Key 或合成失败时自动退回系统语音。
 *
 * 【为什么仍然保留系统语音这条路】朗读是随时可能点的功能，
 *   没网、Key 过期、配额用尽都会让在线合成失败。
 *   如果失败就静默，用户只会觉得按钮坏了。
 *   退回系统语音至少"点了有声音"。
 *
 * 约定：
 *  - 优先使用 poem.split_lines（人工分块，词牌/古文更自然）；
 *  - 没有分块时按标点切句，过短的句子自动合并；
 *  - 设备没有中文朗读声音时返回 false，由界面给出温和提示，
 *    不影响游戏其他功能。
 */

import { getPoemSplitLines } from '../config/poemLines.js';
import { audio } from '../managers/AudioManager.js';
import { ttsReady, speak as speakOnline } from '../../core/tts.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

let speaking = false;
let currentUtterance = null;
let handlers = null;
let queue = [];
let queueIndex = 0;
// 朗诵期间把 BGM 压低（人声更清楚）：内部保证 begin/end 成对
let ducked = false;

function duckBgm() {
  if (ducked) return;
  ducked = true;
  audio.beginDucking();
}

function unduckBgm() {
  if (!ducked) return;
  ducked = false;
  audio.endDucking();
}

/** 把整首诗切成适合逐句朗读的句子 */
export function splitRecitationLines(poem) {
  if (!poem) return [];
  const manual = getPoemSplitLines(poem);
  if (manual && manual.length > 0) return manual;

  const raw = String(poem.full_text || '')
    .split(/(?<=[，。！？；、：,\n])/)
    .map((line) => line.trim())
    .filter(Boolean);

  const lines = [];
  let buffer = '';
  raw.forEach((piece) => {
    buffer += piece;
    if (buffer.length >= 8) {
      lines.push(buffer.trim());
      buffer = '';
    }
  });
  if (buffer.trim()) {
    if (lines.length > 0 && buffer.trim().length < 6) {
      lines[lines.length - 1] += buffer.trim();
    } else {
      lines.push(buffer.trim());
    }
  }
  return lines.length > 0 ? lines : [String(poem.full_text || '')];
}

/** 浏览器是否提供语音合成能力 */
export function hasSpeechSupport() {
  return Boolean(synth && typeof synth.speak === 'function');
}

/** 当前可用的中文声音（可能为空数组） */
export function getChineseVoices() {
  if (!hasSpeechSupport()) return [];
  const voices = synth.getVoices() || [];
  const chinese = voices.filter((voice) => /zh|cmn|Chinese|中文|普通话/i.test(`${voice.lang} ${voice.name}`));
  return chinese.length > 0 ? chinese : voices;
}

/**
 * 等待声音列表就绪（部分浏览器首次 getVoices() 为空）。
 * @returns {Promise<boolean>} 是否有可用声音
 */
export function ensureVoices(timeout = 900) {
  if (!hasSpeechSupport()) return Promise.resolve(false);
  if (getChineseVoices().length > 0) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      synth.onvoiceschanged = previous;
      resolve(value);
    };
    const previous = synth.onvoiceschanged;
    synth.onvoiceschanged = () => {
      if (getChineseVoices().length > 0) finish(true);
    };
    setTimeout(() => finish(getChineseVoices().length > 0), timeout);
  });
}

/**
 * 逐句朗读一首诗。
 * @param {object} poem
 * @param {object} options { onStart, onLine, onEnd, onError }
 * @returns {boolean} 是否成功开始（不支持时 false）
 */
export function speakPoem(poem, options = {}) {
  if (!hasSpeechSupport()) {
    if (options.onError) options.onError('unsupported');
    return false;
  }
  stopRecitation(true);

  const lines = splitRecitationLines(poem);
  if (lines.length === 0) return false;

  const voices = getChineseVoices();
  const voice = voices.find((item) => /zh[-_]CN|Chinese|普通话/i.test(`${item.lang} ${item.name}`)) || voices[0] || null;

  handlers = {
    onStart: options.onStart || null,
    onLine: options.onLine || null,
    onEnd: options.onEnd || null,
    onError: options.onError || null,
  };
  queue = lines;
  queueIndex = 0;
  speaking = true;
  // 开始朗读时把 BGM 压轻，读完了再补回来
  duckBgm();

  const speakNext = async () => {
    if (!speaking) return;
    if (queueIndex >= queue.length) {
      finishSpeaking();
      return;
    }
    const text = queue[queueIndex];

    // 【先试在线合成】配了 Key 才有意义；ttsReady() 内部会判断。
    //   成功就直接进下一句，不用再走系统语音。
    if (handlers?.onLine) handlers.onLine(queueIndex, text);
    if (queueIndex === 0 && handlers?.onStart) handlers.onStart();
    try {
      if (await ttsReady()) {
        const ok = await speakOnline(text, { lang: 'zh-CN', rate: 0.92 });
        if (ok) {
          queueIndex += 1;
          // 句与句之间留一点呼吸，和系统语音那条保持一致
          setTimeout(speakNext, 220);
          return;
        }
      }
    } catch { /* 落到系统语音 */ }

    if (!speaking) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.72;
    utterance.pitch = 1.02;
    utterance.volume = 1;
    if (voice) {
      // 个别浏览器的声音对象不允许手动指定，失败就用默认声音
      try {
        utterance.voice = voice;
      } catch (error) {
        // 忽略：用系统默认朗读声音
      }
    }
    currentUtterance = utterance;

    utterance.onstart = () => {
      // 【为什么这里不再调 onLine】上面在线合成分支已经统一提前通知过了。
      //   两处都调会让界面把同一句高亮两次，看起来像跳了一句。
      if (queueIndex === 0 && handlers?.onStart) handlers.onStart();
    };
    utterance.onend = () => {
      if (!speaking) return;
      queueIndex += 1;
      // 句与句之间留一点呼吸
      setTimeout(speakNext, 180);
    };
    utterance.onerror = (event) => {
      const reason = event?.error || 'unknown';
      if (reason === 'interrupted' || reason === 'canceled') return;
      if (handlers?.onError) handlers.onError(reason);
      finishSpeaking();
    };

    try {
      synth.speak(utterance);
    } catch (error) {
      if (handlers?.onError) handlers.onError(error?.message || 'speak-failed');
      finishSpeaking();
    }
  };

  try {
    if (synth.paused) synth.resume();
    speakNext();
    return true;
  } catch (error) {
    if (options.onError) options.onError(error?.message || 'speak-failed');
    speaking = false;
    handlers = null;
    unduckBgm();
    return false;
  }
}

function finishSpeaking() {
  speaking = false;
  currentUtterance = null;
  queue = [];
  queueIndex = 0;
  unduckBgm();
  const done = handlers?.onEnd;
  handlers = null;
  if (done) done();
}

/** 停止朗读（不会触发 onEnd 回调，避免界面闪回） */
export function stopRecitation(silent = false) {
  if (!synth) return;
  speaking = false;
  currentUtterance = null;
  queue = [];
  queueIndex = 0;
  unduckBgm();
  if (!silent) handlers = null;
  try {
    synth.cancel();
    if (synth.paused) synth.resume();
  } catch (error) {
    // 忽略取消时的异常
  }
}

export function isReciting() {
  return speaking;
}

export function getRecitationState() {
  return {
    supported: hasSpeechSupport(),
    voiceCount: getChineseVoices().length,
    speaking,
    totalLines: queue.length,
    currentIndex: queueIndex,
    bgmDucked: audio.isDucking(),
  };
}
