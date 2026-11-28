import { describe, expect, it } from 'vitest';

import type { ChatCompletionTool } from '../../../types';
import { convertChatCompletionToolToResponseTool } from './tools';

const tool = (parameters: Record<string, any>, extra: Record<string, unknown> = {}) =>
  ({
    function: { description: 'test tool', name: 'test____tool', parameters, ...extra },
    type: 'function',
  }) as ChatCompletionTool;

/** The shape of Agent Documents `modifyNodes`: a union of operation variants. */
const modifyNodesParameters = {
  properties: {
    id: { type: 'string' },
    operations: {
      items: {
        oneOf: [
          {
            properties: {
              action: { const: 'insert', type: 'string' },
              beforeId: { type: 'string' },
              litexml: { type: 'string' },
            },
            required: ['action', 'beforeId', 'litexml'],
            type: 'object',
          },
          {
            properties: {
              action: { const: 'modify', type: 'string' },
              litexml: {
                oneOf: [{ type: 'string' }, { items: { type: 'string' }, type: 'array' }],
              },
            },
            required: ['action', 'litexml'],
            type: 'object',
          },
        ],
      },
      minItems: 1,
      type: 'array',
    },
  },
  required: ['id', 'operations'],
  type: 'object',
};

describe('convertChatCompletionToolToResponseTool', () => {
  it('keeps the exact serialization of a schema strict mode can express', () => {
    const parameters = {
      properties: {
        mode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        query: { type: 'string' },
      },
      required: ['query'],
      type: 'object',
    };

    const converted = convertChatCompletionToolToResponseTool(tool(parameters));

    expect(converted).toEqual({
      description: 'test tool',
      name: 'test____tool',
      parameters,
      type: 'function',
    });
    expect(converted).not.toHaveProperty('strict');
  });

  it('declares a union schema such as modifyNodes non-strict', () => {
    expect(convertChatCompletionToolToResponseTool(tool(modifyNodesParameters))).toEqual({
      description: 'test tool',
      name: 'test____tool',
      parameters: modifyNodesParameters,
      strict: false,
      type: 'function',
    });
  });

  it.each([
    ['a property', { properties: { value: { oneOf: [{ type: 'string' }, { type: 'number' }] } } }],
    [
      'array items',
      { properties: { list: { items: { allOf: [{ type: 'string' }] }, type: 'array' } } },
    ],
    ['a definition', { $defs: { node: { not: { type: 'null' } } }, properties: {} }],
    [
      'an anyOf branch',
      { properties: { value: { anyOf: [{ if: { type: 'string' } }, { type: 'null' }] } } },
    ],
    ['the root', { oneOf: [{ required: ['a'] }, { required: ['b'] }], properties: {} }],
  ])('finds an unsupported keyword nested in %s', (_, parameters) => {
    expect(
      convertChatCompletionToolToResponseTool(tool({ type: 'object', ...parameters })),
    ).toMatchObject({ strict: false });
  });

  it('treats property names and enum values as data, not keywords', () => {
    const parameters = {
      properties: {
        not: { type: 'boolean' },
        shape: { const: { oneOf: [] }, type: 'object' },
        variant: { enum: ['oneOf', 'allOf'], type: 'string' },
      },
      type: 'object',
    };

    expect(convertChatCompletionToolToResponseTool(tool(parameters))).not.toHaveProperty('strict');
  });

  it('keeps a strict flag the caller set', () => {
    expect(
      convertChatCompletionToolToResponseTool(tool(modifyNodesParameters, { strict: true })),
    ).toMatchObject({ strict: true });
    expect(
      convertChatCompletionToolToResponseTool(tool({ type: 'object' }, { strict: false })),
    ).toMatchObject({ strict: false });
  });

  it('passes a native tool through', () => {
    expect(
      convertChatCompletionToolToResponseTool({
        type: 'web_search',
      } as unknown as ChatCompletionTool),
    ).toEqual({ type: 'web_search' });
  });

  it('leaves a tool without parameters alone', () => {
    expect(
      convertChatCompletionToolToResponseTool({
        function: { name: 'ping' },
        type: 'function',
      }),
    ).toEqual({ name: 'ping', type: 'function' });
  });
});
