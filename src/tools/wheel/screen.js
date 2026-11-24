/**
 * 云海转盘 —— 界面。
 *
 * 【为什么转盘用 canvas 而不是 CSS conic-gradient】扇区数量最多几百个，
 *   conic-gradient 在每个扇区上要写一段颜色，几百段字符串会拖慢重绘；
 *   canvas 一次画完，且能顺手把文字沿半径旋转排版。
 *
 * 【为什么结果先定再转】见 engine.js 顶部注释：动画只是"揭晓"，不是"决定"。
 *
 * 【为什么存档分三个域】见 store.js 顶部注释。界面这里只负责在
 *   "改了转盘本体"时存 lib、"抽完之后"存 goto，各存各的，
 *   不会因为抽一次就把几百 KB 的转盘库重写一遍。
 */
import { h, formatDate, syncRangeFill } from '../../core/util.js';
import { toast } from '../../ui/toast.js';
import {
  createWheel, spin, sectors, rotationFor, uid, EXPORT_FORMATS,
  renderTemplate, previewTemplate, TEMPLATE_VARS,
} from './engine.js';
import {
  loadLibrary, saveLibrary, loadGotoData, saveGotoData, mergeGoto,
  loadLog, appendLog, clearLog, loadConfig, saveConfig,
  loadScripts, saveScripts, SCRIPT_LIMIT, wheelUsage, VERSION, activeScript,
} from './store.js';
import { serialize, deserialize } from './format.js';
import { parse, Interpreter } from '../../mod/interp.js';
import { openGlobalSettings } from '../../ui/global.js';
import { speakSmart, VOICES } from './voice.js';
import { exportText, importText } from '../../sdk/files.js';

const PALETTE = [
  '#4ad991', '#6ea8ff', '#f0b429', '#ff7a59', '#b48cff',
  '#4ad9d9', '#ff6b9d', '#8fd14f', '#ffb648', '#7b8cff',
];

/** 中奖时先念这几句，再念选项本身 */

export async function openWheelScreen({ onExit }) {
  const [rawLib, gotoData, cfg0, scripts0] = await Promise.all([
    loadLibrary(), loadGotoData(), loadConfig(), loadScripts(),
  ]);

  let lib = mergeGoto(rawLib, gotoData);
  let cfg = cfg0;
  let scripts = scripts0;
  let current = lib[0];
  let spinning = false;
  let rotation = 0;
  let animFrom = 0;
  let animTo = 0;
  let animStart = 0;
  let animDur = 0;
  let raf = 0;
  let destroyed = false;
  let lastResult = null;
  let tab = 'items';

  // 预载常用语音，第一次抽中时不用等加载


  // ---------- DOM ----------
  const canvas = h('canvas', { class: 'wheel-canvas' });
  const ctx = canvas.getContext('2d');
  const resultEl = h('div', { class: 'result-banner' }, '点「开始抽取」');
  const remainEl = h('div', { class: 'wheel-remain' }, '');

  const stage = h('div', { class: 'wheel-stage' }, [
    h('div', { class: 'wheel-pointer' }),
    canvas,
    resultEl,
    remainEl,
  ]);

  const header = h('div', { class: 'tool-header' }, [
    h('button', { class: 'hud-back', onclick: () => exit() }, '‹'),
    h('h1', {}, '云海转盘'),
    h('span', { class: 'badge' }, 'v' + VERSION),
    // 全屏页会盖住外壳的顶栏，所以这里必须自带一个设置入口，
    // 否则"设置永远在右上角"这条要求在这个页面上就断了
    h('button', { class: 'icon-btn', title: '设置', onclick: () => openGlobalSettings() }, '⚙'),
  ]);

  const spinBtn = h('button', {
    class: 'big-play',
    style: { marginTop: '14px' },
    onclick: () => doSpin(),
  }, '开始抽取');

  const page = h('div', { class: 'page wheel-page' });
  const screen = h('div', { class: 'wheel-screen' }, [header, page]);

  page.appendChild(stage);
  page.appendChild(spinBtn);

  const tabBar = h('div', { class: 'mode-row', style: { marginTop: '12px' } });
  const TABS = [
    { id: 'items', label: '选项' },
    { id: 'wheels', label: '转盘' },
    { id: 'log', label: '记录' },
    { id: 'settings', label: '设置' },
  ];
  const tabHost = h('div', {});
  for (const t of TABS) {
    tabBar.appendChild(h('button', {
      class: `mode-pill${t.id === tab ? ' active' : ''}`,
      dataset: { tab: t.id },
      onclick: (e) => {
        tab = t.id;
        for (const el of tabBar.children) el.classList.toggle('active', el.dataset.tab === tab);
        renderTab();
      },
    }, t.label));
  }
  page.appendChild(tabBar);
  page.appendChild(tabHost);

  document.body.appendChild(screen);

  // ---------- 画布尺寸 ----------
  let SIZE = 300;
  let DPR = 1;

  function sizeCanvas() {
    const w = Math.min(window.innerWidth - 48, 340);
    SIZE = Math.max(200, Math.round(w));
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.style.width = SIZE + 'px';
    canvas.style.height = SIZE + 'px';
    canvas.width = Math.round(SIZE * DPR);
    canvas.height = Math.round(SIZE * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawWheel();
  }

  // ---------- 绘制 ----------
  function drawWheel() {
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const R = SIZE / 2 - 6;
    ctx.clearRect(0, 0, SIZE, SIZE);

    ctx.beginPath();
    ctx.arc(cx, cy, R + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();

    const secs = sectors(current);
    if (!secs.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(154,164,178,0.9)';
      ctx.font = '13px "TWKai", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('还没有选项', cx, cy);
      return;
    }

    secs.forEach((s, i) => {
      const color = PALETTE[i % PALETTE.length];
      const used = current.unique && (current.unable || []).includes(s.item.id);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, s.start + rotation, s.end + rotation);
      ctx.closePath();
      ctx.fillStyle = used ? shade(color, -0.62) : color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // 文字沿半径排；字太多就缩字号，而不是一味截断
      const mid = s.mid + rotation;
      const label = s.item.text;
      const maxChars = Math.max(3, Math.floor(R / 22));
      const text = label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label;
      const fs = Math.max(9, Math.min(15, (SIZE / 2) * 0.14 - Math.max(0, secs.length - 12) * 0.12));
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * R * 0.62, cy + Math.sin(mid) * R * 0.62);
      ctx.rotate(mid);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${fs}px "WXSJT", "PingFang SC", sans-serif`;
      ctx.fillStyle = used ? 'rgba(255,255,255,0.32)' : 'rgba(10,14,12,0.9)';
      ctx.fillText(text, 0, 0);
      ctx.restore();
    });

    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = '#12161b';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#eef1f5';
    ctx.font = '700 12px "WXSJT", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(current.items.filter((i) => !i.disabled).length), cx, cy);
  }

  function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
  }

  function loop(ts) {
    if (destroyed) return;
    raf = requestAnimationFrame(loop);
    if (!animStart) {
      drawWheel();
      return;
    }
    const t = Math.min(1, (ts - animStart) / animDur);
    rotation = animFrom + (animTo - animFrom) * easeOutQuint(t);
    drawWheel();
    if (t >= 1) {
      animStart = 0;
      spinning = false;
      onSpinEnd();
    }
  }

  // ---------- 抽取 ----------
  async function doSpin() {
    if (spinning) return;
    const pool = current.items.filter((i) => !i.disabled);
    if (!pool.length) {
      toast('这个转盘没有可抽的选项');
      return;
    }
    if (current.unique && (current.unable || []).length >= pool.length) {
      current.unable = [];
      await persistGoto();
    }

    // 抽之前跑一次 before 指令：用户可能想在这里根据历史改避重设置
    await runAutoScript('before', null);

    const res = spin(current);
    if (!res.item) {
      toast('没有可抽的选项');
      return;
    }
    lastResult = res;
    spinning = true;
    animFrom = rotation % (Math.PI * 2);
    animTo = rotationFor(current, res.index);
    while (animTo < animFrom + Math.PI * 2 * 3) animTo += Math.PI * 2;
    animStart = performance.now();
    animDur = 3600;
    resultEl.textContent = '抽取中…';
    remainEl.textContent = '';
    await persistGoto();
    renderTab();
  }

  async function onSpinEnd() {
    const item = lastResult?.item;
    if (!item) return;
    resultEl.textContent = item.text;
    remainEl.textContent = current.unique
      ? `剩余 ${lastResult.remaining} / ${current.items.filter((i) => !i.disabled).length} 项`
      : `共 ${current.items.filter((i) => !i.disabled).length} 项`;

    current.counts = current.counts || {};
    current.counts[item.id] = (current.counts[item.id] || 0) + 1;
    current.lastResult = item.text;
    await appendLog({ wheel: current.name, wheelId: current.id, text: item.text, itemId: item.id });
    await runAutoScript('after', item);
    await persistGoto();
    speak(item);
    drawWheel();

    // 跳转规则：抽中某选项后跳到另一个转盘
    const rule = (current.rules || []).find(
      (r) => r.enabled !== false && r.itemText && r.itemText === item.text,
    );
    if (rule && rule.targetId) {
      const target = lib.find((w) => w.id === rule.targetId);
      if (target) {
        setTimeout(() => {
          current = target;
          rotation = 0;
          resultEl.textContent = `跳转到「${target.name}」`;
          renderTab();
          drawWheel();
          if (rule.autoSpin) doSpin();
        }, (Number(rule.delay) || 2) * 1000);
      }
    }

    if (current.unique && lastResult.exhausted && current.resetSec > 0) {
      setTimeout(async () => {
        current.unable = [];
        await persistGoto();
        renderTab();
        drawWheel();
      }, current.resetSec * 1000);
    }
  }

  /**
   * 念出结果。
   *
   * 【为什么走模板而不是直接念 item.text】用户要的念法差别很大：
   *   有人只听结果，有人要听"第几次抽"，有人要报时间。
   *   模板 `抽到{result}` 是默认值，也是原 APK 的默认值。
   *
   * 【为什么 count 要现算】wheel.counts 在 onSpinEnd 里刚刚 +1，
   *   这里读到的就是"这一抽之后"的次数，和界面上显示的一致。
   */
  async function speak(item) {
    if (!cfg.voice) return;
    const counts = current.counts || {};
    const total = current.items.filter((i) => !i.disabled).length;
    const drawn = current.unique ? (current.unable || []).length : 0;
    const text = renderTemplate(cfg.voiceTemplate, item, current, {
      count: item ? (counts[item.id] || 0) : 0,
      last: current.unique ? Math.max(0, total - drawn) : total,
    });
    if (!text) return;
    // 可选的前缀短语：预生成的固定音频，音色比现场拼接自然
    if (cfg.voicePrefix) {
      await speakSmart('本次结果', { voice: cfg.voiceId, rate: cfg.voiceRate });
    }
    speakSmart(text, { voice: cfg.voiceId, rate: cfg.voiceRate });
  }

  /* ---------------- 自动指令 ---------------- */

  /**
   * 跑一次自动指令。
   *
   * 【为什么指令要在沙箱里跑，而不是 eval】指令是用户写的 Python，
   *   里面有 `import random` / `time` / 循环。用同一个解释器跑，
   *   既能限制步数（防死循环），又能让"指令能做什么"和"模组能做什么"
   *   用同一套语义——用户不用学两套。
   *
   * 【为什么给的是一个受限对象而不是整个 wheel】指令应该能读转盘、
   *   读结果、改设置，但不该能改选项本身（那会让"抽奖"变成"改奖"）。
   *   所以只暴露只读视图 + 少量安全的可写字段。
   */
  async function runAutoScript(phase, item) {
    const script = await activeScript();
    if (!script) return;

    const view = {
      phase,                       // 'before' | 'after'
      result: item ? item.text : '',
      wheel: current.name,
      count: current.items.length,
      remaining: lastResult ? lastResult.remaining : current.items.length,
      resetSec: current.resetSec,
    };

    // 只读镜像 + 写回白名单
    const WRITABLE = new Set(['resetSec']);
    const sets = [];
    const interp = new Interpreter({
      modules: new Map([['wheel', view]]),
      onSet: (p, v) => {
        const key = p.replace(/^\./, '');
        if (WRITABLE.has(key)) sets.push([key, v]);
      },
      onCall: () => null,
      onLog: (t) => console.log('[wheel script]', t),
      maxSteps: 200000,
    });

    try {
      const gen = interp.run(parse(script.code));
      let guard = 0;
      let r = gen.next();
      while (!r.done) {
        if (guard++ > 400000) throw new Error('指令执行步数超限');
        r = gen.next();
      }
      for (const [k, v] of sets) {
        if (k === 'resetSec') current.resetSec = Math.max(0, Number(v) || 0);
      }
      if (sets.length) await persistLib();
    } catch (e) {
      // 指令出错不能让抽奖崩掉：记一条提示，继续走
      toast('自动指令出错：' + e.message, 2600);
    }
  }

  /* ---------------- 持久化 ---------------- */

  /** 转盘本体变了 */
  async function persistLib() {
    current.updatedAt = Date.now();
    lib = lib.map((w) => (w.id === current.id ? current : w));
    await saveLibrary(lib);
  }

  /** 抽取状态变了（避重 / 记录 / 跳转） */
  async function persistGoto() {
    lib = lib.map((w) => (w.id === current.id ? current : w));
    await saveGotoData({
      rules: lib.flatMap((w) => (w.rules || []).map((r) => ({ ...r, wheelId: w.id }))),
      drawn: Object.fromEntries(lib.map((w) => [w.id, w.unable || []])),
      counts: Object.fromEntries(lib.map((w) => [w.id, w.counts || {}])),
      lastResult: Object.fromEntries(lib.map((w) => [w.id, w.lastResult || ''])),
    });
  }

  // ---------- 各标签页 ----------
  function renderTab() {
    tabHost.innerHTML = '';
    if (tab === 'items') tabHost.appendChild(renderItems());
    else if (tab === 'wheels') tabHost.appendChild(renderWheels());
    else if (tab === 'log') tabHost.appendChild(renderLog());
    else tabHost.appendChild(renderSettings());
  }

  function renderItems() {
    const box = h('div', {});

    box.appendChild(
      h('div', { class: 'card' }, [
        h('div', { class: 'row' }, [
          h('div', {}, [
            h('div', { class: 'label' }, '避重（抽过不再出现）'),
            h('div', { class: 'hint' }, `抽完自动复原：${current.resetSec} 秒`),
          ]),
          h('div', {
            class: `switch${current.unique ? ' on' : ''}`,
            onclick: async () => {
              current.unique = !current.unique;
              current.unable = [];
              await persistLib();
              await persistGoto();
              renderTab();
              drawWheel();
            },
          }),
        ]),
        h('div', { class: 'btn-row' }, [
          h('button', {
            class: 'btn',
            onclick: async () => {
              current.unable = [];
              await persistGoto();
              renderTab();
              drawWheel();
              toast('已复原全部选项');
            },
          }, '复原全部'),
          h('button', {
            class: 'btn primary',
            onclick: async () => {
              const name = prompt('选项内容', '');
              if (!name) return;
              current.items.push({ id: uid(), text: name, value: '', weight: 100, group: 0, disabled: false });
              await persistLib();
              renderTab();
              drawWheel();
            },
          }, '+ 添加选项'),
        ]),
      ]),
    );

    const list = h('div', {});
    if (!current.items.length) {
      list.appendChild(h('div', { class: 'empty' }, '还没有选项，点上面的「添加选项」'));
    }
    current.items.forEach((it, i) => {
      const used = current.unique && (current.unable || []).includes(it.id);
      const n = (current.counts || {})[it.id] || 0;
      list.appendChild(
        h('div', {
          class: 'record-row',
          style: { opacity: it.disabled ? '0.4' : used ? '0.55' : '1' },
        }, [
          h('div', { class: 'rr-emoji' }, used ? '✓' : String(i + 1)),
          h('div', { class: 'rr-main' }, [
            h('div', { class: 'rr-name' }, it.text),
            h('div', { class: 'rr-sub' },
              `权重 ${it.weight}${it.group ? ` · 组 ${it.group}` : ''}${it.value ? ` · 数值 ${it.value}` : ''}${n ? ` · 中过 ${n} 次` : ''}${it.disabled ? ' · 已禁用' : ''}`),
          ]),
          h('button', {
            class: 'hud-btn',
            // 数值只影响朗读模板里的 {value}，不影响抽奖概率，
            // 所以放在选项行里和"权重"并排，而不是塞进转盘设置
            onclick: async () => {
              const v = prompt(
                '数值（朗读模板里的 {value} 用；留空则念选项文本）',
                it.value || '',
              );
              if (v === null) return;
              it.value = v.trim();
              await persistLib();
              renderTab();
            },
          }, '数值'),
          h('button', {
            class: 'hud-btn',
            onclick: async () => {
              const w = prompt('权重（越大越容易抽中）', String(it.weight));
              if (w === null) return;
              it.weight = Math.max(0, Number(w) || 0);
              await persistLib();
              renderTab();
              drawWheel();
            },
          }, '权重'),
          h('button', {
            class: 'hud-btn',
            onclick: async () => {
              it.disabled = !it.disabled;
              await persistLib();
              renderTab();
              drawWheel();
            },
          }, it.disabled ? '启用' : '禁用'),
          h('button', {
            class: 'hud-btn danger',
            onclick: async () => {
              current.items = current.items.filter((x) => x.id !== it.id);
              await persistLib();
              renderTab();
              drawWheel();
            },
          }, '删'),
        ]),
      );
    });
    box.appendChild(list);
    return box;
  }

  function renderWheels() {
    const box = h('div', {});

    box.appendChild(
      h('div', { class: 'btn-row', style: { marginBottom: '10px' } }, [
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            const name = prompt('转盘名称', '新转盘');
            if (!name) return;
            const w = createWheel({ name });
            lib.push(w);
            current = w;
            await persistLib();
            await persistGoto();
            renderTab();
            drawWheel();
          },
        }, '+ 新建转盘'),
        h('button', {
          class: 'btn',
          onclick: async () => {
            const name = prompt('重命名', current.name);
            if (!name) return;
            current.name = name;
            await persistLib();
            renderTab();
          },
        }, '重命名'),
      ]),
    );

    // ---- 导入 / 导出 ----
    box.appendChild(
      h('div', { class: 'card' }, [
        h('div', { class: 'label' }, '导入 / 导出'),
        h('div', { class: 'hint', style: { marginBottom: '10px' } },
          '完整版 ZIP 2.0 与原版云海转盘 APK 互通，导出后可以直接在原 APK 里导入。'),
        h('div', { class: 'btn-row' }, EXPORT_FORMATS.map((f) =>
          h('button', {
            class: 'btn',
            onclick: () => doExport(f.value),
          }, f.label),
        )),
        h('div', { class: 'btn-row', style: { marginTop: '8px' } }, [
          h('button', { class: 'btn', onclick: () => doImport() }, '导入备份文件'),
        ]),
      ]),
    );

    // ---- 跳转规则 ----
    // 【为什么放在"转盘"页而不是单独一页】跳转是转盘之间的连线，
    //   看到转盘列表的同时能配置连线，因果关系才清楚。
    const ruleCard = h('div', { class: 'card' }, [
      h('div', { class: 'label' }, '跳转规则'),
      h('div', { class: 'hint', style: { marginBottom: '10px' } },
        `抽中某个选项后，自动切换到另一个转盘。共 ${(current.rules || []).length} 条。`),
    ]);

    for (const r of current.rules || []) {
      const target = lib.find((w) => w.id === r.targetId);
      ruleCard.appendChild(
        h('div', { class: 'rule-row' }, [
          h('div', { class: 'rr-main' }, [
            h('div', { class: 'rr-name' }, `「${r.itemText || '?'}」→ ${target ? target.name : '（已删除）'}`),
            h('div', { class: 'rr-sub' },
              `延迟 ${r.delay || 2}s${r.autoSpin ? ' · 自动抽' : ''}${r.enabled === false ? ' · 已停用' : ''}`),
          ]),
          h('button', {
            class: 'hud-btn',
            onclick: async () => {
              r.enabled = r.enabled === false;
              await persistGoto();
              renderTab();
            },
          }, r.enabled === false ? '启用' : '停用'),
          h('button', {
            class: 'hud-btn danger',
            onclick: async () => {
              current.rules = (current.rules || []).filter((x) => x !== r);
              await persistGoto();
              renderTab();
            },
          }, '删'),
        ]),
      );
    }

    ruleCard.appendChild(
      h('button', {
        class: 'btn',
        style: { marginTop: '8px' },
        onclick: async () => {
          if (!current.items.length) return toast('先给这个转盘加几个选项');
          const text = prompt(`抽中哪个选项时跳转？\n可选：${current.items.map((i) => i.text).join(' / ')}`, current.items[0].text);
          if (!text) return;
          const others = lib.filter((w) => w.id !== current.id);
          if (!others.length) return toast('至少要有两个转盘才能跳转');
          const name = prompt(`跳到哪个转盘？\n可选：${others.map((w) => w.name).join(' / ')}`, others[0].name);
          if (!name) return;
          const target = others.find((w) => w.name === name);
          if (!target) return toast('没有这个转盘');
          const delay = Number(prompt('延迟几秒后跳转', '2')) || 2;
          current.rules = current.rules || [];
          current.rules.push({
            itemText: text, targetId: target.id, targetTitle: target.name,
            delay, autoSpin: false, enabled: true,
          });
          await persistGoto();
          renderTab();
          toast('已添加跳转');
        },
      }, '+ 添加跳转'),
    );
    box.appendChild(ruleCard);

    for (const w of lib) {
      box.appendChild(
        h('div', {
          class: 'record-row',
          style: w.id === current.id ? { borderColor: 'var(--accent)' } : {},
        }, [
          h('div', { class: 'rr-main' }, [
            h('div', { class: 'rr-name' }, w.name),
            h('div', { class: 'rr-sub' }, `${w.items.length} 项 · ${w.category}${w.rules?.length ? ` · ${w.rules.length} 条跳转` : ''}`),
          ]),
          h('button', {
            class: 'hud-btn',
            onclick: () => {
              current = w;
              rotation = 0;
              resultEl.textContent = '点「开始抽取」';
              renderTab();
              drawWheel();
            },
          }, '选择'),
          h('button', {
            class: 'hud-btn danger',
            onclick: async () => {
              if (lib.length <= 1) return toast('至少保留一个转盘');
              lib = lib.filter((x) => x.id !== w.id);
              if (current === w) current = lib[0];
              await persistLib();
              await persistGoto();
              renderTab();
              drawWheel();
            },
          }, '删'),
        ]),
      );
    }
    return box;
  }

  async function doExport(format) {
    const { text, ext } = serialize(lib, format, {
      autoGoto: cfg.autoGoto,
      avoidReset: cfg.autoResetSec,
      defaultAvoid: cfg.defaultAvoid,
      voiceTemplate: cfg.voiceTemplate,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    try {
      const res = await exportText(`云海转盘-${stamp}.${ext}`, text, 'application/json');
      if (res.ok) toast(`已导出 ${res.name}`);
      else if (!res.cancelled) toast('导出失败：' + (res.error || '未知'));
    } catch (e) {
      toast('导出失败：' + e.message);
    }
  }

  async function doImport() {
    const res = await importText(['.json', '.pwh', '.txt']);
    if (res.cancelled) return;
    if (!res.ok) return toast('导入失败：' + res.error);
    try {
      const parsed = deserialize(res.data, createWheel, uid);
      // 备份里带了朗读模板就一并恢复。只在备份里有值时才覆盖，
      // 否则导入一个不含设置的旧包会把用户已经调好的模板冲掉。
      if (parsed.settings && parsed.settings.voiceTemplate) {
        cfg.voiceTemplate = parsed.settings.voiceTemplate;
        await saveConfig(cfg);
      }
      const before = lib.length;
      const existing = new Set(lib.map((w) => w.name));
      let skipped = 0;
      for (const w of parsed.wheels) {
        if (existing.has(w.name)) { skipped++; continue; }
        lib.push(w);
      }
      if (lib.length === before) return toast('全部同名，没有导入');
      current = lib[before];
      await persistLib();
      await persistGoto();
      renderTab();
      drawWheel();
      toast(`导入 ${lib.length - before} 个转盘${skipped ? `，跳过 ${skipped} 个同名` : ''}`);
    } catch (e) {
      toast('解析失败：' + e.message);
    }
  }

  function renderLog() {
    const box = h('div', {});
    box.appendChild(
      h('div', { class: 'btn-row', style: { marginBottom: '10px' } }, [
        h('button', {
          class: 'btn danger',
          onclick: async () => {
            await clearLog();
            renderTab();
            toast('记录已清空');
          },
        }, '清空记录'),
      ]),
    );
    loadLog().then((log) => {
      if (!log.length) {
        box.appendChild(h('div', { class: 'empty' }, '还没有抽取记录'));
        return;
      }
      for (const e of log.slice(0, 100)) {
        box.appendChild(
          h('div', { class: 'record-row' }, [
            h('div', { class: 'rr-main' }, [
              h('div', { class: 'rr-name' }, e.text),
              h('div', { class: 'rr-sub' }, `${e.wheel} · ${formatDate(e.at)}`),
            ]),
          ]),
        );
      }
    });
    return box;
  }

  function renderSettings() {
    const box = h('div', {});

    // ---- 朗读 ----
    box.appendChild(
      h('div', { class: 'card' }, [
        h('div', { class: 'row' }, [
          h('div', {}, [
            h('div', { class: 'label' }, '朗读结果'),
            h('div', { class: 'hint' }, '用内置音色念出抽中的选项'),
          ]),
          h('div', {
            class: `switch${cfg.voice ? ' on' : ''}`,
            onclick: async () => {
              cfg.voice = !cfg.voice;
              await saveConfig(cfg);

              renderTab();
            },
          }),
        ]),
        cfg.voice ? h('div', { class: 'voice-list' }, VOICES.map((v) =>
          h('button', {
            class: `voice-item${(cfg.voiceId || 'langdu') === v.id ? ' active' : ''}`,
            onclick: async () => {
              cfg.voiceId = v.id;
              await saveConfig(cfg);
              renderTab();
              speakSmart('本次结果', { voice: v.id });
            },
          }, [
            h('div', { class: 'vi-name' }, v.name),
            h('div', { class: 'vi-desc' }, v.desc),
            h('div', { class: 'vi-src' }, v.source),
          ]),
        )) : null,
        cfg.voice ? h('div', { class: 'hint', style: { marginTop: '10px', lineHeight: '1.7' } },
          '内置音色是预生成的标准女声，简繁英都能读。' +
          '短语表里没有的文本（比如你自己输入的选项）会整句退回系统语音。') : null,
      ]),
    );

    // ---- 朗读模板 ----
    // 只在开了朗读时显示：没开朗读的用户不需要看见一个用不上的输入框
    if (cfg.voice) {
      const input = h('input', {
        class: 'tpl-input',
        type: 'text',
        maxlength: '120',
        value: cfg.voiceTemplate || '抽到{result}',
        placeholder: '抽到{result}',
      });
      const previewEl = h('div', { class: 'tpl-preview' },
        '预览：' + previewTemplate(cfg.voiceTemplate));

      // 每次输入都存盘。模板只有几十个字符，写云存档的成本可以忽略，
      // 而"改完忘了点保存"是最常见的挫败点。
      const onChange = async () => {
        cfg.voiceTemplate = input.value;
        previewEl.textContent = '预览：' + previewTemplate(input.value);
        await saveConfig(cfg);
      };
      input.addEventListener('input', onChange);

      // 点占位符按钮 = 在光标处插入。比让用户手打花括号靠谱得多。
      const chips = h('div', { class: 'tpl-vars' }, TEMPLATE_VARS.map((v) =>
        h('button', {
          class: 'tpl-chip',
          title: v.desc,
          onclick: async () => {
            const pos = input.selectionStart === null ? input.value.length : input.selectionStart;
            const token = '{' + v.key + '}';
            input.value = input.value.slice(0, pos) + token + input.value.slice(pos);
            input.focus();
            input.setSelectionRange(pos + token.length, pos + token.length);
            await onChange();
          },
        }, v.label),
      ));

      box.appendChild(
        h('div', { class: 'card' }, [
          h('div', { class: 'label' }, '朗读模板'),
          h('div', { class: 'hint' },
            '决定抽完之后念什么。点下面的按钮插入占位符，也可以当普通文字用。'),
          input,
          chips,
          previewEl,
          h('div', { class: 'hint', style: { marginTop: '8px', lineHeight: '1.7' } },
            TEMPLATE_VARS.map((v) => `${v.label} {${v.key}}：${v.desc}`).join('；') + '。'),
        ]),
      );
    }

    // ---- 自动指令 ----
    const scriptNames = Object.keys(scripts);
    box.appendChild(
      h('div', { class: 'card' }, [
        h('div', { class: 'label' }, '自动指令'),
        h('div', { class: 'hint' },
          `抽奖前后执行的小段脚本。小程序侧限 ${SCRIPT_LIMIT} 份（原 APK 可以多份），` +
          '因为同时存在多份时"到底跑哪一份"很难在界面上说清楚。'),
        h('div', { class: 'btn-row', style: { marginTop: '10px' } }, [
          h('button', {
            class: 'btn',
            onclick: () => editScript(scriptNames[0] || ''),
          }, scriptNames.length ? `编辑「${scriptNames[0]}」` : '+ 新建指令'),
          scriptNames.length ? h('button', {
            class: 'btn danger',
            onclick: async () => {
              scripts = {};
              await saveScripts(scripts);
              renderTab();
              toast('指令已删除');
            },
          }, '删除') : null,
        ]),
      ]),
    );

    // ---- 其它设置 ----
    box.appendChild(
      h('div', { class: 'card' }, [
        h('div', { class: 'row' }, [
          h('div', {}, [
            h('div', { class: 'label' }, '抽完自动复原'),
            h('div', { class: 'hint' }, '避重模式下全部抽完后的等待秒数'),
          ]),
          (() => {
            const el = h('input', {
              type: 'range', min: '0', max: '10', step: '1', value: String(current.resetSec),
              oninput: async (e) => {
                current.resetSec = Number(e.target.value);
                // MD3 波浪分段跟随拖动
                syncRangeFill(e.target);
                await persistLib();
              },
            });
            queueMicrotask(() => syncRangeFill(el));
            return el;
          })(),
        ]),
      ]),
    );

    // ---- 用量 ----
    const usageBox = h('div', { class: 'card' }, [h('div', { class: 'label' }, '云存档用量')]);
    wheelUsage().then((u) => {
      for (const [k, v] of Object.entries(u)) {
        usageBox.appendChild(
          h('div', { class: 'usage-row' }, [
            h('span', {}, `${v.label}（${v.values} 个 value）`),
            h('span', { class: 'usage-num' }, `${fmtKb(v.bytes)} / ${fmtKb(v.capacity)}`),
          ]),
        );
      }
      // 【为什么不再写死数字】用户给转盘数据 +2、自动指令 +1 之后，
      //   这句话如果还写"合计 14 个"就是错的。改成按实际数据算，
      //   以后扩容也不用回来改这里。
      const vcount = (k) => {
        const d = u[k];
        return d && d.values ? d.values : 0;
      };
      const totalV = vcount('lib') + vcount('goto') + vcount('script');
      usageBox.appendChild(h('div', { class: 'hint', style: { marginTop: '8px' } },
        `受工坊云存档限制：转盘数据 ${vcount('lib')} 个 value、跳转数据 ${vcount('goto')} 个、`
        + `自动指令 ${vcount('script')} 个，合计 ${totalV} 个 value。`));
    });
    box.appendChild(usageBox);

    box.appendChild(
      h('div', { class: 'hint', style: { marginTop: '12px', lineHeight: '1.7' } },
        '本工具完全离线运行，不上传任何数据。转盘与记录保存在小黑盒账号存储里，' +
        '换设备登录同一账号即可同步。'),
    );
    return box;
  }

  async function editScript(name) {
    const cur = name ? scripts[name] || '' : '';
    const code = prompt(
      '自动指令（Python 子集）。可用对象：wheel（当前转盘）、result（抽中结果）、random、time',
      cur,
    );
    if (code === null) return;
    const next = {};
    if (code.trim()) next[name || '指令 1'] = code;
    const res = await saveScripts(next);
    if (!res.ok) {
      toast(res.error === 'OVER_BUDGET' ? '指令太长，超出配额' : '保存失败：' + res.error);
      return;
    }
    scripts = next;
    renderTab();
    toast('指令已保存');
  }

  function exit() {
    destroyed = true;
    cancelAnimationFrame(raf);
    screen.remove();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', sizeCanvas);
    onExit?.();
  }

  const onKey = (e) => {
    if (e.key === ' ' && !e.repeat) {
      e.preventDefault();
      doSpin();
    }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', sizeCanvas);

  sizeCanvas();
  renderTab();
  raf = requestAnimationFrame(loop);

  return { destroy: exit };
}

function fmtKb(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  return (n / 1024).toFixed(1) + ' KB';
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 + amt));
  const g = Math.round(((n >> 8) & 255) * (1 + amt));
  const b = Math.round((n & 255) * (1 + amt));
  const c = (v) => Math.max(0, Math.min(255, v));
  return '#' + ((c(r) << 16) | (c(g) << 8) | c(b)).toString(16).padStart(6, '0');
}
