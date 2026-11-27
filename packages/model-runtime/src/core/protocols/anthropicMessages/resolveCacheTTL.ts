import type Anthropic from '@anthropic-ai/sdk';

import type { ChatStreamPayload } from '../../../types';

type CacheTTL = Anthropic.Messages.CacheControlEphemeral['ttl'];

/** Anthropic caches for 5 minutes unless a request asks for `1h`. */
export const DEFAULT_CACHE_TTL = '5m' as const;
export interface ResolveCacheTTLOptions {
  /**
   * The upstream is Anthropic's own cache (the Anthropic API, Claude on Bedrock), which keeps a
   * `cache_control` block without a TTL for {@link DEFAULT_CACHE_TTL}. Leave it off for other
   * Messages-compatible providers (DeepSeek, Moonshot, MiniMax, ...): they accept the same blocks
   * but cache on their own terms (DeepSeek's disk cache lasts hours), so a TTL reported for them
   * would make a still-warm cache look expired.
   */
  anthropicCache?: boolean;
}

/**
 * Resolves the cache TTL of the request actually sent upstream.
 *
 * Returns the first explicit TTL found in system or message content blocks, or
 * {@link DEFAULT_CACHE_TTL} when the request explicitly enabled context caching. With
 * `anthropicCache`, a block that asks for caching without a TTL also resolves to the default:
 * the payload builder enables caching unless the request opts out, so a request that never set
 * `enabledContextCaching` still carries `cache_control` blocks.
 */
export const resolveCacheTTL = (
  requestPayload: ChatStreamPayload,
  anthropicPayload: {
    messages: Anthropic.MessageCreateParams['messages'];
    system: Anthropic.MessageCreateParams['system'];
  },
  { anthropicCache = false }: ResolveCacheTTLOptions = {},
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

  if ((anthropicCache && requestsCaching) || requestPayload.enabledContextCaching) {
    return DEFAULT_CACHE_TTL;
  }

  return undefined;
};

const CACHE_TTL_SECONDS: Record<string, number> = { '1h': 3600, '5m': 300 };

/**
 * Converts a resolved cache TTL (`5m`, `1h`) to seconds. Returns `undefined`
 * for values the provider does not define, so callers never guess a lifetime.
 */
export const cacheTTLToSeconds = (ttl: unknown): number | undefined =>
  typeof ttl === 'string' ? CACHE_TTL_SECONDS[ttl] : undefined;
