/**
 * 首页：云海转盘当主体，游戏收进「更多玩法」区。
 *
 * 【为什么转盘是主体】小程序叫「迷你游戏与实用工具」，
 *   但审核最怕「内置游戏」被当成独立游戏产品去要版号。
 *   把转盘（纯本地抽签工具，没有任何游戏要素）放首屏，
 *   定位就从「这个 app 是游戏」变成「工具附带的小玩法」。
 *
 * 【为什么游戏不删只挪走】用户要的游戏一个都不能少，
 *   只是从首屏主体降为「更多玩法」，点进去全都还在。
 *
 * 【为什么转盘不直接复用 openWheelScreen】那个是全屏浮层，
 *   会盖住外壳顶栏和标签栏。首页要的是「转盘就在页面里」，
 *   常驻设置按钮和底部标签栏都还得在。
 *   所以这里内嵌「画布 + 开始抽取 + 结果」，
 *   完整编辑能力仍走 openWheelScreen（点「编辑转盘」）。
 */
import { h } from '../core/util.js';
import { toast } from './toast.js';
import { spin, sectors, rotationFor, renderTemplate } from '../tools/wheel/engine.js';
import { loadLibrary, loadGotoData, mergeGoto, appendLog, loadConfig } from '../tools/wheel/store.js';
import { speakSmart } from '../tools/wheel/voice.js';
import { openWheelScreen } from '../tools/wheel/screen.js';


const PALETTE = [
  '#4ad991', '#6ea8ff', '#f0b429', '#ff7a59', '#b48cff',
  '#4ad9d9', '#ff6b9d', '#8fd14f', '#ffb648', '#7b8cff',
];

export function renderHomeTab(state, rerender) {
  const box = h('div', {});

  // ---------- 转盘主体 ----------
  const canvas = h('canvas', { class: 'home-wheel' });
  const ctx = canvas.getContext('2d');
  const resultEl = h('div', { class: 'home-wheel-result' }, '点「开始抽取」');
  const wheelName = h('div', { class: 'home-wheel-name' }, '');

  let lib = [];
  let current = null;
  let cfg = null;
  let rotation = 0;
  let spinning = false;
  let raf = 0;
  let dead = false;

  const stage = h('div', { class: 'home-wheel-stage' }, [
    h('div', { class: 'home-wheel-pointer' }),
    canvas,
  ]);

  const spinBtn = h('button', {
    class: 'big-play home-spin',
    onclick: () => doSpin(),
  }, '开始抽取');

  const editBtn = h('button', {
    class: 'home-wheel-edit',
    onclick: () => {
      // 完整编辑（选项/转盘/记录/设置）还是走原来的全屏页
      openWheelScreen({ onExit: () => rerender() });
    },
  }, '编辑转盘 ›');

  box.appendChild(h('div', { class: 'home-hero' }, [
    h('div', { class: 'home-hero-head' }, [
      wheelName,
      editBtn,
    ]),
    stage,
    resultEl,
    spinBtn,
  ]));

  /* ---------------- 尺寸 ---------------- */
  let SIZE = 280;
  let DPR = 1;

  function sizeCanvas() {
    // 用容器宽度而不是 window.innerWidth：外面还有 padding
    // 上限压到 260：首屏要能同时露出「更多玩法」的标题，
    // 否则第一眼只看到转盘，用户会以为这里没有游戏
    const w = stage.clientWidth || 300;
    SIZE = Math.max(190, Math.min(260, Math.round(w - 8)));
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.style.width = SIZE + 'px';
    canvas.style.height = SIZE + 'px';
    canvas.width = Math.round(SIZE * DPR);
    canvas.height = Math.round(SIZE * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawWheel();
  }

  /* ---------------- 绘制 ---------------- */
  function drawWheel() {
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const R = SIZE / 2 - 6;
    ctx.clearRect(0, 0, SIZE, SIZE);

    ctx.beginPath();
    ctx.arc(cx, cy, R + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();

    const secs = current ? sectors(current) : [];
    if (!secs.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(154,164,178,0.9)';
      ctx.font = FONT_EMPTY;
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
      ctx.font = '700 ' + fs + 'px "WXSJT", "PingFang SC", sans-serif';
      ctx.fillStyle = used ? 'rgba(255,255,255,0.32)' : 'rgba(10,14,12,0.9)';
      ctx.fillText(text, 0, 0);
      ctx.restore();
    });

    // 中心轴
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = '#12161b';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#eef1f5';
    ctx.font = '700 ' + Math.max(11, Math.round(SIZE * 0.05)) + 'px "WXSJT", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('转', cx, cy);
  }

  /* ---------------- 抽取 ---------------- */
  function doSpin() {
    if (spinning || !current) {
      if (!current) toast('还没有转盘数据');
      return;
    }
    const secs = sectors(current);
    if (!secs.length) {
      toast('先点「编辑转盘」加几个选项');
      return;
    }
    spinning = true;
    spinBtn.disabled = true;
    resultEl.textContent = '抽取中…';

    const picked = spin(current);
    if (!picked) {
      spinning = false;
      spinBtn.disabled = false;
      return;
    }

    const from = rotation;
    const to = rotationFor(current, picked.index, from);
    const start = performance.now();
    const dur = 2600;

    function anim(now) {
      if (dead) return;
      const t = Math.min(1, (now - start) / dur);
      // 先快后慢：和全屏页同一套缓动，手感一致
      const e = 1 - Math.pow(1 - t, 3);
      rotation = from + (to - from) * e;
      drawWheel();
      if (t < 1) {
        raf = requestAnimationFrame(anim);
      } else {
        rotation = to;
        drawWheel();
        onSpinEnd(picked);
      }
    }
    raf = requestAnimationFrame(anim);
  }

  function onSpinEnd(picked) {
    spinning = false;
    spinBtn.disabled = false;
    const item = picked.item;
    resultEl.textContent = item.text;
    resultEl.classList.remove('pop');
    void resultEl.offsetWidth;
    resultEl.classList.add('pop');

    // 记录 + 语音：和全屏页保持一致
    appendLog({ text: item.text, at: Date.now(), wheel: current.name, wheelId: current.id, itemId: item.id }).catch(() => {});
    if (cfg && cfg.voice) {
      try {
        const line = renderTemplate(cfg.voiceTemplate || '抽到 {result}', item, current, {});
        speakSmart(line, { voice: cfg.voiceId || 'langdu' });
      } catch (e) { /* 语音失败不该影响抽奖 */ }
    }
  }

  /* ---------------- 载入 ---------------- */
  (async () => {
    const [rawLib, gotoData, c] = await Promise.all([
      loadLibrary(), loadGotoData(), loadConfig(),
    ]);
    cfg = c;
    lib = mergeGoto(rawLib, gotoData);
    current = lib[0] || null;
    if (dead) return;
    // 注意字段名是 name，不是 title（engine.js 的 createWheel 用的是 name）
    wheelName.textContent = current ? current.name : '还没有转盘';
    sizeCanvas();
  })();

  // 【为什么首页不再列游戏】首页的定位是「转盘」，是这个小程序的第一屏
  //   主功能。游戏和工具统一收进「工具」页，职责才清楚：
  //     首页 = 转盘，工具 = 实用工具 + 更多玩法，我的 = 记录。
  //   之前首页也铺了一份游戏网格，同一批入口出现两次，
  //   而且首页那套点击逻辑没跟上后续新增的关卡制游戏（流水入杯）
  //   和剧情游戏（诗山寻踪），点进去会走错分支。入口收归一处就没有这个问题。

  // 首帧之后量一次真实宽度，避免拿到 0
  requestAnimationFrame(() => { if (!dead) sizeCanvas(); });
  window.addEventListener('resize', sizeCanvas);

  return {
    el: box,
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', sizeCanvas);
    },
  };
}

/** 空转盘提示文字用的字体，单独提出来避免和主字体混在一起 */
const FONT_EMPTY = '13px "TWKai", sans-serif';

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 + amt));
  const g = Math.round(((n >> 8) & 255) * (1 + amt));
  const b = Math.round((n & 255) * (1 + amt));
  const c = (v) => Math.max(0, Math.min(255, v));
  return '#' + ((c(r) << 16) | (c(g) << 8) | c(b)).toString(16).padStart(6, '0');
}
