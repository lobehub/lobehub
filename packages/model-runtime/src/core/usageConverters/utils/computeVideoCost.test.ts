import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import type { VideoGenerationParams } from './computeVideoCost';
import { computeVideoCost, computeVideoRequestCost } from './computeVideoCost';

describe('computeVideoCost', () => {
  describe('fixed pricing strategy', () => {
    it('should compute cost with millionTokens unit', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'videoGeneration',
            rate: 0.21,
            strategy: 'fixed',
            unit: 'millionTokens',
          },
        ],
      };

      const result = computeVideoCost(pricing, 500_000, {});

      expect(result).toBeDefined();
      expect(result?.totalCost).toBe(0.105);
      expect(result?.totalCredits).toBe(105_000);
      expect(result?.breakdown?.completionTokens).toBe(500_000);
      expect(result?.breakdown?.pricePerMillionTokens).toBe(0.21);
    });

    it('should return undefined when unit is not millionTokens', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'videoGeneration',
            rate: 0.21,
            strategy: 'fixed',
            unit: 'image' as any,
          },
        ],
      };

      const result = computeVideoCost(pricing, 500_000, {});

      expect(result).toBeUndefined();
    });

    it('should handle zero tokens', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'videoGeneration',
            rate: 0.21,
            strategy: 'fixed',
            unit: 'millionTokens',
          },
        ],
      };

      const result = computeVideoCost(pricing, 0, {});

      expect(result).toBeDefined();
      expect(result?.totalCost).toBe(0);
      expect(result?.totalCredits).toBe(0);
    });
  });

  describe('lookup pricing strategy', () => {
    it('should compute lookup pricing with generateAudio param', () => {
      const pricing: Pricing = {
        units: [
          {
            lookup: {
              pricingParams: ['generateAudio'],
              prices: {
                false: 0.21,
                true: 0.42,
              },
            },
            name: 'videoGeneration',
            strategy: 'lookup',
            unit: 'millionTokens',
          },
        ],
      };

      const params: VideoGenerationParams = { generateAudio: true };
      const result = computeVideoCost(pricing, 1_000_000, params);

      expect(result).toBeDefined();
      expect(result?.totalCost).toBe(0.42);
      expect(result?.totalCredits).toBe(420_000);
      expect(result?.breakdown?.lookupKey).toBe('true');
    });

    it('should return undefined when lookup param is missing', () => {
      const pricing: Pricing = {
        units: [
          {
            lookup: {
              pricingParams: ['generateAudio'],
              prices: { true: 0.42 },
            },
            name: 'videoGeneration',
            strategy: 'lookup',
            unit: 'millionTokens',
          },
        ],
      };

      // generateAudio is undefined
      const result = computeVideoCost(pricing, 1_000_000, {});

      expect(result).toBeUndefined();
    });

    it('should return undefined when lookup key has no matching price', () => {
      const pricing: Pricing = {
        units: [
          {
            lookup: {
              pricingParams: ['generateAudio'],
              prices: { true: 0.42 },
            },
            name: 'videoGeneration',
            strategy: 'lookup',
            unit: 'millionTokens',
          },
        ],
      };

      const params: VideoGenerationParams = { generateAudio: false };
      const result = computeVideoCost(pricing, 1_000_000, params);

      expect(result).toBeUndefined();
    });

    it('should return undefined when no pricingParams defined', () => {
      const pricing: Pricing = {
        units: [
          {
            lookup: {
              pricingParams: [] as any,
              prices: { true: 0.42 },
            } as any,
            name: 'videoGeneration',
            strategy: 'lookup',
            unit: 'millionTokens',
          },
        ],
      };

      const result = computeVideoCost(pricing, 1_000_000, { generateAudio: true });

      expect(result).toBeUndefined();
    });

    it('should return undefined when param value is null', () => {
      const pricing: Pricing = {
        units: [
          {
            lookup: {
              pricingParams: ['generateAudio'],
              prices: { true: 0.42 },
            },
            name: 'videoGeneration',
            strategy: 'lookup',
            unit: 'millionTokens',
          },
        ],
      };

      const params: VideoGenerationParams = { generateAudio: null as any };
      const result = computeVideoCost(pricing, 1_000_000, params);

      expect(result).toBeUndefined();
    });
  });

  describe('currency conversion', () => {
    it('should convert CNY to USD', () => {
      const pricing: Pricing = {
        currency: 'CNY',
        units: [
          {
            name: 'videoGeneration',
            rate: 1.5,
            strategy: 'fixed',
            unit: 'millionTokens',
          },
        ],
      };

      const result = computeVideoCost(pricing, 1_000_000, {});

      expect(result).toBeDefined();
      // 1.5 CNY / 7.12 = ~0.2107
      expect(result?.totalCost).toBeCloseTo(1.5 / 7.12, 10);
    });

    it('should not convert when currency is USD', () => {
      const pricing: Pricing = {
        currency: 'USD',
        units: [
          {
            name: 'videoGeneration',
            rate: 0.21,
            strategy: 'fixed',
            unit: 'millionTokens',
          },
        ],
      };

      const result = computeVideoCost(pricing, 1_000_000, {});

      expect(result?.totalCost).toBe(0.21);
    });

    it('should default to USD when currency is not specified', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'videoGeneration',
            rate: 0.21,
            strategy: 'fixed',
            unit: 'millionTokens',
          },
        ],
      };

      const result = computeVideoCost(pricing, 1_000_000, {});

      expect(result?.totalCost).toBe(0.21);
    });
  });

  describe('edge cases', () => {
    it('should return undefined when no videoGeneration unit found', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'textGeneration' as any,
            rate: 0.01,
            strategy: 'fixed',
            unit: 'millionTokens',
          },
        ],
      };

      const result = computeVideoCost(pricing, 1_000_000, {});

      expect(result).toBeUndefined();
    });

    it('should return undefined for unsupported pricing strategy', () => {
      const pricing = {
        units: [
          {
            name: 'videoGeneration',
            strategy: 'unknown_strategy',
            unit: 'millionTokens',
          },
        ],
      } as unknown as Pricing;

      const result = computeVideoCost(pricing, 1_000_000, {});

      expect(result).toBeUndefined();
    });

    it('should apply Math.ceil on totalCredits', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'videoGeneration',
            rate: 0.000001,
            strategy: 'fixed',
            unit: 'millionTokens',
          },
        ],
      };

      // (0.000001 * 1) / 1_000_000 = 1e-12 USD → credits = Math.ceil(1e-12 * 1_000_000) = 1
      const result = computeVideoCost(pricing, 1, {});

      expect(result).toBeDefined();
      expect(result?.totalCredits).toBe(1);
      expect(Number.isInteger(result?.totalCredits)).toBe(true);
    });
  });

  describe('per-second pricing', () => {
    const lookupPricing: Pricing = {
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

    it('bills requested duration at the resolution rate and ignores tokens', () => {
      const result = computeVideoCost(lookupPricing, 123_456, {
        duration: 10,
        resolution: '768P',
      });

      expect(result?.totalCost).toBeCloseTo(0.8);
      expect(result?.breakdown).toMatchObject({
        durationSeconds: 10,
        lookupKey: '768P',
        pricePerSecond: 0.08,
      });
    });

    it('supports a fixed per-second rate', () => {
      const pricing: Pricing = {
        units: [{ name: 'videoGeneration', rate: 0.05, strategy: 'fixed', unit: 'second' }],
      };

      expect(computeVideoCost(pricing, 0, { duration: 6 })?.totalCost).toBeCloseTo(0.3);
    });

    it('returns undefined without a duration or a matching lookup price', () => {
      expect(computeVideoCost(lookupPricing, 0, { resolution: '768P' })).toBeUndefined();
      expect(computeVideoCost(lookupPricing, 0, { duration: 5, resolution: '4K' })).toBeUndefined();
    });
  });
});

describe('computeVideoRequestCost', () => {
  // fal H3 Max reference-to-video: requested seconds by resolution, plus reference tokens above a
  // 4,096-token allowance at $0.02 / 1K (https://fal.ai/models/minimax/h3-max/reference-to-video)
  const h3MaxPricing: Pricing = {
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
      {
        mode: 'graduated',
        name: 'imageInput',
        strategy: 'tiered',
        tiers: [
          { rate: 0, upTo: 4096 },
          { rate: 20, upTo: 'infinity' },
        ],
        unit: 'millionTokens',
      },
    ],
  };
  const images = (count: number) => Array.from({ length: count }, (_, i) => `https://img/${i}.png`);

  it('prices text-to-video from the requested duration alone', () => {
    const result = computeVideoRequestCost(h3MaxPricing, { duration: 15, resolution: '1080P' });

    expect(result?.totalCost).toBeCloseTo(2.4, 10);
    expect(result?.breakdown?.units).toEqual([
      {
        cost: expect.closeTo(2.4, 10),
        lookupKey: '1080P',
        name: 'videoGeneration',
        quantity: 15,
        unit: 'second',
      },
      { cost: 0, lookupKey: undefined, name: 'imageInput', quantity: 0, unit: 'millionTokens' },
    ]);
  });

  it('matches fal published examples for reference tokens', () => {
    // 5 square images: 5 × 1,024 tokens, 1,024 above the allowance
    expect(
      computeVideoRequestCost(
        h3MaxPricing,
        { duration: 5, imageUrls: images(5), resolution: '480P' },
        { referenceImageTokens: 5120 },
      )?.totalCost,
    ).toBeCloseTo(0.270_48, 10);
    // Within the allowance, references add nothing
    expect(
      computeVideoRequestCost(
        h3MaxPricing,
        { duration: 5, imageUrls: images(4), resolution: '768P' },
        { referenceImageTokens: 4096 },
      )?.totalCost,
    ).toBeCloseTo(0.4, 10);
  });

  it('matches billed units of calibration requests', () => {
    // fal bills reference-to-video in 480P seconds ($0.05); 4 × 6:5 images → 5.3072 units
    expect(
      computeVideoRequestCost(
        h3MaxPricing,
        { duration: 5, imageUrls: images(4), resolution: '480P' },
        { referenceImageTokens: 4 * 1216 },
      )?.totalCost,
    ).toBeCloseTo(5.3072 * 0.05, 10);
  });

  it('is not exact when reference tokens were not metered', () => {
    expect(
      computeVideoRequestCost(h3MaxPricing, {
        duration: 5,
        imageUrls: images(1),
        resolution: '480P',
      }),
    ).toBeUndefined();
  });

  it('is not exact when a param needed by a unit is missing', () => {
    expect(computeVideoRequestCost(h3MaxPricing, { resolution: '480P' })).toBeUndefined();
    expect(computeVideoRequestCost(h3MaxPricing, { duration: 5 })).toBeUndefined();
    expect(
      computeVideoRequestCost(h3MaxPricing, { duration: 5, resolution: '4K' }),
    ).toBeUndefined();
  });

  it('is not exact when any unit is billed from reported usage', () => {
    const pricing: Pricing = {
      units: [
        ...h3MaxPricing.units,
        { name: 'videoGeneration', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
      ],
    };

    expect(computeVideoRequestCost(pricing, { duration: 5, resolution: '480P' })).toBeUndefined();
  });

  it('prices reference image counts with a graduated free allowance', () => {
    const pricing: Pricing = {
      units: [
        { name: 'videoGeneration', rate: 0.5, strategy: 'fixed', unit: 'video' },
        {
          mode: 'graduated',
          name: 'imageInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0, upTo: 5 },
            { rate: 0.04, upTo: 'infinity' },
          ],
          unit: 'image',
        },
      ],
    };

    expect(computeVideoRequestCost(pricing, { imageUrls: images(7) })?.totalCost).toBeCloseTo(
      0.58,
      10,
    );
  });

  it('bills the whole quantity at the matched tier for volume tiers', () => {
    const pricing: Pricing = {
      units: [
        {
          name: 'imageInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0, upTo: 5 },
            { rate: 0.04, upTo: 'infinity' },
          ],
          unit: 'image',
        },
      ],
    };

    expect(computeVideoRequestCost(pricing, { imageUrls: images(7) })?.totalCost).toBeCloseTo(
      0.28,
      10,
    );
  });
});
