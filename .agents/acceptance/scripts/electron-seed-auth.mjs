#!/usr/bin/env node
/**
 * Seed the Electron app's session from the same better-auth login `web-seed`
 * mints for the browser — no OAuth, no login page, no human step.
 *
 * This works because the desktop's backend proxy runs `net.fetch` on the app's
 * own Electron session, so that session's cookie jar is what actually
 * authenticates it. `Oidc-Auth` is only an *additional* path, and a stale token
 * there is worse than none: `createContext` tries it first and, when it fails to
 * validate, the request falls through to better-auth — which is why a profile
 * carrying another backend's token 401s even with a perfectly good cookie.
 *
 * The better-auth cookie is host-scoped (`localhost`) and cookies ignore ports,
 * so one seeded session covers every worktree's server.
 *
 * Usage: electron-seed-auth.mjs --state <web-state.json> [--port 9222] [--verify-only]
 * Exit codes: 0 seeded/already authenticated · 1 could not authenticate · 2 bad usage
 */
import fs from 'node:fs';

import WebSocket from 'ws';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};

const statePath = arg('--state');
const port = Number(arg('--port', '9222'));
const verifyOnly = args.includes('--verify-only');

if (!statePath && !verifyOnly) {
  console.error('usage: electron-seed-auth.mjs --state <web-state.json> [--port 9222]');
  process.exit(2);
}

const connect = async () => {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error(`no page target on CDP ${port}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
  const pending = new Map();
  let id = 0;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
  });
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const msgId = ++id;
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  return { close: () => ws.close(), send };
};

/** Ask the running app whether the SERVER accepts it — the store's own flag can lie. */
const serverAuthenticated = async (send) => {
  const expression = `(async () => {
    const input = encodeURIComponent(JSON.stringify({ json: {} }));
    const response = await fetch('/trpc/lambda/user.getUserState?input=' + input, {
      credentials: 'include',
    });
    return response.status;
  })()`;
  const { result } = await send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });

  return result?.result?.value === 200;
};

const main = async () => {
  const { close, send } = await connect();
  try {
    await send('Network.enable');

    if (await serverAuthenticated(send)) {
      console.log('electron session already authenticated');
      return 0;
    }
    if (verifyOnly) {
      console.log('electron session NOT authenticated');
      return 1;
    }

    if (!fs.existsSync(statePath)) {
      console.log(`no seeded web session at ${statePath} — run: setup-auth.sh web-seed`);
      return 1;
    }

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const cookies = (state.cookies ?? [])
      .filter((cookie) => String(cookie.domain).includes('localhost'))
      .map((cookie) => ({
        domain: cookie.domain,
        httpOnly: cookie.httpOnly ?? true,
        name: cookie.name,
        path: cookie.path ?? '/',
        sameSite: 'Lax',
        secure: false,
        value: cookie.value,
      }));

    if (cookies.length === 0) {
      console.log(`no localhost cookies in ${statePath} — run: setup-auth.sh web-seed`);
      return 1;
    }

    await send('Network.setCookies', { cookies });

    if (!(await serverAuthenticated(send))) {
      console.log('seeded the cookies but the server still rejects the session');
      return 1;
    }

    console.log(`seeded ${cookies.length} cookie(s) — electron session authenticated`);

    return 0;
  } finally {
    close();
  }
};

main().then(
  (code) => process.exit(code),
  (error) => {
    console.log(`electron auth seeding failed: ${error.message}`);
    process.exit(1);
  },
);
