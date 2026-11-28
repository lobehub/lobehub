import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COMPRESSION_WINDOW_TOKENS,
  resolveCompressionWindowTokens,
} from './compressionWindow';
import type { Pricing } from './types';

const tieredInput = (upTo: number): Pricing => ({
  units: [
    {
      name: 'textInput',
      strategy: 'tiered',
      tiers: [
        { rate: 5, upTo },
        { rate: 10, upTo: 'infinity' },
      ],
      unit: 'millionTokens',
    },
    { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
  ],
});

const fixedInput: Pricing = {
  units: [{ name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' }],
};

describe('resolveCompressionWindowTokens', () => {
  it('caps a long-context card at its first input pricing tier', () => {
    expect(
      resolveCompressionWindowTokens({
        contextWindowTokens: 1_050_000,
        pricing: tieredInput(272_000),
      }),
    ).toBe(272_000);
  });

  it('caps a card without an input tier at the default window', () => {
    expect(
      resolveCompressionWindowTokens({ contextWindowTokens: 1_000_000, pricing: fixedInput }),
    ).toBe(DEFAULT_COMPRESSION_WINDOW_TOKENS);
    expect(resolveCompressionWindowTokens({ contextWindowTokens: 1_000_000 })).toBe(200_000);
  });

  it('keeps a hard limit already below the cap', () => {
    expect(
      resolveCompressionWindowTokens({
        contextWindowTokens: 128_000,
        pricing: tieredInput(200_000),
      }),
    ).toBe(128_000);
    expect(resolveCompressionWindowTokens({ contextWindowTokens: 131_072 })).toBe(131_072);
  });

  it('ignores tiers on other units', () => {
    const pricing: Pricing = {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 15, upTo: 100_000 },
            { rate: 30, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    };
    expect(resolveCompressionWindowTokens({ contextWindowTokens: 1_000_000, pricing })).toBe(
      200_000,
    );
  });

  it('returns undefined without a hard limit', () => {
    expect(resolveCompressionWindowTokens({ pricing: tieredInput(272_000) })).toBeUndefined();
  });
});
