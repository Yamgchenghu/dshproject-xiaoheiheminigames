/**
 * 流水入杯的物理与关卡逻辑。
 *
 * 【为什么要完整重写一套 2D 刚体引擎】原版是 Android 上的 Java 代码，
 *   小程序里跑不了。而"水珠堆在杯子里"这个效果，靠动画或假流体是做不出来的：
 *   水珠之间必须真的互相挤压、真的把线压弯。所以这里把原版的
 *   圆-圆、圆-胶囊、胶囊-胶囊三类碰撞逐条搬过来，参数一个不改，
 *   保证同一关的难度和手感跟原版一致。
 *
 * 【坐标与单位】世界宽 0.60 m、高 1.00 m，原点左上，Y 向下。
 *   全部用国际单位（米/千克/秒），这样原版的关卡坐标可以逐位照搬。
 *
 * 【为什么不直接用 Box2D/Matter.js】Matter.js 有 90KB，而且它是"通用刚体"，
 *   水滴需要的是"大量等质量小圆 + 睡眠 + 网格宽相"，通用引擎反而更慢。
 *   这套定制的固定步长循环在原版上已经调好了手感，照搬风险最低。
 */

/* ============================ 常量 ============================ */

export const WORLD_W = 0.6;
export const WORLD_H = 1.0;

const CUP_VOLUME_RATIO = 7 / 17;
const CUP_LINEAR = Math.sqrt(CUP_VOLUME_RATIO);
export const BASE_CUP_W = 0.222;
export const BASE_CUP_H = 0.2;
export const CUP_W = BASE_CUP_W * CUP_LINEAR;
export const CUP_H = BASE_CUP_H * CUP_LINEAR;
export const CUP_WALL = 0.0075;
export const FAUCET_SPOUT_Y = 0.165;
export const POISON_FAUCET_Y = 0.105;

export const TOTAL_DROPS = 225;
export const CUP_FULL_DROPS = 200;
export const TARGET_DROPS = 190;

const LINE_DENSITY = 5.0;
const LINE_RADIUS = 0.0065;
// 【长度为什么要 ×2.1】原来 60.5cm 是按原版手感定的，实测在小屏上
//   太短，很多关卡几乎无处落笔。用户要求放宽到 2.1 倍：60.5 × 2.1 ≈ 127cm。
//   限长仍保留——完全不限的话随便搭一根就能兜住水，关卡设计失去意义。
export const LINE_MAX_LEN = 0.605 * 2.1;
const LINE_MIN_LEN = 0.045;
const SNAP_RADIUS = 0.036;
export const MAX_LINES = 3;

export const DROP_RADIUS = 0.0155 * Math.sqrt(0.75) * (2 / 3);
const DROP_MASS = 0.0125;
const DROP_INV_MASS = 1 / DROP_MASS;

const GRAVITY = 9.8;
const AIR_DRAG_N = 0.0025;
const WATER_RESTITUTION = 0.04;
const WATER_FRICTION = 0.0125;

const ENTER_FADE_SECONDS = 1.5;
const STILL_SECONDS = 5.0;
const FIXED_DT = 1 / 240;

/** 物体标签：决定画什么颜色、以及和谁发生特殊反应 */
export const TAG = {
  GROUND: 1,
  CUP: 2,
  FAUCET: 3,
  SUPPORT: 4,
  WALL: 5,
  FIRE_LINE: 6,
  FIRE_RING: 7,
  FIRE_BALL: 8,
  MUD: 9,
  LINE: 10,
  BALL: 11,
};

/** 圆形物体的种类（对应关卡数据里的 circles[0]） */
export const CIRCLE = {
  SOLID: 0,
  FIRE_RING: 1,
  FIRE_BALL: 2,
  BUBBLE: 3,
  POISON_BALL: 4,
  BALL: 5,
};

const MOVE = { NONE: 0, LINEAR: 1, ORBIT: 2, PATH: 3, SPIN: 4 };

/* ============================ 随机数 ============================ */

/** 与 Java Random 无关，但保证同一 seed 可复现——录像/回放要靠它 */
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/* ============================ 刚体 ============================ */

class Bar {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.angle = 0;
    this.omega = 0;
    this.c = 1;
    this.s = 0;
    this.localX = [0, 0];
    this.localY = [0, 0];
    this.pointCount = 2;
    this.totalLength = 0;
    this.halfLen = 0;
    this.boundRadius = 0;
    this.radius = 0.005;
    this.mass = 1;
    this.invMass = 1;
    this.inertia = 1;
    this.invInertia = 1;
    this.restitution = 0.12;
    this.friction = 0.3;
    this.fixed = false;
    this.pinned = false;
    this.pinLocalX = 0;
    this.pinLocalY = 0;
    this.pinX = 0;
    this.pinY = 0;
    this.tag = 0;
    this.supportId = -1;
    this.ignoreSupportA = -1;
    this.ignoreSupportB = -1;
    this.waterPass = false;
    this.ground = false;
    this.noGround = false;
    this.calmEligible = false;
    this.sleeping = false;
    this.kinematic = false;
    this.circleShape = false;
    this.prevX = 0;
    this.prevY = 0;
    this.prevAngle = 0;
    this.restTime = 0;
  }

  static capsule(x1, y1, x2, y2, radius, mass, fixed) {
    const b = new Bar();
    b.setEndpoints(x1, y1, x2, y2);
    b.radius = radius;
    b.mass = mass;
    b.fixed = fixed;
    b.refreshMass();
    return b;
  }

  static polyline(wx, wy, n, radius, density, fixed) {
    const b = new Bar();
    b.configurePolyline(wx, wy, n, radius, density, fixed);
    return b;
  }

  setEndpoints(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    this.x = (x1 + x2) * 0.5;
    this.y = (y1 + y2) * 0.5;
    this.angle = Math.atan2(dy, dx);
    this.halfLen = Math.max(0.001, len * 0.5);
    this.totalLength = len;
    this.pointCount = 2;
    this.localX = [-this.halfLen, this.halfLen];
    this.localY = [0, 0];
    this.boundRadius = this.halfLen + this.radius;
    this.cacheRotation();
  }

  configurePolyline(wx, wy, n, radius, density, fixed) {
    this.radius = radius;
    this.fixed = fixed;
    if (n < 2) n = 2;
    let total = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n - 1; i++) {
      const len = Math.hypot(wx[i + 1] - wx[i], wy[i + 1] - wy[i]);
      total += len;
      cx += ((wx[i] + wx[i + 1]) * 0.5) * len;
      cy += ((wy[i] + wy[i + 1]) * 0.5) * len;
    }
    if (total < 1e-9) {
      total = Math.hypot(wx[n - 1] - wx[0], wy[n - 1] - wy[0]);
      cx = (wx[0] + wx[n - 1]) * 0.5;
      cy = (wy[0] + wy[n - 1]) * 0.5;
    }
    if (total < 1e-9) total = 1e-9;
    this.x = cx / total;
    this.y = cy / total;
    this.angle = 0;
    this.totalLength = total;
    this.halfLen = total * 0.5;
    this.pointCount = n;
    this.localX = new Array(n);
    this.localY = new Array(n);
    let bound = 0;
    for (let i = 0; i < n; i++) {
      this.localX[i] = wx[i] - this.x;
      this.localY[i] = wy[i] - this.y;
      const d = Math.hypot(this.localX[i], this.localY[i]);
      if (d > bound) bound = d;
    }
    this.boundRadius = bound + radius;
    this.mass = Math.max(1e-6, density * total);

    let inertiaSum = 0;
    for (let i = 0; i < n - 1; i++) {
      const len = Math.hypot(wx[i + 1] - wx[i], wy[i + 1] - wy[i]);
      const mi = density * len;
      const mx = (wx[i] + wx[i + 1]) * 0.5 - this.x;
      const my = (wy[i] + wy[i + 1]) * 0.5 - this.y;
      inertiaSum += mi * ((len * len) / 12 + mx * mx + my * my + radius * radius * 0.25);
    }
    this.inertia = Math.max(1e-9, inertiaSum);
    if (fixed) {
      this.invMass = 0;
      this.invInertia = 0;
    } else {
      this.invMass = 1 / this.mass;
      this.invInertia = 1 / this.inertia;
    }
    this.cacheRotation();
  }

  refreshMass() {
    if (!this.fixed && this.mass > 1e-9) {
      const length = this.totalLength > 0 ? this.totalLength : this.halfLen * 2;
      const width = this.radius * 2;
      this.invMass = 1 / this.mass;
      if (this.pointCount <= 2) {
        this.inertia = (this.mass * (length * length + width * width)) / 12;
        this.invInertia = 1 / this.inertia;
      } else {
        if (this.inertia <= 1e-9) this.inertia = (this.mass * length * length) / 12;
        this.invInertia = 1 / this.inertia;
      }
    } else {
      this.invMass = 0;
      this.invInertia = 0;
      if (this.inertia <= 0) {
        this.inertia = this.mass > 0 ? (this.mass * this.halfLen * this.halfLen) / 3 : 0;
      }
    }
  }

  cacheRotation() {
    this.c = Math.cos(this.angle);
    this.s = Math.sin(this.angle);
  }

  px(i) {
    return this.x + this.c * this.localX[i] - this.s * this.localY[i];
  }

  py(i) {
    return this.y + this.s * this.localX[i] + this.c * this.localY[i];
  }

  segCount() {
    return Math.max(1, this.pointCount - 1);
  }

  segAx(i) {
    return this.px(i);
  }

  segAy(i) {
    return this.py(i);
  }

  segBx(i) {
    return this.px(i + 1);
  }

  segBy(i) {
    return this.py(i + 1);
  }

  setPinLocalEndA(wx, wy) {
    this.setPinLocal(this.localX[0], this.localY[0], wx, wy);
  }

  setPinLocalEndB(wx, wy) {
    this.setPinLocal(this.localX[this.pointCount - 1], this.localY[this.pointCount - 1], wx, wy);
  }

  setPinLocal(lx, ly, wx, wy) {
    this.pinned = true;
    this.pinLocalX = lx;
    this.pinLocalY = ly;
    this.pinX = wx;
    this.pinY = wy;
  }

  integrate(dt, gravity) {
    if (this.fixed || this.sleeping || this.kinematic) return;
    this.vy += gravity * dt;
    const damp = 1 - 0.025 * dt;
    this.vx *= damp;
    this.vy *= damp;
    this.omega *= 1 - 0.18 * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle += this.omega * dt;
    if (this.angle > Math.PI) this.angle -= Math.PI * 2;
    if (this.angle < -Math.PI) this.angle += Math.PI * 2;
    this.cacheRotation();
  }

  solvePin() {
    if (this.fixed || this.sleeping || !this.pinned) return;
    const cs = Math.cos(this.angle);
    const sn = Math.sin(this.angle);
    const rx = cs * this.pinLocalX - sn * this.pinLocalY;
    const ry = sn * this.pinLocalX + cs * this.pinLocalY;
    this.x -= this.x + rx - this.pinX;
    this.y -= this.y + ry - this.pinY;

    for (let it = 0; it < 2; it++) {
      const vxp = this.vx - this.omega * ry;
      const vyp = this.vy + this.omega * rx;
      const k11 = this.invMass + this.invInertia * ry * ry;
      const k12 = -this.invInertia * rx * ry;
      const k22 = this.invMass + this.invInertia * rx * rx;
      const det = k11 * k22 - k12 * k12;
      if (det < 1e-12) break;
      const lx = (-vxp * k22 + vyp * k12) / det;
      const ly = (-vyp * k11 + vxp * k12) / det;
      this.vx += this.invMass * lx;
      this.vy += this.invMass * ly;
      this.omega += this.invInertia * (rx * ly - ry * lx);
    }
  }

  pointVx(rx, ry) {
    return this.sleeping ? 0 : this.vx - this.omega * ry;
  }

  pointVy(rx, ry) {
    return this.sleeping ? 0 : this.vy + this.omega * rx;
  }

  applyImpulse(ix, iy, rx, ry) {
    if (this.fixed || this.sleeping) return;
    this.vx += ix * this.invMass;
    this.vy += iy * this.invMass;
    this.omega += this.invInertia * (rx * iy - ry * ix);
  }

  moving() {
    return !this.fixed && Math.abs(this.vx) + Math.abs(this.vy) + Math.abs(this.omega) * this.boundRadius > 0.03;
  }
}

/* ============================ 水滴 ============================ */

class Drop {
  constructor(x, y, radius, index) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = radius;
    this.angle = 0;
    this.spin = 0;
    this.index = index;
    this.removed = false;
    this.collected = false;
    this.poison = false;
    this.sleeping = false;
    this.restTime = 0;
    this.ghost = false;
    this.fade = 0;
  }
}

/* ============================ 物理世界 ============================ */

class PhysicsWorld {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.calmMode = false;
    this.drops = [];
    this.bars = [];
    this.cellSize = 0.034;
    this.gridCols = Math.max(1, Math.ceil(width / this.cellSize));
    this.gridRows = Math.max(1, Math.ceil(height / this.cellSize));
    this.gridHead = new Int32Array(this.gridCols * this.gridRows).fill(-1);
    this.gridNext = new Int32Array(512);
    this.cp1x = 0;
    this.cp1y = 0;
    this.cp2x = 0;
    this.cp2y = 0;
  }

  addDrop(d) {
    this.drops.push(d);
  }

  addBar(b) {
    this.bars.push(b);
  }

  removeBar(b) {
    const i = this.bars.indexOf(b);
    if (i >= 0) this.bars.splice(i, 1);
  }

  wakeAll() {
    for (const d of this.drops) {
      if (!d.removed && !d.ghost) {
        d.sleeping = false;
        d.restTime = 0;
      }
    }
    for (const b of this.bars) {
      b.sleeping = false;
      b.restTime = 0;
    }
  }

  step(dt, iterations) {
    if (dt <= 0) return;
    dt = Math.min(dt, 1 / 120);

    for (const b of this.bars) {
      b.prevX = b.x;
      b.prevY = b.y;
      b.prevAngle = b.angle;
      b.integrate(dt, GRAVITY);
      if (this.calmMode && !b.fixed) {
        const metric = Math.abs(b.vx) + Math.abs(b.vy) + Math.abs(b.omega) * b.boundRadius;
        if (metric < 0.22) {
          b.vx *= 0.94;
          b.vy *= 0.94;
          b.omega *= 0.94;
        }
      }
      b.solvePin();
    }

    for (const d of this.drops) {
      if (d.removed || d.ghost || d.sleeping) continue;
      d.vy += GRAVITY * dt;
      const speed = Math.hypot(d.vx, d.vy);
      if (this.calmMode) {
        if (speed < 0.35) {
          d.vx *= 0.72;
          d.vy *= 0.5;
        } else if (speed < 0.8) {
          d.vx *= 0.9;
          d.vy *= 0.9;
        }
      }
      if (speed > 1e-7) {
        let dv = (AIR_DRAG_N / DROP_MASS) * dt;
        if (dv > speed) dv = speed;
        d.vx -= (d.vx / speed) * dv;
        d.vy -= (d.vy / speed) * dv;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.angle += d.spin * dt;
    }

    for (let it = 0; it < iterations; it++) {
      const bars = this.bars;
      for (let i = 0; i < bars.length; i++) {
        const a = bars[i];
        for (let j = i + 1; j < bars.length; j++) {
          const b = bars[j];
          if (a.fixed && b.fixed) continue;
          if (this.supportLinked(a, b)) continue;
          if ((a.noGround && b.ground) || (b.noGround && a.ground)) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) > a.boundRadius + b.boundRadius + 0.01) continue;
          this.collideBars(a, b);
        }
      }
      for (const d of this.drops) {
        if (d.removed || d.ghost || d.sleeping) continue;
        for (const b of bars) this.collideDropBar(d, b);
      }
      this.collideWaterGrid();
      for (const d of this.drops) {
        if (!d.removed && !d.ghost && !d.sleeping) this.collideEdges(d);
      }
      for (const b of bars) b.solvePin();
    }

    if (this.calmMode) {
      for (const d of this.drops) {
        if (d.removed || d.ghost || d.collected || d.sleeping) continue;
        if (Math.hypot(d.vx, d.vy) < 0.06) {
          d.restTime += dt;
          if (d.restTime > 0.35) {
            d.sleeping = true;
            d.vx = 0;
            d.vy = 0;
          }
        } else d.restTime = 0;
      }
      for (const b of this.bars) {
        if (b.fixed || !b.calmEligible || b.sleeping) continue;
        const metric = Math.abs(b.vx) + Math.abs(b.vy) + Math.abs(b.omega) * b.boundRadius;
        if (metric < 0.06) {
          b.restTime += dt;
          if (b.restTime > 0.35) {
            b.sleeping = true;
            b.vx = 0;
            b.vy = 0;
            b.omega = 0;
          }
        } else b.restTime = 0;
      }
    }

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (d.removed || d.ghost) continue;
      if (d.y > this.height + 0.35 || d.x < -0.4 || d.x > this.width + 0.4) d.removed = true;
    }
  }

  supportLinked(a, b) {
    if (a.supportId >= 0 && (b.ignoreSupportA === a.supportId || b.ignoreSupportB === a.supportId)) return true;
    if (b.supportId >= 0 && (a.ignoreSupportA === b.supportId || a.ignoreSupportB === b.supportId)) return true;
    return false;
  }

  cellX(x) {
    const v = Math.floor(x / this.cellSize);
    return v < 0 ? 0 : v >= this.gridCols ? this.gridCols - 1 : v;
  }

  cellY(y) {
    const v = Math.floor(y / this.cellSize);
    return v < 0 ? 0 : v >= this.gridRows ? this.gridRows - 1 : v;
  }

  collideWaterGrid() {
    const drops = this.drops;
    const n = drops.length;
    if (this.gridNext.length < n) this.gridNext = new Int32Array(Math.max(512, n * 2));
    this.gridHead.fill(-1);
    for (let i = 0; i < n; i++) {
      const d = drops[i];
      if (d.removed || d.ghost || d.sleeping) continue;
      const c = this.cellY(d.y) * this.gridCols + this.cellX(d.x);
      this.gridNext[i] = this.gridHead[c];
      this.gridHead[c] = i;
    }
    for (let i = 0; i < n; i++) {
      const a = drops[i];
      if (a.removed || a.ghost || a.sleeping) continue;
      const cx = this.cellX(a.x);
      const cy = this.cellY(a.y);
      for (let oy = -1; oy <= 1; oy++) {
        const yy = cy + oy;
        if (yy < 0 || yy >= this.gridRows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const xx = cx + ox;
          if (xx < 0 || xx >= this.gridCols) continue;
          let j = this.gridHead[yy * this.gridCols + xx];
          while (j >= 0) {
            if (j > i) {
              const b = drops[j];
              if (!b.removed && !b.ghost && !b.sleeping) this.collideDrops(a, b);
            }
            j = this.gridNext[j];
          }
        }
      }
    }
  }

  collideDrops(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const rr = a.radius + b.radius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return;
    if (d2 < 1e-12) {
      a.x -= 0.0002;
      b.x += 0.0002;
      return;
    }
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const pen = rr - d;
    const corr = pen * 0.55;
    a.x -= nx * corr * 0.5;
    a.y -= ny * corr * 0.5;
    b.x += nx * corr * 0.5;
    b.y += ny * corr * 0.5;

    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const j = (-(1 + 0.03) * vn) / (DROP_INV_MASS * 2);
      a.vx -= j * nx * DROP_INV_MASS;
      a.vy -= j * ny * DROP_INV_MASS;
      b.vx += j * nx * DROP_INV_MASS;
      b.vy += j * ny * DROP_INV_MASS;
      const tx = -ny;
      const ty = nx;
      const vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
      let jt = -vt / (DROP_INV_MASS * 2);
      const max = Math.abs(j) * 0.06;
      if (jt > max) jt = max;
      if (jt < -max) jt = -max;
      a.vx -= jt * tx * DROP_INV_MASS;
      a.vy -= jt * ty * DROP_INV_MASS;
      b.vx += jt * tx * DROP_INV_MASS;
      b.vy += jt * ty * DROP_INV_MASS;
    }
  }

  collideDropBar(d, b) {
    if (b.waterPass || b.sleeping) return;
    let bestPen = -1;
    let bestSeg = -1;
    let bestCx = 0;
    let bestCy = 0;
    let bestDx = 0;
    let bestDy = 0;
    let bestDist = 0;
    for (let i = 0; i < b.segCount(); i++) {
      this.closestPointOnSegment(d.x, d.y, b.segAx(i), b.segAy(i), b.segBx(i), b.segBy(i));
      const dx = d.x - this.cp1x;
      const dy = d.y - this.cp1y;
      const dist = Math.hypot(dx, dy);
      const pen = d.radius + b.radius - dist;
      if (pen > bestPen) {
        bestPen = pen;
        bestSeg = i;
        bestCx = this.cp1x;
        bestCy = this.cp1y;
        bestDx = dx;
        bestDy = dy;
        bestDist = dist;
      }
    }
    if (bestSeg < 0 || bestPen <= 0) return;

    let nx;
    let ny;
    if (bestDist < 1e-7) {
      const lx = b.segBx(bestSeg) - b.segAx(bestSeg);
      const ly = b.segBy(bestSeg) - b.segAy(bestSeg);
      nx = -ly;
      ny = lx;
      const len = Math.hypot(nx, ny);
      if (len < 1e-9) {
        nx = 0;
        ny = -1;
      } else {
        nx /= len;
        ny /= len;
      }
      if ((d.x - b.x) * nx + (d.y - b.y) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
    } else {
      nx = bestDx / bestDist;
      ny = bestDy / bestDist;
    }

    const totalInv = DROP_INV_MASS + b.invMass;
    if (totalInv <= 0) return;
    const corr = (bestPen * 0.75) / totalInv;
    d.x += nx * corr * DROP_INV_MASS;
    d.y += ny * corr * DROP_INV_MASS;
    if (!b.fixed) {
      b.x -= nx * corr * b.invMass;
      b.y -= ny * corr * b.invMass;
    }

    const rx = bestCx - b.x;
    const ry = bestCy - b.y;
    const vpx = d.vx - b.pointVx(rx, ry);
    const vpy = d.vy - b.pointVy(rx, ry);
    const vn = vpx * nx + vpy * ny;
    if (vn >= 0) return;

    const rn = rx * ny - ry * nx;
    const k = DROP_INV_MASS + b.invMass + b.invInertia * rn * rn;
    if (k <= 1e-12) return;
    const e = Math.min(WATER_RESTITUTION, b.restitution);
    const j = (-(1 + e) * vn) / k;
    d.vx += j * nx * DROP_INV_MASS;
    d.vy += j * ny * DROP_INV_MASS;
    b.applyImpulse(-j * nx, -j * ny, rx, ry);

    const tx = -ny;
    const ty = nx;
    const vt = (d.vx - b.pointVx(rx, ry)) * tx + (d.vy - b.pointVy(rx, ry)) * ty;
    const rt = rx * ty - ry * tx;
    const kt = DROP_INV_MASS + b.invMass + b.invInertia * rt * rt;
    let jt = -vt / Math.max(kt, 1e-12);
    const mu = (WATER_FRICTION + b.friction) * 0.5;
    const max = Math.abs(j) * mu;
    if (jt > max) jt = max;
    if (jt < -max) jt = -max;
    d.vx += jt * tx * DROP_INV_MASS;
    d.vy += jt * ty * DROP_INV_MASS;
    b.applyImpulse(-jt * tx, -jt * ty, rx, ry);
  }

  collideBars(a, b) {
    if (a.sleeping || b.sleeping) return;
    for (let si = 0; si < a.segCount(); si++) {
      for (let sj = 0; sj < b.segCount(); sj++) {
        this.collideBarSegments(a, si, b, sj);
      }
    }
  }

  collideBarSegments(a, si, b, sj) {
    this.closestSegmentSegment(
      a.segAx(si), a.segAy(si), a.segBx(si), a.segBy(si),
      b.segAx(sj), b.segAy(sj), b.segBx(sj), b.segBy(sj),
    );
    let nx = this.cp2x - this.cp1x;
    let ny = this.cp2y - this.cp1y;
    const d2 = nx * nx + ny * ny;
    const rr = a.radius + b.radius;
    if (d2 >= rr * rr) return;
    let d = Math.sqrt(d2);
    if (d < 1e-7) {
      const dx = a.segBx(si) - a.segAx(si);
      const dy = a.segBy(si) - a.segAy(si);
      nx = -dy;
      ny = dx;
      const len = Math.hypot(nx, ny);
      if (len < 1e-9) {
        nx = 0;
        ny = -1;
      } else {
        nx /= len;
        ny /= len;
      }
      if ((b.x - a.x) * nx + (b.y - a.y) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      d = 1e-7;
    } else {
      nx /= d;
      ny /= d;
    }
    const pen = rr - d;
    const invSum = a.invMass + b.invMass;
    if (invSum <= 0) return;
    const px = (this.cp1x + this.cp2x) * 0.5;
    const py = (this.cp1y + this.cp2y) * 0.5;
    const corr = (pen * 0.68) / invSum;
    a.x -= nx * corr * a.invMass;
    a.y -= ny * corr * a.invMass;
    b.x += nx * corr * b.invMass;
    b.y += ny * corr * b.invMass;

    const rax = px - a.x;
    const ray = py - a.y;
    const rbx = px - b.x;
    const rby = py - b.y;
    const rvx = b.pointVx(rbx, rby) - a.pointVx(rax, ray);
    const rvy = b.pointVy(rbx, rby) - a.pointVy(rax, ray);
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return;
    const ran = rax * ny - ray * nx;
    const rbn = rbx * ny - rby * nx;
    const k = a.invMass + b.invMass + a.invInertia * ran * ran + b.invInertia * rbn * rbn;
    if (k <= 1e-12) return;
    const e = Math.min(a.restitution, b.restitution);
    const j = (-(1 + e) * vn) / k;
    a.applyImpulse(-j * nx, -j * ny, rax, ray);
    b.applyImpulse(j * nx, j * ny, rbx, rby);

    const tx = -ny;
    const ty = nx;
    const vt = (b.pointVx(rbx, rby) - a.pointVx(rax, ray)) * tx
      + (b.pointVy(rbx, rby) - a.pointVy(rax, ray)) * ty;
    const rat = rax * ty - ray * tx;
    const rbt = rbx * ty - rby * tx;
    const kt = a.invMass + b.invMass + a.invInertia * rat * rat + b.invInertia * rbt * rbt;
    let jt = -vt / Math.max(kt, 1e-12);
    const mu = (a.friction + b.friction) * 0.5;
    const max = Math.abs(j) * mu;
    if (jt > max) jt = max;
    if (jt < -max) jt = -max;
    a.applyImpulse(-jt * tx, -jt * ty, rax, ray);
    b.applyImpulse(jt * tx, jt * ty, rbx, rby);
  }

  collideEdges(d) {
    const r = d.radius;
    if (d.x < r) {
      d.x = r;
      if (d.vx < 0) d.vx = -d.vx * 0.22;
      d.vy *= 0.995;
    } else if (d.x > this.width - r) {
      d.x = this.width - r;
      if (d.vx > 0) d.vx = -d.vx * 0.22;
      d.vy *= 0.995;
    }
    if (d.y < r) {
      d.y = r;
      if (d.vy < 0) d.vy = -d.vy * 0.15;
    } else if (d.y > this.height - r) {
      d.y = this.height - r;
      if (d.vy > 0) d.vy = -d.vy * 0.12;
      d.vx *= 0.96;
    }
  }

  closestPointOnSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 1e-12 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    this.cp1x = ax + abx * t;
    this.cp1y = ay + aby * t;
  }

  closestSegmentSegment(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1x = bx - ax;
    const d1y = by - ay;
    const d2x = dx - cx;
    const d2y = dy - cy;
    const rx = ax - cx;
    const ry = ay - cy;
    const a = d1x * d1x + d1y * d1y;
    const e = d2x * d2x + d2y * d2y;
    const f = d2x * rx + d2y * ry;
    let s;
    let t;
    const EPS = 1e-12;
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    if (a <= EPS && e <= EPS) {
      s = 0;
      t = 0;
    } else if (a <= EPS) {
      s = 0;
      t = clamp01(f / e);
    } else {
      const c = d1x * rx + d1y * ry;
      if (e <= EPS) {
        t = 0;
        s = clamp01(-c / a);
      } else {
        const b = d1x * d2x + d1y * d2y;
        const denom = a * e - b * b;
        s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
        t = (b * s + f) / e;
        if (t < 0) {
          t = 0;
          s = clamp01(-c / a);
        } else if (t > 1) {
          t = 1;
          s = clamp01((b - c) / a);
        }
      }
    }
    this.cp1x = ax + d1x * s;
    this.cp1y = ay + d1y * s;
    this.cp2x = cx + d2x * t;
    this.cp2y = cy + d2y * t;
  }
}

export { Bar, Drop, PhysicsWorld };


/* ============================ 关卡对象辅助 ============================ */

/** 三点贝塞尔圆弧：把"起点/经过点/终点"换算成二次贝塞尔的控制点 */
function arcPoint(s, t) {
  const u = 1 - t;
  const qx = 2 * s.xm - (s.x1 + s.x2) * 0.5;
  const qy = 2 * s.ym - (s.y1 + s.y2) * 0.5;
  return {
    x: u * u * s.x1 + 2 * u * t * qx + t * t * s.x2,
    y: u * u * s.y1 + 2 * u * t * qy + t * t * s.y2,
  };
}

function segCenter(s) {
  return { x: (s.x1 + s.x2) * 0.5, y: (s.y1 + s.y2) * 0.5 };
}

/** 沿折线走 travel 距离后的位置与单位切向（原版 pathPosition 的直译） */
function pathPosition(m, travel) {
  const pts = m.points;
  const n = pts.length;
  if (n === 0) return [m.x1, m.y1, 0, 0];
  if (n === 1) return [pts[0].x, pts[0].y, 0, 0];
  let total = 0;
  for (let i = 0; i < n - 1; i++) total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  if (m.loop) total += Math.hypot(pts[0].x - pts[n - 1].x, pts[0].y - pts[n - 1].y);
  if (total < 1e-6 || m.speed <= 0) return [pts[0].x, pts[0].y, 0, 0];

  let cycle;
  let dirSign = 1;
  if (m.loop) cycle = travel % total;
  else {
    const t = travel % (2 * total);
    if (t <= total) cycle = t;
    else {
      cycle = 2 * total - t;
      dirSign = -1;
    }
  }
  const segments = m.loop ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    if (cycle <= len) {
      const f = cycle / len;
      return [a.x + dx * f, a.y + dy * f, (dx / len) * dirSign, (dy / len) * dirSign];
    }
    cycle -= len;
  }
  return [pts[0].x, pts[0].y, 0, 0];
}

/* ============================ 关卡世界 ============================ */

/**
 * 一局游戏的全部状态。
 *
 * 生命周期：new GameWorld(level, seed) → update(dt)… → state 变成 won/lost。
 * 状态机跟原版完全一致：
 *   ready   —— 只画线，物理完全冻结（否则玩家画线时水会先流下去）
 *   running —— 出水 + 物理
 *   won/lost—— 结算后仍继续跑物理，让画面自然停下，不要"啪"地定住
 */
export class GameWorld {
  constructor(level, seed) {
    this.level = level;
    this.seed = seed >>> 0 || 1;
    this.rng = makeRng(this.seed);
    this.state = 'ready';
    this.physics = null;
    this.lines = [];
    this.supportBars = [];
    this.fireBars = [];
    this.mudBars = [];
    this.bubbles = [];
    this.poisonBalls = [];
    this.poisonSources = [];
    this.steams = [];
    this.solidBalls = [];
    this.movers = [];
    this.fireBall = null;
    this.cupBody = null;
    this.cupLocalInnerLeft = 0;
    this.cupLocalInnerRight = 0;
    this.cupLocalTop = 0;
    this.cupLocalBottom = 0;
    this.spawned = 0;
    this.dropsInCup = 0;
    this.poisonDropsInCup = 0;
    this.maxDropsInCup = 0;
    this.time = 0;
    this.runTime = 0;
    this.sinceLastSpawn = 0;
    this.stillTimer = 0;
    this.cupOutTimer = 0;
    this.completeTimer = 0;
    this.manualEndTimer = 0;
    this.manualEndRequested = false;
    this.endReason = '';
    this.failReason = '';
    this.elapsedAtWin = 0;
    this.linesAtWin = 0;
    this.firstLineLength = -1;
    this.totalLineLength = 0;
    this.toast = '';
    this.toastTimer = 0;
    this.motionClock = 0;
    this.allSpawned = false;
    this.accumulator = 0;
    this.pixelsPerMeter = 1800;
    this.load();
  }

  get cupRimY() {
    return this.level.cupBottomY - CUP_H;
  }

  get cupLeft() {
    return this.level.cupCx - CUP_W * 0.5;
  }

  get cupRight() {
    return this.level.cupCx + CUP_W * 0.5;
  }

  /** 杯内水量百分比（0..100），界面上的进度条直接用它 */
  get percent() {
    return Math.min(100, this.dropsInCup / 2);
  }

  load() {
    this.physics = new PhysicsWorld(WORLD_W, WORLD_H);
    this.lines = [];
    this.supportBars = [];
    this.fireBars = [];
    this.mudBars = [];
    this.bubbles = [];
    this.poisonBalls = [];
    this.poisonSources = [];
    this.steams = [];
    this.solidBalls = [];
    this.movers = [];
    this.fireBall = null;
    this.cupBody = null;
    this.motionClock = 0;
    this.state = 'ready';
    this.failReason = '';
    this.spawned = 0;
    this.dropsInCup = 0;
    this.poisonDropsInCup = 0;
    this.maxDropsInCup = 0;
    this.time = 0;
    this.runTime = 0;
    this.sinceLastSpawn = 0;
    this.stillTimer = 0;
    this.firstLineLength = -1;
    this.totalLineLength = 0;
    this.cupOutTimer = 0;
    this.completeTimer = 0;
    this.manualEndTimer = 0;
    this.manualEndRequested = false;
    this.endReason = '';
    this.accumulator = 0;
    this.allSpawned = false;
    this.toast = '';
    this.toastTimer = 0;
    this.buildWorld();
  }

  buildWorld() {
    const L = this.level;
    const p = this.physics;

    const ground = Bar.capsule(-0.2, 0.955, 0.8, 0.955, 0.011, 0, true);
    ground.tag = TAG.GROUND;
    ground.ground = true;
    p.addBar(ground);

    // 杯子是一整块"U 形"动态刚体：水在杯里被推被撞时，杯子自己也会动，
    // 而且已经计入的水量不会因为杯子倾斜而减少——这是原版的核心设定。
    const wall = CUP_WALL;
    const left = this.cupLeft;
    const right = this.cupRight;
    const rim = this.cupRimY;
    const bottom = L.cupBottomY;
    const lx = left + wall * 0.5;
    const rx = right - wall * 0.5;
    const by = bottom - wall * 0.5;
    this.cupBody = Bar.polyline([lx, lx, rx, rx], [rim, by, by, rim], 4, wall * 0.5, 4.6, false);
    this.cupBody.tag = TAG.CUP;
    this.cupBody.restitution = 0.1;
    this.cupBody.friction = 0.55;
    p.addBar(this.cupBody);
    this.cupLocalInnerLeft = left + wall - this.cupBody.x;
    this.cupLocalInnerRight = right - wall - this.cupBody.x;
    this.cupLocalTop = rim - this.cupBody.y;
    this.cupLocalBottom = bottom - wall - this.cupBody.y;

    const pipe = Bar.capsule(L.faucetX, 0.015, L.faucetX, 0.15, 0.02, 0, true);
    pipe.tag = TAG.FAUCET;
    p.addBar(pipe);
    const collar = Bar.capsule(L.faucetX - 0.032, 0.092, L.faucetX + 0.032, 0.092, 0.011, 0, true);
    collar.tag = TAG.FAUCET;
    p.addBar(collar);

    // 支撑弧：11 段折线近似一条贝塞尔弧，够平滑且碰撞稳定
    L.supports.forEach((s, i) => {
      const n = 11;
      const xs = [];
      const ys = [];
      for (let k = 0; k < n; k++) {
        const q = arcPoint(s, k / (n - 1));
        xs.push(q.x);
        ys.push(q.y);
      }
      const b = Bar.polyline(xs, ys, n, 0.0048, 1.0, s.motion == null);
      b.tag = s.kind === 2 ? TAG.FIRE_LINE : s.kind === 1 ? TAG.WALL : TAG.SUPPORT;
      b.supportId = i;
      if (s.motion) {
        this.makeKinematic(b, s.motion, (s.x1 + s.xm + s.x2) / 3, (s.y1 + s.ym + s.y2) / 3);
        this.movers.push({ bar: b, circle: null, seg: null, support: s, motion: s.motion, angle0: 0, baseAngle: b.angle });
      }
      p.addBar(b);
      this.supportBars.push(b);
      if (s.kind === 2) this.fireBars.push(b);
    });

    for (const s of L.segments) {
      const fire = s.kind === 2;
      const b = Bar.capsule(s.x1, s.y1, s.x2, s.y2, fire ? 0.0055 : 0.0065, 0, true);
      b.tag = fire ? TAG.FIRE_LINE : TAG.WALL;
      b.restitution = fire ? 0.28 : 0.12;
      b.friction = 0.35;
      if (s.motion) {
        const c = segCenter(s);
        this.makeKinematic(b, s.motion, c.x, c.y);
        this.movers.push({
          bar: b, circle: null, seg: s, support: null, motion: s.motion,
          angle0: orbit0At(c.x, c.y, s.motion), baseAngle: b.angle,
        });
      }
      p.addBar(b);
      if (fire) this.fireBars.push(b);
    }

    for (const o of L.circles) {
      if (o.kind === CIRCLE.BUBBLE) {
        this.bubbles.push({ def: o, used: false });
        if (o.motion) this.movers.push({ bar: null, circle: o, seg: null, support: null, motion: o.motion, angle0: orbit0At(o.cx, o.cy, o.motion), baseAngle: 0 });
      } else if (o.kind === CIRCLE.POISON_BALL) {
        this.poisonBalls.push({ def: o, used: false });
        if (o.motion) this.movers.push({ bar: null, circle: o, seg: null, support: null, motion: o.motion, angle0: orbit0At(o.cx, o.cy, o.motion), baseAngle: 0 });
      } else if (o.kind === CIRCLE.BALL) {
        // 实心球：质量按面积算，密度取 500 kg/m²，撞线才有力道
        const mass = Math.max(0.25, 500 * Math.PI * o.radius * o.radius);
        const b = Bar.capsule(o.cx, o.cy, o.cx + 0.002, o.cy, o.radius, mass, false);
        b.tag = TAG.BALL;
        b.circleShape = true;
        b.restitution = 0.18;
        b.friction = 0.4;
        o.motion = null;
        p.addBar(b);
        this.solidBalls.push({ bar: b, def: o });
      } else if (o.kind === CIRCLE.FIRE_BALL) {
        const mass = Math.max(0.35, (2.1 * o.radius * o.radius) / 0.0025);
        const b = Bar.capsule(o.cx, o.cy, o.cx + 0.002, o.cy, o.radius, mass, false);
        b.tag = TAG.FIRE_BALL;
        b.restitution = 0.24;
        b.friction = 0.45;
        b.noGround = true;
        o.motion = null;
        p.addBar(b);
        this.fireBars.push(b);
        this.fireBall = b;
      } else {
        const fixed = o.motion == null;
        const b = Bar.capsule(o.cx, o.cy, o.cx + 0.002, o.cy, o.radius, o.motion ? 1 : 0, fixed);
        b.tag = o.kind === CIRCLE.FIRE_RING ? TAG.FIRE_RING : TAG.WALL;
        b.restitution = o.kind === CIRCLE.FIRE_RING ? 0.3 : 0.12;
        b.friction = 0.32;
        if (o.motion) {
          this.makeKinematic(b, o.motion, o.cx, o.cy);
          this.movers.push({ bar: b, circle: o, seg: null, support: null, motion: o.motion, angle0: orbit0At(o.cx, o.cy, o.motion), baseAngle: b.angle });
        }
        p.addBar(b);
        if (o.kind === CIRCLE.FIRE_RING) this.fireBars.push(b);
      }
    }

    for (const pf of L.poisonFaucets) {
      this.poisonSources.push({ def: { ...pf, y: POISON_FAUCET_Y }, remaining: pf.count, timer: 0 });
    }
  }

  /** 机关改成"运动学"物体：不受力，但位置/速度每帧由轨道公式驱动 */
  makeKinematic(b, m, curX, curY) {
    b.kinematic = true;
    b.fixed = false;
    b.pinned = false;
    b.sleeping = false;
    b.calmEligible = false;
    b.invMass = 0;
    b.invInertia = 0;
    b.vx = 0;
    b.vy = 0;
    b.omega = 0;
    if (m.type === MOVE.LINEAR || m.type === MOVE.SPIN) {
      b.x = m.x1;
      b.y = m.y1;
    } else if (m.type === MOVE.PATH) {
      if (m.points.length > 0) {
        b.x = m.points[0].x;
        b.y = m.points[0].y;
      }
    } else {
      b.x = m.x1 + m.radius;
      b.y = m.y1;
      const dx = curX - m.x1;
      const dy = curY - m.y1;
      if (Math.hypot(dx, dy) > 1e-5) {
        b.x = curX;
        b.y = curY;
      }
    }
  }

  updateMovers() {
    for (const mv of this.movers) {
      const m = mv.motion;
      let px;
      let py;
      let vx;
      let vy;
      if (m.type === MOVE.LINEAR) {
        const dx = m.x2 - m.x1;
        const dy = m.y2 - m.y1;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6 || m.speed <= 0) {
          px = m.x1; py = m.y1; vx = 0; vy = 0;
        } else {
          const cycle = (this.motionClock * m.speed) % (2 * len);
          if (cycle <= len) {
            px = m.x1 + (dx * cycle) / len;
            py = m.y1 + (dy * cycle) / len;
            vx = (dx / len) * m.speed;
            vy = (dy / len) * m.speed;
          } else {
            const back = cycle - len;
            px = m.x2 - (dx * back) / len;
            py = m.y2 - (dy * back) / len;
            vx = (-dx / len) * m.speed;
            vy = (-dy / len) * m.speed;
          }
        }
      } else if (m.type === MOVE.PATH) {
        const q = pathPosition(m, this.motionClock * m.speed);
        px = q[0]; py = q[1]; vx = q[2] * m.speed; vy = q[3] * m.speed;
      } else if (m.type === MOVE.SPIN) {
        px = m.x1; py = m.y1; vx = 0; vy = 0;
      } else {
        const r = Math.max(0.005, m.radius);
        const ang = mv.angle0 + this.motionClock * (m.speed / r);
        px = m.x1 + Math.cos(ang) * r;
        py = m.y1 + Math.sin(ang) * r;
        vx = -Math.sin(ang) * m.speed;
        vy = Math.cos(ang) * m.speed;
      }
      const a = mv.baseAngle + m.spin * this.motionClock;
      if (mv.bar) {
        const b = mv.bar;
        b.prevX = b.x;
        b.prevY = b.y;
        b.prevAngle = b.angle;
        b.x = px; b.y = py; b.vx = vx; b.vy = vy; b.angle = a;
        b.cacheRotation();
      }
      if (mv.circle) {
        mv.circle.cx = px;
        mv.circle.cy = py;
      }
    }
  }

  startWater() {
    if (this.state !== 'ready') return;
    this.state = 'running';
    this.runTime = 0;
    this.sinceLastSpawn = 0;
    this.showToast('水龙头打开：225 颗水珠');
  }

  requestManualEnd() {
    if (this.state !== 'running' || this.manualEndRequested) return;
    this.manualEndRequested = true;
    this.manualEndTimer = 5;
    this.showToast('手动结束：5 秒后结算');
  }

  /**
   * 清空玩家画的线。
   * 【为什么运行中也能清】原来只允许 ready 阶段清线，但水一旦开始流，
   *   玩家发现线画歪了就只能整关重来，体验很糟。现在任何阶段都能清，
   *   已经接住的水珠照常计入——清线是「改布局」，不是「重置进度」。
   *   刚体从物理世界里移除后，已经落在上面的水珠会自然往下掉，
   *   这也符合直觉（线没了，水当然就漏下去）。
   */
  clearLines() {
    for (const gl of this.lines) this.physics.removeBar(gl.bar);
    this.lines = [];
    this.showToast('线已清空');
  }

  showToast(msg) {
    this.toast = msg;
    this.toastTimer = 2.2;
  }

  update(dt) {
    if (dt > 0.05) dt = 0.05;
    this.time += dt;
    if (this.toastTimer > 0) this.toastTimer = Math.max(0, this.toastTimer - dt);
    // 画线阶段完全冻结物理：否则玩家还在思考，水已经开始往下掉了
    if (this.state === 'ready') return;
    if (this.state === 'won' || this.state === 'lost') {
      this.stepPhysics(dt);
      this.updateCollection(dt);
      this.syncSolidBalls();
      return;
    }

    this.motionClock += dt;
    this.updateMovers();
    this.stepPhysics(dt);

    this.runTime += dt;
    this.sinceLastSpawn += dt;
    while (this.spawned < TOTAL_DROPS && this.sinceLastSpawn >= 0.02) {
      this.spawnWaterDrop(
        this.level.faucetX + (this.rng() - 0.5) * 0.003,
        FAUCET_SPOUT_Y + 0.004,
        false, 0, 0.15,
      );
      this.sinceLastSpawn -= 0.02;
    }
    if (this.spawned >= TOTAL_DROPS && !this.allSpawned) {
      this.allSpawned = true;
      for (const b of this.physics.bars) b.calmEligible = true;
    }
    this.physics.calmMode = false;
    this.updateHazards(dt);
    this.updateCollection(dt);
    this.syncSolidBalls();
    if (this.state !== 'running') return;

    // 1) 杯子被推出屏幕：给 5 秒宽限，还不回来就判负
    if (this.cupOffscreen()) {
      this.cupOutTimer += dt;
      if (this.cupOutTimer >= 5) {
        this.finish(false, '杯子离开屏幕 5 秒');
        return;
      }
    } else this.cupOutTimer = 0;

    // 2) 手动结束：固定 5 秒倒计时，给最后几颗水珠落下的时间
    if (this.manualEndRequested) {
      this.manualEndTimer -= dt;
      if (this.manualEndTimer <= 0) {
        if (this.dropsInCup >= TARGET_DROPS) this.finish(true, '手动结束 · 杯量达到 95%');
        else this.finish(false, '手动结束：只装到 ' + this.percent.toFixed(1) + '%，需达到 95%');
        return;
      }
    }

    // 3) 已经够了：再等 15 秒强制结算，防止某个物体永远在轻微抖动导致卡死
    if (this.dropsInCup >= TARGET_DROPS) {
      this.completeTimer += dt;
      if (this.completeTimer >= 15) {
        this.finish(true, '关卡已完成 · 15 秒结束');
        return;
      }
    } else this.completeTimer = 0;

    if (this.allSpawned) {
      if (this.everythingStill()) {
        this.stillTimer += dt;
        this.physics.calmMode = true;
      } else {
        this.stillTimer = 0;
        this.physics.calmMode = false;
      }
      if (this.stillTimer >= STILL_SECONDS) {
        if (this.dropsInCup >= TARGET_DROPS) this.finish(true, '杯量达到 95% · 所有物体静止');
        else this.finish(false, '只装到 ' + this.percent.toFixed(1) + '%，需达到 95%');
      }
    }
  }

  stepPhysics(dt) {
    this.accumulator += dt;
    let guard = 0;
    while (this.accumulator >= FIXED_DT && guard < 12) {
      this.physics.step(FIXED_DT, 2);
      this.accumulator -= FIXED_DT;
      guard++;
    }
  }

  finish(win, reason) {
    this.state = win ? 'won' : 'lost';
    this.endReason = reason;
    if (!win) this.failReason = reason;
    this.elapsedAtWin = this.runTime;
    this.linesAtWin = this.lines.length;
    this.physics.calmMode = false;
    this.showToast(reason);
  }

  cupOffscreen() {
    const c = this.cupBody;
    if (!c) return false;
    return c.x < -0.02 || c.x > WORLD_W + 0.02 || c.y < -0.02 || c.y > WORLD_H + 0.02;
  }

  everythingStill() {
    if (this.spawned < TOTAL_DROPS) return false;
    for (const d of this.physics.drops) {
      if (d.removed || d.ghost || d.sleeping || d.collected) continue;
      if (Math.hypot(d.vx, d.vy) > 0.06) return false;
    }
    for (const b of this.physics.bars) {
      if (b.fixed || b.kinematic || b.sleeping) continue;
      if (b.moving()) return false;
    }
    return true;
  }

  endingStatus() {
    if (this.manualEndRequested) return `手动结束 ${this.manualEndTimer.toFixed(1)} / 5.0 s`;
    if (this.cupOutTimer > 0) return `杯子离开屏幕 ${this.cupOutTimer.toFixed(1)} / 5.0 s`;
    if (this.completeTimer > 0) return `95% 已完成 · ${this.completeTimer.toFixed(1)} / 15.0 s`;
    if (this.allSpawned) return `所有物体静止 ${this.stillTimer.toFixed(1)} / 5.0 s`;
    return '';
  }

  spawnWaterDrop(x, y, poison, vx, vy) {
    const d = new Drop(x, y, DROP_RADIUS, this.spawned);
    d.angle = this.rng() * Math.PI * 2;
    d.spin = (this.rng() - 0.5) * 2;
    d.vx = vx;
    d.vy = vy;
    d.poison = poison;
    this.physics.addDrop(d);
    this.spawned++;
  }

  /** 被机关"释放"的水珠：不占用 225 颗的配额，带一点随机初速度散开 */
  spawnReleasedDrop(x, y, poison) {
    const a = this.rng() * Math.PI * 2;
    const sp = 0.25 + this.rng() * 0.55;
    const d = new Drop(
      x + Math.cos(a) * DROP_RADIUS,
      y + Math.sin(a) * DROP_RADIUS,
      DROP_RADIUS,
      this.spawned,
    );
    d.angle = this.rng() * Math.PI * 2;
    d.spin = (this.rng() - 0.5) * 2;
    d.vx = Math.cos(a) * sp;
    d.vy = Math.sin(a) * sp;
    d.poison = poison;
    this.physics.addDrop(d);
    this.physics.wakeAll();
  }

  updateHazards(dt) {
    for (const ps of this.poisonSources) {
      if (ps.remaining <= 0) continue;
      ps.timer += dt;
      while (ps.timer >= 0.055 && ps.remaining > 0) {
        ps.timer -= 0.055;
        this.spawnReleasedDrop(ps.def.x, ps.def.y, true);
        ps.remaining--;
      }
    }

    // 火焰线/环/球碰到水就蒸发
    for (let i = this.physics.drops.length - 1; i >= 0; i--) {
      const d = this.physics.drops[i];
      if (d.removed || d.ghost) continue;
      let burn = false;
      for (const b of this.fireBars) {
        const sweep = Math.hypot(b.vx, b.vy) * 0.035;
        if (this.circleBarDistance(b, d.x, d.y) < d.radius + b.radius + sweep) {
          burn = true;
          break;
        }
      }
      if (burn) {
        d.removed = true;
        this.addSteam(d.x, d.y, d.radius);
      }
    }

    for (const cs of this.bubbles) {
      if (cs.used || !this.touched(cs.def)) continue;
      cs.used = true;
      const n = this.releasedCount(cs.def.radius, 0.0005) * 2;
      for (let k = 0; k < n; k++) this.spawnReleasedDrop(cs.def.cx, cs.def.cy, false);
      this.addSteam(cs.def.cx, cs.def.cy, 0.03);
    }
    for (const cs of this.poisonBalls) {
      if (cs.used || !this.touched(cs.def)) continue;
      cs.used = true;
      const n = this.releasedCount(cs.def.radius, 0.001) * 2;
      for (let k = 0; k < n; k++) this.spawnReleasedDrop(cs.def.cx, cs.def.cy, true);
      this.addSteam(cs.def.cx, cs.def.cy, 0.02);
    }

    // 毒水 + 水 → 泥土（固定在原地挡水），这是第十四关的核心机制
    const drops = this.physics.drops;
    for (let i = 0; i < drops.length; i++) {
      const p = drops[i];
      if (p.removed || p.ghost || !p.poison) continue;
      for (let j = 0; j < drops.length; j++) {
        const w = drops[j];
        if (w === p || w.removed || w.ghost || w.poison) continue;
        if (Math.hypot(p.x - w.x, p.y - w.y) < p.radius + w.radius) {
          const mx = (p.x + w.x) * 0.5;
          const my = (p.y + w.y) * 0.5;
          p.removed = true;
          w.removed = true;
          this.addMud(mx, my);
          break;
        }
      }
    }

    // 火球掉进杯子 = 立刻失败
    if (this.fireBall && !this.fireBall.fixed) {
      if (this.insideCup(this.fireBall.x, this.fireBall.y)) {
        this.state = 'lost';
        this.failReason = '火球落入杯中';
        this.showToast('火球入杯 · 挑战失败');
        return;
      }
      if (this.fireBall.y > 1.5 || this.fireBall.x < -0.5 || this.fireBall.x > 1.1) {
        this.physics.removeBar(this.fireBall);
        this.fireBars = this.fireBars.filter((b) => b !== this.fireBall);
        this.fireBall = null;
      }
    }
    for (let i = this.steams.length - 1; i >= 0; i--) {
      const s = this.steams[i];
      s.life -= dt;
      s.y -= dt * 0.05;
      if (s.life <= 0) this.steams.splice(i, 1);
    }
  }

  releasedCount(radius, pct) {
    const px = radius * this.pixelsPerMeter;
    const area = Math.PI * px * px;
    return Math.max(1, Math.min(300, Math.round(area * pct)));
  }

  addSteam(x, y, size) {
    if (this.steams.length > 80) this.steams.shift();
    this.steams.push({ x, y, life: 0.8, maxLife: 0.8, size: Math.max(0.012, size) });
  }

  addMud(x, y) {
    const m = Bar.capsule(x, y, x + 0.002, y, DROP_RADIUS * 1.15, 0, true);
    m.tag = TAG.MUD;
    m.friction = 0.7;
    this.physics.addBar(m);
    this.mudBars.push(m);
    this.addSteam(x, y, DROP_RADIUS);
  }

  insideCup(x, y) {
    const c = this.cupBody;
    if (!c) return false;
    const dx = x - c.x;
    const dy = y - c.y;
    const lx = c.c * dx + c.s * dy;
    const ly = -c.s * dx + c.c * dy;
    return lx > this.cupLocalInnerLeft && lx < this.cupLocalInnerRight
      && ly > this.cupLocalTop && ly < this.cupLocalBottom + 0.01;
  }

  updateCollection(dt) {
    for (const d of this.physics.drops) {
      if (d.removed) continue;
      if (d.collected) {
        d.fade -= dt;
        if (d.fade <= 0) d.removed = true;
        continue;
      }
      if (!d.ghost && this.touchesCupSurface(d)) {
        d.collected = true;
        d.ghost = true;
        d.vx = 0;
        d.vy = 0;
        d.fade = ENTER_FADE_SECONDS;
        if (d.poison) {
          this.poisonDropsInCup++;
          this.dropsInCup = Math.max(0, this.dropsInCup - 1);
        } else {
          this.dropsInCup++;
          if (this.dropsInCup > this.maxDropsInCup) this.maxDropsInCup = this.dropsInCup;
        }
      }
    }
  }

  cupSurfaceLocalY() {
    const f = Math.min(1, this.dropsInCup / CUP_FULL_DROPS);
    return this.cupLocalBottom - f * (this.cupLocalBottom - this.cupLocalTop);
  }

  /**
   * 水珠只有"碰到水面"才算入杯。
   * 【为什么不能碰到杯壁就算】否则水珠贴着杯壁下滑时会被提前吸掉，
   *   杯子永远装不满，而且视觉上水珠凭空消失，非常出戏。
   */
  touchesCupSurface(d) {
    const c = this.cupBody;
    if (!c) return false;
    // 毒水不能凭空消失在干杯里，必须先有水才能反应
    if (d.poison && this.dropsInCup <= 0) return false;
    const dx = d.x - c.x;
    const dy = d.y - c.y;
    const lx = c.c * dx + c.s * dy;
    const ly = -c.s * dx + c.c * dy;
    if (lx < this.cupLocalInnerLeft || lx > this.cupLocalInnerRight) return false;
    if (ly < this.cupLocalTop - d.radius) return false;
    if (ly > this.cupLocalBottom + d.radius) return false;
    const surface = this.cupSurfaceLocalY();
    return ly + d.radius >= surface - 0.0005;
  }

  touched(c) {
    for (const d of this.physics.drops) {
      if (d.removed || d.ghost) continue;
      if (Math.hypot(d.x - c.cx, d.y - c.cy) < c.radius + d.radius) return true;
    }
    for (const b of this.physics.bars) {
      if (b.fixed) continue;
      const sweep = (Math.hypot(b.x - b.prevX, b.y - b.prevY)
        + Math.abs(b.angle - b.prevAngle) * b.boundRadius) * 0.55;
      const reach = c.radius + b.radius + sweep;
      if (this.barCircleDistance(b, c.cx, c.cy) < reach) return true;
      if (this.barCircleDistanceAt(b, c.cx, c.cy, b.prevX, b.prevY, b.prevAngle) < reach) return true;
    }
    return false;
  }

  barCircleDistanceAt(b, cx, cy, px, py, angle) {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    let best = Infinity;
    for (let i = 0; i < b.segCount(); i++) {
      const ax = px + ca * b.localX[i] - sa * b.localY[i];
      const ay = py + sa * b.localX[i] + ca * b.localY[i];
      const bx = px + ca * b.localX[i + 1] - sa * b.localY[i + 1];
      const by = py + sa * b.localX[i + 1] + ca * b.localY[i + 1];
      best = Math.min(best, distPointSeg(cx, cy, ax, ay, bx, by));
    }
    return best;
  }

  barCircleDistance(b, cx, cy) {
    let best = Infinity;
    for (let i = 0; i < b.segCount(); i++) {
      best = Math.min(best, distPointSeg(cx, cy, b.segAx(i), b.segAy(i), b.segBx(i), b.segBy(i)));
    }
    return best;
  }

  circleBarDistance(b, x, y) {
    return this.barCircleDistance(b, x, y);
  }

  syncSolidBalls() {
    for (const b of this.solidBalls) {
      b.def.cx = b.bar.x;
      b.def.cy = b.bar.y;
    }
  }

  nearestSupportPoint(x, y) {
    let best = { dist: Infinity, index: -1, x, y };
    this.level.supports.forEach((s, i) => {
      let prev = arcPoint(s, 0);
      for (let k = 1; k <= 16; k++) {
        const nx = arcPoint(s, k / 16);
        const abx = nx.x - prev.x;
        const aby = nx.y - prev.y;
        const len2 = abx * abx + aby * aby;
        let u = len2 > 1e-12 ? ((x - prev.x) * abx + (y - prev.y) * aby) / len2 : 0;
        u = Math.max(0, Math.min(1, u));
        const qx = prev.x + abx * u;
        const qy = prev.y + aby * u;
        const d = Math.hypot(x - qx, y - qy);
        if (d < best.dist) best = { dist: d, index: i, x: qx, y: qy };
        prev = nx;
      }
    });
    return best;
  }

  /**
   * 加一根玩家画的自由曲线。
   * 【为什么限长 60.5cm / 限 3 根】原版靠这两条约束保证"每关都有解"：
   *   线太长了随便一搭就能兜住水，关卡就失去意义。
   */
  addLinePath(rawX, rawY, rawN) {
    if (this.lines.length >= MAX_LINES) {
      this.showToast('最多 3 根线，先点「清线」');
      return null;
    }
    if (rawN < 2) return null;
    const cap = Math.min(40, rawN);
    const wx = [];
    const wy = [];
    for (let i = 0; i < rawN; i++) {
      if (i > 0 && Math.hypot(rawX[i] - wx[wx.length - 1], rawY[i] - wy[wy.length - 1]) < 0.004) continue;
      if (wx.length >= cap) break;
      wx.push(rawX[i]);
      wy.push(rawY[i]);
    }
    let n = wx.length;
    if (n < 2) {
      this.showToast('线太短了');
      return null;
    }
    if (n > 26) {
      const nx = [];
      const ny = [];
      for (let i = 0; i < 26; i++) {
        const t = (i / 25) * (n - 1);
        const j = Math.floor(t);
        const k = Math.min(n - 1, j + 1);
        const f = t - j;
        nx.push(wx[j] * (1 - f) + wx[k] * f);
        ny.push(wy[j] * (1 - f) + wy[k] * f);
      }
      wx.length = 0;
      wy.length = 0;
      wx.push(...nx);
      wy.push(...ny);
      n = 26;
    }
    let len = 0;
    for (let i = 0; i < n - 1; i++) len += Math.hypot(wx[i + 1] - wx[i], wy[i + 1] - wy[i]);
    if (len < LINE_MIN_LEN) {
      this.showToast('线太短了');
      return null;
    }
    if (len > LINE_MAX_LEN) {
      this.showToast('线太长：最长 60.5 cm');
      return null;
    }

    if (this.firstLineLength < 0) this.firstLineLength = len;
    this.totalLineLength += len;

    const bar = Bar.polyline(wx, wy, n, LINE_RADIUS, LINE_DENSITY, false);
    bar.restitution = 0.1;
    bar.friction = 0.22;
    bar.tag = TAG.LINE;
    this.physics.addBar(bar);
    this.physics.wakeAll();
    const gl = { bar, length: len, mass: bar.mass };
    this.lines.push(gl);
    this.showToast('自由曲线 · 会掉落，可搭在支撑弧上');
    return gl;
  }

  /** 把线的一端吸附到最近的支撑弧上（玩家想搭桥时的手感） */
  snapLineToSupport(gl, endA) {
    const b = gl.bar;
    const x = endA ? b.px(0) : b.px(b.pointCount - 1);
    const y = endA ? b.py(0) : b.py(b.pointCount - 1);
    const s = this.nearestSupportPoint(x, y);
    if (s.dist > SNAP_RADIUS) return false;
    if (endA) b.setPinLocalEndA(s.x, s.y);
    else b.setPinLocalEndB(s.x, s.y);
    return true;
  }
}

/** 点到线段的距离 */
function distPointSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 1e-12 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function orbit0At(cx, cy, m) {
  if (m.type !== MOVE.ORBIT) return 0;
  return Math.atan2(cy - m.y1, cx - m.x1);
}

