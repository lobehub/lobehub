import { encode } from 'gpt-tokenizer/encoding/cl100k_base';
import { describe, expect, it } from 'vitest';

import { resolveEmbeddingTokenLimit, trimEmbeddingInput } from './embedding';

describe('embedding input limits', () => {
  it.each(['text-embedding-ada-002', 'text-embedding-3-small', 'text-embedding-3-large'])(
    'bounds %s by its own window even without an explicit limit',
    async (model) => {
      expect(resolveEmbeddingTokenLimit(model)).toBe(8192);
      expect(resolveEmbeddingTokenLimit(model, 32768)).toBe(8192);
      const text = 'hello world '.repeat(6000).trim();
      const result = await trimEmbeddingInput(text, model);
      expect(encode(result).length).toBeLessThanOrEqual(8192);
      expect(result.length).toBeLessThan(text.length);
      expect(text.endsWith(result)).toBe(true);
    },
  );

  it('counts emoji tokens exactly and keeps valid Unicode', async () => {
    const text = '🧑🏽‍💻🚀 '.repeat(2500).trim();
    const result = await trimEmbeddingInput(text, 'text-embedding-3-small', 8192);
    expect(encode(result).length).toBeLessThanOrEqual(8192);
    expect(encode(result).length).toBeGreaterThan(8000);
    expect(result).not.toContain('\uFFFD');
    expect(text.endsWith(result)).toBe(true);
  });

  it('honors smaller limits and treats special-token spellings as ordinary text', async () => {
    const text = 'hello <|endoftext|> world '.repeat(50).trim();
    const result = await trimEmbeddingInput(text, 'text-embedding-3-small', 32);
    expect(encode(result, { disallowedSpecial: new Set() }).length).toBeLessThanOrEqual(32);
    expect(text.endsWith(result)).toBe(true);
  });

  it.each([undefined, 0, -1, NaN, Infinity])('ignores invalid limits: %s', (limit) => {
    expect(resolveEmbeddingTokenLimit('text-embedding-3-small', limit)).toBe(8192);
  });

  it('preserves short inputs and does not guess a tokenizer for custom models', async () => {
    expect(await trimEmbeddingInput('short text', 'text-embedding-3-small')).toBe('short text');
    expect(await trimEmbeddingInput('', 'text-embedding-3-small')).toBe('');
    expect(resolveEmbeddingTokenLimit('custom-embedding')).toBeUndefined();
    expect(await trimEmbeddingInput('unchanged input', 'custom-embedding')).toBe('unchanged input');
  });
});
