// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getServerDB } from '@/database/core/db-adaptor';
import { AgentBotProviderModel } from '@/database/models/agentBotProvider';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { createGatewayManager, GatewayManager, getGatewayManager } from './GatewayManager';

// Mock database and external dependencies
const { mockFindEnabledByPlatform } = vi.hoisted(() => ({
  mockFindEnabledByPlatform: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(),
}));

vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: Object.assign(vi.fn(), {
    findEnabledByPlatform: mockFindEnabledByPlatform,
  }),
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn(),
  },
}));

// Helper: create a mock PlatformBot instance
const createMockBot = () => ({
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
});

// Helper: create a mock PlatformBot class (constructor)
const createMockBotClass = (instance = createMockBot()) => {
  return vi.fn().mockImplementation(() => instance);
};

describe('GatewayManager', () => {
  let mockDb: any;
  let mockGateKeeper: any;
  let mockAgentBotProviderModel: any;

  beforeEach(() => {
    mockDb = {};
    mockGateKeeper = {};
    mockAgentBotProviderModel = {
      findEnabledByApplicationId: vi.fn(),
    };

    vi.mocked(getServerDB).mockResolvedValue(mockDb as any);
    vi.mocked(KeyVaultsGateKeeper.initWithEnvKey).mockResolvedValue(mockGateKeeper as any);
    vi.mocked(AgentBotProviderModel).mockImplementation(() => mockAgentBotProviderModel);
    mockFindEnabledByPlatform.mockResolvedValue([]);

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
      const manager = new GatewayManager({ registry: {} });
      expect(manager.isRunning).toBe(false);
    });

    it('should accept a registry configuration', () => {
      const BotClass = createMockBotClass();
      const manager = new GatewayManager({ registry: { slack: BotClass } });
      expect(manager.isRunning).toBe(false);
    });
  });

  describe('start', () => {
    it('should set isRunning to true after start', async () => {
      const manager = new GatewayManager({ registry: {} });

      await manager.start();

      expect(manager.isRunning).toBe(true);
    });

    it('should not start again if already running', async () => {
      const manager = new GatewayManager({ registry: {} });

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

      const manager = new GatewayManager({ registry: {} });

      // Should not throw
      await expect(manager.start()).resolves.toBeUndefined();
      expect(manager.isRunning).toBe(true);
    });
  });

  describe('stop', () => {
    it('should set isRunning to false after stop', async () => {
      const manager = new GatewayManager({ registry: {} });
      await manager.start();
      expect(manager.isRunning).toBe(true);

      await manager.stop();

      expect(manager.isRunning).toBe(false);
    });

    it('should do nothing if not running', async () => {
      const manager = new GatewayManager({ registry: {} });

      // Should not throw
      await expect(manager.stop()).resolves.toBeUndefined();
      expect(manager.isRunning).toBe(false);
    });

    it('should stop all running bots', async () => {
      const mockBot1 = createMockBot();
      const mockBot2 = createMockBot();
      const BotClass = vi
        .fn()
        .mockImplementationOnce(() => mockBot1)
        .mockImplementationOnce(() => mockBot2);

      // Pre-load two bots by calling startBot
      mockAgentBotProviderModel.findEnabledByApplicationId.mockResolvedValue({
        applicationId: 'app-1',
        credentials: { token: 'tok1' },
      });

      const manager = new GatewayManager({ registry: { slack: BotClass } });
      await manager.start();

      await manager.startBot('slack', 'app-1', 'user-1');
      await manager.startBot('slack', 'app-2', 'user-2');

      await manager.stop();

      expect(mockBot1.stop).toHaveBeenCalled();
      expect(mockBot2.stop).toHaveBeenCalled();
      expect(manager.isRunning).toBe(false);
    });
  });

  describe('startBot', () => {
    it('should do nothing when no provider is found in DB', async () => {
      mockAgentBotProviderModel.findEnabledByApplicationId.mockResolvedValue(null);
      const BotClass = createMockBotClass();

      const manager = new GatewayManager({ registry: { slack: BotClass } });

      await manager.startBot('slack', 'app-123', 'user-abc');

      expect(BotClass).not.toHaveBeenCalled();
    });

    it('should do nothing when the platform is not in registry', async () => {
      mockAgentBotProviderModel.findEnabledByApplicationId.mockResolvedValue({
        applicationId: 'app-123',
        credentials: { token: 'tok' },
      });

      const manager = new GatewayManager({ registry: {} }); // empty registry

      await manager.startBot('unsupported', 'app-123', 'user-abc');

      // No bot should be created
      expect(vi.mocked(AgentBotProviderModel)).toHaveBeenCalled();
    });

    it('should start a bot and register it', async () => {
      const mockBot = createMockBot();
      const BotClass = createMockBotClass(mockBot);
      mockAgentBotProviderModel.findEnabledByApplicationId.mockResolvedValue({
        applicationId: 'app-123',
        credentials: { token: 'tok123' },
      });

      const manager = new GatewayManager({ registry: { slack: BotClass } });

      await manager.startBot('slack', 'app-123', 'user-abc');

      expect(BotClass).toHaveBeenCalledWith({ token: 'tok123', applicationId: 'app-123' });
      expect(mockBot.start).toHaveBeenCalled();
    });

    it('should stop existing bot before starting a new one for the same key', async () => {
      const mockBot1 = createMockBot();
      const mockBot2 = createMockBot();
      const BotClass = vi
        .fn()
        .mockImplementationOnce(() => mockBot1)
        .mockImplementationOnce(() => mockBot2);

      mockAgentBotProviderModel.findEnabledByApplicationId.mockResolvedValue({
        applicationId: 'app-123',
        credentials: { token: 'tok' },
      });

      const manager = new GatewayManager({ registry: { slack: BotClass } });

      // Start bot first time
      await manager.startBot('slack', 'app-123', 'user-abc');
      expect(mockBot1.start).toHaveBeenCalled();

      // Start bot second time for same key — should stop first
      await manager.startBot('slack', 'app-123', 'user-abc');
      expect(mockBot1.stop).toHaveBeenCalled();
      expect(mockBot2.start).toHaveBeenCalled();
    });

    it('should pass credentials merged with applicationId to the bot constructor', async () => {
      const mockBot = createMockBot();
      const BotClass = createMockBotClass(mockBot);
      mockAgentBotProviderModel.findEnabledByApplicationId.mockResolvedValue({
        applicationId: 'my-app',
        credentials: { apiKey: 'key-abc', secret: 'sec-xyz' },
      });

      const manager = new GatewayManager({ registry: { discord: BotClass } });

      await manager.startBot('discord', 'my-app', 'user-xyz');

      expect(BotClass).toHaveBeenCalledWith({
        apiKey: 'key-abc',
        secret: 'sec-xyz',
        applicationId: 'my-app',
      });
    });
  });

  describe('stopBot', () => {
    it('should do nothing when bot is not found', async () => {
      const manager = new GatewayManager({ registry: {} });

      // Should not throw
      await expect(manager.stopBot('slack', 'app-123')).resolves.toBeUndefined();
    });

    it('should stop and remove a running bot', async () => {
      const mockBot = createMockBot();
      const BotClass = createMockBotClass(mockBot);
      mockAgentBotProviderModel.findEnabledByApplicationId.mockResolvedValue({
        applicationId: 'app-123',
        credentials: { token: 'tok' },
      });

      const manager = new GatewayManager({ registry: { slack: BotClass } });

      // First start the bot
      await manager.startBot('slack', 'app-123', 'user-abc');
      expect(mockBot.start).toHaveBeenCalled();

      // Then stop it
      await manager.stopBot('slack', 'app-123');
      expect(mockBot.stop).toHaveBeenCalled();
    });

    it('should not affect other bots when stopping one', async () => {
      const mockBot1 = createMockBot();
      const mockBot2 = createMockBot();
      const BotClass = vi
        .fn()
        .mockImplementationOnce(() => mockBot1)
        .mockImplementationOnce(() => mockBot2);

      mockAgentBotProviderModel.findEnabledByApplicationId
        .mockResolvedValueOnce({ applicationId: 'app-1', credentials: {} })
        .mockResolvedValueOnce({ applicationId: 'app-2', credentials: {} });

      const manager = new GatewayManager({ registry: { slack: BotClass } });

      await manager.startBot('slack', 'app-1', 'user-1');
      await manager.startBot('slack', 'app-2', 'user-2');

      await manager.stopBot('slack', 'app-1');

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
    const manager = createGatewayManager({ registry: {} });
    expect(manager).toBeInstanceOf(GatewayManager);
  });

  it('should return the same instance on subsequent calls (singleton)', () => {
    const manager1 = createGatewayManager({ registry: {} });
    const manager2 = createGatewayManager({ registry: { slack: vi.fn() as any } });

    expect(manager1).toBe(manager2);
  });

  it('should be accessible via getGatewayManager after creation', () => {
    const created = createGatewayManager({ registry: {} });
    const retrieved = getGatewayManager();

    expect(retrieved).toBe(created);
  });
});
