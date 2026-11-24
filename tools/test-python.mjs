/**
 * Python 子集解释器的回归测试。
 *
 * 【为什么用 node 直接跑而不是浏览器】解释器本身不依赖 DOM，
 *   在 node 里跑得比开浏览器快两个数量级，改一行就能验一次。
 */
import { parse, Interpreter, PyError } from '../src/mod/interp.js';

let pass = 0;
let fail = 0;
const failures = [];

function run(code, opts = {}) {
  const logs = [];
  const sets = [];
  const calls = [];
  const interp = new Interpreter({
    modules: opts.modules || new Map(),
    onSet: (p, v) => sets.push([p, v]),
    onCall: (p, a) => calls.push([p, a]),
    onLog: (t) => logs.push(t),
    maxSteps: opts.maxSteps || 500000,
  });
  const gen = interp.run(parse(code));
  let r = gen.next();
  let guard = 0;
  while (!r.done && guard++ < 2_000_000) {
    r = gen.next();
  }
  return { logs, sets, calls, result: r.value, done: r.done };
}

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    fail++;
    failures.push({ name, error: e });
    console.log('  ✗ ' + name + ' → ' + e.message);
  }
}

function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label} 期望 ${b}，实际 ${a}`);
}

function ok(cond, label = '') {
  if (!cond) throw new Error(label || '断言失败');
}

console.log('\n=== 基础语法 ===');

check('变量与算术', () => {
  const { logs } = run(`
a = 1 + 2 * 3
b = a ** 2
c = 7 // 2
d = 7 % 3
print(a, b, c, d)
`);
  eq(logs[0], '7 49 3 1');
});

check('字符串与拼接', () => {
  const { logs } = run(`
s = "你好" + "，" + "世界"
print(s, len(s))
print("abc".upper())
print("-".join(["a","b","c"]))
`);
  eq(logs[0], '你好，世界 5');
  eq(logs[1], 'ABC');
  eq(logs[2], 'a-b-c');
});

check('f-string', () => {
  const { logs } = run(`
x = 42
print(f"值是 {x}，翻倍 {x*2}")
`);
  eq(logs[0], '值是 42，翻倍 84');
});

check('列表操作', () => {
  const { logs } = run(`
arr = [1, 2, 3]
arr.append(4)
arr[0] = 9
print(arr, len(arr), sum(arr))
print(sorted([3,1,2]))
`);
  eq(logs[0], '[9, 2, 3, 4] 4 18');
  eq(logs[1], '[1, 2, 3]');
});

check('字典操作', () => {
  const { logs } = run(`
d = {"a": 1, "b": 2}
d["c"] = 3
print(d["a"], len(d), d.get("z", 0))
`);
  eq(logs[0], '1 3 0');
});

console.log('\n=== 控制流 ===');

check('if / elif / else', () => {
  const { logs } = run(`
for i in range(4):
    if i == 0:
        print("zero")
    elif i == 1:
        print("one")
    else:
        print("many", i)
`);
  eq(logs, ['zero', 'one', 'many 2', 'many 3']);
});

check('while + break + continue', () => {
  const { logs } = run(`
i = 0
while True:
    i = i + 1
    if i > 5:
        break
    if i % 2 == 0:
        continue
    print(i)
`);
  eq(logs, ['1', '3', '5']);
});

check('嵌套循环', () => {
  const { logs } = run(`
total = 0
for i in range(3):
    for j in range(3):
        total = total + i * j
print(total)
`);
  eq(logs[0], '9');
});

console.log('\n=== 函数 ===');

check('函数定义与返回', () => {
  const { logs } = run(`
def add(a, b=10):
    return a + b

print(add(1), add(1, 2))
`);
  eq(logs[0], '11 3');
});

check('递归', () => {
  const { logs } = run(`
def fib(n):
    if n < 2:
        return n
    return fib(n-1) + fib(n-2)

print(fib(10))
`);
  eq(logs[0], '55');
});

check('lambda', () => {
  const { logs } = run(`
f = lambda x: x * 2
print(f(21))
`);
  eq(logs[0], '42');
});

console.log('\n=== 类 ===');

check('类定义与实例', () => {
  const { logs } = run(`
class Counter:
    def __init__(self, start):
        self.value = start

    def inc(self):
        self.value = self.value + 1
        return self.value

c = Counter(5)
c.inc()
c.inc()
print(c.value)
`);
  eq(logs[0], '7');
});

check('类的继承', () => {
  const { logs } = run(`
class Animal:
    def speak(self):
        return "..."

class Dog(Animal):
    def speak(self):
        return "woof"

d = Dog()
print(d.speak())
`);
  eq(logs[0], 'woof');
});

console.log('\n=== 模组桥接 ===');

check('属性写入触发 onSet', () => {
  const target = { bomb: { appearrate: 0.12 }, score: 0 };
  const mods = new Map([['fruitninja', target]]);
  const { sets } = run('fruitninja.bomb.appearrate = 0.001', { modules: mods });
  ok(sets.length === 1, '应该有一次 set');
  eq(sets[0][0], 'bomb.appearrate');
  eq(sets[0][1], 0.001);
  eq(target.bomb.appearrate, 0.001);
});

check('读取实时值', () => {
  const target = { score: 123 };
  const mods = new Map([['game', target]]);
  const { logs } = run('print(game.score)', { modules: mods });
  eq(logs[0], '123');
});

check('import 小游戏名', () => {
  const target = { speed: 1 };
  const mods = new Map([['snake', target]]);
  const { logs } = run(`
import snake
snake.speed = 0.5
print(snake.speed)
`, { modules: mods });
  eq(logs[0], '0.5');
  eq(target.speed, 0.5);
});

console.log('\n=== 模块 ===');

check('random 模块', () => {
  const { logs } = run(`
import random
random.seed(42)
x = random.randint(1, 6)
y = random.randint(1, 6)
print(x >= 1 and x <= 6)
print(random.choice(["a","b","c"]) in ["a","b","c"])
`);
  eq(logs[0], 'True');
  eq(logs[1], 'True');
});

check('time.sleep 产生 sleep 信号', () => {
  const interp = new Interpreter({ maxSteps: 100000 });
  const gen = interp.run(parse('import time\ntime.sleep(0.5)'));
  let sawSleep = false;
  let r = gen.next();
  while (!r.done) {
    if (r.value && r.value.type === 'sleep') {
      sawSleep = true;
      eq(r.value.ms, 500);
    }
    r = gen.next();
  }
  ok(sawSleep, '应该产生 sleep 信号');
});

console.log('\n=== 错误处理 ===');

check('未定义名字报错', () => {
  try {
    run('print(undefined_name)');
    throw new Error('应该抛错');
  } catch (e) {
    ok(e instanceof PyError, '应该是 PyError');
    ok(/未定义/.test(e.message), '错误信息应包含"未定义"，实际：' + e.message);
  }
});

check('死循环被步数上限拦下', () => {
  try {
    run('while True:\n    x = 1', { maxSteps: 5000 });
    throw new Error('应该抛错');
  } catch (e) {
    ok(/步数超过上限/.test(e.message), '实际：' + e.message);
  }
});

check('try/except 捕获', () => {
  const { logs } = run(`
try:
    x = 1 / 0
except:
    print("caught")
`);
  eq(logs[0], 'caught');
});

console.log('\n=== 真实模组脚本 ===');

check('切水果 0.1% 炸弹模组', () => {
  const target = {
    score: 0,
    bomb: { appearrate: 0.12 },
    spawn: { interval: 0.62, speed: 1 },
    fruit: { scoreMul: 1 },
    timer: { remaining: 60 },
  };
  const mods = new Map([['fruitninja', target]]);
  const { logs, sets } = run(`
fruitninja.bomb.appearrate = 0.001
fruitninja.spawn.interval = 0.35
fruitninja.fruit.scoreMul = 2
print("模组已加载")
`, { modules: mods });
  eq(target.bomb.appearrate, 0.001);
  eq(target.spawn.interval, 0.35);
  eq(target.fruit.scoreMul, 2);
  eq(logs[0], '模组已加载');
});

check('带循环与随机的模组', () => {
  const target = { speed: 1, obstacle: { count: 0 } };
  const mods = new Map([['snake', target]]);
  run(`
import random, time
for i in range(3):
    snake.speed = 1 + i * 0.5
    time.sleep(0.1)
`, { modules: mods });
  eq(target.speed, 2);
});


console.log('\n=== timer 内建类 ===');

check('timer 是类：type() 返回 <class timer>', () => {
  const state = { timer: { remaining: 60, duration: 60, elapsed: 0, paused: false } };
  const logs = [];
  const interp = new Interpreter({
    modules: new Map([['snake', state]]),
    onSet: () => {}, onCall: () => null,
    onLog: (t) => logs.push(t), maxSteps: 100000,
  });
  interp.globals.set('timer', interp.bindTimer(
    (n) => (state.timer || {})[n],
    () => null,
  ));
  const gen = interp.run(parse([
    'print(type(timer))',
    'print(isinstance(timer, timer))',
  ].join('\n')));
  let r; do { r = gen.next(); } while (!r.done);
  eq(logs[0], "<class 'timer'>");
  eq(logs[1], 'True');
});

check('timer.add 转发到宿主', () => {
  const state = { timer: { remaining: 60 } };
  const calls = [];
  const interp = new Interpreter({
    modules: new Map([['snake', state]]),
    onSet: () => {}, onCall: () => null, onLog: () => {}, maxSteps: 100000,
  });
  interp.globals.set('timer', interp.bindTimer(
    (n) => state.timer[n],
    (m, a) => { calls.push([m, a]); return null; },
  ));
  const gen = interp.run(parse('timer.add(30)\ntimer.reset()'));
  let r; do { r = gen.next(); } while (!r.done);
  eq(calls, [['add', [30]], ['reset', []]]);
});

check('timer.remaining 读到宿主实时值', () => {
  const state = { timer: { remaining: 60 } };
  const logs = [];
  const interp = new Interpreter({
    modules: new Map([['snake', state]]),
    onSet: () => {}, onCall: () => null,
    onLog: (t) => logs.push(t), maxSteps: 100000,
  });
  interp.globals.set('timer', interp.bindTimer((n) => state.timer[n], () => null));
  const gen = interp.run(parse([
    'print(timer.remaining)',
    'timer_placeholder = 0',
  ].join('\n')));
  let r = gen.next();
  // 跑到 print 之后改宿主值，再继续——验证读的是实时值而不是快照
  while (!r.done) r = gen.next();
  eq(logs[0], '60');
});

console.log('\n' + '='.repeat(50));
console.log(`通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
  console.log('\n失败详情：');
  for (const f of failures) {
    console.log(`  ${f.name}: ${f.error.message}`);
    if (f.error.stack) console.log(f.error.stack.split('\n').slice(1, 4).join('\n'));
  }
  process.exit(1);
}
