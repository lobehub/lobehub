import { describe, expect, it } from 'vitest';

import { countVideoOutputTokens, meterVideoOutputTokens } from './videoOutputTokens';

const SEEDANCE = 'bytedance/seedance-2.5';

describe('countVideoOutputTokens', () => {
  // Billed tokens of real fal requests on 2026-09-30 (4s, 97 frames): fal floors the token count
  it.each([
    [854, 480, 38_830],
    [640, 640, 38_800],
    [560, 752, 39_891],
    [992, 432, 40_594],
    [1470, 630, 87_726],
    [1112, 834, 87_850],
    // 1080p is billed at 1.094× these tokens, which the pricing rate carries
    [2206, 946, 197_682],
    // image-to-video with 6:5 and 10:16 start frames
    [710, 592, 39_815],
    [506, 810, 38_824],
  ])('matches fal billing for %i×%i', (width, height, billedTokens) => {
    expect(countVideoOutputTokens(SEEDANCE, { frames: 97, height, width })).toBe(billedTokens);
  });

  it('skips models not billed by output tokens and unmeasured videos', () => {
    expect(countVideoOutputTokens('minimax/h3-max', { frames: 97, height: 480, width: 854 })).toBe(
      undefined,
    );
    expect(countVideoOutputTokens(SEEDANCE, { frames: 0, height: 480, width: 854 })).toBe(
      undefined,
    );
  });
});

describe('meterVideoOutputTokens', () => {
  it('prices text-to-video exactly from the resolution, aspect ratio and duration', () => {
    expect(
      meterVideoOutputTokens(SEEDANCE, { aspectRatio: '9:16', duration: 4, resolution: '480p' }),
    ).toEqual({ exact: Math.floor((480 * 854 * 97) / 1024) });
  });

  it('prices 1080p from its measured frame size', () => {
    expect(
      meterVideoOutputTokens(SEEDANCE, { aspectRatio: '21:9', duration: 4, resolution: '1080p' }),
    ).toEqual({ exact: 197_682 });
  });

  it('prices reference-to-video exactly, frames folded into the pool included', () => {
    expect(
      meterVideoOutputTokens(SEEDANCE, {
        aspectRatio: '1:1',
        duration: 10,
        imageUrl: 'https://img/start.png',
        imageUrls: ['https://img/a.png'],
        resolution: '480p',
      }),
    ).toEqual({ exact: Math.floor((640 * 640 * 241) / 1024) });
  });

  it('only estimates image-to-video, whose output follows the start frame', () => {
    expect(
      meterVideoOutputTokens(SEEDANCE, {
        aspectRatio: '1:1',
        duration: 4,
        imageUrl: 'https://img/start.png',
        imageUrls: [''],
        resolution: '480p',
      }),
    ).toEqual({ estimated: Math.floor((854 * 480 * 97) / 1024) });
  });

  it('meters nothing without a duration, a known size or an output-token model', () => {
    expect(meterVideoOutputTokens(SEEDANCE, { aspectRatio: '16:9', resolution: '480p' })).toBe(
      undefined,
    );
    expect(
      meterVideoOutputTokens(SEEDANCE, { aspectRatio: 'auto', duration: 4, resolution: '480p' }),
    ).toBe(undefined);
    expect(
      meterVideoOutputTokens('minimax/h3-max', {
        aspectRatio: '16:9',
        duration: 5,
        resolution: '480P',
      }),
    ).toBe(undefined);
  });
});
