import type { LobeAgentChatConfig } from '@lobechat/types';
import type { ContextCachingTTL } from 'model-bank/aiModel';
import { CONTEXT_CACHING_TTL_OPTIONS } from 'model-bank/aiModel';

/** Cache lifetime of a provider that declares none below: the order of most implicit caches. */
export const DEFAULT_CONTEXT_CACHING_TTL: ContextCachingTTL = '5m';

/**
 * A provider's cache lifetime when neither the user's model config nor the model card sets one.
 */
export const PROVIDER_DEFAULT_CONTEXT_CACHING_TTL: Readonly<Record<string, ContextCachingTTL>> = {
  // Requested on every breakpoint. 1h writes cost 2× base input (5m: 1.25×) but keep a prefix
  // warm across the 5–60 minute gaps between coding turns.
  anthropic: '1h',
  // Automatic disk cache: an unused entry is cleared "usually within a few hours to a few days"
  // (KV-cache guide); the upper bound, so a still-warm prefix is never priced as cold.
  deepseek: '72h',
};

/**
 * TTLs a provider's API lets a request choose, shortest (the API default) first. The request
 * writes the resolved one; elsewhere the TTL only tells context engineering how long a prefix
 * stays warm. Anthropic-compatible endpoints (Bedrock, Kimi, MiniMax, proxies…) are absent on
 * purpose: they don't document `cache_control.ttl`.
 */
export const PROVIDER_REQUESTABLE_CONTEXT_CACHING_TTLS: Readonly<
  Record<string, readonly ContextCachingTTL[]>
> = {
  anthropic: ['5m', '1h'],
};

/** Whether the provider's API takes the TTL, i.e. whether the setting changes the request. */
export const isContextCachingTTLRequestable = (provider: string): boolean =>
  !!PROVIDER_REQUESTABLE_CONTEXT_CACHING_TTLS[provider];

/** The TTLs a user can pick for a model of this provider. */
export const getContextCachingTTLOptions = (provider: string): readonly ContextCachingTTL[] =>
  PROVIDER_REQUESTABLE_CONTEXT_CACHING_TTLS[provider] ?? CONTEXT_CACHING_TTL_OPTIONS;

export const getDefaultContextCachingTTL = (provider: string): ContextCachingTTL =>
  PROVIDER_DEFAULT_CONTEXT_CACHING_TTL[provider] ?? DEFAULT_CONTEXT_CACHING_TTL;

export interface ResolveContextCachingTTLContext {
  /** Only `disableContextCaching` is read, and only when the model declares that switch. */
  chatConfig?: Pick<LobeAgentChatConfig, 'disableContextCaching'> | null;
  /** The extend params the model declares (user row ← provider card ← canonical card). */
  modelExtendParams?: readonly string[] | null;
  provider: string;
  /** The model's `settings.contextCachingTTL`: the user's model config over the provider card. */
  ttl?: string | null;
}

/**
 * The prompt-cache lifetime in effect for a model, shared by the request (which writes it where
 * the API takes one), context engineering (which tells warm prefixes from cold ones with it) and
 * the provider's model config (which shows it), so the three always agree. A value the provider
 * cannot request falls back to its default. Undefined only when the agent turned context caching
 * off: no breakpoint is written, so no lifetime applies.
 */
export const resolveContextCachingTTL = ({
  chatConfig,
  modelExtendParams,
  provider,
  ttl,
}: ResolveContextCachingTTLContext): ContextCachingTTL | undefined => {
  if (modelExtendParams?.includes('disableContextCaching') && chatConfig?.disableContextCaching)
    return;

  const options: readonly string[] = getContextCachingTTLOptions(provider);
  return ttl && options.includes(ttl)
    ? (ttl as ContextCachingTTL)
    : getDefaultContextCachingTTL(provider);
};

/**
 * The TTL the request payload carries: only where the API takes one, and only when it is not the
 * API default (`5m` on Anthropic), so a default request stays byte-identical to one sent before
 * the setting existed.
 */
export const resolveRequestContextCachingTTL = (
  provider: string,
  ttl: ContextCachingTTL | undefined,
): ContextCachingTTL | undefined => {
  const options = PROVIDER_REQUESTABLE_CONTEXT_CACHING_TTLS[provider];
  return options && ttl && ttl !== options[0] && options.includes(ttl) ? ttl : undefined;
};
