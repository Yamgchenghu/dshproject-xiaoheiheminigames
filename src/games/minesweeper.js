/**
 * 扫雷 —— 计时 + 揭开格子的经典玩法。
 *
 * 【计分】剩余时间越短越差；这里用「排雷进度 × 速度」给分，让"快"和"准"都被奖励。
 *   胜利直接按剩余时间秒数给基础分，再乘一个难度系数，避免不同盘面互相不可比。
 *
 * 【为什么首次点击才布雷】先把雷撒好再让玩家点，开局就可能一点即爆，
 *   那是运气不是技术。首次点击及其邻域必须无雷。
 */
import { makeRng, randInt, clamp } from '../core/util.js';
import { canvasFont } from '../core/fonts.js';

const MODES = {
  small: { rows: 9, cols: 9, mines: 10, ms: 120000, label: '9×9 · 10 雷' },
  large: { rows: 15, cols: 15, mines: 40, ms: 180000, label: '15×15 · 40 雷' },
  wide: { rows: 15, cols: 21, mines: 70, ms: 300000, label: '21×15 · 70 雷' },
};

export const meta = {
  id: 'minesweeper',
  title: '扫雷',
  sub: '排掉全部地雷，用时越短越好',
  accent: '#e05a5a',
  bgm: 'minesweeper',
  modes: [
    { value: 'small', label: '初级 9×9', sub: '10 颗雷 · 2 分钟', fullMark: 600 },
    { value: 'large', label: '中级 15×15', sub: '40 颗雷 · 3 分钟', fullMark: 900 },
    { value: 'wide', label: '高级 21×15', sub: '70 颗雷 · 5 分钟', fullMark: 1500 },
  ],
  schema: {
    score: 0,
    opened: 0,
    total: 0,
    flags: 0,
    lives: 1,
    bomb: { density: 1 },
    hint: { count: 3 },
    timer: { remaining: 120, duration: 120, elapsed: 0, paused: false },
  },
  classes: {
    timer: { attrs: ['remaining', 'duration', 'elapsed', 'paused'], methods: ['add', 'reset', 'pause', 'resume'] },
  },
  achievements: [
    { id: 'win1', name: '第一次排雷', desc: '完成一局扫雷', check: (s) => s.wins >= 1 },
    { id: 'fast', name: '手速惊人', desc: '初级 30 秒内通关', check: (s) => s.bestTimeSmall > 0 && s.bestTimeSmall <= 30000 },
    { id: 'noflag', name: '不插旗', desc: '全程不插旗通关', check: (s) => s.noFlagWin },
    { id: 'hard', name: '高级工兵', desc: '高级盘面通关', check: (s) => s.bestTimeWide > 0 },
  ],
};

export function create(opts = {}) {
  const modeKey = MODES[opts.mode] ? opts.mode : 'small';
  const cfg = MODES[modeKey];
  const rng = makeRng(opts.seed == null ? Date.now() & 0xffff : opts.seed);

  const rows = cfg.rows;
  const cols = cfg.cols;
  const totalCells = rows * cols;

  const mods = {
    score: 0,
    opened: 0,
    total: totalCells - cfg.mines,
    flags: 0,
    lives: 1,
    bomb: { density: 1 },
    hint: { count: 3 },
    timer: { remaining: cfg.ms / 1000, duration: cfg.ms / 1000, elapsed: 0, paused: false },
  };

  let mineCount = cfg.mines;
  let mines = [];
  let numbers = [];
  let state = []; // 0=隐藏 1=已开 2=旗
  let firstClick = true;
  let status = 'ready';
  let over = false;
  let opened = 0;
  let flags = 0;
  let elapsed = 0;
  let boomAt = null;
  let lost = false;
  /**
   * 棋盘在画布里的实际位置和格子大小。
   * 【为什么必须记下来】draw() 里棋盘不是铺满画布的：
   *   上方留 56px 给状态栏，四周留 24/16px 边距，然后整体居中。
   *   而 pointer() 原来直接用 y*rows 把 0..1 映射到格子，
   *   等于假设棋盘铺满整块画布——手指点在格子上，判定却落到别的格，
   *   越靠近边缘偏得越多，表现出来就是「点了没反应」或「点错格」。
   *   draw 每帧都会跑，在这里记录天然是最新的。
   */
  let boardRect = { ox: 0, oy: 0, cell: 32, cols: 9, rows: 9 };
  /** draw 时记录的画布 CSS 像素尺寸，pointer 要把 0..1 还原成像素 */
  let canvasW = 0;
  let canvasH = 0;

  function reset() {
    mines = new Array(totalCells).fill(false);
    numbers = new Array(totalCells).fill(0);
    state = new Array(totalCells).fill(0);
    firstClick = true;
    status = 'ready';
    over = false;
    opened = 0;
    flags = 0;
    elapsed = 0;
    boomAt = null;
    lost = false;
    // 难度倍率通过 mods.bomb.density 调整：>1 更密，<1 更稀
    const density = clamp(Number(mods.bomb.density) || 1, 0.1, 3);
    mineCount = Math.min(totalCells - 9, Math.max(1, Math.round(cfg.mines * density)));
    mods.total = totalCells - mineCount;
    syncMods();
  }

  function idx(r, c) {
    return r * cols + c;
  }

  function neighbors(r, c) {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push([nr, nc]);
      }
    }
    return out;
  }

  /** 首次点击后布雷：避开点击格及其邻域，保证开局必是空白 */
  function layMines(sr, sc) {
    const safe = new Set([idx(sr, sc), ...neighbors(sr, sc).map(([r, c]) => idx(r, c))]);
    const pool = [];
    for (let i = 0; i < totalCells; i++) if (!safe.has(i)) pool.push(i);
    // Fisher-Yates 取前 mineCount 个
    for (let i = pool.length - 1; i > 0; i--) {
      const j = randInt(rng, 0, i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = pool.slice(0, mineCount);
    for (const i of picked) mines[i] = true;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (mines[idx(r, c)]) continue;
        let n = 0;
        for (const [nr, nc] of neighbors(r, c)) if (mines[idx(nr, nc)]) n++;
        numbers[idx(r, c)] = n;
      }
    }
  }

  function floodOpen(r, c) {
    const stack = [[r, c]];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      const i = idx(cr, cc);
      if (state[i] !== 0 || mines[i]) continue;
      state[i] = 1;
      opened++;
      if (numbers[i] === 0) {
        for (const [nr, nc] of neighbors(cr, cc)) {
          const ni = idx(nr, nc);
          if (state[ni] === 0 && !mines[ni]) stack.push([nr, nc]);
        }
      }
    }
  }

  function openCell(r, c) {
    if (over || state[idx(r, c)] !== 0) return;
    if (firstClick) {
      layMines(r, c);
      firstClick = false;
      if (status === 'ready') status = 'playing';
    }
    const i = idx(r, c);
    if (mines[i]) {
      state[i] = 1;
      boomAt = { r, c, t: 0 };
      lost = true;
      over = true;
      status = 'over';
      opts.onEnd && opts.onEnd(result());
      return;
    }
    floodOpen(r, c);
    syncMods();
    if (opened >= totalCells - mineCount) win();
  }

  function win() {
    over = true;
    status = 'over';
    opts.onEnd && opts.onEnd(result());
  }

  function toggleFlag(r, c) {
    if (over) return;
    const i = idx(r, c);
    if (state[i] === 1) return;
    state[i] = state[i] === 2 ? 0 : 2;
    flags = state.filter((s) => s === 2).length;
    syncMods();
  }

  function syncMods() {
    mods.opened = opened;
    mods.flags = flags;
    mods.score = score();
    mods.timer.remaining = Math.max(0, cfg.ms / 1000 - elapsed);
    mods.timer.elapsed = elapsed;
    mods.timer.duration = cfg.ms / 1000;
  }

  /**
   * 模组改时间：正数加时，负数扣时。
   *
   * 【为什么是挪 elapsed 而不是挪上限】扫雷的剩余时间处处由
   *   cfg.ms/1000 - elapsed 算出来，改 elapsed 才是唯一一处改动、
   *   全场一致的做法；改上限会让计分和显示各算各的。
   */
  function extendTime(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n === 0) return;
    elapsed = clamp(elapsed - n, 0, cfg.ms / 1000);
    syncMods();
  }

  /** 模组重置计时：回到满时间 */
  function resetTimer() {
    elapsed = 0;
    syncMods();
  }

  /** 计分：胜利 = 剩余秒数 × 难度系数；失败 = 已排雷数 × 2 */
  function score() {
    const remain = Math.max(0, cfg.ms / 1000 - elapsed);
    const diff = mineCount / 10;
    if (opened >= totalCells - mineCount && !lost) return Math.round(remain * 6 * Math.sqrt(diff) + 100);
    return Math.round(opened * 3);
  }

  function result() {
    return {
      score: score(),
      won: !lost && opened >= totalCells - mineCount,
      timeMs: Math.round(elapsed * 1000),
      detail: lost ? `踩到雷了 · 排雷 ${opened}/${totalCells - mineCount}` : `通关！剩余 ${Math.round(cfg.ms / 1000 - elapsed)} 秒`,
      extra: { opened, mines: mineCount, flags },
    };
  }

  reset();

  return {
    kind: 'canvas',
    meta,
    mods,
    get status() { return status; },
    get over() { return over; },
    get score() { return score(); },
    get elapsedMs() { return Math.round(elapsed * 1000); },
    get stats() { return result(); },
    get board() { return { rows, cols, mines, numbers, state, firstClick }; },

    start() {
      if (status === 'ready') status = 'playing';
    },
    pause() { if (status === 'playing') status = 'paused'; },
    resume() { if (status === 'paused') status = 'playing'; },
    restart() { reset(); },

    extendTime,
    resetTimer,

    tick(dt) {
      if (status === 'playing') {
        // 模组把 timer.paused 设成 true 时冻结计时（Python 侧 timer.pause()）
        if (!mods.timer.paused) elapsed += dt;
        if (elapsed * 1000 >= cfg.ms) {
          lost = true;
          over = true;
          status = 'over';
          opts.onEnd && opts.onEnd(result());
        }
        syncMods();
      }
      if (boomAt) boomAt.t += dt;
    },

    /**
     * 逻辑坐标 (0..1) → 格子。
     *
     * 【为什么不能再直接乘 rows/cols】棋盘在画布里是居中的一小块，
     *   四周有留白（见 boardRect 的说明）。必须先把 0..1 还原成画布像素，
     *   再减掉棋盘偏移、除以格子边长，才能得到真正的行列号。
     */
    pointer(x, y, isFlag) {
      if (over) return;
      const { ox, oy, cell, cols: bc, rows: br } = boardRect;
      const px = x * canvasW;
      const py = y * canvasH;
      const c = Math.floor((px - ox) / cell);
      const r = Math.floor((py - oy) / cell);
      if (r < 0 || r >= br || c < 0 || c >= bc) return;
      // 【长按的语义按格子状态分流】用户要求把「自动标雷 / 自动翻开」
      //   从 HUD 按钮移进长按，不再单独占两个按钮位。
      //   长按未翻开的格 = 插旗（原长按行为，保持不变）；
      //   长按已翻开的数字格 = 和弦展开（该标的都标齐了，一次翻开周围）。
      //   这样两个动作都在"长按这个格子"上，符合直觉，也不用记按钮。
      // 【长按已翻开的数字格 = 和弦展开】这里直接按已算好的 (r, c) 做，
      //   不再回调 chord()——chord 会把 x/y 再乘一次 canvasW，
      //   传进去的行列会算错（曾经就因此读到 undefined 的 boardRect）。
      //   逻辑与 chord 一致：旗数正好等于数字才展开，否则什么都不做。
      if (isFlag && state[idx(r, c)] === 1) {
        const n = numbers[idx(r, c)];
        if (n > 0) {
          const around = neighbors(r, c);
          let flagged = 0;
          for (const [nr, nc] of around) if (state[idx(nr, nc)] === 2) flagged++;
          if (flagged === n) {
            for (const [nr, nc] of around) {
              if (state[idx(nr, nc)] === 0) openCell(nr, nc);
              if (over) return;
            }
          }
        }
        return;
      }
      if (isFlag) toggleFlag(r, c);
      else openCell(r, c);
    },

    /**
     * 和弦（自动翻开）：点一个已翻开的数字格，如果它周围的旗数
     * 正好等于这个数字，就把周围所有没插旗的格子一起翻开。
     *
     * 【为什么需要】扫雷玩到中后期全是重复劳动：数完旗数还要一个个点。
     *   原版扫雷都有这个操作，没有的话盘面一复杂就非常难熬。
     * 【为什么旗数必须"正好等于"】只有确认了该标的雷都标齐了才安全。
     *   旗数少于数字说明还有雷没标出来，这时候和弦等于赌命。
     */
    chord(x, y) {
      if (over) return;
      const { ox, oy, cell, cols: bc, rows: br } = boardRect;
      const c = Math.floor((x * canvasW - ox) / cell);
      const r = Math.floor((y * canvasH - oy) / cell);
      if (r < 0 || r >= br || c < 0 || c >= bc) return;
      const i = idx(r, c);
      if (state[i] !== 1 || numbers[i] <= 0) return;
      const around = neighbors(r, c);
      let flagged = 0;
      for (const [nr, nc] of around) if (state[idx(nr, nc)] === 2) flagged++;
      if (flagged !== numbers[i]) return;
      for (const [nr, nc] of around) {
        if (state[idx(nr, nc)] === 0) openCell(nr, nc);
        if (over) return;
      }
    },

    /**
     * 自动标雷：把所有「周围未开格数 == 数字」的位置一次性插旗。
     *
     * 【为什么这条规则是安全的】一个已翻开的数字格，如果它周围
     *   剩下的未知格数量正好等于这个数字，那么这些未知格必然全是雷——
     *   不存在别的可能。这是纯逻辑推导，不是猜。
     * 【为什么不做更复杂的推理】再往上（比如 1-2-1 模式）需要成对分析，
     *   容易误判，一旦标错反而坑玩家。这里只做百分之百确定的那一层，
     *   剩下的交给玩家自己判断。
     */
    autoFlag() {
      if (over) return 0;
      let count = 0;
      let changed = true;
      // 反复扫描：这一轮标的旗可能让下一轮的格子满足条件
      while (changed) {
        changed = false;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const i = idx(r, c);
            if (state[i] !== 1 || numbers[i] <= 0) continue;
            const around = neighbors(r, c);
            let unknown = 0;
            let flagged = 0;
            for (const [nr, nc] of around) {
              const ni = idx(nr, nc);
              if (state[ni] === 0) unknown++;
              else if (state[ni] === 2) flagged++;
            }
            if (unknown > 0 && unknown + flagged === numbers[i]) {
              for (const [nr, nc] of around) {
                const ni = idx(nr, nc);
                if (state[ni] === 0) {
                  state[ni] = 2;
                  count++;
                }
              }
              flags = state.filter((s) => s === 2).length;
              changed = true;
            }
          }
        }
      }
      if (count) syncMods();
      return count;
    },

    /**
     * 自动翻开：把所有「周围旗数 == 数字」的格子一次性展开。
     *
     * 【为什么这条也是安全的】数字格周围旗数已经等于数字，
     *   说明该标的雷都标齐了，剩下没开的格子必然安全。
     *   这是 autoFlag 的对偶规则，两个配合能省掉大量重复点击。
     * 【为什么要反复扫描】一次展开会露出新的数字格，
     *   新格子可能立刻满足条件，一轮轮推下去能连锁清掉一大片。
     */
    autoOpen() {
      if (over) return 0;
      let count = 0;
      let changed = true;
      while (changed) {
        changed = false;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const i = idx(r, c);
            if (state[i] !== 1 || numbers[i] <= 0) continue;
            const around = neighbors(r, c);
            let flagged = 0;
            let unknown = 0;
            for (const [nr, nc] of around) {
              const ni = idx(nr, nc);
              if (state[ni] === 2) flagged++;
              else if (state[ni] === 0) unknown++;
            }
            if (unknown > 0 && flagged === numbers[i]) {
              for (const [nr, nc] of around) {
                if (state[idx(nr, nc)] === 0) {
                  openCell(nr, nc);
                  count++;
                }
                if (over) {
                  syncMods();
                  return count;
                }
              }
              changed = true;
            }
          }
        }
      }
      if (count) syncMods();
      return count;
    },

    /** 提示：随机开一个安全格（受 mods.hint.count 限制） */
    useHint() {
      if (over || mods.hint.count <= 0) return false;
      const safe = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = idx(r, c);
          if (!mines[i] && state[i] === 0 && !firstClick) safe.push([r, c]);
        }
      }
      if (!safe.length) return false;
      const [r, c] = safe[randInt(rng, 0, safe.length - 1)];
      mods.hint.count--;
      openCell(r, c);
      return true;
    },

    draw(ctx, w, h) {
      const padTop = 56;
      const avail = Math.min(w - 24, h - padTop - 16);
      const cell = Math.floor(Math.min(avail / cols, avail / rows));
      const boardW = cell * cols;
      const boardH = cell * rows;
      const ox = (w - boardW) / 2;
      const oy = padTop + (h - padTop - boardH) / 2;
      // 记下来给 pointer / chord 用，保证「看到哪就点到哪」
      canvasW = w;
      canvasH = h;
      boardRect = { ox, oy, cell, cols, rows };

      // 【为什么要先铺一层棋盘底】已翻开的格子是接近纯黑的暗块，
      //   如果直接画在同样是黑的画布上，两者会糊成一片，看不出网格。
      //   先铺一层略亮的底，暗格才能显出"凹槽"的轮廓。
      ctx.fillStyle = '#1b2028';
      ctx.fillRect(ox, oy, boardW, boardH);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = idx(r, c);
          const x = ox + c * cell;
          const y = oy + r * cell;
          const st = state[i];
          if (st === 1) {
            if (mines[i]) {
              const isBoom = boomAt && boomAt.r === r && boomAt.c === c;
              ctx.fillStyle = isBoom ? '#ff5252' : '#8a2b2b';
              ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
              ctx.fillStyle = '#fff';
              ctx.font = canvasFont(Math.floor(cell * 0.55));
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('💣', x + cell / 2, y + cell / 2 + 1);
            } else {
              // 【为什么用这个颜色】未翻开的格是"凸起的浅色块"，已翻开的格
              //   必须是"凹下去的暗块"，两者一眼能分开。
              //   原来已翻开用的是 rgba(255,255,255,0.10)，只比未翻开的 0.16
              //   暗一点点，整个盘面看起来一片灰——玩家根本分不清哪格翻过。
              //   现在用比背景更暗的实色，翻开 = 明显下沉。
              // 底色 + 一圈更暗的边：视觉上"凹进去"，和未翻开的凸起块拉开
              ctx.fillStyle = '#0a0d13';
              ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
              ctx.strokeStyle = 'rgba(0,0,0,0.55)';
              ctx.lineWidth = 1;
              ctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
              const n = numbers[i];
              if (n > 0) {
                const palette = ['', '#6fb3ff', '#5ad48a', '#ff7b7b', '#b48cff', '#ffb648', '#4ad9d9', '#e8e8e8', '#ff9ad5'];
                ctx.fillStyle = palette[n] || '#fff';
                ctx.font = canvasFont(Math.floor(cell * 0.56), 700);
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(String(n), x + cell / 2, y + cell / 2 + 1);
              }
            }
          } else {
            // 未翻开：明显的凸起块（上亮下暗的渐变 + 高光边），
            // 让它和"已翻开的暗格"形成立体对比，而不是同一片灰。
            const g = ctx.createLinearGradient(x, y, x, y + cell);
            g.addColorStop(0, 'rgba(255,255,255,0.30)');
            g.addColorStop(1, 'rgba(255,255,255,0.14)');
            ctx.fillStyle = g;
            ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
            // 顶部高光：一条 1px 的亮线，强化"这块还没翻"的凸起感
            ctx.fillStyle = 'rgba(255,255,255,0.22)';
            ctx.fillRect(x + 1, y + 1, cell - 2, 1);
            if (st === 2) {
              ctx.font = canvasFont(Math.floor(cell * 0.5));
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('🚩', x + cell / 2, y + cell / 2 + 1);
            }
          }
        }
      }
    },
  };
}
