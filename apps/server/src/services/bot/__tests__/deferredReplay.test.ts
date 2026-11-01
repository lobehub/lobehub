import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunBot = vi.hoisted(() => vi.fn());
const mockRunMessenger = vi.hoisted(() => vi.fn());
const mockPublish = vi.hoisted(() => vi.fn().mockResolvedValue({ messageId: 'queued' }));
const config = vi.hoisted(() => ({
  APP_URL: 'https://example.com',
  enableQueueAgentRuntime: false,
}));
vi.mock('@/envs/app', () => ({ appEnv: config }));
vi.mock('../BotMessageRouter', () => ({
  getBotMessageRouter: () => ({ replayDeferredMessages: mockRunBot }),
}));
vi.mock('@/server/services/messenger/MessengerRouter', () => ({
  getMessengerRouter: () => ({ replayDeferredMessages: mockRunMessenger }),
}));
vi.mock('@/libs/qstash', () => ({
  OtelQstashClient: class {
    publishJSON = mockPublish;
  },
}));

const { scheduleDeferredReplay } = await import('../deferredReplay');
const target = { applicationId: 'app', platform: 'wechat', platformThreadId: 'wechat:single:user' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  config.enableQueueAgentRuntime = false;
  vi.stubEnv('AGENT_RUNTIME_BASE_URL', '');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('independent deferred replay retries', () => {
  it.each([false, true])(
    'retries a failed local delivery without another completion (messenger=%s)',
    async (messenger) => {
      const replay = messenger ? mockRunMessenger : mockRunBot;
      replay
        .mockRejectedValueOnce(new Error('temporary adapter error'))
        .mockResolvedValue(undefined);
      await scheduleDeferredReplay(
        { ...target, ...(messenger ? { messengerInstallationKey: 'wechat:singleton' } : {}) },
        'op-1',
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(replay).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(replay).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(replay).toHaveBeenCalledTimes(2);
    },
  );

  it('publishes a deduplicated replay-only job with bounded provider retries', async () => {
    config.enableQueueAgentRuntime = true;
    vi.stubEnv('QSTASH_TOKEN', 'example-token');
    await scheduleDeferredReplay(target, 'op-1');
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ operationId: 'op-1', payload: target }),
        deduplicationId: expect.stringMatching(/^[a-f\d]{64}$/),
        retries: 8,
        retryDelay: '60000',
        url: 'https://example.com/api/agent/webhooks/bot-replay',
      }),
    );
    expect(mockPublish.mock.calls[0][0].body.payload).not.toHaveProperty('lastAssistantContent');
  });
});
