# 东海龙珠 · 本地改动清单

> **这个文件的存在意义**：东海龙珠是从外部源码包移植进来的。
> 每次上游发新版本（v1.2.5 → v1.2.7 → …），都要把改动搬进来。
> 如果直接拿新包覆盖 `src/tools/donghai/game.js`，**下面这些改动会全部丢失**，
> 而且不会报错——只是分数、尺寸、手感悄悄变回上游的样子。
>
> 所以：**新包体永远不要整文件覆盖，只逐条比对差异。**

## 更新上游时的正确做法

```bash
# 1. 解压新包到临时目录
# 2. 逐文件 diff（不要覆盖）
diff 旧包/web/game.js 新包/web/game.js
# 3. 只把"上游新改的"逐条搬进来
# 4. 搬完跑测试，并检查本文件的每一条是否还在
node tools/test-donghai.mjs
node tools/check-donghai-fork.mjs
```

`check-donghai-fork.mjs` 会自动校验下面每一条改动是否还生效。
**它失败了就说明有改动被覆盖了。**

---

## 与上游有意不同的地方

### 1. 蓝色大龙珠尺寸（上游 v1.2.7 起）

| | 值 | 实际半径 |
|---|---|---|
| 上游 v1.2.5 | `Math.cbrt(0.7)` | 0.3339 |
| 上游 v1.2.7 | `Math.cbrt(0.7 * 0.85)` | 0.3162（只小 5.27%） |
| **本移植** | `Math.cbrt(0.7) * 0.85` | **0.2838（小 15%）** |

**为什么不同**：上游把 `0.85` 乘在 `cbrt` 里面，等于体积 ×0.85，半径只缩 5.27%，
肉眼几乎看不出。而这条改动要解决的是"大龙珠太占地方、把后面的珠子顶开"，
5% 完全不够。改到线性 15% 才真的看得出变小。

### 2. 大龙珠质量（上游从来没改过）

```js
BODY_M.bigDragon = 4.224 * BIG_VOL   // BIG_VOL = 0.85³
```

**为什么加**：上游 `BODY_M.bigDragon` 是写死的 4.224（= 2.64 × 1.6），
跟 `BIG_SIZE` 无关。上游把大龙珠改小之后，它变轻了却没变更"软"——
体积小了、质量不变，撞起来像铅球。这里按体积缩放（质量 ∝ 半径³）。

### 3. 龙珠入盘初速显式 ×3（上游靠写死数字）

```js
const PEARL_SPEED = 1.35;
const DRAGON_SPEED_MUL = 3;
```

**为什么不同**：上游写死 `3.45`，相对珍珠 1.35 只有 2.56 倍，
和 README 宣称的 ×3 对不上。改成显式倍数，改基准只动一处。

### 4. 非法灯组保护（上游会崩）

```js
if (!state.lamps[row]) return;   // selectRow / cycleTarget
```

**为什么加**：`state.lamps` 只有 `pearl`/`ticket` 两组，龙珠槽没有灯组。
上游 `selectRow('dragon')` 会 `TypeError` 崩掉整个页面。
上游只在内部调用、传的都是合法值所以没暴露，但外部传入就会炸。

### 5. 计分与挑战系统（上游完全没有）

`scoring.js` / `stats.js` / `screen.js` 全是本移植新增：
每币平均彩票、基准 45/8、每日限额、每日 3 次、周榜。

### 6. 结算流程（上游没有）

上游是无尽模式的街机，没有"一局结束"。结算按钮、`doSettle`、`resetRound` 都是新增。

---

### 7. 看板娘图片用 Vite 导入（上游是写死相对路径）

```js
import mascotUrl from './mascot.png?url';
root.innerHTML = TEMPLATE.replace('__MASCOT__', mascotUrl);
```

**为什么改**：上游 `<img src="./mascot.png">` 是相对路径，会相对**当前页面**解析。
页面在根目录、图片在子目录 → 404，浏览器就把 `alt="看板娘"` 文字显示出来，
看着像界面坏了。用 `?url` 让 Vite 算好路径。

**踩过的坑**：图片**不能放 public/**。public 下的文件是原样拷贝、不参与路径处理，
从 public 导入 `?url` 会得到 `/public/donghai/mascot.png` 这种不存在的地址。

### 8. 珠子放大到 6.2px 并加拖尾（上游 4.4px）

**为什么改**：390px 屏上 4.4px 基本是个小点，整段下落只有 0.3~0.4 秒。
玩家点完发射看到"闪了一下就没了"，会以为游戏卡住。
放大 + 沿速度反方向画 3 个渐隐小圆，落点就看得见了。

### 9. 开始界面「参加周榜」按钮（上游没有）

上游没有周榜。按钮放在「开始游戏」右侧，点开挑战面板，
让玩家先看今日限额、剩余次数和榜上水平，再决定要不要开始。

---

## 与上游一致、但容易被误改的地方

这些**不是**本地改动，是上游行为，改上游时**要跟着上游走**：

- 奖励珠出生点用 `L.pusher.retreat`（上游 v1.2.7 起，固定不跟推板）
- 奖励龙珠 `vx: -0.25 * 3, vz: rr(0.06, 0.18) * 3`（上游 v1.2.7 起，两轴都 ×3）
- 落球偏灯加权 `weight = unlit + 0.5`（上游 v1.2.5 已有）
- 只有吐出出票口的纸票才计入彩票（上游 v1.2.5 已有）

## 移植时改过、但语义不变的地方

- `$` → `id => rootEl.querySelector('#' + id)`（容器内查询）
- `resize` 量容器尺寸而非 window
- `el` / `canvas` / `ctx` 改为 mount 时绑定
- 事件监听包进 `bindEvents()`，`eventsBound` 防重复
- `window.game` → `const API`，导出 `mount`/`unmount`

**这些是移植必需，不是设计改动。**

## 10. 全屏：外壳 HUD 让位（1.3.9）

推币机的 `.dh-root` 原来是 `position:absolute;inset:0`，**不是 fixed**。
其他全屏页（`.game-screen` / `.wheel-screen` / `.shishan-screen`）都是 fixed，会盖住外壳；
推币机没有，于是外壳的 `.topbar`（品牌 + 设置）和 `.tabbar` 直接露在机台上面 —— 
这就是玩家说的「小黑盒应用的 UI 和推币机 UI 混在一起」。

改成两层：

1. `.dh-root` 用 `position:fixed; z-index:500`，真正脱离外壳的层叠上下文；
2. 打开时给 `body` 加 `.is-immersive`，`src/styles.css` 里让 `.topbar` / `.tabbar` 让位。

**为什么用 body class 而不是 `setImmersive()`**：`src/ui/app.js` 里确实有 `setImmersive()`，
但它只在 `createApp` 内部可见，`main.js` 丢掉了返回值，全屏页拿不到。
body class 是「谁开全屏谁负责」，不用改调用链。

## 11. 右上角一个键都不留（1.3.9）

宿主 SDK 的 `viewport.getWindowInfo()` **只给 `statusBarHeight`，不给胶囊的 left/top/width/height**。
算不出一块「确定不压胶囊」的区域，唯一稳妥的做法是右上角彻底留空。

- 退出键 → 机台底部操作区，「消耗币数」左边（`.exit-btn`）
- 设置键 → 底部 utils 行（`#dhSet`）
- `--safe-t` 改成 `var(--safe-top, env(safe-area-inset-top, 0px))`，优先用宿主给的真实状态栏高度

**为什么 `--safe-t` 原来恒为 0**：小程序跑在宿主 iframe 里，`env(safe-area-inset-*)` 拿到的是 0。
宿主高度由 `applySafeArea()` 写进 `--safe-top`（实测 84px），推币机原来没用它。

## 12. 退出 / 重进的三个真实 bug（1.3.9）

这三个都是「退出再进来」才暴露的，单局内测不出来：

### 12.1 `donghaiBack()` 的退出条件写反了

```js
// 错：开始界面时退出不生效，游戏中退出被吞掉
if (donghaiBack && !donghaiBack()) return;
// 对
if (donghaiBack && donghaiBack()) return;
```

`donghaiBack()` 的语义是「这次返回被我消费掉了」（关帮助弹窗 / 停在开始界面），
返回 true 表示**不要退出**。写反的后果：游戏中退出被吞 → `unmount()` 不执行 → 
`state.started` 残留 true → 下次进来开始界面不出现。

### 12.2 `unmount()` 没清模块级 state

`state` 是模块级的，退出机台只停 raf。`started` 还是 true，
`startGame()` 里 `startScreen.classList.add('hidden')` 早就加过了，开始界面永远不出现。

### 12.3 `mount()` 没有返回值

写成 `api = mount(root)`，`api` 永远是 `undefined`，
自动存档的 `if (!api) return` 每次都提前返回 —— 挑战进度一直写不进去。改用 `mounted` 布尔量。

## 13. 挑战局进度单独存档（save_42）

`save_41` 只记「每日次数 / 本周分」，是跨局累加的统计。
挑战局还有「这局投了几币、剩多少额度」，玩家中途退出去看榜再回来必须能接上。
混进 `save_41` 会让那份统计的语义变脏，所以单独占 `save_42`（`donghai.run`）。

自动存档每 3 秒一次 + 退出时强制存一次，最坏丢 3 秒进度。
**盘面珠子不恢复** —— 那是纯视觉的，重开时物理重落一遍就行；
真正影响公平的是「这一局已经投掉多少额度」。

## 14. 八段管显示剩余弹珠数（1.3.9）

挑战局有币数上限（50/80/100/120），玩家关心的是「还能投几颗」，不是「已经投了几颗」。
所以挑战局左上角显示 `coinLimit - coinsSpent`，标签「剩余弹珠」；
普通局无上限，剩余数没有意义，仍显示已用币。

## 15. 两组 3 位七段管必须同一水平线（1.4.1）

机台顶部有两组 3 位七段管：左边「已用币 / 剩余弹珠」，右边「剩余彩票」。

**踩过的坑**：左边那组为了避开上方两层 DOM（`#status` 卡片、`#colorRow` 颜色行）
被下移过，右边那组还写死在 `gy + 8`，于是两组错开一格 —— 看着就是没对齐的坏 UI。

现在两组共用同一个 `tubeY`：

```js
const tubeY = Math.max(gy + 8, hudSafeTop() - canvas.getBoundingClientRect().top + 6);
drawTube3(gx + 2, tubeY, tubeLeftValue(), ...);
drawTube3(gx + gw - 2 - (18 * 3 + 4), tubeY, state.ticketsRemaining, ...);
```

**注意**：不要为了避让 HUD 单独挪其中一组。要挪就两组一起挪，`tubeY` 是唯一入口。

## 16. 首页返回键（1.4.1）

全屏后外壳 HUD 被隐藏，机台内的 `.exit-btn` 又长在 `#controls` 里被 `#startScreen`（z-index 50）盖住，
**玩家在首页其实没有出口**。所以首页左上角单独加了 `.start-back`（z-index 56）。

**为什么它走 `exit(true)` 强制退出**：`donghaiBack()` 在「还在开始界面」时返回 `true`，
意思是「这次返回别退出」（那是给机台内的退出键用的，让玩家先看帮助弹窗）。
但首页那个 `‹` 是玩家唯一出口，被拦住就等于出不去。

## 17. 退出后重进卡在首页（1.4.2 修的线上 bug）

**症状**：退出到主页后再进东海龙珠，开始游戏点不动，永远停在首页。

**根因**：`eventsBound` 是模块级标志，第一次 mount 时置 true。
退出时 `root.remove()` 把机台 DOM 连同监听一起销毁了；再进来 `bindEls()` 拿到的是**全新元素**，
但 `if (!eventsBound)` 仍然跳过 `bindEvents()` —— 新 DOM 上一个监听都没有。

**修法**：按宿主把监听拆成两类：

| 类型 | 例子 | 绑定策略 |
| --- | --- | --- |
| 元素级 | `el.fire` / `el.startBtn` / `el.settle` | **每次 mount 都绑**（元素是新的） |
| 全局级 | `window.pointerup` / `keydown` / `visibilitychange` | **只绑一次**（window 长生，重复绑会叠加） |

全局级单独放进 `bindGlobalEvents()`，用 `globalBound` 守住；
`endHold` 是每次 mount 新建的闭包，通过 `endHoldRef` 间接引用。

**注意**：不要在 `bindEvents()` 里绑 `window`。那样退出重进会叠加，一次点击触发多遍。

## 18. 周榜云榜为什么一直是空的（1.4.2）

两个独立的真问题叠在一起：

### 18.1 榜单根本没创建

代码里写的是 `hb_donghai_weekly`，但远端只建了 `hb_total_quantized` 一个。
提交时 key 不存在 → 每次都失败 → 静默回落本地。**一次云端提交都没成功过**。

用 `npx hb-sdk remote cloud leaderboard list` 可以核对，`create` 补建：

```bash
npx hb-sdk remote cloud leaderboard create hb_donghai_weekly --order desc --rank-limit 500
```

**教训**：代码里出现新的榜单 key，必须同步确认远端建过。

### 18.2 只拉 50 条会把本周挤没

云榜是「最高分永久保留、不重置」，周榜靠把周序号编进分数来区分周次。
历史周的编码值更大，会长期霸占前排。只拉 50 条时，本周成绩可能**一条都进不了前 50**，
过滤完本周就是空榜 —— 看着像「周榜坏了」。

改成拉 `CLOUD_FETCH_LIMIT = 200` 条，过滤本周后再截前 50。

### 18.3 顺带：标出「我自己」和「榜单来源」

- `getList` 返回的 `self` **恒为 false**，平台不告诉哪条是你。改用 `getCurrentUserEntry` 单独查。
- 云端失败会静默回落本机榜，玩家看到的「第 1 名」其实只有自己。现在会标「云端不可用，以下是本机记录」。

## 19. 重开不清盘：盘面越叠越多（1.4.3）

**现象**：反复进出推币机，盘面珠子只增不减；重开几轮后一开局转盘里就涌进
七八颗龙珠，50 个币打出 4000 张彩票。

**根因**：`seedTable()` 只往 `state.tableBalls` 里 `push`，从不清空。
每次 `mount()` 都调它，于是每进一次机台就多铺一整套珠子。

**修复**：`seedTable()` 开头先把六个数组清空（幂等化），
`startGame()` 再显式清零计数器 + 清球 + `seedTable()` + `initDiscHoles(true)`，
全部做完才置 `state.started = true`。

## 20. 转盘孔位从不重建：残留球重复计分（1.4.3）

**现象**：重开后转盘「堆满」，投 1 币却能持续出票。

**根因**：`initDiscHoles()` 里是 `if (state.discHoles.length) return;`，
而 `state.discHoles` **全项目没有任何一处清空**。
重开时 `discBalls` / `discSliders` 清了，但每个 `hole.occupied` / `hole.ball`
还持有上一局的旧引用 —— 旧球转到顶部会再计一次分，`occupied` 又挡住新球。

**修复**：签名改成 `initDiscHoles(force)`，守卫改为
`if (state.discHoles.length && !force) return;`。
三处重置点（`resetRound` / `startGame` / `mount`）都传 `true`；
`resize()` 里保持不传 —— 改窗口大小不该重建孔位状态。

## 21. 成绩没进过综合总分榜（1.4.3）

**这是最隐蔽的一个**：推币机的量化分**从来没有**参与过综合总分榜，
一直是 0，而且完全没有报错。

三处叠加：

1. `core/scores.js` 的 `SHORT` 表里**没有 `donghai`**。
   `recordBest('donghai','classic',…) ` 存出来的键是 `donghai.classic`。
2. `core/quantize.js` 的 `totalQuantized()` 按 `SHORT_KEYS.donghai = 'dh'`
   去读 `dh.classic`。**键名对不上，永远读到 0。**
3. 推币机结算只调 `recordDonghaiRun()`（写 `save_41`），
   **从不调 `submitTotalScore()`**，所以连提交都没发生过。

**修复**：
- `scores.js` 补 `donghai: 'dh'`；
- 结算时先 `recordBest('donghai','classic',score)` + `submitTotalScore()`，
  **在参赛校验之前** —— 总分是"这个游戏的最高纪录"，与参不参加周榜无关。
  原来不参赛直接 `return`，等于把非参赛局的成绩整个丢掉。

**教训**：键名不一致是最难发现的 bug —— 不报错、不崩溃、值恒为 0。
`test-quantize.mjs` 有"短键与存档一致"的断言，但它只比对**已登记**的游戏，
覆盖不到"漏登记"。

## 22. 结算漏算未吐出的票（1.4.3）

出票器每秒只吐 11.7 张，而派对里一次中奖就是 170~280 张。
攒下几百张没吐完很正常，但 `doSettle()` 只认 `state.tickets`（已吐出），
**完全不看 `state.ticketsRemaining`（已赢得、未打印）**。

两个方向都是错的：
- 对玩家不利：赢了票却拿不到分；
- 对公平性不利：可以先结算拿低分、再让出票器慢慢吐，下一局凭空多出一堆票。

**修复**：结算时按 `tickets + ticketsRemaining` 计算。

## 23. 投币太少就能上榜（1.4.3）

成绩是「票数 ÷ 币数」，**分母小的时候比值会爆炸**。

实测刷分路径：反复重开堆满盘面 → 只投 1 币 → 恰好触发 10 秒派对 →
转盘里的球全落下去。1 币换回两三百张票，量化分顶到 150 以上，
而正常瞄准打一整局才 5.7 张/币。

**修复**：加 `MIN_COINS_FOR_RANK = 20`（用户定的门槛）。
不足 20 币的局可以玩、可以看成绩，但**不进周榜、也不占当天次数**。

配合 #19 #20 一起，刷分路径才算真正堵死：
单靠门槛挡不住"20 币 + 全程派对"，单靠清盘挡不住"1 币吃一次派对"。

## 24. 存档版本号与作废被刷过的成绩（1.4.3）

刷分 bug 从 1.4.0 起就在线上，已经有人的周榜成绩是刷出来的
（实测出现过量化分 191.45 —— 对应每币 3184 张票，是正常水平的 566 倍）。

光修 bug 不够，旧数据还挂在榜上。所以引入存档版本号：

- `core/savever.js`：`SAVE_VERSION = 2`，版本号存 `save_43`。
- **判断依据是"有没有版本号"，不是时间戳** —— 时间戳可以改系统时钟伪造，
  "这个键从没被写过"是本地事实，伪造不了。
- 只在 `from === 0`（从没写过版本号）时作废，**且只作废东海龙珠**，
  不碰扫雷、2048 等无关游戏的成绩，避免误伤。
- 即使作废钩子抛异常也**照常写入版本号**，否则云端一直失败就会每次启动都重试。
