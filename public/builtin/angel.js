// 内蔵モデル「氷色天使」(designs の設定画 4 番: クリーム×白の天使系)
// Live2D (Cubism) と同じパラメータ ID (ParamAngleX, ParamEyeLOpen, ParamMouthOpenY …) で動く、
// Canvas 2D でパーツごとに描画・変形するアバター。avatar.js からは Live2DModel と同じように扱える。
//
// パーツ構成 (奥 → 手前)
//   天使の輪(奥) / 後ろ髪 / 体 (フード・コート・シャツ・リボン・ベルト・ぬいぐるみ) / 首
//   顔 / 頬 / 目 / 口 / 前髪・横髪 / 髪飾り / 眉 / 天使の輪(手前)
// 物理演算 (ばね) で髪・髪飾り・天使の輪・ぬいぐるみ・コートが揺れる。

const W = 1000;
const H = 1400; // 実際に描画する範囲 (頭〜腰)
const VIRTUAL_H = 2400; // レイアウト計算上の全身の高さ (Haru と同じ感覚で scale / offset を使えるように)
const CENTER_Y = VIRTUAL_H / 2;

const C = {
  skin: '#fdf0ea',
  skinShade: '#f3d6d0',
  hair: '#f7f8fc',
  hairMid: '#e6ebf5',
  hairShade: '#cdd6e8',
  hairDeep: '#b3bed6',
  hairLine: '#aeb9d1',
  iris1: '#34508e',
  iris2: '#5f8fd8',
  iris3: '#b7dcff',
  lash: '#3c4560',
  white: '#ffffff',
  cloth: '#fbfcff',
  clothShade: '#dfe7f4',
  clothLine: '#b9c5dc',
  blue: '#8fb2ea',
  blueDeep: '#5b7cc0',
  lining: '#c9daf4',
  gold: '#e3cd8c',
  goldDeep: '#b99a52',
  black: '#2d3142',
  mouth: '#b8566a',
  tongue: '#f0a0aa',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const TAU = Math.PI * 2;

class Spring {
  constructor(k = 70, d = 9) {
    this.k = k;
    this.d = d;
    this.x = 0;
    this.v = 0;
  }
  step(target, dt) {
    this.v += ((target - this.x) * this.k - this.v * this.d) * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

export const BUILTIN_MODELS = { 'builtin:angel': '氷色天使 (内蔵モデル)' };

export function createBuiltinModel(url) {
  if (!(url in BUILTIN_MODELS)) throw new Error(`内蔵モデルが見つかりません: ${url}`);
  return new AngelModel();
}

// Live2DModel の代わりに使う PIXI.Sprite。毎フレーム Canvas に描き直してテクスチャを更新する。
class AngelModel extends PIXI.Sprite {
  constructor() {
    const res = Number(new URLSearchParams(location.search).get('res')) || 1.5;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * res);
    canvas.height = Math.round(H * res);
    super(new PIXI.Texture(new PIXI.BaseTexture(canvas, { resolution: res })));
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.res = res;
    // anchor は描画範囲ではなく仮想の全身の中心に合わせる
    this.anchorY = CENTER_Y / H;

    const params = Object.create(null);
    const listeners = [];
    this.params = params;
    this.internalModel = {
      width: W,
      height: VIRTUAL_H,
      coreModel: {
        setParameterValueById: (id, v) => (params[id] = v),
        getParameterValueById: (id) => params[id] ?? 0,
      },
      motionManager: { stopAllMotions() {}, state: {}, expressionManager: null },
      on: (ev, fn) => ev === 'afterMotionUpdate' && listeners.push(fn),
    };
    this.listeners = listeners;
    this.phys = {
      hairX: new Spring(55, 7),
      hairY: new Spring(60, 8),
      accX: new Spring(35, 4),
      accY: new Spring(40, 5),
      haloX: new Spring(25, 5),
      haloY: new Spring(25, 5),
      bodyX: new Spring(40, 7),
    };
    this.time = 0;
    this.lastY = null;
    this.tick = () => this.update(PIXI.Ticker.shared.elapsedMS / 1000);
    PIXI.Ticker.shared.add(this.tick);
  }

  expression() {} // 表情ファイルは無し (パラメータで表情を作る)

  destroy() {
    PIXI.Ticker.shared.remove(this.tick);
    super.destroy({ texture: true, baseTexture: true });
  }

  update(dt) {
    dt = clamp(dt, 0.001, 0.05);
    this.time += dt;
    for (const fn of this.listeners) fn();
    this.draw(dt);
    this.texture.baseTexture.update();
  }

  p(id, def = 0) {
    return this.params[id] ?? def;
  }

  draw(dt) {
    const ctx = this.ctx;
    const t = this.time;

    const P = {
      ax: clamp(this.p('ParamAngleX') / 30, -1, 1),
      ay: clamp(this.p('ParamAngleY') / 30, -1, 1),
      az: clamp(this.p('ParamAngleZ'), -30, 30),
      bx: clamp(this.p('ParamBodyAngleX') / 10, -1, 1),
      bz: clamp(this.p('ParamBodyAngleZ'), -10, 10),
      eyeL: clamp(this.p('ParamEyeLOpen', 1), 0, 1.2),
      eyeR: clamp(this.p('ParamEyeROpen', 1), 0, 1.2),
      smileL: clamp(this.p('ParamEyeLSmile'), 0, 1),
      smileR: clamp(this.p('ParamEyeRSmile'), 0, 1),
      ballX: clamp(this.p('ParamEyeBallX'), -1, 1),
      ballY: clamp(this.p('ParamEyeBallY'), -1, 1),
      browLY: clamp(this.p('ParamBrowLY'), -1, 1),
      browRY: clamp(this.p('ParamBrowRY'), -1, 1),
      browLForm: clamp(this.p('ParamBrowLForm'), -1, 1),
      browRForm: clamp(this.p('ParamBrowRForm'), -1, 1),
      browLAngle: clamp(this.p('ParamBrowLAngle'), -1, 1),
      browRAngle: clamp(this.p('ParamBrowRAngle'), -1, 1),
      mouthOpen: clamp(this.p('ParamMouthOpenY'), 0, 1),
      mouthForm: clamp(this.p('ParamMouthForm'), -1, 1),
      cheek: clamp(this.p('ParamCheek'), 0, 1),
      breath: (Math.sin((t * TAU) / 3.6) + 1) / 2,
    };

    // ---- 物理演算 ----
    // 画面上の上下移動 (ジャンプなど) も揺れに使う
    const sy = this.scale.y || 1;
    const y = this.y / sy;
    const vy = this.lastY == null ? 0 : (y - this.lastY) / dt;
    this.lastY = y;
    const headX = P.ax * 30 + P.az * 1.6 + P.bx * 12;
    const headY = -P.ay * 16;
    const ph = this.phys;
    ph.hairX.step(headX, dt);
    ph.hairY.step(headY, dt);
    ph.hairY.v -= vy * dt * 0.6;
    ph.accX.step(headX, dt);
    ph.accY.step(headY, dt);
    ph.accY.v -= vy * dt * 0.8;
    ph.haloX.step(headX, dt);
    ph.haloY.step(headY, dt);
    ph.haloY.v -= vy * dt * 0.5;
    ph.bodyX.step(P.bx * 15 + P.bz * 2, dt);
    const wind = Math.sin(t * 1.3) * 2 + Math.sin(t * 2.9 + 1) * 1;
    P.hairSwayX = clamp(ph.hairX.x - headX, -40, 40) + wind;
    P.hairSwayY = clamp(ph.hairY.x - headY, -30, 30);
    P.accSwayX = clamp(ph.accX.x - headX, -60, 60) + wind * 1.5;
    P.accSwayY = clamp(ph.accY.x - headY, -40, 40);
    P.haloSwayX = clamp(ph.haloX.x - headX, -50, 50);
    P.haloSwayY = clamp(ph.haloY.x - headY, -40, 40) + Math.sin(t * 1.7) * 5;
    P.coatSway = clamp(ph.bodyX.x - (P.bx * 15 + P.bz * 2), -30, 30) + Math.sin(t * 1.1) * 1.5;
    P.t = t;

    ctx.setTransform(this.res, 0, 0, this.res, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // 頭のトランスフォーム: 首の付け根を中心に傾き、体と一緒に動く
    const bodyShiftX = P.bx * 14;
    const headTf = () => {
      ctx.translate(500 + bodyShiftX + P.ax * 6, 640 - P.breath * 3);
      ctx.rotate((-P.az * Math.PI) / 180);
      ctx.translate(-500, -640);
    };
    const bodyTf = () => {
      ctx.translate(500 + bodyShiftX, 1500);
      ctx.rotate((-P.bz * Math.PI) / 180);
      ctx.translate(-500, -1500);
    };

    ctx.save();
    headTf();
    drawHalo(ctx, P, 'back');
    drawBackHair(ctx, P);
    ctx.restore();

    ctx.save();
    bodyTf();
    drawBody(ctx, P);
    ctx.restore();

    ctx.save();
    headTf();
    drawFace(ctx, P);
    drawFrontHair(ctx, P);
    drawHairClip(ctx, P);
    drawBrows(ctx, P);
    drawHalo(ctx, P, 'front');
    ctx.restore();

    // 腰から下はフェードアウト (スケールを小さくしたときに切れ目が目立たないように)
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const g = ctx.createLinearGradient(0, H - 160, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H - 160, W, 160);
    ctx.restore();
  }
}

// ---------- 共通パーツ ----------
function circles(ctx, list, off = () => [0, 0]) {
  ctx.beginPath();
  for (const [x, y, r] of list) {
    const [dx, dy] = off(x, y);
    ctx.moveTo(x + dx + r, y + dy);
    ctx.arc(x + dx, y + dy, r, 0, TAU);
  }
}

// 根元 (rx, ry) 幅 w から 先端 (tx, ty) へ伸びる毛束。bend で先端がカールする
function strandPath(ctx, rx, ry, tx, ty, w, bend = 0) {
  const L = ty - ry;
  ctx.moveTo(rx - w / 2, ry);
  ctx.bezierCurveTo(rx - w / 2, ry + L * 0.4, tx - w * 0.3 + bend, ty - L * 0.3, tx, ty);
  ctx.bezierCurveTo(tx + w * 0.25 + bend * 1.2, ty - L * 0.4, rx + w / 2, ry + L * 0.45, rx + w / 2, ry);
}

function bezierPoint(p0, [c1x, c1y, c2x, c2y], p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p0[0] + b * c1x + c * c2x + d * p3[0], a * p0[1] + b * c1y + c * c2y + d * p3[1]];
}

function star(ctx, x, y, r, inner = 0.38, points = 4, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points - Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

// ---------- 天使の輪 ----------
function drawHalo(ctx, P, layer) {
  const cx = 500 + P.ax * 26 + P.haloSwayX * 0.8;
  const cy = 118 - P.ay * 14 + P.haloSwayY * 0.6;
  const rot = -0.14 + P.haloSwayX * 0.004;
  const [a0, a1] = layer === 'back' ? [Math.PI, TAU] : [0, Math.PI];
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  const ring = (w, color) => {
    ctx.beginPath();
    ctx.ellipse(0, 0, 138, 30, 0, a0, a1);
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  ring(26, 'rgba(170,205,255,0.18)');
  ring(14, 'rgba(190,215,255,0.45)');
  ring(8, 'rgba(236,244,255,0.95)');
  ring(2.5, '#ffffff');
  if (layer === 'front') {
    // 輪の右端の星
    const sx = 132;
    const sy = -6;
    const tw = 1 + Math.sin(P.t * 3) * 0.08;
    ctx.fillStyle = 'rgba(255,240,190,0.35)';
    star(ctx, sx, sy, 40 * tw, 0.3);
    ctx.fill();
    ctx.fillStyle = '#fff6d6';
    ctx.strokeStyle = C.goldDeep;
    ctx.lineWidth = 2;
    star(ctx, sx, sy, 28 * tw, 0.32);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    star(ctx, sx - 3, sy - 3, 9, 0.4);
    ctx.fill();
    // 小さなきらめき
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    star(ctx, -150, 22, 9 + Math.sin(P.t * 2.3) * 3, 0.3);
    ctx.fill();
  }
  ctx.restore();
}

// ---------- 後ろ髪 ----------
const BACK_HAIR = [
  [500, 272, 142], [405, 270, 110], [595, 270, 110], [345, 345, 92], [655, 345, 92],
  [325, 440, 82], [675, 440, 82], [335, 525, 68], [665, 525, 68], [365, 590, 50], [635, 590, 50],
  [420, 600, 40], [580, 600, 40], [300, 470, 60], [700, 470, 60],
];

function drawBackHair(ctx, P) {
  const ox = -P.ax * 14;
  const oy = P.ay * 8;
  const off = (x, y) => {
    const k = clamp((y - 250) / 350, 0, 1);
    return [ox + P.hairSwayX * k * 0.9, oy + P.hairSwayY * k * 0.5];
  };
  ctx.fillStyle = C.hairLine;
  circles(ctx, BACK_HAIR.map(([x, y, r]) => [x, y + 2, r + 2.5]), off);
  ctx.fill();
  const g = ctx.createLinearGradient(0, 150, 0, 650);
  g.addColorStop(0, C.hair);
  g.addColorStop(1, '#dbe2ef');
  ctx.fillStyle = g;
  circles(ctx, BACK_HAIR, off);
  ctx.fill();
  // 毛先のカール
  ctx.fillStyle = C.hairShade;
  ctx.strokeStyle = C.hairLine;
  ctx.lineWidth = 2;
  for (const [x, y, dir] of [[318, 600, -1], [682, 600, 1], [385, 640, -1], [615, 640, 1]]) {
    const [dx, dy] = off(x, y);
    ctx.beginPath();
    strandPath(ctx, x + dx, y - 50 + dy, x + dx + dir * 22, y + 45 + dy, 46, dir * 20);
    ctx.fill();
    ctx.stroke();
  }
}

// ---------- 体 ----------
function drawBody(ctx, P) {
  const br = P.breath * 4; // 呼吸で肩が上下
  const sw = P.coatSway;

  // フード (背中側に垂れている)
  ctx.fillStyle = C.lining;
  ctx.strokeStyle = C.clothLine;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(300, 760 - br);
  ctx.bezierCurveTo(290, 640, 380, 600, 500, 600);
  ctx.bezierCurveTo(620, 600, 710, 640, 700, 760 - br);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 首
  ctx.fillStyle = C.skin;
  ctx.beginPath();
  ctx.moveTo(458, 540);
  ctx.lineTo(456, 690);
  ctx.lineTo(544, 690);
  ctx.lineTo(542, 540);
  ctx.closePath();
  ctx.fill();
  let g = ctx.createLinearGradient(0, 560, 0, 640);
  g.addColorStop(0, C.skinShade);
  g.addColorStop(1, 'rgba(243,214,208,0)');
  ctx.fillStyle = g;
  ctx.fillRect(455, 560, 90, 80);
  // チョーカー
  ctx.fillStyle = C.black;
  ctx.beginPath();
  ctx.moveTo(455, 628);
  ctx.quadraticCurveTo(500, 640, 545, 628);
  ctx.lineTo(545, 650);
  ctx.quadraticCurveTo(500, 662, 455, 650);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#c9d2e3';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(500, 662, 7, 0, TAU);
  ctx.stroke();

  // シャツ
  ctx.fillStyle = C.cloth;
  ctx.strokeStyle = C.clothLine;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(380, 700 - br);
  ctx.quadraticCurveTo(500, 670 - br, 620, 700 - br);
  ctx.lineTo(640, 1400);
  ctx.lineTo(360, 1400);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  g = ctx.createLinearGradient(380, 0, 620, 0);
  g.addColorStop(0, 'rgba(201,218,244,0.7)');
  g.addColorStop(0.3, 'rgba(201,218,244,0)');
  g.addColorStop(0.7, 'rgba(201,218,244,0)');
  g.addColorStop(1, 'rgba(201,218,244,0.7)');
  ctx.fillStyle = g;
  ctx.fill();
  // 前立てとボタン
  ctx.strokeStyle = C.clothLine;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(500, 760);
  ctx.lineTo(500, 1180);
  ctx.stroke();
  ctx.fillStyle = C.gold;
  for (const by of [880, 960, 1040, 1120]) {
    ctx.beginPath();
    ctx.arc(512, by, 6, 0, TAU);
    ctx.fill();
  }
  // 襟
  ctx.fillStyle = C.white;
  ctx.strokeStyle = C.clothLine;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(500, 690 - br);
    ctx.lineTo(500 + s * 62, 668 - br);
    ctx.lineTo(500 + s * 50, 745 - br);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // ベルトと前垂れ
  ctx.fillStyle = C.lining;
  ctx.strokeStyle = C.clothLine;
  ctx.beginPath();
  ctx.moveTo(468, 1200);
  ctx.lineTo(532, 1200);
  ctx.lineTo(540 + sw * 0.3, 1400);
  ctx.lineTo(460 + sw * 0.3, 1400);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.black;
  ctx.beginPath();
  ctx.moveTo(368, 1175);
  ctx.quadraticCurveTo(500, 1195, 632, 1175);
  ctx.lineTo(633, 1210);
  ctx.quadraticCurveTo(500, 1230, 367, 1210);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#d6dbe6';
  ctx.lineWidth = 5;
  ctx.strokeRect(478, 1182, 44, 34);
  // ベルトのチェーン
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(530, 1215);
  ctx.quadraticCurveTo(580 + sw * 0.5, 1275, 625, 1220);
  ctx.stroke();

  // コート (左右)
  for (const s of [-1, 1]) drawCoatPanel(ctx, s, br, sw);

  // ぬいぐるみ (うさぎ) をベルトから下げる
  drawPlush(ctx, 415 + sw * 0.8, 1265, sw);

  // リボン
  drawRibbon(ctx, 500, 712 - br, P);
}

function drawCoatPanel(ctx, s, br, sw) {
  const X = (x) => 500 + s * x;
  const hem = sw * 0.8;
  ctx.fillStyle = C.cloth;
  ctx.strokeStyle = C.clothLine;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(X(70), 660 - br);
  ctx.bezierCurveTo(X(150), 670 - br, X(220), 690 - br, X(250), 740 - br);
  ctx.bezierCurveTo(X(300), 820, X(330), 1050, X(370) + hem, 1400);
  ctx.lineTo(X(105) + hem * 0.5, 1400);
  ctx.bezierCurveTo(X(110), 1200, X(105), 900, X(78), 760 - br);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 陰影
  const g = ctx.createLinearGradient(X(80), 0, X(370), 0);
  g.addColorStop(0, 'rgba(201,218,244,0.15)');
  g.addColorStop(1, 'rgba(180,200,235,0.55)');
  ctx.fillStyle = g;
  ctx.fill();
  // 前端の水色の裏地と金のライン
  ctx.fillStyle = C.lining;
  ctx.beginPath();
  ctx.moveTo(X(70), 660 - br);
  ctx.bezierCurveTo(X(100), 700, X(80), 740, X(78), 760 - br);
  ctx.bezierCurveTo(X(105), 900, X(110), 1200, X(105) + hem * 0.5, 1400);
  ctx.lineTo(X(130) + hem * 0.5, 1400);
  ctx.bezierCurveTo(X(132), 1200, X(128), 900, X(100), 760);
  ctx.bezierCurveTo(X(120), 720, X(110), 690, X(70), 660 - br);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(X(100), 760);
  ctx.bezierCurveTo(X(128), 900, X(132), 1200, X(130) + hem * 0.5, 1400);
  ctx.stroke();
  // しわ
  ctx.strokeStyle = 'rgba(160,180,215,0.55)';
  ctx.lineWidth = 2;
  for (const [x0, y0, x1, y1] of [[200, 820, 240, 1100], [160, 900, 175, 1250], [270, 900, 320, 1300], [230, 1150, 260, 1400]]) {
    ctx.beginPath();
    ctx.moveTo(X(x0), y0);
    ctx.quadraticCurveTo(X((x0 + x1) / 2 + 10), (y0 + y1) / 2, X(x1) + hem * ((y1 - 700) / 700), y1);
    ctx.stroke();
  }
  // 肩の飾り (金のボタンと水色のタブ)
  ctx.fillStyle = C.blue;
  ctx.strokeStyle = C.blueDeep;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(150), 680 - br);
  ctx.lineTo(X(225), 712 - br);
  ctx.lineTo(X(215), 735 - br);
  ctx.lineTo(X(140), 702 - br);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.gold;
  ctx.beginPath();
  ctx.arc(X(205), 718 - br, 7, 0, TAU);
  ctx.fill();
}

function drawRibbon(ctx, x, y, P) {
  const sw = P.coatSway * 0.6;
  ctx.fillStyle = C.blue;
  ctx.strokeStyle = C.blueDeep;
  ctx.lineWidth = 2.5;
  // 垂れ
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + s * 6, y + 8);
    ctx.quadraticCurveTo(x + s * 30 + sw, y + 70, x + s * 22 + sw * 1.4, y + 128);
    ctx.lineTo(x + s * 40 + sw * 1.4, y + 118);
    ctx.quadraticCurveTo(x + s * 40 + sw, y + 60, x + s * 14, y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  // 輪
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + s * 30, y - 38, x + s * 70, y - 22, x + s * 62, y + 6);
    ctx.bezierCurveTo(x + s * 56, y + 30, x + s * 25, y + 18, x, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.moveTo(x + s * 18, y - 12);
    ctx.quadraticCurveTo(x + s * 40, y - 24, x + s * 54, y - 8);
    ctx.stroke();
    ctx.strokeStyle = C.blueDeep;
  }
  ctx.beginPath();
  ctx.ellipse(x, y + 2, 13, 15, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  // 金の十字のペンダント
  const px = x + sw * 0.5;
  const py = y + 42;
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + 16);
  ctx.lineTo(px, py - 14);
  ctx.stroke();
  ctx.fillStyle = C.gold;
  ctx.strokeStyle = C.goldDeep;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(px - 4, py - 14, 8, 36);
  ctx.rect(px - 13, py - 5, 26, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#a9c8f5';
  ctx.beginPath();
  ctx.arc(px, py - 1, 4, 0, TAU);
  ctx.fill();
}

function drawPlush(ctx, x, y, sw) {
  ctx.save();
  ctx.translate(x, y - 50);
  ctx.rotate(-sw * 0.01 + Math.sin(performance.now() / 900) * 0.05);
  ctx.strokeStyle = '#c9d2e3';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.lineTo(0, 20);
  ctx.stroke();
  ctx.translate(0, 55);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = C.clothLine;
  ctx.lineWidth = 2;
  // 耳
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * 13, -38, 9, 22, s * 0.25, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  // 体と顔
  ctx.beginPath();
  ctx.ellipse(0, 26, 24, 20, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -4, 28, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.lash;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * 10, -6, 3.2, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(245,170,185,0.6)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * 17, 3, 5, 3, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = C.blue;
  ctx.beginPath();
  ctx.moveTo(0, 20);
  ctx.lineTo(-12, 12);
  ctx.lineTo(-12, 28);
  ctx.closePath();
  ctx.moveTo(0, 20);
  ctx.lineTo(12, 12);
  ctx.lineTo(12, 28);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------- 顔 ----------
function drawFace(ctx, P) {
  const { ax, ay } = P;
  // 輪郭: 上ほど動きが小さく、あごほど横を向く
  const fp = (x, y) => {
    const k = clamp((y - 300) / 300, 0, 1);
    const side = (x - 500) / 150; // -1..1
    // 向いた側の反対の頬を少し狭くして立体感を出す
    const squash = 1 - Math.abs(ax) * 0.06 * (Math.sign(side) === Math.sign(-ax) ? 1 : 0.2);
    return [500 + (x - 500) * squash + ax * (8 + k * 16), y - ay * (6 + k * 8)];
  };
  const path = [
    ['M', 350, 250],
    ['L', 350, 340],
    ['C', 352, 430, 362, 495, 405, 545],
    ['C', 438, 578, 472, 597, 500, 599],
    ['C', 528, 597, 562, 578, 595, 545],
    ['C', 638, 495, 648, 430, 650, 340],
    ['L', 650, 250],
  ];
  ctx.beginPath();
  for (const [cmd, ...v] of path) {
    const pts = [];
    for (let i = 0; i < v.length; i += 2) pts.push(...fp(v[i], v[i + 1]));
    if (cmd === 'M') ctx.moveTo(...pts);
    else if (cmd === 'L') ctx.lineTo(...pts);
    else ctx.bezierCurveTo(...pts);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 300, 0, 600);
  g.addColorStop(0, C.skin);
  g.addColorStop(1, '#fff6f2');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#e6c2bb';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.save();
  ctx.clip();
  // 前髪の影
  const hs = ctx.createLinearGradient(0, 330, 0, 420);
  hs.addColorStop(0, 'rgba(226,190,196,0.75)');
  hs.addColorStop(1, 'rgba(226,190,196,0)');
  ctx.fillStyle = hs;
  ctx.fillRect(300, 250, 400, 180);
  // 横顔側の影
  const sh = ctx.createLinearGradient(330, 0, 670, 0);
  sh.addColorStop(0, `rgba(240,200,200,${0.35 + Math.max(0, ax) * 0.3})`);
  sh.addColorStop(0.25, 'rgba(240,200,200,0)');
  sh.addColorStop(0.75, 'rgba(240,200,200,0)');
  sh.addColorStop(1, `rgba(240,200,200,${0.35 + Math.max(0, -ax) * 0.3})`);
  ctx.fillStyle = sh;
  ctx.fillRect(300, 250, 400, 360);
  ctx.restore();

  const fx = ax * 30;
  const fy = -ay * 18;

  // 頬
  const blush = 0.22 + P.cheek * 0.55;
  for (const s of [-1, 1]) {
    const cx = 500 + s * 92 + fx * (1 - s * ax * 0.3) * 0.9;
    const cy = 522 + fy;
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 52);
    rg.addColorStop(0, `rgba(250,150,170,${blush})`);
    rg.addColorStop(1, 'rgba(250,150,170,0)');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 56, 34, 0, 0, TAU);
    ctx.fill();
    if (P.cheek > 0.45) {
      ctx.strokeStyle = `rgba(225,110,130,${(P.cheek - 0.45) * 1.4})`;
      ctx.lineWidth = 2.2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(cx - 20 + i * 14, cy + 8);
        ctx.lineTo(cx - 12 + i * 14, cy - 8);
        ctx.stroke();
      }
    }
  }

  // 目 (向いている側の目は大きく、奥の目は小さく)
  drawEye(ctx, 422 + fx - ax * 4, 455 + fy, 1 + ax * 0.1, P.eyeL, P.smileL, P, -1);
  drawEye(ctx, 578 + fx - ax * 4, 455 + fy, 1 - ax * 0.1, P.eyeR, P.smileR, P, 1);

  // 鼻
  ctx.strokeStyle = '#e3b0a8';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(503 + fx * 1.1, 500 + fy);
  ctx.lineTo(499 + fx * 1.1, 508 + fy);
  ctx.stroke();

  drawMouth(ctx, 500 + fx * 0.95, 549 + fy * 0.9, P);
}

function drawEye(ctx, cx, cy, scale, open, smile, P, s) {
  const w = 104 * scale;
  const h = 118;
  const o = clamp(open, 0, 1.2);
  // 閉じた目の形: 普通は下向きの弧 (︶)、笑顔は上向きの弧 (︵)
  const sag = h * 0.13 * (1 - Math.min(1, o)) * (1 - 2 * smile);
  const O = [cx + s * 0.5 * w, cy - 0.06 * h]; // 目尻
  const I = [cx - s * 0.46 * w, cy + 0.08 * h]; // 目頭
  // 笑うと上まぶたが少し下がり、下まぶたが持ち上がる
  const topY1 = cy - 0.62 * h * o * (1 - 0.55 * smile) + sag;
  const topY2 = cy - 0.68 * h * o * (1 - 0.55 * smile) + sag;
  const botY = Math.max(cy + 0.44 * h * clamp(o * 1.3, 0, 1) - smile * 0.8 * h + sag, Math.max(topY1, topY2));
  const e = clamp((botY - Math.min(topY1, topY2)) / (1.1 * h), 0, 1.2); // 実際の開き具合
  const top = [cx + s * 0.4 * w, topY1, cx - s * 0.22 * w, topY2];
  const bot = [cx - s * 0.24 * w, botY, cx + s * 0.32 * w, botY - 0.04 * h];

  ctx.save();
  if (e > 0.02) {
    ctx.beginPath();
    ctx.moveTo(...O);
    ctx.bezierCurveTo(...top, ...I);
    ctx.bezierCurveTo(...bot, ...O);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    // 白目
    ctx.fillStyle = '#fdfdff';
    ctx.fillRect(cx - w, cy - h, w * 2, h * 2);
    // 瞳 (視線で移動)
    const ix = cx + P.ballX * 0.2 * w;
    const iy = cy - smile * 0.14 * h - P.ballY * 0.13 * h;
    const rx = 0.34 * w;
    const ry = 0.47 * h;
    const ig = ctx.createLinearGradient(0, iy - ry, 0, iy + ry);
    ig.addColorStop(0, C.iris1);
    ig.addColorStop(0.45, C.iris2);
    ig.addColorStop(1, C.iris3);
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.ellipse(ix, iy, rx, ry, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#2c437a';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // 瞳孔
    ctx.fillStyle = 'rgba(30,45,90,0.85)';
    ctx.beginPath();
    ctx.ellipse(ix, iy - 0.06 * h, rx * 0.42, ry * 0.42, 0, 0, TAU);
    ctx.fill();
    // 下側の反射 (氷のようなきらめき)
    const lg = ctx.createRadialGradient(ix, iy + ry * 0.55, 0, ix, iy + ry * 0.55, rx);
    lg.addColorStop(0, 'rgba(225,245,255,0.9)');
    lg.addColorStop(1, 'rgba(225,245,255,0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.ellipse(ix, iy + ry * 0.5, rx * 0.8, ry * 0.45, 0, 0, TAU);
    ctx.fill();
    // ハイライト
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ix - s * 0.12 * w - 0.05 * w, iy - 0.2 * h, 0.1 * w, 0.085 * h, -0.4, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ix + 0.13 * w, iy + 0.16 * h, 0.04 * w, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    star(ctx, ix + 0.08 * w, iy - 0.05 * h, 0.05 * w, 0.35, 4);
    ctx.fill();
    // 上まぶたの影
    const sg = ctx.createLinearGradient(0, Math.min(topY1, topY2) - 6, 0, Math.min(topY1, topY2) + 0.3 * h);
    sg.addColorStop(0, 'rgba(80,100,160,0.45)');
    sg.addColorStop(1, 'rgba(80,100,160,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(cx - w, cy - h, w * 2, h * 2);
    ctx.restore();

    // 下まつげ
    ctx.strokeStyle = 'rgba(120,125,160,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(O[0] - s * 4, O[1] + 6);
    ctx.bezierCurveTo(bot[2], bot[3] + 2, bot[0] + s * 18, bot[1] + 2, I[0] + s * 18, I[1] + 4);
    ctx.stroke();
  }

  // 上まつげ (目尻側が太い)
  ctx.strokeStyle = C.lash;
  ctx.fillStyle = C.lash;
  ctx.lineWidth = 5.5;
  ctx.beginPath();
  ctx.moveTo(...O);
  ctx.bezierCurveTo(...top, ...I);
  ctx.stroke();
  ctx.lineWidth = 3;
  // 目尻側を太く
  ctx.lineWidth = 8.5;
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) ctx.lineTo(...bezierPoint(O, top, I, (i / 8) * 0.38));
  ctx.stroke();
  // 二重まぶたの線
  if (e > 0.3) {
    ctx.strokeStyle = 'rgba(200,150,150,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(O[0] - s * 10, O[1] - 18);
    ctx.quadraticCurveTo(cx, Math.min(topY1, topY2) - 16, I[0] + s * 20, I[1] - 0.45 * h * e);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMouth(ctx, x, y, P) {
  const o = P.mouthOpen;
  const f = P.mouthForm;
  const hw = 13 + f * 4 + o * 4; // 口の半幅
  const cornerY = y - f * 6;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#b06a70';
  if (o < 0.06) {
    ctx.beginPath();
    ctx.moveTo(x - hw, cornerY);
    ctx.quadraticCurveTo(x, y + f * 7 + 1, x + hw, cornerY);
    ctx.stroke();
    return;
  }
  const bottom = y + 6 + o * 30 + Math.max(0, f) * 4;
  const topY = y - 1 + Math.max(0, f) * 2 - o * 3;
  ctx.beginPath();
  ctx.moveTo(x - hw, cornerY);
  ctx.quadraticCurveTo(x, topY, x + hw, cornerY);
  ctx.bezierCurveTo(x + hw * 0.8, bottom, x - hw * 0.8, bottom, x - hw, cornerY);
  ctx.closePath();
  ctx.fillStyle = C.mouth;
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = C.tongue;
  ctx.beginPath();
  ctx.ellipse(x, bottom - 2, hw * 0.75, 6 + o * 8, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

// ---------- 前髪・横髪 ----------
// [根元x, 根元y, 先端x, 先端y, 幅, カール]
const BANGS = [
  [352, 270, 330, 430, 78, -24],
  [648, 270, 672, 430, 78, 24],
  [392, 270, 380, 405, 74, 18],
  [610, 270, 622, 405, 74, -18],
  [430, 268, 425, 418, 70, -16],
  [574, 268, 580, 418, 70, 16],
  [466, 270, 470, 410, 66, 14],
  [538, 270, 535, 412, 66, -14],
  [502, 268, 497, 440, 62, -12],
];
const CROWN = [
  [500, 245, 122], [415, 258, 92], [585, 258, 92], [355, 305, 60], [645, 305, 60],
  [458, 222, 88], [545, 218, 88],
];
// 顔の輪郭にかかる横髪
const SIDE_LOCKS = [
  [312, 330, 298, 535, 56, 18],
  [688, 330, 702, 535, 56, -18],
  [342, 300, 352, 588, 60, -22],
  [658, 300, 648, 588, 60, 22],
];
// 頭頂部の毛流れ [始点, 制御点, 終点]
const HAIR_FLOW = [
  [505, 132, 430, 170, 390, 250], [510, 134, 470, 190, 448, 272], [518, 136, 528, 200, 515, 270],
  [526, 134, 585, 175, 605, 255], [532, 138, 625, 165, 662, 245], [498, 136, 405, 150, 340, 230],
  [540, 142, 660, 158, 690, 220], [470, 160, 380, 185, 330, 290],
];
// パーマのうねり [中心x, 中心y, 半径, 開始角, 終了角]
const CROWN_CURLS = [
  [400, 230, 26, 3.6, 5.6], [455, 258, 22, 3.4, 5.4], [590, 242, 26, 4.0, 6.0], [640, 282, 22, 4.2, 6.2],
  [360, 292, 20, 3.4, 5.2], [520, 200, 20, 3.8, 5.8],
];
// 外へ跳ねるパーマの毛束
const FLICKS = [
  [350, 250, 292, 296, 50, -22], [650, 250, 708, 296, 50, 22],
  [322, 360, 278, 418, 46, -18], [678, 360, 722, 418, 46, 18],
  [425, 200, 380, 165, 44, -16], [575, 195, 620, 160, 44, 16],
];

function drawFrontHair(ctx, P) {
  const ox = P.ax * 36;
  const oy = -P.ay * 20;
  const sx = P.hairSwayX;
  const syw = P.hairSwayY;
  const tipOff = (k) => [sx * k, syw * k * 0.5];

  const g = ctx.createLinearGradient(0, 120, 0, 620);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, C.hair);
  g.addColorStop(1, C.hairMid);

  ctx.save();
  ctx.translate(ox, oy);

  const strand = ([rx, ry, tx, ty, w, bend], k, outlineFrom = 0) => {
    const [dx, dy] = tipOff(k);
    ctx.beginPath();
    strandPath(ctx, rx, ry, tx + dx, ty + dy, w, bend + dx * 0.3);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    if (outlineFrom) {
      ctx.beginPath();
      ctx.rect(0, ry + outlineFrom, W, H);
      ctx.clip();
      ctx.beginPath();
      strandPath(ctx, rx, ry, tx + dx, ty + dy, w, bend + dx * 0.3);
    }
    ctx.strokeStyle = C.hairLine;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    return [dx, dy];
  };

  // 横髪・跳ねた毛束 (根元は頭頂部で隠れる)
  for (const l of SIDE_LOCKS) strand(l, 1);
  for (const l of FLICKS) strand(l, 0.7);

  // 頭頂部のふわふわ
  ctx.fillStyle = C.hairLine;
  circles(ctx, CROWN.map(([x, y, r]) => [x, y + 1, r + 2.5]));
  ctx.fill();
  ctx.fillStyle = g;
  circles(ctx, CROWN);
  ctx.fill();
  // つむじから流れる毛の線とパーマのうねり
  ctx.save();
  circles(ctx, CROWN);
  ctx.clip();
  ctx.strokeStyle = 'rgba(170,185,215,0.55)';
  ctx.lineWidth = 2;
  for (const [x0, y0, cx, cy, x1, y1] of HAIR_FLOW) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(185,198,224,0.7)';
  for (const [x, y, r, a0, a1] of CROWN_CURLS) {
    ctx.beginPath();
    ctx.arc(x, y, r, a0, a1);
    ctx.stroke();
  }
  ctx.restore();

  // 前髪の毛束 (輪郭線は毛先側だけ)
  for (const b of BANGS) {
    const [rx, ry, tx, ty, w, bend] = b;
    const [dx, dy] = strand(b, 0.8, 70);
    // 毛束の中の影線
    ctx.strokeStyle = 'rgba(170,185,215,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rx + (tx - rx) * 0.5 + bend * 0.2, ry + (ty - ry) * 0.55);
    ctx.quadraticCurveTo(rx + (tx - rx) * 0.8 + bend * 0.5, ry + (ty - ry) * 0.75, tx + dx + bend * 0.35, ty + dy - 18);
    ctx.stroke();
  }

  // アホ毛
  const [ahx, ahy] = [P.accSwayX * 0.8, P.accSwayY * 0.5];
  ctx.beginPath();
  ctx.moveTo(492, 136);
  ctx.bezierCurveTo(500, 92, 538 + ahx, 76 + ahy, 546 + ahx, 104 + ahy);
  ctx.bezierCurveTo(528 + ahx * 0.6, 94 + ahy, 515, 112, 512, 138);
  ctx.closePath();
  ctx.fillStyle = C.hair;
  ctx.fill();
  ctx.strokeStyle = C.hairLine;
  ctx.stroke();

  // 天使の輪っか状のツヤ
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineCap = 'round';
  for (const [x, y, len, rot] of [[420, 238, 28, -0.6], [470, 220, 30, -0.25], [530, 218, 30, 0.2], [585, 235, 28, 0.55], [365, 276, 22, -0.9], [640, 276, 22, 0.9]]) {
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(rot) * len / 2, y - Math.sin(rot) * len / 2);
    ctx.lineTo(x + Math.cos(rot) * len / 2, y + Math.sin(rot) * len / 2);
    ctx.stroke();
  }
  // 青みのあるツヤ (毛先)
  ctx.strokeStyle = 'rgba(160,195,240,0.45)';
  ctx.lineWidth = 3;
  for (const [rx, ry, tx, ty] of BANGS) {
    const [dx, dy] = tipOff(0.8);
    ctx.beginPath();
    ctx.moveTo(rx + (tx - rx) * 0.75 + dx * 0.7, ry + (ty - ry) * 0.7 + dy * 0.7);
    ctx.lineTo(rx + (tx - rx) * 0.9 + dx * 0.9, ry + (ty - ry) * 0.88 + dy * 0.9);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- 髪飾り (水色のヘアピン + 星のチャーム) ----------
function drawHairClip(ctx, P) {
  const x = 628 + P.ax * 34;
  const y = 318 - P.ay * 20;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.35);
  for (const [dx, dy, rot] of [[0, -10, 0], [0, 10, 0], [0, 0, -0.9]]) {
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(rot);
    ctx.fillStyle = C.blue;
    ctx.strokeStyle = C.blueDeep;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-38, -6, 76, 12, 6);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(-30, -2);
    ctx.lineTo(20, -2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  // チェーンでぶら下がる星
  const cx = x + 22 + P.accSwayX * 0.9;
  const cy = y + 80 + Math.abs(P.accSwayX) * 0.15 + P.accSwayY * 0.4;
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x + 18, y + 14);
  ctx.quadraticCurveTo(x + 20 + P.accSwayX * 0.3, y + 50, cx, cy - 16);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#fff3c8';
  ctx.strokeStyle = C.goldDeep;
  ctx.lineWidth = 2;
  star(ctx, cx, cy, 17, 0.42, 5, P.accSwayX * 0.02);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#bcd6ff';
  ctx.beginPath();
  ctx.arc(cx, cy + 26, 6, 0, TAU);
  ctx.fill();
}

// ---------- 眉 (前髪の上に薄く描く) ----------
function drawBrows(ctx, P) {
  const fx = P.ax * 32;
  const fy = -P.ay * 19;
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = '#9aa3bb';
  ctx.lineWidth = 4.5;
  for (const [s, by, form, angle] of [[-1, P.browLY, P.browLForm, P.browLAngle], [1, P.browRY, P.browRForm, P.browRAngle]]) {
    const cx = 500 + s * 80 + fx;
    const y = 370 + fy - by * 16;
    const inner = [cx - s * 40, y + 6 - angle * 9 - form * 7];
    const outer = [cx + s * 42, y + 2 + angle * 4];
    ctx.beginPath();
    ctx.moveTo(...inner);
    ctx.quadraticCurveTo(cx, y - 10 + form * 6, ...outer);
    ctx.stroke();
  }
  ctx.restore();
}
