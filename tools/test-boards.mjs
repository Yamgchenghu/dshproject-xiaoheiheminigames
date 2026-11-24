/**
 * 排行榜 key 的回归测试。
 *
 * 【为什么这条必须锁死】用户明确要求「每个游戏 × 每种模式一个榜，不许混榜」。
 *   一旦有人图省事把 mode 从 key 里去掉，扫雷 9×9 的 120 秒就会和
 *   35×25 的 600 秒直接比大小——榜单立刻失去意义，而且这种退化是静默的，
 *   上线后很久才会被发现。所以这里把「12 个 key 互不相同」写成断言。
 */
import { GAMES } from '../src/games/index.js';
import { LEVELS } from '../src/tools/liushui/levels.js';
import { boardKey, cloudBoardKey, hasCloudBoard, CLOUD_BOARDS } from '../src/sdk/leaderboard.js';

/**
 * 全部参赛者 = 四款原生游戏 + 流水入杯（关卡制）。
 * 流水入杯不在 GAMES 里（它没有 tick/模组参数表），但它同样上榜，
 * 所以这里显式补上，否则它的 14 个榜单不会被任何测试覆盖。
 */
const LIUSHUI = {
  id: 'liushui',
  modes: LEVELS.map((_, i) => ({ value: 'lv' + (i + 1) })),
};
const ALL_GAMES = [...GAMES, LIUSHUI];

let pass = 0;
let fail = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    fail++;
    failures.push({ name, error: e });
    console.log('  ✗ ' + name + ' → ' + e.message);
  }
}

function ok(cond, label) {
  if (!cond) throw new Error(label || '断言失败');
}

console.log('\n=== 榜单 key ===');

check('每个游戏每种模式都有独立的 key', () => {
  const keys = [];
  for (const g of ALL_GAMES) {
    for (const m of g.modes) keys.push(boardKey(g.id, m.value));
  }
  const uniq = new Set(keys);
  ok(uniq.size === keys.length, `key 有重复：${keys.length} 个组合只有 ${uniq.size} 个不同的 key`);
  ok(keys.length >= 12, `组合数偏少：${keys.length}`);
});

check('流水入杯 14 个关卡各有一个榜', () => {
  const keys = LIUSHUI.modes.map((m) => boardKey('liushui', m.value));
  ok(keys.length === LEVELS.length, `关卡数不对：${keys.length} vs ${LEVELS.length}`);
  ok(new Set(keys).size === keys.length, '流水入杯的 key 有重复');
  ok(keys[0] === 'hb_liushui_lv1', '第一关的 key 应该是 hb_liushui_lv1，实际 ' + keys[0]);
});

check('key 只用合法字符', () => {
  for (const g of ALL_GAMES) {
    for (const m of g.modes) {
      const k = boardKey(g.id, m.value);
      ok(/^[A-Za-z0-9_-]+$/.test(k), `非法 key：${k}`);
      ok(k.length <= 64, `key 太长：${k}`);
    }
  }
});

check('key 里带上了模式名', () => {
  for (const g of ALL_GAMES) {
    for (const m of g.modes) {
      const k = boardKey(g.id, m.value);
      ok(k.includes(m.value), `${g.id}/${m.value} 的 key 里没有模式名：${k}`);
    }
  }
});

check('特殊字符被替换而不是被丢弃', () => {
  ok(boardKey('a', 'x y') === 'hb_a_x_y', '空格应变成下划线');
  ok(boardKey('a', 'x/y') === 'hb_a_x_y', '斜杠应变成下划线');
});

console.log('\n=== 云端榜名额 ===');

/**
 * 【为什么这条必须锁死】平台硬限制：每个小程序最多创建 3 个排行榜。
 *   第一版按「每个游戏每种模式一个榜」写了 33 个 key，批量创建时全部被拒，
 *   直到线上才发现所有成绩都只能存本机。这条断言防止有人再次扩表。
 */
check('云端榜不超过 3 个', () => {
  const n = Object.keys(CLOUD_BOARDS).length;
  ok(n <= 3, `云端榜有 ${n} 个，平台上限是 3 个`);
});

check('云端榜的 key 都合法', () => {
  for (const [combo, key] of Object.entries(CLOUD_BOARDS)) {
    ok(/^[A-Za-z0-9_-]{1,64}$/.test(key), `${combo} 的 key 非法：${key}`);
  }
});

check('云端榜的 key 两两不同', () => {
  const keys = Object.values(CLOUD_BOARDS);
  ok(new Set(keys).size === keys.length, '云端榜 key 有重复');
});

check('云端榜不超平台上限，且必含综合总榜', () => {
  // 【设计已变更两次，这里记下来免得以后再猜】
  //   第一版：按模式分榜，3 个名额给了扫雷初级/2048经典/流水第1关。
  //   第二版：改成「全部模式量化后累加成一个总分」，1 个榜就够。
  //   第三版（当前）：推币机的分数是"每币平均彩票"，和量化总分不是同一个
  //     量纲，混进同一个榜没法排，所以单独占第 2 个名额。
  //   【为什么断言是"不超上限"而不是"正好 1 个"】名额是稀缺资源，
  //     要守的是"别超 3 个"这条硬线；具体用几个该由玩法决定，
  //     写死成 1 会把合理的第二个榜判成错误（就是这次踩的坑）。
  const keys = Object.keys(CLOUD_BOARDS);
  ok(keys.length <= 3, `云端榜 ${keys.length} 个，超过平台上限 3 个：${keys.join(',')}`);
  ok(keys.includes('total:all'), `必须保留综合总榜 total:all，实际：${keys.join(',')}`);
});

check('综合总榜的 key 合法', () => {
  ok(/^[A-Za-z0-9_-]{1,64}$/.test(CLOUD_BOARDS['total:all']), '总榜 key 非法');
});

check('逐模式榜已全部取消（单模式成绩只记本机）', () => {
  // 3 个名额让给总榜后，单模式不再有云端榜。
  // 它们的成绩仍然写进 save_18，用于总榜累加和「我的」页展示。
  ok(hasCloudBoard('minesweeper', 'small') === false, '扫雷初级不该再有独立榜');
  ok(hasCloudBoard('g2048', 'classic') === false, '2048 经典不该再有独立榜');
  ok(hasCloudBoard('liushui', 'lv1') === false, '流水第 1 关不该再有独立榜');
  ok(cloudBoardKey('minesweeper', 'small') === null, '无云端榜时 cloudBoardKey 应返回 null');
});

check('总榜能被正确识别', () => {
  ok(hasCloudBoard('total', 'all') === true, 'total:all 应该被识别为有云端榜');
  ok(cloudBoardKey('total', 'all') === 'hb_total_quantized');
});

check('总榜 key 与模式榜 key 不冲突', () => {
  ok(boardKey('total', 'all') !== CLOUD_BOARDS['total:all'],
    '本机键与云端键应分属不同命名空间');
});

check('本机榜的 key 仍然覆盖全部模式', () => {
  // 云端只有 3 个，但本机记录必须每个模式都能存，否则成绩会丢
  for (const g of ALL_GAMES) {
    for (const m of g.modes) {
      const k = boardKey(g.id, m.value);
      ok(/^[A-Za-z0-9_-]+$/.test(k), `本机 key 非法：${k}`);
    }
  }
});

console.log('\n' + '='.repeat(50));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  for (const f of failures) console.log(`  ${f.name}: ${f.error.message}`);
  process.exit(1);
}
