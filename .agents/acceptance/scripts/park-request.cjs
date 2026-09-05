// 停住匹配的请求，把 Suspense fallback 定格在屏幕上；SIGINT 时放行
const WebSocket = require('ws');
const [,, browserWs, pattern, holdMs] = process.argv;

(async () => {
  const http = require('node:http');
  const port = new URL(browserWs).port;
  const targets = await new Promise((res, rej) => {
    http.get(`http://127.0.0.1:${port}/json/list`, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res(JSON.parse(b)));
    }).on('error', rej);
  });
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:3010'));
  if (!page) { console.log(JSON.stringify({ ok: false, error: 'no page target' })); process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0;
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
  const paused = [];

  ws.on('open', () => {
    send('Fetch.enable', { patterns: [{ requestStage: 'Request', urlPattern: pattern }] });
    console.log(JSON.stringify({ ok: true, armed: pattern, target: page.url }));
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.method === 'Fetch.requestPaused') {
      paused.push(msg.params.requestId);
      console.log(JSON.stringify({ paused: msg.params.request.url.slice(0, 110) }));
    }
  });
  setTimeout(() => {
    for (const requestId of paused) send('Fetch.failRequest', { requestId, errorReason: 'Failed' });
    send('Fetch.disable');
    setTimeout(() => { console.log(JSON.stringify({ released: paused.length })); process.exit(0); }, 300);
  }, Number(holdMs || 15000));
})();
