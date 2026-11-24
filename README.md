# 小黑盒工坊小程序

一套源码，两个小程序。原生 Android / Material Design 3 风格，无框架 UI。

| 小程序 | 版本 | 内容 |
|---|---|---|
| **复古游戏** | `1.4.4` | 扫雷、切水果、2048、贪吃蛇、合成大西瓜、流水入杯、诗山寻踪、东海龙珠 |
| **学习与实用工具** | `1.2.9` | 云海转盘、诗山寻踪、单词机 |

> 版本号唯一真源是 `package.json` / `package.games.json` / `package.tools.json` 的 `version` 字段，
> 构建时由 `vite.config.js` 注入到 `__APP_VERSION__`，设置页显示的就是实际提审的版本。
> 仓库不打 GitHub Release，版本点用轻量 tag 标记。

## 为什么是两个小程序

根因是一个死结：本项目申请了 `network`（联网）权限，平台因此把小程序判定为 **server 模式**。
而 server 模式下 `user.getInfo()` 被平台禁用——文档写得很清楚：「第三方小程序进入联网的 server 模式后
不能调用本方法获取身份」，要拿昵称头像必须自建服务端换票。我们没有服务端，
所以登录态永远读不到，三轮「修复」都没用，因为方向本身是错的。

解法不是继续修，而是把不需要联网的部分拆出去：

- **复古游戏** 不申请 `network` → 回到 host 模式 → `user.getInfo()` 可用 → **真登录**。
- **学习与实用工具** 需要联网（单词机 AI 整理、诗山朗读），保持现状。

两个变体的差异**全部集中在 `src/core/variant.js`**，一眼能看全到底哪里不同：

    export const FEATURES = {
      wordMachine: IS_TOOLS,   // 单词机：AI 整理、在线朗读
      shishan:     IS_TOOLS,   // 诗山寻踪：朗读需要网络
      wheel:       IS_TOOLS,   // 云海转盘：纯本地随机
      games:       IS_GAMES,   // 小游戏只在游戏版
      leaderboard: IS_GAMES,   // 只有游戏版有榜
      login:       IS_GAMES,   // 只有游戏版需要身份
      mods:        IS_GAMES,   // 模组实验室只给游戏版
    };

变体由 `package.json` 的 `heybox.name` 推断（「复古游戏」即 games），不再依赖环境变量——
环境变量是隐形状态，忘传一次就会把工具版界面传到游戏服上，这个事故真实发生过。

    node tools/use-variant.mjs games    # 切到复古游戏
    node tools/use-variant.mjs tools    # 切到学习与实用工具
    node tools/use-variant.mjs status   # 查看当前绑定

## 分支

| 分支 | 对应小程序 | 说明 |
|---|---|---|
| `main` | 复古游戏 | 小游戏主体：游戏引擎、排行榜、模组实验室、量化总分 |
| `study` | 学习与实用工具 | 转盘、诗山寻踪、单词机 |

两个分支按现有两个小程序的划法划分，各自是完整可构建的状态。
共享层（存档、压缩、SDK 封装、UI 外壳、MD3 样式）两边都有。

## 目录结构

    src/
      core/          存档、压缩、成绩、成就、音频、量化
        save.js      分域分块云存档（本项目的核心约束）
        pack.js      纯 ASCII 打包（让「按字节切块」等于「按字符切块」）
        quantize.js  量化总分（基准 100，高于基准取对数，低于基准线性）
        audio.js     BGM 单例 + 音效
        variant.js   两个小程序的全部差异都在这里
      sdk/           hb-sdk 封装（存储 / 文件 / 榜单 / 账号）
      games/         五款 canvas 游戏，统一实例契约（tick + draw）
      tools/
        wheel/       云海转盘（引擎 / 存档 / ZIP2.0 格式 / 语音 / 界面）
        danciji/     单词机（词表 / 课文 / 学习记录三域存档 + AI 整理）
        liushui/     流水入杯（Java 物理移植 + canvas 界面 + 14 关）
        donghai/     东海龙珠（2.5D 推币机，九孔 + 转盘 + 周榜）
      shishan/       诗山寻踪（Phaser 3 长线流程）
      mod/           Python 注入（词法 → 语法 → 生成器解释器 → Worker）
      ui/            外壳与各标签页
    public/
      bgm/           七首 BGM（MIDI 生成 → 合成 → MP3）
      shishan/       诗山寻踪的图片与数据（路径不超过 42 字节）
    tools/           构建期脚本与测试
    docs/            参数手册与设计记录

## 开发

    npm install
    npm run dev          # hb-sdk dev（真机/模拟器调试）
    npm run dev:vite     # 纯浏览器预览
    npm run build        # 构建
    npm test             # 全部测试（21 个套件）

字体已随仓库提供（`src/assets/fonts/` 下两个 woff2，共 21 MB，是仓库体积的主要部分）。
子集化流程见 `tools/collect-chars.mjs`：它扫描源码里出现的所有汉字，只保留用到的字形。
**新增中文文案后要重跑**，否则新字会 fallback 成系统字体。

## 成绩与排行榜

### 量化总分

每局分数先按模式的**基准分**量化，再跨模式相加成一个总分榜：

- 分数 = 基准 → 100 分
- 分数 > 基准 → `100 + 10 × log2(分数 / 基准)`（对数，防刷分）
- 分数 < 基准 → `100 × 分数 / 基准`（线性）
- 封顶 200；没玩过的模式记 0

对数段的含义：成绩翻倍只加 10 分。这让「比基准强一倍」和「强一千倍」在总分上只差 100 分，
而不是 1000 分——单模式刷分无法绑架总分榜。

### 平台限制

工坊最多 **3 个排行榜**。已用两个：

- `hb_total_quantized` —— 量化总分总榜
- `hb_donghai_weekly` —— 东海龙珠周榜（编码 `weekIdx × 10000 × 1000 + 分 × 1000`，每周清空）

`order` 在创建时就定死。`desc` 意味着**提交只能让分数变高**，
想降分只能 `deleteCurrentUserEntry` 后重提——这个语义坑过一次（误删总榜）。

### 东海龙珠计分

推币机按**每币平均彩票**计分，不是累加：投币越多总分越高反而是坏成绩。

- 基准 45/8 = 5.625 彩票/币
- 至少投 20 币才算成绩（`MIN_COINS_FOR_RANK`），防止 1 币刷基准分
- 每日随机限额 50/80/100/120 币，3 次机会，取最好一次

## 云存档配额

工坊云存档按 value 计费，每个 value 最多 16 KB。本项目把数据**连续打包**，
一个 value 装满才用下一个（`CHUNK_BYTES = 16000`，留 384 字节给块头）。

分块写入是**倒序**的：先写最后一块，最后写第 0 块。第 0 块带
`S1|<总字节>|<块数>|<校验和>|` 头，相当于提交标记——写到一半断电，
第 0 块还是旧的，读出来的就是旧数据而不是半截新数据。

### 为什么打包结果必须是纯 ASCII

云端限制是「16 KB 的 UTF-8 字符串」。一个中文字符算 3 字节但只算 1 个字符，
如果直接存 JSON，`str.length` 和实际字节数对不上，切块就会算错。
所以 `pack.js` 一律输出 base85（85 个可打印 ASCII 字符），压缩后再 base85，取两者较小的那个。

## 背景音乐

七首曲目全部由代码生成，不是找的素材：

    编曲模块 (tools/lib/songs.mjs) → MIDI → 回读校验 → PCM 合成 → MP3 (11025Hz / 56kbps)

曲风来自用户自己调了几十遍的参考曲《Boarding Pass in the Clouds》（9 分 16 秒，17 轨）。
我实测那首 MIDI 得到可量化的硬指标，作为全部曲目的约束：

| 特征 | 参考曲实测 | 说明 |
|---|---|---|
| 调式 | D 混合利底亚 | 有降七级（F 自然音），不是自然大调 |
| 旋律音程 | 三度 47% / 二度 29% / 同音 13% / 大跳 7.5% | 以三度为核心的级进 |
| 旋律密度 | 5.09 音/小节 | 密集的 4 分音符线条，不是长音吟唱 |
| 打击 | 闭镲 960 / 底鼓 400 / **军鼓仅 40** | 几乎没有军鼓 |

七首分别用六个不同调性、72~96 BPM，全部可循环（音符不越过循环结尾，尾音折回开头）。
贪吃蛇例外：它走实时 WebAudio 合成，BPM 随吃到的果实加快，mp3 做不到这一点。

## 测试

    合计 600+ 条断言，21 个套件

| 套件 | 覆盖 |
|---|---|
| `test-save.mjs` | 分域分块存档、压缩往返、截断、FNV 校验 |
| `test-savever.mjs` | 存档版本闸门、迁移只清东海龙珠 |
| `test-games.mjs` | 全部游戏×模式跑完整局、分数有限、timer 接口 |
| `test-quantize.mjs` | 量化公式、边界、封顶、未玩记 0 |
| `test-boards.mjs` | 排行榜 key 不混榜 |
| `test-donghai.mjs` | 推币机计分、限额、周榜编码、最小币数 |
| `test-bgm.mjs` | 曲风约束（调式、音程、密度、循环边界） |
| `check-donghai-fork.mjs` | 移植改动不被上游包体覆盖 |

## 几个关键约束

### 模组不计入排行榜

Python 脚本能任意改分数。允许带模组的对局上榜等于榜单作废，
所以带模组的对局在提交前就被拦下，连最佳成绩也不刷新。

### CSP 是 `default-src 'none'`

小程序 WebView 里 `fetch()` 被拦，`<iframe>` 加载不了任何外部页面。
所有第三方玩法必须**内联移植**，不能嵌。流水入杯、诗山寻踪都是这样搬进来的。

### 安全区靠 JS 补

`env(safe-area-inset-*)` 在宿主 iframe 里恒为 0，必须在启动时读
`viewport.getWindowInfo().statusBarHeight` 写进 CSS 变量。实测状态栏 84px。

### 字体体积

中文字体全量太大，`tools/collect-chars.mjs` 扫描源码里出现的所有汉字做子集化。
新增中文文案后要重跑，否则新字会 fallback 成系统字体。

## 文档

- `docs/mod-parameters.md` —— 模组参数手册（每个参数的属性与效果）
- `docs/donghai-fork.md` —— 东海龙珠移植记录与「不被上游覆盖」的三层保护
- `docs/voice-template.md` —— 朗读模板与占位符说明
- `docs/publish-notes.md` —— 提审说明与规则自查
- `public/fonts/README.md` —— 字体来源、子集化、授权说明
- `src/tools/liushui/README.md` —— 流水入杯玩法与物理说明

## 授权

代码 MIT。字体与语音的授权情况分别见各自的 README：
**吴邪瘦金体的字体名里带 `(Non-Commercial Use)`，商用前必须替换。**
