import { describe, expect, it } from 'vitest';

import {
  extractMusicDefaultValues,
  MusicModelParamsMetaSchema,
  type MusicModelParamsSchema,
  validateMusicModelParamsSchema,
} from './music';

describe('music standard-parameters', () => {
  it('accepts a schema declaring every standard parameter', () => {
    const fullSchema: MusicModelParamsSchema = {
      autoLyrics: { default: false },
      bitrate: { default: 256_000, enum: [128_000, 256_000] },
      duration: { default: null, max: 360, min: 10 },
      format: { default: 'mp3', enum: ['mp3', 'wav'] },
      instrumental: { default: false },
      lyrics: { default: null, maxLength: 3500 },
      negativeStyle: { default: null },
      prompt: { default: '', maxLength: 2000 },
      referenceAudioUrl: { default: null, maxDuration: 360, minDuration: 6, required: true },
      sampleRate: { default: 44_100, enum: [32_000, 44_100] },
      style: { default: null, maxLength: 1000 },
      title: { default: null, maxLength: 80 },
    };

    expect(() => validateMusicModelParamsSchema(fullSchema)).not.toThrow();
  });

  it('requires only prompt and leaves undeclared parameters out', () => {
    const parsed = MusicModelParamsMetaSchema.parse({ prompt: {} });

    expect(parsed.prompt.default).toBe('');
    expect(Object.keys(parsed)).toEqual(['prompt']);
  });

  it('rejects a schema without prompt', () => {
    expect(() => validateMusicModelParamsSchema({ lyrics: { default: null } })).toThrow();
  });

  it('rejects an unsupported output format', () => {
    expect(() =>
      validateMusicModelParamsSchema({
        format: { default: 'flac', enum: ['flac'] },
        prompt: { default: '' },
      }),
    ).toThrow();
  });

  it('extracts defaults, filling nullable and boolean parameters', () => {
    expect(
      extractMusicDefaultValues({
        instrumental: {},
        lyrics: {},
        prompt: {},
        style: { default: 'lo-fi' },
      }),
    ).toEqual({ instrumental: false, lyrics: null, prompt: '', style: 'lo-fi' });
  });
});
