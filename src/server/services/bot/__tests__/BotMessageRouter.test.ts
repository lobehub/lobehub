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

vi.mock('chat', () => ({
  Chat: vi.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    onNewMention: mockOnNewMention,
    onNewMessage: mockOnNewMessage,
    onSubscribedMessage: mockOnSubscribedMessage,
    webhooks: {},
  })),
  ConsoleLogger: vi.fn(),
}));

vi.mock('../AgentBridgeService', () => ({
  AgentBridgeService: vi.fn().mockImplementation(() => ({
    handleMention: vi.fn().mockResolvedValue(undefined),
    handleSubscribedMessage: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock platform descriptors
const mockCreateAdapter = vi.hoisted(() =>
  vi.fn().mockReturnValue({ testplatform: { type: 'mock-adapter' } }),
);
const mockOnBotRegistered = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../platforms', () => ({
  getPlatformDescriptor: vi.fn().mockImplementation((platform: string) => {
    if (platform === 'unknown') return undefined;
    return {
      charLimit: platform === 'telegram' ? 4000 : undefined,
      createAdapter: mockCreateAdapter,
      handleDirectMessages: platform === 'telegram' || platform === 'lark',
      onBotRegistered: mockOnBotRegistered,
      persistent: platform === 'discord',
      platform,
    };
  }),
  platformDescriptors: {
    discord: { platform: 'discord' },
    lark: { platform: 'lark' },
    telegram: { platform: 'telegram' },
  },
}));

// ==================== Tests ====================

describe('BotMessageRouter', () => {
  const FAKE_DB = {} as any;
  const FAKE_GATEKEEPER = { decrypt: vi.fn() };

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

  describe('initialize', () => {
    it('should load agent bots on initialization', async () => {
      const router = new BotMessageRouter();
      await router.initialize();

      // Should query each platform in the descriptor registry
      expect(mockFindEnabledByPlatform).toHaveBeenCalledTimes(3); // discord, lark, telegram
    });

    it('should create bots for enabled providers', async () => {
      mockFindEnabledByPlatform.mockImplementation((_db: any, platform: string) => {
        if (platform === 'telegram') {
          return [
            {
              agentId: 'agent-1',
              applicationId: 'tg-bot-123',
              credentials: { botToken: 'tg-token' },
              userId: 'user-1',
            },
          ];
        }
        return [];
      });

      const router = new BotMessageRouter();
      await router.initialize();

      // Chat SDK should be initialized
      expect(mockInitialize).toHaveBeenCalled();
      // Adapter should be created via descriptor
      expect(mockCreateAdapter).toHaveBeenCalledWith({ botToken: 'tg-token' }, 'tg-bot-123');
      // Post-registration hook should be called
      expect(mockOnBotRegistered).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'tg-bot-123',
          credentials: { botToken: 'tg-token' },
        }),
      );
    });

    it('should register onNewMessage for platforms with handleDirectMessages', async () => {
      mockFindEnabledByPlatform.mockImplementation((_db: any, platform: string) => {
        if (platform === 'telegram') {
          return [
            {
              agentId: 'agent-1',
              applicationId: 'tg-bot-123',
              credentials: { botToken: 'tg-token' },
              userId: 'user-1',
            },
          ];
        }
        return [];
      });

      const router = new BotMessageRouter();
      await router.initialize();

      // Telegram should have onNewMessage registered
      expect(mockOnNewMessage).toHaveBeenCalled();
    });

    it('should NOT register onNewMessage for Discord', async () => {
      mockFindEnabledByPlatform.mockImplementation((_db: any, platform: string) => {
        if (platform === 'discord') {
          return [
            {
              agentId: 'agent-1',
              applicationId: 'discord-app-123',
              credentials: { botToken: 'dc-token', publicKey: 'key' },
              userId: 'user-1',
            },
          ];
        }
        return [];
      });

      const router = new BotMessageRouter();
      await router.initialize();

      // Discord should NOT have onNewMessage registered (handleDirectMessages = false)
      expect(mockOnNewMessage).not.toHaveBeenCalled();
    });

    it('should skip already registered bots on refresh', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          agentId: 'agent-1',
          applicationId: 'app-1',
          credentials: { botToken: 'token' },
          userId: 'user-1',
        },
      ]);

      const router = new BotMessageRouter();
      await router.initialize();

      const firstCallCount = mockInitialize.mock.calls.length;

      // Force a second load
      await (router as any).loadAgentBots();

      // Should not create duplicate bots
      expect(mockInitialize.mock.calls.length).toBe(firstCallCount);
    });

    it('should handle DB errors gracefully during initialization', async () => {
      mockFindEnabledByPlatform.mockRejectedValue(new Error('DB connection failed'));

      const router = new BotMessageRouter();
      // Should not throw
      await expect(router.initialize()).resolves.toBeUndefined();
    });
  });

  describe('handler registration', () => {
    it('should always register onNewMention and onSubscribedMessage', async () => {
      mockFindEnabledByPlatform.mockImplementation((_db: any, platform: string) => {
        if (platform === 'telegram') {
          return [
            {
              agentId: 'agent-1',
              applicationId: 'tg-123',
              credentials: { botToken: 'token' },
              userId: 'user-1',
            },
          ];
        }
        return [];
      });

      const router = new BotMessageRouter();
      await router.initialize();

      expect(mockOnNewMention).toHaveBeenCalled();
      expect(mockOnSubscribedMessage).toHaveBeenCalled();
    });
  });
});
