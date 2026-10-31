// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayService } from '.';
import {
  mockFindEnabledByPlatform,
  mockGatewayClient,
  mockGatewayEnv,
  mockIsBotFeatureAccessAllowed,
  mockResolveConnectionMode,
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

  // ─── syncGatewayConnections ───

  describe('syncGatewayConnections (via ensureRunning)', () => {
    beforeEach(() => {
      mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = '1';
      mockGatewayClient.isConfigured = true;
      mockGatewayClient.isEnabled = true;
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });
    });

    it('skips webhook-mode providers', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { token: 'x' },
          id: 'prov-1',
          settings: {},
          userId: 'u1',
        },
      ]);
      mockResolveConnectionMode.mockReturnValue('webhook');

      await service.ensureRunning();

      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('ensure-wakes a registered-only desired provider without probing status', async () => {
      // Registered-only (pruned from stats) used to be skipped outright, but a
      // stranded DO (alarm chain lost) looks exactly like this and sleeps
      // forever unless woken. The wake is an `ensure` connect, never a status
      // probe: parked connections answer 409 and keep their park.
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { token: 'x' },
          id: 'prov-1',
          settings: {},
          userId: 'u1',
        },
      ]);
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['prov-1'] });
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'prov-1' }),
        { ensure: true },
      );
    });

    it('connects disconnected providers', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord'
          ? [
              {
                applicationId: 'app-1',
                credentials: { token: 'x' },
                id: 'prov-1',
                settings: {},
                userId: 'u1',
              },
            ]
          : [],
      );
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'app-1',
          connectionId: 'prov-1',
          platform: 'discord',
        }),
        { ensure: true },
      );
      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'starting' }),
      );
    });

    it('persists a dormant ensure result as dormant, not starting', async () => {
      // An `ensure` reconcile of a sparse-polling DO can legitimately return
      // `dormant`; it must be mapped through the shared helper so it is not
      // collapsed to `starting` (the DO sends no correcting callback).
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord'
          ? [
              {
                applicationId: 'app-1',
                credentials: { token: 'x' },
                id: 'prov-1',
                settings: {},
                userId: 'u1',
              },
            ]
          : [],
      );
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.connect.mockResolvedValue({ status: 'dormant' });

      await service.ensureRunning();

      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'dormant' }),
      );
      expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'starting' }),
      );
    });

    it('disconnects paid-only WeChat providers when the owner is on a free plan', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db, platform) =>
        platform === 'wechat'
          ? [
              {
                applicationId: 'wechat-app',
                credentials: { botToken: 'token' },
                id: 'wechat-provider',
                settings: {},
                userId: 'free-user',
              },
            ]
          : [],
      );
      mockResolveConnectionMode.mockReturnValue('polling');
      mockIsBotFeatureAccessAllowed.mockResolvedValue(false);
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['wechat-provider'] });

      await service.ensureRunning();

      expect(mockIsBotFeatureAccessAllowed).toHaveBeenCalledWith({
        applicationId: 'wechat-app',
        platform: 'wechat',
        userId: 'free-user',
        workspaceId: undefined,
      });
      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('wechat-provider');
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'wechat-app',
          errorMessage: 'This bot channel requires a paid plan.',
          platform: 'wechat',
          status: 'failed',
        }),
      );
    });

    it.each([
      { snapshot: 'stats-only', statsUnavailable: false },
      { snapshot: 'unavailable', statsUnavailable: true },
    ])(
      'disconnects a paid-gated provider when the registry snapshot is $snapshot',
      async ({ statsUnavailable }) => {
        mockFindEnabledByPlatform.mockImplementation(async (_db, platform) =>
          platform === 'wechat'
            ? [
                {
                  applicationId: 'wechat-app',
                  credentials: { botToken: 'token' },
                  id: 'wechat-provider',
                  settings: {},
                  userId: 'free-user',
                },
              ]
            : [],
        );
        mockResolveConnectionMode.mockReturnValue('polling');
        mockIsBotFeatureAccessAllowed.mockResolvedValue(false);
        mockGatewayClient.getRegisteredIds.mockRejectedValue(
          new Error('registered-ids unavailable'),
        );
        if (statsUnavailable) {
          mockGatewayClient.getStats.mockRejectedValue(new Error('stats unavailable'));
        }

        await service.ensureRunning();

        expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('wechat-provider');
        expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
        expect(mockGatewayClient.connect).not.toHaveBeenCalled();
      },
    );

    it('sets connected status for sync connect result', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { token: 'x' },
          id: 'prov-1',
          settings: {},
          userId: 'u1',
        },
      ]);
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.connect.mockResolvedValue({ status: 'connected' });

      await service.ensureRunning();

      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'connected' }),
      );
    });

    it('defers desired providers when the gateway snapshot is unavailable', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { token: 'x' },
          id: 'prov-1',
          settings: {},
          userId: 'u1',
        },
      ]);
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.getStats.mockRejectedValue(new Error('stats unavailable'));
      mockGatewayClient.getRegisteredIds.mockRejectedValue(new Error('registered-ids unavailable'));

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('handles connect failure gracefully', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([
        {
          applicationId: 'app-1',
          credentials: { token: 'x' },
          id: 'prov-1',
          settings: {},
          userId: 'u1',
        },
      ]);
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.connect.mockRejectedValue(new Error('timeout'));

      // Should not throw
      await expect(service.ensureRunning()).resolves.toBeUndefined();
      expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalled();
    });

    it('keeps the connection when the feature gate check itself throws', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'wechat'
          ? [
              {
                applicationId: 'wechat-app',
                credentials: { botToken: 'token' },
                id: 'wechat-provider',
                settings: {},
                userId: 'u1',
              },
            ]
          : [],
      );
      mockResolveConnectionMode.mockReturnValue('polling');
      mockIsBotFeatureAccessAllowed.mockRejectedValue(new Error('subscription service down'));
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['wechat-provider'] });

      await service.ensureRunning();

      // Fail-open: no disconnect, provider stays in the desired set. As a
      // desired registered-only id it may receive the idempotent ensure wake,
      // which preserves whatever state the gateway holds.
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalledWith(expect.anything(), {
        ensure: false,
      });
    });

    it('does not repeatedly disconnect a gated provider absent from the gateway snapshot', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db, platform) =>
        platform === 'wechat'
          ? [
              {
                applicationId: 'wechat-app',
                credentials: { botToken: 'token' },
                id: 'wechat-provider',
                settings: {},
                userId: 'free-user',
              },
            ]
          : [],
      );
      mockResolveConnectionMode.mockReturnValue('polling');
      mockIsBotFeatureAccessAllowed.mockResolvedValue(false);

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          applicationId: 'wechat-app',
          status: 'failed',
        }),
      );
    });
  });
});
