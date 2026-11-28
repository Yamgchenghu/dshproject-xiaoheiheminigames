/**
 * 游戏注册表。
 *
 * 【为什么用静态 import 而不是扫目录】打包器必须能静态分析出有哪些模块，
 *   动态 readdir 它看不见，会漏打进而线上少游戏。
 */
import * as g2048 from './g2048.js';
import * as minesweeper from './minesweeper.js';
import * as snake from './snake.js';
import * as fruitninja from './fruitninja.js';
import * as watermelon from './watermelon.js';
import { LEVELS } from '../tools/liushui/levels.js';
import { MODES as YIGAN_MODES } from '../tools/yigan/scoring.js';

const MODULES = [minesweeper, fruitninja, g2048, snake, watermelon];

/**
 * 五款 tick 驱动的原生小游戏。
 * 【注意】模组实验室、成绩结算、成就统计都只认这个列表——
 *   它们依赖 mods 参数表和 achievements，流水入杯两样都没有。
 */
export const GAMES = MODULES.map((m) => m.meta);

/**
 * 流水入杯：同样出现在「游戏」页、同样上排行榜，但实现完全不同
 * （240Hz 定步长物理 + 关卡制 + 自己画布，见 tools/liushui/）。
 *
 * 【为什么单独一条而不是塞进 GAMES】塞进去的话，模组实验室会把
 *   它列成一个"可注入参数"的游戏，点进去却没有任何参数可改；
 *   结算时也会走 recordRun 去读不存在的 achievements。
 *   分开列，两边都不用为对方加 if。
 */
export const LIUSHUI_META = {
  id: 'liushui',
  title: '流水入杯',
  sub: '画线接水，把杯子接满',
  accent: '#4ad9d9',
  bgm: 'liushui',
  /** 标记：这一项要走 openLiushuiScreen，而不是 game-screen */
  isLevelGame: true,
  modes: LEVELS.map((lv, i) => ({
    value: 'lv' + (i + 1),
    label: lv.name || `第 ${i + 1} 关`,
    sub: lv.tip || `第 ${i + 1} 关`,
  })),
};

/**
 * 诗山寻踪：一个带章节、地图、收集的国风古诗长线流程（Phaser 3）。
 *
 * 【为什么单独一条，且不并入 GAMES】
 *   1. 它没有「一局」的概念，也就没有分数——结算、排行榜、成就统计
 *      这三套东西都建立在「一局结束出一个分」上，对它完全不适用；
 *   2. 它有自己独立的存档域（save_20..21），不跟小游戏的最高分混在一起；
 *   3. 模组实验室只支持 tick 驱动的原生小游戏，诗山不在其列。
 *   所以这里只登记元信息，实际打开走 openShishanScreen。
 */
export const SHISHAN_META = {
  id: 'shishan',
  title: '诗山寻踪',
  sub: '抄诗、闯关、收集，慢慢游历',
  accent: '#9db79e',
  /** 标记：这一项要走 openShishanScreen，而不是 game-screen */
  isStoryGame: true,
  /** 没有模式概念；留一个占位，避免任何按 modes[0] 取值的旧代码崩掉 */
  modes: [{ value: 'story', label: '诗山寻踪', sub: '长线流程' }],
};

/**
 * 东海龙珠：2.5D 推币机。
 *
 * 【为什么单独一条，且不进 GAMES】
 *   1. 它没有"一局"的终点——币是无限的，什么时候结算由玩家决定。
 *      game-screen 的 recordRun / recordBest / submitScore 都建立在
 *      "打完一局出一个分"上，对它不成立；
 *   2. 计分口径完全不同：别的游戏是累加分，它是「每币平均彩票」——
 *      投币越多总分越高反而是坏成绩，这在 score 语义上是反的；
 *   3. 它有自己的每日挑战和周榜（每日 3 次、限额档位、每周累加刷新），
 *      这套东西只有它有，不该让别的游戏为它加 if。
 *   所以和流水入杯、诗山寻踪一样，只登记元信息，实际打开走 openDonghaiScreen。
 */
export const DONGHAI_META = {
  id: 'donghai',
  title: '东海龙珠',
  sub: '投币推珠，攒龙珠等派对',
  accent: '#e9bb66',
  // 【为什么元信息里也写 bgm】推币机不走 game-screen，实际播放是
  //   openDonghaiScreen 自己调的 playBgm('donghai')。
  //   这里照样登记，是为了让「设置页」和「游戏列表」能一致地知道
  //   这个游戏有音乐——否则设置页那句"每款游戏有独立 BGM"对它是假的。
  bgm: 'donghai',
  /** 标记：这一项要走 openDonghaiScreen */
  isCoinGame: true,
  /** 没有模式概念；留占位，避免按 modes[0] 取值的旧代码崩掉 */
  modes: [{ value: 'classic', label: '经典', sub: '每币平均彩票' }],
};


/**
 * 一杆清台：HTML5 台球。
 *
 * 【为什么单独一条，且不进 GAMES】
 *   它自带完整的 DOM 界面（开始页 / 设置 / 回放 / 开发者终端）和
 *   自己的 requestAnimationFrame 循环，不是 tick+draw 那套契约。
 *   硬塞进 game-screen 要把界面层整个重写，手感也会变。
 *   所以和流水入杯、诗山寻踪、东海龙珠一样，只登记元信息，
 *   实际打开走 openYiganScreen。
 *
 * 【它和另外三个特殊游戏的区别】
 *   流水入杯是关卡制、诗山是长线流程、东海龙珠没有终点；
 *   一杆清台是**有明确一局**的（分出胜负就结束），所以它能进排行榜，
 *   计分走 scoring.js 的 computeRunScore。
 */
export const YIGAN_META = {
  id: 'yigan',
  title: '一杆清台',
  sub: '真实碰撞物理，四种台球玩法',
  accent: '#3fa96b',
  /** 标记：这一项要走 openYiganScreen */
  isBilliardsGame: true,
  modes: YIGAN_MODES,
};
/** 「游戏」页与「我的」页展示的全部游戏 */
export const ALL_GAMES = [...GAMES, LIUSHUI_META, SHISHAN_META, DONGHAI_META, YIGAN_META];

export function metaOf(id) {
  for (const m of MODULES) if (m.meta.id === id) return m.meta;
  return null;
}

export function create(id, opts = {}) {
  for (const m of MODULES) if (m.meta.id === id) return m.create(opts);
  return null;
}

/** 全部游戏里按 id 找（含流水入杯、诗山寻踪） */
export function anyMetaOf(id) {
  if (id === LIUSHUI_META.id) return LIUSHUI_META;
  if (id === SHISHAN_META.id) return SHISHAN_META;
  if (id === DONGHAI_META.id) return DONGHAI_META;
  if (id === YIGAN_META.id) return YIGAN_META;
  return metaOf(id);
}

export default {
  GAMES, ALL_GAMES, LIUSHUI_META, SHISHAN_META, DONGHAI_META, YIGAN_META, create, metaOf, anyMetaOf,
};
