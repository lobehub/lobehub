#!/usr/bin/env node
// cdp-capture.cjs — capture a screenshot from a CDP target via RAW DevTools protocol,
// bypassing the agent-browser daemon. Proven reliable against headful Electron/Chrome
// regardless of display sleep or window minimization/occlusion (Page.captureScreenshot
// forces a compositor frame). Every CDP call is hard-timeout guarded so a stall fails
// fast instead of wedging anything.
//
// Usage: node cdp-capture.cjs --port 9222 --out shot.png [--full] [--target-url <substr>] [--timeout 12000]
// Prints one line of JSON: {"ok":true,"bytes":N,"ms":N,"targetUrl":"..."} or {"ok":false,"error":"..."}
// Exit 0 on success, non-zero on failure/timeout.
//
// Requires the `ws` package to be resolvable from this file's own location —
// Node's require() walks up ancestor node_modules automatically, so this works
// whether the skill ships inside @lobehub/cli's own node_modules or a hoisted
// monorepo root; no manual NODE_PATH wiring needed. A `lh verify install`-copied
// skill dir lives inside a consumer repo's harness skills dir, though, so the
// ancestor walk from there never reaches @lobehub/cli's node_modules — fall
// back to the `cliRoot` recorded in the sibling `.skill-meta.json`.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

function resolveWs() {
  const attempted = [];
  try {
    return require('ws');
  } catch {
    attempted.push('ancestor node_modules walk from ' + __filename);
  }

  const markerDir = path.join(__dirname, '..');
  const metaPath = path.join(markerDir, '.skill-meta.json');
  let cliRoot;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    cliRoot = meta && meta.cliRoot;
    if (cliRoot && !path.isAbsolute(cliRoot)) {
      cliRoot = path.resolve(markerDir, cliRoot);
    }
  } catch {
    attempted.push(metaPath + ' (missing or unreadable)');
  }

  if (cliRoot) {
    // createRequire, not a hand-built <cliRoot>/node_modules/ws path: pnpm
    // links a package's deps NEXT TO it (.pnpm/<pkg>@<v>/node_modules/ws),
    // so only Node's real resolution walk anchored inside cliRoot finds ws
    // across both npm and pnpm layouts.
    try {
      return require('node:module').createRequire(path.join(cliRoot, 'package.json'))('ws');
    } catch {
      attempted.push("createRequire('ws') from " + cliRoot + ' (via .skill-meta.json cliRoot)');
    }
  }

  console.log(
    JSON.stringify({
      ok: false,
      error:
        "Cannot find module 'ws'. Tried: " +
        attempted.join('; ') +
        ". This script requires the 'ws' package to be resolvable " +
        'from its own install location (a dependency of @lobehub/cli, or installed ' +
        "alongside it). Run 'npm install ws' in the consuming project if using this " +
        'script standalone.',
    }),
  );
  process.exit(7);
}

const WebSocket = resolveWs();

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > -1 ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes(k);
const PORT = parseInt(arg('--port', '9222'), 10);
const OUT = arg('--out', '/tmp/cdp-capture.png');
const FULL = has('--full');
const TURL = arg('--target-url', '');
const TIMEOUT = parseInt(arg('--timeout', '12000'), 10);

const done = (obj, code) => {
  console.log(JSON.stringify(obj));
  process.exit(code);
};
const httpGet = (path) =>
  new Promise((res, rej) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        try {
          res(JSON.parse(d));
        } catch (e) {
          rej(e);
        }
      });
    });
    req.on('error', rej);
    req.setTimeout(4000, () =>
      req.destroy(
        new Error(
          'CDP HTTP timeout — is the app running with --remote-debugging-port=' + PORT + '?',
        ),
      ),
    );
  });

function client(url) {
  const ws = new WebSocket(url, { maxPayload: 512 * 1024 * 1024 });
  const pending = new Map();
  let id = 0;
  const ready = new Promise((r, j) => {
    ws.on('open', r);
    ws.on('error', j);
  });
  ws.on('message', (m) => {
    const o = JSON.parse(m);
    if (o.id && pending.has(o.id)) {
      pending.get(o.id)(o);
      pending.delete(o.id);
    }
  });
  const send = (method, params = {}, timeout = TIMEOUT) =>
    new Promise((res, rej) => {
      const myid = ++id;
      pending.set(myid, (o) =>
        o.error ? rej(new Error(method + ': ' + o.error.message)) : res(o.result),
      );
      ws.send(JSON.stringify({ id: myid, method, params }));
      setTimeout(() => {
        if (pending.has(myid)) {
          pending.delete(myid);
          rej(new Error('TIMEOUT ' + method + ' after ' + timeout + 'ms'));
        }
      }, timeout);
    });
  return { ws, ready, send };
}

(async () => {
  const targets = await httpGet('/json');
  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const page = TURL ? pages.find((t) => (t.url || '').includes(TURL)) : pages[0];
  if (!page) throw new Error('no page target found' + (TURL ? ' matching "' + TURL + '"' : ''));
  const pg = client(page.webSocketDebuggerUrl);
  await pg.ready;
  let params = { format: 'png' };
  if (FULL) {
    const m = await pg.send('Page.getLayoutMetrics', {});
    const s = m.cssContentSize || m.contentSize;
    params = {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(s.width), height: Math.ceil(s.height), scale: 1 },
    };
  }
  const t0 = Date.now();
  const r = await pg.send('Page.captureScreenshot', params);
  const buf = Buffer.from(r.data, 'base64');
  fs.writeFileSync(OUT, buf);
  done({ ok: true, bytes: buf.length, ms: Date.now() - t0, targetUrl: page.url }, 0);
})().catch((e) => done({ ok: false, error: e.message }, 1));
