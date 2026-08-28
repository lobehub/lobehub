import { describe, expect, it } from 'vitest';

import { FALLBACK_ASPECT_RATIO, readAspectRatio } from './imageAspectRatio';

describe('readAspectRatio', () => {
  it('uses the ratio recorded at upload time', () => {
    expect(readAspectRatio({ height: 400, ratio: 2, width: 800 })).toBe(2);
  });

  it('derives the ratio from width / height when `ratio` is missing', () => {
    expect(readAspectRatio({ height: 400, width: 800 })).toBe(2);
  });

  it('returns undefined for uploads with no usable dimensions', () => {
    // CLI / desktop / public-API uploads and pre-rollout rows: the card has to
    // fall back to the reserved box instead of collapsing to zero height.
    expect(readAspectRatio(undefined)).toBeUndefined();
    expect(readAspectRatio(null)).toBeUndefined();
    expect(readAspectRatio({ date: '2026-08-09' })).toBeUndefined();
    expect(readAspectRatio({ height: 0, width: 800 })).toBeUndefined();
    expect(readAspectRatio({ height: -400, width: 800 })).toBeUndefined();
    expect(readAspectRatio({ height: 'tall', width: 'wide' })).toBeUndefined();
  });

  it('ignores a non-positive stored ratio and falls back to the dimensions', () => {
    expect(readAspectRatio({ height: 400, ratio: 0, width: 800 })).toBe(2);
  });

  it('keeps a landscape default so unmeasured cards read as image slots', () => {
    expect(FALLBACK_ASPECT_RATIO).toBeGreaterThan(1);
  });
});
