#!/usr/bin/env node

/**
 * Extract RS256 public key from JWKS_KEY environment variable.
 * Output is the JSON string to use with `wrangler secret put JWKS_PUBLIC_KEY`.
 *
 * Usage:
 *   JWKS_KEY='{"keys":[...]}' node scripts/extract-public-key.mjs
 *   # or load from .env
 *   node --env-file=../../.env scripts/extract-public-key.mjs
 */

const jwksString = process.env.JWKS_KEY;

if (!jwksString) {
  console.error('Error: JWKS_KEY environment variable is not set.');
  process.exit(1);
}

const jwks = JSON.parse(jwksString);
const privateKey = jwks.keys?.find((k) => k.alg === 'RS256' && k.kty === 'RSA');

if (!privateKey) {
  console.error('Error: No RS256 RSA key found in JWKS_KEY.');
  process.exit(1);
}

const publicJwks = {
  keys: [
    {
      alg: privateKey.alg,
      e: privateKey.e,
      kid: privateKey.kid,
      kty: privateKey.kty,
      n: privateKey.n,
      use: privateKey.use,
    },
  ],
};

// Remove undefined fields
for (const key of publicJwks.keys) {
  for (const [k, v] of Object.entries(key)) {
    if (v === undefined) delete key[k];
  }
}

console.log(JSON.stringify(publicJwks));
