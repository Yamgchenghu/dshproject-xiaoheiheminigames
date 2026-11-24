/**
 * 存档版本号与作废逻辑的测试。
 *
 * 【为什么这个必须测】这段代码只在「老玩家第一次进新版本」时跑一次，
 *   开发时几乎永远碰不到 —— 而它一旦写错，后果是两种极端：
 *   要么该清的分没清（刷分的人继续霸榜），
 *   要么清多了（把扫雷、2048 的成绩一起抹掉，玩家会炸）。
 *
 * 【为什么要伪造 localStorage】save.js 在非 host 模式下把数据双写进
 *   localStorage。Node 里没有这个对象，不补上的话每个用例都会因为
 *   「存储不可用」而失败 —— 那不是被测代码的问题，是环境没搭好。
 */
import assert from 'node:assert/strict';

// ---- 先补 localStorage，再 import 任何碰存储的模块 ----
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i) => Array.from(mem.keys())[i] ?? null,
  get length() { return mem.size; },
};

let pass = 0, fail = 0;
const cases = [];
function check(name, fn) { cases.push({ name, fn }); }

const SV = await import('../src/core/savever.js');
const SAVE = await import('../src/core/save.js');

check('老存档（没写过版本号）会被识别为 0', async () => {
  mem.clear();
  assert.equal(await SV.readSaveVersion(), 0);
});

check('写版本号后能原样读回来', async () => {
  mem.clear();
  await SV.writeSaveVersion();
  assert.equal(await SV.readSaveVersion(), SV.SAVE_VERSION);
});

check('老存档升级：调用作废钩子，并打上新版本号', async () => {
  mem.clear();
  let wiped = 0;
  const res = await SV.migrateSave({ wipeDonghai: async () => { wiped++; } });
  assert.equal(wiped, 1, '老存档必须作废一次');
  assert.equal(res.from, 0);
  assert.equal(res.to, SV.SAVE_VERSION);
  assert.equal(res.wiped, true);
  assert.equal(await SV.readSaveVersion(), SV.SAVE_VERSION, '升级后要写上版本号');
});

check('已升级的存档不再作废（关键：不能每次启动都清）', async () => {
  mem.clear();
  await SV.writeSaveVersion();
  let wiped = 0;
  const res = await SV.migrateSave({ wipeDonghai: async () => { wiped++; } });
  assert.equal(wiped, 0, '版本号已是当前版本时绝不能清');
  assert.equal(res.wiped, false);
});

check('作废钩子抛异常：不谎报已清，但仍写版本号（避免无限重试）', async () => {
  mem.clear();
  const res = await SV.migrateSave({ wipeDonghai: async () => { throw new Error('云端挂了'); } });
  assert.equal(res.wiped, false, '失败时不能谎报已清');
  assert.equal(await SV.readSaveVersion(), SV.SAVE_VERSION, '失败也要写版本号');
});

check('版本号真的落在 save_43', async () => {
  mem.clear();
  await SV.writeSaveVersion();
  const keys = SAVE.scopeKeys('savever');
  assert.deepEqual(keys, ['save_43']);
  // 直接查底层：确认写的是 save_43 而不是别处
  const raw = mem.get('hbmini:cloud:save_43');
  assert.ok(raw && raw.length > 0, 'save_43 应该有内容');
});

check('存档槽位不重叠（save_41/42/43 各归各的）', async () => {
  assert.equal(SAVE.SCOPES.donghai.start, 41);
  assert.equal(SAVE.SCOPES['donghai.run'].start, 42);
  assert.equal(SAVE.SCOPES.savever.start, 43);
  const used = new Set();
  for (const [name, def] of Object.entries(SAVE.SCOPES)) {
    const ids = [];
    for (let i = 0; i < def.count; i++) ids.push(def.start + i);
    for (const e of def.extra || []) ids.push(e);
    for (const k of ids) {
      assert.ok(!used.has(String(k)), '槽位冲突：' + name + ' 用了已占用的 ' + k);
      used.add(String(k));
    }
  }
});

check('作废后推币机战绩确实读不回来（真清，不是只清缓存）', async () => {
  mem.clear();
  const { writeScope } = SAVE;
  // 先写一份「被刷过的」战绩
  await writeScope('donghai', { daily: { date: '2026-11-23', used: 3, best: 4000 }, week: { week: '2026-11-23', days: {}, total: 4000 } });
  assert.ok(await SAVE.readScope('donghai'), '前置条件：应该写得进去');
  const { wipeDonghaiStats } = await import('../src/tools/donghai/stats.js');
  await wipeDonghaiStats();
  const after = await SAVE.readScope('donghai');
  assert.equal(after, null, '作废后应该读不到任何战绩');
});

for (const c of cases) {
  try { await c.fn(); console.log('  ✓ ' + c.name); pass++; }
  catch (e) { console.log('  ✗ ' + c.name + '\n    ' + e.message); fail++; }
}
console.log('\n' + (fail ? '失败' : '全部通过') + '：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
