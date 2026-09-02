import { describe, expect, it } from 'vitest';

import { padVector, validateVectorDimension } from './vectorPadding';

describe('VectorPaddingService', () => {
  describe('padVector', () => {
    it('should pad a smaller vector with zeros', () => {
      const vector = [0.1, 0.2, 0.3];
      const result = padVector(vector, 5);
      expect(result).toEqual([0.1, 0.2, 0.3, 0, 0]);
    });

    it('should not modify a vector with matching dimensions', () => {
      const vector = [0.1, 0.2, 0.3];
      const result = padVector(vector, 3);
      expect(result).toBe(vector); // Same reference (zero allocation)
    });

    it('should truncate a larger vector', () => {
      const vector = [0.1, 0.2, 0.3, 0.4, 0.5];
      const result = padVector(vector, 3);
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it('should pad empty vector to target dimension', () => {
      const vector: number[] = [];
      const result = padVector(vector, 1024);
      expect(result.length).toBe(1024);
      expect(result.every((v) => v === 0)).toBe(true);
    });

    it('should handle null vector', () => {
      const result = padVector(null, 1024);
      expect(result.length).toBe(1024);
      expect(result.every((v) => v === 0)).toBe(true);
    });

    it('should handle undefined vector', () => {
      const result = padVector(undefined, 1024);
      expect(result.length).toBe(1024);
      expect(result.every((v) => v === 0)).toBe(true);
    });

    it('should pad 768-dim vector to 1024', () => {
      const vector = Array.from({ length: 768 }, (_, i) => i / 768);
      const result = padVector(vector, 1024);
      expect(result.length).toBe(1024);
      expect(result.slice(0, 768)).toEqual(vector);
      expect(result.slice(768).every((v) => v === 0)).toBe(true);
    });

    it('should truncate 1536-dim vector to 1024', () => {
      const vector = Array.from({ length: 1536 }, (_, i) => i / 1536);
      const result = padVector(vector, 1024);
      expect(result.length).toBe(1024);
      expect(result).toEqual(vector.slice(0, 1024));
    });

    it('should handle negative target dimension', () => {
      const vector = [0.1, 0.2];
      expect(() => padVector(vector, -1)).toThrow();
    });

    it('should handle zero target dimension', () => {
      const vector = [0.1, 0.2];
      expect(() => padVector(vector, 0)).toThrow();
    });
  });

  describe('validateVectorDimension', () => {
    it('should return valid for matching dimensions', () => {
      const vector = [0.1, 0.2, 0.3];
      const result = validateVectorDimension(vector, 3);
      expect(result).toEqual({ actual: 3, expected: 3, valid: true });
    });

    it('should return invalid for mismatched dimensions', () => {
      const vector = [0.1, 0.2, 0.3];
      const result = validateVectorDimension(vector, 5);
      expect(result).toEqual({ actual: 3, expected: 5, valid: false });
    });

    it('should handle empty vector', () => {
      const vector: number[] = [];
      const result = validateVectorDimension(vector, 1024);
      expect(result).toEqual({ actual: 0, expected: 1024, valid: false });
    });
  });

  describe('cosine similarity preservation', () => {
    it('should preserve cosine similarity after zero-padding', () => {
      const a = [0.1, 0.2, 0.3];
      const b = [0.4, 0.5, 0.6];

      // Original cosine similarity
      const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
      const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      const originalSimilarity = dotProduct / (normA * normB);

      // Padded cosine similarity
      const aPadded = padVector(a, 1024);
      const bPadded = padVector(b, 1024);
      const paddedDotProduct = aPadded.reduce((sum, val, i) => sum + val * bPadded[i], 0);
      const paddedNormA = Math.sqrt(aPadded.reduce((sum, val) => sum + val * val, 0));
      const paddedNormB = Math.sqrt(bPadded.reduce((sum, val) => sum + val * val, 0));
      const paddedSimilarity = paddedDotProduct / (paddedNormA * paddedNormB);

      expect(paddedSimilarity).toBeCloseTo(originalSimilarity, 10);
    });

    it('should preserve cosine similarity after zero-padding 768 to 1024', () => {
      const a = Array.from({ length: 768 }, (_, i) => Math.sin(i));
      const b = Array.from({ length: 768 }, (_, i) => Math.cos(i));

      // Original cosine similarity
      const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
      const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
      const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
      const originalSimilarity = dotProduct / (normA * normB);

      // Padded cosine similarity
      const aPadded = padVector(a, 1024);
      const bPadded = padVector(b, 1024);
      const paddedDotProduct = aPadded.reduce((sum, val, i) => sum + val * bPadded[i], 0);
      const paddedNormA = Math.sqrt(aPadded.reduce((sum, val) => sum + val * val, 0));
      const paddedNormB = Math.sqrt(bPadded.reduce((sum, val) => sum + val * val, 0));
      const paddedSimilarity = paddedDotProduct / (paddedNormA * paddedNormB);

      expect(paddedSimilarity).toBeCloseTo(originalSimilarity, 10);
    });
  });
});
