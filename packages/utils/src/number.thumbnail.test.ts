import { describe, expect, it } from 'vitest';

import { calculateThumbnailDimensions } from './number';

describe('extreme thumbnail aspect ratios', () => {
  it.each([
    [10000, 1],
    [1, 10000],
  ])('keeps both dimensions positive for %i × %i images', (width, height) => {
    const result = calculateThumbnailDimensions(width, height, 512);
    expect(result.shouldResize).toBe(true);
    expect(result.thumbnailWidth).toBeGreaterThanOrEqual(1);
    expect(result.thumbnailHeight).toBeGreaterThanOrEqual(1);
    expect(Math.max(result.thumbnailWidth, result.thumbnailHeight)).toBe(512);
  });

  it('preserves small images without upscaling', () => {
    expect(calculateThumbnailDimensions(1, 1)).toEqual({
      shouldResize: false,
      thumbnailWidth: 1,
      thumbnailHeight: 1,
    });
  });
});
