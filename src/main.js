/**
 * 应用入口。
 *
 * 【为什么这里分叉】第三个小程序「一杆清台」只有一个游戏，
 *   没有列表页、没有标签栏、没有「我的」页——进去就该是球桌。
 *   所以它在 main.js 就分出去了，根本不建外壳，
 *   而不是建好外壳再藏起来（那样会闪一下标签栏，还白跑一遍存档迁移）。
 *
 * 【为什么不放 index.html 里按变体换入口】index.html 是打包器入口，
 *   不能有运行时逻辑；变体是构建期常量，用 import 分支最直接。
 */
import './styles.css';
import { IS_POOL } from './core/variant.js';

const root = document.getElementById('app');
if (!root) {
  throw new Error('找不到 #app 挂载点，请检查 index.html');
}

if (IS_POOL) {
  // 【为什么动态 import】第三个小程序不开源，源码目录在 .gitignore 里。
  //   静态 import 会让公开仓库少一个文件、构建直接失败。
  //   这里的 import 只在 pool 变体里执行，别的变体根本走不到。
  import('./boot-pool.js').then((m) => m.bootPool(root)).catch((e) => {
    console.error('[pool] 启动失败', e);
    root.textContent = '启动失败：' + (e && e.message ? e.message : e);
  });
} else {
  import('./ui/app.js').then((m) => m.createApp(root)).catch((e) => {
    console.error('[app] 启动失败', e);
    root.textContent = '启动失败：' + (e && e.message ? e.message : e);
  });
}