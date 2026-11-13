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
