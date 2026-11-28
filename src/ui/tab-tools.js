/**
 * 工具页：单词机 + 更多玩法（小游戏入口）。
 *
 * 【为什么游戏挪到这里】转盘提到首屏当主体之后，
 *   游戏就不再是「一个平级的标签」，而是「工具页里的附加玩法」。
 *   这样首屏第一印象是工具，游戏退到第二层，
 *   和「工具类小程序」的准入口径一致。
 *
 * 【为什么不做成折叠面板】折叠要多一次点击，
 *   而这些游戏是用户明确要的内容，不该藏。
 *   用分组标题把它们和工具区分开就够了。
 */
import { h } from '../core/util.js';
import { ALL_GAMES } from '../games/index.js';
import { FEATURES } from '../core/variant.js';
import { openGameScreen } from './game-screen.js';
import { openLiushuiScreen } from '../tools/liushui/screen.js';
import { openShishanScreen } from './shishan-screen.js';
import { openDonghaiScreen } from '../tools/donghai/screen.js';
import { openWordGameScreen } from '../tools/danciji/screen.js';
import { openRailScreen } from '../tools/rail/screen.js';

const EMOJI = {
  minesweeper: '💣', fruitninja: '🍉', g2048: '🔢', snake: '🐍', liushui: '💧',
  shishan: '⛰',
};

/**
 * 选模式弹层。
 *
 * 【为什么需要这一步】原来点游戏卡片直接进 modes[0]，
 *   等于把「穿墙」「迷宫」「8 人局」这些模式全藏起来了——
 *   用户根本不知道有这些玩法，meta.modes 里写多少种都白搭。
 *   模式少的游戏（1 种）直接跳过弹层，不为了一次点击多弹一层。
 */
function openModePicker(g, onPick) {
  if (g.modes.length <= 1) { onPick(g.modes[0].value); return; }

  const mask = h('div', { class: 'modal-mask' });
  const sheet = h('div', { class: 'modal' });
  sheet.appendChild(h('h3', { style: { margin: '0 0 12px' } }, g.title + ' · 选模式'));

  const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '58vh', overflowY: 'auto' } });
  for (const m of g.modes) {
    list.appendChild(h('button', {
      class: 'hud-btn',
      style: { padding: '12px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '3px' },
      onclick: () => { close(); onPick(m.value); },
    }, [
      h('span', { style: { fontWeight: '700' } }, m.label),
      m.sub ? h('span', { style: { fontSize: '12px', opacity: '0.62' } }, m.sub) : null,
    ]));
  }
  sheet.appendChild(list);
  sheet.appendChild(h('button', {
    class: 'hud-btn',
    style: { marginTop: '10px', padding: '11px' },
    onclick: () => close(),
  }, '取消'));

  function close() { mask.remove(); }
  mask.appendChild(sheet);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  document.body.appendChild(mask);
}

export function renderToolsTab(state, rerender, opts = {}) {
  const box = h('div', {});
  // 【为什么用参数而不是另写一个页面】「复古游戏」的首屏就是游戏列表，
  //   而游戏列表本来就长在工具页里。复制一份出来会产生两套入口逻辑，
  //   以后加游戏、改跳转要改两处，必然漏。这里只控制"显示哪几段"。
  const gamesOnly = !!opts.gamesOnly;

  // ---- 工具 ----
  // 复古游戏版没有单词机（它依赖联网的 AI 整理与朗读），整段跳过
  if (!gamesOnly) {
  box.appendChild(h('div', { class: 'section-title' }, '实用工具'));
  const grid = h('div', { class: 'tool-grid' });
  // 单词机：放在「实用工具」分组里，和设置页的存档统计对应
  grid.appendChild(h('button', {
    class: 'tool-card',
    style: { '--hero-accent': '#6ea8ff' },
    onclick: () => openWordGameScreen({ onExit: () => rerender() }),
  }, [
    h('div', { class: 'tool-art', style: { background: '#6ea8ff1f', borderColor: '#6ea8ff44' } }, '📖'),
    h('div', { style: { flex: '1', textAlign: 'left' } }, [
      h('h3', {}, '单词机'),
      h('p', {}, '背单词 · 背课文 · 生词本 · 离线可用'),
    ]),
    h('div', { class: 'chev' }, '›'),
  ]));

  grid.appendChild(h('button', {
    class: 'tool-card',
    style: { '--hero-accent': '#e0728f' },
    onclick: () => openRailScreen({ onExit: () => rerender() }),
  }, [
    h('div', { class: 'tool-art', style: { background: '#e0728f1f', borderColor: '#e0728f44' } }, '🎫'),
    h('div', { style: { flex: '1', textAlign: 'left' } }, [
      h('h3', {}, '火车票根'),
      h('p', {}, '仿真实体票面 · 可导出图片 · 离线可用'),
    ]),
    h('div', { class: 'chev' }, '›'),
  ]));
  box.appendChild(grid);
  }

  // ---- 更多玩法 ----
  // 【为什么要按游戏逐个筛，而不是整体开关】诗山寻踪虽然注册在游戏表里，
  //   但它是学习类内容（读诗、收集、朗读），属于「学习与实用工具」的核心功能；
  //   扫雷、2048 那些才是要搬到「复古游戏」的。
  //   用一个总开关会把诗山一起藏掉——那正是之前的错误。
  const visibleGames = ALL_GAMES.filter((g) => (g.isStoryGame ? FEATURES.shishan : FEATURES.games));
  if (!visibleGames.length) return box;
  box.appendChild(h('div', { class: 'section-title', style: { marginTop: gamesOnly ? '0' : '22px' } },
    gamesOnly ? '全部游戏' : '更多玩法'));
  const games = h('div', { class: 'home-games' });
  for (const g of visibleGames) {
    games.appendChild(h('button', {
      class: 'home-game',
      style: { '--chip-accent': g.accent },
      onclick: () => {
        // 【为什么诗山要单独一个分支】它不是一个「一局结束出分数」的小游戏，
        //   而是一整个带章节、地图、收集的长线流程，有自己的 Phaser 实例和存档。
        //   它也不进排行榜——没有「一局」这个概念，硬凑一个分数没有意义。
        if (g.isStoryGame) {
          openShishanScreen({ onExit: () => rerender() });
          return;
        }
        if (g.isLevelGame) {
          openLiushuiScreen({ startLevel: 0, onExit: () => rerender() });
          return;
        }
        // 推币机：没有模式选择、没有"一局"，直接进机台，
        //   结算由玩家在机台里自己按。
        if (g.isCoinGame) {
          openDonghaiScreen({ onExit: () => rerender() });
          return;
        }
        openModePicker(g, (mode) => {
          openGameScreen({
            meta: g,
            mode,
            appState: state,
            onExit: () => rerender(),
            onProfileChange: () => rerender(),
          });
        });
      },
    }, [
      h('span', { class: 'hg-emoji' }, EMOJI[g.id] || '🎮'),
      h('span', { class: 'hg-name' }, g.title),
      h('span', { class: 'hg-sub' }, g.isStoryGame ? '诗卷 · 长线' : g.isCoinGame ? '推币 · 周榜' : g.modes.length + ' 种模式'),
    ]));
  }
  box.appendChild(games);

  // ---- 说明 ----
  // 复古游戏版没有联网功能，不需要「离线与联网」这段权限说明
  if (gamesOnly) return box;
  box.appendChild(h('div', { class: 'section-title', style: { marginTop: '22px' } }, '说明'));
  // 【为什么不能写"全部离线可用"】单词机的 AI 解析、AI 配音、音色克隆
  //   和诗山寻踪的朗读都要联网调用大模型。笼统写"不联网"是对用户的误导，
  //   也会让上架审核认为我们隐瞒了网络权限。这里如实分两类说明。
  box.appendChild(h('div', { class: 'card' }, [
    h('h3', {}, '离线与联网'),
    h('div', { class: 'hint', style: { lineHeight: '1.7' } },
      '转盘、小玩法、单词机的背词与课文全部离线运行，配置与记录保存在小黑盒账号存储里。'
      + '仅单词机的 AI 解析 / AI 配音 / 音色克隆和诗山朗读需要联网，且都由你主动触发。'),
  ]));

  return box;
}
