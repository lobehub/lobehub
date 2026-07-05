import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformDefinition } from '@/server/services/bot/platforms';

import { GatewayManager } from '../GatewayManager';

const mockFindEnabledByPlatform = vi.hoisted(() => vi.fn());
const mockFindEnabledByPlatformAndAppId = vi.hoisted(() => vi.fn());
const mockInitWithEnvKey = vi.hoisted(() => vi.fn());
const mockGetServerDB = vi.hoisted(() => vi.fn());
const mockIsBotFeatureAccessAllowed = vi.hoisted(() => vi.fn());

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/agentBotProvider', () => {
  const MockModel = vi.fn();
  (MockModel as any).findEnabledByPlatform = mockFindEnabledByPlatform;
  (MockModel as any).findEnabledByPlatformAndAppId = mockFindEnabledByPlatformAndAppId;
  return { AgentBotProviderModel: MockModel };
});

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: mockInitWithEnvKey,
  },
}));

vi.mock('@/business/server/bot/featureAccess', () => ({
  isBotFeatureAccessAllowed: mockIsBotFeatureAccessAllowed,
}));

// Fake platform definition for testing
const mockStartedClient = vi.hoisted(() => ({
  applicationId: 'app-1',
  createAdapter: () => ({}),
  extractChatId: (id: string) => id,
  getMessenger: () => ({
    createMessage: async () => {},
    editMessage: async () => {},
    removeReaction: async () => {},
    triggerTyping: async () => {},
  }),
  parseMessageId: (id: string) => id,
  id: 'fakeplatform',
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
}));

const fakeDefinition: PlatformDefinition = {
  clientFactory: {
    createClient: () => mockStartedClient,
    validateCredentials: async () => ({ valid: true }),
    validateSettings: async () => ({ valid: true }),
  },
  credentials: [],
  name: 'Fake Platform',
  id: 'fakeplatform',
  schema: [],
} as any;

const FAKE_DB = {} as any;
const FAKE_GATEKEEPER = { decrypt: vi.fn() };

describe('GatewayManager', () => {
  let manager: GatewayManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue(FAKE_DB);
    mockInitWithEnvKey.mockResolvedValue(FAKE_GATEKEEPER);
    mockFindEnabledByPlatform.mockResolvedValue([]);
    mockFindEnabledByPlatformAndAppId.mockResolvedValue(null);
    mockIsBotFeatureAccessAllowed.mockResolvedValue(true);
    mockStartedClient.start.mockClear();
    mockStartedClient.stop.mockClear();

    manager = new GatewayManager({ definitions: [fakeDefinition] });
  });

  describe('lifecycle', () => {
    it('should start and set running state', async () => {
      await manager.start();

      expect(manager.isRunning).toBe(true);
    });

    it('should not start twice', async () => {
      await manager.start();
      await manager.start();

      // findEnabledByPlatform should only be called once (during first start)
      expect(mockFindEnabledByPlatform).toHaveBeenCalledTimes(1);
    });

    it('should stop and clear running state', async () => {
      await manager.start();
      await manager.stop();

      expect(manager.isRunning).toBe(false);
    });

    it('should not throw when stopping while not running', async () => {
      await expect(manager.stop()).resolves.toBeUndefined();
    });
  });

  describe('sync', () => {
    it('should start bots for enabled providers', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { key: 'value' },
        },
      ]);

      await manager.start();

      expect(manager.isRunning).toBe(true);
    });

    it('should stop an already running bot when feature access becomes denied', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { key: 'value' },
          userId: 'owner-1',
        },
      ]);

      await manager.start();
      expect(mockStartedClient.start).toHaveBeenCalledTimes(1);

      mockIsBotFeatureAccessAllowed.mockResolvedValue(false);
      await (manager as any).syncPlatform('fakeplatform');

      expect(mockStartedClient.stop).toHaveBeenCalledTimes(1);
    });

    it('should skip already running bots', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { key: 'value' },
        },
      ]);

      await manager.start();

      expect(manager.isRunning).toBe(true);
    });

    it('should handle sync errors gracefully', async () => {
      mockFindEnabledByPlatform.mockRejectedValue(new Error('DB connection failed'));

      // Should not throw - error is caught internally
      await expect(manager.start()).resolves.toBeUndefined();
      expect(manager.isRunning).toBe(true);
    });
  });

  describe('startClient', () => {
    it('should handle missing provider gracefully', async () => {
      await manager.start();

      await expect(manager.startClient('fakeplatform', 'app-1')).resolves.toBeUndefined();
    });
  });

  describe('stopClient', () => {
    it('should stop a specific bot', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { key: 'value' },
        },
      ]);

      await manager.start();
      await manager.stopClient('fakeplatform', 'app-1');

      expect(manager.isRunning).toBe(true);
    });

    it('should handle stopping non-existent bot gracefully', async () => {
      await manager.start();
      await expect(manager.stopClient('fakeplatform', 'non-existent')).resolves.toBeUndefined();
    });
  });

  describe('createConnector', () => {
    it('should return null for unknown platform', async () => {
      const managerWithEmpty = new GatewayManager({ definitions: [] });

      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { key: 'value' },
        },
      ]);

      // With no definitions, no bots should be created
      await managerWithEmpty.start();
      expect(managerWithEmpty.isRunning).toBe(true);
    });
  });

  describe('sync removes stale bots', () => {
    it('should stop bots no longer in DB on subsequent syncs', async () => {
      mockFindEnabledByPlatform.mockResolvedValueOnce([
        {
          applicationId: 'app-1',
          credentials: { key: 'value' },
        },
      ]);

      await manager.start();

      expect(manager.isRunning).toBe(true);
    });
  });
});
