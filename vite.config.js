import { miniappManifest } from '@heybox/hb-sdk/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

// 【为什么在这里读 package.json】版本号原本在 src/version.js 里写死了一份，
//   和 package.json 各管各的。结果就是升了 package.json 忘了改 version.js，
//   设置页显示的版本号和实际提交审核的版本号对不上。
//   现在构建时直接把 package.json 的 version 注入进去，只有一处真源。
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * 构建变体。
 *
 * 【为什么改成从 package.json 推断，而不是只看环境变量】
 *   原来只有环境变量这一条路，不传就默认 tools。这导致过一个真实事故：
 *   package.json 已经切到「复古游戏」，但构建时忘了带 APP_VARIANT=games，
 *   于是工具版的界面被打包出来、传到了游戏服上——审核通过后线上就是错的。
 *   环境变量是"隐形状态"，容易被忘；package.json 的 heybox 绑定是"看得见的状态"，
 *   而且切变体的脚本本来就在改它。所以现在以 package.json 为准，
 *   环境变量只作显式覆盖（比如临时想构建另一个变体看看）。
 *
 * 【怎么用】node tools/use-variant.mjs games  → 改 package.json 绑定
 *          npx hb-sdk build                     → 自动跟随绑定
 *          APP_VARIANT=tools npx vite build     → 强制构建工具版（调试用）
 */
function resolveVariant() {
  const forced = process.env.APP_VARIANT;
  if (forced === 'games' || forced === 'tools') return forced;
  // package.json 里 heybox.name 是变体的唯一真源：
  //   叫「复古游戏」就是 games，其余一律 tools。
  const bound = pkg.heybox && pkg.heybox.name;
  return bound === '复古游戏' ? 'games' : 'tools';
}

const variant = resolveVariant();
// 把推断结果打出来，避免"以为构建的是 A，其实是 B"这类事故再发生
console.log('[variant] ' + variant + (process.env.APP_VARIANT ? '（环境变量指定）' : '（跟随 package.json 绑定）'));

export default defineConfig({
  base: './',
  plugins: [miniappManifest()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_VARIANT__: JSON.stringify(variant),
  },
  build: {
    // 音频体积较大，关闭资源内联阈值，保持独立文件按需加载
    assetsInlineLimit: 4096,
  },
});
