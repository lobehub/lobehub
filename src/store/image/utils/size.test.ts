import { describe, expect, it } from 'vitest';

import { adaptSizeToRatio, parseRatio } from './size';

describe('size utils', () => {
  describe('parseRatio', () => {
    it('should parse valid ratio string correctly', () => {
      expect(parseRatio('16:9')).toBe(16 / 9);
      expect(parseRatio('4:3')).toBe(4 / 3);
      expect(parseRatio('1:1')).toBe(1);
      expect(parseRatio('21:9')).toBe(21 / 9);
    });

    it('should handle square ratio correctly', () => {
      expect(parseRatio('1:1')).toBe(1);
      expect(parseRatio('100:100')).toBe(1);
      expect(parseRatio('512:512')).toBe(1);
    });

    it('should handle wide ratios correctly', () => {
      expect(parseRatio('16:9')).toBeCloseTo(16 / 9, 6);
      expect(parseRatio('2:1')).toBe(2);
      expect(parseRatio('3:1')).toBe(3);
    });

    it('should handle tall ratios correctly', () => {
      expect(parseRatio('9:16')).toBeCloseTo(0.5625, 4);
      expect(parseRatio('1:2')).toBe(0.5);
      expect(parseRatio('3:4')).toBe(0.75);
    });

    it('should handle decimal values in ratio string', () => {
      expect(parseRatio('1.5:1')).toBe(1.5);
      expect(parseRatio('16.5:9.5')).toBeCloseTo(16.5 / 9.5, 6);
    });

    it('should return 1 for invalid ratio string formats', () => {
      expect(parseRatio('16')).toBe(1); // Missing colon
      expect(parseRatio('16-9')).toBe(1); // Wrong separator
      expect(parseRatio('16:9:1')).toBe(1); // Too many parts
      expect(parseRatio('')).toBe(1); // Empty string
      expect(parseRatio(':')).toBe(1); // Only separator
    });

    it('should return 1 for invalid input types', () => {
      // @ts-expect-error - testing runtime behavior with invalid types
      expect(parseRatio(null)).toBe(1);
      // @ts-expect-error - testing runtime behavior with invalid types
      expect(parseRatio(undefined)).toBe(1);
      // @ts-expect-error - testing runtime behavior with invalid types
      expect(parseRatio(123)).toBe(1);
      // @ts-expect-error - testing runtime behavior with invalid types
      expect(parseRatio({})).toBe(1);
    });

    it('should return 1 for non-numeric ratio parts', () => {
      expect(parseRatio('abc:def')).toBe(1);
      expect(parseRatio('16:abc')).toBe(1);
      expect(parseRatio('abc:9')).toBe(1);
      expect(parseRatio('NaN:9')).toBe(1);
      expect(parseRatio('16:NaN')).toBe(1);
    });

    it('should return 1 for zero or negative values', () => {
      expect(parseRatio('0:9')).toBe(1);
      expect(parseRatio('16:0')).toBe(1);
      expect(parseRatio('0:0')).toBe(1);
      expect(parseRatio('-16:9')).toBe(1);
      expect(parseRatio('16:-9')).toBe(1);
      expect(parseRatio('-16:-9')).toBe(1);
    });

    it('should return 1 for Infinity values', () => {
      expect(parseRatio('Infinity:9')).toBe(1);
      expect(parseRatio('16:Infinity')).toBe(1);
      expect(parseRatio('Infinity:Infinity')).toBe(1);
    });
  });

  describe('adaptSizeToRatio', () => {
    describe('valid inputs', () => {
      it('should keep width and adjust height when target ratio is wider', () => {
        // 16:9 (1.777) is wider than 4:3 (1.333)
        const result = adaptSizeToRatio(16 / 9, 800, 600);
        expect(result).toEqual({ width: 800, height: 450 });
      });

      it('should keep height and adjust width when target ratio is taller', () => {
        // 4:3 (1.333) is taller than 16:9 (1.777)
        const result = adaptSizeToRatio(4 / 3, 800, 450);
        expect(result).toEqual({ width: 600, height: 450 });
      });

      it('should maintain dimensions when ratio matches current ratio', () => {
        // 16:9 matches 1920:1080
        const result = adaptSizeToRatio(16 / 9, 1920, 1080);
        expect(result).toEqual({ width: 1920, height: 1080 });
      });

      it('should handle square ratio (1:1) correctly', () => {
        // Current ratio: 800/600 = 1.333, target ratio: 1
        // Since 1 < 1.333, keeps height (600), adjusts width to 600
        const result = adaptSizeToRatio(1, 800, 600);
        expect(result).toEqual({ width: 600, height: 600 });

        // Current ratio: 600/800 = 0.75, target ratio: 1
        // Since 1 > 0.75, keeps width (600), adjusts height to 600
        const result2 = adaptSizeToRatio(1, 600, 800);
        expect(result2).toEqual({ width: 600, height: 600 });
      });

      it('should round dimensions to nearest integer', () => {
        // Current ratio: 1000/800 = 1.25, target ratio: 1.5
        // Since 1.5 > 1.25, keeps width (1000), adjusts height to 1000/1.5 = 666.67 -> 667
        const result = adaptSizeToRatio(1.5, 1000, 800);
        expect(result.width).toBe(1000);
        expect(result.height).toBe(667);
        expect(Number.isInteger(result.width)).toBe(true);
        expect(Number.isInteger(result.height)).toBe(true);
      });

      it('should handle very wide ratios correctly', () => {
        const result = adaptSizeToRatio(3, 1200, 800);
        expect(result).toEqual({ width: 1200, height: 400 });
      });

      it('should handle very tall ratios correctly', () => {
        const result = adaptSizeToRatio(1 / 3, 1200, 800);
        expect(result).toEqual({ width: 267, height: 800 });
      });

      it('should handle small dimensions', () => {
        const result = adaptSizeToRatio(16 / 9, 320, 240);
        expect(result).toEqual({ width: 320, height: 180 });
      });

      it('should handle large dimensions', () => {
        const result = adaptSizeToRatio(16 / 9, 3840, 2880);
        expect(result).toEqual({ width: 3840, height: 2160 });
      });

      it('should handle decimal ratio values', () => {
        const result = adaptSizeToRatio(1.5, 900, 600);
        expect(result).toEqual({ width: 900, height: 600 });
      });
    });

    describe('error handling - invalid ratio', () => {
      it('should throw error for zero ratio', () => {
        expect(() => adaptSizeToRatio(0, 800, 600)).toThrow(
          'Invalid ratio: must be a positive finite number',
        );
      });

      it('should throw error for negative ratio', () => {
        expect(() => adaptSizeToRatio(-1.5, 800, 600)).toThrow(
          'Invalid ratio: must be a positive finite number',
        );
      });

      it('should throw error for NaN ratio', () => {
        expect(() => adaptSizeToRatio(NaN, 800, 600)).toThrow(
          'Invalid ratio: must be a positive finite number',
        );
      });

      it('should throw error for Infinity ratio', () => {
        expect(() => adaptSizeToRatio(Infinity, 800, 600)).toThrow(
          'Invalid ratio: must be a positive finite number',
        );
        expect(() => adaptSizeToRatio(-Infinity, 800, 600)).toThrow(
          'Invalid ratio: must be a positive finite number',
        );
      });
    });

    describe('error handling - invalid defaultWidth', () => {
      it('should throw error for zero defaultWidth', () => {
        expect(() => adaptSizeToRatio(16 / 9, 0, 600)).toThrow(
          'Invalid defaultWidth: must be a positive finite number',
        );
      });

      it('should throw error for negative defaultWidth', () => {
        expect(() => adaptSizeToRatio(16 / 9, -800, 600)).toThrow(
          'Invalid defaultWidth: must be a positive finite number',
        );
      });

      it('should throw error for NaN defaultWidth', () => {
        expect(() => adaptSizeToRatio(16 / 9, NaN, 600)).toThrow(
          'Invalid defaultWidth: must be a positive finite number',
        );
      });

      it('should throw error for Infinity defaultWidth', () => {
        expect(() => adaptSizeToRatio(16 / 9, Infinity, 600)).toThrow(
          'Invalid defaultWidth: must be a positive finite number',
        );
      });
    });

    describe('error handling - invalid defaultHeight', () => {
      it('should throw error for zero defaultHeight', () => {
        expect(() => adaptSizeToRatio(16 / 9, 800, 0)).toThrow(
          'Invalid defaultHeight: must be a positive finite number',
        );
      });

      it('should throw error for negative defaultHeight', () => {
        expect(() => adaptSizeToRatio(16 / 9, 800, -600)).toThrow(
          'Invalid defaultHeight: must be a positive finite number',
        );
      });

      it('should throw error for NaN defaultHeight', () => {
        expect(() => adaptSizeToRatio(16 / 9, 800, NaN)).toThrow(
          'Invalid defaultHeight: must be a positive finite number',
        );
      });

      it('should throw error for Infinity defaultHeight', () => {
        expect(() => adaptSizeToRatio(16 / 9, 800, Infinity)).toThrow(
          'Invalid defaultHeight: must be a positive finite number',
        );
      });
    });

    describe('error handling - multiple invalid parameters', () => {
      it('should validate ratio first before other parameters', () => {
        // When multiple params are invalid, ratio is checked first
        expect(() => adaptSizeToRatio(0, 0, 0)).toThrow(
          'Invalid ratio: must be a positive finite number',
        );
      });

      it('should validate defaultWidth before defaultHeight', () => {
        // When ratio is valid but width and height are invalid
        expect(() => adaptSizeToRatio(1.5, 0, 0)).toThrow(
          'Invalid defaultWidth: must be a positive finite number',
        );
      });
    });
  });
});
