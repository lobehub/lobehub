import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BotMessageRouter } from '../BotMessageRouter';

// ==================== Hoisted mocks ====================

const mockFindEnabledByPlatform = vi.hoisted(() => vi.fn());
const mockInitWithEnvKey = vi.hoisted(() => vi.fn());
const mockGetServerDB = vi.hoisted(() => vi.fn());

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: {
    findEnabledByPlatform: mockFindEnabledByPlatform,
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: mockInitWithEnvKey,
  },
}));

vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn().mockReturnValue(null),
}));

vi.mock('@chat-adapter/state-ioredis', () => ({
  createIoRedisState: vi.fn(),
}));

// Mock Chat SDK
const mockInitialize = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockOnNewMention = vi.hoisted(() => vi.fn());
const mockOnSubscribedMessage = vi.hoisted(() => vi.fn());
const mockOnNewMessage = vi.hoisted(() => vi.fn());
const mockOnSlashCommand = vi.hoisted(() => vi.fn());

vi.mock('chat', () => ({
  BaseFormatConverter: class {},
  Chat: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    onNewMention: mockOnNewMention,
    onNewMessage: mockOnNewMessage,
    onSlashCommand: mockOnSlashCommand,
    onSubscribedMessage: mockOnSubscribedMessage,
    webhooks: {},
  })),
  ConsoleLogger: vi.fn(),
}));

vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({
    interruptTask: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

vi.mock('../AgentBridgeService', () => ({
  AgentBridgeService: vi.fn().mockImplementation(() => ({
    handleMention: vi.fn().mockResolvedValue(undefined),
    handleSubscribedMessage: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock platform entries
const mockCreateAdapter = vi.hoisted(() =>
  vi.fn().mockReturnValue({ testplatform: { type: 'mock-adapter' } }),
);
const mockMergeWithDefaults = vi.hoisted(() =>
  vi.fn((_: unknown, settings?: Record<string, unknown>) => settings ?? {}),
);

const mockGetPlatform = vi.hoisted(() =>
  vi.fn().mockImplementation((platform: string) => {
    if (platform === 'unknown') return undefined;
    return {
      clientFactory: {
        createClient: vi.fn().mockReturnValue({
          applicationId: 'mock-app',
          createAdapter: mockCreateAdapter,
          extractChatId: (id: string) => id.split(':')[1],
          getMessenger: () => ({
            createMessage: vi.fn(),
            editMessage: vi.fn(),
            removeReaction: vi.fn(),
            triggerTyping: vi.fn(),
          }),
          id: platform,
          parseMessageId: (id: string) => id,
          start: vi.fn(),
          stop: vi.fn(),
        }),
      },
      credentials: [],
      id: platform,
      name: platform,
    };
  }),
);

vi.mock('../platforms', () => ({
  buildRuntimeKey: (platform: string, appId: string) => `${platform}:${appId}`,
  mergeWithDefaults: mockMergeWithDefaults,
  platformRegistry: {
    getPlatform: mockGetPlatform,
  },
}));

// ==================== Helpers ====================

const FAKE_DB = {} as any;
const FAKE_GATEKEEPER = { decrypt: vi.fn() };

function makeProvider(overrides: Record<string, any> = {}) {
  return {
    agentId: 'agent-1',
    applicationId: 'app-123',
    credentials: { botToken: 'token' },
    userId: 'user-1',
    ...overrides,
  };
}

// ==================== Tests ====================

describe('BotMessageRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue(FAKE_DB);
    mockInitWithEnvKey.mockResolvedValue(FAKE_GATEKEEPER);
    mockFindEnabledByPlatform.mockResolvedValue([]);
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

    it('should register onNewMessage when dm.enabled is true', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        makeProvider({
          applicationId: 'tg-123',
          settings: { dm: { enabled: true } },
        }),
      ]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'tg-123');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req);

      // Called twice: once for text-based slash commands, once for DM catch-all
      expect(mockOnNewMessage).toHaveBeenCalledTimes(2);
    });

    it('should NOT register DM onNewMessage when dm is not enabled', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([makeProvider({ applicationId: 'app-123' })]);

      const router = new BotMessageRouter();
      const handler = router.getWebhookHandler('telegram', 'app-123');

      const req = new Request('https://example.com/webhook', { body: '{}', method: 'POST' });
      await handler(req);

      // Called once for text-based slash commands only, no DM catch-all
      expect(mockOnNewMessage).toHaveBeenCalledTimes(1);
    });
  });
});
