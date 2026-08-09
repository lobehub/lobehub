import { describe, expect, it } from 'vitest';

import { TaskRecommendationConfigurator } from './config';

/** @example The default allocation keeps every provider to two high-value task slots. */
describe('TaskRecommendationConfigurator', () => {
  /** @example Every non-empty provider set receives exactly two recommendation slots. */
  it('caps every provider at the fixed two-task budget', () => {
    const configurator = new TaskRecommendationConfigurator();
    expect([1, 2, 3, 4, 8].map((count) => configurator.recommendationsPerProvider(count))).toEqual([
      2, 2, 2, 2, 2,
    ]);
  });

  /** @example No providers means no generation budget. */
  it('returns zero for an invalid provider count', () => {
    expect(new TaskRecommendationConfigurator().recommendationsPerProvider(0)).toBe(0);
  });

  /** @example Shared writing policy stays independent from provider-owned collectors and guides. */
  it('exposes the shared recommendation writing policy', () => {
    const { writing } = new TaskRecommendationConfigurator();

    expect(writing.maxSourcesPerRecommendation).toBe(4);
  });
});
