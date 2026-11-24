/**
 * 流水入杯 —— 画布界面。
 *
 * 【这个工具和别的工具不一样在哪】转盘是"点一下出结果"，
 *   这个是**实时物理**：240Hz 定步长、每帧要推进十几次积分。
 *   所以这里所有设计都围绕一件事：别让渲染拖累物理。
 *     - 物理跑固定步长，渲染按 rAF；两者解耦，掉帧不会让水变快变慢；
 *     - 画布 DPR 上限 2.5，再高只会让填充率爆掉而看不出差别；
 *     - 世界坐标 0.6×1.0 直接映射到画布，不做中间变换层。
 *
 * 【为什么画线要单独一个状态】原版是"先画线、再开水"。
 *   如果边画边放水，玩家根本没时间思考，关卡设计（哪些位置能挡住水）
 *   也就失去意义了。所以 ready 状态下物理完全冻结。
 */
import { h } from '../../core/util.js';
import { openGlobalSettings } from '../../ui/global.js';
import { LEVELS, LEVEL_COUNT, levelAt } from './levels.js';
import {
  GameWorld, WORLD_W, WORLD_H, TOTAL_DROPS, TARGET_DROPS, CUP_FULL_DROPS,
  TAG, CIRCLE, MAX_LINES, LINE_MAX_LEN,
} from './engine.js';
import { toast } from '../../ui/toast.js';
import { submitScore, submitTotalScore } from '../../sdk/leaderboard.js';
import { accountForBoard } from '../../sdk/account.js';
import { recordBest, getBestSync } from '../../core/scores.js';
import { liushuiRawScore } from '../../core/quantize.js';
import { CANVAS_FONT_BODY } from '../../core/fonts.js';
import { recordRun } from '../../core/achievements.js';

const LINE_MAX_POINTS = 40;

/**
 * 画布文字用的字体族。
 *
 * 【为什么改成从 core/fonts.js 取】这里原本写死 TWKai（楷体），理由是
 *   「界面正文用楷体」。但 MD3 改版后 --font-body 已经换成无衬线字体栈，
 *   这段注释和代码都过期了——画布还在用楷体，界面是无衬线，
 *   两者放在同一屏上明显不是一套字。现在统一走共享常量。
 */
const CANVAS_FONT = CANVAS_FONT_BODY;

/**
 * 打开流水入杯。
 *
 * 【startLevel】游戏页把它当作"模式"传进来（第 N 关），
 *   工具页不传，从第一关开始。两条入口共用一个实现，
 *   免得以后改一处忘一处。
 */
export function openLiushuiScreen({ onExit, startLevel } = {}) {
  // 【入口参数也要限】startLevel 来自游戏页的「模式」列表，
  //   如果不拦，玩家可以从那里直接点进最后一关，绕过通关解锁。
  //   这里先夹到 0..N-1，后面 gotoLevel 里还会再查一次解锁状态。
  const firstLevel = Math.max(0, Math.min(LEVEL_COUNT - 1, Number(startLevel) || 0));
  let levelIndex = firstLevel;
  let world = new GameWorld(levelAt(levelIndex), Date.now() & 0xffff);

  const root = h('div', { class: 'game-screen liushui-screen' });

  /* ---------------- 顶栏 ---------------- */
  const titleEl = h('div', { class: 'ls-level' }, '');
  const statEl = h('div', { class: 'ls-stat' }, '');
  const backBtn = h('button', {
    class: 'icon-btn',
    onclick: () => {
      running = false;
      root.remove();
      onExit && onExit();
    },
  }, '‹');

  const header = h('div', { class: 'tool-header ls-header' }, [
    backBtn,
    h('div', { class: 'ls-head-main' }, [titleEl, statEl]),
    h('button', { class: 'ls-help', onclick: () => showHelp() }, '?'),
    // 全屏页盖住了外壳顶栏，设置入口必须在这里补
    h('button', { class: 'icon-btn', title: '设置', onclick: () => openGlobalSettings() }, '⚙'),
  ]);

  /* ---------------- 画布 ---------------- */
  const canvas = h('canvas', { class: 'ls-canvas' });
  const ctx = canvas.getContext('2d');
  const wrap = h('div', { class: 'ls-stage' }, [canvas]);

  /* ---------------- 底部操作 ---------------- */
  const startBtn = h('button', { class: 'ls-btn primary', onclick: () => onStart() }, '开水');
  const clearBtn = h('button', { class: 'ls-btn', onclick: () => onClear() }, '清线');
  const resetBtn = h('button', { class: 'ls-btn', onclick: () => onReset() }, '重来');
  const prevBtn = h('button', { class: 'ls-btn', onclick: () => gotoLevel(levelIndex - 1) }, '‹ 上一关');
  const nextBtn = h('button', { class: 'ls-btn', onclick: () => gotoLevel(levelIndex + 1) }, '下一关 ›');

  const controls = h('div', { class: 'ls-controls' }, [
    h('div', { class: 'ls-row' }, [prevBtn, resetBtn, clearBtn, startBtn, nextBtn]),
  ]);

  /* ---------------- 结算浮层 ---------------- */
  const overlay = h('div', { class: 'ls-overlay hidden' });

  root.appendChild(header);
  root.appendChild(wrap);
  root.appendChild(controls);
  root.appendChild(overlay);
  // 全屏层直接挂 body，退出路径一旦漏掉就会和新的层叠在一起，
  // 点击落到旧层上表现为「没反应」。进门前先清场。
  for (const old of document.querySelectorAll('.game-screen')) old.remove();
  document.body.appendChild(root);

  /* ================= 状态 ================= */
  let running = true;
  let drawing = false;
  let drawX = [];
  let drawY = [];
  let lastFrame = 0;
  let dpr = 1;
  // 【为什么 scale 要提到外面】绘制时算字号需要「世界单位 → 像素」的换算，
  //   而这个 scale 原本只是 resize() 的局部变量，绘制函数里根本取不到，
  //   直接用会 ReferenceError，整个 draw 中断，画面直接空白。
  let scale = 1;

  /* ================= 尺寸 ================= */
  function resize() {
    const box = wrap.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // 世界是 0.6 : 1.0 的竖条，画布按这个比例留白居中
    scale = Math.min(box.width / WORLD_W, box.height / WORLD_H);
    const cw = WORLD_W * scale;
    const ch = WORLD_H * scale;
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  }

  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();

  /* ================= 关卡解锁 ================= */

  /** 本次会话里已确认通关的关卡下标（不依赖异步存档） */
  const sessionCleared = new Set();

  /**
   * 第 N 关是否已通关。
   * 【为什么用最高分判断】流水入杯是关卡制，每关的成绩按 ls.lvN
   *   存进最高分表（见 core/scores.js）。某一关有成绩，就说明打过；
   *   这里再结合「是否达标」——只有接够 TARGET_DROPS 才算过，
   *   所以直接用最高分 >= TARGET_DROPS 作为解锁依据，
   *   不需要再单独存一份「已通关关卡」的进度，省一个存档位。
   */
  function isLevelCleared(index) {
    // 【为什么要加 sessionCleared】getBestSync 读的是异步写入后的缓存，
    //   刚通关那一瞬间缓存还没更新，点「下一关」会被判定成未解锁。
    //   sessionCleared 记的是「本次会话里确实通关过的关卡」，
    //   结算当刻就写进去，不等云端。两个来源取并集，
    //   既保证本次通关立刻能进下一关，也保证历史进度不丢。
    return sessionCleared.has(index)
      || getBestSync('liushui', 'lv' + (index + 1)) >= TARGET_DROPS;
  }

  /**
   * 当前能玩到第几关（索引，从 0 开始）。
   *
   * 【语义必须说清楚，这里踩过坑】返回值是「最远可进入的关卡下标」，
   *   不是「已通关的关数」。
   *   原来写的是 `Math.min(i, LEVEL_COUNT-1)`，其中 i 是「已通关的连续前缀长度」。
   *   第 1 关（索引 0）通关后 i=1，函数返回 1，含义是「可以玩到索引 1（第 2 关）」，
   *   这本身没错。但调用处写的是 `levelIndex + 1 <= unlocked`：
   *   站在第 1 关（levelIndex=0）时变成 1 <= 1 → 成立；
   *   可站在第 1 关刚通关的瞬间，玩家要的是「下一关」，判断用的是当前关的索引，
   *   实际算的是 0+1=1 <= 1 成立——看起来没问题，
   *   真正出错的是还没通关时的边界：i=0 时返回 0，
   *   此时「下一关」被锁死，而通关后 i 变成 1，
   *   但 syncChrome 里判断的是 levelIndex+1 <= unlocked，
   *   站在索引 0 得到 1<=1 通过，站在索引 1 得到 2<=1 失败——
   *   也就是第 2 关通关后反而进不了第 3 关，和玩家反馈的
   *   「第一关点下一关还是第一关，后面的关卡正常」对不上。
   *
   *   为了彻底消除这种「一半对一半错」的边界，这里统一成：
   *   返回「最远可进入的索引」= 已通关前缀长度（至少为 0），
   *   并额外提供 canEnter(i) 供调用方判断，避免各处自己算。
   */
  function maxUnlocked() {
    let i = 0;
    while (i < LEVEL_COUNT && isLevelCleared(i)) i++;
    // i 就是「第一个还没通关的关卡下标」，也就是最远可进入的那一关。
    // 全部通关时 i === LEVEL_COUNT，需要夹到最后一关。
    return Math.min(i, LEVEL_COUNT - 1);
  }

  /** 第 i 关是否允许进入（统一入口，避免各处重复推导边界） */
  function canEnter(i) {
    if (i < 0 || i >= LEVEL_COUNT) return false;
    // 已通关的关卡当然能重进；第一个未通关的关卡也允许挑战
    return i <= maxUnlocked();
  }

  /* ================= 关卡切换 ================= */

  /**
   * 跳到第 i 关。
   * 【为什么要拦未解锁的关卡】用户要求「必须通过上一关才能玩下一关」。
   *   原来「下一关」按钮可以直接跳到任意关，等于关卡设计形同虚设。
   *   这里统一在入口处拦：任何路径（按钮、startLevel 参数）都要过这道检查，
   *   避免只堵住按钮、却被 URL 参数绕过。
   */
  function gotoLevel(i) {
    const next = Math.max(0, Math.min(LEVEL_COUNT - 1, i));
    if (!canEnter(next)) {
      // maxUnlocked() 是「最远可进入的索引」，所以要提示的是它 +1 那一关
      toast(`先通过第 ${maxUnlocked() + 1} 关`);
      return;
    }
    if (next === levelIndex && world.state === 'ready') return;
    levelIndex = next;
    world = new GameWorld(levelAt(levelIndex), (Date.now() + levelIndex * 7919) & 0xffff);
    drawX = [];
    drawY = [];
    overlay.classList.add('hidden');
    syncChrome();
  }

  function onReset() {
    world = new GameWorld(levelAt(levelIndex), Date.now() & 0xffff);
    drawX = [];
    drawY = [];
    overlay.classList.add('hidden');
    syncChrome();
  }

  /**
   * 清线。
   * 【为什么不再限制在 ready 阶段】原来运行中这个按钮是禁用的，
   *   水一开始流，玩家发现线画歪了只能整关重来。
   *   现在任何阶段都能清：已经接住的水珠照常计入，
   *   线一撤，压在上面的水自然往下漏，符合直觉。
   */
  function onClear() {
    if (world.state === 'won' || world.state === 'lost') return;
    world.clearLines();
    drawX = [];
    drawY = [];
    if (world.state === 'running') syncChrome();
  }

  function onStart() {
    if (world.state === 'ready') {
      world.startWater();
      syncChrome();
    } else if (world.state === 'running') {
      world.requestManualEnd();
    }
  }

  function syncChrome() {
    const L = world.level;
    titleEl.textContent = L.name || `第 ${levelIndex + 1} 关`;
    const st = world.state;
    if (st === 'ready') {
      statEl.textContent = `画线接水 · 最多 ${MAX_LINES} 根 / 每根 ${(LINE_MAX_LEN * 100).toFixed(0)}cm`;
      startBtn.textContent = '开水';
      startBtn.disabled = false;
      clearBtn.disabled = false;
    } else if (st === 'running') {
      const pct = world.percent.toFixed(0);
      // 【为什么要把 endingStatus 显示出来】引擎里手动结束是一个 5 秒倒计时
      //   （manualEndTimer，见 engine.js），但界面原来只显示接水量，
      //   玩家点完「提前结算」后画面毫无变化，会以为按钮没生效。
      //   endingStatus() 会把倒计时、杯子出界、95% 完成这些状态都吐出来，
      //   这里优先显示它。
      const status = world.endingStatus ? world.endingStatus() : '';
      statEl.textContent = status
        ? `${status} · 已接 ${world.dropsInCup}/${TARGET_DROPS}`
        : `接住 ${world.dropsInCup}/${TARGET_DROPS} 滴 · ${pct}%`;
      startBtn.textContent = world.manualEndRequested ? '结算中…' : '提前结算';
      // 倒计时期间再点没有意义，禁掉避免重复触发
      startBtn.disabled = !!world.manualEndRequested;
      // 运行中也可以清线（见 onClear 的说明）
      clearBtn.disabled = false;
    } else {
      statEl.textContent = `${st === 'won' ? '通关' : '失败'} · 接住 ${world.dropsInCup} 滴`;
      startBtn.textContent = '再来一次';
      startBtn.disabled = false;
      clearBtn.disabled = true;
    }
    prevBtn.disabled = levelIndex <= 0;
    // 【下一关按钮按解锁状态禁用】只是灰掉还不够直观，
    //   顺便把按钮文字改成「未解锁」，玩家一眼知道是卡在关卡上，
    //   而不是以为按钮坏了。
    // 用 canEnter 统一判断，别再自己算 levelIndex+1 <= unlocked ——
    // 那样写在第 1 关通关前后会得到相反的结果，就是「点下一关没反应」的根源
    const canNext = levelIndex < LEVEL_COUNT - 1 && canEnter(levelIndex + 1);
    nextBtn.disabled = !canNext;
    nextBtn.textContent = levelIndex >= LEVEL_COUNT - 1
      ? '已是最后一关'
      : (canNext ? '下一关 ›' : '下一关 🔒');
  }

  /* ================= 指针交互 ================= */
  function toWorld(ev) {
    const r = canvas.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width;
    const py = (ev.clientY - r.top) / r.height;
    return [px * WORLD_W, py * WORLD_H];
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (world.state !== 'ready') return;
    if (world.lines.length >= MAX_LINES) {
      toast('最多 3 根线，先点「清线」');
      return;
    }
    drawing = true;
    drawX = [];
    drawY = [];
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = toWorld(e);
    drawX.push(x);
    drawY.push(y);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const [x, y] = toWorld(e);
    const lx = drawX[drawX.length - 1];
    const ly = drawY[drawY.length - 1];
    // 抽稀：点太密对物理没好处，还会拖慢求解器
    if (Math.hypot(x - lx, y - ly) < 0.004) return;
    if (drawX.length >= LINE_MAX_POINTS) return;
    drawX.push(x);
    drawY.push(y);
  });

  const endDraw = () => {
    if (!drawing) return;
    drawing = false;
    if (drawX.length >= 2) {
      world.addLinePath(drawX, drawY, drawX.length);
    }
    drawX = [];
    drawY = [];
  };
  canvas.addEventListener('pointerup', endDraw);
  canvas.addEventListener('pointercancel', endDraw);

  /* ================= 帮助 ================= */
  function showHelp() {
    toast('画线挡水，把水引进杯子。水珠会冲垮线，线也会被火焰烧断。', 3200);
  }

  /* ================= 结算 ================= */
  /**
   * 把这一关的成绩记下来。
   *
   * 【为什么用"接住滴数"当分数】流水入杯没有传统意义的得分，
   *   接住多少滴就是这一关的全部成果，也是唯一能和别人比的量。
   *   通关时它一定 >= TARGET_DROPS，没通关时它反映离目标还差多少，
   *   两种情况下都有意义。
   *
   * 【为什么 mode 用 lvN】排行榜 key 是 hb_liushui_lvN，
   *   14 个关卡各一个榜，和"不混榜"的要求一致。
   */
  function recordResult() {
    const mode = 'lv' + (levelIndex + 1);
    const drops = world.dropsInCup;
    // 【必须先记 sessionCleared 再 return】下面 drops <= 0 会提前返回，
    //   但通关判定与分数无关——只要达标就该解锁下一关。
    if (world.state === 'won' && drops >= TARGET_DROPS) {
      sessionCleared.add(levelIndex);
    }
    if (drops <= 0) return;
    // 无论有没有接住水，这一局都算"玩过"：总场次、总时长要如实累计
    recordRun({
      gameId: 'liushui',
      mode,
      score: drops,
      timeMs: Math.round(world.runTime * 1000),
      won: world.state === 'won',
    }).catch(() => {});
    // 【为什么要在 recordBest 之后再刷一次按钮】解锁状态是从最高分推出来的，
    //   刚通关那一局的成绩要等这次写入完成才会反映到 getBestSync 里。
    //   写完再 syncChrome，「下一关」按钮才会立刻从 🔒 变成可用。
    recordBest('liushui', mode, drops)
      .then(() => syncChrome())
      .catch(() => {});
    submitScore({
      gameId: 'liushui',
      mode,
      score: drops,
      // 【为什么这里也要带昵称】流水入杯之前提交时没带 extra.nick，
      //   导致它的 14 个榜单里所有人一律显示「玩家」，和别的游戏不一致。
      extra: { level: levelIndex + 1, won: world.state === 'won', ...accountForBoard() },
    }).catch(() => {});

    // 【为什么这里要单独写一次量化分】流水入杯的存档值必须是"滴数"——
    //   isLevelCleared() 用 getBestSync(...) >= TARGET_DROPS(190) 判断解锁，
    //   如果直接把"滴数−190"存进去，通关后反而是 0 或负数，关卡永远解不开。
    //   所以滴数照旧存（供解锁），量化分另外记一份供总榜累加。
    const pts = liushuiRawScore(drops);
    recordBest('liushui_q', mode, pts).catch(() => {});
    submitTotalScore({ extra: accountForBoard(), modded: false }).catch(() => {});
  }

  function settle() {
    const won = world.state === 'won';
    const pct = world.percent.toFixed(0);
    // recordResult 里会把通关的关卡写进 sessionCleared，
    // 所以后面判断「下一关」能不能点的时候已经是新状态了
    recordResult();
    syncChrome();
    overlay.innerHTML = '';
    const best = getBestSync('liushui', 'lv' + (levelIndex + 1));
    const hasNext = levelIndex + 1 < LEVEL_COUNT;
    // 【为什么结算浮层里也要判解锁】原来这里的「下一关」按钮无条件可点，
    //   点了以后 gotoLevel 发现没解锁就弹个 toast 退回来，
    //   玩家看到的是「按钮能点但没反应」。现在直接按解锁状态决定：
    //   通关了就能进，没通关就灰掉并说明原因。
    // 同样走 canEnter：通关当刻 sessionCleared 已经写好，
    //   这里直接判断「下一关能不能进」，而不是判断「本关通没通」。
    //   两者在最后一关时含义不同，用 canEnter 更准确。
    const nextUnlocked = !hasNext || canEnter(levelIndex + 1);
    overlay.appendChild(h('div', { class: 'ls-result' }, [
      h('div', { class: 'ls-result-title' }, won ? '通关' : '没接满'),
      h('div', { class: 'ls-result-score num' }, `${world.dropsInCup}`),
      h('div', { class: 'ls-result-sub' }, `/${TARGET_DROPS} 滴 · 完成度 ${pct}%`),
      h('div', { class: 'ls-result-why' }, world.failReason || (won ? '水已经稳稳落进杯子。' : '水没有接够。')),
      h('div', { class: 'ls-result-sub' }, best > 0 ? `本关最佳 ${best} 滴` : '本关首次挑战'),
      h('div', { class: 'ls-result-actions' }, [
        h('button', {
          class: 'ls-btn primary',
          onclick: () => {
            overlay.classList.add('hidden');
            onReset();
          },
        }, '再来一次'),
        h('button', {
          class: 'ls-btn' + (nextUnlocked && hasNext ? ' primary' : ''),
          disabled: !nextUnlocked || !hasNext,
          onclick: () => {
            overlay.classList.add('hidden');
            gotoLevel(levelIndex + 1);
          },
        }, !hasNext ? '已是最后一关' : (nextUnlocked ? '下一关 ›' : '下一关 🔒')),
      ]),
    ]));
    overlay.classList.remove('hidden');
  }

  /* ================= 渲染 ================= */
  const COLORS = {
    water: '#4ad9d9',
    waterDeep: '#2b9fd4',
    poison: '#a86bff',
    fire: '#ff7a45',
    fireHot: '#ffd166',
    support: '#7b8794',
    wall: '#5a6673',
    mud: '#8b6b4a',
    cup: '#cfd8e3',
    line: '#ffe08a',
    ground: '#2a3340',
    ball: '#94a3b8',
  };

  function drawBar(b, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(width, 0.002);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < b.pointCount; i++) {
      const x = b.px(i);
      const y = b.py(i);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function draw() {
    const w = WORLD_W;
    const hh = WORLD_H;
    ctx.clearRect(0, 0, w, hh);

    // 背景
    const g = ctx.createLinearGradient(0, 0, 0, hh);
    g.addColorStop(0, '#12171f');
    g.addColorStop(1, '#0b0e13');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hh);

    // 静态机关
    for (const b of world.physics.bars) {
      if (b.tag === TAG.GROUND) {
        drawBar(b, COLORS.ground, 0.012);
      } else if (b.tag === TAG.SUPPORT) {
        drawBar(b, COLORS.support, 0.009);
      } else if (b.tag === TAG.WALL) {
        drawBar(b, COLORS.wall, 0.008);
      } else if (b.tag === TAG.FIRE_LINE) {
        drawBar(b, COLORS.fire, 0.010);
      } else if (b.tag === TAG.MUD) {
        drawBar(b, COLORS.mud, 0.010);
      } else if (b.tag === TAG.LINE) {
        drawBar(b, COLORS.line, 0.006);
      }
    }

    // 杯子：U 形，用四条边画
    // 【为什么水必须画在杯子自己的坐标系里】杯子是动态刚体，会翻、会平移。
    //   之前按关卡里的 cupLeft / cupRimY 画水，那是**关卡初始坐标**，
    //   杯子一旦倾倒（第一关 1 秒内就翻成 -90°），水就留在半空中，
    //   看起来就是「水不在杯子里」。原版 PlayView.drawCup 是先
    //   translate 到杯子质心、rotate 到杯子角度，再按局部坐标画水，
    //   这里照抄同一个变换顺序。
    if (world.cupBody) {
      const c = world.cupBody;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);

      // 杯壁（局部坐标，和原版 drawPath(localX, localY) 一致）
      ctx.strokeStyle = COLORS.cup;
      ctx.lineWidth = 0.0075;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < c.pointCount; i++) {
        if (i === 0) ctx.moveTo(c.localX[i], c.localY[i]);
        else ctx.lineTo(c.localX[i], c.localY[i]);
      }
      ctx.stroke();

      // 杯里的水：局部坐标 + 按水量抬升水面
      const lvl = Math.min(1, world.dropsInCup / CUP_FULL_DROPS);
      if (lvl > 0.001) {
        const il = world.cupLocalInnerLeft;
        const ir = world.cupLocalInnerRight;
        const it = world.cupLocalTop;
        const ib = world.cupLocalBottom;
        const surf = ib - lvl * (ib - it);
        ctx.beginPath();
        ctx.moveTo(il, surf);
        ctx.lineTo(ir, surf);
        ctx.lineTo(ir, ib);
        ctx.lineTo(il, ib);
        ctx.closePath();
        ctx.fillStyle = 'rgba(74,217,217,0.45)';
        ctx.fill();
        // 水面亮线，让水位看得清
        ctx.beginPath();
        ctx.moveTo(il, surf);
        ctx.lineTo(ir, surf);
        ctx.strokeStyle = 'rgba(156,238,255,0.85)';
        ctx.lineWidth = 0.0035;
        ctx.stroke();
      }
      ctx.restore();
    }

    // 水龙头
    ctx.fillStyle = '#3a4453';
    ctx.fillRect(world.level.faucetX - 0.012, 0.14, 0.024, 0.03);
    ctx.fillStyle = '#6b7a8d';
    ctx.fillRect(world.level.faucetX - 0.004, 0.165, 0.008, 0.014);

    // 水珠
    for (const d of world.physics.drops) {
      if (d.removed) continue;
      ctx.fillStyle = d.poison ? COLORS.poison : COLORS.water;
      ctx.globalAlpha = d.ghost ? 0.35 : 1;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 火焰机关
    // 【为什么火球和火环要分开画】原来两者都走「描边空心圆」，
    //   火球看起来就是一个细环，和关卡说明里的「火球」完全对不上，
    //   玩家也分不清哪个是会掉下来的球、哪个是固定的环。
    //   现在火球画成实心带光晕的球，火环保持空心描边。
    for (const b of world.physics.bars) {
      if (b.tag === TAG.FIRE_BALL) {
        const r = b.radius || 0.02;
        // 外圈光晕：由内到外渐隐，让火球在深色背景上「发光」
        const glow = ctx.createRadialGradient(b.x, b.y, r * 0.2, b.x, b.y, r * 2.6);
        glow.addColorStop(0, 'rgba(255,180,80,0.55)');
        glow.addColorStop(0.55, 'rgba(255,110,40,0.22)');
        glow.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r * 2.6, 0, Math.PI * 2);
        ctx.fill();
        // 球体本身：实心 + 亮边，看起来才像一颗「球」
        const core = ctx.createRadialGradient(
          b.x - r * 0.35, b.y - r * 0.35, r * 0.1,
          b.x, b.y, r,
        );
        core.addColorStop(0, '#fff2c4');
        core.addColorStop(0.45, '#ffb347');
        core.addColorStop(1, '#e0451c');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,224,150,0.9)';
        ctx.lineWidth = 0.0025;
        ctx.stroke();
      } else if (b.tag === TAG.FIRE_RING) {
        ctx.strokeStyle = COLORS.fireHot;
        ctx.lineWidth = 0.004;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius || 0.02, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 水球 / 毒水球
    // 【为什么必须画】这两类是关卡里「一碰就炸开」的机关：
    //   bubbles 破了释放一堆水、poisonBalls 破了释放毒水。
    //   引擎里一直有这两个数组、也会在碰撞时置 used，
    //   但渲染层从来没画过，玩家只能看到水凭空多出来，
    //   完全不知道那里原本有个球。
    for (const list of [world.bubbles, world.poisonBalls]) {
      for (const cs of list) {
        const d = cs.def;
        if (!d) continue;
        const r = d.radius || 0.02;
        const isPoison = list === world.poisonBalls;
        // 用过的球画成半透明的残影，表示「已经破了」
        const alpha = cs.used ? 0.16 : 1;
        ctx.globalAlpha = alpha;
        const grad = ctx.createRadialGradient(
          d.cx - r * 0.35, d.cy - r * 0.35, r * 0.12,
          d.cx, d.cy, r,
        );
        if (isPoison) {
          grad.addColorStop(0, '#d6f5a8');
          grad.addColorStop(0.5, '#7fd93b');
          grad.addColorStop(1, '#3f7a17');
        } else {
          grad.addColorStop(0, '#eafcff');
          grad.addColorStop(0.5, '#8fdcf0');
          grad.addColorStop(1, '#2f7f9c');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(d.cx, d.cy, r, 0, Math.PI * 2);
        ctx.fill();
        // 高光小点，让球看起来是「有体积的水球」而不是一个色块
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.arc(d.cx - r * 0.32, d.cy - r * 0.32, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // 关卡文字提示
    // 【为什么必须画】每关的说明（「这是一个规则关」「记得，线段有重力！」）
    //   都写在 levels.js 的 texts 里，引擎只把它当数据存着，没人渲染。
    //   结果就是玩家完全看不到关卡想教什么，只能自己瞎试。
    for (const t of (world.level.texts || [])) {
      if (!t || !t.text) continue;
      const lines = String(t.text).split('\n');
      // 【字号为什么不能用世界坐标】画布的变换矩阵是
      //     setTransform(dpr*scale, 0, 0, dpr*scale, 0, 0)
      //   而 ctx.font 只接受绝对像素值，不参与这个缩放。
      //   原来写 0.019px —— 这本身就是非法字号（浏览器要求 >= 1px），
      //   整条 font 赋值被静默忽略，canvas 退回默认的 10px sans-serif，
      //   于是所有关卡提示都变成一堆看不清的小字。
      //   正确做法：把想要的世界高度（0.026）乘上 scale 换成像素。
      const fontPx = Math.max(11, 0.026 * scale);
      ctx.font = `${fontPx}px ${CANVAS_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(226,238,245,0.72)';
      // 行距也用像素，否则同样会被当成世界坐标而挤在一起
      const lh = fontPx * 1.45;
      const startY = t.y - ((lines.length - 1) * lh) / 2;
      for (let i = 0; i < lines.length; i++) {
        // 关卡数据里夹带了 <bold><color r g b a> 这类富文本标记，
        // 画布 fillText 不认，直接剥掉只留纯文字
        const plain = lines[i]
          .replace(/<\/?bold>/g, '')
          .replace(/<color[^>]*>/g, '')
          .replace(/<\/color>/g, '');
        ctx.fillText(plain, t.x, startY + i * lh);
      }
      ctx.textBaseline = 'alphabetic';
    }

    // 蒸汽
    // 【为什么必须画】引擎里 addSteam 一直在往 world.steams 里塞粒子
    //   （水碰到火焰就生成），但渲染层从来没读过这个数组，
    //   所以「蒸发」只有物理结果、没有视觉反馈，看起来就像水凭空消失。
    //   这里按剩余寿命做淡出 + 上浮放大，是水被烧掉时唯一的提示。
    for (const st of world.steams) {
      const t = Math.max(0, Math.min(1, st.life / st.maxLife));
      const r = st.size * (1 + (1 - t) * 1.8);
      const alpha = t * 0.42;
      const puff = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, r);
      puff.addColorStop(0, `rgba(226,238,245,${alpha})`);
      puff.addColorStop(1, 'rgba(226,238,245,0)');
      ctx.fillStyle = puff;
      ctx.beginPath();
      ctx.arc(st.x, st.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 正在画的线
    if (drawing && drawX.length > 1) {
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = 0.006;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(drawX[0], drawY[0]);
      for (let i = 1; i < drawX.length; i++) ctx.lineTo(drawX[i], drawY[i]);
      ctx.stroke();
    }

    // 提示文字
    if (world.toastTimer > 0 && world.toast) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      // 同上：必须是像素值，且带下限，免得在小屏上小到看不见
      ctx.font = `${Math.max(12, 0.03 * scale)}px ${CANVAS_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(world.toast, w / 2, hh - 0.04);
    }
  }

  /* ================= 主循环 ================= */
  const FIXED_DT = 1 / 240;

  function loop(now) {
    if (!running) return;
    if (!lastFrame) lastFrame = now;
    let dt = (now - lastFrame) / 1000;
    lastFrame = now;
    // 卡顿保护：切后台回来时 dt 可能是几十秒，直接夹到 0.1
    if (dt > 0.1) dt = 0.1;

    // 定步长推进：物理必须固定步长，否则掉帧会让水变慢、快进会让水穿墙
    world.accumulator += dt;
    let steps = 0;
    while (world.accumulator >= FIXED_DT && steps < 12) {
      world.update(FIXED_DT);
      world.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === 12) world.accumulator = 0;

    draw();
    if (world.state === 'won' || world.state === 'lost') {
      if (!settled) {
        settled = true;
        settle();
      }
    } else if (settled) {
      settled = false;
    }
    if (world.state === 'running' && (world.dropsInCup !== lastDrops)) {
      lastDrops = world.dropsInCup;
      syncChrome();
    }
    requestAnimationFrame(loop);
  }

  let settled = false;
  let lastDrops = -1;
  syncChrome();
  requestAnimationFrame(loop);

  return {
    destroy() {
      running = false;
      ro.disconnect();
      root.remove();
    },
  };
}
