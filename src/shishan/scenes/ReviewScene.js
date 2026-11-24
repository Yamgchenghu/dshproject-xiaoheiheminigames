/**
 * ReviewScene：错题书斋。
 * 从存档读取错题列表，逐首复习；答对后 ProgressManager 会自动清除该错题。
 * 复习时复用 LevelScene（看图猜诗玩法），返回后列表自动刷新。
 */

import Phaser from 'phaser';

import { GAME_HEIGHT, GAME_WIDTH, SCENES } from '../config/constants.js';
import { C, S } from '../config/theme.js';
import { dataManager } from '../data/DataManager.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import BaseScene from '../ui/BaseScene.js';
import { addSeal, roundedRectPath } from '../ui/background.js';
import {
  createButton,
  createPaperPanel,
  createStarRow,
  makeText,
} from '../ui/components.js';
import { DEBUG_TOOLS_ENABLED } from '../ui/devTools.js';

const CARD_W = 560;
const CARD_H = 110;
const COLUMN_X = [340, 940];
const ROW_Y = [204, 338, 472, 606];

export default class ReviewScene extends BaseScene {
  constructor() {
    super(SCENES.REVIEW);
  }

  create() {
    this.prepareScene();
    this.addBackground('paper', { petals: true });

    this.addHeader({
      title: '错题书斋',
      subtitle: '答错的诗会留在这里，复习答对就能把它请出书斋',
      onBack: () => this.goTo(SCENES.MENU, {}),
      backLabel: '主页',
    });

    this.countText = makeText(this, GAME_WIDTH - 150, 52, '', {
      size: 15,
      color: S.inkSoft,
      origin: [0.5, 0.5],
    }).setDepth(1001);

    this.listLayer = this.add.container(0, 0).setDepth(120);
    this._rebuildList();

    // 从关卡返回后刷新列表
    this.events.on(Phaser.Scenes.Events.RESUME, this._onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.RESUME, this._onResume, this);
    });

    audio.playBgm('menu');
  }

  _onResume() {
    this._navigating = false;
    this._rebuildList();
  }

  _rebuildList() {
    if (!this.listLayer) return;
    this.listLayer.removeAll(true);

    const records = progress.getWrongRecords();
    this.countText.setText(`错题 ${records.length} 首`);

    if (records.length === 0) {
      this._buildEmptyState();
      return;
    }

    records.slice(0, 8).forEach((record, index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      this._buildCard(record, COLUMN_X[column], ROW_Y[row]);
    });

    const note = makeText(
      this,
      GAME_WIDTH / 2,
      674,
      '复习答对后，这首诗会自动从错题书斋移出',
      { size: 14, color: S.inkFaint, origin: [0.5, 0.5] },
    );
    this.listLayer.add(note);
  }

  _buildEmptyState() {
    const panel = createPaperPanel(this, {
      x: GAME_WIDTH / 2,
      y: 366,
      width: 820,
      height: 360,
      radius: 28,
      fill: C.paperSoft,
      depth: 0,
    });
    this.listLayer.add(panel);

    this.listLayer.add(
      addSeal(this, GAME_WIDTH / 2, 260, '净', 56, C.pineDeep),
    );

    this.listLayer.add(
      makeText(this, GAME_WIDTH / 2, 330, '书斋里干干净净', {
        size: 30,
        color: S.ink,
        origin: [0.5, 0.5],
      }),
    );

    this.listLayer.add(
      makeText(
        this,
        GAME_WIDTH / 2,
        382,
        '还没有留下错题。\n去青芽谷的石碑前读一首诗，答错的诗会自动记在这里；\n答对通关后，这首诗会自动移出错题书斋。',
        {
          size: 17,
          color: S.inkSoft,
          origin: [0.5, 0.5],
          align: 'center',
          wrap: 640,
          lineSpacing: 9,
        },
      ),
    );

    if (DEBUG_TOOLS_ENABLED) {
      this.listLayer.add(
        makeText(
          this,
          GAME_WIDTH / 2,
          534,
          '开发调试：主菜单「调试 · 错题」可以直接写入测试记录',
          { size: 13, color: S.inkFaint, origin: [0.5, 0.5] },
        ),
      );
    }

    const goButton = createButton(this, {
      x: GAME_WIDTH / 2,
      y: 490,
      width: 340,
      height: 68,
      radius: 24,
      label: '去青芽谷游历',
      variant: 'primary',
      fontSize: 23,
      depth: 0,
      onClick: () => this.goTo(SCENES.CHAPTER_SELECT, {}),
    });
    this.listLayer.add(goButton.container);
  }

  _buildCard(record, x, y) {
    const poem = dataManager.getPoemById(record.poemId);
    if (!poem) return;
    const poemRecord = progress.getPoemRecord(poem.id);

    const halfW = CARD_W / 2;
    const card = this.add.container(x, y).setDepth(0);
    const g = this.add.graphics();

    g.fillStyle(0x6f6050, 0.09);
    roundedRectPath(g, -halfW + 2, -CARD_H / 2 + 5, CARD_W, CARD_H, 20);
    g.fillPath();
    g.fillStyle(C.paperSoft, 0.97);
    roundedRectPath(g, -halfW, -CARD_H / 2, CARD_W, CARD_H, 20);
    g.fillPath();
    g.lineStyle(1.6, C.inkFaint, 0.5);
    roundedRectPath(g, -halfW, -CARD_H / 2, CARD_W, CARD_H, 20);
    g.strokePath();

    // 左侧桃色书签，表示“待复习”
    g.fillStyle(C.peach, 0.55);
    g.fillRoundedRect(-halfW + 8, -CARD_H / 2 + 14, 5, CARD_H - 28, 3);
    card.add(g);

    card.add(
      makeText(this, -halfW + 26, -24, `《${poem.title}》`, {
        size: 23,
        color: S.ink,
        origin: [0, 0.5],
        wrap: 350,
      }),
    );

    card.add(
      makeText(
        this,
        -halfW + 28,
        6,
        `${poem.dynasty} · ${poem.author}　·　${poem.area}`,
        { size: 14, color: S.inkSoft, origin: [0, 0.5], wrap: 380 },
      ),
    );

    const stars = createStarRow(this, {
      x: -halfW + 86,
      y: 34,
      stars: poemRecord?.stars || 0,
      size: 15,
      gap: 3,
      depth: 0,
    });
    card.add(stars.container);

    card.add(
      makeText(this, -halfW + 150, 34, `错了 ${record.count} 次`, {
        size: 13,
        color: S.peach,
        origin: [0, 0.5],
      }),
    );

    const reviewButton = createButton(this, {
      x: halfW - 86,
      y: 0,
      width: 132,
      height: 56,
      radius: 20,
      label: '复习',
      variant: 'primary',
      fontSize: 20,
      depth: 0,
      onClick: () => this._startReview(poem),
    });
    card.add(reviewButton.container);
    card.setDepth(0);

    this.listLayer.add(card);
  }

  _startReview(poem) {
    audio.playClick();
    this.openLevel(poem.id, { mode: 'guess_poem', review: true });
  }
}
