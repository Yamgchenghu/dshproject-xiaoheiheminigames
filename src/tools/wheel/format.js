/**
 * 云海转盘 —— 与原 APK 的「完整版 ZIP 2.0」互转。
 *
 * 【为什么要 1:1 对齐】用户手上已经有原 APK 导出的包，里面是几十个转盘、
 *   跳转规则、避重记录。如果我换一套自己的 JSON 结构，用户换到小程序
 *   就等于从零开始——那这个工具就没有存在的意义了。
 *   所以导出必须是原 APK 能直接吃回去的格式，导入也必须能吃原 APK 的包。
 *
 * 【两边的差异在哪】
 *   原 APK 用**标题**做转盘的身份，用**下标**记录"哪些选项已抽过"
 *   （drawn / disabled 都是数字数组）。
 *   小程序用 id 做身份（改标题不该让抽取记录失效），
 *   所以中间要做一层转换：导出时按当前顺序把 id 映射成下标，
 *   导入时按下标反推 id。只要导出那一刻的顺序是稳定的，来回就不会错位。
 *
 * 【为什么 script 只导出第一份】小程序侧限 1 份自动指令（见 store.js 的说明）。
 *   导出时写进 wheel.script 字段，原 APK 读得懂；导入时如果原包里
 *   有多个转盘各带脚本，只保留第一个非空的，其余丢弃并提示用户。
 */

/** 内部模型 → 原 APK 的 buildFullJson 结构 */
export function buildFullJson(wheels, opts = {}) {
  return {
    app: 'yunhai-wheel',
    version: 2,
    exportTime: Date.now(),
    categories: categoriesOf(wheels),
    settings: {
      autoGoto: opts.autoGoto !== false,
      avoidReset: Number(opts.avoidReset) || 0,
      defaultAvoid: !!opts.defaultAvoid,
      /**
       * 朗读模板也一起导出。
       *
       * 【为什么它属于"数据"而不是"本机偏好"】原 APK 把 ttsTemplate 放在
       *   db.settings 里，跟着完整版备份走——用户换设备时模板应该跟着走，
       *   而不是重新敲一遍。语音开关、音色这种跟设备能力相关的才留在本地。
       *
       * 原 APK 不认识这个字段以外的也不会受影响：它读 settings 时按 key 取，
       * 多出来的键直接忽略。
       */
      ...(typeof opts.voiceTemplate === 'string' && opts.voiceTemplate
        ? { ttsTemplate: opts.voiceTemplate }
        : {}),
    },
    wheels: wheels.map((w) => {
      const idxOf = new Map(w.items.map((it, i) => [it.id, i]));
      const counts = {};
      for (const [itemId, n] of Object.entries(w.counts || {})) {
        const i = idxOf.get(itemId);
        if (i !== undefined) counts[String(i)] = n;
      }
      return {
        title: w.name,
        category: w.category || '未分类',
        avoid: !!w.unique,
        autogoto: w.autogoto !== false,
        items: w.items.map((it) => ({
          text: it.text,
          // value 是小程序侧新增的字段，原 APK 不认识会直接忽略，
          // 所以带上它不会破坏与原包的兼容性
          ...(it.value ? { value: it.value } : {}),
          weight: Math.max(0, Number(it.weight) || 0),
          // 原 APK 的 group 从 1 开始，0 表示"不参与避重组"
          group: Number.isInteger(it.group) && it.group >= 0 ? it.group : 1,
        })),
        script: w.script || '',
        rules: (w.rules || []).map((r) => ({
          itemText: r.itemText || '',
          delay: Number(r.delay) || 0,
          targetId: r.targetId || '',
          targetTitle: r.targetTitle || '',
          autoSpin: !!r.autoSpin,
          enabled: r.enabled !== false,
        })),
        counts,
        drawn: (w.drawn || []).map((id) => idxOf.get(id)).filter((i) => i !== undefined),
        disabled: w.items.map((it, i) => (it.disabled ? i : -1)).filter((i) => i >= 0),
        lastResult: w.lastResult || '',
        createdAt: w.createdAt || 0,
        updatedAt: w.updatedAt || 0,
      };
    }),
  };
}

/**
 * 从完整版备份里读设置。
 *
 * 【为什么单独导出这个函数】parseFullJson 返回的是转盘数组，
 *   而设置是全局的、不属于任何一个转盘。硬塞进数组元素里会很别扭，
 *   调用方还得知道"第 0 个元素的 settings 才是全局的"。
 */
export function parseSettings(data) {
  const s = (data && data.settings) || {};
  return {
    autoGoto: s.autoGoto !== false,
    avoidReset: Number(s.avoidReset) || 0,
    defaultAvoid: !!s.defaultAvoid,
    // 原 APK 的字段名是 ttsTemplate
    voiceTemplate: typeof s.ttsTemplate === 'string' ? s.ttsTemplate : '',
  };
}

/** 原 APK 的结构 → 内部模型。缺字段的一律给默认值，坏数据不抛异常 */
export function parseFullJson(data, makeWheel, uid) {
  if (!data || !Array.isArray(data.wheels)) {
    throw new Error('不是有效的转盘备份文件');
  }
  const out = [];
  for (const w of data.wheels) {
    if (!w || !Array.isArray(w.items) || !w.items.length) continue;
    const items = w.items.map((it) => ({
      id: uid(),
      text: String(it && it.text != null ? it.text : ''),
      value: it && it.value != null ? String(it.value) : '',
      weight: Math.max(0, Number(it && it.weight) || 0),
      group: Number.isInteger(it && it.group) && it.group > 0 ? it.group : 0,
      disabled: false,
    }));
    const disabled = Array.isArray(w.disabled) ? w.disabled : [];
    for (const i of disabled) if (items[i]) items[i].disabled = true;

    const drawn = (Array.isArray(w.drawn) ? w.drawn : [])
      .map((i) => items[i] && items[i].id)
      .filter(Boolean);

    const counts = {};
    for (const [k, n] of Object.entries(w.counts || {})) {
      const i = Number(k);
      if (items[i]) counts[items[i].id] = Number(n) || 0;
    }

    out.push(makeWheel({
      name: String(w.title || '未命名转盘').trim() || '未命名转盘',
      category: String(w.category || '未分类').trim() || '未分类',
      items,
      unique: w.avoid !== false,
      autogoto: w.autogoto !== false,
      script: typeof w.script === 'string' ? w.script : '',
      rules: Array.isArray(w.rules) ? w.rules : [],
      drawn,
      counts,
      lastResult: typeof w.lastResult === 'string' ? w.lastResult : '',
      createdAt: Number(w.createdAt) || 0,
    }));
  }
  if (!out.length) throw new Error('文件里没有可用的转盘');
  // 统一成内部命名（voiceTemplate），调用方不用知道原 APK 叫 ttsTemplate
  return {
    wheels: out,
    settings: data.settings ? parseSettings(data) : null,
    categories: data.categories || [],
  };
}

function categoriesOf(wheels) {
  const set = new Set();
  for (const w of wheels) if (w.category) set.add(w.category);
  return [...set];
}

/**
 * 导出成文件文本。
 * @param {'json'|'pwh'|'full'} format
 */
export function serialize(wheels, format, opts) {
  if (format === 'pwh') {
    const obj = {};
    for (const w of wheels) obj[w.name] = w.items.map((it) => it.text);
    return { text: JSON.stringify(obj, null, 2), ext: 'pwh' };
  }
  if (format === 'full') {
    return { text: JSON.stringify(buildFullJson(wheels, opts), null, 2), ext: 'json' };
  }
  return {
    text: JSON.stringify({
      app: 'yunhai-wheel',
      version: 1,
      exportTime: Date.now(),
      wheels: wheels.map((w) => ({ title: w.name, items: w.items.map((it) => ({ text: it.text, weight: it.weight })) })),
    }, null, 2),
    ext: 'json',
  };
}

/** 猜一段文本是什么格式，然后尽力解析 */
export function deserialize(text, makeWheel, uid) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON 文本');
  }
  if (data && data.app === 'yunhai-wheel' && Number(data.version) >= 2) {
    return parseFullJson(data, makeWheel, uid);
  }
  if (data && Array.isArray(data.wheels)) {
    return parseFullJson(data, makeWheel, uid);
  }
  if (Array.isArray(data)) {
    return { wheels: [makeWheel({ name: '导入的转盘', items: data.map((t) => ({ text: String(t) })) })], settings: null };
  }
  // PWH：{ 名称: [选项...] }
  const out = [];
  for (const [name, val] of Object.entries(data || {})) {
    if (Array.isArray(val)) {
      out.push(makeWheel({ name, items: val.map((t) => ({ text: String(t) })) }));
    } else if (val && Array.isArray(val.items)) {
      out.push(makeWheel({ name, ...val }));
    }
  }
  if (!out.length) throw new Error('文件里没有可用的转盘');
  return { wheels: out, settings: null };
}