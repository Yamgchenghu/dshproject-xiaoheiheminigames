// 校验供应商的候选模型/音色列表。
//
// 【为什么值得单独测】设置页的下拉框直接吃这些数组：
//   数组缺了，用户看到的下拉框就是空的；
//   默认值不在候选里，打开设置页会显示成「跟随默认」，
//   用户以为没配过，其实是他自己填的型号被静默丢弃了。
//   这两个问题都不会报错，只能靠测试兜住。
import { AI_PROVIDERS } from '../src/core/ai.js';
import { TTS_PROVIDERS } from '../src/core/tts.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); }
}

// ---- AI ----
ok(AI_PROVIDERS.length > 0, 'AI 供应商不能为空');
for (const p of AI_PROVIDERS) {
  ok(Array.isArray(p.models) && p.models.length > 0, p.id + ' 缺少 models 候选列表');
  ok(p.models.some((m) => m.id === p.model), p.id + ' 的默认模型 ' + p.model + ' 不在候选列表里');
  ok(p.models.every((m) => m.id && m.name), p.id + ' 的候选项缺少 id 或 name');
  const ids = p.models.map((m) => m.id);
  ok(new Set(ids).size === ids.length, p.id + ' 的候选模型有重复');
}

// ---- TTS ----
ok(TTS_PROVIDERS.length > 0, 'TTS 供应商不能为空');
for (const p of TTS_PROVIDERS) {
  ok(Array.isArray(p.models) && p.models.length > 0, p.id + ' 缺少 models 候选列表');
  ok(p.models.some((m) => m.id === p.model), p.id + ' 的默认模型 ' + p.model + ' 不在候选列表里');
  ok(Array.isArray(p.voices) && p.voices.length > 0, p.id + ' 缺少 voices 候选列表');
  ok(p.voices.some((v) => v.id === p.voice), p.id + ' 的默认音色 ' + p.voice + ' 不在候选列表里');
}

// 默认模型必须排在第一项：下拉框的「跟随默认」在语义上就等于第一项，
// 两者不一致会让人以为默认值和第一项是两个不同的东西。
for (const p of AI_PROVIDERS) {
  ok(p.models[0].id === p.model, p.id + ' 的默认模型不是候选第一项');
}
for (const p of TTS_PROVIDERS) {
  ok(p.models[0].id === p.model, p.id + ' 的默认模型不是候选第一项');
  ok(p.voices[0].id === p.voice, p.id + ' 的默认音色不是候选第一项');
}

console.log((fail === 0 ? '全部通过：' : '存在失败：') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
