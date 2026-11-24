/**
 * 轻量吐司提示。
 * 【为什么不用 hbSDK.ui.showToast】原生 toast 在游戏画布上会被盖住，
 *   而且浏览器预览里根本不存在。自绘一层最稳。
 */
import { h } from '../core/util.js';

let stack = null;

function ensure() {
  if (stack && document.body.contains(stack)) return stack;
  stack = h('div', { class: 'toast-stack' });
  document.body.appendChild(stack);
  return stack;
}

export function toast(message, ms = 1800) {
  const box = ensure();
  const item = h('div', { class: 'toast-item' }, message);
  box.appendChild(item);
  setTimeout(() => {
    item.style.transition = 'opacity .2s, transform .2s';
    item.style.opacity = '0';
    item.style.transform = 'translateY(-6px)';
    setTimeout(() => item.remove(), 220);
  }, ms);
}
