/**
 * 标准 MIDI 文件（SMF Format 1）写入器 —— 手写二进制，不依赖任何库
 * ------------------------------------------------------------------
 * 结构：
 *   MThd (14 字节头) + 若干 MTrk 块
 *   Track 0 为指挥轨（速度 / 拍号 / 段落标记）
 *   其余轨为乐器轨（音色 / 音符 / 控制器）
 *
 * 所有时间以"拍（beat）"为输入单位，内部换算为 tick（PPQ=480）。
 */

export const PPQ = 480;

/** 变长整数（VLQ）编码，MIDI 的 delta-time 与长度字段都用它 */
function vlq(value) {
  let v = Math.max(0, Math.round(value));
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return Buffer.from(bytes);
}

/** 写一个大端 32 位整数 */
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

/** 写一个大端 16 位整数 */
function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff, 0);
  return b;
}

/** 事件 -> Buffer 片段（不含 delta-time） */
function eventBytes(ev) {
  const ch = ev.channel & 0x0f;
  switch (ev.type) {
    case 'noteOn':
      return Buffer.from([0x90 | ch, ev.pitch & 0x7f, ev.velocity & 0x7f]);
    case 'noteOff':
      return Buffer.from([0x80 | ch, ev.pitch & 0x7f, 0x40]);
    case 'program':
      return Buffer.from([0xc0 | ch, ev.program & 0x7f]);
    case 'control':
      return Buffer.from([0xb0 | ch, ev.controller & 0x7f, ev.value & 0x7f]);
    case 'meta': {
      const payload = Buffer.isBuffer(ev.data) ? ev.data : Buffer.from(String(ev.data), 'utf8');
      return Buffer.concat([Buffer.from([0xff, ev.metaType]), vlq(payload.length), payload]);
    }
    default:
      throw new Error('未知 MIDI 事件类型: ' + ev.type);
  }
}

/** 同一 tick 上的排序权重：先关音，再换音色/控制器，最后开音 */
function order(ev) {
  if (ev.type === 'meta') return 0;
  if (ev.type === 'noteOff') return 1;
  if (ev.type === 'program' || ev.type === 'control') return 2;
  return 3;
}

/** 把事件数组打包成一个 MTrk 块 */
function buildTrack(events) {
  const sorted = events.slice().sort((a, b) => a.tick - b.tick || order(a) - order(b));
  const parts = [];
  let lastTick = 0;
  for (const ev of sorted) {
    const delta = ev.tick - lastTick;
    lastTick = ev.tick;
    parts.push(vlq(delta), eventBytes(ev));
  }
  // 轨道结束标记
  parts.push(vlq(0), Buffer.from([0xff, 0x2f, 0x00]));
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from('MTrk'), u32(body.length), body]);
}

/**
 * 生成 MIDI 文件
 * @param {object} score
 *   score.bpm         每分钟拍数
 *   score.beatsPerBar 每小节拍数（4 表示 4/4）
 *   score.tracks      [{ name, channel, program, notes:[{t,d,p,v}], markers? }]
 *                     t/d 单位是拍，p 是 MIDI 音高，v 是 1..127 力度
 * @returns {Buffer}
 */
export function writeMidi(score) {
  const { bpm, beatsPerBar = 4, tracks } = score;

  // ---- 指挥轨：速度、拍号、段落标记 ----
  const conductor = [];
  const usPerQuarter = Math.round(60000000 / bpm);
  conductor.push({
    tick: 0,
    type: 'meta',
    metaType: 0x51,
    data: Buffer.from([(usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff]),
  });
  conductor.push({
    tick: 0,
    type: 'meta',
    metaType: 0x58,
    data: Buffer.from([beatsPerBar, 2, 24, 8]),
  });
  conductor.push({ tick: 0, type: 'meta', metaType: 0x03, data: 'Conductor' });
  for (const m of score.markers || []) {
    conductor.push({
      tick: Math.round(m.t * PPQ),
      type: 'meta',
      metaType: 0x06,
      data: m.name,
    });
  }

  const chunks = [buildTrack(conductor)];

  for (const tr of tracks) {
    const evs = [];
    evs.push({ tick: 0, type: 'meta', metaType: 0x03, data: tr.name });
    evs.push({ tick: 0, type: 'program', channel: tr.channel, program: tr.program ?? 0 });
    evs.push({ tick: 0, type: 'control', channel: tr.channel, controller: 7, value: tr.volume ?? 100 });
    evs.push({ tick: 0, type: 'control', channel: tr.channel, controller: 10, value: tr.pan ?? 64 });
    evs.push({ tick: 0, type: 'control', channel: tr.channel, controller: 91, value: tr.reverb ?? 40 });
    for (const n of tr.notes) {
      const on = Math.round(n.t * PPQ);
      const off = Math.max(on + 1, Math.round((n.t + n.d) * PPQ));
      evs.push({ tick: on, type: 'noteOn', channel: tr.channel, pitch: n.p, velocity: n.v });
      evs.push({ tick: off, type: 'noteOff', channel: tr.channel, pitch: n.p });
    }
    chunks.push(buildTrack(evs));
  }

  const header = Buffer.concat([
    Buffer.from('MThd'),
    u32(6),
    u16(1), // format 1：多轨同步
    u16(chunks.length),
    u16(PPQ),
  ]);
  return Buffer.concat([header, ...chunks]);
}

/** 统计 MIDI 中的音符总数（用于日志） */
export function countNotes(score) {
  return score.tracks.reduce((a, t) => a + t.notes.length, 0);
}
