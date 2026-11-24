#!/usr/bin/env node
/**
 * 图标与封面生成器。
 * ==================================================================
 * 用法：node tools/gen-images.mjs
 * 产出：assets/icon.png   (200×200，小程序图标)
 *       assets/cover.png  (510×272，封面)
 *
 * 【为什么用代码画】素材有版权风险，且改一次配色就要重做图。
 *   用几何图形 + 4× 超采样抗锯齿（SSAA）生成，配色集中在一处，
 *   改主题时重跑一次即可，输出完全确定。
 *
 * 【注意】png.mjs 的 hex() 只认 "#rrggbb"，不支持 rgba() 字符串——
 *   半透明一律走 opts.alpha / glow 的 strength，否则颜色会解析成 NaN。
 *   shape() 的填充函数可以返回 [r,g,b,a]，第 4 位参与透明度。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, mix, hex, linearFill, radialFill, sdRoundRect } from './lib/png.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets');

/* ============================ 配色 ============================ */

const C = {
  bg0: '#070a12',
  bg1: '#0b0e18',
  ink: '#0b0e18',
  paper: '#e8edf7',
  steel: '#c8d2e6',
  green: '#4ade80',
  amber: '#f0b429',
  red: '#f4634a',
  blue: '#4aa8f4',
  purple: '#9b7bf0',
  mint: '#3fe8cc',
  spark: '#ffd166',
};

/* ============================ SDF 组合 ============================ */

const union = (...fns) => (x, y) => Math.min(...fns.map((f) => f(x, y)));
const subtract = (a, b) => (x, y) => Math.max(a(x, y), -b(x, y));
const circleSdf = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;

/* ============================ 像素数字（3×5 点阵） ============================ */

const DIGIT3 = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '001', '001'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

/** 画一个像素数字（左上角对齐到 x,y） */
function drawNumber(c, n, x, y, px, color, opts = {}) {
  const s = String(n);
  const gap = px * 0.34;
  for (let i = 0; i < s.length; i++) {
    const g = DIGIT3[s[i]];
    if (!g) continue;
    const ox = x + i * (3 * px + gap);
    for (let r = 0; r < 5; r++) {
      for (let col = 0; col < 3; col++) {
        if (g[r][col] !== '1') continue;
        c.roundRect(ox + col * px, y + r * px, px * 0.84, px * 0.84, px * 0.14, color, opts);
      }
    }
  }
}

/** 像素数字的宽度 */
function numberWidth(n, px) {
  const s = String(n);
  return s.length * 3 * px + (s.length - 1) * px * 0.34;
}

/* ============================ 图形元件 ============================ */

/** 地雷：圆体 + 八根尖刺 + 高光 */
function glyphMine(c, cx, cy, r) {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    c.line(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72,
      cx + Math.cos(a) * r * 1.42, cy + Math.sin(a) * r * 1.42, r * 0.30, C.red);
  }
  c.circle(cx, cy, r, C.red);
  c.circle(cx, cy, r, (px, py) => {
    const t = Math.max(0, 1 - Math.hypot(px - (cx - r * 0.34), py - (cy - r * 0.36)) / r);
    if (t <= 0) return null;
    return [255, 255, 255, Math.pow(t, 1.7) * 0.62];
  });
  c.circle(cx, cy, r, (px, py) => {
    const t = Math.max(0, (py - (cy + r * 0.34)) / r);
    if (t <= 0) return null;
    return [90, 10, 10, t * 0.35];
  });
}

/** 水果块（西瓜）：绿皮 + 红瓤 + 籽 */
function glyphMelon(c, cx, cy, r) {
  const half = (rr, col, dy) => {
    c.shape((x, y) => {
      if (y - (cy + dy) > 0) return 1e9;
      return Math.hypot(x - cx, y - (cy + dy)) - rr;
    }, col, { bbox: [cx - rr - 2, cy - rr + dy - 2, cx + rr + 2, cy + dy + 2] });
  };
  half(r, '#1b6b36', 0);
  half(r * 0.86, '#2fa84f', 0);
  half(r * 0.72, C.red, r * 0.10);
  for (const [dx, dy] of [[-0.30, -0.36], [0.10, -0.46], [0.42, -0.22], [-0.44, -0.10], [0.02, -0.12]]) {
    c.ellipse(cx + dx * r, cy + dy * r, r * 0.055, r * 0.085, '#2b0f18');
  }
}

/** 2048 方块 */
function glyphTile(c, cx, cy, r, num, col) {
  c.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.30, (px, py) => {
    const t = Math.min(1, Math.max(0, (py - (cy - r)) / (r * 2)));
    return mix(col, mix(col, '#3a1200', 0.42), Math.pow(t, 0.9));
  });
  c.roundRect(cx - r, cy - r, r * 2, r * 2, r * 0.30, (px, py) => {
    const t = Math.max(0, 1 - (py - (cy - r)) / (r * 0.9));
    return [255, 255, 255, Math.pow(t, 1.5) * 0.30];
  });
  // 数字高度 = 5*px，控制在方块的 45% 左右才好看
  const px = num >= 10 ? r * 0.15 : r * 0.18;
  const w = numberWidth(num, px);
  drawNumber(c, num, cx - w / 2, cy - 2.5 * px, px, '#2a1000', { alpha: 0.92 });
}

/** 蛇身一节 */
function snakeCell(c, x, y, s, col, isHead) {
  c.roundRect(x, y, s, s, s * 0.20, col);
  c.roundRect(x, y, s, s, s * 0.20, (px, py) => {
    const t = Math.max(0, 1 - (py - y) / (s * 0.72));
    return [255, 255, 255, Math.pow(t, 1.4) * 0.30];
  });
  if (isHead) {
    c.roundRect(x + s * 0.22, y + s * 0.26, s * 0.18, s * 0.18, s * 0.05, C.ink);
    c.roundRect(x + s * 0.56, y + s * 0.26, s * 0.18, s * 0.18, s * 0.05, C.ink);
  }
}

/** 苹果 */
function glyphApple(c, cx, cy, r) {
  c.line(cx, cy - r * 0.9, cx + r * 0.24, cy - r * 1.42, r * 0.16, '#4a8a2a');
  c.circle(cx, cy, r, '#c22a3c');
  c.circle(cx, cy, r * 0.86, '#ff4d5e');
  c.circle(cx, cy, r * 0.86, (px, py) => {
    const t = Math.max(0, 1 - Math.hypot(px - (cx - r * 0.28), py - (cy - r * 0.28)) / (r * 0.9));
    if (t <= 0) return null;
    return [255, 255, 255, Math.pow(t, 1.5) * 0.55];
  });
}

/** 齿轮：梯形齿 + 中心孔 + 高光 */
function glyphGear(c, cx, cy, r, teeth) {
  const rIn = r * 0.78;
  const step = (Math.PI * 2) / teeth;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    const tw = step * 0.25;
    const bw = step * 0.34;
    pts.push([cx + Math.cos(a0 - bw) * rIn, cy + Math.sin(a0 - bw) * rIn]);
    pts.push([cx + Math.cos(a0 - tw) * r, cy + Math.sin(a0 - tw) * r]);
    pts.push([cx + Math.cos(a0 + tw) * r, cy + Math.sin(a0 + tw) * r]);
    pts.push([cx + Math.cos(a0 + bw) * rIn, cy + Math.sin(a0 + bw) * rIn]);
  }
  c.polygon(pts, radialFill(cx - r * 0.30, cy - r * 0.32, r * 1.7, [
    [0, '#6d8fd8'],
    [0.55, '#3c5290'],
    [1, '#1a2440'],
  ]));
  c.polygon(pts, '#9db8ee', { stroke: 1.2, strokeColor: hex('#9db8ee'), alpha: 0.35 });
  c.circle(cx, cy, r * 0.33, C.ink);
  c.circle(cx, cy, r * 0.33, C.mint, { stroke: 1.1, strokeColor: hex(C.mint), alpha: 0.45 });
}

/* ============================ 图标 200×200 ============================ */

function makeIcon() {
  const S = 200;
  const c = new Canvas(S, S, 4);

  // 背景：深色径向渐变
  c.fill(C.bg0);
  c.paint((px, py) => {
    const d = Math.min(1, Math.hypot(px - 100, py - 88) / 178);
    return mix('#1c2748', '#04060b', Math.pow(d, 0.7));
  });

  // 圆角底板
  const pad = 9;
  const size = S - pad * 2;
  const radius = 47;
  const body = sdRoundRect(pad, pad, size, size, radius);
  c.shape(sdRoundRect(pad, pad + 5, size, size, radius), '#000000', { alpha: 0.62, soft: 15 });
  c.shape(body, linearFill(pad, pad, pad + size, pad + size, [
    [0, '#374a78'],
    [0.45, '#243057'],
    [1, '#0e1326'],
  ]));
  c.shape(body, (px, py) => {
    const t = Math.max(0, 1 - (py - pad) / (size * 0.58));
    if (t <= 0) return null;
    return [255, 255, 255, Math.pow(t, 2.1) * 0.15];
  });
  c.shape(body, radialFill(100, 192, 112, [[0, C.mint], [1, '#0e1326']]), { alpha: 0.18, blend: 'screen' });
  c.shape(body, C.mint, { stroke: 2, strokeColor: hex(C.mint), alpha: 0.82 });

  // ---------- 手柄剪影 ----------
  const bx = 24;
  const by = 62;
  const bw = 152;
  const bh = 52;
  const gr = 29;
  const gripY = by + bh - 16;
  const padBody = subtract(
    union(
      sdRoundRect(bx, by, bw, bh, 27),
      circleSdf(bx + gr, gripY, gr),
      circleSdf(bx + bw - gr, gripY, gr)
    ),
    circleSdf(bx + bw / 2, by + bh + 32, 36)
  );
  const bbox = [bx - 18, by - 16, bx + bw + 18, by + bh + 46];

  // 外发光 → 投影 → 主体
  c.shape(padBody, C.mint, { alpha: 0.26, soft: 16, bbox });
  c.shape((px, py) => padBody(px, py - 7), '#000000', { alpha: 0.55, soft: 14, bbox });
  c.shape(padBody, linearFill(bx, by, bx, by + bh + 38, [
    [0, '#ffffff'],
    [0.36, '#dbe8ff'],
    [1, '#88a1d6'],
  ]), { bbox });
  // 底部塑形
  c.shape(padBody, (px, py) => {
    const t = Math.max(0, (py - (by + 14)) / (bh + 34));
    if (t <= 0) return null;
    return [26, 42, 88, Math.pow(t, 1.5) * 0.48];
  }, { bbox });
  // 顶部青色轮廓光
  c.shape(padBody, (px, py) => {
    const t = Math.max(0, 1 - (py - by + 2) / 20);
    if (t <= 0) return null;
    return [63, 232, 204, Math.pow(t, 2) * 0.6];
  }, { bbox });
  // 深色描边（与背景分离）
  c.shape(padBody, C.ink, { stroke: 1.6, strokeColor: hex(C.ink), alpha: 0.45, bbox });

  // ---------- 十字键 ----------
  const dx = 66;
  const dy = 88;
  const arm = 11;
  const len = 36;
  const crossOuter = union(
    sdRoundRect(dx - arm, dy - len / 2, arm * 2, len, 4),
    sdRoundRect(dx - len / 2, dy - arm, len, arm * 2, 4)
  );
  const crossBox = [dx - 26, dy - 26, dx + 26, dy + 26];
  c.shape(crossOuter, '#141c33', { bbox: crossBox });
  c.shape(union(
    sdRoundRect(dx - arm + 2, dy - len / 2 + 2, arm * 2 - 4, len - 4, 3),
    sdRoundRect(dx - len / 2 + 2, dy - arm + 2, len - 4, arm * 2 - 4, 3)
  ), linearFill(dx, dy - 16, dx, dy + 16, [
    [0, '#51689f'],
    [1, '#2c3c64'],
  ]), { bbox: crossBox });

  // ---------- 四色动作键 ----------
  const keys = [
    [144, 72, 10, C.amber],
    [161, 88, 10, C.red],
    [144, 104, 10, C.mint],
    [127, 88, 10, C.purple],
  ];
  for (const [kx, ky, kr, col] of keys) {
    c.circle(kx, ky + 2.2, kr + 1.6, '#141c33', { alpha: 0.55 });
    c.circle(kx, ky, kr, col);
    c.circle(kx, ky, kr, (px, py) => {
      const t = Math.max(0, 1 - Math.hypot(px - (kx - kr * 0.34), py - (ky - kr * 0.38)) / kr);
      if (t <= 0) return null;
      return [255, 255, 255, Math.pow(t, 1.4) * 0.85];
    });
    c.circle(kx, ky, kr, (px, py) => {
      const t = Math.max(0, (py - (ky + kr * 0.32)) / kr);
      if (t <= 0) return null;
      return [0, 0, 0, t * 0.28];
    });
  }

  // 中央功能键
  c.roundRect(93, 104, 8, 4.4, 2.2, '#a8bce6', { alpha: 0.9 });
  c.roundRect(104, 104, 8, 4.4, 2.2, '#a8bce6', { alpha: 0.9 });

  // ---------- 星点 ----------
  for (const [x, y, s, col, a] of [
    [26, 26, 2.8, C.paper, 0.45],
    [176, 26, 2.4, C.mint, 0.7],
    [178, 174, 2.2, C.amber, 0.55],
    [24, 172, 2.4, C.purple, 0.5],
  ]) {
    c.roundRect(x, y, s, s, s * 0.3, col, { alpha: a });
  }

  return c;
}

/* ============================ 封面 510×272 ============================ */

/** 卡片容器：深色圆角底 + 顶部彩色辉光 + 描边 */
function card(c, x, y, w, h, accent) {
  c.roundRect(x + 2, y + 7, w, h, 16, '#000000', { alpha: 0.55, soft: 12 });
  c.roundRect(x, y, w, h, 16, linearFill(x, y, x, y + h, [
    [0, mix(accent, '#0c1120', 0.80)],
    [1, '#0c1120'],
  ]));
  c.roundRect(x, y, w, h, 16, radialFill(x + w * 0.5, y + 2, w * 0.82, [
    [0, accent],
    [1, '#0c1120'],
  ]), { alpha: 0.30, blend: 'screen' });
  c.roundRect(x, y, w, h, 16, accent, { stroke: 1.3, strokeColor: hex(accent), alpha: 0.55 });
  c.roundRect(x, y, w, h, 16, (px, py) => {
    const t = Math.max(0, 1 - (py - y) / (h * 0.42));
    if (t <= 0) return null;
    return [255, 255, 255, Math.pow(t, 2) * 0.10];
  });
}

function makeCover() {
  const W = 510;
  const H = 272;
  const c = new Canvas(W, H, 4);

  // ---------- 背景 ----------
  c.fill(C.bg1);
  c.paint((px, py) => {
    const g = Math.min(1, py / H);
    const base = mix('#151d36', '#05070d', Math.pow(g, 0.8));
    const t = Math.min(1, Math.max(0, (px / W) * 0.6 + (py / H) * 0.4));
    return mix('#1c2446', base, t);
  });
  c.glow(64, 48, 235, '#2f5cff', 0.22, 1.8);
  c.glow(452, 242, 215, C.mint, 0.11, 1.8);
  c.glow(300, 10, 170, C.purple, 0.13, 2);

  // 点阵纹理
  for (let y = 8; y < H; y += 14) {
    for (let x = 8; x < W; x += 14) {
      c.roundRect(x, y, 1.5, 1.5, 0.5, '#5a6b9c', { alpha: 0.14 });
    }
  }

  /* ================= 左：四款小游戏 2×2 ================= */
  const cw = 104;
  const ch = 104;
  const gx = 24;
  const gy = 32;
  const gap = 10;

  // --- 扫雷 ---
  const mx0 = gx;
  const my0 = gy;
  card(c, mx0, my0, cw, ch, C.blue);
  {
    const cell = 23;
    const ox = mx0 + 17.5;
    const oy = my0 + 17.5;
    const mines = new Set(['0,0', '1,2', '2,1']);
    const flags = new Set(['2,0']);
    const nums = { '0,1': 2, '1,1': 1, '0,2': 1, '2,2': 3 };
    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 3; col++) {
        const x = ox + col * cell;
        const y = oy + r * cell;
        const k = r + ',' + col;
        const opened = mines.has(k) || nums[k] !== undefined;
        c.roundRect(x + 1, y + 1, cell - 2, cell - 2, 3.2, opened ? '#0c1322' : '#31496f');
        if (!opened) {
          c.roundRect(x + 1, y + 1, cell - 2, cell - 2, 3.2, (px, py) => {
            const t = Math.max(0, 1 - (py - y) / cell);
            return [255, 255, 255, t * 0.18];
          });
        }
        const cx = x + cell / 2;
        const cy = y + cell / 2;
        if (mines.has(k)) {
          glyphMine(c, cx, cy, cell * 0.20);
        } else if (flags.has(k)) {
          c.line(cx, cy - 5.5, cx, cy + 6, 1.5, C.paper);
          c.polygon([[cx + 0.5, cy - 5.5], [cx + 5.4, cy - 2.8], [cx + 0.5, cy]], C.mint);
        } else if (nums[k]) {
          const px = 2.7;
          drawNumber(c, nums[k], cx - numberWidth(nums[k], px) / 2, cy - 2.5 * px, px, '#7fb0ff');
        }
      }
    }
  }

  // --- 2048 ---
  const tx0 = gx + cw + gap;
  card(c, tx0, gy, cw, ch, C.amber);
  {
    const tiles = [
      [7, 7, 43, 2, C.amber],
      [53, 7, 43, 4, '#ff9a4d'],
      [7, 53, 43, 8, '#ff7a7a'],
      [53, 53, 43, 16, '#ef4f7e'],
    ];
    for (const [tx, ty, s, num, col] of tiles) {
      glyphTile(c, tx0 + tx + s / 2, gy + ty + s / 2, s / 2, num, col);
    }
  }

  // --- 水果忍者 ---
  const fx0 = gx;
  const fy0 = gy + ch + gap;
  card(c, fx0, fy0, cw, ch, C.green);
  {
    // 刀光：三层弧线
    const ccx = fx0 + cw * 0.52;
    const ccy = fy0 + ch * 0.54;
    for (let i = 0; i < 3; i++) {
      const pts = [];
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        const a = -0.72 + 1.6 * t;
        pts.push([ccx + Math.cos(a) * 42, ccy + Math.sin(a) * 42]);
      }
      for (let k = 0; k < pts.length - 1; k++) {
        c.line(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], [5.5, 3.2, 1.6][i],
          ['#ffffff', '#c8fff4', '#5fd8ff'][i], { alpha: [0.92, 0.42, 0.30][i], blend: 'screen' });
      }
    }
    glyphMelon(c, ccx - 16, ccy + 4, 26);
    // 橙子
    const ox = ccx + 24;
    const oy = ccy + 15;
    c.circle(ox, oy, 11.5, '#c96f12');
    c.circle(ox, oy, 10.2, '#ff9f2e');
    c.circle(ox, oy, 10.2, (px, py) => {
      const t = Math.max(0, 1 - Math.hypot(px - (ox - 3), py - (oy - 3)) / 10.2);
      if (t <= 0) return null;
      return [255, 255, 255, t * 0.36];
    });
    c.circle(ox, oy, 3.4, '#ffd08a', { alpha: 0.5 });
  }

  // --- 贪吃蛇 ---
  const sx0 = gx + cw + gap;
  const sy0 = gy + ch + gap;
  card(c, sx0, sy0, cw, ch, C.purple);
  {
    // 淡棋盘格
    for (let r = 0; r < 5; r++) {
      for (let col = 0; col < 5; col++) {
        if ((r + col) % 2 === 0) continue;
        c.roundRect(sx0 + 11 + col * 16.4, sy0 + 11 + r * 16.4, 15.6, 15.6, 2.4, '#1a2340', { alpha: 0.55 });
      }
    }
    const cells = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [3, 2]];
    const cs = 16.4;
    for (let i = 0; i < cells.length; i++) {
      const [cx2, cy2] = cells[i];
      const head = i === cells.length - 1;
      snakeCell(c, sx0 + 11 + cx2 * cs, sy0 + 11 + cy2 * cs, cs - 1.6,
        head ? '#b6f05a' : mix('#4f9a2e', '#7ed957', i / cells.length), head);
    }
    glyphApple(c, sx0 + 11 + 3.55 * cs, sy0 + 11 + 1.05 * cs, 6.6);
  }

  /* ================= 右：实用工具面板 ================= */
  const px0 = 268;
  const py0 = 32;
  const pw = 218;
  const ph = 208;

  c.roundRect(px0 + 2, py0 + 8, pw, ph, 20, '#000000', { alpha: 0.55, soft: 14 });
  c.roundRect(px0, py0, pw, ph, 20, linearFill(px0, py0, px0 + pw, py0 + ph, [
    [0, '#1d2c55'],
    [0.55, '#121a30'],
    [1, '#0a0f1d'],
  ]));
  c.roundRect(px0, py0, pw, ph, 20, radialFill(px0 + pw * 0.72, py0 + 8, pw * 0.9, [
    [0, C.blue],
    [1, '#0a0f1d'],
  ]), { alpha: 0.22, blend: 'screen' });
  c.roundRect(px0, py0, pw, ph, 20, C.blue, { stroke: 1.3, strokeColor: hex(C.blue), alpha: 0.5 });
  c.roundRect(px0, py0, pw, ph, 20, (px, py) => {
    const t = Math.max(0, 1 - (py - py0) / (ph * 0.38));
    if (t <= 0) return null;
    return [255, 255, 255, Math.pow(t, 2) * 0.08];
  });

  // 齿轮
  glyphGear(c, px0 + 72, py0 + 66, 38, 11);

  // 扳手
  const wx = px0 + 130;
  const wy = py0 + 120;
  c.line(wx - 30, wy + 24, wx + 14, wy - 22, 13, '#000000', { alpha: 0.4, soft: 7 });
  c.line(wx - 30, wy + 24, wx + 14, wy - 22, 12, '#7d92c2');
  c.line(wx - 30, wy + 24, wx + 14, wy - 22, 8, '#d8e4ff');
  c.circle(wx + 19, wy - 27, 12.5, '#7d92c2');
  c.circle(wx + 19, wy - 27, 11, '#d8e4ff');
  c.circle(wx + 19, wy - 27, 6.8, '#0d1526');
  c.polygon([[wx + 11, wy - 40], [wx + 27, wy - 40], [wx + 33, wy - 31], [wx + 5, wy - 31]], '#0d1526');
  c.circle(wx - 34, wy + 28, 8.5, '#7d92c2');
  c.circle(wx - 34, wy + 28, 7, '#d8e4ff');
  c.circle(wx - 34, wy + 28, 3.4, '#0d1526');

  // 转盘
  const rx = px0 + pw - 44;
  const ry = py0 + 44;
  c.circle(rx, ry, 25, '#0a1122');
  c.circle(rx, ry, 25, radialFill(rx - 6, ry - 7, 30, [[0, '#2a3d68'], [1, '#0b1222']]));
  c.circle(rx, ry, 25, C.mint, { stroke: 1.4, strokeColor: hex(C.mint), alpha: 0.6 });
  for (let i = 0; i < 8; i++) {
    if (i % 2 === 0) continue;
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    c.polygon([
      [rx, ry],
      [rx + Math.cos(a0) * 19, ry + Math.sin(a0) * 19],
      [rx + Math.cos((a0 + a1) / 2) * 19, ry + Math.sin((a0 + a1) / 2) * 19],
      [rx + Math.cos(a1) * 19, ry + Math.sin(a1) * 19],
    ], '#31548c', { alpha: 0.85 });
  }
  c.polygon([[rx, ry - 17], [rx + 5, ry + 1], [rx, ry + 8], [rx - 5, ry + 1]], C.red);
  c.circle(rx, ry, 3, C.paper);

  // 三条滑杆
  const sx = px0 + 22;
  const sxe = px0 + pw - 22;
  const sy = py0 + ph - 50;
  const knobPos = [0.34, 0.66, 0.46];
  const knobCol = [C.mint, C.amber, C.red];
  for (let i = 0; i < 3; i++) {
    const y = sy + i * 15;
    c.line(sx, y, sxe, y, 4, '#1b2542');
    const kx = sx + (sxe - sx) * knobPos[i];
    c.line(sx, y, kx, y, 4, knobCol[i], { alpha: 0.75 });
    c.circle(kx, y, 6.8, '#0c1424');
    c.circle(kx, y, 5.2, knobCol[i]);
    c.circle(kx, y, 5.2, (px, py) => {
      const t = Math.max(0, 1 - Math.hypot(px - (kx - 1.4), py - (y - 1.4)) / 5.2);
      if (t <= 0) return null;
      return [255, 255, 255, t * 0.55];
    });
  }

  /* ================= 点缀 ================= */
  c.glow(262, 150, 74, C.blue, 0.10, 2);
  for (const [x, y, s, col, a] of [
    [252, 20, 2.4, C.amber, 0.8],
    [500, 18, 2.2, C.mint, 0.65],
    [8, 250, 2, C.purple, 0.5],
    [498, 258, 2, C.blue, 0.5],
  ]) {
    c.roundRect(x, y, s, s, s * 0.3, col, { alpha: a });
  }

  // 暗角
  c.paint((px, py) => {
    const dx = (px - W / 2) / (W / 2);
    const dy = (py - H / 2) / (H / 2);
    const d = Math.hypot(dx, dy) / 1.32;
    if (d < 0.58) return null;
    const t = Math.min(1, (d - 0.58) / 0.42);
    return [4, 6, 12, Math.pow(t, 1.8) * 0.5];
  });

  return c;
}

/* ============================ 主流程 ============================ */

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const t0 = Date.now();

  const icon = makeIcon();
  const iconPng = icon.toPng();
  fs.writeFileSync(path.join(OUT, 'icon.png'), iconPng);
  console.log('icon.png   ' + icon.w + '×' + icon.h + '  ' + (iconPng.length / 1024).toFixed(1) + ' KB');

  const cover = makeCover();
  const coverPng = cover.toPng();
  fs.writeFileSync(path.join(OUT, 'cover.png'), coverPng);
  console.log('cover.png  ' + cover.w + '×' + cover.h + '  ' + (coverPng.length / 1024).toFixed(1) + ' KB');

  console.log('耗时 ' + (Date.now() - t0) + ' ms');
}

main();
