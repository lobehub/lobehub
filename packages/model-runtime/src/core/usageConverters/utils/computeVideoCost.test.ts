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
});
