#!/usr/bin/env node
// Raw CDP capture. Requires Node.js >=22.15; no npm packages or project setup.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const finish = (result, code) => {
  console.log(JSON.stringify(result));
  process.exit(code);
};

async function capture() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 15) || typeof WebSocket !== 'function') {
    finish({ ok: false, error: 'Node.js >=22.15 with its built-in WebSocket is required.' }, 7);
  }

  const { values } = parseArgs({
    options: {
      'port': { type: 'string', default: '9222' },
      'out': { type: 'string', default: path.join(require('node:os').tmpdir(), 'cdp-capture.png') },
      'full': { type: 'boolean', default: false },
      'target-url': { type: 'string' },
      'timeout': { type: 'string', default: '12000' },
    },
  });
  const port = Number(values.port);
  const timeout = Number(values.timeout);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port.');
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647) {
    throw new Error('Invalid --timeout (positive milliseconds required).');
  }

  // Bound the entire operation, including discovery and the WebSocket handshake.
  const deadline = setTimeout(
    () => finish({ ok: false, error: `CDP timeout after ${timeout}ms` }, 5),
    timeout,
  );
  const response = await fetch(`http://127.0.0.1:${port}/json`, {
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`CDP discovery returned HTTP ${response.status}.`);
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new Error('CDP discovery did not return a target list.');
  const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  const page = values['target-url']
    ? pages.find((target) => (target.url || '').includes(values['target-url']))
    : pages[0];
  if (!page)
    throw new Error(
      'No page target found' +
        (values['target-url'] ? ` matching ${JSON.stringify(values['target-url'])}` : '') +
        '.',
    );

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  let rejectOpen;
  const ready = new Promise((resolve, reject) => {
    rejectOpen = reject;
    socket.addEventListener('open', resolve, { once: true });
  });
  const fail = (error) => {
    rejectOpen(error);
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  socket.addEventListener('error', () => fail(new Error('CDP WebSocket connection failed.')));
  socket.addEventListener('close', () =>
    fail(new Error('CDP WebSocket closed before capture completed.')),
  );
  socket.addEventListener('message', ({ data }) => {
    try {
      const message = JSON.parse(data);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result);
    } catch (error) {
      fail(new Error(`Invalid CDP response: ${error.message}`));
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { method, resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await ready;
  let params = { format: 'png' };
  if (values.full) {
    const metrics = await send('Page.getLayoutMetrics');
    const size = metrics.cssContentSize || metrics.contentSize;
    params = {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 },
    };
  }
  const started = Date.now();
  const screenshot = await send('Page.captureScreenshot', params);
  const bytes = Buffer.from(screenshot.data || '', 'base64');
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error('CDP returned an empty or invalid PNG.');
  }
  fs.mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
  fs.writeFileSync(values.out, bytes);
  socket.close();
  clearTimeout(deadline);
  finish(
    {
      ok: true,
      bytes: bytes.length,
      ms: Date.now() - started,
      targetUrl: page.url,
      out: values.out,
    },
    0,
  );
}

capture().catch((error) => finish({ ok: false, error: error.message }, 5));
