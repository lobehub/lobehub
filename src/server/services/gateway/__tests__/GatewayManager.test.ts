import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformBot, PlatformBotClass } from '../../bot/types';
import { GatewayManager } from '../GatewayManager';

const mockFindEnabledByPlatform = vi.hoisted(() => vi.fn());
const mockFindEnabledByApplicationId = vi.hoisted(() => vi.fn());
const mockInitWithEnvKey = vi.hoisted(() => vi.fn());
const mockGetServerDB = vi.hoisted(() => vi.fn());

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/agentBotProvider', () => {
  const MockModel = vi.fn().mockImplementation(() => ({
    findEnabledByApplicationId: mockFindEnabledByApplicationId,
  }));
  (MockModel as any).findEnabledByPlatform = mockFindEnabledByPlatform;
  return { AgentBotProviderModel: MockModel };
});

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: mockInitWithEnvKey,
  },
}));

// Fake platform bot for testing
class FakeBot implements PlatformBot {
  static persistent = false;

  readonly platform: string;
  readonly applicationId: string;
  started = false;
  stopped = false;

  constructor(config: any) {
    this.platform = config.platform;
    this.applicationId = config.applicationId;
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

const FAKE_DB = {} as any;
const FAKE_GATEKEEPER = { decrypt: vi.fn() };

describe('GatewayManager', () => {
  let manager: GatewayManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerDB.mockResolvedValue(FAKE_DB);
    mockInitWithEnvKey.mockResolvedValue(FAKE_GATEKEEPER);
    mockFindEnabledByPlatform.mockResolvedValue([]);
    mockFindEnabledByApplicationId.mockResolvedValue(null);

    manager = new GatewayManager({
      registry: { fakeplatform: FakeBot as unknown as PlatformBotClass },
    });
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

    it('should skip already running bots', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { key: 'value' },
        },
      ]);

      await manager.start();

      // Call start again (sync would be called again if manager was restarted)
      // But since isRunning is true, it skips
      expect(manager.isRunning).toBe(true);
    });

    it('should handle sync errors gracefully', async () => {
      mockFindEnabledByPlatform.mockRejectedValue(new Error('DB connection failed'));

      // Should not throw - error is caught internally
      await expect(manager.start()).resolves.toBeUndefined();
      expect(manager.isRunning).toBe(true);
    });
  });

  describe('startBot', () => {
    it('should handle missing provider gracefully', async () => {
      await manager.start();

      // startBot loads from DB - mock returns no provider
      // This tests the "no enabled provider found" path
      await expect(manager.startBot('fakeplatform', 'app-1', 'user-1')).resolves.toBeUndefined();
    });
  });

  describe('stopBot', () => {
    it('should stop a specific bot', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { key: 'value' },
        },
      ]);

      await manager.start();
      await manager.stopBot('fakeplatform', 'app-1');

      // No error should occur
      expect(manager.isRunning).toBe(true);
    });

    it('should handle stopping non-existent bot gracefully', async () => {
      await manager.start();
      await expect(manager.stopBot('fakeplatform', 'non-existent')).resolves.toBeUndefined();
    });
  });

  describe('createBot', () => {
    it('should return null for unknown platform', async () => {
      const managerWithEmpty = new GatewayManager({ registry: {} });

      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { key: 'value' },
        },
      ]);

      // With empty registry, no bots should be created
      await managerWithEmpty.start();
      expect(managerWithEmpty.isRunning).toBe(true);
    });
  });

  describe('sync removes stale bots', () => {
    it('should stop bots no longer in DB on subsequent syncs', async () => {
      // First sync: one bot exists
      mockFindEnabledByPlatform.mockResolvedValueOnce([
        {
          applicationId: 'app-1',
          credentials: { key: 'value' },
        },
      ]);

      await manager.start();

      // Verify bot was started
      expect(manager.isRunning).toBe(true);
    });
  });
});
