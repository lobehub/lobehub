import { describe, expect, it } from 'vitest';

import {
  resolveMasonryColumnCount,
  resolveMasonryColumnCountByWidth,
} from './useMasonryColumnCount';

describe('resolveMasonryColumnCount', () => {
  it('maps viewport width to the masonry column count without a default guess', () => {
    expect(resolveMasonryColumnCount(600)).toBe(2);
    expect(resolveMasonryColumnCount(800)).toBe(3);
    expect(resolveMasonryColumnCount(1200)).toBe(4);
    expect(resolveMasonryColumnCount(1536)).toBe(5);
    expect(resolveMasonryColumnCount(1920)).toBe(5);
  });
});

describe('resolveMasonryColumnCountByWidth', () => {
  it('drops to two columns when the detail panel squeezes the grid', () => {
    // 1280px window with the 480px panel open leaves ~462px of card area.
    expect(resolveMasonryColumnCountByWidth(462)).toBe(2);
  });

  it('never goes below two columns or above five', () => {
    expect(resolveMasonryColumnCountByWidth(120)).toBe(2);
    expect(resolveMasonryColumnCountByWidth(2400)).toBe(5);
  });

  it('keeps cards at least 200px wide as the container grows', () => {
    expect(resolveMasonryColumnCountByWidth(696)).toBe(3);
    expect(resolveMasonryColumnCountByWidth(942)).toBe(4);
    expect(resolveMasonryColumnCountByWidth(1100)).toBe(5);
  });
});
