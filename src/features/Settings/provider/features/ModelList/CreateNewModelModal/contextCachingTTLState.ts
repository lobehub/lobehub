import {
  getContextCachingTTLOptions,
  getDefaultContextCachingTTL,
  isContextCachingTTLRequestable,
  resolveContextCachingTTL,
} from '@lobechat/model-runtime/utils/contextCachingTTL';
import type { ContextCachingTTL } from 'model-bank';

export interface ContextCachingTTLState {
  /** Provider default, applied while the field is cleared. */
  defaultTTL: ContextCachingTTL;
  /** What requests and context engineering use, from the same resolver they call. */
  effectiveTTL: ContextCachingTTL;
  /** True when the default is in effect: nothing picked, or a pick the provider can't request. */
  isDefault: boolean;
  options: readonly ContextCachingTTL[];
  /** Whether the pick changes the request, or only tells context engineering the cache window. */
  requestable: boolean;
}

/** What the model config's cache-duration field shows for a provider and the stored value. */
export const getContextCachingTTLState = (
  provider: string,
  value?: string | null,
): ContextCachingTTLState => {
  const defaultTTL = getDefaultContextCachingTTL(provider);
  const effectiveTTL = resolveContextCachingTTL({ provider, ttl: value }) ?? defaultTTL;

  return {
    defaultTTL,
    effectiveTTL,
    isDefault: !value || effectiveTTL !== value,
    options: getContextCachingTTLOptions(provider),
    requestable: isContextCachingTTLRequestable(provider),
  };
};

/** Prompt caching only applies to chat models; a model being created may have no type yet. */
export const hasContextCachingTTL = (type?: string | null): boolean => !type || type === 'chat';

/**
 * Drop the cache duration from a non-chat model's values, so picking one and then switching the
 * type away does not store a setting the model never uses.
 */
export const omitContextCachingTTLUnlessChat = <
  T extends { settings?: { contextCachingTTL?: unknown } | null; type?: string | null },
>(
  values: T,
): T =>
  hasContextCachingTTL(values.type) || !values.settings
    ? values
    : ({ ...values, settings: { ...values.settings, contextCachingTTL: undefined } } as T);
