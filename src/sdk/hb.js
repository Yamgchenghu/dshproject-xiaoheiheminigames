/**
 * 小黑盒 SDK 封装层。
 *
 * 【为什么要有这一层】页面里到处直接写 hbSDK.storage.getStorage(...) 会带来三个问题：
 *   1. 每处都要 try/catch —— SDK 未就绪、权限未声明、Host 不支持都会 reject；
 *   2. 浏览器里用 vite 直接预览时没有 Host，任何调用都会失败，界面会全白；
 *   3. 业务代码要区分"真的失败"和"能力不存在"，散落各处必然写歪。
 * 所以这里统一收口：**能用就用平台能力，不能用就退到本地降级实现**，
 * 并把"当前是否真的在平台内"通过 mode 暴露给界面，让设置页能如实告诉用户。
 */
import hbSDK from '@heybox/hb-sdk';

const LS_PREFIX = 'hbmini:';

/** 当前运行模式：'host' = 小黑盒客户端内；'web' = 普通浏览器降级 */
let mode = 'web';
let readyPromise = null;
let userInfo = null;
/** getUser 的完整结果（含登录状态判别），供界面区分「未登录 / 已登录 / 读失败」 */
let userResult = null;
let lastError = '';

/**
 * 握手状态是否表示「已连上宿主」。
 *
 * 【这里曾经有个致命 bug】SDK 的 getHandshakeState() 返回的是对象
 *   { status: 'connecting' | 'ready' | 'failed', error? }，
 *   不是字符串。之前写成 state === 'ready' 和 state?.ready，
 *   两个判断永远为 false——对象不等于字符串，属性名也是 status 不是 ready。
 *   后果是：**即使在小黑盒客户端里，也一律被判成浏览器预览**，
 *   于是「我的」页面永远显示「本机玩家」，排行榜也不可用。
 *   这个 bug 不会报错、不会白屏，只是功能静默降级，所以一直没被发现。
 *
 * 【为什么兼容字符串】早期版本的 SDK 可能直接返回字符串，
 *   顺手兼容一下不花成本，避免换版本又静默坏掉。
 */
function stateIsReady(state) {
  if (!state) return false;
  if (typeof state === 'string') return state === 'ready' || state === 'connected';
  return state.status === 'ready' || state.ready === true;
}

function hasHost() {
  try {
    return stateIsReady(hbSDK.getHandshakeState?.());
  } catch {
    return false;
  }
}

/**
 * 等待握手完成。
 * 【为什么带超时】浏览器直接打开页面时握手永远不会完成，
 *   没有超时就会让首屏一直卡在 loading。
 */
export function whenReady(timeoutMs = 4000) {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      mode = ok ? 'host' : 'web';
      resolve(mode);
    };
    if (hasHost()) return finish(true);
    // 【超时只是「先当作浏览器」，不是「永远当浏览器」】
    //   手机上冷启动、网络抖动都可能让握手超过 4 秒。
    //   如果超时就彻底放弃，用户会一直卡在「本机玩家 + 排行榜不可用」，
    //   而他其实就在小黑盒里。所以超时后继续监听：
    //   真连上了就把 mode 改回 host，并通知界面重画。
    const timer = setTimeout(() => {
      finish(false);
      // 兜底：超时后再给 20 秒机会。连上了就纠正过来。
      const lateTimer = setTimeout(() => { clearTimeout(lateTimer); }, 20000);
      try {
        hbSDK.onHandshakeStateChange?.((st) => {
          if (stateIsReady(st)) {
            clearTimeout(lateTimer);
            mode = 'host';
            modeFixHandlers.forEach((fn) => { try { fn(); } catch { /* 忽略 */ } });
          }
        });
      } catch { /* 忽略 */ }
    }, timeoutMs);
    try {
      hbSDK.onHandshakeStateChange?.((state) => {
        if (stateIsReady(state)) {
          clearTimeout(timer);
          finish(true);
        }
      });
    } catch (e) {
      lastError = String(e && e.message ? e.message : e);
    }
  });
  return readyPromise;
}

export const getMode = () => mode;

/** 握手迟到时通知界面重画（浏览器预览 → 客户端） */
const modeFixHandlers = [];
export function onModeFix(fn) {
  if (typeof fn === 'function') modeFixHandlers.push(fn);
}
export const getLastError = () => lastError;

function localGet(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function localSet(key, value) {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch {
    /* 浏览器隐私模式会抛，忽略 */
  }
}

/**
 * 读键值。
 * 【降级语义】平台不可用时读 localStorage，保证同一台设备刷新页面进度不丢；
 *   但这只是浏览器里的开发便利，不是线上存档方案。
 */
export async function storageGet(key, fallback = undefined) {
  if (mode === 'host') {
    try {
      const res = await hbSDK.storage.getStorage({ key });
      if (res && res.data !== undefined && res.data !== null) return res.data;
      return fallback;
    } catch (e) {
      lastError = String(e && e.code ? e.code : e);
    }
  }
  const v = localGet(key);
  return v === undefined ? fallback : v;
}

export async function storageSet(key, data) {
  localSet(key, data); // 双写：即使平台失败，浏览器预览也不丢
  if (mode !== 'host') return false;
  try {
    await hbSDK.storage.setStorage({ key, data });
    return true;
  } catch (e) {
    lastError = String(e && e.code ? e.code : e);
    return false;
  }
}

/**
 * 读取当前用户资料（昵称/头像）。
 * 【为什么缓存】昵称只用于排行榜展示，每次进页面都请求既慢又浪费配额。
 */
/**
 * 读取当前用户资料。
 *
 * 【返回结构为什么是判别联合而不是 null】调用方需要区分三种完全不同的状态，
 *   一律返回 null 会让「没登录」和「读失败」混在一起，界面上就只能显示一个
 *   含糊的「本机玩家」，用户不知道自己到底有没有登录：
 *     - { state: 'hostless' } 不在小黑盒客户端里（浏览器预览）
 *     - { state: 'guest' }    在客户端里，但当前账号未登录
 *     - { state: 'ok' }       已登录，user 里有昵称头像
 *     - { state: 'error' }    调用失败，reason 里是错误码
 *
 * 【这里踩过两个坑】
 *   1. 昵称实际在 userInfo.profile.nickname，旧代码读的是 userInfo.nickname，
 *      永远取不到，于是所有人都显示「玩家」。这种不报错的字段名错位最难发现。
 *   2. userInfo 可能为 null（Host 已登录但资料未披露），必须先判空再取字段，
 *      否则直接 TypeError。
 */
export async function getUser(force = false) {
  if (userResult && !force) return userResult;
  if (mode !== 'host') {
    userInfo = null;
    userResult = { state: 'hostless', user: null };
    return userResult;
  }
  // 【为什么最多试 3 次】真机冷启动时 Host 的账号快照可能还没就绪，
  //   user.getInfo 会抛 AUTHORIZATION_CONTEXT_CHANGED（"查询期间账号上下文变了"）。
  //   1.1.6 把这个错误码直接当成"未登录"，于是用户明明登录了，
  //   界面上却显示「未登录」——这就是"检测不到登录态"的原因。
  //   它其实是可重试的暂时性错误，退避重试一次基本就好了。
  const RETRY_CODES = ['AUTHORIZATION_CONTEXT_CHANGED', 'ACCOUNT_CONTEXT_CHANGED'];
  let lastCode = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await hbSDK.user.getInfo();
      // 未登录是正常业务分支，不抛错
      if (!res || res.isHeyboxAppLoggedIn === false) {
        userInfo = null;
        userResult = { state: 'guest', user: null };
        return userResult;
      }
      const info = res.userInfo;
      const auth = res.authorization || {};
      if (!info) {
        // 已登录但资料未披露：仍然算登录成功，只是没有昵称头像
        userInfo = { nick: '小黑盒玩家', avatar: '', appUserId: '' };
        userResult = { state: 'ok', user: userInfo, profileHidden: true, auth };
        return userResult;
      }
      const prof = info.profile || {};
      userInfo = {
        nick: prof.nickname || '小黑盒玩家',
        avatar: prof.avatar || '',
        // app_user_id 是小程序内隔离标识，不是黑盒用户 ID，只用于本小程序内关联
        appUserId: info.app_user_id || '',
      };
      userResult = { state: 'ok', user: userInfo, auth };
      return userResult;
    } catch (e) {
      lastCode = String((e && e.code) || e);
      lastError = lastCode;
      // 只有暂时性错误才重试，其他（如权限未声明）立刻返回，避免白等
      if (!RETRY_CODES.includes(lastCode) || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  userInfo = null;
  userResult = { state: 'error', user: null, reason: lastCode };
  return userResult;
}

export async function toast(message, status = 'none') {
  try {
    await hbSDK.ui.showToast({ message, status });
  } catch {
    // 浏览器里没有 toast，退化成控制台，避免打断流程
    console.log('[toast]', message);
  }
}

export async function vibrate(type = 'short') {
  try {
    await hbSDK.device.vibrate({ type });
  } catch {
    /* 静默 */
  }
}

/* ---------------- 云存档（cloud.storage） ---------------- */

/**
 * 云端键值读写。
 *
 * 【为什么用云存储而不是本地存储】本地 storage 是"这台设备"的，
 *   换手机就没了。云存储跟着账号走，才算真正的存档。
 *   代价是每个 value 只有 16KB，所以上层必须自己切块（见 core/save.js）。
 *
 * 【为什么降级到 localStorage】浏览器预览时没有 Host，云存储必然失败。
 *   用同样的 key 写 localStorage，预览时也能看到自己的存档，
 *   而且键名一致，行为可预期。
 */
export async function cloudGet(key) {
  if (mode === 'host') {
    try {
      // 【签名是位置参数，不是对象】SDK 的 cloud.storage.getStorage 是
      //   getStorage(key)，内部才组装成 { key } 发给 Host。
      //   传 { key } 进去等于让 SDK 组装成 { key: { key } }，
      //   Host 收到非法参数直接回 invalid params。
      const res = await hbSDK.cloud.storage.getStorage(key);
      const v = res && res.data;
      if (typeof v === 'string') return v;
      if (v === undefined || v === null) return undefined;
      return String(v);
    } catch (e) {
      lastError = String((e && e.code) || e);
    }
  }
  const local = localGet('cloud:' + key);
  return typeof local === 'string' ? local : undefined;
}

export async function cloudSet(key, data) {
  localSet('cloud:' + key, data); // 双写，保证预览不丢
  if (mode !== 'host') return { ok: true, local: true };
  try {
    // 【同理：setStorage(key, value) 两个位置参数】平台收到的字段名是 value，
    //   传 { key, data } 会让 key 变成对象、value 变成 undefined，
    //   平台回 invalid params——模组保存失败就是这个原因。
    await hbSDK.cloud.storage.setStorage(key, data);
    return { ok: true };
  } catch (e) {
    const code = String((e && e.code) || e);
    lastError = code;
    return { ok: false, code };
  }
}

export async function cloudRemove(key) {
  try {
    localStorage.removeItem(LS_PREFIX + 'cloud:' + key);
  } catch {
    /* 忽略 */
  }
  if (mode !== 'host') return { ok: true, local: true };
  try {
    await hbSDK.cloud.storage.removeItem(key);
    return { ok: true };
  } catch (e) {
    const code = String((e && e.code) || e);
    // 不存在也视为成功：删除是幂等的
    return { ok: code === 'NOT_FOUND', code };
  }
}

/** 列出当前小程序下所有云端 key（用于诊断"我到底占了几个 value"） */
export async function cloudKeys() {
  if (mode !== 'host') {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX + 'cloud:')) out.push(k.slice((LS_PREFIX + 'cloud:').length));
      }
    } catch {
      /* 忽略 */
    }
    return out;
  }
  try {
    const res = await hbSDK.cloud.storage.getKeys();
    return (res && (res.keys || res.data)) || [];
  } catch {
    return [];
  }
}

export function onAppHide(fn) {
  try {
    hbSDK.on?.('appHide', fn);
  } catch {
    /* 忽略 */
  }
}

export function onAppShow(fn) {
  try {
    hbSDK.on?.('appShow', fn);
  } catch {
    /* 忽略 */
  }
}

export { hbSDK };
