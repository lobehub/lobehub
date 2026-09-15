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

  // --- regression: text that SPELLS OUT a \u0000 escape must survive ---

  it('should not throw on a string containing a literal \u0000 escape sequence', () => {
    // Real tool results carry this text verbatim: regex character classes,
    // `GROUP_KEY_SEP = "\u0000"`, smali metadata, base64 dumps. The old
    // stringify -> strip -> parse implementation doubled the leading backslash,
    // matched the needle one character late, ate the escape's own backslash and
    // died with `Bad escaped character in JSON at position N` — failing the
    // whole agent operation from the tool-result persist path.
    const state = { content: "key = x.theme + '\\u0000' + x.category" };

    expect(() => sanitizeNullBytes(state)).not.toThrow();
    expect(sanitizeNullBytes(state).content).toBe(state.content);
  });

  it('should preserve a literal \u0000 escape followed by an invalid escape char', () => {
    // The orphan backslash used to land in front of `U`, which is not a legal
    // JSON escape — the exact shape reported from Windows agents.
    const state = { path: 'C:\\u0000Users' };

    expect(sanitizeNullBytes(state).path).toBe('C:\\u0000Users');
  });

  it('should preserve a literal \u0000 escape at the end of a string', () => {
    // The orphan backslash used to swallow the closing quote instead.
    const state = { snippet: 'SEP = "\\u0000"' };

    expect(sanitizeNullBytes(state).snippet).toBe('SEP = "\\u0000"');
  });

  it('should strip real null bytes while leaving literal escape text alone', () => {
    const state = { line: 'a\u0000b, literal: \\u0000' };

    expect(sanitizeNullBytes(state).line).toBe('ab, literal: \\u0000');
  });

  it('should sanitize null bytes in object keys', () => {
    const obj = { ['a\u0000b']: 1 };

    expect(Object.keys(sanitizeNullBytes(obj))).toEqual(['ab']);
  });
});
