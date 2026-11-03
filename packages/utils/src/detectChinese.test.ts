import { describe, expect, it } from 'vitest';

import { containsChinese } from './detectChinese';

describe('containsChinese', () => {
  it('should return true for text containing Chinese characters', () => {
    expect(containsChinese('你好世界')).toBe(true);
    expect(containsChinese('Hello 世界')).toBe(true);
    expect(containsChinese('测试 test')).toBe(true);
    expect(containsChinese('这是一个测试')).toBe(true);
  });

  it('should return false for text without Chinese characters', () => {
    expect(containsChinese('Hello World')).toBe(false);
    expect(containsChinese('123456')).toBe(false);
    expect(containsChinese('!@#$%^&*()')).toBe(false);
    expect(containsChinese('')).toBe(false);
    expect(containsChinese('English only text')).toBe(false);
  });

  it('should handle mixed content correctly', () => {
    expect(containsChinese('Hello 中国')).toBe(true);
    expect(containsChinese('English and 数字 123')).toBe(true);
    expect(containsChinese('Japanese こんにちは and English')).toBe(false);
    expect(containsChinese('Korean 안녕하세요 and English')).toBe(false);
  });

  it('should detect extended Chinese character ranges', () => {
    // Test CJK Unified Ideographs Extension A (U+3400-U+4DBF)
    expect(containsChinese('㐀㑇㒯')).toBe(true);
    // Test CJK Compatibility Ideographs (U+F900-U+FAFF)
    expect(containsChinese('豈更車')).toBe(true);
    // Test traditional Chinese characters
    expect(containsChinese('繁體中文')).toBe(true);
    expect(containsChinese('學習語言')).toBe(true);
  });
});
