/** Providers that use Aico wallet → provisioned OpenRouter keys (never BYOK). */
export const AICO_MANAGED_RUNTIME_PROVIDERS = ['aico', 'openrouter'] as const;

export type AicoManagedRuntimeProvider = (typeof AICO_MANAGED_RUNTIME_PROVIDERS)[number];

export const isAicoManagedRuntimeProvider = (
  provider: string | null | undefined,
): provider is AicoManagedRuntimeProvider => provider === 'aico' || provider === 'openrouter';

/** Keep only wallet-backed provider groups (and drop empty groups). */
export const filterAicoManagedProviders = <T extends { children?: unknown[]; id: string }>(
  list: T[],
): T[] => list.filter((provider) => isAicoManagedRuntimeProvider(provider.id));
