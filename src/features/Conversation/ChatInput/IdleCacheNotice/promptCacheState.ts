import { estimateChatCostFromTokens } from '@lobechat/model-runtime/estimateChatCost';
import type { MessagePromptCache, UIChatMessage } from '@lobechat/types';
import type { Pricing } from 'model-bank';

/**
 * The extra cost of the next reply, over what it costs with a warm cache, that is worth
 * interrupting the user about. Below it the re-read costs cents, and a notice after every idle
 * pause would teach the user to ignore it. Matches Caxri's cache notice.
 */
export const IDLE_CACHE_NOTICE_MIN_EXTRA_USD = 0.25;

/**
 * The share of the model's context window the conversation needs before the notice shows. A
 * conversation filling a small part of the window re-reads about as much as any ordinary turn,
 * so a fresh conversation would not be meaningfully cheaper. Matches Caxri's cache notice.
 */
export const IDLE_CACHE_NOTICE_MIN_CONTEXT_SHARE = 0.2;

/** What the latest reply left in the provider prompt cache. */
export interface PromptCacheSnapshot {
  /**
   * Tokens the next request re-sends before the draft: the latest request's input plus the
   * reply it produced, which becomes part of the history.
   */
  contextTokens: number;
  /** Epoch milliseconds at which the provider is expected to drop the cache. */
  expiresAt: number;
  /** The latest request's input, which a warm cache serves at the cache-read price. */
  inputTokens: number;
  /** Id of the reply the snapshot describes; a dismissal holds until a newer reply. */
  messageId: string;
  model?: string;
  provider?: string;
  ttlSeconds: number;
}

const getUsage = (message: UIChatMessage) => message.usage ?? message.metadata?.usage;

/**
 * Reads the prompt cache the conversation's latest reply left.
 *
 * Use when:
 * - Deciding whether the next reply re-reads the whole conversation at the cache-write price.
 *
 * Expects:
 * - `messages` are the conversation's flat DB messages in send order.
 *
 * Returns:
 * - The snapshot of the latest assistant message with recorded usage. User or tool messages and
 *   usage-less replies after it (a failed or aborted run) are skipped, since that run never
 *   reached the cache. `undefined` when that reply did not ask the provider to cache, so the
 *   lifetime is unknown and nothing is guessed.
 */
export const getPromptCacheSnapshot = (
  messages: UIChatMessage[],
): PromptCacheSnapshot | undefined => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;

    const usage = getUsage(message);
    const inputTokens = usage?.totalInputTokens;
    if (!usage || !inputTokens) continue;

    const promptCache: MessagePromptCache | undefined = message.metadata?.promptCache;
    if (!promptCache) return;

    return {
      contextTokens: inputTokens + (usage.totalOutputTokens ?? 0),
      expiresAt: promptCache.requestStartedAt + promptCache.ttlSeconds * 1000,
      inputTokens,
      messageId: message.id,
      model: message.model ?? undefined,
      provider: message.provider ?? undefined,
      ttlSeconds: promptCache.ttlSeconds,
    };
  }

  return;
};

/** Pricing lookup value for the cache-write price of a lifetime (Anthropic prices `5m` and `1h`). */
export const toTTLLookup = (ttlSeconds: number) => (ttlSeconds >= 3600 ? '1h' : '5m');

export interface NextReplyCostEstimate {
  /** The next reply after the cache expired: the whole history is written to the cache again. */
  coldCost: number;
  /** The same reply while the cache is warm: the history is read from the cache. */
  warmCost: number;
}

/**
 * Estimates the next reply's cost with a warm and with an expired prompt cache.
 *
 * Both include the same estimated output, so the difference is only the re-read. `undefined`
 * when the model has no price.
 */
export const estimateNextReplyCost = (
  snapshot: PromptCacheSnapshot,
  pricing: Pricing | undefined,
  maxOutputTokens?: number,
): NextReplyCostEstimate | undefined => {
  const options = { lookupParams: { ttl: toTTLLookup(snapshot.ttlSeconds) } };
  const estimate = (readTokens: number) =>
    estimateChatCostFromTokens(
      pricing,
      {
        maxOutputTokens,
        promptCache: { readTokens, writesUncached: true },
        textTokens: snapshot.contextTokens,
      },
      options,
    )?.estimatedCost;

  const warmCost = estimate(snapshot.inputTokens);
  const coldCost = estimate(0);
  if (warmCost === undefined || coldCost === undefined) return;

  return { coldCost, warmCost };
};

/**
 * Whether an expired cache is worth a notice: re-reading costs at least
 * {@link IDLE_CACHE_NOTICE_MIN_EXTRA_USD} more than a warm reply, and the conversation fills at least
 * {@link IDLE_CACHE_NOTICE_MIN_CONTEXT_SHARE} of the model's window. A model whose card states no
 * window stays quiet: without it a fresh conversation cannot be shown to be meaningfully cheaper.
 */
export const isIdleCacheNoticeworthy = (
  snapshot: PromptCacheSnapshot,
  cost: NextReplyCostEstimate,
  contextWindowTokens?: number,
): boolean => {
  if (
    !contextWindowTokens ||
    snapshot.contextTokens / contextWindowTokens < IDLE_CACHE_NOTICE_MIN_CONTEXT_SHARE
  )
    return false;

  return cost.coldCost - cost.warmCost >= IDLE_CACHE_NOTICE_MIN_EXTRA_USD;
};
