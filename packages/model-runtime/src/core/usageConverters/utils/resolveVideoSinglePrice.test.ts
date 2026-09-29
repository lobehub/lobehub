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
