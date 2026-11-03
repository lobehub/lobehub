import { describe, expect, it } from 'vitest';

import { sanitizeFileName } from './sanitizeFileName';

describe('sanitizeFileName', () => {
  it('should keep alphanumeric characters', () => {
    expect(sanitizeFileName('hello123', 'fb')).toBe('hello123');
  });

  it('should keep CJK characters', () => {
    expect(sanitizeFileName('你好世界', 'fb')).toBe('你好世界');
  });

  it('should keep spaces and hyphens', () => {
    expect(sanitizeFileName('my file-name', 'fb')).toBe('my file-name');
  });

  it('should replace path separators with underscores', () => {
    expect(sanitizeFileName('../../etc/passwd', 'fb')).toBe('______etc_passwd');
  });

  it('should replace special characters with underscores', () => {
    expect(sanitizeFileName('file<name>:with|bad*chars?', 'fb')).toBe('file_name__with_bad_chars_');
  });

  it('should replace control characters', () => {
    expect(sanitizeFileName('file\x00\x1Fname', 'fb')).toBe('file__name');
  });

  it('should trim leading and trailing whitespace after sanitization', () => {
    expect(sanitizeFileName('  hello  ', 'fb')).toBe('hello');
  });

  it('should truncate to default max length of 50', () => {
    const longInput = 'a'.repeat(100);
    expect(sanitizeFileName(longInput, 'fb')).toHaveLength(50);
  });

  it('should truncate to custom max length', () => {
    expect(sanitizeFileName('abcdefghij', 'fb', 5)).toBe('abcde');
  });

  it('should replace path separators but keep underscores', () => {
    // `/` and `\` are replaced with `_`, underscores are kept
    expect(sanitizeFileName('///\\\\', 'fallback')).toBe('_____');
  });

  it('should return fallback for empty input', () => {
    expect(sanitizeFileName('', 'fallback')).toBe('fallback');
  });

  it('should return fallback when input is only whitespace', () => {
    expect(sanitizeFileName('   ', 'fallback')).toBe('fallback');
  });

  it('should handle mixed content with prompt-like input', () => {
    expect(sanitizeFileName('A sunset over the ocean!!! 🌅', 'fb')).toBe(
      'A sunset over the ocean___ __',
    );
  });

  it('should keep underscores from original input', () => {
    expect(sanitizeFileName('my_file_name', 'fb')).toBe('my_file_name');
  });
});
