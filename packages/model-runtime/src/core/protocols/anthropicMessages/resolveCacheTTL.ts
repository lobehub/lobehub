import type Anthropic from '@anthropic-ai/sdk';

import type { ChatStreamPayload } from '../../../types';

type CacheTTL = Anthropic.Messages.CacheControlEphemeral['ttl'];

/** Anthropic caches for 5 minutes unless a request asks for `1h`. */
export const DEFAULT_CACHE_TTL = '5m' as const;

/**
 * Builds the `cache_control` marker for a breakpoint. Only the opt-in `1h` TTL is
 * written out: `5m` is the API default, so leaving `ttl` off keeps the default
 * request byte-identical to the pre-option payload (no cache churn on rollout).
 * All breakpoints share one TTL, which satisfies the API rule that longer-TTL
 * entries must precede shorter ones.
 */
export const buildCacheControl = (ttl?: CacheTTL): Anthropic.Messages.CacheControlEphemeral =>
  ttl === '1h' ? { ttl: '1h', type: 'ephemeral' } : { type: 'ephemeral' };

/**
 * Resolves cache TTL from Anthropic payload or request settings
 * Returns the first valid TTL found in system messages or content blocks
 */

export const resolveCacheTTL = (
  requestPayload: ChatStreamPayload,
  anthropicPayload: {
    messages: Anthropic.MessageCreateParams['messages'];
    system: Anthropic.MessageCreateParams['system'];
  },
): CacheTTL | undefined => {
  // Check system messages for cache TTL
  if (Array.isArray(anthropicPayload.system)) {
    for (const block of anthropicPayload.system) {
      const ttl = block.cache_control?.ttl;
      if (ttl) return ttl;
    }
  }

  // Check message content blocks for cache TTL
  for (const message of anthropicPayload.messages ?? []) {
    if (!Array.isArray(message.content)) continue;

    for (const block of message.content) {
      // Message content blocks might have cache_control property
      const ttl = ('cache_control' in block && block.cache_control?.ttl) as CacheTTL | undefined;
      if (ttl) return ttl;
    }
  }

  // Use default TTL if context caching is enabled
  if (requestPayload.enabledContextCaching) {
    return DEFAULT_CACHE_TTL;
  }

  return undefined;
};
