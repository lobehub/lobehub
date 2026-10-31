import {
  BUILTIN_BETTER_AUTH_PROVIDERS,
  LINK_ONLY_SSO_PROVIDERS,
  PROVIDER_ALIAS_MAP,
  PROVIDER_DISPLAY_NAMES,
} from '@/libs/better-auth/constants';

/**
 * Normalize provider id using configured alias map (e.g. microsoft-entra-id -> microsoft).
 */
export const normalizeProviderId = (provider: string) => {
  return PROVIDER_ALIAS_MAP[provider] || provider;
};

/**
 * Check whether a provider is handled by Better-Auth's built-in social providers.
 * Uses alias normalization so callers can pass either canonical ids or aliases.
 */
export const isBuiltinProvider = (provider: string) => {
  const normalized = normalizeProviderId(provider);

  return BUILTIN_BETTER_AUTH_PROVIDERS.includes(
    normalized as (typeof BUILTIN_BETTER_AUTH_PROVIDERS)[number],
  );
};

/**
 * Check whether a provider can only be linked to an existing account, not used to sign in.
 */
export const isLinkOnlyProvider = (provider: string) =>
  LINK_ONLY_SSO_PROVIDERS.includes(normalizeProviderId(provider));

/**
 * Get the display name of a provider, falling back to its id.
 */
export const getProviderDisplayName = (provider: string) =>
  PROVIDER_DISPLAY_NAMES[normalizeProviderId(provider)] ?? provider;

/**
 * Whether unlinking `provider` still leaves the user a way to sign in.
 * Link-only accounts can always be unlinked; they never count as a sign-in method.
 */
export const canUnlinkProvider = ({
  hasPasswordAccount,
  linkedProviders,
  provider,
}: {
  hasPasswordAccount: boolean;
  /** Provider ids of every linked account, one entry per account */
  linkedProviders: string[];
  provider: string;
}) => {
  if (isLinkOnlyProvider(provider) || hasPasswordAccount) return true;

  return linkedProviders.filter((item) => !isLinkOnlyProvider(item)).length > 1;
};
