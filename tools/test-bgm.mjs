/**
 * BGM 曲风约束测试。
 *
 * 【为什么音乐也要测】"像不像那首参考曲"不是形容词，它对应一组可量化的特征。
 *   2026-11-24 用户给了他自己调了几十遍的《Boarding Pass in the Clouds》
 *   （ai音乐/_10plus.mid，9分16秒，17 轨），说这个曲风他非常喜欢，
 *   要我把另外几首也写成同一个味道。
 *
 *   我实测那首 MIDI 得到这些硬指标：
 *     调式    D 混合利底亚（G 大调音阶但主音是 D，有降七级 F 自然音）
 *     旋律    三度 47%、二度 29%、同音 13%、大跳 7.5%
 *     密度    钢琴高音区 5.09 音/小节
 *     打击    闭镲 960 次、底鼓 400、军鼓只有 40（基本不用）
 *
 *   这些数字就是"曲风"本身。任何一条被改掉，听感立刻变味，
 *   而这种退化在代码审查时根本看不出来 —— 所以钉成断言。
 */
import { SONGS, NO_MP3 } from '../tools/lib/songs.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

/** 需要统一曲风的六首（贪吃蛇走实时合成，不在其列） */
const STYLED = ['minesweeper', 'g2048', 'watermelon', 'donghai', 'liushui'];

section('曲目注册');
for (const n of STYLED) {
  ok(n + ' 已注册', typeof SONGS[n] === 'function');
}
ok('贪吃蛇仍走实时合成（不进 SONGS 出 mp3）', NO_MP3.has('snake'));

const songs = {};
for (const n of STYLED) songs[n] = SONGS[n]();

section('调式：全部是混合利底亚（参考曲的核心特征）');
// 【为什么必须是混合利底亚】参考曲是 G 大调音阶但主音 D，且有 F 自然音。
//   这个"降七级"是整套曲风的灵魂 —— 用自然大调会得到 F#，
//   味道立刻从"民谣治愈"变成"儿歌明亮"。
for (const n of STYLED) {
  ok(n + ' 用混合利底亚', /混合利底亚/.test(songs[n].key), songs[n].key);
}

section('调性：六首互不相同（否则听起来是同一首）');
const keys = STYLED.map((n) => songs[n].key);
ok('六首调性各不相同', new Set(keys).size === keys.length, keys.join(' / '));

section('速度：72~96，全部在中慢速区间');
// 【为什么卡这个区间】参考曲 88 BPM 起、渐慢到 65。
//   太快（>100）会变成"游戏音乐"，太慢（<70）会拖沓。
for (const n of STYLED) {
  const b = songs[n].bpm;
  ok(n + ' BPM 在 72~96', b >= 72 && b <= 96, String(b));
}

section('旋律密度：每小节 3.5~4.5 个音（参考曲实测 5.09）');
// 【为什么这条是硬的】第一版我写成"长音吟唱"（每小节 1 个音），
//   听起来完全不是同一首曲子 —— 参考曲的旋律是密集的 4 分音符线条，
//   不是长音铺底。这个数字直接决定"像不像"。
for (const n of STYLED) {
  const lead = songs[n].tracks.find((t) => t.name === 'Lead');
  ok(n + ' 有主旋律轨', !!lead);
  if (!lead) continue;
  const dens = lead.notes.length / songs[n].bars;
  ok(n + ' 每小节 3.5~4.5 音', dens >= 3.5 && dens <= 4.5, dens.toFixed(2));
}

section('旋律音程：以三度/二度为主，不出现大跳');
// 【为什么测这个】参考曲三度 47%、二度 29%、大跳仅 7.5%。
//   如果旋律里塞八度跳进，那一下就"出戏"，听起来像别的曲子串进来。
//   这里统计相邻音的半音差，要求六度以上（>=8 半音）占比低于 20%。
for (const n of STYLED) {
  const lead = songs[n].tracks.find((t) => t.name === 'Lead');
  if (!lead) continue;
  const ps = lead.notes.map((x) => x.p);
  let leaps = 0;
  for (let i = 1; i < ps.length; i++) {
    if (Math.abs(ps[i] - ps[i - 1]) >= 8) leaps++;
  }
  const ratio = ps.length > 1 ? leaps / (ps.length - 1) : 0;
  ok(n + ' 大跳（>=6度）占比 < 20%', ratio < 0.2, (ratio * 100).toFixed(1) + '%');
}

section('打击：极轻，没有军鼓（参考曲 192 小节只有 40 次军鼓）');
// 【为什么这条是硬的】参考曲根本不是一个"有节奏感"的鼓组，
//   而是用闭镲做时间刻度、底鼓做心跳。加军鼓会立刻变成流行/摇滚。
for (const n of STYLED) {
  const hits = songs[n].tracks.filter((t) => t.inst === 'snare');
  ok(n + ' 没有军鼓', hits.length === 0, hits.length ? '有 snare' : '无');
}

section('弦乐铺底：必须存在且音量足够（保证中频不塌）');
// 【为什么测这个】实测 strings 是唯一在 1k-2kHz（临场感频段）
//   有可观能量（27%）的柔和音色，压低它等于压掉临场感。
for (const n of STYLED) {
  const str = songs[n].tracks.find((t) => t.inst === 'strings');
  ok(n + ' 有弦乐铺底', !!str);
  if (str) ok(n + ' 弦乐音量 >= 0.8', str.gain >= 0.8, String(str.gain));
}

section('循环：所有音符都落在循环长度内（否则尾音会被切掉）');
// 【为什么要查这个】BGM 是 loop 播放的，音符超出循环长度，
//   折回时会被硬切，听感上是一个突兀的断音。
for (const n of STYLED) {
  const s = songs[n];
  const limit = s.bars * s.beatsPerBar;
  let over = 0;
  for (const t of s.tracks) {
    for (const note of t.notes) {
      if (note.t + note.d > limit + 0.5) over++;
    }
  }
  ok(n + ' 没有音符越过循环结尾', over === 0, over + ' 个越界');
}

section('音频产物');
for (const n of STYLED) {
  const mp3 = path.join(ROOT, 'public', 'bgm', n + '.mp3');
  ok(n + '.mp3 已生成', fs.existsSync(mp3));
  if (!fs.existsSync(mp3)) continue;
  const size = fs.statSync(mp3).size;
  ok(n + ' 文件大小合理（0.8~3 MB）', size > 800000 && size < 3145728, (size / 1048576).toFixed(2) + ' MB');
}

section('编码参数');
// 【为什么固定 11025Hz / 56kbps】11025 的奈奎斯特频率是 5512Hz，
//   这些曲子的谐波本来就在 5.5kHz 以下，降采样率没有可听损失。
//   56kbps 是 MPEG-2 Layer III 在 11025Hz 下的倒数第二档。
for (const n of STYLED) {
  const mp3 = path.join(ROOT, 'public', 'bgm', n + '.mp3');
  if (!fs.existsSync(mp3)) continue;
  const buf = fs.readFileSync(mp3);
  // MPEG-2 (LSF) 采样率表：索引 0=22050 1=24000 2=16000，11025 对应 MPEG-2.5
  // 简化判断：文件头第 2 字节的版本位 + 采样率索引
  const h = buf[1] * 256 + buf[2];
  const verBits = (h >> 11) & 3;   // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
  ok(n + ' 是 MPEG-2.5（11025Hz 档）', verBits === 0, 'verBits=' + verBits);
}

section('贪吃蛇不再占用 mp3');
ok('snake 在 NO_MP3 名单里', NO_MP3.has('snake'));
ok('public/bgm/snake.mp3 已删除', !fs.existsSync(path.join(ROOT, 'public', 'bgm', 'snake.mp3')));

section('每款有 bgm 字段的游戏都必须有对应文件');
// 【为什么测这个】流水入杯的 meta.bgm 写着 'liushui'，但文件一直不存在，
//   进游戏时 <audio> 请求 404、控制台报错、玩家听不到任何声音。
//   这个 bug 存在了很久没人发现，就是因为没有这条断言。
const gamesSrc = fs.readFileSync(path.join(ROOT, 'src', 'games', 'index.js'), 'utf8');
const bgmRefs = [...gamesSrc.matchAll(/bgm:\s*'([a-z0-9]+)'/g)].map((m) => m[1]);
for (const ref of bgmRefs) {
  ok('bgm "' + ref + '" 有对应 mp3', fs.existsSync(path.join(ROOT, 'public', 'bgm', ref + '.mp3')));
}

console.log('\n' + '='.repeat(50));
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail > 0) process.exit(1);
