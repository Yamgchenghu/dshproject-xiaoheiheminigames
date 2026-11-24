#!/usr/bin/env node
/**
 * 把 14 个官方关卡从 Android 资源里抽出来，生成 src/tools/liushui/levels.js。
 *
 * 【为什么要生成而不是手抄】关卡坐标有十几位小数，手抄必错；
 *   而且原版 JSON 的字段顺序/可选字段有历史包袱，集中解析一次，
 *   运行时就不用再兼容各种旧格式。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(ROOT, '..', '_src', 'liushui', '流水入杯', 'android', 'assets', 'levels');
const OUT = path.join(ROOT, 'src', 'tools', 'liushui', 'levels.js');

// 【为什么用这一组名字】原版 OfficialLevels.java 的 NAMES 只有前六关
// 起了名字，第七关往后就是「第七关」…「第十四关」。关卡 JSON 里的
// name 字段全是占位符「我的关卡」（那是编辑器存档格式的默认值），
// 所以名字只能照抄 OfficialLevels.java，不能自己编。
const NAMES = [
  '第一关 · 初见', '第二关 · 三角', '第三关 · 推杯',
  '第四关 · 多线', '第五关 · 清线', '第六关 · 岩浆',
  '第七关', '第八关', '第九关',
  '第十关', '第十一关', '第十二关', '第十三关', '第十四关',
];

/** 解析原版 JSON 里的 motion 数组：[type,x1,y1,x2,y2,radius,speed,phase,loop,pts,spin] */
function readMotion(a) {
  if (!Array.isArray(a) || a.length < 7) return null;
  return {
    type: a[0],
    x1: a[1], y1: a[2], x2: a[3], y2: a[4],
    radius: a[5], speed: a[6],
    phase: a[7] ?? 0,
    loop: a[8] ?? false,
    spin: a[10] ?? 0,
    points: Array.isArray(a[9]) ? a[9].map((p) => ({ x: p[0], y: p[1] })) : [],
  };
}

const levels = [];
for (let i = 1; i <= 14; i++) {
  const raw = JSON.parse(fs.readFileSync(path.join(SRC, `level${i}.json`), 'utf8'));

  const supports = (raw.supports || []).map((a) => {
    if (a.length >= 6) {
      return {
        x1: a[0], y1: a[1], xm: a[2], ym: a[3], x2: a[4], y2: a[5],
        motion: readMotion(a[6]),
        kind: a.length > 7 ? a[7] : 0,
      };
    }
    // 旧格式：只有两个端点，中点按"略高于直线"补出来（原版 LevelStore 也这么干）
    const [x1, y1, x2, y2] = a;
    return {
      x1, y1, xm: (x1 + x2) / 2, ym: (y1 + y2) / 2 - 0.03, x2, y2,
      motion: null, kind: 0,
    };
  });

  const segments = (raw.segments || []).map((a) => ({
    kind: a[0], x1: a[1], y1: a[2], x2: a[3], y2: a[4], motion: readMotion(a[5]),
  }));

  const circles = (raw.circles || []).map((a) => {
    const kind = a[0];
    // 动态球（火球/实心球）不能走路径——原版也是这么处理的
    const motion = kind === 2 || kind === 5 ? null : readMotion(a[4]);
    return { kind, cx: a[1], cy: a[2], radius: a[3], motion };
  });

  const poisonFaucets = (raw.poisonFaucets || []).map((a) => ({
    x: a[0], y: 0.105, count: a[2],
  }));

  const texts = (raw.texts || []).map((a) => ({ x: a[0], y: a[1], text: a[2] }));

  levels.push({
    index: i,
    name: NAMES[i - 1] || `第 ${i} 关`,
    faucetX: raw.faucetX,
    cupCx: raw.cupCx,
    cupBottomY: raw.cupBottomY,
    supports,
    segments,
    circles,
    poisonFaucets,
    texts,
  });
}

const header = `/**
 * 十四关官方关卡数据。
 *
 * 【这个文件是生成的，不要手改】由 tools/gen-levels.mjs 从原版 Android 资源
 *   里抽取并归一化。改了原版数据就重跑一次生成脚本。
 *
 * 【坐标系】世界宽 0.60、高 1.00，原点在左上角，Y 向下。
 *   和原版 Level.java 里的 WORLD_W / WORLD_H 完全一致，
 *   所以所有坐标可以逐位照搬，不需要任何缩放。
 *
 * 【字段】
 *   faucetX       水龙头出水的横坐标（0..0.60）
 *   cupCx         杯子中心横坐标
 *   cupBottomY    杯子底部纵坐标（越大越靠下）
 *   supports      三点圆弧支撑（可旋转的机关）：{x1,y1,xm,ym,x2,y2,kind,motion}
 *   segments      直线段：{kind,x1,y1,x2,y2,motion}
 *   circles       圆形物体：{kind,cx,cy,radius,motion}
 *                 kind: 0=实心圆 1=火环 2=火球 3=水泡 4=毒球 5=实心球
 *   poisonFaucets 毒水龙头：{x,y,count}
 *   texts         关卡内提示文字：{x,y,text}
 *
 * 【motion 机关】type: 0=静止 1=直线往复 2=绕轨 3=路径 4=自转
 */

`;

const body = `export const LEVELS = ${JSON.stringify(levels, null, 2)};

export const LEVEL_COUNT = LEVELS.length;

/** 按 1 基序号取关卡（原版 UI 是 1..14，这里保持一致） */
export function levelAt(index) {
  return LEVELS[index - 1] || LEVELS[0];
}

export default { LEVELS, LEVEL_COUNT, levelAt };
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header + body);
console.log(`写入 ${path.relative(ROOT, OUT)}（${levels.length} 关，${(header + body).length} 字节）`);
for (const L of levels) {
  console.log(`  ${L.name}  支撑 ${L.supports.length}  线 ${L.segments.length}  圆 ${L.circles.length}  毒 ${L.poisonFaucets.length}`);
}
