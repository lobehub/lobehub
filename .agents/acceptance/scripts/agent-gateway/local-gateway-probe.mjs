#!/usr/bin/env node
// local-gateway-probe.mjs — prove a LOCAL gateway accepts the app's JWT.
//
// Signs a user JWT with the app's local JWKS_KEY (the same key the browser
// uses) and opens the gateway WS auth handshake. Decisive feasibility check
// for the local closed loop: expect {"type":"auth_success"}. Against the
// ONLINE gateway the same JWT yields {"type":"auth_failed","reason":
// "signature verification failed"} — that contrast is the whole point.
//
// JWKS_KEY source resolution (do NOT assume `.env.local` exists — the managed
// agent-testing flow has no `.env.local`; the key lives in the dev env / a
// `.records/env/*.env` file). Order:
//   1. process.env.JWKS_KEY            (export it before running)
//   2. JWKS_SOURCE=<file>              (any env file with a JWKS_KEY= line)
//   3. .records/env/gateway.env        (managed flow default)
//
// Run from the lobehub repo root (needs `jose` from its node_modules):
//   JWKS_KEY="$JWKS_KEY" node .agents/acceptance/scripts/agent-gateway/local-gateway-probe.mjs
//   JWKS_SOURCE=.env.local node .../local-gateway-probe.mjs            # explicit file
//   GATEWAY_WS=ws://localhost:8787 node .../local-gateway-probe.mjs    # override ws

import { existsSync, readFileSync } from 'node:fs';

import { importJWK, SignJWT } from 'jose';

const WS_BASE = process.env.GATEWAY_WS || 'ws://localhost:8787';

const fromFile = (p) => {
  if (!p || !existsSync(p)) return '';
  const m = readFileSync(p, 'utf8').match(/^JWKS_KEY=(.*)$/m);
  return m ? m[1].trim().replaceAll(/^['"]|['"]$/g, '') : '';
};
const jwksRaw =
  process.env.JWKS_KEY?.trim() ||
  fromFile(process.env.JWKS_SOURCE) ||
  fromFile(new URL('../../../../.records/env/gateway.env', import.meta.url).pathname);
if (!jwksRaw) {
  console.error(
    '❌ no JWKS_KEY found — export JWKS_KEY, or set JWKS_SOURCE=<env file>, or create .records/env/gateway.env',
  );
  process.exit(1);
}
const rsa = JSON.parse(jwksRaw).keys.find((k) => k.alg === 'RS256' && k.kty === 'RSA');
const key = await importJWK(rsa, 'RS256');

const token = await new SignJWT({ purpose: 'cli-sandbox' })
  .setProtectedHeader({ alg: 'RS256', kid: rsa.kid })
  .setSubject('user_local_probe')
  .setIssuedAt()
  .setExpirationTime('5m')
  .sign(key);
console.log('signed JWT kid=', rsa.kid, 'len=', token.length);

const ws = new WebSocket(`${WS_BASE}/ws?operationId=op_local_probe_001`);
const exit = (msg, code = 0) => {
  console.log(msg);
  try {
    ws.close();
  } catch {}
  setTimeout(() => process.exit(code), 100);
};
ws.onopen = () => {
  console.log('WS open →', WS_BASE, '→ sending auth');
  ws.send(JSON.stringify({ type: 'auth', token }));
};
ws.onmessage = (e) => {
  console.log('RECV:', e.data);
  if (/auth_success/.test(e.data))
    exit('✅ local gateway accepts the app JWT — closed loop is feasible');
  else if (/auth_failed/.test(e.data))
    exit('❌ auth_failed — JWKS_PUBLIC_KEY does not match the app JWKS_KEY', 1);
};
ws.onerror = (e) =>
  exit(
    '❌ WS error: ' +
      (e.message || e.type) +
      ' (is the gateway running? `bun run dev` in agent-gateway/)',
    1,
  );
setTimeout(() => exit('❌ timeout (no auth reply)', 1), 8000);
