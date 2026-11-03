import { describe, expect, it } from 'vitest';

import { calculateWeightedLength, truncateByWeightedLength } from './textLength';

describe('textLength utilities', () => {
  describe('calculateWeightedLength', () => {
    it('should calculate length for pure English text', () => {
      expect(calculateWeightedLength('Hello World')).toBe(11);
    });

    it('should calculate weighted length for pure CJK text', () => {
      // Chinese characters with default weight of 2
      expect(calculateWeightedLength('你好世界')).toBe(8);
    });

    it('should calculate weighted length for Japanese text', () => {
      // Hiragana and Katakana
      expect(calculateWeightedLength('こんにちは')).toBe(10);
      expect(calculateWeightedLength('カタカナ')).toBe(8);
    });

    it('should calculate weighted length for Korean text', () => {
      expect(calculateWeightedLength('안녕하세요')).toBe(10);
    });

    it('should calculate weighted length for mixed text', () => {
      // "Hello 世界" = 5 (Hello) + 1 (space) + 4 (世界) = 10
      expect(calculateWeightedLength('Hello 世界')).toBe(10);
    });

    it('should handle custom CJK weight', () => {
      expect(calculateWeightedLength('你好', 3)).toBe(6);
    });

    it('should handle empty string', () => {
      expect(calculateWeightedLength('')).toBe(0);
    });

    it('should handle text with numbers and special characters', () => {
      expect(calculateWeightedLength('test123')).toBe(7);
      expect(calculateWeightedLength('你好123')).toBe(7); // (2 * 2) + 3
      expect(calculateWeightedLength('hello!')).toBe(6);
      expect(calculateWeightedLength('@#$%')).toBe(4);
    });

    it('should handle CJK Compatibility Ideographs', () => {
      // Character in CJK Compatibility Ideographs range (0xF900-0xFAFF)
      expect(calculateWeightedLength('豈')).toBe(2);
    });

    it('should handle CJK Extension A characters', () => {
      // Character in CJK Extension A range (0x3400-0x4DBF)
      expect(calculateWeightedLength('㐀')).toBe(2);
    });

    it('should handle emoji characters as non-CJK', () => {
      expect(calculateWeightedLength('😀')).toBe(1);
      expect(calculateWeightedLength('🎉🎊')).toBe(2);
      expect(calculateWeightedLength('hello😀')).toBe(6);
    });

    it('should handle newlines and tabs', () => {
      expect(calculateWeightedLength('hello\nworld')).toBe(11);
      expect(calculateWeightedLength('hello\tworld')).toBe(11);
      expect(calculateWeightedLength('你好\n世界')).toBe(9); // (2 * 2) + 1 + (2 * 2)
    });

    it('should handle very long text', () => {
      const longText = 'a'.repeat(1000);
      expect(calculateWeightedLength(longText)).toBe(1000);

      const longCJK = '中'.repeat(100);
      expect(calculateWeightedLength(longCJK)).toBe(200);
    });

    it('should count individual ASCII characters correctly', () => {
      expect(calculateWeightedLength('a')).toBe(1);
      expect(calculateWeightedLength('Z')).toBe(1);
      expect(calculateWeightedLength('0')).toBe(1);
    });

    it('should handle Hangul Jamo characters', () => {
      // Hangul Jamo range (0x1100-0x11FF)
      expect(calculateWeightedLength('ᄀᄁ')).toBe(4); // 2 chars * 2 weight
    });
  });

  describe('truncateByWeightedLength', () => {
    it('should not truncate text within limit', () => {
      expect(truncateByWeightedLength('Hello', 10)).toBe('Hello');
    });

    it('should truncate English text exceeding limit', () => {
      expect(truncateByWeightedLength('Hello World', 8)).toBe('Hello Wo');
    });

    it('should truncate CJK text at character boundary', () => {
      // "你好世界" weighted length = 8, limit = 6 should keep "你好世" (weight 6)
      expect(truncateByWeightedLength('你好世界', 6)).toBe('你好世');
    });

    it('should truncate mixed text correctly', () => {
      // "Hello你好" = 5 (Hello) + 4 (你好) = 9
      // With limit 7, should keep "Hello你" (5 + 2 = 7)
      expect(truncateByWeightedLength('Hello你好', 7)).toBe('Hello你');
    });

    it('should handle text exactly at limit', () => {
      expect(truncateByWeightedLength('你好', 4)).toBe('你好');
    });

    it('should return empty string when limit is 0', () => {
      expect(truncateByWeightedLength('Hello', 0)).toBe('');
    });

    it('should handle empty string', () => {
      expect(truncateByWeightedLength('', 10)).toBe('');
    });

    it('should work with custom CJK weight', () => {
      // "你好" with weight 3 = 6, limit 5 should keep "你" (weight 3)
      expect(truncateByWeightedLength('你好', 5, 3)).toBe('你');
    });

    it('should not include partial CJK character at boundary', () => {
      expect(truncateByWeightedLength('你好世界', 5)).toBe('你好'); // Cannot fit 世 (needs 2)
      expect(truncateByWeightedLength('hello你好', 7)).toBe('hello你'); // 5 + 2 = 7 exactly
      expect(truncateByWeightedLength('hello你好', 6)).toBe('hello'); // 5 + 2 = 7 > 6, can't fit 你
    });

    it('should handle single character truncation', () => {
      expect(truncateByWeightedLength('hello', 1)).toBe('h');
      expect(truncateByWeightedLength('你好', 2)).toBe('你');
      expect(truncateByWeightedLength('你好', 1)).toBe(''); // CJK char needs weight 2
    });

    it('should handle negative max length', () => {
      expect(truncateByWeightedLength('hello', -1)).toBe('');
      expect(truncateByWeightedLength('你好', -5)).toBe('');
    });

    it('should preserve Korean Hangul correctly', () => {
      expect(truncateByWeightedLength('안녕하세요', 6)).toBe('안녕하'); // 3 chars * 2 = 6
      expect(truncateByWeightedLength('한글테스트', 8)).toBe('한글테스'); // 4 chars * 2 = 8
    });

    it('should preserve Japanese characters correctly', () => {
      expect(truncateByWeightedLength('ひらがなテスト', 10)).toBe('ひらがなテ'); // 4 chars * 2 = 8, + テ = 10
      expect(truncateByWeightedLength('ひらがなテスト', 8)).toBe('ひらがな'); // 4 chars * 2 = 8 exactly
      expect(truncateByWeightedLength('カタカナtest', 10)).toBe('カタカナte'); // (4 * 2) + 2 = 10
    });

    it('should handle very long max length', () => {
      const text = 'hello world';
      expect(truncateByWeightedLength(text, 1000)).toBe(text);

      const cjkText = '你好世界';
      expect(truncateByWeightedLength(cjkText, 1000)).toBe(cjkText);
    });

    it('should handle mixed content with numbers and special characters', () => {
      expect(truncateByWeightedLength('test123你好', 11)).toBe('test123你好'); // 7 + (2 * 2) = 11
      expect(truncateByWeightedLength('test123你好', 9)).toBe('test123你'); // 7 + 2 = 9 exactly
      expect(truncateByWeightedLength('hello!world', 6)).toBe('hello!');
      expect(truncateByWeightedLength('你好！世界', 5)).toBe('你好！'); // (2 * 2) + 1 = 5
    });

    it('should handle truncation with newlines and tabs', () => {
      expect(truncateByWeightedLength('hello\nworld', 6)).toBe('hello\n');
      expect(truncateByWeightedLength('你好\n世界', 5)).toBe('你好\n'); // (2 * 2) + 1 = 5
    });

    it('should handle edge case with only CJK characters and odd limit', () => {
      expect(truncateByWeightedLength('你好世', 5)).toBe('你好'); // 5 is odd, can only fit 2 CJK chars
      expect(truncateByWeightedLength('こんにちは', 7)).toBe('こんに'); // 7 allows 3 chars (6) but not 4
    });

    it('should handle CJK weight of 1 (no weighting)', () => {
      expect(truncateByWeightedLength('你好世界', 4, 1)).toBe('你好世界'); // All chars weight 1
      expect(truncateByWeightedLength('你好世界', 2, 1)).toBe('你好'); // 2 chars
    });

    it('should handle very large custom weight', () => {
      expect(truncateByWeightedLength('你好', 10, 5)).toBe('你好'); // 2 chars * 5 = 10
      expect(truncateByWeightedLength('你好', 9, 5)).toBe('你'); // Only 1 char fits
    });
  });
});
