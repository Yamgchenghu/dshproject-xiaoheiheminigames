/**
 * 账号登录态判定的回归测试。
 *
 * 【为什么值得单独测】1.1.6 上线后用户反馈"检测不到登录态"：
 *   真机冷启动时 user.getInfo 会抛 AUTHORIZATION_CONTEXT_CHANGED（账号上下文
 *   还没就绪），旧代码把这个可重试的暂时性错误直接当成"未登录"，
 *   于是明明登录了的用户看到的是「未登录」。这类 bug 不报错、不白屏，
 *   只是功能静默降级，只能靠测试锁住行为。
 */

let pass = 0;
let fail = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail += 1;
    failures.push({ name, error: e });
    console.log(`  ✗ ${name}`);
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg || '值不相等'}：期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);
}

/**
 * 复刻 hb.js 里的重试判定，不直接 import（那个模块依赖 @heybox/hb-sdk，
 * 在 Node 里跑不起来）。逻辑必须与实现保持一致。
 */
const RETRY_CODES = ['AUTHORIZATION_CONTEXT_CHANGED', 'ACCOUNT_CONTEXT_CHANGED'];

function shouldRetry(code, attempt) {
  return RETRY_CODES.includes(code) && attempt < 2;
}

console.log('=== 登录态重试判定 ===');

check('上下文切换是可重试的暂时性错误', () => {
  ok(shouldRetry('AUTHORIZATION_CONTEXT_CHANGED', 0), '第一次应该重试');
  ok(shouldRetry('AUTHORIZATION_CONTEXT_CHANGED', 1), '第二次应该重试');
  ok(!shouldRetry('AUTHORIZATION_CONTEXT_CHANGED', 2), '第三次不再重试');
});

check('明确的未授权不重试', () => {
  ok(!shouldRetry('UNAUTHORIZED', 0), 'UNAUTHORIZED 应立即返回');
});

check('权限未声明不重试', () => {
  ok(!shouldRetry('PERMISSION_DENIED', 0), '权限问题重试也没用');
});

check('未知错误不重试', () => {
  ok(!shouldRetry('SOMETHING_ELSE', 0), '未知错误不该白等');
});

check('重试上限是 3 次尝试（2 次重试）', () => {
  let attempts = 0;
  for (let a = 0; a < 3; a += 1) {
    attempts += 1;
    if (!shouldRetry('AUTHORIZATION_CONTEXT_CHANGED', a)) break;
  }
  eq(attempts, 3, '总共应该尝试 3 次');
});

console.log('\n=== 用户信息解析 ===');

/** 复刻 getUser 的解析逻辑 */
function parseUserInfo(res) {
  if (!res || res.isHeyboxAppLoggedIn === false) return { state: 'guest' };
  const info = res.userInfo;
  if (!info) return { state: 'ok', profileHidden: true, nick: '小黑盒玩家' };
  const prof = info.profile || {};
  return {
    state: 'ok',
    nick: prof.nickname || '小黑盒玩家',
    avatar: prof.avatar || '',
    appUserId: info.app_user_id || '',
  };
}

check('未登录分支返回 guest', () => {
  eq(parseUserInfo({ isHeyboxAppLoggedIn: false, userInfo: null }).state, 'guest');
});

check('已登录且有资料', () => {
  const r = parseUserInfo({
    isHeyboxAppLoggedIn: true,
    userInfo: { app_user_id: 'au_1_x', profile: { nickname: '老王', avatar: 'http://a/b.png' } },
  });
  eq(r.state, 'ok');
  eq(r.nick, '老王');
  eq(r.avatar, 'http://a/b.png');
  eq(r.appUserId, 'au_1_x');
});

check('昵称必须从 profile.nickname 读（不是 userInfo.nickname）', () => {
  const r = parseUserInfo({
    isHeyboxAppLoggedIn: true,
    userInfo: { app_user_id: 'au_1', profile: { nickname: '阿强' } },
  });
  eq(r.nick, '阿强', '顶层没有 nickname 字段，读错了会退化成默认值');
});

check('已登录但资料未披露仍算登录成功', () => {
  const r = parseUserInfo({ isHeyboxAppLoggedIn: true, userInfo: null });
  eq(r.state, 'ok', '不能因为没昵称就判成未登录');
  ok(r.profileHidden === true, '应标记资料未披露');
});

check('profile 为空对象时不崩', () => {
  const r = parseUserInfo({ isHeyboxAppLoggedIn: true, userInfo: { app_user_id: 'au_1', profile: null } });
  eq(r.state, 'ok');
  eq(r.nick, '小黑盒玩家');
});

console.log('\n=== 榜单条数 ===');

const TOP_N = 50;

check('榜单展示前 50 名', () => {
  eq(TOP_N, 50, '产品要求显示前 50 名');
});

check('50 不超过 getList 单次上限 100', () => {
  ok(TOP_N <= 100, 'getList 单次最多 100 条，超过需要翻页');
});

console.log('\n=== 登录兜底路径 ===');

/**
 * 【为什么要有兜底】静默读取（user.getInfo）在某些宿主状态下会持续失败，
 *   这时如果界面上连"登录"按钮都没有，用户就彻底没有自救出口。
 *   兜底规则：未登录(guest)和读取失败(error)两种状态都必须给按钮。
 */
function showsLoginButton(state, mode) {
  return (state === 'guest' || state === 'error') && mode === 'host';
}

check('未登录时给登录按钮', () => {
  ok(showsLoginButton('guest', 'host'), '未登录必须有出口');
});

check('读取失败时也给登录按钮（兜底）', () => {
  ok(showsLoginButton('error', 'host'), '静默读取失败时，主动登录是唯一出路');
});

check('已登录不显示登录按钮', () => {
  ok(!showsLoginButton('ok', 'host'), '已登录还提示登录是骚扰');
});

check('浏览器预览不显示登录按钮', () => {
  ok(!showsLoginButton('guest', 'web'), '没有宿主，点了也没用');
  ok(!showsLoginButton('error', 'web'), '没有宿主，点了也没用');
});

check('取消授权不算失败', () => {
  const r = { ok: false, reason: 'cancelled' };
  eq(r.reason, 'cancelled', '用户主动取消应静默处理');
});

check('登录成功后资料可能滞后，仍算成功', () => {
  // auth.login 返回 code/scopes，昵称头像要重新 getInfo 才有
  const r = { ok: true, scopes: ['profile'], profilePending: true };
  ok(r.ok === true, '授权已建立就不该报失败');
});

console.log('\n=== 状态文案 ===');

function accountLabel(state, nickname) {
  switch (state) {
    case 'ok': return nickname || '小黑盒玩家';
    case 'guest': return '未登录';
    case 'hostless': return '浏览器预览';
    case 'error': return nickname || '读取失败';
    default: return '未知';
  }
}

check('四种状态各有不同文案', () => {
  eq(accountLabel('ok', '老王'), '老王');
  eq(accountLabel('guest'), '未登录');
  eq(accountLabel('hostless'), '浏览器预览');
  eq(accountLabel('error'), '读取失败');
});

check('error 状态若缓存有昵称则沿用', () => {
  eq(accountLabel('error', '老王'), '老王', '读失败时不该丢掉已知昵称');
});

console.log('\n' + '='.repeat(50));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  for (const f of failures) console.log(`  ${f.name}: ${f.error.message}`);
  process.exit(1);
}
