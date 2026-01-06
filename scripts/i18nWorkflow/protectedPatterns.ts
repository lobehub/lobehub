/**
 * Protected patterns for i18n keys
 *
 * Keys matching these patterns will be considered "used" even if not found in static analysis.
 * This is useful for dynamically generated keys like:
 * - t(`modelProvider.${providerId}.title`)
 * - t('error.' + errorCode)
 */

/**
 * Files to ignore at file level (won't be scanned at all)
 */
export const IGNORED_FILES = [
  'clerk.ts', // Clerk third-party library translations
  'providers.ts', // Dynamically generated from DEFAULT_MODEL_PROVIDER_LIST
  'models.ts', // Dynamically generated from LOBE_DEFAULT_MODEL_LIST
  'auth.ts', // Auth-related dynamic keys
  'authError.ts', // Auth error dynamic keys
  'error.ts', // Error messages with dynamic codes
  'migration.ts', // Migration-related dynamic keys
  'subscription.ts',
  'electron.ts', // Electron-specific dynamic keys
  'editor.ts', // Editor-related dynamic keys
  'changelog.ts', // Changelog dynamic keys
  'ragEval.ts',
  'plugin.ts',
  'tools.ts',
  'oauth.ts',
];

/**
 * Namespace patterns to protect (keys won't be marked as unused)
 */
export const PROTECTED_KEY_PATTERNS = [
  // === Namespaces with extensive dynamic usage ===
  'modelProvider', // t(`modelProvider.${providerId}.title`)

  // Discover namespace has many dynamic keys
  'discover', // t(`assistants.status.${statusKey}.subtitle`)

  // Setting namespace with dynamic agent configurations
  'setting', // t(`systemAgent.${key}.label`)

  // Hotkey namespace uses dynamic key construction
  'hotkey', // t(`${item.id}.desc`, { ns: 'hotkey' })

  // Home namespace with dynamic starter keys
  'home', // t(`starter.${key}`)

  // Welcome namespace with returnObjects usage
  'welcome', // t('welcomeMessages', { returnObjects: true })

  // Chat namespace has dynamic input keys
  'chat', // t(`input.${key}`)

  // File namespace - used in hooks that receive t as parameter
  'file', // TFunction<'file'> passed as parameter

  // MarketAuth namespace - has Trans components with dynamic keys
  'marketAuth', // <Trans i18nKey="authorize.footer.agreement" />

  // Onboarding namespace - has various dynamic usage patterns
  'onboarding', // Onboarding flow with complex Trans usage
  'error',
  'errors',
  'consent.error',
  'builtins',

  // === Add your custom patterns here ===
  // Examples:
  // 'error.code',           // Protects all error.code.* keys
  // 'plugin.settings',      // Protects all plugin.settings.* keys
  // 'tool',                 // Protects entire 'tool' namespace
];

/**
 * How to use:
 *
 * 1. IGNORED_FILES - Files to completely skip during analysis:
 *    Add filename with .ts extension (e.g., 'clerk.ts')
 *    These files won't be scanned at all
 *
 * 2. PROTECTED_KEY_PATTERNS - Namespace/patterns to protect:
 *    - Full namespace: 'myNamespace' protects all keys under that namespace
 *    - Prefix pattern: 'namespace.prefix' protects keys starting with that prefix
 *      (e.g., 'error.code' protects 'error.code.NOT_FOUND', 'error.code.TIMEOUT', etc.)
 *
 * 3. After modifying this file:
 *    - Run `bun run workflow:i18n-analyze` to regenerate the report
 *    - Run `bun run workflow:i18n-clean` to preview cleanup (both use same config)
 *    - Check the console output for "Protected patterns" to verify your config
 */
