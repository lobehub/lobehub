import { MessagePlatformError } from '@lobechat/builtin-tool-message/executionRuntime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListPlatforms, mockListProviders, mockReadMessages, mockSendMessage } = vi.hoisted(
  () => ({
    mockListPlatforms: vi.fn(),
    mockListProviders: vi.fn(),
    mockReadMessages: vi.fn(),
    mockSendMessage: vi.fn(),
  }),
);

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    agentBotProvider: {
      list: { query: mockListProviders },
      listPlatforms: { query: mockListPlatforms },
    },
    botMessage: {
      readMessages: { query: mockReadMessages },
      sendMessage: { mutate: mockSendMessage },
    },
  },
}));

const { trpcBotProvider, trpcMessageService } = await import('./trpcAdapters');

describe('trpcBotProvider.listPlatforms', () => {
  it('does not offer a platform this deployment cannot run', async () => {
    mockListPlatforms.mockResolvedValue([
      { id: 'discord', name: 'Discord', schema: [] },
      { id: 'wecom', name: 'WeCom', schema: [], unavailableReason: 'needs an in-process server' },
    ]);

    const platforms = await trpcBotProvider.listPlatforms();

    expect(platforms.map((p) => p.id)).toEqual(['discord']);
  });
});

describe('trpcMessageService routing', () => {
  beforeEach(() => {
    mockListProviders.mockReset();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue({ messageId: 'm-1' });
  });

  it('forwards a System Bot send as-is instead of injecting a platform default botId', async () => {
    mockListProviders.mockResolvedValue([
      { enabled: true, id: 'bot-1', platform: 'wechat', runtimeStatus: 'connected' },
    ]);

    await trpcMessageService.sendMessage({
      channelId: 'wx-user@im.wechat',
      content: 'hi',
      messengerInstallationId: 'link-1',
      platform: 'wechat',
    });

    expect(mockSendMessage).toHaveBeenCalledWith({
      channelId: 'wx-user@im.wechat',
      content: 'hi',
      messengerInstallationId: 'link-1',
    });
    expect(mockListProviders).not.toHaveBeenCalled();
  });

  it('skips failed bots when resolving the platform default', async () => {
    mockListProviders.mockResolvedValue([
      { enabled: true, id: 'bot-failed', platform: 'wechat', runtimeStatus: 'failed' },
      { enabled: true, id: 'bot-ok', platform: 'wechat', runtimeStatus: 'connected' },
    ]);

    await trpcMessageService.sendMessage({
      channelId: 'wx-user@im.wechat',
      content: 'hi',
      platform: 'wechat',
    });

    expect(mockSendMessage).toHaveBeenCalledWith({
      botId: 'bot-ok',
      channelId: 'wx-user@im.wechat',
      content: 'hi',
    });
  });
});

describe('trpcMessageService platform errors', () => {
  const errorData = {
    code: 'DISCORD_MISSING_ACCESS',
    hint: "Ask a server admin to give the bot's role View Channel.",
    kind: 'stop',
    message: 'Missing Access (Discord 50001): this bot cannot see channel c1.',
    platformCode: 50_001,
    status: 403,
  };

  it('rebuilds the reason the server sent as errorData', async () => {
    mockReadMessages.mockRejectedValue(
      Object.assign(new Error(errorData.message), {
        data: { code: 'INTERNAL_SERVER_ERROR', errorData },
      }),
    );

    const error = await trpcMessageService
      .readMessages({ botId: 'bot-1', channelId: 'c1', platform: 'discord' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MessagePlatformError);
    expect((error as MessagePlatformError).data).toEqual(errorData);
  });

  it('passes other errors through', async () => {
    const plain = Object.assign(new Error('UNAUTHORIZED'), { data: { code: 'UNAUTHORIZED' } });
    mockReadMessages.mockRejectedValue(plain);

    await expect(
      trpcMessageService.readMessages({ botId: 'bot-1', channelId: 'c1', platform: 'discord' }),
    ).rejects.toBe(plain);
  });
});
