/**
 * 背景音乐与音效。
 *
 * 【为什么用 <audio> 而不是 WebAudio】小程序 WebView 里 AudioContext 的
 *   自动播放策略比 <audio> 严得多：<audio> 在用户点击后 play() 就能出声，
 *   AudioContext 还要 resume() 且各宿主实现不一致。这里只需要"循环放一首
 *   mp3"，用 <audio> 最稳，内存也低。
 *
 * 【为什么要"预加载 + 单例"】一首 4 分钟的曲子约 1.9MB，每次进游戏新建
 *   一个 <audio> 会重复解码。做成单例，切游戏时只换 src，解码器复用。
 *
 * 【为什么音量要乘一个系数】BGM 是背景，不能盖住操作的听觉反馈；
 *   用户把滑杆拉满时也只给 0.85，留一点余量。
 */
import { getProfileSync } from './achievements.js';

/**
 * 【为什么是 './bgm/' 而不是 import.meta.url 相对路径】
 *   音频放在 public/bgm/，打包后原样复制到产物根目录，
 *   用 import.meta.url 会解析到 src/core/bgm/（不存在）。
 *   相对 document.baseURI 解析，dev 和打包后都指向正确位置。
 */
function bgmUrl(name) {
  return new URL('bgm/' + name + '.mp3', document.baseURI).href;
}

let el = null;
let current = null; // 当前曲目名
let unlocked = false; // 是否已获得"用户手势"授权
let pending = null; // 授权前想播的曲目

function audioEl() {
  if (el) return el;
  el = new Audio();
  el.loop = true;
  el.preload = 'auto';
  el.volume = 0;
  // 移动端要显式声明，否则部分 WebView 会走"下载后播放"而不是流式
  el.setAttribute('playsinline', '');
  return el;
}

function settings() {
  const p = getProfileSync();
  return p?.settings || { bgm: true, bgmVolume: 0.5, sfx: true };
}

function targetVolume() {
  const s = settings();
  if (!s.bgm) return 0;
  return Math.max(0, Math.min(1, Number(s.bgmVolume ?? 0.5))) * 0.85;
}

/**
 * 播放某款游戏的 BGM。
 * 同一个曲目重复调用是幂等的——切模式、重开一局都不会重头播。
 */
export function playBgm(name) {
  if (!name) return;
  const s = settings();
  if (!s.bgm) {
    stopBgm();
    return;
  }
  const a = audioEl();
  if (current === name && !a.paused) {
    a.volume = targetVolume();
    return;
  }
  const src = bgmUrl(name);
  if (a.src !== src) a.src = src;
  current = name;
  a.volume = targetVolume();
  const p = a.play();
  if (p && p.catch) {
    p.catch(() => {
      // 还没拿到用户手势：记下来，等第一次点击再补播
      pending = name;
      unlockOnGesture();
    });
  }
}

export function stopBgm() {
  if (!el) return;
  el.pause();
  current = null;
  pending = null;
}

export function pauseBgm() {
  if (el && !el.paused) el.pause();
}

export function resumeBgm() {
  if (!el || !current) return;
  const s = settings();
  if (!s.bgm) return;
  el.volume = targetVolume();
  const p = el.play();
  if (p && p.catch) p.catch(() => {});
}

/** 设置改变后调用：立即反映音量/开关，不用重开游戏 */
export function applyAudioSettings() {
  if (!el) return;
  const s = settings();
  if (!s.bgm) {
    el.pause();
    return;
  }
  el.volume = targetVolume();
  if (current && el.paused && unlocked) resumeBgm();
}

/**
 * 小程序宿主一般会在页面加载时触发一次用户手势（点击"开始游戏"）。
 * 这里挂一次性监听，把手势补上，顺便把排队中的曲目播出来。
 */
function unlockOnGesture() {
  if (unlocked) return;
  const handler = () => {
    unlocked = true;
    document.removeEventListener('pointerdown', handler, true);
    document.removeEventListener('touchstart', handler, true);
    document.removeEventListener('keydown', handler, true);
    if (pending) {
      const n = pending;
      pending = null;
      playBgm(n);
    }
  };
  document.addEventListener('pointerdown', handler, true);
  document.addEventListener('touchstart', handler, true);
  document.addEventListener('keydown', handler, true);
}

/** 应用回到前台：恢复播放（系统通常会暂停后台音频） */
export function onAppShowAudio() {
  const s = settings();
  if (s.bgm && current) resumeBgm();
}

/** 应用切后台：主动暂停，别在后台耗电 */
export function onAppHideAudio() {
  pauseBgm();
}
