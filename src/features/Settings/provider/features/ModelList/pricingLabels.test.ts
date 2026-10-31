import type { AIChatModelCard, AITTSModelCard } from 'model-bank';
import minimaxModels from 'model-bank/minimax';
import { openaiTTSModels } from 'model-bank/openai';
import { describe, expect, it } from 'vitest';

import { formatModelPricingLabels } from './pricingLabels';

const t = (key: string, { amount }: { amount: string }) =>
  `${key.replace('providerModels.item.pricing.', '')}:${amount}`;

const findModel = <T extends { id: string }>(models: T[], id: string) => {
  const model = models.find((item) => item.id === id);
  if (!model) throw new Error(`model ${id} not found`);
  return model;
};

describe('formatModelPricingLabels', () => {
  describe('tts', () => {
    it('shows the per-character price of MiniMax speech models', () => {
      const model = findModel(minimaxModels as AITTSModelCard[], 'speech-2.8-hd');

      const labels = formatModelPricingLabels('tts', model.pricing, t);

      // 350 CNY per million characters, displayed in USD like the other CNY-priced models.
      expect(labels).toHaveLength(1);
      expect(labels[0]).toMatch(/^inputCharts:\d/);
    });

    it('shows the per-character price of OpenAI tts-1', () => {
      const model = findModel(openaiTTSModels, 'tts-1');

      expect(formatModelPricingLabels('tts', model.pricing, t)).toEqual(['inputCharts:15.00']);
    });

    it('shows token input and audio output prices for gpt-4o-mini-tts', () => {
      const model = findModel(openaiTTSModels, 'gpt-4o-mini-tts');

      expect(formatModelPricingLabels('tts', model.pricing, t)).toEqual([
        'inputTokens:0.60',
        'audioOutputTokens:12.00',
      ]);
    });

    it('keeps showing legacy custom models priced as audioInput', () => {
      const labels = formatModelPricingLabels(
        'tts',
        { units: [{ name: 'audioInput', rate: 20, strategy: 'fixed', unit: 'millionCharacters' }] },
        t,
      );

      expect(labels).toEqual(['inputCharts:20.00']);
    });
  });

  it('shows input and output token prices for chat models', () => {
    const chat = (minimaxModels as AIChatModelCard[]).find(
      (item) => item.type === 'chat' && item.pricing,
    )!;

    const labels = formatModelPricingLabels('chat', chat.pricing, t);

    expect(labels[0]).toMatch(/^inputTokens:/);
    expect(labels[1]).toMatch(/^outputTokens:/);
  });

  it('returns nothing without pricing', () => {
    expect(formatModelPricingLabels('tts', undefined, t)).toEqual([]);
  });
});
