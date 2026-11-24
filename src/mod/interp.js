/**
 * Python 子集的解释执行器（生成器版）。
 *
 * 【为什么用 generator 而不是普通递归】模组脚本里有 while True + time.sleep，
 *   普通递归会把线程卡死。写成生成器后，每条语句执行完就 yield 一次控制权，
 *   驱动方可以：
 *     · 计数——防止死循环把设备跑飞；
 *     · 挂起——游戏暂停时不再 next()，Python 就冻结在原地；
 *     · 定时——time.sleep 只是"告诉驱动方 ms 之后再 next()"，不阻塞任何人。
 *   这是唯一能在浏览器主线程里安全跑任意用户脚本的做法。
 */
import { parse, PyError } from './python.js';

// ---------------- 控制流信号 ----------------
class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
  constructor(value) {
    this.value = value;
  }
}

// ---------------- 环境 ----------------
class Env {
  constructor(parent = null) {
    this.vars = new Map();
    this.parent = parent;
  }
  get(name) {
    let e = this;
    while (e) {
      if (e.vars.has(name)) return e.vars.get(name);
      e = e.parent;
    }
    throw new PyError(`名字 "${name}" 未定义`);
  }
  has(name) {
    let e = this;
    while (e) {
      if (e.vars.has(name)) return true;
      e = e.parent;
    }
    return false;
  }
  set(name, value) {
    // Python 语义：赋值永远写当前作用域（除非 global 声明）
    this.vars.set(name, value);
  }
  setExisting(name, value) {
    let e = this;
    while (e) {
      if (e.vars.has(name)) {
        e.vars.set(name, value);
        return;
      }
      e = e.parent;
    }
    this.vars.set(name, value);
  }
}

// ---------------- 值类型 ----------------
class PyFunc {
  constructor(name, params, body, closure, isLambda = false) {
    this.name = name;
    this.params = params;
    this.body = body;
    this.closure = closure;
    this.isLambda = isLambda;
    this.isPyFunc = true;
  }
}

class PyClass {
  constructor(name, bases, dict) {
    this.name = name;
    this.bases = bases;
    this.dict = dict; // Map<string, value>
    this.isPyClass = true;
  }
  lookup(name) {
    if (this.dict.has(name)) return this.dict.get(name);
    for (const b of this.bases) {
      const v = b.lookup?.(name);
      if (v !== undefined) return v;
    }
    return undefined;
  }
}

/**
 * 内建类：由宿主提供的对象（如 timer），对 Python 看起来是一个类。
 *
 * 【为什么必须做成类，而不是"一个普通对象"】用户明确要求 `timer` 是类：
 *   `type(timer)` 要打印 `<class 'timer'>`，`timer.add(30)` 要能调用。
 *   用普通 JS 对象，解释器只会当它是"某个不透明值"，属性访问会失败。
 *
 * 【为什么方法调用要带 self 但不吃实参】和 bindMethod 的约定保持一致：
 *   解释器在 callPyFunc 里看到 boundSelf 会跳过第一个形参，
 *   这里把 self 塞进 args[0]，让宿主侧拿到完整上下文（路径 + 方法名）。
 */
class NativeClass {
  constructor(name, attrs, methods) {
    this.name = name;
    this.bases = [];
    this.dict = new Map();
    this.isPyClass = true;
    this.isNative = true;
    this.attrs = attrs || [];     // 可读属性名
    this.methods = methods || []; // 可调方法名
    this.cls = this;              // 自引用：isinstance(timer, timer) 为 True
  }
  lookup(name) {
    return this.dict.get(name);
  }

  /**
   * 绑定宿主。
   * 【为什么 timer 既是"类"又是"实例"】用户要求 timer 是类
   *   （`type(timer)` → `<class 'timer'>`），但写法是 `timer.add(30)`——
   *   直接对类调用。Python 里那需要 classmethod，这里索性让这个对象
   *   同时扮演两个角色：type() 看到 <class 'timer'>，属性访问直接读宿主。
   *   代价是 `isinstance(timer, timer)` 要自引用才算得对，所以上面有 this.cls = this。
   */
  bind(getAttrs, callMethod) {
    this.getAttrs = getAttrs;
    this.callMethod = callMethod;
    return this;
  }

  get(name) {
    if (this.methods.includes(name)) {
      const fn = (...args) => this.callMethod(name, args);
      fn.__nativeMethod = name;
      return fn;
    }
    if (this.attrs.includes(name)) return this.getAttrs ? this.getAttrs(name) : undefined;
    return undefined;
  }
}

class PyInstance {
  constructor(cls) {
    this.cls = cls;
    this.dict = new Map();
    this.isPyInstance = true;
  }
  get(name) {
    if (this.dict.has(name)) return this.dict.get(name);
    const v = this.cls.lookup(name);
    if (v === undefined) return undefined;
    if (v instanceof PyFunc) return bindMethod(this, v);
    return v;
  }
  set(name, value) {
    this.dict.set(name, value);
  }
}

class PyModule {
  constructor(name, dict) {
    this.name = name;
    this.dict = dict;
    this.isPyModule = true;
  }
}

/** 绑定方法：把 self 塞进第一个参数 */
function bindMethod(inst, fn) {
  const bound = new PyFunc(fn.name, fn.params, fn.body, fn.closure, fn.isLambda);
  bound.boundSelf = inst;
  return bound;
}

/**
 * 模组对象：把普通 JS 对象包一层，属性写入立刻通知主线程。
 * 【为什么不用 JS Proxy】解释器里对 Proxy 的 `in` / 属性枚举处理会有歧义，
 *   显式类更可控，也让"哪些是模组对象"一目了然。
 */
class ModObject {
  constructor(path, node, interp) {
    this.path = path;
    this.node = node;
    this.interp = interp;
    this.isModObject = true;
  }
  get(name) {
    const val = this.node ? this.node[name] : undefined;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return new ModObject(this.path ? this.path + '.' + name : name, val, this.interp);
    }
    return val;
  }
  set(name, value) {
    const full = this.path ? this.path + '.' + name : name;
    if (this.node) this.node[name] = value;
    this.interp.onSet(full, value);
  }
}

/** 游戏对象代理：读写都转发给主线程，Python 看到的是"实时镜像" */
class ModProxy {
  constructor(path, node, hooks) {
    this.path = path;
    this.node = node; // 当前镜像（普通对象）
    this.hooks = hooks;
    this.isModProxy = true;
  }
  get(name) {
    if (name === '__class__') return 'mod';
    const hooks = this.hooks;
    const val = this.node ? this.node[name] : undefined;
    // 方法：schema 里声明过的方法名
    if (hooks.methods && hooks.methods.includes(name)) {
      return makeModMethod(this.path ? this.path + '.' + name : name, hooks);
    }
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return new ModProxy(this.path ? this.path + '.' + name : name, val, hooks);
    }
    return val;
  }
  set(name, value) {
    const full = this.path ? this.path + '.' + name : name;
    if (this.node) this.node[name] = value;
    this.hooks.onSet(full, value);
  }
}

function makeModMethod(path, hooks) {
  const fn = (...args) => hooks.onCall(path, args);
  fn.__pyModMethod = path;
  fn.__hooks = hooks;
  return fn;
}

// ---------------- 内置函数 ----------------
const BUILTINS = {
  print: (...args) => {
    const text = args.map(pyStr).join(' ');
    if (BUILTINS.__printHook) BUILTINS.__printHook(text);
    return null;
  },
  len: (x) => {
    if (typeof x === 'string') return x.length;
    if (Array.isArray(x)) return x.length;
    if (x instanceof Map) return x.size;
    if (x && x.isPyInstance && x.cls.name === 'timer') return 0;
    throw new PyError('len() 不支持该类型');
  },
  range: (a, b, c) => {
    let start = 0;
    let stop = a;
    let step = 1;
    if (b !== undefined) {
      start = a;
      stop = b;
      if (c !== undefined) step = c;
    }
    if (step === 0) throw new PyError('range() 步长不能为 0');
    const out = [];
    if (step > 0) for (let i = start; i < stop; i += step) out.push(i);
    else for (let i = start; i > stop; i += step) out.push(i);
    return out;
  },
  str: (x) => pyStr(x),
  int: (x) => {
    if (typeof x === 'string') {
      const n = parseInt(x, 10);
      return Number.isNaN(n) ? 0 : n;
    }
    return Math.trunc(Number(x) || 0);
  },
  float: (x) => Number(x) || 0,
  bool: (x) => pyTruthy(x),
  list: (x) => (x === undefined ? [] : Array.from(x instanceof Map ? x.keys() : x)),
  dict: () => new Map(),
  abs: (x) => Math.abs(x),
  min: (...a) => Math.min(...(a.length === 1 && Array.isArray(a[0]) ? a[0] : a)),
  max: (...a) => Math.max(...(a.length === 1 && Array.isArray(a[0]) ? a[0] : a)),
  sum: (arr) => arr.reduce((s, v) => s + v, 0),
  round: (x, n) => {
    const p = Math.pow(10, n || 0);
    return Math.round(x * p) / p;
  },
  sorted: (arr, opts) => {
    const copy = Array.from(arr);
    const keyFn = opts && opts.key;
    copy.sort((a, b) => {
      const ka = keyFn ? keyFn(a) : a;
      const kb = keyFn ? keyFn(b) : b;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    return copy;
  },
  enumerate: (arr, start = 0) => Array.from(arr).map((v, i) => [i + start, v]),
  zip: (...arrs) => {
    const n = Math.min(...arrs.map((a) => a.length));
    const out = [];
    for (let i = 0; i < n; i++) out.push(arrs.map((a) => a[i]));
    return out;
  },
  type: (x) => {
    if (x && x.isNative) return { __className: x.name, toString: () => `<class '${x.name}'>` };
    if (x && x.isNativeInstance) return { __className: x.cls.name, toString: () => `<class '${x.cls.name}'>` };
    if (x && x.isPyInstance) return { __className: x.cls.name, toString: () => `<class '${x.cls.name}'>` };
    if (x === null || x === undefined) return { toString: () => "<class 'NoneType'>" };
    if (typeof x === 'number') return { toString: () => Number.isInteger(x) ? "<class 'int'>" : "<class 'float'>" };
    if (typeof x === 'string') return { toString: () => "<class 'str'>" };
    if (typeof x === 'boolean') return { toString: () => "<class 'bool'>" };
    if (Array.isArray(x)) return { toString: () => "<class 'list'>" };
    if (x instanceof Map) return { toString: () => "<class 'dict'>" };
    return { toString: () => '<class object>' };
  },
  isinstance: (x, cls) => {
    if (!cls) return false;
    if (x && x.isNative) return x === cls;
    if (x && x.isNativeInstance) return x.cls === cls;
    if (x && x.isPyInstance) return x.cls === cls || isSubclass(x.cls, cls);
    return false;
  },
  Exception: { __className: 'Exception' },
  ValueError: { __className: 'ValueError' },
  RuntimeError: { __className: 'RuntimeError' },
};

function isSubclass(cls, base) {
  if (cls === base) return true;
  for (const b of cls.bases || []) if (isSubclass(b, base)) return true;
  return false;
}

export function pyTruthy(v) {
  if (v === null || v === undefined || v === false) return false;
  if (v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map) return v.size > 0;
  return true;
}

export function pyStr(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return String(Math.round(v * 1e10) / 1e10);
  }
  if (Array.isArray(v)) return '[' + v.map((x) => (typeof x === 'string' ? `'${x}'` : pyStr(x))).join(', ') + ']';
  if (v instanceof Map) {
    const parts = [];
    for (const [k, val] of v) parts.push(`${typeof k === 'string' ? `'${k}'` : pyStr(k)}: ${typeof val === 'string' ? `'${val}'` : pyStr(val)}`);
    return '{' + parts.join(', ') + '}';
  }
  if (v && v.isNative) return `<class '${v.name}'>`;
  if (v && v.isNativeInstance) return `<${v.cls.name} object>`;
  if (v && v.isPyInstance) return `<${v.cls.name} object>`;
  if (v && v.isPyClass) return `<class '${v.name}'>`;
  if (v && v.isModObject) return `<mod '${v.path}'>`;
  if (v && v.isModProxy) return `<mod '${v.path}'>`;
  if (v && v.toString && v.__className) return v.toString();
  if (typeof v === 'function') return '<built-in function>';
  return String(v);
}

// ---------------- 解释器 ----------------
export class Interpreter {
  /**
   * @param {object} opts
   * @param {Map<string, any>} opts.modules  模组对象（minesweeper / fruitninja / timer ...）
   * @param {(path:string, value:any)=>void} opts.onSet
   * @param {(path:string, args:any[])=>any} opts.onCall
   * @param {(msg:string)=>void} opts.onLog
   * @param {number} opts.maxSteps 步数上限（防止死循环）
   */
  constructor(opts = {}) {
    this.modules = opts.modules || new Map();
    this.onSet = opts.onSet || (() => {});
    this.onCall = opts.onCall || (() => null);
    this.onLog = opts.onLog || (() => {});
    this.maxSteps = opts.maxSteps || 200000;
    this.steps = 0;
    this.globals = new Env();
    this.installBuiltins();
    // 模组对象直接以名字可用（不需要 import）——用户写 minesweeper.bomb... 就能改。
    // 普通对象要包一层，否则 Python 改属性时主线程收不到通知。
    for (const [name, obj] of this.modules) {
      if (obj && typeof obj === 'object' && !obj.isPyModule && !obj.isModObject && !obj.isModProxy) {
        // 路径从模组根开始，不带模块名前缀——上层拿到 "bomb.appearrate" 就能直接写进 mods
        this.modules.set(name, new ModObject('', obj, this));
      }
      this.globals.set(name, this.modules.get(name));
    }
  }

  installBuiltins() {
    for (const [name, fn] of Object.entries(BUILTINS)) {
      if (typeof fn === 'function') this.globals.set(name, fn);
    }
    BUILTINS.__printHook = (text) => this.onLog(text);

    // time 模块：sleep 特殊处理（yield 给驱动方）
    const sleepFn = (ms) => {
      // 实际执行在 evalCall 里被拦截，这里只是占位
    };
    sleepFn.__pySleep = true;
    const timeMod = new PyModule('time', new Map([
      ['time', () => Date.now() / 1000],
      ['monotonic', () => performance.now() / 1000],
      ['sleep', sleepFn],
    ]));
    this.globals.set('time', timeMod);

    // random 模块
    let seedState = Date.now() >>> 0;
    const nextRand = () => {
      seedState = (seedState * 1664525 + 1013904223) >>> 0;
      return seedState / 4294967296;
    };
    const randomMod = new PyModule('random', new Map([
      ['random', () => nextRand()],
      ['seed', (s) => {
        seedState = (Number(s) || Date.now()) >>> 0;
        return null;
      }],
      ['randint', (a, b) => a + Math.floor(nextRand() * (b - a + 1))],
      ['uniform', (a, b) => a + nextRand() * (b - a)],
      ['choice', (arr) => arr[Math.floor(nextRand() * arr.length)]],
      ['shuffle', (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(nextRand() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return null;
      }],
    ]));
    this.globals.set('random', randomMod);
    this.randomMod = randomMod;

    /**
     * timer 内建类。
     * 【为什么要包成类而不是直接把 mods.timer 递进去】
     *   `type(timer)` 必须得到 `<class 'timer'>`，`timer.add(30)` 必须能调用。
     *   直接把 `{remaining, duration, ...}` 递进去，Python 只能读属性，
     *   方法调用会抛"对象没有属性 add"。
     *   这里把"读属性"和"调方法"分别接到宿主：
     *     读 → 走 ModObject 镜像（永远是最新值）
     *     调 → 走 onCall('timer.add', [30])
     */
    const timerCls = new NativeClass('timer',
      ['remaining', 'duration', 'elapsed', 'paused'],
      ['add', 'reset', 'pause', 'resume']);
    this.timerClass = timerCls;
    this.globals.set('timer', timerCls);
    // 让 `import timer` 也能拿到这个类
    this.modules.set('timer', timerCls);

    // import 走 this.modules，所以内置模块也要登记进去
    if (!this.modules.has('time')) this.modules.set('time', timeMod);
    if (!this.modules.has('random')) this.modules.set('random', randomMod);
  }

  /**
   * 把 timer 类"实例化"到某个模组对象上。
   * 【为什么不是全局单例】不同游戏各有自己的 timer，读的必须是**这一局**的值。
   *   调用方（runtime / worker）在 init 时传入一个取属性的函数，
   *   这里返回的实例每次读都问宿主，不会读到过期快照。
   */
  bindTimer(getAttrs, callMethod) {
    return this.timerClass.bind(getAttrs, callMethod);
  }

  /** 顶层：跑整段程序 */
  *run(ast) {
    yield* this.execBlock(ast.body, this.globals);
  }

  *execBlock(body, env) {
    for (const stmt of body) {
      yield* this.execStmt(stmt, env);
    }
  }

  *execStmt(node, env) {
    this.steps++;
    if (this.steps > this.maxSteps) {
      throw new PyError(`执行步数超过上限（${this.maxSteps}），疑似死循环`, node.line);
    }
    yield { type: 'step' };

    switch (node.type) {
      case 'Expr': {
        yield* this.evalExpr(node.value, env);
        return;
      }
      case 'Assign': {
        const value = yield* this.evalExpr(node.value, env);
        this.assign(node.target, value, env);
        return;
      }
      case 'AugAssign': {
        const cur = yield* this.evalExpr(node.target, env);
        const rhs = yield* this.evalExpr(node.value, env);
        const next = binop(node.op, cur, rhs);
        this.assign(node.target, next, env);
        return;
      }
      case 'If': {
        const test = yield* this.evalExpr(node.test, env);
        if (pyTruthy(test)) yield* this.execBlock(node.body, env);
        else if (node.orelse) yield* this.execBlock(node.orelse, env);
        return;
      }
      case 'While': {
        while (pyTruthy(yield* this.evalExpr(node.test, env))) {
          this.steps++;
          if (this.steps > this.maxSteps) {
            throw new PyError(`循环步数超过上限（${this.maxSteps}），疑似死循环`, node.line);
          }
          yield { type: 'step' };
          try {
            yield* this.execBlock(node.body, env);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }
      case 'For': {
        const iterable = yield* this.evalExpr(node.iter, env);
        const items = toIterable(iterable);
        for (const item of items) {
          this.steps++;
          if (this.steps > this.maxSteps) {
            throw new PyError(`循环步数超过上限（${this.maxSteps}），疑似死循环`, node.line);
          }
          yield { type: 'step' };
          this.assign(node.target, item, env);
          try {
            yield* this.execBlock(node.body, env);
          } catch (e) {
            if (e instanceof BreakSignal) break;
            if (e instanceof ContinueSignal) continue;
            throw e;
          }
        }
        return;
      }
      case 'Break': throw new BreakSignal();
      case 'Continue': throw new ContinueSignal();
      case 'Pass': return;
      case 'Return': {
        const v = node.value ? yield* this.evalExpr(node.value, env) : null;
        throw new ReturnSignal(v);
      }
      case 'Def': {
        const fn = new PyFunc(node.name, node.params, node.body, env);
        env.set(node.name, fn);
        return;
      }
      case 'Class': {
        const dict = new Map();
        const classEnv = new Env(env);
        for (const stmt of node.body) {
          if (stmt.type === 'Def') {
            dict.set(stmt.name, new PyFunc(stmt.name, stmt.params, stmt.body, classEnv));
          } else {
            yield* this.execStmt(stmt, classEnv);
            for (const [k, v] of classEnv.vars) dict.set(k, v);
          }
        }
        const bases = [];
        for (const b of node.bases) bases.push(yield* this.evalExpr(b, env));
        env.set(node.name, new PyClass(node.name, bases, dict));
        return;
      }
      case 'Import': {
        for (const { mod, alias } of node.names) {
          const m = this.modules.get(mod);
          if (m === undefined) {
            throw new PyError(`无法导入模块 "${mod}"。可用：${[...this.modules.keys()].join(', ')}`, node.line);
          }
          env.set(alias || mod, m);
        }
        return;
      }
      case 'FromImport': {
        const m = this.modules.get(node.mod);
        if (m === undefined) throw new PyError(`无法导入模块 "${node.mod}"`, node.line);
        for (const { name, alias } of node.names) {
          if (name === '*') {
            if (m instanceof PyModule) for (const [k, v] of m.dict) env.set(k, v);
            continue;
          }
          env.set(alias || name, m.get ? m.get(name) : m[name]);
        }
        return;
      }
      case 'Del': {
        if (node.target.type === 'Name') env.vars.delete(node.target.name);
        return;
      }
      case 'Global': {
        // 简化：global 声明的名字直接写到全局
        for (const n of node.names) {
          if (!this.globals.vars.has(n)) this.globals.vars.set(n, null);
        }
        return;
      }
      case 'Try': {
        try {
          yield* this.execBlock(node.body, env);
        } catch (e) {
          if (e instanceof BreakSignal || e instanceof ContinueSignal || e instanceof ReturnSignal) throw e;
          if (!node.handlers.length) throw e;
          // 只捕获 Python 层的错误；解释器内部错误（步数上限）不吞
          if (e instanceof PyError && /步数超过上限/.test(e.message)) throw e;
          const h = node.handlers[0];
          if (h.varName) env.set(h.varName, e);
          yield* this.execBlock(h.body, env);
        } finally {
          if (node.finalbody) yield* this.execBlock(node.finalbody, env);
        }
        return;
      }
      case 'With': {
        // 只做顺序执行：模组脚本用不到上下文管理器语义
        yield* this.execBlock(node.body, env);
        return;
      }
      case 'Raise': {
        const v = node.value ? yield* this.evalExpr(node.value, env) : null;
        throw new PyError(v ? pyStr(v) : 'raise', node.line);
      }
      default:
        throw new PyError(`不支持的语句类型 ${node.type}`, node.line);
    }
  }

  /** 赋值：支持 name / attr / index / 解构 */
  assign(target, value, env) {
    if (target.type === 'Name') {
      env.setExisting(target.name, value);
      return;
    }
    if (target.type === 'Attr') {
      const obj = this.evalExprSync(target.obj, env);
      this.setAttr(obj, target.name, value);
      return;
    }
    if (target.type === 'Index') {
      const obj = this.evalExprSync(target.obj, env);
      const idx = this.evalExprSync(target.index, env);
      if (obj instanceof Map) obj.set(idx, value);
      else if (Array.isArray(obj)) obj[idx] = value;
      return;
    }
    if (target.type === 'Tuple') {
      const items = toIterable(value);
      target.items.forEach((t, i) => this.assign(t, items[i], env));
      return;
    }
    throw new PyError('无法赋值的目标');
  }

  /**
   * 同步求值：只用于"赋值目标"这种不含调用副作用的场景。
   * 一旦里面出现 time.sleep 之类会 yield 的东西，这里会拿到 undefined —— 
   * 赋值目标不会写 sleep()，所以可以接受。
   */
  evalExprSync(node, env) {
    const gen = this.evalExpr(node, env);
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  }

  setAttr(obj, name, value) {
    if (obj instanceof ModObject) {
      obj.set(name, value);
      return;
    }
    if (obj instanceof PyInstance) {
      obj.set(name, value);
      return;
    }
    if (obj instanceof PyModule) {
      obj.dict.set(name, value);
      return;
    }
    if (obj && obj.isModProxy) {
      obj.set(name, value);
      return;
    }
    if (obj && typeof obj === 'object') {
      obj[name] = value;
      return;
    }
    throw new PyError(`无法给 ${pyStr(obj)} 设置属性`);
  }

  *evalExpr(node, env) {
    switch (node.type) {
      case 'Const': {
        if (node.fstring) return yield* this.evalFString(node.value, env);
        return node.value;
      }
      case 'Name': {
        return env.get(node.name);
      }
      case 'List': {
        const out = [];
        for (const it of node.items) out.push(yield* this.evalExpr(it, env));
        return out;
      }
      case 'Tuple': {
        const out = [];
        for (const it of node.items) out.push(yield* this.evalExpr(it, env));
        return out;
      }
      case 'Dict': {
        const m = new Map();
        for (const e of node.entries) {
          const k = yield* this.evalExpr(e.key, env);
          const v = yield* this.evalExpr(e.value, env);
          m.set(k, v);
        }
        return m;
      }
      case 'Attr': {
        const obj = yield* this.evalExpr(node.obj, env);
        return this.getAttr(obj, node.name, node.line);
      }
      case 'Index': {
        const obj = yield* this.evalExpr(node.obj, env);
        const idx = yield* this.evalExpr(node.index, env);
        if (obj instanceof Map) {
          if (!obj.has(idx)) throw new PyError(`字典没有键 ${pyStr(idx)}`, node.line);
          return obj.get(idx);
        }
        if (typeof obj === 'string') {
          const i = idx < 0 ? obj.length + idx : idx;
          return obj[i] ?? '';
        }
        if (Array.isArray(obj)) {
          const i = idx < 0 ? obj.length + idx : idx;
          if (i < 0 || i >= obj.length) throw new PyError('下标越界', node.line);
          return obj[i];
        }
        throw new PyError('该对象不支持下标访问', node.line);
      }
      case 'BinOp': {
        const l = yield* this.evalExpr(node.left, env);
        const r = yield* this.evalExpr(node.right, env);
        return binop(node.op, l, r);
      }
      case 'UnaryOp': {
        const v = yield* this.evalExpr(node.operand, env);
        if (node.op === 'not') return !pyTruthy(v);
        if (node.op === '-') return -v;
        return v;
      }
      case 'BoolOp': {
        const l = yield* this.evalExpr(node.left, env);
        if (node.op === 'and') return pyTruthy(l) ? yield* this.evalExpr(node.right, env) : l;
        return pyTruthy(l) ? l : yield* this.evalExpr(node.right, env);
      }
      case 'Compare': {
        const l = yield* this.evalExpr(node.left, env);
        const r = yield* this.evalExpr(node.right, env);
        return compare(node.op, l, r);
      }
      case 'IfExp': {
        const t = yield* this.evalExpr(node.test, env);
        return pyTruthy(t) ? yield* this.evalExpr(node.body, env) : yield* this.evalExpr(node.orelse, env);
      }
      case 'Lambda': {
        return new PyFunc('<lambda>', node.params, [{ type: 'Return', value: node.body }], env, true);
      }
      case 'Call': {
        return yield* this.evalCall(node, env);
      }
      default:
        throw new PyError(`不支持的表达式 ${node.type}`);
    }
  }

  *evalCall(node, env) {
    // 方法调用要在"对象"上解析，不能先取出函数再调用（会丢 self）
    let fn;
    let self = undefined;
    if (node.func.type === 'Attr') {
      const obj = yield* this.evalExpr(node.func.obj, env);
      fn = this.getAttr(obj, node.func.name, node.line);
      self = obj;
    } else {
      fn = yield* this.evalExpr(node.func, env);
    }

    const args = [];
    for (const a of node.args) args.push(yield* this.evalExpr(a, env));
    const kwargs = new Map();
    for (const kw of node.kwargs) kwargs.set(kw.name, yield* this.evalExpr(kw.value, env));

    // time.sleep 特殊处理：把等待交给驱动方，不阻塞
    if (fn && fn.__pySleep) {
      const secs = Number(args[0]) || 0;
      if (secs > 0) yield { type: 'sleep', ms: Math.min(secs * 1000, 60000) };
      return null;
    }

    // 模组方法
    if (fn && fn.__pyModMethod) {
      return fn(...args);
    }

    // Python 函数
    if (fn instanceof PyFunc) {
      return yield* this.callPyFunc(fn, args, kwargs);
    }

    // Python 类
    if (fn instanceof PyClass) {
      const inst = new PyInstance(fn);
      const init = fn.lookup('__init__');
      if (init instanceof PyFunc) {
        yield* this.callPyFunc(bindMethod(inst, init), args, kwargs);
      }
      return inst;
    }

    // JS 内置
    if (typeof fn === 'function') {
      return fn(...args);
    }

    // 未绑定的方法（PyInstance.get 已绑定，这里兜底）
    if (self && self.isPyInstance) {
      const m = self.get(node.func.name);
      if (m instanceof PyFunc) return yield* this.callPyFunc(m, args, kwargs);
    }

    throw new PyError(`"${node.func.name || '?'}" 不可调用`, node.line);
  }

  *callPyFunc(fn, args, kwargs) {
    const callEnv = new Env(fn.closure);
    let argIndex = 0;
    const bound = fn.boundSelf !== undefined;
    if (bound) callEnv.set('self', fn.boundSelf);
    for (let pi = 0; pi < fn.params.length; pi++) {
      const p = fn.params[pi];
      // 绑定的方法：第一个形参就是 self，已由 boundSelf 填好，不能再吃实参
      if (bound && pi === 0) continue;
      if (argIndex < args.length) {
        callEnv.set(p.name, args[argIndex++]);
      } else if (kwargs.has(p.name)) {
        callEnv.set(p.name, kwargs.get(p.name));
      } else if (p.def) {
        callEnv.set(p.name, yield* this.evalExpr(p.def, callEnv));
      } else {
        callEnv.set(p.name, null);
      }
    }
    try {
      yield* this.execBlock(fn.body, callEnv);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    }
    return null;
  }

  getAttr(obj, name, line) {
    // 内建类（timer）：它既是类又是实例，属性和方法都问宿主
    if (obj && obj.isNative) return obj.get(name);
    // 内建类实例：属性和方法都问宿主
    if (obj && obj.isNativeInstance) return obj.get(name);
    if (obj instanceof ModObject) return obj.get(name);
    if (obj && obj.isModProxy) return obj.get(name);
    if (obj instanceof PyInstance) {
      const v = obj.get(name);
      if (v === undefined) throw new PyError(`对象没有属性 "${name}"`, line);
      return v;
    }
    if (obj instanceof PyClass) {
      const v = obj.lookup(name);
      if (v === undefined) throw new PyError(`类没有属性 "${name}"`, line);
      return v;
    }
    if (obj instanceof PyModule) {
      if (!obj.dict.has(name)) throw new PyError(`模块 ${obj.name} 没有 "${name}"`, line);
      return obj.dict.get(name);
    }
    if (typeof obj === 'string') {
      if (name === 'upper') return () => obj.toUpperCase();
      if (name === 'lower') return () => obj.toLowerCase();
      if (name === 'strip') return () => obj.trim();
      if (name === 'split') return (sep) => (sep ? obj.split(sep) : obj.split(/\s+/));
      if (name === 'replace') return (a, b) => obj.split(a).join(b);
      if (name === 'join') return (arr) => Array.from(arr).join(obj);
      if (name === 'startswith') return (p) => obj.startsWith(p);
      if (name === 'endswith') return (p) => obj.endsWith(p);
      if (name === 'find') return (p) => obj.indexOf(p);
      throw new PyError(`字符串没有方法 "${name}"`, line);
    }
    if (Array.isArray(obj)) {
      if (name === 'append') return (v) => { obj.push(v); return null; };
      if (name === 'pop') return (i) => (i === undefined ? obj.pop() : obj.splice(i, 1)[0]);
      if (name === 'remove') return (v) => { const i = obj.indexOf(v); if (i >= 0) obj.splice(i, 1); return null; };
      if (name === 'index') return (v) => obj.indexOf(v);
      if (name === 'count') return (v) => obj.filter((x) => x === v).length;
      if (name === 'sort') return () => { obj.sort(); return null; };
      if (name === 'reverse') return () => { obj.reverse(); return null; };
      if (name === 'extend') return (a) => { obj.push(...a); return null; };
      if (name === 'clear') return () => { obj.length = 0; return null; };
      if (name === 'insert') return (i, v) => { obj.splice(i, 0, v); return null; };
      if (name === 'copy') return () => obj.slice();
      throw new PyError(`列表没有方法 "${name}"`, line);
    }
    if (obj instanceof Map) {
      if (name === 'get') return (k, d = null) => (obj.has(k) ? obj.get(k) : d);
      if (name === 'keys') return () => [...obj.keys()];
      if (name === 'values') return () => [...obj.values()];
      if (name === 'items') return () => [...obj.entries()];
      if (name === 'update') return (m) => { for (const [k, v] of m) obj.set(k, v); return null; };
      if (name === 'pop') return (k) => obj.delete(k);
      if (name === 'clear') return () => { obj.clear(); return null; };
      if (name === 'copy') return () => new Map(obj);
      throw new PyError(`字典没有方法 "${name}"`, line);
    }
    if (typeof obj === 'number') {
      if (name === '__class__') return 'number';
      throw new PyError(`数字没有属性 "${name}"`, line);
    }
    if (obj === null || obj === undefined) throw new PyError(`None 没有属性 "${name}"`, line);
    // 普通对象（模组镜像的降级路径）
    if (typeof obj === 'object' && name in obj) return obj[name];
    throw new PyError(`对象没有属性 "${name}"`, line);
  }

  /** f-string：把 {expr} 替换成求值结果 */
  *evalFString(raw, env) {
    let out = '';
    let i = 0;
    while (i < raw.length) {
      if (raw[i] === '{' && raw[i + 1] === '{') {
        out += '{';
        i += 2;
        continue;
      }
      if (raw[i] === '}' && raw[i + 1] === '}') {
        out += '}';
        i += 2;
        continue;
      }
      if (raw[i] === '{') {
        let depth = 1;
        let j = i + 1;
        while (j < raw.length && depth > 0) {
          if (raw[j] === '{') depth++;
          else if (raw[j] === '}') depth--;
          j++;
        }
        const exprSrc = raw.slice(i + 1, j - 1).split('!')[0].split(':')[0];
        try {
          const ast = parse(exprSrc);
          const stmt = ast.body[0];
          if (stmt && stmt.type === 'Expr') {
            const v = yield* this.evalExpr(stmt.value, env);
            out += pyStr(v);
          }
        } catch {
          out += '{' + exprSrc + '}';
        }
        i = j;
        continue;
      }
      out += raw[i++];
    }
    return out;
  }
}

// ---------------- 运算 ----------------
function binop(op, l, r) {
  switch (op) {
    case '+':
      if (typeof l === 'string' || typeof r === 'string') {
        if (Array.isArray(l) && Array.isArray(r)) return l.concat(r);
        return pyStr(l) + pyStr(r);
      }
      if (Array.isArray(l) && Array.isArray(r)) return l.concat(r);
      return l + r;
    case '-': return l - r;
    case '*':
      if (typeof l === 'string' && typeof r === 'number') return l.repeat(Math.max(0, r));
      if (Array.isArray(l) && typeof r === 'number') {
        const out = [];
        for (let i = 0; i < r; i++) out.push(...l);
        return out;
      }
      return l * r;
    case '/':
      if (r === 0) throw new PyError('除以零');
      return l / r;
    case '//':
      if (r === 0) throw new PyError('除以零');
      return Math.floor(l / r);
    case '%':
      if (r === 0) throw new PyError('取模零');
      return ((l % r) + r) % r;
    case '**': return Math.pow(l, r);
    default: throw new PyError(`未知运算符 ${op}`);
  }
}

function compare(op, l, r) {
  switch (op) {
    case '==': return deepEq(l, r);
    case '!=': return !deepEq(l, r);
    case '<': return l < r;
    case '<=': return l <= r;
    case '>': return l > r;
    case '>=': return l >= r;
    case 'in':
      if (typeof r === 'string') return r.includes(l);
      if (Array.isArray(r)) return r.some((x) => deepEq(x, l));
      if (r instanceof Map) return r.has(l);
      return false;
    case 'not in': return !compare('in', l, r);
    case 'is': return l === r;
    case 'is not': return l !== r;
    default: throw new PyError(`未知比较符 ${op}`);
  }
}

function deepEq(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEq(x, b[i]));
  }
  return false;
}

function toIterable(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split('');
  if (v instanceof Map) return [...v.keys()];
  if (v && v.isPyInstance && v.cls.name === 'range') return [];
  throw new PyError(`${pyStr(v)} 不可迭代`);
}

export { parse, PyError };
