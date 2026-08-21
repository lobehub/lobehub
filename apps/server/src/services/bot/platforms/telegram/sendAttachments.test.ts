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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(Buffer.from('pdf-bytes'), { status: 200 })),
    );

    try {
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
    } finally {
      vi.unstubAllGlobals();
    }

    expect(api.sendPhoto).toHaveBeenCalledTimes(2);
    expect(api.sendDocument).toHaveBeenCalledTimes(1);
    expect(api.sendPhoto.mock.calls[0][0].caption).toBe('hello');
    expect(api.sendPhoto.mock.calls[1][0].caption).toBeUndefined();
    expect(api.sendDocument.mock.calls[0][0].caption).toBeUndefined();
  });

  it('downloads a URL-only document and uploads it as multipart instead of passing the URL', async () => {
    // Regression: `sendDocument` by URL only works for .pdf/.zip per the Bot
    // API, and the extension-less redirecting file-proxy URL fails even for
    // those — md/csv/pdf pushes all died with "wrong file identifier".
    const api = makeApi();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(Buffer.from('markdown-bytes'), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const n = await sendTelegramAttachments(api as any, 'chat-1', [
        {
          fetchUrl: 'https://app.example.com/f/file_123',
          mimeType: 'text/markdown',
          name: 'notes.md',
          type: 'file',
        },
      ]);

      expect(n).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledWith('https://app.example.com/f/file_123', expect.anything());
    expect(api.sendDocument).toHaveBeenCalledWith({
      caption: undefined,
      chatId: 'chat-1',
      source: expect.objectContaining({
        buffer: expect.any(Buffer),
        filename: 'notes.md',
        mimeType: 'text/markdown',
      }),
    });
  });

  it('sends videos as documents so soundless MP4s are not converted to GIF animations', async () => {
    const api = makeApi();

    const n = await sendTelegramAttachments(api as any, 'chat-1', [
      {
        data: Buffer.from('mp4-bytes').toString('base64'),
        mimeType: 'video/mp4',
        name: 'ad.mp4',
        type: 'video',
      },
    ]);

    expect(n).toBe(1);
    expect(api.sendVideo).not.toHaveBeenCalled();
    expect(api.sendDocument).toHaveBeenCalledWith({
      caption: undefined,
      chatId: 'chat-1',
      source: expect.objectContaining({ filename: 'ad.mp4', mimeType: 'video/mp4' }),
    });
  });

  it('skips a document whose download fails without aborting the batch', async () => {
    const api = makeApi();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

    try {
      const n = await sendTelegramAttachments(api as any, 'chat-1', [
        { fetchUrl: 'https://app.example.com/f/file_bad', name: 'bad.csv', type: 'file' },
        {
          data: Buffer.from('ok').toString('base64'),
          name: 'ok.pdf',
          type: 'file',
        },
      ]);

      expect(n).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(api.sendDocument).toHaveBeenCalledTimes(1);
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
