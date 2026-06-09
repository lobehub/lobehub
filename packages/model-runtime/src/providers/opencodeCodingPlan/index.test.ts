// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { LobeOpenCodeCodingPlanAI, sanitizeJsonSchema } from './index';

const provider = ModelProvider.OpenCodeCodingPlan;
const defaultBaseURL = 'https://opencode.ai/zen/go/v1';

describe('LobeOpenCodeCodingPlanAI', () => {
  describe('init', () => {
    it('should correctly initialize with an API key', () => {
      const instance = new LobeOpenCodeCodingPlanAI({ apiKey: 'test_api_key' });
      expect(instance).toBeInstanceOf(LobeOpenCodeCodingPlanAI);
    });
  });
});

describe('sanitizeJsonSchema', () => {
  it('should return non-object values as-is', () => {
    expect(sanitizeJsonSchema(null)).toBeNull();
    expect(sanitizeJsonSchema(undefined)).toBeUndefined();
    expect(sanitizeJsonSchema('string')).toBe('string');
    expect(sanitizeJsonSchema(42)).toBe(42);
  });

  it('should remove null from enum arrays', () => {
    const schema = {
      type: 'string',
      enum: ['heartbeat', 'schedule', null],
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.enum).toEqual(['heartbeat', 'schedule']);
  });

  it('should simplify type: ["string", "null"] to type: "string"', () => {
    const schema = {
      type: ['string', 'null'],
      enum: ['heartbeat', 'schedule', null],
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.type).toBe('string');
    expect(result.enum).toEqual(['heartbeat', 'schedule']);
  });

  it('should keep type: ["string", "number"] as array (no null)', () => {
    const schema = { type: ['string', 'number'] };
    expect(sanitizeJsonSchema(schema).type).toEqual(['string', 'number']);
  });

  it('should drop enum key if all values are null', () => {
    const schema = { type: 'string', enum: [null, null] };
    const result = sanitizeJsonSchema(schema);
    expect(result.enum).toBeUndefined();
  });

  it('should recurse into properties', () => {
    const schema = {
      type: 'object',
      properties: {
        action: {
          type: ['string', 'null'],
          enum: ['create', 'refine', 'consolidate', null],
        },
        name: { type: 'string' },
      },
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.properties.action.enum).toEqual(['create', 'refine', 'consolidate']);
    expect(result.properties.action.type).toBe('string');
    expect(result.properties.name).toEqual({ type: 'string' });
  });

  it('should recurse into allOf/anyOf/oneOf', () => {
    const schema = {
      allOf: [
        { type: 'object', properties: { x: { enum: ['a', null] } } },
        { type: 'object', properties: { y: { enum: ['b', null] } } },
      ],
      anyOf: [
        { enum: ['c', null] },
        { type: ['string', 'null'] },
      ],
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.allOf[0].properties.x.enum).toEqual(['a']);
    expect(result.allOf[1].properties.y.enum).toEqual(['b']);
    expect(result.anyOf[0].enum).toEqual(['c']);
    expect(result.anyOf[1].type).toBe('string');
  });

  it('should recurse into items and prefixItems', () => {
    const schema = {
      type: 'array',
      items: {
        type: 'object',
        properties: { tag: { enum: ['alpha', 'beta', null] } },
      },
      prefixItems: [
        { enum: ['x', null] },
        { enum: ['y', null] },
      ],
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.items.properties.tag.enum).toEqual(['alpha', 'beta']);
    expect(result.prefixItems[0].enum).toEqual(['x']);
    expect(result.prefixItems[1].enum).toEqual(['y']);
  });

  it('should handle deeply nested schemas with $defs and if/then/else', () => {
    const schema = {
      $defs: {
        Foo: {
          type: 'object',
          properties: { status: { enum: ['ok', 'error', null] } },
        },
      },
      if: { properties: { x: { enum: ['a', null] } } },
      then: { properties: { y: { type: ['string', 'null'] } } },
      else: { properties: { z: { enum: ['b', null] } } },
    };
    const result = sanitizeJsonSchema(schema);
    expect(result.$defs.Foo.properties.status.enum).toEqual(['ok', 'error']);
    expect(result.if.properties.x.enum).toEqual(['a']);
    expect(result.then.properties.y.type).toBe('string');
    expect(result.else.properties.z.enum).toEqual(['b']);
  });

  it('should handle schemas without nullable enums (no-op)', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        count: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    expect(sanitizeJsonSchema(schema)).toEqual(schema);
  });
});
