# 一杆清台的移植说明（只对本项目有效）

> 上游项目：`https://github.com/Yamgchenghu/dshproject-yigan`（WebView APK 源）
> 与 `https://github.com/Yamgchenghu/dshproject-yigan-web`（GitHub Pages 网页版）。
> 本项目把它的**网页版**（`index.html` + `game.js` + `style.css`）搬进了
> 小黑盒「复古游戏」小程序的 `src/tools/yigan/` 下。

---

## 一、为什么不能直接放原版

小程序外壳的 CSP 是 `default-src 'none'`，`<iframe>` 会被直接拦掉，
`<script src="peerjs.min.js">` 这类外部脚本也加载不了。
所以只能把 DOM / CSS / JS 全部搬进来，由 `screen.js` 这一层负责挂载。

这和东海龙珠的做法一致：独立网页 → 拆成「模板字符串 + 全屏层 + 自己的 rAF 循环」。

---

## 二、移植时砍掉了什么（**上游更新时务必重新砍一遍**）

### 1. 大模型 API 接入（整块删除）

| 删掉的符号 | 原用途 |
| --- | --- |
| `PROVIDERS` | 11 家大模型的服务商表（OpenAI / Claude / 通义 / 文心 …） |
| `httpPost` / `httpGet` | 直连服务商的 HTTP 封装 |
| `callLLM` / `askModel` / `parseModelChoice` | 让大模型选球路的整条链路 |
| `stateForModel` | 把局面序列化成给模型的 prompt |
| `simulateShotInSandbox` / `askModelWithSandbox` | 在沙箱里预演模型给的杆法 |
| `modelAngleCandidate` | 模型返回角度 → 候选杆法 |
| `aiThinkRounds` | 记录 AI 思考轮次（只给 API 用） |
| `testApiConnection` / `fetchAvailableModels` | 设置页的「测试连接」「拉模型列表」 |
| `populateProviders` / `renderModelOptions` / `renderModelChips` / `providerDefaults` | 设置页的模型选择 UI |
| `getAiProfile` / `saveActiveAiProfile` / `deleteAiProfile` / AI 档案 CRUD | 多套 AI 配置 |
| `translateReplayText` | 回放里把模型的思考翻译成人话 |

**为什么砍掉是安全的**：这些只影响「对手是谁」。
本地 AI（`chooseLocalShot` + 候选枚举：遍历「目标球 × 袋口」、检查遮挡与切球角度、按难度加误差）
完全保留，四种模式都还能正常人机对战。

### 2. 局域网 / 联机（整块删除）

| 删掉的符号 | 原用途 |
| --- | --- |
| `peerjs.min.js` | WebRTC 信令库（86 KB） |
| 所有 `LAN` / `web*` / `lan*` 函数 | 建房、加入、同步局面 |
| 联机设置页、联机弹窗、`#menuLan` / `#welcomeLan` | 相关 UI |
| `G.net` 相关钩子（10 处单行 + 1 处三行） | 每杆后同步给对端 |

**为什么砍掉是安全的**：所有联机钩子都写成 `if (G.net)` 守卫，
而 `G.net` 只由联机代码赋值。联机代码删干净后，这些守卫永远为假，
本地双人 / 人机对战的路径完全不受影响。

### 3. 保留的东西（不要跟着砍）

- `gameSnapshot()`：局面快照，回放功能要用。
- 回放的录制 / 播放 / 导出全链路。
- 本地 AI、完整物理、四种规则（八球 / 九球 / 轮转 / 斯诺克）。
- 球杆拖拽、微调旋钮、音效。
- 开发者终端（`$shell`），只是去掉了 API 相关子命令。

---

## 三、为了跑在小程序里，额外改了什么

这些改动**不是砍功能**，是环境差异导致的，上游更新后要重新做：

### 1. 启动时机（`window.__yiganBoot`）

原版是独立页面，`game.js` 在 `<body>` 末尾加载，脚本一跑 DOM 就在。
搬进小程序后 `game.js` 是「导入即执行」的模块，那一刻模板还没进 DOM，
`$('#felt').getContext('2d')` 会拿到 `null` 并抛错。

改法：
- 原来的 `window.addEventListener('load', boot)` 换成 `window.__yiganBoot = function () {...}`。
- `canvas` / `ctx` 改成 `let` 声明，在 `boot()` 里赋值。
- `screen.js` 插完模板后 `requestAnimationFrame(() => window.__yiganBoot())`。

### 2. 横屏（整个 `#ygApp` 转 90°）

球桌世界是 `1000 × 550` 的横版，而小黑盒小程序只能竖屏。
竖着塞进去球桌只有 200px 宽，连球都点不准。

改法：`layoutLandscape()` 给 `#ygApp` 写内联样式，宽 = `innerHeight`、
高 = `innerWidth`、`transform: rotate(90deg)`。

**必须同时做坐标转义**，否则点击会整体偏 90°：

```js
// 应用点 (ax, ay) → 屏幕点 (innerWidth - ay, ax)
function toAppPoint(clientX, clientY) {
  return { x: clientY, y: window.innerWidth - clientX };
}
```

所有读 `clientX` / `clientY` 的地方都要过这个函数：
`canvasPoint`（瞄准）、球杆拖拽蓄力、微调旋钮。

### 3. `getBoundingClientRect` 换成 `clientWidth/clientHeight`

`#ygApp` 转了 90°，`getBoundingClientRect()` 返回的是**旋转后的外接矩形**，
宽高会互换（拿到 390×654 而不是 654×390），球桌被算小一半。
`clientWidth` / `clientHeight` 读的是布局尺寸，不受 transform 影响。

### 4. CSS 作用域化

原版 CSS 有 `:root`、`*`、`html,body`、`.app`、`.panel`、`.modal`、`.overlay`、
`.toast` 这些规则，直接引入会污染整个小程序外壳（外壳也用 `.app` / `.modal` / `.overlay` / `.toast`）。

改法：所有选择器加 `.yg-root ` 前缀。

**特别注意 `#app` 这个 id**：外壳的根容器就是 `#app`，
原版也有 `<div class="app" id="app">`，两个撞在一起，外壳的 `#app{flex-direction:column}`
会把球桌布局压成竖排。已改成 `id="ygApp"`。

### 5. 计分接进排行榜

原版成绩只留在本地。小程序有排行榜，所以 `showOver()` 里加了回调：

```js
window.__yiganOnOver({ mode, winner, difficulty, shots, ballsTotal, players, overReason })
```

`screen.js` 接住后调 `computeRunScore()` → `recordBest('yigan', mode, score)`
→ `submitTotalScore()`。

计分口径见 `src/tools/yigan/scoring.js` 顶部注释。

---

## 三之二、小游戏版不存档（用户明确要求）

「小游戏版不存档」是产品决定，不是漏做。上游一杆清台会往 localStorage 写设置、
往 Android 原生目录写回放、用 `window.Android.vibrate` 震动、用 `window.Android.exit` 退出——
这些在小程序里全部不成立：

| 上游做法 | 小程序里为什么不行 | 现在怎么做 |
| --- | --- | --- |
| `localStorage` 存设置 | 沙箱里每次进来都是新的 WebView，写下去下次也读不到 | 设置只在内存里，`loadSettings()` 直接返回默认值 |
| `saveSettings()` 写盘 | 同上，写了也是白写 | 改成空实现，但保留函数名（调用点太多） |
| `Android.saveReplay` 存回放 | 没有这个对象 | 只保留 `<a download>` 手动导出 |
| `Android.vibrate` | 没有这个对象 | 换 `navigator.vibrate` |
| `Android.exit` / `window.close()` | 关不掉宿主页面 | 回调 `window.__yiganOnExit`，由 screen.js 拆浮层 |

【为什么连回放都不自动存】一局回放实测 2.47 MB，而云存档单个 value 上限 16 KB，
塞不进去；本机又存不住。所以回放只能靠玩家自己点「导出」拿到文件——
这也是为什么完整版专门加了导入功能。

## 三之三、退出按钮

用户要求「一杆清台小游戏版支持退出 — 退出按钮放在声音按钮左边」。
位置在右上角 `.top-actions` 里，顺序是 `退出 / 音效 / 辅助线 / 菜单`。

【为什么不能直接 `window.close()`】游戏是嵌进小程序的一个全屏层，
宿主页面还在，`window.close()` 对非脚本打开的窗口无效。
所以按钮只负责调 `window.__yiganOnExit()`，真正的清理（拆 DOM、
停 requestAnimationFrame、清 AI 定时器、恢复底部标签栏）在 `screen.js` 的 `exit()` 里。


## 四、上游更新时怎么做

1. 把新的 `game.js` / `style.css` / `index.html` 拿到 `C:\server\_yigan-web\`。
2. 对照本文第二节，把 API 和联机整块删掉。
3. 对照第三节，重做启动时机、横屏、坐标转义、CSS 作用域、`#app` 改名。
4. 跑 `node tools/check-yigan-fork.mjs` —— 它会逐条检查上面这些改动还在不在。
5. 跑 `node tools/test-yigan.mjs` —— 计分和量化登记也会一起验。

**这两步不要跳**：上游包体是完整版，直接覆盖会把 API 设置项和联机按钮
重新带回玩家面前，而这两样在小程序里根本用不了，只会变成一堆点不动的死按钮。
