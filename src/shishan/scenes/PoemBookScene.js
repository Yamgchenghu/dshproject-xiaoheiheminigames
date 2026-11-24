/**
 * PoemBookScene：诗卡图鉴。
 * 展示全部诗卡（未解锁显示待寻），支持按课内/拓展/隐藏筛选，
 * 点击已解锁诗卡可查看全诗、拼音、译文、小贴士与作者信息。
 */

import { GAME_HEIGHT, GAME_WIDTH, SCENES } from '../config/constants.js';
import { C, FONT_SIZE, S } from '../config/theme.js';
import { dataManager } from '../data/DataManager.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import BaseScene from '../ui/BaseScene.js';
import {
  createButton,
  createIconButton,
  createPaperPanel,
  createStarRow,
  createTag,
  makeText,
  showToast,
} from '../ui/components.js';
import { addSeal, roundedRectPath } from '../ui/background.js';
import { ScrollPanel } from '../ui/ScrollPanel.js';
import { addRecitationButton } from '../ui/poemRecitation.js';

const CARD_W = 260;
const CARD_H = 184;
const CARD_GAP_X = 22;
const CARD_GAP_Y = 20;
const CARD_COLUMNS = 4;

// 诗卡网格的滚动区域（诗篇变多后，一屏放不下，需要滚动查看）
const GRID_PANEL = { x: 32, y: 184, width: 1216, height: 456, radius: 24 };
const GRID_PAD_TOP = 10;
const GRID_PAD_BOTTOM = 14;
const DRAG_THRESHOLD = 8; // 拖动超过这个距离算「滚动」，不再当作点击诗卡

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'core', label: '课内' },
  { key: 'extend', label: '拓展' },
  { key: 'hidden', label: '隐藏' },
];

export default class PoemBookScene extends BaseScene {
  constructor() {
    super(SCENES.POEM_BOOK);
  }

  create() {
    this.prepareScene();
    this.addBackground('paper', { petals: true });
    this.currentFilter = 'all';
    this.filterButtons = {};

    this.addHeader({
      title: '诗卡图鉴',
      subtitle: '把走过的诗路，一张张收进诗卷',
      onBack: () => this.goTo(SCENES.MENU, {}),
      backLabel: '主页',
      rightText: `已点亮 ${progress.getUnlockedCardIds().length} / ${dataManager.getTotalPoemCount()} 张`,
    });

    this._buildFilters();
    this._buildGridPanel();
    this._rebuildGrid(true);

    makeText(this, GAME_WIDTH / 2, 660, '点击已点亮的诗卡，可以查看全诗、拼音与译文', {
      size: 14,
      color: S.inkFaint,
      origin: [0.5, 0.5],
    }).setDepth(100);

    audio.playSceneBgm('PoemBookScene');
  }

  _buildFilters() {
    const startX = 210;
    FILTERS.forEach((filter, index) => {
      const counts = this._filterCounts();
      const button = createButton(this, {
        x: startX + index * 178,
        y: 146,
        width: 160,
        height: 50,
        radius: 25,
        label: `${filter.label} ${counts[filter.key]}`,
        fontSize: 17,
        variant: filter.key === this.currentFilter ? 'tabActive' : 'tab',
        onClick: () => this._setFilter(filter.key),
        depth: 300,
      });
      this.filterButtons[filter.key] = button;
    });

    // 收藏进度小条
    const percent = Math.round(
      (progress.getUnlockedCardIds().length / Math.max(1, dataManager.getTotalPoemCount())) * 100,
    );
    makeText(this, GAME_WIDTH - 78, 146, `收藏度 ${percent}%`, {
      size: 15,
      color: S.inkSoft,
      origin: [1, 0.5],
    }).setDepth(300);
  }

  // ---------------------------------------------------------
  // 诗卡网格：滚动面板
  // ---------------------------------------------------------
  _buildGridPanel() {
    this.gridScroll = new ScrollPanel(this, {
      x: GRID_PANEL.x,
      y: GRID_PANEL.y,
      width: GRID_PANEL.width,
      height: GRID_PANEL.height,
      radius: GRID_PANEL.radius,
      depth: 120,
    });
    // 诗卡都挂在滚动面板的内容容器里，坐标从面板左上角算起
    this.gridLayer = this.gridScroll.content;

    // 面板内任意位置都能拖动滚动（按在诗卡上也能拖），
    // 拖动距离超过阈值就不再当成「点击诗卡」
    this._gridDrag = null;
    this._gridDragMoved = false;
    this.input.on('pointerdown', (pointer) => {
      this._gridDragMoved = false;
      if (this.detailRoot) return; // 详情弹窗打开时不要滚动后面的网格
      if (!this._inGridPanel(pointer)) return;
      this._gridDrag = {
        id: pointer.id,
        startY: pointer.y,
        startScroll: this.gridScroll ? this.gridScroll.scrollY : 0,
      };
    });
    this.input.on('pointermove', (pointer) => {
      const drag = this._gridDrag;
      if (!drag || pointer.id !== drag.id || !this.gridScroll) return;
      const delta = pointer.y - drag.startY;
      if (Math.abs(delta) > DRAG_THRESHOLD) this._gridDragMoved = true;
      if (this._gridDragMoved) this.gridScroll.setScroll(drag.startScroll - delta);
    });
    const stopDrag = () => {
      this._gridDrag = null;
    };
    this.input.on('pointerup', stopDrag);
    this.input.on('pointerupoutside', stopDrag);
  }

  _inGridPanel(pointer) {
    return pointer.x >= GRID_PANEL.x
      && pointer.x <= GRID_PANEL.x + GRID_PANEL.width
      && pointer.y >= GRID_PANEL.y
      && pointer.y <= GRID_PANEL.y + GRID_PANEL.height;
  }

  _filterCounts() {
    const poems = dataManager.getAllPoems();
    return {
      all: poems.length,
      core: poems.filter((poem) => poem.type === 'core' && !poem.is_hidden).length,
      extend: poems.filter((poem) => poem.type === 'extend').length,
      hidden: poems.filter((poem) => poem.is_hidden).length,
    };
  }

  _setFilter(key) {
    if (this.currentFilter === key) return;
    this.currentFilter = key;
    Object.entries(this.filterButtons).forEach(([filterKey, button]) => {
      button.setVariant(filterKey === key ? 'tabActive' : 'tab');
    });
    this._rebuildGrid(true);
  }

  _filteredPoems() {
    const poems = dataManager.getAllPoems();
    if (this.currentFilter === 'core') {
      return poems.filter((poem) => poem.type === 'core' && !poem.is_hidden);
    }
    if (this.currentFilter === 'extend') {
      return poems.filter((poem) => poem.type === 'extend');
    }
    if (this.currentFilter === 'hidden') {
      return poems.filter((poem) => poem.is_hidden);
    }
    return poems;
  }

  _rebuildGrid(resetScroll = false) {
    this.gridLayer.removeAll(true);
    const poems = this._filteredPoems();

    if (poems.length === 0) {
      const empty = makeText(this, GRID_PANEL.width / 2, GRID_PANEL.height / 2, '这一栏还空着，去诗山里找找吧。', {
        size: 22,
        color: S.inkSoft,
        origin: [0.5, 0.5],
      });
      this.gridLayer.add(empty);
      this.gridScroll.layout(GRID_PANEL.height, { reset: true });
      return;
    }

    const rowCount = Math.ceil(poems.length / CARD_COLUMNS);
    poems.forEach((poem, index) => {
      const row = Math.floor(index / CARD_COLUMNS);
      const column = index % CARD_COLUMNS;
      const itemsInRow = Math.min(CARD_COLUMNS, poems.length - row * CARD_COLUMNS);
      const rowWidth = itemsInRow * CARD_W + (itemsInRow - 1) * CARD_GAP_X;
      const startX = (GRID_PANEL.width - rowWidth) / 2 + CARD_W / 2;
      const x = startX + column * (CARD_W + CARD_GAP_X);
      const y = GRID_PAD_TOP + row * (CARD_H + CARD_GAP_Y) + CARD_H / 2;
      this._buildCard(poem, x, y);
    });

    const contentHeight = GRID_PAD_TOP
      + rowCount * CARD_H
      + Math.max(0, rowCount - 1) * CARD_GAP_Y
      + GRID_PAD_BOTTOM;
    this.gridScroll.layout(contentHeight, { reset: resetScroll });
  }

  _buildCard(poem, x, y) {
    const unlocked = progress.isCardUnlocked(poem.id);
    const record = progress.getPoemRecord(poem.id);
    const card = this.add.container(x, y).setDepth(120);

    const graphics = this.add.graphics();
    if (unlocked) {
      graphics.fillStyle(0x6f6050, 0.1);
      roundedRectPath(graphics, -CARD_W / 2 + 2, -CARD_H / 2 + 5, CARD_W, CARD_H, 22);
      graphics.fillPath();
      graphics.fillStyle(C.paperSoft, 0.98);
      roundedRectPath(graphics, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 22);
      graphics.fillPath();
      graphics.lineStyle(1.8, C.inkFaint, 0.55);
      roundedRectPath(graphics, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 22);
      graphics.strokePath();
      graphics.lineStyle(1, C.gold, 0.3);
      roundedRectPath(graphics, -CARD_W / 2 + 7, -CARD_H / 2 + 7, CARD_W - 14, CARD_H - 14, 17);
      graphics.strokePath();
      graphics.fillStyle(poem.type === 'core' ? C.pineLight : C.goldLight, 0.5);
      graphics.fillRoundedRect(-CARD_W / 2 + 10, CARD_H / 2 - 22, CARD_W - 20, 6, 3);
    } else {
      graphics.fillStyle(C.paperDeep, 0.8);
      roundedRectPath(graphics, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 22);
      graphics.fillPath();
      graphics.lineStyle(1.6, C.inkLine, 0.7);
      roundedRectPath(graphics, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 22);
      graphics.strokePath();
    }
    card.add(graphics);

    if (unlocked) {
      const typeLabel = poem.is_hidden ? '隐藏' : poem.type === 'core' ? '课内' : '拓展';
      const tag = createTag(this, 0, 0, typeLabel, {
        fill: poem.is_hidden ? C.goldLight : poem.type === 'core' ? C.pineLight : 0xf4ead7,
        textColor: poem.is_hidden ? S.gold : poem.type === 'core' ? S.pineDeep : '#8b7048',
        fontSize: 13,
        height: 27,
        paddingX: 12,
        depth: 121,
        strokeColor: poem.is_hidden ? C.gold : poem.type === 'core' ? C.pine : C.inkFaint,
      });
      tag.container.setPosition(-CARD_W / 2 + tag.width / 2 + 15, -CARD_H / 2 + 22);
      card.add(tag.container);

      const stars = createStarRow(this, {
        x: CARD_W / 2 - 58,
        y: -CARD_H / 2 + 21,
        stars: record?.stars || 0,
        size: 16,
        gap: 2,
        depth: 121,
      });
      card.add(stars.container);

      const title = makeText(this, 0, -30, poem.title, {
        size: 27,
        color: S.ink,
        origin: [0.5, 0.5],
        wrap: CARD_W - 30,
      });
      card.add(title);

      const author = makeText(this, 0, 10, `${poem.dynasty} · ${poem.author}`, {
        size: 16,
        color: S.inkSoft,
        origin: [0.5, 0.5],
      });
      card.add(author);

      const line = this.add.graphics();
      line.lineStyle(1, C.gold, 0.35);
      line.beginPath();
      line.moveTo(-64, 34);
      line.lineTo(64, 34);
      line.strokePath();
      card.add(line);

      const chapterName = this._chapterShort(poem.chapter);
      const meta = makeText(this, 0, 54, `${chapterName} · ${poem.area}`, {
        size: 13,
        color: S.inkFaint,
        origin: [0.5, 0.5],
        wrap: CARD_W - 28,
      });
      card.add(meta);

      // 小朱印
      card.add(addSeal(this, CARD_W / 2 - 28, CARD_H / 2 - 26, '读', 28, C.peachDeep));
    } else {
      card.add(makeText(this, 0, -18, '？', {
        size: 44,
        color: S.mute,
        origin: [0.5, 0.5],
      }).setAlpha(0.6));
      card.add(
        makeText(this, 0, 26, '尚未寻得', {
          size: 18,
          color: S.mute,
          origin: [0.5, 0.5],
        }),
      );
      card.add(
        makeText(this, 0, 54, '去地图上的石碑读一读', {
          size: 12,
          color: S.inkFaint,
          origin: [0.5, 0.5],
        }),
      );
    }

    const zone = this.add
      .zone(0, 0, CARD_W, CARD_H)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      this.tweens.add({ targets: card, scaleX: 1.025, scaleY: 1.025, duration: 120 });
    });
    zone.on('pointerout', () => {
      this.tweens.add({ targets: card, scaleX: 1, scaleY: 1, duration: 120 });
    });
    zone.on('pointerdown', () => {
      this._gridDragMoved = false;
    });
    zone.on('pointerup', () => {
      // 手指按在诗卡上拖动是「滚动图鉴」，不当作点击
      if (this._gridDragMoved) return;
      audio.playClick();
      if (!unlocked) {
        showToast(this, '这张诗卡还在诗山里等你。去地图上找到那块石碑，答对诗题就能点亮它。', {
          y: 640,
          duration: 2200,
        });
        return;
      }
      this._openDetail(poem);
    });
    card.add(zone);

    this.gridLayer.add(card);
  }

  _chapterShort(chapterId) {
    const names = {
      1: '青芽谷',
      2: '清溪渡',
      3: '松风书院',
      4: '云涧古观',
      5: '云麓文庄',
      6: '凌霄诗台',
    };
    return names[chapterId] || `第${chapterId}章`;
  }

  // ---------------------------------------------------------
  // 诗卡详情
  // ---------------------------------------------------------
  _openDetail(poem) {
    if (this.detailRoot) return;
    audio.playPage();

    const root = this.add.container(0, 0).setDepth(9200).setScrollFactor(0);
    this.detailRoot = root;

    const blocker = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x2e3a34, 0.42)
      .setOrigin(0)
      .setInteractive();
    root.add(blocker);

    // 纸卡加入 root，关闭详情时随容器一起销毁；先加入才能垫在文字下面
    const panel = createPaperPanel(this, {
      x: GAME_WIDTH / 2,
      y: GAME_HEIGHT / 2,
      width: 1000,
      height: 600,
      fill: C.paperSoft,
      depth: 0,
    });
    root.add(panel);

    // 标题区
    const headerSeal = addSeal(this, 196, 116, poem.is_hidden ? '隐' : '诗', 48, C.peachDeep);
    headerSeal.setDepth(9202);
    root.add(headerSeal);

    const title = makeText(this, 236, 102, poem.title, {
      size: 34,
      color: S.ink,
      origin: [0, 0.5],
      wrap: 700,
    }).setDepth(9202);
    root.add(title);

    const author = makeText(this, 240, 140, `${poem.dynasty} · ${poem.author}　·　${this._chapterShort(poem.chapter)} / ${poem.area}`, {
      size: 16,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(9202);
    root.add(author);

    const stars = createStarRow(this, {
      x: 1016,
      y: 108,
      stars: progress.getPoemRecord(poem.id)?.stars || 0,
      size: 22,
      gap: 4,
      depth: 9202,
    });
    root.add(stars.container);

    const tags = [
      poem.type === 'core' ? '课内' : '拓展',
      poem.is_hidden ? '隐藏诗卡' : '',
      `难度 ${poem.difficulty}`,
    ].filter(Boolean);
    let tagX = 240;
    tags.forEach((label) => {
      const tag = createTag(this, 0, 0, label, {
        fill: C.pineLight,
        textColor: S.pineDeep,
        fontSize: 12,
        height: 26,
        paddingX: 12,
        depth: 9202,
        strokeColor: C.pine,
      });
      tag.container.setPosition(tagX + tag.width / 2, 172);
      root.add(tag.container);
      tagX += tag.width + 10;
    });

    // 关闭按钮
    const closeButton = createIconButton(this, {
      x: 1112,
      y: 90,
      size: 46,
      icon: '×',
      variant: 'ghost',
      depth: 9240,
      onClick: () => this._closeDetail(),
    });
    root.add(closeButton.container);

    const scroll = new ScrollPanel(this, {
      x: 200,
      y: 198,
      width: 880,
      height: 352,
      radius: 18,
      depth: 9210,
    });
    this.detailScroll = scroll;

    let cursorY = 0;
    const wrapWidth = 844;
    const addBlock = (content, options = {}) => {
      const {
        size = 20,
        color = S.inkSoft,
        gap = 16,
        align = 'left',
        lineSpacing,
      } = options;
      const text = makeText(this, 0, cursorY, content, {
        size,
        color,
        align,
        wrap: wrapWidth,
        origin: [0, 0],
        lineSpacing,
      });
      scroll.add(text);
      cursorY += text.height + gap;
      return text;
    };
    const addSection = (label) => {
      const tag = createTag(this, 0, 0, label, {
        fill: C.paperDeep,
        textColor: S.gold,
        fontSize: 13,
        height: 28,
        paddingX: 13,
        strokeColor: C.gold,
        depth: 9211,
      });
      tag.container.setPosition(tag.width / 2, cursorY + 14);
      scroll.add(tag.container);
      cursorY += 44;
    };

    addBlock(poem.full_text, {
      size: 27,
      color: S.ink,
      gap: 14,
      lineSpacing: 14,
    });
    addBlock(poem.pinyin_text, {
      size: 16,
      color: S.inkFaint,
      gap: 22,
      lineSpacing: 8,
    });

    addSection('译文');
    addBlock(poem.translation, { size: 19, color: S.inkSoft, gap: 20 });

    addSection('小贴士');
    addBlock(poem.tip, { size: 18, color: S.inkSoft, gap: 20 });

    addSection('作者');
    addBlock(
      `${poem.author}，${poem.dynasty}代诗人。本篇收录于第${poem.chapter}章「${this._chapterShort(poem.chapter)}」· ${poem.area}。`,
      { size: 16, color: S.inkSoft, gap: 14 },
    );

    if (poem.tags?.length) {
      addBlock(`标签：${poem.tags.join(' · ')}`, { size: 14, color: S.inkFaint, gap: 20 });
    }

    if (poem.anecdote_id) {
      addSection('轶事');
      const anecdote = dataManager.getAnecdoteById(poem.anecdote_id);
      if (anecdote) {
        if (progress.hasAnecdote(anecdote.anecdote_id)) {
          addBlock(`《${anecdote.title}》\n${anecdote.content}`, {
            size: 17,
            color: S.inkSoft,
            gap: 14,
          });
        } else {
          addBlock('这枚轶事碎片还藏在诗题之后，完成本诗即可收集。', {
            size: 15,
            color: S.inkFaint,
            gap: 14,
          });
        }
      }
    }

    scroll.layout(cursorY + 10);
    scroll.scrollToTop();

    // 底部：听一听 / 抄一抄
    this.detailRecitation = addRecitationButton(this, {
      x: 550,
      y: 604,
      poem,
      width: 132,
      height: 50,
      depth: 2000,
    });
    root.add(this.detailRecitation.button.container);

    const excerptButton = createButton(this, {
      x: 712,
      y: 604,
      width: 172,
      height: 50,
      label: '摘抄这一首',
      variant: 'gold',
      fontSize: 18,
      depth: 2000,
      onClick: () => {
        this._closeDetail();
        this.goTo(SCENES.EXCERPT, { poemId: poem.id });
      },
    });
    root.add(excerptButton.container);

    root.add(
      makeText(this, GAME_WIDTH / 2, 568, '先听一遍，再挑喜欢的句子抄在诗笺上。', {
        size: 13,
        color: S.inkFaint,
        origin: [0.5, 0.5],
      }),
    );
  }

  _closeDetail() {
    if (this.detailRecitation) {
      this.detailRecitation.stop();
      this.detailRecitation = null;
    }
    if (this.detailScroll) {
      this.detailScroll.destroy();
      this.detailScroll = null;
    }
    if (this.detailRoot) {
      this.detailRoot.destroy(true);
      this.detailRoot = null;
    }
    audio.playClick();
  }
}
