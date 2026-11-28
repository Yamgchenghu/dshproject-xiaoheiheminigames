/**
 * 「一杆清台」完整版的启动器。
 *
 * 【这个文件解决什么】第三个小程序只做桌球，用户要求「一上来就横屏绘制」、
 *   「不需要小游戏界面 UI」、「基本从 APK 版本构建」。
 *   所以这里不建任何外壳（没有 topbar / tabbar / 列表页 / 退出按钮），
 *   直接把 APK 里那份 DOM 挂上去，一帧之内就是球桌。
 *
 * 【为什么不复用 openPoolScreen】那个函数是给「复古游戏」用的：
 *   它挂在已存在的壳上、带 is-immersive 切换、退出时要回调重画列表。
 *   这里没有壳可回，退出按钮也不该存在——小程序里关不掉宿主，
 *   留个按钮只会让人以为点了能出去。
 *
 * 【为什么不开源】第三个小程序不开源，本文件与 src/tools/pool/ 一起
 *   在 .gitignore 里。main.js 用动态 import 引用它，公开仓库不会因此缺文件。
 */
import { whenReady } from './sdk/hb.js';
import { refreshAccount } from './sdk/account.js';
import { loadScores } from './core/scores.js';
import { applySafeArea } from './ui/safe-area.js';
import { onAppHide, onAppShow } from './sdk/hb.js';
import { onAppHideAudio, onAppShowAudio } from './core/audio.js';

export async function bootPool(root) {
  root.innerHTML = '';
  document.body.classList.add('is-immersive');

  // 【为什么先握手再挂 DOM】pool 变体的 game.js 会读账号昵称填座位名，
  //   也会在结算时提交排行榜。握手没完成就开局，昵称会停在「本机玩家」，
  //   榜单提交会静默失败。等握手只多几十毫秒，换的是正确的首帧。
  try { await whenReady(); } catch (e) { console.warn('[pool] 握手失败，按预览模式继续', e); }

  // 安全区：横屏旋转后状态栏在左侧，不处理会让球桌左侧被盖住一条
  try { await applySafeArea(); } catch (e) { /* 拿不到就用 0 */ }

  // 账号：静默读登录态，不弹授权框
  try { await refreshAccount(); } catch (e) { /* 未登录也能玩 */ }

  // 最高分缓存：结算时 computeRunScore 之后要读本机最佳成绩做对比
  try { await loadScores(); } catch (e) { /* 读不到就当没有 */ }

  // 【为什么这两行不能省】切后台要停 BGM 和 AI 定时器，
  //   回前台要重新量画布（横屏下旋转尺寸可能变）。
  onAppHide(onAppHideAudio);
  onAppShow(onAppShowAudio);

  // 【为什么不能加 @vite-ignore】加了之后 Vite 会把这条 import 原样留在产物里，
  //   而 dist/assets/ 下并没有 tools/pool/mount.js，运行时按相对路径解析必然 404，
  //   用户看到的就是「启动失败 failed to fetch dynamically imported module」。
  //   mount.js 是标准 ES 模块，交给 Vite 打包即可，不需要绕过。
  const { mountPool } = await import('./tools/pool/mount.js');
  // 【为什么必须先挂载再设钩子】mountPool 里会启动 raf 与 AI 定时器，
  //   钩子要在挂载之后才有 handle 可操作。
  const handle = mountPool(root);
  // 【为什么把 appPause 接到 window 上】game.js 是 IIFE，内部调
  //   window.appPause 来暂停自己的 raf 和 AI 定时器。这里没有外壳，
  //   要由启动器提供这两个钩子，否则切后台后 AI 还在算。
  window.appPause = () => { try { handle && handle.pause && handle.pause(); } catch (e) { /* ignore */ } };
  window.appResume = () => { try { handle && handle.resume && handle.resume(); } catch (e) { /* ignore */ } };

  return handle;
}