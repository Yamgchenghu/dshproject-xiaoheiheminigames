# MD3 视觉规范（本项目实际采用的取值）

> 依据：[lwhhz/Android-MD3-Knowledge](https://github.com/lwhhz/Android-MD3-Knowledge)（官方站点核验版，核验日期 2026-11-16）。
> 本文件只记录**本项目真正用到的**那些值，以及为什么是这个值。
> 修改样式前先看这里，避免凭记忆编造规范。

## 一、先纠正三个容易搞错的点

1. **MD3 滑块没有波浪轨道。**
   波浪（wavy）是 **Progress Indicator（进度条）** 的特性。
   滑块是「16dp 高胶囊轨道 + **4dp 宽竖条** handle」。
   圆点 handle 是 M2 的样式，M3 明确不同。
   —— 我一开始就按波浪滑块写错过一次，务必记住。

2. **圆角是十档，不是七档。**
   0 / 4 / 8 / 12 / 16 / 20 / 28 / 32 / 48 / full(dp)。
   Compose 的 Shapes 只有五槽（4/8/12/16/28），其余要就地写。

3. **颜色不存十六进制值。**
   官方原则是颜色存角色、不存值（dynamic color 会让同角色在不同设备变色）。
   本项目不用 dynamic color，所以按 baseline 浅色主题固化了值，
   但**变量名一律用角色名**（--md-primary 而不是 --md-purple），以后换主题只改一处。

## 二、颜色角色（baseline 浅色主题）

| 角色 | 值 | 用在哪 |
|---|---|---|
| surface | #fef7ff | 正文区底、顶栏 |
| surfaceContainerLowest | #ffffff | — |
| surfaceContainerLow | #f7f2fa | 卡片（filled card） |
| surfaceContainer | #f3edf7 | **底部导航栏** |
| surfaceContainerHigh | #ece6f0 | — |
| surfaceContainerHighest | #e6e0e9 | 统计块 |
| surfaceVariant | #e7e0ec | 滑块未激活轨道 |
| primary | #6750a4 | 强调、滑块激活段、导航选中 |
| onPrimary | #ffffff | 主色上的文字 |
| primaryContainer | #eaddff | 账号卡片底 |
| onPrimaryContainer | #21005d | 账号卡片文字 |
| secondaryContainer | #e8def8 | tonal 按钮底、导航选中指示器 |
| outline | #cac4d0 | 输入框描边、开关关闭态 |
| outlineVariant | #e7e0ec | 分割线 |

**跨断点映射（官方硬性要求）**：正文区用 surface，导航区用 surfaceContainer。
两者差一档明度，导航栏因此自然沉下去，**不需要投影或分割线**去划界。

## 三、形状

| 组件 | 圆角 | 说明 |
|---|---|---|
| Card | **12dp** | CardDefaults.shape 的 medium 档，不要手写别的值 |
| Button（圆形样式） | **Full** | 胶囊，本项目所有 .hud-btn 用这个 |
| Button（按下态） | 8dp | Expressive 形状 morph，按下变更方 |
| Dialog / Bottom sheet | 28dp（顶部） | 非对称圆角 |
| 滑块轨道 | 8dp | XS 档 |
| 滑块 handle | 2dp（4dp 宽的竖条） | — |

## 四、尺寸

| 组件 | 值 |
|---|---|
| 滑块轨道高 | **16dp**（XS 档） |
| 滑块 handle | **4dp 宽 x 44dp 高** |
| 按钮高度（Small） | 40dp |
| 卡片内边距 | 16dp |

## 五、字体

MD3 用几何无衬线。本项目原来用瘦金体（标题）+ 楷体（正文），
是手写书法风，与 MD 的几何感冲突，已改为：

- 标题/正文：Roboto, Noto Sans CJK SC, PingFang SC, Microsoft YaHei, sans-serif
- 代码：Roboto Mono, SF Mono, Consolas, monospace

安卓上第一个命中的就是 Roboto，等于系统原生字体。

## 六、本项目不用什么

- **波浪进度条**：那是 Progress Indicator 的 Expressive 特性，本项目没有进度条场景。
- **Shape morph**：官方只点名 Button Group 和 Loading Indicator 两个组件内置使用，
  其余属自定义实现，收益小、风险大，不做。
- **Dynamic color**：小程序不需要跟随系统壁纸取色，固定 baseline 主题更可控。

## 七、改样式时的自检

1. 圆角是不是十档里的某一档？不是就错了。
2. 颜色用的是角色变量还是硬编码十六进制？后者要改成前者。
3. 导航区和正文区是否用了不同档的 surface？同档就分不出层级。
4. 滑块 handle 是 4dp 竖条还是圆点？圆点说明写成 M2 了。
5. 有没有给卡片加投影？MD3 默认卡片**无阴影**，靠 surface 明度分档。
