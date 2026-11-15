import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListPlatforms, mockListProviders, mockSendMessage } = vi.hoisted(() => ({
  mockListPlatforms: vi.fn(),
  mockListProviders: vi.fn(),
  mockSendMessage: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    agentBotProvider: {
      list: { query: mockListProviders },
      listPlatforms: { query: mockListPlatforms },
    },
    botMessage: { sendMessage: { mutate: mockSendMessage } },
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
