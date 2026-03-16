import { describe, expect, it } from 'vitest';

import { sanitizeBm25Query } from './bm25';

describe('sanitizeBm25Query', () => {
  it('should join multiple words with AND', () => {
    expect(sanitizeBm25Query('hello world')).toBe('hello AND world');
  });

  it('should return single word as-is', () => {
    expect(sanitizeBm25Query('hello')).toBe('hello');
  });

  it('should escape tantivy special characters', () => {
    expect(sanitizeBm25Query('hello+world')).toBe('hello\\+world');
    expect(sanitizeBm25Query('a-b')).toBe('a AND b');
    expect(sanitizeBm25Query('a&b|c')).toBe('a\\&b\\|c');
    expect(sanitizeBm25Query('a &b| c')).toBe('a AND \\&b\\| AND c');
    expect(sanitizeBm25Query('test!')).toBe('test\\!');
    expect(sanitizeBm25Query('(group)')).toBe('\\(group\\)');
    expect(sanitizeBm25Query('{curly}')).toBe('\\{curly\\}');
    expect(sanitizeBm25Query('[bracket]')).toBe('\\[bracket\\]');
    expect(sanitizeBm25Query('a^b')).toBe('a\\^b');
    expect(sanitizeBm25Query('"quoted"')).toBe('\\"quoted\\"');
    expect(sanitizeBm25Query('~fuzzy')).toBe('\\~fuzzy');
    expect(sanitizeBm25Query('wild*card')).toBe('wild\\*card');
    expect(sanitizeBm25Query('single?char')).toBe('single\\?char');
    expect(sanitizeBm25Query('field:value')).toBe('field\\:value');
    expect(sanitizeBm25Query('back\\slash')).toBe('back\\\\slash');
    expect(sanitizeBm25Query('a/b')).toBe('a\\/b');
  });

  it('should escape multiple special characters and join with AND', () => {
    expect(sanitizeBm25Query('(a+b) & c!')).toBe('\\(a\\+b\\) AND \\& AND c\\!');
    expect(sanitizeBm25Query('react-component')).toBe('react AND component');
  });

  it('should trim whitespace', () => {
    expect(sanitizeBm25Query('  hello  ')).toBe('hello');
    expect(sanitizeBm25Query('  hello world  ')).toBe('hello AND world');
  });

  it('should throw on empty string', () => {
    expect(() => sanitizeBm25Query('')).toThrow('Query is empty after sanitization');
  });

  it('should throw on whitespace-only string', () => {
    expect(() => sanitizeBm25Query('   ')).toThrow('Query is empty after sanitization');
  });

  it('should handle CJK characters', () => {
    expect(sanitizeBm25Query('你好世界')).toBe('你好世界');
    expect(sanitizeBm25Query('こんにちは')).toBe('こんにちは');
  });
});
