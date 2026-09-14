import { describe, expect, it } from 'vitest';

import { resolveMasonryColumnCount } from './useMasonryColumnCount';

describe('resolveMasonryColumnCount', () => {
  it('maps viewport width to the masonry column count without a default guess', () => {
    expect(resolveMasonryColumnCount(600)).toBe(2);
    expect(resolveMasonryColumnCount(800)).toBe(3);
    expect(resolveMasonryColumnCount(1200)).toBe(4);
    expect(resolveMasonryColumnCount(1536)).toBe(5);
    expect(resolveMasonryColumnCount(1920)).toBe(5);
  });
});
