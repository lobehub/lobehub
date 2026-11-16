import { describe, expect, it } from 'vitest';

import { MAX_FILE_PARSE_SIZE } from '@/const/file';

import {
  assertChunkResultWithinLimits,
  ChunkOutputTooLargeError,
  DEFAULT_CHUNK_RESULT_LIMITS,
} from './chunkLimits';

const chunk = (text: string) => ({ metadata: {}, pageContent: text });

describe('assertChunkResultWithinLimits', () => {
  it('sizes the text bound so a file at the parse cap still fits after overlap', () => {
    // 800-character chunks every 400 characters: about 2x the input
    expect(DEFAULT_CHUNK_RESULT_LIMITS.maxChars).toBeGreaterThan(2 * MAX_FILE_PARSE_SIZE);
    expect(DEFAULT_CHUNK_RESULT_LIMITS.maxChunks).toBeGreaterThan(MAX_FILE_PARSE_SIZE / 400);
  });

  it('returns the very same chunks when they are within bounds', () => {
    const chunks = [chunk('ab'), chunk('cd')];

    expect(assertChunkResultWithinLimits(chunks, { maxChars: 4, maxChunks: 2 })).toBe(chunks);
  });

  it('rejects too many chunks instead of cutting the list', () => {
    const error = (() => {
      try {
        assertChunkResultWithinLimits([chunk('a'), chunk('b'), chunk('c')], {
          maxChars: 99,
          maxChunks: 2,
        });
      } catch (e) {
        return e;
      }
    })();

    expect(error).toBeInstanceOf(ChunkOutputTooLargeError);
    expect(error).toMatchObject({ actual: 3, limit: 2, unit: 'chunks' });
  });

  it('rejects too much text instead of cutting a chunk', () => {
    expect(() =>
      assertChunkResultWithinLimits([chunk('abc'), chunk('de')], { maxChars: 4, maxChunks: 9 }),
    ).toThrow(ChunkOutputTooLargeError);
  });
});
