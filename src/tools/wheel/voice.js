/**
 * 转盘的语音播报。
 *
 * 【历史】这里原来有一套「预生成 113 条 MP3」的方案：
 *   小程序没联网权限，运行时合成不了，只能把常用短语提前录好打进包。
 *   联网权限申请下来之后那套方案就多余了——它能覆盖的文本是固定的，
 *   用户自己填的转盘选项永远覆盖不到，而且占了 0.54 MB 包体。
 *   现在改成在线合成，任意文本都能读，音色也统一。
 *
 * 【保留系统语音作为兜底】在线合成会因为没网、Key 过期、配额耗尽失败。
 *   失败时退回 speechSynthesis，至少"点了有声音"，
 *   而不是静默什么都不发生——那样用户只会以为按钮坏了。
 */
import { ttsReady, speak as speakOnline, speakSystem as speakSystemBase } from '../../core/tts.js';

/**
 * 音色列表。
 * 【为什么只有两项】在线合成用哪个音色由设置页的 provider/voice 决定，
 *   这里列的是"用不用在线"这个层级的选择，不是具体音色。
 */
export const VOICES = [
  {
    id: 'online',
    name: '在线语音',
    desc: '在设置里填好 Key 后启用，任意文本都能读，音色统一',
    source: '用户自己的 TTS 服务',
    rate: 1,
  },
  {
    id: 'system',
    name: '系统语音',
    desc: '设备自带 TTS，不占包体，但音色随设备变化',
    source: 'speechSynthesis',
    rate: 1,
  },
];

/** 判断某个语种：有汉字就当中文 */
export function detectLang(text) {
  return /[\u3400-\u9fff]/.test(String(text || '')) ? 'zh-CN' : 'en-US';
}

/** 系统语音（保留旧签名，内部转给统一实现） */
export function speakSystem(text, opts = {}) {
  return speakSystemBase(text, { lang: detectLang(text), ...opts });
}

/**
 * 朗读一段文本：在线优先，失败退回系统语音。
 * @returns {Promise<boolean>} 是否成功发出声音
 */
export async function speakSmart(text, opts = {}) {
  const raw = String(text || '').trim();
  if (!raw) return false;

  // 1) 在线合成（用户配了 Key 才有意义）
  try {
    if (await ttsReady()) {
      const ok = await speakOnline(raw, { lang: detectLang(raw), ...opts });
      if (ok) return true;
    }
  } catch { /* 落到系统语音 */ }

  // 2) 系统语音
  return speakSystem(raw, opts);
}

/** 兼容旧调用名 */
export const speakClip = speakSmart;
