// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramMessageService } from './service';

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

    await service.sendMessage({
      attachments: [
        { fetchUrl: 'https://cdn.example.com/a.png', type: 'image' },
        { fetchUrl: 'https://cdn.example.com/b.pdf', type: 'file' },
      ],
      channelId: 'chat-1',
      content: 'caption',
      platform: 'telegram',
    });

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
