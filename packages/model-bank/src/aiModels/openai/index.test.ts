import { describe, expect, it } from 'vitest';

import { openaiChatModels } from './index';

describe('openai chat model cards', () => {
  /** @see https://developers.openai.com/api/docs/pricing */
  it('bills gpt-5.5-pro prompts over 272K tokens at long-context rates', () => {
    const card = openaiChatModels.find((model) => model.id === 'gpt-5.5-pro');

    expect(card?.pricing?.units).toEqual([
      {
        name: 'textInput',
        strategy: 'tiered',
        tiers: [
          { rate: 30, upTo: 272_000 },
          { rate: 60, upTo: 'infinity' },
        ],
        unit: 'millionTokens',
      },
      {
        name: 'textOutput',
        strategy: 'tiered',
        tiers: [
          { rate: 180, upTo: 272_000 },
          { rate: 270, upTo: 'infinity' },
        ],
        unit: 'millionTokens',
      },
    ]);
  });

  /**
   * Consumers size per-request output budgets from `maxOutput`, so every
   * official card must declare it.
   */
  it('declares maxOutput on every official chat card', () => {
    const missing = openaiChatModels
      .filter((model) => model.isOfficial && model.maxOutput == null)
      .map((model) => model.id);

    expect(missing).toEqual([]);
  });
});
