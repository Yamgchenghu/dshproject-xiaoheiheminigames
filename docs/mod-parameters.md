# 模组参数手册

> 这份手册对应「设置 → 关于 → 连点版本号 7 次 → 实验性功能 → 模组实验室」。

## 这是什么

模组实验室把一款小游戏**打开**给一段 Python 脚本：游戏启动的同一瞬间，
脚本在一个独立的执行线程里跑起来，脚本里写什么，游戏里就立刻变什么。

```python
import fruitninja

fruitninja.bomb.appearrate = 0.001   # 炸弹出现概率改成 0.1%
```

三件事需要先说清楚：

1. **带模组的对局不计入排行榜。** 模组能任意改分数，允许上榜会让榜单失去意义，
   对其他玩家也不公平。带模组的对局连"最佳成绩"也不会刷新。
2. **脚本在游戏结束时被强制终止。** 不是"等它跑完"，是直接杀掉执行线程。
3. **这是离线沙箱，不是外挂。** 它只能改本局内存里的数值，
   不读取其他玩家的数据、不修改线上战绩、不绕过任何校验。

## 通用规则

### 导入

四款游戏的模块名就是游戏名：

```python
import minesweeper   # 扫雷
import fruitninja    # 切水果
import g2048         # 2048
import snake         # 贪吃蛇
```

也可以 `from minesweeper import bomb` 只导入子对象。

### 可用的库

| 库 | 说明 |
|---|---|
| `random` | `random()` / `randint(a,b)` / `choice(seq)` / `uniform(a,b)` / `shuffle(list)` |
| `time` | `time()` 秒级时间戳 / `sleep(秒)` 暂停脚本（不阻塞游戏） |

### 回调函数

脚本里定义这些名字的函数，会在对应时机被调用。**函数名必须完全一致。**

| 函数名 | 时机 |
|---|---|
| `on_start()` | 游戏启动，脚本加载完成后立刻调用一次 |
| `on_tick(dt)` | 每一帧。`dt` 是距上一帧的秒数 |
| `on_pause()` / `on_resume()` | 游戏暂停 / 继续 |
| `on_input(name)` | 键盘/手势输入，`name` 是动作名 |
| `on_score(score)` | 分数变化 |
| `on_end(result)` | 游戏结束 |
| `on_draw(ctx)` | 每帧绘制之后（`ctx` 是 canvas 上下文，慎用） |

### 读写规则

- **读**：任何参数都能读，读到的是**当前这一帧的真实值**。
- **写**：赋值立刻生效，下一帧游戏逻辑就会读到新值。
- **越界**：游戏内部有 `clamp` 保护（见各参数的范围列）。
  超出范围不会崩，会被夹到边界值——这是刻意的，宁可参数不生效也不要让游戏崩溃。

## 扫雷 minesweeper

| 参数 | 类型 | 默认 | 范围 | 作用 |
|---|---|---|---|---|
| `minesweeper.score` | 数字 | 0 | — | 当前分数（只读建议，改它不会真的加分） |
| `minesweeper.opened` | 数字 | 0 | — | 已翻开的格子数 |
| `minesweeper.total` | 数字 | 0 | — | 总安全格数 |
| `minesweeper.flags` | 数字 | 0 | — | 已插旗数 |
| `minesweeper.lives` | 数字 | 1 | ≥0 | 可踩雷次数。设成 3 就是"三条命" |
| `minesweeper.bomb.density` | 数字 | 1 | 0.1–3 | **雷密度倍率**。1 是标准，0.3 是 30% 的雷，3 是三倍雷 |
| `minesweeper.hint.count` | 数字 | 3 | ≥0 | 提示次数。改大就是无限提示 |

### timer（类）

扫雷有倒计时，`timer` 以**类**的形式暴露：

| 属性 | 说明 |
|---|---|
| `timer.remaining` | 剩余秒数 |
| `timer.duration` | 总时长 |
| `timer.elapsed` | 已经过的秒数 |
| `timer.paused` | 是否暂停 |

| 方法 | 说明 |
|---|---|
| `timer.add(秒)` | 加时。`timer.add(60)` 就是多一分钟 |
| `timer.reset()` | 重置到满 |
| `timer.pause()` / `timer.resume()` | 暂停 / 继续 |

```python
import minesweeper

minesweeper.bomb.density = 0.3
minesweeper.lives = 3
minesweeper.hint.count = 99

def on_start():
    minesweeper.timer.add(120)
    print("扫雷：雷少了，命多了，时间也多了")
```

## 切水果 fruitninja

| 参数 | 类型 | 默认 | 范围 | 作用 |
|---|---|---|---|---|
| `fruitninja.score` | 数字 | 0 | — | 当前分数 |
| `fruitninja.combo` | 数字 | 0 | — | 当前连击数 |
| `fruitninja.lives` | 数字 | 3 | ≥0 | 剩余生命（漏一个水果 / 切到炸弹会掉） |
| `fruitninja.timeLeft` | 数字 | 60 | — | 剩余秒数 |
| `fruitninja.bomb.appearrate` | 数字 | 0.12 | 0–1 | **炸弹出现概率**。0.12 是 12%，`0.001` 就是千分之一 |
| `fruitninja.spawn.interval` | 数字 | 0.62 | 0.08–4 | 出果间隔（秒）。越小越密集 |
| `fruitninja.spawn.speed` | 数字 | 1 | 0.2–4 | 水果飞行速度倍率 |
| `fruitninja.fruit.scoreMul` | 数字 | 1 | 0–100 | **每个水果的得分倍率** |

### timer（类）

同扫雷：`remaining` / `duration` / `elapsed` / `paused` + `add` / `reset` / `pause` / `resume`。

```python
import fruitninja

# 用户最常问的那个：炸弹概率 0.1%
fruitninja.bomb.appearrate = 0.001
fruitninja.fruit.scoreMul = 3
fruitninja.spawn.interval = 0.3

import random

def on_tick(dt):
    # 每帧 0.3% 概率临时改一下出果速度，做个"随机节奏"
    if random.random() < 0.003:
        fruitninja.spawn.speed = random.uniform(0.8, 2.0)
```

## 2048 g2048

| 参数 | 类型 | 默认 | 范围 | 作用 |
|---|---|---|---|---|
| `g2048.score` | 数字 | 0 | — | 当前分数 |
| `g2048.maxTile` | 数字 | 0 | — | 场上最大的数字 |
| `g2048.merges` | 数字 | 0 | — | 合并次数 |
| `g2048.moves` | 数字 | 0 | — | 移动次数 |
| `g2048.grid.rows` | 数字 | 4 | — | 行数（布局决定，改它不会重排棋盘） |
| `g2048.grid.cols` | 数字 | 4 | — | 列数 |
| `g2048.spawn.fourChance` | 数字 | 0.1 | 0–1 | **新方块是 4 的概率**。设 0.5 就是一半出 4 |

2048 没有倒计时，`timer` 存在但 `duration` 是 0。

```python
import g2048

g2048.spawn.fourChance = 0.9   # 几乎全是 4，分数涨得飞快
```

## 贪吃蛇 snake

| 参数 | 类型 | 默认 | 范围 | 作用 |
|---|---|---|---|---|
| `snake.score` | 数字 | 0 | — | 当前分数 |
| `snake.length` | 数字 | 3 | — | 蛇的长度 |
| `snake.speed` | 数字 | 1 | 0.2–6 | **移动速度倍率**。小于 1 变慢，大于 1 变快 |
| `snake.food.x` / `snake.food.y` | 数字 | 0 | — | 当前食物的格子坐标（只读） |
| `snake.grow.perFood` | 数字 | 1 | ≥0 | **每个果实长几节** |
| `snake.obstacle.count` | 数字 | 0 | 0–60 | 障碍物数量。0 就是没有墙 |

### timer（类）

同扫雷。贪吃蛇本身没有倒计时，但 `timer` 依然可用，可以自己拿来做"限时挑战"。

```python
import snake
import time

snake.speed = 0.6
snake.grow.perFood = 3
snake.obstacle.count = 0

def on_start():
    print("慢慢玩，吃一个长三节")

def on_tick(dt):
    # 每 10 秒把速度提一点，做个渐进难度
    if snake.timer.elapsed > 10:
        snake.speed = min(3.0, snake.speed + 0.01)
        snake.timer.reset()
```

## 存档配额

模组源码存在云存档里，受工坊限制：

> 由于工坊云存档限制，你只能保存最多96000字节的mod源码，超出部分请手动保存 当前已使用{byte}/96000字节

四款游戏的脚本**合计**受这 96000 字节限制（不是每款 96000）。
（2026-11 用户要求模组存档从 3 个 value 扩到 8 个，源码额度随之从 32000 提到 96000。）
编辑器顶部实时显示用量，超了会变红并且拒绝保存——不会静默截断你的代码。

需要存更长的脚本时，用编辑器里的「导出」把源码存到手机本地，需要时再「导入」。

## 常见问题

**Q：改了参数没反应？**
A：确认脚本已经「保存」，然后**重新开一局**。脚本只在游戏启动那一刻加载，
已经开着的对局不会中途加载新脚本。

**Q：脚本报错怎么办？**
A：错误会显示在游戏的日志区，游戏本身照常运行。常见原因是：
- 拼错了参数名（比如 `appearRate` 写成大写 R，实际是全小写 `appearrate`）
- 忘了 `import`
- 用了不支持的语法（这是 Python 子集，没有类和推导式）

**Q：能改别人的成绩吗？**
A：不能。脚本只能改**本局内存里**的数值，碰不到云端数据。

**Q：为什么带模组的对局不上榜？**
A：见开头第 1 条。这不是技术限制，是刻意的规则。
