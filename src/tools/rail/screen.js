/**
 * 火车票票根生成器 —— 小程序版。
 *
 * 【核心约束：相对位置一像素都不能动】
 *   票面坐标不是设计出来的，是原作者对着实体蓝票一行一行比对量出来的。
 *   所以这里绝不重新排版：render.js 是从 pygame 版逐行移植的渲染器，
 *   画布永远按 1890×1190（fbl=3.5 设计分辨率）绘制，显示大小只靠 CSS 缩放。
 *   一旦为了「适配屏幕」去改画布尺寸或坐标，取整误差就会让整张票歪掉。
 *
 * 【为什么把字体子集塞进包里】CSP 是 default-src 'none'，
 *   SDK 构建时注入的 CSP 没有任何业务域名白名单钩子，
 *   在线字体、CDN 全都被拦。字体必须打进包内，用相对路径加载。
 *   原版字体 33MB，按票面实际用到的 943 字取子集后只有 1.1MB。
 */
import { h } from '../../core/util.js';
import { toast } from '../../ui/toast.js';
import { openGlobalSettings } from '../../ui/global.js';
import { renderTicket, DESIGN_W, DESIGN_H } from './render.js';
import { FIELDS, DEFAULTS, parseDataTxt, buildDataTxt, loadLocal, saveLocal } from './data.js';
import { exportText, importText } from '../../sdk/files.js';
import { saveCanvasPng } from './io.js';
import './rail.css';

// 【必须用 import.meta.glob】Vite 只对 glob 和静态 import 做资源收集，
//   写成 new URL('./fonts/' + name, import.meta.url) 这种拼字符串的形式，
//   构建时不会被识别，产物里根本不会有字体文件，线上会 404。
const FONT_URLS = import.meta.glob('./fonts/*.ttf', { eager: true, query: '?url', import: 'default' });
const PIC_URLS = import.meta.glob('./picts/*.png', { eager: true, query: '?url', import: 'default' });

const FONT_NAMES = [
  ['simsun', 'simsun.ttf'],
  ['simhei', 'simhei.ttf'],
  ['simw', 'simw.ttf'],
  ['simhei-rednum', 'simhei-rednum.ttf'],
];

function fontUrl(file) {
  const hit = FONT_URLS['./fonts/' + file];
  if (!hit) throw new Error('缺少字体 ' + file);
  return hit;
}
function picUrl(file) {
  const hit = PIC_URLS['./picts/' + file];
  if (!hit) throw new Error('缺少底图 ' + file);
  return hit;
}

const BASE_FOR_FBL = (fbl) => (fbl === 1 ? 'base' : fbl === 2.4 ? 'basea' : 'baseb');

const GROUPS = [
  { name: '票面', keys: ['red_code', 'enter_gate'] },
  { name: '行程', keys: ['sta_chn', 'sta_eng', 'train', 'end_chn', 'end_eng'] },
  { name: '时间与座位', keys: ['date', 'seat', 'money', 'seatclass', 'midcode'] },
  { name: '提示与乘客', keys: ['tips1', 'tips2', 'idname'] },
  { name: '底部框', keys: ['und1', 'und2', 'undl'] },
];

export async function openRailScreen({ onExit }) {
  const state = Object.assign({}, DEFAULTS, loadLocal() || {});

  const header = h('div', { class: 'tool-header' }, [
    h('button', { class: 'hud-back', onclick: () => exit() }, '‹'),
    h('h1', {}, '火车票根'),
    h('button', { class: 'icon-btn', title: '设置', onclick: () => openGlobalSettings() }, '⚙'),
  ]);

  const body = h('div', { class: 'page rail-body' });
  const screen = h('div', {
    style: {
      position: 'fixed', inset: '0', background: 'var(--bg)', zIndex: '60',
      display: 'flex', flexDirection: 'column',
    },
  }, [header, body]);
  document.body.appendChild(screen);

  function exit() {
    screen.remove();
    if (onExit) onExit();
  }

  /* ---------------- 画布 ---------------- */

  // 【画布尺寸写死】见文件头注释：改尺寸 = 改坐标。
  const canvas = h('canvas', { class: 'rail-canvas' });
  canvas.width = DESIGN_W;
  canvas.height = DESIGN_H;
  const ctx = canvas.getContext('2d');

  const imgCache = new Map();
  function loadImg(src) {
    if (imgCache.has(src)) return imgCache.get(src);
    const p = new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('底图加载失败'));
      im.src = src;
    });
    imgCache.set(src, p);
    return p;
  }

  let fontsReady = false;
  async function loadFonts() {
    await Promise.all(FONT_NAMES.map(async ([fam, file]) => {
      const ff = new FontFace(fam, 'url(' + fontUrl(file) + ')');
      await ff.load();
      document.fonts.add(ff);
    }));
    await document.fonts.ready;
    fontsReady = true;
  }

  let token = 0;
  async function redraw() {
    const my = ++token;
    if (!fontsReady) return;
    const fbl = Number(state.fbl) || 3.5;
    const n = Math.min(3, Math.max(1, Number(state.base_pic) || 1));
    let baseImg = null, qrImg = null;
    try {
      const prefix = BASE_FOR_FBL(fbl);
      baseImg = await loadImg(picUrl(prefix + n + '.png'));
      if (Number(state.qrcode)) qrImg = await loadImg(picUrl('QRcode.png'));
    } catch (e) {
      toast('底图加载失败');
    }
    if (my !== token) return;
    renderTicket(ctx, state, baseImg, qrImg);
  }

  /* ---------------- 预览区 ---------------- */

  const stage = h('div', { class: 'rail-stage' }, [
    h('div', { class: 'rail-frame' }, [canvas]),
  ]);
  body.appendChild(stage);

  /* ---------------- 表单 ---------------- */

  const formBox = h('div', { class: 'rail-form' });
  body.appendChild(formBox);

  function buildForm() {
    formBox.innerHTML = '';
    const byKey = new Map(FIELDS.map((f) => [f.key, f]));

    for (const g of GROUPS) {
      const det = h('details', { class: 'rail-grp', open: '' }, [
        h('summary', {}, g.name),
      ]);
      for (const k of g.keys) {
        const f = byKey.get(k);
        if (!f) continue;
        const input = h('input', {
          type: 'text',
          value: state[k] == null ? '' : String(state[k]),
        });
        input.addEventListener('input', () => {
          state[k] = input.value;
          saveLocal(state);
          redraw();
        });
        det.appendChild(h('div', { class: 'rail-fld' }, [
          h('label', {}, f.label),
          input,
          f.hint ? h('div', { class: 'rail-hint' }, f.hint) : null,
        ]));
      }
      formBox.appendChild(det);
    }

    // 样式
    const opt = h('details', { class: 'rail-grp', open: '' }, [h('summary', {}, '样式')]);

    const selBase = h('select', {}, [
      h('option', { value: '1' }, '1 · 蓝色（CR 涂装）'),
      h('option', { value: '2' }, '2 · 红色（水印纹）'),
      h('option', { value: '3' }, '3 · 橙色（灯笼）'),
    ]);
    selBase.value = String(state.base_pic || 1);
    selBase.addEventListener('change', () => {
      state.base_pic = Number(selBase.value); saveLocal(state); redraw();
    });
    opt.appendChild(h('div', { class: 'rail-fld' }, [h('label', {}, '底图'), selBase]));

    const selFbl = h('select', {}, [
      h('option', { value: '3.5' }, '3.5 · 1890×1190（推荐）'),
      h('option', { value: '2.4' }, '2.4 · 1296×816'),
      h('option', { value: '1' }, '1 · 540×340'),
    ]);
    selFbl.value = String(state.fbl || 3.5);
    selFbl.addEventListener('change', () => {
      state.fbl = Number(selFbl.value); saveLocal(state); redraw();
    });
    opt.appendChild(h('div', { class: 'rail-fld' }, [
      h('label', {}, '分辨率倍数'), selFbl,
      h('div', { class: 'rail-hint' }, '底图按倍数自动选 base / basea / baseb'),
    ]));

    const selSimsun = h('select', {}, [
      h('option', { value: '1' }, '宋体（经典）'),
      h('option', { value: '0' }, '黑体'),
    ]);
    selSimsun.value = String(state.if_simsun || '1');
    selSimsun.addEventListener('change', () => {
      state.if_simsun = selSimsun.value; saveLocal(state); redraw();
    });
    opt.appendChild(h('div', { class: 'rail-fld' }, [h('label', {}, '席别字体'), selSimsun]));

    const qr = h('input', { type: 'checkbox' });
    qr.checked = !!Number(state.qrcode);
    qr.addEventListener('change', () => {
      state.qrcode = qr.checked ? 1 : 0; saveLocal(state); redraw();
    });
    opt.appendChild(h('div', { class: 'rail-fld' }, [h('label', {}, '二维码'), qr]));

    formBox.appendChild(opt);
  }

  /* ---------------- 底栏按钮 ---------------- */

  const bar = h('div', { class: 'rail-bar' }, [
    h('button', {
      class: 'hud-btn',
      onclick: async () => {
        try {
          const txt = buildDataTxt(state);
          const r = await exportText('data.txt', txt);
          if (r.cancelled) return;
          if (!r.ok) throw new Error(r.error || '未知');
        } catch (e) { toast('导出失败：' + e.message); }
      },
    }, '导出 data.txt'),
    h('button', {
      class: 'hud-btn',
      onclick: async () => {
        try {
          const r = await importText(['.txt']);
          if (r.cancelled) return;
          if (!r.ok) throw new Error(r.error || '未知');
          Object.assign(state, parseDataTxt(r.data));
          saveLocal(state);
          buildForm();
          await redraw();
          toast('已导入');
        } catch (e) { toast('导入失败：' + e.message); }
      },
    }, '导入 data.txt'),
    h('button', {
      class: 'hud-btn primary',
      onclick: async () => {
        try {
          const r = await saveCanvasPng(canvas, 'ticket.png');
          if (r.cancelled) return;
          if (!r.ok) throw new Error(r.error || '未知');
          toast('已保存');
        } catch (e) { toast('保存失败：' + e.message); }
      },
    }, '保存到相册'),
  ]);
  body.appendChild(bar);

  /* ---------------- 启动 ---------------- */

  buildForm();
  stage.appendChild(h('div', { class: 'rail-loading' }, '正在加载字体…'));
  try {
    await loadFonts();
    await redraw();
  } catch (e) {
    toast('字体加载失败：' + e.message);
  }
  const ld = stage.querySelector('.rail-loading');
  if (ld) ld.remove();
}