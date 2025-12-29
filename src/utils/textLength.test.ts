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
  });
});
