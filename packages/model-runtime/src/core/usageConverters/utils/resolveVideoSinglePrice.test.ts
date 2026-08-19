import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { resolveVideoSinglePrice } from './resolveVideoSinglePrice';

describe('resolveVideoSinglePrice', () => {
  it('should return empty object when pricing is undefined', () => {
    expect(resolveVideoSinglePrice(undefined)).toEqual({});
  });

  it('uses approximatePricePerVideo when present', () => {
    expect(resolveVideoSinglePrice({ approximatePricePerVideo: 0.5, units: [] })).toEqual({
      approximatePrice: 0.5,
    });
  });

  it('returns the exact fixed per-video price', () => {
    expect(
      resolveVideoSinglePrice({
        units: [{ name: 'videoGeneration', rate: 1.25, strategy: 'fixed', unit: 'video' }],
      }),
    ).toEqual({ price: 1.25 });
  });

  it('uses the model duration for fixed per-second pricing', () => {
    expect(
      resolveVideoSinglePrice(
        { units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }] },
        8,
      ),
    ).toEqual({ approximatePrice: 0.8 });
  });

  it('falls back to a five-second clip for fixed per-second pricing', () => {
    expect(
      resolveVideoSinglePrice({
        units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
      }),
    ).toEqual({ approximatePrice: 0.5 });
  });

  it('derives an approximate clip price from the lowest lookup rate', () => {
    expect(
      resolveVideoSinglePrice({
        units: [
          {
            lookup: { prices: { '4K': 0.3, '720p': 0.1 }, pricingParams: ['resolution'] },
            name: 'videoGeneration',
            strategy: 'lookup',
            unit: 'second',
          },
        ],
      }),
    ).toEqual({ approximatePrice: 0.5 });
  });

  it('returns an empty object when no video pricing is configured', () => {
    const pricing: Pricing = { units: [] };
    expect(resolveVideoSinglePrice(pricing)).toEqual({});
  });
});
