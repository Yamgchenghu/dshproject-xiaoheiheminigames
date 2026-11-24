/**
 * 难度模式。
 * 温和模式：选项会标出作者与朝代，适合低年级刚接触古诗的小朋友。
 * 挑战模式：只凭画面与记忆作答，更考验积累。
 * 两种模式都可以消耗毛笔获得提示。
 */
export const DIFFICULTIES = {
  gentle: {
    key: 'gentle',
    name: '温和模式',
    shortName: '温和',
    desc: '选项标出作者与朝代，答错后有小诗童的温柔鼓励。',
    showOptionMeta: true,
    gentleNudge: true,
  },
  challenge: {
    key: 'challenge',
    name: '挑战模式',
    shortName: '挑战',
    desc: '只凭画面与诗句记忆作答，更考验平时的积累。',
    showOptionMeta: false,
    gentleNudge: false,
  },
};

export function getDifficultyConfig(key) {
  return DIFFICULTIES[key] || DIFFICULTIES.gentle;
}
