import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserMemoryEmbeddingRuntime } from '../embedding';
import { embedUserMemoryTexts } from '../embedding';

const mocks = vi.hoisted(() => ({
  contextLimit: 3 as number | undefined,
  encodeAsync: vi.fn(async (text: string) => text.split(/\s+/).filter(Boolean).length),
  trimBasedOnBatchProbe: vi.fn(async (text: string, limit?: number) =>
    text
      .split(/\s+/)
      .filter(Boolean)
      .slice(-(limit ?? 0))
      .join(' '),
  ),
}));

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: () => ({
    embedding: {
      contextLimit: mocks.contextLimit,
    },
  }),
}));

vi.mock('@/utils/chunkers', () => ({
  trimBasedOnBatchProbe: mocks.trimBasedOnBatchProbe,
}));

vi.mock('@/utils/tokenizer', () => ({
  encodeAsync: mocks.encodeAsync,
}));

describe('embedUserMemoryTexts - dimension handling', () => {
  beforeEach(() => {
    mocks.contextLimit = 3;
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('current behavior (pre-change)', () => {
    it('should always request dimensions: 1024 from embedding runtime', async () => {
      const runtime = {
        embeddings: vi.fn(async () => [[0.1, 0.2, 0.3]]),
      } satisfies UserMemoryEmbeddingRuntime;

      await embedUserMemoryTexts({
        input: ['test input'],
        model: 'text-embedding-3-large',
        runtime,
        source: 'test:source',
        userId: 'user-test',
      });

      // Current behavior: always sends dimensions: 1024
      expect(runtime.embeddings).toHaveBeenCalledWith(
        expect.objectContaining({
          dimensions: 1024,
        }),
        expect.anything(),
      );
    });

    it('should use dimensions parameter from options if provided', async () => {
      const runtime = {
        embeddings: vi.fn(async () => [[0.1, 0.2, 0.3]]),
      } satisfies UserMemoryEmbeddingRuntime;

      await embedUserMemoryTexts({
        dimensions: 768, // Custom dimension
        input: ['test input'],
        model: 'text-embedding-3-large',
        runtime,
        source: 'test:source',
        userId: 'user-test',
      });

      // Current behavior: uses custom dimensions
      expect(runtime.embeddings).toHaveBeenCalledWith(
        expect.objectContaining({
          dimensions: 768,
        }),
        expect.anything(),
      );
    });
  });

  describe('expected behavior (post-change)', () => {
    it('should pad vectors returned by Ollama to target dimension', async () => {
      // Simulate Ollama returning 768-dim vectors
      const ollamaVector = Array.from({ length: 768 }, (_, i) => i / 768);
      const runtime = {
        embeddings: vi.fn(async () => [ollamaVector]),
      } satisfies UserMemoryEmbeddingRuntime;

      const result = await embedUserMemoryTexts({
        input: ['test input'],
        model: 'nomic-embed-text',
        runtime,
        source: 'test:source',
        userId: 'user-test',
      });

      // After our changes, the result should be padded to 1024
      expect(result[0]).toBeDefined();
      expect(result[0]!.length).toBe(1024);
      expect(result[0]!.slice(0, 768)).toEqual(ollamaVector);
      expect(result[0]!.slice(768).every((v) => v === 0)).toBe(true);
    });

    it('should not pad vectors already at target dimension', async () => {
      // Simulate OpenAI returning 1024-dim vectors (via Matryoshka)
      const openaiVector = Array.from({ length: 1024 }, (_, i) => i / 1024);
      const runtime = {
        embeddings: vi.fn(async () => [openaiVector]),
      } satisfies UserMemoryEmbeddingRuntime;

      const result = await embedUserMemoryTexts({
        input: ['test input'],
        model: 'text-embedding-3-small',
        runtime,
        source: 'test:source',
        userId: 'user-test',
      });

      // After our changes, the result should be unchanged
      expect(result[0]).toEqual(openaiVector);
    });

    it('should truncate vectors larger than target dimension', async () => {
      // Simulate a model returning 1536-dim vectors without Matryoshka
      const largeVector = Array.from({ length: 1536 }, (_, i) => i / 1536);
      const runtime = {
        embeddings: vi.fn(async () => [largeVector]),
      } satisfies UserMemoryEmbeddingRuntime;

      const result = await embedUserMemoryTexts({
        input: ['test input'],
        model: 'text-embedding-ada-002', // No Matryoshka support
        runtime,
        source: 'test:source',
        userId: 'user-test',
      });

      // After our changes, the result should be truncated to 1024
      expect(result[0]).toBeDefined();
      expect(result[0]!.length).toBe(1024);
      expect(result[0]!).toEqual(largeVector.slice(0, 1024));
    });

    it('should handle multiple vectors with different dimensions', async () => {
      // Simulate mixed vectors
      const vector1 = Array.from({ length: 768 }, (_, i) => i / 768); // 768-dim
      const vector2 = Array.from({ length: 1024 }, (_, i) => i / 1024); // 1024-dim
      const runtime = {
        embeddings: vi.fn(async () => [vector1, vector2]),
      } satisfies UserMemoryEmbeddingRuntime;

      const result = await embedUserMemoryTexts({
        input: ['input 1', 'input 2'],
        model: 'nomic-embed-text',
        runtime,
        source: 'test:source',
        userId: 'user-test',
      });

      // Both vectors should be padded to 1024
      expect(result[0]!.length).toBe(1024);
      expect(result[1]!.length).toBe(1024);
    });
  });
});
