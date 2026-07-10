// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sendTelegramAttachments } from './sendAttachments';

const makeApi = () => ({
  sendAudio: vi.fn().mockResolvedValue({ message_id: 1 }),
  sendDocument: vi.fn().mockResolvedValue({ message_id: 1 }),
  sendPhoto: vi.fn().mockResolvedValue({ message_id: 1 }),
  sendVideo: vi.fn().mockResolvedValue({ message_id: 1 }),
});

describe('sendTelegramAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches to sendPhoto for image with URL source', async () => {
    const api = makeApi();

    const n = await sendTelegramAttachments(
      api as any,
      'chat-1',
      [{ fetchUrl: 'https://cdn.example.com/foo.png', name: 'foo.png', type: 'image' }],
      'caption text',
    );

    expect(n).toBe(1);
    expect(api.sendPhoto).toHaveBeenCalledWith({
      caption: 'caption text',
      chatId: 'chat-1',
      source: { url: 'https://cdn.example.com/foo.png' },
    });
  });

  it('dispatches to sendDocument for file with base64 data → Buffer', async () => {
    const api = makeApi();

    const n = await sendTelegramAttachments(api as any, 'chat-1', [
      {
        data: Buffer.from('pdf-bytes').toString('base64'),
        mimeType: 'application/pdf',
        name: 'doc.pdf',
        type: 'file',
      },
    ]);

    expect(n).toBe(1);
    expect(api.sendDocument).toHaveBeenCalledWith({
      caption: undefined,
      chatId: 'chat-1',
      source: expect.objectContaining({
        buffer: expect.any(Buffer),
        filename: 'doc.pdf',
        mimeType: 'application/pdf',
      }),
    });
  });

  it('only carries the caption on the first attachment', async () => {
    const api = makeApi();

    await sendTelegramAttachments(
      api as any,
      'chat-1',
      [
        { fetchUrl: 'https://cdn.example.com/a.png', type: 'image' },
        { fetchUrl: 'https://cdn.example.com/b.png', type: 'image' },
        { fetchUrl: 'https://cdn.example.com/c.pdf', type: 'file' },
      ],
      'hello',
    );

    expect(api.sendPhoto).toHaveBeenCalledTimes(2);
    expect(api.sendDocument).toHaveBeenCalledTimes(1);
    expect(api.sendPhoto.mock.calls[0][0].caption).toBe('hello');
    expect(api.sendPhoto.mock.calls[1][0].caption).toBeUndefined();
    expect(api.sendDocument.mock.calls[0][0].caption).toBeUndefined();
  });

  it('continues with remaining attachments when one fails', async () => {
    const api = makeApi();
    api.sendPhoto
      .mockRejectedValueOnce(new Error('Telegram 429'))
      .mockResolvedValueOnce({ message_id: 2 });

    const n = await sendTelegramAttachments(api as any, 'chat-1', [
      { fetchUrl: 'https://cdn.example.com/a.png', type: 'image' },
      { fetchUrl: 'https://cdn.example.com/b.png', type: 'image' },
    ]);

    expect(n).toBe(1);
    expect(api.sendPhoto).toHaveBeenCalledTimes(2);
  });

  it('skips attachments with no resolvable source', async () => {
    const api = makeApi();

    const n = await sendTelegramAttachments(api as any, 'chat-1', [
      { type: 'image' } as any, // no data, no fetchUrl
      { fetchUrl: 'https://cdn.example.com/b.png', type: 'image' },
    ]);

    expect(n).toBe(1);
    expect(api.sendPhoto).toHaveBeenCalledTimes(1);
  });
});
