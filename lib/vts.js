// VTube Studio iPhone アプリ(ARKit トラッキング)からデータを受け取るクライアント。
// iPhone アプリの「3rd Party PC Clients」を ON にすると、
// PC から UDP 21412 にリクエストを送り続けている間、トラッキングデータが送られてくる。
import dgram from 'node:dgram';
import { normalizeBlendshapes, blendshapesToParams } from '../public/lib/face.js';

const PHONE_PORT = 21412;

export function parseVtsPacket(json) {
  const bs = normalizeBlendshapes(json.BlendShapes ?? []);
  const rot = json.Rotation ?? {};
  // VTS: x=ピッチ, y=ヨー, z=ロール (deg)
  const params = blendshapesToParams(bs, {
    yaw: -(rot.y ?? 0),
    pitch: -(rot.x ?? 0),
    roll: -(rot.z ?? 0),
  });
  return { faceFound: json.FaceFound !== false, params };
}

export function createVtsClient({ listenPort = 50510, onParams, onStatus }) {
  const sock = dgram.createSocket('udp4');
  let phoneIp = '';
  let timer = null;
  let lastPacket = 0;

  sock.on('message', (buf) => {
    try {
      const { faceFound, params } = parseVtsPacket(JSON.parse(buf.toString('utf8')));
      lastPacket = Date.now();
      if (faceFound) onParams(params);
    } catch {
      // 壊れたパケットは無視
    }
  });
  sock.on('error', (e) => onStatus?.({ error: e.message }));
  sock.bind(listenPort);

  const request = () => {
    if (!phoneIp) return;
    const msg = JSON.stringify({
      messageType: 'iOSTrackingDataRequest',
      time: 1.5,
      sentBy: 'vtuber-tool',
      ports: [listenPort],
    });
    sock.send(msg, PHONE_PORT, phoneIp, (err) => err && onStatus?.({ error: err.message }));
  };

  return {
    setPhoneIp(ip) {
      phoneIp = (ip || '').trim();
      clearInterval(timer);
      timer = phoneIp ? setInterval(request, 500) : null;
      request();
    },
    status() {
      return { phoneIp, connected: Date.now() - lastPacket < 1500 };
    },
    close() {
      clearInterval(timer);
      sock.close();
    },
  };
}
