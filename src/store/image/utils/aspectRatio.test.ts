import { type ModelParamsSchema } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { calculateInitialAspectRatio, supportsVirtualAspectRatio } from './aspectRatio';

// Test data fixtures
const createBaseSchema = (overrides: Partial<ModelParamsSchema> = {}): ModelParamsSchema => ({
  prompt: { default: '' },
  ...overrides,
});

const createDimensionSchema = (overrides: Partial<ModelParamsSchema> = {}): ModelParamsSchema =>
  createBaseSchema({
    width: { default: 512, min: 256, max: 2048 },
    height: { default: 512, min: 256, max: 2048 },
    ...overrides,
  });

const createDefaultValues = (values: Record<string, any> = {}) => ({
  prompt: '',
  ...values,
});

describe('aspectRatio utils', () => {
  describe('calculateInitialAspectRatio', () => {
    it('should return null when native aspect controls are present', () => {
      // Models with native aspectRatio parameter
      const aspectRatioSchema = createBaseSchema({
        aspectRatio: { default: '1:1', enum: ['1:1', '16:9', '4:3'] },
      });
      const aspectRatioValues = createDefaultValues({ aspectRatio: '1:1' });

      expect(calculateInitialAspectRatio(aspectRatioSchema, aspectRatioValues)).toBeNull();

      // Models with native size parameter
      const sizeSchema = createBaseSchema({
        size: { default: '1024x1024', enum: ['512x512', '1024x1024', '1536x1536'] },
      });
      const sizeValues = createDefaultValues({ size: '1024x1024' });

      expect(calculateInitialAspectRatio(sizeSchema, sizeValues)).toBeNull();
    });

    it('should return null when width or height parameters are missing', () => {
      const schemaWithoutWidth = createBaseSchema({
        height: { default: 512, min: 256, max: 2048 },
      });
      const valuesWithoutWidth = createDefaultValues({ height: 512 });

      expect(calculateInitialAspectRatio(schemaWithoutWidth, valuesWithoutWidth)).toBeNull();

      const schemaWithoutHeight = createBaseSchema({
        width: { default: 512, min: 256, max: 2048 },
      });
      const valuesWithoutHeight = createDefaultValues({ width: 512 });

      expect(calculateInitialAspectRatio(schemaWithoutHeight, valuesWithoutHeight)).toBeNull();
    });

    it('should calculate aspect ratio from width and height values', () => {
      const schema = createDimensionSchema({
        width: { default: 1024, min: 256, max: 2048 },
        height: { default: 768, min: 256, max: 2048 },
      });
      const values = createDefaultValues({ width: 1024, height: 768 });

      expect(calculateInitialAspectRatio(schema, values)).toBe('1024:768');
    });

    it('should handle square dimensions correctly', () => {
      const schema = createDimensionSchema();
      const values = createDefaultValues({ width: 512, height: 512 });

      expect(calculateInitialAspectRatio(schema, values)).toBe('512:512');
    });

    it('should return fallback ratio for invalid dimension values', () => {
      const schema = createDimensionSchema();

      // Invalid values should fallback to 1:1
      const testCases = [
        { width: NaN, height: NaN },
        { width: 0, height: 512 },
        { width: -512, height: 512 },
        { height: 512 }, // missing width
        { width: 512 }, // missing height
      ];

      testCases.forEach((testCase) => {
        const values = createDefaultValues(testCase);
        expect(calculateInitialAspectRatio(schema, values)).toBe('1:1');
      });
    });
  });

  describe('supportsVirtualAspectRatio', () => {
    it('should return true for models with width/height but no native aspect controls', () => {
      const schema = createDimensionSchema();

      expect(supportsVirtualAspectRatio(schema)).toBe(true);
    });

    it('should return false when native aspect controls are present', () => {
      // Schema with native aspectRatio parameter
      const aspectRatioSchema = createDimensionSchema({
        aspectRatio: { default: '1:1', enum: ['1:1', '16:9', '4:3'] },
      });

      expect(supportsVirtualAspectRatio(aspectRatioSchema)).toBe(false);

      // Schema with native size parameter
      const sizeSchema = createDimensionSchema({
        size: { default: '1024x1024', enum: ['512x512', '1024x1024', '1536x1536'] },
      });

      expect(supportsVirtualAspectRatio(sizeSchema)).toBe(false);

      // Schema with both aspectRatio and size parameters
      const bothSchema = createDimensionSchema({
        aspectRatio: { default: '1:1', enum: ['1:1', '16:9', '4:3'] },
        size: { default: '1024x1024', enum: ['512x512', '1024x1024', '1536x1536'] },
      });

      expect(supportsVirtualAspectRatio(bothSchema)).toBe(false);
    });

    it('should return false when required dimension parameters are missing', () => {
      // Missing width parameter
      const schemaWithoutWidth = createBaseSchema({
        height: { default: 512, min: 256, max: 2048 },
      });

      expect(supportsVirtualAspectRatio(schemaWithoutWidth)).toBe(false);

      // Missing height parameter
      const schemaWithoutHeight = createBaseSchema({
        width: { default: 512, min: 256, max: 2048 },
      });

      expect(supportsVirtualAspectRatio(schemaWithoutHeight)).toBe(false);

      // Missing both width and height parameters
      const emptySchema = createBaseSchema();

      expect(supportsVirtualAspectRatio(emptySchema)).toBe(false);
    });
  });
});
