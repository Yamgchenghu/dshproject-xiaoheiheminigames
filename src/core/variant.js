/**
 * 构建变体 —— 一套源码产出两个小程序。
 *
 * 【为什么要拆成两个】根因是一个死结：
 *   本项目申请了 network（联网）权限，平台因此把小程序判定为 "server 模式"。
 *   而 server 模式下 user.getInfo() 被平台禁用——文档写得很清楚：
 *   "第三方小程序进入联网的 server 模式后不能调用本方法获取身份"，
 *   要拿昵称头像必须由开发者自建服务端换票。我们没有服务端。
 *   所以登录态永远读不到，三轮"修复"都没用，因为方向本身是错的。
 *
 *   解法不是继续修，而是把不需要联网的部分拆出去：
 *   「复古游戏」不申请 network → 回到 host 模式 → user.getInfo() 可用 → 真登录。
 *   「学习与实用工具」需要联网（单词机 AI 整理、诗山朗读），保持现状。
 *
 * 【为什么不复制一份代码】复制会立刻产生分叉：修一个 bug 要改两处，
 *   两边会慢慢长得不一样，最后没人说得清哪个是最新的。
 *   这里用同一套源码 + 构建时开关，行为差异集中在本文件里，
 *   一眼能看全两个小程序到底哪里不同。
 */

/** 构建变体：'games' = 复古游戏（无联网），'tools' = 学习与实用工具（有联网） */
/**
 * 变体来源优先级：构建注入 > URL 参数 > 默认 tools。
 *
 * 【为什么要读 URL 参数】dev 预览跑的是源码，__APP_VARIANT__ 在启动时就固定了，
 *   想同时看两个版本就得重启服务器。加个 ?variant=games 就能在同一个
 *   dev 会话里来回切，验证成本从"重启一次"降到"刷新一下"。
 *   生产构建不传这个参数，所以线上永远走构建注入的值。
 */
function resolveVariant() {
  // 【顺序很重要】URL 参数必须排在构建值前面。
  //   dev 服务器会把 __APP_VARIANT__ 注入成默认值 'tools'，
  //   如果先看构建值，?variant=games 永远不生效——调试时看起来
  //   "参数没反应"，实际是被默认值挡住了。
  //   生产构建不带这个参数，所以线上仍然走构建注入的值。
  try {
    const q = new URLSearchParams(location.search).get('variant');
    if (q === 'games' || q === 'tools' || q === 'pool') return q;
  } catch { /* 非浏览器环境（测试）没有 location，忽略 */ }
  const built = typeof __APP_VARIANT__ !== 'undefined' && __APP_VARIANT__;
  return built || 'tools';
}

export const VARIANT = resolveVariant();

export const IS_GAMES = VARIANT === 'games';
export const IS_TOOLS = VARIANT === 'tools';
/** 第三个小程序：一杆清台（完整版，有联网权限，只做桌球） */
export const IS_POOL = VARIANT === 'pool';

/** 小程序名称，用于标题栏与分享文案 */
export const APP_NAME = IS_POOL ? '一杆清台' : IS_GAMES ? '复古游戏' : '学习与实用工具';

/**
 * 首屏与标签页。
 *
 * 【为什么两个变体的标签不一样】「复古游戏」的主体就是游戏，
 *   首屏直接进游戏列表；「学习与实用工具」的主体是转盘，
 *   游戏降级成工具页里的入口（避免被判定为游戏类小程序，牵扯版号）。
 */
// 【pool 为什么是空数组】第三个小程序只做桌球，进去直接是球桌，
//   根本没有标签栏（main.js 在 pool 变体里根本不建外壳）。
//   留空数组而不是删掉这个导出，是因为 app.js 仍在其他变体里读它。
export const TABS = IS_POOL
  ? []
  : IS_GAMES
  ? [
    { id: 'games', label: '游戏', icon: '🎮' },
    { id: 'mine', label: '我的', icon: '👤' },
  ]
  : [
    { id: 'home', label: '转盘', icon: '🎡' },
    { id: 'tools', label: '工具', icon: '🧰' },
    { id: 'mine', label: '我的', icon: '👤' },
  ];

/** 默认标签页 */
// 【pool 的默认标签无意义】它不走外壳，但保留一个合法值避免下游读到 undefined。
export const DEFAULT_TAB = IS_POOL ? 'pool' : IS_GAMES ? 'games' : 'home';

/**
 * 是否启用联网相关功能。
 * 【复古游戏关掉它们】不只是权限问题——没有 network 权限时调用 fetch
 *   会直接抛错。单词机 AI、诗山朗读都依赖网络，在游戏版里必须隐藏入口，
 *   否则用户点进去只会看到失败提示。
 */
export const FEATURES = Object.freeze({
  // 单词机：AI 整理词表、在线朗读都需要网络
  wordMachine: IS_TOOLS,
  // 诗山寻踪：朗读需要网络（游戏本体是离线的，但朗读是核心体验）
  shishan: IS_TOOLS,
  // 云海转盘：纯本地随机，两个版本都能用，但游戏版没有转盘 tab
  wheel: IS_TOOLS,
  // 【游戏只在复古游戏版】用户要求工具版移除游戏、排行榜、登录，
  //   全部迁到「复古游戏」。游戏代码仍在同一仓库，由构建变体决定是否显示。
  games: IS_GAMES,
  // 【桌球只在一杆清台】用户要求第三个小程序「只做桌球」。
  //   它和复古游戏里那份一杆清台是两套代码：这份是完整版（有联网、
  //   保留国内大模型接入和双 AI 观战），那份砍掉了全部联网能力。
  pool: IS_POOL,
  // 排行榜：只有游戏版有榜（分数来自游戏）。工具版没有可比较的分数。
  leaderboard: IS_GAMES || IS_POOL,
  // 登录：只有游戏版需要（榜上显示昵称头像）。
  //   工具版不需要身份，也就不用弹授权框，避免用户困惑。
  login: IS_GAMES || IS_POOL,
  // 【模组实验室只给游戏版】模组的作用是"用 Python 脚本改游戏内参数"，
  //   没有游戏就没有可改的东西。用户要求把它整体挪到复古游戏。
  //   注意：mod/ 目录的代码仍然打两份包（体积可忽略），
  //   只是工具版的所有入口都不再可达——不做动态 import 是为了避免
  //   "点了入口才发现模块没打包"这类线上事故。
  mods: IS_GAMES,
});
