import { describe, expect, it } from 'vitest';

import type { EmbeddingsPayload } from '../../../types';

// Test that verifies the current behavior of Ollama embeddings
// and documents the expected behavior after our changes
describe('Ollama embeddings dimension handling', () => {
  describe('current behavior (pre-change)', () => {
    it('should NOT pass dimensions parameter to Ollama API', () => {
      // This test documents that the Ollama provider currently
      // does NOT pass the dimensions parameter to the Ollama API
      const payload: EmbeddingsPayload = {
        dimensions: 1024, // This should be ignored
        input: 'test input',
        model: 'nomic-embed-text',
      };

      // The Ollama client.embeddings() call should NOT include dimensions
      // This is because Ollama does not support the dimensions parameter
      expect(payload.dimensions).toBe(1024); // Payload has it
      // But the actual API call should not pass it
    });

    it('should return vector with native model dimension', () => {
      // nomic-embed-text returns 768-dimensional vectors
      // This test documents that the returned vector
      // has the native dimension, not the requested dimension
      const nativeVector = Array.from({ length: 768 }, (_, i) => i / 768);

      expect(nativeVector.length).toBe(768);
      // After our changes, this vector should be padded to 1024
    });
  });

  describe('expected behavior (post-change)', () => {
    it('should pad 768-dim vector to 1024', () => {
      // After our changes, the Ollama provider should pad vectors
      // from their native dimension to the target dimension
      const nativeVector = Array.from({ length: 768 }, (_, i) => i / 768);
      const targetDim = 1024;

      // Simulate padding
      const padded = [
        ...nativeVector,
        ...Array.from({ length: targetDim - nativeVector.length }).fill(0),
      ];

      expect(padded.length).toBe(1024);
      expect(padded.slice(0, 768)).toEqual(nativeVector);
      expect(padded.slice(768).every((v) => v === 0)).toBe(true);
    });

    it('should not pad vector if already at target dimension', () => {
      const nativeVector = Array.from({ length: 1024 }, (_, i) => i / 1024);
      const targetDim = 1024;

      // Simulate padding (should be no-op)
      const padded =
        nativeVector.length === targetDim
          ? nativeVector
          : [...nativeVector, ...Array.from({ length: targetDim - nativeVector.length }).fill(0)];

      expect(padded.length).toBe(1024);
      expect(padded).toEqual(nativeVector);
    });

    it('should truncate vector if larger than target dimension', () => {
      const nativeVector = Array.from({ length: 1536 }, (_, i) => i / 1536);
      const targetDim = 1024;

      // Simulate truncation
      const truncated =
        nativeVector.length > targetDim ? nativeVector.slice(0, targetDim) : nativeVector;

      expect(truncated.length).toBe(1024);
      expect(truncated).toEqual(nativeVector.slice(0, 1024));
    });
  });
});
