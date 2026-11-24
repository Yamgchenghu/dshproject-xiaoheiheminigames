/**
 * 诗山寻踪的小程序入口。
 *
 * 【为什么不复用原版 main.js】原版是给浏览器/APK 用的，里面有一堆
 *   只对开发期有意义的入口：?level=42 直达关卡、?unlock=all 全章解锁、
 *   ?feihua=1&keyword=月 直达玩法，还有挂在 window 上的调试对象。
 *   这些在小程序里既没有 URL 参数可读，也不该暴露给玩家，
 *   而且 ?unlock=all 那种「临时解锁全部章节」的能力一旦留下，
 *   等于给玩家一个绕过进度的后门。所以这里只保留最小启动路径。
 *
 * 【为什么 Phaser 实例要能被外部销毁】小程序里玩家会反复进出这个页面，
 *   每次 new Phaser.Game 都会占一个 WebGL 上下文。浏览器上限通常是 8~16 个，
 *   不销毁的话进出几次就黑屏。销毁由 shishan-screen.js 的 exit() 负责。
 */
import Phaser from 'phaser';

import { GAME_CONFIG } from './config/gameConfig.js';
import { GAME_WIDTH, GAME_HEIGHT } from './config/constants.js';
import { audio } from './managers/AudioManager.js';

/**
 * 在给定容器里创建并启动诗山。
 * @param {HTMLElement} parent 承载 canvas 的容器
 * @returns {Promise<Phaser.Game>}
 */
/**
 * 让 Phaser 的指针换算认识「画布被旋转了 90°」这件事。
 * @param {Phaser.Game} game
 */
function installRotatedPointer(game) {
  // 【为什么是 game.input 而不是 game.input.manager】
  //   Phaser 3 的 Game.input 直接就是 InputManager 实例
  //   （Game.js 第 209 行 new InputManager）。之前写成 game.input.manager，
  //   那里是 undefined，函数一进来就 return，补丁从未装上——
  //   所以点击一直按「没旋转」的竖屏坐标换算，点开始游戏会落到设置上。
  const im = game.input;
  if (!im || typeof im.transformPointer !== 'function') return;

  im.transformPointer = function transformPointer(pointer, pageX, pageY, wasMove) {
    const p0 = pointer.position;
    const p1 = pointer.prevPosition;
    p1.x = p0.x;
    p1.y = p0.y;

    const canvas = game.canvas;
    // 包围盒是旋转后的：宽 = 画布本地高，高 = 画布本地宽。
    const box = canvas.getBoundingClientRect();
    // offsetWidth/offsetHeight 是布局尺寸，不受 transform 影响，
    // 拿到的才是画布「本地」的宽高。
    const cw = canvas.offsetWidth || box.height;
    const ch = canvas.offsetHeight || box.width;

    // pageX/pageY 含滚动偏移，getBoundingClientRect 是相对视口的，先对齐。
    const clientX = pageX - (window.scrollX || 0);
    const clientY = pageY - (window.scrollY || 0);

    // 【逆旋转 90° 的推导】
    //   CSS rotate(90deg) 是顺时针。画布本地坐标 (lx, ly)（原点在左上角，
    //   x 向右、y 向下）转 90° 之后：
    //       屏幕相对画布包围盒的 x = ch - ly
    //       屏幕相对画布包围盒的 y = lx
    //   （本地左上角 → 包围盒右上角；本地 x 轴 → 屏幕向下；
    //     本地 y 轴 → 屏幕向左。）
    //   反过来解：
    //       lx = clientY - box.top
    //       ly = ch - (clientX - box.left)
    //   注意这里的 box 是 canvas 自己的包围盒，不是外层旋转层的——
    //   两者尺寸一致（canvas 铺满舞台），但 canvas 可能在舞台内偏移，
    //   所以必须用 canvas 自己的 rect 做基准。
    const lx = clientY - box.top;          // 0 .. cw
    const ly = ch - (clientX - box.left);  // 0 .. ch

    const gs = game.scale.gameSize;
    const x = (lx / cw) * gs.width;
    const y = (ly / ch) * gs.height;

    const a = pointer.smoothFactor;
    if (!wasMove || a === 0) {
      p0.x = x;
      p0.y = y;
    } else {
      p0.x = x * a + p1.x * (1 - a);
      p0.y = y * a + p1.y * (1 - a);
    }
  };
}

export async function createShishanGame(parent) {
  // 【为什么要复制一份配置】GAME_CONFIG 里的 parent 是原版的 'game-container'，
  //   而小程序里我们用的是动态创建的 div，不能写死字符串 id。
  const config = { ...GAME_CONFIG, parent };

  // 【关键】Phaser 3 默认用 XHR/fetch 加载图片，而小程序的 CSP 里
  //   connect-src 只放行了 SDK 的日志端点，XHR 一律被拒；
  //   但 img-src 是允许 'self' 的。把加载方式换成 HTMLImageElement，
  //   Phaser 就改用 <img> 标签取图，正好落在 img-src 的放行范围内。
  //   这是实测出来的：改这一行之前 437 条 CSP 报错，改完归零。
  config.loader = { ...(config.loader || {}), imageLoadType: 'HTMLImageElement' };

  // 【横屏游戏放进竖屏小程序：整体旋转 90°】
  //   诗山原版是 sensorLandscape（强制横屏），设计分辨率 1280×720；
  //   小程序是竖屏（实测容器 440×803），宽高比差近 3 倍。
  //   三条路都试过：
  //     - FIT：完整可见，但只占中间一条 440×247，字小到看不清；
  //     - ENVELOP：铺满，但左右裁掉大半，菜单按钮点不到；
  //     - 旋转 90°（采用这个）：把整个画布转过来，让 1280 的宽度
  //       对应手机的 803 高度、720 的高度对应 440 宽度，可用面积
  //       从 440×247 提升到 803×440，接近翻倍，且不裁任何内容。
  //   代价是玩家要横着拿手机——但这本来就是一款横屏游戏，
  //   和原版 APK 的体验一致。
  /**
   * 【缩放模式：FIT，但把「量父容器」这一步掐掉】
   *
   *   FIT 本身是对的：它同时负责三件事——算 canvas 的显示尺寸、
   *   建立「屏幕坐标 → 游戏坐标」的换算、在窗口变化时重算。
   *   其中输入换算是关键：Phaser 用 canvasBounds 和 displayScale
   *   把点击位置映射回 1280×720。这一层如果没建立，点哪都错位。
   *
   *   问题出在 FIT 测量父容器的那一步：它走 getParentBounds()，
   *   里面直接读 parent.getBoundingClientRect()。这个 API 会把祖先的
   *   transform 算进去，而我们的容器在 rotate(90deg) 的层里，
   *   量到的「包围盒」根本不是布局尺寸——实测该给 956×390，
   *   它量成 219×390，画面就缩到左上角一小块。
   *
   *   试过 setParentSize() 直接改，没用：refresh() 里 getParentBounds()
   *   又把 parentSize 覆写回 DOM 测量值。
   *
   *   【解决办法】保留 FIT，只把 getParentBounds 换成一个不测量的空实现，
   *   尺寸改由外部通过 setParentSize(宽, 高) 显式告知（见
   *   shishan-screen.js 的 layout()）。这样显示尺寸和输入换算
   *   都由 Phaser 自己按我们给的正确尺寸算，点哪就是哪。
   */
  config.scale = {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.NO_CENTER,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  };

  // 【必须在 new Phaser.Game 之前把字体拉进内存】
  //   Phaser 的文字是画进 canvas 的，canvas 一旦画完就固化了：
  //   字体晚到不会触发重绘，玩家会整局都看着 fallback 字体。
  //   document.fonts.load() 是唯一能在画之前等到的办法。
  //
  //   为什么给 3 秒上限：字体 494KB，正常情况下几百毫秒就到位；
  //   但如果网络或解码出问题，不能把整个诗山卡死在启动页——
  //   超时就先用 fallback 字体画，至少能玩。
  try {
    if (document.fonts && typeof document.fonts.load === 'function') {
      // 两套字体都要等：正文用 TWKai，标题用 WXSJT（瘦金体）。
      // 少等一个，那个字号的文字就会永久停在 fallback 上。
      const loadFont = Promise.all([
        document.fonts.load('24px "TWKai"'),
        document.fonts.load('58px "WXSJT"'),
      ]);
      const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
      await Promise.race([loadFont, timeout]);
    }
  } catch {
    // 字体加载失败不阻断启动，主题里还有系统楷体兜底
  }

  const game = new Phaser.Game(config);

  // 掐掉自动测量（原因见上面 config.scale 的注释）。
  // 【为什么在这里打补丁而不是改配置】Phaser 没有提供「不要量父容器」的开关，
  //   但 getParentBounds 是实例方法，覆盖它是最小侵入的做法；
  //   而且返回 false 表示「尺寸没变」，不会触发多余的 resize 事件。
  if (game.scale) {
    game.scale.getParentBounds = () => false;

    // 【updateBounds 也必须改】
    //   refresh() 里有这么一行：
    //       displayScale.set(baseSize.width / canvasBounds.width,
    //                        baseSize.height / canvasBounds.height)
    //   而 canvasBounds 由 updateBounds() 用 canvas.getBoundingClientRect() 填。
    //   画布转了 90°，包围盒是 390×693（宽高互换），可 baseSize 是 1280×720，
    //   于是 displayScale 被算成 (3.28, 1.04)——横竖两个缩放差了 3 倍多。
    //   输入换算用的就是这个 displayScale，所以点哪儿都偏，
    //   表现就是「点开始游戏，结果点到设置」。
    //
    //   改成用 offsetWidth/offsetHeight：这两个是布局尺寸，
    //   不受 transform 影响，拿到的就是画布本地的 693×390。
    //   这样 displayScale 变成 (1.847, 1.846)，两轴一致且正确。
    game.scale.updateBounds = function updateBounds() {
      const canvas = this.canvas;
      const bounds = this.canvasBounds;
      const rect = canvas.getBoundingClientRect();
      bounds.x = rect.left + (window.pageXOffset || 0);
      bounds.y = rect.top + (window.pageYOffset || 0);
      bounds.width = canvas.offsetWidth || rect.height;
      bounds.height = canvas.offsetHeight || rect.width;
    };
  }

  // 【调试钩子】把实例挂到 window 上，方便在预览里直接读
  //   scale / 指针坐标 / 场景状态。WebGL 画布截图经常是空的
  //   （合成时序问题），靠读内部状态判断比看像素可靠得多。
  //   体积和性能开销可忽略，线上留着也不影响玩家。
  window.__shishanGame = game;

  // AudioManager 需要游戏实例才能从缓存取音频；没有它 BGM 不会响。
  audio.setGame(game);

  // 【为什么要挂这个钩子】AudioManager 是模块级单例，但主包（shishan-screen.js）
  //   和诗山包是两个独立的 bundle，各有一份 AudioManager，也就各有一个 audio 实例。
  //   主包调自己的 audio.stopBgm() 停的是自己那份，而真正在响的是诗山这份——
  //   实测退出后 isBgmPlaying() 仍是 true，音乐继续放。
  //   所以把「停音乐」这件事挂到 game 实例上，由真正持有该单例的这边来执行。
  game.stopAllAudio = () => {
    try { audio.stopBgm(); } catch (error) { console.warn('[诗山] 停止音乐失败：', error); }
    try { audio.unlock && audio.ctx && audio.ctx.suspend && audio.ctx.suspend(); } catch { /* 忽略 */ }
  };

  // 首次触摸唤醒 WebAudio。小程序 WebView 同样有自动播放限制，
  // 不唤醒的话第一段 BGM 会被静默丢弃。
  const unlock = () => audio.unlock();
  parent.addEventListener('pointerdown', unlock, { once: true });

  // 【输入坐标换算：必须自己做，因为画布整体转了 90°】
  //   Phaser 的 transformX/transformY 只做两件事：
  //       (pageX - canvasBounds.left) * displayScale.x
  //   它默认画布是正着摆的。而我们的画布在 rotate(90deg) 的层里，
  //   getBoundingClientRect() 返回的是「旋转后的包围盒」——宽高互换，
  //   左上角也不再是画布真正的左上角。照这个算出来的坐标和画面对不上，
  //   表现就是「点这里、反应在那里」。
  //
  //   修在 transformPointer 这一层：它是鼠标、触摸、指针事件共同的入口
  //   （Pointer.js 里所有 onDown/onUp/onMove 都调它），
  //   在这里先把屏幕坐标逆旋转回画布本地坐标，再交给 Phaser 的平滑逻辑。
  //   改一处，三种输入一起修好。
  installRotatedPointer(game);

  // 等 Phaser 真正 READY 再返回，外部才好显示/隐藏 loading。
  await new Promise((resolve) => {
    if (game.isBooted) { resolve(); return; }
    game.events.once(Phaser.Core.Events.READY, resolve);
    // 兜底：万一 READY 没触发（资源加载失败），5 秒后也放行，
    // 让玩家看到场景自己的错误提示，而不是永远转圈。
    setTimeout(resolve, 5000);
  });

  return game;
}
