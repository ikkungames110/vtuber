// 感情ごとの表情プリセットとジェスチャー定義
// 値は「目標値」(その値へ寄せる)。xxxAdd は加算、eyeScale は目の開きの倍率、mouthMin は口の最低開き。
export const EMOTION_PRESETS = {
  joy: { mouthForm: 1, eyeSmile: 0.7, cheek: 0.4, browL: 0.3, browR: 0.3 },
  laugh: { mouthForm: 1, eyeSmile: 1, eyeScale: 0.4, cheek: 0.6, mouthMin: 0.4, browL: 0.4, browR: 0.4 },
  angry: { mouthForm: -0.7, browL: -0.8, browR: -0.8, browAngle: -1, browForm: -0.6, eyeScale: 0.85 },
  sad: { mouthForm: -0.9, browL: -0.3, browR: -0.3, browForm: -1, browAngle: 0.8, eyeScale: 0.75, pitchAdd: -6 },
  surprised: { eyeScale: 1.25, browL: 1, browR: 1, mouthMin: 0.5, mouthForm: 0, pitchAdd: 4 },
  embarrassed: { cheek: 1, mouthForm: 0.3, eyeSmile: 0.3, eyeX: -0.6, eyeY: -0.4, pitchAdd: -5, rollAdd: 4 },
  thinking: { eyeX: 0.5, eyeY: 0.7, mouthForm: -0.3, browL: 0.2, browR: -0.3, rollAdd: 8, yawAdd: 5 },
};

const env = (t, dur) => (t < 0 || t > dur ? 0 : Math.sin((Math.PI * t) / dur));

// t: 開始からの秒数。終了したら null を返す
export function gestureOffset(name, t) {
  switch (name) {
    case 'nod':
      return t > 0.9 ? null : { pitch: -Math.abs(Math.sin(t * Math.PI * 2.2)) * 12 * env(t, 0.9) };
    case 'shake':
      return t > 1.1 ? null : { yaw: Math.sin(t * Math.PI * 5) * 14 * env(t, 1.1) };
    case 'tilt':
      return t > 1.8 ? null : { roll: 12 * env(t, 1.8) ** 0.5, yaw: 4 * env(t, 1.8) };
    case 'bounce':
      return t > 1.0 ? null : { bounce: -Math.abs(Math.sin(t * Math.PI * 3)) * 18 * env(t, 1.0), roll: Math.sin(t * Math.PI * 3) * 4 };
    default:
      return null;
  }
}
