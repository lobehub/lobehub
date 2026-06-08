import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImessageClientFactory } from './client';

const mockExecuteMessageApi = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/deviceGateway', () => ({
  deviceGateway: {
    executeMessageApi: mockExecuteMessageApi,
  },
}));

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

const APPLICATION_ID = 'home-mac-mini';
const credentials = {
  desktopDeviceId: 'desktop-device-1',
  webhookSecret: 'shared-secret',
};

const createClient = (settings: Record<string, unknown> = {}) =>
  new ImessageClientFactory().createClient(
    {
      applicationId: APPLICATION_ID,
      credentials,
      platform: 'imessage',
      settings,
    },
    { appUrl: 'https://lobehub.example.com', userId: 'user-1' },
  );

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  mockExecuteMessageApi.mockReset();
});

describe('ImessageWebhookClient', () => {
  it('extractChatId strips the iMessage thread prefix without changing the chat guid', () => {
    const client = createClient();
    expect(client.extractChatId('imessage:iMessage;-;abc:def')).toBe('iMessage;-;abc:def');
  });

  it('createAdapter wires the Desktop bridge transport into the SDK adapter', () => {
    const client = createClient({ userId: 'operator@example.com' });
    const adapter = client.createAdapter();
    expect(adapter.imessage).toBeDefined();
    expect((adapter.imessage as any).botUserId).toBe('operator@example.com');
  });

  it('messenger.createMessage sends text through the Desktop bridge', async () => {
    mockExecuteMessageApi.mockResolvedValueOnce({
      content: JSON.stringify({ guid: 'sent-1', text: 'hello' }),
      success: true,
    });

    const client = createClient();
    const messenger = client.getMessenger('imessage:iMessage;-;chat-1');
    await messenger.createMessage('hello');

    expect(mockExecuteMessageApi).toHaveBeenCalledWith(
      { deviceId: 'desktop-device-1', userId: 'user-1' },
      {
        apiName: 'sendText',
        payload: {
          applicationId: APPLICATION_ID,
          chatGuid: 'iMessage;-;chat-1',
          message: 'hello',
          options: {},
        },
        platform: 'imessage',
      },
      60_000,
    );
  });

  it('extractFiles downloads BlueBubbles attachments through the Desktop bridge', async () => {
    mockExecuteMessageApi.mockResolvedValueOnce({
      content: JSON.stringify({
        data: Buffer.from('image-bytes').toString('base64'),
        mimeType: 'image/png',
      }),
      success: true,
    });

    const client = createClient();
    const sources = await (client as any).extractFiles({
      attachments: [
        {
          mimeType: 'image/png',
          name: 'photo.png',
          raw: {
            guid: 'att-1',
            mimeType: 'image/png',
            transferName: 'photo.png',
          },
          type: 'image',
          url: '',
        },
      ],
      id: 'merged',
    });

    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe('photo.png');
    expect(sources[0].mimeType).toBe('image/png');
    expect(sources[0].buffer.toString()).toBe('image-bytes');
    expect(mockExecuteMessageApi).toHaveBeenCalledWith(
      { deviceId: 'desktop-device-1', userId: 'user-1' },
      {
        apiName: 'downloadAttachment',
        payload: {
          applicationId: APPLICATION_ID,
          guid: 'att-1',
        },
        platform: 'imessage',
      },
      60_000,
    );
  });

  it('formatMarkdown strips Markdown and formatReply appends usage only when enabled', () => {
    const off = createClient();
    const on = createClient({ showUsageStats: true });

    expect(off.formatMarkdown!('**hi**')).toBe('hi');
    expect(off.formatReply!('body', { totalCost: 0.01, totalTokens: 42 })).toBe('body');
    expect(
      on.formatReply!('body', { elapsedMs: 1234, totalCost: 0.01, totalTokens: 42 }).startsWith(
        'body\n\n',
      ),
    ).toBe(true);
  });

  it('start verifies the Desktop bridge can reach BlueBubbles', async () => {
    mockExecuteMessageApi.mockResolvedValueOnce({
      content: JSON.stringify({ ok: true }),
      success: true,
    });

    const client = createClient();
    await client.start();

    expect(mockExecuteMessageApi).toHaveBeenCalledWith(
      { deviceId: 'desktop-device-1', userId: 'user-1' },
      {
        apiName: 'ping',
        payload: { applicationId: APPLICATION_ID },
        platform: 'imessage',
      },
      60_000,
    );
  });
});

describe('ImessageClientFactory.validateCredentials', () => {
  it('reports missing fields without hitting the Desktop bridge', async () => {
    const factory = new ImessageClientFactory();
    const result = await factory.validateCredentials({});
    expect(result.valid).toBe(false);
    const fields = (result.errors ?? []).map((e) => e.field).sort();
    expect(fields).toEqual(['applicationId', 'desktopDeviceId', 'webhookSecret']);
    expect(mockExecuteMessageApi).not.toHaveBeenCalled();
  });

  it('returns valid=true when required Desktop bridge fields are present', async () => {
    const factory = new ImessageClientFactory();
    const result = await factory.validateCredentials(credentials, undefined, APPLICATION_ID);
    expect(result.valid).toBe(true);
    expect(mockExecuteMessageApi).not.toHaveBeenCalled();
  });
});
