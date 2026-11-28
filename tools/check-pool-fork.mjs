#!/usr/bin/env node
/**
 * 检查一杆清台（完整版）的移植改动是否还在。
 *
 * 【为什么需要这个脚本】完整版来自上游独立仓库（dshproject-yigan-web）。
 *   以后拿上游新包体覆盖 src/tools/pool/game.js 时，本次移植做的裁剪和适配
 *   会全部丢失 —— 而且丢得静悄悄：代码照样能跑，只是
 *   - 国外模型和自定义域名又回来了（小程序连不上，用户配完才发现用不了）
 *   - 备案拦截没了（用户看到的是超时，不是那句说清楚原因的话）
 *   - 横屏旋转没了（球桌缩成一条，点击偏 90°）
 *   - 存档又开始写 localStorage（用户明确要求「小游戏版不存档」）
 *   这个脚本把每一条改动变成一条断言，跑一遍就知道有没有被覆盖。
 *
 * 用法：node tools/check-pool-fork.mjs
 * 退出码 0 = 全部还在；1 = 有改动丢失（输出会指出是哪条）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const poolDir = join(root, 'src/tools/pool');
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

const gamePath = join(poolDir, 'game.js');
const mountPath = join(poolDir, 'mount.js');
const bootPath = join(root, 'src/boot-pool.js');
const cssPath = join(poolDir, 'pool.css');

const gameRaw = read(gamePath);
if (gameRaw === null) {
  console.error('找不到 ' + gamePath);
  process.exit(1);
}
const game = stripComments(gameRaw);
const mount = stripComments(read(mountPath) || '');
const boot = stripComments(read(bootPath) || '');
const css = read(cssPath) || '';

/* ---------- 第一层：国外模型必须已删除 ---------- */
const FOREIGN = [
  'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com',
  'api.groq.com', 'api.mistral.ai', 'api.cohere.ai', 'api.together.xyz',
];
for (const d of FOREIGN) {
  check('国外域名已删除：' + d, !game.includes(d),
    'PROVIDERS 里又出现了国外服务商。小程序只能访问已备案域名，境外 API 连不上，' +
    '留着只会让用户配完才发现用不了。删掉这一项。');
}

/* ---------- 第二层：自定义服务商必须已删除 ---------- */
check('PROVIDERS.custom 已删除', !/custom:\s*\{/.test(game),
  '自定义服务商又回来了。自定义域名不可能备案，等于给用户挖坑。');
check('没有 PROVIDERS.custom 引用', !game.includes('PROVIDERS.custom'),
  '有代码在引用 PROVIDERS.custom，改成 PROVIDERS.deepseek。');

/* ---------- 第三层：国内厂商清单 ---------- */
const DOMESTIC = ['deepseek', 'zhipu', 'qwen', 'volc', 'moonshot', 'step', 'mimo'];
for (const p of DOMESTIC) {
  check('国内厂商仍在：' + p, game.includes(p),
    'PROVIDERS 里少了 ' + p + '，被上游覆盖时可能连带删掉了国内厂商。');
}

/* ---------- 第四层：备案拦截必须还在 ---------- */
check('FILED_DOMAINS 存在', game.includes('FILED_DOMAINS'),
  '备案域名清单被删了，guardFiledUrl 会失去依据。');
check('isFiledUrl 存在', game.includes('function isFiledUrl'),
  'isFiledUrl 被删了，备案判断失效。');
check('guardFiledUrl 存在', game.includes('function guardFiledUrl'),
  'guardFiledUrl 被删了，未备案域名不会被拦。');
check('httpPost 挂了备案拦截', /guardFiledUrl\(url\)/.test(game),
  'httpPost/httpGet 入口的 guardFiledUrl 被摘掉了，未备案请求会直接发出去然后超时。');
check('备案提示文案正确',
  game.includes('小黑盒小程序不兼容无备案的域名，无法操作'),
  '这是用户指定的提示文案，不要改。');

/* ---------- 第五层：横屏适配必须还在 ---------- */
check('toAppPoint 存在', game.includes('function toAppPoint'),
  '触摸坐标反向映射没了，旋转后点击会偏 90°。');
check('layoutLandscape 存在', game.includes('function layoutLandscape'),
  '横屏布局没了，球桌会缩成竖屏尺寸。');
check('canvas 用 clientWidth 量尺寸',
  /clientWidth/.test(game) && !/getBoundingClientRect\(\)\s*\.width/.test(game),
  '又用 getBoundingClientRect() 量尺寸了。旋转容器的外接矩形宽高是反的，要用 clientWidth/clientHeight。');

/* 【球杆轴向】这是用户实际报过的 bug：必须垂直于球杆滑动才有反应。
 * 旋转后球杆轨道在屏幕上呈横向，蓄力轴必须用 toAppPoint().y。 */
const cueY = (game.match(/toAppPoint\(e\.clientX, e\.clientY\)\.y/g) || []).length;
const cueX = (game.match(/toAppPoint\(e\.clientX, e\.clientY\)\.x/g) || []).length;
check('球杆/旋钮用 .y 轴（4 处）', cueY === 4 && cueX === 0,
  '当前 .y=' + cueY + ' 处、.x=' + cueX + ' 处。必须全部是 .y —— 用 .x 会让用户' +
  '觉得「必须往屏幕右侧（竖屏下方）拖才有反应」。');

/* ---------- 第六层：启动时机 ---------- */
check('canvas 懒加载', /let canvas = null/.test(game),
  'canvas 又变回模块顶层取 #felt 了，导入那一刻 DOM 还没建好，会抛 null.getContext。');
/* ---------- 第六层之二：启动链路 ---------- */
// 【为什么查这三条】1.4.46-1 线上报「启动失败 failed to fetch dynamically
//   imported module」，两个独立原因叠在一起：
//   1) boot-pool.js 的动态 import 加了 /* @vite-ignore */，Vite 原样保留路径，
//      dist/assets 下没有 tools/pool/mount.js，运行时 404；
//   2) 修 1) 时误删了 const handle = mountPool(root)，handle 未定义，
//      bootPool 抛 ReferenceError，被 .catch 吞成一句「启动失败」文案。
check('动态 import 未加 @vite-ignore', !boot.includes('@vite-ignore'),
  '加了 @vite-ignore 后 Vite 不打包 mount.js，线上必然 404。');
check('动态 import 指向 mount.js', /import\('\.\/tools\/pool\/mount\.js'\)/.test(boot),
  'boot-pool.js 里找不到对 mount.js 的动态 import，挂载器不会被加载。');
check('bootPool 调用了 mountPool', /const\s+handle\s*=\s*mountPool\(root\)/.test(boot),
  '缺了 const handle = mountPool(root)，handle 未定义会抛 ReferenceError。');
check('__poolBoot 存在', game.includes('__poolBoot'),
  '显式启动钩子没了，game.js 不会 boot。');

/* ---------- 第七层：必须保留的功能 ---------- */
check('gameSnapshot 保留', game.includes('function gameSnapshot'),
  'gameSnapshot 又被连带删了（它夹在联机代码块里，删块时容易一起没）。回放要用它。');
check('无 LAN 定义', !game.includes('const LAN = {'),
  '联机代码又回来了。小程序里没有 WebRTC 信令，留着只是死代码。');
check('观战模式提示保留', game.includes('观战模式'),
  '两个 AI 对打时的提示没了，用户会以为卡死。');

/* ---------- 第八层：存档策略（用户明确要求） ---------- */
check('无 localStorage 实际调用', !/localStorage\.(get|set|remove)Item/.test(game),
  '又有代码在写 localStorage。用户要求「小游戏版不存档」，完整版也只走云端 1 个 value。');
check('设置交给宿主存', game.includes('__poolSavePrefs'),
  'saveSettings 又直接写存储了。应该只把 JSON 丢给宿主，由 screen.js 防抖写云端。');
check('回放不自动落盘', !/yigan_replay_archives_v1/.test(game),
  '回放又往持久化里写了。一局 2.47MB 远超 16KB 上限，必须只活在内存 + 手动导出。');
check('加密存档保留', game.includes('encryptReplayText') && game.includes('decryptReplayText'),
  '加密/解密函数没了，保存加密存档和导入会失效。');
check('紧凑存档保留', game.includes('compactReplay') && game.includes('expandCompactReplay'),
  '关键帧压缩没了，存档会大很多。');

/* ---------- 第九层：宿主层（无外壳，直接挂载） ---------- */
// 【为什么不再有 screen.js】用户要求「一杆清台完整小程序版不需要退出按钮，
//   不需要小游戏界面 ui，基本从 apk 版本构建」。原来那层浮窗外壳整个删掉了，
//   现在 boot-pool.js 直接把 APK 的 HTML 挂到 #app 上，进小程序就是球桌。
check('mount.js 存在', read(mountPath) !== null,
  'mount.js 没了，模板没地方放，整个页面会空白。');
check('boot-pool.js 存在', read(bootPath) !== null,
  'boot-pool.js 没了，main.js 的动态导入会 404。');
check('main.js 按变体分流', /IS_POOL/.test(read(join(root, 'src/main.js')) || ''),
  'main.js 不再按 IS_POOL 分流，完整版会去加载小游戏外壳。');
check('mount.js 读云端设置', mount.includes('readScope'),
  '不再读云端设置，用户存的 API Key 每次进来都会丢。');
check('mount.js 写云端设置', mount.includes('writeScope'),
  '不再写云端设置，改了设置下次进来就没了。');
check('mount.js 用 pool 域', mount.includes("'pool'"),
  '存档域不是 pool，会写到别的域去（串档）。');
check('mount.js 防抖', /PREFS_SAVE_DEBOUNCE/.test(mount),
  '防抖没了。saveSettings 是高频调用，不合并会撞限流。');
check('mount.js 挂 __poolBoot', mount.includes('__poolBoot'),
  '启动钩子没挂上，模板插进 DOM 后游戏不会 boot。');

/* ---------- 第十层：CSS 作用域 ---------- */
check('CSS 全部限定在 .pool-root 下',
  !/(^|\})\s*(html|body|\.app|#app)\s*\{/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')),
  'CSS 里出现了未限定作用域的 html/body/.app 规则，会污染小程序外壳。');
// 【为什么要专门查类名】src/styles.css 有一份全局 .switch{width:48px;height:28px;
//   border-radius:999px}，是给「整个胶囊」用的。设置页里的 .switch 是包住图标+
//   文字的 label，撞上之后被压成 48px 的胶囊，文字竖排、开关互相重叠。
//   1.4.25 起改名 .sw 避开；如果哪天又改回 .switch，这个断言会立刻报出来。
check('设置页开关用 .sw 不用 .switch', css.includes('.pool-root .sw{') && !/\.pool-root \.switch\{/.test(css),
  '又用回 .switch 了，会和 styles.css 的全局胶囊样式撞，文字会错位。');
check('开关容器不继承 .field 的竖排', /\.pool-root \.sws\{[^}]*flex-direction:row/.test(css),
  '没写 flex-direction:row，.field 的 column 会让开关竖着排。');
check('模板里开关是 .sw', mount.includes('class=\\"sw\\"'),
  '模板又用了 class="switch"，CSS 里的 .sw 规则就不会生效。');
check('CSS 没有 id=app', !/#app\s*\{/.test(css),
  'CSS 里还有 #app，会和外壳的 #app 撞。');

/* ---------- 第十一层：没有退出按钮（用户明确要求） ---------- */
// 【为什么反过来检查】1.4.19 之前这里要求「退出按钮放在声音按钮左边」，
//   那是小游戏版的要求。完整版用户后来说清楚了：
//   「一杆清台完整小程序版不需要退出按钮，不需要小游戏界面 ui」。
//   所以现在要确认它真的没有 —— 否则以后有人照旧文档加回去，
//   界面上会多一个点了没处可去的按钮（小程序关不掉宿主）。
check('模板里没有退出按钮', !mount.includes('btnExit'),
  '退出按钮又回来了。用户要求完整版不要退出按钮：小程序没有 API 能关掉宿主，留着只会误导。');
check('模板里没有退出菜单项', !mount.includes('menuExit'),
  '菜单里的「退出游戏」又回来了，同上。');
check('game.js 不再绑定退出按钮', !game.includes("$('#btnExit')"),
  '又在绑定一个不存在的按钮，boot 时会抛 null.addEventListener。');
check('game.js 不再挂 __poolOnExit', !game.includes('window.__poolOnExit'),
  '还在挂退出钩子，说明退出路径没清干净。');
check('模板里没有局域网入口', !mount.includes('menuLan'),
  '联机代码已整块删除，这个按钮点了没反应，会让人以为坏了。');
check('没有外壳样式', !mount.includes('hb-shell') && !css.includes('.hb-shell'),
  '外壳样式又回来了，会盖住球桌。');
check('横屏在首帧就生效', /layoutLandscape\(\)/.test(game) && game.indexOf('layoutLandscape()') < game.indexOf('resizeCanvas()'),
  '横屏没在 resizeCanvas 之前跑，第一帧会是竖屏，用户会看到闪一下。');

/* ---------- 第十二层：版本号规则 ---------- */
// 【规则】用户要求「版本号按照 {对标 apk 版本号}-{该版本对标下发布的小版本命名}」。
//   第一段必须等于 game.js 里合并到的上游 APK 版本，第二段才是本项目自己的迭代号。
//   写成固定 1.4.19-* 就看不出对标哪个包，排查问题要翻文档。
{
  const pkg = JSON.parse(read(join(root, 'package.pool.json')) || '{}');
  const m = (game.match(/APP_VERSION = '([0-9.]+)'/) || [])[1];
  const v = pkg.version || '';
  check('版本号是 SemVer prerelease 形式', /^\d+\.\d+\.\d+-\d+$/.test(v),
    'package.pool.json 的 version 不是 x.y.z-n 形式，hb-sdk 会拒。当前：' + v);
  check('版本号第一段等于对标 APK 版本', v.split('-')[0] === m,
    '版本号第一段应该等于 game.js 的 APP_VERSION（对标 APK 版本）。' +
    '当前版本号 ' + v + '，APP_VERSION ' + m + '。改完上游要同步改两处。');
}

/* ---------- 输出 ---------- */
if (fails.length) {
  console.error('');
  console.error('一杆清台（完整版）移植检查：' + fails.length + ' 项丢失');
  console.error('');
  for (const f of fails) {
    console.error('  ✗ ' + f.name);
    if (f.hint) console.error('      ' + f.hint);
  }
  console.error('');
  console.error('修复方法见 docs/pool-fork.md。');
  process.exit(1);
}
console.log('一杆清台（完整版）移植检查：全部通过（' + pass + ' 项）');
