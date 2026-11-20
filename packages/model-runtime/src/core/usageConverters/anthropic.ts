import type Anthropic from '@anthropic-ai/sdk';
import type { ModelUsage } from '@lobechat/types';

import type { ChatPayloadForTransformStream } from '../streams/protocol';
import { withUsageCost } from './utils/withUsageCost';

export const buildAnthropicInitialUsage = (
  usage: Anthropic.Messages.Usage | null | undefined,
): ModelUsage | undefined => {
  if (!usage) return undefined;

  let totalInputTokens = usage.input_tokens;

  if (usage.cache_creation_input_tokens || usage.cache_read_input_tokens) {
    totalInputTokens =
      (usage.input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0);
  }

  const totalOutputTokens = usage.output_tokens;

  return {
    inputCacheMissTokens: usage.input_tokens,
    inputCachedTokens: usage.cache_read_input_tokens ?? undefined,
    inputWriteCacheTokens: usage.cache_creation_input_tokens || undefined,
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  } satisfies ModelUsage;
};

/** A field the delta reports replaces the earlier value, as the official SDK's MessageStream does. */
const pickReported = (previous: number | undefined, reported: number | null | undefined) =>
  typeof reported === 'number' ? reported : previous;

/**
 * `message_delta.usage` is a cumulative snapshot, not an increment
 * (https://platform.claude.com/docs/en/build-with-claude/streaming), and the official SDK's
 * MessageStream overwrites the snapshot with it. Relays differ in where the full usage lives:
 *
 * - Native Anthropic / Bedrock: input and cache on `message_start`; the final delta repeats them
 *   (or omits them) and carries the cumulative output.
 * - Vercel AI Gateway and MiniMax: `message_start` reports 0/0 and only the final delta carries
 *   input, cache and output (https://github.com/vercel/ai/issues/17326).
 * - OpenRouter: both events carry the same full usage, so adding output double counts it.
 *
 * Two zeros are treated as "not counted here" instead of a correction, so they cannot erase a
 * value `message_start` already reported: an output of 0 (cumulative output never shrinks), and a
 * delta whose input and cache fields are all 0.
 */
const mergeDeltaUsage = (
  previousUsage: ModelUsage | undefined,
  deltaUsage: Anthropic.MessageDeltaUsage | null | undefined,
): ModelUsage | undefined => {
  const usage: Partial<Anthropic.MessageDeltaUsage> = deltaUsage ?? {};
  const reportsInput =
    typeof usage.input_tokens === 'number' ||
    typeof usage.cache_read_input_tokens === 'number' ||
    typeof usage.cache_creation_input_tokens === 'number';
  const reportedInputTokens =
    (usage.input_tokens || 0) +
    (usage.cache_read_input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0);

  if (!previousUsage && !reportsInput && !usage.output_tokens) {
    return undefined;
  }

  const base: ModelUsage = previousUsage ? { ...previousUsage } : {};
  const totalOutputTokens = usage.output_tokens || previousUsage?.totalOutputTokens || 0;

  if (reportsInput && (reportedInputTokens > 0 || !previousUsage?.totalInputTokens)) {
    const initial = buildAnthropicInitialUsage({
      cache_creation_input_tokens:
        pickReported(previousUsage?.inputWriteCacheTokens, usage.cache_creation_input_tokens) ??
        null,
      cache_read_input_tokens:
        pickReported(previousUsage?.inputCachedTokens, usage.cache_read_input_tokens) ?? null,
      input_tokens: pickReported(previousUsage?.inputCacheMissTokens, usage.input_tokens) || 0,
      output_tokens: totalOutputTokens,
    } as Anthropic.Messages.Usage)!;

    base.inputCacheMissTokens = initial.inputCacheMissTokens;
    base.inputCachedTokens = initial.inputCachedTokens;
    base.inputWriteCacheTokens = initial.inputWriteCacheTokens;
    base.totalInputTokens = initial.totalInputTokens;
  }

  const totalInputTokens = base.totalInputTokens || 0;
  const totalTokens = totalInputTokens + totalOutputTokens;

  base.totalInputTokens = totalInputTokens;
  base.totalOutputTokens = totalOutputTokens;

  if (totalTokens > 0) {
    base.totalTokens = totalTokens;
  }

  return base;
};

export const convertAnthropicUsage = (
  messageEvent: Anthropic.MessageStreamEvent,
  streamContextUsage?: ModelUsage,
  payload?: ChatPayloadForTransformStream,
): ModelUsage | undefined => {
  switch (messageEvent.type) {
    case 'message_start': {
      return buildAnthropicInitialUsage(messageEvent.message.usage);
    }
    case 'message_delta': {
      const usage = mergeDeltaUsage(streamContextUsage, messageEvent.usage);
      return usage && withUsageCost(usage, payload?.pricing, payload?.pricingOptions);
    }
    default: {
      return streamContextUsage;
    }
  }
};
