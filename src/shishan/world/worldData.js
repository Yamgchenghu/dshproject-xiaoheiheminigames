/**
 * 章节地图定义。
 *
 * 六章各有一张 2400×1400 的可漫游地图：
 *   第一章 · 青芽谷（溪边草甸）用显式 interactions（手写诗碑位置）
 *   第二～六章用 autoNodes：按本章诗篇的 area 分簇、环状自动布点，
 *   避开水域与装饰物碰撞，节点之间保持最小间距。
 *
 * 新增片区只需要在 AREA_MAPS 里追加配置，MapScene 不需要改动。
 * 碰撞几何由 collectObstacles() 统一计算，MapRenderer 与自动布点共用同一份。
 */

import { dataManager } from '../data/DataManager.js';
import {
  ANECDOTE_FRAGMENT_RULES,
  FRAGMENT_SPOT_DEFAULTS,
  fragmentKeyOf,
} from '../config/anecdoteFragments.js';
import { getGameSpotRule } from '../config/gameSpots.js';

// ---------------------------------------------------------
// 碰撞几何（水域 / 石头 / 装饰物）
// ---------------------------------------------------------

/** 椭圆水塘用多少条横条近似碰撞（条数越多越贴合，代价是多几个静态体） */
const ELLIPSE_COLLISION_STRIPS = 12;

/** 各类装饰物的碰撞盒（宽 / 高 / 相对落点的纵向偏移）
 *  pad 给角色用；nodePad 给石碑布点用（树冠比树干碰撞盒宽得多，碑不能贴着树画） */
const DECOR_COLLISION = {
  pavilion: { width: 230, height: 54, offsetY: -30, pad: 52, nodePad: 104 },
  rock: { width: 110, height: 46, offsetY: -18, pad: 44, nodePad: 78 },
  tree_round: { width: 54, height: 36, offsetY: -22, pad: 58, nodePad: 126 },
  tree_blossom: { width: 54, height: 36, offsetY: -22, pad: 58, nodePad: 126 },
  tree_pine: { width: 46, height: 34, offsetY: -20, pad: 58, nodePad: 118 },
};

/**
 * 把地图配置里的水域 / 石头 / 装饰物换算成静态碰撞矩形。
 * 返回的每一项都带 pad（布点时给石碑留的安全间距），渲染与物理只用到 x/y/w/h。
 */
export function collectObstacles(mapConfig) {
  const obstacles = [];
  if (!mapConfig) return obstacles;

  (mapConfig.tiles || []).forEach((tile) => {
    if (tile.type !== 'water' && tile.type !== 'rock' && !tile.collide) return;

    if (tile.shape === 'ellipse') {
      // 椭圆水塘：按横条切片，既贴合水面又保持矩形物理体
      const rx = Number(tile.rx) || 0;
      const ry = Number(tile.ry) || 0;
      if (rx <= 0 || ry <= 0) return;
      const stripHeight = (ry * 2) / ELLIPSE_COLLISION_STRIPS;
      for (let i = 0; i < ELLIPSE_COLLISION_STRIPS; i += 1) {
        const centerY = tile.cy - ry + (i + 0.5) * stripHeight;
        const ratio = Math.sqrt(Math.max(0, 1 - ((centerY - tile.cy) / ry) ** 2));
        const halfWidth = rx * ratio;
        if (halfWidth <= 1) continue;
        obstacles.push({
          x: tile.cx,
          y: centerY,
          width: halfWidth * 2,
          height: stripHeight + 0.6,
          pad: 74,
          nodePad: 78,
        });
      }
      return;
    }

    const width = Number(tile.w) || 0;
    const height = Number(tile.h) || 0;
    if (width <= 0 || height <= 0) return;
    obstacles.push({
      x: tile.x + width / 2,
      y: tile.y + height / 2,
      width,
      height,
      pad: tile.type === 'water' ? 78 : 54,
      nodePad: tile.type === 'water' ? 78 : 58,
    });
  });

  (mapConfig.decors || []).forEach((decor) => {
    if (!decor.collide) return;
    const scale = decor.scale || 1;
    const rule = DECOR_COLLISION[decor.type] || { width: 50, height: 36, offsetY: -24, pad: 50 };
    obstacles.push({
      x: decor.x,
      y: decor.y + rule.offsetY,
      width: rule.width * (decor.type === 'pavilion' ? 1 : scale),
      height: rule.height * (decor.type === 'pavilion' ? 1 : scale),
      pad: rule.pad,
      nodePad: rule.nodePad,
    });
  });

  return obstacles;
}

// ---------------------------------------------------------
// 自动布点（第二～六章）
// ---------------------------------------------------------

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

function cnOrdinal(value) {
  const number = Math.max(1, Math.min(99, Number(value) || 1));
  if (number <= 10) return CN_DIGITS[number];
  if (number < 20) return `十${CN_DIGITS[number - 10]}`;
  const tens = Math.floor(number / 10);
  const ones = number % 10;
  return `${CN_DIGITS[tens]}十${ones ? CN_DIGITS[ones] : ''}`;
}

/** 石碑之间至少留这么多像素，名牌才不会叠在一起 */
const NODE_MIN_GAP = 172;

function clampPoint(point, bounds) {
  const x = point.x;
  const y = point.y;
  point.x = Math.min(bounds.maxX, Math.max(bounds.minX, point.x));
  point.y = Math.min(bounds.maxY, Math.max(bounds.minY, point.y));
  return Math.abs(point.x - x) > 0.5 || Math.abs(point.y - y) > 0.5;
}

/**
 * 石碑 / 木牌不能立在主路正中：碑心离路中心线至少这么远
 * （路面半宽 58 + 碑座半宽 26 + 余量）。否则角色沿路走会从碑面上穿过去。
 */
export const NODE_ROAD_CLEARANCE = 96;

/**
 * 诗碑离指路木牌（簇心）至少这么远：
 * 以前碑是围着路牌摆一圈（半径 170），看上去整簇都挤在牌子脚下。
 */
export const NODE_SIGN_CLEARANCE = 200;

/** 点到主路折线的最近距离（自动布点与数据校验共用） */
export function distanceToPath(path, x, y) {
  if (!path || path.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i];
    const b = path[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t)));
  }
  return best;
}

/** 把落在路面上的点推到路边；返回是否移动过 */
export function pushOffRoad(point, path, clearance) {
  if (!path || path.length < 2) return false;

  let moved = false;
  // 拐弯处一次推不到位（离这段远了、离下一段又近了），最多推 4 次
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let best = null;
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const distance = Math.hypot(point.x - px, point.y - py);
      if (!best || distance < best.distance) {
        const length = Math.sqrt(len2) || 1;
        best = { distance, px, py, nx: dy / length, ny: -dx / length };
      }
    }
    if (!best || best.distance >= clearance) break;

    // 沿「最近点 → 碑」的方向往外推（拐弯处比死用某一段的法线更可靠）
    const dx = point.x - best.px;
    const dy = point.y - best.py;
    let nx = best.distance > 0.5 ? dx / best.distance : best.nx;
    let ny = best.distance > 0.5 ? dy / best.distance : best.ny;
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || Math.hypot(nx, ny) < 0.001) {
      nx = 0;
      ny = -1;
    }
    // 正好压在中心线上时没有方向：默认往画面上方让开
    if (best.distance < 0.5 && ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    point.x = best.px + nx * clearance;
    point.y = best.py + ny * clearance;
    moved = true;
  }
  return moved;
}

/** 把点推到矩形外（pad 为额外安全距离）；返回是否移动过 */
function pushOutOfRect(point, rect, pad) {
  const left = rect.x - rect.width / 2 - pad;
  const right = rect.x + rect.width / 2 + pad;
  const top = rect.y - rect.height / 2 - pad;
  const bottom = rect.y + rect.height / 2 + pad;
  if (point.x <= left || point.x >= right || point.y <= top || point.y >= bottom) return false;

  const distances = [point.x - left, right - point.x, point.y - top, bottom - point.y];
  const nearest = Math.min(...distances);
  if (nearest === distances[0]) point.x = left;
  else if (nearest === distances[1]) point.x = right;
  else if (nearest === distances[2]) point.y = top;
  else point.y = bottom;
  return true;
}

/**
 * 收尾用：把点推到矩形外，但挑「既离开障碍、又不落回主路」的那条边。
 * 树冠的 nodePad 很宽，直接选最近的一边会把碑又推回路面（碑就立在路中间了）。
 */
function pushOutOfRectClear(point, rect, pad, path, clearance) {
  const left = rect.x - rect.width / 2 - pad;
  const right = rect.x + rect.width / 2 + pad;
  const top = rect.y - rect.height / 2 - pad;
  const bottom = rect.y + rect.height / 2 + pad;
  if (point.x <= left || point.x >= right || point.y <= top || point.y >= bottom) return false;

  const fromX = point.x;
  const fromY = point.y;
  const candidates = [
    { x: left, y: fromY },
    { x: right, y: fromY },
    { x: fromX, y: top },
    { x: fromX, y: bottom },
  ].filter((candidate) => !path || distanceToPath(path, candidate.x, candidate.y) >= clearance);

  const pick = candidates.length > 0
    // 前提是离开主路：在这些边里挑离原位最近的那条
    ? candidates.reduce((best, candidate) => (
      Math.hypot(candidate.x - fromX, candidate.y - fromY) < Math.hypot(best.x - fromX, best.y - fromY)
        ? candidate
        : best
    ))
    // 四条边都会落回路面：退而求其次，挑离主路最远的那条
    : [
      { x: left, y: fromY },
      { x: right, y: fromY },
      { x: fromX, y: top },
      { x: fromX, y: bottom },
    ].reduce((best, candidate) => (path && distanceToPath(path, candidate.x, candidate.y)
      > distanceToPath(path, best.x, best.y) ? candidate : best));

  point.x = pick.x;
  point.y = pick.y;
  return true;
}

/**
 * 椭圆水域的「真椭圆」约束：碰撞盒用 12 条横条近似，布点时如果只按横条推，
 * 点会卡在两条横条之间的椭圆里（看起来碑脚泡在水里）。布点收尾对椭圆单独推。
 */
export function collectEllipses(mapConfig) {
  return (mapConfig?.tiles || [])
    .filter((tile) => tile.type === 'water' && tile.shape === 'ellipse')
    .map((tile) => ({
      cx: Number(tile.cx) || 0,
      cy: Number(tile.cy) || 0,
      rx: Number(tile.rx) || 0,
      ry: Number(tile.ry) || 0,
      pad: 78,
    }))
    .filter((ellipse) => ellipse.rx > 0 && ellipse.ry > 0);
}

/** 把点沿径向推到椭圆外（pad 为额外安全距离）；返回是否移动过 */
function pushOutOfEllipse(point, ellipse, pad) {
  const dx = point.x - ellipse.cx;
  const dy = point.y - ellipse.cy;
  const scale = Math.hypot(dx / (ellipse.rx + pad), dy / (ellipse.ry + pad));
  if (scale >= 1) return false;
  if (scale < 0.001) {
    // 正好落在水塘中心：随便挑一个方向推到东岸
    point.x = ellipse.cx + ellipse.rx + pad;
    point.y = ellipse.cy;
    return true;
  }
  point.x = ellipse.cx + dx / scale;
  point.y = ellipse.cy + dy / scale;
  return true;
}

/** 点在「椭圆 + pad」里面（含边界） */
function ellipsePenetrates(point, ellipse, pad) {
  return Math.hypot(
    (point.x - ellipse.cx) / (ellipse.rx + pad),
    (point.y - ellipse.cy) / (ellipse.ry + pad),
  ) < 1;
}

/**
 * 椭圆水塘贴着地图边界时，竖直方向让不开（推下岸会超出可走范围被边界顶回来），
 * 就走左右最近的岸边。返回是否真的挪动了。
 */
function settleOutOfEllipses(point, ellipses, bounds) {
  let moved = false;
  ellipses.forEach((ellipse) => {
    if (!ellipsePenetrates(point, ellipse, ellipse.pad)) return;
    const dy = Math.max(-ellipse.ry, Math.min(ellipse.ry, point.y - ellipse.cy));
    const halfWidth = (ellipse.rx + ellipse.pad)
      * Math.sqrt(Math.max(0, 1 - (dy / (ellipse.ry + ellipse.pad)) ** 2));
    const targetX = point.x >= ellipse.cx
      ? ellipse.cx + halfWidth + 1
      : ellipse.cx - halfWidth - 1;
    const before = point.x;
    point.x = Math.min(bounds.maxX, Math.max(bounds.minX, targetX));
    if (Math.abs(point.x - before) > 0.5) moved = true;
  });
  return moved;
}

/** 批量版本（relaxPoints 一轮收尾用） */
function settleOutOfEllipsesPoints(points, ellipses, bounds) {
  let moved = false;
  points.forEach((point) => {
    if (point.fixed || ellipses.length === 0) return;
    if (settleOutOfEllipses(point, ellipses, bounds)) moved = true;
  });
  return moved;
}

/**
 * 把环状布点推开：① 离开主路（碑不能立在路中间）；
 * ② 离开水域 / 石头 / 装饰物碰撞盒（带 pad），椭圆水域按真椭圆推；
 * ③ 节点之间保持 NODE_MIN_GAP；④ 收进可走边界。多轮迭代直到稳定。
 * @param {{path:Array, clearance:number}|null} road 主路让位规则（不传就不让路）
 * @param {Array} ellipses 椭圆水域（见 collectEllipses）
 */
function relaxPoints(points, obstacles, bounds, road = null, ellipses = []) {
  if (points.length === 0) return;

  for (let iteration = 0; iteration < 20; iteration += 1) {
    let moved = false;

    points.forEach((point) => {
      if (point.fixed) return;
      if (road && pushOffRoad(point, road.path, road.clearance)) moved = true;
      obstacles.forEach((rect) => {
        if (pushOutOfRect(point, rect, rect.nodePad || rect.pad || 70)) moved = true;
      });
      ellipses.forEach((ellipse) => {
        if (pushOutOfEllipse(point, ellipse, ellipse.pad)) moved = true;
      });
    });

    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i];
        const b = points[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        // 固定点（路牌）有自己的最小间距；普通碑之间用 NODE_MIN_GAP
        const gap = Math.max(NODE_MIN_GAP, a.fixed ? a.minGap || 0 : 0, b.fixed ? b.minGap || 0 : 0);
        if (distance >= gap) continue;
        if (a.fixed && b.fixed) continue;
        // 指路木牌（fixed）钉在簇心不动，只把石碑推开，避免整簇被挤走
        const push = (gap - distance) / 2 + 0.5;
        const ux = distance > 0.001 ? dx / distance : 1;
        const uy = distance > 0.001 ? dy / distance : 0;
        if (a.fixed) {
          b.x += ux * push * 2;
          b.y += uy * push * 2;
        } else if (b.fixed) {
          a.x -= ux * push * 2;
          a.y -= uy * push * 2;
        } else {
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
        moved = true;
      }
    }

    points.forEach((point) => {
      if (!point.fixed && clampPoint(point, bounds)) moved = true;
    });
    if (settleOutOfEllipsesPoints(points, ellipses, bounds)) moved = true;
    if (!moved) break;
  }
}

/**
 * 在簇心周围取一个环上落点。
 * 簇心贴着地图上 / 下边界时，正对着边界方向的落点会被边界压回来，
 * 反而挤到路牌脚下（距离只剩七八十像素）。这里按角度依次偏转，
 * 挑第一个「收进边界后仍离簇心 minGap 以上」且没被边界压扁的方向。
 */
function ringPointOnBounds(cluster, angle, ring, bounds, minGap) {
  const offsets = [0, 0.24, -0.24, 0.48, -0.48, 0.72, -0.72, 1, -1, 1.35, -1.35, Math.PI];
  let fallback = null;
  for (let i = 0; i < offsets.length; i += 1) {
    const a = angle + offsets[i];
    const rawX = cluster.x + Math.cos(a) * ring;
    const rawY = cluster.y + Math.sin(a) * ring;
    const x = Math.min(bounds.maxX, Math.max(bounds.minX, rawX));
    const y = Math.min(bounds.maxY, Math.max(bounds.minY, rawY));
    const distance = Math.hypot(x - cluster.x, y - cluster.y);
    if (distance < minGap) continue;
    // 被边界压扁的落点会让碑顺着边界排成一条线，优先选完整落在边界内的
    if (Math.abs(rawX - x) <= 1 && Math.abs(rawY - y) <= 1) return { x, y };
    if (!fallback || distance > fallback.distance) fallback = { x, y, distance };
  }
  return fallback ? { x: fallback.x, y: fallback.y } : { x: cluster.x, y: cluster.y + ring };
}

/**
 * 簇心贴边时，螺旋不该硬朝上（会全被边界压扁）。
 * 上方空地够就保持默认的「碑在上」，否则转向空地最多的那一边。
 */
function pickStartAngle(cluster, radius, bounds) {
  const sides = [
    { angle: -Math.PI / 2, room: cluster.y - bounds.minY },
    { angle: Math.PI / 2, room: bounds.maxY - cluster.y },
    { angle: Math.PI, room: cluster.x - bounds.minX },
    { angle: 0, room: bounds.maxX - cluster.x },
  ];
  const up = sides[0];
  if (up.room >= radius + 40) return up.angle;
  return sides.reduce((best, side) => (side.room > best.room ? side : best)).angle;
}

/**
 * 按诗篇的 area 把它们分到各个片区簇。
 * 布点（generateAutoInteractions）与施工单（collectClusterRings）共用这一份分组逻辑，
 * 保证给画师看的「环带范围」与游戏里真实摆碑的位置不会错位。
 */
function groupPoemsByCluster(mapConfig, clusters) {
  dataManager.getVisiblePoemsByChapter(mapConfig.chapterId).forEach((poem) => {
    const target = clusters.find((cluster) => cluster.area === poem.area)
      || clusters.reduce(
        (best, cluster) => (cluster.poems.length < best.poems.length ? cluster : best),
        clusters[0],
      );
    target.poems.push(poem);
  });
}

/** 簇的诗碑环半径：碑越多铺得越开（300–380），配置里显式写了 radius 就照用 */
export function autoClusterRadius(cluster, count) {
  return Number(cluster.radius) || Math.min(380, Math.max(300, count * 70));
}

/** 施工单用：每个片区实际使用的环半径与碑数（与游戏内布点同一套算法） */
export function collectClusterRings(mapConfig) {
  const clusters = (((mapConfig.autoNodes || {}).clusters) || []).map((cluster) => ({ ...cluster, poems: [] }));
  if (clusters.length === 0) return [];
  groupPoemsByCluster(mapConfig, clusters);
  return clusters
    .filter((cluster) => cluster.poems.length > 0)
    .map((cluster) => ({
      area: cluster.area,
      count: cluster.poems.length,
      radius: autoClusterRadius(cluster, cluster.poems.length),
    }));
}

/**
 * 按诗篇所属 area 自动生成诗碑与区域路牌。
 * 每簇环状排布，簇心放一块指路木牌（不写诗题，只说这一带叫什么）。
 */
function generateAutoInteractions(mapConfig) {
  const layout = mapConfig.autoNodes || {};
  const clusters = (layout.clusters || []).map((cluster) => ({ ...cluster, poems: [] }));
  if (clusters.length === 0) return [];

  groupPoemsByCluster(mapConfig, clusters);

  const obstacles = collectObstacles(mapConfig);
  const bounds = {
    minX: 140,
    maxX: mapConfig.size.width - 160,
    // 上方留到 240：环状布点铺得比较开，簇心靠上的那一簇会往北顶，
    // 只留 300 会把好几块碑挤在同一条边界线上，间距反而不够。
    minY: 240,
    maxY: mapConfig.size.height - 120,
  };

  const points = [];
  const interactions = [];

  clusters.forEach((cluster) => {
    const count = cluster.poems.length;
    if (count === 0) return;

    // 碑不能都挤在路牌脚下：按数量铺成一条「由内向外」的螺旋，
    // 半径一次比一次大，同簇相邻两碑的弧长也跟着拉开，
    // 看上去是散在片区各处，而不是围着路牌摆一圈。
    const radius = autoClusterRadius(cluster, count);
    const startAngle = Number.isFinite(cluster.startAngle)
      ? cluster.startAngle
      : pickStartAngle(cluster, radius, bounds);

    interactions.push({
      id: `ch${mapConfig.chapterId}_sign_${cluster.area}`,
      kind: 'sign',
      label: cluster.area,
      x: cluster.x,
      y: cluster.y,
      message: cluster.signMessage
        || `这里是${cluster.area}。附近的诗碑都亮着微光，走近了就能读。`,
    });
    // 指路木牌钉在簇心：参与石碑之间的互斥，但自己不动；
    // 且碑必须离它 NODE_SIGN_CLEARANCE 以上，不能挤在路牌脚下
    points.push({
      x: cluster.x,
      y: cluster.y,
      fixed: true,
      minGap: NODE_SIGN_CLEARANCE,
    });

    cluster.poems.forEach((poem, index) => {
      const angle = startAngle + (index * Math.PI * 2) / Math.max(count, 3) + index * 0.35;
      // 最内一圈也留出 0.78 半径，最近的碑离路牌也有 230px 以上
      const ring = count === 1
        ? radius
        : radius * (0.78 + 0.22 * (index / Math.max(1, count - 1)));
      const point = ringPointOnBounds(cluster, angle, ring, bounds, NODE_SIGN_CLEARANCE);
      points.push(point);
      interactions.push({
        id: `ch${mapConfig.chapterId}_stone_${poem.id}`,
        kind: 'scroll',
        // 碑名只说「哪一带的第几块」，不能出现诗题（看图猜诗要靠画面猜）
        label: `${cluster.prefix || cluster.area}诗碑 · ${cnOrdinal(index + 1)}`,
        hint: poem.scene_note || '',
        poemId: poem.id,
        point,
      });
    });
  });

  relaxPoints(points, obstacles, bounds, {
    path: mapConfig.path,
    clearance: NODE_ROAD_CLEARANCE,
  }, collectEllipses(mapConfig));

  interactions.forEach((item) => {
    if (!item.point) return;
    item.x = Math.round(item.point.x);
    item.y = Math.round(item.point.y);
    delete item.point;
  });

  return interactions;
}

/** 隐藏诗碑的位置由地图配置给出，诗篇本身来自 poem_db 的 is_hidden */
function generateAutoHiddenSteles(mapConfig) {
  const spots = (mapConfig.autoNodes && mapConfig.autoNodes.hidden) || [];
  if (spots.length === 0) return [];

  return dataManager
    .getHiddenPoemsByChapter(mapConfig.chapterId)
    .slice(0, spots.length)
    .map((poem, index) => {
      const spot = spots[index];
      return {
        id: `ch${mapConfig.chapterId}_hidden_${poem.id}`,
        poemId: poem.id,
        x: spot.x,
        y: spot.y,
        name: spot.name || '苔痕诗碑',
        appearsRadius: spot.appearsRadius || 330,
        triggerRadius: spot.triggerRadius || 130,
        hint: spot.hint || poem.scene_note || '',
      };
    });
}

/**
 * 第一章：青芽谷 · 溪边草甸
 * 设计成 2400×1400 的可漫游小地图，镜头跟随小诗童。
 */
export const MAP_1_MEADOW = {
  chapterId: 1,
  area: '溪边草甸',
  title: '青芽谷 · 溪边草甸',
  subtitle: '溪草初青，读第一声鹅鸣',
  key: 'map_1_meadow',
  size: { width: 2400, height: 1400 },
  spawn: { x: 300, y: 1090 },
  palette: {
    grassTop: 0xf0f2dc,
    grassBottom: 0xd7e5c2,
    grassDeep: 0xc5d9ad,
    path: 0xf1e4c6,
    pathLight: 0xf8efd9,
    water: 0xbddad4,
    waterDeep: 0x9cc8c1,
    bank: 0xe7dcbc,
    hill: 0xa9c396,
  },
  // 主路采用样条曲线绘制
  path: [
    { x: 190, y: 1280 },
    { x: 330, y: 1120 },
    { x: 460, y: 1010 },
    { x: 600, y: 900 },
    { x: 760, y: 850 },
    { x: 900, y: 930 },
    { x: 1030, y: 1000 },
    { x: 1210, y: 900 },
    { x: 1400, y: 800 },
    { x: 1600, y: 780 },
    { x: 1770, y: 650 },
    { x: 1940, y: 560 },
    { x: 2080, y: 500 },
  ],
  // 通向牧童小亭的岔路
  branch: [
    { x: 1020, y: 980 },
    { x: 1050, y: 1030 },
    { x: 1090, y: 1060 },
  ],
  // 溪上的木桥（横跨右侧溪流）
  bridge: { x: 2100, y: 410, length: 260 },
  // 节气 / 节日限时诗碑的位置
  festivalSpot: { x: 1680, y: 880 },
  // 玩法触发点：不是每块碑都「看图猜诗」，走到诗台可以换一种玩法
  gameSpots: [
    {
      id: 'game_ch1_chain',
      game: 'chain',
      label: '溪畔诗台',
      x: 1500,
      y: 1000,
      hint: '石台上摊着一卷散了序的诗，坐下把句子一句句接起来',
    },
  ],
  // 主路尽头的下一章路牌：牌面上直接写下一章的名字，本章课内诗读完 60% 后开放。
  // 第一章用的是手绘底图，桥画在 x≈1877–2223 / y≈597–710，
  // 所以这块牌立在桥西头的路上（别放到溪水里去）。
  nextGate: {
    x: 1830,
    y: 650,
    label: '前往清溪渡',
    hint: '木桥桥头立着这块路牌，过了桥就是出谷的山径。',
  },
  tiles: [
    { type: 'water', x: 2180, y: 0, w: 220, h: 1400 },
    { type: 'water', x: 70, y: 1280, w: 440, h: 140 },
  ],
  decors: [
    { type: 'pavilion', x: 1110, y: 1000, collide: true },
    { type: 'tree_round', x: 610, y: 760, scale: 1, collide: true },
    { type: 'tree_blossom', x: 1460, y: 620, scale: 1, collide: true },
    { type: 'tree_blossom', x: 120, y: 620, scale: 0.82, collide: true },
    { type: 'tree_round', x: 1830, y: 940, scale: 0.8, collide: true },
    { type: 'tree_pine', x: 2060, y: 850, scale: 0.65, collide: true },
    { type: 'tree_pine', x: 760, y: 240, scale: 0.72, collide: true },
    { type: 'tree_round', x: 1480, y: 1180, scale: 0.75, collide: true },
    { type: 'reed', x: 2100, y: 1270 },
    { type: 'reed', x: 2110, y: 1130 },
    { type: 'reed', x: 2090, y: 300 },
    { type: 'reed', x: 260, y: 1260 },
    { type: 'rock', x: 1690, y: 520, scale: 0.75, collide: true },
    { type: 'rock', x: 430, y: 1180, scale: 0.65, collide: true },
    { type: 'tree_blossom', x: 300, y: 220, scale: 0.7, collide: true },
  ],
  interactions: [
    {
      id: 'stone_1',
      kind: 'scroll',
      label: '画卷石碑',
      // 立在主路北侧的草坡上：离路中心线 113px，角色沿路走不会穿碑
      x: 700,
      y: 750,
      poemId: 1,
      hint: '石碑上刻着一幅白鹅戏水图。',
    },
    {
      id: 'stone_2',
      kind: 'scroll',
      label: '落花石碑',
      // 花树 (1460,620) 下方、主路北侧的草地，离路 101px
      x: 1480,
      y: 690,
      poemId: 2,
      hint: '风一吹，碑面落满了春日的花瓣。',
    },
    {
      id: 'npc_cowherd',
      kind: 'npc',
      label: '牧童阿青',
      // 岔路口南侧的草地上：既不在主路上，也离开通往凉亭的小岔路
      x: 990,
      y: 1100,
      poemId: 3,
      hint: '牧童吹着竹笛，想考你一题。',
      // NPC 对话奖励：聊过一次就送一片逸闻碎片（已拥有后不再重复发放）
      fragmentReward: { anecdoteId: 102, fragmentIndex: 2 },
    },
    {
      id: 'sign_yue',
      kind: 'sign',
      label: '月下浅滩',
      x: 260,
      y: 340,
      message: '沿溪往上游走，水声会越来越清；浅滩边的月色最亮，夜里能听见鱼跃。',
    },
    // 第 1 章课内篇目：除画卷 / 落花两块碑外，再补 4 块诗碑，
    // 让「6 首课内完成 60%（4 首）」的章节解锁条件可以从地图走到
    {
      id: 'stone_jingye',
      kind: 'scroll',
      label: '月影石碑',
      x: 1240,
      y: 760,
      poemId: 9,
      hint: '碑面映着一层薄薄的月光，像铺了霜。',
    },
    {
      id: 'stone_minong',
      kind: 'scroll',
      label: '稻香石碑',
      x: 830,
      y: 1060,
      poemId: 10,
      hint: '石碑上刻着禾苗与汗珠，旁边还沾着泥土。',
    },
    {
      id: 'stone_jiangnan',
      kind: 'scroll',
      label: '莲舟石碑',
      x: 1980,
      y: 1000,
      poemId: 11,
      hint: '碑上画着莲叶与游鱼，像能听见水声。',
    },
    {
      id: 'stone_hua',
      kind: 'scroll',
      label: '山色石碑',
      x: 430,
      y: 820,
      poemId: 12,
      hint: '远远看去有山有水，走近却听不见声音。',
    },
    {
      id: 'stone_liu',
      kind: 'scroll',
      label: '柳色石碑',
      x: 620,
      y: 400,
      poemId: 40,
      hint: '碑上刻着细长的柳叶，风一吹就轻轻摆动。',
    },
  ],
  // 隐藏诗碑：数据里 is_hidden = true，不参与章节解锁，只作为收集内容
  hiddenSteles: [
    {
      id: 'hidden_8',
      poemId: 8,
      // 桥西头的坡地，离主路 115px：半埋的苔痕石不该压在路面上
      x: 1950,
      y: 430,
      name: '苔痕诗碑',
      appearsRadius: 330,
      triggerRadius: 130,
      hint: '青苔下若有若无地刻着一首空山诗。',
    },
  ],
  // 逸闻碎片拾取点（支线收集）：淡彩宣纸碎片，走近自动拾取，拾取后不再出现
  fragmentSpots: [
    {
      id: 'frag_102_1',
      anecdoteId: 102,
      fragmentIndex: 1,
      x: 470,
      y: 1070,
      hint: '溪边草丛里压着一角淡彩宣纸。',
    },
    {
      id: 'frag_102_3',
      anecdoteId: 102,
      fragmentIndex: 3,
      // 从桥头 (1870,620) 挪到桥西的草坡：原位置正好压在「前往清溪渡」路牌上，
      // 纸片和「逸闻碎片」小提示会盖住牌面文字。
      x: 1680,
      y: 600,
      hint: '桥头草坡的石缝里，卡着一角旧宣纸。',
    },
    {
      id: 'frag_401_1',
      anecdoteId: 401,
      fragmentIndex: 1,
      x: 1330,
      y: 890,
      hint: '溪石上贴着一片被水浸软的宣纸。',
    },
    {
      id: 'frag_401_2',
      anecdoteId: 401,
      fragmentIndex: 2,
      x: 520,
      y: 500,
      hint: '花树枝头挂着一小片旧纸。',
    },
  ],
};

/**
 * 第二章：清溪渡 · 桃溪岸 / 飞瀑台 / 渔翁渡口
 * 右上一条溪流 + 左上飞瀑水潭，主路自左下向右上。
 */
export const MAP_2_TAOXI = {
  chapterId: 2,
  area: '桃溪 · 飞瀑 · 渡口',
  title: '清溪渡 · 桃溪岸',
  subtitle: '桃溪落英，听飞瀑与渔歌',
  key: 'map_2_taoxi',
  size: { width: 2400, height: 1400 },
  spawn: { x: 300, y: 1200 },
  palette: {
    grassTop: 0xf6efdc,
    grassBottom: 0xe3d6bd,
    grassDeep: 0xd3c2a2,
    path: 0xf2e2ca,
    pathLight: 0xfaf0e0,
    water: 0xc6dde0,
    waterDeep: 0xa6c8ce,
    bank: 0xe9dcc0,
    hill: 0xd8b898,
  },
  path: [
    { x: 210, y: 1300 },
    { x: 360, y: 1160 },
    { x: 520, y: 1060 },
    { x: 720, y: 980 },
    { x: 940, y: 900 },
    { x: 1160, y: 860 },
    { x: 1360, y: 800 },
    { x: 1580, y: 700 },
    { x: 1790, y: 620 },
    { x: 1960, y: 540 },
    { x: 2120, y: 470 },
  ],
  branch: [
    { x: 720, y: 980 },
    { x: 700, y: 880 },
    { x: 690, y: 780 },
  ],
  bridge: { x: 2130, y: 470, length: 220 },
  festivalSpot: { x: 1420, y: 900 },
  gameSpots: [
    {
      id: 'game_ch2_match',
      game: 'match',
      label: '渡口诗摊',
      x: 1460,
      y: 420,
      hint: '渔翁把诗句和意思分写在两张纸上，喊你一起配对',
    },
  ],
  // 主路尽头的下一章路牌
  nextGate: {
    x: 2125,
    y: 475,
    label: '前往松风书院',
    hint: '渡口的木桥走到头，路牌指向书院。',
  },
  tiles: [
    { type: 'water', x: 2200, y: 0, w: 200, h: 1400 },
    { type: 'water', shape: 'ellipse', cx: 560, cy: 300, rx: 220, ry: 130 },
  ],
  decors: [
    { type: 'tree_blossom', x: 420, y: 800, scale: 1, collide: true },
    { type: 'tree_blossom', x: 1520, y: 1160, scale: 0.8, collide: true },
    { type: 'tree_round', x: 700, y: 1200, scale: 0.85, collide: true },
    { type: 'tree_pine', x: 1660, y: 320, scale: 0.7, collide: true },
    { type: 'tree_round', x: 380, y: 520, scale: 0.75, collide: true },
    { type: 'tree_blossom', x: 1250, y: 250, scale: 0.72, collide: true },
    { type: 'rock', x: 980, y: 1180, scale: 0.7, collide: true },
    { type: 'rock', x: 1560, y: 540, scale: 0.65, collide: true },
    { type: 'reed', x: 2090, y: 1240 },
    { type: 'reed', x: 2120, y: 940 },
    { type: 'reed', x: 2110, y: 560 },
    { type: 'reed', x: 760, y: 400 },
  ],
  autoNodes: {
    clusters: [
      { area: '桃溪岸', x: 1180, y: 980, prefix: '桃溪' },
      { area: '飞瀑台', x: 880, y: 540, prefix: '飞瀑' },
      { area: '渔翁渡口', x: 1830, y: 700, prefix: '渡口' },
    ],
  },
};

/**
 * 第三章：松风书院 · 前院书廊 / 听雨斋 / 后园荷池
 * 右下角一片荷池，右上一条细溪。
 */
export const MAP_3_STUDY = {
  chapterId: 3,
  area: '书廊 · 听雨 · 荷池',
  title: '松风书院',
  subtitle: '松风翻书，雨声入砚池',
  key: 'map_3_study',
  size: { width: 2400, height: 1400 },
  spawn: { x: 300, y: 1220 },
  palette: {
    grassTop: 0xeff2e2,
    grassBottom: 0xdbe4cd,
    grassDeep: 0xc8d6b8,
    path: 0xf0e6d0,
    pathLight: 0xf8f2e2,
    water: 0xc2d6d3,
    waterDeep: 0xa3c2c0,
    bank: 0xe6ddc2,
    hill: 0xa9bd9f,
  },
  path: [
    { x: 220, y: 1300 },
    { x: 400, y: 1190 },
    { x: 600, y: 1110 },
    { x: 820, y: 1030 },
    { x: 1040, y: 950 },
    { x: 1260, y: 870 },
    { x: 1480, y: 790 },
    { x: 1700, y: 710 },
    { x: 1900, y: 620 },
    { x: 2080, y: 540 },
  ],
  branch: [
    { x: 1040, y: 950 },
    { x: 1000, y: 860 },
    { x: 970, y: 780 },
  ],
  festivalSpot: { x: 1300, y: 980 },
  gameSpots: [
    {
      id: 'game_ch3_sort',
      game: 'sort',
      label: '松风诗案',
      x: 1150,
      y: 900,
      hint: '书廊外的石案上，一叠诗句被风翻乱了，帮忙摆回去',
    },
  ],
  // 主路尽头的下一章路牌
  nextGate: {
    x: 2080,
    y: 610,
    label: '前往云涧古观',
    hint: '书院后的石阶走到头，路牌指向云涧。',
  },
  tiles: [
    { type: 'water', x: 2270, y: 0, w: 130, h: 1400 },
    { type: 'water', shape: 'ellipse', cx: 1700, cy: 1120, rx: 280, ry: 160 },
  ],
  decors: [
    { type: 'pavilion', x: 1250, y: 700, collide: true },
    { type: 'tree_pine', x: 500, y: 720, scale: 0.8, collide: true },
    { type: 'tree_pine', x: 1150, y: 380, scale: 0.75, collide: true },
    { type: 'tree_round', x: 1500, y: 520, scale: 0.8, collide: true },
    { type: 'tree_round', x: 900, y: 1200, scale: 0.85, collide: true },
    { type: 'tree_blossom', x: 1900, y: 900, scale: 0.7, collide: true },
    { type: 'rock', x: 1350, y: 1140, scale: 0.7, collide: true },
    { type: 'reed', x: 1450, y: 1030 },
    { type: 'reed', x: 1960, y: 1180 },
    { type: 'reed', x: 2240, y: 700 },
  ],
  autoNodes: {
    clusters: [
      { area: '前院书廊', x: 960, y: 440, prefix: '书廊' },
      { area: '听雨斋', x: 620, y: 1010, prefix: '听雨' },
      { area: '后园荷池', x: 1680, y: 760, prefix: '荷池' },
    ],
  },
};

/**
 * 第四章：云涧古观 · 松涧石台 / 竹里静舍 / 观内讲经堂
 * 左上涧潭，右侧窄溪；隐藏诗碑藏在画面右上。
 */
export const MAP_4_TEMPLE = {
  chapterId: 4,
  area: '石台 · 静舍 · 经堂',
  title: '云涧古观',
  subtitle: '云深涧静，松间有琴声',
  key: 'map_4_temple',
  size: { width: 2400, height: 1400 },
  spawn: { x: 300, y: 1240 },
  palette: {
    grassTop: 0xeff0ea,
    grassBottom: 0xdcdfd6,
    grassDeep: 0xc8cec2,
    path: 0xeee9da,
    pathLight: 0xf7f4ea,
    water: 0xc5d8d9,
    waterDeep: 0xa6c0c3,
    bank: 0xe2dcc8,
    hill: 0xb2bdb0,
  },
  path: [
    { x: 240, y: 1300 },
    { x: 420, y: 1180 },
    { x: 620, y: 1080 },
    { x: 840, y: 1000 },
    { x: 1060, y: 920 },
    { x: 1280, y: 840 },
    { x: 1500, y: 760 },
    { x: 1720, y: 660 },
    { x: 1980, y: 540 },
    { x: 2180, y: 440 },
  ],
  branch: [
    { x: 1060, y: 920 },
    { x: 1080, y: 820 },
    { x: 1100, y: 740 },
  ],
  festivalSpot: { x: 1400, y: 900 },
  gameSpots: [
    {
      id: 'game_ch4_classical',
      game: 'classical',
      label: '云涧讲席',
      x: 1080,
      y: 820,
      hint: '道观的先生在这里摆了几支文言小签，等你来答',
    },
  ],
  // 主路尽头的下一章路牌
  nextGate: {
    x: 2160,
    y: 520,
    label: '前往云麓文庄',
    hint: '石台旁的路牌指向山下的古巷书楼。',
  },
  tiles: [
    { type: 'water', x: 2330, y: 0, w: 70, h: 1400 },
    { type: 'water', shape: 'ellipse', cx: 880, cy: 300, rx: 200, ry: 120 },
  ],
  decors: [
    { type: 'tree_pine', x: 520, y: 560, scale: 0.85, collide: true },
    { type: 'tree_pine', x: 1180, y: 250, scale: 0.7, collide: true },
    { type: 'tree_pine', x: 1720, y: 860, scale: 0.8, collide: true },
    { type: 'tree_round', x: 700, y: 1150, scale: 0.8, collide: true },
    { type: 'tree_round', x: 1980, y: 1000, scale: 0.75, collide: true },
    { type: 'rock', x: 1250, y: 1160, scale: 0.7, collide: true },
    { type: 'rock', x: 1560, y: 360, scale: 0.65, collide: true },
    { type: 'reed', x: 2280, y: 1280 },
    { type: 'reed', x: 2300, y: 900 },
    { type: 'reed', x: 700, y: 420 },
  ],
  autoNodes: {
    clusters: [
      { area: '松涧石台', x: 1320, y: 460, prefix: '石台' },
      { area: '竹里静舍', x: 640, y: 820, prefix: '竹里' },
      { area: '观内讲经堂', x: 1620, y: 1040, prefix: '经堂' },
    ],
    hidden: [
      {
        x: 1930,
        y: 320,
        name: '苔痕诗碑',
        hint: '青苔下若有若无地刻着一首空山诗。',
      },
    ],
  },
};

/**
 * 第五章：云麓文庄 · 石桥古巷 / 藏书阁楼 / 枫亭古道
 * 右侧溪流上架着石桥，右下角一口小水塘。
 */
export const MAP_5_VILLAGE = {
  chapterId: 5,
  area: '古巷 · 古道 · 书楼',
  title: '云麓文庄',
  subtitle: '古巷石桥，藏书楼里读春秋',
  key: 'map_5_village',
  size: { width: 2400, height: 1400 },
  spawn: { x: 280, y: 1250 },
  palette: {
    grassTop: 0xf2eedd,
    grassBottom: 0xe2dcc4,
    grassDeep: 0xd0c6a8,
    path: 0xeee3cd,
    pathLight: 0xf8f0de,
    water: 0xc4d5d4,
    waterDeep: 0xa5bdbe,
    bank: 0xe2d9bf,
    hill: 0xc0a884,
  },
  path: [
    { x: 230, y: 1290 },
    { x: 420, y: 1180 },
    { x: 640, y: 1090 },
    { x: 880, y: 1000 },
    { x: 1120, y: 920 },
    { x: 1360, y: 840 },
    { x: 1600, y: 760 },
    { x: 1820, y: 660 },
    { x: 2000, y: 580 },
    { x: 2120, y: 520 },
  ],
  branch: [
    { x: 1120, y: 920 },
    { x: 1080, y: 820 },
    { x: 1060, y: 740 },
  ],
  bridge: { x: 2080, y: 620, length: 220 },
  festivalSpot: { x: 900, y: 980 },
  gameSpots: [
    {
      id: 'game_ch5_klondike',
      game: 'klondike',
      label: '藏书阁案',
      x: 980,
      y: 500,
      hint: '阁里的诗卷被风吹得错位，一格一格推回原处',
    },
  ],
  // 主路尽头的下一章路牌
  nextGate: {
    x: 2110,
    y: 600,
    label: '前往凌霄诗台',
    hint: '古道石阶向上，路牌指向凌霄诗台。',
  },
  tiles: [
    { type: 'water', x: 2240, y: 0, w: 160, h: 1400 },
    { type: 'water', shape: 'ellipse', cx: 1250, cy: 1200, rx: 220, ry: 90 },
  ],
  decors: [
    { type: 'tree_round', x: 520, y: 720, scale: 0.85, collide: true },
    { type: 'tree_round', x: 1600, y: 320, scale: 0.75, collide: true },
    { type: 'tree_blossom', x: 1950, y: 380, scale: 0.7, collide: true },
    { type: 'tree_pine', x: 620, y: 1220, scale: 0.7, collide: true },
    { type: 'tree_round', x: 1820, y: 1120, scale: 0.8, collide: true },
    { type: 'rock', x: 1000, y: 1180, scale: 0.7, collide: true },
    { type: 'rock', x: 1480, y: 620, scale: 0.65, collide: true },
    { type: 'reed', x: 2180, y: 1240 },
    { type: 'reed', x: 2210, y: 900 },
    { type: 'reed', x: 780, y: 1080 },
  ],
  autoNodes: {
    clusters: [
      { area: '石桥古巷', x: 1250, y: 880, prefix: '古巷' },
      { area: '藏书阁楼', x: 700, y: 500, prefix: '书楼' },
      { area: '枫亭古道', x: 1740, y: 580, prefix: '古道' },
    ],
  },
};

/**
 * 第六章：凌霄诗台 · 四方诗亭 / 百味诗廊 / 文会雅厅 / 溯源石室 / 星碑秘境
 * 山巅石台，没有水域，只有石阶与几棵孤松。
 */
export const MAP_6_STAGE = {
  chapterId: 6,
  area: '诗亭 · 诗廊 · 石室',
  title: '凌霄诗台',
  subtitle: '登临诗台，与古今诗心相逢',
  key: 'map_6_stage',
  size: { width: 2400, height: 1400 },
  spawn: { x: 360, y: 1250 },
  palette: {
    grassTop: 0xeeeef2,
    grassBottom: 0xdcdce6,
    grassDeep: 0xc8c8d6,
    path: 0xeee7da,
    pathLight: 0xf7f2e8,
    water: 0xc8d6de,
    waterDeep: 0xa8bcc8,
    bank: 0xe2dccb,
    hill: 0xb8b6c8,
  },
  path: [
    { x: 320, y: 1300 },
    { x: 520, y: 1190 },
    { x: 760, y: 1090 },
    { x: 1000, y: 990 },
    { x: 1220, y: 900 },
    { x: 1440, y: 800 },
    { x: 1660, y: 700 },
    { x: 1880, y: 610 },
    { x: 2060, y: 520 },
  ],
  branch: [
    { x: 1220, y: 900 },
    { x: 1220, y: 780 },
    { x: 1220, y: 620 },
  ],
  festivalSpot: { x: 1450, y: 830 },
  gameSpots: [
    {
      id: 'game_ch6_trial',
      game: 'trial',
      label: '文会诗台',
      x: 1000,
      y: 900,
      hint: '文会上摆着六章混出的诗题，试一试能连过几关',
    },
    {
      id: 'game_ch6_feihua',
      game: 'feihua',
      label: '流觞令台',
      x: 1550,
      y: 420,
      hint: '诗友围坐一圈，轮着说带关键字的诗句，说不出来就换人',
    },
  ],
  tiles: [],
  decors: [
    { type: 'tree_pine', x: 420, y: 760, scale: 0.8, collide: true },
    { type: 'tree_pine', x: 1960, y: 820, scale: 0.75, collide: true },
    { type: 'tree_blossom', x: 520, y: 300, scale: 0.7, collide: true },
    { type: 'rock', x: 900, y: 1180, scale: 0.7, collide: true },
    { type: 'rock', x: 1500, y: 1150, scale: 0.65, collide: true },
    { type: 'rock', x: 1800, y: 300, scale: 0.6, collide: true },
  ],
  autoNodes: {
    clusters: [
      { area: '文会雅厅', x: 1200, y: 900, prefix: '文会' },
      { area: '百味诗廊', x: 700, y: 520, prefix: '诗廊' },
      { area: '溯源石室', x: 1720, y: 560, prefix: '石室' },
      { area: '星碑秘境', x: 1200, y: 320, prefix: '星碑' },
    ],
  },
};

/** 片区地图注册表：key => 配置 */
export const AREA_MAPS = {
  map_1_meadow: MAP_1_MEADOW,
  map_2_taoxi: MAP_2_TAOXI,
  map_3_study: MAP_3_STUDY,
  map_4_temple: MAP_4_TEMPLE,
  map_5_village: MAP_5_VILLAGE,
  map_6_stage: MAP_6_STAGE,
};

/** 章节 → 地图 key（六章现在都有可游历的地图） */
const CHAPTER_MAP_KEYS = {
  1: 'map_1_meadow',
  2: 'map_2_taoxi',
  3: 'map_3_study',
  4: 'map_4_temple',
  5: 'map_5_village',
  6: 'map_6_stage',
};

export function getAreaMap(mapKey) {
  return AREA_MAPS[mapKey] || null;
}

export function resolveMapKey(chapterId) {
  return CHAPTER_MAP_KEYS[Number(chapterId)] || '';
}

/**
 * 把地图配置里的诗词绑定解析成运行时节点。
 * 所有诗词内容都从 DataManager 读取，不在场景里写死。
 * 有 autoNodes 的章节按 area 自动布点；第一章仍用手写 interactions。
 */
export function buildMapNodes(mapConfig) {
  const nodes = [];
  const auto = Boolean(mapConfig.autoNodes);

  const interactions = auto
    ? (mapConfig.interactions || []).concat(generateAutoInteractions(mapConfig))
    : (mapConfig.interactions || []);
  const hiddenSteles = auto
    ? (mapConfig.hiddenSteles || []).concat(generateAutoHiddenSteles(mapConfig))
    : (mapConfig.hiddenSteles || []);

  interactions.forEach((item) => {
    if (item.kind === 'sign' || !item.poemId) {
      nodes.push({
        id: item.id,
        kind: item.kind || 'sign',
        label: item.label,
        x: item.x,
        y: item.y,
        hint: item.hint || '',
        message: item.message || '',
        triggerRadius: item.triggerRadius || 120,
        isHidden: false,
        poem: null,
        poemId: null,
        fragmentReward: buildFragmentReward(item.fragmentReward),
      });
      return;
    }

    const poem = dataManager.getPoemById(item.poemId);
    if (!poem) return;
    nodes.push({
      id: item.id,
      kind: item.kind,
      label: item.label,
      x: item.x,
      y: item.y,
      hint: item.hint || '',
      poemId: poem.id,
      poem,
      artKey: poem.artKey,
      triggerRadius: item.triggerRadius || 125,
      isHidden: false,
      fragmentReward: buildFragmentReward(item.fragmentReward),
    });
  });

  hiddenSteles.forEach((item) => {
    const poem = dataManager.getPoemById(item.poemId);
    if (!poem) return;
    nodes.push({
      id: item.id,
      kind: 'hiddenStele',
      label: item.name,
      x: item.x,
      y: item.y,
      hint: item.hint || '',
      poemId: poem.id,
      poem,
      artKey: poem.artKey,
      triggerRadius: item.triggerRadius || 130,
      appearsRadius: item.appearsRadius || 300,
      isHidden: Boolean(poem.is_hidden),
    });
  });

  // 玩法触发点：不绑诗（具体考哪首由 MapScene 从本章未读的诗里挑），
  // 只负责说明「这里是哪一种玩法」。
  (mapConfig.gameSpots || []).forEach((item) => {
    const rule = getGameSpotRule(item.game);
    if (!rule) return;
    nodes.push({
      id: item.id,
      kind: 'game',
      game: item.game,
      label: item.label,
      x: item.x,
      y: item.y,
      hint: item.hint || rule.intro,
      message: rule.intro,
      triggerRadius: item.triggerRadius || 130,
      isHidden: false,
      poem: null,
      poemId: null,
    });
  });

  // 主路尽头的下一章路口：不绑诗，只负责「本章达标后通往下一章」。
  // 最后一章没有 nextGate，地图上就不会出现路口节点。
  if (mapConfig.nextGate) {
    const gate = mapConfig.nextGate;
    nodes.push({
      id: `ch${mapConfig.chapterId}_gate_next`,
      kind: 'gate',
      label: gate.label || '山径路口',
      x: gate.x,
      y: gate.y,
      hint: gate.hint || '主路走到这里就断了，前面是通往下一章的山径。',
      message: '',
      triggerRadius: gate.triggerRadius || 130,
      isHidden: false,
      poem: null,
      poemId: null,
      // 由 MapScene 用来判断「下一章是否已满足解锁要求」
      nextChapterId: Number(mapConfig.chapterId) + 1,
    });
  }

  // 最后一道：所有标识点都不许立在主路正中（下一章路牌例外——它本来就立在
  // 主路尽头 / 桥头，是给玩家看的指示牌）。碑立在路上，角色沿路走就会穿碑。
  // 第一章的碑是手写坐标（画面另有画稿），这里不再算法推动，由数据校验兜底。
  if ((mapConfig.interactions || []).length === 0) {
    const nodeBounds = {
      minX: 140,
      maxX: mapConfig.size.width - 160,
      minY: 240,
      maxY: mapConfig.size.height - 120,
    };
    // 指路木牌也要离开主路 / 障碍物（它立在路上，玩家会从牌子中间穿过去），
    // 但它不会因为旁边的碑而挪动；碑反过来要让开它（见 ③）。
    const movableAll = nodes.filter((node) => node.kind !== 'gate');
    const stones = nodes.filter((node) => node.kind !== 'gate' && node.kind !== 'sign');
    // 下一章路牌 / 指路木牌都钉在原位：只把旁边的碑推开。
    // 指路牌要留更远（NODE_SIGN_CLEARANCE），碑不能挤在牌子脚下。
    const anchors = nodes
      .filter((node) => node.kind === 'gate' || node.kind === 'sign')
      .map((node) => ({ node, gap: node.kind === 'sign' ? NODE_SIGN_CLEARANCE : NODE_MIN_GAP }));
    const nodeObstacles = collectObstacles(mapConfig);
    const nodeEllipses = collectEllipses(mapConfig);
    for (let pass = 0; pass < 40; pass += 1) {
      let moved = false;
      // ① 诗碑之间保持最小间距（名牌不叠在一起；路牌不参与互斥）
      // 离主路近的那块碑「不动」或只挪一点点，主要由另一块让开，
      // 否则互斥会把碑推向路边，下一步又被主路推回来，两碑就一直挤在一起。
      for (let i = 0; i < stones.length; i += 1) {
        for (let j = i + 1; j < stones.length; j += 1) {
          const a = stones[i];
          const b = stones[j];
          const distance = Math.hypot(b.x - a.x, b.y - a.y);
          if (distance >= NODE_MIN_GAP) continue;
          const weightOf = (node) => Math.min(
            1,
            Math.max(0, (distanceToPath(mapConfig.path, node.x, node.y) - NODE_ROAD_CLEARANCE) / 60),
          );
          let wa = weightOf(a);
          let wb = weightOf(b);
          if (wa + wb < 0.2) {
            wa = 0.5;
            wb = 0.5;
          }
          const total = wa + wb;
          const need = NODE_MIN_GAP - distance + 0.5;
          const ux = distance > 0.001 ? (b.x - a.x) / distance : 1;
          const uy = distance > 0.001 ? (b.y - a.y) / distance : 0;
          const pushA = need * (wa / total);
          const pushB = need * (wb / total);
          a.x -= ux * pushA;
          a.y -= uy * pushA;
          b.x += ux * pushB;
          b.y += uy * pushB;
          if (pushA > 0.5 || pushB > 0.5) moved = true;
        }
      }
      // ② 碑离「下一章路牌 / 指路木牌」也要留出间距（这些牌子不动，只推碑）
      stones.forEach((node) => {
        anchors.forEach(({ node: anchor, gap }) => {
          const distance = Math.hypot(node.x - anchor.x, node.y - anchor.y);
          if (distance >= gap) return;
          const push = gap - distance + 0.5;
          const ux = distance > 0.001 ? (node.x - anchor.x) / distance : 1;
          const uy = distance > 0.001 ? (node.y - anchor.y) / distance : 0;
          node.x += ux * push;
          node.y += uy * push;
          moved = true;
        });
      });
      // ③ 离开主路 + 离开水域 / 石树亭（路牌同样适用）。
      // 放在互斥之后：互斥会把碑挤向路边，这一步最后再保证「碑不立在路中间」。
      movableAll.forEach((node) => {
        const point = { x: node.x, y: node.y };
        if (pushOffRoad(point, mapConfig.path, NODE_ROAD_CLEARANCE)) moved = true;
        nodeObstacles.forEach((rect) => {
          if (pushOutOfRectClear(
            point,
            rect,
            rect.nodePad || rect.pad || 70,
            mapConfig.path,
            NODE_ROAD_CLEARANCE,
          )) moved = true;
        });
        // 椭圆水塘按真椭圆再推一次，别卡在两条碰撞横条之间
        nodeEllipses.forEach((ellipse) => {
          if (pushOutOfEllipse(point, ellipse, ellipse.pad)) moved = true;
        });
        node.x = point.x;
        node.y = point.y;
      });
      movableAll.forEach((node) => {
        if (clampPoint(node, nodeBounds)) moved = true;
      });
      // ④ 水塘贴到地图边界时，竖直让不开就横着让
      movableAll.forEach((node) => {
        if (settleOutOfEllipses(node, nodeEllipses, nodeBounds)) moved = true;
      });
      if (!moved) break;
    }
    movableAll.forEach((node) => {
      node.x = Math.round(node.x);
      node.y = Math.round(node.y);
    });
  }

  return nodes;
}

/**
 * 解析「对话奖励碎片」配置：{ anecdoteId, fragmentIndex } → 运行时奖励对象。
 * 数据不自洽（轶事不存在 / 碎片序号越界）时返回 null，不影响其他内容。
 */
function buildFragmentReward(config) {
  if (!config) return null;
  const index = Number(config.fragmentIndex);
  const fragmentKey = fragmentKeyOf(config.anecdoteId, index);
  if (!fragmentKey) return null;
  const anecdote = dataManager.getAnecdoteById(config.anecdoteId);
  if (!anecdote) return null;
  return {
    anecdoteId: anecdote.anecdote_id,
    fragmentIndex: index,
    fragmentKey,
    anecdote,
  };
}

/**
 * 把地图配置里的「逸闻碎片拾取点」解析成运行时节点。
 * 全部碎片标识与轶事标题都来自 anecdote_db，不在场景里写死。
 */
export function buildFragmentSpots(mapConfig) {
  const spots = [];

  (mapConfig.fragmentSpots || []).forEach((item, index) => {
    const reward = buildFragmentReward(item);
    if (!reward) return;
    spots.push({
      id: item.id || `${reward.fragmentKey}_${index}`,
      kind: 'fragment',
      label: '逸闻碎片',
      x: Number(item.x) || 0,
      y: Number(item.y) || 0,
      hint: item.hint || ANECDOTE_FRAGMENT_RULES.map.hint,
      anecdoteId: reward.anecdoteId,
      fragmentIndex: reward.fragmentIndex,
      fragmentKey: reward.fragmentKey,
      anecdote: reward.anecdote,
      triggerRadius: item.triggerRadius || FRAGMENT_SPOT_DEFAULTS.triggerRadius,
      appearsRadius: item.appearsRadius || FRAGMENT_SPOT_DEFAULTS.appearsRadius,
    });
  });

  return spots;
}
