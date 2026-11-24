/**
 * 手写 PNG 编码器 + 2D 绘图工具（纯 JS，不依赖 canvas / sharp / 任何图像库）
 * ==================================================================
 * PNG 结构：签名 + IHDR + IDAT(zlib deflate) + IEND
 * 每个扫描行用 filter type 0（None），RGB 8bit，无 alpha（背景不透明）。
 * 绘图采用 4 倍超采样（SSAA）后降采样，边缘平滑无锯齿。
 */

import zlib from 'node:zlib';

/* ============================ PNG 编码 ============================ */

function crc32(buf) {
  // 标准 CRC-32（PNG 每个 chunk 都要带）
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * 把 RGBA 像素数据编码成 PNG
 * @param {Uint8Array} rgba 长度 = w*h*4
 */
export function encodePng(rgba, w, h) {
  const stride = w * 3 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = y * stride + 1 + x * 3;
      raw[di] = rgba[si];
      raw[di + 1] = rgba[si + 1];
      raw[di + 2] = rgba[si + 2];
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ============================ 颜色 ============================ */

/** "#rrggbb" 或 [r,g,b] -> [r,g,b] */
export function hex(c) {
  if (Array.isArray(c)) return c;
  const s = c.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

export function mix(a, b, t) {
  const A = hex(a);
  const B = hex(b);
  return [
    A[0] + (B[0] - A[0]) * t,
    A[1] + (B[1] - A[1]) * t,
    A[2] + (B[2] - A[2]) * t,
  ];
}


/** 生成一个线性渐变的填充函数（供 shape 的 fillFn 使用） */
export function linearFill(x0, y0, x1, y1, stops) {
  const parsed = stops.map(([pos, col]) => [pos, hex(col)]);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  return (px, py) => {
    let t = ((px - x0) * dx + (py - y0) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    for (let i = 0; i < parsed.length - 1; i++) {
      const [p0, c0] = parsed[i];
      const [p1, c1] = parsed[i + 1];
      if (t >= p0 && t <= p1) return mix(c0, c1, (t - p0) / (p1 - p0 || 1));
    }
    return parsed[parsed.length - 1][1];
  };
}

/** 生成一个径向渐变的填充函数 */
export function radialFill(cx, cy, r, stops) {
  const parsed = stops.map(([pos, col]) => [pos, hex(col)]);
  return (px, py) => {
    let t = Math.hypot(px - cx, py - cy) / r;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    for (let i = 0; i < parsed.length - 1; i++) {
      const [p0, c0] = parsed[i];
      const [p1, c1] = parsed[i + 1];
      if (t >= p0 && t <= p1) return mix(c0, c1, (t - p0) / (p1 - p0 || 1));
    }
    return parsed[parsed.length - 1][1];
  };
}

/** 圆角矩形 SDF 工厂（外部复用，避免重复定义） */
export function sdRoundRect(x, y, w, h, r) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  return (px, py) => {
    const qx = Math.abs(px - cx) - hw;
    const qy = Math.abs(py - cy) - hh;
    const ax = Math.max(qx, 0);
    const ay = Math.max(qy, 0);
    return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
  };
}

/* ============================ 画布 ============================ */

/**
 * 画布：内部以 float RGB 存储，支持 alpha 混合与任意形状覆盖。
 * 用 4 倍超采样渲染，最后降采样得到抗锯齿边缘。
 */
export class Canvas {
  constructor(w, h, ss = 4) {
    this.w = w;
    this.h = h;
    this.ss = ss;
    this.W = w * ss;
    this.H = h * ss;
    this.buf = new Float32Array(this.W * this.H * 3);
  }

  /** 直接设置某个超采样像素 */
  setPx(x, y, rgb, alpha = 1) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    const i = (y * this.W + x) * 3;
    if (alpha >= 1) {
      this.buf[i] = rgb[0];
      this.buf[i + 1] = rgb[1];
      this.buf[i + 2] = rgb[2];
    } else {
      this.buf[i] += (rgb[0] - this.buf[i]) * alpha;
      this.buf[i + 1] += (rgb[1] - this.buf[i + 1]) * alpha;
      this.buf[i + 2] += (rgb[2] - this.buf[i + 2]) * alpha;
    }
  }

  /** 填充整个画布 */
  fill(color) {
    const c = hex(color);
    for (let i = 0; i < this.buf.length; i += 3) {
      this.buf[i] = c[0];
      this.buf[i + 1] = c[1];
      this.buf[i + 2] = c[2];
    }
  }

  /**
   * 通用"逐像素函数"填充：
   * fn(x, y, u, v) -> [r,g,b] | [r,g,b,a] | null
   * u/v 是 0..1 归一化坐标（逻辑像素）
   */
  paint(fn) {
    const { W, H, ss } = this;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = fn(x / ss, y / ss, (x + 0.5) / W, (y + 0.5) / H);
        if (!r) continue;
        const i = (y * W + x) * 3;
        const a = r.length > 3 ? r[3] : 1;
        if (a >= 1) {
          this.buf[i] = r[0];
          this.buf[i + 1] = r[1];
          this.buf[i + 2] = r[2];
        } else {
          this.buf[i] += (r[0] - this.buf[i]) * a;
          this.buf[i + 1] += (r[1] - this.buf[i + 1]) * a;
          this.buf[i + 2] += (r[2] - this.buf[i + 2]) * a;
        }
      }
    }
  }

  /**
   * 用有符号距离函数（SDF）填充形状：
   * sdf(x,y) 返回负值表示在形状内（单位：逻辑像素）
   * 这样边缘天然抗锯齿，且支持任意圆角/描边。
   */
  shape(sdf, color, opts = {}) {
    const { W, ss } = this;
    // color 可以是颜色值，也可以是 (x, y) => [r,g,b] 的填充函数
    const fillFn = typeof color === 'function' ? color : null;
    const c = fillFn ? null : hex(color);
    const alpha = opts.alpha ?? 1;
    const stroke = opts.stroke ?? null; // 描边宽度（逻辑像素）
    const strokeColor = opts.strokeColor ? hex(opts.strokeColor) : null;
    const blend = opts.blend ?? 'over'; // over | add | screen
    // 只扫描形状的包围盒，速度快很多
    const b = opts.bbox;
    const x0 = Math.max(0, Math.floor((b ? b[0] : 0) * ss));
    const y0 = Math.max(0, Math.floor((b ? b[1] : 0) * ss));
    const x1 = Math.min(W, Math.ceil((b ? b[2] : this.w) * ss));
    const y1 = Math.min(this.H, Math.ceil((b ? b[3] : this.h) * ss));
    const soft = opts.soft ?? 1; // 边缘羽化宽度（超采样像素）
    // 旋转：绕 (rot.cx, rot.cy) 旋转 rot.angle 弧度（形状在本地坐标定义）
    const rot = opts.rotate || null;
    let cosA = 1;
    let sinA = 0;
    if (rot) {
      cosA = Math.cos(-rot.angle);
      sinA = Math.sin(-rot.angle);
    }

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        let sx = (x + 0.5) / ss;
        let sy = (y + 0.5) / ss;
        if (rot) {
          const dx = sx - rot.cx;
          const dy = sy - rot.cy;
          sx = rot.cx + dx * cosA - dy * sinA;
          sy = rot.cy + dx * sinA + dy * cosA;
        }
        const d = sdf(sx, sy);
        let a = 0;
        if (stroke === null) {
          a = Math.max(0, Math.min(1, 0.5 - d / soft));
        } else {
          const dEdge = Math.abs(d + stroke / 2) - stroke / 2;
          a = Math.max(0, Math.min(1, 0.5 - dEdge / soft));
        }
        if (a <= 0) continue;
        a *= alpha;
        const i = (y * W + x) * 3;
        if (stroke !== null && strokeColor && Math.abs(d + stroke / 2) - stroke / 2 > -soft && d > -stroke) {
          // 描边区域
          if (blend === 'add') {
            this.buf[i] += strokeColor[0] * a;
            this.buf[i + 1] += strokeColor[1] * a;
            this.buf[i + 2] += strokeColor[2] * a;
          } else {
            this.buf[i] += (strokeColor[0] - this.buf[i]) * a;
            this.buf[i + 1] += (strokeColor[1] - this.buf[i + 1]) * a;
            this.buf[i + 2] += (strokeColor[2] - this.buf[i + 2]) * a;
          }
          continue;
        }
        const col = fillFn ? fillFn((x + 0.5) / ss, (y + 0.5) / ss) : c;
        if (!col) continue;
        // 填充函数可以返回 [r,g,b,a]，其 alpha 与 opts.alpha 相乘
        if (col.length > 3) a *= col[3];
        if (a <= 0) continue;
        if (blend === 'add') {
          this.buf[i] += col[0] * a;
          this.buf[i + 1] += col[1] * a;
          this.buf[i + 2] += col[2] * a;
        } else if (blend === 'screen') {
          this.buf[i] = 255 - (255 - this.buf[i]) * (1 - (col[0] / 255) * a);
          this.buf[i + 1] = 255 - (255 - this.buf[i + 1]) * (1 - (col[1] / 255) * a);
          this.buf[i + 2] = 255 - (255 - this.buf[i + 2]) * (1 - (col[2] / 255) * a);
        } else {
          this.buf[i] += (col[0] - this.buf[i]) * a;
          this.buf[i + 1] += (col[1] - this.buf[i + 1]) * a;
          this.buf[i + 2] += (col[2] - this.buf[i + 2]) * a;
        }
      }
    }
  }

  /** 圆角矩形（SDF） */
  roundRect(x, y, w, h, r, color, opts = {}) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const hw = w / 2;
    const hh = h / 2;
    const sdf = (px, py) => {
      const qx = Math.abs(px - cx) - (hw - r);
      const qy = Math.abs(py - cy) - (hh - r);
      const ax = Math.max(qx, 0);
      const ay = Math.max(qy, 0);
      return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
    };
    this.shape(sdf, color, { ...opts, bbox: [x - 2, y - 2, x + w + 2, y + h + 2] });
  }

  /** 旋转的圆角矩形（angle 单位弧度） */
  roundRectRot(x, y, w, h, r, angle, color, opts = {}) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const hw = w / 2;
    const hh = h / 2;
    const sdf = (px, py) => {
      const qx = Math.abs(px - cx) - (hw - r);
      const qy = Math.abs(py - cy) - (hh - r);
      const ax = Math.max(qx, 0);
      const ay = Math.max(qy, 0);
      return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
    };
    // 旋转后的包围盒按对角线放宽
    const rad = Math.hypot(hw, hh) + 2;
    this.shape(sdf, color, {
      ...opts,
      rotate: { cx, cy, angle },
      bbox: [cx - rad, cy - rad, cx + rad, cy + rad],
    });
  }

  /** 圆形 */
  circle(cx, cy, r, color, opts = {}) {
    const sdf = (px, py) => Math.hypot(px - cx, py - cy) - r;
    this.shape(sdf, color, { ...opts, bbox: [cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2] });
  }

  /** 椭圆 */
  ellipse(cx, cy, rx, ry, color, opts = {}) {
    const sdf = (px, py) => {
      const dx = (px - cx) / rx;
      const dy = (py - cy) / ry;
      const k = Math.hypot(dx, dy);
      // 近似距离场，足够做抗锯齿
      return (k - 1) * Math.min(rx, ry);
    };
    this.shape(sdf, color, { ...opts, bbox: [cx - rx - 2, cy - ry - 2, cx + rx + 2, cy + ry + 2] });
  }

  /** 线段（带圆头），用胶囊 SDF */
  line(x1, y1, x2, y2, width, color, opts = {}) {
    const sdf = (px, py) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((px - x1) * dx + (py - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const qx = px - (x1 + t * dx);
      const qy = py - (y1 + t * dy);
      return Math.hypot(qx, qy) - width / 2;
    };
    const pad = width + 2;
    this.shape(sdf, color, {
      ...opts,
      bbox: [Math.min(x1, x2) - pad, Math.min(y1, y2) - pad, Math.max(x1, x2) + pad, Math.max(y1, y2) + pad],
    });
  }

  /** 多边形（凸/凹都可用：奇偶规则 + 距离场） */
  polygon(points, color, opts = {}) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const inside = (px, py) => {
      let c = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const edgeDist = (px, py) => {
      let best = Infinity;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [ax, ay] = points[j];
        const [bx, by] = points[i];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
      }
      return best;
    };
    const sdf = (px, py) => (inside(px, py) ? -edgeDist(px, py) : edgeDist(px, py));
    this.shape(sdf, color, {
      ...opts,
      bbox: [Math.min(...xs) - 2, Math.min(...ys) - 2, Math.max(...xs) + 2, Math.max(...ys) + 2],
    });
  }

  /** 环形（甜甜圈） */
  ring(cx, cy, r, thickness, color, opts = {}) {
    const sdf = (px, py) => Math.abs(Math.hypot(px - cx, py - cy) - r) - thickness / 2;
    const pad = r + thickness + 2;
    this.shape(sdf, color, { ...opts, bbox: [cx - pad, cy - pad, cx + pad, cy + pad] });
  }

  /** 线性渐变填充（在矩形范围内） */
  linearGradient(x, y, w, h, stops, opts = {}) {
    const angle = opts.angle ?? 90;
    const rad = (angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // 投影范围
    let min = Infinity;
    let max = -Infinity;
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      const t = px * dx + py * dy;
      min = Math.min(min, t);
      max = Math.max(max, t);
    }
    const parsed = stops.map(([pos, col]) => [pos, hex(col)]);
    const bbox = opts.bbox ?? [x, y, x + w, y + h];
    this.paint((px, py) => {
      if (px < bbox[0] || py < bbox[1] || px > bbox[2] || py > bbox[3]) return null;
      let t = (px * dx + py * dy - min) / (max - min || 1);
      t = Math.max(0, Math.min(1, t));
      // 找到所在区间
      for (let i = 0; i < parsed.length - 1; i++) {
        const [p0, c0] = parsed[i];
        const [p1, c1] = parsed[i + 1];
        if (t >= p0 && t <= p1) {
          const k = (t - p0) / (p1 - p0 || 1);
          const c = mix(c0, c1, k);
          return [c[0], c[1], c[2], opts.alpha ?? 1];
        }
      }
      const last = parsed[parsed.length - 1][1];
      return [last[0], last[1], last[2], opts.alpha ?? 1];
    });
  }

  /** 径向光晕（叠加混合） */
  glow(cx, cy, radius, color, strength = 1, falloff = 2) {
    const c = hex(color);
    const bbox = [cx - radius, cy - radius, cx + radius, cy + radius];
    this.paint((px, py) => {
      if (px < bbox[0] || py < bbox[1] || px > bbox[2] || py > bbox[3]) return null;
      const d = Math.hypot(px - cx, py - cy) / radius;
      if (d >= 1) return null;
      const a = Math.pow(1 - d, falloff) * strength;
      return [c[0], c[1], c[2], a];
    });
  }

  /** 降采样输出 RGBA */
  toRGBA() {
    const { w, h, ss, W } = this;
    const out = new Uint8Array(w * h * 4);
    const n = ss * ss;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let sy = 0; sy < ss; sy++) {
          for (let sx = 0; sx < ss; sx++) {
            const i = ((y * ss + sy) * W + (x * ss + sx)) * 3;
            r += this.buf[i];
            g += this.buf[i + 1];
            b += this.buf[i + 2];
          }
        }
        const o = (y * w + x) * 4;
        out[o] = Math.max(0, Math.min(255, Math.round(r / n)));
        out[o + 1] = Math.max(0, Math.min(255, Math.round(g / n)));
        out[o + 2] = Math.max(0, Math.min(255, Math.round(b / n)));
        out[o + 3] = 255;
      }
    }
    return out;
  }

  /** 输出 PNG Buffer */
  toPng() {
    return encodePng(this.toRGBA(), this.w, this.h);
  }
}
