import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { resolveVideoSinglePrice } from './resolveVideoSinglePrice';

describe('resolveVideoSinglePrice', () => {
  it('should return empty object when pricing is undefined', () => {
    const result = resolveVideoSinglePrice(undefined);
    expect(result).toEqual({});
  });

  it('should return approximatePrice when approximatePricePerVideo is set', () => {
    const pricing: Pricing = {
      approximatePricePerVideo: 0.5,
      units: [],
    };

    const result = resolveVideoSinglePrice(pricing);
    expect(result).toEqual({ approximatePrice: 0.5 });
  });

  it('should return empty object when approximatePricePerVideo is not set', () => {
    const pricing: Pricing = {
      units: [],
    };

    const result = resolveVideoSinglePrice(pricing);
    expect(result).toEqual({});
  });

  it('should return approximatePrice of 0 when approximatePricePerVideo is 0', () => {
    const pricing: Pricing = {
      approximatePricePerVideo: 0,
      units: [],
    };

    const result = resolveVideoSinglePrice(pricing);
    expect(result).toEqual({ approximatePrice: 0 });
  });

  it('should return empty object when approximatePricePerVideo is not a number', () => {
    const pricing = {
      approximatePricePerVideo: '0.5' as any,
      units: [],
    } as Pricing;

    const result = resolveVideoSinglePrice(pricing);
    expect(result).toEqual({});
  });
});

describe('resolveVideoSinglePrice with request pricing', () => {
  const pricing: Pricing = {
    approximatePricePerVideo: 0.4,
    units: [
      {
        lookup: {
          prices: { '1080P': 0.16, '480P': 0.05, '768P': 0.08 },
          pricingParams: ['resolution'],
        },
        name: 'videoGeneration',
        strategy: 'lookup',
        unit: 'second',
      },
    ],
  };

  it('returns the exact price when the request prices every unit', () => {
    const result = resolveVideoSinglePrice(pricing, { duration: 15, resolution: '1080P' });

    expect(result.approximatePrice).toBe(0.4);
    expect(result.price).toBeCloseTo(2.4, 10);
  });

  it('omits the exact price when params are missing', () => {
    expect(resolveVideoSinglePrice(pricing)).toEqual({ approximatePrice: 0.4 });
    expect(resolveVideoSinglePrice(pricing, { resolution: '1080P' })).toEqual({
      approximatePrice: 0.4,
    });
    // Lookup keys follow the model card enum exactly; an unknown casing is not priced.
    expect(resolveVideoSinglePrice(pricing, { duration: 5, resolution: '480p' })).toEqual({
      approximatePrice: 0.4,
    });
  });

  it('only returns the approximate price for token-priced models', () => {
    const tokenPricing: Pricing = {
      approximatePricePerVideo: 0.76,
      units: [{ name: 'videoGeneration', rate: 7, strategy: 'fixed', unit: 'millionTokens' }],
    };

    expect(resolveVideoSinglePrice(tokenPricing, { duration: 15 })).toEqual({
      approximatePrice: 0.76,
    });
  });
});

describe('resolveVideoSinglePrice with output tokens', () => {
  // fal Seedance 2.5: $0.0214 per 1K output tokens
  const pricing: Pricing = {
    approximatePricePerVideo: 2.33,
    units: [{ name: 'videoGeneration', rate: 21.4, strategy: 'fixed', unit: 'millionTokens' }],
  };

  it('prices the request exactly from metered output tokens', () => {
    expect(resolveVideoSinglePrice(pricing, { duration: 4 }, { outputTokens: 40_000 })).toEqual({
      approximatePrice: 2.33,
      price: expect.closeTo(0.856, 10),
    });
  });

  it('sizes the hold from an estimate without an exact price', () => {
    expect(
      resolveVideoSinglePrice(pricing, { duration: 4 }, { estimatedOutputTokens: 40_000 }),
    ).toEqual({ approximatePrice: expect.closeTo(0.856, 10) });
  });

  it('rates 1080p tokens by resolution', () => {
    const lookupPricing: Pricing = {
      approximatePricePerVideo: 2.33,
      units: [
        {
          lookup: {
            prices: { '1080p': 23.4116, '480p': 21.4, '720p': 21.4 },
            pricingParams: ['resolution'],
          },
          name: 'videoGeneration',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    };

    // fal billed 214.88895K units × $0.0214 for 1920×1080, 97 frames
    expect(
      resolveVideoSinglePrice(
        lookupPricing,
        { duration: 4, resolution: '1080p' },
        { outputTokens: 196_425 },
      ),
    ).toEqual({ approximatePrice: 2.33, price: 4.59862353 });
  });
});
