/**
 * 应用入口。
 *
 * 这里只做三件事：加载全局样式、等 SDK 握手完成、把应用挂到 #app 上。
 * 真正的初始化逻辑（读存档、拉用户信息、决定首屏）都在 createApp 里，
 * 因为那是"应用"的事，不是"启动"的事。
 */
import './styles.css';
import { createApp } from './ui/app.js';

const root = document.getElementById('app');
if (!root) {
  throw new Error('找不到 #app 挂载点，请检查 index.html');
}

createApp(root);
