/**
 * 开发调试小工具（仅开发环境可见）。
 * ------------------------------------------------------------
 * 主菜单左上角一排调试入口：
 *  - 「调试 · 碎片」：列出 anecdote_db.json 里的每一段轶事与当前碎片进度，
 *    一键领取该轶事的全部碎片，用来快速验收逸闻册的灰度/彩色卡片与解锁弹窗；
 *  - 「调试 · 藏品」：列出 collection_db.json 里的全部藏品，
 *    点一下就把指定 collection_id 收进陈列馆（自动写盘），
 *    也可以「全部解锁」，用来快速验收展柜的彩色/剪影与详情弹窗；
 *  - 「调试 · 玩法」：选一首诗，直接进入 8 个独立小游戏
 *    （排序 / 配对 / 三消 / 华容道 / 接龙 / 文言问答 / 飞花令 / 综合试炼房），
 *    验收关卡里还没开放的玩法与「返回」流程；
 *  - 「调试 · 错题」：给指定诗篇写入错题记录，验收错题书斋的列表与复习流程。
 *    （答对通关会自动把这首诗移出错题书斋，所以正常流程下看到空书斋是预期行为。）
 *
 * 打包发布（npm run build）时 import.meta.env.DEV 为 false，
 * 按钮与面板都不会创建，玩家看不到任何调试入口。
 */

import { GAME_HEIGHT, GAME_WIDTH, SCENES } from '../config/constants.js';
import { C, FONT_SIZE, S } from '../config/theme.js';
import { dataManager } from '../data/DataManager.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import { FRAGMENT_PER_ANECDOTE } from '../config/anecdoteFragments.js';
import { LUNAR_FESTIVALS, SOLAR_TERMS, getTodayEvents } from '../config/festivals.js';
import { getRarityMeta } from '../config/collections.js';
import { grantAllAnecdoteFragments } from '../gameplay/anecdoteFragments.js';
import { addSeal, roundedRectPath } from './background.js';
import { createButton, createIconButton, makeText, showModal, showToast } from './components.js';
import { ScrollPanel } from './ScrollPanel.js';

/** 只有开发服务器下才为 true；打包后整块 UI 不会创建 */
export const DEBUG_TOOLS_ENABLED = Boolean(import.meta.env && import.meta.env.DEV);

const MAX_DEBUG_ACTIONS = 3;

// 共用面板尺寸（藏品 / 玩法 / 错题 三个面板一致，视觉统一）
const PANEL_W = 1120;
const PANEL_H = 560;

// 面板内网格
const GRID_COLS = 4;
const CARD_W = 248;
const CARD_H = 50;
const GRID_GAP_X = 16;
const GRID_GAP_Y = 7;

// 诗题有 74 首，一屏放不下：玩法 / 错题面板里「诗题列表」做成可滚动区，
// 一屏约 5 行，其余用滚轮或按住上下拖动查看（与逸闻册 / 陈列馆一致）。
const POEM_LIST_H = 250;
const POEM_LIST_PAD_TOP = 10;
const POEM_LIST_PAD_BOTTOM = 12;

/** 8 个独立小游戏：needsPoem 的用面板上选中的诗题开局 */
const GAME_LAUNCHES = [
  { key: SCENES.SORT_POEM, label: '诗句排序', needsPoem: true },
  { key: SCENES.MEANING_MATCH, label: '诗意配对', needsPoem: true },
  { key: SCENES.POEM_MATCH3, label: '诗句三消', needsPoem: true },
  { key: SCENES.POEM_KLONDIKE, label: '诗句华容道', needsPoem: true },
  { key: SCENES.POEM_CHAIN, label: '诗句接龙', needsPoem: true },
  { key: SCENES.CLASSICAL_QUIZ, label: '文言问答', needsPoem: true },
  {
    key: SCENES.FEIHUA_LING,
    label: '飞花令 · 月',
    needsPoem: false,
    data: { keyword: '月' },
  },
  {
    key: SCENES.RANDOM_CHALLENGE,
    label: '综合试炼房',
    needsPoem: false,
    data: { range: 'all' },
  },
];

/** 在主菜单角落放一排很小的调试入口 */
export function addDebugTools(scene) {
  if (!DEBUG_TOOLS_ENABLED) return null;

  const entries = [
    ['调试 · 碎片', () => openDebugFragmentPanel(scene)],
    ['调试 · 藏品', () => openDebugCollectionPanel(scene)],
    ['调试 · 玩法', () => openDebugGameplayPanel(scene)],
    ['调试 · 错题', () => openDebugWrongPanel(scene)],
    ['调试 · 节气', () => openDebugFestivalPanel(scene)],
    ['调试 · 诗笺', () => scene.scene.start(SCENES.EXCERPT, {})],
  ];

  const startX = 96;
  const stepX = 134;
  let first = null;

  entries.forEach(([label, onClick], index) => {
    const controller = createButton(scene, {
      x: startX + index * stepX,
      y: 32,
      width: 128,
      height: 34,
      radius: 17,
      label,
      variant: 'ghost',
      fontSize: 12,
      depth: 300,
      onClick,
    });
    if (!first) first = controller;
  });

  // 说明文字放到按钮右侧
  makeText(scene, 900, 32, '仅开发环境可见，打包后自动隐藏', {
    size: 11,
    color: S.inkFaint,
    origin: [0, 0.5],
  })
    .setDepth(300)
    .setAlpha(0.6);

  return first;
}

/**
 * 统一的调试面板外框：遮罩 + 纸卡 + 印章标题 + 右上角 ×。
 * 返回 root / 左上角坐标 / 关闭方法，面板内容自己往里加。
 */
function createDebugPanelFrame(scene, title, tip = '', options = {}) {
  const width = options.width || PANEL_W;
  const height = options.height || PANEL_H;
  const cx = GAME_WIDTH / 2;
  const cy = GAME_HEIGHT / 2;
  const left = cx - width / 2;
  const top = cy - height / 2;

  const root = scene.add.container(0, 0).setDepth(9200).setScrollFactor(0);
  const blocker = scene.add
    .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x2e3a34, 0.45)
    .setOrigin(0)
    .setScrollFactor(0)
    .setInteractive();
  root.add(blocker);

  const panel = scene.add.graphics();
  panel.fillStyle(0x4b4130, 0.13);
  roundedRectPath(panel, left + 3, top + 8, width, height, 30);
  panel.fillPath();
  panel.fillStyle(C.paperSoft, 0.985);
  roundedRectPath(panel, left, top, width, height, 30);
  panel.fillPath();
  panel.lineStyle(2, C.inkFaint, 0.45);
  roundedRectPath(panel, left, top, width, height, 30);
  panel.strokePath();
  panel.lineStyle(1, C.gold, 0.28);
  roundedRectPath(panel, left + 9, top + 9, width - 18, height - 18, 22);
  panel.strokePath();
  panel.lineStyle(1.4, C.gold, 0.38);
  panel.beginPath();
  panel.moveTo(left + 64, top + 96);
  panel.lineTo(left + width - 64, top + 96);
  panel.strokePath();
  root.add(panel);

  root.add(addSeal(scene, left + 56, top + 54, '调', 44));
  root.add(
    makeText(scene, cx, top + 54, title, {
      size: FONT_SIZE.xl,
      color: S.ink,
      origin: [0.5, 0.5],
      bold: true,
    }),
  );

  if (tip) {
    root.add(
      makeText(scene, left + 64, top + 118, tip, {
        size: 14,
        color: S.inkSoft,
        origin: [0, 0.5],
        wrap: width - 128,
      }),
    );
  }

  const close = () => {
    if (!root.scene) return;
    root.destroy(true);
  };

  const xButton = createIconButton(scene, {
    x: left + width - 42,
    y: top + 42,
    size: 46,
    icon: '×',
    variant: 'ghost',
    onClick: close,
    depth: 9202,
  });
  root.add(xButton.container);

  return { root, left, top, cx, cy, width, height, close };
}

/**
 * 面板里的「诗题滚动列表」：4 列卡片，一屏放不下时用滚轮 / 按住上下拖动查看。
 * 卡片坐标从滚动区左上角算起，超出窗口的卡片会被隐藏（也顺带禁掉点击）。
 */
function createPoemList(scene, root, options) {
  const {
    x,
    y,
    width,
    poems,
    cardHeight,
    rowPitch,
    createCard,
  } = options;

  const entries = [];

  const scroller = new ScrollPanel(scene, {
    x,
    y,
    width,
    height: POEM_LIST_H,
    radius: 14,
    depth: 9201,
    // 内容贴着窗口右沿，滚动条往外挪一点，避免压住最右一列卡片
    scrollbarOffset: 14,
    onScroll: (scrollY) => {
      entries.forEach(({ controller }) => {
        const center = controller.container.y;
        controller.setVisible(
          center + cardHeight / 2 - scrollY > 0
          && center - cardHeight / 2 - scrollY < POEM_LIST_H,
        );
      });
    },
  });

  poems.forEach((poem, index) => {
    const column = index % GRID_COLS;
    const row = Math.floor(index / GRID_COLS);
    const controller = createCard(poem, {
      x: CARD_W / 2 + column * (CARD_W + GRID_GAP_X),
      y: POEM_LIST_PAD_TOP + cardHeight / 2 + row * rowPitch,
      width: CARD_W,
    });
    scroller.add(controller.container);
    entries.push({ poem, controller });
  });

  const rowCount = Math.ceil(poems.length / GRID_COLS);
  scroller.layout(
    POEM_LIST_PAD_TOP + Math.max(0, rowCount - 1) * rowPitch + cardHeight + POEM_LIST_PAD_BOTTOM,
    { reset: true },
  );

  // 拖动滚动：按在卡片上也能拖（Phaser 默认只把指针事件发给最上层对象，
  // 所以这里走场景级事件，而不是滚动区里那块热区）。
  // 拖动距离超过阈值就不再算「点了卡片」，避免滚一下就把诗选了。
  let drag = null;
  let dragMoved = false;
  const inArea = (pointer) => pointer.x >= x
    && pointer.x <= x + width
    && pointer.y >= y
    && pointer.y <= y + POEM_LIST_H;

  const onPointerDown = (pointer) => {
    dragMoved = false;
    if (!inArea(pointer)) return;
    drag = { id: pointer.id, startY: pointer.y, startScroll: scroller.scrollY };
  };
  const onPointerMove = (pointer) => {
    if (!drag || pointer.id !== drag.id) return;
    const delta = pointer.y - drag.startY;
    if (Math.abs(delta) > 6) dragMoved = true;
    if (dragMoved) scroller.setScroll(drag.startScroll - delta);
  };
  const onPointerUp = () => {
    drag = null;
  };

  scene.input.on('pointerdown', onPointerDown);
  scene.input.on('pointermove', onPointerMove);
  scene.input.on('pointerup', onPointerUp);
  scene.input.on('pointerupoutside', onPointerUp);

  // 面板关掉时一起收掉滚动区与监听
  root.once('destroy', () => {
    scene.input.off('pointerdown', onPointerDown);
    scene.input.off('pointermove', onPointerMove);
    scene.input.off('pointerup', onPointerUp);
    scene.input.off('pointerupoutside', onPointerUp);
    scroller.destroy();
  });

  return { scroller, entries, isDragging: () => dragMoved };
}

/** 一键领取面板 */
export function openDebugFragmentPanel(scene) {
  if (!DEBUG_TOOLS_ENABLED) return null;

  const anecdotes = dataManager.getAllAnecdotes();
  if (anecdotes.length === 0) {
    return showModal(scene, {
      title: '调试 · 逸闻碎片',
      message: 'anecdote_db.json 里还没有轶事数据。',
      sealText: '调',
      actions: [{ label: '知道了', variant: 'primary' }],
    });
  }

  let pendingId = null;
  const actions = anecdotes.slice(0, MAX_DEBUG_ACTIONS).map((item) => {
    const count = progress.getAnecdoteFragmentList(item.anecdote_id).length;
    return {
      label: `${item.title} ${count}/${FRAGMENT_PER_ANECDOTE} · 一键集齐`,
      variant: count >= FRAGMENT_PER_ANECDOTE ? 'secondary' : 'primary',
      onClick: () => {
        pendingId = item.anecdote_id;
      },
    };
  });
  actions.push({ label: '关闭', variant: 'secondary' });

  return showModal(scene, {
    title: '调试 · 逸闻碎片',
    message: [
      '仅开发环境可用，打包发布后自动隐藏。',
      '',
      '一键领取会补齐该轶事的三片碎片并自动存档，',
      '集齐时会顺带弹出解锁提示。',
    ].join('\n'),
    sealText: '调',
    width: 800,
    actions,
    onClose: () => {
      if (pendingId === null) return;
      const id = pendingId;
      pendingId = null;
      // 等上一层弹窗彻底收好，再弹「获得碎片」纸卡
      scene.time.delayedCall(180, () => {
        if (!scene.scene.isActive()) return;
        grantAllAnecdoteFragments(scene, id);
      });
    },
  });
}

/** 藏品调试面板：全部藏品网格，一键解锁指定 collection_id */
export function openDebugCollectionPanel(scene) {
  if (!DEBUG_TOOLS_ENABLED) return null;

  const collections = dataManager.getAllCollections();
  if (collections.length === 0) {
    return showModal(scene, {
      title: '调试 · 文房藏品',
      message: 'collection_db.json 里还没有藏品数据。',
      sealText: '调',
      actions: [{ label: '知道了', variant: 'primary' }],
    });
  }

  const frame = createDebugPanelFrame(
    scene,
    '调试 · 文房藏品',
    '点一下就能解锁指定 collection_id（自动写入存档）；仅开发环境可见，打包后自动隐藏。',
  );
  const { root, left, top, cx } = frame;

  const countText = makeText(scene, left + PANEL_W - 64, top + 54, '', {
    size: 15,
    color: S.gold,
    origin: [1, 0.5],
  });
  root.add(countText);

  const gridLeft = cx - (GRID_COLS * CARD_W + (GRID_COLS - 1) * GRID_GAP_X) / 2;
  const gridTop = top + 138;
  const entries = [];

  const refreshAll = () => {
    const owned = progress.getCollectionItemCount();
    countText.setText(`已收藏 ${owned} / ${collections.length}`);
    entries.forEach(({ item, controller }) => {
      const has = progress.hasCollectionItem(item.collection_id);
      controller.setSubLabel(has ? '已获得' : `${item.rarity} · 未获得`);
      controller.setVariant(has ? 'soft' : item.rarity === '典藏'
        ? 'primary'
        : item.rarity === '稀有' ? 'gold' : 'secondary');
    });
  };

  collections.forEach((item, index) => {
    const column = index % GRID_COLS;
    const row = Math.floor(index / GRID_COLS);
    const x = gridLeft + CARD_W / 2 + column * (CARD_W + GRID_GAP_X);
    const y = gridTop + CARD_H / 2 + row * (CARD_H + GRID_GAP_Y);
    const meta = getRarityMeta(item.rarity);
    const controller = createButton(scene, {
      x,
      y,
      width: CARD_W,
      height: CARD_H,
      radius: 16,
      label: item.name,
      subLabel: '',
      variant: 'secondary',
      fontSize: 17,
      subFontSize: 11,
      depth: 9202,
      onClick: () => {
        const info = progress.addCollectionItem(item.collection_id);
        if (!info) return;
        if (info.added) audio.playCollect();
        showToast(
          scene,
          info.added
            ? `已解锁【${item.name}】· ${meta.label}藏品`
            : `【${item.name}】早已在展柜里`,
          { y: 662, duration: 1500 },
        );
        refreshAll();
      },
    });
    root.add(controller.container);
    entries.push({ item, controller });
  });

  const unlockAll = createButton(scene, {
    x: cx - 160,
    y: top + PANEL_H - 54,
    width: 280,
    height: 58,
    radius: 20,
    label: '全部解锁',
    variant: 'gold',
    fontSize: 20,
    depth: 9202,
    onClick: () => {
      const gained = progress.collectAllCollectionItems();
      if (gained.length > 0) audio.playCollect();
      showToast(
        scene,
        gained.length > 0 ? `已解锁 ${gained.length} 件藏品` : '全部藏品都已在展柜里',
        { y: 662, duration: 1600 },
      );
      refreshAll();
    },
  });
  root.add(unlockAll.container);

  const closeButton = createButton(scene, {
    x: cx + 190,
    y: top + PANEL_H - 54,
    width: 220,
    height: 58,
    radius: 20,
    label: '关闭',
    variant: 'secondary',
    fontSize: 20,
    depth: 9202,
    onClick: frame.close,
  });
  root.add(closeButton.container);

  refreshAll();
  return root;
}

// ---------------------------------------------------------
// 调试 · 玩法：选诗题 → 直接进 8 个小游戏
// ---------------------------------------------------------
export function openDebugGameplayPanel(scene) {
  if (!DEBUG_TOOLS_ENABLED) return null;

  const poems = dataManager.getAllPoems();
  if (poems.length === 0) {
    return showModal(scene, {
      title: '调试 · 玩法',
      message: 'poem_db.json 里还没有诗篇数据。',
      sealText: '调',
      actions: [{ label: '知道了', variant: 'primary' }],
    });
  }

  const frame = createDebugPanelFrame(
    scene,
    '调试 · 玩法',
    '关卡里还没开放的玩法，可以先在这里逐个试玩；小游戏里的「返回」会回到主菜单（仅开发环境可见）。',
    { height: 650 },
  );
  const { root, left, top, cx, width } = frame;

  let selectedPoemId = poems[0].id;

  const gridWidth = GRID_COLS * CARD_W + (GRID_COLS - 1) * GRID_GAP_X;
  const gridLeft = cx - gridWidth / 2;

  root.add(
    makeText(scene, left + 64, top + 152, '① 先选一首诗（下面 6 个玩法都用这首诗开局）', {
      size: 14,
      color: S.inkSoft,
      origin: [0, 0.5],
    }),
  );
  root.add(
    makeText(scene, left + width - 64, top + 152, `共 ${poems.length} 首 · 滚轮或按住上下拖动`, {
      size: 13,
      color: S.inkFaint,
      origin: [1, 0.5],
    }),
  );

  // 诗题列表可滚动：一屏 5 行，其余往下翻（不会再压到下面的玩法区）
  const poemList = createPoemList(scene, root, {
    x: gridLeft,
    y: top + 168,
    width: gridWidth,
    poems,
    cardHeight: 42,
    rowPitch: 52,
    createCard: (poem, layout) => createButton(scene, {
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: 42,
      radius: 14,
      label: poem.title.length > 7
        ? `《${poem.title}》`
        : `《${poem.title}》 · 第${poem.chapter}章`,
      variant: 'secondary',
      fontSize: 14,
      depth: 9202,
      onClick: () => {
        if (poemList.isDragging()) return;
        selectedPoemId = poem.id;
        refreshPoems();
      },
    }),
  });
  const poemEntries = poemList.entries;

  const refreshPoems = () => {
    poemEntries.forEach(({ poem, controller }) => {
      controller.setVariant(poem.id === selectedPoemId ? 'gold' : 'secondary');
    });
  };

  root.add(
    makeText(scene, left + 64, top + 440, '② 打开玩法（飞花令与试炼房不绑定诗题）', {
      size: 14,
      color: S.inkSoft,
      origin: [0, 0.5],
    }),
  );

  // 玩法按钮的 onClick 会销毁整个面板，所以先把关闭与跳转收在一个函数里
  const launchGame = (entry) => {
    const data = { ...(entry.data || {}) };
    if (entry.needsPoem) data.poemId = selectedPoemId || poems[0].id;
    data.returnScene = SCENES.MENU;

    frame.close();
    // 主菜单暂停在下面，小游戏结束后「返回」会原地恢复主菜单
    scene.scene.pause();
    scene.scene.launch(entry.key, data);
    scene.scene.bringToTop(entry.key);
  };

  GAME_LAUNCHES.forEach((entry, index) => {
    const column = index % GRID_COLS;
    const row = Math.floor(index / GRID_COLS);
    const x = gridLeft + CARD_W / 2 + column * (CARD_W + GRID_GAP_X);
    const y = top + 480 + row * 62;
    const controller = createButton(scene, {
      x,
      y,
      width: CARD_W,
      height: 50,
      radius: 16,
      label: entry.label,
      variant: entry.needsPoem ? 'primary' : 'soft',
      fontSize: 16,
      depth: 9202,
      onClick: () => launchGame(entry),
    });
    root.add(controller.container);
  });

  const closeButton = createButton(scene, {
    x: cx,
    y: top + 608,
    width: 220,
    height: 54,
    radius: 20,
    label: '关闭',
    variant: 'secondary',
    fontSize: 20,
    depth: 9202,
    onClick: frame.close,
  });
  root.add(closeButton.container);

  refreshPoems();
  return root;
}

// ---------------------------------------------------------
// 调试 · 错题：给指定诗篇写错题记录
// ---------------------------------------------------------
export function openDebugWrongPanel(scene) {
  if (!DEBUG_TOOLS_ENABLED) return null;

  const poems = dataManager.getAllPoems();
  if (poems.length === 0) {
    return showModal(scene, {
      title: '调试 · 错题',
      message: 'poem_db.json 里还没有诗篇数据。',
      sealText: '调',
      actions: [{ label: '知道了', variant: 'primary' }],
    });
  }

  const frame = createDebugPanelFrame(
    scene,
    '调试 · 错题',
    '点一首诗就写入一条错题记录（自动存档）；答对通关后这首诗会自动移出错题书斋（仅开发环境可见）。',
    { height: 650 },
  );
  const { root, left, top, cx, width } = frame;

  const countText = makeText(scene, left + width - 64, top + 54, '', {
    size: 15,
    color: S.gold,
    origin: [1, 0.5],
  });
  root.add(countText);

  root.add(
    makeText(scene, left + 64, top + 152, '① 点诗写入错题（每点一次记 1 次）', {
      size: 14,
      color: S.inkSoft,
      origin: [0, 0.5],
    }),
  );
  root.add(
    makeText(scene, left + width - 64, top + 152, `共 ${poems.length} 首 · 滚轮或按住上下拖动`, {
      size: 13,
      color: S.inkFaint,
      origin: [1, 0.5],
    }),
  );

  const gridWidth = GRID_COLS * CARD_W + (GRID_COLS - 1) * GRID_GAP_X;
  const gridLeft = cx - gridWidth / 2;

  const wrongList = createPoemList(scene, root, {
    x: gridLeft,
    y: top + 168,
    width: gridWidth,
    poems,
    cardHeight: 56,
    rowPitch: 66,
    createCard: (poem, layout) => createButton(scene, {
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: 56,
      radius: 16,
      label: `《${poem.title}》`,
      subLabel: '尚未记录',
      variant: 'secondary',
      fontSize: 17,
      subFontSize: 12,
      depth: 9202,
      onClick: () => {
        if (wrongList.isDragging()) return;
        const count = progress.addWrongRecord(poem.id);
        if (!count) return;
        audio.playClick();
        showToast(scene, `已为《${poem.title}》记下第 ${count} 次错题`, {
          y: 662,
          duration: 1400,
        });
        refreshAll();
      },
    }),
  });
  const entries = wrongList.entries;

  const refreshAll = () => {
    countText.setText(`错题 ${progress.getWrongCount()} 首`);
    entries.forEach(({ poem, controller }) => {
      const record = progress.getWrongRecord(poem.id);
      controller.setSubLabel(record ? `错了 ${record.count} 次` : '尚未记录');
      controller.setVariant(record ? 'gold' : 'secondary');
    });
  };

  root.add(
    makeText(
      scene,
      left + 64,
      top + 440,
      '② 书斋里为什么常常是空的？\n答对通关时，ProgressManager 会把这首诗从错题记录里移除；\n想复核书斋展示，可以在这里多写几条，再点下面的按钮查看。',
      {
        size: 14,
        color: S.inkFaint,
        origin: [0, 0],
        align: 'left',
        wrap: width - 128,
        lineSpacing: 9,
      },
    ),
  );

  const openReview = createButton(scene, {
    x: cx - 160,
    y: top + 608,
    width: 280,
    height: 54,
    radius: 20,
    label: '打开错题书斋',
    variant: 'primary',
    fontSize: 20,
    depth: 9202,
    onClick: () => {
      frame.close();
      scene.goTo(SCENES.REVIEW, {});
    },
  });
  root.add(openReview.container);

  const closeButton = createButton(scene, {
    x: cx + 190,
    y: top + 608,
    width: 220,
    height: 54,
    radius: 20,
    label: '关闭',
    variant: 'secondary',
    fontSize: 20,
    depth: 9202,
    onClick: frame.close,
  });
  root.add(closeButton.container);

  refreshAll();
  return root;
}

// ---------------------------------------------------------
// 调试 · 节气诗碑：预览 24 节气 + 7 个农历节日
// ---------------------------------------------------------
/** 节气诗碑面板比其它面板稍大一些：31 块碑铺成 6 列 6 行 */
const STELE_PANEL = { width: 1160, height: 700 };
const STELE_COLS = 6;
const STELE_CARD_W = 162;
const STELE_CARD_H = 54;
const STELE_GAP_X = 12;
const STELE_GAP_Y = 2;

export function openDebugFestivalPanel(scene) {
  if (!DEBUG_TOOLS_ENABLED) return null;

  const today = new Date();
  const todayEvents = getTodayEvents(today);
  const todayIds = new Set(todayEvents.map((event) => event.id));

  const frame = createDebugPanelFrame(
    scene,
    '调试 · 节气诗碑',
    '地图上的限时诗碑由系统日期决定；这里可以强制预览任意一块（只影响本次进入地图，不动存档）。',
    STELE_PANEL,
  );
  const { root, left, top, cx, width, height } = frame;

  root.add(
    makeText(scene, left + width - 64, top + 54, `${SOLAR_TERMS.length} 节气 · ${LUNAR_FESTIVALS.length} 节日`, {
      size: 15,
      color: S.gold,
      origin: [1, 0.5],
    }),
  );

  /** 关掉面板，带着 festivalPreviewId 进入第一章地图 */
  const goStele = (eventId) => {
    frame.close();
    scene.scene.start(SCENES.MAP, { chapterId: 1, festivalPreviewId: eventId });
  };

  // ① 今天真正生效的限时事件
  root.add(
    makeText(
      scene,
      left + 64,
      top + 152,
      `① 今天（${today.getMonth() + 1} 月 ${today.getDate()} 日）地图上的限时诗碑`,
      { size: 14, color: S.inkSoft, origin: [0, 0.5] },
    ),
  );

  if (todayEvents.length > 0) {
    todayEvents.slice(0, 3).forEach((event, index) => {
      const controller = createButton(scene, {
        x: left + 64 + 160 + index * 356,
        y: top + 194,
        width: 320,
        height: 54,
        radius: 18,
        label: `${event.name}诗碑 · ${event.dateLabel}`,
        subLabel: `${event.kind === 'festival' ? '传统节日' : '二十四节气'} · ${
          progress.hasFestival(event.id) ? '已收诗笺' : '未收诗笺'
        }`,
        variant: 'gold',
        fontSize: 18,
        subFontSize: 12,
        depth: 9202,
        onClick: () => goStele(event.id),
      });
      root.add(controller.container);
    });
  } else {
    root.add(
      makeText(
        scene,
        left + 64,
        top + 194,
        '今天既不是节气，也不是传统节日，地图上暂时不会有限时诗碑。',
        { size: 15, color: S.inkFaint, origin: [0, 0.5] },
      ),
    );
  }

  // ② 全部节气 / 节日，点哪块就看哪块
  root.add(
    makeText(
      scene,
      left + 64,
      top + 248,
      '② 预览任意一块（点击后进入第一章地图，溪边草甸会立起这块诗碑）',
      { size: 14, color: S.inkSoft, origin: [0, 0.5] },
    ),
  );

  const gridLeft = cx - (STELE_COLS * STELE_CARD_W + (STELE_COLS - 1) * STELE_GAP_X) / 2;
  const gridTop = top + 268;
  const entries = [
    ...SOLAR_TERMS.map((term) => ({ ...term, kind: 'term' })),
    ...LUNAR_FESTIVALS.map((festival) => ({ ...festival, kind: 'festival' })),
  ];

  entries.forEach((event, index) => {
    const column = index % STELE_COLS;
    const row = Math.floor(index / STELE_COLS);
    const collected = progress.hasFestival(event.id);
    const controller = createButton(scene, {
      x: gridLeft + STELE_CARD_W / 2 + column * (STELE_CARD_W + STELE_GAP_X),
      y: gridTop + STELE_CARD_H / 2 + row * (STELE_CARD_H + STELE_GAP_Y),
      width: STELE_CARD_W,
      height: STELE_CARD_H,
      radius: 14,
      label: event.name,
      subLabel: collected ? '已收诗笺' : event.kind === 'festival' ? '传统节日' : '节气',
      variant: todayIds.has(event.id) ? 'gold' : event.kind === 'festival' ? 'soft' : 'secondary',
      fontSize: 15,
      subFontSize: 11,
      depth: 9202,
      onClick: () => goStele(event.id),
    });
    root.add(controller.container);
  });

  const goToday = createButton(scene, {
    x: cx - 160,
    y: top + height - 52,
    width: 280,
    height: 56,
    radius: 20,
    label: '按今天的日期进地图',
    variant: 'primary',
    fontSize: 19,
    depth: 9202,
    onClick: () => {
      frame.close();
      scene.scene.start(SCENES.MAP, { chapterId: 1 });
    },
  });
  root.add(goToday.container);

  const closeButton = createButton(scene, {
    x: cx + 190,
    y: top + height - 52,
    width: 220,
    height: 56,
    radius: 20,
    label: '关闭',
    variant: 'secondary',
    fontSize: 19,
    depth: 9202,
    onClick: frame.close,
  });
  root.add(closeButton.container);

  return root;
}
