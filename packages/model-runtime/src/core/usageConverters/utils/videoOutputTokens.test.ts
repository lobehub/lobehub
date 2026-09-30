import { describe, expect, it } from 'vitest';

import { countVideoOutputTokens, meterVideoOutputTokens } from './videoOutputTokens';

const SEEDANCE = 'bytedance/seedance-2.5';

describe('countVideoOutputTokens', () => {
  // Billed units of real fal requests on 2026-09-30 (4s, 97 frames), in thousands of tokens
  it.each([
    [854, 480, 38.83],
    [640, 640, 38.8],
    [560, 752, 39.891],
    // image-to-video with a 6:5 start frame
    [710, 592, 39.815],
  ])('matches fal billing for %i×%i', (width, height, billedThousands) => {
    const tokens = countVideoOutputTokens(SEEDANCE, { frames: 97, height, width });

    expect(Number(((tokens ?? 0) / 1000).toFixed(3))).toBe(billedThousands);
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
    ).toEqual({ exact: (480 * 854 * 97) / 1024 });
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
    ).toEqual({ exact: (640 * 640 * 241) / 1024 });
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
    ).toEqual({ estimated: (854 * 480 * 97) / 1024 });
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
