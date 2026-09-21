// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscordMessageService } from './service';

const makeApi = () => ({
  createMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
});

describe('DiscordMessageService.sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends text-only when no attachments', async () => {
    const api = makeApi();
    const service = new DiscordMessageService(api as any);

    const result = await service.sendMessage({
      channelId: 'ch-1',
      content: 'hello',
      platform: 'discord',
    });

    expect(api.createMessage).toHaveBeenCalledWith('ch-1', 'hello', undefined, undefined);
    expect(result).toMatchObject({ channelId: 'ch-1', messageId: 'msg-1', platform: 'discord' });
  });

  it('forwards base64 attachments as multipart files', async () => {
    const api = makeApi();
    const service = new DiscordMessageService(api as any);

    await service.sendMessage({
      attachments: [
        {
          data: Buffer.from('img').toString('base64'),
          mimeType: 'image/png',
          name: 'foo.png',
          type: 'image',
        },
      ],
      channelId: 'ch-1',
      content: 'here',
      platform: 'discord',
    });

    expect(api.createMessage).toHaveBeenCalledTimes(1);
    expect(api.createMessage).toHaveBeenCalledWith(
      'ch-1',
      'here',
      expect.arrayContaining([
        expect.objectContaining({
          contentType: 'image/png',
          name: 'foo.png',
        }),
      ]),
      undefined,
    );
  });

  it('splits >10 attachments across multiple createMessage calls', async () => {
    const api = makeApi();
    const service = new DiscordMessageService(api as any);

    const attachments = Array.from({ length: 12 }, (_, i) => ({
      data: Buffer.from(`bytes-${i}`).toString('base64'),
      mimeType: 'image/png',
      name: `a${i}.png`,
      type: 'image' as const,
    }));

    await service.sendMessage({
      attachments,
      channelId: 'ch-1',
      content: 'batch',
      platform: 'discord',
    });

    expect(api.createMessage).toHaveBeenCalledTimes(2);
    // First batch carries the content
    expect(api.createMessage.mock.calls[0][0]).toBe('ch-1');
    expect(api.createMessage.mock.calls[0][1]).toBe('batch');
    expect(api.createMessage.mock.calls[0][2]).toHaveLength(10);
    // Second batch is content-empty, 2 files
    expect(api.createMessage.mock.calls[1][1]).toBe('');
    expect(api.createMessage.mock.calls[1][2]).toHaveLength(2);
  });

  it('falls back to text-only when all attachments fail to materialize', async () => {
    const api = makeApi();
    const service = new DiscordMessageService(api as any);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }) as any);

    await service.sendMessage({
      attachments: [{ fetchUrl: 'https://cdn.example.com/broken.png', type: 'image' }],
      channelId: 'ch-1',
      content: 'still send the text',
      platform: 'discord',
    });

    // Only a single text-only call should be made — no files arg.
    expect(api.createMessage).toHaveBeenCalledTimes(1);
    expect(api.createMessage).toHaveBeenCalledWith(
      'ch-1',
      'still send the text',
      undefined,
      undefined,
    );
  });
});

describe('DiscordMessageService.sendMessage embeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('normalizes embeds and sends them with the text content', async () => {
    const api = makeApi();
    const service = new DiscordMessageService(api as any);

    await service.sendMessage({
      channelId: 'ch-1',
      content: 'Daily report',
      embeds: [
        {
          color: '#22c55e',
          fields: [{ inline: true, name: 'Users', value: '100' }],
          footer: { text: 'GA4' },
          title: '📊 Daily Report',
        },
      ],
      platform: 'discord',
    });

    expect(api.createMessage).toHaveBeenCalledWith('ch-1', 'Daily report', undefined, [
      {
        color: 0x22_c5_5e,
        fields: [{ inline: true, name: 'Users', value: '100' }],
        footer: { text: 'GA4' },
        title: '📊 Daily Report',
      },
    ]);
  });

  it('omits embeds entirely when none survive normalization', async () => {
    const api = makeApi();
    const service = new DiscordMessageService(api as any);

    await service.sendMessage({
      channelId: 'ch-1',
      content: 'plain',
      embeds: [{ color: '#fff000' } as any],
      platform: 'discord',
    });

    expect(api.createMessage).toHaveBeenCalledWith('ch-1', 'plain', undefined, undefined);
  });

  it('attaches embeds only to the first batch when attachments are split', async () => {
    const api = makeApi();
    const service = new DiscordMessageService(api as any);

    const attachments = Array.from({ length: 12 }, (_, i) => ({
      data: Buffer.from(`bytes-${i}`).toString('base64'),
      mimeType: 'image/png',
      name: `a${i}.png`,
      type: 'image' as const,
    }));

    await service.sendMessage({
      attachments,
      channelId: 'ch-1',
      content: 'batch',
      embeds: [{ title: 'Card' }],
      platform: 'discord',
    });

    expect(api.createMessage).toHaveBeenCalledTimes(2);
    expect(api.createMessage.mock.calls[0][3]).toEqual([
      expect.objectContaining({ title: 'Card' }),
    ]);
    expect(api.createMessage.mock.calls[1][3]).toBeUndefined();
  });

  it('keeps embeds when all attachments fail to materialize', async () => {
    const api = makeApi();
    const service = new DiscordMessageService(api as any);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }) as any);

    await service.sendMessage({
      attachments: [{ fetchUrl: 'https://cdn.example.com/broken.png', type: 'image' }],
      channelId: 'ch-1',
      content: 'text',
      embeds: [{ title: 'Card' }],
      platform: 'discord',
    });

    expect(api.createMessage).toHaveBeenCalledWith('ch-1', 'text', undefined, [
      expect.objectContaining({ title: 'Card' }),
    ]);
  });
});

describe('DiscordMessageService.sendDirectMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates DM channel and posts text + attachments via the shared path', async () => {
    const api = {
      createDMChannel: vi.fn().mockResolvedValue({ id: 'dm-ch' }),
      createMessage: vi.fn().mockResolvedValue({ id: 'msg-dm' }),
    };
    const service = new DiscordMessageService(api as any);

    await service.sendDirectMessage!({
      attachments: [
        {
          data: Buffer.from('img').toString('base64'),
          mimeType: 'image/png',
          name: 'foo.png',
          type: 'image',
        },
      ],
      content: 'hello DM',
      platform: 'discord',
      userId: 'user-1',
    });

    expect(api.createDMChannel).toHaveBeenCalledWith('user-1');
    expect(api.createMessage).toHaveBeenCalledWith(
      'dm-ch',
      'hello DM',
      expect.arrayContaining([
        expect.objectContaining({ contentType: 'image/png', name: 'foo.png' }),
      ]),
      undefined,
    );
  });

  it('forwards embeds to the DM channel', async () => {
    const api = {
      createDMChannel: vi.fn().mockResolvedValue({ id: 'dm-ch' }),
      createMessage: vi.fn().mockResolvedValue({ id: 'msg-dm' }),
    };
    const service = new DiscordMessageService(api as any);

    await service.sendDirectMessage({
      content: 'card',
      embeds: [{ title: 'Hi' }],
      platform: 'discord',
      userId: 'user-1',
    });

    expect(api.createMessage).toHaveBeenCalledWith('dm-ch', 'card', undefined, [
      expect.objectContaining({ title: 'Hi' }),
    ]);
  });
});

describe('DiscordMessageService.replyToThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts to the thread id with attachments', async () => {
    const api = { createMessage: vi.fn().mockResolvedValue({ id: 'tr-1' }) };
    const service = new DiscordMessageService(api as any);

    await service.replyToThread({
      attachments: [{ data: Buffer.from('x').toString('base64'), name: 'x.png', type: 'image' }],
      content: 'thread reply',
      platform: 'discord',
      threadId: 'thread-id-1',
    });

    expect(api.createMessage).toHaveBeenCalledWith(
      'thread-id-1',
      'thread reply',
      expect.arrayContaining([expect.objectContaining({ name: 'x.png' })]),
      undefined,
    );
  });

  it('forwards embeds to the thread', async () => {
    const api = { createMessage: vi.fn().mockResolvedValue({ id: 'tr-2' }) };
    const service = new DiscordMessageService(api as any);

    await service.replyToThread({
      content: 'card reply',
      embeds: [{ description: 'body' }],
      platform: 'discord',
      threadId: 'thread-id-1',
    });

    expect(api.createMessage).toHaveBeenCalledWith('thread-id-1', 'card reply', undefined, [
      expect.objectContaining({ description: 'body' }),
    ]);
  });
});
