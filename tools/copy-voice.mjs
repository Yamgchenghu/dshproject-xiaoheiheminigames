/**
 * 把 mimo 生成的 WAV 转成 mp3，写进 public/voice/langdu/。
 *
 * 【为什么要转 mp3】mimo 返回 24 kHz 单声道 16 bit WAV，113 条约 13 MB。
 *   转成 32 kbps mp3 后约 1 MB，音质对"念一个词"完全够用。
 *   包体上限 100 MiB 虽然放得下 WAV，但没必要让用户多下 12 MB。
 *
 * 【为什么要裁静音】mimo 返回的音频首尾有 0.1–0.3 秒静音，
 *   转盘连续念多条时会听起来一顿一顿的。裁到 -45 dBFS 为止。
 *
 * 【为什么在 node 里调 ffmpeg 而不是用 python】ffmpeg 在
 *   /c/ffmpeg/.../bin 下，node 直接 spawn 最省事，不用再进 python 环境。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = 'C:/server/TTS/gptsovits/out/mimo';
const DST = path.join(ROOT, 'public', 'voice', 'langdu');
const FFMPEG = 'C:/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe';

// 短语表要和 python 端一致
const PHRASES = JSON.parse(
  spawnSync('C:/server/TTS/gsvenv/Scripts/python.exe',
    ['-c', 'import sys,json; sys.path.insert(0,r"C:/...编程/小黑盒/_voice"); from phrases import PHRASES; print(json.dumps(PHRASES,ensure_ascii=False))'],
    { encoding: 'utf8' }).stdout,
);

if (!fs.existsSync(FFMPEG)) {
  console.error('找不到 ffmpeg:', FFMPEG);
  process.exit(1);
}
fs.mkdirSync(DST, { recursive: true });

const index = {};
let ok = 0, skip = 0, total = 0;

for (let i = 0; i < PHRASES.length; i++) {
  const text = PHRASES[i];
  const src = path.join(SRC, `p${String(i).padStart(3, '0')}.wav`);
  if (!fs.existsSync(src)) { skip++; continue; }

  const name = `p${String(i).padStart(3, '0')}`;
  const dst = path.join(DST, name + '.mp3');

  // 裁静音 + 重采样到 24k 单声道 + 32k mp3
  const r = spawnSync(FFMPEG, [
    '-y', '-loglevel', 'error',
    '-i', src,
    '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse',
    '-ar', '24000', '-ac', '1', '-b:a', '32k',
    dst,
  ], { encoding: 'utf8' });

  if (r.status !== 0) {
    console.error(name, 'ffmpeg 失败:', (r.stderr || '').slice(0, 200));
    continue;
  }
  const size = fs.statSync(dst).size;
  total += size;
  index[text] = name;
  ok++;
}

fs.writeFileSync(path.join(DST, 'index.json'), JSON.stringify(index, null, 0), 'utf8');
console.log(`转换 ${ok} 条，跳过 ${skip} 条，共 ${(total / 1048576).toFixed(2)} MB`);
