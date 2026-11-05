import { beforeEach, describe, expect, it, vi } from 'vitest';

const botReply = vi.hoisted(() => ({
  forgetDingTalkSessionWebhook: vi.fn(),
  getDingTalkSessionWebhook: vi.fn(),
}));
vi.mock('@/server/services/redis', () => ({ redisService: { botReply } }));

const { sendDingTalkAttachments } = await import('./sendAttachments');

const group = { id: 'cid1', type: 'group' as const };

const createApi = () => ({
  replyViaSessionWebhook: vi.fn().mockResolvedValue(undefined),
  sendGroupMessage: vi.fn().mockResolvedValue({ processQueryKey: 'k' }),
  sendSingleMessage: vi.fn().mockResolvedValue({ processQueryKey: 'k' }),
});

describe('sendDingTalkAttachments', () => {
  let api: ReturnType<typeof createApi>;

  beforeEach(() => {
    vi.clearAllMocks();
    botReply.getDingTalkSessionWebhook.mockResolvedValue(undefined);
    api = createApi();
  });

  it('sends text first, then each public image as sampleImageMsg', async () => {
    const result = await sendDingTalkAttachments(
      api as any,
      'dingapp',
      group,
      [{ fetchUrl: 'https://cdn.example/a.png', name: 'a.png', type: 'image' }],
      'caption',
    );

    expect(api.sendGroupMessage.mock.calls.map(([, msg]) => msg)).toEqual([
      { msgKey: 'sampleText', msgParam: { content: 'caption' } },
      { msgKey: 'sampleImageMsg', msgParam: { photoURL: 'https://cdn.example/a.png' } },
    ]);
    expect(result).toEqual({ delivered: 1, failures: [] });
  });

  it('degrades files and URL-less attachments to links in the text leg', async () => {
    const result = await sendDingTalkAttachments(api as any, 'dingapp', group, [
      { fetchUrl: 'https://cdn.example/r.pdf', name: 'r.pdf', type: 'file' },
      { data: 'aGk=', name: 'b.png', type: 'image' },
    ]);

    expect(api.sendGroupMessage).toHaveBeenCalledTimes(1);
    const text = api.sendGroupMessage.mock.calls[0][1].msgParam.content;
    expect(text).toContain('📎 r.pdf: https://cdn.example/r.pdf');
    expect(text).toContain('📎 b.png (attachment dropped: no public URL)');
    expect(result.delivered).toBe(0);
    expect(result.failures.map((f) => [f.name, f.reason])).toEqual([
      ['r.pdf', 'upload-failed'],
      ['b.png', 'source-unavailable'],
    ]);
  });

  it('falls back to a link when DingTalk rejects an image', async () => {
    api.sendSingleMessage
      .mockRejectedValueOnce(new Error('invalid photoURL'))
      .mockResolvedValue({ processQueryKey: 'k' });

    const result = await sendDingTalkAttachments(
      api as any,
      'dingapp',
      { id: 'staff1', type: 'single' },
      [{ fetchUrl: 'https://cdn.example/a.png', name: 'a.png', type: 'image' }],
    );

    expect(result.delivered).toBe(0);
    expect(result.failures).toEqual([
      { detail: 'invalid photoURL', name: 'a.png', reason: 'upload-failed', type: 'image' },
    ]);
    expect(api.sendSingleMessage.mock.calls.at(-1)![1]).toEqual({
      msgKey: 'sampleText',
      msgParam: { content: '📎 a.png: https://cdn.example/a.png' },
    });
  });
});
