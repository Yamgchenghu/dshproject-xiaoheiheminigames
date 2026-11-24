/**
 * 关卡玩法注册表。
 * ------------------------------------------------------------
 * LevelScene 只负责“关卡外壳”（纸卡、返回、奖励结算），
 * 具体玩法由这里注册的模块提供。
 *
 * 当前骨架版只实现「看图猜诗」。
 * 后续新增诗句排序 / 三消 / 飞花令 / 华容道时：
 *   1. 新建 src/gameplay/XxxModule.js，导出同名类；
 *   2. 在本文件 import 并注册；
 *   3. 地图交互点或图鉴入口传入对应 mode 即可。
 */

import { GuessPoemModule } from './GuessPoemModule.js';

export const LEVEL_MODULES = {
  // 已实现：看图猜诗
  guess_poem: {
    key: 'guess_poem',
    name: '看图猜诗',
    desc: '看画卷，从四个诗题里选出正确的一首。',
    available: true,
    create: (context) => new GuessPoemModule(context),
  },

  // ---------------------------------------------------------
  // 以下为后续玩法预留入口（暂未实现，调用时给出温柔提示）
  // ---------------------------------------------------------
  poem_order: {
    key: 'poem_order',
    name: '诗句排序',
    desc: '把打乱的诗句重新排成一首完整的诗。',
    available: false,
  },
  match3: {
    key: 'match3',
    name: '诗字三消',
    desc: '连成三个相同诗字，解锁一句诗。',
    available: false,
  },
  feihualing: {
    key: 'feihualing',
    name: '飞花令',
    desc: '在限定时间内说出含指定字的诗句。',
    available: false,
  },
  huarongdao: {
    key: 'huarongdao',
    name: '诗境华容道',
    desc: '移动诗块，让诗句归位。',
    available: false,
  },
};

/** 取单个玩法配置 */
export function getLevelModule(modeKey) {
  return LEVEL_MODULES[modeKey] || null;
}

/**
 * 根据 mode 创建玩法实例。
 * @param {string} modeKey
 * @param {object} context { scene, layer, bounds, poem, review, onSolved }
 * @returns {object|null} 玩法实例（需实现 mount 方法）
 */
export function createLevelModule(modeKey, context) {
  const config = getLevelModule(modeKey);
  if (!config || !config.available || typeof config.create !== 'function') {
    return null;
  }
  return config.create(context);
}

/** 后续做玩法选择界面时可直接使用 */
export function listLevelModules() {
  return Object.values(LEVEL_MODULES);
}
