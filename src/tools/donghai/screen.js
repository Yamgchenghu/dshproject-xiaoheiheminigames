/**
 * 东海龙珠的宿主页：把 2.5D 推币机挂进小程序的全屏层。
 *
 * 【为什么不直接用 iframe 加载原版 index.html】
 *   小程序外壳的 CSP 是 `default-src 'none'`，iframe 会被直接拦掉。
 *   所以只能把 DOM / CSS / JS 全部搬进来，由这一层负责挂载。
 *
 * 【为什么单独一个 screen 而不是塞进 game-screen】
 *   game-screen 是给 tick 驱动、有明确"一局"和"一个分数"的小游戏用的
 *   （结算走 recordRun / recordBest / submitScore）。
 *   推币机没有终点，结算是玩家自己按的，计分口径也完全不同
 *   （每币平均彩票，不是累加分）。硬塞进去两边都要加一堆 if。
 */
import { h } from '../../core/util.js';
import { openGlobalSettings } from '../../ui/global.js';
import { mount, unmount, doSettle, donghaiPause, donghaiResume, donghaiBack, resetRound, setSettleHandler, setCoinLimit, getCoinLimit, isLimitReached, state as gameState, restoreCoins } from './game.js';
import { loadDonghaiStats, recordDonghaiRun, todayAttemptsLeft, todayLimit, thisWeek, todayDaily, submitWeeklyBoard, fetchWeeklyBoard, saveRunState, loadRunState, clearRunState } from './stats.js';
import { DAILY_ATTEMPTS, CHALLENGE_LIMITS, BASE_TICKETS_PER_COIN, MIN_COINS_FOR_RANK } from './scoring.js';
import { recordBest } from '../../core/scores.js';
// 【为什么要单独 import BGM】推币机的音效走自己的 WebAudio（game.js 里的 Sound 类），
//   背景音乐走 <audio> 单例，两条链路互不干扰：
//   音效要低延迟、要随碰撞即时触发；音乐要循环、要能被设置页统一调音量。
// 【为什么只 import 这两个】切后台/回前台由 app.js 统一挂 onAppHideAudio /
//   onAppShowAudio 处理（全局只挂一次），推币机不用自己再管 resume。
import { playBgm, pauseBgm } from '../../core/audio.js';
import { submitTotalScore } from '../../sdk/leaderboard.js';
import { accountForBoard } from '../../sdk/account.js';
import './donghai.css';
// 【为什么要 import 而不是写 "./mascot.png"】模板是字符串，里面的相对路径
//   会相对"当前页面"解析，而页面在根目录、图片在子目录下，于是 404，
//   浏览器就把 <img> 的 alt 文字"看板娘"显示出来，看着像界面坏了。
//   用 ?url 让 Vite 算好路径：开发时 /src/...，打包后 ./assets/mascot-hash.png。
// 【为什么放 src 不放 public】public 下的文件是原样拷贝、不参与路径处理，
//   从 public 导入 ?url 会得到 /public/xxx.png 这种不存在的地址（已踩过）。
import mascotUrl from './mascot.png?url';

/** 游戏的 DOM 模板（原 index.html 的 body 部分） */
const TEMPLATE = "\n<canvas id=\"scene\"></canvas>\n\n<div id=\"hud\">\n  <header id=\"topbar\">\n    <div class=\"brand\">\n      <div class=\"seal\">龍</div>\n      <div class=\"brand-text\"><b>东海龙珠</b><small>DRAGON PEARL</small></div>\n    </div>\n    <div class=\"top-actions\">\n      <button id=\"btnSound\" class=\"icon-btn\" aria-label=\"声音\">♪</button>\n      <button id=\"btnHelp\" class=\"icon-btn\" aria-label=\"玩法\">?</button>\n    </div>\n  </header>\n\n  <div id=\"status\">\n    <div class=\"stat pearl-stat\">\n      <span class=\"stat-ico\">◉</span>\n      <div><small>已用币</small><b id=\"statCoins\">0</b></div>\n    </div>\n    <div class=\"stat ticket-stat\">\n      <span class=\"stat-ico\">▤</span>\n      <div><small>得票</small><b id=\"statTickets\">0</b></div>\n    </div>\n  </div>\n\n  <div id=\"colorRow\">\n    <div class=\"color-chip blue\"><i></i><span>蓝孔</span><b id=\"lvBlue\">0</b></div>\n    <div class=\"color-chip purple\"><i></i><span>紫孔</span><b id=\"lvPurple\">0</b></div>\n    <div class=\"color-chip yellow\"><i></i><span>黄孔</span><b id=\"lvYellow\">0</b></div>\n    <div id=\"tableCount\" class=\"table-chip\">盘面龙珠 <b>0</b></div>\n  </div>\n\n  <div id=\"floatLayer\"></div>\n\n  <div id=\"bottom\">\n    <div id=\"controls\">\n      <button id=\"exitBtn\" class=\"exit-btn\" aria-label=\"退出\">‹</button>\n      <div class=\"score-screen\">\n        <div><span>消耗币数</span><b id=\"screenCoins\">0</b></div>\n        <div><span>获得彩票</span><b id=\"screenTickets\">0</b></div>\n      </div>\n      <button id=\"fire\" class=\"fire-btn\">\n        <span class=\"fire-ring\"></span>\n        <span class=\"fire-label\">发 射</span>\n        <span class=\"fire-cost\">−1 币 · 1 珠</span>\n      </button>\n      <div class=\"mascot-slot\">\n        <div id=\"mascotBubble\" class=\"mascot-bubble\"></div>\n        <div id=\"mascotAvatar\" class=\"mascot-avatar\"><img src=\"__MASCOT__\" alt=\"看板娘\"></div>\n      </div>\n    </div>\n    <div id=\"utils\">\n      <button id=\"auto\" class=\"util-btn auto-btn\"><span class=\"auto-dot\"></span>自动连发 <b>关</b></button>\n      <!-- 结算：单机模式随时可点，按「每币平均彩票」算成绩 -->\n      <button id=\"settle\" class=\"util-btn settle-btn\">结算</button>\n      <button id=\"dhSet\" class=\"util-btn icon-util\" aria-label=\"设置\">⚙</button>\n    </div>\n  </div>\n</div>\n\n<div id=\"startScreen\">\n  <div class=\"start-bg\"></div>\n  <button id=\"startBack\" class=\"start-back\" aria-label=\"返回\">‹</button>\n  <div class=\"start-inner\">\n    <div class=\"start-emblem\">\n      <div class=\"ring r1\"></div><div class=\"ring r2\"></div>\n      <div class=\"orb\"><span>龍</span></div>\n    </div>\n    <p class=\"start-kicker\">東海龍宮 · 立體推幣</p>\n    <h1>东海龙珠</h1>\n    <p class=\"start-sub\">攒龙珠 · 等派对 · 冲最高倍率</p>\n    <div class=\"start-tips\">\n      <div><b>01</b><span>看准滑槽<br>定时发射</span></div>\n      <div><b>02</b><span>九孔落点<br>珍珠或龙珠</span></div>\n      <div><b>03</b><span>5 灯派对<br>滑槽锁定</span></div>\n    </div>\n    <div class=\"start-actions\"><button id=\"startBtn\" class=\"start-btn\">开始游戏</button><button id=\"joinWeekly\" class=\"join-btn\">参加周榜</button></div>\n    <p class=\"start-note\">1 币 1 珠 · 只计用币与得票 · 低内存</p>\n  </div>\n</div>\n\n<div id=\"helpModal\" class=\"modal hidden\">\n  <div class=\"modal-card\">\n    <button id=\"closeHelp\" class=\"modal-close\">×</button>\n    <h2>玩法说明</h2>\n    <div class=\"help-step\"><b>① 1 币 = 1 珠</b><p>每次发射自动投入 1 币并获得 1 颗珍珠。游戏只统计「已用币」和「得票」，不显示剩余珍珠或额外总分。按住发射可连续射击。</p></div>\n    <div class=\"help-step\"><b>② 滑槽与九孔</b><p>出口下方两条滑槽以定速在 −30° 到 +30° 间摆动，滑槽角度决定珍珠落点。下方九孔从左到右是：无、珍珠、彩票、珍珠、龙珠、珍珠、彩票、珍珠、无。珍珠 / 彩票孔会点亮对应灯，龙珠孔直接放一颗龙珠到推盘，无孔则落一颗珍珠到推盘。</p></div>\n    <div class=\"help-step\"><b>③ 派对时间</b><p>同一组 5 盏灯全亮，进入固定 10 秒派对。派对开始时右侧三颗派对灯全亮、普通奖励灯全部熄灭；两条滑槽锁定在正中 0°，盘面龙珠被向前推动。派对内每颗龙珠计分时按对应派对灯票数（50 / 100 / 80）出票。派对发射同样扣 1 币。</p></div>\n    <div class=\"help-step\"><b>④ 龙珠进转盘</b><p>推板把龙珠和珍珠推向台沿。龙珠掉落即进入右侧六孔转奖盘；蓝 / 黄 / 紫孔倍率各不相同：蓝最低、黄居中、紫最高。转盘顺时针转动，孔转到正上方时计分出票。右侧 3×7 奖励灯：第 1 行是派对奖励灯；第 2~7 行是平时奖励灯。平时每落一颗对应颜色龙珠，从 2~7 行最下方点亮一颗暗灯并按灯内数字出票；6 颗全亮后，再中该颜色会熄灭该颜色所有灯并从最下方重新开始。派对开始时三颗派对灯全亮、普通灯全部熄灭；派对内每次龙珠计分，按对应 50 / 100 / 80 出票。派对发射同样扣 1 币。</p></div>\n    <button id=\"helpOk\" class=\"modal-ok\">知道了</button>\n  </div>\n</div>\n\n<div id=\"resultBanner\" class=\"hidden\">\n  <span class=\"rb-kicker\">RESULT</span>\n  <strong id=\"rbTitle\">蓝龙</strong>\n  <p id=\"rbSub\">+30 彩票</p>\n</div>\n\n<!-- 结算弹窗：展示本局每币平均彩票与折算成绩 -->\n<div id=\"settleModal\" class=\"modal hidden\">\n  <div class=\"modal-card\">\n    <button id=\"closeSettle\" class=\"modal-close\">×</button>\n    <h2>本局结算</h2>\n    <div class=\"settle-rows\">\n      <div class=\"settle-row\"><span>已用币</span><b id=\"stCoins\">0</b></div>\n      <div class=\"settle-row\"><span>获得彩票</span><b id=\"stTickets\">0</b></div>\n      <div class=\"settle-row\"><span>每币平均</span><b id=\"stAvg\">0.000</b></div>\n      <div class=\"settle-row hl\"><span>本局成绩</span><b id=\"stScore\">0</b></div>\n      <div class=\"settle-row\"><span>量化分</span><b id=\"stQuant\">100</b></div>\n    </div>\n    <p id=\"stNote\" class=\"settle-note\"></p>\n    <button id=\"settleAgain\" class=\"modal-ok\">再来一局</button>\n  </div>\n</div>\n\n<div id=\"rotateHint\" class=\"hidden\">请保持竖屏游玩</div>\n\n\n";

export function openDonghaiScreen({ onExit, onSubmit } = {}) {
  // 【为什么要挡重复打开】入口在多个地方（工具页卡片、设置里的入口），
  //   快速连点或代码里误调两次会叠出两套机台：
  //   两套 raf 一起跑、两份 pointerdown 监听、存档互相覆盖。
  //   已经开着就复用，不新建。
  const existing = document.querySelector('.dh-root');
  if (existing) {
    existing.scrollIntoView?.();
    return { root: existing, reuse: true };
  }
  const root = h('div', { class: 'dh-root' });
  root.innerHTML = TEMPLATE.replace('__MASCOT__', mascotUrl);

  // 推币机 BGM：C 混合利底亚，84 BPM，3:03 循环。
  // 【为什么这里就要播】开始界面也是推币机的一部分，
  //   玩家点进来看机台的那几秒就该有音乐，等到点「开始游戏」才响会显得空。
  //   playBgm 内部会处理"还没有用户手势"的情况（排队等第一次点击）。
  playBgm('donghai');

  // HUD：返回 + 设置。推币机原版没有这两个键，是小程序外壳要求的
  // （用户明确要求设置键永远在右上角，返回必须是显式的「‹」）。
  // 【为什么退出键不再放右上角】宿主的胶囊（··· / ×）就贴在右上角，
  //   推币机自己的 ♪ ? 也在那一带，三层叠在一起必然重合。
  //   退出键挪到「消耗币数」左边 —— 那是机台操作区，宿主 UI 不占。
  //   设置键留在右上角（用户规则：设置永远在右上角），
  //   靠 --safe-top 把它推到状态栏下面，不压胶囊。
  /**
   * 本局是否已"参加周榜"。
   *
   * 【为什么要这个开关】用户规则：不点「参加周榜」直接玩，成绩不计入周榜。
   *   原实现是开局无条件 setCoinLimit(todayLimit())，结算时无条件记账，
   *   等于强制所有人参赛 —— 玩家想随便玩玩也不行。
   *
   * 【为什么声明必须在这个位置】它下面 startChallenge() 会赋值，
   *   startAutoSave() 会读。用 let 声明时存在暂时性死区（TDZ），
   *   如果声明在 startChallenge 之后，赋值会抛 ReferenceError，
   *   而回调里的异常不会冒到控制台 —— 表现就是"存档一直写不进去"。
   */
  let joined = false;
  /** 挑战局进度的自动保存定时器 */
  let saveTimer = 0;
  /**
   * 机台是否已经挂载。
   * 【为什么用布尔量而不是 mount() 的返回值】mount() 没有返回值
   *   （它在内部把 rafId / running 都设好了就结束）。
   *   之前写成 api = mount(root)，api 永远是 undefined，
   *   于是定时器每次都在 if (!api) return 处提前返回 —— 存档一直写不进去。
   */
  let mounted = false;

  /** 挑战局每 3 秒存一次进度 */
  function startAutoSave() {
    clearInterval(saveTimer);
    if (!joined) return;
    saveTimer = setInterval(() => {
      if (!mounted) return;
      saveRunState({
        joined: true,
        coinsSpent: gameState.coinsSpent,
        limit: todayLimit(),
        tickets: gameState.tickets,
      });
    }, 3000);
  }

  // 【为什么右上角一个键都不留】宿主 SDK 的 viewport.getWindowInfo 只给
  //   statusBarHeight，**不给胶囊的 left/top/width/height**，
  //   所以没法算出一块"确定不压胶囊"的区域。唯一稳妥的做法是右上角彻底留空。
  //   退出键和设置键都放到机台底部的操作区（那里宿主 UI 不占）。
  const hud = h('div', { class: 'dh-hud hidden' }, []);
  root.appendChild(hud);

  /**
   * 每日挑战面板：显示今日限额、剩余次数、本周榜。
   *
   * 【为什么单独做一个面板，而不是塞进游戏内的 HUD】
   *   游戏内 HUD 是原版作者设计的（已用币 / 得票 / 灯 / 派对），
   *   那些是"机台"的一部分，改动会破坏原版观感。
   *   每日挑战是小程序加的规则层，属于"外面的事"，
   *   放在返回键旁边、以悬浮按钮展开，两边互不干扰。
   */
  const panel = h('div', { class: 'dh-challenge hidden' });
  const panelBody = h('div', { class: 'dh-challenge-body' });
  panel.appendChild(panelBody);
  // 显式的关闭键：遮罩点击是隐式的，第一次用的人不一定知道。
  const panelClose = h('button', { class: 'dhc-close', 'aria-label': '关闭' }, '×');
  panelClose.addEventListener('click', () => {
    challengeOpen = false;
    panel.classList.add('hidden');
  });
  panel.appendChild(panelClose);
  // 【为什么点遮罩就关】面板是全屏弹层，没有任何关闭入口时玩家会被困住。
  //   点遮罩关闭是移动端弹层的通用约定，比额外加一个"×"更省空间。
  //   只关面板本身，点到面板内部不关（冒泡到 panel 才处理）。
  panel.addEventListener('click', (e) => {
    if (e.target === panel) {
      challengeOpen = false;
      panel.classList.add('hidden');
    }
  });
  const panelBtn = h('button', { class: 'dh-challenge-btn', title: '每日挑战' }, '🏆');
  panelBtn.onclick = () => toggleChallenge();
  root.appendChild(panelBtn);
  root.appendChild(panel);

  // 开始界面右侧的「参加周榜」：点开面板看今日限额、剩余次数和云端周榜。
  // 【为什么放在开始界面而不是游戏内】玩家进来第一件事就是想知道
  //   "今天还能玩几次、榜上什么水平"，让他先看再决定要不要开始。
  // 【为什么首页也要返回键】全屏后外壳的 HUD 被隐藏了，机台内的退出键
  //   又长在开始界面底下（开始界面 z-index 50 把它盖住），
  //   玩家在首页其实没有出口。这个键就是首页唯一的返回通道。
  const startBack = root.querySelector('#startBack');
  if (startBack) startBack.addEventListener('click', () => exit(true));

  const dhSet = root.querySelector('#dhSet');
  if (dhSet) dhSet.addEventListener('click', () => openGlobalSettings());

  const exitBtn = root.querySelector('#exitBtn');
  if (exitBtn) exitBtn.addEventListener('click', () => exit());

  const joinBtn = root.querySelector('#joinWeekly');
  // 【为什么直接开挑战，而不是只弹面板】用户说"点了参加周榜才计入排行"，
  //   那这个按钮就该是参赛入口。面板里的「参加今日挑战」是二次确认用的。
  if (joinBtn) joinBtn.addEventListener('click', () => { startChallenge(); });

  /**
   * 从「参加周榜」进入挑战局。
   *
   * 【为什么这里要单独一个入口】用户规则：只有参加周榜的这一局才计入排行。
   *   所以点「参加周榜」不能只是打开面板看数字，必须真的把这一局标记成参赛，
   *   并且从第一颗珠子就按今日限额扣币（否则玩家先投 200 币养盘面再参赛，
   *   成绩和认真玩的人不可比）。
   */
  function startChallenge() {
    if (todayAttemptsLeft() <= 0) {
      // 次数用完：不让他白玩一局然后结算被拒
      showToast('今日 ' + DAILY_ATTEMPTS + ' 次挑战机会已用完，明天再来。');
      return;
    }
    joined = true;
    setCoinLimit(todayLimit());
    // 【为什么这里要重启定时器】mount 时 joined 还是 false，startAutoSave 会直接返回。
    //   点「参加周榜」是在 mount 之后才把 joined 置 true 的，
    //   所以必须在这里补一次，否则整个挑战局的进度都不会存。
    startAutoSave();
    const startBtn = root.querySelector('#startBtn');
    if (startBtn) startBtn.click();

    // 【为什么恢复进度放在这里而不是 mount】mount 时 joined 还是 false，
    //   玩家可能只是打开机台看看、根本没打算参赛。真正的"这局算挑战局"
    //   是在点「参加周榜」这一刻确定的，进度也只能在这之后才有意义。
    //   恢复的是"这一局已经投掉多少额度"，盘面珠子不恢复（纯视觉，重落即可）。
    loadRunState().then((run) => {
      if (!alive || !run || !run.joined || !(run.coinsSpent > 0)) return;
      setCoinLimit(run.limit || todayLimit());
      restoreCoins(run.coinsSpent, run.tickets || 0);
      showToast('已接上本局进度：已投 ' + run.coinsSpent + ' 币');
    }).catch(() => {});
  }

  /** 轻提示：复用游戏内的气泡位，不额外造 UI */
  function showToast(text) {
    const bubble = root.querySelector('#mascotBubble');
    if (!bubble) return;
    bubble.textContent = text;
    bubble.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => bubble.classList.remove('show'), 2600);
  }

  let stats = null;
  let challengeOpen = false;

  async function toggleChallenge() {
    challengeOpen = !challengeOpen;
    panel.classList.toggle('hidden', !challengeOpen);
    if (challengeOpen) await renderChallenge();
  }

  /**
   * 强制打开挑战面板（开始界面的「参加周榜」用）。
   *
   * 【为什么不用 toggle】toggle 在面板已打开时会把它关掉。
   *   开始界面点「参加周榜」的语义是"我要看周榜"，不是"开关面板"，
   *   所以必须幂等地打开。
   */
  async function openChallenge() {
    if (challengeOpen) return;
    challengeOpen = true;
    panel.classList.remove('hidden');
    await renderChallenge();
  }

  async function renderChallenge() {
    stats = await loadDonghaiStats();
    const left = todayAttemptsLeft();
    const limit = todayLimit();
    const daily = todayDaily();
    const week = thisWeek();
    const days = ['一', '二', '三', '四', '五', '六', '日'];

    panelBody.innerHTML = '';
    panelBody.appendChild(h('div', { class: 'dhc-title' }, '每日推币挑战'));
    panelBody.appendChild(h('div', { class: 'dhc-row' }, [
      h('span', {}, '今日限额'),
      h('b', {}, limit + ' 币'),
    ]));
    panelBody.appendChild(h('div', { class: 'dhc-row' }, [
      h('span', {}, '剩余次数'),
      h('b', { class: left > 0 ? '' : 'dhc-dim' }, left + ' / ' + DAILY_ATTEMPTS),
    ]));
    panelBody.appendChild(h('div', { class: 'dhc-row' }, [
      h('span', {}, '今日最好'),
      h('b', {}, (daily.best || 0).toFixed(3)),
    ]));
    // ---- 本周我自己的记录（本机）----
    panelBody.appendChild(h('div', { class: 'dhc-sep' }));
    panelBody.appendChild(h('div', { class: 'dhc-title' }, '我的本周'));
    const wk = week.week;
    const monday = new Date(wk + 'T00:00:00');
    let anyDay = false;
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const v = week.days[k] || 0;
      if (v > 0) anyDay = true;
      panelBody.appendChild(h('div', { class: 'dhc-day' + (v > 0 ? ' has' : '') }, [
        h('span', {}, '周' + days[i] + ' ' + k.slice(5)),
        h('b', {}, v > 0 ? v.toFixed(3) : '—'),
      ]));
    }
    panelBody.appendChild(h('div', { class: 'dhc-row dhc-total' }, [
      h('span', {}, '本周累计'),
      h('b', {}, (week.total || 0).toFixed(3)),
    ]));
    if (!anyDay) {
      panelBody.appendChild(h('p', { class: 'dhc-note' }, '本周还没有成绩。点机台里的「结算」提交本局。'));
    }

    // ---- 云端周榜前 50 ----
    panelBody.appendChild(h('div', { class: 'dhc-sep' }));
    panelBody.appendChild(h('div', { class: 'dhc-title' }, '云端周榜 · 前 50'));
    const loadingEl = h('p', { class: 'dhc-note' }, '正在读取…');
    panelBody.appendChild(loadingEl);
    const boardBox = h('div', { class: 'dhc-board' });
    panelBody.appendChild(boardBox);

    fetchWeeklyBoard(50).then((board) => {
      loadingEl.remove();
      if (board.error) {
        boardBox.appendChild(h('p', { class: 'dhc-note' },
          board.error === 'not-logged-in' ? '登录后可查看云端周榜。' : '云端周榜读取失败。'));
        return;
      }
      // 【为什么要标来源】云榜失败会静默回落到本机榜，玩家看到的"第 1 名"
      //   其实只有自己。不标出来会以为是全服榜坏了。
      if (board.source !== 'cloud') {
        boardBox.appendChild(h('p', { class: 'dhc-note' },
          board.error === 'not-logged-in' ? '未登录，以下是本机记录。' : '云端不可用，以下是本机记录。'));
      }
      if (!board.entries.length) {
        boardBox.appendChild(h('p', { class: 'dhc-note' }, '本周还没有人上榜，你可以是第一个。'));
        return;
      }
      for (const e of board.entries) {
        boardBox.appendChild(h('div', { class: 'dhc-rank' + (e.self ? ' self' : '') }, [
          h('span', { class: 'dhc-rk' }, String(e.rank)),
          h('span', { class: 'dhc-nm' }, e.name || '玩家'),
          h('b', {}, e.total.toFixed(3)),
        ]));
      }
    }).catch(() => {
      loadingEl.textContent = '云端周榜读取失败。';
    });

    panelBody.appendChild(h('p', { class: 'dhc-note' },
      '每日 ' + DAILY_ATTEMPTS + ' 次机会，取最好一次计入周榜；每周一零点刷新。'));

    // 【为什么要这个按钮】用户规则是"不点参加周榜就不计榜"。
    //   面板只是"看"，这里才是真正"参赛"的动作，必须显式点一次。
    const canJoin = left > 0;
    const joinNow = h('button', { class: 'dhc-join' + (canJoin ? '' : ' dhc-dim') },
      canJoin ? ('参加今日挑战（' + limit + ' 币）') : '今日机会已用完');
    if (canJoin) {
      joinNow.addEventListener('click', () => {
        challengeOpen = false;
        panel.classList.add('hidden');
        startChallenge();
      });
    }
    panelBody.appendChild(joinNow);
  }

  // 【为什么要给 body 加标记】推币机是全屏浮层，外壳的 topbar / tabbar
  //   必须让位，否则两套 UI 叠在一起（玩家原话："乱七八糟，很多按钮点不了"）。
  //   用 body class 而不是 setImmersive()，因为那个函数没有暴露到外面。
  document.body.classList.add('is-immersive');
  document.body.appendChild(root);

  // 【为什么延一帧再 mount】root 刚插进 DOM，此时 getBoundingClientRect
  //   可能还是 0（样式没算完）。延一帧量到的才是真实尺寸。
  let alive = true;
  requestAnimationFrame(() => {
    if (!alive) return;
    // 每日挑战的币数上限：今天轮到哪一档就设多少。
    // 【为什么开局就设，而不是玩到一半才设】限额必须从第一颗珠子开始生效，
    //   否则玩家先投 200 币把盘面养起来、再"发现"限额 50，成绩就不可比了。
    // 【为什么这里不再无条件限额】普通游玩是原版的无上限街机，
    //   只有「参加周榜」的挑战局才受每日币数限制。
    setCoinLimit(joined ? todayLimit() : 0);
    mount(root);
    mounted = true;
    startAutoSave();
    // 把宿主的结算回调交给游戏：玩家点「结算」时先问次数够不够，
    // 够就记账，不够就拦下来。
    setSettleHandler(onSettle);
  });

  /**
   * 结算回调：校验每日次数 → 记账 → 返回是否放行。
   *
   * 【为什么要拦】用户规则是"每人每日限制 3 次，取最好 1 次录入排行榜"。
   *   如果次数用完还能结算，那"限制 3 次"就形同虚设。
   *   但【玩本身不限制】——原版是无限投币的街机，随时可以玩，
   *   只是第 4 次之后的成绩不进榜。所以这里是"拦记榜，不拦玩"。
   */
  async function onSettle(result) {
    if (!result) return { ok: false };
    // 【为什么总分要先记】综合总分榜和「周榜」是两回事：
    //   周榜是每日挑战赛，要参赛、要限额、每日 3 次；
    //   总分榜是这个游戏的最高纪录，只要打了一局就该更新。
    //   原来不参赛就直接 return，等于把非参赛局的成绩整个丢掉 ——
    //   而推币机本来就没接总分榜，两件事叠在一起，
    //   它的量化分从来没进过综合榜。
    //   这里先记最高分并提交总分，再走周榜那套参赛校验。
    await recordBest('donghai', 'classic', result.score);
    submitTotalScore({ extra: accountForBoard(), modded: false }).catch(() => {});

    // 没参赛：总分已记，但不进周榜、不占次数
    if (!joined) {
      return { ok: true, reason: '成绩已计入综合总分。参加周榜才会进排行榜。' };
    }
    // 【为什么先拦投币数】成绩是「票数 ÷ 币数」，分母小到 1、2 时
    //   比值衡量的是运气不是水平。实测刷分路径：反复重开堆满盘面，
    //   只投 1 币触发派对，1 币换两三百票，量化分顶到 150+。
    //   这类局允许玩、允许看成绩，但不进周榜、也不占当天次数。
    if (result.coins < MIN_COINS_FOR_RANK) {
      return {
        ok: false,
        reason: '本局只投了 ' + result.coins + ' 币，满 ' + MIN_COINS_FOR_RANK +
          ' 币才能计入周榜。成绩仅供参考，不占今日次数。',
      };
    }
    const left = todayAttemptsLeft();
    if (left <= 0) {
      return {
        ok: false,
        reason: '今日 ' + DAILY_ATTEMPTS + ' 次挑战机会已用完，成绩不计入周榜。明天再来。',
      };
    }
    await recordDonghaiRun(result.score);
    // 提交云端周榜：本地已经记好了，这里失败不影响本局成绩
    submitWeeklyBoard().catch(() => {});
    const after = todayAttemptsLeft();
    return {
      ok: true,
      reason: '已计入周榜 · 今日还剩 ' + after + ' 次机会',
    };
  }

  function exit(force) {
    if (!alive) return;
    // 【为什么首页返回键要 force】donghaiBack() 在"还在开始界面"时返回 true，
    //   意思是"这次返回别退出"——那是给机台内的退出键用的（让玩家先看帮助）。
    //   但首页那个 ‹ 是玩家唯一出口，被拦住就等于出不去。
    if (force) {
      alive = false;
      clearInterval(saveTimer);
      // 【为什么退出要 pauseBgm 而不是 stopBgm】pauseBgm 保留 current，
      //   下次进推币机时 playBgm('donghai') 会发现 current 已经是它，
      //   直接 resume 接着放，而不是从头开始——玩家来回进出不会每次都听开头。
      pauseBgm();
      unmount();
      root.remove();
      document.body.classList.remove('is-immersive');
      onExit && onExit();
      return;
    }
    // 原版有"帮助弹窗打开时先关弹窗"的逻辑，这里复用。
    // 【为什么条件是 donghaiBack() === true 才 return】donghaiBack 的语义是
    //   "这次返回被我消费掉了"（关掉帮助弹窗 / 停在开始界面时不动），
    //   返回 true 表示不要退出。原来写成 !donghaiBack()，
    //   在"还在开始界面"时 donghaiBack 返回 true → 条件为假 → 反而继续退出；
    //   在"已经开始游戏"时返回 false → 条件为真 → 退出被吞掉，
    //   unmount() 永远不执行，state.started 残留成 true，
    //   下次进来开始界面直接不出现。
    if (donghaiBack && donghaiBack()) return;
    alive = false;
    clearInterval(saveTimer);
    // 退出前存一次，避免最后 3 秒的进度丢掉
    if (joined && mounted) {
      saveRunState({ joined: true, coinsSpent: gameState.coinsSpent, limit: todayLimit(), tickets: gameState.tickets });
    }
    pauseBgm();
    unmount();
    root.remove();
    document.body.classList.remove('is-immersive');
    onExit && onExit();
  }

  return { exit };
}
