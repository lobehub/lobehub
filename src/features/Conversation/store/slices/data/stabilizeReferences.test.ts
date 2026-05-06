import { describe, expect, it } from 'vitest';

import { stabilizeReferences } from './stabilizeReferences';

describe('stabilizeReferences', () => {
  it('returns prev when deeply equal', () => {
    const prev = { a: 1, b: { c: 2 } };
    const next = { a: 1, b: { c: 2 } };
    expect(stabilizeReferences(prev, next)).toBe(prev);
  });

  it('returns next for primitive replacement', () => {
    expect(stabilizeReferences(1, 2)).toBe(2);
    expect(stabilizeReferences('a', 'b')).toBe('b');
  });

  it('preserves unchanged sub-objects when sibling changes', () => {
    const prevChild = { id: 'c1', value: 'same' };
    const prev = { a: prevChild, b: { id: 'b', value: 1 } };
    const next = { a: { id: 'c1', value: 'same' }, b: { id: 'b', value: 2 } };

    const result = stabilizeReferences(prev, next);

    expect(result).not.toBe(prev);
    expect(result.a).toBe(prevChild);
    expect(result.b).not.toBe(prev.b);
    expect(result.b.value).toBe(2);
  });

  it('preserves unchanged array elements when siblings change', () => {
    const stableTool = { id: 't1', args: '{}' };
    const prev = [stableTool, { id: 't2', args: '{"k":1}' }];
    const next = [
      { id: 't1', args: '{}' },
      { id: 't2', args: '{"k":2}' },
    ];

    const result = stabilizeReferences(prev, next);

    expect(result[0]).toBe(stableTool);
    expect(result[1]).not.toBe(prev[1]);
  });

  it('returns next when array length differs', () => {
    const prev = [1, 2, 3];
    const next = [1, 2];
    expect(stabilizeReferences(prev, next)).toEqual(next);
  });

  it('returns next when object keys differ', () => {
    const prev = { a: 1 };
    const next = { a: 1, b: 2 };
    expect(stabilizeReferences(prev, next)).toEqual(next);
  });

  it('returns next for changed non-plain objects', () => {
    const prev = new Date('2026-01-01T00:00:00.000Z');
    const next = new Date('2026-01-02T00:00:00.000Z');

    expect(stabilizeReferences(prev, next)).toBe(next);
  });

  it('handles null and undefined safely', () => {
    expect(stabilizeReferences(null, null)).toBe(null);
    expect(stabilizeReferences(undefined, undefined)).toBe(undefined);
    expect(stabilizeReferences(null, { a: 1 })).toEqual({ a: 1 });
    expect(stabilizeReferences({ a: 1 }, null)).toBe(null);
  });

  it('handles array vs non-array shape change', () => {
    expect(stabilizeReferences([1, 2], { 0: 1, 1: 2 } as any)).toEqual({ 0: 1, 1: 2 });
  });

  it('preserves deep tool tree across streaming-like updates', () => {
    const finishedTool = {
      id: 'tool-finished',
      apiName: 'fetch',
      arguments: '{"url":"https://x"}',
      result: { id: 'r1', content: 'ok' },
    };
    const prev = {
      id: 'msg',
      children: [
        {
          id: 'block',
          content: 'hello',
          tools: [finishedTool, { id: 'tool-streaming', arguments: '{"u' }],
        },
      ],
    };
    const next = {
      id: 'msg',
      children: [
        {
          id: 'block',
          content: 'hello world',
          tools: [{ ...finishedTool }, { id: 'tool-streaming', arguments: '{"url":"https://y"}' }],
        },
      ],
    };

    const result = stabilizeReferences(prev, next);

    // top-level changed because content changed
    expect(result).not.toBe(prev);
    // finished tool reference preserved despite outer message rebuild
    expect(result.children[0].tools[0]).toBe(finishedTool);
    // streaming tool changed
    expect(result.children[0].tools[1]).not.toBe(prev.children[0].tools[1]);
  });
});
