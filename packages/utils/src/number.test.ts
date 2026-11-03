import { MAX_SEED } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { calculateThumbnailDimensions, generateUniqueSeeds } from './number';

describe('number utilities', () => {
  describe('MAX_SEED constant', () => {
    it('should be 2^31 - 1', () => {
      expect(MAX_SEED).toBe(2147483647);
      expect(MAX_SEED).toBe(2 ** 31 - 1);
    });
  });

  describe('generateUniqueSeeds', () => {
    it('should generate the correct number of seeds', () => {
      const seedCount = 5;
      const seeds = generateUniqueSeeds(seedCount);

      expect(seeds).toHaveLength(seedCount);
    });

    it('should generate unique seeds', () => {
      const seedCount = 10;
      const seeds = generateUniqueSeeds(seedCount);

      // Convert to Set to check uniqueness
      const uniqueSeeds = new Set(seeds);
      expect(uniqueSeeds.size).toBe(seedCount);
    });

    it('should generate seeds within valid range', () => {
      const seedCount = 20;
      const seeds = generateUniqueSeeds(seedCount);

      seeds.forEach((seed) => {
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThanOrEqual(MAX_SEED);
        expect(Number.isInteger(seed)).toBe(true);
      });
    });

    it('should handle edge case of 0 seeds', () => {
      const seeds = generateUniqueSeeds(0);

      expect(seeds).toHaveLength(0);
      expect(Array.isArray(seeds)).toBe(true);
    });

    it('should handle edge case of 1 seed', () => {
      const seeds = generateUniqueSeeds(1);

      expect(seeds).toHaveLength(1);
      expect(seeds[0]).toBeGreaterThanOrEqual(0);
      expect(seeds[0]).toBeLessThanOrEqual(MAX_SEED);
    });

    it('should generate different results on different calls', () => {
      const seedCount = 5;

      // Generate seeds at different times to ensure different timestamps
      const seeds1 = generateUniqueSeeds(seedCount);

      // Add a small delay to ensure different timestamp
      vi.useFakeTimers();
      vi.advanceTimersByTime(1);
      const seeds2 = generateUniqueSeeds(seedCount);
      vi.useRealTimers();

      // The arrays should not be identical (very low probability of collision)
      expect(seeds1).not.toEqual(seeds2);
    });

    it('should handle larger seed counts', () => {
      const seedCount = 100;
      const seeds = generateUniqueSeeds(seedCount);

      expect(seeds).toHaveLength(seedCount);

      // Verify uniqueness
      const uniqueSeeds = new Set(seeds);
      expect(uniqueSeeds.size).toBe(seedCount);

      // Verify all are in valid range
      seeds.forEach((seed) => {
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThanOrEqual(MAX_SEED);
      });
    });

    it('should use current timestamp as initial seed', () => {
      const mockTimestamp = 1234567890123;
      vi.useFakeTimers();
      vi.setSystemTime(mockTimestamp);

      // Mock Date.now to verify it's being used
      const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp);

      generateUniqueSeeds(3);

      expect(dateSpy).toHaveBeenCalled();

      dateSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe('calculateThumbnailDimensions', () => {
    it('should not resize when both dimensions are within max size', () => {
      const result = calculateThumbnailDimensions(400, 300);

      expect(result).toEqual({
        shouldResize: false,
        thumbnailWidth: 400,
        thumbnailHeight: 300,
      });
    });

    it('should not resize when dimensions equal max size', () => {
      const result = calculateThumbnailDimensions(512, 512);

      expect(result).toEqual({
        shouldResize: false,
        thumbnailWidth: 512,
        thumbnailHeight: 512,
      });
    });

    it('should resize when width exceeds max size (landscape)', () => {
      const result = calculateThumbnailDimensions(1024, 768);

      expect(result).toEqual({
        shouldResize: true,
        thumbnailWidth: 512,
        thumbnailHeight: 384, // Math.round((768 * 512) / 1024)
      });
    });

    it('should resize when height exceeds max size (portrait)', () => {
      const result = calculateThumbnailDimensions(768, 1024);

      expect(result).toEqual({
        shouldResize: true,
        thumbnailWidth: 384, // Math.round((768 * 512) / 1024)
        thumbnailHeight: 512,
      });
    });

    it('should resize square images correctly', () => {
      const result = calculateThumbnailDimensions(1024, 1024);

      expect(result).toEqual({
        shouldResize: true,
        thumbnailWidth: 512,
        thumbnailHeight: 512,
      });
    });

    it('should handle very large images', () => {
      const result = calculateThumbnailDimensions(2048, 1536);

      expect(result).toEqual({
        shouldResize: true,
        thumbnailWidth: 512,
        thumbnailHeight: 384, // Math.round((1536 * 512) / 2048)
      });
    });

    it('should handle very tall images', () => {
      const result = calculateThumbnailDimensions(800, 2400);

      expect(result).toEqual({
        shouldResize: true,
        thumbnailWidth: 171, // Math.round((800 * 512) / 2400)
        thumbnailHeight: 512,
      });
    });

    it('should work with custom max size', () => {
      const result = calculateThumbnailDimensions(1000, 800, 256);

      expect(result).toEqual({
        shouldResize: true,
        thumbnailWidth: 256,
        thumbnailHeight: 205, // Math.round((800 * 256) / 1000)
      });
    });

    it('should handle edge case with very small dimensions', () => {
      const result = calculateThumbnailDimensions(50, 100);

      expect(result).toEqual({
        shouldResize: false,
        thumbnailWidth: 50,
        thumbnailHeight: 100,
      });
    });

    it('should maintain aspect ratio correctly', () => {
      const result = calculateThumbnailDimensions(1600, 900);
      const originalRatio = 1600 / 900;
      const thumbnailRatio = result.thumbnailWidth / result.thumbnailHeight;

      expect(Math.abs(originalRatio - thumbnailRatio)).toBeLessThan(0.01);
    });
  });
});
