import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListProviders, mockSendMessage } = vi.hoisted(() => ({
  mockListProviders: vi.fn(),
  mockSendMessage: vi.fn(),
}));

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    agentBotProvider: { list: { query: mockListProviders } },
    botMessage: { sendMessage: { mutate: mockSendMessage } },
  },
}));

const { trpcMessageService } = await import('./trpcAdapters');

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
