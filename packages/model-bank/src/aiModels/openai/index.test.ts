import { describe, expect, it } from 'vitest';

import { openaiChatModels } from './index';

describe('openai chat model cards', () => {
  /** @see https://developers.openai.com/api/docs/models/gpt-6.1-terra */
  it('registers GPT-6.1 Terra with its published limits, long-context rates and none effort', () => {
    const card = openaiChatModels.find((model) => model.id === 'gpt-6.1-terra');

    expect(card).toMatchObject({
      contextWindowTokens: 1_050_000,
      enabled: true,
      generation: 'gpt-6.1',
      knowledgeCutoff: '2026-06',
      maxOutput: 128_000,
      releasedAt: '2026-10-26',
      settings: { extendParams: ['gpt5_6ReasoningEffort', 'textVerbosity'] },
    });
    const tiers = (low: number, high: number) => [
      { rate: low, upTo: 272_000 },
      { rate: high, upTo: 'infinity' },
    ];
    expect(card?.pricing?.units).toEqual([
      { name: 'textInput', strategy: 'tiered', tiers: tiers(1, 2), unit: 'millionTokens' },
      {
        name: 'textInput_cacheRead',
        strategy: 'tiered',
        tiers: tiers(0.05, 0.1),
        unit: 'millionTokens',
      },
      {
        name: 'textInput_cacheWrite',
        strategy: 'tiered',
        tiers: tiers(1.25, 2.5),
        unit: 'millionTokens',
      },
      { name: 'textOutput', strategy: 'tiered', tiers: tiers(5, 7.5), unit: 'millionTokens' },
    ]);
  });
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
