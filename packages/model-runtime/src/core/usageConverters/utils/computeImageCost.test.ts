import type { Pricing } from 'model-bank';
import { describe, expect, it } from 'vitest';

import type { ImageGenerationParams } from './computeImageCost';
import { computeImageCost } from './computeImageCost';

describe('computeImageCost', () => {
  describe('lookup pricing strategy', () => {
    it('should compute dall-e-3 lookup pricing correctly', () => {
      // Arrange - Based on actual production logs
      const pricing: Pricing = {
        units: [
          {
            name: 'imageGeneration',
            strategy: 'lookup',
            unit: 'image',
            lookup: {
              pricingParams: ['quality', 'size'],
              prices: {
                standard_1024x1024: 0.04,
                standard_1024x1792: 0.08,
                standard_1792x1024: 0.08,
                hd_1024x1024: 0.08,
                hd_1024x1792: 0.12,
                hd_1792x1024: 0.12,
              },
            },
          },
        ],
      };

      const params: ImageGenerationParams = {
        quality: 'standard',
        size: '1024x1024',
        prompt: '一条边牧',
      };

      // Act
      const result = computeImageCost(pricing, params, 1);

      // Assert - Match the production log output
      expect(result).toBeDefined();
      expect(result?.totalCost).toBe(0.04);
      expect(result?.totalCredits).toBe(40000); // $0.04 * 100000 credits per dollar
      expect(result?.breakdown?.lookupKey).toBe('standard_1024x1024');
      expect(result?.breakdown?.pricePerImage).toBe(0.04);
      expect(result?.breakdown?.imageCount).toBe(1);
    });

    it('should compute lookup pricing for multiple images', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'imageGeneration',
            strategy: 'lookup',
            unit: 'image',
            lookup: {
              pricingParams: ['quality', 'size'],
              prices: {
                hd_1024x1792: 0.12,
              },
            },
          },
        ],
      };

      const params: ImageGenerationParams = {
        quality: 'hd',
        size: '1024x1792',
      };

      const result = computeImageCost(pricing, params, 3);

      expect(result).toBeDefined();
      expect(result?.totalCost).toBe(0.36); // 0.12 * 3
      expect(result?.totalCredits).toBe(360000); // $0.36 * 100000
      expect(result?.breakdown?.lookupKey).toBe('hd_1024x1792');
      expect(result?.breakdown?.imageCount).toBe(3);
    });

    it('should return undefined if required lookup param is missing', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'imageGeneration',
            strategy: 'lookup',
            unit: 'image',
            lookup: {
              pricingParams: ['quality', 'size'],
              prices: {
                standard_1024x1024: 0.04,
              },
            },
          },
        ],
      };

      const params: ImageGenerationParams = {
        quality: 'standard',
        // Missing 'size' parameter
      };

      const result = computeImageCost(pricing, params, 1);

      expect(result).toBeUndefined();
    });

    it('should return undefined if lookup key has no matching price', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'imageGeneration',
            strategy: 'lookup',
            unit: 'image',
            lookup: {
              pricingParams: ['quality', 'size'],
              prices: {
                standard_1024x1024: 0.04,
              },
            },
          },
        ],
      };

      const params: ImageGenerationParams = {
        quality: 'hd',
        size: '2048x2048', // No matching price for this combination
      };

      const result = computeImageCost(pricing, params, 1);

      expect(result).toBeUndefined();
    });

    it('should return undefined if lookup has no pricingParams defined', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'imageGeneration',
            strategy: 'lookup',
            unit: 'image',
            lookup: {
              // Missing pricingParams
              prices: {
                standard_1024x1024: 0.04,
              },
              pricingParams: [],
            } as any,
          },
        ],
      };

      const params: ImageGenerationParams = {
        quality: 'standard',
        size: '1024x1024',
      };

      const result = computeImageCost(pricing, params, 1);

      expect(result).toBeUndefined();
    });
  });

  describe('fixed pricing strategy', () => {
    it('should compute fixed pricing correctly', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'imageGeneration',
            strategy: 'fixed',
            unit: 'image',
            rate: 0.05,
          },
        ],
      };

      const params: ImageGenerationParams = {
        quality: 'standard',
        size: '512x512',
      };

      const result = computeImageCost(pricing, params, 1);

      expect(result).toBeDefined();
      expect(result?.totalCost).toBe(0.05);
      expect(result?.totalCredits).toBe(50000); // $0.05 * 100000
      expect(result?.breakdown?.pricePerImage).toBe(0.05);
      expect(result?.breakdown?.imageCount).toBe(1);
      expect(result?.breakdown?.lookupKey).toBeUndefined();
    });

    it('should compute fixed pricing for multiple images', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'imageGeneration',
            strategy: 'fixed',
            unit: 'image',
            rate: 0.02,
          },
        ],
      };

      const params: ImageGenerationParams = {};

      const result = computeImageCost(pricing, params, 5);

      expect(result).toBeDefined();
      expect(result?.totalCost).toBe(0.1); // 0.02 * 5
      expect(result?.totalCredits).toBe(100000);
      expect(result?.breakdown?.imageCount).toBe(5);
    });

    it('should return undefined if fixed pricing unit is not image', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'imageGeneration',
            strategy: 'fixed',
            unit: 'token' as any, // Unsupported unit type
            rate: 0.05,
          },
        ],
      };

      const params: ImageGenerationParams = {};

      const result = computeImageCost(pricing, params, 1);

      expect(result).toBeUndefined();
    });
  });

  describe('tiered pricing strategy', () => {
    it('should return undefined for tiered strategy (not yet implemented)', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'imageGeneration',
            strategy: 'tiered',
            unit: 'image',
            tiers: [
              { upTo: 10, rate: 0.05 },
              { upTo: 'infinity' as any, rate: 0.03 },
            ],
          },
        ],
      };

      const params: ImageGenerationParams = {};

      const result = computeImageCost(pricing, params, 1);

      expect(result).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should return undefined if no imageGeneration unit found', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'textGeneration' as any, // Different unit name
            strategy: 'fixed',
            unit: 'token' as any,
            rate: 0.01,
          },
        ],
      };

      const params: ImageGenerationParams = {};

      const result = computeImageCost(pricing, params, 1);

      expect(result).toBeUndefined();
    });

    it('should return undefined for unsupported pricing strategy', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'imageGeneration',
            // @ts-expect-error - Testing unsupported strategy
            strategy: 'unsupported_strategy',
            unit: 'image',
          },
        ],
      };

      const params: ImageGenerationParams = {};

      const result = computeImageCost(pricing, params, 1);

      expect(result).toBeUndefined();
    });

    it('should handle null lookup param value', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'imageGeneration',
            strategy: 'lookup',
            unit: 'image',
            lookup: {
              pricingParams: ['quality', 'size'],
              prices: {
                standard_1024x1024: 0.04,
              },
            },
          },
        ],
      };

      const params: ImageGenerationParams = {
        quality: null as any, // null value for testing
        size: '1024x1024',
      };

      const result = computeImageCost(pricing, params, 1);

      expect(result).toBeUndefined();
    });

    it('should handle zero images', () => {
      const pricing: Pricing = {
        units: [
          {
            name: 'imageGeneration',
            strategy: 'fixed',
            unit: 'image',
            rate: 0.05,
          },
        ],
      };

      const params: ImageGenerationParams = {};

      const result = computeImageCost(pricing, params, 0);

      expect(result).toBeDefined();
      expect(result?.totalCost).toBe(0);
      expect(result?.totalCredits).toBe(0);
    });
  });
});
