import { ModelRuntime } from '@lobechat/model-runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserMemoryModel } from '@/database/models/userMemory';

import { generateEmbeddings } from '../extract/embeddings';
import { listRelevantUserMemories } from '../extract/queries';

// Input trimming is incidental to the dimension-normalization regression these
// tests guard; keep it deterministic instead of loading tokenizer models.
vi.mock('@/utils/tokenizer/embedding', () => ({
  resolveEmbeddingTokenLimit: () => undefined,
  trimEmbeddingInput: async (text: string) => text,
}));

vi.mock('@/server/services/ftsSearch', () => ({
  createFtsSearchRepo: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/server/services/ftsSearch/observability', () => ({
  recordUserMemoryLexicalSearchDecision: vi.fn(),
}));

vi.mock('@/database/models/userMemory', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, UserMemoryModel: vi.fn() };
});

const vector768 = Array.from({ length: 768 }, (_, i) => i / 768);

const createRuntimeReturning = (vectors: number[][]) =>
  new ModelRuntime({ embeddings: vi.fn(async () => vectors) } as any);

/**
 * Regression coverage for the dimension-mismatch paths called out in review:
 * these exercise the real extraction entry points end-to-end through
 * `ModelRuntime.embeddings`, which normalizes provider-native vectors to the
 * requested `payload.dimensions` (the pgvector column width) at the shared
 * boundary.
 */
describe('memory extraction embedding dimension regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('generateEmbeddings (extraction persistence path)', () => {
    it('pads provider-native 768-dim vectors to the 1024-dim memory schema width', async () => {
      const runtime = createRuntimeReturning([vector768]);

      const result = await generateEmbeddings(runtime as any, 'nomic-embed-text', ['hello'], 'u1');

      expect(result[0]).toHaveLength(1024);
      expect(result[0]!.slice(0, 768)).toEqual(vector768);
      expect(result[0]!.slice(768).every((v) => v === 0)).toBe(true);
    });

    it('truncates provider-native 1536-dim vectors to the requested width', async () => {
      const vector1536 = Array.from({ length: 1536 }, (_, i) => i / 1536);
      const runtime = createRuntimeReturning([vector1536]);

      const result = await generateEmbeddings(
        runtime as any,
        'text-embedding-ada-002',
        ['hello'],
        'u1',
      );

      expect(result[0]).toHaveLength(1024);
      expect(result[0]).toEqual(vector1536.slice(0, 1024));
    });

    it('keeps the slot missing when the provider returns an empty vector', async () => {
      const runtime = createRuntimeReturning([[]]);

      const result = await generateEmbeddings(runtime as any, 'nomic-embed-text', ['hello'], 'u1');

      expect(result[0]).toBeNull();
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('listRelevantUserMemories (extraction search path)', () => {
    it('passes a normalized 1024-dim query vector to hybrid search', async () => {
      const searchMemory = vi.fn().mockResolvedValue({
        activities: [],
        contexts: [],
        experiences: [],
        identities: [],
        meta: {},
        preferences: [],
      });
      vi.mocked(UserMemoryModel).mockImplementation(function () {
        return { searchMemory } as any;
      } as any);

      const runtime = createRuntimeReturning([vector768]);

      await listRelevantUserMemories(
        { db: Promise.resolve({}) } as any,
        {} as any,
        runtime as any,
        'nomic-embed-text',
        'u1',
        [{ content: 'hello world', role: 'user' }] as any,
      );

      expect(searchMemory).toHaveBeenCalledTimes(1);
      const queryVectors = searchMemory.mock.calls[0]![1] as number[][];
      expect(queryVectors[0]).toHaveLength(1024);
      expect(queryVectors[0]!.slice(0, 768)).toEqual(vector768);
    });

    it('surfaces the provider failure when the query embedding comes back empty', async () => {
      const searchMemory = vi.fn();
      vi.mocked(UserMemoryModel).mockImplementation(function () {
        return { searchMemory } as any;
      } as any);

      const runtime = createRuntimeReturning([[]]);

      // An empty query vector must fail loudly (retryable) instead of silently
      // retrieving with a fabricated or missing vector.
      await expect(
        listRelevantUserMemories(
          { db: Promise.resolve({}) } as any,
          {} as any,
          runtime as any,
          'nomic-embed-text',
          'u1',
          [{ content: 'hello world', role: 'user' }] as any,
        ),
      ).rejects.toThrow(/empty or missing/i);

      expect(searchMemory).not.toHaveBeenCalled();
    });
  });
});
