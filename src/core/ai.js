/**
 * 单词机的 AI 能力 —— 识图 / 切分 / 翻译 / 总结课文。
 *
 * 【为什么单独一个模块】TTS 是「把文字变成声音」，这里是「把图片或文字变成结构化数据」，
 *   两件事的失败模式完全不同：TTS 失败最多没声音，这里失败会把乱七八糟的内容写进用户词表。
 *   所以校验必须比 TTS 严得多——宁可报错让用户重来，也不能存进脏数据。
 *
 * 【域名限制】只能用「网络权限」批准清单里的域名：
 *   dashscope.aliyuncs.com / api.deepseek.com / open.bigmodel.cn
 *   api.xiaomimimo.com / ark.cn-beijing.volces.com / api.moonshot.cn
 *   加新服务商要重新申请权限。
 *
 * 【为什么默认不自动调用】每次调用都花用户自己的钱（Key 是用户填的）。
 *   所以所有 AI 功能都是「用户点了才跑」，绝不后台偷偷请求。
 */
import { storageGet, storageSet } from '../sdk/hb.js';
// 复用 logic.js 里已验证过的解析与切分，不再写第二份
import { extractJson as L_extractJson, normalizeAiWords as L_normalizeAiWords, chunk as L_chunk } from '../tools/danciji/logic.js';

const KEY_STORE = 'ai:danciji:v1';

/**
 * 文本模型预设。
 *
 * 【为什么要分 text / vision】识图必须用多模态模型，翻译用文本模型就够。
 *   用文本模型去识图会直接报错，用多模态模型翻译又贵又慢，
 *   所以按用途分开列，界面上也分开选。
 */
export const AI_PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
    // 【为什么要有候选列表】设置页把模型名做成了下拉框，
    //   用户不用背模型 ID。列表按"官方仍在服务"的常见型号给，
    //   第一项就是默认值，和上面的 model 字段保持一致。
    models: [
      { id: 'deepseek-chat', name: 'deepseek-chat（通用对话，推荐）' },
      { id: 'deepseek-reasoner', name: 'deepseek-reasoner（推理更强，较慢）' },
    ],
    vision: false,
    hint: '便宜、中文好，适合翻译和总结',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4v-flash',
    models: [
      { id: 'glm-4v-flash', name: 'glm-4v-flash（识图，免费额度，推荐）' },
      { id: 'glm-4v-plus', name: 'glm-4v-plus（识图，更准，计费）' },
      { id: 'glm-4-flash', name: 'glm-4-flash（纯文本，最快）' },
    ],
    vision: true,
    hint: 'glm-4v-flash 支持识图，免费额度够用',
  },
  {
    id: 'qwen',
    name: '千问 Qwen',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-vl-max',
    models: [
      { id: 'qwen-vl-max', name: 'qwen-vl-max（识图，最准，推荐）' },
      { id: 'qwen-vl-plus', name: 'qwen-vl-plus（识图，便宜）' },
      { id: 'qwen-plus', name: 'qwen-plus（纯文本，快）' },
    ],
    vision: true,
    hint: 'qwen-vl 系列支持识图，中英混排识别准',
  },
  {
    id: 'mimo',
    name: '小米 MiMo',
    endpoint: 'https://api.xiaomimimo.com/v1/chat/completions',
    model: 'mimo-v2.5',
    models: [
      { id: 'mimo-v2.5', name: 'mimo-v2.5（识图，推荐）' },
      { id: 'mimo-v2.5-pro', name: 'mimo-v2.5-pro（更强，较慢）' },
    ],
    vision: true,
    hint: '同一个 Key 也能用在语音合成上',
  },
  {
    // 火山方舟（豆包）。endpoint 用的是 ark 的 OpenAI 兼容路径，
    // 和豆包网页版/APP 的 Key 不是同一个——必须去「火山方舟控制台 → API Key 管理」
    // 单独申请，很多人卡在这一步。
    id: 'ark',
    name: '火山豆包',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    model: 'doubao-seed-1-6-flash-250828',
    models: [
      { id: 'doubao-seed-1-6-flash-250828', name: 'doubao-seed-1.6-flash（识图，便宜，推荐）' },
      { id: 'doubao-seed-1-6-250615', name: 'doubao-seed-1.6（识图，更强）' },
      { id: 'doubao-1-5-pro-32k-250115', name: 'doubao-1.5-pro-32k（纯文本）' },
    ],
    vision: true,
    hint: '豆包 Seed 支持识图，单价低；Key 要去火山方舟控制台单独申请',
  },
  {
    // 月之暗面 Kimi。kimi-k2 系列是纯文本，识图要用 moonshot-v1-vision。
    id: 'moonshot',
    name: '月之暗面 Kimi',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'kimi-k2-0905-preview',
    models: [
      { id: 'kimi-k2-0905-preview', name: 'kimi-k2（纯文本，长文强，推荐）' },
      { id: 'moonshot-v1-8k-vision-preview', name: 'moonshot-v1-8k-vision（识图）' },
      { id: 'moonshot-v1-32k', name: 'moonshot-v1-32k（超长上下文）' },
    ],
    vision: false,
    visionModel: 'moonshot-v1-8k-vision-preview',
    hint: '长文本强，适合整篇课文总结；识图要换 vision 模型',
  },
];

/** 取某个预设 */
export function aiProviderOf(id) {
  return AI_PROVIDERS.find((p) => p.id === id) || AI_PROVIDERS[0];
}

/** 读配置；没配过返回空壳 */
export async function loadAiConfig() {
  try {
    const raw = await storageGet(KEY_STORE);
    if (raw && typeof raw === 'object') {
      return {
        provider: raw.provider || 'deepseek',
        apiKey: raw.apiKey || '',
        model: raw.model || '',
        visionProvider: raw.visionProvider || 'zhipu',
      };
    }
  } catch (e) {
    console.warn('[AI] 读配置失败', e);
  }
  return { provider: 'deepseek', apiKey: '', model: '', visionProvider: 'zhipu' };
}

/**
 * 存配置。
 * 【为什么 Key 只进本地】云存档是明文可读的，把 Key 放进去等于公开。
 *   本地 storage 不参与云同步，换设备要重填，这是安全换来的代价。
 */
export async function saveAiConfig(cfg) {
  const next = {
    provider: (cfg && cfg.provider) || 'deepseek',
    apiKey: (cfg && cfg.apiKey) || '',
    model: (cfg && cfg.model) || '',
    visionProvider: (cfg && cfg.visionProvider) || 'zhipu',
  };
  await storageSet(KEY_STORE, next);
  return next;
}

/** 配好了没有（有 Key 才算） */
export async function aiReady() {
  const cfg = await loadAiConfig();
  return !!String(cfg.apiKey || '').trim();
}

/**
 * 底层请求：OpenAI 兼容的 chat/completions。
 *
 * 【为什么统一成 OpenAI 格式】批准清单里的四家（DeepSeek / 智谱 / 千问兼容模式 / MiMo）
 *   都提供 OpenAI 兼容端点，一套请求体走通四家，不必为每家写分支。
 *   智谱的 paas/v4 和千问的 compatible-mode 都是为此设计的。
 *
 * @param {object} opts
 * @param {string} opts.system  系统提示词
 * @param {string|Array} opts.user  用户内容（识图时是数组）
 * @param {boolean} opts.json  是否要求返回 JSON
 * @param {number} opts.timeoutMs
 */
async function chat(opts) {
  const o = opts || {};
  const cfg = await loadAiConfig();
  const apiKey = String(cfg.apiKey || '').trim();
  if (!apiKey) throw new Error('还没填 API Key，请先到设置里填');

  const useVision = o.vision === true;
  const preset = aiProviderOf(useVision ? cfg.visionProvider : cfg.provider);
  // 用户手填了模型名就优先用他的——各家的模型更新很快，写死会很快过时
  // 【为什么要 visionModel】有的家把文本模型和视觉模型分成两条线
  //   （Kimi 就是：kimi-k2 不能识图，识图得用 moonshot-v1-*-vision）。
  //   用户手填的 model 只对文本生效，识图时用预设里的 visionModel，
  //   否则会拿一个不支持图片的模型去识图，报错信息还很难懂。
  const autoModel = useVision ? (preset.visionModel || preset.model) : preset.model;
  const model = String(cfg.model || '').trim() || autoModel;

  const messages = [];
  if (o.system) messages.push({ role: 'system', content: o.system });
  messages.push({ role: 'user', content: o.user });

  const body = { model, messages, temperature: o.temperature != null ? o.temperature : 0.3 };
  if (o.json) body.response_format = { type: 'json_object' };

  // 【为什么要 AbortController】bridge 的请求超时是 10 秒，
  //   但模型偶尔要 20 秒以上。不主动设上限的话，用户会看到界面卡死没有任何反馈。
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), o.timeoutMs || 60000) : null;

  let res;
  try {
    res = await fetch(preset.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch (e) {
    if (timer) clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new Error('请求超时，模型没在预期时间内返回');
    throw new Error('网络请求失败：' + ((e && e.message) || '未知原因'));
  }
  if (timer) clearTimeout(timer);

  if (!res.ok) {
    // 把服务商的原始错误带出来，否则用户只看到「失败」不知道是 Key 错了还是余额没了
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch { /* 忽略 */ }
    throw new Error('接口返回 ' + res.status + (detail ? '：' + detail : ''));
  }

  const data = await res.json();
  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  if (!content) throw new Error('模型返回里没有内容');
  return String(content);
}

/* ------------------------------------------------------------------ */
/* 具体能力                                                            */
/* ------------------------------------------------------------------ */

const WORD_SYSTEM = [
  '你是英语词表整理助手。',
  '用户会给你一段文字或一张课本照片，里面混有英文单词、音标、词性、中文释义、例句、页码、单元号等。',
  '你要提取出可以背诵的单词表。',
  '规则：',
  '1. 只保留真正需要背的英文单词或短语，不要收例句、不要收整句翻译。',
  '2. en 只放英文本身，小写开头，不要带序号、音标、词性标记。',
  '3. zh 放最核心的中文意思，多个义项用「；」分隔，不要带词性前缀（如 n. / v.）。',
  '4. 同一个单词只出现一次，重复的合并。',
  '5. 跳过纯数字、页码、单元标题、人名地名。',
  '6. 严格返回 JSON：{"words":[{"en":"abandon","zh":"放弃"}]}',
  '7. 不要输出任何解释文字，不要用代码块包裹。',
].join('\n');

/**
 * 从一段文字里抽出单词表。
 * @param {string} text 用户粘贴的原文
 * @returns {Promise<Array<{en:string,zh:string}>>}
 */
export async function aiParseWords(text, opts = {}) {
  const src = String(text || '').trim();
  if (!src) throw new Error('没有可解析的文字');
  // 【asSentences 的作用】课文导入要按句切，不能按词提取。
  //   输出结构一样，只是换一套规则，所以清洗逻辑（finalizeWords）共用。
  const system = opts.asSentences ? TEXT_SYSTEM : WORD_SYSTEM;
  const content = await chat({
    system,
    user: src.slice(0, 12000),
    json: true,
    timeoutMs: 90000,
  });
  return finalizeWords(content);
}

/**
 * 课文整理用的提示词。
 *
 * 【为什么不能复用 WORD_SYSTEM】词表的规则是「只保留单词、不要整句」，
 *   而课文恰恰相反——要的就是整句。用错提示词会得到一份被拆成
 *   单词的课文，用户拿到的是一堆散词，完全没法背。
 *   两者的输出结构相同（都是 [{en, zh}]），差别只在「一个条目是什么」，
 *   所以共用 finalizeWords 做清洗。
 */
const TEXT_SYSTEM = [
  '你是英语课文整理助手。',
  '用户会给你一段课文原文（可能带音标、行号、页码、中文注释，也可能是一整段没有换行的散文）。',
  '你要把它整理成可以逐句背诵的双语对照。',
  '规则：',
  '1. 按句子切分，一句一个条目。不要合并句子，也不要把一句话拆成几段。',
  '2. en 放完整的英文句子，保留原句的标点和大小写，不要加序号。',
  '3. zh 放这句对应的中文翻译；原文已有译文的照抄，没有的给出通顺直译。',
  '4. 跳过页码、单元号、练习题号、作者署名等与正文无关的内容。',
  '5. 句子顺序必须和原文一致，不要重排。',
  '6. 严格返回 JSON：{"words":[{"en":"I have a dream.","zh":"我有一个梦想。"}]}',
  '7. 不要输出任何解释文字，不要用代码块包裹。',
].join('\n');

/**
 * 从图片里识别单词表。
 * @param {string} dataUrl 形如 data:image/jpeg;base64,xxx
 */
export async function aiParseImage(dataUrl) {
  const src = String(dataUrl || '');
  if (!src.startsWith('data:image/')) throw new Error('图片格式不对');
  // 图片太大既慢又容易超 2 MiB 的请求上限，先压一下
  const small = await shrinkImage(src, 1400, 0.82);
  const content = await chat({
    system: WORD_SYSTEM,
    vision: true,
    user: [
      { type: 'text', text: '请识别这张图片里的单词表，按约定返回 JSON。' },
      { type: 'image_url', image_url: { url: small } },
    ],
    json: true,
    timeoutMs: 120000,
  });
  return finalizeWords(content);
}

/** 解析模型返回并清洗 */
function finalizeWords(content) {
  let raw;
  try {
    raw = L_extractJson(content);
  } catch (e) {
    throw new Error('模型没有返回可用的 JSON，请换个模型或重试');
  }
  const list = L_normalizeAiWords(raw);
  if (!list.length) throw new Error('没识别出单词，换张更清晰的图或检查文字内容');
  return list;
}

/**
 * 按 10 个一组切分。
 *
 * 【为什么要 AI 切分】用户可能一次贴进来三个单元的 120 个词。
 *   直接按 10 个硬切，会把同一个单元的短语拆到两组，
 *   背起来毫无关联。让模型按语义（同单元、同主题）分组更合理。
 *   模型失败就退回本地硬切，不能让功能卡住。
 */
export async function aiSplitGroups(words, size) {
  const list = Array.isArray(words) ? words : [];
  const n = Math.max(1, Number(size) || 10);
  if (list.length <= n) return [list];

  const payload = list.map((w, i) => (i + 1) + '.' + w.en + ' ' + w.zh).join('\n');
  try {
    const content = await chat({
      system: [
        '你是词表分组助手。',
        '把给定的单词按语义关联度分组，每组 ' + n + ' 个（最后一组可以少一些）。',
        '同一单元、同一主题、词形相近的词尽量放一起。',
        '严格返回 JSON：{"groups":[[1,2,3],[4,5,6]]}，数组里放的是单词的序号（从 1 开始）。',
        '不要输出解释，不要用代码块。',
      ].join('\n'),
      user: payload.slice(0, 8000),
      json: true,
      timeoutMs: 60000,
    });
    const raw = L_extractJson(content);
    const groups = Array.isArray(raw && raw.groups) ? raw.groups : [];
    const used = new Set();
    const out = [];
    for (const g of groups) {
      if (!Array.isArray(g)) continue;
      const bucket = [];
      for (const idx of g) {
        const i = Number(idx) - 1;
        if (!Number.isInteger(i) || i < 0 || i >= list.length || used.has(i)) continue;
        used.add(i);
        bucket.push(list[i]);
      }
      if (bucket.length) out.push(bucket);
    }
    // 模型漏掉的词补到最后一组，不能丢词
    const rest = list.filter((_, i) => !used.has(i));
    if (rest.length) {
      if (out.length && out[out.length - 1].length + rest.length <= n) out[out.length - 1].push(...rest);
      else out.push(rest);
    }
    return out.length ? out : L_chunk(list, n);
  } catch (e) {
    console.warn('[AI] 分组失败，退回本地切分', e);
    return L_chunk(list, n);
  }
}

/**
 * 总结课文，给出背诵技巧。
 * 返回 {summary, tips:[], keywords:[]}
 */
export async function aiSummarizeText(text) {
  const src = String(text || '').trim();
  if (!src) throw new Error('没有可总结的课文');
  const content = await chat({
    system: [
      '你是英语背诵助手。',
      '读用户给的英文课文，帮他更快背下来。',
      '严格返回 JSON：',
      '{"summary":"两三句中文概括讲了什么",',
      ' "tips":["具体可操作的背诵方法，2-4 条"],',
      ' "keywords":["课文里的关键英文词或短语，5-12 个"]}',
      'tips 要说人话，比如「按时间顺序记：先…再…最后…」，不要写「多读几遍」这种废话。',
      '不要输出解释，不要用代码块。',
    ].join('\n'),
    user: src.slice(0, 10000),
    json: true,
    timeoutMs: 90000,
  });
  const raw = L_extractJson(content);
  return {
    summary: String((raw && raw.summary) || '').trim(),
    tips: Array.isArray(raw && raw.tips) ? raw.tips.map((t) => String(t).trim()).filter(Boolean) : [],
    keywords: Array.isArray(raw && raw.keywords) ? raw.keywords.map((k) => String(k).trim()).filter(Boolean) : [],
  };
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

/**
 * 压缩图片，返回新的 data URL。
 *
 * 【为什么必须压】bridge 的请求体上限是 2 MiB，
 *   手机直出的照片动辄 4-8 MB，不压会直接失败。
 *   压到长边 1400px、JPEG 0.82，通常 200-400 KB，
 *   对识别单词表这种场景清晰度绰绰有余。
 */
async function shrinkImage(dataUrl, maxSide, quality) {
  try {
    const img = await loadImage(dataUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvas.toDataURL('image/jpeg', quality || 0.82);
  } catch (e) {
    console.warn('[AI] 图片压缩失败，用原图', e);
    return dataUrl;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = src;
  });
}

/** 文件转 data URL */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}
