import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { computeChatCost } from './computeChatCost';

describe('computeChatCost with millionCharacters units', () => {
  it('bills textInput by inputCharacters for a fixed character rate', () => {
    const pricing: Pricing = {
      units: [{ name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionCharacters' }],
    };

    const result = computeChatCost(pricing, { inputCharacters: 2000 });

    expect(result?.breakdown).toHaveLength(1);
    expect(result?.breakdown[0]).toMatchObject({ quantity: 2000 });
    expect(result?.totalCost).toBe(0.03);
  });

  it('ignores token counts for character-billed units', () => {
    const pricing: Pricing = {
      units: [{ name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionCharacters' }],
    };

    const result = computeChatCost(pricing, { inputTextTokens: 5000, totalInputTokens: 5000 });

    expect(result?.breakdown).toHaveLength(0);
    expect(result?.totalCost).toBe(0);
  });

  it('converts CNY character rates to USD', () => {
    const pricing: Pricing = {
      currency: 'CNY',
      units: [{ name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionCharacters' }],
    };

    // 1M chars × ¥2 = ¥2 = $1 at a 2:1 rate
    const result = computeChatCost(pricing, { inputCharacters: 1_000_000 }, { usdToCnyRate: 2 });

    expect(result?.totalCost).toBe(1);
  });

  it('supports tiered character pricing', () => {
    const pricing: Pricing = {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 10, upTo: 1000 },
            { rate: 20, upTo: 'infinity' },
          ],
          unit: 'millionCharacters',
        },
      ],
    };

    expect(computeChatCost(pricing, { inputCharacters: 500 })?.totalCredits).toBe(5000);
    expect(computeChatCost(pricing, { inputCharacters: 2000 })?.totalCredits).toBe(40_000);
  });
});
