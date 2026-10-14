// ARKit 互換ブレンドシェイプ(52種) + 頭の回転 → アバター用の正規化パラメータへ変換する。
// iPhone(MediaPipe) とサーバー(VTube Studio iPhone アプリ受信) の両方から使う。
//
// 出力パラメータ(すべて「本人視点」):
//   yaw   : 本人が自分の右を向くと +   (deg)
//   pitch : 上を向くと +               (deg)
//   roll  : 頭を自分の右肩側へ傾けると + (deg)
//   eyeL / eyeR : 目の開き 0(閉)〜1(開)、見開きで最大 1.2
//   eyeX  : 本人の右を見ると +  (-1..1)
//   eyeY  : 上を見ると +        (-1..1)
//   browL / browR : 眉の上下 (-1..1)
//   mouthOpen : 0..1
//   mouthForm : 笑顔 +1 / への字 -1
//   cheek : 頬 0..1

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// "EyeBlinkLeft" / "eyeBlinkLeft" どちらの表記でも受け付ける
export function normalizeBlendshapes(input) {
  const out = {};
  if (Array.isArray(input)) {
    for (const item of input) {
      const k = item.k ?? item.categoryName ?? item.name;
      const v = item.v ?? item.score ?? item.value;
      if (k != null) out[k[0].toLowerCase() + k.slice(1)] = v;
    }
  } else if (input) {
    for (const [k, v] of Object.entries(input)) out[k[0].toLowerCase() + k.slice(1)] = v;
  }
  return out;
}

export function blendshapesToParams(bs, rot = { yaw: 0, pitch: 0, roll: 0 }) {
  const g = (k) => bs[k] ?? 0;

  const eyeOpen = (blink, wide) => {
    // 半目くらいの値はノイズが多いので、閉じ判定を少し強めにする
    const closed = clamp((blink - 0.15) / 0.55, 0, 1);
    return clamp(1 - closed + wide * 0.4, 0, 1.2);
  };

  // ARKit の Left/Right は本人基準
  const lookRight = (g('eyeLookOutRight') + g('eyeLookInLeft')) / 2;
  const lookLeft = (g('eyeLookOutLeft') + g('eyeLookInRight')) / 2;
  const lookUp = (g('eyeLookUpLeft') + g('eyeLookUpRight')) / 2;
  const lookDown = (g('eyeLookDownLeft') + g('eyeLookDownRight')) / 2;

  const smile = (g('mouthSmileLeft') + g('mouthSmileRight')) / 2;
  const frown = (g('mouthFrownLeft') + g('mouthFrownRight')) / 2;
  const pucker = g('mouthPucker');

  return {
    yaw: rot.yaw,
    pitch: rot.pitch,
    roll: rot.roll,
    eyeL: eyeOpen(g('eyeBlinkLeft'), g('eyeWideLeft')),
    eyeR: eyeOpen(g('eyeBlinkRight'), g('eyeWideRight')),
    eyeX: clamp((lookRight - lookLeft) * 1.6, -1, 1),
    eyeY: clamp((lookUp - lookDown) * 1.6, -1, 1),
    browL: clamp(g('browInnerUp') * 0.6 + g('browOuterUpLeft') * 0.8 - g('browDownLeft') * 1.2, -1, 1),
    browR: clamp(g('browInnerUp') * 0.6 + g('browOuterUpRight') * 0.8 - g('browDownRight') * 1.2, -1, 1),
    mouthOpen: clamp((g('jawOpen') - g('mouthClose') * 0.5) * 1.8, 0, 1),
    mouthForm: clamp(smile * 1.8 - frown * 1.5 - pucker * 0.6, -1, 1),
    cheek: clamp((g('cheekSquintLeft') + g('cheekSquintRight')) / 2 * 1.5, 0, 1),
  };
}

// MediaPipe の facialTransformationMatrix(4x4, 列優先) → 本人視点の yaw/pitch/roll(deg)
export function matrixToEuler(m) {
  const r = (row, col) => m[col * 4 + row];
  const toDeg = 180 / Math.PI;
  const pitch = Math.atan2(r(2, 1), r(2, 2)) * toDeg;
  const yaw = Math.asin(clamp(-r(2, 0), -1, 1)) * toDeg;
  const roll = Math.atan2(r(1, 0), r(0, 0)) * toDeg;
  // カメラ座標系 → 本人視点に合わせる(向きがおかしい場合は設定の反転で調整可能)
  return { yaw: -yaw, pitch, roll: -roll };
}

// 正面キャリブレーション値を差し引く
export function applyCalibration(params, calib) {
  if (!calib) return params;
  return {
    ...params,
    yaw: params.yaw - (calib.yaw ?? 0),
    pitch: params.pitch - (calib.pitch ?? 0),
    roll: params.roll - (calib.roll ?? 0),
  };
}
