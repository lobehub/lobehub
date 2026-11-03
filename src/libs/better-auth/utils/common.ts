import { BUILTIN_BETTER_AUTH_PROVIDERS, PROVIDER_ALIAS_MAP } from '@/libs/better-auth/constants';

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
