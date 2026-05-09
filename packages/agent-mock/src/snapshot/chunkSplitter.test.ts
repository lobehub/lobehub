import { describe, expect, it } from 'vitest';

import { splitTextIntoChunks } from './chunkSplitter';

describe('splitTextIntoChunks', () => {
  it('splits ASCII text into ~targetChunkChars-sized chunks', () => {
    const text = 'a'.repeat(100);
    const chunks = splitTextIntoChunks(text, { targetChunkChars: 20 });
    expect(chunks.length).toBe(5);
    expect(chunks.every((c) => c.length === 20)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });

  it('respects code points and does not break CJK characters', () => {
    const text = '你好世界'.repeat(10); // 40 code points
    const chunks = splitTextIntoChunks(text, { targetChunkChars: 8 });
    expect(chunks.join('')).toBe(text);
    chunks.forEach((c) => {
      expect(c).toBe([...c].join(''));
    });
  });

  it('returns single chunk for empty/short text', () => {
    expect(splitTextIntoChunks('', { targetChunkChars: 30 })).toEqual([]);
    expect(splitTextIntoChunks('hi', { targetChunkChars: 30 })).toEqual(['hi']);
  });

  it('applies jitter within ±15% when jitter enabled', () => {
    const text = 'a'.repeat(1000);
    const chunks = splitTextIntoChunks(text, { targetChunkChars: 30, jitter: 0.15 });
    chunks.forEach((c) => {
      expect(c.length).toBeGreaterThanOrEqual(Math.floor(30 * 0.85));
      expect(c.length).toBeLessThanOrEqual(Math.ceil(30 * 1.15));
    });
    expect(chunks.join('')).toBe(text);
  });
});
