/**
 * 音色克隆 —— 用一小段录音复刻音色，之后所有朗读都用这个声音。
 *
 * 【为什么走智谱】原方案是在本地跑 SoVITS，但那需要 .pth 权重，
 *   包里没有，而且几百 MB 塞进 100 MiB 的小程序根本放不下。
 *   智谱的 GLM-TTS-Clone 只要 3 秒样本就能克隆，权重在他们服务器上，
 *   我们只存一个音色 ID（几十字节），这是唯一在包体限制内可行的路。
 *
 * 【两步协议】注意这是两步，不能一步到位：
 *   1) POST /paas/v4/files        上传样本音频（multipart），拿到 file_id
 *   2) POST /paas/v4/voice/clone  用 file_id 换 voice ID
 *   之后合成音频时把 voice 填成这个 ID 即可。
 *
 * 【为什么不支持任意音频格式】官方只收 mp3 / wav，
 *   浏览器录音默认是 webm，所以这里必须转码，
 *   否则上传会被拒。
 */
import { storageGet, storageSet } from '../sdk/hb.js';
import { loadTtsConfig } from './tts.js';

const CLONE_STORE = 'tts:clone:v1';
const FILE_UPLOAD = 'https://open.bigmodel.cn/api/paas/v4/files';
const VOICE_CLONE = 'https://open.bigmodel.cn/api/paas/v4/voice/clone';

/** 读已克隆的音色 */
export async function loadClone() {
  try {
    const raw = await storageGet(CLONE_STORE);
    if (raw && typeof raw === 'object' && raw.voiceId) {
      return { voiceId: String(raw.voiceId), name: String(raw.name || '我的音色'), at: Number(raw.at) || 0 };
    }
  } catch (e) {
    console.warn('[克隆] 读配置失败', e);
  }
  return null;
}

export async function saveClone(info) {
  if (!info || !info.voiceId) {
    await storageSet(CLONE_STORE, {});
    return null;
  }
  const next = { voiceId: String(info.voiceId), name: String(info.name || '我的音色'), at: Date.now() };
  await storageSet(CLONE_STORE, next);
  return next;
}

export async function clearClone() {
  await storageSet(CLONE_STORE, {});
}

/**
 * 把浏览器录到的音频转成 wav。
 *
 * 【为什么要自己转】MediaRecorder 在 Chrome 里默认输出 webm/opus，
 *   智谱只收 mp3/wav。用 WebAudio 解码后重采样成 16kHz 单声道 PCM，
 *   再手写 44 字节 WAV 头——这样不依赖任何转码库，包体零增加。
 *   16kHz 对语音克隆足够，而且文件小、上传快。
 */
async function toWav(blob) {
  const buf = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('当前环境不支持音频处理');
  const ctx = new AC();
  let audio;
  try {
    audio = await ctx.decodeAudioData(buf.slice(0));
  } finally {
    // 解码完就关，不然会一直占着一个音频上下文（浏览器有数量上限）
    try { ctx.close(); } catch { /* 忽略 */ }
  }

  // 多声道混成单声道：克隆只关心音色，不需要立体声
  const ch0 = audio.getChannelData(0);
  let mono = ch0;
  if (audio.numberOfChannels > 1) {
    const ch1 = audio.getChannelData(1);
    mono = new Float32Array(ch0.length);
    for (let i = 0; i < ch0.length; i++) mono[i] = (ch0[i] + ch1[i]) / 2;
  }

  // 线性重采样到 16k
  const targetRate = 16000;
  const ratio = audio.sampleRate / targetRate;
  const outLen = Math.max(1, Math.floor(mono.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = Math.floor(i * ratio);
    const v = mono[src] || 0;
    // 钳到 [-1,1] 再转 16 位，防止削波爆音
    const s = Math.max(-1, Math.min(1, v));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return encodeWav(out, targetRate);
}

/** 手写 WAV 头（44 字节）+ PCM 数据 */
function encodeWav(samples, sampleRate) {
  const bytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const view = new DataView(buf);
  const w = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  w(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  view.setUint32(16, 16, true);          // fmt 块长度
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率
  view.setUint16(32, 2, true);           // 块对齐
  view.setUint16(34, 16, true);          // 位深
  w(36, 'data');
  view.setUint32(40, bytes, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) view.setInt16(off, samples[i], true);
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * 用一段录音克隆音色。
 * @param {Blob} audioBlob 录音（任意浏览器支持的格式）
 * @param {string} voiceName 音色名，需唯一
 * @param {string} sampleText 这段录音说的内容（选填，给了更准）
 */
export async function cloneVoice(audioBlob, voiceName, sampleText) {
  const cfg = await loadTtsConfig();
  const apiKey = String(cfg.apiKey || '').trim();
  if (!apiKey) throw new Error('请先在设置里填语音合成的 API Key');

  // 智谱的克隆接口只认智谱的 Key，用别家的会 401。
  // 这里提前拦一下，省得用户上传完才失败。
  if (cfg.provider && cfg.provider !== 'zhipu') {
    throw new Error('音色克隆目前只支持智谱，请先在设置里把语音合成切换到智谱');
  }

  const wav = await toWav(audioBlob);
  // 官方要求 3-30 秒，超过 10 MB 会被拒。压到 16k 单声道后 30 秒约 1 MB，安全。
  if (wav.size > 9 * 1024 * 1024) throw new Error('录音太长了，请控制在 30 秒内');

  // ---- 第一步：上传 ----
  const form = new FormData();
  form.append('file', wav, 'sample.wav');
  form.append('purpose', 'voice-clone-input');
  const up = await fetch(FILE_UPLOAD, {
    method: 'POST',
    // 【注意】这里绝对不能手写 Content-Type，
    //   必须让浏览器自己带 multipart 的 boundary，手写会导致解析失败
    headers: { Authorization: 'Bearer ' + apiKey },
    body: form,
  });
  if (!up.ok) {
    let d = '';
    try { d = (await up.text()).slice(0, 200); } catch { /* 忽略 */ }
    throw new Error('上传录音失败 ' + up.status + (d ? '：' + d : ''));
  }
  const upData = await up.json();
  const fileId = upData && (upData.id || upData.file_id);
  if (!fileId) throw new Error('上传成功但没拿到 file_id');

  // ---- 第二步：克隆 ----
  const name = String(voiceName || ('my_voice_' + Date.now())).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40);
  const res = await fetch(VOICE_CLONE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: 'glm-tts-clone',
      voice_name: name,
      text: String(sampleText || '').slice(0, 200),
      input: '音色已就绪，这是你的声音。',
      file_id: fileId,
    }),
  });
  if (!res.ok) {
    let d = '';
    try { d = (await res.text()).slice(0, 200); } catch { /* 忽略 */ }
    throw new Error('克隆失败 ' + res.status + (d ? '：' + d : ''));
  }
  const data = await res.json();
  const voiceId = data && data.voice;
  if (!voiceId) throw new Error('克隆成功但没拿到音色 ID');
  return await saveClone({ voiceId, name });
}

/** 录音器封装：开始/停止，返回 Blob */
export function createRecorder() {
  let rec = null;
  let chunks = [];
  let stream = null;

  return {
    async start() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('当前环境不支持录音');
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      rec = new MediaRecorder(stream);
      chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.start();
    },
    async stop() {
      if (!rec) return null;
      const done = new Promise((resolve) => { rec.onstop = () => resolve(); });
      rec.stop();
      await done;
      // 一定要关麦克风，否则浏览器的录音指示灯会一直亮着
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      return new Blob(chunks, { type: chunks[0] ? chunks[0].type : 'audio/webm' });
    },
    cancel() {
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* 忽略 */ }
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    },
  };
}
