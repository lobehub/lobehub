import { describe, expect, it } from 'vitest';

import { openaiGpt4oMiniTTSSchema, openaiTTS1Schema } from '../const/ttsParameters';
import {
  extractTTSDefaultValues,
  TTS_AUDIO_FORMATS,
  TTS_AUDIO_MIME_TYPES,
  TTSModelParamsMetaSchema,
  type TTSModelParamsSchema,
  TTSVoiceSchema,
  validateTTSModelParamsSchema,
  validateTTSParams,
} from './tts';

const fullSchema: TTSModelParamsSchema = {
  emotion: { default: 'neutral', enum: ['neutral', 'happy', 'sad'] },
  format: { default: 'mp3', enum: ['mp3', 'wav', 'pcm'] },
  instructions: { maxLength: 20 },
  pitch: { default: 0, max: 12, min: -12, step: 1 },
  sampleRate: { default: 32_000, enum: [16_000, 24_000, 32_000] },
  speed: { default: 1, max: 2, min: 0.5, step: 0.1 },
  voice: { default: 'female-shaonv' },
  volume: { default: 1, max: 10, min: 0.1 },
};

describe('tts standard-parameters', () => {
  describe('TTSModelParamsMetaSchema', () => {
    it('validates a schema declaring every standard param', () => {
      expect(() => validateTTSModelParamsSchema(fullSchema)).not.toThrow();
    });

    it('accepts an empty schema since every param is optional', () => {
      expect(TTSModelParamsMetaSchema.parse({})).toEqual({});
    });

    it('rejects a format outside the standard list', () => {
      expect(() =>
        TTSModelParamsMetaSchema.parse({ format: { default: 'ogg', enum: ['ogg'] } }),
      ).toThrow();
    });

    it('requires numeric ranges to declare min and max', () => {
      expect(() => TTSModelParamsMetaSchema.parse({ speed: { default: 1 } })).toThrow();
    });

    it('validates the built-in OpenAI schemas', () => {
      expect(() => validateTTSModelParamsSchema(openaiTTS1Schema)).not.toThrow();
      expect(() => validateTTSModelParamsSchema(openaiGpt4oMiniTTSSchema)).not.toThrow();
    });
  });

  describe('extractTTSDefaultValues', () => {
    it('returns the declared defaults without voice', () => {
      expect(extractTTSDefaultValues(fullSchema)).toEqual({
        emotion: 'neutral',
        format: 'mp3',
        instructions: '',
        pitch: 0,
        sampleRate: 32_000,
        speed: 1,
        volume: 1,
      });
    });
  });

  describe('validateTTSParams', () => {
    it('accepts values inside the declared ranges and enums', () => {
      expect(
        validateTTSParams(fullSchema, {
          emotion: 'happy',
          format: 'wav',
          pitch: -3,
          sampleRate: 24_000,
          speed: 1.5,
        }),
      ).toEqual([]);
    });

    it('reports params the model does not declare', () => {
      expect(validateTTSParams(openaiTTS1Schema, { emotion: 'happy', pitch: 2 })).toEqual([
        { key: 'emotion', reason: 'not supported by this model' },
        { key: 'pitch', reason: 'not supported by this model' },
      ]);
    });

    it('reports out-of-range numbers and unknown enum values', () => {
      expect(
        validateTTSParams(fullSchema, { emotion: 'angry', sampleRate: 44_100, speed: 3 }),
      ).toEqual([
        { key: 'emotion', reason: 'must be one of neutral, happy, sad' },
        { key: 'sampleRate', reason: 'must be one of 16000, 24000, 32000' },
        { key: 'speed', reason: 'must be between 0.5 and 2' },
      ]);
    });

    it('reports instructions over the declared max length', () => {
      expect(validateTTSParams(fullSchema, { instructions: 'x'.repeat(21) })).toEqual([
        { key: 'instructions', reason: 'must be at most 20 characters' },
      ]);
    });

    it('ignores undefined values', () => {
      expect(validateTTSParams(openaiTTS1Schema, { emotion: undefined })).toEqual([]);
    });
  });

  describe('voices', () => {
    it('requires id, displayName, language and gender', () => {
      expect(() =>
        TTSVoiceSchema.parse({ displayName: 'Alloy', gender: 'neutral', id: 'alloy' }),
      ).toThrow();
      expect(
        TTSVoiceSchema.parse({
          displayName: 'Alloy',
          gender: 'neutral',
          id: 'alloy',
          language: 'multilingual',
          previewUrl: 'https://example.com/alloy.mp3',
        }),
      ).toMatchObject({ id: 'alloy' });
    });
  });

  it('maps every audio format to a mime type', () => {
    for (const format of TTS_AUDIO_FORMATS) {
      expect(TTS_AUDIO_MIME_TYPES[format]).toMatch(/^audio\//);
    }
  });
});
