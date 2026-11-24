/**
 * 版本号：设置页与「云海转盘」都会展示。
 *
 * 【为什么不再写死】以前这里和 package.json 各写一份，
 *   升版本时经常只改一处，导致设置页显示的版本和实际审核的版本不一致。
 *   现在由 vite.config.js 在构建时从 package.json 注入 __APP_VERSION__，
 *   只有 package.json 一个真源，不会再漏改。
 */
export const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

/** 构建月份，用于粗略区分构建批次 */
export const BUILD = '2026-11';
