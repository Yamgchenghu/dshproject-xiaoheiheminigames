/**
 * 游戏运行页：画布 + HUD + 开始/暂停/结束覆盖层。
 *
 * 【为什么自己写 requestAnimationFrame 循环】setInterval 在后台标签页会被
 *   节流到 1s，而 rAF 在不可见时会暂停——这正是我们想要的行为（省电、不跳帧）。
 *   dt 做上限截断，避免切回来时一帧推进几秒钟直接撞死。
 *
 * 【指针为什么要分三种处理】四款 canvas 游戏的操作模型完全不同：
 *   扫雷 = 点按；2048/贪吃蛇 = 滑动（看"按下→抬起"的位移）；
 *   切水果 = 轨迹（要连续的线段）。硬塞成一种会有一半游戏手感崩掉。
 */
import { h, formatClock, buzz } from '../core/util.js';
import { create } from '../games/index.js';
import { submitScore, submitTotalScore } from '../sdk/leaderboard.js';
import { recordBest } from '../core/scores.js';
import { recordRun, mergeGameStats, loadProfile } from '../core/achievements.js';
import { toast } from './toast.js';
import { openLeaderboard } from './leaderboard.js';
import { openGlobalSettings } from './global.js';
import { getModSource } from '../mod/store.js';
import { accountForBoard } from '../sdk/account.js';
import { ModRuntime } from '../mod/runtime.js';
import { playBgm, pauseBgm, resumeBgm, stopBgm } from '../core/audio.js';
import { createSnakeBgm } from '../games/snake-bgm.js';

const MAX_DT = 1 / 20; // 单帧最多推进 50ms

/**
 * 电脑端操作提示。
 *
 * 【为什么按游戏分别写】同一个键在不同游戏里含义完全不同：
 *   WASD 在贪吃蛇里是转向，在扫雷里毫无意义。
 *   给扫雷写「WASD 移动」会让人以为能用方向键选格子——那是错的。
 */
function pcHintText(id) {
  // 右键 = 长按（见 pointerdown 的说明）。右键点已翻开的数字格
  // 现在是和弦展开，不再是标雷——提示要把这层说清楚，
  // 否则老玩家会以为右键只能插旗。
  if (id === 'minesweeper') return '左键开格 · 右键标雷 / 数字格和弦展开 · 空格暂停';
  if (id === 'g2048') return 'WASD / 方向键移动 · 空格暂停';
  if (id === 'snake') return 'WASD / 方向键转向 · 空格暂停';
  if (id === 'fruitninja') return '按住左键划过水果 · 空格暂停';
  return '';
}

export function openGameScreen({ meta, mode, appState, onExit, onProfileChange }) {
  const modeCfg = meta.modes.find((m) => m.value === mode) || meta.modes[0];
  let game = null;
  const modSource = getModSource(meta.id);
  const modded = !!modSource;
  let runtime = null;
  let raf = 0;
  let last = 0;
  let startedAt = 0;
  let submitted = false;
  let destroyed = false;

  game = create(meta.id, { mode, onEnd: (r) => onGameEnd(r) });

  // 【纯观战标记】贪吃蛇的 watch 模式整局没有玩家，HUD 不该显示分数，
  //   结算也不该走存档/排行。这里统一取一次，后面多处要用。
  const isSpectateMode = Boolean(game.isSpectateMode);
  // 只有贪吃蛇有多条蛇"存活"的概念，HUD 才能显示 N/M
  const hasAlive = typeof game.mods?.alive === 'number' && typeof game.mods?.players === 'number';

  /** 观战局批量加 NPC；地图会按峰值人数放大 */
  function addNpcs() {
    const n = game.addNpcs?.(5);
    if (!n) { toast('地图已经满了，加不进去', 2000); return; }
    buzz(10);
    toast('加入 ' + n + ' 条 NPC', 1500);
  }

  // ---------- DOM ----------
  const scoreEl = h('div', { class: 'v' }, '0');
  const timeEl = h('div', { class: 'v' }, '00:00');
  // 【为什么生命和倒计时共用一个槽】切水果的限时模式里生命是 999
  //   （见 fruitninja.js 的 MODES），显示出来是一串没意义的数字；
  //   而玩家真正需要盯的是还剩几秒。两种模式互斥，所以共用一个位置，
  //   由 syncHud 决定显示哪一种，不额外占 HUD 宽度。
  const livesKeyEl = h('div', { class: 'k' }, '生命');
  const livesEl = h('div', { class: 'hud-stat', style: { display: 'none' } }, [
    livesKeyEl,
    h('div', { class: 'v' }, ''),
  ]);

  const canvas = h('canvas');
  const overlayHost = h('div', { class: 'overlay-host' });
  const wrap = h('div', { class: 'canvas-wrap' }, [canvas, overlayHost]);

  const hud = h('div', { class: 'game-hud' }, [
    h('button', { class: 'hud-back', onclick: () => exit() }, '‹'),
    h('div', { class: 'hud-stat' }, [h('div', { class: 'k' }, isSpectateMode ? (hasAlive ? '存活' : '模式') : '分数'), scoreEl]),
    h('div', { class: 'hud-stat' }, [h('div', { class: 'k' }, meta.id === 'minesweeper' ? '剩余' : '用时'), timeEl]),
    livesEl,
    h('div', { class: 'hud-spacer' }),
    modded ? h('span', { class: 'badge warn' }, '模组') : null,
    // 【为什么这里没有「自动标雷 / 自动翻开」了】用户要求把这两个功能
    //   集成进长按，不再占 HUD 位置。现在长按已翻开的数字格 = 和弦展开，
    //   长按未翻开的格 = 插旗（见 minesweeper.js 的 pointer）。
    //   HUD 位置留给每局都要用的「排行 / 暂停 / 设置」，不再被两个
    //   只有扫雷用得到的按钮占掉。
    // 纯观战局：给一个加 NPC 的入口。用户要求「允许批量增加 npc」，
    //   一次加 5 条，地图会按峰值人数自动放大。
    //   观战局不上榜，所以「排行」按钮没有意义，用加人按钮占它的位置。
    // 观战局不上榜，所以「排行」按钮没有意义。
    //   贪吃蛇观战支持加 NPC，其他游戏的观战只是看 AI 自己玩，
    //   给个「重开」让画面能换一局。
    isSpectateMode
      ? (typeof game.addNpcs === 'function'
        ? h('button', { class: 'hud-btn', onclick: () => addNpcs() }, '+5 NPC')
        : h('button', { class: 'hud-btn', onclick: () => restart() }, '重开'))
      : h('button', { class: 'hud-btn', onclick: () => openLeaderboard({ meta, mode }) }, '排行'),
    h('button', { class: 'hud-btn', onclick: () => togglePause() }, '暂停'),
    // 游戏页是全屏层，外壳顶栏被盖住了；设置按钮必须在这里补一个，
    // 否则玩到一半想改设置就得先退出游戏
    h('button', { class: 'icon-btn', title: '设置', onclick: () => openGlobalSettings() }, '⚙'),
  ]);

  // 【为什么进来先清场】全屏游戏层是直接 appendChild 到 body 的，
  //   不挂在任何会 rerender 的容器里。如果玩家退出时走了别的路径
  //   （比如返回键、或者点了别的入口），旧层不会被移除，
  //   新层盖在它上面——结果是页面上同时存在好几个 canvas，
  //   点击落在最上层那个，但它是隐藏的旧实例，看起来就是「点了没反应」。
  //   实测最多堆到 5 层。这里在创建新层之前先把旧的清干净。
  for (const old of document.querySelectorAll('.game-screen')) old.remove();

  const screen = h('div', { class: 'game-screen' }, [hud, wrap]);
  document.body.appendChild(screen);

  // 【为什么只给电脑端显示】手机上这些提示全是噪音：
  //   滑动、长按本来就是触屏的常识动作，不需要教。
  //   而鼠标用户不知道「右键 = 长按」「WASD = 滑动」，
  //   不提示就等于这两个功能不存在。
  const pcHint = matchMedia('(hover: hover) and (pointer: fine)').matches
    ? pcHintText(meta.id)
    : '';
  if (pcHint) {
    screen.appendChild(h('div', {
      style: {
        position: 'absolute', left: '0', right: '0', bottom: '6px',
        textAlign: 'center', fontSize: '11px', opacity: '0.55',
        pointerEvents: 'none', zIndex: '5',
      },
    }, pcHint));
  }

  if (meta.id === 'fruitninja') livesEl.style.display = 'flex';

  // ---------- 画布 ----------
  const ctx = canvas.getContext('2d');
  let cssW = 0;
  let cssH = 0;

  function resize() {
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cssW = rect.width;
    cssH = rect.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOnce();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  function drawOnce() {
    if (!cssW || !cssH) return;
    ctx.clearRect(0, 0, cssW, cssH);
    game.draw(ctx, cssW, cssH);
  }

  // ---------- 主循环 ----------
  function loop(ts) {
    if (destroyed) return;
    raf = requestAnimationFrame(loop);
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt > MAX_DT) dt = MAX_DT;
    if (dt < 0) dt = 0;

    game.tick(dt);
    drawOnce();
    syncHud();
    syncSnakeBgm();
    pushModState();
  }

  /**
   * 贪吃蛇：把「吃了多少」喂给合成器，让曲子越吃越快。
   * 【为什么放在 HUD 同步里】这里每帧都会跑一次，天然跟得上游戏状态，
   *   不需要在引擎里加回调。
   */
  function syncSnakeBgm() {
    if (!synthBgm || !synthOn) return;
    synthBgm.setIntensity(game.mods?.eaten || 0);
  }

  function syncHud() {
    // 观战局没有玩家分数。贪吃蛇能显示"存活几条"，
    //   其他游戏（2048/切水果/合成大西瓜）没有这个概念，
    //   显示 0/0 反而像坏了——它们统一显示「观战」。
    if (isSpectateMode) {
      scoreEl.textContent = hasAlive ? (game.mods?.alive ?? 0) + '/' + (game.mods?.players ?? 0) : '观战';
      timeEl.textContent = formatClock(game.elapsedMs);
      return;
    }
    scoreEl.textContent = String(Math.round(game.score));
    if (meta.id === 'minesweeper') {
      const left = Math.max(0, (game.mods.timer.duration || 0) - (game.mods.timer.elapsed || 0));
      timeEl.textContent = formatClock(left * 1000);
    } else {
      timeEl.textContent = formatClock(game.elapsedMs);
    }
    if (meta.id === 'fruitninja') {
      const timed = (game.mods.timer && game.mods.timer.duration > 0);
      if (timed) {
        // 限时模式：显示剩余秒数，最后 10 秒变红提醒
        const left = Math.max(0, game.mods.timer.duration - game.mods.timer.elapsed);
        livesKeyEl.textContent = '剩余';
        livesEl.lastChild.textContent = Math.ceil(left) + 's';
        livesEl.lastChild.style.color = left <= 10 ? 'var(--danger, #ff6b6b)' : '';
      } else {
        // 经典模式：显示生命
        livesKeyEl.textContent = '生命';
        livesEl.lastChild.textContent = '♥'.repeat(Math.max(0, game.mods.lives || 0)) || '—';
        livesEl.lastChild.style.color = '';
      }
    }
  }

  /** 把实时状态推给模组进程：Python 里读到的永远是当前值 */
  let frameCount = 0;
  function pushModState() {
    if (!runtime) return;
    frameCount++;
    if (frameCount % 4) return;
    runtime.pushState(game.mods);
  }

  // ---------- 覆盖层 ----------
  /**
   * 贪吃蛇用实时合成的曲子，其余游戏仍然放 mp3。
   *
   * 【为什么贪吃蛇要单独一套】它的节奏需要跟着「吃了多少」变快，
   *   mp3 是定长音频做不到这一点。合成器还能省掉 1.9MB 包体。
   * 【为什么这里不直接调 playBgm】两条链路的状态要各自管：
   *   合成器有自己的 start/stop，mp3 有单例 <audio>。
   *   用一个 bgmOn 标记当前走哪条，暂停/恢复/退出时分别处理。
   */
  const synthBgm = meta.id === 'snake' ? createSnakeBgm() : null;
  let synthOn = false;
  // 合成器也要吃设置页的音量，否则玩家调了滑杆这边不跟着变
  if (synthBgm) {
    synthBgm.setVolume(appState.profile?.settings?.bgmVolume ?? 0.5);
  }

  function bgmStart() {
    if (synthBgm) {
      synthBgm.start();
      synthOn = true;
    } else if (meta.bgm) {
      playBgm(meta.bgm);
    }
  }
  function bgmPause() {
    if (synthBgm) {
      // 合成器没有"暂停"，停掉即可；恢复时重新 start 会从头排程，
      // 对循环小曲来说听感上没有差别
      synthBgm.stop();
      synthOn = false;
    } else {
      pauseBgm();
    }
  }
  function bgmResume() {
    if (synthBgm) {
      if (!synthOn) {
        synthBgm.start();
        synthOn = true;
      }
    } else {
      resumeBgm();
    }
  }
  function bgmStop() {
    if (synthBgm) {
      synthBgm.stop();
      synthOn = false;
    } else {
      stopBgm();
    }
  }

  // 一进游戏页就开始放这首曲子的 BGM：用户在"开始/暂停"之间反复时
  // 音乐不该跟着断，只有离开这个页面才停。
  bgmStart();

  function showStart() {
    overlayHost.innerHTML = '';
    overlayHost.appendChild(
      h('div', { class: 'overlay' }, [
        h('h2', {}, meta.title),
        h('p', {}, modeCfg.sub || ''),
        h('button', {
          class: 'big-play',
          style: { maxWidth: '260px' },
          onclick: () => startGame(),
        }, '▶ 开始'),
        modded ? h('p', { style: { color: 'var(--warn)' } }, '本局载入模组，成绩不计入排行榜') : null,
      ]),
    );
  }

  function showOver(result) {
    overlayHost.innerHTML = '';
    // 【为什么要把本局分数算进来】结算现在先弹、存档后跑，
    //   profile 还没刷新，直接读会显示上一局的旧最佳，
    //   玩家破了纪录却看到「历史最佳」还是旧数字——比不显示还糟。
    const prevBest = (appState.profile?.games?.[meta.id]?.best || {})[mode] || 0;
    const best = Math.max(prevBest, Math.round(result.score));
    // 【多人局为什么多一个继续观战】用户要求：自己死了立刻结算并暂停，
    //   按钮是「再来一局 / 继续观战 / 退出」。
    //   之前的实现是死后自动接管一条 AI，玩家不知道自己在观战，
    //   只看到操作没反应，以为卡死了。现在把观战变成一个明确的选项。
    const battleMode = /^b[2-8]$/.test(mode);
    const canSpectate = battleMode && !result.won;
    // 纯观战局：没有玩家分数，也没有最佳成绩可言
    const isWatch = result.ranked === false;

    overlayHost.appendChild(
      h('div', { class: 'overlay' }, [
        h('h2', {}, result.won ? '通关！' : isWatch ? '观战结束' : '结束'),
        isWatch ? null : h('div', { class: 'big-score' }, String(Math.round(result.score))),
        h('p', {}, result.detail || ''),
        isWatch ? null : h('p', { style: { color: 'var(--text-3)' } },
          modded ? '模组对局 · 不计入排行榜'
            : best > 0 ? '历史最佳 ' + best
            : '首次挑战'),
        // 【为什么结算页不再放"看排行"】用户要求取消这个按钮。
        //   结算时玩家只想快点再来一局或退出，多一个按钮反而增加决策负担；
        //   排行榜在游戏内的 HUD 有「排行」入口、"我的"页也有总榜，
        //   从这里拿掉不会让功能消失，只是把"看榜"挪到更合适的位置。
        h('div', { class: 'btn-row', style: { justifyContent: 'center', marginTop: '6px' } }, [
          h('button', { class: 'btn primary', onclick: () => restart() }, '再来一局'),
          canSpectate
            ? h('button', { class: 'btn', onclick: () => continueSpectate() }, '继续观战')
            : null,
          h('button', { class: 'btn', onclick: () => exit() }, isWatch ? '退出' : '返回'),
        ]),
      ]),
    );
  }

  /**
   * 继续观战：玩家已死，让剩下的 AI 把这一局打完。
   *
   * 【为什么不是 resume】游戏已经 status=over，resume() 只处理 paused。
   *   这里要把 over 清掉、接管一条还活着的蛇，并让外壳停止计分——
   *   否则观战过程中分数还在涨，观战结束又会弹一次结算。
   */
  function continueSpectate() {
    const ok = game.startSpectate?.();
    if (!ok) {
      toast('已经没有可观战的对象了', 2000);
      return;
    }
    overlayHost.innerHTML = '';
    submitted = true; // 观战不再结算，避免二次弹窗
    bgmResume();
  }

  function togglePause() {
    if (game.status === 'playing') {
      game.pause();
      bgmPause();
      // 模组进程同步冻结：否则 Python 会在暂停期间继续改游戏状态
      runtime?.pause();
      overlayHost.innerHTML = '';
      overlayHost.appendChild(
        h('div', { class: 'overlay' }, [
          h('h2', {}, '已暂停'),
          h('button', { class: 'big-play', style: { maxWidth: '220px' }, onclick: () => togglePause() }, '继续'),
          h('button', { class: 'btn', onclick: () => exit() }, '退出本局'),
        ]),
      );
    } else if (game.status === 'paused') {
      game.resume();
      bgmResume();
      runtime?.resume();
      overlayHost.innerHTML = '';
    }
  }

  async function startGame() {
    overlayHost.innerHTML = '';
    startedAt = Date.now();
    submitted = false;
    game.start();

    if (modded && !runtime) {
      runtime = new ModRuntime({
        gameId: meta.id,
        code: modSource,
        target: game.mods,
        onSet: (path, value) => writeMod(path, value),
        onCall: (path, method, args) => callMod(path, method, args),
        onLog: (msg) => console.log('[mod]', msg),
        onError: (e) => toast('模组错误：' + e, 3200),
      });
      runtime.start();
    } else if (runtime) {
      runtime.resume();
    }
  }

  /** Python 写属性 → 落到游戏内实时参数对象（游戏每帧读它，所以立刻生效） */
  function writeMod(path, value) {
    const parts = String(path).split('.');
    let cur = game.mods;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    game.applyMod?.(path, value);
  }

  /** timer 之类的方法调用 */
  function callMod(path, method, args) {
    if (path !== 'timer') return null;
    if (method === 'add') {
      game.extendTime?.(Number(args[0]) || 0);
      return null;
    }
    if (method === 'pause') {
      game.mods.timer.paused = true;
      return null;
    }
    if (method === 'resume') {
      game.mods.timer.paused = false;
      return null;
    }
    if (method === 'reset') {
      game.resetTimer?.();
      return null;
    }
    return null;
  }

  function restart() {
    overlayHost.innerHTML = '';
    submitted = false;
    startedAt = Date.now();
    game.restart();
    game.start();
    bgmResume();
    runtime?.restart?.();
  }

  async function onGameEnd(result) {
    if (submitted) return;
    submitted = true;
    buzz(20);
    // 结算后压低音量：让玩家看清成绩，也给"再来一局"留出静默
    bgmPause();
    runtime?.pause();

    const timeMs = result.timeMs || Date.now() - startedAt;

    // 【观战局不存档、不上榜】观战没有玩家成绩，result.ranked 为 false。
    //   照常走 recordBest / submitScore 会把 0 分写进最好成绩，
    //   还会污染排行榜。这里直接弹结算就返回。
    if (result.ranked === false) {
      showOver(result);
      return;
    }

    // 【为什么先弹结算再存档】原来这里是「写记录 → 合并统计 → 提交排行 →
    //   重载档案 → 弹窗」，四五个 await 串起来。每一步都是网络或存储 IO，
    //   手机上一次就要几百毫秒，加起来就是用户看到的「结束五秒才弹窗」。
    //   结算弹窗只依赖本局结果（分数、用时），这些数据早就在 result 里，
    //   根本不需要等云端。所以先弹，存档在后台跑。
    //   流水入杯之所以没这个问题，是因为它自己管结算，不走这条路径。
    showOver(result);

    // 后台存档：失败不能影响已经显示的成绩
    (async () => {
      try {
        const { unlocked } = await recordRun({
          gameId: meta.id,
          mode,
          score: result.score,
          timeMs,
          modded,
        });
        // 【为什么必须单独写一次 recordBest】recordRun 把最高分存进
        //   profile.games[].best，那是成就系统用的；而量化总分读的是
        //   scores.js 的 save_18。两套存储互不相通——不写这一句，
        //   扫雷/切水果/2048/贪吃蛇的成绩永远进不了量化，所有模式
        //   都被当成"没玩过"记 0，总分就只剩流水入杯一家的分。
        //   这就是"游戏没算基准分"的真正原因。
        if (!modded) await recordBest(meta.id, mode, result.score);
        await mergeGameStats(meta.id, {
          won: result.won,
          maxTile: result.extra?.maxTile,
          maxLen: result.extra?.length,
          totalFood: result.extra?.eaten,
          bestSlice: result.extra?.bestSlice,
          bestTime: result.won ? { mode, ms: timeMs } : null,
        });

        // 模组局直接跳过排行榜：模组可以任意改分，允许上榜等于榜单作废
        if (!modded) {
          const res = await submitScore({
            gameId: meta.id,
            mode,
            score: result.score,
            // 昵称头像从账号层取：没登录时留空，榜单显示「玩家」而不是假昵称
            extra: accountForBoard(),
            modded,
          });
          // 【为什么要提示】以前提交失败是静默的，用户以为上榜了，其实一条都没传上去。
          //   只有真正没成功时才说一句，成功时保持安静，不打扰结算界面。
          if (res && !res.ok && res.reason === 'not-logged-in') {
            toast('未登录，成绩仅保存在本机', 2400);
          }

          // 【为什么每局都要重算总分】综合总分榜用的是"全部模式的最高分累加"，
          //   这一局可能刷新了某个模式的个人纪录，总分就变了。
          //   不重算的话，玩家破了纪录却发现榜上分数没动。
          const tot = await submitTotalScore({ extra: accountForBoard(), modded });
          if (tot && tot.ok && tot.rank) {
            // 只有进了榜单展示范围才提示名次，避免每次都弹
            toast(`综合榜第 ${tot.rank} 名 · 总分 ${Math.round(tot.total)}`, 2600);
          }
        }

        for (const a of unlocked) toast(`🏆 解锁成就：${a.name}`, 2200);

        appState.profile = await loadProfile();
        onProfileChange?.();
      } catch { /* 后台存档失败不影响本局成绩展示 */ }
    })();
  }

  function exit() {
    if (!submitted && startedAt && Date.now() - startedAt > 3000) {
      // 中途退出：只记时长，不记成绩（没有结束判定就没有可比的分）
      recordRun({
        gameId: meta.id,
        mode,
        score: 0,
        timeMs: Date.now() - startedAt,
        modded: true,
      }).catch(() => {});
    }
    destroy();
    onExit?.();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
    // 游戏停止 → 模组进程强制终止
    runtime?.stop();
    // 离开游戏页才停音乐（重开一局不该重新起头）
    bgmStop();
    screen.remove();
  }

  // ---------- 输入 ----------
  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  };

  function onKey(e) {
    // 【为什么必须排除输入框】游戏页里有设置弹层，里面是 Key、音色这类输入框。
    //   用户在输入框里打「w」是想打字，结果蛇往上一拐；
    //   按空格想加个空格，游戏直接暂停。这类串扰很难被当成 bug 报出来，
    //   用户只会觉得「打字的时候游戏乱动」。
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    if (e.key === ' ' || e.key === 'Escape') {
      e.preventDefault();
      togglePause();
      return;
    }
    const k = KEYMAP[e.key];
    if (!k) return;
    e.preventDefault();
    if (game.status === 'ready') startGame();
    game.key?.(k);
  }
  window.addEventListener('keydown', onKey);

  function toLogical(ev) {
    const rect = canvas.getBoundingClientRect();
    const t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
    return {
      x: (t.clientX - rect.left) / rect.width,
      y: (t.clientY - rect.top) / rect.height,
    };
  }

  let downPt = null;
  let lastPt = null;
  let dragging = false;
  // 扫雷长按标雷：计时器在 pointerdown 起，pointerup 判断是否已触发
  let longPressTimer = 0;
  let longPressed = false;
  // 这次按下用的是不是右键。
  // 【为什么不用 ev.button 判断】pointerup 上的 button 在不同浏览器里
  //   含义不一致：Chrome 在右键抬起时给 2，但有些环境给 0（因为「释放的是
  //   主按钮」）。只看 ev.button 会在某些机器上漏判，旗子插上又被翻开。
  //   按下时记下来最可靠。
  let downButton = 0;

  function onDown(ev) {
    if (game.status === 'over') return;

    // 【右键 = 长按】电脑上根本没有「长按」这个动作：
    //   鼠标按住不动会被当成拖拽起点，松开又变成普通点击，
    //   而且按住久了浏览器可能弹右键菜单。所以给鼠标用户一条等价路径——
    //   右键单击直接等价于「长按标雷」。
    //   必须在这里就 return，不能落到下面：否则 dragging 被置 true，
    //   pointerup 里会再执行一次 openCell，旗子刚插上就被翻开。
    if (ev.button === 2) {
      ev.preventDefault();
      // 右键一律不进入 dragging 状态，同时把 downButton 标成 2，
      // 万一之后收到 pointerup 也能据此跳过判定
      downButton = 2;
      dragging = false;
      downPt = null;
      lastPt = null;
      if (game.status === 'ready') startGame();
      if (meta.id === 'minesweeper') {
        const p2 = toLogical(ev);
        game.pointer?.(p2.x, p2.y, true);
        buzz(14);
      }
      return;
    }

    if (game.status === 'ready') startGame();
    downButton = ev.button || 0;
    dragging = true;
    downPt = toLogical(ev);
    lastPt = downPt;
    if (meta.id === 'fruitninja') game.stroke?.(downPt.x, downPt.y, downPt.x, downPt.y);
    // 合成大西瓜：按下立刻瞄准（准星跟手），落果留给抬起
    // 【合成大西瓜要的是画布 CSS 像素，不是 0..1】
    //   watermelon.pointer 内部用 ((nx - viewOx) / viewK) 反算逻辑坐标，
    //   viewOx/viewK 是 draw 时按画布像素算出来的。
    //   传 0..1 进去会被减成一个大负数，clamp 之后永远落在最左边——
    //   这就是用户报的「手机点不动」。
    if (meta.id === 'watermelon') game.pointer?.(downPt.x * cssW, downPt.y * cssH, true);
    // 合成器需要用户手势才能启动 AudioContext（浏览器自动播放策略），
    // 第一次按下时补一次 unlock；已经启动过则是空操作
    if (synthBgm) {
      synthBgm.unlock();
      if (!synthOn) {
        synthBgm.start();
        synthOn = true;
      }
    }
    // 扫雷按下时先记下位置并起长按计时器，到点就标雷
    if (meta.id === 'minesweeper') {
      longPressed = false;
      clearTimeout(longPressTimer);
      const p = downPt;
      longPressTimer = window.setTimeout(() => {
        longPressed = true;
        // 长按 = 标雷
        game.pointer?.(p.x, p.y, true);
        buzz(14);
      }, 380);
    }
  }

  function onMove(ev) {
    // 右键拖动不参与任何游戏操作：扫雷里右键是标雷，
    // 按住划过去不该连续标一片；切水果里也不该切出刀光。
    if (!dragging || downButton === 2) return;
    const p = toLogical(ev);
    if (meta.id === 'fruitninja' && lastPt) game.stroke?.(lastPt.x, lastPt.y, p.x, p.y);
    // 合成大西瓜：拖动时准星跟着手指走，松手才落果
    if (meta.id === 'watermelon') game.pointer?.(p.x * cssW, p.y * cssH, true);
    lastPt = p;
  }

  function onUp(ev) {
    // 【右键抬起绝不能判定】右键已经在 pointerdown 里完成了标雷，
    //   抬起时再做任何事都是重复：轻则把刚插的旗子翻开，
    //   重则触发和弦展开炸一片。
    //   这里同时看两个信号——按下时记的 downButton，和抬起事件自己的 button，
    //   任一为 2 都直接返回。只靠其中一个在个别浏览器上会漏。
    if (downButton === 2 || ev.button === 2) {
      downButton = 0;
      dragging = false;
      clearTimeout(longPressTimer);
      downPt = null;
      lastPt = null;
      return;
    }
    if (!dragging) return;
    dragging = false;
    clearTimeout(longPressTimer);
    const p = toLogical(ev);
    if (meta.id === 'minesweeper') {
      // 【长按过就不能再开格】长按已经在 pointerdown 的计时器里标了雷，
      //   如果这里还执行 openCell，等于标完立刻把同一格翻开——
      //   旗子瞬间消失、格子被打开，玩家看到的就是「标雷没生效」。
      //   这正是「扫雷不能标雷」的直接原因。
      if (!longPressed) {
        // 已翻开的数字格点一下 = 和弦展开（见 minesweeper.chord）
        game.chord?.(downPt.x, downPt.y);
        // chord 没有可展开的对象时再当普通点击处理，
        // openCell 内部会自己判断该格是否已开、是否合法
        game.pointer?.(downPt.x, downPt.y, false);
      }
    } else if (meta.id === 'watermelon') {
      // 【合成大西瓜：抬起才落果】按下只瞄准、抬起才落下，
      //   这样玩家按住时可以左右拖动调整落点，松手才确认。
      //   按下即落会让手指还没对准就掉下去，手感很糟。
      //   注意这里传的是画布 CSS 像素（乘过 cssW/cssH），不是 0..1：
      //   watermelon.pointer 会自己用 viewK/viewOx 反算逻辑坐标，
      //   而那两个值是按像素算的。见上面 onDown 的说明。
      game.pointer?.(p.x * cssW, p.y * cssH, false);
    } else if (meta.id === 'g2048' || meta.id === 'snake') {
      const dx = (p.x - downPt.x) * cssW;
      const dy = (p.y - downPt.y) * cssH;
      // 【观战优先于滑动】多人局玩家死后，画面里已经没有自己的蛇了，
      //   这时候滑动没有任何意义。轻点（位移很小）就是「换一个观战对象」，
      //   大位移仍按滑动处理，避免死后误触把视角切走。
      const isTap = Math.abs(dx) < 12 && Math.abs(dy) < 12;
      if (isTap && game.spectating && game.nextSpectate) {
        game.nextSpectate();
      } else {
        game.swipe?.(dx, dy);
      }
    }
    downPt = null;
    lastPt = null;
  }

  // 右键在扫雷里是「标雷」，不能让系统菜单盖住棋盘
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => {
    clearTimeout(longPressTimer);
    dragging = false;
    downPt = null;
    lastPt = null;
  });
  resize();
  raf = requestAnimationFrame(loop);
  showStart();

  return { destroy, screen };
}
