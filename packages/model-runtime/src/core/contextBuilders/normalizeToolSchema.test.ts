import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import { normalizeToolJsonSchema, normalizeToolsParameters } from './normalizeToolSchema';

describe('normalizeToolJsonSchema', () => {
  it('collapses a top-level boolean schema to an empty object', () => {
    expect(normalizeToolJsonSchema(true)).toEqual({});
    expect(normalizeToolJsonSchema(false)).toEqual({});
  });

  it('returns primitives untouched', () => {
    expect(normalizeToolJsonSchema(null)).toBeNull();
    expect(normalizeToolJsonSchema(undefined)).toBeUndefined();
    expect(normalizeToolJsonSchema('foo')).toBe('foo');
  });

  // DeepSeek variant — array property with `items: true`
  it('rewrites `items: true` to an empty object schema', () => {
    const result = normalizeToolJsonSchema({
      properties: {
        sourceIds: { items: true, type: 'array' },
      },
      type: 'object',
    });

    expect(result.properties.sourceIds.items).toEqual({});
    expect(result.properties.sourceIds.type).toBe('array');
  });

  // Gemini variant — array property carrying `items` but missing `type`
  it('backfills `type: array` on a node that carries `items` without a type', () => {
    const result = normalizeToolJsonSchema({
      properties: {
        sourceIds: { items: { type: 'string' } },
      },
      type: 'object',
    });

    expect(result.properties.sourceIds.type).toBe('array');
    expect(result.properties.sourceIds.items).toEqual({ type: 'string' });
  });

  it('does not override an existing array type', () => {
    const result = normalizeToolJsonSchema({
      items: { type: 'number' },
      type: ['array', 'null'],
    });

    expect(result.type).toEqual(['array', 'null']);
  });

  it('normalizes nested items within items (array of arrays)', () => {
    const result = normalizeToolJsonSchema({
      items: { items: true },
      type: 'array',
    });

    expect(result.items.type).toBe('array');
    expect(result.items.items).toEqual({});
  });

  it('recurses into anyOf / oneOf / allOf combinators', () => {
    const result = normalizeToolJsonSchema({
      anyOf: [{ items: true }, { type: 'string' }],
    });

    expect(result.anyOf[0].items).toEqual({});
    expect(result.anyOf[0].type).toBe('array');
    expect(result.anyOf[1]).toEqual({ type: 'string' });
  });

  it('recurses into $defs / definitions', () => {
    const result = normalizeToolJsonSchema({
      $defs: {
        Tag: { items: true },
      },
      type: 'object',
    });

    expect(result.$defs.Tag.items).toEqual({});
    expect(result.$defs.Tag.type).toBe('array');
  });

  it('recurses into prefixItems and object additionalProperties', () => {
    const result = normalizeToolJsonSchema({
      additionalProperties: { items: true },
      prefixItems: [{ items: true }],
      type: 'object',
    });

    expect(result.prefixItems[0].items).toEqual({});
    expect(result.additionalProperties.items).toEqual({});
  });

  it('keeps boolean additionalProperties untouched (a valid, accepted form)', () => {
    expect(normalizeToolJsonSchema({ additionalProperties: false, type: 'object' })).toEqual({
      additionalProperties: false,
      type: 'object',
    });
  });

  it('does not mutate the input schema', () => {
    const input = { properties: { ids: { items: true, type: 'array' } }, type: 'object' };
    const snapshot = JSON.parse(JSON.stringify(input));

    normalizeToolJsonSchema(input);

    expect(input).toEqual(snapshot);
  });
});

describe('normalizeToolsParameters', () => {
  it('returns undefined when no tools are provided', () => {
    expect(normalizeToolsParameters(undefined)).toBeUndefined();
  });

  it('normalizes the parameters of every function tool', () => {
    const tools: OpenAI.ChatCompletionTool[] = [
      {
        function: {
          name: 'reetp14-openalex-mcp____autocomplete____mcp',
          parameters: {
            properties: { sourceIds: { items: true, type: 'array' } },
            type: 'object',
          },
        },
        type: 'function',
      },
    ];

    const result = normalizeToolsParameters(tools)!;

    expect((result[0] as any).function.parameters.properties.sourceIds.items).toEqual({});
  });

  it('leaves tools without parameters untouched', () => {
    const tools: OpenAI.ChatCompletionTool[] = [
      { function: { name: 'noParams' }, type: 'function' },
    ];

    expect(normalizeToolsParameters(tools)).toEqual(tools);
  });
});
