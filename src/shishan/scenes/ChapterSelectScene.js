/**
 * ChapterSelectScene：六章诗卷选择。
 * 灰色锁定章节、显示本章课内进度与解锁条件提示。
 */

import { GAME_WIDTH, SCENES } from '../config/constants.js';
import { CHAPTERS } from '../config/chapters.js';
import { C, FONT_SIZE, S } from '../config/theme.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import BaseScene from '../ui/BaseScene.js';
import { addSeal } from '../ui/background.js';
import {
  createButton,
  createProgressBar,
  createTag,
  makeText,
  showModal,
} from '../ui/components.js';
import { resolveMapKey } from '../world/worldData.js';

const CARD_WIDTH = 370;
const CARD_HEIGHT = 232;
const CARD_GAP_X = 30;
const CARD_GAP_Y = 24;
const GRID_TOP = 126;

export default class ChapterSelectScene extends BaseScene {
  constructor() {
    super(SCENES.CHAPTER_SELECT);
  }

  create() {
    this.prepareScene();
    this.addBackground('garden', { petals: true });

    const unlockedCount = progress.getUnlockedChapterIds().length;
    this.addHeader({
      title: '选择章卷',
      subtitle: '读完本章 60% 的课内诗题，下一章的诗路就会亮起来',
      onBack: () => this.goTo(SCENES.MENU, {}),
      backLabel: '主页',
      rightText: `已解锁 ${unlockedCount} / 6 章${progress.isDevUnlockAll() ? ' · 测试解锁' : ''}`,
    });

    CHAPTERS.forEach((chapter, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      const x = (GAME_WIDTH - (CARD_WIDTH * 3 + CARD_GAP_X * 2)) / 2 + CARD_WIDTH / 2
        + column * (CARD_WIDTH + CARD_GAP_X);
      const y = GRID_TOP + CARD_HEIGHT / 2 + row * (CARD_HEIGHT + CARD_GAP_Y);
      this._buildChapterCard(chapter, x, y);
    });

    makeText(
      this,
      GAME_WIDTH / 2,
      688,
      '全章印章：本章课内诗题全部读完，并收齐本章轶事',
      { size: 14, color: S.inkFaint, origin: [0.5, 0.5] },
    ).setDepth(100);

    audio.playBgm('menu');
  }

  _buildChapterCard(chapter, x, y) {
    const status = progress.getChapterStatus(chapter.id);
    const unlocked = status.unlocked;
    const top = y - CARD_HEIGHT / 2;
    const left = x - CARD_WIDTH / 2;

    const cardButton = createButton(this, {
      x,
      y,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      radius: 26,
      label: '',
      variant: unlocked ? 'secondary' : 'muted',
      onClick: () => this._onChapterClick(chapter, status),
      depth: 100,
    });
    cardButton.setVariant(unlocked ? 'secondary' : 'muted');
    cardButton.container.setAlpha(unlocked ? 1 : 0.9);

    // 卡片底色与章节色带
    const graphics = this.add.graphics().setDepth(101).setScrollFactor(0);
    if (unlocked) {
      graphics.fillStyle(C.paperSoft, 0.25);
      graphics.fillRoundedRect(left + 10, top + 10, CARD_WIDTH - 20, CARD_HEIGHT - 20, 20);
      graphics.fillStyle(C.pineLight, 0.55);
      graphics.fillRoundedRect(left + 1, top + 1, CARD_WIDTH - 2, 8, 4);
    } else {
      graphics.fillStyle(0xe9e3d6, 0.45);
      graphics.fillRoundedRect(left + 1, top + 1, CARD_WIDTH - 2, CARD_HEIGHT - 2, 26);
    }

    // 水印数字
    makeText(this, x + CARD_WIDTH / 2 - 58, top + 40, `${chapter.id}`, {
      size: 72,
      color: S.inkFaint,
      origin: [0.5, 0.5],
    }).setDepth(101).setAlpha(unlocked ? 0.13 : 0.1);

    // 印章与小标题
    const sealColor = unlocked ? C.pineDeep : 0xa89d8a;
    addSeal(this, left + 42, top + 42, chapter.seal, 44, sealColor).setDepth(102);
    makeText(this, left + 76, top + 36, chapter.name, {
      size: 27,
      color: unlocked ? S.ink : S.mute,
      origin: [0, 0.5],
    }).setDepth(101).setAlpha(unlocked ? 1 : 0.75);

    // 状态标签
    const tag = createTag(this, x + CARD_WIDTH / 2 - 64, top + 34, unlocked ? '可游历' : '未解锁', {
      fill: unlocked ? C.pineLight : C.paperDeep,
      textColor: unlocked ? S.pineDeep : S.mute,
      fontSize: 14,
      height: 30,
      paddingX: 14,
      strokeColor: unlocked ? C.pine : C.inkFaint,
      depth: 103,
    });
    tag.container.setPosition(x + CARD_WIDTH / 2 - tag.width / 2 - 22, top + 34);

    // 片区
    makeText(this, left + 42, top + 78, chapter.areas.join(' · '), {
      size: 14,
      color: unlocked ? S.inkSoft : S.mute,
      origin: [0, 0.5],
      wrap: CARD_WIDTH - 84,
      lineSpacing: 4,
    }).setDepth(101).setAlpha(unlocked ? 1 : 0.7);

    // 进度条
    const barY = top + 138;
    createProgressBar(this, {
      x: x - 18,
      y: barY,
      width: 240,
      height: 12,
      percent: status.coreProgress,
      color: status.coreProgress >= 100 ? C.gold : C.pine,
      trackColor: C.paperShade,
      showLabel: true,
      depth: 102,
    });

    makeText(this, left + 28, barY - 25, '课内进度', {
      size: 14,
      color: unlocked ? S.inkSoft : S.mute,
      origin: [0, 0.5],
    }).setDepth(102).setAlpha(unlocked ? 1 : 0.7);

    // 课内篇目决定解锁门槛，全章篇目决定地图上有多少块诗碑，两个数都写清楚，
    // 免得玩家看到「课内 2/7」再进地图发现本章其实有 15 首。
    makeText(this, left + 42, top + 166, status.coreTotal > 0
      ? `课内 ${status.coreCompleted}/${status.coreTotal} · 全章 ${status.visibleCompleted}/${status.visibleTotal}`
      : `全章 ${status.visibleCompleted}/${status.visibleTotal} 首 · 纯收集章`, {
      size: 14,
      color: unlocked ? S.inkSoft : S.mute,
      origin: [0, 0.5],
    }).setDepth(102).setAlpha(unlocked ? 1 : 0.7);

    // 解锁 / 典藏信息
    const bottomText = unlocked
      ? (status.masteryUnlocked ? `★ 典藏「${status.masteryTitle}」已得` : `典藏「${status.masteryTitle}」待寻`)
      : `解锁：${this._unlockRequirement(chapter.id)}`;
    makeText(this, left + 42, top + 200, bottomText, {
      size: 14,
      color: status.masteryUnlocked ? S.gold : unlocked ? S.inkSoft : S.mute,
      origin: [0, 0.5],
      wrap: CARD_WIDTH - 80,
      lineSpacing: 3,
    }).setDepth(102).setAlpha(unlocked ? 1 : 0.8);

    // 锁定盖一层淡淡薄雾
    if (!unlocked) {
      graphics.fillStyle(0xf2ecdf, 0.24);
      graphics.fillRoundedRect(left + 1, top + 1, CARD_WIDTH - 2, CARD_HEIGHT - 2, 26);
    } else if (status.masteryUnlocked) {
      this.add.image(x + CARD_WIDTH / 2 - 26, top + 30, 'petal')
        .setAlpha(0.4)
        .setScale(0.7)
        .setDepth(103);
    }
  }

  _onChapterClick(chapter, status) {
    if (!status.unlocked) {
      audio.playWrong();
      showModal(this, {
        title: '这卷诗还未展开',
        message: `「${chapter.name}」还藏在一层薄雾里，暂时走不进去。\n\n解锁条件：${this._unlockRequirement(chapter.id)}。\n\n先回青芽谷，把课内的小诗读一读吧。`,
        sealText: '雾',
        actions: [
          { label: '继续游历', variant: 'primary' },
        ],
      });
      return;
    }

    const mapKey = resolveMapKey(chapter.id);
    if (!mapKey) {
      const devHint = progress.isDevUnlockAll()
        ? '\n\n（测试模式：本次会话已临时解锁六章；本章地图还没营造，可回测试页「章节与关卡直达」，直接进本章的诗篇关卡。）'
        : '';
      showModal(this, {
        title: `${chapter.name} · 诗路营造中`,
        message: `这一章的山水与玩法还在细细营造，暂时还没有开放的入口。\n\n已经收下的诗卡与进度都会留着，等这卷诗展开，接着走就行。${devHint}`,
        sealText: '筑',
        actions: [
          { label: '返回章卷', variant: 'primary' },
        ],
      });
      return;
    }

    this.goTo(SCENES.MAP, {
      chapterId: chapter.id,
      mapKey,
    });
  }

  _unlockRequirement(chapterId) {
    if (chapterId === 1) return '初始开放';
    const previous = CHAPTERS.find((item) => item.id === chapterId - 1);
    if (!previous) return '读完上一章的课内诗题';
    const previousStatus = progress.getChapterStatus(previous.id);
    if (previousStatus.coreTotal > 0) {
      return `读完「${previous.name}」60% 的课内诗题（现在 ${previousStatus.coreProgress}%）`;
    }
    return `读完「${previous.name}」目前可见的全部诗题（现在 ${previousStatus.visibleCompleted}/${previousStatus.visibleTotal}）`;
  }
}
