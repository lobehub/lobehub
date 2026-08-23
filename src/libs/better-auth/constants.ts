/**
 * Canonical IDs of Better-Auth built-in social providers.
 * Keep this list in sync with provider definitions in `src/libs/better-auth/sso/providers`.
 */
export const BUILTIN_BETTER_AUTH_PROVIDERS = [
  'apple',
  'google',
  'github',
  'cognito',
  'microsoft',
] as const;

/**
 * Provider alias → canonical ID mapping.
 * This is used on the client to normalize configured provider keys.
 */
export const PROVIDER_ALIAS_MAP: Record<string, string> = {
  'microsoft-entra-id': 'microsoft',
};

/**
 * Returned when deleting a passkey would remove the account's last currently usable sign-in method.
 */
export const PASSKEY_DELETE_REQUIRES_FALLBACK_ERROR = 'PASSKEY_DELETE_REQUIRES_FALLBACK';
