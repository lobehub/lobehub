// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendQQAttachments } from './sendAttachments';

const makeApi = () => ({
  sendC2CMedia: vi.fn().mockResolvedValue({ id: 'm', timestamp: '' }),
  sendC2CMessage: vi.fn().mockResolvedValue({ id: 'm', timestamp: '' }),
  sendDmsMessage: vi.fn().mockResolvedValue({ id: 'm', timestamp: '' }),
  sendGroupMedia: vi.fn().mockResolvedValue({ id: 'm', timestamp: '' }),
  sendGroupMessage: vi.fn().mockResolvedValue({ id: 'm', timestamp: '' }),
  sendGuildMessage: vi.fn().mockResolvedValue({ id: 'm', timestamp: '' }),
  uploadC2CRichMedia: vi.fn().mockResolvedValue({ file_info: 'fi-c2c' }),
  uploadGroupRichMedia: vi.fn().mockResolvedValue({ file_info: 'fi-group' }),
});

describe('sendQQAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('group: uploads via uploadGroupRichMedia and sends via sendGroupMedia', async () => {
    const api = makeApi();
    const n = await sendQQAttachments(
      api as any,
      'group',
      'gid-1',
      [{ fetchUrl: 'https://cdn.example.com/a.png', name: 'a.png', type: 'image' }],
      'hi',
    );
    expect(n).toBe(1);
    expect(api.uploadGroupRichMedia).toHaveBeenCalledWith(
      'gid-1',
      1,
      'https://cdn.example.com/a.png',
    );
    expect(api.sendGroupMedia).toHaveBeenCalledWith('gid-1', 'fi-group');
    // Text leg goes through sendGroupMessage as a separate call
    expect(api.sendGroupMessage).toHaveBeenCalledWith('gid-1', 'hi');
  });

  it('c2c: uses C2C upload + send', async () => {
    const api = makeApi();
    const n = await sendQQAttachments(api as any, 'c2c', 'openid-1', [
      { fetchUrl: 'https://cdn.example.com/a.png', type: 'image' },
    ]);
    expect(n).toBe(1);
    expect(api.uploadC2CRichMedia).toHaveBeenCalled();
    expect(api.sendC2CMedia).toHaveBeenCalled();
  });

  it('infers QQ file_type from attachment.type (image=1, video=2, audio=3, file=4)', async () => {
    const api = makeApi();
    await sendQQAttachments(api as any, 'group', 'gid', [
      { fetchUrl: 'https://x/a.png', type: 'image' },
      { fetchUrl: 'https://x/b.mp4', type: 'video' },
      { fetchUrl: 'https://x/c.mp3', type: 'audio' },
      { fetchUrl: 'https://x/d.pdf', type: 'file' },
    ]);
    expect(api.uploadGroupRichMedia.mock.calls.map((c) => c[1])).toEqual([1, 2, 3, 4]);
  });

  it('guild: all attachments degrade to a text-link line', async () => {
    const api = makeApi();
    const n = await sendQQAttachments(
      api as any,
      'guild',
      'cid',
      [
        { fetchUrl: 'https://cdn.example.com/a.png', type: 'image' },
        { fetchUrl: 'https://cdn.example.com/b.pdf', name: 'b.pdf', type: 'file' },
      ],
      'check this',
    );
    expect(n).toBe(0);
    expect(api.uploadGroupRichMedia).not.toHaveBeenCalled();
    // Combined into a single sendGuildMessage call
    expect(api.sendGuildMessage).toHaveBeenCalledTimes(1);
    const text = api.sendGuildMessage.mock.calls[0][1];
    expect(text).toContain('check this');
    expect(text).toContain('https://cdn.example.com/a.png');
    expect(text).toContain('b.pdf');
  });

  it('data-only attachments fall back to text-link (no public URL)', async () => {
    const api = makeApi();
    const n = await sendQQAttachments(api as any, 'group', 'gid', [
      { data: 'aGVsbG8=', name: 'inline.png', type: 'image' },
    ]);
    expect(n).toBe(0);
    expect(api.uploadGroupRichMedia).not.toHaveBeenCalled();
    const text = api.sendGroupMessage.mock.calls[0][1];
    expect(text).toContain('inline.png');
    expect(text).toContain('attachment dropped: no public URL');
  });

  it('keeps remaining media + falls back on failed upload', async () => {
    const api = makeApi();
    api.uploadGroupRichMedia
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce({ file_info: 'fi-2' });
    const n = await sendQQAttachments(api as any, 'group', 'gid', [
      { fetchUrl: 'https://x/a.png', name: 'a.png', type: 'image' },
      { fetchUrl: 'https://x/b.png', name: 'b.png', type: 'image' },
    ]);
    expect(n).toBe(1);
    expect(api.sendGroupMedia).toHaveBeenCalledTimes(1);
    // The failing attachment becomes a text-link in the fallback
    expect(api.sendGroupMessage).toHaveBeenCalledTimes(1);
    expect(api.sendGroupMessage.mock.calls[0][1]).toContain('a.png');
  });

  it('skips text leg when there is nothing to say', async () => {
    const api = makeApi();
    await sendQQAttachments(api as any, 'group', 'gid', [
      { fetchUrl: 'https://x/a.png', type: 'image' },
    ]);
    // No leadingText, no fallback lines → no text call
    expect(api.sendGroupMessage).not.toHaveBeenCalled();
    expect(api.sendGroupMedia).toHaveBeenCalledTimes(1);
  });
});
