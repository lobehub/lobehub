import { describe, expect, it } from 'vitest';

import { TaskRecommendationConfigurator } from './config';

/** @example The default target distributes recommendations without a provider-count table. */
describe('TaskRecommendationConfigurator', () => {
  /** @example 1→6, 2→5, 3→3, and 4→2 recommendations per provider. */
  it('clamps a rounded fair share to configured bounds', () => {
    const configurator = new TaskRecommendationConfigurator();
    expect([1, 2, 3, 4, 8].map((count) => configurator.recommendationsPerProvider(count))).toEqual([
      6, 5, 3, 2, 2,
    ]);
  });

  /** @example No providers means no generation budget. */
  it('returns zero for an invalid provider count', () => {
    expect(new TaskRecommendationConfigurator().recommendationsPerProvider(0)).toBe(0);
  });

  /** @example Runtime collection limits remain paired with prompt-package provider guides. */
  it('combines operational provider settings with prompt guides', () => {
    const { providers, writing } = new TaskRecommendationConfigurator();

    expect(providers.github).toMatchObject({ maxContextLength: 24_000, maxSignals: 24 });
    expect(providers.github.examples.length).toBeGreaterThan(0);
    expect(providers.gmail.queries).toHaveLength(3);
    expect(writing.maxSourcesPerRecommendation).toBe(4);
  });
});
