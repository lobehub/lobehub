import { estimateTokenCount } from 'tokenx';
import { describe, expect, it } from 'vitest';

import { chunkByTokens } from './chunkByTokens';

// Integration test against the REAL tokenx package (no mock). tokenx's
// splitByTokens estimates loosely and can emit chunks above `tokenLimit` for
// CJK text without spaces; we assert the chunker's output is strictly bounded
// regardless (final boundedness pass).
const fillMessage = (i: number) =>
  `这是第${i}条用于把对话撑长的中间填充消息，内容本身没有检索价值，只是为了让整段聚合文本超过 embedding 上下文限制，从而触发内部切块而不是单条 embedding。`;

describe('chunkByTokens (real tokenx, CJK long sentences)', () => {
  const head = '用户的重要事实：我和妻子的结婚纪念日是每年6月18日。';
  const body = Array.from({ length: 40 }, (_, i) => fillMessage(i)).join('\n\n');
  const tail = '用户最后问：我最近聊了哪些话题？';
  const text = `${head}\n\n${body}\n\n${tail}`;

  it('keeps every chunk strictly under the token limit', async () => {
    const tokenLimit = 256;
    expect(estimateTokenCount(text)).toBeGreaterThan(tokenLimit);

    const chunks = await chunkByTokens(text, { tokenLimit });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(estimateTokenCount(chunk)).toBeLessThanOrEqual(tokenLimit);
    }
  });

  it('does not drop the head or the tail across chunks', async () => {
    const chunks = await chunkByTokens(text, { tokenLimit: 256 });

    expect(chunks[0]).toContain('结婚纪念日是每年6月18日');
    const allJoined = chunks.join('');
    expect(allJoined).toContain('我最近聊了哪些话题');
  });

  it('emits no empty chunks', async () => {
    const chunks = await chunkByTokens(text, { tokenLimit: 256 });

    for (const chunk of chunks) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });
});
