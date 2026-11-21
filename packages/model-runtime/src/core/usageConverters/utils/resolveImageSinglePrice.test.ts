import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { resolveImagePriceMultiplier, resolveImageSinglePrice } from './resolveImageSinglePrice';

const tokenPricing: Pricing = {
  approximatePricePerImage: 0.035,
  units: [{ name: 'imageOutput', rate: 34.8, strategy: 'fixed', unit: 'millionTokens' }],
};

describe('resolveImagePriceMultiplier', () => {
  it('counts static output as one image', () => {
    expect(resolveImagePriceMultiplier()).toBe(1);
    expect(resolveImagePriceMultiplier({ frameCount: 64, outputFormat: 'png' })).toBe(1);
  });

  it('scales GIF output with its frame count, never below one image', () => {
    expect(resolveImagePriceMultiplier({ frameCount: 14, outputFormat: 'gif' })).toBe(2);
    expect(resolveImagePriceMultiplier({ frameCount: 2, outputFormat: 'gif' })).toBe(1);
  });

  it('counts a GIF without a frame count as one image', () => {
    expect(resolveImagePriceMultiplier({ outputFormat: 'gif' })).toBe(1);
  });
});

describe('resolveImageSinglePrice', () => {
  it('returns the approximate price for static output', () => {
    expect(resolveImageSinglePrice(tokenPricing)).toEqual({ approximatePrice: 0.035 });
  });

  it('raises the approximate price for multi-frame GIF output', () => {
    const { approximatePrice } = resolveImageSinglePrice(tokenPricing, {
      frameCount: 70,
      outputFormat: 'gif',
    });

    expect(approximatePrice).toBeCloseTo(0.35);
  });

  it('keeps fixed per-image prices unchanged', () => {
    const pricing: Pricing = {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    };

    expect(resolveImageSinglePrice(pricing, { frameCount: 70, outputFormat: 'gif' })).toEqual({
      price: 0.04,
    });
  });
});
