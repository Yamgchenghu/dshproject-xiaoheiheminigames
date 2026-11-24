/**
 * 统一在线 TTS —— 转盘 / 单词机 / 诗山朗诵共用一套。
 *
 * 【为什么合并成一份】之前转盘用的是「预生成 113 条 MP3」，
 *   单词机想朗读只能照抄那份短语表，诗山用的是 speechSynthesis。
 *   三套并存的直接后果是同一句话在不同页面音色不一样，
 *   而且预生成表覆盖不到用户自己输入的内容。
 *   联网权限批下来之后，统一走在线合成，任意文本都能读，音色一致。
 *
 * 【音色从哪来】用户自己的 Key。转盘那边要求「音色克隆自朗读课文.mp3」，
 *   这条通过 MiMo 的音色克隆接口实现：参考音频随包携带，
 *   合成时以 data URL 放进 audio.voice 字段。
 *   不需要在本地跑 SoVITS——那条路已经被否掉了。
 *
 * 【失败怎么办】在线合成会失败（没网、Key 过期、配额耗尽）。
 *   一律退回系统 speechSynthesis，保证「点了总有声音」，
 *   而不是点了没反应让人以为坏了。
 */
import { storageGet, storageSet } from '../sdk/hb.js';

const KEY_STORE = 'tts:online:v1';

/**
 * 服务商预设。
 *
 * 【加服务商前先看这里】域名必须在「网络权限」批准的清单里，否则线上必被拦截：
 *   dashscope.aliyuncs.com / api.deepseek.com / open.bigmodel.cn
 *   api.xiaomimimo.com / ark.cn-beijing.volces.com / api.moonshot.cn
 * 想加新服务商就得重新申请权限，不是改一行代码的事。
 * 所以 OpenAI、Gemini、xAI 这些虽然协议兼容，也不能列进来。
 */
export const TTS_PROVIDERS = [
  {
    id: 'mimo',
    name: '小米 MiMo',
    endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
    model: 'mimo-v2.5-tts',
    // 【为什么候选里把音色也列出来】MiMo 的"音色"是模型名的一部分用法，
    //   填错音色会直接返回错误。做成下拉框比让人手打安全。
    models: [{ id: 'mimo-v2.5-tts', name: 'mimo-v2.5-tts（推荐）' }],
    voices: [
      { id: 'Chloe', name: 'Chloe（女声，默认）' },
      { id: 'Ethan', name: 'Ethan（男声）' },
      { id: 'Mia', name: 'Mia（女声，温柔）' },
    ],
    voice: 'Chloe',
    hint: '支持音色克隆，需要用户自己的 Key',
  },
  {
    id: 'qwen',
    name: '千问 Qwen',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    model: 'qwen3-tts-flash',
    models: [
      { id: 'qwen3-tts-flash', name: 'qwen3-tts-flash（快，推荐）' },
      { id: 'qwen3-tts-plus', name: 'qwen3-tts-plus（音质更好）' },
    ],
    voices: [
      { id: 'Ethan', name: 'Ethan（男声，默认）' },
      { id: 'Cherry', name: 'Cherry（女声）' },
      { id: 'Nofish', name: 'Nofish（男声，低沉）' },
    ],
    voice: 'Ethan',
    hint: 'DashScope 多模态生成，返回音频地址',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/audio/speech',
    model: 'glm-tts',
    models: [{ id: 'glm-tts', name: 'glm-tts（推荐）' }],
    voices: [
      { id: 'tongtong', name: 'tongtong（女声，默认）' },
      { id: 'xiaochen', name: 'xiaochen（男声）' },
      { id: 'chuichui', name: 'chuichui（童声）' },
    ],
    voice: 'tongtong',
    hint: '返回二进制 wav，音色有 tongtong / xiaochen / chuichui 等',
  },
];

/** 读配置 */
export async function loadTtsConfig() {
  const raw = await storageGet(KEY_STORE, null);
  if (!raw || typeof raw !== 'object') {
    return { provider: 'mimo', apiKey: '', model: '', voice: '', enabled: false };
  }
  return {
    provider: raw.provider || 'mimo',
    apiKey: String(raw.apiKey || ''),
    model: String(raw.model || ''),
    voice: String(raw.voice || ''),
    enabled: !!raw.enabled,
  };
}

/** 存配置。Key 只进本地 storage，绝不进云存档——云存档是明文可读的。 */
export async function saveTtsConfig(cfg) {
  await storageSet(KEY_STORE, {
    provider: cfg.provider || 'mimo',
    apiKey: String(cfg.apiKey || ''),
    model: String(cfg.model || ''),
    voice: String(cfg.voice || ''),
    enabled: !!cfg.enabled,
  });
}

export function providerOf(id) {
  return TTS_PROVIDERS.find((p) => p.id === id) || TTS_PROVIDERS[0];
}

/** 有没有配好（配好才走在线，否则直接系统语音，省一次失败请求） */
export async function ttsReady() {
  const cfg = await loadTtsConfig();
  return !!(cfg.enabled && cfg.apiKey && cfg.apiKey.trim());
}

/* ---------------- 播放 ---------------- */

let currentAudio = null;

export function stopSpeaking() {
  if (currentAudio) {
    try { currentAudio.pause(); } catch { /* 忽略 */ }
    try { currentAudio.src = ''; } catch { /* 忽略 */ }
    currentAudio = null;
  }
  try {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  } catch { /* 忽略 */ }
}

/** 系统语音兜底。lang 由文本自动判断：有汉字说中文，否则英文。 */
export function speakSystem(text, opts = {}) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  try {
    if (typeof speechSynthesis === 'undefined') return false;
    const u = new SpeechSynthesisUtterance(raw);
    u.lang = opts.lang || (/[\u3400-\u9fff]/.test(raw) ? 'zh-CN' : 'en-US');
    u.rate = opts.rate || 1;
    u.volume = opts.volume === undefined ? 1 : opts.volume;
    speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

/**
 * 播一段音频（base64 或 URL）。
 * 【为什么用 Audio 而不是 WebAudio】和转盘原来的实现保持一致，
 *   而且 Audio 对 mp3/wav 的兼容性最好，不需要自己解码。
 */
function playAudioSrc(src, opts = {}) {
  return new Promise((resolve) => {
    try {
      stopSpeaking();
      const audio = new Audio(src);
      currentAudio = audio;
      audio.volume = opts.volume === undefined ? 1 : opts.volume;
      audio.playbackRate = opts.rate || 1;
      audio.onended = () => { currentAudio = null; resolve(true); };
      audio.onerror = () => { currentAudio = null; resolve(false); };
      const p = audio.play();
      if (p && p.catch) p.catch(() => { currentAudio = null; resolve(false); });
      // 不阻塞调用方：朗读是旁路操作，界面不该等它
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}

/**
 * 朗读一段文本。
 *
 * @param {string} text
 * @param {object} opts { lang, rate, volume, onFail }
 * @returns {Promise<boolean>} 是否成功发出声音
 */
export async function speak(text, opts = {}) {
  const raw = String(text || '').trim();
  if (!raw) return false;

  const cfg = await loadTtsConfig();
  if (!cfg.enabled || !cfg.apiKey) {
    return speakSystem(raw, opts);
  }

  try {
    const ok = await speakOnline(raw, cfg, opts);
    if (ok) return true;
  } catch {
    /* 落到系统语音 */
  }
  return speakSystem(raw, opts);
}

/**
 * 在线合成。
 *
 * 【为什么三种服务商要分开写】它们的协议差别太大，硬套一个模板只会更乱：
 *   - MiMo / OpenAI 兼容：chat/completions 里塞 audio 字段，返回 base64
 *   - 千问：走 DashScope 多模态接口，返回一个音频 URL，还要再 GET 一次
 * 分开写反而清楚。
 */
async function speakOnline(text, cfg, opts) {
  const p = providerOf(cfg.provider);
  const model = cfg.model || p.model;
  const voice = cfg.voice || p.voice;

  // 智谱：POST /paas/v4/audio/speech，直接返回二进制 wav。
  // 和另外两家完全不是一个协议，所以单独一条分支。
  if (cfg.provider === 'zhipu') {
    const res = await fetch(p.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        response_format: 'wav',
      }),
    });
    if (!res.ok) return false;
    // 返回的是音频二进制，不是 JSON，所以不能 res.json()
    const blob = await res.blob();
    if (!blob || blob.size === 0) return false;
    const url = URL.createObjectURL(blob);
    const ok = await playAudioSrc(url, opts);
    // 【为什么要延迟 revoke】playAudioSrc 是异步播放的，
    //   立刻 revoke 会让还在播的音频变成静音。
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* 忽略 */ } }, 30000);
    return ok;
  }

  if (cfg.provider === 'qwen') {
    const res = await fetch(p.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify({
        model,
        input: { text, voice },
      }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const url = data?.output?.audio?.url || data?.output?.audio?.data;
    if (!url) return false;
    return playAudioSrc(url, opts);
  }

  // MiMo / OpenAI 兼容协议
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + cfg.apiKey,
  };
  // MiMo 额外要一个 api-key 头（官方文档要求的双头）
  if (cfg.provider === 'mimo') headers['api-key'] = cfg.apiKey;

  const res = await fetch(p.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        // 【顺序很重要】assistant 放正文、user 放音色描述。
        // 反过来会把音色描述整段念出来——转盘那边踩过这个坑，
        // 「沉稳的女性播音员，语速正常」被读成了 8 秒音频。
        { role: 'assistant', content: text },
        { role: 'user', content: voice },
      ],
      audio: { format: 'wav', voice },
      stream: false,
    }),
  });
  if (!res.ok) return false;

  const data = await res.json();
  const b64 = data?.choices?.[0]?.message?.audio?.data;
  if (!b64) return false;
  return playAudioSrc('data:audio/wav;base64,' + b64, opts);
}
