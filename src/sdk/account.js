/**
 * 账号登录与身份展示。
 *
 * 【为什么需要这一层】小黑盒小程序里没有"账号密码登录"这回事：用户已经在小黑盒
 *   客户端里登录过了，宿主会把当前账号静默注入进来。所以"登录"在这里只有两种含义：
 *     1. 读当前登录态（user.getInfo）—— 绝大多数情况，静默、无弹窗；
 *     2. 主动申请资料授权（auth.login）—— 只在需要昵称头像展示、且用户明确点了按钮时。
 *
 * 【为什么不在启动时自动 auth.login】它会弹授权框。用户只是打开小程序看看，
 *   上来就弹框是最劝退的体验。启动只做静默读取，弹框必须由用户点击触发。
 *
 * 【为什么登录态要缓存到本地】排行榜的昵称头像靠 extra 里带上去。如果每次提交都
 *   现读一次 user.getInfo，网络抖动时昵称会退化成"玩家"，榜单里就会出现一堆"玩家"。
 *   缓存一份，读失败时用上次的。
 */
import hbSDK from '@heybox/hb-sdk';
import { getMode, getUser, storageGet, storageSet } from './hb.js';

const CACHE_KEY = 'account:profile:v1';

/** 登录态快照，界面直接读这里 */
let snapshot = {
  // 'hostless' 浏览器预览 / 'guest' 未登录 / 'ok' 已登录 / 'error' 读取失败
  state: 'hostless',
  user: null,
  nickname: '',
  avatar: '',
  appUserId: '',
  /** 资料授权状态：granted / denied / not_requested / not_required */
  profileAuth: '',
  identityAuth: '',
};

export function getAccount() {
  return snapshot;
}

export function isLoggedIn() {
  return snapshot.state === 'ok';
}

/**
 * 刷新登录态。
 * 【为什么先读缓存】冷启动时 user.getInfo 可能慢几百毫秒，先用上次的昵称
 *   把界面填上，避免"本机玩家"闪一下再变成真名。读完再覆盖。
 */
export async function refreshAccount({ useCache = true } = {}) {
  if (useCache) {
    const cached = await storageGet(CACHE_KEY, null);
    if (cached && cached.nickname) {
      snapshot = { ...snapshot, nickname: cached.nickname, avatar: cached.avatar || '' };
    }
  }

  const res = await getUser(true);
  if (res.state === 'ok' && res.user) {
    snapshot = {
      state: 'ok',
      user: res.user,
      nickname: res.user.nick || '小黑盒玩家',
      avatar: res.user.avatar || '',
      appUserId: res.user.appUserId || '',
      profileAuth: res.profileHidden ? 'not_requested' : 'granted',
      identityAuth: res.profileHidden ? 'not_requested' : 'granted',
    };
    // 只缓存展示用的昵称头像，不缓存 appUserId——它不是凭据，但也没必要落盘
    await storageSet(CACHE_KEY, {
      nickname: snapshot.nickname,
      avatar: snapshot.avatar,
      at: Date.now(),
    });
  } else if (res.state === 'guest') {
    snapshot = {
      state: 'guest', user: null, nickname: '', avatar: '', appUserId: '',
      profileAuth: '', identityAuth: '',
    };
  } else if (res.state === 'hostless') {
    snapshot = {
      state: 'hostless', user: null, nickname: '', avatar: '', appUserId: '',
      profileAuth: '', identityAuth: '',
    };
  } else if (res.reason === 'AUTHORIZATION_CONTEXT_CHANGED') {
    // 【重试后仍然上下文变化】只有调试台/预览会稳定出现（没有真实账号上下文）。
    //   真机上 getInfo 内部已经退避重试过 3 次，还失败说明宿主账号上下文真的在剧烈变化，
    //   这时报"读取失败"比谎报"未登录"更诚实——用户会知道该重开小程序，而不是去点登录。
    snapshot = { ...snapshot, state: 'error', reason: res.reason };
  } else if (res.reason === 'UNAUTHORIZED') {
    // UNAUTHORIZED 是明确的"没有登录凭据"，等价于未登录
    snapshot = {
      state: 'guest', user: null, nickname: '', avatar: '', appUserId: '',
      profileAuth: '', identityAuth: '',
    };
  } else {
    // 真的读失败：保留缓存里的昵称，标记为 error，让界面能提示"读取失败"而不是谎报未登录
    snapshot = { ...snapshot, state: 'error', reason: res.reason || '' };
  }
  return snapshot;
}

/**
 * 主动申请资料授权（会弹授权框，必须由用户点击触发）。
 *
 * 【为什么单独提供】用户可能在小黑盒里关掉了本小程序的资料授权，
 *   这时 getInfo 拿不到昵称头像。让他能主动重新授权，比只能去设置里翻要友好。
 *
 * 【为什么成功后要 refreshAccount】auth.login 只返回 code 和 scopes，
 *   真正的昵称头像还是要再读一次 getInfo。少了这一步，界面不会有变化。
 */
export async function requestProfileAuth() {
  if (getMode() !== 'host') {
    return { ok: false, reason: 'hostless' };
  }
  try {
    const result = await hbSDK.auth.login({ scopes: ['profile'] });
    // 【为什么登录成功后要再读一次】auth.login 只返回 code 和 scopes，
    //   昵称头像要重新走 getInfo 才拿得到。少了这一步，用户点了登录却看不到变化。
    //   这里最多再试 2 次：登录刚完成时宿主上下文可能还在落定。
    for (let i = 0; i < 3; i += 1) {
      const acc = await refreshAccount({ useCache: false });
      if (acc.state === 'ok') {
        return { ok: true, scopes: (result && result.scopes) || [] };
      }
      if (i < 2) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    // 授权成功但资料仍读不到：不算失败，至少身份已建立
    return { ok: true, scopes: (result && result.scopes) || [], profilePending: true };
  } catch (e) {
    const code = String((e && e.code) || e);
    // 用户主动取消不是错误，静默处理
    if (code === 'AUTHORIZATION_CANCELLED') return { ok: false, reason: 'cancelled' };
    return { ok: false, reason: code };
  }
}

/**
 * 撤销本小程序的资料授权。
 * 【为什么要提供】授权给了昵称头像，用户应该能收回去。撤销后 app_user_id 会失效，
 *   排行榜里已有的历史记录不会消失（那是平台侧数据），但之后的提交会用新身份。
 */
export async function revokeProfileAuth() {
  if (getMode() !== 'host') return { ok: false, reason: 'hostless' };
  try {
    await hbSDK.user.revokeAuthorization();
    await refreshAccount({ useCache: false });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String((e && e.code) || e) };
  }
}

/** 界面展示用：把状态翻译成人话 */
export function accountLabel() {
  switch (snapshot.state) {
    case 'ok': return snapshot.nickname || '小黑盒玩家';
    case 'guest': return '未登录';
    case 'hostless': return '浏览器预览';
    case 'error': return snapshot.nickname || '读取失败';
    default: return '未知';
  }
}

/** 给排行榜 extra 用的昵称头像；没登录时给空，让榜单显示"玩家"而不是假昵称 */
export function accountForBoard() {
  if (snapshot.state === 'ok') {
    return { nick: snapshot.nickname, avatar: snapshot.avatar };
  }
  return { nick: '', avatar: '' };
}
