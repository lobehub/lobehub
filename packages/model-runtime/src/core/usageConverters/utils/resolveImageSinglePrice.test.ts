import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { resolveImageSinglePrice } from './resolveImageSinglePrice';

describe('resolveImageSinglePrice', () => {
  it('returns an exact per-image price for a fixed image unit', () => {
    const pricing: Pricing = {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    };

    expect(resolveImageSinglePrice(pricing)).toEqual({ price: 0.04 });
  });

  it('uses a 1MP reference for megapixel units instead of inventing a per-image SKU', () => {
    const pricing: Pricing = {
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'megapixel' }],
    };

    expect(resolveImageSinglePrice(pricing).price).toBeCloseTo(0.03 * ((1024 * 1024) / 1_000_000));
  });

  it('uses the lowest lookup price as the approximate amount', () => {
    const pricing: Pricing = {
      units: [
        {
          lookup: {
            prices: { low_1K: 0.04, medium_2K: 0.08 },
            pricingParams: ['quality', 'resolution'],
          },
          name: 'imageGeneration',
          strategy: 'lookup',
          unit: 'image',
        },
      ],
    };

    expect(resolveImageSinglePrice(pricing)).toEqual({ approximatePrice: 0.04 });
  });

  it('does not invent a per-image price from token rates on imageOutput', () => {
    const pricing: Pricing = {
      units: [{ name: 'imageOutput', rate: 40, strategy: 'fixed', unit: 'millionTokens' }],
    };

    expect(resolveImageSinglePrice(pricing)).toEqual({});
  });

  it('prefers approximatePricePerImage when set', () => {
    const pricing: Pricing = {
      approximatePricePerImage: 0.04,
      units: [{ name: 'imageGeneration', rate: 0.08, strategy: 'fixed', unit: 'image' }],
    };

    expect(resolveImageSinglePrice(pricing)).toEqual({ approximatePrice: 0.04 });
  });
});
