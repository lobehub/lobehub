import { z } from 'zod';

/**
 * Provider prompt-cache facts of the request that produced an assistant
 * message, written by the agent runtime when the request asked the provider to
 * cache its prefix (Anthropic `cache_control`).
 *
 * The provider restarts the cache lifetime whenever a request reads the cache,
 * so the cache is expected to expire `ttlSeconds` after `requestStartedAt`.
 * This is the requested lifetime, not an observed one: a routed request may
 * still miss the cache earlier when it lands on another upstream account.
 */
export interface MessagePromptCache {
  /** Epoch milliseconds at which the request was sent to the provider. */
  requestStartedAt: number;
  /** Cache lifetime the request asked for, in seconds (300 for `5m`, 3600 for `1h`). */
  ttlSeconds: number;
}

export const MessagePromptCacheSchema = z.object({
  requestStartedAt: z.number(),
  ttlSeconds: z.number(),
});
