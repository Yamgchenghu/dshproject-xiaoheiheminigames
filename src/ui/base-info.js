/**
 * 基准分查询 —— 把量化规则摊开给玩家看。
 *
 * 【为什么要做这个页面】量化规则本身是公平的，但它藏在代码里。
 *   玩家看到「我打了 850 分，总分怎么才 118」会觉得是黑箱：
 *   凭什么扫雷 240 分就是 100、2048 要 6000 才 100？
 *   把「每个模式的基准是多少、我这局拿了多少、折算成多少基准分」
 *   逐行列出来，规则就从黑箱变成可以自己验算的公式。
 *
 * 【为什么不做成静态文档】基准分跟着版本调（比如新增休闲模式就补了一条）。
 *   文档写在别处必然和代码脱节，玩家照着旧文档算会算错。
 *   这里所有数字都从 quantize.js 实时读，代码改了页面立刻跟着变。
 */
import { h } from '../core/util.js';
import { GAMES } from '../games/index.js';
import { baseOf, quantize, Q_CAP, liushuiBase } from '../core/quantize.js';
import { MIN_COINS_FOR_RANK } from '../tools/donghai/scoring.js';
import { loadScores, getBestSync } from '../core/scores.js';

const EMOJI = {
  minesweeper: '💣', fruitninja: '🍉', g2048: '🔢', snake: '🐍', liushui: '🫗',
  donghai: '🐉',
};

/**
 * 这些游戏的成绩是小数，显示时不能取整。
 *
 * 【为什么】推币机存的是「每币平均彩票」，基准 5.625，正常发挥 5.3~5.73。
 *   取整后 5.73 显示成 6、5.3 也显示成 5，玩家看不出"我离基准还差多少"，
 *   而这张表存在的意义就是让玩家能自己验算。
 */
const FRACTIONAL_GAMES = new Set(['donghai']);

/** 一行：模式名 + 基准 / 我的最好 / 折算分 */
function row(label, sub, base, best, gameId) {
  const played = best > 0;
  // 小数型游戏保留 3 位，其余按原来的整数显示
  const bestText = FRACTIONAL_GAMES.has(gameId)
    ? String(Math.round(best * 1000) / 1000)
    : String(Math.round(best));
  const q = played && base > 0 ? quantize(best, base) : 0;
  return h('div', { class: 'base-row' }, [
    h('div', { class: 'base-row-name' }, [
      h('div', {}, label),
      sub ? h('div', { class: 'base-row-sub' }, sub) : null,
    ]),
    h('div', { class: 'base-row-nums' }, [
      h('span', { class: 'base-cell' }, [
        h('span', { class: 'base-cell-k' }, '基准'),
        h('span', { class: 'base-cell-v' }, String(base)),
      ]),
      // 没玩过时显示破折号而不是 0：0 看着像「打了但得 0 分」，
      // 和「还没打过」是两件事，玩家会误以为记录丢了。
      h('span', { class: 'base-cell' }, [
        h('span', { class: 'base-cell-k' }, '我的最好'),
        h('span', { class: 'base-cell-v' }, played ? bestText : '—'),
      ]),
      h('span', { class: 'base-cell base-cell-q' }, [
        h('span', { class: 'base-cell-k' }, '基准分'),
        // 【未游玩也显示破折号】原本这里写 '0'，而左边「我的最好」是 '—'，
        //   同一行两种写法看着像两回事。而且玩家会疑惑"基准分凭什么是 0"。
        //   统一成 '—' 表示"还没有这个数据"，语义才对得上。
        h('span', { class: 'base-cell-v' + (played ? '' : ' dim') },
          played ? q.toFixed(1) : '—'),
      ]),
    ]),
  ]);
}

export async function openBaseInfo() {
  // 先读存档：要显示「我拿了多少」，没读之前全是未游玩
  await loadScores();

  const mask = h('div', { class: 'modal-mask' }, []);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });

  const listHost = h('div', {});
  const modal = h('div', {
    class: 'modal',
    style: { maxHeight: '84vh', overflowY: 'auto' },
  }, [
    h('div', { class: 'modal-grip' }),
    h('h2', {}, '基准分查询'),
    h('div', { class: 'lb-note', style: { lineHeight: '1.75' } }, [
      '每个模式有一个基准分，是普通玩家认真玩一局的典型成绩。',
      h('br'),
      '达到基准 = 100 分；超过按对数加分（每翻一倍 +10）；低于按比例折算。',
      h('br'),
      '没玩过的模式记 0 分，不是 100 分。',
    ]),
    listHost,
    h('div', { class: 'btn-row', style: { marginTop: '14px' } }, [
      h('button', { class: 'btn block', onclick: () => close() }, '关闭'),
    ]),
  ]);
  mask.appendChild(modal);
  document.body.appendChild(mask);

  function close() { mask.remove(); }

  let total = 0;

  for (const g of GAMES) {
    const block = h('div', { style: { marginTop: '14px' } }, [
      h('div', { class: 'section-title' }, (EMOJI[g.id] || '') + ' ' + g.title),
    ]);
    for (const m of g.modes) {
      const base = baseOf(g.id, m.value);
      const best = getBestSync(g.id, m.value);
      if (base > 0 && best > 0) total += quantize(best, base);
      block.appendChild(row(m.label, m.sub || '', base, best));
    }
    listHost.appendChild(block);
  }

  // ---- 东海龙珠单独列 ----
  // 【为什么它不在上面的循环里】上面遍历的是 GAMES，而东海龙珠登记在
  //   DONGHAI_META（只进 ALL_GAMES）—— 它不是"打完一局出一个分"的游戏，
  //   计分口径是「每币平均彩票」，还有自己的每日挑战和周榜。
  //   结果就是这张表里一直没有它，玩家对不上总分为什么多了这一项。
  // 【为什么副标题要写"每币"】它的分数语义和其他游戏相反：
  //   别的游戏分越高越好、玩越久分越高；它投币越多总分越高反而是坏成绩。
  //   不写清楚，玩家会拿"总彩票数"来对基准，永远对不上。
  {
    const dBase = baseOf('donghai', 'classic');
    const dBest = getBestSync('donghai', 'classic');
    if (dBase > 0) {
      if (dBest > 0) total += quantize(dBest, dBase);
      listHost.appendChild(h('div', { style: { marginTop: '14px' } }, [
        h('div', { class: 'section-title' }, (EMOJI.donghai || '') + ' 东海龙珠'),
        row(
          '每币平均彩票',
          '成绩 = 本局彩票 ÷ 已用币；基准 45÷8，即每币 5.625 张。' +
            '满 ' + MIN_COINS_FOR_RANK + ' 币才计入周榜',
          dBase,
          dBest,
          'donghai',
        ),
      ]));
    }
  }

  // ---- 流水入杯单独列 ----
  // 【为什么不套上面的循环】它不是「一个模式一个基准」，而是 14 关总分
  //   当成一个整体算基准。套循环会显示成 14 行一样的数字，反而看不懂。
  const lb = liushuiBase();
  // 【这里原来算错了】流水入杯存两份数据：
  //   liushui.lvN   = 该关接住的滴数（给"解锁下一关"用，TARGET_DROPS=190 判达标）
  //   liushui_q.lvN = 该关得分 = 滴数 − 190（真正参与量化的值）
  //   原来这里读的是 liushui.lvN（滴数），直接和 437 比，
  //   等于把"滴数"当成"分数"，14 关随便打打就上千滴 → 基准分虚高好几倍。
  //   排行榜的 totalQuantized 读的是 liushui_q，两边必须一致。
  let lbBest = 0;
  for (let i = 1; i <= 14; i++) lbBest += getBestSync('liushui_q', 'lv' + i);
  if (lbBest > 0) total += quantize(lbBest, lb);
  listHost.appendChild(h('div', { style: { marginTop: '14px' } }, [
    h('div', { class: 'section-title' }, (EMOJI.liushui || '') + ' 流水入杯'),
    // 【这里要说清"得分"而不是"总分"】流水的存档值有两种：滴数和得分。
    //   玩家如果按"我接了 2800 滴"来对这张表，会完全对不上——
    //   参与量化的是 14 关得分之和（每关 = 滴数 − 190），
    //   所以副标题必须写明减了多少，否则这张表看着像算错了。
    // 【副标题要说清水球】基准里有 448 分来自机关水球（560 颗 × 80%）。
    //   不写清楚的话，玩家按"14 关 × 35 分上限"去对 885 会觉得完全不可能达到。
    row('14 关得分之和', '每关得分 = 入杯滴数 − 190；基准 = 公式 437 + 水球释放量 80%（448）', lb, lbBest),
  ]));

  // ---- 底部总分 ----
  // 【为什么要把总分也算一遍】玩家可以拿这张表自己加一遍。
  //   对得上才说明规则是真的透明，而不是我们说了算。
  listHost.appendChild(h('div', { class: 'base-total' }, [
    h('span', {}, '按上表累加，我的当前总分'),
    h('span', { class: 'base-total-v' }, total.toFixed(1)),
  ]));
  listHost.appendChild(h('div', {
    class: 'hint',
    style: { marginTop: '8px', lineHeight: '1.7' },
  }, '单模式封顶 ' + Q_CAP + ' 分。超过基准越多加分越慢，刷同一个模式的收益会递减。'));
}
