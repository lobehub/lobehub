// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildLineMessages, sendLineAttachments } from './sendAttachments';

describe('buildLineMessages', () => {
  it('puts the leading text first', () => {
    const messages = buildLineMessages(
      [{ fetchUrl: 'https://cdn.example.com/a.png', type: 'image' }],
      'hello',
    );
    expect(messages[0]).toEqual({ text: 'hello', type: 'text' });
    expect(messages[1]).toEqual({
      originalContentUrl: 'https://cdn.example.com/a.png',
      previewImageUrl: 'https://cdn.example.com/a.png',
      type: 'image',
    });
  });

  it('emits typed image messages for https image attachments', () => {
    const messages = buildLineMessages([
      { fetchUrl: 'https://cdn.example.com/a.png', type: 'image' },
    ]);
    expect(messages).toEqual([
      {
        originalContentUrl: 'https://cdn.example.com/a.png',
        previewImageUrl: 'https://cdn.example.com/a.png',
        type: 'image',
      },
    ]);
  });

  it('degrades non-image / non-https / data-only attachments to text-links', () => {
    const messages = buildLineMessages([
      { fetchUrl: 'https://cdn.example.com/doc.pdf', name: 'doc.pdf', type: 'file' },
      { fetchUrl: 'https://cdn.example.com/v.mp4', type: 'video' },
      { data: 'aGVsbG8=', name: 'inline.png', type: 'image' },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('text');
    expect((messages[0] as any).text).toContain('doc.pdf');
    expect((messages[0] as any).text).toContain('https://cdn.example.com/doc.pdf');
    expect((messages[0] as any).text).toContain('attachment dropped: no public URL');
  });

  it('mixes typed image + text-fallback in the same push', () => {
    const messages = buildLineMessages([
      { fetchUrl: 'https://cdn.example.com/ok.png', type: 'image' },
      { fetchUrl: 'https://cdn.example.com/bad.pdf', type: 'file' },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('image');
    expect(messages[1].type).toBe('text');
  });

  it('rejects http:// URLs (LINE requires HTTPS)', () => {
    const messages = buildLineMessages([
      { fetchUrl: 'http://insecure.example.com/a.png', type: 'image' },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('text');
  });
});

describe('sendLineAttachments', () => {
  const makeApi = () => ({ push: vi.fn().mockResolvedValue(undefined) });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the count of typed media messages (not text)', async () => {
    const api = makeApi();
    const n = await sendLineAttachments(
      api as any,
      'U1',
      [
        { fetchUrl: 'https://cdn.example.com/a.png', type: 'image' },
        { fetchUrl: 'https://cdn.example.com/b.png', type: 'image' },
        { fetchUrl: 'https://cdn.example.com/c.pdf', type: 'file' },
      ],
      'hi',
    );
    // 2 image messages count; leading text + file text-fallback don't.
    expect(n).toBe(2);
    expect(api.push).toHaveBeenCalledTimes(1);
  });

  it('batches >5 messages across multiple push calls', async () => {
    const api = makeApi();
    const atts = Array.from({ length: 8 }, (_, i) => ({
      fetchUrl: `https://cdn.example.com/${i}.png`,
      type: 'image' as const,
    }));
    await sendLineAttachments(api as any, 'U1', atts);
    // 8 image messages → 2 push batches (5 + 3)
    expect(api.push).toHaveBeenCalledTimes(2);
    expect((api.push.mock.calls[0][1] as any[]).length).toBe(5);
    expect((api.push.mock.calls[1][1] as any[]).length).toBe(3);
  });

  it('continues to next batch when one push fails', async () => {
    const api = makeApi();
    api.push.mockRejectedValueOnce(new Error('rate limit'));
    const atts = Array.from({ length: 6 }, (_, i) => ({
      fetchUrl: `https://cdn.example.com/${i}.png`,
      type: 'image' as const,
    }));
    await sendLineAttachments(api as any, 'U1', atts);
    expect(api.push).toHaveBeenCalledTimes(2);
  });

  it('returns 0 and skips push when there are no resolvable messages', async () => {
    const api = makeApi();
    const n = await sendLineAttachments(api as any, 'U1', []);
    expect(n).toBe(0);
    expect(api.push).not.toHaveBeenCalled();
  });
});
