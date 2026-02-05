import { describe, expect, it } from 'vitest';

import { convertAlphaToSolid } from './colorUtils';

describe('colorUtils', () => {
  describe('convertAlphaToSolid', () => {
    it('should convert fully opaque color to same color', () => {
      // Fully opaque (alpha = 1.0)
      const result = convertAlphaToSolid('rgba(255, 0, 0, 1.0)', '#ffffff');

      expect(result).toBe('#ff0000');
    });

    it('should convert fully transparent color to background color', () => {
      // Fully transparent (alpha = 0.0)
      const result = convertAlphaToSolid('rgba(255, 0, 0, 0.0)', '#0000ff');

      expect(result).toBe('#0000ff');
    });

    it('should blend semi-transparent red over white background', () => {
      // 50% transparent red over white
      const result = convertAlphaToSolid('rgba(255, 0, 0, 0.5)', '#ffffff');

      // Expected: (255*0.5 + 255*0.5, 0*0.5 + 255*0.5, 0*0.5 + 255*0.5) = (255, 127.5, 127.5)
      expect(result).toBe('#ff8080');
    });

    it('should blend semi-transparent blue over black background', () => {
      // 50% transparent blue over black
      const result = convertAlphaToSolid('rgba(0, 0, 255, 0.5)', '#000000');

      // Expected: (0*0.5 + 0*0.5, 0*0.5 + 0*0.5, 255*0.5 + 0*0.5) = (0, 0, 127.5)
      expect(result).toBe('#000080');
    });

    it('should handle hex color format for foreground', () => {
      // Using hex with alpha
      const result = convertAlphaToSolid('#ff000080', '#ffffff');

      // #ff000080 is red with 50% opacity (80 in hex = 128/255 ≈ 0.5)
      expect(result).toBe('#ff8080');
    });

    it('should handle named colors', () => {
      const result = convertAlphaToSolid('rgba(255, 0, 0, 0.5)', 'white');

      expect(result).toBe('#ff8080');
    });

    it('should blend with 25% opacity', () => {
      // 25% opacity red over white
      const result = convertAlphaToSolid('rgba(255, 0, 0, 0.25)', '#ffffff');

      // Expected: (255*0.25 + 255*0.75, 0*0.25 + 255*0.75, 0*0.25 + 255*0.75) = (255, 191.25, 191.25)
      expect(result).toBe('#ffbfbf');
    });

    it('should blend with 75% opacity', () => {
      // 75% opacity red over white
      const result = convertAlphaToSolid('rgba(255, 0, 0, 0.75)', '#ffffff');

      // Expected: (255*0.75 + 255*0.25, 0*0.75 + 255*0.25, 0*0.75 + 255*0.25) = (255, 63.75, 63.75)
      expect(result).toBe('#ff4040');
    });

    it('should handle complex color blending', () => {
      // Green with 60% opacity over blue
      const result = convertAlphaToSolid('rgba(0, 255, 0, 0.6)', '#0000ff');

      // Expected: (0*0.6 + 0*0.4, 255*0.6 + 0*0.4, 0*0.6 + 255*0.4) = (0, 153, 102)
      expect(result).toBe('#009966');
    });

    it('should blend gray colors', () => {
      // 50% gray over black
      const result = convertAlphaToSolid('rgba(128, 128, 128, 0.5)', '#000000');

      // Expected: (128*0.5 + 0*0.5, 128*0.5 + 0*0.5, 128*0.5 + 0*0.5) = (64, 64, 64)
      expect(result).toBe('#404040');
    });

    it('should handle white foreground over colored background', () => {
      // 30% white over red
      const result = convertAlphaToSolid('rgba(255, 255, 255, 0.3)', '#ff0000');

      // Expected: (255*0.3 + 255*0.7, 255*0.3 + 0*0.7, 255*0.3 + 0*0.7) = (255, 76.5, 76.5)
      expect(result).toBe('#ff4d4d');
    });

    it('should handle both colors with uppercase hex format', () => {
      const result = convertAlphaToSolid('rgba(255, 0, 0, 0.5)', '#FFFFFF');

      expect(result).toBe('#ff8080');
    });

    it('should handle RGB format for background', () => {
      const result = convertAlphaToSolid('rgba(0, 255, 0, 0.5)', 'rgb(0, 0, 255)');

      expect(result).toBe('#008080');
    });

    it('should blend dark color over light background', () => {
      // Dark gray (20, 20, 20) with 80% opacity over white
      const result = convertAlphaToSolid('rgba(20, 20, 20, 0.8)', '#ffffff');

      // Expected: (20*0.8 + 255*0.2, 20*0.8 + 255*0.2, 20*0.8 + 255*0.2) = (67, 67, 67)
      expect(result).toBe('#434343');
    });

    it('should blend light color over dark background', () => {
      // Light gray (200, 200, 200) with 20% opacity over black
      const result = convertAlphaToSolid('rgba(200, 200, 200, 0.2)', '#000000');

      // Expected: (200*0.2 + 0*0.8, 200*0.2 + 0*0.8, 200*0.2 + 0*0.8) = (40, 40, 40)
      expect(result).toBe('#282828');
    });

    it('should handle three-digit hex codes', () => {
      // #f00 is red, expanded to #ff0000
      const result = convertAlphaToSolid('rgba(255, 0, 0, 0.5)', '#fff');

      expect(result).toBe('#ff8080');
    });

    it('should return lowercase hex format', () => {
      const result = convertAlphaToSolid('rgba(255, 165, 0, 1.0)', '#000000');

      // Orange color
      expect(result).toMatch(/^#[\da-f]{6}$/);
      expect(result).toBe('#ffa500');
    });

    it('should handle edge case with very low alpha value', () => {
      // Nearly transparent
      const result = convertAlphaToSolid('rgba(255, 0, 0, 0.01)', '#0000ff');

      // Should be very close to blue background
      expect(result).toBe('#0300fc');
    });

    it('should handle edge case with very high alpha value', () => {
      // Nearly opaque
      const result = convertAlphaToSolid('rgba(255, 0, 0, 0.99)', '#0000ff');

      // Should be very close to red foreground
      expect(result).toBe('#fc0003');
    });

    it('should handle blending complementary colors', () => {
      // Cyan with 50% opacity over red
      const result = convertAlphaToSolid('rgba(0, 255, 255, 0.5)', '#ff0000');

      // Expected: (0*0.5 + 255*0.5, 255*0.5 + 0*0.5, 255*0.5 + 0*0.5) = (127.5, 127.5, 127.5)
      expect(result).toBe('#808080');
    });

    it('should produce same result regardless of input color format', () => {
      const result1 = convertAlphaToSolid('#ff000080', '#ffffff');
      const result2 = convertAlphaToSolid('rgba(255, 0, 0, 0.5)', 'white');
      const result3 = convertAlphaToSolid('rgba(255, 0, 0, 0.5)', '#fff');

      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });
  });
});
