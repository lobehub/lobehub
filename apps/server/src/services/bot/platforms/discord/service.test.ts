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

    expect(api.createMessage).toHaveBeenCalledWith('ch-1', 'hello');
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
    expect(api.createMessage).toHaveBeenCalledWith('ch-1', 'still send the text');
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
    );
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
    );
  });
});
