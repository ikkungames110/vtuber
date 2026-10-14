// VTuber ツールのローカルサーバー
//  - http://localhost:3000   … OBS / PC ブラウザ用 (avatar.html, control.html)
//  - https://<LAN IP>:3443   … iPhone 用 (phone.html: カメラ利用に HTTPS が必要)
//  - WebSocket /ws           … 各画面間のパラメータ中継
//  - POST /api/emotion       … 発言テキスト → ローカル LLM(Ollama) で表情推定
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import selfsigned from 'selfsigned';
import QRCode from 'qrcode';
import { llmEmotion, ruleEmotion } from './lib/emotion.js';
import { createVtsClient } from './lib/vts.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HTTP_PORT = Number(process.env.PORT ?? 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 3443);
const CONFIG_PATH = path.join(ROOT, 'config.json');
const MODELS_DIR = path.join(ROOT, 'models');
const CACHE_DIR = path.join(ROOT, 'cache');

const SAMPLE_MODEL_URL = 'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/haru/haru_greeter_t03.model3.json';
// 内蔵モデル (public/builtin/ の Canvas 描画モデル)
const BUILTIN_MODELS = [{ url: 'builtin:angel', name: '氷色天使 (内蔵モデル)' }];

const DEFAULT_CONFIG = {
  mode: 'tracking', // tracking | voice | hybrid
  modelUrl: BUILTIN_MODELS[0].url,
  scale: 2,
  offsetX: 0,
  offsetY: 0.5,
  mirror: true,
  invertYaw: false,
  invertPitch: false,
  invertRoll: false,
  smoothing: 0.5,
  vtsPhoneIp: '',
  ollamaUrl: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
  llmModel: 'qwen2.5:3b',
  useLlm: true,
  emotionHoldSec: 4,
  micSensitivity: 1,
  micGate: 0.02,
  expressionMap: {}, // 例: { "joy": "f01" } モデル付属の表情ファイルを使う場合
};

let config = { ...DEFAULT_CONFIG };
try {
  config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
} catch {}
const saveConfig = () => fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

// ---------- 静的ファイル ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.moc3': 'application/octet-stream',
  '.task': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

const STATIC_MOUNTS = [
  ['/vendor/pixi/', path.join(ROOT, 'node_modules/pixi.js/dist/browser')],
  ['/vendor/live2d/', path.join(ROOT, 'node_modules/pixi-live2d-display/dist')],
  ['/vendor/tasks-vision/', path.join(ROOT, 'node_modules/@mediapipe/tasks-vision')],
  ['/models/', MODELS_DIR],
  ['/', path.join(ROOT, 'public')],
];

// 再配布できない/大きいファイルは初回アクセス時にダウンロードしてキャッシュする
const REMOTE_CACHE = {
  'live2dcubismcore.min.js': 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
  'face_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
};

async function serveCached(name, res) {
  const url = REMOTE_CACHE[name];
  if (!url) return send(res, 404, 'not found');
  const file = path.join(CACHE_DIR, name);
  if (!fs.existsSync(file)) {
    const r = await fetch(url);
    if (!r.ok) return send(res, 502, `download failed: ${r.status}`);
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    console.log(`[cache] ${name} をダウンロードしました`);
  }
  serveFile(file, res);
}

function serveFile(file, res) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found');
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function serveStatic(pathname, res) {
  if (pathname === '/') pathname = '/control.html';
  for (const [prefix, dir] of STATIC_MOUNTS) {
    if (!pathname.startsWith(prefix)) continue;
    const rel = decodeURIComponent(pathname.slice(prefix.length));
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) return send(res, 403, 'forbidden');
    return serveFile(file, res);
  }
  send(res, 404, 'not found');
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
const json = (res, body, status = 200) => send(res, status, body, 'application/json; charset=utf-8');

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function listModels() {
  const found = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.model3.json')) {
        found.push('/models/' + path.relative(MODELS_DIR, p).split(path.sep).map(encodeURIComponent).join('/'));
      }
    }
  };
  walk(MODELS_DIR);
  return found;
}

// iPhone から届く可能性が高い順に並べた LAN の IPv4 アドレス
// (WSL / Hyper-V / VirtualBox などの仮想アダプタやリンクローカルは除外)
function lanAddresses() {
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return Object.entries(os.networkInterfaces())
    .filter(([name]) => !/vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|br-|veth/i.test(name))
    .flatMap(([, list]) => list ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address)
    .sort((a, b) => rank(a) - rank(b));
}

// WSL2 の NAT モードで動いているか (この場合 iPhone からサーバーに届かない)
const IS_WSL_NAT =
  os.platform() === 'linux' &&
  /microsoft/i.test(os.release()) &&
  lanAddresses().every((ip) => ip.startsWith('172.'));
const WSL_WARNING = IS_WSL_NAT
  ? 'サーバーが WSL2 の中で動いているため、iPhone から接続できません。Windows 側で起動してください (WSL のターミナルなら `npm run start:win`、または start.bat をダブルクリック)。'
  : '';

// ---------- API ----------
const history = [];

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/config' && req.method === 'GET') return json(res, config);
    if (p === '/api/config' && req.method === 'POST') {
      const patch = await readBody(req);
      config = { ...config, ...patch };
      saveConfig();
      if ('vtsPhoneIp' in patch) vts.setPhoneIp(config.vtsPhoneIp);
      broadcast({ type: 'config', config });
      return json(res, config);
    }
    if (p === '/api/models') return json(res, { builtin: BUILTIN_MODELS, local: listModels(), sample: SAMPLE_MODEL_URL });
    if (p === '/api/info') {
      return json(res, {
        phoneUrls: lanAddresses().map((ip) => `https://${ip}:${HTTPS_PORT}/phone.html`),
        avatarUrl: `http://localhost:${HTTP_PORT}/avatar.html`,
        warning: WSL_WARNING,
      });
    }
    if (p === '/api/qr.svg') {
      const svg = await QRCode.toString(url.searchParams.get('text') ?? '', { type: 'svg', margin: 1 });
      return send(res, 200, svg, 'image/svg+xml');
    }
    if (p === '/api/llm-models') {
      const r = await fetch(`${config.ollamaUrl.replace(/\/$/, '')}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const data = await r.json();
      return json(res, { models: (data.models ?? []).map((m) => m.name) });
    }
    if (p === '/api/emotion' && req.method === 'POST') {
      const { text } = await readBody(req);
      const t0 = Date.now();
      let result;
      let source = 'llm';
      let error;
      if (config.useLlm) {
        try {
          result = await llmEmotion(text, { ollamaUrl: config.ollamaUrl, model: config.llmModel, history });
        } catch (e) {
          error = e.name === 'AbortError' ? 'タイムアウト' : e.message;
        }
      }
      if (!result) {
        result = ruleEmotion(text);
        source = 'rule';
      }
      history.push(text);
      if (history.length > 5) history.shift();
      return json(res, { ...result, source, error, ms: Date.now() - t0 });
    }
    if (p.startsWith('/cache/')) return await serveCached(p.slice('/cache/'.length), res);
    serveStatic(p, res);
  } catch (e) {
    console.error(e);
    json(res, { error: e.message }, 500);
  }
}

// ---------- 証明書 (iPhone のカメラ利用に HTTPS が必須) ----------
function loadCert() {
  const dir = path.join(ROOT, 'certs');
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  const ips = lanAddresses();
  const ipsPath = path.join(dir, 'ips.txt');
  const ipsKey = ips.sort().join(',');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(ipsPath) && fs.readFileSync(ipsPath, 'utf8') === ipsKey) {
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  }
  const pems = selfsigned.generate([{ name: 'commonName', value: 'vtuber-local' }], {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [{ type: 2, value: 'localhost' }, ...['127.0.0.1', ...ips].map((ip) => ({ type: 7, ip }))],
      },
    ],
  });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(ipsPath, ipsKey);
  return { key: pems.private, cert: pems.cert };
}

// ---------- WebSocket 中継 ----------
const clients = new Set();

function broadcast(msg, filter = () => true) {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === 1 && filter(ws)) ws.send(data);
}

function statusMessage() {
  const count = (role) => [...clients].filter((c) => c.role === role).length;
  return {
    type: 'status',
    clients: { phone: count('phone'), avatar: count('avatar'), control: count('control') },
    vts: vts.status(),
  };
}

function attachWs(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.role = 'unknown';
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'config', config }));
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        ws.role = msg.role;
        broadcast(statusMessage(), (c) => c.role === 'control');
        return;
      }
      // track(iPhone) / voice(マイク) / emotion(LLM) / face-lost / calibrate(正面リセット) を他の画面へ転送
      if (['track', 'voice', 'emotion', 'face-lost', 'calibrate'].includes(msg.type)) {
        broadcast(msg, (c) => c !== ws && (c.role === 'avatar' || c.role === 'control'));
      }
    });
    ws.on('close', () => {
      clients.delete(ws);
      broadcast(statusMessage(), (c) => c.role === 'control');
    });
  });
}

const vts = createVtsClient({
  listenPort: Number(process.env.VTS_LISTEN_PORT ?? 50510),
  onParams: (params) => broadcast({ type: 'track', source: 'vts', params }, (c) => c.role === 'avatar' || c.role === 'control'),
  onStatus: (s) => s.error && console.warn('[VTS]', s.error),
});
vts.setPhoneIp(config.vtsPhoneIp);
setInterval(() => broadcast(statusMessage(), (c) => c.role === 'control'), 2000);

const httpServer = http.createServer(handle);
attachWs(httpServer);
httpServer.listen(HTTP_PORT, () => {
  console.log(`\n=== VTuber ツール起動 ===`);
  console.log(`コントロール画面 : http://localhost:${HTTP_PORT}/control.html`);
  console.log(`OBS ブラウザソース: http://localhost:${HTTP_PORT}/avatar.html`);
});

const httpsServer = https.createServer(loadCert(), handle);
attachWs(httpsServer);
httpsServer.listen(HTTPS_PORT, () => {
  for (const ip of lanAddresses()) console.log(`iPhone 用         : https://${ip}:${HTTPS_PORT}/phone.html`);
  if (WSL_WARNING) console.warn(`\n⚠ ${WSL_WARNING}\n`);
});
