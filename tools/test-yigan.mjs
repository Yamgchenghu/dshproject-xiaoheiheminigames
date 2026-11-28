// 一杆清台的计分 / 量化登记 / 移植防护测试。
//
// 【为什么这些断言必须存在】一杆清台是从独立网页搬进来的，
//   搬迁时最容易出的两类错都在这里守着：
//   1. 计分口径被改坏 —— 榜单上看不出对错，只是分数系统性偏了。
//   2. 移植时的改动被上游新包体覆盖 —— 玩家会看到 API 设置项又冒出来。
import { computeRunScore, MODES } from '../src/tools/yigan/scoring.js';
import { BASES, MODE_KEYS, SHORT_KEYS, baseOf } from '../src/core/quantize.js';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

/* 剥掉行注释和块注释，只留真实代码。字符串里的 // 不处理——
 * 本项目没有含 // 的关键字符串，这个简化是安全的。 */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

section('计分：赢比输高，且都大于 0');
{
  const win = computeRunScore({ mode: '8ball', winner: 0, difficulty: 'normal', shotIndex: 16, ballsTotal: 15 });
  const lose = computeRunScore({ mode: '8ball', winner: 1, difficulty: 'normal', shotIndex: 16, ballsTotal: 15 });
  ok('赢了有分', win > 0, 'win=' + win);
  ok('输了也有底分（否则没人愿意打完）', lose > 0, 'lose=' + lose);
  ok('赢的分数高于输的', win > lose, 'win=' + win + ' lose=' + lose);
}

section('计分：杆数越少分越高');
{
  const few = computeRunScore({ mode: '8ball', winner: 0, difficulty: 'normal', shotIndex: 8, ballsTotal: 15 });
  const many = computeRunScore({ mode: '8ball', winner: 0, difficulty: 'normal', shotIndex: 60, ballsTotal: 15 });
  ok('8 杆高于 60 杆', few > many, 'few=' + few + ' many=' + many);
}

section('计分：难度越高分越高');
{
  const easy = computeRunScore({ mode: '8ball', winner: 0, difficulty: 'easy', shotIndex: 16, ballsTotal: 15 });
  const normal = computeRunScore({ mode: '8ball', winner: 0, difficulty: 'normal', shotIndex: 16, ballsTotal: 15 });
  const master = computeRunScore({ mode: '8ball', winner: 0, difficulty: 'master', shotIndex: 16, ballsTotal: 15 });
  ok('休闲 < 标准 < 大师', easy < normal && normal < master, [easy, normal, master].join(' / '));
}

section('计分：斯诺克基础分最高（22 颗球最难）');
{
  const mk = (m) => computeRunScore({ mode: m, winner: 0, difficulty: 'normal', shotIndex: 20, ballsTotal: 15 });
  const vals = ['8ball', '9ball', 'rotation', 'snooker'].map(mk);
  ok('四种模式分数递增', vals[0] < vals[1] && vals[1] < vals[2] && vals[2] < vals[3], vals.join(' / '));
}

section('计分：结果一定是正整数（榜上不能有小数）');
{
  for (const mode of ['8ball', '9ball', 'rotation', 'snooker']) {
    for (const winner of [0, 1, -1]) {
      const s = computeRunScore({ mode, winner, difficulty: 'normal', shotIndex: 30, ballsTotal: 15 });
      ok(mode + ' winner=' + winner + ' 是正整数', Number.isInteger(s) && s > 0, 'got=' + s);
    }
  }
}

section('计分：空状态不崩');
{
  ok('null 返回 0', computeRunScore(null) === 0);
  ok('空对象不抛错', typeof computeRunScore({}) === 'number');
}

section('量化表：四种模式都已登记，基准分与 MODE_BASE 一致');
{
  ok('MODE_KEYS 含 yigan', Array.isArray(MODE_KEYS.yigan));
  ok('四个模式都在', MODE_KEYS.yigan.length === 4, 'got=' + MODE_KEYS.yigan.length);
  for (const m of ['8ball', '9ball', 'rotation', 'snooker']) {
    ok('MODE_KEYS 含 ' + m, MODE_KEYS.yigan.includes(m));
    ok(m + ' 有基准分', baseOf('yigan', m) > 0, 'got=' + baseOf('yigan', m));
  }
  ok('SHORT_KEYS 有 yigan', SHORT_KEYS.yigan === 'yg', 'got=' + SHORT_KEYS.yigan);
}

section('MODES 元信息与量化表一致');
{
  ok('MODES 有 4 项', MODES.length === 4, 'got=' + MODES.length);
  for (const m of MODES) {
    ok('MODES 里的 ' + m.value + ' 在量化表里', MODE_KEYS.yigan.includes(m.value));
    ok('MODES 里的 ' + m.value + ' 有中文名', !!m.label);
  }
}

section('移植防护：API / 联机代码不能回来');
{
  const gamePath = join(root, 'src/tools/yigan/game.js');
  ok('game.js 存在', existsSync(gamePath));
  const raw = readFileSync(gamePath, 'utf8');
  // 【为什么先剥注释再查】移植说明里会提到「原版有 PROVIDERS / PeerJS，已砍掉」，
  //   那是解释，不是代码。只查真实代码，才不会被自己的注释误伤。
  const src = stripComments(raw);
  // 【为什么要查这些符号】它们是移植时明确砍掉的 API / 联机能力。
  //   如果哪天有人拿上游新包体直接覆盖 game.js，这些符号会全部回来，
  //   而这个测试会立刻失败，提醒他按 docs/yigan-fork.md 重新裁剪。
  const banned = [
    'httpPost', 'httpGet', 'callLLM', 'askModel', 'parseModelChoice',
    'stateForModel', 'simulateShotInSandbox', 'askModelWithSandbox',
    'modelAngleCandidate', 'aiThinkRounds', 'testApiConnection',
    'fetchAvailableModels', 'populateProviders', 'PROVIDERS',
    'peerjs', 'PeerJS', 'new Peer(', 'LAN_HOST', 'webLan',
  ];
  for (const sym of banned) {
    ok('不含 ' + sym, !src.includes(sym));
  }
  ok('不含局域网联机字样', !src.includes('局域网联机'));
  ok('不含 API-Key 字样', !src.includes('API-Key'));
}

section('移植防护：防护文档与警示头都在');
{
  ok('docs/yigan-fork.md 存在', existsSync(join(root, 'docs/yigan-fork.md')));
  const src = readFileSync(join(root, 'src/tools/yigan/game.js'), 'utf8');
  ok('game.js 顶部有 ⚠️ 移植警示', src.slice(0, 2000).includes('⚠️'));
  ok('警示里提到 yigan-fork.md', src.slice(0, 3000).includes('yigan-fork.md'));
}

section('移植防护：peerjs 资源不能被打包');
{
  ok('没有 peerjs.min.js', !existsSync(join(root, 'src/tools/yigan/peerjs.min.js')));
  ok('没有 peerjs 目录', !existsSync(join(root, 'src/tools/yigan/peerjs')));
}

console.log('');
console.log((fail === 0 ? '全部通过：' : '存在失败：') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);