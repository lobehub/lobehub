/**
 * Startup check for the Gateway Mode wiring of Docker Compose deployments.
 * Used by startServer.js (Docker runtime). It only warns: an incomplete setup
 * still runs, with agent runs falling back to the browser.
 *
 * IMPORTANT: Keep this file as CommonJS (.js) for compatibility with startServer.js
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports -- startServer.js loads this file through CommonJS.
const { createHash } = require('node:crypto');

const UPGRADE_DOC_URL =
  'https://lobehub.com/docs/self-hosting/platform/docker-compose#upgrading-an-existing-deployment';

/**
 * `kid` of the JWKS key that used to ship in docker-compose/deploy/.env.example.
 * Its private half is public, so anyone can sign tokens a server using it accepts.
 */
const PUBLIC_EXAMPLE_JWKS_KID = '6823046760c5d460';

/** JWK members that only a private RSA key carries. */
const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];

const isUnset = (value) => !value || value.startsWith('YOUR_');

/** Keys of a JWKS JSON string, `null` for invalid JWKS shape, `undefined` if unparsable. */
const readJwks = (raw) => {
  try {
    const keys = JSON.parse(raw)?.keys;
    return Array.isArray(keys) && keys.every((key) => key && typeof key === 'object') ? keys : null;
  } catch {
    return undefined;
  }
};

/** Match the kid that oidc-provider assigns to legacy keys that omit one. */
const withDerivedKid = (key) => ({
  ...key,
  kid:
    key.kid ??
    createHash('sha256')
      .update(JSON.stringify({ e: key.e, kty: 'RSA', n: key.n }))
      .digest('base64url'),
});

const getRsaSigningKeys = (keys) =>
  keys?.filter((key) => key.alg === 'RS256' && key.kty === 'RSA').map(withDerivedKid) || [];

const hasAmbiguousKeyIds = (keys) => {
  if (keys.length < 2) return false;
  const keyIds = keys.map((key) => key.kid);
  return (
    keyIds.some((kid) => typeof kid !== 'string' || kid.length === 0) ||
    new Set(keyIds).size !== keyIds.length
  );
};

const publicKeySetCoversPrivateKeys = (privateKeys, publicKeys) => {
  const publicByKid = new Map(publicKeys.map((key) => [key.kid, key]));
  return privateKeys.every((privateKey) => {
    const publicKey = publicByKid.get(privateKey.kid);
    return (
      publicKey &&
      publicKey.kty === privateKey.kty &&
      publicKey.alg === privateKey.alg &&
      publicKey.n === privateKey.n &&
      publicKey.e === privateKey.e
    );
  });
};

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Array<{ name: string; vars: string[]; message: string }>}
 */
function collectGatewayConfigIssues(env = process.env) {
  const issues = [];
  const privateJwks = isUnset(env.JWKS_KEY) ? undefined : readJwks(env.JWKS_KEY);
  const privateRsaKeys = getRsaSigningKeys(privateJwks);

  if (privateRsaKeys.some((key) => key.kid === PUBLIC_EXAMPLE_JWKS_KID)) {
    issues.push({
      message:
        'JWKS_KEY is the example key that was published in .env.example. Anyone can forge tokens this server and its gateway accept. Generate a new key and replace it in .env.',
      name: 'Public example JWKS_KEY',
      vars: ['JWKS_KEY'],
    });
  }

  // Set by docker-compose.yml; other deployments opt in explicitly.
  if (env.ENABLE_AGENT_GATEWAY !== '1') return issues;

  const missing = [];
  if (isUnset(env.AGENT_GATEWAY_URL)) missing.push('AGENT_GATEWAY_URL');
  if (isUnset(env.AGENT_GATEWAY_SERVICE_TOKEN)) missing.push('GATEWAY_SERVICE_TOKEN');
  if (isUnset(env.JWKS_KEY)) missing.push('JWKS_KEY');
  else if (!privateJwks || privateRsaKeys.length === 0)
    missing.push('JWKS_KEY (not valid JWKS JSON)');

  const publicJwks = isUnset(env.JWKS_PUBLIC_KEY) ? undefined : readJwks(env.JWKS_PUBLIC_KEY);
  const publicRsaKeys = getRsaSigningKeys(publicJwks);
  if (isUnset(env.JWKS_PUBLIC_KEY)) missing.push('JWKS_PUBLIC_KEY');
  else if (!publicJwks || publicRsaKeys.length === 0)
    missing.push('JWKS_PUBLIC_KEY (not valid JWKS JSON)');

  if (missing.length > 0) {
    issues.push({
      message:
        'docker-compose.yml enables Gateway Mode, but .env is missing its settings. The gateway container cannot start and agent runs fall back to the browser. Add the variables to .env, then run `docker compose up -d --force-recreate`.',
      name: 'Gateway Mode is not configured',
      vars: missing,
    });
  }

  if (publicJwks?.some((key) => PRIVATE_JWK_FIELDS.some((field) => field in key))) {
    issues.push({
      message:
        'JWKS_PUBLIC_KEY is passed to the gateway container, but it includes the private key. Anyone who can read the gateway environment could forge tokens. Replace it with the public half of JWKS_KEY.',
      name: 'JWKS_PUBLIC_KEY contains the private key',
      vars: ['JWKS_PUBLIC_KEY'],
    });
  }

  const ambiguousVars = [];
  if (hasAmbiguousKeyIds(privateRsaKeys)) ambiguousVars.push('JWKS_KEY');
  if (hasAmbiguousKeyIds(publicRsaKeys)) ambiguousVars.push('JWKS_PUBLIC_KEY');
  if (ambiguousVars.length > 0) {
    issues.push({
      message:
        'JWKS key rotation requires every RS256 RSA key to have a unique kid so verifiers can select exactly one key.',
      name: 'JWKS key ids are ambiguous',
      vars: ambiguousVars,
    });
  }

  if (
    privateRsaKeys.length > 0 &&
    publicRsaKeys.length > 0 &&
    ambiguousVars.length === 0 &&
    !publicKeySetCoversPrivateKeys(privateRsaKeys, publicRsaKeys)
  ) {
    issues.push({
      message:
        'JWKS_PUBLIC_KEY does not contain every signing key in JWKS_KEY, so the gateway may reject newly signed browser sessions. Publish the complete public set before enabling a new signing key.',
      name: 'JWKS_PUBLIC_KEY does not match JWKS_KEY',
      vars: ['JWKS_PUBLIC_KEY'],
    });
  }

  return issues;
}

/**
 * Print a prominent warning for every Gateway Mode configuration issue.
 * @param {NodeJS.ProcessEnv} [env]
 */
function checkGatewayConfig(env = process.env) {
  const issues = collectGatewayConfigIssues(env);
  if (issues.length === 0) return issues;

  console.warn('\n' + '═'.repeat(70));
  console.warn('⚠️  ACTION REQUIRED: Gateway Mode configuration needs attention');
  console.warn('═'.repeat(70));

  for (const issue of issues) {
    console.warn(`\n⚠️ ${issue.name}`);
    console.warn('─'.repeat(50));
    for (const envVar of issue.vars) {
      console.warn(`  • ${envVar}`);
    }
    console.warn(`\n${issue.message}`);
  }

  console.warn(`\n📖 Upgrade guide: ${UPGRADE_DOC_URL}`);
  console.warn('═'.repeat(70) + '\n');

  return issues;
}

module.exports = { checkGatewayConfig, collectGatewayConfigIssues, PUBLIC_EXAMPLE_JWKS_KID };
