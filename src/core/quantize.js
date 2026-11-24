/**
 * 成绩量化 —— 把 26 个「游戏 × 模式」的原始分压成一把可比的尺子。
 *
 * 【为什么必须做这件事】平台硬限制：每个小程序最多 3 个排行榜。
 *   而我们有 4 个游戏 × 3 种模式 + 贪吃蛇 10 种 + 流水 14 关 = 33 个组合，
 *   原始分根本不可比：扫雷是"剩余秒数 × 6 × √难度 + 100"（几百），
 *   2048 是方块合并累加（几千），切水果是水果个数（几十）。
 *   把它们塞进同一个榜里直接相加，等于比谁玩的项目分数量级大。
 *
 * 【量化规则】基准分 = 该模式「普通玩家一局的典型成绩」。
 *   - 达到基准 → 100 分
 *   - 超过基准 → 每翻一倍 +10 分：Q = 100 + 10·log₂(score / base)
 *     （对数增长：从 100 到 110 要翻倍，从 110 到 120 再翻倍，
 *      所以高手之间的差距被压缩，不会因为某个模式分数量级大就碾压）
 *   - 低于基准 → 线性：Q = 100 · (score / base)
 *     （低分区用线性，保证新手每多打一点都有可见增长，不至于全是 0）
 *   - 没玩过（score 为 0 或缺失）→ **记 0 分**，不是记基准分。
 *     否则没玩过的人白拿 100 分，躺着就比认真玩的人高。
 *
 * 【为什么超过基准用对数、低于基准用线性】用户给的示例反推出来的：
 *   基准 20 分时，得 18 分 → 90（线性 100×18/20=90 ✓）
 *   得 30 分 → 105.85（100+10·log₂(30/20)=105.8496 ✓）
 *   得 40 分 → 110（100+10·log₂(2)=110 ✓）
 *   想要 105 分 → 需要 20·2^(5/10)=28.284 ✓
 *   五个示例全部吻合。
 */

/** 量化结果封顶，避免极少数异常分数把总分拉爆 */
import { LEVELS } from '../tools/liushui/levels.js';

export const Q_CAP = 200;

/**
 * 各模式基准分。
 *
 * 【怎么定的】取"普通玩家认真玩一局能拿到的成绩"，不是世界纪录。
 *   定太高 → 大多数人在 100 分以下，量化分全是零点几，榜看起来都是 0；
 *   定太低 → 人人都 100+，区分度又没了。
 *   依据是各游戏的计分公式和成就门槛（如切水果"单局 500 分"是成就线，
 *   属于优秀成绩，基准就该明显低于它）。
 */
export const BASES = Object.freeze({
  // 扫雷：通关 = 剩余秒数×6×√(雷数/10)+100；输了 = 已开格×3
  // 初级 9×9/10雷/120s：普通玩家赢一局剩 20~40 秒 → 约 100+30×6=280
  'minesweeper:small': 240,
  // 中级 15×15/40雷/180s：剩 20 秒 → 100+20×6×2=340
  'minesweeper:large': 320,
  // 高级 21×15/70雷/300s：剩 20 秒 → 100+20×6×2.65=418
  'minesweeper:wide': 400,

  // 合成大西瓜：合成出第 i 级得 (i+1)*10。一局正常能合 150~250 次，
  //   平均每次约 35 分（多数是小果），所以 200 次左右约 7000 分。
  //   取 6000 作基准：够得着但需要会看堆型，不是无脑砸就能到。
  'watermelon:classic': 6000,

  // 东海龙珠（推币机）：分数是「每币平均彩票」，不是累加分。
  //   基准 45/8 = 5.625 张/币 —— 等于"8 个币能换回 45 张票"。
  //   【为什么是分数】用户给的原话就是 45/8，写成分数不会手抄错。
  //   【为什么定这个数】实测自动连发 5.3 张、瞄准彩票槽 5.73 张，
  //     5.625 卡在中间：不瞄准约 94 分，瞄准到位刚过 100。
  //     也就是"必须瞄准才够 100"，挂机刷不到。
  //   【为什么这个基准和别的游戏不是一回事】别的游戏基准是"一局大概能打多少"，
  //     它是"投入产出比"。所以它天然落在 100 分附近，超了就按对数加分，
  //     不会像 2048 那样出现几百分的极端值。
  'donghai:classic': 45 / 8,

  // 切水果：普通水果 1 分、蓝莓 2 分，一局经典大约 60~120 个
  'fruitninja:classic': 120,
  // 限时 1 分钟：节奏快但时间短
  'fruitninja:t60': 90,
  // 限时 2 分钟：时间翻倍，分数接近翻倍
  'fruitninja:t120': 180,
  // 休闲：无炸弹、10 条命、容错远高于其他模式。
  // 基准定得比经典低一档，避免"刷休闲冲总分"——
  // 同样水平的玩家在经典里拿 120 分，在休闲里能拿 200 分。
  'fruitninja:casual': 100,

  // 2048：分数 = 所有合并出的方块面值之和。到 2048 方块约 2 万分，
  // 普通玩家一局通常到 512~1024 方块 → 约 4000~8000
  'g2048:classic': 6000,
  // 5×5 空间更大，更容易堆高分
  'g2048:square5': 9000,
  // 菱形四角封死，反而更难
  'g2048:diamond': 4500,

  // 贪吃蛇：分数 = 吃到果实×10 + (长度-3)×2
  'snake:classic': 300,
  'snake:wrap': 350,
  'snake:maze': 250,
  // 多人局：AI 会抢果实，人类吃到的更少，基准递减
  'snake:b2': 200,
  'snake:b3': 160,
  'snake:b4': 130,
  'snake:b5': 110,
  'snake:b6': 90,
  'snake:b7': 80,
  'snake:b8': 70,
});

/**
 * 流水入杯的基准 —— 用户口径：公式基础 + 水球释放量的 80%。
 *
 *   base = 28 × (关卡总数 + 1.5) + 3 + 水球额外释放量 × 0.8
 *
 * 【为什么它不走 BASES】流水是关卡制，14 关每关的接水量差异很大
 *   （有的关只需看着水流、有的关要连续推杯），逐关定基准没有依据。
 *   用户给的公式是按关卡总数整体估算的，14 关时 28×15.5+3 = 437。
 *   关卡数一变，基准自动跟着变，不用手工维护 14 个数字。
 *
 * 【为什么要加"水球释放量的 80%"】每关除了水龙头固定的 225 颗，
 *   碰到水球（CIRCLE.BUBBLE）还会额外释放水珠，这些水珠不占 225 的配额
 *   （见 engine.js 的 spawnReleasedDrop 注释）。它们同样是可接的分数来源，
 *   所以基准要按"玩家实际能接到的总量"来定，否则基准偏低、流水虚高。
 *   按 80% 而不是 100%，是因为机关要主动去碰才有收益，不是白送的。
 *
 * 【实测数字】pixelsPerMeter = 1800 时，水球额外释放量合计 560 颗：
 *   第 9 关 214 颗、第 10 关 18 颗、第 12 关 26 颗、第 13 关 302 颗。
 *   560 × 0.8 = 448，14 关基准 = 437 + 448 = 885。
 *   理论满分 = 14×225 + 560 − 14×190 = 1050，完美局折算 1050/885×100 = 118.6 分，
 *   高于 100 但留有余量——这正是想要的：打得极好能超过基准，但不是随便就满。
 *
 * 【依赖注意】这里 import { LEVELS } from '../tools/liushui/levels.js';
import 了 levels.js 和 engine.js 的常量。
 *   两者都不 import quantize.js，不构成循环依赖。
 *   若将来 levels.js 要引 quantize，必须改成把释放量算好再传进来。
 */
export const LIUSHUI_LEVELS = 14;

/** 每关水龙头固定放出的水珠数，与 engine.js 的 TOTAL_DROPS 一致 */
const LIUSHUI_DROPS_PER_LEVEL = 225;

/** 机关水球的释放系数：碰到水球时按面积算颗数，见 engine.js 的 releasedCount */
const BUBBLE_AREA_PCT = 0.0005;

/** 释放量乘数：engine.js 里 spawnReleasedDrop 被调用 n = releasedCount(...) * 2 次 */
const BUBBLE_MULTIPLIER = 2;

/** 机关释放量计入基准的比例 */
const BUBBLE_BASE_RATIO = 0.8;

/** 与 engine.js 一致的每米像素数，releasedCount 用它把半径换成面积 */
const LIUSHUI_PPM = 1800;

/** 复刻 engine.js 的 releasedCount：按圆面积算释放颗数，下限 1、上限 300 */
function releasedCount(radius) {
  const area = Math.PI * Math.pow(radius * LIUSHUI_PPM, 2);
  return Math.max(1, Math.min(300, Math.round(area * BUBBLE_AREA_PCT)));
}

/**
 * 水球额外释放的水珠总数。
 * 【为什么运行时算而不是写死 560】关卡数据一改（增删水球、调半径），
 *   基准必须跟着变。写死数字的话，改完关卡基准就悄悄错了。
 */
export function liushuiBubbleDrops() {
  let total = 0;
  for (const lv of LEVELS) {
    for (const c of lv.circles || []) {
      // kind === 3 是水球（CIRCLE.BUBBLE），毒球是 4，不参与加分
      if (c.kind === 3) total += releasedCount(c.radius) * BUBBLE_MULTIPLIER;
    }
  }
  return total;
}

export function liushuiBase(levelCount = LIUSHUI_LEVELS) {
  const formula = 28 * (levelCount + 1.5) + 3;
  const bubble = Math.round(liushuiBubbleDrops() * BUBBLE_BASE_RATIO);
  return formula + bubble;
}

/** 流水入杯的达标线：每关接住这么多滴才算「保本」，超出的部分才是得分 */
export const LIUSHUI_TARGET_DROPS = 190;

/** 每关总滴数：完美情况下全部入杯 */
export const LIUSHUI_TOTAL_DROPS = 225;

/**
 * 流水单关得分 = 入杯滴数 − 190。
 *
 * 【为什么是减 190 而不是直接算滴数】190 滴是「达标线」，是这一关的及格线，
 *   不是收益。用户的口径：完美局 225 滴全部入杯 → 225 − 190 = 35 分。
 *   也就是说 35 分是单关的理论上限，14 关全完美 = 490 分。
 *
 * 【为什么可能为负】只接了 150 滴，说明这一关虽然「过关」了但打得差，
 *   应当扣分。返回负值是刻意的，不是 bug —— 但在累加进总分时要按 0 处理
 *   （见 totalQuantized），否则一关打崩会把别的模式的努力全抹掉。
 */
export function liushuiRawScore(dropsInCup) {
  const d = Number(dropsInCup);
  if (!Number.isFinite(d)) return 0;
  return d - LIUSHUI_TARGET_DROPS;
}

/**
 * 流水满分的理论值。
 *
 * 【为什么不是 关数 × 35】每关水龙头固定 225 颗，但机关水球被碰到时会
 *   额外释放水珠，不占 225 的配额。所以满分 = 固定滴数 + 水球额外滴数
 *   − 关数×达标线。14 关时为 14×225 + 560 − 14×190 = 1050。
 *   漏算水球会得出 490，进而误判"基准 885 高于满分"。
 */
export function liushuiMaxScore(levelCount = LIUSHUI_LEVELS) {
  return (
    levelCount * (LIUSHUI_TOTAL_DROPS - LIUSHUI_TARGET_DROPS) + liushuiBubbleDrops()
  );
}

/**
 * 把原始分量化成可比分数。
 *
 * @param {number} score 原始分
 * @param {number} base  该模式的基准分
 * @returns {number} 量化分，未玩过返回 0
 */
export function quantize(score, base) {
  const s = Number(score);
  const b = Number(base);
  // 没玩过、分数非法、基准非法 → 0 分。绝不能退化成基准分。
  if (!Number.isFinite(s) || s <= 0) return 0;
  if (!Number.isFinite(b) || b <= 0) return 0;
  const q = s >= b ? 100 + 10 * Math.log2(s / b) : 100 * (s / b);
  return Math.min(Q_CAP, Math.round(q * 100) / 100);
}

/**
 * 反解：想要拿到目标量化分，原始分需要多少。
 * 用于在界面上告诉玩家"再打多少分能超过对手"。
 */
export function rawForQuant(targetQ, base) {
  const q = Number(targetQ);
  const b = Number(base);
  if (!Number.isFinite(q) || !Number.isFinite(b) || b <= 0) return 0;
  if (q <= 0) return 0;
  if (q < 100) return (b * q) / 100;
  return b * Math.pow(2, (q - 100) / 10);
}

/** 某个「游戏:模式」的基准分；流水入杯走专用公式 */
export function baseOf(gameId, mode, levelCount = LIUSHUI_LEVELS) {
  if (gameId === 'liushui') return liushuiBase(levelCount);
  return BASES[gameId + ':' + mode] || 0;
}

/**
 * 把玩家的全部最高分汇总成一个总分。
 *
 * 【为什么没玩的模式记 0 而不是记 100】用户明确要求：
 *   "如果有人没玩过，那么基准分=0参与累加"。
 *   记 100 的话，一个只玩过一个模式的人和一个全模式都玩到基准的人
 *   分数一样，榜就失去意义了。记 0 才能体现"广度 + 深度"。
 *
 * @param {object} scores   { '游戏.模式': 最高分 }，来自 save_18
 * @param {object} opts     { liushuiLevels }
 * @returns {{ total:number, parts:Array<{gameId,mode,raw,base,q}> }}
 */
export function totalQuantized(scores, opts = {}) {
  const levelCount = opts.liushuiLevels || LIUSHUI_LEVELS;
  const src = scores && typeof scores === 'object' ? scores : {};
  const parts = [];
  let total = 0;

  for (const gameId of Object.keys(MODE_KEYS)) {
    // 【流水入杯为什么整体算一个模式】基准公式 28×(关卡数+1.5)+3 = 437
    //   是按「14 关总分」量级定的，不是单关。
    //   若按单关算（满分 35），基准 437 会让满分也只有 8 分，
    //   14 关全完美才 112 分，还不如扫雷一个模式——流水玩得再好都没价值。
    //   所以把 14 关得分求和后当成一个模式参与量化，与基准量级对齐。
    if (gameId === 'liushui') {
      let sum = 0;
      const detail = [];
      for (const mode of MODE_KEYS.liushui) {
        const raw = Number(src[SHORT_KEYS.liushui_q + '.' + mode]) || 0;
        sum += raw;
        detail.push({ mode, raw });
      }
      const base = liushuiBase(levelCount);
      const q = quantize(Math.max(0, sum), base);
      parts.push({ gameId, mode: 'all', raw: sum, base, q, detail });
      total += q;
      continue;
    }
    for (const mode of MODE_KEYS[gameId]) {
      // 【流水为什么要读 liushui_q.*】流水的存档值是滴数（供关卡解锁用），
      //   不是得分。得分 = 滴数 − 190，存在单独的 liushui_q.* 里。
      //   读错键的话，190 滴会被当成 190 分，量化后虚高。
      const raw = Number(src[SHORT_KEYS[gameId] + '.' + mode]) || 0;
      const base = baseOf(gameId, mode, levelCount);
      // 【为什么负分先夹到 0 再量化】流水的单关得分可能是负数（接得不够），
      //   但负分已经在那个模式内部体现为"这关打得差"，
      //   如果再让它把别的模式的得分抵掉，就会出现"玩得越多总分越低"的荒谬结果。
      //   所以每个模式独立按 max(0, raw) 量化，模式之间不互相抵扣。
      const q = quantize(Math.max(0, raw), base);
      parts.push({ gameId, mode, raw, base, q });
      total += q;
    }
  }
  return { total: Math.round(total * 100) / 100, parts };
}

/**
 * 存储短键 —— 必须与 core/scores.js 里的 SHORT 表完全一致。
 *
 * 【为什么量化要用短键】save_18 里存的就是短键（ms.small、lsq.lv1），
 *   量化要读同一份数据，键必须对得上。这里独立维护一份而不是从 scores.js
 *   导入，是为了避免 core 内部互相 import 造成循环依赖
 *   （scores.js 已经 import 了 save.js，quantize 再反向依赖会打结）。
 *   两边不一致会被 test-quantize.mjs 的「短键与存档一致」断言抓到。
 */
export const SHORT_KEYS = Object.freeze({
  minesweeper: 'ms',
  fruitninja: 'fj',
  g2048: 'g2',
  snake: 'sn',
  watermelon: 'wm',
  donghai: 'dh',
  liushui: 'ls',
  liushui_q: 'lsq',
});

/** 参与量化的全部「游戏:模式」组合。必须与实际游戏注册表一致。 */
export const MODE_KEYS = Object.freeze({
  minesweeper: ['small', 'large', 'wide'],
  fruitninja: ['classic', 't60', 't120', 'casual'],
  g2048: ['classic', 'square5', 'diamond'],
  snake: ['classic', 'wrap', 'maze', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'],
  // 合成大西瓜：只算经典。观战模式不计分，绝不进这张表——
  //   进来就会给它分一个基准分，进而把"看 AI 玩"算成"我玩过"。
  watermelon: ['classic'],
  // 推币机：只有一种玩法，分数是每币平均彩票。
  //   【为什么它进这张表】用户要求"推币机也计入综合总分榜"，
  //   而综合总分是全部模式量化分的累加——不进表就等于不参与。
  donghai: ['classic'],
  liushui: ['lv1','lv2','lv3','lv4','lv5','lv6','lv7','lv8','lv9','lv10','lv11','lv12','lv13','lv14'],
});
