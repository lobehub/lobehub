/**
 * Startup check for the Gateway Mode wiring of Docker Compose deployments.
 * Used by startServer.js (Docker runtime). It only warns: an incomplete setup
 * still runs, with agent runs falling back to the browser.
 *
 * IMPORTANT: Keep this file as CommonJS (.js) for compatibility with startServer.js
 */

const UPGRADE_DOC_URL =
  'https://lobehub.com/docs/self-hosting/platform/docker-compose#upgrading-an-existing-deployment';

/**
 * `kid` of the JWKS key that used to ship in docker-compose/deploy/.env.example.
 * Its private half is public, so anyone can sign tokens a server using it accepts.
 */
const PUBLIC_EXAMPLE_JWKS_KID = '6823046760c5d460';

/** JWK members that only a private RSA key carries. */
const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi'];

const isUnset = (value) => !value || value.startsWith('YOUR_');

/** First key of a JWKS JSON string, `null` for valid JSON without keys, `undefined` if unparsable. */
const readFirstJwk = (raw) => {
  try {
    const key = JSON.parse(raw)?.keys?.[0];
    return key && typeof key === 'object' ? key : null;
  } catch {
    return undefined;
  }
};

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Array<{ name: string; vars: string[]; message: string }>}
 */
function collectGatewayConfigIssues(env = process.env) {
  const issues = [];
  const privateJwk = isUnset(env.JWKS_KEY) ? undefined : readFirstJwk(env.JWKS_KEY);

  if (privateJwk?.kid === PUBLIC_EXAMPLE_JWKS_KID) {
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
  else if (privateJwk === undefined) missing.push('JWKS_KEY (not valid JWKS JSON)');

  const publicJwk = isUnset(env.JWKS_PUBLIC_KEY) ? undefined : readFirstJwk(env.JWKS_PUBLIC_KEY);
  if (isUnset(env.JWKS_PUBLIC_KEY)) missing.push('JWKS_PUBLIC_KEY');
  else if (publicJwk === undefined) missing.push('JWKS_PUBLIC_KEY (not valid JWKS JSON)');

  if (missing.length > 0) {
    issues.push({
      message:
        'docker-compose.yml enables Gateway Mode, but .env is missing its settings. The gateway container cannot start and agent runs fall back to the browser. Add the variables to .env, then run `docker compose up -d --force-recreate`.',
      name: 'Gateway Mode is not configured',
      vars: missing,
    });
  }

  if (publicJwk && PRIVATE_JWK_FIELDS.some((field) => field in publicJwk)) {
    issues.push({
      message:
        'JWKS_PUBLIC_KEY is passed to the gateway container, but it includes the private key. Anyone who can read the gateway environment could forge tokens. Replace it with the public half of JWKS_KEY.',
      name: 'JWKS_PUBLIC_KEY contains the private key',
      vars: ['JWKS_PUBLIC_KEY'],
    });
  }

  if (privateJwk?.n && publicJwk?.n && privateJwk.n !== publicJwk.n) {
    issues.push({
      message:
        'JWKS_PUBLIC_KEY is not the public half of JWKS_KEY, so the gateway rejects every browser session and agent runs fall back to the browser. Derive it again from JWKS_KEY.',
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
