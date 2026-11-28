// 火车票渲染器 —— pygame 版 run_display_window 的精确移植
// 【为什么逐行照搬】票面靠逐字符累加宽度来定位，任何取整差异都会累积偏移。

// 设计分辨率：fbl_multiply = 3.5 时画布 1890x1190，fx(x)=x，fy(y)=y*340/307
export const DESIGN_W = 1890;
export const DESIGN_H = 1190;
const FY_RATIO = 340 / 307;

export const fx = (x) => x;
export const fy = (y) => y * FY_RATIO;

// 20 个字体的规格：序号 -> [字体文件, 字号(设计分辨率下)]
// 字号 = int(原字号 / 3.5 * 3.5) = 原字号，直接取整即可
export const FONT_SPECS = [
  ['simhei-rednum', 98], ['simsun', 74], ['simhei', 119], ['simsun', 46],
  ['simsun', 102], ['simhei', 91], ['simsun', 77], ['simhei', 70],
  ['simhei', 53], ['simsun', 70], ['simw', 112], ['simsun', 67],
  ['simw', 70], ['simsun', 84], ['simsun', 25], ['simsun', 81],
  ['simsun', 49], ['simsun', 63], ['simw', 53], ['simsun', 60],
];

// pygame get_ascent() 实测值。浏览器 fontBoundingBoxAscent 会差 0~1px，
// 所以直接用 pygame 的值，保证垂直基线与原版一致。
export const ASCENT = [85, 64, 103, 40, 88, 79, 67, 61, 46, 61, 90, 58, 56, 73, 22, 70, 43, 55, 43, 52];

export function fontString(num) {
  const f = FONT_SPECS[num] || FONT_SPECS[0];
  return f[1] + 'px "' + f[0] + '"';
}

// pygame 实测的 ASCII 整数步进表（20 个字号 x 95 个可打印字符）。
// 【为什么不用 ctx.measureText】子集化后的字体丢掉了 hinting，
//   Chrome 量出来全是 45.5 / 59.5 这种半像素值，而 pygame(FreeType) 是
//   带 hinting 的整数步进（'{' 45、'D' 46）。Math.round(45.5)=46 会让
//   每个 ASCII 字符多吃 1px，一行 30 个字符就偏 30px —— 票面全歪。
//   CJK 字符的步进恒等于字号（已验证 20 个字号全成立），所以直接推导。
export const ASCII_CHARS = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
const ASCII_W = [
  [49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49,49],
  [37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,38,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37,37],
  [60,59,60,59,60,59,60,60,60,59,60,59,59,59,59,60,60,60,60,67,60,60,60,60,60,60,59,59,60,59,60,60,60,60,60,60,59,60,60,60,60,59,59,59,60,59,60,60,59,60,59,59,60,59,60,60,60,59,60,59,60,60,60,60,60,59,60,60,59,60,60,60,59,59,60,59,60,60,59,59,60,59,60,59,59,59,60,60,60,60,60,59,60,59,60],
  [23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,25,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23,23],
  [51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51,51],
  [46,45,45,46,46,45,45,46,46,45,46,46,45,46,45,46,46,46,46,52,46,46,46,46,46,46,45,45,46,46,46,46,46,46,46,45,46,46,45,45,46,45,46,45,45,45,46,46,46,46,45,45,46,45,46,46,46,45,45,46,46,46,46,46,46,45,45,45,45,46,45,46,46,45,46,45,46,44,46,45,45,45,45,46,45,46,46,46,46,46,45,45,46,45,46],
  [39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,40,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39,39],
  [35,35,35,34,35,35,36,35,35,35,35,34,35,34,34,35,35,35,35,40,35,35,35,35,35,35,35,35,35,34,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,36,35,35,34,35,35,35,35,35,35,34,35,35,35,35,35,35,36,35,35,35,35,35,35,35,35,36,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,36,35,35,35,35],
  [27,27,27,27,27,26,26,27,26,27,26,27,26,27,26,27,27,27,27,30,27,27,27,27,27,27,26,26,27,27,27,27,27,27,26,27,26,26,26,26,26,27,27,26,26,27,26,26,27,26,26,26,26,26,27,27,27,27,26,26,27,27,27,27,27,26,26,26,27,27,26,26,27,27,27,27,27,27,27,27,26,27,26,26,26,27,27,27,27,27,27,26,27,26,27],
  [35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35,35],
  [27,34,37,62,64,113,79,20,43,39,56,75,32,35,32,46,66,45,64,64,64,64,64,64,64,64,35,35,93,93,93,44,112,75,66,74,82,57,59,82,89,33,44,72,53,107,90,94,61,94,72,48,68,84,75,116,74,68,65,39,46,39,112,56,56,56,63,47,65,55,40,56,62,28,33,56,29,95,63,67,65,64,40,38,37,61,60,92,57,58,50,40,56,39,93],
  [34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34,34],
  [17,21,23,39,40,71,49,13,27,25,35,47,20,22,20,29,41,28,40,40,40,40,40,40,40,40,22,22,58,58,58,28,70,47,41,46,51,36,37,51,56,21,28,45,33,67,56,59,38,59,45,30,42,53,47,73,46,43,40,25,29,25,70,35,35,35,39,30,41,34,25,35,39,18,20,35,18,60,39,42,41,40,25,24,23,38,38,58,35,37,31,25,35,25,58],
  [42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,43,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42,42],
  [13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,14,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13,13],
  [41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41,41],
  [25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25,25],
  [32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32,32],
  [13,16,18,29,30,54,37,10,21,19,27,36,15,16,15,22,31,21,30,30,30,30,30,30,30,30,16,16,44,44,44,21,53,35,31,35,39,27,28,39,42,16,21,34,25,50,43,44,29,44,34,23,32,40,36,56,35,33,31,19,23,19,53,27,27,26,30,22,31,26,19,27,29,13,16,27,14,45,30,32,31,30,19,18,18,29,29,44,27,28,24,19,27,19,44],
  [30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,32,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30],
];

const ASCII_INDEX = new Map();
for (let i = 0; i < ASCII_CHARS.length; i++) ASCII_INDEX.set(ASCII_CHARS.charCodeAt(i), i);

/** 单字符步进：CJK/全角 = 字号，ASCII 查表，其余回退字号。 */
export function charAdvance(ch, num) {
  const size = (FONT_SPECS[num] || FONT_SPECS[0])[1];
  const row = ASCII_W[num] || ASCII_W[0];
  const idx = ASCII_INDEX.get(ch.charCodeAt(0));
  if (idx !== undefined) return row[idx];
  return size;
}

/** 整串步进 = 逐字符相加（与原版逐字符 output 完全一致）。 */
export function textAdvance(text, num) {
  let w = 0;
  for (const ch of text) w += charAdvance(ch, num);
  return w;
}
export function createEngine(ctx) {
  function csckg(text, num, mode) {
    // 【必须查表】见文件头 ASCII_W 的说明：
    //   浏览器 measureText 给的是去掉 hinting 的亚像素宽度，
    //   与 pygame 的整数步进差 0~1px/字符，累积起来整行会歪。
    if (mode === 1) {
      const prev = ctx.font;
      ctx.font = fontString(num);
      const m = ctx.measureText(text);
      ctx.font = prev;
      return Math.round(m.fontBoundingBoxAscent + m.fontBoundingBoxDescent);
    }
    return textAdvance(text, num);
  }

  function output(text, color, px, py, tm, num) {
    const prev = ctx.font;
    ctx.font = fontString(num);
    ctx.globalAlpha = (tm === undefined || tm === null ? 255 : tm) / 255;
    ctx.fillStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, px, py + ASCENT[num]);
    ctx.globalAlpha = 1;
    ctx.font = prev;
  }

  function mlength(words, num) {
    let x = 0, xmax = 0, i = 0;
    const colorset = ['#R','#G','#B','#Y','#W','#P','#O','#L','#D','#C','#Z'];
    while (i < words.length) {
      const two = words.slice(i, i + 2);
      const three = words.slice(i, i + 3);
      if (colorset.includes(two)) { i += 2; }
      else if (three === '###') { i += 3; }
      else if (two === '#y') { i += 6; }
      else if (two === '#c') { i += 11; }
      else if (two === '#n') { xmax = Math.max(xmax, x); x = 0; i += 2; }
      else if (two === '#0') { num = 0; i += 2; }
      // 【照搬原版】mlength 里 #10/#11 只前进 2 个字符（原版就少走一位），
      // 且不识别 #12~#39，会把它当普通字符量宽度。必须一致，否则居中会偏。
      else if (three === '#10') { num = 10; i += 2; }
      else if (three === '#11') { num = 11; i += 2; }
      else if (/^#[1-9]$/.test(two)) { num = parseInt(two.slice(1), 10); i += 2; }
      else { x += csckg(words[i], num, 0); i += 1; }
    }
    return Math.max(xmax, x);
  }

  function moutput(words, colorcs, place, tm, num) {
    words = String(words);
    let x = place[0];
    let y = place[1];
    let color = colorcs;
    let i = 0;
    let yp = 30;
    if (tm === undefined) tm = 255;
    if (num === undefined) num = 0;
    words += '      ';
    while (i < words.length) {
      const two = words.slice(i, i + 2);
      const three = words.slice(i, i + 3);
      const four = words.slice(i, i + 4);
      if (four === '#y+=') { y += parseInt(words.slice(i+4, i+7), 10); i += 7; }
      else if (four === '#x+=') { x += parseInt(words.slice(i+4, i+7), 10); i += 7; }
      else if (four === '#tm=') { tm = parseInt(words.slice(i+4, i+7), 10); i += 7; }
      else if (four === '#y-=') { y -= parseInt(words.slice(i+4, i+7), 10); i += 7; }
      else if (four === '#x-=') { x -= parseInt(words.slice(i+4, i+7), 10); i += 7; }
      else if (two === '#R') { color = [255,0,0]; i += 2; }
      else if (two === '#G') { color = [0,255,0]; i += 2; }
      else if (two === '#B') { color = [0,0,255]; i += 2; }
      else if (two === '#Y') { color = [255,255,0]; i += 2; }
      else if (two === '#W') { color = [255,255,255]; i += 2; }
      else if (two === '#P') { color = [255,130,104]; i += 2; }
      else if (two === '#O') { color = [255,128,0]; i += 2; }
      else if (two === '#L') { color = [173,216,230]; i += 2; }
      else if (two === '#D') { color = [218,112,214]; i += 2; }
      else if (two === '#C') { color = [152,251,152]; i += 2; }
      else if (two === '#Z') { color = [255,0,255]; i += 2; }
      else if (two === '#H') { color = [120,120,120]; i += 2; }
      else if (two === '#l') { color = [123,213,231]; i += 2; }
      else if (two === '#x') {
        if (words[i+2] !== '+') { x = parseInt(words.slice(i+2, i+5), 10); i += 5; }
        else { x = parseInt(words.slice(i+3, i+7), 10); i += 7; }
      }
      else if (three === '###') { color = colorcs; i += 3; }
      else if (two === '#c') {
        color = [parseInt(words.slice(i+2,i+5),10), parseInt(words.slice(i+5,i+8),10), parseInt(words.slice(i+8,i+11),10)];
        i += 11;
      }
      else if (two === '#n') { y += yp; x = place[0]; i += 2; }
      else if (two === '#y') { yp = parseInt(words.slice(i+2, i+6), 10); i += 6; }
      else if (two === '#0') { num = 0; i += 2; }
      // 【关键】字体号只认 #10~#39，且两位数必须先于一位数判断。
      // 原版是逐个 elif 硬写的；用 [1-9]\d 会把 #51 误判成 51 号字体，
      // 把紧随其后的数字整个吞掉（日期里的 10/18/01:44 就是这么丢的）。
      else if (/^#(1[0-9]|2[0-9]|3[0-9])$/.test(three)) { num = parseInt(three.slice(1), 10); i += 3; }
      else if (/^#[1-9]$/.test(two)) { num = parseInt(two.slice(1), 10); i += 2; }
      else if (two === '#零') {
        const r = parseInt(words.slice(i+2, i+5), 10);
        const prev = ctx.font;
        ctx.font = fontString(num);
        ctx.strokeStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x + csckg('人', num, 0) / 2, y + csckg('人', num, 1) / 2, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = prev;
        i += 5;
      }
      else if (two === '%一') {
        const n2 = parseInt(words.slice(i+2, i+4), 10);
        const useNum = isNaN(n2) ? num : n2;
        output('一', color, x, y, tm, useNum);
        i += isNaN(n2) ? 2 : 4;
      }
      else if (words[i] === '$') { i += 1; }
      else if (two === '#$') { i += 1; output(words[i], color, x, y, tm, num); x += csckg(words[i], num, 0); i += 1; }
      else { output(words[i], color, x, y, tm, num); x += csckg(words[i], num, 0); i += 1; }
    }
  }

  return { csckg, output, mlength, moutput };
}

function str03(int1) {
  const n = Math.trunc(Number(int1));
  if (n < 10) return '00' + n;
  if (n < 100) return '0' + n;
  if (n < 1000) return String(n);
  return '999#x+=' + str03(n - 999);
}

export function renderTicket(ctx, d, baseImg, qrImg) {
  const E = createEngine(ctx);
  const { moutput, mlength } = E;

  ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  if (baseImg) ctx.drawImage(baseImg, 0, 0);

  const black = [0, 0, 0];
  const fbl = 3.5;
  // 【#10 是"华文新魏花体"标记】原版在出发站名里出现 #10 时：
  //   1) 去掉 #10 三个字符；2) 用 10 号字体（simw 112px）渲染；3) 站名两字中间加两个空格；
  //   4) 站名与「站」字之间的偏移从 fy(25) 改成 fy(11)/fy(14) 两段。
  //   这套偏移和普通票完全不同，漏掉就会整块错位。
  const ten0 = d.sta_chn.indexOf('#10') >= 0 ? 1 : 0;
  let sta = d.sta_chn, end = d.end_chn;
  if (ten0) { sta = sta.slice(3); }

  // 红色票号
  moutput(d.red_code, d.base_pic >= 3 ? [235,40,30] : [255,120,120], [fx(111), fy(42)], 255, 0);

  // 检票口
  if (d.enter_gate === '旅游计次票' || d.lyjcp === 1) {
    moutput('旅游计次票', black, [fx(1780) - mlength('旅游计次票', 17), fy(49)], 255, 17);
  } else if (d.enter_gate && d.enter_gate !== '$' && d.enter_gate !== '\n') {
    const t = '检票:' + d.enter_gate;
    moutput(t, black, [fx(1780) - mlength(t, 17), fy(49)], 255, 17);
  }

  // 站名
  const sp = (s) => (s.length === 2 ? s[0] + '  ' + s[1] : s);
  if (ten0) {
    moutput('#y+=' + str03(fy(11)) + sp(sta) + '#6#x+=' + str03(fx(35)) + '#y+=' + str03(fy(14)) + '站',
      black, [fx(156), fy(158)], 255, 10);
    moutput('#y+=' + str03(fy(11)) + sp(end) + '#6#x+=' + str03(fx(35)) + '#y+=' + str03(fy(14)) + '站',
      black, [fx(1224), fy(158)], 255, 10);
  } else {
    moutput(sp(sta) + '#6#x+=' + str03(fx(35)) + '#y+=' + str03(fy(25)) + '站',
      black, [fx(156), fy(158)], 255, 2);
    moutput(sp(end) + '#6#x+=' + str03(fx(35)) + '#y+=' + str03(fy(25)) + '站',
      black, [fx(1224), fy(158)], 255, 2);
  }

  // 拼音
  moutput(d.sta_eng, black, [fx(219), fy(284)], 255, 9);
  moutput(d.end_eng, black, [fx(1287), fy(284)], 255, 9);

  // 车次
  moutput(d.train, black, [fx(940) - Math.floor(mlength(d.train, 4) / 2), fy(161)], 255, 4);

  // 箭头
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.round(2 * fbl);
  ctx.beginPath();
  const ax0 = fx(940) - Math.floor(mlength('C3895', 4) / 2);
  const ax1 = fx(968) + Math.floor(mlength('C3895', 4) / 2);
  ctx.moveTo(ax0, fy(280));
  ctx.lineTo(ax1, fy(280));
  ctx.moveTo(ax1 - mlength('5', 4), fy(263));
  ctx.lineTo(ax1, fy(280));
  ctx.stroke();

  const date = d.date.split('/');
  if (d.lyjcp === 0) {
    const sep = (unit) => '#3#x+=' + str03(fx(18)) + '#y+=' + str03(fy(25)) + unit +
      '#x+=' + str03(fx(18)) + '#y-=' + str03(fy(25)) + '#5';
    moutput(date[0] + sep('年') + date[1] + sep('月') + date[2] + sep('日') + date[3] + ':' + date[4] +
      '#3#x+=' + str03(fx(18)) + '#y+=' + str03(fy(25)) + '开',
      black, [fx(118), fy(368)], 255, 5);

    // 座位号
    // 【照搬原版】原版条件是 len(seat) > 1 才画，seat[1] 越界会被 try/except 吞掉。
    //   所以「座位号」这种不含「车」字的输入，原版是整行不画的——
    //   这里必须一致，否则会凭空多出一行「座位号车」。
    const seat = d.seat ? d.seat.split('车') : [''];
    if (seat.length > 1 && seat[0] && seat[0] !== '不对号入座' && seat[0] !== '$') {
      let s1 = seat[1] || '';
      if (seat.length > 1 && s1.slice(-1) === '号') {
        s1 = s1.slice(0, -1) + '#3#x+=' + str03(fx(14)) + '#y+=' + str03(fy(14)) + '号';
      }
      moutput('#y+=' + str03(fy(11)) + seat[0] + '#3#x+=' + str03(fx(11)) + '#y+=' + str03(fy(14)) + '车' +
        '#x+=' + str03(fx(11)) + '#y-=' + str03(fy(14)) + '#7' + s1,
        black, [fx(1238), fy(368)], 255, 7);
    } else if (seat[0] === '不对号入座') {
      moutput('不对号入座', black, [fx(1238), fy(368)], 255, 11);
    }
  }

  // 金额
  const hbys = d.hbys;
  if (!hbys || hbys === '$') {
    moutput('#x+=' + str03(fx(18)) + '#y+=' + str03(fy(36)) + '%一08#y-=' + str03(fy(36)) +
      '#x-=' + str03(fx(18)) + '￥' + d.money + '#3#x+=' + str03(fx(11)) + '#y+=' + str03(fy(25)) + '元',
      black, [fx(118), fy(455)], 255, 5);
  } else {
    const parts = hbys.split('|');
    moutput(parts[0] + d.money + '#3#x+=' + str03(fx(11)) + '#y+=024' + (parts[1] || ''),
      black, [fx(118), fy(455)], 255, 5);
  }

  // 中部标记（圆圈）
  if (d.midcode && d.midcode !== 'None' && d.midcode !== '') {
    const mc = d.midcode.split('/');
    let out = '';
    if (mc.length === 1) out = '#零' + str03(12 * fbl) + mc[0];
    else if (mc.length === 2) out = '#x-=' + str03(fx(81)) + '#零' + str03(12 * fbl) + mc[0] +
      '  #x-=' + str03(fx(11)) + '#零' + str03(12 * fbl) + mc[1];
    if (out) moutput(out, black, [fx(888), fy(476)], 255, 19);
  }

  // 席别
  const sc = d.lyjcp !== 0 ? '二等座' : d.seatclass;
  const scNum = d.if_simsun === '1' ? 11 : 7;
  moutput(sc, black, [fx(1587) - mlength(sc, scNum), fy(455)], 255, scNum);

  // 两行提示
  moutput(d.tips1, black, [fx(107), fy(560)], 255, 11);
  moutput(d.tips2, black, [fx(107), fy(665)], 255, 11);

  // 乘客信息
  if (d.idname) {
    let s;
    if (d.idname.length >= 19) {
      s = '#6$#y-=' + str03(fy(7)) + d.idname.slice(0, 10) + '#y+=' + str03(fy(4)) + '****' +
        '#y-=' + str03(fy(4)) + d.idname.slice(14, 19) + '#11#y+=' + str03(fy(7)) + d.idname.slice(19);
    } else {
      s = '#6$#y-=' + str03(fy(2)) + d.idname;
    }
    moutput(s, black, [fx(107), fy(753)], 255, 11);
  }

  // 虚线框
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.round(1 * fbl);
  const kd = 290 / 27 * 3.5;
  for (let i = 0; i < 27; i++) {
    const x0 = fx(205 + kd * i), x1 = fx(205 + kd * i + kd / 3 * 2);
    ctx.beginPath(); ctx.moveTo(x0, fy(832)); ctx.lineTo(x1, fy(832)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x0, fy(962)); ctx.lineTo(x1, fy(962)); ctx.stroke();
  }
  const kd2 = 140 / 4, x2 = 1210;
  for (let i = 0; i < 4; i++) {
    const y0 = fy(832 + kd2 * i), y1 = fy(832 + kd2 * i + kd2 / 3 * 2);
    ctx.beginPath(); ctx.moveTo(fx(200), y0); ctx.lineTo(fx(200), y1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(fx(x2), y0); ctx.lineTo(fx(x2), y1); ctx.stroke();
  }

  // 框内文字
  moutput(d.und1, black, [fx(730) - Math.floor(mlength(d.und1, 16) / 2), fy(844)], 255, 16);
  moutput(d.und2, black, [fx(730) - Math.floor(mlength(d.und2, 16) / 2), fy(904)], 255, 16);
  moutput(d.undl, black, [fx(107), fy(971)], 255, 16);

  // 二维码
  if (d.qrcode && qrImg) ctx.drawImage(qrImg, Math.round(395 * fbl), Math.round(199 * fbl));
}

export const DEFAULT_DATA = {
  red_code: '219K886412', enter_gate: '二楼候车室 19AB',
  sta_chn: '广州南', sta_eng: 'Guangzhounan', train: 'C3798',
  end_chn: '上海虹桥', end_eng: 'Shanghaihongqiao',
  date: '2026/10/18/01/44', seat: '01车04B号', money: '69.0',
  midcode: 'None', seatclass: '新空调软卧', tips1: '', tips2: '仅供报销使用',
  idname: '310107201102080069    <票样>',
  und1: '买票请到12306 发货请到95306', und2: '中国铁路祝您旅途愉快',
  undl: '16555300380707K886412  J M',
  base_pic: 2, qrcode: 0, lyjcp: 0, hbys: '$', if_simsun: '1',
};
