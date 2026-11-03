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
});
