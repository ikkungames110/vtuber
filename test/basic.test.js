import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVtsPacket } from '../lib/vts.js';
import { ruleEmotion, sanitize } from '../lib/emotion.js';
import { matrixToEuler } from '../public/lib/face.js';

test('VTS パケットをパラメータに変換できる', () => {
  const { params } = parseVtsPacket({
    FaceFound: true,
    Rotation: { x: 0, y: 10, z: 0 },
    BlendShapes: [{ k: 'JawOpen', v: 0.5 }, { k: 'EyeBlinkLeft', v: 1 }],
  });
  assert.ok(params.mouthOpen > 0.5);
  assert.equal(params.eyeL, 0);
  assert.equal(params.eyeR, 1);
  assert.equal(params.yaw, -10);
});

test('単位行列は正面', () => {
  const e = matrixToEuler([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  for (const v of Object.values(e)) assert.ok(Math.abs(v) < 1e-9);
});

test('キーワード判定と LLM 出力の整形', () => {
  assert.equal(ruleEmotion('うわっ、マジ!?').emotion, 'surprised');
  assert.equal(ruleEmotion('wwwww').emotion, 'laugh');
  assert.deepEqual(sanitize({ emotion: 'xxx', intensity: 8, gesture: 'nod' }), { emotion: 'neutral', intensity: 0.8, gesture: 'nod' });
});
