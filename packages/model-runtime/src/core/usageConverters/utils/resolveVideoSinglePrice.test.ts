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
