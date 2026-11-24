/**
 * SettingScene：设置。
 * 难度切换（温和 / 挑战）、音效与 BGM 开关、存档概况、清除存档（二次确认）。
 * 所有设置写入 localStorage，离线保存。
 */

import { GAME_WIDTH, SCENES } from '../config/constants.js';
import { DIFFICULTIES } from '../config/difficulty.js';
import { COLLECTION_ITEMS } from '../config/collection.js';
import { C, S } from '../config/theme.js';
import { dataManager } from '../data/DataManager.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import BaseScene from '../ui/BaseScene.js';
import {
  createButton,
  createPaperPanel,
  makeText,
  showModal,
  showToast,
} from '../ui/components.js';

export default class SettingScene extends BaseScene {
  constructor() {
    super(SCENES.SETTING);
  }

  create() {
    this.prepareScene();
    this.addBackground('paper', { petals: true });

    this.addHeader({
      title: '设置',
      subtitle: '把诗路调成你喜欢的样子',
      onBack: () => this.goTo(SCENES.MENU, {}),
      backLabel: '主页',
    });

    this._buildPanel();

    makeText(
      this,
      GAME_WIDTH / 2,
      674,
      '纯离线单机 · 所有存档只保存在本机浏览器（localStorage）',
      { size: 14, color: S.inkFaint, origin: [0.5, 0.5] },
    ).setDepth(100);

    audio.playBgm('menu');
  }

  _buildPanel() {
    const panel = createPaperPanel(this, {
      x: GAME_WIDTH / 2,
      y: 386,
      width: 1000,
      height: 512,
      radius: 30,
      fill: C.paperSoft,
      depth: 100,
    });
    panel.setAlpha(0.97);

    // ---------------- 难度 ----------------
    // 说明文字只占左侧一列，避免被右侧两个模式按钮挡住
    this._addSectionTitle(
      200,
      176,
      '难度模式',
      '温和模式：标出作者朝代\n挑战模式：只凭画面记忆',
      230,
    );

    this.gentleButton = createButton(this, {
      x: 570,
      y: 220,
      width: 300,
      height: 82,
      radius: 24,
      label: DIFFICULTIES.gentle.name,
      subLabel: '标注作者朝代 · 温柔鼓励',
      variant: 'secondary',
      fontSize: 22,
      subFontSize: 13,
      depth: 110,
      onClick: () => this._setDifficulty('gentle'),
    });

    this.challengeButton = createButton(this, {
      x: 920,
      y: 220,
      width: 300,
      height: 82,
      radius: 24,
      label: DIFFICULTIES.challenge.name,
      subLabel: '只凭画面与记忆作答',
      variant: 'secondary',
      fontSize: 22,
      subFontSize: 13,
      depth: 110,
      onClick: () => this._setDifficulty('challenge'),
    });

    this._addDivider(272);

    // ---------------- 音效 ----------------
    this._addSectionTitle(200, 300, '音效', '答对风铃轻响，答错是柔和的提示音。');
    this.sfxButton = createButton(this, {
      x: 920,
      y: 320,
      width: 300,
      height: 64,
      radius: 22,
      label: '',
      variant: 'gold',
      fontSize: 20,
      depth: 110,
      onClick: () => {
        const enabled = progress.toggleSetting('sfx');
        if (enabled) audio.playCorrect();
        this._refreshControls();
      },
    });

    this._addDivider(366);

    // ---------------- BGM ----------------
    this._addSectionTitle(200, 394, '背景音乐', '每一章都有自己的曲子；六章曲风各异，可以在关卡里慢慢听。');
    this.bgmButton = createButton(this, {
      x: 920,
      y: 414,
      width: 300,
      height: 64,
      radius: 22,
      label: '',
      variant: 'gold',
      fontSize: 20,
      depth: 110,
      onClick: () => {
        progress.toggleSetting('bgm');
        audio.syncBgmSetting();
        this._refreshControls();
      },
    });

    this._addDivider(460);

    // ---------------- 存档 ----------------
    this._addSectionTitle(200, 488, '本地存档', '');
    this.storageText = makeText(this, 200, 516, '', {
      size: 14,
      color: S.inkSoft,
      origin: [0, 0],
      align: 'left',
      wrap: 460,
      lineSpacing: 5,
    }).setDepth(110);

    this.clearButton = createButton(this, {
      x: 920,
      y: 512,
      width: 300,
      height: 64,
      radius: 22,
      label: '清除存档',
      variant: 'danger',
      fontSize: 20,
      depth: 110,
      onClick: () => this._confirmClear(),
    });

    this._refreshControls();
  }

  _addSectionTitle(x, y, title, desc, descWrap = 460) {
    makeText(this, x, y, title, {
      size: 19,
      color: S.ink,
      origin: [0, 0.5],
    }).setDepth(110);

    if (desc) {
      makeText(this, x, y + 26, desc, {
        size: 13,
        color: S.inkSoft,
        origin: [0, 0],
        wrap: descWrap,
        lineSpacing: 4,
      }).setDepth(110);
    }
  }

  _addDivider(y) {
    const line = this.add.graphics().setDepth(109);
    line.lineStyle(1, C.gold, 0.28);
    line.beginPath();
    line.moveTo(200, y);
    line.lineTo(GAME_WIDTH - 200, y);
    line.strokePath();
  }

  _refreshControls() {
    const difficulty = progress.getDifficulty();
    this.gentleButton.setVariant(difficulty === 'gentle' ? 'primary' : 'secondary');
    this.challengeButton.setVariant(difficulty === 'challenge' ? 'primary' : 'secondary');
    this.gentleButton.setSubLabel(difficulty === 'gentle' ? '当前模式 · 标注作者朝代' : '标注作者朝代 · 温柔鼓励');
    this.challengeButton.setSubLabel(difficulty === 'challenge' ? '当前模式 · 只凭记忆作答' : '只凭画面与记忆作答');

    const settings = progress.getSettings();
    this.sfxButton.setLabel(`音效：${settings.sfx ? '开' : '关'}`);
    this.sfxButton.setVariant(settings.sfx ? 'gold' : 'muted');
    this.bgmButton.setLabel(`背景音乐：${settings.bgm ? '开' : '关'}`);
    this.bgmButton.setVariant(settings.bgm ? 'gold' : 'muted');

    const updatedAt = progress.getUpdatedAt();
    const timeText = updatedAt
      ? new Date(updatedAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      : '尚未记录';

    this.storageText.setText(
      `诗卡 ${progress.getUnlockedCardIds().length}/${dataManager.getTotalPoemCount()}　`
      + `错题 ${progress.getWrongCount()}　`
      + `轶事 ${progress.getAnecdoteIds().length}/${dataManager.getAllAnecdotes().length}　`
      + `藏品 ${progress.getCollectionIds().length}/${COLLECTION_ITEMS.length}\n`
      + `诗笺 ${progress.getExcerptCount()} 张　节气诗笺 ${progress.getFestivalRecords().length} 枚\n`
      + `最近保存：${timeText}`
      + (progress.getStorageAvailable() ? '' : '\n注意：本机无法写入 localStorage，进度可能无法保留。'),
    );
  }

  _setDifficulty(mode) {
    if (progress.getDifficulty() === mode) return;
    progress.setDifficulty(mode);
    audio.playPage();
    showToast(this, `已切换为${DIFFICULTIES[mode].name}`, { y: 640, duration: 1600 });
    this._refreshControls();
  }

  _confirmClear() {
    audio.playWrong();
    showModal(this, {
      title: '要清空这卷诗吗？',
      sealText: '慎',
      message: '这会清除诗卡、错题、轶事、藏品、诗笺、节气诗笺、章节解锁与所有设置，\n而且无法恢复。\n\n如果只是想重新读一遍，可以点「再想想」。',
      actions: [
        { label: '再想想', variant: 'primary' },
        {
          label: '确认清除',
          variant: 'danger',
          onClick: () => this._clearSave(),
        },
      ],
    });
  }

  _clearSave() {
    progress.resetAll();
    audio.syncBgmSetting();
    showToast(this, '诗卷已清空，可以从青芽谷重新出发了。', { y: 640, duration: 2600 });
    this.time.delayedCall(420, () => {
      this.scene.restart();
    });
  }
}
