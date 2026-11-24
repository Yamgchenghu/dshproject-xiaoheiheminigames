/**
 * CollectionScene：文房藏品陈列馆（新藏品体系）。
 * ------------------------------------------------------------
 * 数据全部来自 collection_db.json（字段：collection_id / name / desc / rarity / artKey；
 * 其中 ai_prompt 只用于出图，界面上不再展示）。
 * 是否获得由 ProgressManager 统一记录（save.collectionItems），获取即永久解锁、自动存档。
 *
 * 页面布局：
 *  - 按稀有度分三个国风展柜区：普通 · 稀有 · 典藏，每个展柜 4 件；
 *    同稀有度藏品变多时自动分成多个「续柜」，整页可上下拖动查看；
 *  - 已获得：彩色器物剪影 + 名字 + 稀有度签，点开淡彩详情弹窗（名字 / 介绍 / 产出渠道 / 绘本插画）；
 *  - 未获得：整卡置灰，只留一件看不清的剪影，点一下给出获得线索；
 *  - 底部保留原有 8 件「章节典藏成就」小签，只展示、不参与新藏品逻辑。
 *
 * 藏品属于支线收集：不参与章节解锁与课内进度计算。
 */

import { GAME_HEIGHT, GAME_WIDTH, SCENES } from '../config/constants.js';
import { COLLECTION_ITEMS } from '../config/collection.js';
import {
  RARITY_ORDER,
  getCollectionChannelLabel,
  getCollectionHint,
  getRarityMeta,
} from '../config/collections.js';
import { C, FONT_SIZE, S } from '../config/theme.js';
import { dataManager } from '../data/DataManager.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import { backFromSideScene, getReturnLabel } from '../gameplay/sceneNav.js';
import BaseScene from '../ui/BaseScene.js';
import { addSeal, roundedRectPath } from '../ui/background.js';
import {
  createButton,
  createIconButton,
  createTag,
  makeText,
  showModal,
  showToast,
} from '../ui/components.js';
import { ScrollPanel } from '../ui/ScrollPanel.js';
import { addArtwork, hasArtwork } from '../ui/artwork.js';

// 展柜区（可滚动）：6 个展柜叠起来会超过一屏
const PANEL = { x: 32, y: 124, width: 1216, height: 508, radius: 24 };
const PANEL_PAD_TOP = 6;
const PANEL_PAD_BOTTOM = 10;
const DRAG_THRESHOLD = 8; // 拖动超过这个距离算「滚动」，不再当作点击藏品

// 展柜
const SHELF_W = 1168;
const SHELF_H = 156;
const SHELF_GAP = 14;
const LABEL_W = 156;
const SHELF_PAD = 16;
const SHELF_PER_ROW = 4; // 每个展柜 4 件，多出来的分「续柜」

// 藏品卡
const CARD_W = 228;
const CARD_H = 116;

// 底部旧藏品（章节典藏成就）小签
const CHIP_Y = 668;
const CHIP_H = 34;
const CHIP_GAP = 8;

export default class CollectionScene extends BaseScene {
  constructor() {
    super(SCENES.COLLECTION);
  }

  init(data = {}) {
    // 回程场景：从地图 / 关卡进来时回到原地，从主页进来就回主页
    this.returnScene = data.returnScene || SCENES.MENU;
  }

  create() {
    this.prepareScene();
    this.addBackground('paper', { petals: true });

    const total = dataManager.getCollectionCount();
    const owned = progress.getCollectionItemCount();

    this.addHeader({
      title: '文房藏品陈列馆',
      subtitle: '读完诗、集齐轶事，案头就会多一件文房小物',
      onBack: () => this._goBack(),
      backLabel: getReturnLabel(this.returnScene, '主页'),
      rightText: `已收藏 ${owned} / ${total} 件`,
    });

    if (total === 0) {
      showModal(this, {
        title: '陈列馆还空着',
        message: '数据文件中还没有藏品内容。\n等 collection_db.json 补充后，这里会自动出现。',
        sealText: '藏',
        actions: [{ label: '返回', variant: 'primary', onClick: () => this._goBack() }],
      });
      audio.playBgm('menu');
      return;
    }

    // 按稀有度分组：普通 → 稀有 → 典藏；同稀有度每 4 件一个展柜
    this._buildHallPanel();

    let shelfIndex = 0;
    RARITY_ORDER.forEach((rarity) => {
      const items = dataManager.getCollectionsByRarity(rarity);
      for (let start = 0; start < items.length; start += SHELF_PER_ROW) {
        const partItems = items.slice(start, start + SHELF_PER_ROW);
        const shelfTop = PANEL_PAD_TOP + shelfIndex * (SHELF_H + SHELF_GAP);
        this._buildShelf(rarity, partItems, shelfTop, {
          partIndex: Math.floor(start / SHELF_PER_ROW),
        });
        shelfIndex += 1;
      }
    });

    const contentHeight = PANEL_PAD_TOP
      + shelfIndex * SHELF_H
      + Math.max(0, shelfIndex - 1) * SHELF_GAP
      + PANEL_PAD_BOTTOM;
    this.hallScroll.layout(contentHeight, { reset: true });

    this._buildLegacyRow();

    makeText(
      this,
      GAME_WIDTH / 2,
      704,
      '藏品是支线收集：不影响章节解锁，也不改变课内进度（按住展柜上下拖动可看更多）',
      { size: 13, color: S.inkFaint, origin: [0.5, 0.5] },
    ).setDepth(100);

    audio.playBgm('menu');
  }

  /** 返回来源场景：从关卡 / 地图进来时回到原来的地点 */
  _goBack() {
    backFromSideScene(this);
  }

  // ---------------------------------------------------------
  // 展柜区：滚动面板
  // ---------------------------------------------------------
  _buildHallPanel() {
    this.hallScroll = new ScrollPanel(this, {
      x: PANEL.x,
      y: PANEL.y,
      width: PANEL.width,
      height: PANEL.height,
      radius: PANEL.radius,
      depth: 110,
    });
    // 展柜与藏品卡都挂在滚动面板的内容容器里，坐标从面板左上角算起
    this.hallLayer = this.hallScroll.content;

    // 面板内任意位置都能拖动滚动（按在展柜上也能拖），
    // 拖动距离超过阈值就不再当成「点击藏品」
    this._drag = null;
    this._dragMoved = false;
    this.input.on('pointerdown', (pointer) => {
      this._dragMoved = false;
      if (this._detailRoot) return; // 详情弹窗打开时不要滚动后面的展柜
      if (!this._inPanel(pointer)) return;
      this._drag = {
        id: pointer.id,
        startY: pointer.y,
        startScroll: this.hallScroll ? this.hallScroll.scrollY : 0,
      };
    });
    this.input.on('pointermove', (pointer) => {
      const drag = this._drag;
      if (!drag || pointer.id !== drag.id || !this.hallScroll) return;
      const delta = pointer.y - drag.startY;
      if (Math.abs(delta) > DRAG_THRESHOLD) this._dragMoved = true;
      if (this._dragMoved) this.hallScroll.setScroll(drag.startScroll - delta);
    });
    const stopDrag = () => {
      this._drag = null;
    };
    this.input.on('pointerup', stopDrag);
    this.input.on('pointerupoutside', stopDrag);
  }

  _inPanel(pointer) {
    return pointer.x >= PANEL.x
      && pointer.x <= PANEL.x + PANEL.width
      && pointer.y >= PANEL.y
      && pointer.y <= PANEL.y + PANEL.height;
  }

  // ---------------------------------------------------------
  // 国风展柜
  // ---------------------------------------------------------
  _buildShelf(rarity, items, shelfTop, options = {}) {
    const { partIndex = 0 } = options;
    const meta = getRarityMeta(rarity);
    const left = (PANEL.width - SHELF_W) / 2;
    const ownedCount = items.filter((item) => progress.hasCollectionItem(item.collection_id)).length;

    const g = this.add.graphics().setDepth(110);
    // 柜体投影与木框
    g.fillStyle(0x6f6050, 0.1);
    roundedRectPath(g, left + 3, shelfTop + 7, SHELF_W, SHELF_H, 24);
    g.fillPath();
    g.fillStyle(C.paperSoft, 0.94);
    roundedRectPath(g, left, shelfTop, SHELF_W, SHELF_H, 24);
    g.fillPath();
    g.lineStyle(2, meta.tagStroke, 0.42);
    roundedRectPath(g, left, shelfTop, SHELF_W, SHELF_H, 24);
    g.strokePath();

    // 展柜内衬（背板）
    g.fillStyle(C.paper, 0.72);
    roundedRectPath(g, left + 14, shelfTop + 12, SHELF_W - 28, SHELF_H - 26, 18);
    g.fillPath();

    // 左侧稀有度标签条
    g.fillStyle(meta.tagFill, 0.6);
    roundedRectPath(g, left + 14, shelfTop + 12, LABEL_W, SHELF_H - 26, 16);
    g.fillPath();

    // 卡下的隔板，像真的展柜层板
    g.fillStyle(C.paperShade, 0.95);
    roundedRectPath(g, left + SHELF_PAD, shelfTop + SHELF_H - 28, SHELF_W - SHELF_PAD * 2, 7, 3);
    g.fillPath();
    g.lineStyle(1, meta.tagStroke, 0.3);
    g.beginPath();
    g.moveTo(left + SHELF_PAD, shelfTop + SHELF_H - 25);
    g.lineTo(left + SHELF_W - SHELF_PAD, shelfTop + SHELF_H - 25);
    g.strokePath();

    // 金色内细框与标签条分隔线
    g.lineStyle(1, C.gold, 0.28);
    roundedRectPath(g, left + 8, shelfTop + 8, SHELF_W - 16, SHELF_H - 16, 20);
    g.strokePath();
    g.lineStyle(1.2, meta.tagStroke, 0.32);
    g.beginPath();
    g.moveTo(left + 14 + LABEL_W + 8, shelfTop + 26);
    g.lineTo(left + 14 + LABEL_W + 8, shelfTop + SHELF_H - 26);
    g.strokePath();
    this.hallLayer.add(g);

    // 标签条内容：印章 + 稀有度（或「续」柜）+ 小注解 + 进度
    const seal = addSeal(this, left + 56, shelfTop + 50, rarity.slice(0, 1), 42, meta.sealColor);
    seal.setDepth(120);
    this.hallLayer.add(seal);

    const label = partIndex === 0 ? rarity : `${rarity} · 续`;
    this.hallLayer.add(
      makeText(this, left + 92, shelfTop + 40, label, {
        size: partIndex === 0 ? 24 : 18,
        color: S.ink,
        origin: [0, 0.5],
        bold: true,
      }).setDepth(120),
    );
    this.hallLayer.add(
      makeText(this, left + 92, shelfTop + 68, meta.blurb, {
        size: 13,
        color: S.inkSoft,
        origin: [0, 0.5],
      }).setDepth(120),
    );
    this.hallLayer.add(
      makeText(this, left + 92, shelfTop + 104, `已收 ${ownedCount} / ${items.length}`, {
        size: 14,
        color: ownedCount >= items.length ? S.gold : S.inkFaint,
        origin: [0, 0.5],
      }).setDepth(120),
    );

    // 每柜 4 件藏品卡（不足 4 件时靠左对齐）
    const firstCardX = left + LABEL_W + SHELF_PAD + 8 + CARD_W / 2;
    const step = CARD_W + (SHELF_W - LABEL_W - SHELF_PAD * 2 - 8 - CARD_W * SHELF_PER_ROW)
      / (SHELF_PER_ROW - 1);
    items.forEach((item, index) => {
      this._buildCard(item, firstCardX + index * step, shelfTop + 72, index % 4);
    });
  }

  // ---------------------------------------------------------
  // 藏品卡
  // ---------------------------------------------------------
  _buildCard(item, x, y, variant) {
    const meta = getRarityMeta(item.rarity);
    const owned = progress.hasCollectionItem(item.collection_id);

    const card = this.add.container(x, y).setDepth(130);
    const g = this.add.graphics();

    // 卡片本体：有则彩纸 + 稀有度描边，无则灰纸
    g.fillStyle(0x6f6050, owned ? 0.1 : 0.06);
    roundedRectPath(g, -CARD_W / 2 + 2, -CARD_H / 2 + 4, CARD_W, CARD_H, 18);
    g.fillPath();
    g.fillStyle(owned ? C.paper : C.paperDeep, owned ? 0.99 : 0.9);
    roundedRectPath(g, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 18);
    g.fillPath();
    g.lineStyle(1.8, owned ? meta.tagStroke : C.inkLine, owned ? 0.6 : 0.6);
    roundedRectPath(g, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 18);
    g.strokePath();

    // 器物小展台
    g.fillStyle(owned ? meta.barColor : 0xe9e3d6, owned ? 0.32 : 0.5);
    roundedRectPath(g, -CARD_W / 2 + 10, -CARD_H / 2 + 9, CARD_W - 20, 60, 12);
    g.fillPath();
    card.add(g);

    // 器物剪影
    const silhouette = this.add.graphics();
    this._drawRelic(silhouette, 0, -30, variant, owned ? meta.sealColor : 0xafa695, owned ? 1 : 0.7);
    card.add(silhouette);

    // 名字：未获得只给剪影，不剧透
    card.add(
      makeText(this, 0, 16, owned ? item.name : '？ ？ ？', {
        size: 20,
        color: owned ? S.ink : S.mute,
        origin: [0.5, 0.5],
      }),
    );

    // 稀有度 / 状态签
    const tag = createTag(this, 0, 0, owned ? item.rarity : '未获得', {
      fill: owned ? meta.tagFill : C.paperDeep,
      textColor: owned ? meta.tagText : S.mute,
      fontSize: 13,
      height: 26,
      paddingX: 12,
      strokeColor: owned ? meta.tagStroke : C.inkFaint,
    });
    tag.container.setPosition(0, 44);
    card.add(tag.container);

    // 未获得：盖一层很淡的灰纱
    if (!owned) {
      const veil = this.add.graphics();
      veil.fillStyle(0x8d8578, 0.08);
      roundedRectPath(veil, -CARD_W / 2 + 2, -CARD_H / 2 + 2, CARD_W - 4, CARD_H - 4, 16);
      veil.fillPath();
      card.add(veil);
    }

    const zone = this.add.zone(0, 0, CARD_W, CARD_H).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      this.tweens.add({ targets: card, scaleX: 1.02, scaleY: 1.02, duration: 120 });
    });
    zone.on('pointerout', () => {
      this.tweens.add({ targets: card, scaleX: 1, scaleY: 1, duration: 120 });
    });
    zone.on('pointerdown', () => {
      this._dragMoved = false;
    });
    zone.on('pointerup', () => {
      if (this._dragMoved) return; // 拖动滚动中，不算点击
      audio.playClick();
      if (!owned) {
        showToast(this, `还是一件剪影。${getCollectionHint()}`, { y: 628, duration: 3000 });
        return;
      }
      this._openDetail(item, variant);
    });
    card.add(zone);

    this.hallLayer.add(card);
  }

  /**
   * 简笔器物剪影：四种形状轮换（笔 / 砚 / 印 / 水盂），
   * 有藏品时用稀有度色，未获得时统一灰陶色。
   */
  _drawRelic(g, cx, cy, variant, color, alpha) {
    g.fillStyle(color, alpha);
    g.lineStyle(3, color, alpha * 0.9);

    if (variant === 0) {
      // 毛笔：笔杆斜搁 + 笔锋
      g.beginPath();
      g.moveTo(cx - 26, cy + 16);
      g.lineTo(cx + 22, cy - 18);
      g.strokePath();
      g.fillTriangle(
        cx - 26, cy + 16,
        cx - 36, cy + 22,
        cx - 22, cy + 26,
      );
      g.fillCircle(cx + 22, cy - 18, 3.5);
    } else if (variant === 1) {
      // 砚台：方砚 + 砚池
      g.fillRoundedRect(cx - 26, cy - 12, 52, 26, 7);
      g.fillStyle(0xffffff, alpha * 0.5);
      g.fillEllipse(cx, cy + 1, 34, 12);
    } else if (variant === 2) {
      // 印章：印身 + 印钮
      g.fillRoundedRect(cx - 17, cy - 6, 34, 26, 5);
      g.fillRect(cx - 7, cy - 20, 14, 14);
      g.fillStyle(0xffffff, alpha * 0.45);
      g.fillRect(cx - 10, cy + 6, 20, 3);
    } else {
      // 水盂：小口圆腹
      g.fillEllipse(cx, cy + 4, 36, 28);
      g.fillRect(cx - 8, cy - 22, 16, 14);
      g.fillStyle(0xffffff, alpha * 0.4);
      g.fillEllipse(cx - 8, cy + 1, 8, 5);
    }
  }

  // ---------------------------------------------------------
  // 底部：原有 8 件章节典藏成就（只展示，逻辑不变）
  // ---------------------------------------------------------
  _buildLegacyRow() {
    const ownedIds = new Set(progress.getCollectionIds());
    makeText(this, 64, CHIP_Y, `典藏成就 ${ownedIds.size} / ${COLLECTION_ITEMS.length}`, {
      size: 15,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(120);

    const startX = 232;
    const chipW = (GAME_WIDTH - 96 - startX - CHIP_GAP * (COLLECTION_ITEMS.length - 1))
      / COLLECTION_ITEMS.length;

    COLLECTION_ITEMS.forEach((item, index) => {
      const owned = ownedIds.has(item.id);
      const x = startX + chipW / 2 + index * (chipW + CHIP_GAP);
      const chip = this.add.container(x, CHIP_Y).setDepth(120);

      const g = this.add.graphics();
      g.fillStyle(owned ? C.goldLight : C.paperDeep, owned ? 0.85 : 0.5);
      roundedRectPath(g, -chipW / 2, -CHIP_H / 2, chipW, CHIP_H, 12);
      g.fillPath();
      g.lineStyle(1.2, owned ? C.gold : C.inkLine, owned ? 0.65 : 0.5);
      roundedRectPath(g, -chipW / 2, -CHIP_H / 2, chipW, CHIP_H, 12);
      g.strokePath();
      chip.add(g);

      chip.add(
        makeText(this, -chipW / 2 + 16, 0, item.glyph, {
          size: 15,
          color: owned ? S.gold : S.mute,
          origin: [0, 0.5],
        }),
      );
      chip.add(
        makeText(this, -chipW / 2 + 34, 0, owned ? item.name : '未得', {
          size: 13,
          color: owned ? S.ink : S.mute,
          origin: [0, 0.5],
          wrap: chipW - 44,
        }).setAlpha(owned ? 1 : 0.75),
      );

      const zone = this.add.zone(0, 0, chipW, CHIP_H).setInteractive({ useHandCursor: true });
      zone.on('pointerdown', () => {
        audio.playClick();
        if (!owned) {
          showToast(this, `尚未获得。${item.source}`, { y: 628, duration: 2800 });
          return;
        }
        this._openLegacyDetail(item);
      });
      chip.add(zone);
    });
  }

  // ---------------------------------------------------------
  // 详情弹窗（新藏品：名字 / 介绍 / 插画占位）
  // ---------------------------------------------------------
  _openDetail(item, variant) {
    audio.playPage();

    const meta = getRarityMeta(item.rarity);
    const panelW = 1000;
    const panelH = 600;
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    const root = this.add.container(0, 0).setDepth(9200).setScrollFactor(0);
    const blocker = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x2e3a34, 0.45)
      .setOrigin(0)
      .setScrollFactor(0)
      .setInteractive();
    root.add(blocker);

    const panel = this.add.graphics();
    panel.fillStyle(0x4b4130, 0.13);
    roundedRectPath(panel, left + 3, top + 8, panelW, panelH, 30);
    panel.fillPath();
    panel.fillStyle(C.paperSoft, 0.985);
    roundedRectPath(panel, left, top, panelW, panelH, 30);
    panel.fillPath();
    panel.lineStyle(2, C.inkFaint, 0.45);
    roundedRectPath(panel, left, top, panelW, panelH, 30);
    panel.strokePath();
    panel.lineStyle(1, C.gold, 0.28);
    roundedRectPath(panel, left + 9, top + 9, panelW - 18, panelH - 18, 22);
    panel.strokePath();
    panel.lineStyle(1.4, C.gold, 0.38);
    panel.beginPath();
    panel.moveTo(left + 64, top + 96);
    panel.lineTo(left + panelW - 64, top + 96);
    panel.strokePath();
    root.add(panel);

    root.add(addSeal(this, left + 56, top + 54, '藏', 44, meta.sealColor));
    root.add(
      makeText(this, cx, top + 54, item.name, {
        size: FONT_SIZE.xl,
        color: S.ink,
        origin: [0.5, 0.5],
        wrap: panelW - 260,
        bold: true,
      }),
    );

    // 左侧插画占位
    this._buildIllustration(root, left + 36, top + 112, 372, 292, item, variant);

    // 右侧介绍
    const textX = left + 440;
    const textWrap = 520;
    const rarityTag = createTag(this, 0, 0, `${item.rarity} · ${meta.blurb}`, {
      fill: meta.tagFill,
      textColor: meta.tagText,
      fontSize: 13,
      height: 28,
      paddingX: 14,
      strokeColor: meta.tagStroke,
      depth: 9201,
    });
    rarityTag.container.setPosition(textX + rarityTag.width / 2, top + 124);
    root.add(rarityTag.container);

    // 产出渠道：让玩家知道这件藏品主要从哪里获得
    root.add(
      makeText(this, textX + rarityTag.width + 16, top + 124, `产出渠道：${getCollectionChannelLabel(item.channel)}`, {
        size: 13,
        color: S.inkSoft,
        origin: [0, 0.5],
      }),
    );

    const descText = makeText(this, textX, top + 158, item.desc, {
      size: 21,
      color: S.ink,
      origin: [0, 0],
      align: 'left',
      wrap: textWrap,
      lineSpacing: 13,
    });
    root.add(descText);

    const ownedText = makeText(
      this,
      textX,
      Math.min(top + 302, descText.y + descText.height + 26),
      '已收进书箧 · 正在陈列馆展出',
      { size: 16, color: S.gold, origin: [0, 0] },
    );
    root.add(ownedText);

    const close = () => {
      if (!root.scene) return;
      root.destroy(true);
      this._detailRoot = null;
    };

    const button = createButton(this, {
      x: cx,
      y: top + panelH - 54,
      width: 300,
      height: 64,
      label: '放回展柜',
      variant: 'primary',
      fontSize: FONT_SIZE.md,
      depth: 9202,
      onClick: close,
    });
    root.add(button.container);

    const xButton = createIconButton(this, {
      x: left + panelW - 42,
      y: top + 42,
      size: 46,
      icon: '×',
      variant: 'ghost',
      onClick: close,
      depth: 9202,
    });
    root.add(xButton.container);

    this._detailRoot = root;
    root.setAlpha(0);
    root.y = 16;
    this.tweens.add({
      targets: root,
      alpha: 1,
      y: 0,
      duration: 260,
      ease: 'Sine.easeOut',
    });
  }

  /** 插画：有绘本图就铺真图，没有就画器物占位图 */
  _buildIllustration(root, x, y, width, height, item, variant) {
    if (hasArtwork(this, item.artKey)) {
      addArtwork(this, {
        key: item.artKey,
        x,
        y,
        width,
        height,
        radius: 16,
        parent: root,
      });

      const frame = this.add.graphics();
      frame.lineStyle(2, C.inkFaint, 0.55);
      roundedRectPath(frame, x, y, width, height, 16);
      frame.strokePath();
      frame.lineStyle(1, C.gold, 0.3);
      roundedRectPath(frame, x + 7, y + 7, width - 14, height - 14, 11);
      frame.strokePath();
      root.add(frame);

      const badge = createTag(this, 0, 0, '绘本插画', {
        fill: C.paperSoft,
        textColor: S.inkSoft,
        fontSize: 12,
        height: 26,
        paddingX: 12,
        strokeColor: C.inkLine,
        depth: 9201,
      });
      badge.container.setPosition(x + width / 2, y + 26);
      root.add(badge.container);

      root.add(
        makeText(this, x + width / 2, y + height + 16, '器物小像 · 照着实物描的', {
          size: 13,
          color: S.inkFaint,
          origin: [0.5, 0.5],
        }),
      );
      return;
    }

    const meta = getRarityMeta(item.rarity);
    const art = this.add.graphics();
    art.fillStyle(0x6f6050, 0.08);
    roundedRectPath(art, x + 2, y + 5, width, height, 16);
    art.fillPath();
    art.fillStyle(C.paper, 1);
    roundedRectPath(art, x, y, width, height, 16);
    art.fillPath();

    // 天光与远山
    art.fillStyle(0xf6e7c9, 0.5);
    art.fillCircle(x + width - 74, y + 58, 22);
    art.fillStyle(meta.barColor, 0.35);
    art.fillPoints([
      { x, y: y + 196 },
      { x: x + 76, y: y + 126 },
      { x: x + 146, y: y + 192 },
      { x: x + 220, y: y + 118 },
      { x: x + 294, y: y + 186 },
      { x: x + width, y: y + 148 },
      { x: x + width, y: y + height - 46 },
      { x, y: y + height - 46 },
    ], true);

    // 展台与器物剪影
    art.fillStyle(C.paperShade, 0.55);
    art.fillEllipse(x + width / 2, y + height - 62, 236, 28);
    root.add(art);

    const relic = this.add.graphics();
    this._drawRelic(relic, 0, 0, variant, meta.sealColor, 0.95);
    relic.setScale(2.1);
    relic.setPosition(x + width / 2, y + height - 120);
    root.add(relic);

    const frame = this.add.graphics();
    frame.lineStyle(2, C.inkFaint, 0.55);
    roundedRectPath(frame, x, y, width, height, 16);
    frame.strokePath();
    frame.lineStyle(1, C.gold, 0.3);
    roundedRectPath(frame, x + 7, y + 7, width - 14, height - 14, 11);
    frame.strokePath();
    root.add(frame);

    const badge = createTag(this, 0, 0, '小像还在绘制中', {
      fill: C.paperSoft,
      textColor: S.inkSoft,
      fontSize: 12,
      height: 26,
      paddingX: 12,
      strokeColor: C.inkLine,
      depth: 9201,
    });
    badge.container.setPosition(x + width / 2, y + 26);
    root.add(badge.container);

    root.add(
      makeText(this, x + width / 2, y + height + 16, '这一页的小像还在慢慢画', {
        size: 13,
        color: S.inkFaint,
        origin: [0.5, 0.5],
      }),
    );
  }

  /** 旧藏品（章节典藏成就）详情：保持原有文案风格 */
  _openLegacyDetail(item) {
    audio.playPage();
    showModal(this, {
      title: item.name,
      sealText: item.glyph,
      width: 860,
      message: `${item.desc}\n\n获得方式：${item.source}\n\n这件小物已经摆在诗童的书案上，会一直陪着你读诗。`,
      actions: [{ label: '放回案头', variant: 'primary' }],
    });
  }
}
