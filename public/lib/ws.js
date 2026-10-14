// サーバーとの WebSocket 接続(自動再接続つき)
export function connect(role, onMessage, onState) {
  let ws;
  let queue = [];
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', role }));
      for (const m of queue) ws.send(m);
      queue = [];
      onState?.(true);
    };
    ws.onmessage = (e) => onMessage?.(JSON.parse(e.data));
    ws.onclose = () => {
      onState?.(false);
      setTimeout(open, 1000);
    };
  };
  open();
  return {
    send(msg) {
      const data = JSON.stringify(msg);
      if (ws.readyState === 1) ws.send(data);
      else if (msg.type !== 'track' && msg.type !== 'voice') queue.push(data);
    },
    get connected() {
      return ws.readyState === 1;
    },
  };
}
