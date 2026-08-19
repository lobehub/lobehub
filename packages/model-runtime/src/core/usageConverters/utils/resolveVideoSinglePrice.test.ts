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

  it('derives an approximate clip price from a per-second unit', () => {
    const result = resolveVideoSinglePrice({
      units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
    });
    expect(result.approximatePrice).toBe(0.5);
  });

  it('derives an approximate clip price from the lowest per-second lookup rate', () => {
    const result = resolveVideoSinglePrice({
      units: [
        {
          lookup: {
            prices: { '720p': 0.1, '4K': 0.3 },
            pricingParams: ['resolution'],
          },
          name: 'videoGeneration',
          strategy: 'lookup',
          unit: 'second',
        },
      ],
    });
    expect(result.approximatePrice).toBe(0.5);
  });

  it('uses a flat per-video unit as the approximate price', () => {
    const result = resolveVideoSinglePrice({
      units: [{ name: 'videoGeneration', rate: 0.4, strategy: 'fixed', unit: 'video' }],
    });
    expect(result.approximatePrice).toBe(0.4);
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
