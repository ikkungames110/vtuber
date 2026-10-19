// YouTube Data API v3 でチャンネル登録者数を取得する
// (1 回の取得でクォータ 1 消費。無料枠は 1 日 10,000)

// 入力 (チャンネル ID / @ハンドル / チャンネル URL) → API のクエリ
export function parseChannel(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  const id = s.match(/(?:^|\/channel\/)(UC[\w-]{22})(?:$|[/?])/);
  if (id) return { id: id[1] };
  const handle = s.match(/(?:^|youtube\.com\/)(@[\w.\-]+)/);
  if (handle) return { forHandle: handle[1] };
  return { forHandle: s.startsWith('@') ? s : `@${s}` };
}

export async function fetchSubscribers({ apiKey, channel }) {
  if (!apiKey) throw new Error('YouTube API キーが未設定です');
  const query = parseChannel(channel);
  if (!query) throw new Error('チャンネルが未設定です');
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.search = new URLSearchParams({ part: 'snippet,statistics', key: apiKey, ...query });
  const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message ?? `HTTP ${r.status}`);
  const ch = data.items?.[0];
  if (!ch) throw new Error('チャンネルが見つかりません');
  return {
    title: ch.snippet.title,
    count: ch.statistics.hiddenSubscriberCount ? null : Number(ch.statistics.subscriberCount),
    hidden: !!ch.statistics.hiddenSubscriberCount,
  };
}
