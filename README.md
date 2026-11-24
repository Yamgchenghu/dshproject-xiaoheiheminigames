# 迷你游戏与实用工具

小黑盒工坊小程序。以云海转盘为主体，附带单词机和小游戏玩法。

## 内容

| 分区 | 内容 |
|---|---|
| 转盘（首屏） | 云海转盘：直接抽取 + 编辑入口 |
| 工具 | 单词机 + 「更多玩法」游戏网格（扫雷、切水果、2048、贪吃蛇、流水入杯、诗山寻踪） |
| 我的 | 游玩记录、成就、总时长、26 个排行榜入口 |

> **为什么转盘在首屏**：审核容易把「首屏就是游戏」的小程序当成内置游戏产品去要版号。
> 转盘是纯本地抽签工具，把它放首屏、游戏降到工具页第二层，
> 定位就从「游戏 app」变成「工具 app + 小玩法」，和工具类小程序的口径一致。
> 内容一个没少，只是入口下移一层。
>
> 流水入杯是工具 APK 复刻的，但玩法是完整关卡制游戏。
> 它不在 `src/games/` 里（那套要求 tick + mods 参数表），
> 而是在 `src/games/index.js` 里单列 `LIUSHUI_META`，界面由 `src/tools/liushui/screen.js` 自绘。

## 目录结构

    src/
      core/          存档、压缩、成绩、成就、音频
        save.js      分域分块云存档（本项目的核心约束）
        pack.js      纯 ASCII 打包（让「按字节切块」等于「按字符切块」）
        shrink.js    标识符简写（整包共享映射表才省）
      sdk/           hb-sdk 封装（存储 / 文件 / 榜单）
      games/         四款 Phaser 无关的 canvas 游戏，统一实例契约
      tools/
        wheel/       云海转盘（引擎 / 存档 / ZIP2.0 格式 / 语音 / 界面）
        danciji/     单词机（词表 / 课文 / 学习记录三域存档 + AI 整理）
        liushui/     流水入杯（Java 物理移植 + canvas 界面 + 14 关）
      mod/           Python 注入（词法 → 语法 → 生成器解释器 → Worker）
      ui/            外壳与各标签页
    public/
      bgm/           四首 BGM（MIDI 生成 → 合成 → MP3）
      fonts/         两款中文字体子集（woff2）
      shishan/       诗山寻踪的图片与数据（i/ 目录已扁平化，路径不超过 42 字节）
    tools/           构建期脚本与测试
    docs/            参数手册

## 开发

    npm install
    npm run dev          # hb-sdk dev（真机/模拟器调试）
    npm run dev:vite     # 纯浏览器预览
    npm run build        # 构建
    npm test             # 全部测试

## 测试

| 文件 | 覆盖 | 数量 |
|---|---|---|
| `tools/test-save.mjs` | 分域分块存档、压缩往返、截断、FNV 校验 | 131 |
| `tools/test-games.mjs` | 12 个游戏×模式跑完整局、分数有限、timer 接口 | 73 |
| `tools/test-liushui.mjs` | 流水入杯物理、碰撞、水位、画线上限 | 52 |
| `tools/test-python.mjs` | Python 子集解释器、timer 类、真实模组脚本 | 26 |
| `tools/test-boards.mjs` | 排行榜 key 不混榜（含流水入杯 14 关） | 5 |

合计 287 条断言。

## 几个关键约束

### 云存档配额

工坊云存档按 value 计费，每个 value 最多 16 KB。本项目把数据**连续打包**，
一个 value 装满才用下一个（`CHUNK_BYTES = 16000`，留 384 字节给块头）。

| 域 | value 数 | key |
|---|---|---|
| 模组源码 | 3 | `save_1`–`save_3` |
| 转盘数据 | 6 | `save_4`–`save_9` |
| 转盘跳转 | 4 | `save_10`–`save_13` |
| 自动指令 | 4 | `save_14`–`save_17` |
| 最佳成绩 | 1 | `save_18` |
| 个人资料 | 1 | `save_19` |

分块写入是**倒序**的：先写最后一块，最后写第 0 块。第 0 块带
`S1|<总字节>|<块数>|<校验和>|` 头，相当于提交标记——写到一半断电，
第 0 块还是旧的，读出来的就是旧数据而不是半截新数据。

### 为什么打包结果必须是纯 ASCII

云端限制是「16 KB 的 UTF-8 字符串」。一个中文字符算 3 字节但只算 1 个字符，
如果直接存 JSON，`str.length` 和实际字节数对不上，切块就会算错。
所以 `pack.js` 一律输出 base85（85 个可打印 ASCII 字符，排除引号反斜杠等
容易在传输中被转义的符号），压缩后再 base85，并取两者较小的那个。

### 模组不计入排行榜

Python 脚本能任意改分数。允许带模组的对局上榜等于榜单作废，
所以带模组的对局在提交前就被拦下，连最佳成绩也不刷新。

## 文档

- `docs/mod-parameters.md` —— 模组参数手册（每个参数的属性与效果）
- `docs/voice-template.md` —— 朗读模板与占位符说明
- `docs/publish-notes.md` —— 提审说明与规则自查
- `public/fonts/README.md` —— 字体来源、子集化、授权说明
- `public/voice/README.md` —— 语音生成流程与音色说明
- `src/tools/liushui/README.md` —— 流水入杯玩法与物理说明

## 授权

代码 MIT。字体与语音的授权情况分别见各自的 README：
**吴邪瘦金体的字体名里带 `(Non-Commercial Use)`，商用前必须替换。**
