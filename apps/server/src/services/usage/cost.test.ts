import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { type ModelUsage } from '@/types/message';

import { computeMessageCostSplit } from './cost';

// Pick any builtin model that has cache-read pricing so the savings math is exercised.
const priced = LOBE_DEFAULT_MODEL_LIST.find(
  (m) =>
    m.pricing?.units?.some((u: any) => u.name === 'textInput') &&
    m.pricing?.units?.some((u: any) => u.name === 'textInput_cacheRead'),
)!;

describe('computeMessageCostSplit', () => {
  it('attributes the whole billed cost to input when pricing is unknown', () => {
    const usage: ModelUsage = { totalInputTokens: 100, totalOutputTokens: 50, totalTokens: 150 };
    const split = computeMessageCostSplit(usage, 'no-such-provider', 'no-such-model', 0.42);

    expect(split.totalCost).toBe(0.42);
    expect(split.inputCost).toBe(0.42);
    expect(split.cachedInputCost).toBe(0);
    expect(split.outputCost).toBe(0);
    expect(split.cacheWriteCost).toBe(0);
    expect(split.cacheSavings).toBe(0);
  });

  it('reconciles the cost split to the authoritative billed cost', () => {
    const usage: ModelUsage = {
      cost: 1.5,
      inputCacheMissTokens: 1000,
      inputCachedTokens: 4000,
      inputWriteCacheTokens: 500,
      totalInputTokens: 5000,
      totalOutputTokens: 800,
      totalTokens: 5800,
    };
    const split = computeMessageCostSplit(usage, priced.providerId, priced.id, 1.5);

    expect(split.totalCost).toBeCloseTo(1.5, 6);
    // input + cached input + output + cache-write must sum back to the billed total
    expect(
      split.inputCost + split.cachedInputCost + split.outputCost + split.cacheWriteCost,
    ).toBeCloseTo(1.5, 6);
    expect(split.inputCost).toBeGreaterThan(0);
    expect(split.cachedInputCost).toBeGreaterThan(0);
    expect(split.outputCost).toBeGreaterThan(0);
  });

  it('reports positive cache savings when tokens were read from cache', () => {
    const usage: ModelUsage = {
      inputCachedTokens: 1_000_000,
      inputCacheMissTokens: 0,
      totalInputTokens: 1_000_000,
      totalOutputTokens: 0,
    };
    const split = computeMessageCostSplit(usage, priced.providerId, priced.id, 0);

    // savings = cachedTokens × (inputRate − cachedRate) / 1e6, strictly positive
    expect(split.cacheSavings).toBeGreaterThan(0);
    expect(split.cacheReadTokens).toBe(1_000_000);
  });

  it('passes through token components', () => {
    const usage: ModelUsage = {
      inputWriteCacheTokens: 300,
      totalInputTokens: 1200,
      totalOutputTokens: 400,
      totalTokens: 1600,
    };
    const split = computeMessageCostSplit(usage, priced.providerId, priced.id, 0);

    expect(split.inputTokens).toBe(1200);
    expect(split.outputTokens).toBe(400);
    expect(split.cacheWriteTokens).toBe(300);
    expect(split.totalTokens).toBe(1600);
  });
});
