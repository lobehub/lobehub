/**
 * Production probe that drives the REAL device client:
 * `GatewayClient` + `DeviceTunnelHost` from packages/device-gateway-client,
 * connected to the deployed gateway with the CLI's stored JWT.
 *
 * It is a manual dev tool, not CI: it needs a logged-in `lh` CLI on this
 * machine (`~/.lobehub/credentials.json`) and reaches the real gateway.
 *
 * Run from the repo root:  bunx tsx packages/device-gateway-client/scripts/verify-tunnel-prod.mts
 */
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { GatewayClient } from '@lobechat/device-gateway-client';

const GATEWAY = 'https://device-gateway.lobehub.com';
const ORIGIN_PORT = 43112;
const DEVICE_ID = `tunnel-probe-${crypto.randomBytes(4).toString('hex')}`;

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function loadJwt() {
  const key = crypto.pbkdf2Sync(
    `lobehub-cli:${os.hostname()}:${os.userInfo().username}`,
    'lobehub-cli-salt',
    100_000,
    32,
    'sha256',
  );
  const packed = Buffer.from(
    fs.readFileSync(path.join(os.homedir(), '.lobehub', 'credentials.json'), 'utf8'),
    'base64',
  );
  const d = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  d.setAuthTag(packed.subarray(12, 28));
  const creds = JSON.parse(d.update(packed.subarray(28)) + d.final('utf8'));
  const claims = JSON.parse(Buffer.from(creds.accessToken.split('.')[1], 'base64url').toString());
  return { jwt: creds.accessToken as string, userId: claims.sub as string };
}

const { jwt, userId } = loadJwt();

// ─── origin: a stand-in for the user's dev server ───

const origin = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://127.0.0.1');
  if (url.pathname === '/') {
    res.writeHead(200, {
      'content-type': 'text/html',
      'set-cookie': ['a=1; Path=/', 'b=2; Path=/'],
    });
    res.end('<h1>real client origin</h1>');
    return;
  }
  if (url.pathname === '/gzip') {
    res.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/plain' });
    res.end(gzipSync(Buffer.from('compressed-over-the-tunnel')));
    return;
  }
  if (url.pathname === '/echo' && req.method === 'POST') {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.concat(chunks));
    });
    return;
  }
  if (url.pathname === '/huge') {
    // 8 MiB: well past the gateway's 4 MiB unacked hard cap, so this only
    // survives if the device honours the flow window.
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(Buffer.alloc(8 * 1024 * 1024, 0x62));
    return;
  }
  if (url.pathname === '/sse') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    let i = 0;
    const timer = setInterval(() => {
      res.write(`data: event-${i++}\n\n`);
      if (i >= 100) clearInterval(timer);
    }, 150);
    req.on('close', () => clearInterval(timer));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not here');
});
await new Promise<void>((resolve) => origin.listen(ORIGIN_PORT, '127.0.0.1', resolve));

// ─── the real device client ───

const client = new GatewayClient({
  channel: 'tunnel-probe',
  connectionId: DEVICE_ID,
  deviceId: DEVICE_ID,
  gatewayUrl: GATEWAY,
  logger: { debug: () => {}, error: console.error, info: () => {}, warn: console.warn },
  token: jwt,
  tokenType: 'jwt',
  userId,
});

console.log(`▶ gateway : ${GATEWAY}`);
console.log(`▶ device  : ${DEVICE_ID} (GatewayClient + DeviceTunnelHost)`);

await new Promise<void>((resolve, reject) => {
  client.on('connected', () => resolve());
  client.on('auth_failed', (reason) => reject(new Error(reason)));
  void client.connect();
  setTimeout(() => reject(new Error('connect timeout')), 20_000);
});
console.log('▶ authenticated\n');

const base = `${GATEWAY}/tunnel/${DEVICE_ID}/${ORIGIN_PORT}`;
const authHeaders = { Authorization: `Bearer ${jwt}` };

{
  const res = await fetch(`${base}/`, { headers: authHeaders });
  const text = await res.text();
  check('GET / → HTML round-trip', res.status === 200 && text.includes('real client origin'));
  check(
    'set-cookie stays split into two cookies',
    res.headers.getSetCookie().length === 2,
    res.headers.getSetCookie().join(' | '),
  );
}
{
  const res = await fetch(`${base}/gzip`, { headers: authHeaders });
  const text = await res.text();
  // Cloudflare re-compresses on its own hop (content-encoding: br here), so the
  // assertion is on the decoded body: the device must not forward the origin's
  // gzip label over bytes `fetch` already inflated.
  check(
    'gzip origin → body decodes correctly end to end',
    text === 'compressed-over-the-tunnel',
    `content-encoding at the browser: ${res.headers.get('content-encoding')}`,
  );
}
{
  const payload = Buffer.alloc(300 * 1024, 0x63);
  const res = await fetch(`${base}/echo`, { body: payload, headers: authHeaders, method: 'POST' });
  const echoed = Buffer.from(await res.arrayBuffer());
  check(
    'POST 300 KiB → request body round-trip',
    echoed.length === payload.length && echoed.equals(payload),
    `${echoed.length} bytes`,
  );
}
{
  const started = Date.now();
  const res = await fetch(`${base}/huge`, { headers: authHeaders });
  const buf = Buffer.from(await res.arrayBuffer());
  check(
    'GET 8 MiB → flow control holds past the 4 MiB cap',
    buf.length === 8 * 1024 * 1024,
    `${buf.length} bytes in ${Date.now() - started}ms`,
  );
}
{
  const res = await fetch(`${base}/missing`, { headers: authHeaders });
  check('GET /missing → 404 passthrough', res.status === 404 && (await res.text()) === 'not here');
}
{
  const controller = new AbortController();
  const res = await fetch(`${base}/sse`, { headers: authHeaders, signal: controller.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const stamps: number[] = [];
  let seen = '';
  while (stamps.length < 3) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += decoder.decode(value, { stream: true });
    const events = seen.split('\n\n').filter(Boolean).length;
    while (stamps.length < events && stamps.length < 3) stamps.push(Date.now());
  }
  controller.abort();
  const spread = stamps.length >= 3 ? stamps[2] - stamps[0] : -1;
  check(
    'GET /sse → events stream incrementally',
    stamps.length >= 3 && spread >= 100,
    `${spread}ms across 3 events`,
  );
}

await client.disconnect();
origin.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
