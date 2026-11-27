import type Anthropic from '@anthropic-ai/sdk';

import type { ChatStreamPayload } from '../../../types';

type CacheTTL = Anthropic.Messages.CacheControlEphemeral['ttl'];

/** Anthropic caches for 5 minutes unless a request asks for `1h`. */
export const DEFAULT_CACHE_TTL = '5m' as const;
/**
 * Resolves the cache TTL of the request actually sent to Anthropic.
 *
 * Returns the first explicit TTL found in system or message content blocks. A
 * block that asks for caching without a TTL caches for {@link DEFAULT_CACHE_TTL}:
 * the payload builder enables caching unless the request opts out, so a request
 * that never set `enabledContextCaching` still carries `cache_control` blocks.
 * Returns `undefined` only when the request asked for no caching at all.
 */
export const resolveCacheTTL = (
  requestPayload: ChatStreamPayload,
  anthropicPayload: {
    messages: Anthropic.MessageCreateParams['messages'];
    system: Anthropic.MessageCreateParams['system'];
  },
): CacheTTL | undefined => {
  let requestsCaching = false;

  // Check system messages for cache TTL
  if (Array.isArray(anthropicPayload.system)) {
    for (const block of anthropicPayload.system) {
      if (!block.cache_control) continue;
      requestsCaching = true;
      if (block.cache_control.ttl) return block.cache_control.ttl;
    }
  }

  // Check message content blocks for cache TTL
  for (const message of anthropicPayload.messages ?? []) {
    if (!Array.isArray(message.content)) continue;

    for (const block of message.content) {
      // Message content blocks might have cache_control property
      const cacheControl =
        'cache_control' in block
          ? (block.cache_control as Anthropic.Messages.CacheControlEphemeral | null | undefined)
          : undefined;
      if (!cacheControl) continue;
      requestsCaching = true;
      if (cacheControl.ttl) return cacheControl.ttl;
    }
  }

  if (requestsCaching || requestPayload.enabledContextCaching) return DEFAULT_CACHE_TTL;

  return undefined;
};

const CACHE_TTL_SECONDS: Record<string, number> = { '1h': 3600, '5m': 300 };

/**
 * Converts a resolved cache TTL (`5m`, `1h`) to seconds. Returns `undefined`
 * for values the provider does not define, so callers never guess a lifetime.
 */
export const cacheTTLToSeconds = (ttl: unknown): number | undefined =>
  typeof ttl === 'string' ? CACHE_TTL_SECONDS[ttl] : undefined;
