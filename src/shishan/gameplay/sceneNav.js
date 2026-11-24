/**
 * 支线场景（逸闻册 / 陈列馆）与独立玩法场景的跨场景导航。
 * ------------------------------------------------------------
 * 关卡 LevelScene 是叠加在来源场景（地图 / 错题书斋）上的独立场景：
 *   1. 从关卡进入支线时，只关掉关卡本身，下面的地图保持暂停；
 *   2. 从支线返回时把暂停的地图原地恢复，小朋友还在刚才的游戏地点，
 *      不用重新从地图起点走一遍；
 *   3. 从主页这类常规场景进入时走淡出切换，返回时重新进入主页。
 *
 * 这里只做场景调度，不改动任何进度与玩法逻辑。
 */

import { SCENES } from '../config/constants.js';

/** 支持「暂停在下面、返回时原地恢复」的来源场景 */
const PAUSABLE_SOURCES = [
  SCENES.MAP,
  SCENES.REVIEW,
  SCENES.CHAPTER_SELECT,
  SCENES.POEM_BOOK,
];

/** 返回按钮文案 */
const RETURN_LABELS = {
  [SCENES.MAP]: '地图',
  [SCENES.REVIEW]: '书斋',
  [SCENES.ANECDOTE]: '逸闻册',
  [SCENES.COLLECTION]: '陈列馆',
  [SCENES.CHAPTER_SELECT]: '章节',
  [SCENES.POEM_BOOK]: '诗卷',
  [SCENES.MENU]: '主页',
};

/**
 * 回程目标：
 *  - 关卡取它自己记下来的来源场景（地图 / 错题书斋）；
 *  - 逸闻册、陈列馆取打开时传入的 returnScene；
 *  - 其余场景就回自己。
 */
export function resolveReturnScene(scene, fallback = SCENES.MENU) {
  if (!scene || !scene.scene) return fallback;
  const key = scene.scene.key;

  if (key === SCENES.LEVEL) {
    const back = scene.returnScene;
    return back && back !== SCENES.LEVEL ? back : SCENES.MAP;
  }
  if (key === SCENES.ANECDOTE || key === SCENES.COLLECTION) {
    return scene.returnScene || fallback;
  }
  return key || fallback;
}

/** 返回按钮文案：从地图进来显示「地图」，从主页进来显示「主页」 */
export function getReturnLabel(returnScene, fallback = '返回') {
  return RETURN_LABELS[returnScene] || fallback;
}

/**
 * 打开支线 / 玩法场景，并把回程目标一起带过去。
 * @param {Phaser.Scene} scene 触发跳转的场景
 * @param {string} targetKey 目标场景
 * @param {object} options { returnScene, data }
 * @returns {boolean} 是否已经发起跳转
 */
export function openSideScene(scene, targetKey, options = {}) {
  if (!scene || !scene.scene || !scene.sys?.game?.scene) return false;
  const manager = scene.sys.game.scene;
  const currentKey = scene.scene.key;
  const returnScene = options.returnScene || resolveReturnScene(scene, SCENES.MENU);
  const data = { ...(options.data || {}), returnScene };

  if (typeof scene.playClick === 'function') scene.playClick();

  // 关卡：只关掉关卡本身；下面的地图 / 书斋保持暂停，返回时原地恢复
  if (currentKey === SCENES.LEVEL) {
    manager.stop(currentKey);
    manager.start(targetKey, data);
    manager.bringToTop(targetKey);
    return true;
  }

  // 地图等可以暂停的场景：暂停在下面再叠加打开，回程时位置不变
  if (PAUSABLE_SOURCES.includes(currentKey)) {
    manager.pause(currentKey);
    manager.start(targetKey, data);
    manager.bringToTop(targetKey);
    return true;
  }

  // 常规场景（主页 / 设置等）：淡出切换，回程时重新进入
  if (typeof scene.goTo === 'function') {
    scene.goTo(targetKey, data);
    return true;
  }

  manager.stop(currentKey);
  manager.start(targetKey, data);
  manager.bringToTop(targetKey);
  return true;
}

/**
 * 从支线场景返回来源场景：
 *  - 来源还在暂停中：原地恢复，位置与镜头都不变；
 *  - 来源已经不在：重新进入（例如从主页直接进来的逸闻册）。
 */
export function backFromSideScene(scene) {
  if (!scene || !scene.scene || !scene.sys?.game?.scene) return false;
  if (scene._navigating) return false;

  const manager = scene.sys.game.scene;
  const currentKey = scene.scene.key;
  const target = resolveReturnScene(scene, SCENES.MENU);

  if (target !== currentKey) {
    if (manager.isPaused(target)) {
      manager.resume(target);
      manager.stop(currentKey);
      return true;
    }
    if (manager.isActive(target)) {
      manager.bringToTop(target);
      manager.stop(currentKey);
      return true;
    }
  }

  if (typeof scene.goTo === 'function') {
    scene.goTo(target === currentKey ? SCENES.MENU : target, {});
    return true;
  }

  manager.start(target === currentKey ? SCENES.MENU : target, {});
  manager.stop(currentKey);
  return true;
}
