/**
 * Shared utility to check for deprecated authentication environment variables.
 * Used by both prebuild.mts (build time) and startServer.js (Docker runtime).
 *
 * IMPORTANT: Keep this file as CommonJS (.js) for compatibility with startServer.js
 */

const MIGRATION_DOC_BASE = 'https://lobehub.com/docs/self-hosting/advanced/auth';

/**
 * Deprecated environment variable checks configuration
 * @type {Array<{
 *   name: string;
 *   getVars: () => string[];
 *   message: string;
 *   docUrl?: string;
 *   formatVar?: (envVar: string) => string;
 * }>}
 */
const DEPRECATED_CHECKS = [
  {
    docUrl: `${MIGRATION_DOC_BASE}/nextauth-to-betterauth`,
    getVars: () =>
      Object.keys(process.env).filter(
        (key) => key.startsWith('NEXT_AUTH') || key.startsWith('NEXTAUTH'),
      ),
    message: 'NextAuth has been removed from LobeChat. Please migrate to Better Auth.',
    name: 'NextAuth',
  },
  {
    docUrl: `${MIGRATION_DOC_BASE}/clerk-to-betterauth`,
    getVars: () =>
      ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'CLERK_WEBHOOK_SECRET'].filter(
        (key) => process.env[key],
      ),
    message: 'Clerk has been removed from LobeChat. Please migrate to Better Auth.',
    name: 'Clerk',
  },
  {
    formatVar: (envVar) => {
      const mapping = {
        NEXT_PUBLIC_AUTH_EMAIL_VERIFICATION: 'AUTH_EMAIL_VERIFICATION',
        NEXT_PUBLIC_ENABLE_MAGIC_LINK: 'ENABLE_MAGIC_LINK',
      };
      return `${envVar} → Please use ${mapping[envVar]} instead`;
    },
    getVars: () =>
      ['NEXT_PUBLIC_AUTH_EMAIL_VERIFICATION', 'NEXT_PUBLIC_ENABLE_MAGIC_LINK'].filter(
        (key) => process.env[key],
      ),
    message: 'Please update to the new environment variable names.',
    name: 'Deprecated Auth',
  },
];

/**
 * Print error message and exit
 */
function printErrorAndExit(name, vars, message, action, docUrl, formatVar) {
  console.error('\n' + '═'.repeat(70));
  console.error(`❌ ERROR: ${name} environment variables are deprecated!`);
  console.error('═'.repeat(70));
  console.error('\nDetected deprecated environment variables:');
  for (const envVar of vars) {
    console.error(`  • ${formatVar ? formatVar(envVar) : envVar}`);
  }
  console.error(`\n${message}`);
  if (docUrl) {
    console.error(`\n📖 Migration guide: ${docUrl}`);
  }
  console.error(`\nPlease update your environment variables and ${action}.`);
  console.error('═'.repeat(70) + '\n');
  process.exit(1);
}

/**
 * Check for deprecated authentication environment variables and exit if found
 * @param {object} options
 * @param {string} [options.action='redeploy'] - Action hint in error message ('redeploy' or 'restart')
 */
function checkDeprecatedAuth(options = {}) {
  const { action = 'redeploy' } = options;

  for (const check of DEPRECATED_CHECKS) {
    const foundVars = check.getVars();
    if (foundVars.length > 0) {
      printErrorAndExit(
        check.name,
        foundVars,
        check.message,
        action,
        check.docUrl,
        check.formatVar,
      );
    }
  }
}

module.exports = { checkDeprecatedAuth };
