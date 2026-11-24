/**
 * 标准 MIDI 文件解析器 —— 手写二进制解析，与 midi.mjs 的写入器配套
 * ------------------------------------------------------------------
 * 合成器直接读取生成的 .mid 来发声，保证"MIDI 才是真正的乐谱"。
 * 只解析本脚本用到的子集：format 1、note on/off、program、CC、tempo、marker。
 */

import { PPQ } from './midi.mjs';

/** 读取变长整数 */
function readVlq(buf, pos) {
  let value = 0;
  let p = pos;
  for (;;) {
    const b = buf[p++];
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  return { value, next: p };
}

/**
 * 解析 MIDI Buffer
 * @returns {{ format:number, ppq:number, bpm:number, beatsPerBar:number,
 *             tracks:Array<{name:string, channel:number, program:number,
 *                           volume:number, pan:number, reverb:number,
 *                           notes:Array<{t:number,d:number,p:number,v:number}>}>,
 *             markers:Array<{t:number,name:string}> }}
 *   t / d 单位是"拍"
 */
export function readMidi(buf) {
  if (buf.toString('ascii', 0, 4) !== 'MThd') throw new Error('不是合法的 MIDI 文件');
  const headerLen = buf.readUInt32BE(4);
  const format = buf.readUInt16BE(8);
  const trackCount = buf.readUInt16BE(10);
  const ppq = buf.readUInt16BE(12) || PPQ;

  let pos = 8 + headerLen;
  let bpm = 120;
  let beatsPerBar = 4;
  const tracks = [];
  const markers = [];

  for (let ti = 0; ti < trackCount && pos < buf.length; ti++) {
    const id = buf.toString('ascii', pos, pos + 4);
    if (id !== 'MTrk') break;
    const len = buf.readUInt32BE(pos + 4);
    const start = pos + 8;
    const end = start + len;
    let p = start;
    let tick = 0;
    let runningStatus = 0;

    // 该轨的临时状态
    const track = {
      name: '',
      channel: 0,
      program: 0,
      volume: 100,
      pan: 64,
      reverb: 40,
      notes: [],
    };
    const openNotes = new Map(); // pitch -> { tick, velocity }

    while (p < end) {
      const dv = readVlq(buf, p);
      p = dv.next;
      tick += dv.value;
      if (p >= end) break;
      let status = buf[p];

      if (status === 0xff) {
        // 元事件
        p++;
        const metaType = buf[p++];
        const dl = readVlq(buf, p);
        p = dl.next;
        const dataStart = p;
        const dataLen = dl.value;
        p += dataLen;
        if (metaType === 0x51 && dataLen === 3) {
          const us = (buf[dataStart] << 16) | (buf[dataStart + 1] << 8) | buf[dataStart + 2];
          if (us > 0) bpm = 60000000 / us;
        } else if (metaType === 0x58 && dataLen >= 2) {
          beatsPerBar = buf[dataStart];
        } else if (metaType === 0x03) {
          track.name = buf.toString('utf8', dataStart, dataStart + dataLen);
        } else if (metaType === 0x06) {
          markers.push({ t: tick / ppq, name: buf.toString('utf8', dataStart, dataStart + dataLen) });
        }
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        // 系统专用（本脚本不产生，跳过）
        p++;
        const dl = readVlq(buf, p);
        p = dl.next + dl.value;
        continue;
      }

      if (status & 0x80) {
        p++;
        runningStatus = status;
      } else {
        status = runningStatus;
      }

      const type = status & 0xf0;
      const ch = status & 0x0f;

      if (type === 0x90 || type === 0x80) {
        const pitch = buf[p++];
        const vel = buf[p++];
        if (type === 0x90 && vel > 0) {
          openNotes.set(pitch, { tick, vel });
        } else {
          const on = openNotes.get(pitch);
          if (on) {
            track.notes.push({
              t: on.tick / ppq,
              d: Math.max(1 / 64, (tick - on.tick) / ppq),
              p: pitch,
              v: on.vel,
            });
            openNotes.delete(pitch);
          }
        }
      } else if (type === 0xc0) {
        track.program = buf[p++];
        track.channel = ch;
      } else if (type === 0xd0) {
        p += 1;
      } else if (type === 0xb0) {
        const cc = buf[p++];
        const val = buf[p++];
        if (cc === 7) track.volume = val;
        else if (cc === 10) track.pan = val;
        else if (cc === 91) track.reverb = val;
      } else if (type === 0xe0) {
        p += 2;
      } else if (type === 0xa0) {
        p += 2;
      } else {
        // 未知状态，防止死循环
        break;
      }
    }

    // 未闭合的音符（文件被截断时）直接丢弃
    if (track.notes.length > 0) {
      track.channel = track.channel ?? 0;
      tracks.push(track);
    }
    pos = end;
  }

  return { format, ppq, bpm, beatsPerBar, tracks, markers };
}
