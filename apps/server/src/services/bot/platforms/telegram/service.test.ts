// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramMessageService } from './service';

const makeApi = () => ({
  editRichMessageText: vi.fn().mockResolvedValue(undefined),
  sendRichMessage: vi.fn().mockResolvedValue({ message_id: 10 }),
});

describe('TelegramMessageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends text through Rich Messages', async () => {
    const api = makeApi();
    const service = new TelegramMessageService(api as any);

    const result = await service.sendMessage({
      channelId: 'chat-1',
      content: '# hello',
      platform: 'telegram',
    });

    expect(api.sendRichMessage).toHaveBeenCalledWith({
      chatId: 'chat-1',
      richMessage: { markdown: '# hello' },
      uploads: [],
    });
    expect(result.messageId).toBe('10');
  });

  it('embeds attachments in the same Rich Message', async () => {
    const api = makeApi();
    const service = new TelegramMessageService(api as any);

    await service.sendMessage({
      attachments: [{ fetchUrl: 'https://cdn.example.com/a.png', type: 'image' }],
      channelId: 'chat-1',
      content: 'caption',
      platform: 'telegram',
    });

    expect(api.sendRichMessage).toHaveBeenCalledWith({
      chatId: 'chat-1',
      richMessage: {
        markdown: 'caption\n\n![](tg://photo?id=media_0)',
        media: [
          {
            id: 'media_0',
            media: { media: 'https://cdn.example.com/a.png', type: 'photo' },
          },
        ],
      },
      uploads: [],
    });
  });

  it('edits text through Rich Messages', async () => {
    const api = makeApi();
    const service = new TelegramMessageService(api as any);

    await service.editMessage({
      channelId: 'chat-1',
      content: '**updated**',
      messageId: '42',
      platform: 'telegram',
    });

    expect(api.editRichMessageText).toHaveBeenCalledWith({
      chatId: 'chat-1',
      messageId: 42,
      richMessage: { markdown: '**updated**' },
    });
  });
});
