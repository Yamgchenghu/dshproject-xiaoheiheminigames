/**
 * 我的页：游玩记录 + 成就 + 总时长。
 *
 * 【为什么"总时长"单独放一个显眼的位置】用户要求"至少能看到自己的游玩记录"，
 *   而时长是最直观的"我投入了多少"的度量；场次和最高分都不如它直观。
 */
import { h, formatDuration, formatDate } from '../core/util.js';
import { GAMES, ALL_GAMES } from '../games/index.js';
import { loadProfile } from '../core/achievements.js';
import { openLeaderboard } from './leaderboard.js';
import { openBaseInfo } from './base-info.js';
import { FEATURES } from '../core/variant.js';
import { toast } from './toast.js';
import { getMode } from '../sdk/hb.js';
import { getAccount, requestProfileAuth, refreshAccount } from '../sdk/account.js';
import { totalQuantized } from '../core/quantize.js';
import { getAllSync } from '../core/scores.js';

/**
 * 综合总分榜的「伪游戏」元信息。
 *
 * 【为什么要造一个不存在的游戏】openLeaderboard 的入参是 { meta, mode }，
 *   它只用到 meta.title 和 meta.id。总榜不属于任何一款具体游戏，
 *   传 total 这个 id 能让 leaderboard 里的 hasCloudBoard('total','all') 命中，
 *   从而正确走云端而不是降级到本机榜。
 */
const TOTAL_META = { id: 'total', title: '综合总分榜' };

const EMOJI = {
  minesweeper: '💣',
  fruitninja: '🍉',
  g2048: '🔢',
  snake: '🐍',
};

export function renderMineTab(state, rerender) {
  const box = h('div', {});
  const p = state.profile;

  // ---- 用户卡 ----
  // 【为什么要区分四种状态】以前只有「有昵称 / 没有昵称」两种，于是未登录、
  //   浏览器预览、读取失败全都显示成「本机玩家」，用户无法判断自己到底登没登录。
  const acc = state.account || getAccount();
  const loggedIn = acc.state === 'ok';
  const avatar = acc.avatar
    ? h('img', { class: 'avatar', src: acc.avatar, alt: '' })
    : h('div', { class: 'avatar' }, loggedIn ? (acc.nickname || '玩').slice(0, 1) : '🙂');

  const subText = loggedIn
    ? (state.modeLabel || '小黑盒客户端')
    : acc.state === 'guest'
      ? '未登录小黑盒账号'
      : acc.state === 'hostless'
        ? '浏览器预览（无账号）'
        : '账号信息读取失败，稍后重试';

  // 【工具版为什么简化账号卡】工具版不显示登录，也不上传成绩，
  //   继续显示"未登录 / 账号读取失败"只会让人以为出了故障。
  //   这里改成中性的说明，只保留「设置」入口。
  box.appendChild(
    h('div', { class: 'profile-card' }, [
      FEATURES.login ? avatar : h('div', { class: 'avatar' }, '🧰'),
      h('div', { style: { flex: '1', minWidth: '0' } }, [
        h('div', { class: 'who' }, FEATURES.login
          ? (loggedIn ? acc.nickname : (acc.state === 'guest' ? '未登录' : '本机玩家'))
          : '学习与实用工具'),
        h('div', { class: 'sub' }, FEATURES.login
          ? subText
          : '单词机 · 转盘 · 诗山寻踪'),
      ]),
      h('button', { class: 'hud-btn', onclick: () => openSettingsFromHere() }, '设置'),
    ]),
  );

  // ---- 未登录提示 ----
  // 只有在客户端里、且确实未登录时才提示；浏览器预览提示登录没有意义。
  // 【为什么 error 状态也要给按钮】静默读取失败时（宿主账号上下文持续变化），
  //   用户如果连个"登录"按钮都看不到，就彻底没有自救的出口了。
  //   主动调 auth.login 会重新建立账号上下文，这是唯一能绕过静默读取失败的办法。
  // 【工具版不显示登录】用户要求工具版移除登录。工具版不需要身份——
  //   没有排行榜要显示昵称，存档走的是账号云存储（平台自动带身份），
  //   不需要用户额外授权。弹授权框只会让人困惑"我为什么要登录"。
  if (FEATURES.login && !loggedIn && (acc.state === 'guest' || acc.state === 'error') && getMode() === 'host') {
    const isError = acc.state === 'error';
    box.appendChild(
      h('div', { class: 'login-hint' }, [
        h('div', { style: { flex: '1' } }, [
          h('b', {}, isError ? '账号读取失败' : '未登录'),
          h('div', {}, isError
            ? '可能是刚切换过小黑盒账号。点右侧重新授权即可恢复。'
            : '登录后才能把成绩传到云端排行榜、并在换设备后找回存档。'),
        ]),
        h('button', {
          class: 'hud-btn',
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            btn.textContent = '登录中…';
            const r = await requestProfileAuth();
            if (r.ok) {
              await refreshAccount({ useCache: false });
              state.account = getAccount();
              state.user = state.account.user;
              rerender();
            } else {
              // 失败要把按钮恢复，否则用户以为卡死了，也没有重试入口
              btn.disabled = false;
              btn.textContent = '重试登录';
              if (r.reason === 'cancelled') toast('已取消授权', 'warn');
              else toast('登录失败：' + (r.reason || '未知原因'), 'warn');
            }
          },
        }, isError ? '重新授权' : '登录'),
      ]),
    );
  }

  // ---- 总览 ----
  // 【工具版没有游玩记录与成就】这些数据全部来自游戏，
  //   工具版已移除游戏，继续显示"总场次 0 / 成就 0/16"只会让人以为坏了。
  // 【工具版仍要显示诗山的进度】诗山寻踪是学习类内容，属于工具版；
  //   只有扫雷/2048 那些才搬走了。所以这里不是整段跳过，而是把统计范围
  //   收窄到"工具版里还在的游戏"（也就是诗山）。
  //   直接 return 会连诗山的收集进度一起藏掉，那是错的。
  const shownGames = FEATURES.games ? ALL_GAMES : ALL_GAMES.filter((g) => g.isStoryGame);
  if (!shownGames.length) {
    box.appendChild(h('div', { class: 'card' }, [
      h('h3', {}, '关于'),
      h('div', { class: 'hint', style: { lineHeight: '1.7' } },
        '本小程序提供云海转盘抽签、单词机背词背课文、诗山寻踪等学习与实用工具。'),
    ]));
    return box;
  }

  const totals = p?.totals || { plays: 0, totalMs: 0, modRuns: 0 };
  const achCount = Object.keys(p?.achievements || {}).length;
  const achTotal = shownGames.reduce((s, g) => s + (g.achievements?.length || 0), 0);

  box.appendChild(
    h('div', { class: 'stat-grid' }, [
      h('div', { class: 'stat-box' }, [h('b', {}, String(totals.plays)), h('span', {}, '总场次')]),
      h('div', { class: 'stat-box' }, [h('b', {}, formatDuration(totals.totalMs)), h('span', {}, '总时长')]),
      // 工具版没有成就（诗山不设成就），显示 "0/0 成就" 只会让人困惑
      achTotal > 0
        ? h('div', { class: 'stat-box' }, [h('b', {}, `${achCount}/${achTotal}`), h('span', {}, '成就')])
        : null,
    ]),
  );

  // ---- 各游戏记录 ----
  box.appendChild(h('div', { class: 'section-title' }, '游玩记录'));
  let anyRecord = false;
  // 用 ALL_GAMES：流水入杯也会往 profile.games.liushui 里写记录
  for (const g of shownGames) {
    const rec = p?.games?.[g.id];
    if (!rec || !rec.plays) continue;
    anyRecord = true;
    const best = rec.best || {};
    const bestMode = Object.keys(best).sort((a, b) => best[b] - best[a])[0];
    const bestCfg = g.modes.find((m) => m.value === bestMode);
    box.appendChild(
      h('div', { class: 'record-row' }, [
        h('div', { class: 'rr-emoji' }, EMOJI[g.id] || '🎮'),
        h('div', { class: 'rr-main' }, [
          h('div', { class: 'rr-name' }, g.title),
          h('div', { class: 'rr-sub' },
            `${rec.plays} 局 · ${formatDuration(rec.totalMs)}${rec.lastPlayed ? ' · ' + formatDate(rec.lastPlayed) : ''}`),
        ]),
        h('div', { style: { textAlign: 'right' } }, [
          h('div', { class: 'rr-best' }, bestMode ? String(best[bestMode]) : '—'),
          h('div', { class: 'rr-sub' }, bestCfg ? bestCfg.label : ''),
        ]),
      ]),
    );
  }
  if (!anyRecord) {
    box.appendChild(h('div', { class: 'empty' }, '还没有游玩记录，去「游戏」页开一局吧'));
  }

  // ---- 成就 ----
  // 工具版唯一的内容是诗山寻踪，它没有成就系统，整段跳过
  if (achTotal > 0) {
  box.appendChild(h('div', { class: 'section-title' }, '成就'));
  const achGrid = h('div', { class: 'ach-grid' });
  for (const g of shownGames) {
    for (const a of g.achievements || []) {
      const got = !!p?.achievements?.[a.id];
      achGrid.appendChild(
        h('div', { class: `ach${got ? ' on' : ''}` }, [
          h('div', { class: 'a-ico' }, got ? '🏆' : '🔒'),
          h('div', { class: 'a-name' }, a.name),
          h('div', { class: 'a-desc' }, a.desc),
        ]),
      );
    }
  }
  box.appendChild(achGrid);
  }

  // ---- 综合总分榜 ----
  // 【工具版没有排行榜】榜上的分数全部来自游戏，工具版已移除游戏，
  //   保留一个空榜只会让人以为功能坏了。
  if (!FEATURES.leaderboard) return box;

  // 【为什么总分要在这里现算】总分是 33 个模式最高分的函数，
  //   任何一局游戏都可能改变它。缓存反而会显示过期的名次。
  const totalInfo = totalQuantized(getAllSync());
  totalInfo.played = totalInfo.parts.filter((x) => x.raw > 0).length;
  // 【为什么把它放在最前面】平台只给 1 个云端榜名额，全部给了综合总分。
  //   逐模式的 34 个入口点进去只能看到本机记录，先放总榜才能让人一眼看到
  //   "我到底排第几"这个真正有比较意义的信息。
  box.appendChild(h('div', { class: 'section-title' }, '综合总分榜'));
  const totalCard = h('div', { class: 'card total-card' }, [
    h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } }, [
      h('b', { style: { fontSize: '26px', letterSpacing: '-0.5px' } }, String(Math.round(totalInfo.total))),
      h('span', { class: 'hint', style: { margin: 0 } }, '分'),
    ]),
    h('div', { class: 'hint', style: { lineHeight: '1.65', marginTop: '6px' } },
      `已玩 ${totalInfo.played} / ${totalInfo.parts.length} 个模式。每个模式以基准分为 100 分，`
      + '超过基准每翻一倍加 10 分，没玩过的模式记 0 分。'),
    // 【为什么把基准分查询放在这里】它是"为什么我是这个分数"的解释页，
    //   紧挨着总分展示最自然：先看到总分，产生疑问，下一屏就能查到依据。
    //   放到设置里会藏得太深——玩家在意的正是这个数字怎么来的。
    h('div', { class: 'btn-row', style: { marginTop: '12px' } }, [
      h('button', {
        class: 'btn',
        style: { flex: '1 1 auto' },
        onclick: () => openLeaderboard({ meta: TOTAL_META, mode: 'all' }),
      }, '查看综合排行榜'),
      h('button', {
        class: 'btn',
        style: { flex: '1 1 auto' },
        onclick: () => openBaseInfo(),
      }, '基准分查询'),
    ]),
  ]);
  box.appendChild(totalCard);

  // 【为什么删掉了逐模式入口】平台只给 1 个云端榜名额，已经全部给了综合总分。
  //   逐模式的 34 个入口点进去只能看到"本机记录"，既没有比较意义，
  //   又让「我的」页塞满 34 个药丸、要滑三屏才到底。
  //   现在只保留综合总分榜，页面干净，也符合"删掉模式记录"的要求。

  // 【为什么要留白】排行榜是「我的」页最后一块内容，最后一个药丸会紧贴
  //   底部标签栏，视觉上像被截断。这里补一段留白，让最后一行完整可见。
  box.appendChild(h('div', { style: { height: '72px' } }));

  // ---- 页脚署名 ----
  // 【这里原本有一行站外域名，已按用户要求整行删除，不留一个字符】
  // 原因：《小程序工坊上架规则》四(二)2 严禁引导站外；即便做成不可点击的
  //   纯文本，审核仍可能判定为「引流暗示」。既然用户说删，就彻底删干净——
  //   包括 CSS 类、文档里的申报段落、以及版本说明里的域名披露。
  //   现在小程序内不存在任何外部域名，也就不需要任何域名披露。

  function openSettingsFromHere() {
    // 复用外壳的设置入口，避免两套设置页
    state.openSettings?.();
  }

  return box;
}
