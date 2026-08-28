import { describe, expect, it } from 'vitest';

import { safeJsonStringify, toJsonSafe } from './json';

describe('json utilities', () => {
  it('stringifies bigint and circular references', () => {
    const value: Record<string, unknown> = { count: 1n };
    value.self = value;

    expect(safeJsonStringify(value)).toBe('{"count":"1","self":"[Circular]"}');
  });

  it('converts unknown values to plain JSON-safe data', () => {
    expect(
      toJsonSafe({
        dropped: undefined,
        items: [undefined, () => {}, Symbol('value'), Number.NaN, Number.POSITIVE_INFINITY],
        nested: { count: 1n },
      }),
    ).toEqual({
      items: [null, null, null, null, null],
      nested: { count: '1' },
    });
    expect(toJsonSafe(undefined)).toBeNull();
  });

  it('returns a JSON-safe fallback when serialization fails', () => {
    const value = {};
    Object.defineProperty(value, 'broken', {
      enumerable: true,
      get: () => {
        throw new Error('broken getter');
      },
    });

    expect(toJsonSafe(value)).toEqual({
      message: 'Failed to serialize JSON value',
      name: 'JsonSerializationFailure',
    });
  });
});
