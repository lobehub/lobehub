import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AUDIO_INPUT_TOKEN_ESTIMATE,
  estimateAudioInputTokens,
  normalizeAudioDurationMs,
  readAudioDurationMs,
} from './audio';

describe('audio token estimates', () => {
  it('normalizes only positive finite durations', () => {
    expect(normalizeAudioDurationMs(2500.2)).toBe(2501);
    expect(normalizeAudioDurationMs(0)).toBeUndefined();
    expect(normalizeAudioDurationMs(-1)).toBeUndefined();
    expect(normalizeAudioDurationMs(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(normalizeAudioDurationMs('2500')).toBeUndefined();
  });

  it('reads only durationMs from metadata', () => {
    expect(readAudioDurationMs({ durationMs: 1200, transcript: 'private' })).toBe(1200);
    expect(readAudioDurationMs({ duration: 1200 })).toBeUndefined();
    expect(readAudioDurationMs(null)).toBeUndefined();
  });

  it('uses duration when possible and exposes conservative fallback sources', () => {
    expect(
      estimateAudioInputTokens([{ durationMs: 2500 }, {}, { durationMs: -1 }], {
        tokensPerSecond: 32,
      }),
    ).toEqual({
      durationItemCount: 1,
      fallbackItemCount: 2,
      source: 'mixed',
      tokens: DEFAULT_AUDIO_INPUT_TOKEN_ESTIMATE * 3,
    });
  });

  it('does not let an untrusted short duration reduce the flat fallback', () => {
    expect(
      estimateAudioInputTokens([{ durationMs: 1 }], {
        fallbackTokensPerItem: 1200,
        tokensPerSecond: 32,
      }),
    ).toEqual({
      durationItemCount: 1,
      fallbackItemCount: 0,
      source: 'duration',
      tokens: 1200,
    });
  });

  it('uses the duration estimate when it is more conservative than the flat fallback', () => {
    expect(estimateAudioInputTokens([{ durationMs: 40_000 }], { tokensPerSecond: 32 })).toEqual({
      durationItemCount: 1,
      fallbackItemCount: 0,
      source: 'duration',
      tokens: 1280,
    });
  });

  it('falls back when the configured token rate is invalid', () => {
    expect(estimateAudioInputTokens([{ durationMs: 2500 }], { tokensPerSecond: 0 })).toEqual({
      durationItemCount: 0,
      fallbackItemCount: 1,
      source: 'fallback',
      tokens: DEFAULT_AUDIO_INPUT_TOKEN_ESTIMATE,
    });
  });
});
