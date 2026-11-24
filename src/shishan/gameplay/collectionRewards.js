/**
 * 文房藏品发放逻辑（支线收集，独立于原有玩法与进度计算）。
 * ------------------------------------------------------------
 * 本模块只做四件事：
 *   1. 把「藏品 id」交给 ProgressManager 落盘（addCollectionItem，自动存档）；
 *   2. 播放轻收集音效 + 弹出淡彩国风弹窗「获得藏品【XX】」；
 *   3. 提供四种发放渠道：
 *        level    —— 关卡通关概率奖励（结算当下掷骰，不强制每局必出）
 *        anecdote —— 逸闻全套解锁保底（一件典藏）
 *        chapter  —— 章节课内 100% 完成度保底（一件稀有）
 *        trial    —— 第六章试炼模式通关奖励（一件典藏）
 *      保底渠道用 save.collectionRewards 标记幂等，不会重复补发；
 *   4. 打开藏品陈列馆（跨场景入口）。
 *
 * 藏品整件解锁、不拆碎片；不参与章节解锁与课内进度计算。
 */

import { SCENES } from '../config/constants.js';
import { CHAPTERS } from '../config/chapters.js';
import {
  RARITY_ORDER,
  getLevelCollectionChance,
  getCollectionSourceLabel,
  getRarityMeta,
  isCollectionRewardEnabled,
} from '../config/collections.js';
import { dataManager } from '../data/DataManager.js';
import { audio } from '../managers/AudioManager.js';
import { progress } from '../managers/ProgressManager.js';
import { showModal } from '../ui/components.js';
import { openSideScene } from './sceneNav.js';

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

/** 单件藏品的收集状态（陈列馆与调试面板共用） */
export function getCollectionItemState(collection_id) {
  const collection = dataManager.getCollectionById(collection_id);
  if (!collection) return null;
  return {
    collection,
    collectionId: collection.collection_id,
    owned: progress.hasCollectionItem(collection.collection_id),
  };
}

export function getAllCollectionStates() {
  return dataManager
    .getAllCollections()
    .map((item) => getCollectionItemState(item.collection_id))
    .filter(Boolean);
}

/** 还没拥有的藏品（可按稀有度筛选） */
export function listUnownedCollections(rarities = null) {
  const wanted = rarities ? [].concat(rarities) : RARITY_ORDER;
  return dataManager
    .getAllCollections()
    .filter((item) => wanted.includes(item.rarity) && !progress.hasCollectionItem(item.collection_id));
}

/**
 * 按稀有度抽一件还没拥有的藏品。
 * 传入 channel 时优先抽该渠道的藏品（collection_db.json 的 channel 字段），
 * 该渠道在这一稀有度里已经收齐，就回退到同稀有度其他藏品；
 * 稀有度也收齐时，从其他稀有度里补一件，避免保底渠道空转。
 */
export function pickCollectionByRarity(rarity, random = Math.random, channel = null) {
  const preferred = channel
    ? listUnownedCollections([rarity]).filter((item) => item.channel === channel)
    : [];
  let pool = preferred.length > 0 ? preferred : listUnownedCollections([rarity]);
  if (pool.length === 0) pool = listUnownedCollections();
  if (pool.length === 0) return null;
  const index = Math.floor(random() * pool.length) % pool.length;
  return pool[index];
}

/**
 * 打开藏品陈列馆。
 * 与逸闻册一样：从关卡进入时只关掉关卡，下面的地图保持暂停，
 * 返回时原地恢复（见 gameplay/sceneNav.js）。
 */
export function openCollectionHall(scene) {
  return openSideScene(scene, SCENES.COLLECTION);
}

/** 「获得藏品」弹窗（统一国风样式：印章 + 稀有度 + 来源 + 小介绍） */
function showCollectionGainModal(scene, info, options = {}) {
  const { source = 'level', onClose = null, withHallButton = false } = options;
  const meta = getRarityMeta(info.rarity);
  const lines = [
    `获得藏品【${info.name}】`,
    '',
    `稀有度：${info.rarity} · ${meta.blurb}`,
    `来源：${getCollectionSourceLabel(source)}`,
    '',
    info.collection.desc,
    '',
    `陈列馆进度：${info.count} / ${info.total}`,
  ];

  const actions = withHallButton
    ? [
      {
        label: '去陈列馆看看',
        variant: 'primary',
        onClick: () => openCollectionHall(scene),
      },
      { label: '收进书箧', variant: 'secondary' },
    ]
    : [{ label: '收进书箧', variant: 'primary' }];

  const modal = showModal(scene, {
    title: '藏品入柜',
    sealText: '藏',
    width: 820,
    message: lines.join('\n'),
    actions,
    onClose: () => {
      if (onClose) onClose();
    },
  });
  animatePopup(modal.root);
  return modal;
}

/**
 * 只负责「音效 + 弹窗」：藏品在发放那一刻就已经落盘，
 * 这里不再改存档，所以即使弹窗排了很久也不会重复发、也不会漏发。
 * @param {Phaser.Scene} scene
 * @param {object} info progress.addCollectionItem 的返回值
 * @param {object} options { source, onClose, withHallButton }
 */
export function notifyCollectionGain(scene, info, options = {}) {
  const { source = 'level', onClose = null, withHallButton = false } = options;
  if (!info) {
    if (onClose) onClose();
    return null;
  }
  if (!info.added) {
    if (onClose) onClose();
    return info;
  }

  audio.playCollection();
  console.info('[藏品] 获得藏品：', {
    collectionId: info.collectionId,
    name: info.name,
    rarity: info.rarity,
    source,
    progress: `${info.count}/${info.total}`,
  });

  if (scene && scene.scene && scene.scene.isActive()) {
    showCollectionGainModal(scene, info, { source, onClose, withHallButton });
  } else if (onClose) {
    onClose();
  }
  return info;
}

/**
 * 获得一件藏品：落盘 → 音效 → 弹窗。
 * @param {Phaser.Scene} scene
 * @param {string} collection_id
 * @param {object} options { source, onClose, withHallButton }
 */
export function grantCollectionItem(scene, collection_id, options = {}) {
  const info = progress.addCollectionItem(collection_id);
  return notifyCollectionGain(scene, info, options);
}

/**
 * 按稀有度发放一件藏品（保底渠道用）。
 * channel 默认跟 source 一致：chapter / anecdote / trial 各自优先抽本渠道藏品；
 * 该渠道收齐后自动补其他藏品；全部收齐时返回 null。
 */
export function grantCollectionByRarity(scene, options = {}) {
  const {
    source = 'chapter',
    rarity = '稀有',
    channel = source,
    random = Math.random,
    onClose = null,
  } = options;
  const collection = pickCollectionByRarity(rarity, random, channel);
  if (!collection) {
    if (onClose) onClose();
    return null;
  }
  return grantCollectionItem(scene, collection.collection_id, {
    source,
    onClose,
    withHallButton: true,
  });
}

/**
 * 依次弹窗展示一批「已经落盘」的藏品（保底渠道可能同时达标多条）。
 * entries: [{ info, source }]，info 来自 progress.addCollectionItem。
 */
function notifyCollectionBatch(scene, entries, index = 0, onDone = null) {
  if (!scene || !scene.scene || !scene.scene.isActive() || index >= entries.length) {
    // 场景已经关掉：藏品早就落盘了，只是不再弹窗
    if (onDone) onDone();
    return;
  }
  const entry = entries[index];
  notifyCollectionGain(scene, entry.info, {
    source: entry.source,
    withHallButton: true,
    onClose: () => notifyCollectionBatch(scene, entries, index + 1, onDone),
  });
}

/** 场景里是否已经有弹窗（depth 9200~9600）——防止两层弹窗叠在一起 */
function hasOpenModal(scene) {
  if (!scene || !scene.children || !Array.isArray(scene.children.list)) return false;
  return scene.children.list.some(
    (child) => child.type === 'Container' && child.depth >= 9200 && child.depth < 9600,
  );
}

/**
 * 等桌面空下来再弹藏品窗，避免和逸闻碎片 / 集齐解锁弹窗撞车。
 *
 * 注意：这里只「一直等」，不做超时强制弹出。
 * 以前超时就会硬弹，结果新弹窗盖在碎片弹窗上面，
 * 小朋友点「前往逸闻册」「继续游历」和右上角 × 都点不到。
 * 藏品在掉落的当下就已经写进存档，所以等多久都不会丢，
 * 场景被关掉时（time 事件一起销毁）自然就停下，也不会再弹。
 */
export function delayUntilIdle(scene, callback, options = {}) {
  const { interval = 380 } = options;
  if (!scene || !scene.scene || !scene.scene.isActive()) return;

  const tick = () => {
    if (!scene.scene || !scene.scene.isActive()) return;
    if (hasOpenModal(scene)) {
      scene.time.delayedCall(interval, tick);
      return;
    }
    callback();
  };
  scene.time.delayedCall(120, tick);
}

/**
 * 关卡通关概率奖励。
 * 掷骰、抽藏品、落盘都在结算当下完成（提前离开也不会丢），
 * 弹窗等桌面空下来再出现。
 */
export function maybeDropCollection(scene, options = {}) {
  const { source = 'level', delay = 1400, random = Math.random, onClose = null } = options;

  if (!isCollectionRewardEnabled('level')) return null;
  const chance = getLevelCollectionChance();
  if (chance <= 0) return null;
  if (random() >= chance) return null;

  // 关卡掉落优先抽 channel=level 的普通 / 稀有藏品；
  // 这一批抽完了再回退到「任意未拥有的普通 / 稀有」，最后才动用典藏。
  let pool = listUnownedCollections(['普通', '稀有'])
    .filter((item) => item.channel === 'level');
  if (pool.length === 0) pool = listUnownedCollections(['普通', '稀有']);
  const fallback = pool.length > 0 ? pool : listUnownedCollections();
  if (fallback.length === 0) return null;
  const collection = fallback[Math.floor(random() * fallback.length) % fallback.length];

  // 先落盘：即使小朋友在弹窗出现前就离开关卡，藏品也已经在陈列馆里
  const info = progress.addCollectionItem(collection.collection_id);
  if (!info || !info.added) return null;

  return scene.time.delayedCall(delay, () => {
    if (!scene.scene || !scene.scene.isActive()) return;
    delayUntilIdle(scene, () => {
      notifyCollectionGain(scene, info, { source, onClose });
    });
  });
}

/**
 * 保底渠道检查（地图每次恢复时调用一次）：
 *   1. 任一章节课内篇目 100% 完成 → 一件稀有藏品（每章只发一次）
 *   2. 逸闻册全部轶事解锁 → 一件典藏藏品（只发一次）
 * 已经发过的用 collectionRewards 标记，不会重复补发。
 */
export function checkCollectionGuarantees(scene, options = {}) {
  const { onClose = null } = options;
  if (!scene || !scene.scene || !scene.scene.isActive()) return [];

  const pending = [];

  if (isCollectionRewardEnabled('chapter')) {
    const rarity = '稀有';
    CHAPTERS.forEach((chapter) => {
      const chapterId = chapter.id;
      const key = `chapter:${chapterId}`;
      if (progress.hasCollectionReward(key)) return;
      const coreTotal = dataManager.getCorePoemsByChapter(chapterId).length;
      if (coreTotal <= 0) return;
      if (progress.getChapterCoreProgress(chapterId) < 100) return;
      progress.markCollectionReward(key);
      const collection = pickCollectionByRarity(rarity, Math.random, 'chapter');
      if (!collection) return;
      // 先落盘，再排队弹窗：玩家提前离开地图也不会少一件藏品
      const info = progress.addCollectionItem(collection.collection_id);
      if (info && info.added) pending.push({ info, source: 'chapter' });
    });
  }

  if (isCollectionRewardEnabled('anecdote') && !progress.hasCollectionReward('anecdoteAll')) {
    const totals = progress.getAnecdoteFragmentTotals();
    if (totals.totalAnecdotes > 0 && totals.unlockedAnecdotes >= totals.totalAnecdotes) {
      progress.markCollectionReward('anecdoteAll');
      const collection = pickCollectionByRarity('典藏', Math.random, 'anecdote');
      if (collection) {
        const info = progress.addCollectionItem(collection.collection_id);
        if (info && info.added) pending.push({ info, source: 'anecdote' });
      }
    }
  }

  if (pending.length === 0) return [];

  delayUntilIdle(scene, () => {
    notifyCollectionBatch(scene, pending, 0, onClose);
  });
  return pending.map((entry) => entry.info);
}

/**
 * 第六章试炼房通关奖励（一件典藏，只发一次）。
 * 结算面板先露一会儿，再淡彩弹窗报喜；藏品先落盘，弹窗只是通知。
 */
export function grantTrialCollection(scene, options = {}) {
  const { delay = 1200, onClose = null } = options;
  if (!isCollectionRewardEnabled('trial')) return null;
  if (progress.hasCollectionReward('trial')) return null;
  if (!scene || !scene.scene) return null;

  const collection = pickCollectionByRarity('典藏', Math.random, 'trial');
  if (!collection) return null;

  const info = progress.addCollectionItem(collection.collection_id);
  if (!info || !info.added) return null;
  progress.markCollectionReward('trial');

  return scene.time.delayedCall(delay, () => {
    if (!scene.scene || !scene.scene.isActive()) return null;
    delayUntilIdle(scene, () => {
      notifyCollectionGain(scene, info, {
        source: 'trial',
        withHallButton: true,
        onClose,
      });
    });
    return null;
  });
}

/** 调试用：一键解锁全部藏品（主菜单角落的调试按钮调用） */
export function grantAllCollections(scene, options = {}) {
  const { onClose = null } = options;
  const gained = progress.collectAllCollectionItems();
  if (gained.length === 0) {
    if (onClose) onClose();
    return gained;
  }
  audio.playCollection();
  console.info('[藏品][调试] 一键解锁藏品：', gained.map((item) => item.name));
  return gained;
}
