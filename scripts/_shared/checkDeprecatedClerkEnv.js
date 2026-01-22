/**
 * Shared utility to check for deprecated Clerk environment variables.
 * Used by both prebuild.mts (build time) and startServer.js (Docker runtime).
 *
 * IMPORTANT: Keep this file as CommonJS (.js) for compatibility with startServer.js
 */

const CLERK_MIGRATION_DOC_URL =
  'https://lobehub.com/docs/self-hosting/advanced/auth/clerk-to-betterauth';

const CLERK_ENV_VARS = [
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'CLERK_WEBHOOK_SECRET',
];

/**
 * Check for deprecated Clerk environment variables and exit if found
 * @param {object} options
 * @param {string} [options.action='redeploy'] - Action hint in error message ('redeploy' or 'restart')
 */
function checkDeprecatedClerkEnv(options = {}) {
  const { action = 'redeploy' } = options;
  const foundClerkEnvVars = CLERK_ENV_VARS.filter((envVar) => process.env[envVar]);

  if (foundClerkEnvVars.length > 0) {
    console.error('\n' + '═'.repeat(70));
    console.error('❌ ERROR: Clerk authentication is no longer supported!');
    console.error('═'.repeat(70));
    console.error('\nDetected deprecated Clerk environment variables:');
    for (const envVar of foundClerkEnvVars) {
      console.error(`  • ${envVar}`);
    }
    console.error('\nClerk has been removed from LobeChat. Please migrate to Better Auth.');
    console.error(`\n📖 Migration guide: ${CLERK_MIGRATION_DOC_URL}`);
    console.error(`\nAfter migration, remove the Clerk environment variables and ${action}.`);
    console.error('═'.repeat(70) + '\n');
    process.exit(1);
  }
}

module.exports = { checkDeprecatedClerkEnv };
