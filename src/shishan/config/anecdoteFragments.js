/**
 * 逸闻碎片配置（支线收集内容）。
 * ------------------------------------------------------------
 * 一条文人轶事拆成 3 片碎片，碎片标识统一为：
 *   `${anecdote_id}_fragment_1` / `_fragment_2` / `_fragment_3`
 *
 * 碎片来源共三种，全部在这里配置开关：
 *   map   —— RPG 地图上隐藏的淡彩宣纸拾取点（worldData 里按地图摆放）
 *   npc   —— NPC 对话奖励（worldData 的 interactions 里挂 fragmentReward）
 *   level —— 关卡通关奖励（按概率掉落，不强制每局必出）
 *
 * 逸闻碎片属于支线收集：不解锁章节、不影响课内进度、与温和/挑战模式无关。
 */

export const FRAGMENT_PER_ANECDOTE = 3;

const FRAGMENT_KEY_PATTERN = /^(\d+)_fragment_([1-9]\d*)$/;

/** 三种投放来源的开关与参数（关卡奖励的概率也在这里调） */
export const ANECDOTE_FRAGMENT_RULES = {
  map: {
    enabled: true,
    label: '地图拾取',
    hint: '地图上飘着一片淡彩宣纸，走近就能拾起。',
  },
  npc: {
    enabled: true,
    label: '对话奖励',
    hint: '和小书童聊聊，也会收到一片旧纸。',
  },
  level: {
    enabled: true,
    chance: 0.4, // 每局通关额外掉 1 片碎片的概率（0~1），设为 0 即关闭
    label: '通关奖励',
    hint: '诗题答得漂亮，偶尔会从书页里飘出一片纸。',
  },
};

/** 地图拾取点的默认参数 */
export const FRAGMENT_SPOT_DEFAULTS = {
  triggerRadius: 78, // 走进这个范围自动拾取
  appearsRadius: 300,
};

/** 由 anecdote_id 与第几片拼出碎片标识 */
export function fragmentKeyOf(anecdoteId, fragmentIndex) {
  const id = Number(anecdoteId);
  const index = Math.floor(Number(fragmentIndex));
  if (!Number.isFinite(id) || id <= 0) return '';
  if (!Number.isFinite(index) || index < 1 || index > FRAGMENT_PER_ANECDOTE) return '';
  return `${id}_fragment_${index}`;
}

/** 解析碎片标识；格式不合法返回 null */
export function parseFragmentKey(fragmentKey) {
  const match = FRAGMENT_KEY_PATTERN.exec(String(fragmentKey || '').trim());
  if (!match) return null;
  const anecdoteId = Number(match[1]);
  const fragmentIndex = Number(match[2]);
  if (!(fragmentIndex >= 1 && fragmentIndex <= FRAGMENT_PER_ANECDOTE)) return null;
  return {
    anecdoteId,
    fragmentIndex,
    fragmentKey: `${anecdoteId}_fragment_${fragmentIndex}`,
  };
}

/** 某条轶事是否已经集齐（不写存档，只判断列表长度） */
export function isFragmentListComplete(list) {
  return Array.isArray(list) && list.length >= FRAGMENT_PER_ANECDOTE;
}

export function isFragmentSourceEnabled(source) {
  const rule = ANECDOTE_FRAGMENT_RULES[source];
  return Boolean(rule && rule.enabled);
}

/** 关卡通关掉落概率；来源关闭时为 0 */
export function getLevelDropChance() {
  const rule = ANECDOTE_FRAGMENT_RULES.level;
  if (!rule || !rule.enabled) return 0;
  // 调试用：浏览器控制台临时写 window.__ANECDOTE_DROP_CHANCE__ = 1 可强制每局必掉
  if (typeof window !== 'undefined') {
    const override = Number(window.__ANECDOTE_DROP_CHANCE__);
    if (Number.isFinite(override)) return Math.max(0, Math.min(1, override));
  }
  const chance = Number(rule.chance);
  if (!Number.isFinite(chance)) return 0;
  return Math.max(0, Math.min(1, chance));
}

/** 只用于弹窗文案的来源名（debug 不是正式投放来源，只在开发调试时出现） */
const EXTRA_SOURCE_LABELS = {
  debug: '调试领取',
};

export function getFragmentSourceLabel(source) {
  return ANECDOTE_FRAGMENT_RULES[source]?.label || EXTRA_SOURCE_LABELS[source] || '诗山拾遗';
}
