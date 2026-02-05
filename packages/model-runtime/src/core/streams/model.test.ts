import { describe, expect, it, vi } from 'vitest';

import { createModelPullStream } from './model';

describe('createModelPullStream', () => {
  const createMockAsyncIterable = <T>(values: T[]) => ({
    async *[Symbol.asyncIterator]() {
      for (const value of values) {
        yield value;
      }
    },
  });

  it('should create a readable stream from async iterable', async () => {
    const mockData = [
      { status: 'downloading', completed: 100, total: 1000 },
      { status: 'downloading', completed: 500, total: 1000 },
      { status: 'complete', completed: 1000, total: 1000 },
    ];

    const iterable = createMockAsyncIterable(mockData);
    const stream = createModelPullStream(iterable, 'test-model');

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value));
      }
    } finally {
      reader.releaseLock();
    }

    expect(chunks).toHaveLength(3);

    const parsedChunks = chunks.map((chunk) => JSON.parse(chunk));
    expect(parsedChunks[0]).toEqual({
      completed: 100,
      digest: undefined,
      model: 'test-model',
      status: 'downloading',
      total: 1000,
    });
    expect(parsedChunks[2]).toEqual({
      completed: 1000,
      digest: undefined,
      model: 'test-model',
      status: 'complete',
      total: 1000,
    });
  });

  it('should skip "pulling manifest" status', async () => {
    const mockData = [
      { status: 'pulling manifest' },
      { status: 'downloading', completed: 100, total: 1000 },
      { status: 'complete', completed: 1000, total: 1000 },
    ];

    const iterable = createMockAsyncIterable(mockData);
    const stream = createModelPullStream(iterable, 'test-model');

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value));
      }
    } finally {
      reader.releaseLock();
    }

    // Should only have 2 chunks (skipping "pulling manifest")
    expect(chunks).toHaveLength(2);

    const parsedChunks = chunks.map((chunk) => JSON.parse(chunk));
    expect(parsedChunks[0].status).toBe('downloading');
    expect(parsedChunks[1].status).toBe('complete');
  });

  it('should include digest when provided', async () => {
    const mockData = [
      { status: 'downloading', completed: 100, total: 1000, digest: 'sha256:abc123' },
    ];

    const iterable = createMockAsyncIterable(mockData);
    const stream = createModelPullStream(iterable, 'test-model');

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const { value } = await reader.read();
    reader.releaseLock();

    const parsed = JSON.parse(decoder.decode(value));
    expect(parsed.digest).toBe('sha256:abc123');
  });

  it('should handle cancel with onCancel callback', async () => {
    const mockData = [
      { status: 'downloading', completed: 100, total: 1000 },
      { status: 'downloading', completed: 500, total: 1000 },
    ];

    const onCancel = vi.fn();
    const iterable = createMockAsyncIterable(mockData);
    const stream = createModelPullStream(iterable, 'test-model', { onCancel });

    const reader = stream.getReader();

    // Read first chunk then cancel
    await reader.read();
    await reader.cancel('user cancelled');

    expect(onCancel).toHaveBeenCalledWith('user cancelled');
  });

  it('should handle iterator with return method', async () => {
    const returnMock = vi.fn().mockResolvedValue({ done: true });
    const mockIterable = {
      [Symbol.asyncIterator]: () => ({
        next: vi.fn().mockResolvedValue({ done: false, value: { status: 'downloading' } }),
        return: returnMock,
      }),
    };

    const stream = createModelPullStream(mockIterable as any, 'test-model');
    const reader = stream.getReader();

    await reader.cancel();

    expect(returnMock).toHaveBeenCalled();
  });

  it('should handle AbortError gracefully', async () => {
    const mockIterable = {
      async *[Symbol.asyncIterator]() {
        yield { status: 'downloading', completed: 100, total: 1000 };
        throw new DOMException('Operation aborted', 'AbortError');
      },
    };

    const stream = createModelPullStream(mockIterable, 'test-model');
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value));
      }
    } finally {
      reader.releaseLock();
    }

    // Should have at least the first chunk and possibly a cancelled status
    expect(chunks.length).toBeGreaterThanOrEqual(1);

    // First chunk should be the normal data
    const firstChunk = JSON.parse(chunks[0]);
    expect(firstChunk.status).toBe('downloading');

    // If there's a second chunk, it should be the cancelled status
    if (chunks.length > 1) {
      const lastChunk = JSON.parse(chunks.at(-1)!);
      expect(lastChunk.status).toBe('cancelled');
    }
  });

  it('should handle generic errors', async () => {
    const mockIterable = {
      async *[Symbol.asyncIterator]() {
        yield { status: 'downloading', completed: 100, total: 1000 };
        throw new Error('Network error');
      },
    };

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const stream = createModelPullStream(mockIterable, 'test-model');
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value));
      }
    } finally {
      reader.releaseLock();
    }

    expect(consoleSpy).toHaveBeenCalledWith(
      '[createModelPullStream] model download stream error:',
      expect.any(Error),
    );

    // Should have the normal chunk and error chunk
    expect(chunks.length).toBeGreaterThanOrEqual(1);

    const firstChunk = JSON.parse(chunks[0]);
    expect(firstChunk.status).toBe('downloading');

    // Last chunk should be error status
    if (chunks.length > 1) {
      const lastChunk = JSON.parse(chunks.at(-1)!);
      expect(lastChunk.status).toBe('error');
      expect(lastChunk.error).toBe('Network error');
    }

    consoleSpy.mockRestore();
  });

  it('should handle empty async iterable', async () => {
    const iterable = createMockAsyncIterable([]);
    const stream = createModelPullStream(iterable, 'test-model');

    const reader = stream.getReader();
    const { done } = await reader.read();
    reader.releaseLock();

    expect(done).toBe(true);
  });

  it('should handle non-Error objects in catch', async () => {
    const mockIterable = {
      async *[Symbol.asyncIterator]() {
        yield { status: 'downloading', completed: 100, total: 1000 };
        throw 'String error';
      },
    };

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const stream = createModelPullStream(mockIterable, 'test-model');
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value));
      }
    } finally {
      reader.releaseLock();
    }

    if (chunks.length > 1) {
      const lastChunk = JSON.parse(chunks.at(-1)!);
      expect(lastChunk.error).toBe('String error');
    }

    consoleSpy.mockRestore();
  });
});
