/**
 * MapScene：基础 RPG 探索场景。
 * 六章各有自己的地图（worldData 的 AREA_MAPS）：草地、溪流、水塘、主路、
 * 树亭石碑都由地图配置驱动，换章只需要换配置。
 *
 * 交互方式：
 *  - 左下虚拟摇杆移动（桌面也支持方向键/WASD）
 *  - 靠近画卷石碑 / 牧童 / 路牌后，右下出现大按钮
 *  - 点击石碑进入「看图猜诗」关卡；牧童先对话再出题
 *  - 诗台是其它玩法的入口；主路尽头的路牌写着下一章的名字，
 *    本章课内诗读够 60% 后可以从路牌直接进下一章
 *  - 隐藏诗碑靠近后显形，走进范围可触发
 */

import Phaser from 'phaser';

import { SCENES } from '../config/constants.js';
import { C, S, FONT_SIZE } from '../config/theme.js';
import { dataManager } from '../data/DataManager.js';
import { progress } from '../managers/ProgressManager.js';
import { audio } from '../managers/AudioManager.js';
import BaseScene from '../ui/BaseScene.js';
import { addSeal, addGrainOverlay } from '../ui/background.js';
import {
  createButton,
  createProgressBar,
  createTag,
  makeText,
  showModal,
  showToast,
} from '../ui/components.js';
import { getEventById, getEventChipLabel, getTodayEvents } from '../config/festivals.js';
import { getPoemSplitLines } from '../config/poemLines.js';
import { ensureVoices, speakPoem, stopRecitation } from '../gameplay/recitation.js';
import { MapRenderer } from '../world/MapRenderer.js';
import {
  buildFragmentSpots,
  buildMapNodes,
  getAreaMap,
  resolveMapKey,
} from '../world/worldData.js';
import { Player } from '../objects/Player.js';
import { VirtualJoystick } from '../objects/VirtualJoystick.js';
import { InteractionNode } from '../objects/InteractionNode.js';
import { FragmentNode } from '../objects/FragmentNode.js';
import { getChapterConfig, CORE_UNLOCK_THRESHOLD } from '../config/chapters.js';
import { getGameSpotRule } from '../config/gameSpots.js';
import { isFragmentSourceEnabled } from '../config/anecdoteFragments.js';
import { grantAnecdoteFragment } from '../gameplay/anecdoteFragments.js';
import { checkCollectionGuarantees } from '../gameplay/collectionRewards.js';
import { isClassicalPoem } from './ClassicalQuizScene.js';

export default class MapScene extends BaseScene {
  constructor() {
    super(SCENES.MAP);
  }

  init(data = {}) {
    this.chapterId = Number(data.chapterId || 1);
    this.mapKey = data.mapKey || resolveMapKey(this.chapterId);
    this.mapConfig = getAreaMap(this.mapKey);
    this.returnScene = data.returnScene || SCENES.CHAPTER_SELECT;
    this.nodes = [];
    this.fragmentNodes = [];
    this.activeNode = null;
    this.modalOpen = false;
    this._unlockedBefore = [];
    this._initialHintShown = false;
    // 诗台随机抽诗时避开上一次抽到的那首，连着点开不会总是同一篇
    this._lastSpotPoemId = 0;
    // 逸闻碎片支线：对话奖励的弹窗要等对话框收起后再弹，先记在这里
    this._pendingFragmentKey = '';
    this._pendingFragmentSource = 'npc';
    this._pendingFlushRetries = 0;
    // 节气 / 节日诗碑：开发预览时可以用 festivalPreviewId 指定某一块
    this.festivalPreviewId = data.festivalPreviewId || '';
    this.festivalPreviewDate = data.festivalPreviewDate || '';
    this.festivalEvent = null;
    this.festivalNode = null;
  }

  create() {
    this.prepareScene();
    audio.playSceneBgm('MapScene', { chapterId: this.chapterId });

    if (!this.mapConfig) {
      this._showComingSoon();
      return;
    }

    if (!progress.isChapterUnlocked(this.chapterId)) {
      this._showLocked();
      return;
    }

    const { width, height } = this.mapConfig.size;
    this.physics.world.setBounds(40, 120, width - 80, height - 170);
    this.cameras.main.setBounds(0, 0, width, height);

    // 绘制地图并取得碰撞盒
    const renderer = new MapRenderer(this, this.mapConfig);
    const obstacles = renderer.render();

    // 玩家
    this.player = new Player(this, this.mapConfig.spawn.x, this.mapConfig.spawn.y);

    // 静态碰撞：水域、树根、亭基、石头
    this.obstacleBodies = [];
    obstacles.forEach((obstacle) => {
      const rect = this.add
        .rectangle(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 0xff0000, 0)
        .setVisible(false);
      this.physics.add.existing(rect, true);
      this.obstacleBodies.push(rect);
      this.physics.add.collider(this.player.sprite, rect);
    });

    // 镜头跟随
    this.cameras.main.startFollow(this.player.sprite, true, 0.11, 0.11);
    this.cameras.main.setDeadzone(180, 120);

    // 交互节点（全部从 poem_db 绑定）
    this.nodes = buildMapNodes(this.mapConfig).map((definition) => {
      const node = new InteractionNode(this, definition);
      return node;
    });

    // 碑 / 木牌 / 人物 / 诗台的底座都是实心的：角色走到跟前会绕开，
    // 不会再「整个人穿进碑面里」。隐藏诗碑不参与（见 InteractionNode.solidBounds）。
    this.nodeBodies = [];
    this.nodes.forEach((node) => this._addNodeBody(node));

    // 节气 / 节日限时诗碑（按本机日期决定今天是否出现）
    this.festivalNode = this._buildFestivalNode();
    if (this.festivalNode) {
      this.nodes.push(this.festivalNode);
      this._addNodeBody(this.festivalNode);
    }

    // 逸闻碎片拾取点（支线收集，已拾取过的不会重新出现）
    this._buildFragmentNodes();

    // 纸张肌理
    addGrainOverlay(this, 890, 0.14);

    // HUD / 摇杆 / 操作按钮
    this._buildHud();
    this.joystick = new VirtualJoystick(this, { x: 150, y: 606 });
    this._buildActionButton();
    this._setupKeyboard();

    // 进度变化后回到地图时刷新
    this.events.off(Phaser.Scenes.Events.RESUME, this._onResume, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this._onResume, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.RESUME, this._onResume, this);
    });

    // 首次进入的温柔指引
    if (!this._initialHintShown) {
      this._initialHintShown = true;
      this.time.delayedCall(500, () => {
        this.showToast('拖动左下角的小摇杆走路，走到石碑旁边，再点「查看」就行。', {
          y: 158,
          duration: 3400,
        });
      });
      if (this.festivalEvent) {
        this.time.delayedCall(4200, () => {
          if (this.modalOpen) return;
          this.showToast(`今天是「${this.festivalEvent.name}」，${this.mapConfig.area}多了一块限时诗碑，去看看吧。`, {
            y: 158,
            duration: 3600,
          });
        });
      }
    }
  }

  // ---------------------------------------------------------
  // 场景状态
  // ---------------------------------------------------------
  _showComingSoon() {
    this.addBackground('garden', { petals: true });
    const chapter = getChapterConfig(this.chapterId);
    this.addHeader({
      title: chapter ? `${chapter.name} · 片区营造中` : '片区营造中',
      subtitle: '六章诗路都已开放，从章卷里挑一卷进去吧',
      onBack: () => this.goTo(SCENES.CHAPTER_SELECT, {}),
      backLabel: '章节',
    });
    this.showModal({
      title: '这里还在铺设诗路',
      message: `「${chapter?.name || '这一章'}」的山野与玩法还在营造，暂时没有入口。\n\n其它章卷的片区已经可以游历，先回去挑一卷吧。`,
      sealText: '筑',
      actions: [
        { label: '返回章节', variant: 'primary', onClick: () => this.goTo(SCENES.CHAPTER_SELECT, {}) },
      ],
    });
  }

  _showLocked() {
    this.addBackground('garden');
    this.addHeader({
      title: '章节未解锁',
      subtitle: '先读完上一章 60% 的课内诗题吧',
      onBack: () => this.goTo(SCENES.CHAPTER_SELECT, {}),
      backLabel: '章节',
    });
    this.showModal({
      title: '诗路尚未开启',
      message: '这一章还笼着一层薄雾，路没有亮起来。\n\n读完上一章 60% 的课内诗题，诗路就会为你打开。',
      sealText: '锁',
      actions: [
        { label: '返回章节', variant: 'primary', onClick: () => this.goTo(SCENES.CHAPTER_SELECT, {}) },
      ],
    });
  }

  _onResume() {
    this.modalOpen = false;
    this._navigating = false;
    if (this.player) this.player.stop();
    if (this.joystick) this.joystick.reset();
    this._refreshHud();
    this.nodes.forEach((node) => node.refresh());
    this._refreshFragmentNodes();
    this._updateActiveNode(true);

    // 如果在关卡里领到了碎片，回到地图时再弹收集提示
    this.time.delayedCall(220, () => this._flushPendingFragmentPopup());

    // 支线保底：章节课内 100% / 逸闻全套 各发一件藏品（已发过的不会重复）
    this.time.delayedCall(420, () => checkCollectionGuarantees(this));

    const newlyUnlocked = progress
      .getUnlockedChapterIds()
      .filter((id) => !this._unlockedBefore.includes(id));
    if (newlyUnlocked.length > 0) {
      const chapter = getChapterConfig(newlyUnlocked[0]);
      if (chapter) {
        this.time.delayedCall(280, () => {
          this.showToast(`新的诗路已解锁：${chapter.name}`, {
            y: 158,
            duration: 2600,
          });
        });
      }
    }
  }

  // ---------------------------------------------------------
  // HUD
  // ---------------------------------------------------------
  _buildHud() {
    const chapter = getChapterConfig(this.chapterId);

    const bar = this.add.graphics().setDepth(1000).setScrollFactor(0);
    bar.fillStyle(C.paperSoft, 0.95);
    bar.fillRect(0, 0, 1280, 96);
    bar.lineStyle(1.5, C.gold, 0.35);
    bar.beginPath();
    bar.moveTo(0, 95);
    bar.lineTo(1280, 95);
    bar.strokePath();
    bar.fillStyle(C.paper, 0.5);
    bar.fillRect(0, 0, 1280, 8);

    this.backButton = createButton(this, {
      x: 76,
      y: 50,
      width: 126,
      height: 62,
      label: '‹ 章节',
      variant: 'secondary',
      fontSize: FONT_SIZE.md,
      onClick: () => this._leaveMap(),
    });

    makeText(this, 156, 31, chapter ? `${chapter.name} · ${this.mapConfig.area}` : this.mapConfig.title, {
      size: 27,
      color: S.ink,
      origin: [0, 0.5],
    }).setDepth(1001).setScrollFactor(0);

    makeText(this, 158, 65, this.mapConfig.subtitle || chapter?.tagline || '', {
      size: 14,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(1001).setScrollFactor(0);

    this.hudBarCaption = makeText(this, 620, 32, '本章课内', {
      size: 14,
      color: S.inkSoft,
      origin: [0, 0.5],
    }).setDepth(1001).setScrollFactor(0);

    this.progressLabel = makeText(this, 620, 59, '', {
      size: 18,
      color: S.ink,
      origin: [0, 0.5],
    }).setDepth(1001).setScrollFactor(0);

    this.hudProgressBar = createProgressBar(this, {
      x: 790,
      y: 61,
      width: 160,
      height: 12,
      percent: 0,
      color: C.pine,
      trackColor: C.paperShade,
      depth: 1001,
    });

    // 毛笔道具
    this.brushSeal = addSeal(this, 1005, 49, '笔', 42, C.pineDeep);
    this.brushSeal.setDepth(1001).setScrollFactor(0);
    this.brushText = makeText(this, 1038, 50, '毛笔 × 3', {
      size: 19,
      color: S.ink,
      origin: [0, 0.5],
    }).setDepth(1001).setScrollFactor(0);

    // 逸闻碎片（支线收集）总进度
    this.fragmentText = makeText(this, 1268, 50, '', {
      size: 15,
      color: S.gold,
      origin: [1, 0.5],
    }).setDepth(1001).setScrollFactor(0);

    // 今日节气 / 节日小签（只在有事件时出现）
    if (this.festivalEvent) {
      const chip = createTag(this, 0, 0, getEventChipLabel(this.festivalEvent), {
        fill: 0xf3ddd2,
        textColor: S.danger,
        fontSize: FONT_SIZE.xs,
        height: 38,
        paddingX: 20,
        depth: 1002,
        strokeColor: C.peachDeep,
        strokeAlpha: 0.5,
      });
      chip.container.setPosition(1268 - chip.width / 2, 130);
      this.festivalChip = chip.container;
      this.tweens.add({
        targets: chip.container,
        alpha: { from: 0.82, to: 1 },
        duration: 1600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    this._refreshHud();
  }

  _refreshHud() {
    const status = progress.getChapterStatus(this.chapterId);
    // 地图上立着的是本章全部可见诗碑（不是只算课内），所以 HUD 也按可见篇目计，
    // 数字由 getChapterStatus 现算，不会再出现旧存档里「2 / 7 首 · 20%」的对不上。
    const total = status.visibleTotal;
    const done = status.visibleCompleted;
    if (this.progressLabel) {
      this.progressLabel.setText(
        total > 0 ? `${done} / ${total} 首 · ${status.visibleProgress}%` : '本章暂无诗篇',
      );
    }
    if (this.hudBarCaption) this.hudBarCaption.setText('本章诗篇');
    if (this.hudProgressBar) {
      this.hudProgressBar.container.setVisible(total > 0);
      this.hudProgressBar.setPercent(status.visibleProgress, true);
    }
    if (this.brushText) this.brushText.setText(`毛笔 × ${progress.getBrushCount()}`);
    if (this.fragmentText) {
      const totals = progress.getAnecdoteFragmentTotals();
      this.fragmentText.setText(`逸闻碎片 ${totals.collectedFragments} / ${totals.totalFragments}`);
    }
  }

  // ---------------------------------------------------------
  // 节气 / 节日限时诗碑
  // ---------------------------------------------------------
  /** 今天（或开发预览指定的日期）是否有限时诗碑 */
  _buildFestivalNode() {
    let event = this.festivalPreviewId ? getEventById(this.festivalPreviewId) : null;
    if (!event) {
      let date = new Date();
      if (this.festivalPreviewDate) {
        const parsed = new Date(this.festivalPreviewDate);
        if (!Number.isNaN(parsed.getTime())) date = parsed;
      }
      event = getTodayEvents(date)[0] || null;
    }
    if (!event) return null;

    const poem = dataManager.getPoemById(event.poemId);
    if (!poem) return null;

    this.festivalEvent = event;
    const spot = this.mapConfig.festivalSpot || { x: 1680, y: 880 };
    return new InteractionNode(this, {
      kind: 'festival',
      x: spot.x,
      y: spot.y,
      label: `${event.name}诗碑`,
      poemId: poem.id,
      festivalId: event.id,
      poem,
      event,
      triggerRadius: 145,
      hint: `${event.name}前后限时开放，读一首应景的小诗。`,
    });
  }

  /** 弹窗里先亮出诗的前两句，读得顺再收诗笺 */
  _festivalPreview(poem) {
    const manual = getPoemSplitLines(poem);
    if (manual && manual.length > 0) {
      return manual.slice(0, 2).join('　');
    }
    const parts = String(poem.full_text || '')
      .split(/(?<=[，。！？；])/)
      .filter(Boolean);
    const lines = [];
    for (let i = 0; i < parts.length; i += 2) lines.push(parts.slice(i, i + 2).join(''));
    return lines.slice(0, 2).join('\n') || String(poem.full_text || '');
  }

  _showFestivalModal(node) {
    const event = node?.event || this.festivalEvent;
    const poem = dataManager.getPoemById(event?.poemId || node?.poemId);
    if (!event || !poem) return;

    this.modalOpen = true;
    this.player.stop();
    this.joystick.reset();
    stopRecitation(true);

    const collected = progress.hasFestival(event.id);
    const message = [
      event.note,
      '',
      `《${poem.title}》${poem.dynasty} · ${poem.author}`,
      this._festivalPreview(poem),
      '',
      collected ? '这张节气诗笺已经收进你的诗笺册了，随时可以再来读一读。' : '喜欢的话，把它收进你的诗笺册吧。',
    ].join('\n');

    showModal(this, {
      title: collected ? `${event.name} · 旧地重游` : `${event.name} · 限时诗碑`,
      sealText: event.seal || '节',
      message,
      width: 820,
      actions: [
        {
          label: '听一听',
          variant: 'secondary',
          close: false,
          onClick: () => this._reciteFestivalPoem(poem),
        },
        collected
          ? { label: '知道了', variant: 'primary' }
          : {
            label: '收下节气诗笺',
            variant: 'primary',
            onClick: () => this._collectFestival(node, event),
          },
      ],
      onClose: () => {
        stopRecitation(true);
        this.modalOpen = false;
        node?.refresh();
        this._refreshHud();
      },
    });
  }

  _reciteFestivalPoem(poem) {
    ensureVoices().then((ok) => {
      if (!ok) {
        showToast(this, '这台设备没有中文朗读声音，可以跟着拼音轻轻读一遍。', { y: 620 });
        return;
      }
      const started = speakPoem(poem, {
        onError: () => showToast(this, '朗读没有成功，我们再试一次吧。', { y: 620 }),
      });
      if (!started) showToast(this, '朗读没有成功，我们再试一次吧。', { y: 620 });
    });
  }

  _collectFestival(node, event) {
    const result = progress.collectFestival({
      id: event.id,
      name: event.name,
      poemId: event.poemId,
      dateLabel: event.dateLabel,
    });
    if (!result.added) {
      this.showToast('这张诗笺已经收下啦。', { y: 620 });
      return;
    }
    progress.addBrush(1);
    audio.playFestival();
    this.showToast(`收下一枚「${event.name}」诗笺，毛笔 +1。`, { y: 620, duration: 2200 });
    if (node) node.refresh();
    this._refreshHud();
  }

  // ---------------------------------------------------------
  // 逸闻碎片（支线收集，与章节进度无关）
  // ---------------------------------------------------------
  /**
   * 给交互节点加一个很小的静态碰撞盒（只占碑座那一条），
   * 角色从此会贴着碑走、绕开碑，不会整个人穿进碑面里。
   * 碰撞盒只有 18px 高，不影响石碑头顶名牌与点击热区。
   */
  _addNodeBody(node) {
    const bounds = node?.solidBounds ? node.solidBounds() : null;
    if (!bounds) return;
    const rect = this.add
      .rectangle(bounds.x, bounds.y, bounds.width, bounds.height, 0xff0000, 0)
      .setVisible(false);
    this.physics.add.existing(rect, true);
    this.nodeBodies.push(rect);
    this.physics.add.collider(this.player.sprite, rect);
  }

  _buildFragmentNodes() {
    if (!isFragmentSourceEnabled('map')) {
      this.fragmentNodes = [];
      return;
    }
    const spots = buildFragmentSpots(this.mapConfig);
    this.fragmentNodes = spots
      .map((definition) => new FragmentNode(this, definition))
      .filter((node) => node.active);
    console.info(`[逸闻] 地图碎片点：${this.fragmentNodes.length} / ${spots.length} 处（其余已拾取）`);
  }

  /** 加入关卡后可能在结算里掉到地图上的碎片，回到地图时把重复的拾取点收掉 */
  _refreshFragmentNodes() {
    const remaining = [];
    (this.fragmentNodes || []).forEach((node) => {
      if (progress.hasAnecdoteFragment(node.anecdoteId, node.fragmentIndex)) {
        node.destroy();
      } else {
        remaining.push(node);
      }
    });
    this.fragmentNodes = remaining;
  }

  /** 走到碎片上自动拾取：落盘 + 轻收集音效 + 国风弹窗 */
  onFragmentCollected(node) {
    this.fragmentNodes = this.fragmentNodes.filter((item) => item !== node);
    const key = node?.def?.fragmentKey;
    if (!key) return;

    if (this.player) this.player.stop();
    if (this.joystick) this.joystick.reset();
    this.modalOpen = true;
    const info = grantAnecdoteFragment(this, key, {
      source: 'map',
      onClose: () => {
        this.modalOpen = false;
      },
    });
    if (!info) this.modalOpen = false;
    this._refreshHud();
  }

  /** 对话奖励：等对话框收起后再发碎片，两个弹窗不会叠在一起 */
  _queueNpcFragmentReward(node) {
    const reward = node?.def?.fragmentReward;
    if (!reward || !isFragmentSourceEnabled('npc')) return;
    this._pendingFragmentKey = reward.fragmentKey;
    this._pendingFragmentSource = 'npc';
    this.time.delayedCall(180, () => this._flushPendingFragmentPopup());
  }

  _flushPendingFragmentPopup() {
    const key = this._pendingFragmentKey;
    if (!key) return;

    // 还有别的弹窗/转场，就稍后再试，避免两层弹窗叠一起
    if (this.modalOpen || this._navigating) {
      if ((this._pendingFlushRetries || 0) < 12) {
        this._pendingFlushRetries = (this._pendingFlushRetries || 0) + 1;
        this.time.delayedCall(420, () => this._flushPendingFragmentPopup());
      }
      return;
    }

    this._pendingFragmentKey = '';
    this._pendingFlushRetries = 0;
    if (this.player) this.player.stop();
    if (this.joystick) this.joystick.reset();
    this.modalOpen = true;
    const info = grantAnecdoteFragment(this, key, {
      source: this._pendingFragmentSource,
      onClose: () => {
        this.modalOpen = false;
      },
    });
    if (!info) this.modalOpen = false;
    this._refreshHud();
  }

  _buildActionButton() {
    this.actionHintText = makeText(this, 1000, 540, '', {
      size: 17,
      color: S.inkSoft,
      wrap: 390,
      origin: [0.5, 0.5],
      lineSpacing: 6,
    }).setDepth(2001).setScrollFactor(0).setAlpha(0);

    this.actionButton = createButton(this, {
      x: 1000,
      y: 618,
      width: 396,
      height: 88,
      label: '查看',
      subLabel: '',
      variant: 'primary',
      fontSize: 27,
      onClick: () => this._interactWithActiveNode(),
      depth: 2100,
    });
    this.actionButton.setVisible(false);
  }

  _showAction(node) {
    const completed = node.poemId ? progress.isPoemCompleted(node.poemId) : false;
    let label = '看看路牌';
    if (node.isFestival) {
      label = progress.hasFestival(node.festivalId) ? '再看一眼节气诗碑' : '读一读今日小诗';
    } else if (node.def.kind === 'npc') {
      label = '和牧童聊两句';
    } else if (node.def.kind === 'game') {
      label = `开一局「${node.def.label}」`;
    } else if (node.def.kind === 'gate') {
      label = node.gateUnlocked ? '沿路牌去下一章' : '看看路口的路牌';
    } else if (node.poemId) {
      // 按钮只写石碑的名字，不写诗题：写题了就等于把「看图猜诗」的答案提前说了
      const steleName = node.def.label || '';
      if (node.def.kind === 'hiddenStele' && !completed) label = '拂开青苔，读诗';
      else if (completed) label = steleName ? `再读一遍「${steleName}」` : '再读一遍这块碑';
      else label = steleName ? `查看「${steleName}」` : '查看诗碑';
    }
    this.actionButton.setLabel(label);
    this.actionButton.setVisible(true);
    this.actionHintText.setText(node.hint || '');
    this.actionHintText.setAlpha(0);
    this.tweens.add({ targets: this.actionHintText, alpha: 1, duration: 200 });
  }

  _hideAction() {
    this.actionButton.setVisible(false);
    this.actionHintText.setAlpha(0);
  }

  _setActiveNode(nextNode) {
    if (this.activeNode === nextNode) return;
    if (this.activeNode) this.activeNode.setHighlight(false);
    this.activeNode = nextNode;
    if (nextNode) {
      nextNode.setHighlight(true);
      this._showAction(nextNode);
    } else {
      this._hideAction();
    }
  }

  _updateActiveNode(force = false) {
    if (this.modalOpen || !this.player) {
      this._setActiveNode(null);
      return;
    }

    let nearest = null;
    let nearestDistance = Infinity;
    this.nodes.forEach((node) => {
      if (node.isHidden && !node.completed && !node.discovered) return;
      const distance = node.getDistance(this.player.x, this.player.y);
      if (distance <= (node.def.triggerRadius || 125) && distance < nearestDistance) {
        nearest = node;
        nearestDistance = distance;
      }
    });

    if (force) {
      this._setActiveNode(null);
    }
    this._setActiveNode(nearest);
  }

  // ---------------------------------------------------------
  // 交互
  // ---------------------------------------------------------
  onNodeTapped(node) {
    if (this.modalOpen || this._navigating) return;
    const distance = node.getDistance(this.player.x, this.player.y);
    if (distance > (node.def.triggerRadius || 125) + 55) {
      audio.playPage();
      this.showToast('再走近一点，就能看清啦', { y: 620, duration: 1400 });
      return;
    }
    this._interactWithNode(node);
  }

  _interactWithActiveNode() {
    if (this.activeNode) this._interactWithNode(this.activeNode);
  }

  _interactWithNode(node) {
    if (!node) return;
    this.player.stop();
    this.joystick.reset();
    this._setActiveNode(null);

    if (node.isFestival) {
      this._showFestivalModal(node);
      return;
    }

    if (node.isSign) {
      audio.playPage();
      this.showToast(node.def.message || node.def.hint, {
        y: 600,
        duration: 4200,
      });
      return;
    }

    if (node.def.kind === 'npc') {
      this._showNpcDialog(node);
      return;
    }

    if (node.def.kind === 'game') {
      this._showGameSpotDialog(node);
      return;
    }

    // 主路尽头的下一章路口：达标后从这里换章，不用先退回章卷
    if (node.def.kind === 'gate') {
      this._showNextChapterGate(node);
      return;
    }

    if (node.isHidden) node.revealHidden();
    this._openPoemLevel(node.poemId);
  }

  _showNpcDialog(node) {
    this.modalOpen = true;
    this.player.stop();
    this.joystick.reset();
    const completed = progress.isPoemCompleted(node.poemId);
    const message = completed
      ? '你已经猜出《画鸡》啦，真厉害。\n\n我家那只大白公鸡，每天清早还是会叫醒整个青芽谷。要再听一遍它的故事吗？'
      : '嗨，我是阿青，刚放牛回来。\n\n我家有只大白公鸡，头上顶着红冠子，一身雪白的羽毛。它每天清早一叫，千家万户都醒了。你猜，写它的是哪一首诗？';

    showModal(this, {
      title: '牧童阿青',
      sealText: '笛',
      message,
      actions: [
        { label: '我自己转转', variant: 'secondary' },
        {
          label: completed ? '再猜一次' : '求个小提示',
          variant: 'primary',
          onClick: () => this._openPoemLevel(node.poemId),
        },
      ],
      onClose: () => {
        this.modalOpen = false;
        // 对话奖励：聊过之后送一片逸闻碎片（已拥有则静默跳过）
        this._queueNpcFragmentReward(node);
      },
    });
  }

  _openPoemLevel(poemId) {
    this.player.stop();
    this.joystick.reset();
    this.modalOpen = false;
    this._unlockedBefore = progress.getUnlockedChapterIds();
    this.openLevel(poemId, { mode: 'guess_poem' });
  }

  // ---------------------------------------------------------
  // 玩法触发点（诗台 / 诗案 / 渡口 / 令台）
  // ---------------------------------------------------------
  /**
   * 挑「这一局」的题库。
   * 优先用「玩家已经学过的诗」（跨章、全库已通关的都算）；还没学过任何诗
   * （刚进第一章）时用本章可见诗卷兜底，保证每次都能开局。
   * 文言小问只能抽古文：抽到普通古诗，场景会先提示「不是文言文」再换一篇。
   */
  _pickGamePoems(rule = null) {
    const classicalOnly = Boolean(rule && rule.classicalOnly);
    const usable = (poem) => (classicalOnly ? isClassicalPoem(poem) : true);
    const all = dataManager.getAllPoems();

    const learned = all.filter((poem) => usable(poem) && progress.isPoemCompleted(poem.id));
    if (learned.length > 0) return { poems: learned, learned: true, source: 'learned' };

    const chapter = dataManager.getVisiblePoemsByChapter(this.chapterId).filter(usable);
    if (chapter.length > 0) return { poems: chapter, learned: false, source: 'chapter' };

    // 本章一篇古文都没有（例如前两章）时，去全库古文里抽
    return { poems: all.filter(usable), learned: false, source: 'library' };
  }

  /**
   * 从题库里随机抽一首。以前是「固定挑第一首未读」，
   * 同一处诗台每次点开都是同一首诗，没有随机性。
   * excludeId 用来避开上一次抽到的那首（题库只有一首时才允许重复）。
   */
  _pickGamePoem(rule = null, excludeId = 0) {
    const { poems } = this._pickGamePoems(rule);
    if (poems.length === 0) return null;
    const remains = excludeId && poems.length > 1
      ? poems.filter((poem) => poem.id !== excludeId)
      : poems;
    const pool = remains.length > 0 ? remains : poems;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _showGameSpotDialog(node) {
    const rule = getGameSpotRule(node.def.game);
    if (!rule) return;

    this.modalOpen = true;
    this.player.stop();
    this.joystick.reset();

    const pool = this._pickGamePoems(rule);
    const poem = rule.needsPoem ? this._pickGamePoem(rule, this._lastSpotPoemId) : null;
    if (poem) this._lastSpotPoemId = poem.id;
    const intro = node.def.hint || rule.intro;
    const unit = rule.classicalOnly ? '篇' : '首';
    const topic = rule.classicalOnly ? '古文' : '诗';
    const round = rule.needsPoem && poem
      ? (pool.source === 'learned'
        ? `这一局从你学过的 ${pool.poems.length} ${unit}${topic}里随机抽一${unit}来考你。`
        : pool.source === 'library'
          ? `这一局从诗库的${rule.classicalOnly ? '古文篇目' : '诗篇'}里随机抽一${unit}来考你。`
          : `这一局从「${this.mapConfig.area}」的${rule.classicalOnly ? '古文篇目' : '诗卷'}里随机抽一${unit}来考你。`)
      : '这一局不分诗篇，考的是这一章的综合功夫。';

    showModal(this, {
      title: node.def.label,
      sealText: rule.sealText,
      message: `${intro}\n\n【${rule.name}】${round}`,
      actions: [
        { label: '先逛逛别处', variant: 'secondary' },
        {
          label: `开始「${rule.name}」`,
          variant: 'primary',
          onClick: () => this._launchGameSpot(node, poem),
        },
      ],
      onClose: () => {
        this.modalOpen = false;
      },
    });
  }

  /** 启动玩法场景（与 openLevel 同一套「暂停地图 → 子场景 → 回来恢复」流程）
   *  poem 由弹窗那边抽好传进来，保证「文案里说抽到一首」和「真正开局用的」是同一首。 */
  _launchGameSpot(node, poem = null) {
    const rule = getGameSpotRule(node.def.game);
    if (!rule || this._navigating) return;

    const picked = rule.needsPoem ? (poem || this._pickGamePoem(rule, this._lastSpotPoemId)) : null;
    if (picked) this._lastSpotPoemId = picked.id;
    if (rule.needsPoem && !picked) {
      this.showToast('这一章还没有可以开局的诗篇', { y: 620, duration: 1600 });
      return;
    }

    this.player.stop();
    this.joystick.reset();
    this.modalOpen = false;
    this._unlockedBefore = progress.getUnlockedChapterIds();
    this._navigating = true;

    const payload = { returnScene: SCENES.MAP, chapterId: this.chapterId };
    if (picked) payload.poemId = picked.id;
    this.scene.launch(rule.scene, payload);
    this.scene.bringToTop(rule.scene);
    this.scene.pause();
  }

  // ---------------------------------------------------------
  // 下一章路口（主路尽头）
  // ---------------------------------------------------------
  /**
   * 主路尽头的下一章路牌：牌面写着下一章的名字。
   * 本章课内诗读完 60%（下一章解锁条件）后可以在这里直接进下一章；
   * 没达标就只开一扇「未开放」说明窗，只给「返回原章节」。
   */
  _showNextChapterGate(node) {
    const nextId = Number(node.def.nextChapterId);
    const nextChapter = getChapterConfig(nextId);
    if (!nextChapter) return;

    this.modalOpen = true;
    this.player.stop();
    this.joystick.reset();
    // 顺便刷新一次路牌：可能刚在别处读完最后一首课内诗
    node.refresh();

    const status = progress.getChapterStatus(this.chapterId);
    const coreTotal = status.coreTotal;
    const coreDone = status.coreCompleted;
    const visibleTotal = status.visibleTotal;
    const need = Math.ceil(coreTotal * CORE_UNLOCK_THRESHOLD);
    const thresholdPercent = Math.round(CORE_UNLOCK_THRESHOLD * 100);
    // 解锁门槛只算课内诗，HUD 算的是全章诗碑；两个数字必须同时写出来，
    // 否则玩家会看到「上面 15 首、下面 8 首」这种看起来对不上的文案。
    const countLine = `本章课内诗已读完 ${coreDone} / ${coreTotal} 首（本章地图上共 ${visibleTotal} 首）`;

    if (node.gateUnlocked) {
      // 测试模式（?unlock=all）下还没读够也会亮着，这时别把「条件已经满足」写出来
      const devUnlocked = progress.isDevUnlockAll() && coreDone < need;
      const unlockLine = devUnlocked
        ? `${countLine}。\n（测试模式：六章都已临时解锁）`
        : `${countLine}，通往下一章的条件已经满足。`;
      showModal(this, {
        title: `路牌 · ${nextChapter.name}`,
        sealText: '行',
        message: `路牌上写着「前往${nextChapter.name}」——${nextChapter.tagline}。\n\n${unlockLine}`,
        actions: [
          { label: '返回原章节', variant: 'secondary' },
          {
            label: '进入下一章',
            variant: 'primary',
            onClick: () => this._goToNextChapter(nextId),
          },
        ],
        onClose: () => {
          this.modalOpen = false;
        },
      });
      return;
    }

    showModal(this, {
      title: `路牌 · ${nextChapter.name}`,
      sealText: '未',
      message: `路牌上写着「前往${nextChapter.name}」，可这条路还没有开放。\n\n${countLine}，再读完 ${Math.max(0, need - coreDone)} 首课内诗（占课内篇目的 ${thresholdPercent}%）路牌就会亮起来。`,
      actions: [{ label: '返回原章节', variant: 'primary' }],
      onClose: () => {
        this.modalOpen = false;
      },
    });
  }

  /** 从路口换章：直接重启地图场景，装上下一章的地图配置 */
  _goToNextChapter(nextChapterId) {
    if (this._navigating) return;
    this.modalOpen = false;
    if (this.player) this.player.stop();
    if (this.joystick) this.joystick.reset();
    this.goTo(SCENES.MAP, { chapterId: nextChapterId });
  }

  _leaveMap() {
    if (this.modalOpen || this._navigating) return;
    if (this.player) this.player.stop();
    if (this.joystick) this.joystick.reset();
    this.goTo(SCENES.CHAPTER_SELECT, { chapterId: this.chapterId });
  }

  // ---------------------------------------------------------
  // 输入
  // ---------------------------------------------------------
  _setupKeyboard() {
    if (!this.input.keyboard) return;
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });
  }

  _readKeyboardVector() {
    if (!this.cursors && !this.wasd) return { x: 0, y: 0 };
    let x = 0;
    let y = 0;
    if (this.cursors.left.isDown || this.wasd.left.isDown) x -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) x += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) y -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) y += 1;
    if (x !== 0 && y !== 0) {
      x *= 0.7071;
      y *= 0.7071;
    }
    return { x, y };
  }

  update() {
    if (!this.player || !this.joystick) return;

    if (this.modalOpen) {
      this.player.stop();
      return;
    }

    const joystickVector = this.joystick.getVector();
    const hasJoystick = Math.hypot(joystickVector.x, joystickVector.y) > 0.02;
    const vector = hasJoystick ? joystickVector : this._readKeyboardVector();

    this.player.update(vector, this.game.loop.delta);

    this.nodes.forEach((node) => {
      node.updateVisibility(this.player.x, this.player.y);
    });
    this.fragmentNodes.forEach((node) => {
      node.update(this.player.x, this.player.y);
    });
    this._updateActiveNode();
  }
}
