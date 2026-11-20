import { describe, expect, it } from 'vitest';

import { thumbnailCropOffset } from './ThreadEvidence';

describe('thumbnailCropOffset', () => {
  it('leaves a thumbnail that already fits untouched', () => {
    expect(thumbnailCropOffset({ height: 800, width: 1280 }, { height: 0.1, y: 0.8 })).toBe(0);
  });

  it('centers the circled region of a tall screenshot in the window', () => {
    // 1170×3600 at 220px wide is ~677px tall; a region centered at 50% sits at ~338px.
    const offset = thumbnailCropOffset({ height: 3600, width: 1170 }, { height: 0.1, y: 0.45 });
    expect(offset).toBeCloseTo(677 / 2 - 120, 0);
  });

  it('never crops past either end of the picture', () => {
    const size = { height: 3600, width: 1170 };
    expect(thumbnailCropOffset(size, { height: 0.02, y: 0 })).toBe(0);
    expect(thumbnailCropOffset(size, { height: 0.02, y: 0.98 })).toBeCloseTo(677 - 240, 0);
  });

  it('cannot crop without the picture size', () => {
    expect(thumbnailCropOffset({}, { height: 0.1, y: 0.9 })).toBe(0);
  });
});
