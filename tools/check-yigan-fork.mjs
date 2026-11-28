#!/usr/bin/env node
/**
 * 检查一杆清台的移植改动是否还在。
 *
 * 【为什么需要这个脚本】一杆清台来自上游独立仓库（dshproject-yigan-web）。
 *   以后拿上游新包体覆盖 src/tools/yigan/game.js 时，
 *   本次移植做的裁剪和适配会全部丢失 —— 而丢得静悄悄：
 *   代码能跑，只是 API 设置项和联机按钮又回来了（小程序里点了没反应），
 *   横屏旋转没了（球桌变回 200px 宽），点击也会偏 90°。
 *   这个脚本把每一条改动变成一条断言，跑一遍就知道有没有被覆盖。
 *
 * 用法：node tools/check-yigan-fork.mjs
 * 退出码 0 = 全部还在；1 = 有改动丢失（输出会指出是哪条）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const yiganDir = join(root, 'src/tools/yigan');
let pass = 0;
const fails = [];

function check(name, cond, hint) {
  if (cond) { pass++; return; }
  fails.push({ name, hint });
}

function read(p) {
  try { return readFileSync(p, 'utf8'); } catch (e) { return null; }
}

/* 剥掉注释，只留真实代码。移植说明里会提到被删的符号名，
 * 那是解释不是代码，不能算作「API 又回来了」。 */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const gamePath = join(yiganDir, 'game.js');
const screenPath = join(yiganDir, 'screen.js');
const cssPath = join(yiganDir, 'yigan.css');
const htmlPath = join(yiganDir, 'index.html');

const gameRaw = read(gamePath);
// 宿主页也要查：退出按钮和 __yiganOnExit 钩子都写在它身上
const screenRaw = read(join(root, 'src/tools/yigan/screen.js')) || '';
if (gameRaw === null) {
  console.error('找不到 ' + gamePath);
  process.exit(1);
}
const game = stripComments(gameRaw);
const screen = stripComments(read(screenPath) || '');
const css = read(cssPath) || '';
const html = read(htmlPath) || '';

/* ---------- 第一层：API 接入必须已被删除 ---------- */
const API_SYMBOLS = [
  'httpPost', 'httpGet', 'callLLM', 'askModel', 'parseModelChoice',
  'stateForModel', 'simulateShotInSandbox', 'askModelWithSandbox',
  'modelAngleCandidate', 'aiThinkRounds', 'testApiConnection',
  'fetchAvailableModels', 'populateProviders', 'renderModelOptions',
  'renderModelChips', 'providerDefaults', 'getAiProfile',
  'saveActiveAiProfile', 'deleteAiProfile', 'translateReplayText',
];
for (const sym of API_SYMBOLS) {
  check('API 已删除：' + sym, !game.includes(sym),
    '上游包体可能覆盖了 game.js，按 docs/yigan-fork.md 第二节重新裁剪');
}
check('不含 PROVIDERS 表', !game.includes('PROVIDERS'),
  'PROVIDERS 是 11 家大模型的服务商表，应整块删除');

/* ---------- 第二层：联机必须已被删除 ---------- */
const LAN_SYMBOLS = ['PeerJS', 'new Peer(', 'LAN_HOST', 'webLan', 'peerjs'];
for (const sym of LAN_SYMBOLS) {
  check('联机已删除：' + sym, !game.includes(sym),
    '联机代码应整块删除，本地双人/人机对战不受影响');
}
check('没有 peerjs.min.js 文件', !existsSync(join(yiganDir, 'peerjs.min.js')),
  '删掉这个 86KB 的信令库');
check('HTML 里没有 peerjs 引用', !html.includes('peerjs'),
  'index.html 的 <script src="peerjs.min.js"> 要删掉');

/* ---------- 第三层：小程序适配必须还在 ---------- */
check('启动钩子 __yiganBoot 还在', game.includes('__yiganBoot'),
  '导入即执行时 DOM 还没进，必须改成显式启动');
check('canvas 是延迟赋值', /let canvas = null/.test(game),
  '模块顶层取 #felt 会拿到 null，改成 boot() 里赋值');
check('横屏布局 layoutLandscape 还在', game.includes('layoutLandscape'),
  '球桌是横版，小程序只能竖屏，必须把 #ygApp 转 90°');
check('坐标转义 toAppPoint 还在', game.includes('toAppPoint'),
  '转了 90° 就必须转义指针坐标，否则点击整体偏 90°');
check('canvasPoint 用了 toAppPoint', /canvasPoint[\s\S]{0,300}toAppPoint/.test(game),
  '瞄准点的坐标必须过 toAppPoint');
check('resizeCanvas 用 clientWidth（不是 getBoundingClientRect）',
  /resizeCanvas[\s\S]{0,600}clientWidth/.test(game),
  'getBoundingClientRect 在旋转后宽高互换，球桌会算小一半');
check('结算回调 __yiganOnOver 还在', game.includes('__yiganOnOver'),
  '成绩要靠它交给 screen.js 记分、提交总分榜');

/* ---------- 第四层：CSS 必须已作用域化 ---------- */
check('CSS 根变量挂在 .yg-root 上', /\.yg-root\{[^}]*--bg/.test(css),
  '原版是 :root，会污染整个小程序外壳');
check('CSS 没有裸 :root 规则', !/(^|\n):root\s*\{/.test(css),
  ':root 会改到外壳的变量');
check('CSS 没有裸 body 规则', !/(^|\n)body\s*\{/.test(css),
  'body 规则会改到外壳的布局');
check('CSS 没有裸 * 规则', !/(^|\n)\*\s*\{/.test(css),
  '* 会重置外壳所有元素');
check('CSS 根容器是固定全屏', /\.yg-root\{[^}]*position:\s*fixed/.test(css),
  '不钉满视口会排在首页下面、被推到屏幕外');

/* ---------- 第五层：id 不能和外壳撞 ---------- */
check('模板根容器用 ygApp（不是 app）', /id=\\"ygApp\\"/.test(screen) || /id="ygApp"/.test(screen),
  '外壳根容器就是 #app，撞了会把球桌布局压成竖排');
check('模板里没有 id="app"', !/id=\\"app\\"/.test(screen) && !/id="app"/.test(screen),
  '同上，必须改成 ygApp');

/* ---------- 第六层：防护文档和警示头 ---------- */
check('docs/yigan-fork.md 存在', existsSync(join(root, 'docs/yigan-fork.md')),
  '移植说明丢了，下次更新就没依据');
check('game.js 顶部有 ⚠️ 警示', gameRaw.slice(0, 2000).includes('⚠️'),
  '警示头是给直接打开文件的人看的最后一道提醒');
check('警示里指向 yigan-fork.md', gameRaw.slice(0, 3000).includes('yigan-fork.md'),
  '要让人知道去哪看完整说明');

/* ---------- 第七层：小游戏版不存档、不碰 Android 原生桥 ---------- */
// 【为什么要这几条】用户明确要求「小游戏版不存档」。存档一旦偷偷回来，
//   玩家换设备就会发现自己在一个本该无痕的小游戏里留下了记录；
//   而 Android 桥在小程序里根本不存在，留着只会让新代码照着抄。
const codeOnly = gameRaw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
check('game.js 不调 localStorage', !/localStorage\.(get|set|remove)Item/.test(codeOnly),
  '小游戏版不存档，读写本地存储会破坏这个承诺');
check('game.js 不调 window.Android', !/window\.Android/.test(codeOnly),
  'Android 桥是小程序里不存在的对象，调了只会崩');
check('saveSettings 是空实现', /function saveSettings\(\)[\s\S]{0,400}?不存档/.test(gameRaw),
  '要留下「为什么不存」的说明，别让后人以为是漏写');
check('loadSettings 不读存档', !/function loadSettings\(\)[\s\S]{0,300}?readStorage/.test(gameRaw),
  '读存档和「不存档」是同一件事的两面');
check('回放只靠手动导出', !/yigan_replay_archives_v1/.test(gameRaw),
  '回放一局 2.47M，绝不能自动落盘');

/* ---------- 第八层：退出按钮 ---------- */
check('模板里有退出按钮', screenRaw.includes('btnExit'),
  '用户要求小游戏版支持退出，按钮放声音左边');
check('退出按钮在声音按钮之前', screenRaw.indexOf('btnExit') < screenRaw.indexOf('btnSound'),
  '用户要求「退出按钮放在声音按钮左边」');
check('game.js 绑定了退出按钮', codeOnly.includes("$('#btnExit')"),
  '按钮没绑事件就是个摆设');
check('退出走宿主钩子', gameRaw.includes('__yiganOnExit'),
  '小程序里 window.close() 关不掉宿主，必须回调 screen.js');

/* ---------- 输出 ---------- */
if (fails.length === 0) {
  console.log('一杆清台移植检查：全部通过（' + pass + ' 项）');
  process.exit(0);
}
console.log('一杆清台移植检查：' + pass + ' 通过 / ' + fails.length + ' 失败');
console.log('');
for (const f of fails) {
  console.log('  ✗ ' + f.name);
  if (f.hint) console.log('      → ' + f.hint);
}
console.log('');
console.log('详细做法见 docs/yigan-fork.md');
process.exit(1);