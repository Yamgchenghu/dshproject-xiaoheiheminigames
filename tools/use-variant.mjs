#!/usr/bin/env node
/**
 * 按构建变体切换 package.json 里的小程序绑定。
 *
 * 【为什么需要这个脚本】两个小程序（复古游戏 / 学习与实用工具）共用同一份源码，
 *   区别只有三点：绑定的小程序 ID、名称描述、权限（游戏版不能有 network）。
 *   hb-sdk 只认 package.json，所以必须在构建前把对应配置换进去。
 *
 * 用法：
 *   node tools/use-variant.mjs games    切到复古游戏
 *   node tools/use-variant.mjs tools    切到学习与实用工具
 *   node tools/use-variant.mjs status   查看当前绑定
 *
 * 备份文件 package.tools.json / package.games.json 是"源"，package.json 是"当前生效"。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cur = join(root, 'package.json');
const V = {
  tools: join(root, 'package.tools.json'),
  games: join(root, 'package.games.json'),
};

const arg = (process.argv[2] || 'status').toLowerCase();

if (arg === 'status') {
  const p = JSON.parse(readFileSync(cur, 'utf8'));
  const isGames = !p.heybox.permissions.network;
  console.log('当前绑定：' + p.heybox.name);
  console.log('  小程序 ID：' + p.heybox.miniProgramId);
  console.log('  版本：' + p.version);
  console.log('  network 权限：' + (p.heybox.permissions.network ? '有（工具版）' : '无（游戏版，可用真实登录）'));
  console.log('  推断变体：' + (isGames ? 'games' : 'tools'));
  process.exit(0);
}

if (!V[arg]) {
  console.error('用法：node tools/use-variant.mjs <games|tools|status>');
  process.exit(1);
}

// 首次运行时把当前 package.json 存成 tools 版备份
if (!existsSync(V.tools)) {
  writeFileSync(V.tools, readFileSync(cur));
}

// 【为什么只换 heybox 字段，不整份覆盖】版本号、依赖、scripts 是共用的，
//   整份覆盖会让两边版本号不同步，发布时容易搞错。
const target = JSON.parse(readFileSync(V[arg], 'utf8'));
const now = JSON.parse(readFileSync(cur, 'utf8'));
now.heybox = target.heybox;
writeFileSync(cur, JSON.stringify(now, null, 2) + '\n');
console.log('已切换到：' + now.heybox.name + '（' + now.heybox.miniProgramId + '）');
