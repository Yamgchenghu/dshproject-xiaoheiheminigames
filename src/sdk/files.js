/**
 * 存档导入 / 导出。
 *
 * 【平台约束】hb-sdk 的文件能力必须由**可信用户手势**直接触发：
 *   点击回调里不能先 await 别的东西，否则会返回 USER_GESTURE_REQUIRED。
 * 所以这里的函数都设计成"点击回调里第一个 await 的就是它"。
 * 浏览器降级用 <a download> 与 <input type=file>，行为等价、不需要权限。
 */
import hbSDK, { HbMiniProgramSDKError } from '@heybox/hb-sdk';
import { getMode } from './hb.js';

const isCancel = (e) =>
  (e instanceof HbMiniProgramSDKError && e.code === 'FILE_PICKER_CANCELLED') ||
  (e && (e.code === 'FILE_PICKER_CANCELLED' || e.name === 'AbortError'));

/**
 * 导出 JSON 到用户选择的位置。
 * 返回 {ok, cancelled, error, name}
 */
export async function exportJson(filename, data) {
  const text = JSON.stringify(data, null, 2);
  if (getMode() === 'host') {
    try {
      const file = await hbSDK.files.saveFile({ suggestedName: filename });
      await file.writeText(text);
      return { ok: true, name: file.name || filename };
    } catch (e) {
      if (isCancel(e)) return { ok: false, cancelled: true };
      return { ok: false, error: (e && e.code) || String(e) };
    }
  }
  // 浏览器降级
  try {
    const blob = new Blob([text], { type: 'application/json' });
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

/**
 * 导出任意文本（不限于 JSON）。
 * 【为什么单独开一个】转盘的 PWH / ZIP2.0 导出可能不是 JSON，
 *   而且 JSON.parse 再 stringify 会改变缩进和键顺序——原 APK 的
 *   备份文件里字段顺序是有意义的（人眼可读），不该被我们打乱。
 */
export async function exportText(filename, text, mime = 'text/plain') {
  if (getMode() === 'host') {
    try {
      const file = await hbSDK.files.saveFile({ suggestedName: filename });
      await file.writeText(text);
      return { ok: true, name: file.name || filename };
    } catch (e) {
      if (isCancel(e)) return { ok: false, cancelled: true };
      return { ok: false, error: (e && e.code) || String(e) };
    }
  }
  try {
    const blob = new Blob([text], { type: mime });
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

/** 读用户选择的文件，返回原始文本（不解析） */
export async function importText(accept = ['.json']) {
  if (getMode() === 'host') {
    try {
      const files = await hbSDK.files.pickFiles({ mode: 'read', accept, multiple: false });
      if (!files || !files.length) return { ok: false, cancelled: true };
      const text = await files[0].readText();
      return { ok: true, data: text, name: files[0].name };
    } catch (e) {
      if (isCancel(e)) return { ok: false, cancelled: true };
      return { ok: false, error: (e && e.code) || String(e) };
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept.join(',');
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return resolve({ ok: false, cancelled: true });
      const reader = new FileReader();
      reader.onload = () => resolve({ ok: true, data: String(reader.result), name: f.name });
      reader.onerror = () => resolve({ ok: false, error: '读取失败' });
      reader.readAsText(f);
    });
    input.click();
  });
}

/** 读一个用户选择的 JSON 文件，返回解析后的对象 */
export async function importJson(accept = ['.json']) {
  if (getMode() === 'host') {
    try {
      const files = await hbSDK.files.pickFiles({ mode: 'read', accept, multiple: false });
      if (!files || !files.length) return { ok: false, cancelled: true };
      const text = await files[0].readText();
      return { ok: true, data: JSON.parse(text), name: files[0].name };
    } catch (e) {
      if (isCancel(e)) return { ok: false, cancelled: true };
      return { ok: false, error: (e && e.code) || String(e) };
    }
  }
  // 浏览器降级：动态创建 input，等用户选完
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept.join(',');
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return resolve({ ok: false, cancelled: true });
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve({ ok: true, data: JSON.parse(String(reader.result)), name: f.name });
        } catch (e) {
          resolve({ ok: false, error: 'JSON 解析失败：' + String(e) });
        }
      };
      reader.onerror = () => resolve({ ok: false, error: '读取失败' });
      reader.readAsText(f);
    });
    input.click();
  });
}
