// 立ち絵 1 枚 + 口の差分で動く内蔵モデル (いわゆる PNGTuber)。
// 表情シート (口閉じ / 半開き / 開き) から切り出した画像を使い、ParamMouthOpenY で口を切り替える。
// たまにほんの少し左右にゆらゆらさせて、配信中の VTuber っぽい動きを出す。

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

const SPRITES = {
  'builtin:hyoshoku': {
    dir: '/builtin/hyoshoku/',
    base: 'base.webp',
    mouths: ['mouth-half.png', 'mouth-open.png'],
    mouthAt: { x: 196, y: 462 }, // 口の差分を貼る位置 (base 画像上の座標)
    width: 508,
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
    this.sway = null; // { start, dur, amp, cycles }
    this.nextSway = rand(2, 5);
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
    this.draw();
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

  // たまに起きるゆらゆら (喋っている間は起きやすい)。戻り値は傾き(ラジアン)
  swayAngle() {
    const t = this.time;
    if (!this.sway && t > this.nextSway) {
      this.sway = { start: t, dur: rand(2.5, 5), amp: rand(0.5, 1.2) * (Math.random() < 0.5 ? -1 : 1), cycles: Math.random() < 0.5 ? 0.5 : 1 };
    }
    let deg = 0;
    if (this.sway) {
      const p = (t - this.sway.start) / this.sway.dur;
      if (p >= 1) {
        this.sway = null;
        this.nextSway = t + (this.talk > 0.5 ? rand(1.5, 5) : rand(4, 10));
      } else {
        // 両端をなめらかに 0 にする。片側に寄って戻る / 左右に 1 往復
        const env = Math.sin(Math.PI * p);
        deg = this.sway.amp * env * (this.sway.cycles === 0.5 ? env : Math.sin(Math.PI * 2 * p));
      }
    }
    // 喋っているときの小さな揺れ
    deg += this.talk * 0.25 * Math.sin(t * 2.3);
    return (deg * Math.PI) / 180;
  }

  draw() {
    const ctx = this.ctx;
    const { width: CW, height: CH } = this.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    if (!this.images) return;
    const [base, ...mouths] = this.images;
    const t = this.time;
    const rot = this.swayAngle();
    const breath = Math.sin(t * 1.6) * 0.5 + 0.5;

    // 下端中央を支点に傾ける (体ごと揺れる感じ)
    const pivotX = this.def.width / 2;
    const pivotY = this.def.height;
    ctx.translate(pivotX + rot * 180, pivotY - this.talk * 1.5);
    ctx.rotate(rot);
    ctx.scale(1, 1 + breath * 0.004);
    ctx.translate(-pivotX, -pivotY);
    ctx.drawImage(base, 0, 0);
    if (this.mouth > 0) ctx.drawImage(mouths[this.mouth - 1], this.def.mouthAt.x, this.def.mouthAt.y);
  }
}
