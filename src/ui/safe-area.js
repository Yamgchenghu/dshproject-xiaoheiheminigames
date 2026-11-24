/**
 * 安全区：把宿主告诉我们的状态栏 / 胶囊高度写进 CSS 变量。
 *
 * 【为什么不能只靠 env(safe-area-inset-*)】
 *   小程序跑在宿主的 iframe 里，这个 iframe 是整屏铺满的，
 *   env() 拿到的是 0——刘海、状态栏、右上角胶囊全都盖在我们的内容上。
 *   实测宿主 windowInfo 里 statusBarHeight = 84，而 env() 给的是 0，
 *   标题就正好被胶囊和左上角徽标压住了。
 *
 * 【为什么不写死 84】不同机型、横竖屏、桌面端都不一样。
 *   只能问宿主，拿不到就退回 env()，再拿不到就退回 0。
 */
import hbSDK from '@heybox/hb-sdk';

/** 兜底值：宿主没给的时候用 env()，再没有就是 0 */
function envPx(name) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function setVar(name, px) {
  document.documentElement.style.setProperty(name, `${Math.max(0, Math.round(px))}px`);
}

/**
 * 读取宿主窗口信息并写入 --safe-top / --safe-bottom。
 * 失败时静默保留 CSS 里的 env() 兜底——安全区拿不到不该让应用起不来。
 */
export async function applySafeArea() {
  try {
    const info = await hbSDK.viewport.getWindowInfo();
    if (!info) return null;
    const sa = info.safeArea || {};
    // 状态栏高度和 safeArea.top 取大的那个：有的宿主只填其中一个
    const top = Math.max(Number(info.statusBarHeight) || 0, Number(sa.top) || 0);
    const wh = Number(info.windowHeight) || 0;
    const bottom = wh > 0 && Number.isFinite(Number(sa.bottom)) ? wh - Number(sa.bottom) : 0;
    if (top > 0) setVar('--safe-top', top);
    if (bottom > 0) setVar('--safe-bottom', bottom);
    return { top, bottom, raw: info };
  } catch (e) {
    // 不在宿主里（浏览器预览、构建期 SSR）会抛 NOT_IN_IFRAME，属于正常情况
    return null;
  }
}

export default { applySafeArea };
