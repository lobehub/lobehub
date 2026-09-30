import { describe, expect, it } from 'vitest';

import { measureVideoOutputUsage } from './videoOutputUsage';

describe('measureVideoOutputUsage', () => {
  it('counts output tokens from the frame size and frame count', () => {
    // fal billed 39.815K tokens for this Seedance 2.5 image-to-video output
    const tokens = 39_815;

    expect(
      measureVideoOutputUsage('bytedance/seedance-2.5', { frames: 97, height: 592, width: 710 }),
    ).toEqual({ completionTokens: tokens, totalTokens: tokens });
  });

  it('returns undefined when the frame count is unknown', () => {
    expect(
      measureVideoOutputUsage('bytedance/seedance-2.5', { height: 592, width: 710 }),
    ).toBeUndefined();
  });

  it('returns undefined for models not billed by output tokens', () => {
    expect(
      measureVideoOutputUsage('minimax/h3-max', { frames: 121, height: 480, width: 832 }),
    ).toBeUndefined();
  });
});
