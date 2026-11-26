#!/usr/bin/env node
/**
 * Mint a desktop sign-in for a LOCAL dev server, with no OAuth page.
 *
 * Signs an access token the way the server's OIDC provider would (RS256 with the
 * server's own JWKS_KEY, client_id lobehub-desktop) for a user of the local
 * database, and writes the file the desktop app reads at boot through
 * LOBE_DESKTOP_DEV_REMOTE_LOGIN (dev builds only; see RemoteServerConfigCtr).
 *
 * Needs the local server's env: JWKS_KEY and DATABASE_URL. Run it with the repo
 * root .env loaded (`node --env-file=.env ...`). Never point it at production.
 *
 *   node --env-file=.env .agents/acceptance/scripts/mint-desktop-login.mjs \
 *     --out /path/login.json [--server http://localhost:3010] \
 *     [--email agent-testing@lobehub.com | --user-id user_x] [--days 30]
 */
import { randomUUID } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { calculateJwkThumbprint, importJWK, SignJWT } from 'jose';
import pg from 'pg';

const { values } = parseArgs({
  options: {
    'days': { default: '30', type: 'string' },
    'email': { default: 'agent-testing@lobehub.com', type: 'string' },
    'out': { type: 'string' },
    'server': { default: process.env.SERVER_URL || 'http://localhost:3010', type: 'string' },
    'user-id': { type: 'string' },
  },
});

const fail = (message) => {
  console.error(`[mint-desktop-login] ${message}`);
  process.exit(1);
};

if (!values.out) fail('--out is required');
const server = new URL(values.server);
if (!['localhost', '127.0.0.1', '[::1]'].includes(server.hostname))
  fail(`refusing to mint for ${server.origin}: only a local dev server is allowed`);

const jwksString = process.env.JWKS_KEY || process.env.OIDC_JWKS_KEY;
if (!jwksString) fail('JWKS_KEY is not set; load the local server env (node --env-file=.env)');
const signingKey = JSON.parse(jwksString).keys?.find(
  (key) => key.alg === 'RS256' && key.kty === 'RSA',
);
if (!signingKey) fail('JWKS_KEY has no RS256 RSA key');
const { key_ops: _keyOps, ...privateKey } = signingKey;

const findUserId = async () => {
  if (values['user-id']) return values['user-id'];
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set; pass --user-id instead');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query('select id from users where email = $1 limit 1', [
      values.email,
    ]);
    if (!rows[0]) fail(`no user ${values.email} in the local database; seed it first`);
    return rows[0].id;
  } finally {
    await client.end();
  }
};

const userId = await findUserId();
const expiresIn = Number(values.days) * 24 * 60 * 60;
const accessToken = await new SignJWT({
  client_id: 'lobehub-desktop',
  scope: 'openid profile email offline_access',
})
  .setProtectedHeader({
    alg: 'RS256',
    kid: privateKey.kid ?? (await calculateJwkThumbprint(privateKey)),
    typ: 'at+jwt',
  })
  .setAudience(server.origin)
  .setIssuer(server.origin)
  .setSubject(userId)
  .setIssuedAt()
  .setJti(randomUUID())
  .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
  .sign(await importJWK(privateKey, 'RS256'));

writeFileSync(
  values.out,
  JSON.stringify({ accessToken, expiresIn, remoteServerUrl: server.origin }, null, 2),
);
chmodSync(values.out, 0o600);
console.log(
  `[mint-desktop-login] ${userId} → ${server.origin}, valid ${values.days} days: ${values.out}`,
);
