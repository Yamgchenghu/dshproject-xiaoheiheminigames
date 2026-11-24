// 校验两个小程序的功能隔离。
//
// 【为什么值得测】游戏版和工具版共用一份源码，靠 FEATURES 开关分家。
//   开关写错不会有任何报错，只会在审核通过后表现为：
//   游戏版里冒出转盘入口、或者工具版里冒出游戏。这类问题
//   线上才被发现，代价是一次重新提审，所以用测试提前拦住。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); }
}

// ---- 1. FEATURES 的取值必须自洽 ----
// 直接读源码文本判断，避免依赖构建期注入的 __APP_VARIANT__。
const variantSrc = readFileSync(join(root, 'src/core/variant.js'), 'utf8');

ok(/mods:\s*IS_GAMES/.test(variantSrc), '模组必须只给游戏版（mods: IS_GAMES）');
ok(/wheel:\s*IS_TOOLS/.test(variantSrc), '转盘必须只给工具版（wheel: IS_TOOLS）');
ok(/games:\s*IS_GAMES/.test(variantSrc), '游戏必须只给游戏版');
ok(/leaderboard:\s*IS_GAMES/.test(variantSrc), '排行榜必须只给游戏版');
ok(/login:\s*IS_GAMES/.test(variantSrc), '登录必须只给游戏版');
ok(/wordMachine:\s*IS_TOOLS/.test(variantSrc), '单词机必须只给工具版');
ok(/shishan:\s*IS_TOOLS/.test(variantSrc), '诗山寻踪必须只给工具版');

// ---- 2. 设置页的关键卡片必须按变体上锁 ----
const settingsSrc = readFileSync(join(root, 'src/ui/settings.js'), 'utf8');

// 模组实验室入口：没有 FEATURES.mods 门禁的话，工具版会露出一个空实验室
ok(/FEATURES\.mods && p\.settings\?\.devMode/.test(settingsSrc),
  '模组实验室入口缺少 FEATURES.mods 门禁');

// 语音合成 / AI 卡片：游戏版不调 TTS 也不调模型，露出来只会让人白填 Key
ok(/if \(FEATURES\.wordMachine\) modal\.appendChild\(\s*\n\s*h\('div', \{ class: 'card' \}, \[\s*\n\s*h\('h3', \{\}, '语音合成'\)/.test(settingsSrc),
  '语音合成卡片缺少 FEATURES.wordMachine 门禁');
ok(/if \(FEATURES\.wordMachine\) modal\.appendChild\(\s*\n\s*h\('div', \{ class: 'card' \}, \[\s*\n\s*h\('h3', \{\}, 'AI 整理'\)/.test(settingsSrc),
  'AI 整理卡片缺少 FEATURES.wordMachine 门禁');
ok(/if \(FEATURES\.wordMachine\) modal\.appendChild\(cloneCard\)/.test(settingsSrc),
  '克隆音色卡片缺少 FEATURES.wordMachine 门禁');

// 用量列表：游戏版不该显示转盘/自动指令行
ok(/if \(FEATURES\.wheel\) \{[\s\S]{0,400}add\('转盘数据'/.test(settingsSrc),
  '云存档用量的转盘行缺少 FEATURES.wheel 门禁');
ok(/if \(FEATURES\.mods\) \{[\s\S]{0,300}add\('模组源码'/.test(settingsSrc),
  '云存档用量的模组行缺少 FEATURES.mods 门禁');

// ---- 3. 构建变体必须跟随 package.json 绑定 ----
// 【这条最重要】曾经因为只看环境变量、忘了传 APP_VARIANT，
//   把工具版打进了游戏服。现在必须从 heybox.name 推断。
const viteSrc = readFileSync(join(root, 'vite.config.js'), 'utf8');
ok(/pkg\.heybox\.name/.test(viteSrc), '构建变体没有从 package.json 的 heybox.name 推断');
ok(/resolveVariant/.test(viteSrc), '缺少 resolveVariant 函数');

// 变体名和 package.json 的绑定必须能对上
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const boundName = pkg.heybox && pkg.heybox.name;
ok(boundName === '复古游戏' || boundName === '学习与实用工具',
  'package.json 的 heybox.name 不是已知变体名：' + boundName);

console.log((fail === 0 ? '全部通过：' : '存在失败：') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
