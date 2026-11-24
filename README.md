# 学习与实用工具

小黑盒工坊小程序。**云海转盘**为主体，附**诗山寻踪**与**单词机**。

当前版本：**`1.2.9`** ｜ 小程序 ID：`01a1da5f-2af3-70bf-a0b0-7185e29ab423`

> 版本号唯一真源是 `package.json` 的 `version`，构建时由 `vite.config.js` 注入到 `__APP_VERSION__`，
> 设置页显示的就是实际提审的版本。仓库不打 GitHub Release，版本点用轻量 tag 标记。

## 内容

| 分区 | 内容 |
|---|---|
| 转盘（首屏） | 云海转盘：直接抽取 + 编辑入口 + 语音朗读 |
| 工具 | 诗山寻踪（抄诗闯关收集）、单词机（词表 / 课文 / AI 整理） |
| 我的 | 学习记录、设置 |

> **为什么转盘在首屏**：审核容易把「首屏就是游戏」的小程序当成内置游戏产品去要版号。
> 转盘是纯本地抽签工具，把它放首屏，定位就从「游戏 app」变成「工具 app」，和工具类小程序的口径一致。

## 为什么没有游戏和排行榜

这个变体申请了 `network`（联网）权限（单词机 AI 整理、诗山朗读需要），
平台因此把它判定为 **server 模式**，而 server 模式下 `user.getInfo()` 被禁用——
拿不到身份就没有昵称头像，排行榜也就失去意义。

小游戏、排行榜、登录、模组实验室全部迁到另一个小程序「复古游戏」（`main` 分支），
那边不申请 `network`，回到 host 模式，登录可用。

差异全部集中在 `src/core/variant.js` 的 `FEATURES`：

    export const FEATURES = {
      wordMachine: IS_TOOLS,   // 单词机：AI 整理、在线朗读
      shishan:     IS_TOOLS,   // 诗山寻踪：朗读需要网络
      wheel:       IS_TOOLS,   // 云海转盘：纯本地随机
      games:       IS_GAMES,   // 本分支关闭
      leaderboard: IS_GAMES,   // 本分支关闭
      login:       IS_GAMES,   // 本分支关闭
      mods:        IS_GAMES,   // 本分支关闭
    };

游戏代码仍在同一仓库里（`src/games/`、`src/tools/donghai/` 等），
由 `FEATURES` 决定入口是否可达，构建时不会出现在界面上。
这样做是为了两个分支共用一份实现，修 bug 不用改两处。

## 目录结构

    src/
      core/          存档、压缩、音频、变体开关
        save.js      分域分块云存档（本项目的核心约束）
        pack.js      纯 ASCII 打包（让「按字节切块」等于「按字符切块」）
        audio.js     BGM 单例 + 音效
        variant.js   两个小程序的全部差异都在这里
      sdk/           hb-sdk 封装（存储 / 文件 / 账号）
      tools/
        wheel/       云海转盘（引擎 / 存档 / ZIP2.0 格式 / 语音 / 界面）
        danciji/     单词机（词表 / 课文 / 学习记录三域存档 + AI 整理）
      shishan/       诗山寻踪（Phaser 3 长线流程）
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
    npm test             # 全部测试

字体已随仓库提供（`src/assets/fonts/` 下两个 woff2，共 21 MB）。
子集化流程见 `tools/collect-chars.mjs`：它扫描源码里出现的所有汉字，只保留用到的字形。
**新增中文文案后要重跑**，否则新字会 fallback 成系统字体。

### 分支与开源节奏

| 分支 | 对应小程序 | 当前版本 |
|---|---|---|
| `main` | 复古游戏 | `1.4.4` |
| `study` | 学习与实用工具 | `1.2.9` |

**每 5 个小版本同步一次开源。** 内部开发与开源发布解耦，
小版本攒够 5 个再合并推送，避免把中间试错过程一条条暴露出去。
版本点用轻量 tag 标记（`games-v1.4.4` / `study-v1.2.9`），不发 GitHub Release。

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

## 几个关键约束

### CSP 是 `default-src 'none'`

小程序 WebView 里 `fetch()` 被拦，`<iframe>` 加载不了任何外部页面。
所有第三方玩法必须**内联移植**，不能嵌。诗山寻踪就是这样搬进来的。

### 安全区靠 JS 补

`env(safe-area-inset-*)` 在宿主 iframe 里恒为 0，必须在启动时读
`viewport.getWindowInfo().statusBarHeight` 写进 CSS 变量。实测状态栏 84px。

### 朗读依赖网络

诗山寻踪与转盘语音都走在线 TTS。断网时功能降级但不崩，
这是本变体保留 `network` 权限的唯一原因。

## 文档

- `docs/voice-template.md` —— 朗读模板与占位符说明
- `docs/publish-notes.md` —— 提审说明与规则自查
- `public/fonts/README.md` —— 字体来源、子集化、授权说明

## 授权

代码 MIT。字体与语音的授权情况分别见各自的 README：
**吴邪瘦金体的字体名里带 `(Non-Commercial Use)`，商用前必须替换。**
