/**
 * 云海转盘 —— 抽取内核。
 *
 * 【为什么把"抽"和"画"分开】转盘动画要 3~5 秒，但结果必须在一开始就定下来。
 *   先算结果再让指针转到那个扇区，动画才有"已经抽好了"的确定感；
 *   反过来（转到哪算哪）会因为缓动误差让指针停在两个扇区交界处。
 *
 * 【权重 + 避重 + 避重组的关系】
 *   - 权重：同一轮里按权重占比决定命中概率；
 *   - 避重：抽过的项从候选里移除，剩余为 0 时按 _reset 秒数自动复原；
 *   - 避重组：一组选项共用一个"自然数组号"，同组抽完才一起复原。
 *   三者叠加的顺序是：先按避重过滤 → 再按避重组过滤 → 最后按权重随机。
 */
import { makeRng } from '../../core/util.js';

let seedCounter = 1;

export function createWheel(def = {}) {
  const wheel = {
    id: def.id || 'w' + Date.now().toString(36),
    name: def.name || '新转盘',
    category: def.category || '未分类',
    items: (def.items || []).map(normalizeItem),
    unique: def.unique !== false,
    unable: def.unable || [], // 已抽掉的项（避重）
    // 原 APK 的 autogoto 是个布尔值（"抽完要不要自动跳"），
    // 而具体跳到哪里由 rules 决定。小程序内部把两者合成一个对象，
    // 这里要能吃布尔值，否则导入原包时会把 true 当成"没有跳转规则"。
    autogoto: typeof def.autogoto === 'boolean' ? def.autogoto : (def.autogoto || null),
    rules: Array.isArray(def.rules) ? def.rules : [],
    drawn: Array.isArray(def.drawn) ? def.drawn : [],
    counts: def.counts && typeof def.counts === 'object' ? def.counts : {},
    lastResult: def.lastResult || '',
    resetSec: def.resetSec === undefined ? 3 : def.resetSec,
    script: def.script || '',
    createdAt: def.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  return wheel;
}

export function normalizeItem(raw) {
  if (typeof raw === 'string') {
    return { id: uid(), text: raw, value: '', weight: 100, group: 0, disabled: false };
  }
  return {
    id: raw.id || uid(),
    text: String(raw.text ?? raw.name ?? ''),
    /**
     * 选项的"数值"，默认为空。
     *
     * 【为什么需要它】选项文本和要念出来的数值经常不是一回事：
     *   「一等奖」要念成"一"，「+5 分」要念成"五"，「谢谢参与」可能根本不念。
     *   把数值单独放一个字段，朗读模板就能用 {value} 只念数值，
     *   而界面上仍然显示完整的文本。
     *
     * 【为什么不自动从文本里抠数字】文本里的数字形态太多（罗马数字、
     *   中文数字、带单位），自动抠出来十次有八次是错的，
     *   而且用户没法纠正。留空就是"没设过"，模板里 {value} 会退回到文本。
     */
    value: raw.value === undefined || raw.value === null ? '' : String(raw.value),
    weight: Number.isFinite(raw.weight) ? raw.weight : 100,
    group: Number.isFinite(raw.group) ? raw.group : 0,
    disabled: !!raw.disabled,
  };
}

let uidSeq = 0;
export function uid() {
  uidSeq++;
  return 'i' + Date.now().toString(36) + uidSeq.toString(36);
}

/**
 * 抽一次。
 * 返回 {item, index, remaining, exhausted}
 */
export function spin(wheel, opts = {}) {
  const rng = opts.rng || makeRng(Date.now() + seedCounter++);
  const items = wheel.items;
  if (!items.length) return { item: null, index: -1, remaining: 0, exhausted: true };

  // 1) 避重过滤
  let pool = items.map((it, i) => ({ it, i }));
  if (wheel.unique) {
    const used = new Set(wheel.unable || []);
    const left = pool.filter((p) => !used.has(p.it.id));
    // 全抽完了：先复原再抽
    if (!left.length) {
      wheel.unable = [];
      pool = items.map((it, i) => ({ it, i }));
    } else {
      pool = left;
    }
  }

  // 2) 避重组过滤：同一组里只要还有没抽过的，就只在这些里挑
  const groupLeft = new Map();
  for (const p of pool) {
    const g = p.it.group;
    if (!g) continue;
    groupLeft.set(g, (groupLeft.get(g) || 0) + 1);
  }
  if (groupLeft.size) {
    const filtered = pool.filter((p) => !p.it.group || groupLeft.get(p.it.group) > 0);
    if (filtered.length) pool = filtered;
  }

  // 3) 权重随机
  const total = pool.reduce((s, p) => s + Math.max(0, p.it.weight || 0), 0);
  let pick = pool[0];
  if (total <= 0) {
    pick = pool[Math.floor(rng() * pool.length)];
  } else {
    let r = rng() * total;
    for (const p of pool) {
      r -= Math.max(0, p.it.weight || 0);
      if (r <= 0) {
        pick = p;
        break;
      }
    }
  }

  if (wheel.unique) {
    wheel.unable = wheel.unable || [];
    if (!wheel.unable.includes(pick.it.id)) wheel.unable.push(pick.it.id);
  }

  const remaining = wheel.unique ? items.length - (wheel.unable || []).length : items.length;
  return { item: pick.it, index: pick.i, remaining, exhausted: remaining <= 0 };
}

/** 计算每个扇区的起止角（弧度，从 -90° 开始顺时针） */
export function sectors(wheel) {
  const n = wheel.items.length;
  if (!n) return [];
  const total = wheel.items.reduce((s, it) => s + Math.max(0.0001, it.weight || 100), 0);
  let acc = -Math.PI / 2;
  return wheel.items.map((it) => {
    const span = (Math.max(0.0001, it.weight || 100) / total) * Math.PI * 2;
    const s = { start: acc, end: acc + span, mid: acc + span / 2, item: it };
    acc += span;
    return s;
  });
}

/** 让指针停在某个扇区中央需要的最终旋转角 */
export function rotationFor(wheel, itemIndex) {
  const secs = sectors(wheel);
  if (!secs[itemIndex]) return 0;
  const target = secs[itemIndex].mid;
  // 指针在正上方（-90°），所以把扇区中点转到 -90°
  const base = -Math.PI / 2 - target;
  // 加 5 圈，保证有"转起来"的观感
  return base + Math.PI * 2 * 5;
}

/* ---------------- 朗读模板 ---------------- */

/**
 * 支持的占位符。顺序即设置页里按钮的显示顺序。
 * desc 给设置页做提示用，不参与渲染。
 */
export const TEMPLATE_VARS = [
  { key: 'result', label: '结果', desc: '选项的完整文本，例如「火锅」' },
  { key: 'value',  label: '数值', desc: '选项的数值字段，没填就用文本' },
  { key: 'count',  label: '次数', desc: '这个选项被抽中的次数' },
  { key: 'last',   label: '剩余', desc: '本转盘还没抽过的选项数' },
  { key: 'time',   label: '时间', desc: '当前时间，例如「11月15日09时30分」' },
  { key: 'total',  label: '总数', desc: '本转盘的选项总数' },
];

/**
 * 按 UTC+8 格式化时间。
 *
 * 【为什么固定 UTC+8 而不是用本地时区】原 APK 就是这么写的，
 *   而且转盘的绝大多数用户在国内。用本地时区会让同一份存档
 *   在不同设备上念出不同时间，看起来像 bug。
 */
export function timeText(ts) {
  const d = new Date((ts === undefined ? Date.now() : ts) + 8 * 3600 * 1000);
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日${p(d.getUTCHours())}时${p(d.getUTCMinutes())}分`;
}

/**
 * 算出模板里每个占位符的值。
 *
 * @param {object} item   抽中的选项（可为空，用于预览）
 * @param {object} wheel  当前转盘
 * @param {object} opts   { count, last, ts }
 */
export function templateVars(item, wheel, opts = {}) {
  const total = wheel ? wheel.items.filter((i) => !i.disabled).length : 0;
  const text = item ? String(item.text ?? '') : '';
  // value 没填就退回文本——否则模板写了 {value} 但用户没设数值时会念出空字符串，
  // 听起来像"卡住了"
  const value = item && item.value !== undefined && item.value !== ''
    ? String(item.value)
    : text;
  return {
    result: text,
    value,
    count: String(opts.count === undefined ? 0 : opts.count),
    last: String(opts.last === undefined ? total : opts.last),
    time: timeText(opts.ts),
    total: String(total),
  };
}

/**
 * 渲染朗读模板。
 *
 * 【为什么未知占位符原样保留】用户可能把 {中奖} 当普通文本写进去，
 *   或者记错了一个占位符名字。静默替换成空字符串会让人以为模板坏了，
 *   原样留着能立刻看出"这个词没被识别"。
 */
export function renderTemplate(tpl, item, wheel, opts = {}) {
  const t = String(tpl || '').trim() || '抽到{result}';
  const vars = templateVars(item, wheel, opts);
  return t.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/**
 * 模板预览。用固定的假数据，设置页里改一个字就能立刻看到效果。
 */
export function previewTemplate(tpl) {
  const fakeWheel = { items: [{ text: '火锅', value: '5' }, {}, {}, {}, {}, {}, {}, {}] };
  const fakeItem = { text: '火锅', value: '5' };
  return renderTemplate(tpl, fakeItem, fakeWheel, { count: 3, last: 5 });
}

/* ---------------- 导入 / 导出 ---------------- */

export const EXPORT_FORMATS = [
  { value: 'json', label: '仅数据 JSON', desc: '最通用，任何工具都能读' },
  { value: 'pwh', label: '仅数据 PWH', desc: '大转盘小决定可读的格式' },
  { value: 'full', label: '完整版 ZIP 2.0', desc: '含跳转、脚本、避重组、权重' },
];

export function toPwh(wheels) {
  // PWH 是大转盘小决定的数据格式：{名称: [选项...]} 的 JSON
  const out = {};
  for (const w of wheels) out[w.name] = w.items.map((it) => it.text);
  return JSON.stringify(out, null, 2);
}

export function fromAny(raw) {
  // 统一入口：能吃 PWH / 纯数组 / 完整结构
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (Array.isArray(data)) {
    return [createWheel({ name: '导入的转盘', items: data })];
  }
  if (data && Array.isArray(data.wheels)) {
    return data.wheels.map((w) => createWheel(w));
  }
  // PWH：{ 名称: [字符串...] }
  const out = [];
  for (const [name, val] of Object.entries(data || {})) {
    if (Array.isArray(val)) {
      out.push(createWheel({ name, items: val.map(normalizeItem) }));
    } else if (val && Array.isArray(val.items)) {
      out.push(createWheel({ name, ...val }));
    }
  }
  return out;
}
