/**
 * 藏品展柜配置（collection_db.json 的配套规则）。
 * ------------------------------------------------------------
 * 藏品本身写在 public/data/collection_db.json，字段固定为：
 *   collection_id / name / desc / ai_prompt / rarity（普通 · 稀有 · 典藏）/ channel
 *
 * 这里只放「稀有度外观」与「发放渠道开关」，不改动原有的
 * config/collection.js（那是章节典藏成就用的老藏品体系）。
 *
 * 四种发放渠道（channel 字段决定「主要从哪条路获得」，找不到时自动回退）：
 *   level    —— 关卡通关概率奖励（不强制每局必出）
 *   anecdote —— 逸闻全套解锁保底（收齐全部轶事时发一件典藏）
 *   chapter  —— 章节课内 100% 完成度保底（发一件稀有）
 *   trial    —— 第六章试炼模式通关奖励（发一件典藏）
 *
 * 藏品属于支线收集：不解锁章节、不参与课内进度计算、与难度模式无关。
 */

import { C, S } from './theme.js';

export const RARITY_ORDER = ['普通', '稀有', '典藏'];

/** 稀有度外观：印章色、标签色与展柜分组小标题 */
export const RARITY_META = {
  普通: {
    key: '普通',
    label: '普通',
    order: 0,
    blurb: '案头常伴',
    sealColor: C.pineDeep,
    tagFill: C.pineLight,
    tagText: S.pineDeep,
    tagStroke: C.pine,
    barColor: C.pineLight,
  },
  稀有: {
    key: '稀有',
    label: '稀有',
    order: 1,
    blurb: '山间偶得',
    sealColor: C.gold,
    tagFill: C.goldLight,
    tagText: S.gold,
    tagStroke: C.gold,
    barColor: C.goldLight,
  },
  典藏: {
    key: '典藏',
    label: '典藏',
    order: 2,
    blurb: '压卷之藏',
    sealColor: C.peachDeep,
    tagFill: 0xf7e0da,
    tagText: S.peach,
    tagStroke: C.peachDeep,
    barColor: 0xf7e0da,
  },
};

export const DEFAULT_RARITY = '普通';

/** 数据里的稀有度写错时，统一落到「普通」，不让页面崩 */
export function normalizeRarity(value) {
  const key = String(value || '').trim();
  return RARITY_ORDER.includes(key) ? key : DEFAULT_RARITY;
}

export function getRarityMeta(value) {
  return RARITY_META[normalizeRarity(value)];
}

/** 藏品的四条产出渠道 */
export const COLLECTION_CHANNELS = ['level', 'chapter', 'anecdote', 'trial'];
export const DEFAULT_COLLECTION_CHANNEL = 'level';

/** 数据里 channel 写错或缺失时，统一落到关卡掉落，不让页面崩 */
export function normalizeCollectionChannel(value) {
  const key = String(value || '').trim();
  return COLLECTION_CHANNELS.includes(key) ? key : DEFAULT_COLLECTION_CHANNEL;
}

/** channel → 玩家能看懂的中文来源名（复用发放渠道文案） */
export function getCollectionChannelLabel(value) {
  return getCollectionSourceLabel(normalizeCollectionChannel(value));
}

/** 按 普通 → 稀有 → 典藏 排序（同类保持数据文件里的顺序） */
export function sortByRarity(list) {
  return [...list].sort((a, b) => {
    const orderA = getRarityMeta(a.rarity).order;
    const orderB = getRarityMeta(b.rarity).order;
    return orderA - orderB;
  });
}

/** 四种发放渠道的开关与参数 */
export const COLLECTION_REWARD_RULES = {
  level: {
    enabled: true,
    chance: 0.25, // 每局通关额外掉一件藏品的概率（0~1），设为 0 即关闭
    rarities: ['普通', '稀有'],
    label: '诗题通关奖励',
    hint: '诗题答完时，字纸里偶尔会飘出一件文房小物。',
  },
  anecdote: {
    enabled: true,
    rarity: '典藏',
    label: '逸闻全套保底',
    hint: '把逸闻册里的轶事全部收齐，书箧里会多一件典藏小物。',
  },
  chapter: {
    enabled: true,
    rarity: '稀有',
    label: '章节课内 100% 保底',
    hint: '把一章的课内篇目全部读完，展柜就会添一件藏品。',
  },
  trial: {
    enabled: true,
    rarity: '典藏',
    label: '试炼房通关奖励',
    hint: '在第六章试炼房一口气走完五关，会得到一件典藏小物。',
  },
};

/** 只用于弹窗文案的来源名（debug 不是正式渠道，只在开发调试时出现） */
const EXTRA_SOURCE_LABELS = {
  debug: '调试领取',
};

export function isCollectionRewardEnabled(source) {
  const rule = COLLECTION_REWARD_RULES[source];
  return Boolean(rule && rule.enabled);
}

/** 关卡通关掉率；渠道关闭时为 0 */
export function getLevelCollectionChance() {
  const rule = COLLECTION_REWARD_RULES.level;
  if (!rule || !rule.enabled) return 0;
  // 调试用：控制台写 window.__COLLECTION_DROP_CHANCE__ = 1 可强制每局必掉
  if (typeof window !== 'undefined') {
    const override = Number(window.__COLLECTION_DROP_CHANCE__);
    if (Number.isFinite(override)) return Math.max(0, Math.min(1, override));
  }
  const chance = Number(rule.chance);
  if (!Number.isFinite(chance)) return 0;
  return Math.max(0, Math.min(1, chance));
}

export function getCollectionSourceLabel(source) {
  return COLLECTION_REWARD_RULES[source]?.label || EXTRA_SOURCE_LABELS[source] || '诗山拾遗';
}

/** 展柜里点击未获得藏品时的提示 */
export function getCollectionHint() {
  const hints = Object.entries(COLLECTION_REWARD_RULES)
    .filter(([, rule]) => rule && rule.enabled)
    .map(([, rule]) => rule.hint);
  return hints.length > 0 ? hints.join('') : '这件小物还藏在诗山深处。';
}
