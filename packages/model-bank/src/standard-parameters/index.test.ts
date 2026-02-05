import { describe, expect, it } from 'vitest';

import type { ModelParamsSchema, RuntimeImageGenParams } from './index';
import { extractDefaultValues, ModelParamsMetaSchema, validateModelParamsSchema } from './index';

describe('meta-schema', () => {
  describe('ModelParamsMetaSchema', () => {
    it('should validate a complete parameter schema', () => {
      const validSchema: ModelParamsSchema = {
        prompt: { default: 'test prompt' },
        width: { default: 1024, min: 512, max: 2048, step: 64 },
        height: { default: 1024, min: 512, max: 2048, step: 64 },
        steps: { default: 20, min: 1, max: 50 },
        seed: { default: null, min: 0 },
        cfg: { default: 7.5, min: 1, max: 20, step: 0.5 },
        aspectRatio: { default: '1:1', enum: ['1:1', '16:9', '4:3'] },
        size: { default: '1024x1024', enum: ['512x512', '1024x1024', '1536x1536'] },
        imageUrl: { default: null },
        imageUrls: { default: [] },
      };

      expect(() => ModelParamsMetaSchema.parse(validSchema)).not.toThrow();
    });

    it('should validate minimal parameter schema with only prompt', () => {
      const minimalSchema: ModelParamsSchema = {
        prompt: { default: '' },
      };

      expect(() => ModelParamsMetaSchema.parse(minimalSchema)).not.toThrow();
    });

    it('should apply default values for optional properties', () => {
      const schema: ModelParamsSchema = {
        prompt: {},
        width: { default: 1024, min: 512, max: 2048 },
        seed: {},
      };

      const result = ModelParamsMetaSchema.parse(schema);

      expect(result.prompt.default).toBe('');
      expect(result.width?.step).toBe(1);
      expect(result.seed?.default).toBeNull();
      expect(result.seed?.min).toBe(0);
    });

    it('should reject invalid parameter schemas', () => {
      const invalidSchema = {
        prompt: { default: 123 }, // Should be string
        width: { min: 'invalid' }, // Should be number
      };

      expect(() => ModelParamsMetaSchema.parse(invalidSchema)).toThrow();
    });

    it('should handle optional parameters correctly', () => {
      const partialSchema: ModelParamsSchema = {
        prompt: { default: 'test' },
        width: { default: 512, min: 256, max: 1024 },
      };

      const result = ModelParamsMetaSchema.parse(partialSchema);
      expect(result.prompt.default).toBe('test');
      expect(result.width?.default).toBe(512);
      expect(result.height).toBeUndefined();
    });
  });

  describe('validateModelParamsSchema', () => {
    it('should validate correct parameter schema', () => {
      const schema = {
        prompt: { default: 'test' },
        width: { default: 1024, min: 512, max: 2048 },
      };

      expect(() => validateModelParamsSchema(schema)).not.toThrow();
    });

    it('should throw error for invalid parameter schema', () => {
      const invalidSchema = {
        prompt: { default: 123 }, // Invalid type
      };

      expect(() => validateModelParamsSchema(invalidSchema)).toThrow();
    });

    it('should handle unknown properties gracefully', () => {
      const schemaWithExtra = {
        prompt: { default: 'test' },
        unknownParam: { default: 'value' },
      };

      // Should not throw since schema uses passthrough
      expect(() => validateModelParamsSchema(schemaWithExtra)).not.toThrow();
    });
  });

  describe('extractDefaultValues', () => {
    it('should extract default values from parameter schema', () => {
      const schema: ModelParamsSchema = {
        prompt: { default: 'test prompt' },
        width: { default: 1024, min: 512, max: 2048 },
        height: { default: 768, min: 512, max: 2048 },
        steps: { default: 20, min: 1, max: 50 },
        seed: { default: null },
      };

      const result = extractDefaultValues(schema);

      expect(result).toEqual({
        prompt: 'test prompt',
        width: 1024,
        height: 768,
        steps: 20,
        seed: null,
      });
    });

    it('should apply schema defaults for missing properties', () => {
      const schema: ModelParamsSchema = {
        prompt: {},
        width: { default: 1024, min: 512, max: 2048 },
        seed: {},
      };

      const result = extractDefaultValues(schema);

      expect(result.prompt).toBe(''); // Schema default
      expect(result.width).toBe(1024);
      expect(result.seed).toBeNull(); // Schema default
    });

    it('should handle empty schema gracefully', () => {
      const schema: ModelParamsSchema = {
        prompt: { default: '' },
      };

      const result = extractDefaultValues(schema);

      expect(result).toEqual({
        prompt: '',
      });
    });

    it('should preserve all parameter types correctly', () => {
      const schema: ModelParamsSchema = {
        prompt: { default: 'test' },
        width: { default: 1024, min: 512, max: 2048 },
        seed: { default: 12345 },
        cfg: { default: 7.5, min: 1, max: 20, step: 0.5 },
        aspectRatio: { default: '16:9', enum: ['1:1', '16:9', '4:3'] },
        imageUrls: { default: ['test.jpg'] },
        imageUrl: { default: 'test.jpg' },
      };

      const result = extractDefaultValues(schema);

      expect(typeof result.prompt).toBe('string');
      expect(typeof result.width).toBe('number');
      expect(typeof result.seed).toBe('number');
      expect(typeof result.cfg).toBe('number');
      expect(typeof result.aspectRatio).toBe('string');
      expect(Array.isArray(result.imageUrls)).toBe(true);
      expect(typeof result.imageUrl).toBe('string');
    });

    it('should handle null values properly', () => {
      const schema: ModelParamsSchema = {
        prompt: { default: 'test' },
        seed: { default: null },
        imageUrl: { default: null },
      };

      const result = extractDefaultValues(schema);

      expect(result.seed).toBeNull();
      expect(result.imageUrl).toBeNull();
    });
  });

  describe('Type inference', () => {
    it('should infer correct RuntimeImageGenParams type', () => {
      // This is a compile-time test to ensure types are correctly inferred
      const params: RuntimeImageGenParams = {
        prompt: 'test',
        width: 1024,
        height: 768,
        steps: 20,
        seed: null,
        cfg: 7.5,
      };

      expect(params.prompt).toBe('test');
      expect(params.width).toBe(1024);
      expect(params.seed).toBeNull();
    });

    it('should require prompt but make other parameters optional', () => {
      // This test ensures prompt is required while others are optional
      const minimalParams: RuntimeImageGenParams = {
        prompt: 'required prompt',
      };

      expect(minimalParams.prompt).toBe('required prompt');
      expect(minimalParams.width).toBeUndefined();
    });
  });
});
