/**
 * 文房藏品定义。
 * rule 由 ProgressManager 统一判定，目前支持：
 *  - mastery：对应章节典藏成就达成
 *  - poem：指定诗篇通关
 *  - hiddenPoem：任意隐藏诗篇通关
 *  - allPoems：全部诗篇通关
 */

export const COLLECTION_ITEMS = [
  {
    id: 'qingya_yan',
    name: '青芽砚',
    glyph: '砚',
    desc: '砚池里养着一小片青芽色的溪光，是青芽谷赠给勤读小诗童的礼物。',
    source: '青芽谷典藏成就「青芽初唱」',
    rule: { type: 'mastery', chapterId: 1 },
  },
  {
    id: 'taoxi_zhen',
    name: '桃溪镇纸',
    glyph: '镇',
    desc: '桃溪岸的落花压成的镇纸，让翻动的书页也安静下来。',
    source: '清溪渡典藏成就「霜叶秋歌」',
    rule: { type: 'mastery', chapterId: 2 },
  },
  {
    id: 'songfeng_bijia',
    name: '松风笔架',
    glyph: '架',
    desc: '一截松枝雕成的小笔架，起风时会发出很轻的松涛声。',
    source: '松风书院典藏成就「松风墨香」',
    rule: { type: 'mastery', chapterId: 3 },
  },
  {
    id: 'yunjian_mo',
    name: '云涧墨锭',
    glyph: '墨',
    desc: '用云涧松烟制出的墨，磨开时像山岚慢慢散在砚池里。',
    source: '云涧古观典藏成就「空山知音」',
    rule: { type: 'mastery', chapterId: 4 },
  },
  {
    id: 'yunlu_yin',
    name: '云麓印章',
    glyph: '印',
    desc: '云麓文庄藏书楼的老印章，印面刻着一座小小的山。',
    source: '云麓文庄典藏成就「云麓藏印」',
    rule: { type: 'mastery', chapterId: 5 },
  },
  {
    id: 'lingxiao_yin',
    name: '凌霄诗印',
    glyph: '霄',
    desc: '登上凌霄诗台才会得到的星纹诗印，映着一点点夜色。',
    source: '凌霄诗台典藏成就「凌霄诗心」',
    rule: { type: 'mastery', chapterId: 6 },
  },
  {
    id: 'kongshan_yin',
    name: '空山小印',
    glyph: '空',
    desc: '在幽静山林里寻到的一方小印，印面只有一层淡淡的青苔。',
    source: '找到隐藏诗碑《鹿柴》',
    rule: { type: 'poem', poemId: 8 },
  },
  {
    id: 'shishan_zhuren',
    name: '诗山主人印',
    glyph: '诗',
    desc: '走遍诗山、点亮全部诗卡后，诗山为你盖下的主人印。',
    source: '全部诗卡收集完成',
    rule: { type: 'allPoems' },
  },
];

export function getCollectionItem(itemId) {
  return COLLECTION_ITEMS.find((item) => item.id === itemId) || null;
}

export function getCollectionItemByChapter(chapterId) {
  return COLLECTION_ITEMS.find(
    (item) => item.rule.type === 'mastery' && item.rule.chapterId === Number(chapterId),
  ) || null;
}
