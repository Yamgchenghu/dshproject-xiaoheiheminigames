/**
 * festivals.js：节气 / 节日限时诗碑。
 * ------------------------------------------------------------
 * 玩法：读取本机系统日期，如果今天前后落在某个节气或传统节日，
 * 地图上就会多出一块「今日诗碑」交互点，读一首应景的小诗，
 * 还能把这张「节气诗笺」收进存档。
 *
 * 日期计算：
 *  - 节气：用通行的「Y×0.2422 + C」近似公式（21 世纪系数），误差 ±1 天，
 *    对游戏来说足够准确；
 *  - 农历节日：交给浏览器内置的 Intl 中国历（new Intl.DateTimeFormat('zh-CN-u-ca-chinese')），
 *    不写死年份表，跨年也不会失效。
 *
 * 本文件只做纯日期计算与文案，不依赖 Phaser 与网络；
 * 诗篇内容由调用方（MapScene）从 DataManager 里取，方便 Node 侧直接测试。
 */

/** 24 节气：名称 / 21 世纪系数 C / 应景诗 / 一句话说明 */
export const SOLAR_TERMS = [
  { id: 'xiaohan', name: '小寒', c: 5.4055, poemId: 5, seal: '寒', note: '小寒一到，风里就有了冬天的味道。墙角那枝梅花，正悄悄地香。' },
  { id: 'dahan', name: '大寒', c: 20.12, poemId: 72, seal: '雪', note: '大寒是一年里最冷的时候。山里人家早早生起了火，等一场雪落下来。' },
  { id: 'lichun', name: '立春', c: 3.87, poemId: 40, seal: '春', note: '立春是春天写来的第一封信，柳条读懂了，就抽出嫩嫩的绿。' },
  { id: 'yushui', name: '雨水', c: 18.73, poemId: 41, seal: '雨', note: '雨水节气，细细的春雨像针一样落下来，花草都仰起脸接水喝。' },
  { id: 'jingzhe', name: '惊蛰', c: 5.63, poemId: 45, seal: '雷', note: '一声春雷，把小虫子和山里的鸟都叫醒了。山谷里忽然热闹起来。' },
  { id: 'chunfen', name: '春分', c: 20.646, poemId: 19, seal: '分', note: '春分这天，白天和黑夜一样长。太阳暖暖的，连泥土都带着香味。' },
  { id: 'qingming', name: '清明', c: 4.81, poemId: 24, seal: '青', note: '清明时节雨纷纷。出门踏青的时候，别忘了带一把小伞。' },
  { id: 'guyu', name: '谷雨', c: 20.1, poemId: 54, seal: '谷', note: '谷雨落下来，湖水涨了，花也开得正好，是春天最后一场盛大的花事。' },
  { id: 'lixia', name: '立夏', c: 5.52, poemId: 11, seal: '夏', note: '立夏到了，莲叶铺满水面。小船划进去，就像钻进一片绿色的云。' },
  { id: 'xiaoman', name: '小满', c: 21.04, poemId: 52, seal: '满', note: '小满说的是麦粒渐渐饱满。原上的草长得很高，风一吹就翻起绿浪。' },
  { id: 'mangzhong', name: '芒种', c: 5.678, poemId: 10, seal: '种', note: '芒种是农人最忙的日子。碗里的每一粒米，都来自田里的汗珠。' },
  { id: 'xiazhi', name: '夏至', c: 21.37, poemId: 57, seal: '荷', note: '夏至白天最长。傍晚划船回家，荷叶太密，惊起一滩水鸟。' },
  { id: 'xiaoshu', name: '小暑', c: 7.108, poemId: 68, seal: '暑', note: '小暑的雨来得又快又急，像有人把一盆水从云上倒了下来。' },
  { id: 'dashu', name: '大暑', c: 22.83, poemId: 58, seal: '蝉', note: '大暑的夜里，稻香混着蛙声。抬头看，月亮正走在中天的路上。' },
  { id: 'liqiu', name: '立秋', c: 7.5, poemId: 14, seal: '秋', note: '立秋后，风里凉了一点点。夜里听风，会想起很远的地方。' },
  { id: 'chushu', name: '处暑', c: 23.13, poemId: 36, seal: '溪', note: '处暑一来，暑气就退了。雨后的山溪最清，船从莲叶旁轻轻滑过。' },
  { id: 'bailu', name: '白露', c: 7.646, poemId: 65, seal: '露', note: '白露天，草叶上挂着亮晶晶的小露珠。天高云淡，像一幅铺开的画。' },
  { id: 'qiufen', name: '秋分', c: 23.042, poemId: 4, seal: '叶', note: '秋分把秋天分成两半。上山的小路上，红叶比花还好看。' },
  { id: 'hanlu', name: '寒露', c: 8.318, poemId: 13, seal: '菊', note: '寒露到了，荷花谢了，菊花开得正好。别急着叹气，好景还在后头。' },
  { id: 'shuangjiang', name: '霜降', c: 23.438, poemId: 37, seal: '霜', note: '霜降的清晨，屋瓦上像撒了一层薄盐。夜里停船，钟声能传得很远。' },
  { id: 'lidong', name: '立冬', c: 7.438, poemId: 72, seal: '冬', note: '立冬了，白天变短。山里的柴门被轻轻敲响，是赶路的客人来借宿。' },
  { id: 'xiaoxue', name: '小雪', c: 22.36, poemId: 50, seal: '钓', note: '小雪前后，江面上白茫茫一片。老渔翁披着蓑衣，独坐船头钓鱼。' },
  { id: 'daxue', name: '大雪', c: 7.18, poemId: 74, seal: '冰', note: '大雪节气，一夜之间树都白了。像春风吹开千树万树的梨花。' },
  { id: 'dongzhi', name: '冬至', c: 21.94, poemId: 9, seal: '夜', note: '冬至夜最长。窗外的月光像霜，落在床前，也落在思念里。' },
];

/** 传统节日（农历）：春节 / 元宵 / 端午 / 七夕 / 中秋 / 重阳 / 腊八 */
export const LUNAR_FESTIVALS = [
  {
    id: 'festival_spring', name: '春节', lunar: { month: 1, day: 1 }, windowDays: 2, poemId: 23, seal: '年',
    note: '爆竹声中一岁除。新的一年，愿你读更多好诗，走更多山路。',
  },
  {
    id: 'festival_lantern', name: '元宵', lunar: { month: 1, day: 15 }, windowDays: 1, poemId: 9, seal: '灯',
    note: '元宵的月亮又圆又亮，灯谜猜累了，就来读一首和月亮有关的诗。',
  },
  {
    id: 'festival_duanwu', name: '端午', lunar: { month: 5, day: 5 }, windowDays: 1, poemId: 11, seal: '粽',
    note: '端午有粽子、有龙舟，还有满池的莲叶。愿你今天玩得开心，也读得开心。',
  },
  {
    id: 'festival_qixi', name: '七夕', lunar: { month: 7, day: 7 }, windowDays: 1, poemId: 46, seal: '星',
    note: '七夕的星星特别亮。古人把想念写进诗里，几千年后读起来还是温热的。',
  },
  {
    id: 'festival_midautumn', name: '中秋', lunar: { month: 8, day: 15 }, windowDays: 2, poemId: 66, seal: '月',
    note: '中秋的月亮最圆。不管离家多远，抬头看的都是同一轮月。',
  },
  {
    id: 'festival_chongyang', name: '重阳', lunar: { month: 9, day: 9 }, windowDays: 1, poemId: 25, seal: '菊',
    note: '重阳要登高、要插茱萸。今天读一首想家的诗，给家里人一个拥抱吧。',
  },
  {
    id: 'festival_laba', name: '腊八', lunar: { month: 12, day: 8 }, windowDays: 1, poemId: 73, seal: '粥',
    note: '腊八粥要慢慢熬，好诗也要慢慢读。天冷了，记得把手捂暖。',
  },
];

/** 节气近似日期公式里的月份归属（小寒、大寒在 1 月，往后每两个节气一个月） */
const TERM_MONTHS = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12];

const DAY_MS = 24 * 60 * 60 * 1000;

function atNoon(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return atNoon(next);
}

function diffDays(a, b) {
  return Math.round((atNoon(a).getTime() - atNoon(b).getTime()) / DAY_MS);
}

/**
 * 某个节气在指定年份的近似日期（±1 天，够游戏使用）。
 * @param {string} termName 节气名
 * @param {number} year 公历年
 * @returns {Date|null}
 */
export function getSolarTermDate(termName, year) {
  const index = SOLAR_TERMS.findIndex((term) => term.name === termName || term.id === termName);
  if (index < 0) return null;
  const term = SOLAR_TERMS[index];
  const y = ((year % 100) + 100) % 100;
  const leapCount = Math.floor((y - 1) / 4);
  const day = Math.floor(y * 0.2422 + term.c) - leapCount;
  return new Date(year, TERM_MONTHS[index] - 1, Math.max(1, day), 12, 0, 0, 0);
}

/**
 * 用浏览器中国历把公历转成农历。
 * @param {Date} date
 * @returns {{month:number, day:number, isLeap:boolean}|null}
 */
export function getLunarDate(date) {
  try {
    const formatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'numeric', day: 'numeric' });
    const parts = formatter.formatToParts(atNoon(date));
    const monthPart = parts.find((part) => part.type === 'month')?.value || '';
    const dayPart = parts.find((part) => part.type === 'day')?.value || '';
    const month = Number(String(monthPart).replace(/[^\d]/g, ''));
    const day = Number(String(dayPart).replace(/[^\d]/g, ''));
    if (!month || !day) return null;
    return { month, day, isLeap: /闰/.test(String(monthPart)) };
  } catch (error) {
    return null;
  }
}

function formatDateLabel(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * 取今天（或指定日期）正生效的限时事件。
 * @param {Date} [date]
 * @returns {Array<object>} 事件对象，节日优先
 */
export function getTodayEvents(date = new Date()) {
  const target = atNoon(date);
  const events = [];

  // 1) 农历节日：前后 windowDays 天内都算「限时」
  if (getLunarDate(target)) {
    LUNAR_FESTIVALS.forEach((festival) => {
      for (let offset = -festival.windowDays; offset <= festival.windowDays; offset += 1) {
        const day = addDays(target, offset);
        const lunar = getLunarDate(day);
        if (!lunar || lunar.isLeap) continue;
        if (lunar.month === festival.lunar.month && lunar.day === festival.lunar.day) {
          events.push({
            ...festival,
            kind: 'festival',
            dateLabel: formatDateLabel(day),
            windowDays: festival.windowDays,
            offset,
            exact: offset === 0,
          });
          break;
        }
      }
    });
  }

  // 2) 节气：误差 ±1 天，今天前后各一天都算
  const years = [target.getFullYear() - 1, target.getFullYear(), target.getFullYear() + 1];
  const termWindow = 1;
  years.forEach((year) => {
    SOLAR_TERMS.forEach((term) => {
      const termDate = getSolarTermDate(term.name, year);
      if (!termDate) return;
      const offset = diffDays(target, termDate);
      if (Math.abs(offset) > termWindow) return;
      events.push({
        ...term,
        kind: 'term',
        dateLabel: formatDateLabel(termDate),
        windowDays: termWindow,
        offset,
        exact: offset === 0,
      });
    });
  });

  // 同一天里，节日排在节气前面；去重
  const seen = new Set();
  return events
    .sort((a, b) => (a.kind === b.kind ? Math.abs(a.offset) - Math.abs(b.offset) : a.kind === 'festival' ? -1 : 1))
    .filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });
}

/** 按 id 取事件定义（调试、预览用） */
export function getEventById(id) {
  const term = SOLAR_TERMS.find((item) => item.id === id || `term_${item.id}` === id);
  if (term) {
    const year = new Date().getFullYear();
    const date = getSolarTermDate(term.name, year);
    return { ...term, kind: 'term', dateLabel: formatDateLabel(date), windowDays: 1, offset: 0, exact: true };
  }
  const festival = LUNAR_FESTIVALS.find((item) => item.id === id);
  if (festival) {
    return { ...festival, kind: 'festival', dateLabel: '', windowDays: festival.windowDays, offset: 0, exact: true };
  }
  return null;
}

/** 顶部小标签文案：今日 · 霜降 · 10月23日 */
export function getEventChipLabel(event, date = new Date()) {
  if (!event) return '';
  if (event.kind === 'festival') return `今日 · ${event.name}`;
  return `今日 · ${event.name} · ${event.dateLabel}`;
}

export default getTodayEvents;
