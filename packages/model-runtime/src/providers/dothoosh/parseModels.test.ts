// @vitest-environment node
import { describe, expect, it } from 'vitest';

import liveAnthropicFixture from './fixtures/live-anthropic-models.json';
import liveOpenAIFixture from './fixtures/live-openai-models.json';
import { type DotHooshModelCard, parseDotHooshModels } from './parseModels';

const liveOpenAI = liveOpenAIFixture.data as unknown as DotHooshModelCard[];
const liveAnthropic = liveAnthropicFixture.data as unknown as DotHooshModelCard[];

const parseOpenAI = async (models: DotHooshModelCard[]) =>
  parseDotHooshModels({ anthropic: [], openai: models });

const findCard = (cards: Array<{ id: string }>, id: string) => {
  const card = cards.find((item) => item.id === id);
  if (!card) throw new Error(`fixture is missing ${id}`);
  return card as any;
};

describe('parseDotHooshModels: unknown limits stay unknown (F2)', () => {
  it('Test Case 1: null max_completion_tokens in the live listing gives no maxOutput for the Kimi fixtures', async () => {
    const cards = await parseOpenAI(liveOpenAI);

    for (const id of ['kimi-k2.6', 'kimi-k2.7-code', 'kimi-k3']) {
      expect(findCard(cards, id).maxOutput, id).toBeUndefined();
    }
  });

  it('Test Case 2: a known model id with null caps gets no static maxOutput from the model bank', async () => {
    const cards = await parseOpenAI([
      {
        id: 'kimi-k2.6',
        max_output_tokens: null,
        top_provider: { max_completion_tokens: null },
      } as DotHooshModelCard,
    ]);

    expect(cards[0].maxOutput).toBeUndefined();
  });

  it('Test Case 3: top_provider.max_completion_tokens of 64000 is used as maxOutput', async () => {
    const cards = await parseOpenAI([
      {
        id: 'custom-model',
        top_provider: { max_completion_tokens: 64_000 },
      } as DotHooshModelCard,
    ]);

    expect(cards[0].maxOutput).toBe(64_000);
  });

  it('Test Case 4: a null top_provider cap falls back to max_output_tokens', async () => {
    const cards = await parseOpenAI([
      {
        id: 'custom-model',
        max_output_tokens: 16_000,
        top_provider: { max_completion_tokens: null },
      } as DotHooshModelCard,
    ]);

    expect(cards[0].maxOutput).toBe(16_000);
  });

  it('Test Case 5: a zero cap with no max_output_tokens gives no maxOutput', async () => {
    const cards = await parseOpenAI([
      {
        id: 'custom-model',
        top_provider: { max_completion_tokens: 0 },
      } as DotHooshModelCard,
    ]);

    expect(cards[0].maxOutput).toBeUndefined();
  });

  it('Test Case 6: null context lengths give no contextWindowTokens for a known gpt-4o id', async () => {
    const cards = await parseOpenAI([
      {
        id: 'gpt-4o',
        context_length: null,
        top_provider: { context_length: null },
      } as DotHooshModelCard,
    ]);

    expect(cards[0].contextWindowTokens).toBeUndefined();
  });

  it('Test Case 7: context_length is used alone, and top_provider.context_length wins over it', async () => {
    const alone = await parseOpenAI([
      { id: 'custom-model', context_length: 200_000 } as DotHooshModelCard,
    ]);
    const both = await parseOpenAI([
      {
        id: 'custom-model',
        context_length: 200_000,
        top_provider: { context_length: 1_000_000 },
      } as DotHooshModelCard,
    ]);

    expect(alone[0].contextWindowTokens).toBe(200_000);
    expect(both[0].contextWindowTokens).toBe(1_000_000);
  });

  it('Test Case 8: a Claude card from the Anthropic listing keeps its own settings and drops vendor settings', async () => {
    const cards = await parseDotHooshModels({
      anthropic: liveAnthropic.slice(0, 1),
      openai: [],
    });
    const card = cards[0] as any;

    expect(card.reasoning).toBe(true);
    expect(card.settings).toEqual({
      disabledParams: ['temperature', 'top_p'],
      extendParams: ['opus47Effort'],
    });
  });
});
