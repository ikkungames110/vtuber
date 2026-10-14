// マイク解析(オーディオスレッドで動くので、タブが裏にあっても止まらない)
// 約 20ms ごとに音量(RMS) と高域比率(母音の「い/え」っぽさ) を送る
class MicAnalyser extends AudioWorkletProcessor {
  constructor() {
    super();
    this.n = 0;
    this.sum = 0;
    this.hiSum = 0;
    this.lp = 0;
    this.prev = 0;
    this.frame = Math.round(sampleRate / 50);
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      this.lp += (x - this.lp) * 0.12; // 低域(約 1kHz 以下)
      const hi = x - this.lp;
      this.sum += x * x;
      this.hiSum += hi * hi;
      if (++this.n >= this.frame) {
        const rms = Math.sqrt(this.sum / this.n);
        const hiRatio = this.sum > 0 ? this.hiSum / this.sum : 0;
        this.port.postMessage({ rms, hiRatio });
        this.n = 0;
        this.sum = 0;
        this.hiSum = 0;
      }
    }
    return true;
  }
}
registerProcessor('mic-analyser', MicAnalyser);
