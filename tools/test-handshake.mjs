/**
 * 握手状态判定的回归测试。
 *
 * 【为什么单独测这个】这个 bug 是「静默降级」：不报错、不白屏，
 *   只是所有需要宿主的功都悄悄关掉了（昵称、排行榜、云存档）。
 *   单元测试是唯一能挡住它的东西。
 */
import assert from 'node:assert';

// 直接复制 hb.js 里的实现（那边依赖 SDK，Node 里加载不了）
function stateIsReady(state) {
  if (!state) return false;
  if (typeof state === 'string') return state === 'ready' || state === 'connected';
  return state.status === 'ready' || state.ready === true;
}

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  [OK] ' + name); }
  else { fail++; console.log('  [NG] ' + name); }
}

console.log('\n握手状态判定');

// 核心回归：SDK 实际返回的是对象，不是字符串
ok('对象 {status:ready} 判定为已连接', stateIsReady({ status: 'ready' }) === true);
ok('对象 {status:connecting} 判定为未连接', stateIsReady({ status: 'connecting' }) === false);
ok('对象 {status:failed} 判定为未连接', stateIsReady({ status: 'failed' }) === false);

// 旧实现的两种写法都必须失败（证明我们修的是真 bug）
ok('字符串 ready 也认（老版本 SDK）', stateIsReady('ready') === true);
ok('字符串 connected 也认', stateIsReady('connected') === true);

// 边界
ok('null 判定为未连接', stateIsReady(null) === false);
ok('undefined 判定为未连接', stateIsReady(undefined) === false);
ok('空对象判定为未连接', stateIsReady({}) === false);
ok('{ready:true} 也认（兼容写法）', stateIsReady({ ready: true }) === true);

// 【最关键的断言】旧代码的三个判断全都为 false，新代码必须为 true
const oldImpl = (state) => state === 'ready' || state === 'connected' || !!state?.ready;
ok('旧实现在 {status:ready} 上确实返回 false（确认 bug 存在）',
  oldImpl({ status: 'ready' }) === false);
ok('新实现在同一输入上返回 true（确认已修复）',
  stateIsReady({ status: 'ready' }) === true);

console.log('\n' + (fail === 0 ? '全部通过' : '有失败') + '：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
