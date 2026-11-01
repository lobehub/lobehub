/* eslint-disable unicorn/no-thenable -- then is a JSON Schema keyword, not a promise method. */
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';

import { buildAnthropicTools } from '../core/contextBuilders/anthropic';
import { normalizeAnthropicToolSchema } from './anthropicToolSchema';

const ajv = new Ajv({ strict: false });

describe('normalizeAnthropicToolSchema', () => {
  it('preserves mutually exclusive argument branches, intersections, root not and nested schemas', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        arguments: { type: 'object' },
        id: { type: 'integer' },
      },
      additionalProperties: false,
      oneOf: [{ required: ['name', 'arguments'] }, { required: ['id'] }],
      anyOf: [{ properties: { name: { enum: ['read', 'write'] } } }, { required: ['id'] }],
      allOf: [{ not: { required: ['forbidden'] } }],
      not: { properties: { id: { const: -1 } }, required: ['id'] },
    };
    const original = structuredClone(schema);
    const normalized = normalizeAnthropicToolSchema(schema)!;
    expect(normalized).not.toHaveProperty('oneOf');
    expect(normalized).not.toHaveProperty('anyOf');
    expect(normalized).not.toHaveProperty('allOf');
    expect(normalized.properties).toEqual(schema.properties);
    const before = ajv.compile(schema);
    const after = ajv.compile(normalized);
    for (const input of [
      {},
      { name: 'read' },
      { name: 'read', arguments: {} },
      { id: 1 },
      { id: -1 },
      { id: 1, name: 'read', arguments: {} },
      { name: 'other', arguments: {} },
      { id: 2, extra: true },
      { id: '1' },
    ]) {
      expect(after(input), JSON.stringify(input)).toBe(before(input));
    }
    expect(schema).toEqual(original);
    expect(normalizeAnthropicToolSchema(normalized)).toBe(normalized);
  });

  it('keeps references to moved constraints and unmoved definitions valid', () => {
    const schema = {
      type: 'object',
      definitions: { text: { type: 'string' } },
      properties: {
        name: { $ref: '#/definitions/text' },
        copy: { $ref: '#/oneOf/0/properties/name' },
      },
      oneOf: [
        { required: ['name'], properties: { name: { enum: ['read'] } } },
        { required: ['id'] },
      ],
    };
    const normalized = normalizeAnthropicToolSchema(schema)!;
    const before = ajv.compile(schema);
    const after = ajv.compile(normalized);
    for (const value of [
      { name: 'read', copy: 'read' },
      { name: 'read', copy: 'write' },
      { id: 1 },
      {},
    ])
      expect(after(value)).toBe(before(value));
    expect(normalized.properties).toMatchObject({
      copy: { $ref: '#/if/oneOf/0/properties/name' },
    });
  });

  it('retains evaluated-property annotations and an existing conditional', () => {
    const schema = {
      type: 'object',
      allOf: [{ properties: { path: { type: 'string' } } }],
      if: { required: ['path'] },
      then: { properties: { mode: { const: 'read' } } },
      else: { required: ['missing'] },
      unevaluatedProperties: false,
    };
    const validator = new Ajv2020({ strict: false });
    const before = validator.compile(schema);
    const after = validator.compile(normalizeAnthropicToolSchema(schema)!);
    for (const input of [
      { path: 'file.txt' },
      { path: 'file.txt', mode: 'read' },
      { path: 'file.txt', mode: 'write' },
      { path: 'file.txt', extra: true },
      {},
    ])
      expect(after(input)).toBe(before(input));
  });

  it('does not rewrite literal data that happens to contain reference-shaped keys', () => {
    const value = { $ref: '#/allOf/0' };
    const schema = {
      type: 'object',
      properties: { data: { const: value, default: value, examples: [value] } },
      allOf: [{ required: ['data'] }],
    };
    const normalized = normalizeAnthropicToolSchema(schema)!;
    expect(normalized.properties).toEqual(schema.properties);
    expect(ajv.compile(normalized)({ data: value })).toBe(true);
  });

  it('applies to native Anthropic tools without changing ordinary schemas', () => {
    const schema = { type: 'object', properties: { path: { type: 'string' } } };
    expect(normalizeAnthropicToolSchema(schema)).toBe(schema);
    const tools = buildAnthropicTools([
      {
        type: 'function',
        function: { name: 'use_tool', parameters: { ...schema, oneOf: [{ required: ['path'] }] } },
      },
    ]);
    expect(tools?.[0].input_schema).not.toHaveProperty('oneOf');
    expect(tools?.[0].input_schema).toMatchObject({
      if: { oneOf: [{ required: ['path'] }] },
      then: true,
      else: false,
    });
  });
});
