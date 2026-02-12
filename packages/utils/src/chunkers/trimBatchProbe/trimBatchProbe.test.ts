import { describe, expect, it, vi } from 'vitest';

import {
  hardTruncateFromTail,
  normalizeToArray,
  resolveJoiner,
  trimBasedOnBatchProbe,
  truncateByPunctuation,
} from './trimBatchProbe';

vi.mock('tokenx', () => ({
  estimateTokenCount: (str: string) => str.split(/\s+/).filter(Boolean).length,
}));

describe('trimBasedOnBatchProbe', () => {
  it('prefers compact builds to keep more segments', async () => {
    class BuildableChunk {
      constructor(
        private readonly detail: string,
        private readonly summary: string,
      ) {}
      build(tryCompactIfPossible?: boolean) {
        return tryCompactIfPossible ? this.summary : this.detail;
      }
    }

    const chunks = [
      new BuildableChunk('very old detail segment', 'old summary'),
      new BuildableChunk('middle detail segment', 'mid summary'),
      new BuildableChunk('latest detail segment', 'latest summary'),
    ];

    const result = await trimBasedOnBatchProbe(chunks, 6);

    expect(result).toBe('old summary\nmid summary\nlatest summary');
  });

  it('keeps newest plain string chunks when under limit', async () => {
    const chunks = ['older message', 'newer message'];
    const result = await trimBasedOnBatchProbe(chunks, 10);

    expect(result).toBe('older message\nnewer message');
  });

  it('prefers compact probe when it allows keeping more segments', async () => {
    class BuildableChunk {
      constructor(
        private readonly detail: string,
        private readonly summary: string,
      ) {}
      build(tryCompactIfPossible?: boolean) {
        return tryCompactIfPossible ? this.summary : this.detail;
      }
    }

    // Each detail is 3 tokens, summary is 1 token.
    const chunks = [
      new BuildableChunk('old detail chunk', 'old'),
      new BuildableChunk('mid detail chunk', 'mid'),
      new BuildableChunk('latest detail chunk', 'latest'),
    ];

    // With detail: 9 tokens total => only last 2 fit; with summary: 3 tokens => all 3 fit.
    const result = await trimBasedOnBatchProbe(chunks, 5);

    expect(result).toBe('old\nmid\nlatest');
  });

  it('truncates only the newest structured segment when all probes fail', async () => {
    const structured = [
      '<root><a>keep me</a></root>',
      '<root><b>keep me too</b></root>',
      '<root><c>truncate me last</c></root>',
    ];

    const result = await trimBasedOnBatchProbe(structured, 2, { tryChunkingByPunctuation: true });

    // When the limit is extremely small, we still return a truncated newest segment rather than empty.
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty when truncation is disabled and nothing fits', async () => {
    const result = await trimBasedOnBatchProbe('too long without truncation', {
      tokenLimit: 1,
      tryChunkingByPunctuation: false,
      tryHardTruncation: false,
    });

    expect(result).toBe('');
  });

  it('uses compact build for single buildable before truncation', async () => {
    class BuildableChunk {
      constructor(
        private readonly detail: string,
        private readonly summary: string,
      ) {}
      build(tryCompactIfPossible?: boolean) {
        return tryCompactIfPossible ? this.summary : this.detail;
      }
    }

    const result = await trimBasedOnBatchProbe(
      new BuildableChunk('too long detail text', 'short'),
      2,
    );

    expect(result).toBe('short');
  });

  it('selects the largest newest batch within limit via probing', async () => {
    // 5 segments of two tokens each => total 10; limit 5 should keep last 3 segments (6 tokens -> too many), so keep last 2 segments (4 tokens) under limit.
    const segments = ['a b', 'c d', 'e f', 'g h', 'i j'];
    const result = await trimBasedOnBatchProbe(segments, 5);

    expect(result).toBe('g h\ni j');
  });

  it('falls back to punctuation then hard truncation for single strings', async () => {
    const text =
      'Older sentence should be dropped. Newest sentence should stay intact. trailing tail';

    const result = await trimBasedOnBatchProbe(text, 4);

    expect(result).toBe('trailing tail');

    const longToken = 'thisisaverylongtokenwithoutspacesorpunctuationthatkeepsgoing';
    const hardResult = await trimBasedOnBatchProbe(longToken, 3);

    expect(hardResult.length).toBeGreaterThan(0);
    expect(longToken.endsWith(hardResult)).toBe(true);
  });

  describe('__private helpers', () => {
    it('resolves joiners correctly', async () => {
      const fnJoiner = (batch: string[]) => batch.join('|');
      const objJoiner = { join: (batch: string[]) => batch.join('*') };

      expect(resolveJoiner()).toBe('\n');
      expect(resolveJoiner(',') as string).toBe(',');
      expect(await (resolveJoiner(fnJoiner) as any)(['a', 'b'])).toBe('a|b');
      expect(await (resolveJoiner(objJoiner) as any)(['a', 'b'])).toBe('a*b');
    });

    it('normalizes inputs to array', () => {
      expect(normalizeToArray(null)).toEqual([]);
      expect(normalizeToArray('one')).toEqual(['one']);
      expect(normalizeToArray(['a', 'b'])).toEqual(['a', 'b']);
    });

    it('truncates by punctuation when possible', async () => {
      const text = 'keep this sentence. drop these words';
      const result = await truncateByPunctuation(text, 3);

      expect(result).toBe('drop these words');
    });

    it('hard truncates from tail with shrinking window', async () => {
      const text = 'averylongtokenwithoutspacesorpunctuation';
      const result = await hardTruncateFromTail(text, 2);

      expect(result.length).toBeGreaterThan(0);
      expect(text.endsWith(result)).toBe(true);
    });
  });
});
