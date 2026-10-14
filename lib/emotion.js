// 発言テキスト → 表情/ジェスチャーの推定。
// ローカル LLM (Ollama) を使い、失敗したらキーワードルールにフォールバックする。

export const EMOTIONS = ['neutral', 'joy', 'laugh', 'angry', 'sad', 'surprised', 'embarrassed', 'thinking'];
export const GESTURES = ['none', 'nod', 'shake', 'tilt', 'bounce'];

const SYSTEM_PROMPT = `あなたはVTuberアバターの表情制御AIです。
配信者(ゲーム実況中)の発言を読み、アバターがするべき表情とジェスチャーを1つずつ選びます。
emotion:
- neutral: 平常、説明、淡々とした発言
- joy: 嬉しい、楽しい、好意、感謝
- laugh: 爆笑、ツッコミ、「w」「草」など笑い
- angry: 怒り、イライラ、悔しさ(「は？」「なんで！」)
- sad: 悲しい、落胆、残念、負けた
- surprised: 驚き(「えっ」「うわっ」「マジ!?」)
- embarrassed: 照れ、恥ずかしい、褒められた
- thinking: 考え中、迷い、「うーん」「どうしよう」
gesture:
- none / nod(うなずき・同意) / shake(首を横に振る・否定) / tilt(首をかしげる・疑問) / bounce(はしゃぐ)
intensity は 0.0〜1.0 で感情の強さ。
JSON だけを出力してください。`;

const SCHEMA = {
  type: 'object',
  properties: {
    emotion: { type: 'string', enum: EMOTIONS },
    intensity: { type: 'number' },
    gesture: { type: 'string', enum: GESTURES },
  },
  required: ['emotion', 'intensity', 'gesture'],
};

const RULES = [
  { emotion: 'laugh', gesture: 'bounce', re: /(w{2,}|ｗ{2,}|草|笑|あはは|ははは|ふふ|ウケる|うける)/i },
  { emotion: 'surprised', gesture: 'none', re: /(えっ|ええ[！!?？]|うわ|マジ[！!?？]|まじで|びっくり|嘘でしょ|うそ[！!]|なにこれ|は[！!]?\?)/ },
  { emotion: 'angry', gesture: 'shake', re: /(くそ|クソ|ふざけ|むかつ|ムカつ|イライラ|なんでだよ|は？|ハァ|許さ)/ },
  { emotion: 'sad', gesture: 'none', re: /(悲し|かなし|残念|つら|辛い|泣|負けた|しんだ|死んだ|終わった|ぴえん)/ },
  { emotion: 'embarrassed', gesture: 'tilt', re: /(恥ずかし|照れ|てれ|はずかし|かわいいって|褒め)/ },
  { emotion: 'thinking', gesture: 'tilt', re: /(うーん|んー|どうしよう|かな[？?]?$|なんだろ|考え|迷う|どっち)/ },
  { emotion: 'joy', gesture: 'nod', re: /(やった|嬉し|うれし|楽し|たのし|最高|好き|ありがと|いいね|よっしゃ|勝った|ナイス)/ },
  { emotion: 'neutral', gesture: 'nod', re: /(そうそう|うんうん|なるほど|たしかに|はい)/ },
];

export function ruleEmotion(text) {
  for (const r of RULES) {
    if (r.re.test(text)) return { emotion: r.emotion, intensity: 0.7, gesture: r.gesture };
  }
  return { emotion: 'neutral', intensity: 0.3, gesture: 'none' };
}

export function sanitize(obj) {
  const emotion = EMOTIONS.includes(obj?.emotion) ? obj.emotion : 'neutral';
  const gesture = GESTURES.includes(obj?.gesture) ? obj.gesture : 'none';
  let intensity = Number(obj?.intensity);
  if (!Number.isFinite(intensity)) intensity = 0.6;
  if (intensity > 1) intensity = intensity / 10; // 0-10 で返すモデル対策
  return { emotion, gesture, intensity: Math.min(1, Math.max(0, intensity)) };
}

export async function llmEmotion(text, { ollamaUrl, model, timeoutMs = 6000, history = [] }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const context = history.length ? `直前の発言: ${history.slice(-3).join(' / ')}\n` : '';
    const res = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        stream: false,
        format: SCHEMA,
        keep_alive: '30m',
        options: { temperature: 0.2, num_predict: 48 },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${context}発言: ${text}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return sanitize(JSON.parse(data.message?.content ?? '{}'));
  } finally {
    clearTimeout(timer);
  }
}
