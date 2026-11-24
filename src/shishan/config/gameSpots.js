/**
 * 章节内的「玩法触发点」规则表。
 *
 * 地图上的诗碑统一走「看图猜诗」，长期玩下来节奏单一；
 * 这里把已经做好的独立玩法（排序 / 接龙 / 配对 / 三消 / 华容道 /
 * 文言问答 / 综合试炼 / 飞花令）挂到地图上的「诗台 / 诗案 / 渡口」，
 * 让每一章都有一处换口味的玩法，而不是从头到尾只有一种题。
 *
 * 每张地图在自己的配置里写 gameSpots：
 *   { id, game, label, x, y, hint }
 * game 必须是下表的 key；needsPoem 为 true 时，由 MapScene 从玩家
 * 「已经学过的诗」里随机抽一首带进玩法（还没学过时用本章诗卷兜底）。
 */

import { SCENES } from './constants.js';

export const GAME_SPOT_RULES = {
  sort: {
    scene: SCENES.SORT_POEM,
    name: '诗句排序',
    sealText: '序',
    needsPoem: true,
    intro: '石案上摊着一卷打乱的诗句，按原来的次序拖回去。',
  },
  chain: {
    scene: SCENES.POEM_CHAIN,
    name: '诗句接龙',
    sealText: '接',
    needsPoem: true,
    intro: '上一句的尾巴，就是下一句的开头，一句接一句串起来。',
  },
  match: {
    scene: SCENES.MEANING_MATCH,
    name: '诗意配对',
    sealText: '配',
    needsPoem: true,
    intro: '把诗句和它讲的意思配成一对，配错了会重来。',
  },
  match3: {
    scene: SCENES.POEM_MATCH3,
    name: '诗句三消',
    sealText: '消',
    needsPoem: true,
    intro: '连成三个相同的字就消掉，把诗行里的字慢慢清出来。',
  },
  klondike: {
    scene: SCENES.POEM_KLONDIKE,
    name: '诗句华容道',
    sealText: '推',
    needsPoem: true,
    intro: '一格一格挪动诗卷，把整首诗推回它原来的位置。',
  },
  classical: {
    scene: SCENES.CLASSICAL_QUIZ,
    name: '文言小问',
    sealText: '问',
    needsPoem: true,
    // 只能抽文言 / 古文篇目：抽到普通古诗，场景会提示「不是文言文」再换一篇，
    // 玩家看到的就是「弹出《独坐敬亭山》→ 自动跳成别的」。
    classicalOnly: true,
    intro: '读一段文言小注，答对先生提出的问题。',
  },
  trial: {
    scene: SCENES.RANDOM_CHALLENGE,
    name: '综合试炼',
    sealText: '试',
    needsPoem: false,
    intro: '连着闯过几关综合题，看看今天能走多远。',
  },
  feihua: {
    scene: SCENES.FEIHUA_LING,
    name: '飞花令',
    sealText: '令',
    needsPoem: false,
    intro: '和诗友轮流说带关键字的诗句，说不出来就换人。',
  },
};

export function getGameSpotRule(key) {
  return GAME_SPOT_RULES[key] || null;
}

export function hasGameSpotRule(key) {
  return Boolean(GAME_SPOT_RULES[key]);
}
