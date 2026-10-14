import { connect } from '/lib/ws.js';

const $ = (id) => document.getElementById(id);
let config = {};

const EMOTES = [
  ['joy', '😊 喜び'], ['laugh', '😆 爆笑'], ['surprised', '😲 驚き'], ['angry', '😠 怒り'],
  ['sad', '😢 悲しみ'], ['embarrassed', '😳 照れ'], ['thinking', '🤔 考え中'], ['neutral', '😐 リセット'],
];
const GESTURES = [['nod', '↕ うなずき'], ['shake', '↔ 首ふり'], ['tilt', '↗ かしげ'], ['bounce', '⤴ はしゃぐ']];

// ---------- サーバー接続 ----------
const conn = connect(
  'control',
  (msg) => {
    if (msg.type === 'config') applyConfig(msg.config);
    else if (msg.type === 'status') renderStatus(msg);
    else if (msg.type === 'track') lastTrackAt = performance.now();
  },
  (ok) => {
    $('conn').textContent = ok ? 'サーバー接続中' : 'サーバー未接続';
    $('conn').className = `pill ${ok ? 'ok' : 'ng'}`;
  },
);

let lastTrackAt = 0;
let lastStatus = null;
function renderStatus(s) {
  lastStatus = s;
  const tracking = performance.now() - lastTrackAt < 1500;
  const parts = [];
  parts.push(`Safari: ${s.clients.phone ? `接続 ${s.clients.phone} 台` : '未接続'}`);
  if (s.vts.phoneIp) parts.push(`VTube Studio: ${s.vts.connected ? '受信中' : '待機中'}`);
  parts.push(tracking ? '🟢 トラッキング受信中' : '⚪ データなし');
  $('trackStatus').textContent = parts.join(' / ');
}
setInterval(() => lastStatus && renderStatus(lastStatus), 1000);

// ---------- 設定 ----------
function applyConfig(c) {
  config = c;
  document.querySelectorAll(`input[name=mode]`).forEach((r) => (r.checked = r.value === c.mode));
  for (const el of document.querySelectorAll('[data-cfg]')) {
    if (document.activeElement === el) continue;
    if (el.type === 'checkbox') el.checked = !!c[el.id];
    else el.value = c[el.id] ?? '';
  }
  if (document.activeElement !== $('expressionMap')) $('expressionMap').value = JSON.stringify(c.expressionMap ?? {}, null, 1);
  for (const sec of document.querySelectorAll('[data-show]')) {
    sec.classList.toggle('hidden', !sec.dataset.show.split(' ').includes(c.mode));
  }
  $('modelSelect').value = [...$('modelSelect').options].some((o) => o.value === c.modelUrl) ? c.modelUrl : '';
  updateGateMarker();
}

let saveTimer;
let pending = {};
function saveConfig(patch) {
  Object.assign(pending, patch);
  Object.assign(config, patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const body = pending;
    pending = {};
    await fetch('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }, 150);
}

document.querySelectorAll('input[name=mode]').forEach((r) => (r.onchange = () => saveConfig({ mode: r.value })));
for (const el of document.querySelectorAll('[data-cfg]')) {
  el.addEventListener(el.type === 'range' || el.type === 'checkbox' ? 'input' : 'change', () => {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'range' || el.type === 'number') v = Number(v);
    saveConfig({ [el.id]: v });
    if (el.id === 'micGate') updateGateMarker();
  });
}
$('saveExpr').onclick = () => {
  try {
    saveConfig({ expressionMap: JSON.parse($('expressionMap').value || '{}') });
  } catch (e) {
    alert(`JSON の形式が正しくありません: ${e.message}`);
  }
};

// タブ切替
document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.tabbody').forEach((b) => b.classList.toggle('hidden', b.dataset.tab !== t.dataset.tab));
  };
});

// iPhone 用 URL と QR
async function loadInfo() {
  const info = await (await fetch('/api/info')).json();
  $('avatarUrl').textContent = info.avatarUrl;
  $('netWarning').textContent = info.warning ? `⚠ ${info.warning}` : '';
  $('netWarning').classList.toggle('hidden', !info.warning);
  const sel = $('phoneUrls');
  sel.innerHTML = '';
  for (const u of info.phoneUrls) sel.add(new Option(u, u));
  const setQr = () => ($('qr').src = `/api/qr.svg?text=${encodeURIComponent(sel.value)}`);
  sel.onchange = setQr;
  if (info.phoneUrls.length) setQr();
}
$('copyAvatar').onclick = () => navigator.clipboard.writeText($('avatarUrl').textContent);
$('calibrate').onclick = () => conn.send({ type: 'calibrate' });

// モデル一覧
async function loadModels() {
  const { local, default: def } = await (await fetch('/api/models')).json();
  const sel = $('modelSelect');
  sel.innerHTML = '';
  sel.add(new Option('サンプル (Haru)', def));
  for (const m of local) sel.add(new Option(decodeURIComponent(m.replace('/models/', '')), m));
  sel.add(new Option('カスタム URL', ''));
  sel.onchange = () => {
    if (!sel.value) return $('modelUrl').focus();
    $('modelUrl').value = sel.value;
    saveConfig({ modelUrl: sel.value });
  };
  sel.value = [...sel.options].some((o) => o.value === config.modelUrl) ? config.modelUrl : '';
}

async function loadLlmModels() {
  try {
    const { models } = await (await fetch('/api/llm-models')).json();
    $('llmModels').innerHTML = models.map((m) => `<option value="${m}">`).join('');
    $('emotionResult').textContent = `Ollama 接続 OK (${models.length} モデル)`;
  } catch {
    $('emotionResult').textContent = 'Ollama に接続できません (キーワード判定で動作します)';
  }
}
$('reloadLlm').onclick = loadLlmModels;

// ---------- 手動表情 ----------
function sendEmotion(emotion, gesture = 'none', intensity = 0.8) {
  conn.send({ type: 'emotion', emotion, gesture, intensity });
}
for (const [name, label] of EMOTES) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => sendEmotion(name);
  $('emotes').append(b);
}
for (const [name, label] of GESTURES) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => conn.send({ type: 'emotion', emotion: null, gesture: name });
  $('gestures').append(b);
}
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  const i = Number(e.key) - 1;
  if (i >= 0 && i < EMOTES.length) sendEmotion(EMOTES[i][0]);
});

// ---------- マイク(口パク) ----------
let audioCtx = null;
let micStream = null;
let level = 0;
let mouthForm = 0;

async function listMics() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const sel = $('micSelect');
  const cur = sel.value;
  sel.innerHTML = '<option value="">既定のマイク</option>';
  for (const d of devs.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')) {
    sel.add(new Option(d.label || 'マイク', d.deviceId));
  }
  sel.value = cur;
}

async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: $('micSelect').value ? { exact: $('micSelect').value } : undefined,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: false,
    },
  });
  audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule('/mic-worklet.js');
  const src = audioCtx.createMediaStreamSource(micStream);
  const node = new AudioWorkletNode(audioCtx, 'mic-analyser');
  node.port.onmessage = (e) => onAudio(e.data);
  src.connect(node);
  // worklet を動かし続けるために無音で出力へ繋ぐ
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  node.connect(mute).connect(audioCtx.destination);
  $('micBtn').textContent = 'マイク停止';
  $('micBtn').classList.add('on');
  listMics();
  if ($('sttOn').checked) startStt();
}

function stopMic() {
  micStream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();
  audioCtx = micStream = null;
  stopStt();
  $('micBtn').textContent = 'マイク開始';
  $('micBtn').classList.remove('on');
  $('meterBar').style.width = '0';
  conn.send({ type: 'voice', mouthOpen: 0, mouthForm: 0 });
}

$('micBtn').onclick = () => (micStream ? stopMic() : startMic().catch((e) => alert(`マイクを開けません: ${e.message}`)));

function onAudio({ rms, hiRatio }) {
  const gate = config.micGate ?? 0.02;
  const sens = config.micSensitivity ?? 1;
  const open = rms < gate ? 0 : Math.min(1, ((rms - gate) * 8 * sens) ** 0.8);
  // 口は速く開いてゆっくり閉じる
  level = open > level ? level + (open - level) * 0.7 : level + (open - level) * 0.35;
  if (open > 0) {
    // 高域が多い → い/え(横に広い口)、少ない → う/お(すぼめた口)
    const form = Math.max(-1, Math.min(1, (hiRatio - 0.12) * 6));
    mouthForm += (form - mouthForm) * 0.3;
  }
  conn.send({ type: 'voice', mouthOpen: level, mouthForm: level > 0.05 ? mouthForm : 0 });
  $('meterBar').style.width = `${Math.min(100, rms * 400)}%`;
}

function updateGateMarker() {
  $('meterGate').style.left = `${Math.min(100, (config.micGate ?? 0.02) * 400)}%`;
}

// ---------- 音声認識 → LLM で表情 ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;
let sttWanted = false;
let reqSeq = 0;
let lastAppliedSeq = 0;
let lastInterimReq = 0;
let lastInterimText = '';

function startStt() {
  if (!SR) {
    $('transcript').textContent = 'このブラウザは音声認識に対応していません (Chrome か Edge を使ってください)。口パクは動作します。';
    return;
  }
  sttWanted = true;
  recog = new SR();
  recog.lang = 'ja-JP';
  recog.continuous = true;
  recog.interimResults = true;
  recog.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        const text = r[0].transcript.trim();
        if (text) {
          showTranscript(text, '');
          // 途中結果でほぼ同じ内容を判定済みならスキップ
          if (!lastInterimText || !text.startsWith(lastInterimText) || text.length - lastInterimText.length > 4) requestEmotion(text);
        }
        lastInterimText = '';
      } else interim += r[0].transcript;
    }
    if (interim) {
      showTranscript(null, interim);
      // 話し終わる前でも、ある程度たまったら先に判定して反応を速くする
      const now = performance.now();
      if (interim.length >= 6 && now - lastInterimReq > 1500 && interim !== lastInterimText) {
        lastInterimReq = now;
        lastInterimText = interim;
        requestEmotion(interim);
      }
    }
  };
  recog.onerror = (e) => {
    if (e.error === 'not-allowed') sttWanted = false;
    if (e.error !== 'no-speech' && e.error !== 'aborted') $('emotionResult').textContent = `音声認識エラー: ${e.error}`;
  };
  recog.onend = () => sttWanted && setTimeout(() => sttWanted && recog?.start(), 200);
  recog.start();
}

function stopStt() {
  sttWanted = false;
  recog?.stop();
  recog = null;
}
$('sttOn').onchange = () => ($('sttOn').checked && micStream ? startStt() : stopStt());

let finalLines = [];
function showTranscript(finalText, interim) {
  if (finalText) finalLines = [...finalLines, finalText].slice(-2);
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  $('transcript').innerHTML = finalLines.map((l) => `<b>${esc(l)}</b>`).join('<br>') + (interim ? `<br>${esc(interim)}…` : '');
}

const EMOJI = Object.fromEntries(EMOTES.map(([k, v]) => [k, v.split(' ')[0]]));
async function requestEmotion(text) {
  const seq = ++reqSeq;
  try {
    const res = await (await fetch('/api/emotion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })).json();
    if (seq < lastAppliedSeq) return; // 古い結果は捨てる
    lastAppliedSeq = seq;
    conn.send({ type: 'emotion', ...res, text });
    $('emotionResult').textContent =
      `${EMOJI[res.emotion] ?? ''} ${res.emotion} (${res.intensity.toFixed(1)}) / ${res.gesture} — ` +
      `${res.source === 'llm' ? 'LLM' : 'キーワード'} ${res.ms}ms` + (res.error ? ` ⚠ ${res.error}` : '');
  } catch (e) {
    $('emotionResult').textContent = `判定エラー: ${e.message}`;
  }
}
$('testBtn').onclick = () => $('testText').value && requestEmotion($('testText').value);
$('testText').onkeydown = (e) => e.key === 'Enter' && $('testBtn').click();

// ---------- 初期化 ----------
config = await (await fetch('/api/config')).json();
await loadModels();
applyConfig(config);
loadInfo();
loadLlmModels();
