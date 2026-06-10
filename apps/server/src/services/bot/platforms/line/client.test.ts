import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LineClientFactory } from './client';

const fetchSpy = vi.spyOn(globalThis, 'fetch');

const APPLICATION_ID = 'Ubotbotbotbotbotbotbotbotbotbotbo';

const createClient = () =>
  new LineClientFactory().createClient(
    {
      applicationId: APPLICATION_ID,
      credentials: {
        channelAccessToken: 'token-test',
        channelSecret: 'secret-test',
      },
      platform: 'line',
      settings: {},
    },
    {},
  );

beforeEach(() => {
  vi.mock('@/server/services/gateway/runtimeStatus', () => ({
    BOT_RUNTIME_STATUSES: {
      connected: 'connected',
      disconnected: 'disconnected',
      failed: 'failed',
      starting: 'starting',
    },
    getRuntimeStatusErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown'),
    updateBotRuntimeStatus: vi.fn().mockResolvedValue(undefined),
  }));
});

afterEach(() => {
  fetchSpy.mockReset();
});

describe('LineWebhookClient', () => {
  it('formatMarkdown strips Markdown to plain text via stripMarkdown', () => {
    const client = createClient();
    expect(client.formatMarkdown!('**hi**')).toBe('hi');
    expect(client.formatMarkdown!('# Title')).toBe('Title');
  });

  it('extractChatId pulls the recipient id out of all three thread variants', () => {
    const client = createClient();
    expect(client.extractChatId('line:user:U1234567890abcdef1234567890abcdef')).toBe(
      'U1234567890abcdef1234567890abcdef',
    );
    expect(client.extractChatId('line:group:Cgroupgroupgroupgroupgroupgroupgr')).toBe(
      'Cgroupgroupgroupgroupgroupgroupgr',
    );
    expect(client.extractChatId('line:room:Rroomroomroomroomroomroomroomroom')).toBe(
      'Rroomroomroomroomroomroomroomroom',
    );
  });

  it('createAdapter wires the credentials into the SDK adapter', () => {
    const client = createClient();
    const adapter = client.createAdapter();
    expect(adapter.line).toBeDefined();
    expect((adapter.line as any).botUserId).toBe(APPLICATION_ID);
  });

  it('messenger.createMessage POSTs to /v2/bot/message/push', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
    const client = createClient();
    const messenger = client.getMessenger('line:user:U1234567890abcdef1234567890abcdef');
    await messenger.createMessage('hi back');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-test');
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe('U1234567890abcdef1234567890abcdef');
    expect(body.messages).toEqual([{ text: 'hi back', type: 'text' }]);
  });

  it('messenger.triggerTyping is a no-op for group + room threads', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
    const client = createClient();
    const groupMessenger = client.getMessenger('line:group:Cgroupgroupgroupgroupgroupgroupgr');
    await groupMessenger.triggerTyping!();
    const roomMessenger = client.getMessenger('line:room:Rroomroomroomroomroomroomroomroom');
    await roomMessenger.triggerTyping!();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('messenger.triggerTyping calls the loading API for user threads', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));
    const client = createClient();
    const messenger = client.getMessenger('line:user:U1234567890abcdef1234567890abcdef');
    await messenger.triggerTyping!();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.line.me/v2/bot/chat/loading/start');
    const body = JSON.parse(init.body as string);
    expect(body.chatId).toBe('U1234567890abcdef1234567890abcdef');
  });

  it('extractFiles downloads media for each merged attachment, even when message.raw is text', async () => {
    // Simulates BotMessageRouter.mergeSkippedMessages: user sent an image then a
    // text immediately after. The merged Message has the image attachment but
    // its `raw` now points at the trailing text event.
    fetchSpy
      .mockResolvedValueOnce(new Response(Buffer.from('image-bytes'), { status: 200 }))
      .mockResolvedValueOnce(new Response(Buffer.from('audio-bytes'), { status: 200 }));

    const client = createClient();
    const merged = {
      attachments: [
        {
          mimeType: 'image/jpeg',
          name: 'image.jpg',
          raw: { id: 'line-image-1', mimeType: 'image/jpeg', type: 'image' },
          type: 'image',
          url: '',
        },
        {
          mimeType: 'audio/m4a',
          name: 'audio.m4a',
          raw: { id: 'line-audio-1', mimeType: 'audio/m4a', type: 'audio' },
          type: 'audio',
          url: '',
        },
      ],
      id: 'merged',
      raw: { id: 'line-text-1', text: 'follow-up text', type: 'text' },
    };

    const sources = await (client as any).extractFiles(merged);
    expect(sources).toHaveLength(2);
    expect(sources[0].name).toBe('image.jpg');
    expect(sources[0].mimeType).toBe('image/jpeg');
    expect(sources[0].buffer.toString()).toBe('image-bytes');
    expect(sources[1].name).toBe('audio.m4a');
    expect(sources[1].buffer.toString()).toBe('audio-bytes');

    const urls = fetchSpy.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      'https://api-data.line.me/v2/bot/message/line-image-1/content',
      'https://api-data.line.me/v2/bot/message/line-audio-1/content',
    ]);
  });

  it('extractFiles returns undefined when no attachments carry a media id', async () => {
    const client = createClient();
    const result = await (client as any).extractFiles({
      attachments: [],
      id: 'm',
      raw: { id: 'line-text-1', text: 'hello', type: 'text' },
    });
    expect(result).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('formatReply appends usage stats only when showUsageStats=true', () => {
    const factory = new LineClientFactory();
    const baseConfig = {
      applicationId: APPLICATION_ID,
      credentials: { channelAccessToken: 't', channelSecret: 's' },
      platform: 'line',
    };
    const off = factory.createClient({ ...baseConfig, settings: {} }, {});
    const on = factory.createClient({ ...baseConfig, settings: { showUsageStats: true } }, {});

    const stats = { elapsedMs: 1234, totalCost: 0.01, totalTokens: 42 };
    expect(off.formatReply!('body', stats)).toBe('body');
    expect(on.formatReply!('body', stats).startsWith('body\n\n')).toBe(true);
  });
});

describe('LineClientFactory.validateCredentials', () => {
  it('reports missing fields without hitting the network', async () => {
    const factory = new LineClientFactory();
    const result = await factory.validateCredentials({});
    expect(result.valid).toBe(false);
    const fields = (result.errors ?? []).map((e) => e.field).sort();
    expect(fields).toEqual(['applicationId', 'channelAccessToken', 'channelSecret']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns valid=true when getBotInfo matches the configured applicationId', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ userId: APPLICATION_ID }), { status: 200 }),
    );
    const factory = new LineClientFactory();
    const result = await factory.validateCredentials(
      { channelAccessToken: 'good', channelSecret: 's' },
      undefined,
      APPLICATION_ID,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects when the token belongs to a different bot than configured', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ userId: 'Uotherbotid' }), { status: 200 }),
    );
    const factory = new LineClientFactory();
    const result = await factory.validateCredentials(
      { channelAccessToken: 'good', channelSecret: 's' },
      undefined,
      APPLICATION_ID,
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]?.field).toBe('applicationId');
    expect(result.errors?.[0]?.message).toContain('Uotherbotid');
  });

  it('surfaces the LINE error envelope message when the token is rejected', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Authentication failed.' }), { status: 401 }),
    );
    const factory = new LineClientFactory();
    const result = await factory.validateCredentials(
      { channelAccessToken: 'bad', channelSecret: 's' },
      undefined,
      APPLICATION_ID,
    );
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]?.message).toContain('Authentication failed.');
  });
});
