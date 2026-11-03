import { describe, expect, it } from 'vitest';

import { matchLevenshtein } from '../levenshtein';

describe('matchLevenshtein', () => {
  it('should pass for similar strings', () => {
    expect(matchLevenshtein('hello', 'helo', { threshold: 0.7 } as any).passed).toBe(true);
  });

  it('should fail for dissimilar strings', () => {
    expect(matchLevenshtein('hello', 'world', { threshold: 0.9 } as any).passed).toBe(false);
  });

  it('should return similarity score', () => {
    const result = matchLevenshtein('abc', 'abc', { threshold: 0 } as any);
    expect(result.score).toBe(1);
  });

  it('should handle empty strings', () => {
    const result = matchLevenshtein('', '', { threshold: 0.8 } as any);
    expect(result.score).toBe(1);
    expect(result.passed).toBe(true);
  });
});
