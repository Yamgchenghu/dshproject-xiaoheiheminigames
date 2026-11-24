import Phaser from 'phaser';

import BootScene from '../scenes/BootScene.js';
import PreloadScene from '../scenes/PreloadScene.js';
import MenuScene from '../scenes/MenuScene.js';
import ChapterSelectScene from '../scenes/ChapterSelectScene.js';
import MapScene from '../scenes/MapScene.js';
import PoemBookScene from '../scenes/PoemBookScene.js';
import AnecdoteScene from '../scenes/AnecdoteScene.js';
import ReviewScene from '../scenes/ReviewScene.js';
import CollectionScene from '../scenes/CollectionScene.js';
import ExcerptScene from '../scenes/ExcerptScene.js';
import SettingScene from '../scenes/SettingScene.js';
import LevelScene from '../scenes/LevelScene.js';
// 独立玩法：诗句拖拽排序（不修改任何原有场景，独立注册即可）
import SortPoemScene from '../scenes/SortPoemScene.js';
// 独立玩法：诗意配对（左诗句 → 右文意）
import MeaningMatchScene from '../scenes/MeaningMatchScene.js';
// 独立玩法：诗句三消（凑成完整诗句才消除）
import PoemMatch3Scene from '../scenes/PoemMatch3Scene.js';
// 独立玩法：诗句华容道（滑块把诗句排回原位）
import PoemKlondikeScene from '../scenes/PoemKlondikeScene.js';
// 独立玩法：诗句接龙（NPC 说上半句，选下句）
import PoemChainScene from '../scenes/PoemChainScene.js';
// 独立玩法：文言文意问答（读古文、答道理与人物行为）
import ClassicalQuizScene from '../scenes/ClassicalQuizScene.js';
// 独立玩法：人机对战飞花令（挑关键字、轮流说带关键字的诗句）
import FeihuaLingScene from '../scenes/FeihuaLingScene.js';
// 独立玩法：综合试炼房（五关连闯，随机抽玩法与诗题，奖励文房藏品碎片）
import RandomChallengeScene from '../scenes/RandomChallengeScene.js';

import { GAME_WIDTH, GAME_HEIGHT, SCENES } from './constants.js';

export { GAME_WIDTH, GAME_HEIGHT, SCENES };

export const GAME_CONFIG = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#f6f0e2',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false,
    },
  },
  render: {
    antialias: true,
    roundPixels: false,
    powerPreference: 'high-performance',
  },
  input: {
    activePointers: 3, // 支持摇杆 + 按钮同时触摸
    topOnly: true,
  },
  banner: false,
  // 场景顺序：Boot 读取数据 → Preload 准备资源 → 进入菜单
  scene: [
    BootScene,
    PreloadScene,
    MenuScene,
    ChapterSelectScene,
    MapScene,
    PoemBookScene,
    AnecdoteScene,
    ReviewScene,
    CollectionScene,
    ExcerptScene,
    SettingScene,
    LevelScene,
    SortPoemScene,
    MeaningMatchScene,
    PoemMatch3Scene,
    PoemKlondikeScene,
    PoemChainScene,
    ClassicalQuizScene,
    FeihuaLingScene,
    RandomChallengeScene,
  ],
};
