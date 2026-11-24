/**
 * 本地预览用的 Vite 配置（不参与小程序构建）。
 *
 * 【为什么单独一份】`npm run dev:vite` 用的是 vite.config.js，它会加载
 *   miniappManifest 插件并注入 __APP_VARIANT__，纯浏览器里跑不完整。
 *   这份配置去掉小程序插件，只保留基础的 base/define，
 *   用来起一个普通 dev server 做界面截图与交互验证。
 *
 * 用法：npx vite --config _preview.vite.config.mjs
 */
import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 5188, strictPort: true } });