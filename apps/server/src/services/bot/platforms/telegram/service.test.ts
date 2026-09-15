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

  it('does not swallow a rejected data-only attachment as an empty success', async () => {
    const api = makeApi();
    api.sendRichMessage.mockRejectedValueOnce(
      new Error('Telegram API sendRichMessage failed: 400 DOCUMENT_INVALID'),
    );
    const service = new TelegramMessageService(api as any);

    await expect(
      service.sendMessage({
        attachments: [
          {
            data: Buffer.from('pdf').toString('base64'),
            mimeType: 'application/pdf',
            name: 'report.pdf',
            type: 'file',
          },
        ],
        channelId: 'chat-1',
        content: '',
        platform: 'telegram',
      }),
    ).rejects.toThrow('400 DOCUMENT_INVALID');
    expect(api.sendRichMessage).toHaveBeenCalledTimes(1);
  });

  it('does not treat an unsourced data-only attachment as an empty success', async () => {
    const api = makeApi();
    const service = new TelegramMessageService(api as any);

    await expect(
      service.sendMessage({
        attachments: [{ name: 'report.pdf', type: 'file' }],
        channelId: 'chat-1',
        content: '',
        platform: 'telegram',
      }),
    ).rejects.toThrow('no deliverable content');
    expect(api.sendRichMessage).not.toHaveBeenCalled();
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

  it('applies structural sanitizing when editing Rich Messages', async () => {
    const api = makeApi();
    const service = new TelegramMessageService(api as any);
    const content = Array.from({ length: 501 }, (_, index) => `block ${index}`).join('\n\n');

    await service.editMessage({
      channelId: 'chat-1',
      content,
      messageId: '42',
      platform: 'telegram',
    });

    const markdown = api.editRichMessageText.mock.calls[0]![0].richMessage.markdown;
    expect(markdown).toContain('block 499');
    expect(markdown).not.toContain('block 500');
  });
});
