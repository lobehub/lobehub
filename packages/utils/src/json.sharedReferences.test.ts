import { describe, expect, it } from 'vitest';

import { safeJsonStringify, toJsonSafe } from './json';

describe('JSON serialization of shared references', () => {
  it('preserves repeated objects and arrays which do not form a cycle', () => {
    const shared = { text: 'tool result', tokens: 12n };
    const items = [shared];

    expect(toJsonSafe({ a: items, b: items, c: shared })).toEqual({
      a: [{ text: 'tool result', tokens: '12' }],
      b: [{ text: 'tool result', tokens: '12' }],
      c: { text: 'tool result', tokens: '12' },
    });
  });

  it('marks only ancestor cycles and serializes later aliases completely', () => {
    const child: Record<string, unknown> = { value: 1 };
    child.self = child;

    expect(JSON.parse(safeJsonStringify({ a: child, b: child }))).toEqual({
      a: { value: 1, self: '[Circular]' },
      b: { value: 1, self: '[Circular]' },
    });
  });
});
