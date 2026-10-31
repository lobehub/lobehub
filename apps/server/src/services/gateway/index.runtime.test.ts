// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayService } from '.';
import {
  mockFindByAgentId,
  mockFindEnabledByPlatformAndAppId,
  mockGatewayClient,
  mockGatewayEnv,
  mockGatewayManager,
  mockResolveConnectionMode,
  mockResolveMessengerInstallation,
  mockUpdateBotRuntimeStatus,
  resetGatewayServiceMocks,
} from './testUtils';

vi.mock('@/envs/gateway', () => import('./testUtils').then((m) => m.envsGatewayModule()));
vi.mock('./MessageGatewayClient', () =>
  import('./testUtils').then((m) => m.messageGatewayClientModule()),
);
vi.mock('@/database/models/messengerAccountLink', () =>
  import('./testUtils').then((m) => m.messengerAccountLinkModule()),
);
vi.mock('./GatewayManager', () => import('./testUtils').then((m) => m.gatewayManagerModule()));
vi.mock('@/database/core/db-adaptor', () => import('./testUtils').then((m) => m.dbAdaptorModule()));
vi.mock('@/database/models/agentBotProvider', () =>
  import('./testUtils').then((m) => m.agentBotProviderModule()),
);
vi.mock('@/server/modules/KeyVaultsEncrypt', () =>
  import('./testUtils').then((m) => m.keyVaultsEncryptModule()),
);
vi.mock('./runtimeStatus', () => import('./testUtils').then((m) => m.runtimeStatusModule()));
vi.mock('@/business/server/bot/featureAccess', () =>
  import('./testUtils').then((m) => m.featureAccessModule()),
);
vi.mock('@/server/services/messenger/installations', () =>
  import('./testUtils').then((m) => m.messengerInstallationsModule()),
);
vi.mock('@/server/services/messenger/platforms', () =>
  import('./testUtils').then((m) => m.messengerPlatformsModule()),
);
vi.mock('../bot/platforms', () => import('./testUtils').then((m) => m.botPlatformsModule()));

describe('GatewayService', () => {
  let service: GatewayService;

  beforeEach(() => {
    resetGatewayServiceMocks();
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

  describe('runtime status refresh', () => {
    beforeEach(() => {
      mockGatewayClient.isEnabled = true;
      mockResolveConnectionMode.mockReturnValue('websocket');
    });

    it('preserves gateway error codes during a single refresh', async () => {
      mockFindEnabledByPlatformAndAppId.mockResolvedValue({ id: 'prov-1', settings: {} });
      mockGatewayClient.getStatus.mockResolvedValue({
        state: { error: 'invalid token', errorCode: 'invalid_credentials', status: 'error' },
      });

      await service.refreshBotRuntimeStatus('discord', 'app-1');

      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith({
        applicationId: 'app-1',
        errorCode: 'invalid_credentials',
        errorMessage: 'invalid token',
        platform: 'discord',
        status: 'failed',
      });
    });

    it('preserves gateway error codes during an agent-wide refresh', async () => {
      mockFindByAgentId.mockResolvedValue([
        {
          applicationId: 'app-1',
          enabled: true,
          id: 'prov-1',
          platform: 'discord',
          settings: {},
        },
      ]);
      mockGatewayClient.getStatus.mockResolvedValue({
        state: { error: 'invalid token', errorCode: 'invalid_credentials', status: 'error' },
      });

      await service.refreshBotRuntimeStatusesByAgent('agent-1');

      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith({
        applicationId: 'app-1',
        errorCode: 'invalid_credentials',
        errorMessage: 'invalid token',
        platform: 'discord',
        status: 'failed',
      });
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

  describe('per-user messenger lifecycle', () => {
    it('registers WeChat as a real polling connection with the complete QR credential bundle', async () => {
      mockGatewayClient.isEnabled = true;
      mockResolveMessengerInstallation.mockResolvedValue({
        applicationId: 'bot@im.wechat',
        baseUrl: 'https://ilink.example.com',
        botId: 'bot@im.wechat',
        botToken: 'secret-token',
      });

      const connectionId = await service.ensureUserMessengerConnected({
        installationKey: 'wechat:alice@im.wechat',
        platform: 'wechat',
        userId: 'user-1',
      });

      expect(connectionId).toBe('messenger:wechat:alice@im.wechat:user-user-1');
      expect(mockGatewayClient.connect).toHaveBeenCalledWith({
        applicationId: 'bot@im.wechat',
        // Per-user messenger connections have no bot-provider settings row, so
        // gated capabilities always resolve to disabled.
        capabilities: { messageMonitoring: { enabled: false } },
        connectionId,
        connectionMode: 'polling',
        credentials: {
          baseUrl: 'https://ilink.example.com',
          botId: 'bot@im.wechat',
          botToken: 'secret-token',
          webhookToken: 'gateway-service-token',
        },
        platform: 'wechat',
        userId: 'user-1',
        webhookPath: '/api/agent/messenger/webhooks/wechat',
      });
    });

    it('disconnects a user WeChat poller even when active gateway flows are disabled', async () => {
      mockGatewayClient.isConfigured = true;
      mockGatewayClient.isEnabled = false;

      await service.disconnectUserMessenger({
        installationKey: 'wechat:alice@im.wechat',
        platform: 'wechat',
        userId: 'user-1',
      });

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith(
        'messenger:wechat:alice@im.wechat:user-user-1',
      );
    });
  });
});
