/**
 * 排行榜弹层。
 *
 * 【为什么要显示"我的排名"】只看前 20 名，排不上榜的用户完全不知道自己什么水平。
 *   平台对超出展示范围的成绩返回 ranked:false / rank:0，这时不能显示"第 0 名"，
 *   要说"成绩已保存，未进入前 N"。
 *
 * 【为什么要把错误分开提示】以前所有云端失败都显示同一句话，
 *   "榜单没创建""没登录""网络断了"在界面上长得一样，用户不知道该怎么办。
 */
import { h, formatDate } from '../core/util.js';
import { fetchBoard, fetchMyEntry, boardKey, hasCloudBoard } from '../sdk/leaderboard.js';
import { getMode } from '../sdk/hb.js';
import { getAccount, requestProfileAuth, refreshAccount } from '../sdk/account.js';

/** 榜单展示条数 */
const TOP_N = 50;

export function openLeaderboard({ meta, mode }) {
  // 【为什么要兜底】综合总分榜传的是 { id:'total', title:'综合总分榜' }，
  //   没有 modes 字段。直接 meta.modes.find 会抛 TypeError 白屏。
  //   总榜只有一个"模式"，标题也不该再拼一次后缀。
  const isTotal = meta.id === 'total';
  const modeCfg = isTotal
    ? { value: 'all', label: '' }
    : (meta.modes.find((m) => m.value === mode) || meta.modes[0]);
  const listHost = h('div', { class: 'lb-list' }, [h('div', { class: 'empty' }, '加载中…')]);
  const myHost = h('div', { class: 'lb-me' });

  const mask = h('div', { class: 'modal-mask', onclick: (e) => {
    if (e.target === mask) close();
  } }, [
    h('div', { class: 'modal' }, [
      h('div', { class: 'modal-grip' }),
      h('h2', {}, isTotal ? meta.title : `${meta.title} · ${modeCfg.label}`),
      hasCloudBoard(meta.id, mode)
        ? null
        : h('div', { class: 'lb-note' }, '该模式只记录本机成绩'),
      isTotal
        ? h('div', { class: 'lb-note' }, '总分 = 各模式最高分按基准折算后累加，没玩过的模式记 0 分')
        : null,
      myHost,
      listHost,
      h('div', { class: 'btn-row', style: { marginTop: '14px' } }, [
        h('button', { class: 'btn block', onclick: () => load(true) }, '刷新'),
      ]),
    ]),
  ]);

  document.body.appendChild(mask);

  function close() {
    mask.remove();
  }

  /** 头像：没有就画一个占位圆，避免 img 破图 */
  function avatarNode(url, name) {
    if (url) {
      return h('img', { class: 'lb-avatar', src: url, alt: '', loading: 'lazy' });
    }
    const ch = (name || '玩').slice(0, 1);
    return h('div', { class: 'lb-avatar lb-avatar-ph' }, ch);
  }

  async function load() {
    listHost.innerHTML = '';
    listHost.appendChild(h('div', { class: 'empty' }, '加载中…'));
    myHost.innerHTML = '';

    // 榜上显示前 50 名（getList 单次上限 100，50 足够且不必翻页）
    const board = await fetchBoard({ gameId: meta.id, mode, limit: TOP_N });
    const mine = await fetchMyEntry({ gameId: meta.id, mode });

    listHost.innerHTML = '';

    // ---- 空态：按原因给不同的可操作提示 ----
    if (!board.entries.length) {
      let msg = '还没有人上榜，来当第一个吧';
      let action = null;
      if (board.error === 'not-logged-in') {
        msg = '登录小黑盒账号后才能上榜';
        const acc = getAccount();
        if (acc.state === 'ok' || getMode() === 'host') {
          action = h('button', {
            class: 'btn',
            style: { marginTop: '10px' },
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              btn.textContent = '登录中…';
              const r = await requestProfileAuth();
              if (r.ok) {
                await refreshAccount({ useCache: false });
                load();
              } else {
                // 失败必须恢复按钮，否则用户被困在"登录中…"里
                btn.disabled = false;
                btn.textContent = '重试登录';
                if (r.reason !== 'cancelled') {
                  listHost.appendChild(h('div', { class: 'empty' }, '登录失败：' + (r.reason || '未知原因')));
                }
              }
            },
          }, '登录并重试');
        }
      } else if (board.error === 'LEADERBOARD_DEFAULT_NOT_FOUND') {
        msg = '该模式榜单尚未创建';
      } else if (board.error) {
        msg = '榜单读取失败，请稍后重试';
      }
      listHost.appendChild(h('div', { class: 'empty' }, [h('div', {}, msg), action].filter(Boolean)));
    } else {
      for (const e of board.entries) {
        const isMe = !!(mine && e.score === mine.score && board.source === 'local');
        listHost.appendChild(
          h('div', { class: `lb-item${isMe || e.self ? ' me' : ''}` }, [
            h('div', { class: `lb-rank${e.rank <= 3 ? ' top' : ''}` }, String(e.rank)),
            avatarNode(e.avatar, e.name),
            h('div', { class: 'lb-name' }, e.name || '玩家'),
            h('div', { class: 'lb-score' }, String(e.score)),
          ]),
        );
      }
      if (board.hasMore) {
        listHost.appendChild(h('div', { class: 'empty' }, `仅显示前 ${TOP_N} 名`));
      }
    }

    // ---- 我的成绩 ----
    const srcText = board.source === 'cloud' ? '云端榜单' : '仅本机记录';
    if (mine) {
      const rankText = mine.rank > 0 ? `第 ${mine.rank} 名` : '未进入展示范围';
      myHost.appendChild(
        h('div', { class: 'lb-me-box' }, [
          h('span', { class: 'lb-me-label' }, '我的最好成绩'),
          h('b', { class: 'lb-me-score' }, String(mine.score)),
          h('span', { class: 'lb-me-rank' }, board.source === 'cloud' ? rankText : srcText),
        ]),
      );
    } else {
      // 【这里原本少了一层空格】两个 span 紧挨着渲染，读起来是「还没有成绩云端榜单」，
      //   必须在中间补一个可换行的分隔，否则文案黏成一串。
      myHost.appendChild(
        h('div', { class: 'lb-me-box' }, [
          h('span', { class: 'lb-me-label' }, '还没有成绩'),
          h('span', { class: 'lb-me-rank' }, srcText),
        ]),
      );
    }
  }

  load();
}
