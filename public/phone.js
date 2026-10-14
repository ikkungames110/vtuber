// iPhone(Safari) でカメラ映像から表情をトラッキングし、サーバーへ送信する。
import { FaceLandmarker, FilesetResolver } from '/vendor/tasks-vision/vision_bundle.mjs';
import { connect } from '/lib/ws.js';
import { normalizeBlendshapes, blendshapesToParams, matrixToEuler } from '/lib/face.js';

const video = document.getElementById('video');
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('start');
let connected = false;
const conn = connect('phone', null, (ok) => (connected = ok));

let landmarker = null;
let running = false;
let lastSend = 0;
let frames = 0;
let fps = 0;
let fpsAt = performance.now();
let faceFound = false;
let lastVideoTime = -1;

async function start() {
  startBtn.disabled = true;
  try {
    statusEl.textContent = 'カメラ起動中…';
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();

    statusEl.textContent = 'トラッキングモデル読み込み中…(初回は数秒かかります)';
    const fileset = await FilesetResolver.forVisionTasks('/vendor/tasks-vision/wasm');
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: '/cache/face_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch {
      landmarker = await FaceLandmarker.createFromOptions(fileset, opts('CPU'));
    }
    running = true;
    startBtn.textContent = 'トラッキング中';
    keepAwake();
    loop();
  } catch (e) {
    statusEl.textContent = `エラー: ${e.message ?? e}`;
    startBtn.disabled = false;
  }
}

function loop() {
  if (!running) return;
  requestAnimationFrame(loop);
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const now = performance.now();
  const res = landmarker.detectForVideo(video, now);
  frames++;
  if (now - fpsAt > 1000) {
    fps = frames;
    frames = 0;
    fpsAt = now;
    render();
  }
  const bs = res.faceBlendshapes?.[0]?.categories;
  const mat = res.facialTransformationMatrixes?.[0]?.data;
  if (!bs || !mat) {
    if (faceFound) conn.send({ type: 'face-lost' });
    faceFound = false;
    return;
  }
  faceFound = true;
  if (now - lastSend < 30) return; // 約 30Hz
  lastSend = now;
  const params = blendshapesToParams(normalizeBlendshapes(bs), matrixToEuler(mat));
  conn.send({ type: 'track', source: 'phone', params });
  window.__last = params;
}

function render() {
  const p = window.__last;
  statusEl.textContent =
    `サーバー: ${connected ? '接続中 ✅' : '未接続 ❌'}\n` +
    `顔検出: ${faceFound ? 'OK ✅' : '見つかりません'}  ${fps} fps\n` +
    (p ? `向き: 左右 ${p.yaw.toFixed(0)}° / 上下 ${p.pitch.toFixed(0)}° / 傾き ${p.roll.toFixed(0)}°\n口: ${p.mouthOpen.toFixed(2)}  目: ${p.eyeL.toFixed(2)} ${p.eyeR.toFixed(2)}` : '');
}

let wakeLock = null;
async function keepAwake() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running) keepAwake();
});

startBtn.onclick = start;
document.getElementById('calib').onclick = () => conn.send({ type: 'calibrate' });
document.getElementById('preview').onclick = (e) => {
  const hidden = video.style.display === 'none';
  video.style.display = hidden ? '' : 'none';
  e.target.textContent = hidden ? '映像を隠す' : '映像を表示';
};
