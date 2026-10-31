import { DEFAULT_BOT_DEBOUNCE_MS } from '@lobechat/const';
import { Chat } from 'chat';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from './index';
import {
  FAKE_DB,
  FAKE_GATEKEEPER,
  makeProvider,
  mockAgentBridgeServiceCtor,
  mockBuildReplayMessages,
  mockChatWebhooks,
  mockCreateAdapter,
  mockDrainDeferredBotMessages,
  mockFindEnabledByPlatform,
  mockGetAgentRuntimeRedisClient,
  mockInitialize,
  mockOnNewMention,
  mockOnNewMessage,
  mockOnSubscribedMessage,
  mockProcessMessage,
  mockReconcileWebhook,
  mockWebhookHandler,
  resetBotMessageRouterMocks,
} from './testUtils';

vi.mock('@/database/core/db-adaptor', async () => (await import('./testUtils')).dbAdaptorModule());
vi.mock('@/database/models/agentBotProvider', async () =>
  (await import('./testUtils')).agentBotProviderModule(),
);
vi.mock('../dmPairingStore', async () => (await import('./testUtils')).dmPairingStoreModule());
vi.mock('@/server/modules/KeyVaultsEncrypt', async () =>
  (await import('./testUtils')).keyVaultsEncryptModule(),
);
vi.mock('@/server/modules/AgentRuntime/redis', async () =>
  (await import('./testUtils')).redisModule(),
);
vi.mock('@/business/server/bot/featureAccess', async () =>
  (await import('./testUtils')).featureAccessModule(),
);
vi.mock('@/envs/app', async () => (await import('./testUtils')).appModule());
vi.mock('@chat-adapter/state-ioredis', async () =>
  (await import('./testUtils')).stateIoredisModule(),
);
vi.mock('chat', async () => (await import('./testUtils')).chatModule());
vi.mock('../deferredMessages', async () => (await import('./testUtils')).deferredMessagesModule());
vi.mock('../mergeMessages', async (importOriginal) =>
  (await import('./testUtils')).mergeMessagesModule(importOriginal),
);
vi.mock('@/server/services/aiAgent', async () => (await import('./testUtils')).aiAgentModule());
vi.mock('../AgentBridgeService', async () =>
  (await import('./testUtils')).agentBridgeServiceModule(),
);
vi.mock('../platforms', async () => (await import('./testUtils')).platformsModule());

describe('BotMessageRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBotMessageRouterMocks();
  });

  describe('getWebhookHandler', () => {
    it('should return 404 for unknown platform', async () => {
      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('unknown');

      const req = new Request('https://example.com/webhook', { method: 'POST' });
      const resp = await handler(req);

      expect(resp.status).toBe(404);
      expect(await resp.text()).toBe('No bot configured for this platform');
    });

    it('should return a handler function', () => {
      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'app-123');

      expect(typeof handler).toBe('function');
    });

    it('forwards webhook lifecycle options to Chat SDK', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: 'tg-bot-123' })]);
      const options = { waitUntil: vi.fn() };
      const router = new BotMessageRouter();

      await router.getWebhookHandler('telegram', 'tg-bot-123')(
        new Request('https://example.com/webhook', { body: '{}', method: 'POST' }),
        options,
      );

      expect(mockWebhookHandler).toHaveBeenCalledWith(expect.any(Request), options);
    });
  });

  describe('on-demand loading', () => {
    it('should load bot on first webhook request', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: 'tg-bot-123' })]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'tg-bot-123');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req);

      // Should only query the specific platform, not all platforms
      expect(mockFindEnabledByPlatform).toHaveBeenCalledTimes(1);
      expect(mockFindEnabledByPlatform).toHaveBeenCalledWith(FAKE_DB, 'telegram', FAKE_GATEKEEPER);

      // Chat SDK should be initialized
      expect(mockInitialize).toHaveBeenCalled();
      expect(mockCreateAdapter).toHaveBeenCalled();
    });

    it('passes provider workspaceId to AgentBridgeService', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'tg-bot-123', workspaceId: 'workspace-1' }),
      ]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'tg-bot-123');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req);

      expect(mockAgentBridgeServiceCtor).toHaveBeenCalledWith(FAKE_DB, 'user-1', 'workspace-1');
    });

    it('should return cached bot on subsequent requests', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: 'tg-bot-123' })]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'tg-bot-123');

      const req1 = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req1);

      const req2 = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req2);

      // DB should only be queried once — second call uses cache
      expect(mockFindEnabledByPlatform).toHaveBeenCalledTimes(1);
      expect(mockInitialize).toHaveBeenCalledTimes(1);
    });

    it('should return 404 when no provider found in DB', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'non-existent');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      const resp = await handler(req);

      expect(resp.status).toBe(404);
    });

    it('should return 400 when appId is missing for generic platform', async () => {
      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      const resp = await handler(req);

      expect(resp.status).toBe(400);
    });

    describe('unverified webhook self-heal', () => {
      const post = (headers?: Record<string, string>) =>
        new Request('https://example.com/webhook', { body: '{}', headers, method: 'POST' });

      beforeEach(() => {
        for (const key of Object.keys(mockChatWebhooks)) delete mockChatWebhooks[key];
        mockGetAgentRuntimeRedisClient.mockReturnValue(null);
        vi.useRealTimers();
      });

      it('asks the client to re-register its webhook when the adapter rejects an update with 401', async () => {
        mockFindEnabledByPlatform.mockResolvedValue([
          makeProvider({ applicationId: 'tg-bot-123' }),
        ]);
        mockChatWebhooks.telegram = vi
          .fn()
          .mockResolvedValue(new Response('Invalid secret token', { status: 401 }));

        const router = new BotMessageRouter();
        const handler = router.getWebhookHandler('telegram', 'tg-bot-123');
        const resp = await handler(post());

        // The 401 is still returned so Telegram retries the update…
        expect(resp.status).toBe(401);
        // …and by then the webhook carries the current secret.
        expect(mockReconcileWebhook).toHaveBeenCalledTimes(1);
      });

      it('re-registers at most once per cooldown window even under a flood of 401s', async () => {
        vi.useFakeTimers();
        mockFindEnabledByPlatform.mockResolvedValue([
          makeProvider({ applicationId: 'tg-bot-123' }),
        ]);
        mockChatWebhooks.telegram = vi
          .fn()
          .mockResolvedValue(new Response('Invalid secret token', { status: 401 }));

        const router = new BotMessageRouter();
        const handler = router.getWebhookHandler('telegram', 'tg-bot-123');
        await handler(post());
        await handler(post());
        await handler(post());
        expect(mockReconcileWebhook).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(5 * 60 * 1000 + 1);
        await handler(post());
        expect(mockReconcileWebhook).toHaveBeenCalledTimes(2);
      });

      it('shares the cooldown across instances through Redis SET NX when a client is available', async () => {
        const redisSet = vi.fn().mockResolvedValueOnce('OK').mockResolvedValue(null);
        mockGetAgentRuntimeRedisClient.mockReturnValue({ set: redisSet } as any);
        mockFindEnabledByPlatform.mockResolvedValue([
          makeProvider({ applicationId: 'tg-bot-123' }),
        ]);
        mockChatWebhooks.telegram = vi
          .fn()
          .mockResolvedValue(new Response('Invalid secret token', { status: 401 }));

        // Two routers stand in for two serverless instances with independent memory.
        const a = new BotMessageRouter().getWebhookHandler('telegram', 'tg-bot-123');
        const b = new BotMessageRouter().getWebhookHandler('telegram', 'tg-bot-123');
        await a(post());
        await b(post());

        expect(redisSet).toHaveBeenCalledTimes(2);
        expect(redisSet).toHaveBeenCalledWith(
          'bot:webhook-reconcile:telegram:tg-bot-123',
          '1',
          'EX',
          300,
          'NX',
        );
        // Only the instance that won the NX slot re-registers.
        expect(mockReconcileWebhook).toHaveBeenCalledTimes(1);
      });

      it('falls back to the in-memory cooldown when Redis errors', async () => {
        mockGetAgentRuntimeRedisClient.mockReturnValue({
          set: vi.fn().mockRejectedValue(new Error('redis down')),
        } as any);
        mockFindEnabledByPlatform.mockResolvedValue([
          makeProvider({ applicationId: 'tg-bot-123' }),
        ]);
        mockChatWebhooks.telegram = vi
          .fn()
          .mockResolvedValue(new Response('Invalid secret token', { status: 401 }));

        const handler = new BotMessageRouter().getWebhookHandler('telegram', 'tg-bot-123');
        await handler(post());
        await handler(post());

        expect(mockReconcileWebhook).toHaveBeenCalledTimes(1);
      });

      it('awaits the re-registration before answering, so a serverless host cannot cancel it', async () => {
        let resolveReconcile!: () => void;
        mockReconcileWebhook.mockImplementationOnce(function () {
          return new Promise<void>((r) => {
            resolveReconcile = r;
          });
        });
        mockFindEnabledByPlatform.mockResolvedValue([
          makeProvider({ applicationId: 'tg-bot-123' }),
        ]);
        mockChatWebhooks.telegram = vi
          .fn()
          .mockResolvedValue(new Response('Invalid secret token', { status: 401 }));

        const handler = new BotMessageRouter().getWebhookHandler('telegram', 'tg-bot-123');
        let settled = false;
        const pending = handler(post()).then((r) => {
          settled = true;
          return r;
        });
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
        expect(mockReconcileWebhook).toHaveBeenCalledTimes(1);
        expect(settled).toBe(false);

        resolveReconcile();
        expect((await pending).status).toBe(401);
      });

      it('does not touch the webhook registration when the adapter accepts the update', async () => {
        mockFindEnabledByPlatform.mockResolvedValue([
          makeProvider({ applicationId: 'tg-bot-123' }),
        ]);
        mockChatWebhooks.telegram = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }));

        const router = new BotMessageRouter();
        const handler = router.getWebhookHandler('telegram', 'tg-bot-123');
        const resp = await handler(post({ 'x-telegram-bot-api-secret-token': 's' }));

        expect(resp.status).toBe(200);
        expect(mockReconcileWebhook).not.toHaveBeenCalled();
      });
    });

    it('should handle DB errors gracefully', async () => {
      mockFindEnabledByPlatform.mockRejectedValue(new Error('DB connection failed'));

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'app-123');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      const resp = await handler(req);

      // Should return 404, not throw
      expect(resp.status).toBe(404);
    });
  });

  describe('handler registration', () => {
    it('should always register onNewMention and onSubscribedMessage', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: 'tg-123' })]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'tg-123');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req);

      expect(mockOnNewMention).toHaveBeenCalled();
      expect(mockOnSubscribedMessage).toHaveBeenCalled();
    });

    it('should register onNewMessage when DM policy is not disabled', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'tg-123',
          settings: { dmPolicy: 'open' },
        }),
      ]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'tg-123');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req);

      // Called twice: once for text-based slash commands, once for DM catch-all
      expect(mockOnNewMessage).toHaveBeenCalledTimes(2);
    });

    it('should NOT register DM onNewMessage when DM policy is disabled', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'app-123',
          // Bot-wake off too: with it on, the catch-all also listens to channel chatter.
          settings: { botWakeDisabled: true, dmPolicy: 'disabled' },
        }),
      ]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'app-123');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req);

      // Called once for text-based slash commands only, no DM catch-all
      expect(mockOnNewMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrency strategy wiring', () => {
    const loadWith = async (settings: Record<string, unknown>, platform = 'telegram') => {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({ applicationId: 'app-1', settings }),
      ]);
      const router = new BotMessageRouter();
      await router.getWebhookHandler(
        platform,
        'app-1',
      )(new Request('https://example.com/webhook', { body: '{}', method: 'POST' }));
      return (Chat as unknown as { mock: { calls: any[][] } }).mock.calls.at(-1)![0];
    };

    it('collects a burst window when the channel asks for it', async () => {
      // The strategy a WeChat channel needs so an image and the sentence about
      // it reach the agent as one turn instead of two separate runs.
      const config = await loadWith({ concurrency: 'burst', debounceMs: 1200 });

      expect(config.concurrency).toEqual({ debounceMs: 1200, strategy: 'burst' });
    });

    it('still supports debounce for channels that opted into it', async () => {
      const config = await loadWith({ concurrency: 'debounce', debounceMs: 900 });

      expect(config.concurrency).toEqual({ debounceMs: 900, strategy: 'debounce' });
    });

    it('falls back to the plain queue when the setting is absent or unknown', async () => {
      expect((await loadWith({})).concurrency).toBe('queue');
      expect((await loadWith({ concurrency: 'nonsense' })).concurrency).toBe('queue');
    });

    it('rescues a WeChat channel still carrying the pre-burst queue setting', async () => {
      // Live WeChat channels persisted `queue` plus the old 5s window when they
      // were created, so a schema default alone would never reach them. They
      // collect a burst regardless, on the platform's own window — 5s in front
      // of every reply would read as a dead bot.
      const config = await loadWith({ concurrency: 'queue', debounceMs: 5000 }, 'wechat');

      expect(config.concurrency).toEqual({
        debounceMs: DEFAULT_BOT_DEBOUNCE_MS,
        strategy: 'burst',
      });
    });
  });

  describe('replayDeferredMessages', () => {
    const THREAD = 'telegram:chat-1';

    beforeEach(() => {
      mockDrainDeferredBotMessages.mockResolvedValue([]);
      mockBuildReplayMessages.mockReset();
      mockProcessMessage.mockResolvedValue(undefined);
      mockCreateAdapter.mockReturnValue({ telegram: { type: 'mock-adapter' } });
    });

    it('re-dispatches each original through Chat.processMessage with the platform adapter', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: 'tg-bot-123' })]);
      const entries = [{ id: 'm1' }, { id: 'm2' }];
      const replays = [
        { id: 'm1:replay:1:0', text: 'first' },
        { id: 'm2:replay:1:1', text: 'second' },
      ];
      mockDrainDeferredBotMessages.mockResolvedValue(entries);
      mockBuildReplayMessages.mockReturnValue(replays);

      const router = new BotMessageRouter();
      await router.replayDeferredMessages('telegram', 'tg-bot-123', THREAD);

      expect(mockDrainDeferredBotMessages).toHaveBeenCalledWith('tg-bot-123', THREAD);
      expect(mockBuildReplayMessages).toHaveBeenCalledWith(entries);
      expect(mockProcessMessage).toHaveBeenCalledTimes(2);
      for (const replay of replays) {
        expect(mockProcessMessage).toHaveBeenCalledWith({ type: 'mock-adapter' }, THREAD, replay);
      }
    });

    it('settles every replay with bounded concurrency and rethrows the first failure', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: 'tg-bot-123' })]);
      const replays = Array.from({ length: 6 }, (_, index) => ({ id: `m${index}` }));
      mockDrainDeferredBotMessages.mockResolvedValue(replays);
      mockBuildReplayMessages.mockReturnValue(replays);

      let inFlight = 0;
      let maxInFlight = 0;
      const failure = new Error('replay m1 failed');
      mockProcessMessage.mockImplementation(async (_adapter, _thread, message: { id: string }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        if (message.id === 'm1') throw failure;
      });

      const router = new BotMessageRouter();
      await expect(router.replayDeferredMessages('telegram', 'tg-bot-123', THREAD)).rejects.toBe(
        failure,
      );

      expect(mockProcessMessage).toHaveBeenCalledTimes(replays.length);
      expect(maxInFlight).toBeLessThanOrEqual(3);
    });

    it('does nothing (and does not load the bot) when nothing was deferred', async () => {
      mockBuildReplayMessages.mockReturnValue([]);

      const router = new BotMessageRouter();
      await router.replayDeferredMessages('telegram', 'tg-bot-123', THREAD);

      expect(mockFindEnabledByPlatform).not.toHaveBeenCalled();
      expect(mockProcessMessage).not.toHaveBeenCalled();
    });

    it('rejects replay when no bot is registered so entries remain pending', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockDrainDeferredBotMessages.mockResolvedValue([{ id: 'm1' }]);
      mockBuildReplayMessages.mockReturnValue([{ id: 'm1:replay:1:0' }]);

      const router = new BotMessageRouter();
      await expect(
        router.replayDeferredMessages('telegram', 'tg-bot-missing', THREAD),
      ).rejects.toThrow('Bot adapter unavailable');

      expect(mockProcessMessage).not.toHaveBeenCalled();
    });
  });
});
