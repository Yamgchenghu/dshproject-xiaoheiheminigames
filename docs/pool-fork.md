# 一杆清台（完整版）的移植说明

> 上游项目：`https://github.com/Yamgchenghu/dshproject-yigan-web`（网页版）。
> 本项目把它搬进**第三个小程序**「一杆清台」的 `src/tools/pool/` 下。
> 对应的小程序 id：`01a2213e-5460-7038-be80-081430208a42`。

---

## 一、这一份和「复古游戏」里那份的区别

| | 复古游戏 `src/tools/yigan/` | 完整版 `src/tools/pool/` |
| --- | --- | --- |
| 小程序 | 01a1e9a3…（复古游戏） | 01a2213e…（一杆清台） |
| network 权限 | **没有** | **有** |
| 大模型接入 | 整块删除 | **保留**，但只留国内厂商 |
| 沙箱试打 | 删除 | 保留 |
| 双 AI 观战 | 删除 | 保留 |
| 存档 | **完全不存** | 设置存云端 1 个 value |
| 回放 | 只在内存 | 只在内存 + 手动导出文件 |

用户对两份的要求是明确分开的：
- 小游戏版（复古游戏里那个）：**「小游戏版不存档」**
- 完整版（这个小程序）：**「完整版用 1 个 value 存储 api、设置等」**

---

## 二、为什么不能直接放原版

小程序外壳的 CSP 是 `default-src 'none'`，`<iframe>` 会被直接拦掉。
所以 DOM / CSS / JS 必须全部搬进来，由 `screen.js` 负责挂载。
这和东海龙珠、复古游戏版一杆清台的做法一致。

---

## 三、砍掉了什么（**上游更新时务必重新砍一遍**）

### 1. 国外大模型（用户明确要求禁止）

`PROVIDERS` 从 11 家精简到 7 家，只留国内厂商：

`deepseek` / `zhipu` / `qwen` / `volc` / `moonshot` / `step` / `mimo`

删掉的：`openai` / `claude` / `gemini` / 其它境外服务商。

**为什么必须删**：小黑盒小程序只能访问**已备案**的域名，
境外 API 一律连不上。留着这些选项只会让用户配完了才发现用不了。

### 2. 自定义服务商（用户明确要求禁止）

`PROVIDERS.custom` 整条删除，所有 `PROVIDERS.custom` 引用改指 `PROVIDERS.deepseek`。
设置页的 `#setBase` 输入框改成 `readonly`，旁边加一行说明。

**为什么必须删**：自定义域名 100% 不可能备案，等于给用户挖坑。

### 3. 未备案域名拦截（`FILED_DOMAINS`）

在 `httpPost` / `httpGet` 入口加 `guardFiledUrl(url)`：

```js
if (!guardFiledUrl(url)) return Promise.reject(new Error('域名未备案'));
```

并 toast **「小黑盒小程序不兼容无备案的域名，无法操作」**。

**为什么要拦**：与其让请求在底层超时、报一个用户看不懂的网络错误，
不如在发起前就说清楚原因。这是用户指定的提示文案，不要改。

### 4. 局域网联机（整块删除）

上游的 `LAN` 对象、22 个联机函数、联机弹窗、`#welcomeLan` 按钮全部删除。

**为什么砍掉是安全的**：所有联机钩子都写成 `if (G.net)` 守卫，
而 `G.net` 只由联机代码赋值。删干净后这些守卫永远为假。

**注意**：`gameSnapshot()` 原来夹在联机代码块中间，删块时**必须单独救出来**，
回放功能要用它。这是已经踩过一次的坑。

---

## 四、为了跑在小程序里额外改了什么

### 1. 启动时机（`window.__poolBoot`）

`game.js` 是「导入即执行」的模块，那一刻模板还没进 DOM，
`$('#felt').getContext('2d')` 会拿到 `null` 并抛错。

改法：
- `canvas` / `ctx` 改成 `let canvas = null; let ctx = null;`，在 `boot()` 里初始化
- 原来的 `window.addEventListener('load', boot)` 改成 `window.__poolBoot = boot`
- `screen.js` 在 `requestAnimationFrame` 里显式调用

### 2. 横屏（`layoutLandscape` + `toAppPoint`）

SDK 的 manifest **没有**屏幕方向字段，横屏只能靠 CSS `rotate(90deg)`。

旋转带来两个连锁问题：

**（a）量尺寸不能用 `getBoundingClientRect()`**
它返回的是旋转后的外接矩形，宽高是反的。必须用 `clientWidth` / `clientHeight`。

**（b）触摸坐标要反向映射**
```js
function toAppPoint(clientX, clientY) {
  return { x: clientY, y: window.innerWidth - clientX };
}
```

**（c）球杆 / 微调旋钮的轴向**
旋转后球杆轨道在屏幕上呈**横向**，所以蓄力轴必须用 `toAppPoint().y`，
**不是** `.x`。用 `.x` 会让用户觉得「必须垂直于球杆滑动才有反应」——
这是用户实际报过的 bug，改的时候别改回去。

### 3. 事件绑定用的是 `clientX/clientY`

`pointerdown` / `pointermove` 拿到的是**屏幕坐标**，不是旋转后的应用坐标，
所以每个拖拽点都要过一遍 `toAppPoint()`。共 4 处：球杆按下、球杆移动、
旋钮按下、旋钮移动。

---

## 五、存档策略（用户明确要求）

### 设置：云端 1 个 value

`src/core/save.js` 里的 `pool` 域 → `save_44`（16 KB）。

`game.js` 自己不碰存储，只调：
- 读：宿主在 boot 前把 JSON 塞进 `window.__poolPrefs`
- 写：`saveSettings()` 调 `window.__poolSavePrefs(raw)`，宿主防抖 700ms 后写云端

**为什么要防抖**：`saveSettings` 在出杆、切模式、拖音量时都会被调，
不合并的话每拖一次就写一次云端，既卡又容易撞限流。

### 回放：**不进** value

用户原话：**「回放存档不保存在 value 中（最小必要原则一局 2.47M，远超过存储限制）」**。

单个云端 value 上限 16 KB，一局回放 2.47 MB，差两个数量级。
所以 `archiveReplay()` 改成空实现，回放只活在内存里。

留存方式：结算页提示 → 回放 → **保存加密存档**（导出 `.yigan` 文件）→ 下次**导入存档**。

---

## 五之二、**没有**退出按钮（用户明确要求）

早期版本按小游戏版的习惯加过一个退出按钮，位置在声音按钮左边。
用户后来把完整版的要求说清楚了：

> 一杆清台完整小程序版不需要退出按钮，不需要小游戏界面 ui，基本从 apk 版本构建

【为什么这条是对的】小程序**没有**任何 API 能关掉宿主（`@heybox/hb-sdk` 的
`types/index.d.ts` 里只有 companion 进程的 `CompanionExit`，不是一回事）。
所谓「退出」在小游戏版里其实是「拆掉浮层回到标签页」；而完整版根本没有浮层、
没有标签页，进去就是球桌——退出无处可去。留一个按钮只会让人以为点了能出去。

所以现在：模板里没有 `#btnExit`，菜单里没有「退出游戏」，
`game.js` 也不绑 `#btnExit`、不挂 `window.__poolOnExit`。
玩家要离开就按手机的系统返回 / 上滑，那是宿主的事。

同理，菜单里的「局域网联机」也删了：联机代码整块移除，按钮点了没反应。


## 五之三、三方合并时一定会撞的两处

每次拿上游新包体做合并，下面两处**必然冲突**，处理方式是固定的：

1. **局域网整块（约 630 行）** —— 我们删了，上游还在。
   冲突标记会从 `function lanHostStartMatch()` 一路包到 `lanLeave()` 结尾。
   **保留删除**，替换成一行说明注释即可。
   注意 `gameSnapshot()` 就紧挨在这块前面，别顺手一起删了。
2. **版本号与设置项** —— `APP_VERSION` 和 `index.html` 的 `#versionTap`
   上游每次都会改，直接取上游的；但 `#setFreeBallLocal` 这类新增开关
   要同步进 `screen.js` 的 TEMPLATE，否则 `game.js` 读 `$('#setFreeBallLocal')` 会拿到 null。

合并完**必须**跑 `node tools/check-pool-fork.mjs`：48 项断言会把上面这些逐条验一遍。


## 六、上游更新时怎么合并

```bash
cd /c/server/_yigan-web
git fetch origin
git show <旧版本>:game.js > /c/server/_old.js
git show <新版本>:game.js > /c/server/_new.js
# 以 src/tools/pool/game.js 为 ours 做三方合并
git merge-file -p --diff3 src/tools/pool/game.js /c/server/_old.js /c/server/_new.js
```

合并后必须逐项确认（`tools/check-pool-fork.mjs` 会自动查）：

1. `PROVIDERS` 仍然只有 7 家国内厂商
2. `FILED_DOMAINS` / `isFiledUrl` / `guardFiledUrl` 还在，且仍挂在 `httpPost`/`httpGet` 上
3. 备案提示文案仍是「小黑盒小程序不兼容无备案的域名，无法操作」
4. `toAppPoint` 的 4 处拖拽仍用 `.y` 轴
5. `canvas` 仍是懒加载，`__poolBoot` 仍存在
6. `gameSnapshot()` 还在
7. 没有 `localStorage` 实际调用
8. 没有 `const LAN = {`

---

## 七、版本对照

### 版本号规则（用户明确要求）

> 版本号按照 {对标 apk 版本号}-{该版本对标下发布的小版本命名}

意思是：**第一段永远是「这一版合并到了 APK 的哪个版本」**，第二段才是
「在同一个 APK 版本下，我这边发了第几版」。例如：

| 本项目版本 | 含义 |
| --- | --- |
| `1.4.25-1` | 合并到 APK 1.4.25 后，我发的第 1 版 |
| `1.4.25-2` | 还是 APK 1.4.25，改了点东西，第 2 版 |
| `1.4.28-1` | 上游出了 1.4.28，重新合并后从 -1 重新数 |

【为什么这样定】只看第二段数字，根本看不出「这一版对应上游哪个 APK」。
要翻文档才知道 `1.4.19-2` 其实合到了 1.4.25。把 APK 版本放在前面，
`1.4.25-1` 一眼就知道对标哪个包，排查问题时不用猜。

【为什么不是四段式 `1.4.25.1`】`hb-sdk remote deploy` 校验严格 SemVer，
四段式直接报「必须是合法 SemVer」。SemVer 允许 prerelease，所以用 `-1`。
语义完全对得上：`-1` 就是该 APK 版本下的第一个包。

### 事故记录：1.4.19-2 ~ 1.4.46-1 全部启动失败

**现象**：进小程序只显示「启动失败：failed to fetch dynamically imported module」。

**两个独立原因叠在一起**：

1. `boot-pool.js` 里的动态 import 写了 `/* @vite-ignore */`。
   Vite 见到这个注释就不打包，把 `import('./tools/pool/mount.js')` 原样留在产物里。
   而 `dist/assets/` 下根本没有这个路径，运行时 404。

2. 修第 1 条时，我误删了 `const handle = mountPool(root);`，
   但函数末尾还 `return handle`。`handle` 未定义，`bootPool` 抛 ReferenceError，
   被 `main.js` 的 `.catch` 吞成一句「启动失败」文案，看不出真实原因。

**为什么一直没发现**：`npm test` 的 16 个套件全是**静态断言**（读源码字符串），
没有一条真的把小程序启动起来。测试全绿 ≠ 能启动。

**修复**：

- 去掉 `@vite-ignore`。`mount.js` 是标准 ES 模块，交给 Vite 打包。
  它本来就只会在 pool 变体里被加载（`main.js` 已经用动态 import 隔开了），
  不需要在第二层再绕过一次。
- 补回 `const handle = mountPool(root);`。
- `check-pool-fork.mjs` 加三条断言：没有 `@vite-ignore`、import 指向 `mount.js`、
  必须调用 `mountPool(root)`。

**教训**：这类问题只有真的跑一遍才看得出来。以后改启动链路，
必须用 dev server 打开 `?variant=pool` 看到球桌，不能只看测试是否全绿。


### 部署状态

- `1.4.19-1` — 已下线（2026-11-28）。首个版本，旧命名（固定 1.4.19 开头），实际对标 1.4.22。
- `1.4.19-2` — 已撤回。旧命名下的第 2 版，实际对标 1.4.25。
- `1.4.25-1` — 已发布（2026-11-28）。无外壳直挂、首帧横屏、固定步进物理、
  沙箱开关、设置页开关错位修复。
- `1.4.37-1` — 已发布（2026-11-28）。核对上游至 1.4.37，版本号对齐。
- `1.4.46-1` — 待提交。核对上游至 1.4.46（无新增可合并内容），版本号对齐。


### 对照表

| 本项目版本 | 上游 APK 版本 | 说明 |
| --- | --- | --- |
| 1.4.19-1 | 1.4.22 | 初版：十球 / 6 红球斯诺克 / 加密存档 / 导入 / 关键帧 / 自由球反复拖动 / 候选白球 |
| 1.4.25-1 | 1.4.25 | 无外壳直挂（进小程序就是球桌）、首帧横屏、去掉退出按钮；API 失败分级（连接 3 / 返回 15）、本杆全部沙箱历史、固定步进物理（1/120 秒）、回合横幅、沙箱总开关与上限；修复设置页开关文字错位 |
| 1.4.37-1 | 1.4.37 | 核对 1.4.26 ~ 1.4.37 全部为联机功能，无可合并内容；版本号对齐到 1.4.37 |
| 1.4.46-1 | 1.4.46 | 核对 1.4.38 ~ 1.4.46 全部为 ADB USB Host 与蓝牙联机，无可合并内容；版本号对齐到 1.4.46 |

### 上游逐版核对记录

| 上游版本 | 内容 | 是否合并 |
| --- | --- | --- |
| 1.4.23 | API 失败分级（连接 3 次 / 返回 15 次后本杆转本地） | ✅ 已合并 |
| 1.4.24 | 本杆全部沙箱历史 | ✅ 已合并 |
| 1.4.25 | 固定步进物理、回合横幅、沙箱开关与上限 | ✅ 已合并 |
| 1.4.26 ~ 1.4.29 | 蓝牙 RFCOMM、USB 网络共享、联机协议菜单 | ❌ 纯联机 |
| 1.4.30 ~ 1.4.33 | 局域网 / USB / 热点整合、USB-C 直连数据入口 | ❌ 纯联机 |
| 1.4.34 | UDP 自动发现主机（`discoverLanHost`） | ❌ 纯联机 |
| 1.4.35 | 房主预演算、客户端最终状态（`shot-start` 协议） | ❌ 纯联机 |
| 1.4.36 | 移除 USB 裸数据接口、移除 PeerJS | ❌ 纯联机 |
| 1.4.37 | 版本不匹配提示（`versionWarnModal`）、`simNotice` 演算中提示 | ❌ 纯联机 |
| 1.4.38 ~ 1.4.42 | ADB USB Host（`AdbUsbHost.java` 401 行）、蓝牙设备过滤 | ❌ 纯联机 |
| 1.4.44 ~ 1.4.46 | ADB 二次签名、认证重置、密钥持久化 | ❌ 纯联机 |

【为什么这些不合并】小程序里没有 WebRTC 信令，也没有 Android 桥接
（`window.Android.usbTransportInit` 之类在 WebView 里不存在）。
这些代码搬进来也跑不起来，只会让「以后要不要合并」的判断变复杂。

【核对方法】`git diff <旧版>..origin/main -- web/game.js`，逐 hunk 看位置：
落在 `lan*` / `bt*` / `WEB_LAN` / `lanHandleHostRequest` 附近的都跳过。
`simNotice` 看起来像个通用 UI，实际只在 `lanHandleHostRequest` 的
`shot-start` 分支里调用（1.4.37 的 L4324 / L4340），所以也是联机专用。

【版本号为什么还是跟到 1.4.37】用户规则是「{对标 apk 版本号}-{迭代号}」。
「对标」指的是**已经核对到哪个上游版本**，不是「抄了多少行代码」。
1.4.26 ~ 1.4.37 我逐版比对过，一条非联机改动都没有——也就是说，
在单人玩法这一块，本项目的代码**已经和 1.4.37 完全对齐**了。
所以写 `1.4.37-1` 是准确的：对标 1.4.37，第 1 版。

【注意】`game.js` 里的 `APP_VERSION` 也必须是 `1.4.37`。它有两个用途：
设置页「关于」显示 `v1.4.37`，以及联机握手时上报版本。
`check-pool-fork.mjs` 有一条断言强制它等于 `package.pool.json` 的第一段，
改一处忘另一处会直接报错。


