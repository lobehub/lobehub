import { describe, expect, it } from 'vitest';

import { HANDOVER_WINDOW, isSkeletonHandover, markSkeletonVisible } from './skeletonHandover';

describe('skeletonHandover', () => {
  it('is not a handover before any skeleton was visible', () => {
    expect(isSkeletonHandover(0)).toBe(false);
  });

  it('is a handover right after a skeleton was visible', () => {
    markSkeletonVisible(10_000);
    expect(isSkeletonHandover(10_100)).toBe(true);
  });

  it('is not a handover once the window has passed', () => {
    markSkeletonVisible(20_000);
    expect(isSkeletonHandover(20_000 + HANDOVER_WINDOW)).toBe(false);
  });
});
