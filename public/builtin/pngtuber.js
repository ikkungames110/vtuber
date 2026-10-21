// 立ち絵 1 枚 + 口の差分で動く内蔵モデル (いわゆる PNGTuber)。
// 腕まで入った立ち絵に、表情シート (口閉じ / 半開き) から縮尺を合わせて移植した口と、立ち絵に元から描かれた開き口を使い、
// ParamMouthOpenY で口を切り替える。
// 人間の VTuber のように、不規則なタイミングで左右に体重を移したり、ふらっと揺れたりさせる。

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// なめらかな 1 次元の勾配ノイズ (おおよそ -1〜1)。周期的にならず、平らな区間ができにくいゆらぎに使う
const hash = (i) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};
const noise = (x) => {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return 2 * (hash(i) * f * (1 - u) + hash(i + 1) * (f - 1) * u);
};

const SPRITES = {
  'builtin:hyoshoku': {
    dir: '/builtin/hyoshoku/',
    base: 'base.webp',
    mouths: ['mouth-half.png', 'mouth-open.png'],
    mouthAt: { x: 508, y: 260 }, // 口の差分を貼る位置 (base 画像上の座標)
    width: 1106,
    height: 1024,
  },
};

export const PNG_MODELS = { 'builtin:hyoshoku': '氷色ビッシューネン (立ち絵 + 口パク)' };

export function createPngModel(url) {
  const def = SPRITES[url];
  if (!def) throw new Error(`内蔵モデルが見つかりません: ${url}`);
  return new PngModel(def);
}

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`画像を読み込めません: ${src}`));
    img.src = src;
  });

class PngModel extends PIXI.Sprite {
  constructor(def) {
    const W = def.width;
    const H = def.height;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    super(new PIXI.Texture(new PIXI.BaseTexture(canvas)));
    this.def = def;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingQuality = 'high';
    this.images = null;
    Promise.all([def.base, ...def.mouths].map((f) => loadImage(def.dir + f)))
      .then((imgs) => (this.images = imgs))
      .catch((e) => console.error(e));

    const params = Object.create(null);
    const listeners = [];
    this.params = params;
    this.listeners = listeners;
    this.internalModel = {
      width: W,
      height: H,
      coreModel: {
        setParameterValueById: (id, v) => (params[id] = v),
        getParameterValueById: (id) => params[id] ?? 0,
      },
      motionManager: { stopAllMotions() {}, state: {}, expressionManager: null },
      on: (ev, fn) => ev === 'afterMotionUpdate' && listeners.push(fn),
    };

    this.time = 0;
    this.mouth = 0; // 0: 閉じ 1: 半開き 2: 開き
    this.mouthChangedAt = 0;
    this.talk = 0; // 喋っている度合い (なめらか)
    // 体の傾き (度)。ランダムな目標角へバネで寄っていく
    this.lean = 0;
    this.leanVel = 0;
    this.leanTarget = 0;
    this.leanSpring = { w: 3, zeta: 0.8 };
    this.nextLeanAt = rand(0.5, 2);
    this.seed = rand(0, 1000);
    this.tick = () => this.update(PIXI.Ticker.shared.elapsedMS / 1000);
    PIXI.Ticker.shared.add(this.tick);
  }

  expression() {} // 表情差分は口のみ

  destroy() {
    PIXI.Ticker.shared.remove(this.tick);
    super.destroy({ texture: true, baseTexture: true });
  }

  update(dt) {
    dt = clamp(dt, 0.001, 0.05);
    this.time += dt;
    for (const fn of this.listeners) fn();
    const open = clamp(this.params.ParamMouthOpenY ?? 0, 0, 1);
    this.updateMouth(open);
    this.talk += ((open > 0.12 ? 1 : 0) - this.talk) * (1 - Math.exp(-dt * 2));
    this.draw(dt);
    this.texture.baseTexture.update();
  }

  // 口の開き具合 → 3 段階。ヒステリシスと最短表示時間でパタパタしすぎないようにする
  updateMouth(open) {
    const t = this.time;
    const up = [0.15, 0.5];
    const down = [0.1, 0.4];
    let next = this.mouth;
    if (this.mouth < 2 && open > up[1]) next = 2;
    else if (this.mouth < 1 && open > up[0]) next = 1;
    else if (this.mouth === 2 && open < down[1]) next = open < down[0] ? 0 : 1;
    else if (this.mouth === 1 && open < down[0]) next = 0;
    if (next !== this.mouth && t - this.mouthChangedAt > 0.06) {
      this.mouth = next;
      this.mouthChangedAt = t;
    }
  }

  // 不規則なゆらゆら。戻り値は傾き(ラジアン)
  // ・ときどき左右どちらかへ体重を移して少し留まる (喋っている間は頻繁に・大きめに)
  // ・常にゆっくり漂う小さなゆらぎ + 喋っているときの細かい揺れ
  swayAngle(dt) {
    const t = this.time;
    const talking = this.talk > 0.5;
    if (t > this.nextLeanAt) {
      const r = Math.random();
      if (r < 0.15) this.leanTarget = rand(-0.5, 0.5); // まっすぐ付近に戻る
      else if (r < 0.55) this.leanTarget = -Math.sign(this.leanTarget || 1) * rand(1, talking ? 3 : 2.2); // 反対側へ
      else this.leanTarget = rand(-1, 1) * (talking ? 3 : 2.2);
      // 速さもまちまちに (ゆっくり傾く / すっと傾く)
      this.leanSpring = { w: rand(1.5, talking ? 5 : 3.5), zeta: rand(0.55, 0.95) };
      this.nextLeanAt = t + (talking ? rand(0.8, 2.5) : rand(1, 3.5));
    }
    const { w, zeta } = this.leanSpring;
    this.leanVel += (w * w * (this.leanTarget - this.lean) - 2 * zeta * w * this.leanVel) * dt;
    this.lean += this.leanVel * dt;

    const s = this.seed;
    let deg = this.lean;
    // ゆっくり漂う (周期の違う 3 層を重ねて、全部が同時に止まらないようにする = 完全静止を作らない)
    deg += noise(s + t * 0.6) * 0.7 + noise(s + 20 + t * 1.05) * 0.4 + noise(s + 40 + t * 1.7) * 0.2;
    deg += this.talk * (noise(s + 50 + t * 1.6) * 0.6 + noise(s + 90 + t * 3.1) * 0.25); // 喋りの細かい揺れ
    return (deg * Math.PI) / 180;
  }

  draw(dt) {
    const ctx = this.ctx;
    const { width: CW, height: CH } = this.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    if (!this.images) return;
    const [base, ...mouths] = this.images;
    const t = this.time;
    const rot = this.swayAngle(dt);
    const breath = Math.sin(t * 1.6) * 0.5 + 0.5;

    // 下端中央を支点に傾ける (体ごと揺れる感じ)
    const pivotX = this.def.width / 2;
    const pivotY = this.def.height;
    const bob = this.talk * (1.5 + Math.max(0, noise(this.seed + 130 + t * 2.4)) * 3); // 喋りながら少し弾む
    ctx.translate(pivotX + rot * 180, pivotY - bob);
    ctx.rotate(rot);
    ctx.scale(1, 1 + breath * 0.004);
    ctx.translate(-pivotX, -pivotY);
    ctx.drawImage(base, 0, 0);
    if (this.mouth > 0) ctx.drawImage(mouths[this.mouth - 1], this.def.mouthAt.x, this.def.mouthAt.y);
  }
}
