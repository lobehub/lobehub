import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import type { VideoGenerationParams } from './computeVideoCost';
import { computeVideoCost } from './computeVideoCost';

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

    it('should return undefined for an unsupported unit', () => {
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

  describe('unit handling', () => {
    it('should price second-unit fixed pricing from videoSeconds', () => {
      const pricing: Pricing = {
        units: [{ name: 'videoGeneration', rate: 0.4, strategy: 'fixed', unit: 'second' }],
      };

      const result = computeVideoCost(pricing, 0, {}, 8);

      expect(result).toBeDefined();
      expect(result?.totalCost).toBeCloseTo(3.2, 10);
      expect(result?.totalCredits).toBe(3_200_000);
      expect(result?.breakdown?.quantity).toBe(8);
      expect(result?.breakdown?.rate).toBe(0.4);
      expect(result?.breakdown?.unit).toBe('second');
      expect(result?.breakdown?.pricePerMillionTokens).toBeUndefined();
    });

    it('should fall back to params.duration for second-unit pricing', () => {
      const pricing: Pricing = {
        units: [{ name: 'videoGeneration', rate: 0.05, strategy: 'fixed', unit: 'second' }],
      };

      const result = computeVideoCost(pricing, 0, { duration: 6 });

      expect(result?.totalCost).toBeCloseTo(0.3, 10);
      expect(result?.breakdown?.quantity).toBe(6);
    });

    it('should ignore non-finite or negative durations', () => {
      const pricing: Pricing = {
        units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
      };

      // Invalid videoSeconds falls back to a valid params.duration...
      expect(computeVideoCost(pricing, 0, { duration: 8 }, Number.NaN)?.totalCost).toBeCloseTo(
        0.8,
        10,
      );
      expect(computeVideoCost(pricing, 0, { duration: 8 }, -1)?.totalCost).toBeCloseTo(0.8, 10);
      // ...and an invalid fallback yields no cost instead of NaN/negative cost.
      expect(computeVideoCost(pricing, 0, { duration: Number.POSITIVE_INFINITY })).toBeUndefined();
      expect(computeVideoCost(pricing, 0, {}, Number.POSITIVE_INFINITY)).toBeUndefined();
    });

    it('should return undefined for second-unit pricing without any duration', () => {
      const pricing: Pricing = {
        units: [{ name: 'videoGeneration', rate: 0.4, strategy: 'fixed', unit: 'second' }],
      };

      expect(computeVideoCost(pricing, 500_000, {})).toBeUndefined();
    });

    it('should price video-unit fixed pricing as a flat per-video rate', () => {
      const pricing: Pricing = {
        units: [{ name: 'videoGeneration', rate: 2.5, strategy: 'fixed', unit: 'video' }],
      };

      const result = computeVideoCost(pricing, 0, {});

      expect(result?.totalCost).toBe(2.5);
      expect(result?.totalCredits).toBe(2_500_000);
      expect(result?.breakdown?.quantity).toBe(1);
      expect(result?.breakdown?.unit).toBe('video');
    });

    it('should preserve credit rounding for token pricing at FP boundaries', () => {
      // (37 * 5) / 1e6 rounds to 185 credits; 37 * (5 / 1e6) would round to 186.
      const pricing: Pricing = {
        units: [{ name: 'videoGeneration', rate: 37, strategy: 'fixed', unit: 'millionTokens' }],
      };

      const result = computeVideoCost(pricing, 5, {});

      expect(result?.totalCredits).toBe(185);
    });

    it('should prefer videoSeconds over params.duration when both are present', () => {
      const pricing: Pricing = {
        units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
      };

      const result = computeVideoCost(pricing, 0, { duration: 4 }, 8);

      expect(result?.breakdown?.quantity).toBe(8);
      expect(result?.totalCost).toBeCloseTo(0.8, 10);
    });

    it('should honor the second unit under lookup pricing', () => {
      // A resolution-keyed per-second card, the shape veo-class video models bill by.
      const pricing: Pricing = {
        units: [
          {
            lookup: { prices: { '1080p': 0.08, '720p': 0.05 }, pricingParams: ['resolution'] },
            name: 'videoGeneration',
            strategy: 'lookup',
            unit: 'second',
          },
        ],
      };

      const result = computeVideoCost(pricing, 0, { resolution: '720p' }, 8);

      expect(result).toBeDefined();
      expect(result?.totalCost).toBeCloseTo(0.4, 10);
      expect(result?.totalCredits).toBe(400_000);
      expect(result?.breakdown?.lookupKey).toBe('720p');
      expect(result?.breakdown?.quantity).toBe(8);
      expect(result?.breakdown?.rate).toBe(0.05);
    });

    it('should convert CNY to USD for second-unit pricing', () => {
      const pricing: Pricing = {
        currency: 'CNY',
        units: [{ name: 'videoGeneration', rate: 7.12, strategy: 'fixed', unit: 'second' }],
      };

      const result = computeVideoCost(pricing, 0, {}, 5);

      // 7.12 CNY/s * 5s = 35.6 CNY / 7.12 = 5 USD
      expect(result).toBeDefined();
      expect(result?.totalCost).toBeCloseTo(35.6 / 7.12, 10);
      expect(result?.totalCredits).toBe(5_000_000);
    });
  });
});
