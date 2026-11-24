/**
 * MapRenderer：负责把 worldData 里的配置画成一张淡彩绘本地图。
 * 地面、溪流、小径、树木、亭子全部程序化绘制，不依赖图片资源。
 *
 * 换底图：public/assets/images/scene/bg_<地图 key>.png 存在时（如 bg_map_1_meadow），
 * 整层替换「草地 / 远山 / 溪流 / 小径 / 木桥」；树木、凉亭、石碑、人物、碎片、花瓣
 * 仍是独立图层，深度排序与碰撞完全不变。没有底图时走程序化绘制。
 *
 * 程序化绘制的水域 / 木桥 / 岔路都读地图配置（tiles / bridge / branch），
 * 六章各自的地形不需要改这份代码。
 * 施工单见 docs/art-scene-rebuild/README.md。
 */

import Phaser from 'phaser';

import { C } from '../config/theme.js';
import { collectObstacles } from './worldData.js';

function seededRandom(seed = 1234567) {
  let state = seed % 2147483647;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function drawRoundedBand(graphics, points, radius, color, alpha = 1) {
  graphics.fillStyle(color, alpha);
  points.forEach((point) => {
    graphics.fillCircle(point.x, point.y, radius);
  });
}

/**
 * 用折线近似一段二次贝塞尔曲线。
 * Phaser 的 Graphics 没有 quadraticCurveTo，山脊这类柔和线条只能自己采样。
 * @param {{x:number,y:number}} start 起点
 * @param {Array<{cx:number,cy:number,x:number,y:number}>} segments 每段：控制点 + 终点
 * @param {number} steps 每段采样步数
 * @returns {Array<{x:number,y:number}>} 从起点到终点的折线点
 */
function curvePoints(start, segments, steps = 10) {
  const points = [start];
  let current = start;
  segments.forEach((segment) => {
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const rest = 1 - t;
      points.push({
        x: rest * rest * current.x + 2 * rest * t * segment.cx + t * t * segment.x,
        y: rest * rest * current.y + 2 * rest * t * segment.cy + t * t * segment.y,
      });
    }
    current = { x: segment.x, y: segment.y };
  });
  return points;
}

/** 把折线点写进 Graphics 当前路径（不 begin/stroke，调用方自己收尾） */
function tracePoints(graphics, points) {
  graphics.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => graphics.lineTo(point.x, point.y));
}

export class MapRenderer {
  constructor(scene, mapConfig) {
    this.scene = scene;
    this.config = mapConfig;
    this.width = mapConfig.size.width;
    this.height = mapConfig.size.height;
    this.obstacles = [];
    this.rand = seededRandom(mapConfig.chapterId * 991 + 17);
  }

  /**
   * 绘制整张地图。
   * @returns {Array<{x, y, width, height}>} 静态碰撞盒
   */
  render() {
    // 有整幅底图就只画底图；否则按原来的分层程序化绘制
    const groundKey = this.config.key ? `bg_${this.config.key}` : '';
    if (groundKey && this.scene.textures.exists(groundKey)) {
      this._drawGroundImage(groundKey);
    } else {
      this._drawGround();
      this._drawBackdrop();
      this._drawWater();
      this._drawPath();
      this._drawGroundDetails();
      this._drawBridge();
    }
    this._drawDecorations();
    this._drawCornerOrnaments();
    this._drawAmbientPetals();
    this._collectObstacles();
    return this.obstacles;
  }

  /**
   * 铺整幅地形底图（树 / 亭 / 石碑 / 人物是独立图层，不画在底图里）。
   * 说明书要求底图尺寸 = 地图配置尺寸；这里再用 displaySize 兜底铺满，
   * 万一尺寸略差也不会露出背景底色（离线校验会先把尺寸不符拦下来）。
   */
  _drawGroundImage(key) {
    this.scene.add
      .image(0, 0, key)
      .setOrigin(0)
      .setDisplaySize(this.width, this.height)
      .setDepth(-100);
  }

  /**
   * 远景：地图上缘叠三层淡色山影，让草甸有纵深。
   * 画在地面之上、水面之下，不影响行走与碰撞。
   */
  _drawBackdrop() {
    const { hill } = this.config.palette;
    const graphics = this.scene.add.graphics().setDepth(-95);

    // 最远一层：几乎融进纸色的山影
    const farRidge = curvePoints({ x: -40, y: 260 }, [
      { cx: 320, cy: 40, x: 700, y: 250 },
      { cx: 1050, cy: 30, x: 1380, y: 240 },
      { cx: 1760, cy: 50, x: 2080, y: 250 },
      { cx: 2320, cy: 120, x: 2460, y: 260 },
    ]);
    graphics.fillStyle(hill, 0.16);
    graphics.beginPath();
    tracePoints(graphics, farRidge);
    graphics.lineTo(2460, -40);
    graphics.lineTo(-40, -40);
    graphics.closePath();
    graphics.fillPath();

    // 中景：颜色稍深，山脊更清楚
    const midRidge = curvePoints({ x: -40, y: 300 }, [
      { cx: 420, cy: 130, x: 820, y: 296 },
      { cx: 1220, cy: 120, x: 1580, y: 300 },
      { cx: 1980, cy: 150, x: 2460, y: 310 },
    ]);
    graphics.fillStyle(hill, 0.24);
    graphics.beginPath();
    tracePoints(graphics, midRidge);
    graphics.lineTo(2460, -40);
    graphics.lineTo(-40, -40);
    graphics.closePath();
    graphics.fillPath();

    // 山顶几棵小树剪影
    graphics.fillStyle(0x8fae84, 0.28);
    [{ x: 480, y: 196 }, { x: 1250, y: 190 }, { x: 1870, y: 210 }].forEach(({ x, y }) => {
      graphics.fillTriangle(x - 14, y, x, y - 34, x + 14, y);
      graphics.fillTriangle(x - 11, y + 16, x, y - 12, x + 11, y + 16);
    });

    // 山脚一层很淡的雾带，把远山和草地连起来
    graphics.fillStyle(0xfffdf4, 0.4);
    graphics.fillRect(-40, 300, this.width + 80, 44);
  }

  _drawGround() {
    const { grassTop, grassBottom, grassDeep } = this.config.palette;
    const graphics = this.scene.add.graphics().setDepth(-100);
    graphics.fillGradientStyle(grassTop, grassTop, grassBottom, grassBottom, 1);
    graphics.fillRect(0, 0, this.width, this.height);

    // 草地色块，避免大片纯色
    for (let i = 0; i < 46; i += 1) {
      const x = this.rand() * this.width;
      const y = this.rand() * this.height;
      const w = 160 + this.rand() * 340;
      const h = 90 + this.rand() * 200;
      graphics.fillStyle(grassDeep, 0.08 + this.rand() * 0.08);
      graphics.fillEllipse(x, y, w, h);
    }

    // 远山似的淡色晕染
    graphics.fillStyle(0xf7f5e6, 0.28);
    graphics.fillEllipse(500, 120, 900, 260);
    graphics.fillEllipse(1750, 90, 980, 220);

    // 地图边缘的淡墨框
    graphics.lineStyle(8, C.paperSoft, 0.45);
    graphics.strokeRect(4, 4, this.width - 8, this.height - 8);
  }

  /**
   * 水域完全由 config.tiles 里的 water 图元驱动：
   *   贴住右边缘的矩形 → 纵向溪流；其余矩形 → 圆角水塘；ellipse → 椭圆水潭。
   * 这样第 2–6 章各自不同的水系不用再改绘制代码，碰撞也用同一份坐标。
   */
  _drawWater() {
    const waterTiles = (this.config.tiles || []).filter((tile) => tile.type === 'water');
    waterTiles.forEach((tile) => {
      if (tile.shape === 'ellipse') this._drawEllipseWater(tile);
      else if (tile.x + tile.w >= this.width - 4) this._drawStreamWater(tile);
      else this._drawPoolWater(tile);
    });
    this._drawStreamRocks(waterTiles);
  }

  /** 右侧溪流：手绘感的左岸线 + 沙洲 + 深水带 + 水纹 */
  _drawStreamWater(tile) {
    const { water, waterDeep, bank } = this.config.palette;
    const graphics = this.scene.add.graphics().setDepth(-80);
    const edgeX = tile.x;
    const top = tile.y - 40;
    const bottom = tile.y + tile.h + 40;
    const phase = (this.config.chapterId || 1) * 1.7;
    const edge = [];
    const steps = 8;
    for (let i = 0; i <= steps; i += 1) {
      const y = top + ((bottom - top) * i) / steps;
      edge.push({ x: edgeX + Math.sin(i * 1.7 + phase) * 26, y });
    }

    // 左岸沙洲
    graphics.fillStyle(bank, 0.65);
    this._fillPolygon(graphics, edge, this.width, this.height, -26);
    graphics.fillStyle(water, 1);
    this._fillPolygon(graphics, edge, this.width, this.height, 0);
    // 靠右的深水带
    graphics.fillStyle(waterDeep, 0.35);
    this._fillPolygon(graphics, edge, this.width, this.height, Math.min(90, tile.w * 0.45));

    // 水纹
    const inset = Math.max(10, Math.min(40, tile.w * 0.22));
    const stepX = Math.max(6, Math.min(22, tile.w * 0.12));
    const span = Math.max(18, Math.min(76, tile.w - inset - 12));
    graphics.lineStyle(3, 0xffffff, 0.4);
    const count = Math.max(6, Math.round(tile.h / 110));
    for (let i = 0; i < count; i += 1) {
      const y = tile.y + 70 + i * ((tile.h - 140) / Math.max(1, count - 1));
      const x = edgeX + inset + (i % 3) * stepX;
      graphics.beginPath();
      graphics.moveTo(x, y);
      graphics.lineTo(x + span * 0.27, y - 6);
      graphics.lineTo(x + span * 0.54, y);
      graphics.lineTo(x + span * 0.78, y - 6);
      graphics.lineTo(x + span, y);
      graphics.strokePath();
    }
    graphics.lineStyle(1.6, waterDeep, 0.3);
    for (let i = 0; i < 8; i += 1) {
      const y = 160 + i * 150;
      const x = edgeX + Math.max(30, tile.w * 0.35);
      graphics.beginPath();
      graphics.moveTo(x, y);
      graphics.lineTo(x + 40, y + 8);
      graphics.lineTo(x + 80, y);
      graphics.strokePath();
    }
  }

  /** 圆角水塘（第一章左下角水湾、书院荷池一类） */
  _drawPoolWater(tile) {
    const { water, waterDeep, bank } = this.config.palette;
    const graphics = this.scene.add.graphics().setDepth(-80);
    const radius = Math.min(tile.w, tile.h) * 0.45;

    graphics.fillStyle(bank, 0.7);
    graphics.fillRoundedRect(tile.x - 22, tile.y - 18, tile.w + 44, tile.h + 36, radius + 14);
    graphics.fillStyle(water, 0.96);
    graphics.fillRoundedRect(tile.x, tile.y, tile.w, tile.h, radius);
    graphics.fillStyle(waterDeep, 0.24);
    graphics.fillRoundedRect(
      tile.x + tile.w * 0.42,
      tile.y + 8,
      tile.w * 0.52,
      Math.max(8, tile.h - 16),
      Math.max(6, radius * 0.7),
    );

    graphics.lineStyle(2, 0xffffff, 0.36);
    for (let i = 0; i < 4; i += 1) {
      const y = tile.y + tile.h * (0.3 + i * 0.16);
      graphics.beginPath();
      graphics.moveTo(tile.x + tile.w * 0.18, y);
      graphics.lineTo(tile.x + tile.w * 0.3, y - 6);
      graphics.lineTo(tile.x + tile.w * 0.42, y);
      graphics.strokePath();
    }

    this._drawLilies(tile.x + tile.w / 2, tile.y + tile.h / 2, tile.w / 2, tile.h / 2);
  }

  /** 椭圆水潭（飞瀑潭、山涧积水） */
  _drawEllipseWater(tile) {
    const { water, waterDeep, bank } = this.config.palette;
    const { cx, cy, rx, ry } = tile;
    const graphics = this.scene.add.graphics().setDepth(-80);

    graphics.fillStyle(bank, 0.72);
    graphics.fillEllipse(cx, cy, rx * 2 + 44, ry * 2 + 34);
    graphics.fillStyle(water, 0.96);
    graphics.fillEllipse(cx, cy, rx * 2, ry * 2);
    graphics.fillStyle(waterDeep, 0.22);
    graphics.fillEllipse(cx + rx * 0.3, cy + ry * 0.1, rx * 1.3, ry * 1.35);

    graphics.lineStyle(2, 0xffffff, 0.34);
    for (let i = 0; i < 3; i += 1) {
      const y = cy - ry * 0.35 + i * ry * 0.5;
      graphics.beginPath();
      graphics.moveTo(cx - rx * 0.45, y);
      graphics.lineTo(cx - rx * 0.22, y - 5);
      graphics.lineTo(cx, y);
      graphics.strokePath();
    }

    this._drawLilies(cx, cy, rx, ry);
  }

  /** 水面上的荷叶与浮萍，让水塘不只是纯色（水太小则不画） */
  _drawLilies(cx, cy, rx, ry) {
    if (ry < 55) return;
    const water = this.config.palette.water;
    const lily = this.scene.add.graphics().setDepth(-78);
    [
      { dx: -0.55, dy: -0.28, r: 16 },
      { dx: -0.3, dy: 0.3, r: 12 },
      { dx: 0.42, dy: -0.18, r: 14 },
    ].forEach((pad) => {
      const x = cx + rx * pad.dx;
      const y = cy + ry * pad.dy;
      lily.fillStyle(0xa9c396, 0.85);
      lily.fillCircle(x, y, pad.r);
      lily.fillStyle(water, 0.9);
      lily.fillTriangle(x, y, x + pad.r, y - pad.r * 0.5, x + pad.r, y + pad.r * 0.5);
      lily.lineStyle(1, 0x89a97a, 0.5);
      lily.strokeCircle(x, y, pad.r);
    });
    lily.fillStyle(0xf3c6bd, 0.9);
    lily.fillCircle(cx + rx * 0.05, cy + ry * 0.12, 4.5);
    lily.fillStyle(0xf1e3bd, 0.9);
    lily.fillCircle(cx + rx * 0.08, cy + ry * 0.18, 3);
  }

  /** 溪边小石（只画在贴着右边缘的溪流旁） */
  _drawStreamRocks(waterTiles) {
    const streams = waterTiles.filter((tile) => tile.shape !== 'ellipse' && tile.x + tile.w >= this.width - 4);
    if (streams.length === 0) return;

    const rockGraphics = this.scene.add.graphics().setDepth(-70);
    streams.forEach((tile) => {
      for (let i = 0; i < 13; i += 1) {
        const x = tile.x - 50 + this.rand() * 60;
        const y = tile.y + 100 + this.rand() * Math.max(1, tile.h - 200);
        rockGraphics.fillStyle(0xcfc9b7, 0.85);
        rockGraphics.fillEllipse(x, y, 18 + this.rand() * 26, 10 + this.rand() * 14);
        rockGraphics.lineStyle(1, 0x8f8876, 0.35);
        rockGraphics.strokeEllipse(x, y, 18 + this.rand() * 20, 10 + this.rand() * 10);
      }
    });
  }

  _fillPolygon(graphics, edge, width, height, offsetX) {
    graphics.beginPath();
    graphics.moveTo(edge[0].x + offsetX, edge[0].y);
    edge.forEach((point) => {
      graphics.lineTo(point.x + offsetX, point.y);
    });
    graphics.lineTo(width + 40, height + 40);
    graphics.lineTo(width + 40, -40);
    graphics.closePath();
    graphics.fillPath();
  }

  _drawPath() {
    const { path, pathLight, grassDeep } = this.config.palette;
    const points = this.config.path;
    const spline = new Phaser.Curves.Spline(points);
    const sampled = spline.getPoints(160);
    const graphics = this.scene.add.graphics().setDepth(-60);

    // 路边阴影
    drawRoundedBand(graphics, sampled.map((p) => ({ x: p.x + 2, y: p.y + 4 })), 61, 0x8a9870, 0.1);
    // 外圈
    drawRoundedBand(graphics, sampled, 58, 0xe6d9b8, 0.85);
    // 内圈
    drawRoundedBand(graphics, sampled, 48, path, 1);
    drawRoundedBand(graphics, sampled, 36, pathLight, 0.5);

    // 路面碎石与草点
    for (let i = 0; i < 66; i += 1) {
      const p = sampled[Math.floor(this.rand() * sampled.length)];
      const angle = this.rand() * Math.PI * 2;
      const dist = this.rand() * 34;
      const x = p.x + Math.cos(angle) * dist;
      const y = p.y + Math.sin(angle) * dist;
      graphics.fillStyle(i % 3 === 0 ? grassDeep : 0xd8c8a5, 0.35);
      graphics.fillEllipse(x, y, 4 + this.rand() * 8, 3 + this.rand() * 4);
    }

    // 岔路：由地图配置给出（第一章通向牧童的小亭）
    const branchPoints = this.config.branch;
    if (branchPoints && branchPoints.length > 1) {
      const branch = new Phaser.Curves.Spline(branchPoints);
      drawRoundedBand(graphics, branch.getPoints(24), 34, path, 0.95);
    }
  }

  /** 是否落在水域图元上（草丛 / 花丛不画进水里） */
  _isInWater(x, y) {
    return (this.config.tiles || []).some((tile) => {
      if (tile.type !== 'water') return false;
      if (tile.shape === 'ellipse') {
        const dx = (x - tile.cx) / tile.rx;
        const dy = (y - tile.cy) / tile.ry;
        return dx * dx + dy * dy <= 1;
      }
      return x >= tile.x && x <= tile.x + tile.w && y >= tile.y && y <= tile.y + tile.h;
    });
  }

  _drawGroundDetails() {
    const graphics = this.scene.add.graphics().setDepth(-40);
    const { grassDeep } = this.config.palette;

    // 草丛
    for (let i = 0; i < 220; i += 1) {
      const x = this.rand() * this.width;
      const y = this.rand() * this.height;
      if (this._isInWater(x, y)) continue;
      graphics.lineStyle(1.6, grassDeep, 0.35 + this.rand() * 0.25);
      graphics.beginPath();
      const h = 5 + this.rand() * 9;
      graphics.moveTo(x, y);
      graphics.lineTo(x - 3, y - h);
      graphics.moveTo(x, y);
      graphics.lineTo(x + 3, y - h * 0.8);
      graphics.strokePath();
    }

    // 花丛：淡粉、淡黄的小花
    for (let i = 0; i < 70; i += 1) {
      const x = 60 + this.rand() * (this.width - 260);
      const y = 100 + this.rand() * (this.height - 200);
      if (this._isInWater(x, y)) continue;
      const color = i % 3 === 0 ? 0xf5cdc4 : i % 3 === 1 ? 0xf3e3b0 : 0xf9f4de;
      graphics.fillStyle(color, 0.9);
      for (let j = 0; j < 4; j += 1) {
        const angle = (j / 4) * Math.PI * 2;
        graphics.fillCircle(x + Math.cos(angle) * 3, y + Math.sin(angle) * 3, 2.2);
      }
      graphics.fillStyle(C.gold, 0.85);
      graphics.fillCircle(x, y, 1.8);
    }

    // 几块青苔与小蘑菇
    for (let i = 0; i < 14; i += 1) {
      const x = 200 + this.rand() * 1700;
      const y = 300 + this.rand() * 900;
      graphics.fillStyle(0x9fb690, 0.22);
      graphics.fillEllipse(x, y, 40 + this.rand() * 50, 22 + this.rand() * 26);
    }
  }

  _drawDecorations() {
    (this.config.decors || []).forEach((decor) => {
      const scale = decor.scale || 1;
      if (!this.scene.textures.exists(decor.type)) return;
      const image = this.scene.add
        .image(decor.x, decor.y, decor.type)
        .setOrigin(0.5, 1)
        .setScale(scale)
        .setDepth(decor.y);
      if (decor.flipX) image.setFlipX(true);
    });
  }

  _drawBridge() {
    const bridge = this.config.bridge;
    if (!bridge) return;
    const baseX = bridge.x;
    const baseY = bridge.y;
    const length = bridge.length || 260;
    const graphics = this.scene.add.graphics().setDepth(360);

    // 桥下淡影
    graphics.fillStyle(0x6f8d7f, 0.14);
    graphics.fillEllipse(baseX + length / 2, baseY + 62, length + 8, 32);

    graphics.lineStyle(3, 0x8c6f4e, 0.8);
    graphics.fillStyle(0xd5b98b, 1);
    graphics.fillRoundedRect(baseX, baseY, length, 46, 8);
    graphics.strokeRoundedRect(baseX, baseY, length, 46, 8);
    graphics.lineStyle(1.6, 0xa8865f, 0.8);
    const plankGap = (length - 20) / 9;
    for (let i = 0; i <= 9; i += 1) {
      graphics.beginPath();
      graphics.moveTo(baseX + 10 + i * plankGap, baseY + 4);
      graphics.lineTo(baseX + 10 + i * plankGap, baseY + 42);
      graphics.strokePath();
    }

    // 两侧栏杆
    graphics.lineStyle(2, 0x876848, 0.85);
    [0, 26].forEach((offsetY) => {
      graphics.beginPath();
      graphics.moveTo(baseX + 4, baseY - 18 + offsetY);
      graphics.lineTo(baseX + length - 4, baseY - 18 + offsetY);
      graphics.strokePath();
    });
    const postGap = (length - 24) / 6;
    for (let i = 0; i <= 6; i += 1) {
      const postX = baseX + 12 + i * postGap;
      graphics.beginPath();
      graphics.moveTo(postX, baseY);
      graphics.lineTo(postX, baseY - 18);
      graphics.strokePath();
      graphics.fillStyle(0x9d7d57, 0.9);
      graphics.fillCircle(postX, baseY - 20, 3);
    }

    // 桥头两盏小红灯笼，作为「可以过桥」的提示
    [baseX - 4, baseX + length + 4].forEach((lanternX) => {
      graphics.fillStyle(0xd97a6c, 0.92);
      graphics.fillEllipse(lanternX, baseY - 34, 12, 15);
      graphics.lineStyle(1.2, 0xa85a4e, 0.8);
      graphics.strokeEllipse(lanternX, baseY - 34, 12, 15);
      graphics.fillStyle(0xe9c47c, 0.95);
      graphics.fillRect(lanternX - 4, baseY - 43, 8, 4);
      graphics.lineStyle(1.4, 0xd9b06a, 0.8);
      graphics.beginPath();
      graphics.moveTo(lanternX, baseY - 42);
      graphics.lineTo(lanternX, baseY - 52);
      graphics.strokePath();
    });
  }

  /** 地图四角的淡云纹，收住整张画纸的边 */
  _drawCornerOrnaments() {
    const graphics = this.scene.add.graphics().setDepth(-20);
    const corners = [
      { x: 12, y: 12, sx: 1, sy: 1 },
      { x: this.width - 12, y: 12, sx: -1, sy: 1 },
      { x: 12, y: this.height - 12, sx: 1, sy: -1 },
      { x: this.width - 12, y: this.height - 12, sx: -1, sy: -1 },
    ];
    corners.forEach(({ x, y, sx, sy }) => {
      graphics.lineStyle(3, C.gold, 0.28);
      graphics.beginPath();
      graphics.moveTo(x, y + 78 * sy);
      graphics.lineTo(x, y);
      graphics.lineTo(x + 78 * sx, y);
      graphics.strokePath();
      graphics.lineStyle(2, C.pine, 0.22);
      graphics.beginPath();
      const cloud = curvePoints(
        { x: x + 10 * sx, y: y + 52 * sy },
        [{ cx: x + 18 * sx, cy: y + 18 * sy, x: x + 52 * sx, y: y + 10 * sy }],
        8,
      );
      tracePoints(graphics, cloud);
      graphics.strokePath();
      graphics.fillStyle(C.gold, 0.32);
      graphics.fillCircle(x + 16 * sx, y + 16 * sy, 3);
    });
  }

  _drawAmbientPetals() {
    if (!this.scene.textures.exists('petal')) return;
    for (let i = 0; i < 10; i += 1) {
      const x = 200 + this.rand() * 1800;
      const y = 200 + this.rand() * 1000;
      const petal = this.scene.add
        .image(x, y, 'petal')
        .setScale(0.45 + this.rand() * 0.45)
        .setAlpha(0.28 + this.rand() * 0.3)
        .setDepth(y + 30)
        .setAngle(this.rand() * 180);
      this.scene.tweens.add({
        targets: petal,
        x: x + (this.rand() > 0.5 ? 120 : -120),
        y: y + 70,
        angle: petal.angle + 120,
        duration: 9000 + this.rand() * 5000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  _collectObstacles() {
    // 碰撞几何与自动布点共用 worldData 的同一份计算，避免「画的位置」和「挡的位置」两套坐标
    this.obstacles = collectObstacles(this.config);
    return this.obstacles;
  }
}
