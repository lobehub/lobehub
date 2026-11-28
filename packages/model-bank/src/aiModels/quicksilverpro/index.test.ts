import { describe, expect, it } from 'vitest';

import models from './index';

describe('QuickSilver Pro public chat catalog', () => {
  it('includes the current GPT-6.2 release with gateway long-context prices', () => {
    const model = models.find((model) => model.id === 'gpt-6.2-sol');

    expect(model).toMatchObject({ contextWindowTokens: 1_050_000, maxOutput: 128_000 });
    expect(model?.pricing?.units).toContainEqual({
      name: 'textInput',
      strategy: 'tiered',
      tiers: [
        { rate: 2, upTo: 200_000 },
        { rate: 4, upTo: 'infinity' },
      ],
      unit: 'millionTokens',
    });
  });

  it('uses the refreshed gateway prices for existing models', () => {
    const model = models.find((model) => model.id === 'claude-opus-5-5');

    expect(model?.pricing?.units).toContainEqual({
      name: 'textInput',
      rate: 1,
      strategy: 'fixed',
      unit: 'millionTokens',
    });
    expect(model?.knowledgeCutoff).toBeUndefined();
  });

  it('excludes retired and non-chat models from the chat picker', () => {
    expect(models.every((model) => model.type === 'chat')).toBe(true);
    expect(models.some((model) => model.id === 'qwen4-max-preview')).toBe(false);
    expect(models.some((model) => model.id === 'qwen4-max')).toBe(true);
    expect(new Set(models.map((model) => model.id)).size).toBe(models.length);
  });
});
