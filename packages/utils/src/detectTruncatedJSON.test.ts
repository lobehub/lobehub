import { describe, expect, it } from 'vitest';

import { detectTruncatedJSON } from './detectTruncatedJSON';

describe('detectTruncatedJSON', () => {
  it('returns null for a balanced object', () => {
    expect(detectTruncatedJSON('{"a": 1}')).toBeNull();
  });

  it('returns null for a balanced nested structure', () => {
    expect(detectTruncatedJSON('{"a": {"b": [1, 2]}}')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectTruncatedJSON('')).toBeNull();
  });

  it('flags an object with an unclosed brace (typical LLM cutoff)', () => {
    const truncated = '{"title": "foo", "description": "bar", "type": "report"';
    expect(detectTruncatedJSON(truncated)).toMatch(/unclosed '\{'/);
  });

  it('flags an unterminated string value', () => {
    const truncated = '{"title": "foo", "content": "this got cut';
    expect(detectTruncatedJSON(truncated)).toBe('unterminated string');
  });

  it('flags an unclosed array', () => {
    const truncated = '[1, 2, 3';
    expect(detectTruncatedJSON(truncated)).toMatch(/unclosed '\['/);
  });

  it('flags structure with both unclosed braces and brackets', () => {
    const truncated = '{"items": [1, 2, 3';
    // Any of the unclosed-bracket/brace reasons is acceptable — both are present.
    expect(detectTruncatedJSON(truncated)).toMatch(/unclosed/);
  });

  it('returns null for malformed-but-balanced JSON (not a truncation signal)', () => {
    // invalid JSON but brackets balanced — should NOT be flagged as truncated
    expect(detectTruncatedJSON('{name: "foo"}')).toBeNull();
  });

  it('ignores braces and quotes inside string values', () => {
    expect(detectTruncatedJSON('{"code": "if (a) { return \\"x\\"; }"}')).toBeNull();
  });

  it('flags deeply nested object truncation', () => {
    const truncated = '{"a": {"b": {"c": "d"';
    expect(detectTruncatedJSON(truncated)).toMatch(/unclosed '\{'/);
  });

  it('flags truncation mid-string inside nested objects', () => {
    const truncated = '{"a": {"b": {"c": "still writing';
    expect(detectTruncatedJSON(truncated)).toBe('unterminated string');
  });
});
