/**
 * AnecdoteScene：逸闻册。
 * ------------------------------------------------------------
 * 数据全部来自 anecdote_db.json；与诗篇的关联通过 poem.anecdote_id。
 *
 * 每段轶事拆成 3 片碎片（<anecdote_id>_fragment_1/2/3）：
 *  - 未集齐：卡片呈灰纸色，展示 3 格碎片进度条（1/3、2/3），点开只给寻找线索；
 *  - 已集齐：彩色卡片，点开淡彩详情弹窗，含绘本插画与轶事正文（ai_prompt 只用于出图，界面不展示）。
 *
 * 碎片属于支线收集，不参与章节解锁与课内进度计算。
 */

import { GAME_HEIGHT, GAME_WIDTH, SCENES } from '../config/constants.js';
import { getChapterName } from '../config/chapters.js';
import { C, FONT_SIZE, S } from '../config/theme.js';
import { FRAGMENT_PER_ANECDOTE } from '../config/anecdoteFragments.js';
import { dataManager } from '../data/DataManager.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import { getAnecdoteFragmentState } from '../gameplay/anecdoteFragments.js';
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

// 轶事卡网格：轶事变多后一屏放不下，改成 4 列可滚动
const CARD_W = 284;
const CARD_H = 224;
const CARD_COLUMNS = 4;
const CARD_GAP_X = 16;
const CARD_GAP_Y = 18;

const PANEL = { x: 32, y: 120, width: 1216, height: 510, radius: 24 };
const PANEL_PAD_TOP = 8;
const PANEL_PAD_BOTTOM = 12;
const DRAG_THRESHOLD = 8; // 拖动超过这个距离算「滚动」，不再当作点击卡片

const ROW_W = CARD_COLUMNS * CARD_W + (CARD_COLUMNS - 1) * CARD_GAP_X;

/** 把长文截断成卡片预览 */
function previewText(text, max = 132) {
  const value = String(text || '').replace(/\n+/g, ' ');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export default class AnecdoteScene extends BaseScene {
  constructor() {
    super(SCENES.ANECDOTE);
  }

  init(data = {}) {
    // 回程场景：从地图 / 关卡进来时回到原地，从主页进来就回主页
    this.returnScene = data.returnScene || SCENES.MENU;
  }

  create() {
    this.prepareScene();
    this.addBackground('paper', { petals: true });

    const anecdotes = dataManager.getAllAnecdotes();
    const totals = progress.getAnecdoteFragmentTotals();
    const unlockedCount = anecdotes.filter((item) => progress.hasAnecdote(item.anecdote_id)).length;

    this.addHeader({
      title: '逸闻册',
      subtitle: '三片旧纸拼成一页，读一段文人的小故事',
      onBack: () => this._goBack(),
      backLabel: getReturnLabel(this.returnScene, '主页'),
      rightText: `已解锁 ${unlockedCount} / ${anecdotes.length} 段 · 碎片 ${totals.collectedFragments} / ${totals.totalFragments}`,
    });

    if (anecdotes.length === 0) {
      showModal(this, {
        title: '逸闻册还空着',
        message: '数据文件中还没有轶事内容。\n等 anecdote_db.json 补充后，这里会自动出现。',
        sealText: '闻',
        actions: [{ label: '返回', variant: 'primary', onClick: () => this._goBack() }],
      });
      audio.playBgm('menu');
      return;
    }

    this._buildGridPanel();
    this._buildGrid(anecdotes);

    makeText(
      this,
      GAME_WIDTH / 2,
      664,
      '碎片三片拼成一页：地图拾取 · 牧童闲聊 · 诗题通关奖励（按住卡片上下拖动可翻看更多）',
      { size: 14, color: S.inkFaint, origin: [0.5, 0.5] },
    ).setDepth(100);

    audio.playBgm('menu');
  }

  /** 返回来源场景：从关卡 / 地图进来时回到原来的地点 */
  _goBack() {
    backFromSideScene(this);
  }

  // ---------------------------------------------------------
  // 卡片网格：滚动面板
  // ---------------------------------------------------------
  _buildGridPanel() {
    this.anecdoteScroll = new ScrollPanel(this, {
      x: PANEL.x,
      y: PANEL.y,
      width: PANEL.width,
      height: PANEL.height,
      radius: PANEL.radius,
      depth: 120,
    });
    // 卡片都挂在滚动面板的内容容器里，坐标从面板左上角算起
    this.gridLayer = this.anecdoteScroll.content;

    // 面板内任意位置都能拖动滚动（按在卡片上也能拖），
    // 拖动距离超过阈值就不再当成「点击卡片」
    this._drag = null;
    this._dragMoved = false;
    this.input.on('pointerdown', (pointer) => {
      this._dragMoved = false;
      if (this._detailRoot) return; // 详情弹窗打开时不要滚动后面的网格
      if (!this._inPanel(pointer)) return;
      this._drag = {
        id: pointer.id,
        startY: pointer.y,
        startScroll: this.anecdoteScroll ? this.anecdoteScroll.scrollY : 0,
      };
    });
    this.input.on('pointermove', (pointer) => {
      const drag = this._drag;
      if (!drag || pointer.id !== drag.id || !this.anecdoteScroll) return;
      const delta = pointer.y - drag.startY;
      if (Math.abs(delta) > DRAG_THRESHOLD) this._dragMoved = true;
      if (this._dragMoved) this.anecdoteScroll.setScroll(drag.startScroll - delta);
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

  /** 按 4 列排卡片；行数随轶事数量增长，超出面板时滚动查看 */
  _buildGrid(anecdotes) {
    this.gridLayer.removeAll(true);

    anecdotes.forEach((item, index) => {
      const row = Math.floor(index / CARD_COLUMNS);
      const column = index % CARD_COLUMNS;
      const x = (PANEL.width - ROW_W) / 2 + CARD_W / 2 + column * (CARD_W + CARD_GAP_X);
      const y = PANEL_PAD_TOP + CARD_H / 2 + row * (CARD_H + CARD_GAP_Y);
      this._buildCard(item, x, y);
    });

    const rowCount = Math.ceil(anecdotes.length / CARD_COLUMNS);
    const contentHeight = PANEL_PAD_TOP
      + rowCount * CARD_H
      + Math.max(0, rowCount - 1) * CARD_GAP_Y
      + PANEL_PAD_BOTTOM;
    this.anecdoteScroll.layout(contentHeight, { reset: true });
  }

  // ---------------------------------------------------------
  // 卡片
  // ---------------------------------------------------------
  _buildCard(item, x, y) {
    const state = getAnecdoteFragmentState(item.anecdote_id);
    const unlocked = Boolean(state && (state.complete || state.unlocked));
    const sourcePoems = dataManager.getPoemsByAnecdote(item.anecdote_id);
    const source = sourcePoems[0] || null;

    const halfW = CARD_W / 2;
    const left = -halfW;
    const top = -CARD_H / 2;

    const card = this.add.container(x, y).setDepth(120);
    const g = this.add.graphics();

    g.fillStyle(0x6f6050, 0.1);
    roundedRectPath(g, left + 2, top + 5, CARD_W, CARD_H, 20);
    g.fillPath();
    g.fillStyle(unlocked ? C.paperSoft : C.paperDeep, unlocked ? 0.98 : 0.92);
    roundedRectPath(g, left, top, CARD_W, CARD_H, 20);
    g.fillPath();
    g.lineStyle(1.6, unlocked ? C.inkFaint : C.inkLine, 0.55);
    roundedRectPath(g, left, top, CARD_W, CARD_H, 20);
    g.strokePath();
    g.lineStyle(1, C.gold, unlocked ? 0.28 : 0.16);
    roundedRectPath(g, left + 7, top + 7, CARD_W - 14, CARD_H - 14, 15);
    g.strokePath();

    // 顶部色带：已集齐用淡桃色，未集齐用灰纸色
    g.fillStyle(unlocked ? C.blossom : C.inkLine, unlocked ? 0.45 : 0.4);
    g.fillRoundedRect(left + 15, top + 11, CARD_W - 30, 5, 2.5);
    card.add(g);

    // 印章 + 标题
    card.add(
      addSeal(this, left + 30, top + 34, unlocked ? '闻' : '？', 34, unlocked ? C.peachDeep : 0xa89d8a),
    );
    card.add(
      makeText(this, left + 54, top + 32, unlocked ? item.title : '尚未拼齐的一页', {
        size: 18,
        color: unlocked ? S.ink : S.mute,
        origin: [0, 0.5],
        wrap: CARD_W - 150,
      }),
    );

    // 状态标签
    const tag = createTag(this, 0, 0, unlocked ? '已解锁' : `碎片 ${state ? state.count : 0}/${FRAGMENT_PER_ANECDOTE}`, {
      fill: unlocked ? C.goldLight : C.paperDeep,
      textColor: unlocked ? S.gold : S.mute,
      fontSize: 12,
      height: 24,
      paddingX: 11,
      strokeColor: unlocked ? C.gold : C.inkFaint,
    });
    tag.container.setPosition(left + CARD_W - tag.width / 2 - 12, top + 32);
    card.add(tag.container);

    // 出处（窄卡只写诗题与章节）
    const sourceLine = source
      ? `出自《${source.title}》· 第${source.chapter}章 ${getChapterName(source.chapter)}`
      : '出处：待补';
    card.add(
      makeText(this, left + 20, top + 58, sourceLine, {
        size: 12,
        color: unlocked ? S.inkSoft : S.inkFaint,
        origin: [0, 0.5],
        wrap: CARD_W - 40,
        lineSpacing: 5,
      }),
    );

    const divider = this.add.graphics();
    divider.lineStyle(1, C.gold, unlocked ? 0.3 : 0.18);
    divider.beginPath();
    divider.moveTo(left + 20, top + 94);
    divider.lineTo(left + CARD_W - 20, top + 94);
    divider.strokePath();
    card.add(divider);

    // 碎片进度条：3 格宣纸小片
    this._buildFragmentBar(card, left + 20, top + 112, state, unlocked);

    if (unlocked) {
      card.add(
        makeText(this, left + 20, top + 142, previewText(item.content, 62), {
          size: 13,
          color: S.inkSoft,
          origin: [0, 0],
          align: 'left',
          wrap: CARD_W - 40,
          lineSpacing: 6,
        }),
      );
      card.add(
        makeText(this, left + CARD_W - 14, top + CARD_H - 14, '轻点翻开全文 ›', {
          size: 12,
          color: S.gold,
          origin: [1, 0.5],
        }),
      );
    } else {
      card.add(
        makeText(
          this,
          left + halfW,
          top + 158,
          source
            ? `还差 ${state ? state.remaining : FRAGMENT_PER_ANECDOTE} 片碎片。\n地图拾取 · 牧童闲聊 · 通关奖励`
            : '这段轶事还藏在诗山深处。',
          {
            size: 13,
            color: S.inkSoft,
            origin: [0.5, 0.5],
            align: 'center',
            wrap: CARD_W - 60,
            lineSpacing: 6,
          },
        ),
      );
      card.add(
        makeText(this, left + CARD_W - 14, top + CARD_H - 14, '三片集齐后才能翻开', {
          size: 12,
          color: S.inkFaint,
          origin: [1, 0.5],
        }),
      );
    }

    // 未集齐时盖一层很淡的灰纱，读起来像旧纸，不刺眼
    if (!unlocked) {
      const veil = this.add.graphics();
      veil.fillStyle(0x8d8578, 0.08);
      roundedRectPath(veil, left + 2, top + 2, CARD_W - 4, CARD_H - 4, 18);
      veil.fillPath();
      card.add(veil);
    }

    // 整卡点击热区：按下后拖动算滚动，抬起时没拖动才算点击
    const zone = this.add.zone(0, 0, CARD_W, CARD_H).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      this.tweens.add({ targets: card, scaleX: 1.015, scaleY: 1.015, duration: 120 });
    });
    zone.on('pointerout', () => {
      this.tweens.add({ targets: card, scaleX: 1, scaleY: 1, duration: 120 });
    });
    zone.on('pointerdown', () => {
      this._dragMoved = false;
    });
    zone.on('pointerup', () => {
      if (this._dragMoved) return;
      audio.playClick();
      if (!unlocked) {
        const missing = state ? state.remaining : FRAGMENT_PER_ANECDOTE;
        showToast(
          this,
          `还缺 ${missing} 片碎片：地图上的淡彩宣纸、牧童的闲谈、诗题通关奖励，都能捡到。`,
          { y: 620, duration: 3000 },
        );
        return;
      }
      this._openDetail(item, sourcePoems, state);
    });
    card.add(zone);

    this.gridLayer.add(card);
  }

  /** 卡片上的 3 格碎片进度条 + 「碎片 n/3」文字 */
  _buildFragmentBar(card, x, y, state, unlocked) {
    const list = state ? state.list : [];
    const count = list.length;
    const slotW = 34;
    const slotH = 26;
    const gap = 8;

    const g = this.add.graphics();
    for (let index = 1; index <= FRAGMENT_PER_ANECDOTE; index += 1) {
      const owned = list.includes(index);
      const sx = x + (index - 1) * (slotW + gap);
      g.fillStyle(owned ? C.goldLight : C.paperShade, owned ? 1 : 0.7);
      roundedRectPath(g, sx, y - slotH / 2, slotW, slotH, 8);
      g.fillPath();
      g.lineStyle(1.2, owned ? C.gold : C.inkFaint, owned ? 0.85 : 0.45);
      roundedRectPath(g, sx, y - slotH / 2, slotW, slotH, 8);
      g.strokePath();
    }
    // 先放底图，再放碎片上的字，避免文字被纸色盖住
    card.add(g);

    for (let index = 1; index <= FRAGMENT_PER_ANECDOTE; index += 1) {
      const owned = list.includes(index);
      const sx = x + (index - 1) * (slotW + gap);
      card.add(
        makeText(this, sx + slotW / 2, y + 1, owned ? '闻' : String(index), {
          size: owned ? 15 : 13,
          color: owned ? S.gold : S.mute,
          origin: [0.5, 0.5],
        }).setAlpha(owned ? 1 : 0.7),
      );
    }

    const labelX = x + FRAGMENT_PER_ANECDOTE * slotW + (FRAGMENT_PER_ANECDOTE - 1) * gap + 14;
    card.add(
      makeText(this, labelX, y - 6, `碎片 ${count}/${FRAGMENT_PER_ANECDOTE}`, {
        size: 13,
        color: count >= FRAGMENT_PER_ANECDOTE ? S.gold : S.inkSoft,
        origin: [0, 0.5],
      }),
    );
    card.add(
      makeText(this, labelX, y + 10, unlocked ? '已拼成完整一页' : '集齐三片即可解锁', {
        size: 11,
        color: S.inkFaint,
        origin: [0, 0.5],
      }),
    );
  }

  // ---------------------------------------------------------
  // 详情弹窗（插画占位图 + 正文）
  // ---------------------------------------------------------
  _openDetail(item, sourcePoems, state) {
    audio.playPage();

    const panelW = 1000;
    const panelH = 628;
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

    root.add(addSeal(this, left + 56, top + 54, '闻', 44));
    root.add(
      makeText(this, cx, top + 54, item.title, {
        size: FONT_SIZE.xl,
        color: S.ink,
        origin: [0.5, 0.5],
        wrap: panelW - 260,
        bold: true,
      }),
    );

    // 左侧插画占位图
    this._buildIllustration(root, left + 36, top + 112, 380, 300, item);

    // 右侧正文
    const textX = left + 448;
    const textWrap = 516;
    const contentText = makeText(this, textX, top + 120, item.content, {
      size: 20,
      color: S.ink,
      origin: [0, 0],
      align: 'left',
      wrap: textWrap,
      lineSpacing: 13,
    });
    root.add(contentText);

    const sourceText = sourcePoems.length > 0
      ? `出处：${sourcePoems
        .map((poem) => `《${poem.title}》（第${poem.chapter}章 · ${getChapterName(poem.chapter)}）`)
        .join('、')}`
      : '出处：诗山旧闻';
    const sourceY = Math.min(top + 372, contentText.y + contentText.height + 28);
    root.add(
      makeText(this, textX, sourceY, sourceText, {
        size: 15,
        color: S.inkSoft,
        origin: [0, 0],
        align: 'left',
        wrap: textWrap,
        lineSpacing: 7,
      }),
    );

    const stateText = state
      ? `碎片 ${state.count}/${state.total} · 已解锁`
      : '碎片 3/3 · 已解锁';
    const tag = createTag(this, 0, 0, stateText, {
      fill: C.goldLight,
      textColor: S.gold,
      fontSize: 13,
      height: 28,
      paddingX: 14,
      strokeColor: C.gold,
    });
    tag.container.setPosition(textX + tag.width / 2, sourceY + 62);
    root.add(tag.container);

    const hint = '把这一页收进书箧，故事就留在逸闻册里了。';
    root.add(
      makeText(this, textX + tag.width + 14, sourceY + 62, hint, {
        size: 13,
        color: S.inkFaint,
        origin: [0, 0.5],
      }),
    );

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
      label: '收好这一页',
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

  /** 插画：有绘本图就铺真图，没有就画淡彩占位画框 */
  _buildIllustration(root, x, y, width, height, item) {
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
        makeText(this, x + width / 2, y + height + 18, '一页小画 · 画的就是这段往事', {
          size: 13,
          color: S.inkFaint,
          origin: [0.5, 0.5],
        }),
      );
      return;
    }

    const art = this.add.graphics();
    // 纸底与投影
    art.fillStyle(0x6f6050, 0.08);
    roundedRectPath(art, x + 2, y + 5, width, height, 16);
    art.fillPath();
    art.fillStyle(C.paper, 1);
    roundedRectPath(art, x, y, width, height, 16);
    art.fillPath();

    // 天空与日头
    art.fillStyle(0xf6e7c9, 0.55);
    art.fillCircle(x + width - 78, y + 62, 24);
    art.fillStyle(0xf6e7c9, 0.28);
    art.fillCircle(x + width - 78, y + 62, 38);

    // 远山
    art.fillStyle(0xd8e6d2, 0.92);
    art.fillPoints([
      { x, y: y + 214 },
      { x: x + 78, y: y + 138 },
      { x: x + 150, y: y + 204 },
      { x: x + 226, y: y + 128 },
      { x: x + 300, y: y + 196 },
      { x: x + width, y: y + 156 },
      { x: x + width, y: y + height - 56 },
      { x, y: y + height - 56 },
    ], true);

    // 近山
    art.fillStyle(0xc2d7b2, 0.9);
    art.fillPoints([
      { x, y: y + height - 62 },
      { x: x + 92, y: y + 206 },
      { x: x + 186, y: y + 240 },
      { x: x + 288, y: y + 194 },
      { x: x + width, y: y + 232 },
      { x: x + width, y: y + height - 44 },
      { x, y: y + height - 44 },
    ], true);

    // 溪水
    art.fillStyle(0xbfdad5, 0.75);
    art.fillRect(x + 10, y + height - 48, width - 20, 38);
    art.lineStyle(1.4, 0xffffff, 0.6);
    art.beginPath();
    art.moveTo(x + 34, y + height - 34);
    art.lineTo(x + 132, y + height - 34);
    art.moveTo(x + 176, y + height - 26);
    art.lineTo(x + 306, y + height - 26);
    art.strokePath();

    // 简笔小树与飞鸟
    art.lineStyle(2, 0x9a8d76, 0.55);
    art.beginPath();
    art.moveTo(x + 66, y + height - 54);
    art.lineTo(x + 68, y + height - 130);
    art.moveTo(x + 68, y + height - 112);
    art.lineTo(x + 96, y + height - 136);
    art.moveTo(x + 68, y + height - 112);
    art.lineTo(x + 46, y + height - 138);
    art.strokePath();
    art.lineStyle(1.6, 0x9a8d76, 0.4);
    art.beginPath();
    art.moveTo(x + 232, y + 76);
    art.lineTo(x + 244, y + 70);
    art.lineTo(x + 256, y + 76);
    art.moveTo(x + 272, y + 58);
    art.lineTo(x + 284, y + 52);
    art.lineTo(x + 296, y + 58);
    art.strokePath();

    // 画框
    art.lineStyle(2, C.inkFaint, 0.55);
    roundedRectPath(art, x, y, width, height, 16);
    art.strokePath();
    art.lineStyle(1, C.gold, 0.3);
    roundedRectPath(art, x + 7, y + 7, width - 14, height - 14, 11);
    art.strokePath();
    root.add(art);

    const badge = createTag(this, 0, 0, '小画还在绘制中', {
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
      makeText(this, x + width / 2, y + height + 18, '这一页的画还在慢慢画', {
        size: 13,
        color: S.inkFaint,
        origin: [0.5, 0.5],
      }),
    );
  }
}
