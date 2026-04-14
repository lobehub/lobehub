// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Import after mocks ───
import { GatewayService } from '../index';

// ─── Hoisted mocks ───

const mockGatewayClient = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  disconnectAll: vi.fn(),
  getStats: vi.fn(),
  getStatus: vi.fn(),
  isConfigured: false,
  isEnabled: false,
}));

const mockGatewayEnv = vi.hoisted(() => ({
  MESSAGE_GATEWAY_ENABLED: undefined as string | undefined,
}));

const mockGatewayManager = vi.hoisted(() => ({
  isRunning: false,
  start: vi.fn(),
  startClient: vi.fn(),
  stop: vi.fn(),
  stopClient: vi.fn(),
}));

const mockFindEnabledByPlatform = vi.hoisted(() => vi.fn());
const mockGetServerDB = vi.hoisted(() => vi.fn());
const mockInitWithEnvKey = vi.hoisted(() => vi.fn());
const mockUpdateBotRuntimeStatus = vi.hoisted(() => vi.fn());
const mockGetEffectiveConnectionMode = vi.hoisted(() => vi.fn());

// ─── Module mocks ───

vi.mock('@/envs/gateway', () => ({
  gatewayEnv: mockGatewayEnv,
}));

vi.mock('../MessageGatewayClient', () => ({
  getMessageGatewayClient: () => mockGatewayClient,
}));

vi.mock('../GatewayManager', () => ({
  createGatewayManager: () => mockGatewayManager,
  getGatewayManager: () => (mockGatewayManager.isRunning ? mockGatewayManager : null),
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: {
    findEnabledByPlatform: mockFindEnabledByPlatform,
  },
}));

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: mockInitWithEnvKey },
}));

vi.mock('../runtimeStatus', () => ({
  BOT_RUNTIME_STATUSES: {
    connected: 'connected',
    disconnected: 'disconnected',
    failed: 'failed',
    queued: 'queued',
    starting: 'starting',
  },
  updateBotRuntimeStatus: mockUpdateBotRuntimeStatus,
}));

vi.mock('../../bot/platforms', () => ({
  getEffectiveConnectionMode: mockGetEffectiveConnectionMode,
  platformRegistry: {
    getPlatform: () => ({ id: 'discord' }),
    listPlatforms: () => [{ id: 'discord' }, { id: 'telegram' }],
  },
}));

describe('GatewayService', () => {
  let service: GatewayService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGatewayClient.isConfigured = false;
    mockGatewayClient.isEnabled = false;
    mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = undefined;
    mockGatewayManager.isRunning = false;
    mockGetServerDB.mockResolvedValue({});
    mockInitWithEnvKey.mockResolvedValue({});
    mockFindEnabledByPlatform.mockResolvedValue([]);
    mockUpdateBotRuntimeStatus.mockResolvedValue({});
    service = new GatewayService();
  });

  // ─── useMessageGateway ───

  describe('useMessageGateway', () => {
    it('returns false when client is not enabled', () => {
      mockGatewayClient.isEnabled = false;
      expect(service.useMessageGateway).toBe(false);
    });

    it('returns true when client is enabled', () => {
      mockGatewayClient.isEnabled = true;
      expect(service.useMessageGateway).toBe(true);
    });
  });

  // ─── ensureRunning ───

  describe('ensureRunning', () => {
    describe('in-process mode (gateway disabled)', () => {
      it('starts local GatewayManager', async () => {
        await service.ensureRunning();

        expect(mockGatewayManager.start).toHaveBeenCalled();
      });

      it('skips start if GatewayManager already running', async () => {
        mockGatewayManager.isRunning = true;

        await service.ensureRunning();

        expect(mockGatewayManager.start).not.toHaveBeenCalled();
      });
    });

    describe('gateway mode (ENABLED=1)', () => {
      beforeEach(() => {
        mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = '1';
        mockGatewayClient.isConfigured = true;
        mockGatewayClient.isEnabled = true;
      });

      it('calls syncGatewayConnections instead of starting local manager', async () => {
        await service.ensureRunning();

        expect(mockGatewayManager.start).not.toHaveBeenCalled();
      });
    });
  });

  // ─── syncGatewayConnections ───

  describe('syncGatewayConnections (via ensureRunning)', () => {
    beforeEach(() => {
      mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = '1';
      mockGatewayClient.isConfigured = true;
      mockGatewayClient.isEnabled = true;
    });

    it('skips webhook-mode providers', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        { applicationId: 'app-1', credentials: {}, id: 'prov-1', settings: {}, userId: 'u1' },
      ]);
      mockGetEffectiveConnectionMode.mockReturnValue('webhook');

      await service.ensureRunning();

      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('skips already connected providers', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        { applicationId: 'app-1', credentials: {}, id: 'prov-1', settings: {}, userId: 'u1' },
      ]);
      mockGetEffectiveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.getStatus.mockResolvedValue({
        state: { status: 'connected' },
      });

      await service.ensureRunning();

      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('skips connecting providers', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        { applicationId: 'app-1', credentials: {}, id: 'prov-1', settings: {}, userId: 'u1' },
      ]);
      mockGetEffectiveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.getStatus.mockResolvedValue({
        state: { status: 'connecting' },
      });

      await service.ensureRunning();

      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('skips providers in error state', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        { applicationId: 'app-1', credentials: {}, id: 'prov-1', settings: {}, userId: 'u1' },
      ]);
      mockGetEffectiveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.getStatus.mockResolvedValue({
        state: { error: 'Session expired (errcode -14)', status: 'error' },
      });

      await service.ensureRunning();

      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('connects disconnected providers', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { token: 'x' },
          id: 'prov-1',
          settings: {},
          userId: 'u1',
        },
      ]);
      mockGetEffectiveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.getStatus.mockResolvedValue({
        state: { status: 'disconnected' },
      });
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'app-1',
          connectionId: 'prov-1',
          platform: 'discord',
        }),
      );
      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'starting' }),
      );
    });

    it('sets connected status for sync connect result', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        { applicationId: 'app-1', credentials: {}, id: 'prov-1', settings: {}, userId: 'u1' },
      ]);
      mockGetEffectiveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.getStatus.mockRejectedValue(new Error('not found'));
      mockGatewayClient.connect.mockResolvedValue({ status: 'connected' });

      await service.ensureRunning();

      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'connected' }),
      );
    });

    it('tries to connect when status check fails', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        { applicationId: 'app-1', credentials: {}, id: 'prov-1', settings: {}, userId: 'u1' },
      ]);
      mockGetEffectiveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.getStatus.mockRejectedValue(new Error('DO not found'));
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.connect).toHaveBeenCalled();
    });

    it('handles connect failure gracefully', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        { applicationId: 'app-1', credentials: {}, id: 'prov-1', settings: {}, userId: 'u1' },
      ]);
      mockGetEffectiveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.getStatus.mockResolvedValue({
        state: { status: 'disconnected' },
      });
      mockGatewayClient.connect.mockRejectedValue(new Error('timeout'));

      // Should not throw
      await expect(service.ensureRunning()).resolves.toBeUndefined();
      expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalled();
    });
  });
});
