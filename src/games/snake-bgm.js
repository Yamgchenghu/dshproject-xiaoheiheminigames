/**
 * 贪吃蛇 BGM —— 程序化合成的欢快小曲。
 *
 * 【为什么不用 mp3】原来 public/bgm/snake.mp3 有 1.9MB，而且风格偏舒缓，
 *   和贪吃蛇「越吃越快、越吃越紧张」的节奏对不上。换成程序化合成有三个好处：
 *   1. 不占包体。小程序整包上限 100MiB，四首 mp3 就吃掉 7.5MB，
 *      能省一首是一首。
 *   2. 节奏可以跟游戏状态走。吃得越多 BPM 越快，这是 mp3 做不到的。
 *   3. 改风格只要改几个数字，不用重新找素材、重新转码。
 *
 * 【为什么是五声音阶】欢快但不吵。用 C 大调的宫调式（C D E G A），
 *   任意两个音叠在一起都不会刺耳，适合长时间循环。
 *
 * 【为什么用 WebAudio 而不是 <audio>】这里要实时调 BPM 和音高，
 *   <audio> 只能整段播放。AudioContext 需要用户手势才能启动，
 *   所以 unlock() 必须在点击事件里调用（见 screen.js 的入口）。
 */

/** 五声音阶（宫调式），相对主音的半音数 */
const SCALE = [0, 2, 4, 7, 9];

/** 主音：C5。整体偏高但不过分，游戏音效（吃豆、撞墙）不会打架 */
const ROOT = 523.25;

/** 音名 → 频率。step 是相对主音的半音步数 */
function freqOf(step) {
  const octave = Math.floor(step / SCALE.length);
  const idx = ((step % SCALE.length) + SCALE.length) % SCALE.length;
  const semi = SCALE[idx] + octave * 12;
  return ROOT * Math.pow(2, semi / 12);
}

/**
 * 旋律：每个数字是「相对主音的步数」，-1 表示休止。
 * 写成 8 小节的循环，听起来有起伏而不是机械重复。
 * 【为什么是这种走向】前两小节上行（明快），三四小节下行（呼吸感），
 *   五六小节跳进（俏皮），七八小节回到主音（收束，方便无缝循环）。
 */
const MELODY = [
  0, 2, 4, 7, 4, 2, 0, -1,
  2, 4, 7, 9, 7, 4, 2, -1,
  7, 9, 7, 4, 2, 4, 0, -1,
  4, 2, 0, 2, 4, 7, 4, -1,
  9, 7, 9, 11, 9, 7, 4, -1,
  7, 4, 2, 4, 7, 9, 7, -1,
  4, 7, 9, 7, 4, 2, 0, -1,
  2, 4, 2, 0, -1, -1, 0, -1,
];

/**
 * 低音：每两拍一个根音，撑住节奏。
 * 【为什么低音要简单】旋律已经比较密，低音再花会糊成一团。
 */
const BASS = [0, 0, -5, -5, -3, -3, -5, -5];

export function createSnakeBgm() {
  let ctx = null;
  let master = null;
  let timer = 0;
  let step = 0;
  let nextTime = 0;
  let bpm = 112;
  let running = false;
  let volume = 0.5;

  /** 单个音符：短促的三角波 + 快速衰减，像木琴/八音盒 */
  function playNote(freq, at, dur, gain) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, at);
    // 轻微下滑，让音头更"弹"
    osc.frequency.exponentialRampToValueAtTime(freq * 0.995, at + dur);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** 低音：正弦波，柔和地垫在底下 */
  function playBass(freq, at, dur) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, at);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.16, at + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /**
   * 调度：用「提前 200ms 排下一次」的方式，而不是 setInterval 直接发声。
   * 【为什么】setInterval 的抖动有几毫秒到几十毫秒，直接发声会明显忽快忽慢。
   *   这里按 AudioContext 的时钟精确排程，抖动只影响"什么时候排"，
   *   不影响"什么时候响"。
   */
  function schedule() {
    if (!ctx || !running) return;
    const beat = 60 / bpm / 2; // 八分音符
    while (nextTime < ctx.currentTime + 0.2) {
      const m = MELODY[step % MELODY.length];
      if (m >= 0) playNote(freqOf(m), nextTime, beat * 0.9, 0.09);
      // 每两拍一个低音
      if (step % 2 === 0) {
        const b = BASS[(step / 2) % BASS.length];
        playBass(freqOf(b) / 2, nextTime, beat * 1.8);
      }
      nextTime += beat;
      step++;
    }
  }

  return {
    /** 必须在用户手势里调用，否则 AudioContext 起不来 */
    unlock() {
      if (ctx) {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try {
        ctx = new Ctx();
        master = ctx.createGain();
        master.gain.value = volume * 0.85;
        master.connect(ctx.destination);
      } catch (e) {
        ctx = null;
      }
    },

    start() {
      if (!ctx) this.unlock();
      if (!ctx || running) return;
      running = true;
      step = 0;
      nextTime = ctx.currentTime + 0.05;
      schedule();
      timer = window.setInterval(schedule, 100);
    },

    stop() {
      running = false;
      if (timer) {
        clearInterval(timer);
        timer = 0;
      }
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (master) master.gain.value = volume * 0.85;
    },

    /**
     * 吃得越多节奏越快。
     * 【为什么封顶 168】再快就变成噪音了，而且玩家会开始烦躁。
     * @param {number} eaten 已吃到的食物数
     */
    setIntensity(eaten) {
      const n = Math.max(0, Number(eaten) || 0);
      bpm = Math.min(168, 112 + n * 2.5);
    },

    get playing() {
      return running;
    },
  };
}
