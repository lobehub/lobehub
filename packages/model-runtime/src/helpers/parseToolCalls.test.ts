import { describe, expect, it } from 'vitest';

import { parseToolCalls } from './parseToolCalls';

describe('parseToolCalls', () => {
  it('should create add new item', () => {
    const chunk = [
      { index: 0, id: '1', type: 'function', function: { name: 'func', arguments: '' } },
    ];

    const result = parseToolCalls([], chunk);
    expect(result).toEqual([
      { id: '1', type: 'function', function: { name: 'func', arguments: '' } },
    ]);
  });

  it('should update arguments if there is a toolCall', () => {
    const origin = [{ id: '1', type: 'function', function: { name: 'func', arguments: '' } }];

    const chunk1 = [{ index: 0, function: { arguments: '{"lo' } }];

    const result1 = parseToolCalls(origin, chunk1);
    expect(result1).toEqual([
      { id: '1', type: 'function', function: { name: 'func', arguments: '{"lo' } },
    ]);

    const chunk2 = [{ index: 0, function: { arguments: 'cation\\": \\"Hangzhou\\"}' } }];
    const result2 = parseToolCalls(result1, chunk2);

    expect(result2).toEqual([
      {
        id: '1',
        type: 'function',
        function: { name: 'func', arguments: '{"location\\": \\"Hangzhou\\"}' },
      },
    ]);
  });

  it('should add a new tool call if the index is different', () => {
    const origin = [
      {
        id: '1',
        type: 'function',
        function: { name: 'func', arguments: '{"location\\": \\"Hangzhou\\"}' },
      },
    ];

    const chunk = [
      {
        index: 1,
        id: '2',
        type: 'function',
        function: { name: 'func', arguments: '' },
      },
    ];

    const result1 = parseToolCalls(origin, chunk);
    expect(result1).toEqual([
      {
        id: '1',
        type: 'function',
        function: { name: 'func', arguments: '{"location\\": \\"Hangzhou\\"}' },
      },
      { id: '2', type: 'function', function: { name: 'func', arguments: '' } },
    ]);
  });

  it('should update correct arguments if there are multi tool calls', () => {
    const origin = [
      {
        id: '1',
        type: 'function',
        function: { name: 'func', arguments: '{"location\\": \\"Hangzhou\\"}' },
      },
      { id: '2', type: 'function', function: { name: 'func', arguments: '' } },
    ];

    const chunk = [{ index: 1, function: { arguments: '{"location\\": \\"Beijing\\"}' } }];

    const result1 = parseToolCalls(origin, chunk);
    expect(result1).toEqual([
      {
        id: '1',
        type: 'function',
        function: { name: 'func', arguments: '{"location\\": \\"Hangzhou\\"}' },
      },
      {
        id: '2',
        type: 'function',
        function: { name: 'func', arguments: '{"location\\": \\"Beijing\\"}' },
      },
    ]);
  });

  it('should handle parallel tool calls with same index but different ids (Gemini behavior)', () => {
    // This tests the scenario where Gemini sends multiple tool calls in separate chunks
    // with the same index: 0 but different ids
    const origin = [
      {
        id: 'get_temperature_0_abc123',
        type: 'function',
        function: { name: 'get_temperature', arguments: '{"location":"Paris"}' },
      },
    ];

    // Second tool call comes with same index: 0 but different id
    const chunk = [
      {
        index: 0,
        id: 'get_temperature_0_def456',
        type: 'function',
        function: { name: 'get_temperature', arguments: '{"location":"London"}' },
      },
    ];

    const result = parseToolCalls(origin, chunk);

    // Should create a new tool call instead of concatenating arguments
    expect(result).toEqual([
      {
        id: 'get_temperature_0_abc123',
        type: 'function',
        function: { name: 'get_temperature', arguments: '{"location":"Paris"}' },
      },
      {
        id: 'get_temperature_0_def456',
        type: 'function',
        function: { name: 'get_temperature', arguments: '{"location":"London"}' },
      },
    ]);

    // Verify arguments are NOT concatenated (the bug we're fixing)
    expect(result[0].function.arguments).not.toContain('London');
    expect(result[1].function.arguments).not.toContain('Paris');
  });

  it('should merge arguments when same id appears in subsequent chunks', () => {
    const origin = [
      {
        id: 'tool_1',
        type: 'function',
        function: { name: 'func', arguments: '{"ke' },
      },
    ];

    // Same id in subsequent chunk - should merge arguments
    const chunk = [
      {
        index: 0,
        id: 'tool_1',
        function: { arguments: 'y":"value"}' },
      },
    ];

    const result = parseToolCalls(origin, chunk);

    expect(result).toEqual([
      {
        id: 'tool_1',
        type: 'function',
        function: { name: 'func', arguments: '{"key":"value"}' },
      },
    ]);
  });

  it('should throw error if incomplete tool calls data', () => {
    const origin = [
      {
        id: '1',
        type: 'function',
        function: { name: 'func', arguments: '{"location\\": \\"Hangzhou\\"}' },
      },
    ];

    const chunk = [{ index: 1, id: '2', type: 'function' }];

    try {
      parseToolCalls(origin, chunk as any);
    } catch (e) {
      expect((e as any).issues).toMatchObject([
        {
          code: 'invalid_type',
          expected: 'object',
          received: 'undefined',
          path: ['function'],
          message: 'Required',
        },
      ]);
    }
  });
});
