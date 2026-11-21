import type { ModelTokensUsage } from '@lobechat/types';
import type { Pricing } from 'model-bank';
import anthropicChatModels from 'model-bank/anthropic';
import { describe, expect, it } from 'vitest';

import { computeChatCost } from './computeChatCost';

const cacheWriteOf = (result: ReturnType<typeof computeChatCost>) =>
  result?.breakdown.find((item) => item.unit.name === 'textInput_cacheWrite');

describe('computeChatCost lookup defaults', () => {
  it('bills a cache write at the 5-minute price when the caller resolves no TTL', () => {
    // OpenAI-compatible providers fall back to the Anthropic card without passing a TTL.
    const pricing = anthropicChatModels.find((model) => model.id === 'claude-fable-5-1')?.pricing;
    const usage: ModelTokensUsage = { inputWriteCacheTokens: 1_000_000 };

    const result = computeChatCost(pricing, usage);

    expect(result?.issues).toEqual([]);
    expect(cacheWriteOf(result)).toMatchObject({ credits: 12_500_000, lookupKey: '5m' });
  });

  it('keeps pricing an explicit 1-hour TTL at the 1-hour price', () => {
    const pricing = anthropicChatModels.find((model) => model.id === 'claude-fable-5-1')?.pricing;
    const usage: ModelTokensUsage = { inputWriteCacheTokens: 1_000_000 };

    const result = computeChatCost(pricing, usage, { lookupParams: { ttl: '1h' } });

    expect(cacheWriteOf(result)).toMatchObject({ credits: 20_000_000, lookupKey: '1h' });
  });

  it('still reports a missing non-TTL lookup param without billing it', () => {
    const pricing: Pricing = {
      units: [
        {
          lookup: { prices: { high: 2, low: 1 }, pricingParams: ['quality'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    };

    const result = computeChatCost(pricing, { inputWriteCacheTokens: 1_000_000 });

    expect(result?.issues[0]?.reason).toContain('Missing lookup params: quality');
    expect(cacheWriteOf(result)?.credits).toBe(0);
  });
});
