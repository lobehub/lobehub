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

const isUnset = (value) => !value || value.startsWith('YOUR_');

const readJwksKid = (raw) => {
  try {
    const kid = JSON.parse(raw)?.keys?.[0]?.kid;
    return typeof kid === 'string' ? kid : null;
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
  const jwksKid = isUnset(env.JWKS_KEY) ? undefined : readJwksKid(env.JWKS_KEY);

  if (jwksKid === PUBLIC_EXAMPLE_JWKS_KID) {
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
  else if (jwksKid === undefined) missing.push('JWKS_KEY (not valid JWKS JSON)');

  if (missing.length > 0) {
    issues.push({
      message:
        'docker-compose.yml enables Gateway Mode, but .env is missing its settings. The gateway container cannot start and agent runs fall back to the browser. Add the variables to .env, then run `docker compose up -d --force-recreate`.',
      name: 'Gateway Mode is not configured',
      vars: missing,
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
