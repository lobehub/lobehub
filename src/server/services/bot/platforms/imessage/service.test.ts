import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImessageMessageService } from './service';

const makeApi = () => ({
  getChatMessages: vi.fn().mockResolvedValue({
    data: [
      {
        attachments: [{ guid: 'att-1', mimeType: 'image/png', transferName: 'photo.png' }],
        dateCreated: 1_700_000_000_000,
        guid: 'msg-1',
        handle: { address: '+15551234567' },
        text: 'hello',
      },
    ],
  }),
  queryMessages: vi.fn().mockResolvedValue({
    data: [
      {
        dateCreated: 1_700_000_000_000,
        guid: 'msg-2',
        handle: { address: '+15551234567' },
        text: 'search hit',
      },
      {
        dateCreated: 1_700_000_001_000,
        guid: 'msg-3',
        handle: { address: '+15557654321' },
        text: 'other hit',
      },
    ],
    metadata: { total: 2 },
  }),
  sendAttachment: vi.fn().mockResolvedValue({ guid: 'att-sent' }),
  sendText: vi.fn().mockResolvedValue({ guid: 'text-sent' }),
});

describe('ImessageMessageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends text and attachments to the BlueBubbles chat guid', async () => {
    const api = makeApi();
    const service = new ImessageMessageService(api as any);

    const result = await service.sendMessage({
      attachments: [
        {
          data: Buffer.from('image-bytes').toString('base64'),
          mimeType: 'image/png',
          name: 'photo.png',
          type: 'image',
        },
      ],
      channelId: 'iMessage;-;chat-1',
      content: 'hello',
      platform: 'imessage',
    });

    expect(api.sendText).toHaveBeenCalledWith('iMessage;-;chat-1', 'hello');
    expect(api.sendAttachment).toHaveBeenCalledWith('iMessage;-;chat-1', {
      data: Buffer.from('image-bytes').toString('base64'),
      fetchUrl: undefined,
      mimeType: 'image/png',
      name: 'photo.png',
    });
    expect(result).toEqual({
      channelId: 'iMessage;-;chat-1',
      messageId: 'att-sent',
      platform: 'imessage',
    });
  });

  it('reads recent messages and maps BlueBubbles attachments', async () => {
    const api = makeApi();
    const service = new ImessageMessageService(api as any);

    const result = await service.readMessages({
      channelId: 'iMessage;-;chat-1',
      limit: 10,
      platform: 'imessage',
    });

    expect(api.getChatMessages).toHaveBeenCalledWith('iMessage;-;chat-1', {
      after: undefined,
      before: undefined,
      limit: 10,
      sort: 'DESC',
      withParts: ['attachments'],
    });
    expect(result.messages?.[0]).toMatchObject({
      attachments: [{ name: 'photo.png', url: 'bluebubbles:attachment:att-1' }],
      author: { id: '+15551234567', name: '+15551234567' },
      content: 'hello',
      id: 'msg-1',
    });
  });

  it('searches messages and applies optional author filtering', async () => {
    const api = makeApi();
    const service = new ImessageMessageService(api as any);

    const result = await service.searchMessages({
      authorId: '+15551234567',
      channelId: 'iMessage;-;chat-1',
      limit: 5,
      platform: 'imessage',
      query: 'hit',
    });

    expect(api.queryMessages).toHaveBeenCalledWith({
      chatGuid: 'iMessage;-;chat-1',
      limit: 5,
      sort: 'DESC',
      where: [
        {
          args: { query: '%hit%' },
          statement: 'message.text LIKE :query COLLATE NOCASE',
        },
      ],
      with: ['attachments'],
    });
    expect(result.messages).toHaveLength(1);
    expect(result.messages?.[0].id).toBe('msg-2');
    expect(result.totalFound).toBe(1);
  });

  it('keeps the query metadata total when no author filter is applied', async () => {
    const api = makeApi();
    const service = new ImessageMessageService(api as any);

    const result = await service.searchMessages({
      channelId: 'iMessage;-;chat-1',
      limit: 5,
      platform: 'imessage',
      query: 'hit',
    });

    expect(result.messages).toHaveLength(2);
    expect(result.totalFound).toBe(2);
  });
});
