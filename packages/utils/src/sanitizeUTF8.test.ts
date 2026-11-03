import { describe, expect, it } from 'vitest';

import { sanitizeUTF8 } from './sanitizeUTF8';

describe('UTF-8 Sanitization', () => {
  it('should handle null bytes', () => {
    const input = 'test\u0000string';
    expect(sanitizeUTF8(input)).toBe('teststring');
  });

  it('should handle invalid UTF-8 sequences', () => {
    const input = 'test\uD800string'; // 未配对的代理项
    expect(sanitizeUTF8(input)).toBe('teststring');
  });

  it('should handle invalid UTF-8 content', () => {
    const input = '\u0002\u0000\u0000\u0002�{\\"error\\":{\\"code\\":\\"resource_exhausted\\",';
    expect(sanitizeUTF8(input)).toBe('{\\"error\\":{\\"code\\":\\"resource_exhausted\\",');
  });

  it('should preserve valid UTF-8 characters', () => {
    const input = '你好，世界！';
    expect(sanitizeUTF8(input)).toBe('你好，世界！');
  });

  it('should preserve valid emoji and astral-plane characters (paired surrogates)', () => {
    // 😀 = U+1F600, 𝕏 = U+1D54F — both are valid surrogate pairs in UTF-16
    expect(sanitizeUTF8('a😀b')).toBe('a😀b');
    expect(sanitizeUTF8('Hello 😀 世界 𝕏!')).toBe('Hello 😀 世界 𝕏!');
  });

  it('should still strip lone (unpaired) surrogates', () => {
    expect(sanitizeUTF8('a\uD800b')).toBe('ab'); // lone high surrogate
    expect(sanitizeUTF8('a\uDC00b')).toBe('ab'); // lone low surrogate
  });
});
