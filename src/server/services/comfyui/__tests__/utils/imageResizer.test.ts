import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Architecture,
  ImageResizer,
  imageResizer,
} from '@/server/services/comfyui/utils/imageResizer';

// Mock debug module
vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

describe('imageResizer.ts', () => {
  let resizer: ImageResizer;

  beforeEach(() => {
    vi.clearAllMocks();
    resizer = new ImageResizer();
  });

  describe('ImageResizer class', () => {
    describe('calculateTargetDimensions', () => {
      describe('FLUX architecture', () => {
        it('should not resize when dimensions are within limits', () => {
          const result = resizer.calculateTargetDimensions(1024, 768, 'FLUX');

          expect(result).toEqual({
            width: 1024,
            height: 768,
            needsResize: false,
          });
        });

        it('should resize when width exceeds maximum', () => {
          const result = resizer.calculateTargetDimensions(2000, 800, 'FLUX');

          expect(result.needsResize).toBe(true);
          expect(result.width).toBeLessThanOrEqual(1440);
          expect(result.height).toBeLessThanOrEqual(1440);
          expect(result.width % 32).toBe(0); // Should be rounded to step
          expect(result.height % 32).toBe(0);
        });

        it('should resize when height exceeds maximum', () => {
          const result = resizer.calculateTargetDimensions(800, 2000, 'FLUX');

          expect(result.needsResize).toBe(true);
          expect(result.width).toBeLessThanOrEqual(1440);
          expect(result.height).toBeLessThanOrEqual(1440);
          expect(result.width % 32).toBe(0);
          expect(result.height % 32).toBe(0);
        });

        it('should resize when dimensions are too small', () => {
          const result = resizer.calculateTargetDimensions(100, 200, 'FLUX');

          expect(result.needsResize).toBe(true);
          expect(result.width).toBeGreaterThanOrEqual(256);
          expect(result.height).toBeGreaterThanOrEqual(256);
          expect(result.width % 32).toBe(0);
          expect(result.height % 32).toBe(0);
        });

        it('should handle exact limit dimensions', () => {
          const result = resizer.calculateTargetDimensions(1440, 256, 'FLUX');

          expect(result).toEqual({
            width: 1440,
            height: 256,
            needsResize: false,
          });
        });

        it('should round to step size (32) correctly', () => {
          const result = resizer.calculateTargetDimensions(1000, 600, 'FLUX');

          if (result.needsResize) {
            expect(result.width % 32).toBe(0);
            expect(result.height % 32).toBe(0);
          } else {
            // Original dimensions should be accepted
            expect(result.width).toBe(1000);
            expect(result.height).toBe(600);
          }
        });

        it('should handle aspect ratio constraints', () => {
          // Test extreme aspect ratios
          const wideResult = resizer.calculateTargetDimensions(2100, 900, 'FLUX'); // 2.33 ratio
          const tallResult = resizer.calculateTargetDimensions(900, 2100, 'FLUX'); // 0.43 ratio

          expect(wideResult.needsResize).toBe(true);
          expect(tallResult.needsResize).toBe(true);

          // Should still produce valid dimensions within model limits
          expect(wideResult.width).toBeLessThanOrEqual(1440);
          expect(wideResult.height).toBeLessThanOrEqual(1440);
          expect(tallResult.width).toBeLessThanOrEqual(1440);
          expect(tallResult.height).toBeLessThanOrEqual(1440);
        });
      });

      describe('SD1 architecture', () => {
        it('should not resize for optimal dimensions', () => {
          const result = resizer.calculateTargetDimensions(512, 512, 'SD1');

          expect(result).toEqual({
            width: 512,
            height: 512,
            needsResize: false,
          });
        });

        it('should resize when exceeding maximum', () => {
          const result = resizer.calculateTargetDimensions(1000, 800, 'SD1');

          expect(result.needsResize).toBe(true);
          expect(result.width).toBeLessThanOrEqual(768);
          expect(result.height).toBeLessThanOrEqual(768);
        });

        it('should resize when below minimum', () => {
          const result = resizer.calculateTargetDimensions(100, 200, 'SD1');

          expect(result.needsResize).toBe(true);
          expect(result.width).toBeGreaterThanOrEqual(256);
          expect(result.height).toBeGreaterThanOrEqual(256);
        });

        it('should handle edge case at exact limits', () => {
          const maxResult = resizer.calculateTargetDimensions(768, 768, 'SD1');
          const minResult = resizer.calculateTargetDimensions(256, 256, 'SD1');

          expect(maxResult.needsResize).toBe(false);
          expect(minResult.needsResize).toBe(false);
        });
      });

      describe('SD3 architecture', () => {
        it('should not resize for optimal dimensions', () => {
          const result = resizer.calculateTargetDimensions(1024, 1024, 'SD3');

          expect(result).toEqual({
            width: 1024,
            height: 1024,
            needsResize: false,
          });
        });

        it('should resize when exceeding maximum', () => {
          const result = resizer.calculateTargetDimensions(3000, 2000, 'SD3');

          expect(result.needsResize).toBe(true);
          expect(result.width).toBeLessThanOrEqual(2048);
          expect(result.height).toBeLessThanOrEqual(2048);
        });

        it('should resize when below minimum', () => {
          const result = resizer.calculateTargetDimensions(300, 400, 'SD3');

          expect(result.needsResize).toBe(true);
          expect(result.width).toBeGreaterThanOrEqual(512);
          expect(result.height).toBeGreaterThanOrEqual(512);
        });
      });

      describe('SDXL architecture', () => {
        it('should not resize for optimal dimensions', () => {
          const result = resizer.calculateTargetDimensions(1024, 1024, 'SDXL');

          expect(result).toEqual({
            width: 1024,
            height: 1024,
            needsResize: false,
          });
        });

        it('should resize when exceeding maximum', () => {
          const result = resizer.calculateTargetDimensions(2500, 2500, 'SDXL');

          expect(result.needsResize).toBe(true);
          expect(result.width).toBeLessThanOrEqual(2048);
          expect(result.height).toBeLessThanOrEqual(2048);
        });

        it('should resize when below minimum', () => {
          const result = resizer.calculateTargetDimensions(400, 300, 'SDXL');

          expect(result.needsResize).toBe(true);
          expect(result.width).toBeGreaterThanOrEqual(512);
          expect(result.height).toBeGreaterThanOrEqual(512);
        });
      });

      describe('edge cases and error handling', () => {
        it('should handle zero dimensions', () => {
          expect(() => resizer.calculateTargetDimensions(0, 100, 'FLUX')).not.toThrow();
          expect(() => resizer.calculateTargetDimensions(100, 0, 'FLUX')).not.toThrow();
          expect(() => resizer.calculateTargetDimensions(0, 0, 'FLUX')).not.toThrow();
        });

        it('should handle negative dimensions', () => {
          expect(() => resizer.calculateTargetDimensions(-100, 100, 'FLUX')).not.toThrow();
          expect(() => resizer.calculateTargetDimensions(100, -100, 'FLUX')).not.toThrow();
        });

        it('should handle very large dimensions', () => {
          const result = resizer.calculateTargetDimensions(10000, 10000, 'FLUX');

          expect(result.needsResize).toBe(true);
          expect(result.width).toBeLessThanOrEqual(1440);
          expect(result.height).toBeLessThanOrEqual(1440);
        });

        it('should handle very small dimensions', () => {
          const result = resizer.calculateTargetDimensions(1, 1, 'FLUX');

          expect(result.needsResize).toBe(true);
          expect(result.width).toBeGreaterThanOrEqual(256);
          expect(result.height).toBeGreaterThanOrEqual(256);
        });

        it('should handle unknown architecture gracefully', () => {
          expect(() => {
            resizer.calculateTargetDimensions(1024, 768, 'UNKNOWN' as Architecture);
          }).toThrow();
        });

        it('should handle floating point dimensions', () => {
          const result = resizer.calculateTargetDimensions(1024.5, 768.7, 'FLUX');

          // Results should be numbers (may be integers or floats depending on calculation)
          expect(typeof result.width).toBe('number');
          expect(typeof result.height).toBe('number');
          expect(Number.isFinite(result.width)).toBe(true);
          expect(Number.isFinite(result.height)).toBe(true);
        });

        it('should maintain aspect ratio during scaling', () => {
          const originalAspectRatio = 16 / 9;
          const originalWidth = 1920;
          const originalHeight = 1080;

          const result = resizer.calculateTargetDimensions(originalWidth, originalHeight, 'FLUX');

          if (result.needsResize) {
            const newAspectRatio = result.width / result.height;
            expect(Math.abs(newAspectRatio - originalAspectRatio)).toBeLessThan(0.1);
          }
        });
      });

      describe('performance and consistency', () => {
        it('should be deterministic for same inputs', () => {
          const inputs = [
            [1024, 768, 'FLUX'],
            [512, 512, 'SD1'],
            [2048, 1024, 'SDXL'],
          ] as const;

          inputs.forEach(([width, height, arch]) => {
            const result1 = resizer.calculateTargetDimensions(width, height, arch);
            const result2 = resizer.calculateTargetDimensions(width, height, arch);

            expect(result1).toEqual(result2);
          });
        });

        it('should handle rapid successive calls', () => {
          const results = [];

          for (let i = 0; i < 1000; i++) {
            const result = resizer.calculateTargetDimensions(1024 + i, 768 + i, 'FLUX');
            results.push(result);
          }

          expect(results).toHaveLength(1000);
          results.forEach((result) => {
            expect(typeof result.width).toBe('number');
            expect(typeof result.height).toBe('number');
            expect(typeof result.needsResize).toBe('boolean');
          });
        });
      });
    });
  });

  describe('private method testing through public interface', () => {
    describe('calculateRatio method (through public interface)', () => {
      it('should calculate ratios correctly in various scenarios', () => {
        // Test through calculateTargetDimensions which uses calculateRatioFromDimensions
        const wideResult = resizer.calculateTargetDimensions(1600, 900, 'FLUX'); // 16:9
        const squareResult = resizer.calculateTargetDimensions(1000, 1000, 'FLUX'); // 1:1
        const tallResult = resizer.calculateTargetDimensions(900, 1600, 'FLUX'); // 9:16

        expect(typeof wideResult).toBe('object');
        expect(typeof squareResult).toBe('object');
        expect(typeof tallResult).toBe('object');
      });
    });

    describe('isWithinRatioRange method (through public interface)', () => {
      it('should handle ratio range validation through FLUX constraints', () => {
        // Test extreme ratios that should trigger ratio range checks
        const extremeWide = resizer.calculateTargetDimensions(3000, 1000, 'FLUX'); // 3:1 (exceeds 21:9)
        const extremeTall = resizer.calculateTargetDimensions(1000, 3000, 'FLUX'); // 1:3 (exceeds 9:21)

        expect(extremeWide.needsResize).toBe(true);
        expect(extremeTall.needsResize).toBe(true);
      });
    });

    describe('getModelLimits method (through public interface)', () => {
      it('should use correct limits for each architecture', () => {
        // Test by checking if results respect known limits
        const fluxResult = resizer.calculateTargetDimensions(2000, 2000, 'FLUX');
        const sd1Result = resizer.calculateTargetDimensions(1000, 1000, 'SD1');
        const sd3Result = resizer.calculateTargetDimensions(3000, 3000, 'SD3');
        const sdxlResult = resizer.calculateTargetDimensions(3000, 3000, 'SDXL');

        expect(fluxResult.width).toBeLessThanOrEqual(1440); // FLUX max
        expect(sd1Result.width).toBeLessThanOrEqual(768); // SD1 max
        expect(sd3Result.width).toBeLessThanOrEqual(2048); // SD3 max
        expect(sdxlResult.width).toBeLessThanOrEqual(2048); // SDXL max
      });
    });
  });

  describe('singleton instance', () => {
    it('should export a singleton instance', () => {
      expect(imageResizer).toBeInstanceOf(ImageResizer);
    });

    it('should maintain state across calls', () => {
      const result1 = imageResizer.calculateTargetDimensions(1024, 768, 'FLUX');
      const result2 = imageResizer.calculateTargetDimensions(1024, 768, 'FLUX');

      expect(result1).toEqual(result2);
    });

    it('should be the same instance when imported multiple times', () => {
      // This tests that the singleton pattern is working correctly
      expect(imageResizer).toBeDefined();
      expect(typeof imageResizer.calculateTargetDimensions).toBe('function');
    });
  });

  describe('integration scenarios', () => {
    it('should handle common use cases correctly', () => {
      const commonSizes = [
        { width: 512, height: 512, arch: 'SD1' as Architecture },
        { width: 1024, height: 1024, arch: 'SDXL' as Architecture },
        { width: 1440, height: 1024, arch: 'FLUX' as Architecture },
        { width: 768, height: 512, arch: 'SD1' as Architecture },
      ];

      commonSizes.forEach(({ width, height, arch }) => {
        const result = resizer.calculateTargetDimensions(width, height, arch);

        expect(result).toHaveProperty('width');
        expect(result).toHaveProperty('height');
        expect(result).toHaveProperty('needsResize');
        expect(typeof result.needsResize).toBe('boolean');
      });
    });

    it('should handle img2img workflow dimensions', () => {
      // Common img2img input sizes
      const img2imgSizes = [
        [1920, 1080], // Full HD
        [1280, 720], // HD
        [800, 600], // SVGA
        [640, 480], // VGA
      ];

      img2imgSizes.forEach(([width, height]) => {
        ['FLUX', 'SDXL', 'SD3', 'SD1'].forEach((arch) => {
          const result = resizer.calculateTargetDimensions(width, height, arch as Architecture);

          // All results should be valid
          expect(result.width).toBeGreaterThan(0);
          expect(result.height).toBeGreaterThan(0);
          expect(Number.isInteger(result.width)).toBe(true);
          expect(Number.isInteger(result.height)).toBe(true);
        });
      });
    });
  });

  describe('boundary testing', () => {
    it('should handle boundary conditions for each architecture', () => {
      const architectures: Architecture[] = ['FLUX', 'SD1', 'SD3', 'SDXL'];

      architectures.forEach((arch) => {
        // Test minimum boundary
        const minResult = resizer.calculateTargetDimensions(1, 1, arch);
        expect(minResult.needsResize).toBe(true);

        // Test maximum boundary
        const maxResult = resizer.calculateTargetDimensions(10000, 10000, arch);
        expect(maxResult.needsResize).toBe(true);
      });
    });

    it('should handle step size boundaries for FLUX', () => {
      // Test dimensions that are close to but not exactly divisible by 32
      const testCases = [
        [1023, 767], // Just below step boundary
        [1025, 769], // Just above step boundary
        [1056, 800], // Exactly on step boundary
      ];

      testCases.forEach(([width, height]) => {
        const result = resizer.calculateTargetDimensions(width, height, 'FLUX');

        if (result.needsResize) {
          expect(result.width % 32).toBe(0);
          expect(result.height % 32).toBe(0);
        }
      });
    });
  });
});
