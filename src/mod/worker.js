/**
 * 模组脚本执行线程。
 *
 * 【为什么必须放进 Worker】模组脚本是用户写的 Python，随时可能
 *   `while True: pass`。放主线程就算有步数上限，也会在达到上限之前
 *   卡住渲染几百毫秒。放进 Worker 后，主线程只负责收消息改数值，
 *   卡死也只是那个线程卡死。
 *
 * 【为什么用"分片执行"而不是一直跑到结束】解释器是生成器，每次 next()
 *   只走一步。我们每片跑 N 步就 setTimeout(0) 让出，这样：
 *     · 主线程发来的 pause/stop 能在几十毫秒内被看到；
 *     · time.sleep 不需要真的阻塞，只要把下一片的调度时间往后推；
 *     · 游戏暂停时脚本也冻结，恢复后不会"补执行"一堆。
 */
import { parse, Interpreter, PyError } from './interp.js';

const SLICE_STEPS = 1200; // 每片最多执行多少步
const IDLE_MS = 4; // 让出后多久继续

let interp = null;
let gen = null;
let running = false;
let paused = false;
let stopped = false;
let sleepUntil = 0;
let pauseBeganAt = 0;
let timer = 0;

/** 模组对象的镜像：主线程 pushState 时更新，Python 读这里 */
let mirror = {};
const methods = {}; // path -> [methodName]

function post(msg) {
  self.postMessage(msg);
}

/** 构造 Python 可见的模组对象 */
function buildModules(schema, classes) {
  const mods = new Map();
  const hooks = {
    onSet(path, value) {
      post({ type: 'set', path, value });
    },
    onCall(path, args) {
      post({ type: 'call', path, args });
      return null;
    },
    methods: [],
  };

  // 顶层对象：每个游戏的 mods 就是它的属性
  const rootProxy = makeProxy('', mirror, hooks, schema);
  mods.set('game', rootProxy);
  // 每个游戏还可以用 import {小游戏英文名}
  if (schema && schema.__names) {
    for (const n of schema.__names) mods.set(n, rootProxy);
  }
  return mods;
}

function makeProxy(path, node, hooks, schema) {
  const target = {};
  return new Proxy(target, {
    get(_, prop) {
      if (prop === '__isMod') return true;
      if (typeof prop === 'symbol') return undefined;
      const val = node ? node[prop] : undefined;
      // 方法：schema.classes 里声明过的
      const methodList = schema && schema.methods && schema.methods[path];
      if (methodList && methodList.includes(prop)) {
        const fn = (...args) => hooks.onCall(path ? path + '.' + prop : prop, args);
        fn.__pyModMethod = true;
        return fn;
      }
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        return makeProxy(path ? path + '.' + prop : prop, val, hooks, schema);
      }
      return val;
    },
    set(_, prop, value) {
      if (node) node[prop] = value;
      hooks.onSet(path ? path + '.' + prop : prop, value);
      return true;
    },
    has(_, prop) {
      return node ? prop in node : false;
    },
  });
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === 'init') {
      mirror = msg.state || {};
      methods.__names = msg.names || [];
      // timer 的方法要能被 ModProxy 认出来：它不在 schema.methods 里，
      // 因为 timer 是"内建类"而不是普通子对象。这里补上，
      // 让 timer.add(...) 在两种绑定方式下都能落到 onCall。
      const methodMap = { ...(msg.methods || {}), timer: ['add', 'reset', 'pause', 'resume'] };
      const modules = buildModules({ __names: msg.names || [], methods: methodMap }, {});
      interp = new Interpreter({
        modules,
        onSet: (p, v) => post({ type: 'set', path: p, value: v }),
        onCall: (p, args) => {
          post({ type: 'call', path: p, args });
          return null;
        },
        onLog: (text) => post({ type: 'log', text }),
        maxSteps: msg.maxSteps || 2_000_000,
      });
      // 暴露 timer 类：让 Python 能 type(timer) → <class 'timer'>、timer.add(30) 能调用
      // 【为什么读的是 mirror 而不是一次性快照】Python 里 timer.remaining 必须
      //   永远反映当前这一帧的真实剩余时间，否则脚本会按过期数据做判断。
      interp.globals.set('timer', interp.bindTimer(
        (name) => (mirror.timer || {})[name],
        (method, args) => {
          post({ type: 'call', path: 'timer.' + method, args });
          return null;
        },
      ));
      post({ type: 'ready' });
      return;
    }

    if (msg.type === 'state') {
      // 覆盖镜像：Python 下次读到的是最新值
      deepAssign(mirror, msg.state || {});
      return;
    }

    if (msg.type === 'start') {
      start(msg.code);
      return;
    }

    if (msg.type === 'pause') {
      if (!paused) {
        paused = true;
        pauseBeganAt = Date.now();
      }
      return;
    }

    if (msg.type === 'resume') {
      if (paused) {
        paused = false;
        // 暂停期间"冻结"的 sleep 时间要顺延，否则恢复瞬间会补睡
        if (sleepUntil) sleepUntil += Date.now() - pauseBeganAt;
        pauseBeganAt = 0;
        schedule(0);
      }
      return;
    }

    if (msg.type === 'stop') {
      stopped = true;
      running = false;
      clearTimeout(timer);
      gen = null;
      post({ type: 'stopped' });
      return;
    }
  } catch (e) {
    post({ type: 'error', message: String(e && e.message ? e.message : e) });
  }
};

function deepAssign(dst, src) {
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {};
      deepAssign(dst[k], v);
    } else {
      dst[k] = v;
    }
  }
}

function start(code) {
  if (running) {
    stopped = true;
    clearTimeout(timer);
  }
  stopped = false;
  paused = false;
  running = true;
  sleepUntil = 0;
  try {
    const ast = parse(code);
    gen = interp.run(ast);
    post({ type: 'started' });
    schedule(0);
  } catch (e) {
    running = false;
    post({ type: 'error', message: e instanceof PyError ? e.message : String(e) });
  }
}

function schedule(ms) {
  if (stopped) return;
  clearTimeout(timer);
  timer = setTimeout(tick, ms);
}

function tick() {
  if (stopped || !running || !gen) return;

  // 暂停：不推进生成器，50ms 后再看
  if (paused) {
    schedule(50);
    return;
  }

  // 睡眠中
  if (sleepUntil) {
    const now = Date.now();
    if (now < sleepUntil) {
      schedule(Math.min(50, sleepUntil - now));
      return;
    }
    sleepUntil = 0;
  }

  let steps = 0;
  try {
    while (steps < SLICE_STEPS) {
      const r = gen.next();
      if (r.done) {
        running = false;
        post({ type: 'done' });
        return;
      }
      const v = r.value;
      if (v && v.type === 'sleep') {
        sleepUntil = Date.now() + Math.max(0, v.ms);
        steps = SLICE_STEPS; // 让出，等下一片
      }
      steps++;
    }
  } catch (e) {
    running = false;
    post({ type: 'error', message: e instanceof PyError ? e.message : String(e) });
    return;
  }
  schedule(IDLE_MS);
}
