// 火车票根生成器 —— 数据模型与 data.txt 读写。
// 【字段行号是硬约定】原版按固定下标读 data.txt（data[4]、data[7]…），
//   改任何一行都会整体错位，所以这里严格按 0 基下标映射，且写回时补齐 68 行。

export const FIELDS = [
  { key: 'red_code',   line: 5,  label: '红色票号',   hint: '票面左上角红色编码，与底部票据号有相关性' },
  { key: 'enter_gate', line: 8,  label: '检票口',     hint: '填「检票：」后面的内容，如「二楼候车室 19AB」' },
  { key: 'sta_chn',    line: 11, label: '出发站',     hint: '中文站名；前面加 #10 可切换花体（simw）' },
  { key: 'sta_eng',    line: 13, label: '出发站拼音', hint: '如 Guangzhounan' },
  { key: 'train',      line: 16, label: '车次',       hint: '如 C3798' },
  { key: 'end_chn',    line: 19, label: '到达站',     hint: '中文站名' },
  { key: 'end_eng',    line: 21, label: '到达站拼音', hint: '如 Shanghaihongqiao' },
  { key: 'date',       line: 23, label: '发车时间',   hint: 'YYYY/MM/DD/HH/MiMi' },
  { key: 'seat',       line: 26, label: '座位号',     hint: '如 01车04B号；填「不对号入座」有专门版式' },
  { key: 'money',      line: 28, label: '价格',       hint: '带小数点，如 69.0' },
  { key: 'midcode',    line: 31, label: '特殊票种',   hint: '多个用 / 分隔，如 惠/学；无则填 None' },
  { key: 'seatclass',  line: 34, label: '席别',       hint: '如 新空调软卧、二等座' },
  { key: 'tips1',      line: 37, label: '提示第一行', hint: '如 限乘当日当次车，可留空' },
  { key: 'tips2',      line: 40, label: '提示第二行', hint: '如 仅供报销使用，可留空' },
  { key: 'idname',     line: 43, label: '乘客信息',   hint: '身份证号会自动打星号' },
  { key: 'und1',       line: 47, label: '框内第一行', hint: '居中显示' },
  { key: 'und2',       line: 48, label: '框内第二行', hint: '居中显示' },
  { key: 'undl',       line: 51, label: '票据号',     hint: '21 位票据号及发售站信息' },
];

export const DEFAULTS = {
  red_code: '219K886412', enter_gate: '二楼候车室 19AB',
  sta_chn: '广州南', sta_eng: 'Guangzhounan', train: 'C3798',
  end_chn: '上海虹桥', end_eng: 'Shanghaihongqiao',
  date: '2026/10/18/01/44', seat: '01车04B号', money: '69.0',
  midcode: 'None', seatclass: '新空调软卧', tips1: '', tips2: '仅供报销使用',
  idname: '310107201102080069    <票样>',
  und1: '买票请到12306 发货请到95306', und2: '中国铁路祝您旅途愉快',
  undl: '16555300380707K886412  J M',
  base_pic: 2, qrcode: 0, lyjcp: 0, hbys: '$', if_simsun: '1', fbl: 3.5,
};

const TOTAL_LINES = 68;

/** 解析 data.txt。按 0 基下标取值，缺行用空串兜底。 */
export function parseDataTxt(text) {
  const lines = text.split(/\r?\n/);
  const at = (i) => (lines[i] === undefined ? '' : String(lines[i]).trim());
  const d = {};
  for (const f of FIELDS) d[f.key] = at(f.line - 1);
  d.base_pic = parseInt(at(54), 10) || 0;
  d.qrcode = parseInt(at(56), 10) || 0;
  d.lyjcp = parseInt(at(58), 10) || 0;
  d.hbys = at(60) || '$';
  d.if_simsun = at(62) || '1';
  d.fbl = parseFloat(at(64)) || 3.5;
  return d;
}

/** 写回 data.txt。必须保持 68 行，否则原版读不到。 */
export function buildDataTxt(d) {
  const lines = new Array(TOTAL_LINES).fill('');
  for (const f of FIELDS) lines[f.line - 1] = d[f.key] === undefined ? '' : String(d[f.key]);
  lines[3] = '↓↓红色车票编号输入区↓↓';
  lines[6] = '↓↓检票口名称输入区↓↓';
  lines[9] = '↓↓请输入乘车站中文名称↓↓';
  lines[11] = '↓↓请输入乘车站拼音↓↓';
  lines[14] = '↓↓请输入车次号↓↓';
  lines[17] = '↓↓请输入到达站中文名称↓↓';
  lines[19] = '↓↓请输入到达站拼音↓↓';
  lines[21] = '↓↓请输入发车时间↓↓（YYYY/MM/DD/HH/MiMi）';
  lines[24] = '↓↓请输入座位号↓↓';
  lines[26] = '↓↓请输入价格↓↓（带小数点）';
  lines[29] = '↓↓请输入特殊票种↓↓(每个字符以/隔开，没有请填None)';
  lines[32] = '↓↓请输入席别↓↓';
  lines[35] = '↓↓请输入第一行提示↓↓';
  lines[38] = '↓↓请输入第二行提示↓↓';
  lines[41] = '↓↓请输入乘客信息↓↓';
  lines[45] = '↓↓请输入框内提示↓↓';
  lines[49] = '↓↓请输入21位票据号及发售站信息↓↓';
  lines[53] = '<使用背景>';
  lines[55] = '<使用二维码>';
  lines[57] = '<旅游计次票>';
  lines[59] = '<货币符号及单位>（以绝对值隔开，前者货币符号，后者单位）';
  lines[61] = '<是否宋体显示坐席>';
  lines[63] = '<显示分辨率倍数>';
  lines[54] = String(d.base_pic);
  lines[56] = String(d.qrcode);
  lines[58] = String(d.lyjcp);
  lines[60] = d.hbys || '$';
  lines[62] = String(d.if_simsun);
  lines[64] = String(d.fbl);
  return lines.join('\r\n');
}

const STORE_KEY = 'rail_ticket_v1';
export function loadLocal() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
export function saveLocal(d) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch {}
}
