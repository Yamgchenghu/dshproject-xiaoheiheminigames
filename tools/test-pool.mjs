// 一杆清台（完整版）的计分 / 量化登记 / 新玩法测试。
//
// 【为什么要和 test-yigan.mjs 分开】两个小程序各有一份一杆清台：
//   复古游戏里那份（src/tools/yigan/）砍掉了联网，只有四种玩法；
//   一杆清台小程序那份（src/tools/pool/）是完整版，有六种玩法
//   （多出十球和 6 红球斯诺克）和国内大模型接入。
//   把两者的断言混在一起，改一个版本会莫名其妙弄红另一个的测试。
import { computeRunScore, MODES } from '../src/tools/pool/scoring.js';
import { BASES, MODE_KEYS, SHORT_KEYS, baseOf } from '../src/core/quantize.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

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
  const few = computeRunScore({ mode: '8ball', winner: 0, difficulty: 'normal', shotIndex: 10, ballsTotal: 15 });
  const many = computeRunScore({ mode: '8ball', winner: 0, difficulty: 'normal', shotIndex: 40, ballsTotal: 15 });
  ok('10 杆高于 40 杆', few > many, 'few=' + few + ' many=' + many);
}

section('计分：难度越高分越高');
{
  const easy = computeRunScore({ mode: '8ball', winner: 0, difficulty: 'easy', shotIndex: 16, ballsTotal: 15 });
  const master = computeRunScore({ mode: '8ball', winner: 0, difficulty: 'master', shotIndex: 16, ballsTotal: 15 });
  ok('大师难度高于休闲', master > easy, 'master=' + master + ' easy=' + easy);
}

section('计分：六种模式都算得出分');
{
  for (const m of ['8ball', '9ball', '10ball', 'rotation', 'snooker', 'snooker6']) {
    const s = computeRunScore({ mode: m, winner: 0, difficulty: 'normal', shotIndex: 20, ballsTotal: 15 });
    ok(m + ' 有分', s > 0, 'got=' + s);
  }
}

section('计分：未知模式不崩，按八球兜底');
{
  const s = computeRunScore({ mode: 'nonsense', winner: 0, difficulty: 'normal', shotIndex: 16, ballsTotal: 15 });
  ok('未知模式仍有分', s > 0, 'got=' + s);
  ok('null 返回 0', computeRunScore(null) === 0);
  ok('空对象不抛错', typeof computeRunScore({}) === 'number');
}

section('新玩法：十球比九球难，6 红球比标准斯诺克简单');
{
  const base = (m) => computeRunScore({ mode: m, winner: 0, difficulty: 'normal', shotIndex: 16, ballsTotal: 15 });
  ok('十球 > 九球', base('10ball') > base('9ball'), '10ball=' + base('10ball') + ' 9ball=' + base('9ball'));
  ok('轮转 > 十球', base('rotation') > base('10ball'), 'rotation=' + base('rotation') + ' 10ball=' + base('10ball'));
  ok('标准斯诺克 > 6 红球', base('snooker') > base('snooker6'), 'snooker=' + base('snooker') + ' snooker6=' + base('snooker6'));
  ok('6 红球 > 轮转（真斯诺克规则，比追分难）', base('snooker6') > base('rotation'), 'snooker6=' + base('snooker6') + ' rotation=' + base('rotation'));
}

section('量化表：六种模式都已登记，基准分与 MODE_BASE 一致');
{
  ok('MODE_KEYS 含 yigan', Array.isArray(MODE_KEYS.yigan));
  ok('六个模式都在', MODE_KEYS.yigan.length === 6, 'got=' + MODE_KEYS.yigan.length);
  for (const m of ['8ball', '9ball', '10ball', 'rotation', 'snooker', 'snooker6']) {
    ok('MODE_KEYS 含 ' + m, MODE_KEYS.yigan.includes(m));
    ok(m + ' 有基准分', baseOf('yigan', m) > 0, 'got=' + baseOf('yigan', m));
  }
  ok('SHORT_KEYS 有 yigan', SHORT_KEYS.yigan === 'yg', 'got=' + SHORT_KEYS.yigan);
}

section('MODES 元信息与量化表一致');
{
  ok('pool 的 MODES 有 6 项', MODES.length === 6, 'got=' + MODES.length);
  for (const m of MODES) {
    ok('MODES 里的 ' + m.value + ' 在量化表里', MODE_KEYS.yigan.includes(m.value));
    ok('MODES 里的 ' + m.value + ' 有中文名', !!m.label);
  }
}

section('移植防护：国外模型和自定义服务商不能回来');
{
  const src = readFileSync(join(root, 'src/tools/pool/game.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const d of ['api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com']) {
    ok('已删除国外域名 ' + d, !code.includes(d));
  }
  ok('没有 PROVIDERS.custom 定义', !/custom:\s*\{/.test(code));
  ok('没有 PROVIDERS.custom 引用', !code.includes('PROVIDERS.custom'));
  for (const p of ['deepseek', 'zhipu', 'qwen', 'volc', 'moonshot', 'step', 'mimo']) {
    ok('国内厂商仍在：' + p, code.includes(p));
  }
}

section('移植防护：备案拦截还在');
{
  const src = readFileSync(join(root, 'src/tools/pool/game.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok('FILED_DOMAINS 存在', code.includes('FILED_DOMAINS'));
  ok('isFiledUrl 存在', code.includes('function isFiledUrl'));
  ok('guardFiledUrl 存在', code.includes('function guardFiledUrl'));
  ok('备案提示文案正确', code.includes('小黑盒小程序不兼容无备案的域名，无法操作'));
}

section('移植防护：横屏与球杆轴向');
{
  const src = readFileSync(join(root, 'src/tools/pool/game.js'), 'utf8');
  ok('toAppPoint 存在', src.includes('function toAppPoint'));
  ok('layoutLandscape 存在', src.includes('function layoutLandscape'));
  const y = (src.match(/toAppPoint\(e\.clientX, e\.clientY\)\.y/g) || []).length;
  const x = (src.match(/toAppPoint\(e\.clientX, e\.clientY\)\.x/g) || []).length;
  ok('球杆/旋钮 4 处都用 .y 轴', y === 4 && x === 0, '.y=' + y + ' .x=' + x);
}

section('移植防护：不写本机存储');
{
  const src = readFileSync(join(root, 'src/tools/pool/game.js'), 'utf8');
  ok('没有 localStorage 调用', !/localStorage\.(get|set|remove)Item/.test(src));
  ok('设置交给宿主存', src.includes('__poolSavePrefs'));
  ok('回放不自动落盘', !/yigan_replay_archives_v1/.test(src));
}

section('1.4.22 新特性：自由球反复拖动 / 候选白球');
{
  const src = readFileSync(join(root, 'src/tools/pool/game.js'), 'utf8');
  ok('freeBallLocal 设置项存在', src.includes('freeBallLocal'));
  ok('freeBallDrag 状态存在', src.includes('freeBallDrag'));
  ok('ballInHandPlacements 存在', src.includes('function ballInHandPlacements'));
  ok('buildBallInHandCandidates 存在', src.includes('function buildBallInHandCandidates'));
  ok('对外暴露候选白球接口', src.includes('buildBallInHandCandidates, ballInHandPlacements'));
}

section('1.4.23 新特性：API 失败分级限制');
{
  const src = readFileSync(join(root, 'src/tools/pool/game.js'), 'utf8');
  ok('apiConnCount 存在', src.includes('function apiConnCount'));
  ok('apiRespCount 存在', src.includes('function apiRespCount'));
  ok('classifyApiFailure 存在', src.includes('function classifyApiFailure'));
  ok('recordApiFailure 存在', src.includes('function recordApiFailure'));
  ok('连接类上限是 3', /apiConnCount\(player\) >= 3/.test(src));
  ok('返回类上限是 15', /apiRespCount\(player\) >= 15/.test(src));
  ok('失败日志上限 20 条', src.includes('G.apiFailureLog[player].length > 20'));
  ok('newGame 初始化失败计数', src.includes('apiConnFailures: [0, 0]'));
  ok('换手时清零失败计数', src.includes('G.apiConnFailures[opp] = 0'));
  ok('fetch 抛错标记为 connection', src.includes("throw apiFailureError(msg, 'connection')"));
  ok('aiTakeShot 用 while 重试', /while \(apiConnCount\(G\.current\) < 3/.test(src));
  ok('重试前检查 token 防止串台', src.includes('if (token !== aiToken || !G) return;'));
}

section('1.4.24 新特性：本杆全部沙箱历史');
{
  const src = readFileSync(join(root, 'src/tools/pool/game.js'), 'utf8');
  ok('stateForModel 带 sandboxHistory', src.includes('sandboxHistory: feedback.map(compactFeedback)'));
  ok('compactFeedback 带 sandbox', src.includes('sandbox: entry.sandbox || null'));
  ok('提示语要求综合全部历史', src.includes('必须综合全部历史修正'));
  ok('SYSTEM_PROMPT 同步更新', src.includes('必须综合全部历史修正下一杆'));
  ok('版本号已到 1.4.24 以上', (() => {
    const m = src.match(/APP_VERSION = '([0-9.]+)'/);
    if (!m) return false;
    const p = m[1].split('.').map(Number);
    return p[0] > 1 || (p[0] === 1 && (p[1] > 4 || (p[1] === 4 && p[2] >= 24)));
  })());
}

section('1.4.25 新特性：固定步进 / 回合横幅 / 沙箱开关');
{
  const src = readFileSync(join(root, 'src/tools/pool/game.js'), 'utf8');
  ok('物理固定步进常量存在', src.includes('const PHYS_STEP = 1 / 120'));
  ok('物理累加器存在', src.includes('let PHYS_ACC = 0'));
  ok('updatePhysics 用累加器推进', src.includes('while (PHYS_ACC >= PHYS_STEP'));
  ok('步长不再按帧 dt 估', !src.includes('Math.ceil((maxV * dt) / (G.R * 0.45))'));
  ok('单帧步数有上限防卡死', src.includes('const maxSteps = 60'));
  ok('换局重置累加器', (src.match(/PHYS_ACC = 0;/g) || []).length >= 4);
  ok('回合横幅字段存在', src.includes('lastShownTurn'));
  ok('回合横幅会弹提示', src.includes('你的回合'));
  ok('沙箱总开关设置项存在', src.includes('sandboxEnabled: true'));
  ok('沙箱上限设置项存在', src.includes('sandboxLimit: null'));
  ok('aiThinkRounds 读总开关', src.includes('if (S.sandboxEnabled === false) return 0;'));
  ok('aiThinkRounds 读上限', src.includes('S.sandboxLimit !== null'));
  ok('设置面板有沙箱开关', readFileSync(join(root, 'src/tools/pool/mount.js'), 'utf8').includes('setSandboxEnabled'));
  ok('设置面板有推演上限输入', readFileSync(join(root, 'src/tools/pool/mount.js'), 'utf8').includes('setSandboxLimit'));
  ok('空输入框存成 null 不是 0', src.includes("raw === '' ? null : Number(raw)"));
}

console.log('\n' + (fail === 0 ? '全部通过：' : '存在失败：') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
