// 模组的启用/禁用行为测试。
//
// 【为什么单独测】禁用看起来简单但很容易漏：如果只在 UI 上改状态、
//   没让 getModSource 也遵守，玩家会看到已禁用但脚本照跑。
//   这里直接测存储层的契约。
import {
  loadMods, saveMod, setModEnabled, isModDisabled, getModSource,
  hasMod, hasModDisabled, modGameIds,
} from '../src/mod/store.js';

let pass = 0;
let fail = 0;
/**
 * 断言：ok(说明, 条件)。
 *
 * 【为什么参数顺序必须是"说明在前"】2026-11-18 发现这四个测试文件的
 *   签名是 ok(cond, msg)，但所有调用都按 ok('说明', 条件) 写。
 *   字符串永远是真值，于是断言全部静默通过——等于没有测试。
 *   四个游戏漏 import canvasFont 就是这么漏到线上的。
 *   改成"说明在前"，是因为绝大多数调用本来就那么写，改签名比改 50 处调用安全。
 */
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

section('默认启用');
await saveMod('snake', 'snake.score = 1');
await loadMods();
ok('新保存的脚本默认启用', isModDisabled('snake') === false);
ok('getModSource 能拿到源码', getModSource('snake') === 'snake.score = 1');
ok('hasMod 为真', hasMod('snake') === true);
ok('hasModDisabled 为假', hasModDisabled('snake') === false);

section('禁用后不生效，但源码保留');
const r1 = await setModEnabled('snake', false);
ok('禁用成功', r1.ok === true && r1.enabled === false);
ok('isModDisabled 为真', isModDisabled('snake') === true);
ok('getModSource 返回 null，脚本不再执行', getModSource('snake') === null);
ok('hasMod 为假', hasMod('snake') === false);
ok('hasModDisabled 为真，UI 能显示已禁用', hasModDisabled('snake') === true);
ok('源码没有被删掉', (await loadMods())['snake'] === 'snake.score = 1');
ok('仍然出现在有脚本的游戏列表里', modGameIds().includes('snake'));

section('重新启用');
const r2 = await setModEnabled('snake', true);
ok('启用成功', r2.ok === true && r2.enabled === true);
ok('isModDisabled 为假', isModDisabled('snake') === false);
ok('getModSource 又能拿到源码', getModSource('snake') === 'snake.score = 1');
ok('hasMod 为真', hasMod('snake') === true);

section('没有脚本时不能切换');
const r3 = await setModEnabled('g2048', false);
ok('无脚本时返回 NO_SCRIPT', r3.ok === false && r3.error === 'NO_SCRIPT');

section('多份脚本互不影响');
await saveMod('g2048', 'g2048.score = 0');
await setModEnabled('snake', false);
ok('禁用 snake 不影响 g2048', getModSource('g2048') === 'g2048.score = 0');
ok('snake 仍是禁用', isModDisabled('snake') === true);
ok('g2048 仍启用', isModDisabled('g2048') === false);

console.log('\n' + (fail === 0 ? '全部通过：' : '存在失败：') + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
