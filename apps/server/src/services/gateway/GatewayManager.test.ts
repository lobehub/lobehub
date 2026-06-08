// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import type { PlatformClient, PlatformDefinition } from '@/server/services/bot/platforms';

import { createGatewayManager, GatewayManager, getGatewayManager } from './GatewayManager';

// Mock database and external dependencies
const { mockFindEnabledByPlatform, mockFindEnabledByPlatformAndAppId } = vi.hoisted(() => ({
  mockFindEnabledByPlatform: vi.fn().mockResolvedValue([]),
  mockFindEnabledByPlatformAndAppId: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: Object.assign(vi.fn(), {
    findEnabledByPlatform: mockFindEnabledByPlatform,
    findEnabledByPlatformAndAppId: mockFindEnabledByPlatformAndAppId,
  }),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn(),
  },
}));

// Helper: create a mock PlatformClient instance
const createMockBot = (): PlatformClient => ({
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
  id: 'slack',
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
});

// Helper: create a fake definition that returns the given bot
const createFakeDefinition = (
  id: string,
  factoryFn?: (...args: any[]) => PlatformClient,
): PlatformDefinition =>
  ({
    clientFactory: {
      createClient: factoryFn || (() => createMockBot()),
      validateCredentials: async () => ({ valid: true }),
      validateSettings: async () => ({ valid: true }),
    },
    credentials: [],
    name: id,
    id,
    schema: [],
  }) as any;

describe('GatewayManager', () => {
  let mockDb: any;
  let mockGateKeeper: any;

  beforeEach(() => {
    mockDb = {};
    mockGateKeeper = {};

    vi.mocked(getServerDB).mockResolvedValue(mockDb as any);
    vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue(mockGateKeeper as any);
    mockFindEnabledByPlatform.mockResolvedValue([]);
    mockFindEnabledByPlatformAndAppId.mockResolvedValue(null);

    // Clean up global singleton between tests
    const globalForGateway = globalThis as any;
    delete globalForGateway.gatewayManager;
  });

  afterEach(() => {
    vi.clearAllMocks();
    const globalForGateway = globalThis as any;
    delete globalForGateway.gatewayManager;
  });

  describe('constructor and isRunning', () => {
    it('should initialize with isRunning = false', () => {
      const manager = new GatewayManager({ definitions: [] });
      expect(manager.isRunning).toBe(false);
    });

    it('should accept a definitions configuration', () => {
      const manager = new GatewayManager({ definitions: [createFakeDefinition('slack')] });
      expect(manager.isRunning).toBe(false);
    });
  });

  describe('start', () => {
    it('should set isRunning to true after start', async () => {
      const manager = new GatewayManager({ definitions: [] });

      await manager.start();

      expect(manager.isRunning).toBe(true);
    });

    it('should not start again if already running', async () => {
      const manager = new GatewayManager({ definitions: [] });

      await manager.start();
      expect(manager.isRunning).toBe(true);

      // Call start again — should be a no-op
      await manager.start();
      expect(manager.isRunning).toBe(true);

      // getServerDB called once during initial sync
      // called again would indicate duplicate work
      const callCount = vi.mocked(getServerDB).mock.calls.length;
      // start was called twice but sync should only happen once
      await manager.start();
      expect(vi.mocked(getServerDB).mock.calls.length).toBe(callCount); // no additional sync
    });

    it('should continue starting even if initial sync fails', async () => {
      vi.mocked(getServerDB).mockRejectedValueOnce(new Error('DB connection failed'));

      const manager = new GatewayManager({ definitions: [] });

      // Should not throw
      await expect(manager.start()).resolves.toBeUndefined();
      expect(manager.isRunning).toBe(true);
    });
  });

  describe('stop', () => {
    it('should set isRunning to false after stop', async () => {
      const manager = new GatewayManager({ definitions: [] });
      await manager.start();
      expect(manager.isRunning).toBe(true);

      await manager.stop();

      expect(manager.isRunning).toBe(false);
    });

    it('should do nothing if not running', async () => {
      const manager = new GatewayManager({ definitions: [] });

      // Should not throw
      await expect(manager.stop()).resolves.toBeUndefined();
      expect(manager.isRunning).toBe(false);
    });

    it('should stop all running bots', async () => {
      const mockBot1 = createMockBot();
      const mockBot2 = createMockBot();
      const factory = vi.fn().mockReturnValueOnce(mockBot1).mockReturnValueOnce(mockBot2);

      // Pre-load two bots by calling startClient
      mockFindEnabledByPlatformAndAppId.mockResolvedValue({
        applicationId: 'app-1',
        credentials: { token: 'tok1' },
      });

      const manager = new GatewayManager({ definitions: [createFakeDefinition('slack', factory)] });
      await manager.start();

      await manager.startClient('slack', 'app-1');
      await manager.startClient('slack', 'app-2');

      await manager.stop();

      expect(mockBot1.stop).toHaveBeenCalled();
      expect(mockBot2.stop).toHaveBeenCalled();
      expect(manager.isRunning).toBe(false);
    });
  });

  describe('startClient', () => {
    it('should do nothing when no provider is found in DB', async () => {
      mockFindEnabledByPlatformAndAppId.mockResolvedValue(null);
      const factory = vi.fn();

      const manager = new GatewayManager({ definitions: [createFakeDefinition('slack', factory)] });

      await manager.startClient('slack', 'app-123');

      expect(factory).not.toHaveBeenCalled();
    });

    it('should do nothing when the platform is not registered', async () => {
      mockFindEnabledByPlatformAndAppId.mockResolvedValue({
        applicationId: 'app-123',
        credentials: { token: 'tok' },
      });

      const manager = new GatewayManager({ definitions: [] }); // empty definitions

      await manager.startClient('unsupported', 'app-123');

      // No bot should be created, but the provider lookup still ran
      expect(mockFindEnabledByPlatformAndAppId).toHaveBeenCalled();
    });

    it('should start a bot and register it', async () => {
      const mockBot = createMockBot();
      const factory = vi.fn().mockReturnValue(mockBot);
      mockFindEnabledByPlatformAndAppId.mockResolvedValue({
        applicationId: 'app-123',
        credentials: { token: 'tok123' },
      });

      const manager = new GatewayManager({ definitions: [createFakeDefinition('slack', factory)] });

      await manager.startClient('slack', 'app-123');

      expect(factory).toHaveBeenCalled();
      expect(mockBot.start).toHaveBeenCalled();
    });

    it('should look up the provider system-wide and build runtime context from the provider row', async () => {
      const mockBot = createMockBot();
      const factory = vi.fn().mockReturnValue(mockBot);
      mockFindEnabledByPlatformAndAppId.mockResolvedValue({
        applicationId: 'app-123',
        credentials: { token: 'tok123' },
        settings: {},
        userId: 'provider-user',
      });

      const manager = new GatewayManager({ definitions: [createFakeDefinition('slack', factory)] });

      await manager.startClient('slack', 'app-123');

      expect(mockFindEnabledByPlatformAndAppId).toHaveBeenCalledWith(
        mockDb,
        'slack',
        'app-123',
        mockGateKeeper,
      );
      expect(factory.mock.calls[0][1]).toMatchObject({ userId: 'provider-user' });
      expect(mockBot.start).toHaveBeenCalled();
    });

    it('should stop existing bot before starting a new one for the same key', async () => {
      const mockBot1 = createMockBot();
      const mockBot2 = createMockBot();
      const factory = vi.fn().mockReturnValueOnce(mockBot1).mockReturnValueOnce(mockBot2);

      mockFindEnabledByPlatformAndAppId.mockResolvedValue({
        applicationId: 'app-123',
        credentials: { token: 'tok' },
      });

      const manager = new GatewayManager({ definitions: [createFakeDefinition('slack', factory)] });

      // Start bot first time
      await manager.startClient('slack', 'app-123');
      expect(mockBot1.start).toHaveBeenCalled();

      // Start bot second time for same key — should stop first
      await manager.startClient('slack', 'app-123');
      expect(mockBot1.stop).toHaveBeenCalled();
      expect(mockBot2.start).toHaveBeenCalled();
    });
  });

  describe('stopClient', () => {
    it('should do nothing when bot is not found', async () => {
      const manager = new GatewayManager({ definitions: [] });

      // Should not throw
      await expect(manager.stopClient('slack', 'app-123')).resolves.toBeUndefined();
    });

    it('should stop and remove a running bot', async () => {
      const mockBot = createMockBot();
      const factory = vi.fn().mockReturnValue(mockBot);
      mockFindEnabledByPlatformAndAppId.mockResolvedValue({
        applicationId: 'app-123',
        credentials: { token: 'tok' },
      });

      const manager = new GatewayManager({ definitions: [createFakeDefinition('slack', factory)] });

      // First start the bot
      await manager.startClient('slack', 'app-123');
      expect(mockBot.start).toHaveBeenCalled();

      // Then stop it
      await manager.stopClient('slack', 'app-123');
      expect(mockBot.stop).toHaveBeenCalled();
    });

    it('should not affect other bots when stopping one', async () => {
      const mockBot1 = createMockBot();
      const mockBot2 = createMockBot();
      const factory = vi.fn().mockReturnValueOnce(mockBot1).mockReturnValueOnce(mockBot2);

      mockFindEnabledByPlatformAndAppId
        .mockResolvedValueOnce({ applicationId: 'app-1', credentials: {} })
        .mockResolvedValueOnce({ applicationId: 'app-2', credentials: {} });

      const manager = new GatewayManager({ definitions: [createFakeDefinition('slack', factory)] });

      await manager.startClient('slack', 'app-1');
      await manager.startClient('slack', 'app-2');

      await manager.stopClient('slack', 'app-1');

      expect(mockBot1.stop).toHaveBeenCalled();
      expect(mockBot2.stop).not.toHaveBeenCalled();
    });
  });
});

describe('createGatewayManager / getGatewayManager', () => {
  beforeEach(() => {
    const globalForGateway = globalThis as any;
    delete globalForGateway.gatewayManager;
  });

  afterEach(() => {
    const globalForGateway = globalThis as any;
    delete globalForGateway.gatewayManager;
  });

  it('should return undefined when no manager has been created', () => {
    expect(getGatewayManager()).toBeUndefined();
  });

  it('should create and return a GatewayManager instance', () => {
    const manager = createGatewayManager({ definitions: [] });
    expect(manager).toBeInstanceOf(GatewayManager);
  });

  it('should return the same instance on subsequent calls (singleton)', () => {
    const manager1 = createGatewayManager({ definitions: [] });
    const manager2 = createGatewayManager({ definitions: [createFakeDefinition('slack')] });

    expect(manager1).toBe(manager2);
  });

  it('should be accessible via getGatewayManager after creation', () => {
    const created = createGatewayManager({ definitions: [] });
    const retrieved = getGatewayManager();

    expect(retrieved).toBe(created);
  });
});
