import { describe, expect, it } from 'vitest';

import {
  extractVideoDefaultValues,
  MAX_VIDEO_SEED,
  PRESET_VIDEO_ASPECT_RATIOS,
  PRESET_VIDEO_RESOLUTIONS,
  type RuntimeVideoGenParams,
  validateVideoModelParamsSchema,
  VideoModelParamsMetaSchema,
  type VideoModelParamsSchema,
} from './video';

describe('video standard-parameters', () => {
  describe('VideoModelParamsMetaSchema', () => {
    it('should validate a complete schema', () => {
      const fullSchema: VideoModelParamsSchema = {
        aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1'] },
        cameraFixed: { default: false },
        duration: { default: 5, max: 10, min: 1, step: 1 },
        endImageUrl: { default: null },
        generateAudio: { default: true },
        imageUrl: { default: null },
        prompt: { default: '' },
        resolution: { default: '720p', enum: ['480p', '720p', '1080p'] },
        seed: { default: null },
      };

      expect(() => VideoModelParamsMetaSchema.parse(fullSchema)).not.toThrow();
    });

    it('should validate minimal schema with only prompt', () => {
      const minimalSchema: VideoModelParamsSchema = {
        prompt: { default: '' },
      };

      expect(() => VideoModelParamsMetaSchema.parse(minimalSchema)).not.toThrow();
    });

    it('should apply default values correctly', () => {
      const schema: VideoModelParamsSchema = {
        cameraFixed: {},
        generateAudio: {},
        prompt: {},
        seed: {},
      };

      const result = VideoModelParamsMetaSchema.parse(schema);

      expect(result.prompt.default).toBe('');
      expect(result.cameraFixed?.default).toBe(false);
      expect(result.generateAudio?.default).toBe(true);
      expect(result.seed?.default).toBeNull();
      expect(result.seed?.max).toBe(MAX_VIDEO_SEED);
      expect(result.seed?.min).toBe(-1);
    });

    it('should reject invalid types', () => {
      const invalidSchema = {
        prompt: { default: 123 }, // Should be string
      };

      expect(() => VideoModelParamsMetaSchema.parse(invalidSchema)).toThrow();
    });
  });

  describe('validateVideoModelParamsSchema', () => {
    it('should validate correct schema', () => {
      const schema: VideoModelParamsSchema = {
        prompt: { default: 'test' },
      };

      expect(() => validateVideoModelParamsSchema(schema)).not.toThrow();
    });

    it('should throw for invalid schema', () => {
      const invalidSchema = {
        prompt: { default: 42 },
      };

      expect(() => validateVideoModelParamsSchema(invalidSchema)).toThrow();
    });
  });

  describe('extractVideoDefaultValues', () => {
    it('should extract all default values from complete schema', () => {
      const schema: VideoModelParamsSchema = {
        aspectRatio: { default: '16:9', enum: ['16:9', '9:16'] },
        cameraFixed: { default: true },
        duration: { default: 5, max: 10, min: 1 },
        generateAudio: { default: false },
        prompt: { default: 'test prompt' },
        resolution: { default: '1080p', enum: ['720p', '1080p'] },
        seed: { default: 42 },
      };

      const result = extractVideoDefaultValues(schema);

      expect(result.prompt).toBe('test prompt');
      expect(result.aspectRatio).toBe('16:9');
      expect(result.cameraFixed).toBe(true);
      expect(result.duration).toBe(5);
      expect(result.generateAudio).toBe(false);
      expect(result.resolution).toBe('1080p');
      expect(result.seed).toBe(42);
    });

    it('should extract defaults from minimal schema', () => {
      const schema: VideoModelParamsSchema = {
        prompt: {},
      };

      const result = extractVideoDefaultValues(schema);

      expect(result.prompt).toBe('');
    });

    it('should extract null defaults for imageUrl and endImageUrl', () => {
      const schema: VideoModelParamsSchema = {
        endImageUrl: { default: null },
        imageUrl: { default: null },
        prompt: { default: 'test' },
      };

      const result = extractVideoDefaultValues(schema);

      expect(result.imageUrl).toBeNull();
      expect(result.endImageUrl).toBeNull();
    });

    it('should preserve correct types for each field', () => {
      const schema: VideoModelParamsSchema = {
        cameraFixed: { default: false },
        generateAudio: { default: true },
        prompt: { default: 'hello' },
        seed: { default: null },
      };

      const result = extractVideoDefaultValues(schema);

      expect(typeof result.prompt).toBe('string');
      expect(typeof result.cameraFixed).toBe('boolean');
      expect(typeof result.generateAudio).toBe('boolean');
      expect(result.seed).toBeNull();
    });
  });

  describe('constants', () => {
    it('MAX_VIDEO_SEED should equal 2^32 - 1', () => {
      expect(MAX_VIDEO_SEED).toBe(4294967295);
    });

    it('PRESET_VIDEO_ASPECT_RATIOS should contain standard ratios', () => {
      expect(PRESET_VIDEO_ASPECT_RATIOS).toContain('16:9');
      expect(PRESET_VIDEO_ASPECT_RATIOS).toContain('9:16');
      expect(PRESET_VIDEO_ASPECT_RATIOS).toContain('1:1');
    });

    it('PRESET_VIDEO_RESOLUTIONS should contain standard resolutions', () => {
      expect(PRESET_VIDEO_RESOLUTIONS).toContain('480p');
      expect(PRESET_VIDEO_RESOLUTIONS).toContain('720p');
      expect(PRESET_VIDEO_RESOLUTIONS).toContain('1080p');
    });
  });

  describe('type inference', () => {
    it('RuntimeVideoGenParams should require prompt and make others optional', () => {
      const params: RuntimeVideoGenParams = {
        prompt: 'required prompt',
      };

      expect(params.prompt).toBe('required prompt');
      expect(params.cameraFixed).toBeUndefined();
      expect(params.generateAudio).toBeUndefined();
      expect(params.seed).toBeUndefined();
    });
  });
});
