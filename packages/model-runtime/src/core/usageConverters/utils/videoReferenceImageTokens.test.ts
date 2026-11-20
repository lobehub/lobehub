import { describe, expect, it } from 'vitest';

import { countVideoReferenceImageTokens } from './videoReferenceImageTokens';

describe('countVideoReferenceImageTokens', () => {
  it.each([
    // fal published samples
    [1024, 1024, 1024],
    [2048, 2048, 1024],
    [1024, 768, 1376],
    [1920, 1080, 1824],
    [1080, 1920, 1824],
    [2500, 1000, 2560],
    // Calibrated against billed units of real requests
    [1500, 1000, 1536],
    [1200, 1000, 1216],
    [360, 300, 1216],
    [1000, 1200, 1216],
    [2200, 1000, 2240],
    [1170, 1000, 1184],
  ])('counts %i×%i as %i tokens for H3 Max', (width, height, tokens) => {
    expect(countVideoReferenceImageTokens('minimax/h3-max', [{ height, width }])).toBe(tokens);
  });

  it('sums every image', () => {
    expect(
      countVideoReferenceImageTokens('minimax/h3-max', [
        { height: 1024, width: 1024 },
        { height: 1080, width: 1920 },
      ]),
    ).toBe(2848);
  });

  it('returns undefined for unknown models or unusable dimensions', () => {
    expect(
      countVideoReferenceImageTokens('other/model', [{ height: 1, width: 1 }]),
    ).toBeUndefined();
    expect(
      countVideoReferenceImageTokens('minimax/h3-max', [{ height: 0, width: 1024 }]),
    ).toBeUndefined();
  });
});
