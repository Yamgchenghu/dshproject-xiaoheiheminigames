/**
 * 全局设置入口的注册表。
 *
 * 【为什么单独一个文件】游戏页和三个工具页是直接挂到 body 上的全屏层，
 *   它们盖住了外壳的顶栏，所以必须自带一个设置按钮——用户要求
 *   "设置按钮永远在右上角"，进到全屏页就消失是不能接受的。
 *
 *   如果让这些页面直接 import app.js，就形成了循环依赖：
 *   app.js → tab-tools.js → wheel/screen.js → app.js。
 *   循环 import 在 ESM 里能跑，但依赖求值顺序，改一个 import 就可能炸。
 *   这里用一个 7 行的注册表把环打断：谁都可以调用 openGlobalSettings()，
 *   但没人需要知道设置页长什么样。
 */

let opener = null;

/** 由外壳在启动时注册。重复注册会覆盖，方便热重载。 */
export function setSettingsOpener(fn) {
  opener = fn;
}

/** 打开设置页。外壳还没准备好时静默忽略（不该在启动瞬间被调用）。 */
export function openGlobalSettings() {
  if (opener) opener();
}
