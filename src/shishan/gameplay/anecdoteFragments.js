/**
 * 逸闻碎片收集逻辑（支线收集，独立于原有玩法与进度计算）。
 * ------------------------------------------------------------
 * 本模块只做四件事：
 *   1. 把「碎片标识」交给 ProgressManager 落盘（collectAnecdoteFragment）；
 *   2. 播放轻收集音效 + 弹出淡彩国风弹窗「获得【XX轶事碎片（1/3）】」；
 *   3. 三片集齐时再弹一次解锁动画弹窗，提供「前往逸闻册 / 继续游历」；
 *   4. 给地图拾取、NPC 对话、关卡结算三种来源提供统一的发放入口。
 *
 * 所有发放都自动存档，不改动章节解锁与课内进度。
 */

import { SCENES } from '../config/constants.js';
import { dataManager } from '../data/DataManager.js';
import { openSideScene } from './sceneNav.js';
import { audio } from '../managers/AudioManager.js';
import { progress } from '../managers/ProgressManager.js';
import { showModal } from '../ui/components.js';
import {
  FRAGMENT_PER_ANECDOTE,
  fragmentKeyOf,
  getFragmentSourceLabel,
  getLevelDropChance,
  isFragmentSourceEnabled,
} from '../config/anecdoteFragments.js';

/** 弹窗淡入：从下方轻轻浮上来，像一张纸落在桌上 */
function animatePopup(root) {
  if (!root) return;
  root.setAlpha(0);
  root.y = 18;
  root.scene?.tweens?.add({
    targets: root,
    alpha: 1,
    y: 0,
    duration: 260,
    ease: 'Sine.easeOut',
  });
}

/** 单条轶事的碎片状态 */
export function getAnecdoteFragmentState(anecdoteId) {
  const anecdote = dataManager.getAnecdoteById(anecdoteId);
  if (!anecdote) return null;
  const list = progress.getAnecdoteFragmentList(anecdote.anecdote_id);
  return {
    anecdote,
    anecdoteId: anecdote.anecdote_id,
    list,
    count: list.length,
    total: FRAGMENT_PER_ANECDOTE,
    remaining: Math.max(0, FRAGMENT_PER_ANECDOTE - list.length),
    complete: list.length >= FRAGMENT_PER_ANECDOTE,
    unlocked: progress.hasAnecdote(anecdote.anecdote_id),
  };
}

/** 全部轶事的碎片状态（逸闻册与调试面板共用） */
export function getAllAnecdoteFragmentStates() {
  return dataManager
    .getAllAnecdotes()
    .map((item) => getAnecdoteFragmentState(item.anecdote_id))
    .filter(Boolean);
}

/** 还没集齐的碎片标识（掉落时优先从这里抽，避免抽到已经有的） */
export function listMissingFragmentKeys() {
  const keys = [];
  getAllAnecdoteFragmentStates().forEach((state) => {
    for (let index = 1; index <= FRAGMENT_PER_ANECDOTE; index += 1) {
      if (!state.list.includes(index)) keys.push(fragmentKeyOf(state.anecdoteId, index));
    }
  });
  return keys;
}

/** 随机抽一片还缺的碎片；全部集齐时返回空字符串 */
export function pickRandomFragmentKey(random = Math.random) {
  const keys = listMissingFragmentKeys();
  if (keys.length === 0) return '';
  const index = Math.floor(random() * keys.length) % keys.length;
  return keys[index];
}

/**
 * 打开逸闻册。
 * 关卡是叠加场景：这里只关掉关卡本身，下面的地图保持暂停，
 * 从逸闻册返回时还能回到刚才的位置（见 gameplay/sceneNav.js）。
 */
export function openAnecdoteBook(scene) {
  return openSideScene(scene, SCENES.ANECDOTE);
}

/** 「获得碎片」弹窗 */
function showFragmentGainModal(scene, info, options = {}) {
  const { source = 'map', onClose = null } = options;
  const title = info.anecdote.title;
  const sourceText = getFragmentSourceLabel(source);
  const lines = [
    `获得【${title}轶事碎片（${info.count}/${info.total}）】`,
    '',
    `来源：${sourceText}`,
  ];
  if (info.complete) {
    lines.push('三片碎片已经拼回完整的一页。');
  } else {
    lines.push(`再找 ${info.remaining} 片，就能在逸闻册里读到完整的故事。`);
  }

  const modal = showModal(scene, {
    title: '拾得逸闻碎片',
    sealText: '拾',
    width: 780,
    message: lines.join('\n'),
    actions: [{ label: info.complete ? '看看新轶闻' : '收进书箧', variant: 'primary' }],
    onClose: () => {
      if (info.complete) {
        showUnlockModal(scene, info, { onClose });
      } else if (onClose) {
        onClose();
      }
    },
  });
  animatePopup(modal.root);
  return modal;
}

/** 「碎片集齐 · 解锁轶闻」弹窗 */
function showUnlockModal(scene, info, options = {}) {
  const { onClose = null } = options;
  const modal = showModal(scene, {
    title: '碎片集齐 · 解锁逸闻',
    sealText: '齐',
    width: 820,
    message: [
      `《${info.anecdote.title}》的三片旧纸，终于拼回了一页。`,
      '',
      '碎片集齐，解锁文人轶事，可前往逸闻册查看。',
    ].join('\n'),
    actions: [
      {
        label: '前往逸闻册',
        variant: 'primary',
        onClick: () => openAnecdoteBook(scene),
      },
      { label: '继续游历', variant: 'secondary' },
    ],
    onClose: () => {
      if (onClose) onClose();
    },
  });
  animatePopup(modal.root);
  return modal;
}

/**
 * 发放一片逸闻碎片：落盘 → 音效 → 弹窗（集齐时再弹解锁）。
 * @param {Phaser.Scene} scene
 * @param {string} fragmentKey 形如 "102_fragment_1"
 * @param {object} options { source: 'map'|'npc'|'level'|'debug', onClose }
 * @returns 收集结果；无效 / 已有该片时返回 null 或带 alreadyOwned 的结果
 */
export function grantAnecdoteFragment(scene, fragmentKey, options = {}) {
  const { source = 'map', onClose = null } = options;

  const info = progress.collectAnecdoteFragment(fragmentKey);
  if (!info) {
    if (onClose) onClose();
    return null;
  }
  if (info.alreadyOwned) {
    if (onClose) onClose();
    return info;
  }

  audio.playCollect();
  console.info('[逸闻] 收集碎片：', {
    fragmentKey: info.fragmentKey,
    anecdote: info.anecdote.title,
    progress: `${info.count}/${info.total}`,
    source,
    complete: info.complete,
  });

  showFragmentGainModal(scene, info, { source, onClose });
  return info;
}

/**
 * 关卡通关奖励：按配置概率额外掉一片碎片（不强制每局必出）。
 * 由 LevelScene 结算面板在展示完收获后调用一次。
 *
 * 掷骰子与抽片在结算当下就完成，弹窗延后一点再出现，避免和结算面板抢注意力；
 * 如果玩家在这之前已经离开关卡，碎片仍然会自动记入存档，只是不再弹窗。
 */
export function maybeDropAnecdoteFragment(scene, options = {}) {
  const {
    source = 'level',
    delay = 900,
    random = Math.random,
    onClose = null,
  } = options;

  if (!isFragmentSourceEnabled('level')) return null;
  const chance = getLevelDropChance();
  if (chance <= 0) return null;
  if (random() >= chance) return null;

  const key = pickRandomFragmentKey(random);
  if (!key) return null;

  return scene.time.delayedCall(delay, () => {
    if (!scene.scene.isActive()) {
      // 结算面板已经关掉：照样落盘，收集动作不丢
      progress.collectAnecdoteFragment(key);
      return;
    }
    grantAnecdoteFragment(scene, key, { source, onClose });
  });
}

/** 调试用：一键领取某段轶事的全部碎片（主菜单角落的调试按钮调用） */
export function grantAllAnecdoteFragments(scene, anecdoteId, options = {}) {
  const { onClose = null } = options;
  const anecdote = dataManager.getAnecdoteById(anecdoteId);
  if (!anecdote) {
    if (onClose) onClose();
    return null;
  }

  const before = progress.getAnecdoteFragmentList(anecdote.anecdote_id).length;
  progress.collectAllAnecdoteFragments(anecdote.anecdote_id);
  const state = getAnecdoteFragmentState(anecdote.anecdote_id);

  if (state.count === before) {
    // 已经集齐，不再重复弹窗
    if (onClose) onClose();
    return state;
  }

  audio.playCollect();
  console.info('[逸闻][调试] 一键领取碎片：', {
    anecdoteId: anecdote.anecdote_id,
    title: anecdote.title,
    progress: `${state.count}/${state.total}`,
  });

  const info = {
    anecdote,
    anecdoteId: anecdote.anecdote_id,
    count: state.count,
    total: state.total,
    remaining: state.remaining,
    complete: state.complete,
    list: state.list,
  };
  showFragmentGainModal(scene, info, { source: 'debug', onClose });
  return info;
}
