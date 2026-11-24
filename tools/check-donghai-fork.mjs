/**
 * 校验「东海龙珠」的本地改动是否还在。
 *
 * 【为什么需要这个脚本】东海龙珠是从外部源码包移植的，上游会持续发新版。
 *   每次搬上游改动，最危险的不是改错，而是**用新包整文件覆盖**——
 *   那样本地改动会静默消失：不报错、不崩溃，只是分数算错、
 *   大龙珠尺寸变回上游的、非法灯组又开始崩。
 *   这个脚本把每条本地改动钉成断言，覆盖了就会红。
 *
 * 用法：node tools/check-donghai-fork.mjs
 * 更新上游后必须先跑这个，再看 test-donghai.mjs。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; failures.push({ name, error: e.message }); console.log('  ✗ ' + name + '\n      ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function has(src, needle, what) {
  ok(src.includes(needle), '找不到：' + what + '\n      期望包含：' + needle);
}
function notHas(src, needle, what) {
  ok(!src.includes(needle), '不该出现却被覆盖回来了：' + what + '\n      不该包含：' + needle);
}
/**
 * 剥掉注释，只留代码。
 *
 * 【为什么需要】注释里常常写着"上游写的是 Math.cbrt(0.7 * 0.85)"这种
 *   说明性文字。如果断言连注释一起查，就会把"解释上游写法"误判成
 *   "上游写法又回来了"，每次改注释都要改断言。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

const game = read('src/tools/donghai/game.js');
const scoring = read('src/tools/donghai/scoring.js');
const screen = read('src/tools/donghai/screen.js');
const scores = read('src/core/scores.js');
const app = read('src/ui/app.js');
const quantize = read('src/core/quantize.js');
const stats = read('src/tools/donghai/stats.js');

console.log('=== 1. 大龙珠尺寸：线性缩小 15%（不是上游的体积 0.85）===');
check('BIG_SIZE 用线性 0.85', () => {
  has(game, 'const BIG_SIZE = Math.cbrt(0.7) * 0.85;', 'BIG_SIZE 线性缩小');
  notHas(stripComments(game), 'Math.cbrt(0.7 * 0.85)', '上游的体积式缩小（只小 5.27%）');
});
check('实际半径约 0.2838', () => {
  const m = game.match(/const BIG_SIZE = Math\.cbrt\(0\.7\) \* ([\d.]+)/);
  ok(m, 'BIG_SIZE 定义格式变了，请检查');
  const r = 0.376 * Math.cbrt(0.7) * Number(m[1]);
  ok(Math.abs(r - 0.2838) < 0.002, '半径算出来是 ' + r.toFixed(4) + '，期望约 0.2838');
});

console.log('\n=== 2. 大龙珠质量跟着体积缩放 ===');
check('BODY_M.bigDragon 乘了 BIG_VOL', () => {
  has(game, 'BIG_VOL', '体积系数常量');
  has(game, 'bigDragon: 4.224 * BIG_VOL', '质量按体积缩放');
  notHas(game, 'bigDragon: 4.224 }', '上游写死的质量');
});
check('BIG_VOL 等于 0.85³', () => {
  has(game, 'const BIG_VOL = 0.85 * 0.85 * 0.85', '体积系数定义');
});

console.log('\n=== 3. 龙珠入盘初速显式 ×3 ===');
check('有 DRAGON_SPEED_MUL = 3', () => {
  has(game, 'DRAGON_SPEED_MUL = 3', '显式倍数');
  has(game, 'PEARL_SPEED * DRAGON_SPEED_MUL', '用在龙珠速度上');
});
check('不再写死 3.45（注释里提到历史可以，代码里不行）', () => {
  // 只在注释里出现是允许的（说明"原实现写死 3.45"），
  // 但代码里不能还有裸的 3.45 当速度用。
  notHas(stripComments(game), '3.45', '上游写死的龙珠速度');
});

console.log('\n=== 4. 非法灯组保护 ===');
check('firstUnlit 挡掉非法 row', () => {
  has(game, 'const arr = state.lamps[row];', 'firstUnlit 取值');
  has(game, 'if (!arr) return -1;', 'firstUnlit 保护');
});
check('selectRow 挡掉非法 row', () => {
  const body = game.slice(game.indexOf('function selectRow'));
  const head = body.slice(0, body.indexOf('\n}'));
  ok(head.includes('if (!state.lamps[row]) return;'), 'selectRow 没有挡掉非法灯组');
});
check('cycleTarget 挡掉非法 row', () => {
  const body = game.slice(game.indexOf('function cycleTarget'));
  const head = body.slice(0, body.indexOf('\n}'));
  ok(head.includes('if (!state.lamps[row]) return;'), 'cycleTarget 没有挡掉非法灯组');
});

console.log('\n=== 5. 计分基准 45/8（不是上游没有、也不是最初的 12）===');
check('scoring.js 基准是 45/8', () => {
  has(scoring, 'BASE_TICKETS_PER_COIN = 45 / 8', '基准常量');
});
check('core/quantize.js 基准是 45/8', () => {
  has(quantize, "'donghai:classic': 45 / 8", 'core 里的基准');
});
check('两处基准数值一致', () => {
  const a = scoring.match(/BASE_TICKETS_PER_COIN = ([\d\s/*.]+);/);
  const b = quantize.match(/'donghai:classic': ([\d\s/*.]+),/);
  ok(a && b, '基准定义格式变了');
  const evalNum = (s) => s.split(/[*/]/).map(Number).reduce((acc, n, i) => i === 0 ? n : acc / n);
  ok(Math.abs(evalNum(a[1]) - evalNum(b[1])) < 1e-12, '两处基准不一致');
});

console.log('\n=== 6. 挑战系统与结算（上游完全没有）===');
check('每日 3 次 / 四档限额', () => {
  has(scoring, 'DAILY_ATTEMPTS = 3', '每日次数');
  has(scoring, 'CHALLENGE_LIMITS = Object.freeze([50, 80, 100, 120])', '四档限额');
});
check('周榜编码周次在高位', () => {
  has(scoring, 'WEEK_ENCODE_BASE = 10000', '编码基数');
  has(scoring, 'export function encodeWeekly', '编码函数');
  has(scoring, 'export function decodeWeekly', '解码函数');
});
check('结算流程还在', () => {
  // 这几个函数是底部统一 export 的，不是行内 export
  has(game, 'async function doSettle(', '结算');
  has(game, 'function resetRound(', '重开一局');
  has(game, 'export { mount, unmount, API, state,', '导出语句');
  ok(game.includes('doSettle, resetRound'), 'doSettle / resetRound 没在导出列表里');
});
check('周榜会提交到云端', () => {
  has(stats, 'export async function submitWeeklyBoard', '提交函数');
  has(stats, 'export async function fetchWeeklyBoard', '读取函数');
});

console.log('\n=== 7. 上游 v1.2.7 的行为要跟着上游（别被我误改）===');
check('奖励珠出生点用 pusher.retreat', () => {
  has(game, 'L.pusher.retreat + BODY_R.pearl', '珍珠出生点');
  has(game, 'L.pusher.retreat + BODY_R.dragon', '龙珠出生点');
  has(game, 'L.pusher.retreat + BODY_R.bigDragon', '大龙珠出生点');
});
check('奖励龙珠两轴都 ×3', () => {
  has(game, 'vx: -0.25 * 3, vz: rr(0.06, 0.18) * 3', 'vx/vz 都放大');
});

console.log('\n=== 8. 移植必需的结构 ===');
check('没有残留的 window.game 赋值', () => {
  notHas(game, 'window.game =', '上游的全局挂载');
});
check('没有残留的裸 $ 定义', () => {
  notHas(game, "const $ = (id) => document.getElementById", '上游的全局查询');
});
check('导出 mount / unmount', () => {
  has(game, 'function mount(root)', 'mount 定义');
  has(game, 'function unmount()', 'unmount 定义');
  ok(game.includes('export { mount, unmount'), 'mount/unmount 没在导出列表里');
});

console.log('\n=== 9. 界面回归（这两个 bug 都上过线）===');
check('看板娘图片走 Vite 导入，不是写死相对路径', () => {
  // 【为什么】写 "./mascot.png" 会相对当前页面解析，图片在子目录 → 404，
  //   浏览器把 <img> 的 alt 文字"看板娘"显示出来，界面看着像坏了。
  const screen = read('src/tools/donghai/screen.js');
  has(screen, "from './mascot.png?url'", '看板娘用 ?url 导入');
  notHas(screen, 'src=\"__MASCOT__\"', '占位符应已被替换（检查模板是否还原）');
  ok(screen.includes("TEMPLATE.replace('__MASCOT__', mascotUrl)"), '没有把 mascotUrl 注入模板');
  ok(fs.existsSync(path.join(root, 'src/tools/donghai/mascot.png')), 'mascot.png 不在 src 下');
  ok(!fs.existsSync(path.join(root, 'public/donghai/mascot.png')), 'mascot.png 不该留在 public（不参与路径处理）');
});
check('开始界面有「参加周榜」且能打开面板', () => {
  const screen = read('src/tools/donghai/screen.js');
  has(screen, 'joinWeekly', '参加周榜按钮的 id');
  has(screen, 'async function openChallenge', '强制打开函数');
  has(screen, "joinBtn.addEventListener('click'", '按钮绑定了事件');
});
check('周榜面板能关掉（点遮罩或点 ×）', () => {
  const screen = read('src/tools/donghai/screen.js');
  has(screen, "e.target === panel", '点遮罩关闭');
  has(screen, 'dhc-close', '显式关闭键');
});
check('珠子画得够大且有拖尾', () => {
  // 【为什么】原来 4.4px，390px 屏上是个小点，整段下落只有 0.3 秒，
  //   玩家看到"闪一下没了"会以为卡住。
  ok(/const rad = 6\.2;/.test(game), '珠子半径应放大到 6.2');
  has(game, '拖尾', '拖尾注释');
});

console.log('\n=== 10. 卡死防护（线上真实出现过）===');
check('frame 循环用 try/finally 兜住异常', () => {
  // 【为什么必须有】requestAnimationFrame 注册在 frame() 末尾。
  //   中间任何一处抛异常，这一帧中断、末尾注册不执行 → 循环永久停止，
  //   机台画面冻住、点发射没反应，就是玩家说的"卡死"。
  const body = game.slice(game.indexOf('function frame(now)'));
  const fn = body.slice(0, body.indexOf('\n}'));
  ok(fn.includes('} catch (err) {'), 'frame 里没有 catch，异常会杀死循环');
  ok(fn.includes('} finally {'), 'frame 里没有 finally，异常时不会注册下一帧');
  const tail = fn.slice(fn.lastIndexOf('finally'));
  ok(tail.includes('requestAnimationFrame(frame)'), 'finally 里必须注册下一帧');
});
check('UI 不与小程序外壳的返回/设置键重叠', () => {
  const css = read('src/tools/donghai/donghai.css');
  // 外壳的 ‹ ⚙ 贴在 right:0，topbar 必须给它让位
  ok(/#topbar\{[^}]*padding:[^;]*96px/.test(css), 'topbar 右侧没给外壳按钮留位置（会重叠 66x27）');
  // 奖杯按钮原来压住「得票」卡片和「盘面龙珠」
  ok(/\.dh-challenge-btn\{position:absolute;top:calc\(136px/.test(css), '奖杯按钮位置不对，会压住「得票」或「盘面龙珠」');
});

console.log('\n=== 11. 参赛开关与外壳层级 ===');
check('不参赛不计榜（普通开始必须无上限）', () => {
  const screen = read('src/tools/donghai/screen.js');
  has(screen, 'let joined = false', '参赛开关');
  has(screen, 'setCoinLimit(joined ? todayLimit() : 0)', '普通游玩必须无上限');
  has(screen, 'if (!joined)', '结算要按参赛状态分流');
  has(screen, "成绩已计入综合总分。参加周榜才会进排行榜", '未参赛的提示');
});
check('外壳返回/设置键永远点得到', () => {
  // 【为什么】实测开始界面(50)和挑战面板(92)会把外壳 HUD 完全盖住，
  //   玩家进了推币机就出不去。HUD 必须是最高的那一层。
  const css = read('src/tools/donghai/donghai.css');
  const m = css.match(/\.dh-hud\{position:absolute;top:0;right:0;z-index:(\d+)/);
  ok(m, '找不到 .dh-hud 的 z-index');
  const z = Number(m[1]);
  const start = Number((css.match(/#startScreen\{position:absolute;inset:0;z-index:(\d+)/)||[])[1]);
  const panel = Number((css.match(/\.dh-challenge\{position:absolute;inset:0;z-index:(\d+)/)||[])[1]);
  ok(z > start, '外壳 HUD(' + z + ') 被开始界面(' + start + ') 盖住');
  ok(z > panel, '外壳 HUD(' + z + ') 被周榜面板(' + panel + ') 盖住');
});

console.log('\n=== 12. 退出 / 重进 / 进度接续（1.3.9 修的一串真实 bug）===');
check('退出条件不能写反（写反了 unmount 不执行，重进时开始界面不出现）', () => {
  const screen = read('src/tools/donghai/screen.js');
  // donghaiBack 的语义是「这次返回被我消费掉了」，返回 true 才不退出。
  has(screen, 'if (donghaiBack && donghaiBack()) return;', '退出条件用 donghaiBack() 为真才拦截');
  notHas(screen, 'if (donghaiBack && !donghaiBack()) return;', '没有写反的退出条件');
});
check('unmount 把模块级 state 清干净', () => {
  const game = read('src/tools/donghai/game.js');
  // 【为什么】state 是模块级的，不清的话重进时 started 还是 true，
  //   开始界面永远不出现，玩家直接落在半局的机台上。
  has(game, 'state.started = false;', 'unmount 清掉 started');
  has(game, 'state.coinsSpent = 0;', 'unmount 清掉已用币');
  has(game, 'coinLimit = 0;', 'unmount 清掉限额');
});
check('不依赖 mount() 的返回值', () => {
  const screen = read('src/tools/donghai/screen.js');
  // mount() 没有返回值，写成 api = mount(root) 会让 api 永远是 undefined
  // 【为什么要先剥注释】上面那段解释里就写着 api = mount(root)，
  //   不剥的话会把"解释这个 bug"误判成"这个 bug 还在"。
  notHas(stripComments(screen), 'api = mount(root)', '不依赖 mount() 的返回值');
  has(screen, 'mounted = true;', '用 mounted 标记机台已挂载');
});
check('挑战局进度落盘并能接上（save_42）', () => {
  const save = read('src/core/save.js');
  const stats = read('src/tools/donghai/stats.js');
  const screen = read('src/tools/donghai/screen.js');
  const game = read('src/tools/donghai/game.js');
  has(save, "'donghai.run': { start: 42", '挑战进度单独占 save_42');
  has(stats, 'export async function saveRunState', '有 saveRunState');
  has(stats, 'export async function loadRunState', '有 loadRunState');
  has(screen, 'loadRunState().then', '进挑战局时读回进度');
  has(game, 'function restoreCoins', '有 restoreCoins 恢复已消耗额度');
});
check('八段管：挑战局显示剩余弹珠数', () => {
  const game = read('src/tools/donghai/game.js');
  has(game, "return coinLimit > 0 ? '剩余弹珠' : '已用币';", '标签随模式切换');
  has(game, 'if (coinLimit > 0) return Math.max(0, coinLimit - state.coinsSpent);', '显示剩余弹珠数');
  // 【为什么要断言这个】八段管画在 canvas 里，上方压着两层 DOM（已用币卡片、
  //   颜色行）。写死 gy + 8 会被这两层盖住，只露出一点红字。
  has(game, 'hudSafeTop()', '八段管位置要避开 HUD 卡片');
  has(game, "'#colorRow'", '要同时避开颜色行');
});
check('首页有返回键，且能真正退出', () => {
  const screen = read('src/tools/donghai/screen.js');
  const css = read('src/tools/donghai/donghai.css');
  has(screen, 'startBack', '首页要有返回键');
  has(screen, 'exit(true)', '首页返回键要走强制退出（donghaiBack 会拦）');
  has(css, '.dh-root .start-back{position:absolute;top:calc(10px + var(--safe-t));left:12px', '返回键在左上角，避开右上角胶囊');
});

check('两组 3 位七段管必须在同一水平线', () => {
  const game = read('src/tools/donghai/game.js');
  // 【为什么断言这个】两组管一个避让 HUD、一个写死 gy+8，就会错开一格，
  //   看着就是没对齐的坏 UI。必须共用同一个 tubeY。
  has(game, 'const tubeY = Math.max(gy + 8, hudSafeTop()', '两组管共用同一个 Y');
  const left = /drawTube3\(gx \+ 2, tubeY,/.test(game);
  const right = /drawTube3\(gx \+ gw - 2 - \(18 \* 3 \+ 4\), tubeY,/.test(game);
  ok(left && right, '左右两组管必须都用 tubeY，不能一组写死 gy + 8');
});

check('周榜云榜：拉取量要够、要能标出自己、要说明来源', () => {
  const stats = read('src/tools/donghai/stats.js');
  const screen = read('src/tools/donghai/screen.js');
  const lb = read('src/sdk/leaderboard.js');
  // 【为什么断言这个】云榜是最高分永久保留，历史周编码值更大、会长期占前排。
  //   只拉 50 条时本周成绩可能一条都进不去，过滤完就是空榜。
  has(stats, 'CLOUD_FETCH_LIMIT = 200', '云端要一次拉 200 条，不能只拉 50');
  has(stats, 'entries.slice(0, limit)', '过滤本周后再截前 N 名');
  // getList 的 self 恒为 false，平台不告诉哪条是你，只能单独查。
  has(lb, 'getCurrentUserEntry', '用 getCurrentUserEntry 标出自己');
  has(screen, "board.source !== 'cloud'", '要标出是不是本机榜');
});
check('重开要清盘（否则盘面越叠越多）', () => {
  // seedTable 必须先把数组清空再铺，否则每次 mount 都多铺一套珠子
  has(game, 'state.tableBalls.length = 0;', 'seedTable 要清空盘面珠子');
  has(game, 'state.discBalls.length = 0;', 'seedTable 要清空转盘球');
  has(game, 'state.discSliders.length = 0;', 'seedTable 要清空转盘滑片');
  // startGame 必须在 started 之前把盘面准备好
  const startIdx = game.indexOf('function startGame(');
  const body = game.slice(startIdx, startIdx + 2200);
  has(body, 'seedTable()', 'startGame 要重新铺盘');
  has(body, 'initDiscHoles(true)', 'startGame 要强制重建转盘孔位');
});

check('转盘孔位要能强制重建（否则残留球重复计分）', () => {
  // 原来是 if (state.discHoles.length) return; 且全项目没有清空点，
  // 重开后 hole.occupied / hole.ball 还持有上一局的旧引用
  has(game, 'function initDiscHoles(force)', 'initDiscHoles 要接受 force 参数');
  has(game, 'if (state.discHoles.length && !force) return;', 'force 为真时要重建');
  const forced = (game.match(/initDiscHoles\(true\)/g) || []).length;
  if (forced < 3) throw new Error('三处重置点都要传 true，实际 ' + forced + ' 处');
  // resize 里不能传 true：改窗口大小不该重建孔位状态
  const resizeIdx = game.indexOf('function resize(');
  const resizeBody = game.slice(resizeIdx, resizeIdx + 900);
  if (/initDiscHoles\(true\)/.test(resizeBody)) throw new Error('resize 里不能强制重建孔位');
});

check('推币机的分要真的进综合总分榜', () => {
  // 三个条件缺一不可，缺任何一个都会静默失效（值恒为 0，不报错）
  has(scores, "donghai: 'dh'", 'scores.js 的 SHORT 要有 donghai，否则键名和 quantize 对不上');
  has(screen, "recordBest('donghai', 'classic'", '结算要写最高分');
  has(screen, 'submitTotalScore(', '结算要提交综合总分');
  // 必须在参赛校验之前：总分和参不参加周榜无关
  const bestIdx = screen.indexOf("recordBest('donghai'");
  // 必须从 recordBest 之后再找 !joined —— 前面还有一个同名判断属于别的逻辑
  const joinIdx = screen.indexOf('if (!joined)', bestIdx);
  if (bestIdx < 0) throw new Error('找不到 recordBest');
  if (joinIdx < 0) throw new Error('recordBest 之后找不到 !joined 校验');
  if (bestIdx > joinIdx) throw new Error('recordBest 必须在 !joined 校验之前，否则非参赛局成绩会被丢掉');
});

check('结算要算上没吐完的票', () => {
  // 出票器每秒 11.7 张，派对一次中奖 170~280 张，必然有积压
  has(game, 'state.tickets + Math.max(0, state.ticketsRemaining)', '结算要按已吐+未吐计算');
});

check('投币太少不能上榜（分母小会让比值爆炸）', () => {
  has(scoring, 'MIN_COINS_FOR_RANK', '要有最低投币门槛');
  const m = scoring.match(/MIN_COINS_FOR_RANK = (\d+)/);
  if (!m) throw new Error('门槛必须是字面量数字');
  if (Number(m[1]) !== 20) throw new Error('用户定的是 20 币，实际 ' + m[1]);
  has(screen, 'result.coins < MIN_COINS_FOR_RANK', '结算要按门槛拦截');
});

check('启动要补传综合总分（榜单重建后靠它恢复）', () => {
  has(app, 'syncTotalOnStartup', '启动要有补传入口');
  has(app, 'submitTotalScore({ extra: {}, modded: false })', '补传要真的提交');
});

check('挡住重复打开（会叠出两套机台）', () => {
  const screen = read('src/tools/donghai/screen.js');
  has(screen, "const existing = document.querySelector('.dh-root');", '挡住重复打开');
});
console.log('\n' + '='.repeat(46));
if (fail) {
  console.log('失败 ' + fail + ' 项：');
  for (const f of failures) console.log('  · ' + f.name);
  console.log('\n【注意】有本地改动被覆盖了。看 docs/donghai-fork.md 逐条恢复。');
  process.exit(1);
}
console.log('本地改动全部在位：' + pass + ' 项通过 / 0 失败');
