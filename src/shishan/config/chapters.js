/**
 * 六大章节配置。
 * 章节名、片区、典藏成就集中在这里，地图与界面都从这里读取，方便后续扩展。
 */

export const CORE_UNLOCK_THRESHOLD = 0.6; // 课内篇目完成度达到 60% 解锁下一章

export const CHAPTERS = [
  {
    id: 1,
    name: '青芽谷',
    seal: '壹',
    areas: ['溪边草甸', '桑林小院', '月下浅滩'],
    tagline: '溪草初青，读第一声鹅鸣',
    palette: 'garden',
    mastery: {
      title: '青芽初唱',
      desc: '课内篇目全部完成，并收齐本章轶事',
      collectionId: 'qingya_yan',
    },
  },
  {
    id: 2,
    name: '清溪渡',
    seal: '贰',
    areas: ['桃溪岸', '飞瀑台', '渔翁渡口'],
    tagline: '桃溪落英，听飞瀑与渔歌',
    palette: 'peach',
    mastery: {
      title: '霜叶秋歌',
      desc: '课内篇目全部完成，并收齐本章轶事',
      collectionId: 'taoxi_zhen',
    },
  },
  {
    id: 3,
    name: '松风书院',
    seal: '叁',
    areas: ['前院书廊', '听雨斋', '后园荷池'],
    tagline: '松风翻书，雨声入砚池',
    palette: 'pine',
    mastery: {
      title: '松风墨香',
      desc: '完成本章全部可见篇目，并收齐本章轶事',
      collectionId: 'songfeng_bijia',
    },
  },
  {
    id: 4,
    name: '云涧古观',
    seal: '肆',
    areas: ['松涧石台', '竹里静舍', '观内讲经堂'],
    tagline: '云深涧静，松间有琴声',
    palette: 'mist',
    mastery: {
      title: '空山知音',
      desc: '课内篇目全部完成，并收齐本章轶事',
      collectionId: 'yunjian_mo',
    },
  },
  {
    id: 5,
    name: '云麓文庄',
    seal: '伍',
    areas: ['石桥古巷', '枫亭古道', '藏书阁楼'],
    tagline: '古巷石桥，藏书楼里读春秋',
    palette: 'maple',
    mastery: {
      title: '云麓藏印',
      desc: '完成本章全部可见篇目，并收齐本章轶事',
      collectionId: 'yunlu_yin',
    },
  },
  {
    id: 6,
    name: '凌霄诗台',
    seal: '陆',
    areas: ['四方诗亭', '百味诗廊', '文会雅厅', '溯源石室', '星碑秘境'],
    tagline: '登临诗台，与古今诗心相逢',
    palette: 'star',
    challengeOnly: true,
    mastery: {
      title: '凌霄诗心',
      desc: '集齐前五章典藏成就',
      collectionId: 'lingxiao_yin',
      requiresAllPrevious: true,
    },
  },
];

export function getChapterConfig(chapterId) {
  return CHAPTERS.find((chapter) => chapter.id === Number(chapterId)) || null;
}

export function getChapterName(chapterId) {
  return getChapterConfig(chapterId)?.name || `第${chapterId}章`;
}
