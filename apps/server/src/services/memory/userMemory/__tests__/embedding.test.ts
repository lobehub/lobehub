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

describe('embedUserMemoryTexts', () => {
  beforeEach(() => {
    mocks.contextLimit = 3;
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('trims long inputs and preserves output indexes', async () => {
    const runtime = {
      embeddings: vi.fn(async () => [
        [1, 2, 3],
        [4, 5, 6],
      ]),
    } satisfies UserMemoryEmbeddingRuntime;

    const result = await embedUserMemoryTexts({
      input: ['one two three four', '', null, 'short text'],
      model: 'text-embedding-3-large',
      runtime,
      source: 'test:source',
      userId: 'user-test',
    });

    expect(runtime.embeddings).toHaveBeenCalledWith(
      {
        dimensions: 1024,
        input: ['two three four', 'short text'],
        model: 'text-embedding-3-large',
      },
      { metadata: { trigger: 'memory' }, user: 'user-test' },
    );
    // Vectors should be padded to 1024 dimensions
    expect(result[0]!.length).toBe(1024);
    expect(result[0]!.slice(0, 3)).toEqual([1, 2, 3]);
    expect(result[0]!.slice(3).every((v) => v === 0)).toBe(true);
    expect(result[1]).toBeUndefined();
    expect(result[2]).toBeUndefined();
    expect(result[3]!.length).toBe(1024);
    expect(result[3]!.slice(0, 3)).toEqual([4, 5, 6]);
    expect(result[3]!.slice(3).every((v) => v === 0)).toBe(true);
    expect(console.warn).toHaveBeenCalledWith('[user-memory] trimmed embedding input', {
      limit: 3,
      model: 'text-embedding-3-large',
      originalTokens: 4,
      source: 'test:source',
      trimmedTokens: 3,
      userId: 'user-test',
    });
  });

  it('skips trimming when no context limit is configured', async () => {
    mocks.contextLimit = undefined;
    const runtime = {
      embeddings: vi.fn(async () => [[1, 2, 3]]),
    } satisfies UserMemoryEmbeddingRuntime;

    const result = await embedUserMemoryTexts({
      input: ['one two three four'],
      model: 'text-embedding-3-large',
      runtime,
      source: 'test:no-limit',
      userId: 'user-test',
    });

    expect(mocks.trimBasedOnBatchProbe).not.toHaveBeenCalled();
    expect(runtime.embeddings).toHaveBeenCalledWith(
      {
        dimensions: 1024,
        input: ['one two three four'],
        model: 'text-embedding-3-large',
      },
      { metadata: { trigger: 'memory' }, user: 'user-test' },
    );
    // Vector should be padded to 1024 dimensions
    expect(result[0]!.length).toBe(1024);
    expect(result[0]!.slice(0, 3)).toEqual([1, 2, 3]);
    expect(result[0]!.slice(3).every((v) => v === 0)).toBe(true);
  });
});
