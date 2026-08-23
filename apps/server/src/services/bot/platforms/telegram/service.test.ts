// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as PublicUrlFetchModule from '../publicUrlFetch';
import { TelegramMessageService } from './service';

// These tests stub `fetch` directly; the SSRF guard in front of it resolves DNS
// for real, which has nothing to do with what they assert. Its own behaviour is
// covered in publicUrlFetch.test.ts.
vi.mock('../publicUrlFetch', async () => ({
  // Spread the real module: a full mock silently drops every export it
  // does not name, so adding one to publicUrlFetch breaks suites that
  // never cared about it.
  ...(await vi.importActual<typeof PublicUrlFetchModule>('../publicUrlFetch')),
  fetchPublicUrl: async (url: string, timeoutMs: number) => ({
    dispose: async () => undefined,
    response: await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }),
  }),
}));

const makeApi = () => ({
  sendAudio: vi.fn().mockResolvedValue({ message_id: 1 }),
  sendDocument: vi.fn().mockResolvedValue({ message_id: 1 }),
  sendMessage: vi.fn().mockResolvedValue({ message_id: 10 }),
  sendPhoto: vi.fn().mockResolvedValue({ message_id: 1 }),
  sendVideo: vi.fn().mockResolvedValue({ message_id: 1 }),
});

describe('TelegramMessageService.sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses sendMessage when no attachments', async () => {
    const api = makeApi();
    const service = new TelegramMessageService(api as any);

    const result = await service.sendMessage({
      channelId: 'chat-1',
      content: 'hello',
      platform: 'telegram',
    });

    expect(api.sendMessage).toHaveBeenCalledWith('chat-1', 'hello');
    expect(api.sendPhoto).not.toHaveBeenCalled();
    expect(result.messageId).toBe('10');
  });

  it('dispatches attachments to typed media methods with content as caption', async () => {
    const api = makeApi();
    const service = new TelegramMessageService(api as any);
    // Documents are uploaded as bytes now (a URL only works for .pdf/.zip and
    // fails outright for the extension-less file proxy), so the document leg
    // has to materialize before `sendDocument` is reached.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(Buffer.from('pdf-bytes'), { status: 200 })),
    );

    try {
      await service.sendMessage({
        attachments: [
          { fetchUrl: 'https://cdn.example.com/a.png', type: 'image' },
          { fetchUrl: 'https://cdn.example.com/b.pdf', type: 'file' },
        ],
        channelId: 'chat-1',
        content: 'caption',
        platform: 'telegram',
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.sendPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ caption: 'caption', chatId: 'chat-1' }),
    );
    expect(api.sendDocument).toHaveBeenCalledWith(expect.objectContaining({ caption: undefined }));
  });

  it('falls back to text sendMessage when all attachments fail', async () => {
    const api = makeApi();
    api.sendPhoto.mockRejectedValueOnce(new Error('429'));
    const service = new TelegramMessageService(api as any);

    await service.sendMessage({
      attachments: [{ fetchUrl: 'https://cdn.example.com/a.png', type: 'image' }],
      channelId: 'chat-1',
      content: 'still send',
      platform: 'telegram',
    });

    expect(api.sendPhoto).toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledWith('chat-1', 'still send');
  });
});
