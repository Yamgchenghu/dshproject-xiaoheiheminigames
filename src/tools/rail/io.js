/**
 * 画布导出为 PNG 文件。
 *
 * 【为什么不能直接 canvas.toBlob 就算完】小程序的 Host 环境没有
 *   浏览器那套下载机制，必须走 files.saveFile 拿到可写句柄再写字节。
 *   而 saveFile 又要求可信用户手势 —— 所以这里必须在点击回调里
 *   第一个 await 就是它，前面不能先 await 别的东西。
 */
import hbSDK, { HbMiniProgramSDKError } from '@heybox/hb-sdk';
import { getMode } from '../../sdk/hb.js';

const isCancel = (e) =>
  (e instanceof HbMiniProgramSDKError && e.code === 'FILE_PICKER_CANCELLED') ||
  (e && (e.code === 'FILE_PICKER_CANCELLED' || e.name === 'AbortError'));

/** canvas -> Blob，兼容没有 toBlob 的环境（退化成 toDataURL 再解码）。 */
async function canvasToBlob(canvas) {
  if (typeof canvas.toBlob === 'function') {
    const b = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (b) return b;
  }
  const url = canvas.toDataURL('image/png');
  const bin = atob(url.split(',')[1]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: 'image/png' });
}

/**
 * 把画布存成 PNG。返回 {ok, cancelled, error, name}。
 * 【注意】host 模式下必须在点击回调里直接调用，不要先 await 别的东西。
 */
export async function saveCanvasPng(canvas, filename = 'ticket.png') {
  if (getMode() === 'host') {
    try {
      // 先拿句柄（这一步吃用户手势），再慢慢编码
      const file = await hbSDK.files.saveFile({ suggestedName: filename });
      const blob = await canvasToBlob(canvas);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await file.writeBytes(bytes);
      return { ok: true, name: file.name || filename };
    } catch (e) {
      if (isCancel(e)) return { ok: false, cancelled: true };
      return { ok: false, error: (e && e.code) || String(e) };
    }
  }
  // 浏览器降级：直接下载
  try {
    const blob = await canvasToBlob(canvas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { ok: true, name: filename };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}