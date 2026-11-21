import type { ModelTokensUsage } from '@lobechat/types';
import type { Pricing } from 'model-bank';
import anthropicChatModels from 'model-bank/anthropic';
import { describe, expect, it } from 'vitest';

import { computeChatCost } from './computeChatCost';

describe('Anthropic mixed-ttl cache-write pricing', () => {
  // Server tools add automatic 5m cache writes even when the request's own
  // cache_control uses a 1h TTL (docs: tool-use-with-prompt-caching), so each
  // bucket must be priced at its own rate — never the request-level ttl alone.
  const pricing = (anthropicChatModels as { id: string; pricing?: Pricing }[]).find(
    (m) => m.id === 'claude-opus-5',
  )?.pricing;

  const usage: ModelTokensUsage = {
    inputCacheMissTokens: 0,
    inputWriteCacheTokens: 3_000,
    inputWriteCacheTokens1h: 2_000,
    inputWriteCacheTokens5m: 1_000,
    totalInputTokens: 3_000,
    totalOutputTokens: 0,
    totalTokens: 3_000,
  };

  it('prices each ttl bucket at its own rate even when the request ttl says 1h', () => {
    expect(pricing).toBeDefined();

    const result = computeChatCost(pricing, usage, { lookupParams: { ttl: '1h' } });
    expect(result?.issues).toHaveLength(0);

    const write = result?.breakdown.find((item) => item.unit.name === 'textInput_cacheWrite');
    expect(write?.segments).toEqual([
      { credits: 1_000 * 6.25, quantity: 1_000, rate: 6.25 },
      { credits: 2_000 * 10, quantity: 2_000, rate: 10 },
    ]);
    expect(write?.credits).toBe(1_000 * 6.25 + 2_000 * 10);
  });

  it('prices the split without any lookup params at all', () => {
    const result = computeChatCost(pricing, usage);
    expect(result?.issues).toHaveLength(0);

    const write = result?.breakdown.find((item) => item.unit.name === 'textInput_cacheWrite');
    expect(write?.credits).toBe(1_000 * 6.25 + 2_000 * 10);
  });

  it('keeps the other lookup params when a card keys cache writes by more than ttl', () => {
    const compositePricing: Pricing = {
      units: [
        {
          lookup: {
            prices: { '1h_standard': 10, '5m_standard': 6.25 },
            pricingParams: ['ttl', 'tier'],
          },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    };

    const result = computeChatCost(compositePricing, usage, {
      lookupParams: { tier: 'standard', ttl: '1h' },
    });
    expect(result?.issues).toHaveLength(0);

    const write = result?.breakdown.find((item) => item.unit.name === 'textInput_cacheWrite');
    expect(write?.credits).toBe(1_000 * 6.25 + 2_000 * 10);
  });
});
