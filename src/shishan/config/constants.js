/**
 * 全局常量：设计分辨率与场景 key。
 * 单独成文件，避免 gameConfig 与 UI 组件之间产生循环依赖。
 */

export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

/** 场景 key 统一常量，避免手写字符串出错 */
export const SCENES = {
  BOOT: 'BootScene',
  PRELOAD: 'PreloadScene',
  MENU: 'MenuScene',
  CHAPTER_SELECT: 'ChapterSelectScene',
  MAP: 'MapScene',
  POEM_BOOK: 'PoemBookScene',
  ANECDOTE: 'AnecdoteScene',
  REVIEW: 'ReviewScene',
  COLLECTION: 'CollectionScene',
  EXCERPT: 'ExcerptScene',
  SETTING: 'SettingScene',
  LEVEL: 'LevelScene',
  // 独立玩法场景（不经过 LevelScene 跳板，可单独启动）
  SORT_POEM: 'SortPoemScene',
  MEANING_MATCH: 'MeaningMatchScene',
  POEM_MATCH3: 'PoemMatch3Scene',
  POEM_KLONDIKE: 'PoemKlondikeScene',
  POEM_CHAIN: 'PoemChainScene',
  CLASSICAL_QUIZ: 'ClassicalQuizScene',
  FEIHUA_LING: 'FeihuaLingScene',
  RANDOM_CHALLENGE: 'RandomChallengeScene',
};
