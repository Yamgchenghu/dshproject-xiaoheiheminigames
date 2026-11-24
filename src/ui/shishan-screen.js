/**
 * 诗山寻踪的宿主页：把 Phaser 游戏挂进小程序的全屏层。
 *
 * 【为什么要有这一层，而不是让 Phaser 直接接管页面】
 *   小程序外壳有两条硬规矩：
 *     1. 设置按钮永远在右上角（用户明确要求），全屏页盖住外壳时也得补一个；
 *     2. 返回必须是显式的「‹」，不能依赖浏览器后退。
 *   所以这里复刻 game-screen.js 的做法：自己建一个全屏 div，
 *   顶上放一条 HUD（返回 / 标题 / 设置），下面才是 Phaser 的容器。
 *
 * 【为什么 Phaser 的 canvas 要自己塞进去】
 *   Phaser 的 parent 参数接受 HTMLElement，直接把它挂到我们的 wrap 里，
 *   Scale.FIT 会按 wrap 的尺寸自适应，不需要额外算像素比。
 */
import { h } from '../core/util.js';
import { openGlobalSettings } from './global.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../shishan/config/constants.js';

/** 同一次会话里只创建一次 Phaser 实例，退出时销毁，避免 WebGL 上下文泄漏。 */
let activeGame = null;

export function openShishanScreen({ onExit }) {
  /**
   * 【整体旋转方案】诗山是 1280×720 的横屏游戏，小程序是竖屏（实测 440×956）。
   *
   * 试过三种摆法，前两种都不成立：
   *   1. 直接 FIT —— 画面完整但只有 440×247，字小到看不清；
   *   2. 只转 canvas —— 画面铺满了，但 HUD 是竖的、游戏是横的，
   *      两套坐标系打架，视觉上错位（实测过，截图里就是歪的）。
   *   3. 【采用】把「HUD + 舞台」整层旋转 90° —— 两者在同一个坐标系里，
   *      布局逻辑完全按横屏写（就像原版 APK），最后由外壳统一转正。
   *      玩家横着拿手机，看到的就是原版界面。
   *
   * 实现要点：外壳 .shishan-rotate 定宽定高（宽=屏高、高=屏宽），
   * 再绕自身中心 rotate(90deg) 铺满竖屏。里面的 .shishan-screen
   * 就是一个普通的 803×440 横屏页面，HUD 在上、舞台在下。
   */
  const rotate = h('div', { class: 'shishan-rotate' });
  const host = h('div', { class: 'shishan-screen' });
  const wrap = h('div', { class: 'shishan-stage' });
  const loading = h('div', { class: 'shishan-loading' }, [
    h('div', { class: 'spinner' }),
    h('div', {}, '正在铺开诗卷……'),
  ]);

  /**
   * 【为什么返回键放右边、贴着设置】这一层是整体转了 90° 的横屏，
   *   旋转之后 HUD 的左端正好落在手机的「顶部」——也就是状态栏、
   *   刘海、以及宿主 App 的关闭按钮那一带。返回键放那儿会被挡住，
   *   点不到。
   *
   *   把「返回 + 设置」一起放到旋转后的右端（对应手机右侧中上部），
   *   这里既没有状态栏也没有关闭键，而且两个按钮挨着，拇指横向拿手机
   *   时右手食指一伸就能够到。标题留在左端当视觉锚点。
   */
  const hud = h('div', { class: 'shishan-hud' }, [
    h('div', { class: 'shishan-title' }, '诗山寻踪'),
    h('div', { class: 'hud-spacer' }),
    h('button', { class: 'hud-back', title: '返回', onclick: () => exit() }, '‹'),
    h('button', { class: 'icon-btn', title: '设置', onclick: () => openGlobalSettings() }, '⚙'),
  ]);

  host.appendChild(hud);
  host.appendChild(loading);
  host.appendChild(wrap);
  rotate.appendChild(host);
  // 同 game-screen：全屏层直接挂 body，进门前先清掉可能残留的旧层，
  // 否则多个 canvas 叠在一起，点击会落到看不见的那一个上。
  for (const old of document.querySelectorAll('.game-screen, .shishan-rotate')) old.remove();
  document.body.appendChild(rotate);

  /**
   * 按屏幕尺寸摆放旋转外壳。
   * 【为什么要手动算宽高】rotate 之后元素的「布局宽高」和「视觉宽高」
   *   是反的：要让视觉上铺满 440×956，布局上必须写成 956×440。
   *   CSS 没法自动完成这个交换，只能由 JS 显式设置。
   */
  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!w || !h) return;
    rotate.style.width = h + 'px';
    rotate.style.height = w + 'px';
    // 旋转是绕中心进行的，中心对齐了，四边自然对齐
    rotate.style.left = (w - h) / 2 + 'px';
    rotate.style.top = (h - w) / 2 + 'px';

    // 【为什么不能靠 wrap 的 100% 让 Phaser 自己量】
    //   Phaser 用 parent.getBoundingClientRect() 取尺寸，这个 API 会把
    //   祖先的 transform 算进去。wrap 在旋转层里面，量到的是「旋转后的
    //   包围盒」——宽高互换之外还带着矩阵缩放，实测得到 219×390，
    //   而我们需要的是 803×440 的横屏舞台。结果画面缩到左上角。
    //
    //   setParentSize 可以直接告诉 Phaser「父容器是这么大」，
    //   跳过 DOM 测量。这里传进去的是旋转前的布局尺寸：
    //   宽 = 屏幕高，高 = 屏幕宽（因为整体转了 90°）。
    wrap.style.width = '100%';
    wrap.style.height = '100%';

    // 【为什么由我们告诉 Phaser 尺寸】它的 getParentBounds 已经被换成
    //   空实现（见 shishan-entry.js），不会再自己量 DOM，所以尺寸必须由
    //   这里显式喂进去。传的是「旋转前的布局尺寸」：
    //     宽 = 屏幕高（956），高 = 屏幕宽 - HUD（440 - 49 = 390）。
    //   Phaser 拿到之后会自己按 FIT 算 canvas 显示尺寸，并且同步建立
    //   「屏幕坐标 → 1280×720 游戏坐标」的换算——输入映射就是靠这个，
    //   所以点击位置才能和画面对上。
    //
    // 【为什么用 offsetHeight 量 HUD】HUD 是横条（布局 956×49），旋转后
    //   它的包围盒变成 49 宽 × 956 高，取 getBoundingClientRect().height
    //   会拿到 956，把整个舞台挤没。offsetHeight 是布局尺寸，不受
    //   transform 影响，拿到的才是真正的 49。
    if (activeGame && activeGame.scale) {
      try {
        const boxW = h;                                  // 旋转前的舞台宽 = 屏幕高
        const boxH = Math.max(160, w - (hud.offsetHeight || 46)); // 旋转前的舞台高
        activeGame.scale.setParentSize(boxW, boxH);

        // 【为什么还要自己补 margin】
        //   Phaser 配的是 autoCenter: NO_CENTER，它只算 canvas 的显示尺寸，
        //   不负责摆位置，画布会贴在舞台左上角。
        //   而 1280:720（1.78）和舞台 956:390（2.45）宽高比不同，
        //   FIT 按高度缩放得到 693×390，舞台还剩 263px 横向空隙。
        //   空隙全留在右侧时，竖着看就是「画面挤在上半屏、下面一大片空白」，
        //   也就是玩家说的错位。这里把空隙对半分，让画布居中。
        //
        //   注意用的是 canvas 的 offsetWidth/offsetHeight（布局尺寸），
        //   不是 getBoundingClientRect()——后者在旋转层里是包围盒，宽高互换。
        const cv = activeGame.canvas;
        if (cv) {
          const cw = cv.offsetWidth || 0;
          const ch = cv.offsetHeight || 0;
          cv.style.marginLeft = Math.max(0, Math.round((boxW - cw) / 2)) + 'px';
          cv.style.marginTop = Math.max(0, Math.round((boxH - ch) / 2)) + 'px';
        }
      } catch { /* 还没启动完，忽略 */ }
    }
  }
  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);

  let destroyed = false;

  function exit() {
    if (destroyed) return;
    destroyed = true;

    // 【为什么必须显式停音乐】AudioManager 是模块级单例，它挂在 Phaser 之外，
    //   game.destroy() 清不掉它手里的 <audio> 元素和合成器——
    //   所以退出后音乐会一直响，而且没有界面能关，玩家只能杀掉整个小程序。
    //
    // 【为什么不能在这里 import AudioManager】主包和诗山包是两个独立 bundle，
    //   各自会打进去一份 AudioManager，也就各有一个 audio 实例。
    //   在这里 import 再 stopBgm()，停的是主包那份，
    //   而真正在响的是诗山那份——实测完全没效果。
    //   所以改调 game 上挂的钩子，由持有该单例的一侧执行。
    if (activeGame && typeof activeGame.stopAllAudio === 'function') {
      try { activeGame.stopAllAudio(); } catch (error) { console.warn('[诗山] 停止音乐失败：', error); }
    }
    // 正在朗读古诗时退出，也要掐掉，不然声音会跟到别的页面
    try { stopTts(); } catch { /* 忽略 */ }

    // 【为什么必须先 destroy】Phaser 的 WebGL 上下文数量有限，
    //   反复进出而不销毁，几次之后就会拿到 null 上下文直接黑屏。
    if (activeGame) {
      try { activeGame.destroy(true); } catch (error) { console.warn('[诗山] 销毁失败：', error); }
      activeGame = null;
    }
    window.removeEventListener('resize', layout);
    window.removeEventListener('orientationchange', layout);
    rotate.remove();
    if (typeof onExit === 'function') onExit();
  }

  (async () => {
    try {
      const { createShishanGame } = await import('../shishan/shishan-entry.js');
      if (destroyed) return;
      activeGame = await createShishanGame(wrap);
      loading.remove();
      // READY 之后容器尺寸才算真正稳定，再摆一次
      layout();
      requestAnimationFrame(layout);
    } catch (error) {
      console.error('[诗山] 启动失败：', error);
      loading.innerHTML = '';
      loading.appendChild(h('div', { style: { color: '#ff9b9b', padding: '20px', textAlign: 'center' } },
        '诗卷没有打开：' + (error && error.message ? error.message : String(error))));
    }
  })();

  return { destroy: exit };
}
