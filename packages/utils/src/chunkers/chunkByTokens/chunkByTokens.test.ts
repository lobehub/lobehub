import { describe, expect, it, vi } from 'vitest';

import { chunkByTokens } from './chunkByTokens';

// A tiny deterministic token estimator: ~1 token per CJK char, ~0.25 per ASCII word char.
const mocks = vi.hoisted(() => ({
  estimateTokenCount: vi.fn(
    (text: string) =>
      Array.from(text).reduce(
        (acc, ch) => acc + (/[\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/.test(ch) ? 1 : 0.25),
        0,
      ) + 1,
  ),
}));

vi.mock('tokenx', () => ({
  estimateTokenCount: mocks.estimateTokenCount,
  splitByTokens: vi.fn((text: string, tokensPerChunk: number, options?: { overlap?: number }) => {
    // Replicate the estimator slicing greedily; enough to exercise our aligning
    // logic independent of the real tokenx implementation.
    const overlap = options?.overlap ?? 0;
    const chunks: string[] = [];
    let cursor = 0;
    while (cursor < text.length) {
      let end = cursor + 1;
      while (end <= text.length) {
        const slice = text.slice(cursor, end);
        const tokens =
          Array.from(slice).reduce(
            (acc, ch) => acc + (/[\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/.test(ch) ? 1 : 0.25),
            0,
          ) + 1;
        if (tokens > tokensPerChunk) break;
        end += 1;
      }
      chunks.push(text.slice(cursor, end - 1));
      cursor = end - 1 - overlap;
    }
    return chunks;
  }),
}));

describe('chunkByTokens', () => {
  it('returns the original text when it fits within the limit', async () => {
    const text = '这是一段简短的中文。The quick brown fox.';
    const result = await chunkByTokens(text, { tokenLimit: 1000 });

    expect(result).toEqual([text.trim()]);
  });

  it('returns an empty array for empty input', async () => {
    await expect(chunkByTokens('', { tokenLimit: 100 })).resolves.toEqual([]);
    await expect(chunkByTokens('   ', { tokenLimit: 100 })).resolves.toEqual([]);
  });

  it('splits a long text into multiple chunks', async () => {
    const text = '第一句。第二句。第三句。第四句。第五句。第六句。第七句。第八句。第九句。第十句。';
    const result = await chunkByTokens(text, { tokenLimit: 14 });

    expect(result.length).toBeGreaterThan(1);
    // Chunks preserve sentence boundaries when possible
    for (const chunk of result) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it('does not drop the head of the text across chunks', async () => {
    const header = '第一句。';
    const body = Array.from(
      { length: 20 },
      (_, i) => `这是第${i + 2}个长句子，包含足够长的内容用于测试切块。`,
    ).join('');
    const text = header + body;
    const result = await chunkByTokens(text, { tokenLimit: 25 });

    expect(result.length).toBeGreaterThan(1);
    expect(result[0]!).toContain('第一句');
    // The tail of the text is still present in the final chunk
    const allJoined = result.map((chunk) => chunk.replaceAll('\n', '')).join('');
    expect(allJoined).toContain('第21个长句子');
  });

  it('re-anchors hard cuts to sentence boundaries', async () => {
    const text = '短句一。短句二。短句三。短句四。短句五。短句六。短句七。短句八。短句九。短句十。';
    const result = await chunkByTokens(text, { tokenLimit: 12 });

    // All non-final chunks should end with sentence punctuation (no mid-sentence cuts)
    for (let i = 0; i < result.length - 1; i += 1) {
      expect(result[i]!.trim()).toMatch(/[。！？!?；;]$/);
    }
  });

  it('keeps the final chunk when the remainder is below the limit', async () => {
    const text = '这是一个很长的开头文本。'.repeat(8) + '结尾短句。';
    const result = await chunkByTokens(text, { tokenLimit: 20 });

    expect(result.length).toBeGreaterThan(1);
    expect(result.at(-1)).toContain('结尾短句');
  });
});
