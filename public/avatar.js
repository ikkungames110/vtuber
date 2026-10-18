// Live2D アバター描画。OBS のブラウザソースにこのページを指定する。
// クエリ: ?bg=green (クロマキー用背景) / ?debug=1 (状態表示)
import { connect } from '/lib/ws.js';
import { EMOTION_PRESETS, gestureOffset } from '/lib/expression.js';
import { createBuiltinModel } from '/builtin/angel.js';
import { createPngModel, PNG_MODELS } from '/builtin/pngtuber.js';

const qs = new URLSearchParams(location.search);
const bg = qs.get('bg');
if (bg) document.body.style.background = bg === 'green' ? '#00ff00' : bg;
const debug = qs.has('debug');
// プレビュー用 iframe で背景を透過させる(親ページと color-scheme を合わせる)
if (debug) document.documentElement.style.colorScheme = 'dark';
const msgEl = document.getElementById('msg');
const showMsg = (text) => {
  msgEl.textContent = text;
  msgEl.style.display = text ? 'block' : 'none';
};

const app = new PIXI.Application({
  view: document.getElementById('stage'),
  resizeTo: window,
  backgroundAlpha: 0,
  antialias: true,
  autoDensity: true,
  resolution: window.devicePixelRatio || 1,
});

let config = null;
let model = null;
let loadedUrl = null;

const state = {
  track: null, // 最新のトラッキング値
  trackAt: 0,
  calib: { yaw: 0, pitch: 0, roll: 0 },
  voice: { mouthOpen: 0, mouthForm: 0 },
  voiceAt: 0,
  emotion: null, // { name, intensity, start, until }
  gesture: null, // { name, start }
  blink: { next: 0, start: -1 },
  saccade: { x: 0, y: 0, next: 0 },
};

// 現在値(スムージング後)
const cur = {
  yaw: 0, pitch: 0, roll: 0, eyeL: 1, eyeR: 1, eyeX: 0, eyeY: 0,
  browL: 0, browR: 0, mouthOpen: 0, mouthForm: 0, cheek: 0,
  eyeSmile: 0, browForm: 0, browAngle: 0, bounce: 0,
};

// ---------- 通信 ----------
connect('avatar', (msg) => {
  const now = performance.now();
  if (msg.type === 'config') applyConfig(msg.config);
  else if (msg.type === 'track') {
    state.track = msg.params;
    state.trackAt = now;
  } else if (msg.type === 'face-lost') {
    state.trackAt = 0;
  } else if (msg.type === 'voice') {
    state.voice = msg;
    state.voiceAt = now;
  } else if (msg.type === 'emotion') {
    startEmotion(msg, now);
  } else if (msg.type === 'calibrate' && state.track) {
    state.calib = { yaw: state.track.yaw, pitch: state.track.pitch, roll: state.track.roll };
  }
});

function startEmotion(msg, now) {
  const hold = (config?.emotionHoldSec ?? 4) * 1000;
  if (msg.emotion && msg.emotion !== 'neutral') {
    state.emotion = { name: msg.emotion, intensity: msg.intensity ?? 0.7, start: now, until: now + hold };
    const exp = config?.expressionMap?.[msg.emotion];
    if (model && exp) model.expression(exp);
  } else if (state.emotion) {
    state.emotion.until = Math.min(state.emotion.until, now + 600);
  }
  if (msg.gesture && msg.gesture !== 'none') state.gesture = { name: msg.gesture, start: now };
}

async function applyConfig(next) {
  config = next;
  if (config.modelUrl !== loadedUrl) await loadModel(config.modelUrl);
  layout();
}

// ---------- モデル ----------
async function loadModel(url) {
  loadedUrl = url;
  showMsg('モデル読み込み中…');
  try {
    // builtin:xxx は Canvas 描画の内蔵モデル (Live2D と同じパラメータ ID で動く)
    const m =
      url in PNG_MODELS ? createPngModel(url)
      : url.startsWith('builtin:') ? createBuiltinModel(url)
      : await PIXI.live2d.Live2DModel.from(url, { autoInteract: false });
    if (loadedUrl !== url) return m.destroy();
    if (model) {
      app.stage.removeChild(model);
      model.destroy();
    }
    model = m;
    const im = model.internalModel;
    // モーション/自動まばたきはこちらで制御するので止める
    im.motionManager.stopAllMotions();
    im.motionManager.state.shouldRequestIdleMotion = () => false;
    im.eyeBlink = undefined;
    im.on('afterMotionUpdate', () => updateParams(im.coreModel));
    model.anchor.set(0.5, model.anchorY ?? 0.5);
    app.stage.addChild(model);
    layout();
    showMsg(debug ? 'モデル読み込み完了' : '');
  } catch (e) {
    console.error(e);
    showMsg(`モデル読み込み失敗: ${e.message ?? e}`);
  }
}

function layout() {
  if (!model || !config) return;
  const w = app.renderer.screen.width;
  const h = app.renderer.screen.height;
  const base = Math.min(w / model.internalModel.width, h / model.internalModel.height) * 0.95;
  model.scale.set(base * config.scale);
  model.position.set(w / 2 + config.offsetX * w, h / 2 + config.offsetY * h + cur.bounce);
}
window.addEventListener('resize', () => setTimeout(layout, 0));

// ---------- パラメータ計算 ----------
let lastT = performance.now();

function idleMotion(t) {
  // トラッキング無しのときのゆらゆら・視線・まばたき
  const s = t / 1000;
  const speaking = performance.now() - state.voiceAt < 300 ? state.voice.mouthOpen : 0;
  if (t > state.saccade.next) {
    state.saccade = { x: (Math.random() - 0.5) * 0.6, y: (Math.random() - 0.5) * 0.3, next: t + 1200 + Math.random() * 2500 };
  }
  return {
    yaw: Math.sin(s * 0.5) * 6 + Math.sin(s * 1.3) * 2,
    pitch: Math.sin(s * 0.7 + 1) * 3 - speaking * 4,
    roll: Math.sin(s * 0.4 + 2) * 3,
    eyeL: 1, eyeR: 1,
    eyeX: state.saccade.x, eyeY: state.saccade.y,
    browL: speaking * 0.3, browR: speaking * 0.3,
    mouthOpen: 0, mouthForm: 0.1, cheek: 0,
  };
}

function blinkValue(t) {
  const b = state.blink;
  if (b.start < 0 && t > b.next) b.start = t;
  if (b.start < 0) return 1;
  const p = (t - b.start) / 160;
  if (p >= 1) {
    b.start = -1;
    b.next = t + 2000 + Math.random() * 4000;
    return 1;
  }
  return Math.abs(1 - p * 2); // 開→閉→開
}

function emotionWeight(t) {
  const e = state.emotion;
  if (!e) return 0;
  if (t > e.until + 800) {
    state.emotion = null;
    if (model && config?.expressionMap?.[e.name]) model.internalModel.motionManager.expressionManager?.resetExpression();
    return 0;
  }
  const fadeIn = Math.min(1, (t - e.start) / 250);
  const fadeOut = t > e.until ? 1 - (t - e.until) / 800 : 1;
  return Math.max(0, fadeIn * fadeOut) * (0.5 + e.intensity * 0.5);
}

function computeTarget(t) {
  const mode = config.mode;
  const trackFresh = t - state.trackAt < 600 && state.track;
  const useTrack = (mode === 'tracking' || mode === 'hybrid') && trackFresh;
  let p;
  if (useTrack) {
    const tr = state.track;
    p = { ...tr, yaw: tr.yaw - state.calib.yaw, pitch: tr.pitch - state.calib.pitch, roll: tr.roll - state.calib.roll };
  } else {
    p = idleMotion(t);
    const blink = blinkValue(t);
    p.eyeL = p.eyeR = blink;
  }

  // 音声モード、またはトラッキングが無いときはマイクの口パクを使う
  const voiceFresh = t - state.voiceAt < 300;
  if (voiceFresh && (mode === 'voice' || !useTrack)) {
    p.mouthOpen = state.voice.mouthOpen;
    p.mouthForm = state.voice.mouthForm;
  }

  p.eyeSmile = 0;
  p.browForm = 0;
  p.browAngle = 0;
  p.bounce = 0;

  // 感情オーバーレイ
  const w = emotionWeight(t);
  if (w > 0) {
    const preset = EMOTION_PRESETS[state.emotion.name] ?? {};
    const k = useTrack ? 0.6 : 1; // トラッキング中は本人の表情を優先して弱めにかける
    for (const [key, target] of Object.entries(preset)) {
      if (key === 'eyeScale') {
        p.eyeL *= 1 + (target - 1) * w * k;
        p.eyeR *= 1 + (target - 1) * w * k;
      } else if (key === 'mouthMin') {
        p.mouthOpen = Math.max(p.mouthOpen, target * w);
      } else if (key.endsWith('Add')) {
        const base = key.slice(0, -3);
        p[base] += target * w * k;
      } else {
        p[key] += (target - p[key]) * w * k;
      }
    }
  }

  // ジェスチャー
  if (state.gesture) {
    const g = gestureOffset(state.gesture.name, (t - state.gesture.start) / 1000);
    if (!g) state.gesture = null;
    else for (const [k, v] of Object.entries(g)) p[k] += v;
  }
  return p;
}

function updateParams(core) {
  if (!config) return;
  const t = performance.now();
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  const target = computeTarget(t);

  const s = Math.min(0.95, Math.max(0, config.smoothing));
  const a = 1 - Math.pow(s, dt * 20);
  const aFast = 1 - Math.pow(s * 0.6, dt * 30);
  for (const k of Object.keys(cur)) {
    const fast = k === 'mouthOpen' || k === 'eyeL' || k === 'eyeR';
    cur[k] += ((target[k] ?? 0) - cur[k]) * (fast ? aFast : a);
  }

  const mir = config.mirror;
  const sx = (mir ? 1 : -1) * (config.invertYaw ? -1 : 1);
  const sy = config.invertPitch ? -1 : 1;
  const sz = (mir ? -1 : 1) * (config.invertRoll ? -1 : 1);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const set = (id, v) => core.setParameterValueById(id, v);

  const ax = clamp(cur.yaw * sx, -30, 30);
  const ay = clamp(cur.pitch * sy, -30, 30);
  const az = clamp(cur.roll * sz, -30, 30);
  set('ParamAngleX', ax);
  set('ParamAngleY', ay);
  set('ParamAngleZ', az);
  set('ParamBodyAngleX', ax * 0.3);
  set('ParamBodyAngleY', ay * 0.2);
  set('ParamBodyAngleZ', az * 0.3);

  // ミラー時は本人の右目 → モデルの左目(画面右側)
  const [eL, eR] = mir ? [cur.eyeR, cur.eyeL] : [cur.eyeL, cur.eyeR];
  const [bL, bR] = mir ? [cur.browR, cur.browL] : [cur.browL, cur.browR];
  set('ParamEyeLOpen', clamp(eL, 0, 1.2));
  set('ParamEyeROpen', clamp(eR, 0, 1.2));
  set('ParamEyeLSmile', clamp(cur.eyeSmile, 0, 1));
  set('ParamEyeRSmile', clamp(cur.eyeSmile, 0, 1));
  set('ParamEyeBallX', clamp(cur.eyeX * sx, -1, 1));
  set('ParamEyeBallY', clamp(cur.eyeY, -1, 1));
  set('ParamBrowLY', clamp(bL, -1, 1));
  set('ParamBrowRY', clamp(bR, -1, 1));
  set('ParamBrowLForm', clamp(cur.browForm, -1, 1));
  set('ParamBrowRForm', clamp(cur.browForm, -1, 1));
  set('ParamBrowLAngle', clamp(cur.browAngle, -1, 1));
  set('ParamBrowRAngle', clamp(cur.browAngle, -1, 1));
  set('ParamMouthOpenY', clamp(cur.mouthOpen, 0, 1));
  set('ParamMouthForm', clamp(cur.mouthForm, -1, 1));
  set('ParamCheek', clamp(cur.cheek, 0, 1));

  if (model) model.y = app.renderer.screen.height / 2 + config.offsetY * app.renderer.screen.height + cur.bounce;
  if (debug) showMsg(`mode=${config.mode} track=${t - state.trackAt < 600 ? 'ON' : 'off'} emotion=${state.emotion?.name ?? '-'}`);
}

window.__avatar = { state, cur };
