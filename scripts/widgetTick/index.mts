/**
 * Fire one widget scheduler tick against a local server — the same
 * request the `lobe-widget-tick` QStash schedule sends every minute.
 *
 *   bun run widget:tick                 # run every due widget now
 *   bun run widget:tick --dry-run       # only report how many are due
 *   SERVER_URL=http://localhost:3011 bun run widget:tick
 *
 * When QSTASH_CURRENT_SIGNING_KEY is set the route verifies signatures, so the
 * request is signed with that key the way QStash would; otherwise it is sent
 * unsigned, which the route accepts.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';

const serverUrl = (
  process.env.SERVER_URL ||
  process.env.APP_URL ||
  'http://localhost:3010'
).replace(/\/$/, '');
const url = `${serverUrl}/api/workflows/widget/tick`;
const body = JSON.stringify({ dryRun: process.argv.includes('--dry-run') });

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

/** An Upstash-Signature JWT over `body`, as QStash would send it. */
const sign = (key: string) => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      body: base64url(createHash('sha256').update(body).digest()),
      exp: now + 300,
      iat: now,
      iss: 'Upstash',
      jti: randomUUID(),
      nbf: now,
      sub: url,
    }),
  );
  const signature = base64url(createHmac('sha256', key).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${signature}`;
};

const signingKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
const response = await fetch(url, {
  body,
  headers: {
    'content-type': 'application/json',
    ...(signingKey && { 'Upstash-Signature': sign(signingKey) }),
  },
  method: 'POST',
});

console.log(`POST ${url} → ${response.status}${signingKey ? ' (signed)' : ''}`);
console.log(JSON.stringify(await response.json(), null, 2));
if (!response.ok) process.exit(1);
