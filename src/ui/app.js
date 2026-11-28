/**
 * 应用外壳：三个标签页 + 常驻右上角设置。
 *
 * 【为什么设置按钮放在外壳而不是各页面里】用户明确要求"设置页按钮永远在右上角"。
 *   放进每个页面的模板里，迟早有页面忘记加；放在外壳的 topbar 里就不可能漏。
 *   工具内部页面（转盘/检测）有自己的 header，所以外壳在进入子页面时
 *   会把设置按钮的点击目标换成子页面自己的设置入口，保证"永远在"。
 */
import { h } from '../core/util.js';
import { applySafeArea } from './safe-area.js';
import { whenReady, getMode, onModeFix } from '../sdk/hb.js';
import { refreshAccount, getAccount } from '../sdk/account.js';
import { loadProfile } from '../core/achievements.js';
import { loadScores, wipeGameScores } from '../core/scores.js';
import { migrateSave } from '../core/savever.js';
import { GAMES } from '../games/index.js';
import { TABS, DEFAULT_TAB, APP_NAME } from '../core/variant.js';
import { renderHomeTab } from './tab-home.js';
import { renderToolsTab } from './tab-tools.js';
import { renderMineTab } from './tab-mine.js';
// 【一杆清台为什么用动态 import】那是第三个小程序，**不开源**，
//   它的源码目录写在 .gitignore 里。这里若用静态 import，公开仓库就少一个文件、
//   构建直接失败。动态 import 让打包器不把它算作必需依赖，
//   本地构建时文件在、运行时能正常加载；公开仓库里那段分支根本走不到。
let renderPoolTabLazy = null;
async function ensurePoolTab() {
  if (!renderPoolTabLazy) {
    const m = await import(/* @vite-ignore */ './tab-pool.js');
    renderPoolTabLazy = m.renderPoolTab;
  }
  return renderPoolTabLazy;
}
import { openSettings } from './settings.js';
import { setSettingsOpener } from './global.js';
import { toast } from './toast.js';
import { preloadMods } from '../mod/store.js';
import { onAppHide, onAppShow } from '../sdk/hb.js';
import { onAppHideAudio, onAppShowAudio } from '../core/audio.js';

/**
 * 三个标签：转盘 / 工具 / 我的。
 *
 * 【为什么原来的「游戏」标签没了】审核把「内置游戏」当独立游戏产品时
 *   会牵扯版号问题。把转盘（纯本地抽签工具）提到首屏当主体，
 *   小游戏降级为「工具页里的更多玩法」，定位就从「这是个游戏 app」
 *   变成「这是个工具 app，附带几个小玩法」，和工具类小程序的口径一致。
 *   用户要的游戏一个没少，只是入口下移了一层。
 */
// TABS / DEFAULT_TAB / APP_NAME 来自 core/variant.js：
// 「复古游戏」只有 游戏 + 我的 两个 tab，首屏是游戏列表；
// 「学习与实用工具」是 转盘 + 工具 + 我的，首屏是转盘。

export function createApp(root) {

  /**
   * 启动时把本机综合总分补传到云端。
   *
   * 【为什么需要它】云端榜只在"玩完一局"时提交，于是三类玩家会长期缺席：
   *   1. 换手机 / 清缓存后重新登录的 —— 本机有成绩，榜上是空的；
   *   2. 更新完版本还没玩任何一局的；
   *   3. 榜单被重建过的 —— 这次误删 hb_total_quantized 就是这种情况，
   *      旧记录全没了，只能靠客户端把本机成绩重新提交回去。
   *   分数存在 save_18 里，是玩家真实打出来的，重传不会虚增。
   *
   * 【为什么不 await】它要发网络请求，await 会让首屏多等一个往返。
   *   结果只影响榜单，不影响渲染，后台跑完即可。
   *
   * 【为什么静默】玩家没主动操作，不该因网络失败弹提示。
   *   未登录返回 not-logged-in 是正常状态，不是错误。
   */
  function syncTotalOnStartup(runMode) {
    // 【为什么 mode 要传进来】mode 是 boot() 里的局部变量（await whenReady() 的结果），
    //   定义在这个作用域取不到 —— 直接引用会抛 ReferenceError: mode is not defined，
    //   而它是在 .then 里跑的，异常被 Promise 吞掉，表现为"补传静默不生效"。
    if (runMode !== 'host') return; // 预览模式没有云端榜
    import('../sdk/leaderboard.js')
      .then(({ submitTotalScore }) => submitTotalScore({ extra: {}, modded: false }))
      .then((res) => {
        if (res && res.ok) console.log('[app] 综合总分已补传', res.total);
        else if (res) console.log('[app] 综合总分未补传：', res.reason);
      })
      .catch((e) => console.warn('[app] 综合总分补传失败', e));
  }

  const state = {
    tab: DEFAULT_TAB,
    gameId: GAMES[0].id,
    mode: GAMES[0].modes[0].value,
    profile: null,
    modeLabel: '启动中',
  };

  const brand = h('div', { class: 'brand' }, [h('div', { class: 'brand-dot' }), APP_NAME]);
  const settingsBtn = h('button', {
    class: 'icon-btn',
    title: '设置',
    // 【为什么把 openSettings 挂到 state 上】「我的」页也有一个「设置」按钮，
    //   它通过 state.openSettings?.() 调用。但 state 里从来没赋过这个字段，
    //   于是那个按钮点了毫无反应——不报错、不弹窗，最难查的一类 bug。
    //   这里统一挂一次，两处入口共用同一套设置页。
    onclick: () => openSettings(state),
  }, '⚙');
  // 全屏页（游戏/工具）也走同一个入口，保证"设置永远在右上角"
  setSettingsOpener(() => openSettings(state));
  state.openSettings = () => openSettings(state);
  const topbar = h('div', { class: 'topbar' }, [brand, settingsBtn]);
  const page = h('div', { class: 'page' });
  const tabbar = h('div', { class: 'tabbar' });

  const shell = h('div', { class: 'shell' }, [topbar, page, tabbar]);
  root.innerHTML = '';
  root.appendChild(shell);

  const tabButtons = TABS.map((t) => {
    const btn = h('button', {
      onclick: () => {
        if (state.tab === t.id) return;
        state.tab = t.id;
        render();
      },
    }, [h('span', { class: 'tab-ico' }, t.icon), h('span', {}, t.label)]);
    tabbar.appendChild(btn);
    return { ...t, btn };
  });

  function syncTabs() {
    for (const t of tabButtons) t.btn.classList.toggle('active', t.id === state.tab);
  }

  /** 当前标签页返回的清理函数（转盘要停 rAF、解绑 resize） */
  let disposeTab = null;

  function render() {
    syncTabs();
    page.scrollTop = 0;
    if (disposeTab) { try { disposeTab(); } catch (e) { /* 清理失败不该挡住渲染 */ } disposeTab = null; }
    page.innerHTML = '';
    if (state.tab === 'pool') {
      // 动态加载：公开仓库里没有这个文件，所以不能静态依赖它。
      // 加载失败时退回工具页，别留一个白屏。
      ensurePoolTab().then((fn) => {
        if (fn) page.appendChild(fn(state, render));
      }).catch(() => { state.tab = 'tools'; render(); });
    } else if (state.tab === 'games') {
      // 复古游戏的首屏：直接就是游戏列表，没有转盘。
      // 【为什么复用 tools 页】游戏入口本来就在工具页里，
      //   单独写一个列表页会产生两套入口逻辑，改一处忘一处。
      page.appendChild(renderToolsTab(state, render, { gamesOnly: true }));
    } else if (state.tab === 'home') {
      const t = renderHomeTab(state, render);
      page.appendChild(t.el);
      disposeTab = t.destroy;
    } else if (state.tab === 'tools') page.appendChild(renderToolsTab(state, render));
    else page.appendChild(renderMineTab(state, render));
  }

  /** 进入子页面时隐藏底部标签栏，避免误触 */
  function setImmersive(on) {
    tabbar.style.display = on ? 'none' : 'flex';
    topbar.style.display = on ? 'none' : 'flex';
  }

  // 启动流程：先握手，再读存档，最后渲染
  (async () => {
    const mode = await whenReady();
    state.modeLabel = mode === 'host' ? '小黑盒客户端' : '浏览器预览';
    // 安全区必须在第一次渲染之前写好，否则首帧标题会被状态栏盖住
    await applySafeArea();
    // 账号：先静默读登录态（不弹授权框），再读存档
    await refreshAccount();
    state.account = getAccount();
    state.user = state.account.user;
    // 【为什么存档升级必须在 loadScores 之前】推币机出过能刷分的 bug，
    //   没有版本号的老存档里那些成绩不可信。必须先把它们作废，
    //   再读最高分——顺序反过来就会先读到脏数据并渲染出去。
    //   已经升过级的存档（版本号对得上）这里什么都不做。
    try {
      await migrateSave({
        // 作废动作注入进来：savever 只管版本判断，不该知道成绩存哪
        wipeDonghai: async () => {
          // 推币机的成绩不在 save_18（它从不调 recordBest），
          // 而是 save_41 的战绩 + save_42 的局内进度，两处都要清。
          const { wipeDonghaiStats } = await import('../tools/donghai/stats.js');
          await wipeDonghaiStats();
          // 顺手清一遍最高分表：将来若给推币机接了 recordBest，
          // 这条也不会漏（现在没接，属于防御）。
          await wipeGameScores('donghai');
        },
      });
    } catch (e) {
      console.warn('[app] 存档升级失败，按原样继续', e);
    }
    // 【为什么要在这里主动加载最高分】「我的」页要同步算出综合总分，
    //   用的是 getAllSync()——它只读内存缓存。启动时不加载的话，
    //   第一次进「我的」页会看到总分 0，切个页面才正常。
    await loadScores();
    // 【为什么启动时要补传一次综合总分】云端榜只在"玩完一局"时提交，
    //   于是有三种玩家会长期缺席：
    //     1. 换手机 / 清缓存后重新登录的 —— 本机有成绩，但榜上是空的；
    //     2. 刚更新完版本还没玩任何一局的；
    //     3. 榜单被重建过（这次误删 hb_total_quantized 就是这种情况），
    //        旧记录全没了，只能靠客户端把本机成绩重新提交回去。
    //   分数本身存在 save_18 里，是玩家真实打出来的，重传不会虚增。
    //   submitTotalScore 内部已处理：0 分不提交、未登录不报错、模组局不提交，
    //   所以这里只管调用，失败也不打扰玩家。
    syncTotalOnStartup(mode);
    state.profile = await loadProfile();
    // 模组脚本必须同步可读（游戏启动那一刻就要拿到），所以先预载进内存
    await preloadMods();
    // 切后台就停音乐（省电），回前台接着放
    onAppHide(onAppHideAudio);
    onAppShow(onAppShowAudio);
    render();
    if (mode === 'web') {
      toast('当前为浏览器预览模式，云端排行榜不可用', 2600);
    }

    // 【为什么启动后还要复查一次登录态】真机冷启动时 Host 的账号快照
    //   往往比小程序本体就绪得晚。启动那一刻读到"未登录"，几百毫秒后
    //   其实已经登录了。不复查的话，用户会看到「未登录」一直挂着，
    //   必须手动切页面才可能刷新——这正是"检测不到登录态"的另一半原因。
    //   只在确实是 guest 时才复查，已登录就不打扰。
    if (state.account && state.account.state !== 'ok' && mode === 'host') {
      setTimeout(async () => {
        try {
          const before = state.account && state.account.state;
          await refreshAccount({ useCache: false });
          const now = getAccount();
          // 只有状态真的变好了才重画，避免无意义闪烁
          if (now.state === 'ok' && before !== 'ok') {
            state.account = now;
            state.user = now.user;
            render();
          } else {
            state.account = now;
          }
        } catch { /* 复查失败保持原状 */ }
      }, 2500);
    }

    // 握手迟到：从「浏览器预览」纠正成「客户端」。
    // 【为什么必须重画】「我的」页面的昵称是渲染时读 state.user 写死的，
    //   不重画的话，用户会一直看到「本机玩家」，哪怕其实已经连上了。
    onModeFix(async () => {
      state.modeLabel = '小黑盒客户端';
      try {
        await refreshAccount({ useCache: false });
        state.account = getAccount();
        state.user = state.account.user;
        state.profile = await loadProfile();
      } catch { /* 拿不到就维持原样，不影响其他功能 */ }
      render();
      toast('已连接小黑盒账号', 'good');
    });
  })();

  return { state, render, setImmersive, settingsBtn };
}
