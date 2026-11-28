/**
 * How long after the last request a provider's automatic (implicit) prompt cache is effectively
 * gone, by model family. These providers cache on their own terms and the request states no
 * lifetime, so it is taken from their documentation or, where they publish none, from observed
 * cache hits.
 *
 * Each value is the point where a follow-up request mostly misses the cache, not where it may
 * start to: an early value would flag a conversation that is still warm.
 *
 * Observed hit rates come from LobeHub Cloud chats (2026-11): the share of follow-up replies with
 * over half their input served from cache, grouped by the idle gap since the previous reply.
 *
 * Not listed:
 * - Claude: Anthropic only caches blocks marked with `cache_control`, so the lifetime comes from
 *   the request (`resolveCacheTTL`), never from the model name.
 * - DeepSeek: its disk cache lasts "a few hours to a few days"
 *   (https://api-docs.deepseek.com/guides/kv_cache); half the replies still hit after 2–6 hours.
 */
const IMPLICIT_CACHE_TTL_SECONDS: { pattern: RegExp; ttlSeconds: number }[] = [
  /**
   * OpenAI keeps entries 5–10 minutes of inactivity up to an hour, and at least 30 minutes on
   * GPT-5.6 and later (https://developers.openai.com/api/docs/guides/prompt-caching). Observed:
   * 55–60% hit up to 30 minutes, 29% at 30–60 minutes, 5% after an hour.
   */
  { pattern: /^(gpt-|chatgpt-|o\d)/, ttlSeconds: 3600 },
  /**
   * Kimi caches for 5 minutes unless the request asks for 1 hour
   * (https://platform.kimi.ai/docs/guide/context-caching). Observed: 20% hit at 5–7 minutes.
   */
  { pattern: /^(kimi-|moonshot-)/, ttlSeconds: 300 },
  /** Lifetime unpublished. Observed: 60% hit at 5–7 minutes, 12% at 15–30 minutes. */
  { pattern: /^glm-/, ttlSeconds: 1800 },
  /** Implicit caching lifetime unpublished. Observed: 26% hit at 5–7 minutes, 16% at 15–30. */
  { pattern: /^gemini-/, ttlSeconds: 1800 },
];

/**
 * Resolves the implicit prompt cache lifetime of a model, in seconds.
 *
 * Use when:
 * - The request stated no cache lifetime and the reply shows the provider served it from cache.
 *
 * Expects:
 * - `model` as sent upstream; a vendor prefix (`openai/gpt-5`) is ignored.
 *
 * Returns:
 * - `undefined` for families without a known lifetime, so callers never guess one.
 */
export const resolveImplicitCacheTTLSeconds = (model: string): number | undefined => {
  const id = model.toLowerCase().split('/').pop() ?? '';
  return IMPLICIT_CACHE_TTL_SECONDS.find(({ pattern }) => pattern.test(id))?.ttlSeconds;
};
