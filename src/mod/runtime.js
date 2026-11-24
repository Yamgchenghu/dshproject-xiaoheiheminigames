/**
 * 模组运行时：主线程与 Python 执行线程之间的桥。
 *
 * 【为什么用 Worker，还要留一条降级路径】
 *   Worker 让 Python 真正"独立于主进程"——它跑死了，游戏画面照常刷新，
 *   主线程只需要在收到 set/call 消息时改个数值，这是用户要的语义。
 *   但某些容器（老 WebView、CSP 严格的宿主）不允许 new Worker，
 *   这时候退化成"主线程分片执行"：同样的生成器，每片 1200 步后让出。
 *   两条路径对外接口完全一致，上层不用关心走的是哪条。
 */
import { parse, Interpreter, PyError } from './interp.js';

const SLICE_STEPS = 1200;

export class ModRuntime {
  /**
   * @param {object} o
   * @param {string} o.gameId
   * @param {string} o.code  Python 源码
   * @param {object} o.target  游戏的实时参数对象（会被 Python 直接改写）
   * @param {(path:string, value:any)=>void} o.onSet
   * @param {(path:string, method:string, args:any[])=>any} o.onCall
   * @param {(msg:string)=>void} o.onLog
   * @param {(msg:string)=>void} o.onError
   */
  constructor(o) {
    this.gameId = o.gameId;
    this.code = o.code || '';
    this.target = o.target || {};
    this.onSet = o.onSet || (() => {});
    this.onCall = o.onCall || (() => null);
    this.onLog = o.onLog || (() => {});
    this.onError = o.onError || (() => {});

    this.worker = null;
    this.inline = null; // 降级路径的解释器状态
    this.paused = false;
    this.stopped = false;
    this.started = false;
  }

  get mode() {
    return this.worker ? 'worker' : 'inline';
  }

  start() {
    if (this.started) return;
    this.started = true;
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (ev) => this.handleMessage(ev.data);
        this.worker.onerror = (e) => {
          // Worker 起不来（CSP 等）→ 降级
          this.onLog('Worker 不可用，切换到主线程模式：' + (e.message || ''));
          this.worker = null;
          this.startInline();
        };
        this.worker.postMessage({
          type: 'init',
          state: this.snapshot(),
          names: [this.gameId],
          methods: {},
          maxSteps: 2_000_000,
        });
        this.worker.postMessage({ type: 'start', code: this.code });
        return;
      } catch (e) {
        this.onLog('Worker 创建失败，切换到主线程模式');
        this.worker = null;
      }
    }
    this.startInline();
  }

  /** 主线程降级：与 worker.js 同一套逻辑，只是没有独立线程 */
  startInline() {
    try {
      const ast = parse(this.code);
      const modules = new Map();
      const rootProxy = this.makeProxy('', this.target);
      modules.set(this.gameId, rootProxy);
      modules.set('game', rootProxy);
      const interp = new Interpreter({
        modules,
        onSet: (p, v) => this.applySet(p, v),
        onCall: (p, args) => {
          this.onCall(p, p.split('.').pop(), args);
          return null;
        },
        onLog: (t) => this.onLog(t),
        maxSteps: 2_000_000,
      });
      // 主线程模式同样要绑定 timer：两条路径的 Python 语义必须完全一致，
      // 否则"在桌面能跑、在手机上报错"这种问题会非常难查。
      interp.globals.set('timer', interp.bindTimer(
        (name) => (this.target.timer || {})[name],
        (method, args) => {
          this.onCall('timer.' + method, method, args);
          return null;
        },
      ));
      this.inline = {
        interp,
        gen: interp.run(ast),
        sleepUntil: 0,
        timer: 0,
        running: true,
      };
      this.tickInline();
    } catch (e) {
      this.onError(e instanceof PyError ? e.message : String(e));
    }
  }

  makeProxy(path, node) {
    const self = this;
    return new Proxy({}, {
      get(_, prop) {
        if (typeof prop === 'symbol') return undefined;
        const val = node ? node[prop] : undefined;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
          return self.makeProxy(path ? path + '.' + prop : prop, val);
        }
        return val;
      },
      set(_, prop, value) {
        const full = path ? path + '.' + prop : prop;
        if (node) node[prop] = value;
        self.applySet(full, value);
        return true;
      },
      has(_, prop) {
        return node ? prop in node : false;
      },
    });
  }

  tickInline() {
    const st = this.inline;
    if (!st || this.stopped) return;
    if (this.paused) {
      st.timer = setTimeout(() => this.tickInline(), 50);
      return;
    }
    const now = Date.now();
    if (st.sleepUntil && now < st.sleepUntil) {
      st.timer = setTimeout(() => this.tickInline(), Math.min(50, st.sleepUntil - now));
      return;
    }
    st.sleepUntil = 0;

    let steps = 0;
    try {
      while (steps < SLICE_STEPS) {
        const r = st.gen.next();
        if (r.done) {
          st.running = false;
          return;
        }
        if (r.value && r.value.type === 'sleep') {
          st.sleepUntil = Date.now() + Math.max(0, r.value.ms);
          steps = SLICE_STEPS;
        }
        steps++;
      }
    } catch (e) {
      this.onError(e instanceof PyError ? e.message : String(e));
      return;
    }
    st.timer = setTimeout(() => this.tickInline(), 4);
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'set':
        this.applySet(msg.path, msg.value);
        break;
      case 'call':
        this.onCall(msg.path, String(msg.path).split('.').pop(), msg.args || []);
        break;
      case 'log':
        this.onLog(msg.text);
        break;
      case 'error':
        this.onError(msg.message);
        break;
      case 'done':
      case 'stopped':
        break;
      default:
        break;
    }
  }

  /** 写到游戏实时参数对象上；上层还会做一次"立刻生效"的钩子 */
  applySet(path, value) {
    const parts = String(path).split('.');
    let cur = this.target;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    this.onSet(path, value);
  }

  snapshot() {
    try {
      return JSON.parse(JSON.stringify(this.target));
    } catch {
      return {};
    }
  }

  /** 把主线程的最新状态推给 Python */
  pushState(state) {
    if (this.worker) {
      this.worker.postMessage({ type: 'state', state: JSON.parse(JSON.stringify(state)) });
    } else if (this.inline) {
      // 主线程模式下 Python 直接读同一个对象，不需要同步
    }
  }

  pause() {
    this.paused = true;
    this.worker?.postMessage({ type: 'pause' });
  }

  resume() {
    this.paused = false;
    if (this.worker) this.worker.postMessage({ type: 'resume' });
    else if (this.inline && !this.inline.running) this.tickInline();
  }

  /** 游戏停止 → 强制终止 Python */
  stop() {
    this.stopped = true;
    this.paused = false;
    if (this.worker) {
      this.worker.postMessage({ type: 'stop' });
      setTimeout(() => this.worker?.terminate(), 60);
      this.worker = null;
    }
    if (this.inline) {
      clearTimeout(this.inline.timer);
      this.inline = null;
    }
  }

  restart() {
    this.stop();
    this.stopped = false;
    this.started = false;
    this.start();
  }
}
