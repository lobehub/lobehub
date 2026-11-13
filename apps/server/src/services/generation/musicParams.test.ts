import { describe, expect, it } from 'vitest';

import { musicParamsInputSchema, toRuntimeMusicParams, validateMusicParams } from './musicParams';

const parse = (value: unknown) => musicParamsInputSchema.parse(value);

describe('validateMusicParams', () => {
  it('accepts lyrics-only input without a model schema', () => {
    expect(validateMusicParams(parse({ lyrics: '[Verse] hi' }))).toEqual([]);
  });

  it('ignores unset optional values the model does not declare', () => {
    const params = parse({ instrumental: false, prompt: 'p', style: '', title: null });
    expect(validateMusicParams(params, { prompt: { default: '' } })).toEqual([]);
  });

  it('enforces declared duration bounds, required reference audio and audio settings', () => {
    const errors = validateMusicParams(
      parse({ bitrate: 64_000, duration: 400, format: 'pcm', prompt: 'p', sampleRate: 8000 }),
      {
        bitrate: { default: 256_000, enum: [128_000, 256_000] },
        duration: { default: null, max: 240, min: 30 },
        format: { default: 'mp3', enum: ['mp3', 'wav'] },
        prompt: { default: '' },
        referenceAudioUrl: { default: null, required: true },
        sampleRate: { default: 44_100, enum: [44_100] },
      },
    );

    expect(errors).toEqual([
      '"duration" must be at most 240 seconds',
      'The model requires "referenceAudioUrl"',
      '"format" must be one of mp3, wav',
      '"sampleRate" must be one of 44100',
      '"bitrate" must be one of 128000, 256000',
    ]);
  });

  it('rejects a non-URL reference audio and unknown keys at the schema', () => {
    expect(() => parse({ prompt: 'p', referenceAudioUrl: 'not a url' })).toThrow();
    expect(() => parse({ prompt: 'p', tags: 'pop' })).toThrow(/Unrecognized key/);
  });
});

describe('toRuntimeMusicParams', () => {
  it('maps standard params to the runtime names and drops empty values', () => {
    expect(
      toRuntimeMusicParams(
        parse({
          autoLyrics: true,
          duration: 120,
          format: 'wav',
          instrumental: false,
          lyrics: '',
          negativeStyle: 'metal',
          prompt: 'rainy night',
          style: null,
          title: 'Rain',
        }),
      ),
    ).toEqual({
      duration: 120,
      format: 'wav',
      instrumental: false,
      lyricsOptimizer: true,
      negativeStyle: 'metal',
      prompt: 'rainy night',
      title: 'Rain',
    });
  });
});
