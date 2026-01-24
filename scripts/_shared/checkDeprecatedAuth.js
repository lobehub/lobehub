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
        ENABLE_MAGIC_LINK: 'AUTH_ENABLE_MAGIC_LINK',
        NEXT_PUBLIC_AUTH_EMAIL_VERIFICATION: 'AUTH_EMAIL_VERIFICATION',
        NEXT_PUBLIC_ENABLE_MAGIC_LINK: 'AUTH_ENABLE_MAGIC_LINK',
      };
      return `${envVar} → Please use ${mapping[envVar]} instead`;
    },
    getVars: () =>
      [
        'ENABLE_MAGIC_LINK',
        'NEXT_PUBLIC_AUTH_EMAIL_VERIFICATION',
        'NEXT_PUBLIC_ENABLE_MAGIC_LINK',
      ].filter((key) => process.env[key]),
    message: 'Please update to the new environment variable names.',
    name: 'Deprecated Auth',
  },
  {
    getVars: () => (process.env['NEXT_PUBLIC_SERVICE_MODE'] ? ['NEXT_PUBLIC_SERVICE_MODE'] : []),
    message:
      'LobeChat 2.0 no longer supports client-side database mode. This environment variable is now obsolete and can be removed.',
    name: 'Service Mode',
  },
  {
    getVars: () => (process.env['ACCESS_CODE'] ? ['ACCESS_CODE'] : []),
    message:
      'ACCESS_CODE is no longer supported in LobeChat 2.0. Please use Better Auth authentication system instead.',
    name: 'Access Code',
  },
  {
    getVars: () =>
      process.env['NEXT_PUBLIC_ENABLE_BETTER_AUTH'] ? ['NEXT_PUBLIC_ENABLE_BETTER_AUTH'] : [],
    message:
      'NEXT_PUBLIC_ENABLE_BETTER_AUTH is no longer needed. Better Auth is now automatically detected via AUTH_SECRET presence.',
    name: 'Better Auth Flag',
  },
  {
    getVars: () => ['NEXT_PUBLIC_AUTH_URL', 'AUTH_URL'].filter((key) => process.env[key]),
    message:
      'AUTH_URL is no longer needed. The authentication URL is now automatically detected from request headers.',
    name: 'Auth URL',
  },
  {
    docUrl: `${MIGRATION_DOC_BASE}/nextauth-to-betterauth`,
    formatVar: (envVar) => {
      const mapping = {
        AUTH_AZURE_AD_ID: 'AUTH_MICROSOFT_ID',
        AUTH_AZURE_AD_SECRET: 'AUTH_MICROSOFT_SECRET',
        AUTH_AZURE_AD_TENANT_ID: 'No longer needed',
        AZURE_AD_CLIENT_ID: 'AUTH_MICROSOFT_ID',
        AZURE_AD_CLIENT_SECRET: 'AUTH_MICROSOFT_SECRET',
        AZURE_AD_TENANT_ID: 'No longer needed',
      };
      return `${envVar} → ${mapping[envVar]}`;
    },
    getVars: () =>
      [
        'AZURE_AD_CLIENT_ID',
        'AZURE_AD_CLIENT_SECRET',
        'AZURE_AD_TENANT_ID',
        'AUTH_AZURE_AD_ID',
        'AUTH_AZURE_AD_SECRET',
        'AUTH_AZURE_AD_TENANT_ID',
      ].filter((key) => process.env[key]),
    message:
      'Azure AD provider has been renamed to Microsoft. Please update your environment variables.',
    name: 'Azure AD',
  },
  {
    formatVar: (envVar) => {
      const mapping = {
        ZITADEL_CLIENT_ID: 'AUTH_ZITADEL_ID',
        ZITADEL_CLIENT_SECRET: 'AUTH_ZITADEL_SECRET',
        ZITADEL_ISSUER: 'AUTH_ZITADEL_ISSUER',
      };
      return `${envVar} → Please use ${mapping[envVar]} instead`;
    },
    getVars: () =>
      ['ZITADEL_CLIENT_ID', 'ZITADEL_CLIENT_SECRET', 'ZITADEL_ISSUER'].filter(
        (key) => process.env[key],
      ),
    message: 'ZITADEL environment variables have been renamed.',
    name: 'ZITADEL',
  },
  {
    formatVar: () => 'OIDC_JWKS_KEY → Please use JWKS_KEY instead',
    getVars: () => (process.env['OIDC_JWKS_KEY'] ? ['OIDC_JWKS_KEY'] : []),
    message: 'OIDC_JWKS_KEY has been renamed to JWKS_KEY.',
    name: 'OIDC JWKS',
  },
  {
    docUrl: `${MIGRATION_DOC_BASE}/nextauth-to-betterauth`,
    formatVar: (envVar) => {
      const mapping = {
        AUTH_MICROSOFT_ENTRA_ID_BASE_URL: 'No longer needed',
        AUTH_MICROSOFT_ENTRA_ID_ID: 'AUTH_MICROSOFT_ID',
        AUTH_MICROSOFT_ENTRA_ID_SECRET: 'AUTH_MICROSOFT_SECRET',
        AUTH_MICROSOFT_ENTRA_ID_TENANT_ID: 'No longer needed',
      };
      return `${envVar} → ${mapping[envVar]}`;
    },
    getVars: () =>
      [
        'AUTH_MICROSOFT_ENTRA_ID_ID',
        'AUTH_MICROSOFT_ENTRA_ID_SECRET',
        'AUTH_MICROSOFT_ENTRA_ID_TENANT_ID',
        'AUTH_MICROSOFT_ENTRA_ID_BASE_URL',
      ].filter((key) => process.env[key]),
    message:
      'Microsoft Entra ID provider has been renamed to Microsoft. Please update your environment variables.',
    name: 'Microsoft Entra ID',
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
