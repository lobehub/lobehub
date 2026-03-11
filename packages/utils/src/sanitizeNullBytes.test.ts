import { describe, expect, it } from 'vitest';

import { sanitizeNullBytes } from './sanitizeNullBytes';

describe('sanitizeNullBytes', () => {
  it('should return null/undefined as-is', () => {
    expect(sanitizeNullBytes(null)).toBeNull();
    expect(sanitizeNullBytes(undefined)).toBeUndefined();
  });

  it('should return non-string primitives as-is', () => {
    expect(sanitizeNullBytes(42)).toBe(42);
    expect(sanitizeNullBytes(true)).toBe(true);
  });

  // --- string ---

  it('should remove null bytes from strings', () => {
    expect(sanitizeNullBytes('hello\u0000world')).toBe('helloworld');
  });

  it('should handle multiple null bytes in strings', () => {
    expect(sanitizeNullBytes('\u0000a\u0000b\u0000')).toBe('ab');
  });

  it('should preserve valid strings', () => {
    expect(sanitizeNullBytes('montée')).toBe('montée');
  });

  // --- object / jsonb ---

  it('should recover corrupted Unicode \\u0000XX → \\u00XX in objects', () => {
    // Simulate the real bug: "montée" encoded as "mont\u0000e9e" in JSON
    // \u0000 is null byte, followed by "e9" which should have been \u00e9 (é)
    const corrupted = JSON.parse('{"query":"mont\\u0000e9e"}');
    const result = sanitizeNullBytes(corrupted);
    expect(result.query).toBe('montée');
  });

  it('should strip remaining null bytes in objects after recovery', () => {
    const obj = { text: 'a\u0000b', nested: { val: 'x\u0000y' } };
    const result = sanitizeNullBytes(obj);
    expect(result.text).toBe('ab');
    expect(result.nested.val).toBe('xy');
  });

  it('should handle real-world web search state with corrupted Unicode', () => {
    const state = {
      query: 'Auxerre mont\u0000e Ligue 1',
      results: [{ content: 'Some result with null\u0000byte', url: 'https://example.com' }],
    };
    const result = sanitizeNullBytes(state);
    expect(result.query).toBe('Auxerre monte Ligue 1');
    expect(result.results[0].content).toBe('Some result with nullbyte');
    expect(JSON.stringify(result)).not.toContain('\u0000');
  });

  it('should handle objects without null bytes (no-op)', () => {
    const obj = { a: 1, b: 'hello', c: [1, 2, 3] };
    expect(sanitizeNullBytes(obj)).toEqual(obj);
  });

  it('should handle arrays', () => {
    const arr = ['a\u0000b', 'c\u0000d'];
    const result = sanitizeNullBytes(arr);
    expect(result).toEqual(['ab', 'cd']);
  });
});
