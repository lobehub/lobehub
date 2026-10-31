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
  'twitter',
] as const;

/**
 * Providers that users can link to an existing account but never sign in or sign up with.
 * X is linked only to identify which account an X user belongs to; offering it as a login
 * method would bypass the email-based sign-up checks.
 */
export const LINK_ONLY_SSO_PROVIDERS: readonly string[] = ['twitter'];

/**
 * Display names for providers whose id differs from their current brand name.
 * Other providers render their id, capitalized by CSS.
 */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  twitter: 'X',
};

/**
 * Provider alias → canonical ID mapping.
 * This is used on the client to normalize configured provider keys.
 */
export const PROVIDER_ALIAS_MAP: Record<string, string> = {
  'microsoft-entra-id': 'microsoft',
};
