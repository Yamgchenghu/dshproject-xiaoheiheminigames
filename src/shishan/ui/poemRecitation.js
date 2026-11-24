/**
 * 古诗朗诵按钮：关卡、诗卡详情、节气诗碑共用。
 * 点一下开始吟诵，再点一下停止；设备没有中文声音时给出温和提示。
 */

import { S, FONT_SIZE } from '../config/theme.js';
import { createButton, makeText, showToast } from './components.js';
import {
  ensureVoices,
  hasSpeechSupport,
  isReciting,
  speakPoem,
  stopRecitation,
} from '../gameplay/recitation.js';

/**
 * @param {Phaser.Scene} scene
 * @param {object} options { x, y, poem, width, height, depth, label, statusY }
 */
export function addRecitationButton(scene, options = {}) {
  const {
    x = 0,
    y = 0,
    poem = null,
    width = 122,
    height = 46,
    depth = 1000,
    label = '吟诵',
    statusY = null,
  } = options;

  const button = createButton(scene, {
    x,
    y,
    width,
    height,
    radius: 23,
    label,
    variant: 'soft',
    fontSize: FONT_SIZE.sm,
    depth,
    onClick: () => toggle(),
  });

  const status = statusY === null
    ? null
    : makeText(scene, x, statusY, '', {
        size: 12,
        color: S.inkFaint,
        origin: [0.5, 0.5],
      }).setDepth(depth);

  let active = false;
  let destroyed = false;

  const setActive = (value) => {
    active = value;
    if (destroyed) return;
    button.setLabel(value ? '停止' : label);
    button.setVariant(value ? 'gold' : 'soft');
    if (status) status.setText(value ? '正在吟诵……' : '');
  };

  const stop = () => {
    stopRecitation();
    setActive(false);
  };

  const toggle = async () => {
    if (!poem || destroyed) return;
    if (isReciting() || active) {
      stop();
      return;
    }
    if (!hasSpeechSupport()) {
      showToast(scene, '这台设备暂时不能朗读，跟着拼音慢慢读也一样好听。', {
        tone: 'warn',
        y: 640,
      });
      return;
    }

    setActive(true);
    if (status) status.setText('正在准备朗读……');
    const ready = await ensureVoices();
    if (!ready || destroyed) {
      setActive(false);
      showToast(scene, '没有找到中文朗读声音，可以跟着拼音读一读。', {
        tone: 'warn',
        y: 640,
      });
      return;
    }

    const started = speakPoem(poem, {
      onLine: (index) => {
        if (status && !destroyed) status.setText(`正在吟诵第 ${index + 1} 句……`);
      },
      onEnd: () => setActive(false),
      onError: () => {
        setActive(false);
        showToast(scene, '朗读中断了，再点一次试试。', { tone: 'warn', y: 640 });
      },
    });
    if (!started) setActive(false);
  };

  const onShutdown = () => {
    stopRecitation();
  };
  scene.events.once('shutdown', onShutdown);

  return {
    button,
    status,
    stop,
    toggle,
    destroy() {
      destroyed = true;
      stopRecitation();
      scene.events.off('shutdown', onShutdown);
      button.destroy();
      if (status) status.destroy();
    },
  };
}

export default addRecitationButton;
