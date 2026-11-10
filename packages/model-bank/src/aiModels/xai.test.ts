import { describe, expect, it } from 'vitest';

import { allModels } from './xai';

describe('xai model cards', () => {
  /** @see https://docs.x.ai/developers/pricing */
  it('bills grok-4.5 prompts of 200K+ tokens at double rates', () => {
    const card = allModels.find((model) => model.id === 'grok-4.5');

    expect(card?.pricing?.units).toEqual([
      {
        name: 'textInput_cacheRead',
        strategy: 'tiered',
        tiers: [
          { rate: 0.3, upTo: 199_999 },
          { rate: 0.6, upTo: 'infinity' },
        ],
        unit: 'millionTokens',
      },
      {
        name: 'textInput',
        strategy: 'tiered',
        tiers: [
          { rate: 2, upTo: 199_999 },
          { rate: 4, upTo: 'infinity' },
        ],
        unit: 'millionTokens',
      },
      {
        name: 'textOutput',
        strategy: 'tiered',
        tiers: [
          { rate: 6, upTo: 199_999 },
          { rate: 12, upTo: 'infinity' },
        ],
        unit: 'millionTokens',
      },
    ]);
  });
});
