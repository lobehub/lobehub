// @vitest-environment node
import { Type as SchemaType } from '@google/genai';
import { describe, expect, it } from 'vitest';

import { convertOpenAISchemaToGoogleSchema } from './generateObject';

// Regression: `anyOf` was dropped and nullable type arrays fell back to STRING,
// so Gemini returned numbers as strings (e.g. "1" instead of 1).
describe('convertOpenAISchemaToGoogleSchema nullable schemas', () => {
  it('should convert a nullable anyOf to the non-null type with nullable', () => {
    const result = convertOpenAISchemaToGoogleSchema({
      name: 'test',
      schema: {
        properties: {
          code: { anyOf: [{ enum: ['c0', 'c1'], type: 'string' }, { type: 'null' }] },
          value: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'A number' },
        },
        required: ['code', 'value'],
        type: 'object',
      },
    });

    expect(result).toEqual({
      properties: {
        code: { enum: ['c0', 'c1'], nullable: true, type: SchemaType.STRING },
        value: { description: 'A number', nullable: true, type: SchemaType.NUMBER },
      },
      required: ['code', 'value'],
      type: SchemaType.OBJECT,
    });
  });

  it('should convert a nullable type array to the non-null type with nullable', () => {
    const result = convertOpenAISchemaToGoogleSchema({
      name: 'test',
      schema: {
        properties: { count: { type: ['integer', 'null'] } },
        type: 'object',
      },
    });

    expect(result.properties.count).toEqual({ nullable: true, type: SchemaType.INTEGER });
  });
});
