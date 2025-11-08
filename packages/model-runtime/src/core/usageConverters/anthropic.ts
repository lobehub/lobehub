import Anthropic from '@anthropic-ai/sdk';
import { ModelUsage } from '@lobechat/types';

import { ChatPayloadForTransformStream } from '../streams/protocol';
import { withUsageCost } from './utils/withUsageCost';

const buildInitialUsage = (
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

  return {
    inputCacheMissTokens: usage.input_tokens,
    inputCachedTokens: usage.cache_read_input_tokens || undefined,
    inputWriteCacheTokens: usage.cache_creation_input_tokens || undefined,
    totalInputTokens,
    totalOutputTokens: usage.output_tokens,
  } satisfies ModelUsage;
};

const mergeDeltaUsage = (
  previousUsage: ModelUsage | undefined,
  usage: Anthropic.MessageDeltaUsage | null | undefined,
): ModelUsage | undefined => {
  const deltaOutputTokens = usage?.output_tokens || 0;

  if (!previousUsage && deltaOutputTokens === 0) {
    return undefined;
  }

  const base: ModelUsage = previousUsage ? { ...previousUsage } : {};
  const totalOutputTokens = (previousUsage?.totalOutputTokens || 0) + deltaOutputTokens;
  const totalInputTokens = previousUsage?.totalInputTokens || 0;
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
      return buildInitialUsage(messageEvent.message.usage);
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
