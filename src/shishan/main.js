/**
 * 游戏入口。
 * 创建 Phaser.Game，并把实例注入音频管理器（用于后续加载 BGM）。
 * 离线单机：不发起任何网络请求（JSON 资源来自本地 public 目录）。
 */

import Phaser from 'phaser';

import { GAME_CONFIG } from './config/gameConfig.js';
import { SCENES } from './config/constants.js';
import { audio } from './managers/AudioManager.js';
import { progress } from './managers/ProgressManager.js';

const game = new Phaser.Game(GAME_CONFIG);

// BGM 预留：AudioManager 需要游戏实例才能从缓存里取音频
audio.setGame(game);

// 首次触摸 / 点击时唤醒 WebAudio，避免浏览器自动播放限制
window.addEventListener(
  'pointerdown',
  () => audio.unlock(),
  { once: true },
);

// 方便在浏览器控制台调试存档与场景
window.__POEM_GAME__ = game;
// 进度管理器同样挂到控制台：可查 getChapterStatus()、isDevUnlockAll()
window.__POEM_PROGRESS__ = progress;
// 音频管理器同样挂到控制台：可查 getBgmDebug()、单独试听音效
window.__POEM_AUDIO__ = audio;

// ---------------------------------------------------------------
// 独立玩法入口（不改动任何原有场景代码）
//   /?sort=1  → 诗句排序 SortPoemScene
//   /?match=1 → 诗意配对 MeaningMatchScene
//   /?match3=1 → 诗句三消 PoemMatch3Scene
//   /?klondike=1 → 诗句华容道 PoemKlondikeScene
//   /?chain=1    → 诗句接龙 PoemChainScene
//   /?classical=6 → 文言文意问答 ClassicalQuizScene
//   /?feihua=1    → 人机对战飞花令 FeihuaLingScene（可加 &keyword=月 指定关键字）
//   /?trial=1     → 综合试炼房 RandomChallengeScene（可加 &range=intro / &range=advanced）
// 参数值就是 poem_db.json 里的 poemId。正式接入时只需在菜单/地图里
// scene.start(SCENES.XXX, { poemId }) 即可，本段可整体删掉。
// ---------------------------------------------------------------
const query = new URLSearchParams(window.location.search);
const standaloneEntries = [
  { param: 'sort', key: SCENES.SORT_POEM },
  { param: 'match', key: SCENES.MEANING_MATCH },
  { param: 'match3', key: SCENES.POEM_MATCH3 },
  { param: 'klondike', key: SCENES.POEM_KLONDIKE },
  { param: 'chain', key: SCENES.POEM_CHAIN },
  { param: 'classical', key: SCENES.CLASSICAL_QUIZ },
  // 飞花令不需要绑定单首诗，参数只当开关用
  { param: 'feihua', key: SCENES.FEIHUA_LING, keyword: true },
  // 综合试炼房不绑定单首诗，参数只当开关用，可用 &range= 指定难度区间
  { param: 'trial', key: SCENES.RANDOM_CHALLENGE, range: true },
];
const standaloneEntry = standaloneEntries.find(
  (entry) => Number(query.get(entry.param) || 0) > 0,
);

if (standaloneEntry) {
  const entryPoemId = Number(query.get(standaloneEntry.param));

  // READY 之后场景实例才存在；此时 MenuScene 还没 create，
  // 等它 create 完（定位、音频都准备好了）再切到玩法场景，避免两个场景同时响应触摸。
  game.events.once(Phaser.Core.Events.READY, () => {
    const enterStandaloneScene = () => {
      const entryData = { poemId: entryPoemId };
      // 飞花令不绑定单首诗，支持 ?feihua=1&keyword=月 直接开局
      if (standaloneEntry.keyword) entryData.keyword = query.get('keyword') || '';
      // 综合试炼房支持 ?trial=1&range=intro 直接指定难度区间
      if (standaloneEntry.range) entryData.range = query.get('range') || '';
      game.scene.stop(SCENES.MENU);
      game.scene.start(standaloneEntry.key, entryData);
    };

    const menuScene = game.scene.getScene(SCENES.MENU);
    if (!menuScene) {
      enterStandaloneScene();
      return;
    }

    if (menuScene.sys.settings.status >= Phaser.Scenes.RUNNING) {
      enterStandaloneScene();
    } else {
      menuScene.events.once(Phaser.Scenes.Events.CREATE, enterStandaloneScene);
    }
  });
}

// ---------------------------------------------------------------
// 测试页直达入口（仅测试用，正式上线可整段删除）
//   /?level=42   → 直接进第 42 首诗的「看图猜诗」关卡（后续章节的诗也能进）
//   /?chapter=3  → 直接打开章卷（可加 &unlock=all 让六章全部显示可游历）
//   /?unlock=all → 本次会话临时解锁全部章节（只改内存，不写存档）
// ---------------------------------------------------------------
const devLevelId = Number(query.get('level') || 0);
const devChapterId = Number(query.get('chapter') || 0);
const devUnlockAll = String(query.get('unlock') || '').toLowerCase() === 'all';

if (devLevelId > 0 || devChapterId > 0 || devUnlockAll) {
  game.events.once(Phaser.Core.Events.READY, () => {
    const enterDevEntry = (menuScene) => {
      // 必须在章节界面 create 之前打标记，测试页才能看到「六章可游历」
      if (devUnlockAll) progress.setDevUnlockAll(true);

      if (devChapterId > 0) {
        game.scene.stop(SCENES.MENU);
        game.scene.start(SCENES.CHAPTER_SELECT, {});
        return;
      }

      if (devLevelId > 0) {
        // 关卡叠在暂停的主菜单上：关闭关卡时会 resume 回主菜单，和地图进关卡一致
        game.scene.pause(SCENES.MENU);
        const levelData = {
          poemId: devLevelId,
          returnScene: SCENES.MENU,
          mode: 'guess_poem',
        };
        // game.scene 是 SceneManager，没有 launch；并行启动要用场景的 ScenePlugin
        if (menuScene) menuScene.scene.launch(SCENES.LEVEL, levelData);
        else game.scene.start(SCENES.LEVEL, levelData);
        game.scene.bringToTop(SCENES.LEVEL);
      }
    };

    const menuScene = game.scene.getScene(SCENES.MENU);
    if (!menuScene) {
      enterDevEntry(null);
      return;
    }
    if (menuScene.sys.settings.status >= Phaser.Scenes.RUNNING) {
      enterDevEntry(menuScene);
    } else {
      menuScene.events.once(Phaser.Scenes.Events.CREATE, () => enterDevEntry(menuScene));
    }
  });
}

// 移动端：阻止双指缩放与长按菜单（画布内已由 Phaser 处理）
document.addEventListener('gesturestart', (event) => event.preventDefault());
console.info('[诗山寻踪] 游戏启动完成。');
