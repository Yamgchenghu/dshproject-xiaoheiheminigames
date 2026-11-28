/**
 * 一杆清台的计分。
 *
 * 【为什么不用「赢 = 1 分」】那样排行榜只有 0 和 1 两个值，谁都能满分，
 *   分不出高手和新手，量化之后所有人都是 Q=200，榜单毫无意义。
 *
 * 【为什么也不直接用杆数】杆数少确实强，但单看杆数会鼓励玩家选最好打的模式
 *   （八球比斯诺克简单得多），而斯诺克一局 20 杆可能比八球 8 杆更值得称道。
 *
 * 【采用的方案】每局算一个「表现分」，由三部分相乘：
 *   1. 基础分：赢 100，输 30（输也有分，否则输了就没人愿意打完）
 *   2. 效率系数：按「每颗球用了几杆」算，越少越高
 *   3. 难度系数：斯诺克 > 轮转 > 九球 > 八球；对手越强越高
 *
 * 这样四种模式、三档难度都能进同一个榜，且分数可比。
 */

/** 各模式的基础分（按清台难度定，斯诺克最难） */
const MODE_BASE = {
  '8ball': 100,
  '9ball': 120,
  'rotation': 140,
  'snooker': 180,
};

/** 对手难度系数 */
const DIFFICULTY_FACTOR = {
  easy: 0.7,
  normal: 1.0,
  master: 1.4,
};

/**
 * 算一局的表现分。
 * @param {object} g  game state（G）
 * @returns {number} 表现分，四舍五入到整数
 */
export function computeRunScore(g) {
  if (!g) return 0;
  const mode = g.mode || '8ball';
  const base = MODE_BASE[mode] || 100;
  const won = g.winner === 0;

  // 【为什么输也有 30】输了直接 0 分的话，玩家一看要输就退出重开，
  //   既毁体验也让榜单只剩顺风局。给个底分，鼓励打完。
  const resultFactor = won ? 1 : 0.3;

  // 效率：本局一共打了几杆，每颗球平均几杆。
  // 【为什么按「每颗球」而不是「总杆数」】斯诺克有 22 颗球、八球 16 颗，
  //   直接比总杆数对斯诺克不公平。
  const shots = Math.max(1, g.shotIndex || 1);
  // 【为什么优先用 g.ballsTotal】game.js 结算时会直接传球数过来；
  //   测试或旧调用没有这个字段时，退回数 balls 数组。
  const ballsTotal = g.ballsTotal || (g.balls || []).filter((b) => b.id !== 0).length || 15;
  const perBall = shots / ballsTotal;
  // 每球 1 杆是理论极限（一杆一球），2 杆算正常，4 杆以上开始扣。
  // 用 1/x 曲线：1 杆 → 1.0，2 杆 → 0.5，4 杆 → 0.25。
  const efficiency = Math.min(1, 1 / Math.max(0.5, perBall));

  const diff = DIFFICULTY_FACTOR[g.difficulty] || 1;

  const score = base * resultFactor * (0.5 + efficiency) * diff;
  return Math.max(1, Math.round(score));
}

/** 四种模式的元信息（给 game-screen 的模式选择用） */
export const MODES = [
  { value: '8ball', label: '经典八球', sub: '打完自己那组再收黑八' },
  { value: '9ball', label: '九球', sub: '按号码顺序击球' },
  { value: 'rotation', label: '轮转', sub: '每颗球按号码计分' },
  { value: 'snooker', label: '斯诺克', sub: '红球彩球交替，最高分' },
];
