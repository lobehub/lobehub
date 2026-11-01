// @vitest-environment node
/**
 * Characterization of the per-provider client lifecycle (`startClient`,
 * `stopClient`, `stop`) in gateway mode and in the in-process (non-Vercel)
 * legacy mode.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayService } from '.';
import {
  mockAssertBotFeatureAccess,
  mockFindByPlatformAndAppId,
  mockFindEnabledByPlatformAndAppId,
  mockGatewayClient,
  mockGatewayManager,
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

const provider = {
  applicationId: 'app-1',
  credentials: { botToken: 'bot-token' },
  id: 'prov-1',
  settings: { watchKeywords: [{ keyword: 'deploy' }] },
  userId: 'owner-1',
  workspaceId: null,
};

describe('GatewayService client lifecycle', () => {
  let service: GatewayService;

  beforeEach(() => {
    resetGatewayServiceMocks();
    service = new GatewayService();
  });

  describe('via the message gateway', () => {
    beforeEach(() => {
      mockGatewayClient.isEnabled = true;
    });

    it('connects a persistent provider with its capabilities and marks it connected', async () => {
      mockFindEnabledByPlatformAndAppId.mockResolvedValue(provider);
      mockResolveConnectionMode.mockReturnValue('websocket');

      await expect(service.startClient('discord', 'app-1', 'user-1')).resolves.toBe('started');

      expect(mockAssertBotFeatureAccess).toHaveBeenCalledWith({
        action: 'manage',
        applicationId: 'app-1',
        platform: 'discord',
        userId: 'owner-1',
        workspaceId: undefined,
      });
      expect(mockGatewayClient.connect).toHaveBeenCalledWith({
        applicationId: 'app-1',
        capabilities: { messageMonitoring: { enabled: true } },
        connectionId: 'prov-1',
        connectionMode: 'websocket',
        credentials: { botToken: 'bot-token' },
        platform: 'discord',
        userId: 'user-1',
        webhookPath: '/api/agent/webhooks/discord/app-1',
      });
      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith({
        applicationId: 'app-1',
        platform: 'discord',
        status: 'connected',
      });
      expect(mockGatewayManager.startClient).not.toHaveBeenCalled();
    });

    it('runs a webhook-mode provider locally instead of on the gateway', async () => {
      mockFindEnabledByPlatformAndAppId.mockResolvedValue(provider);
      mockResolveConnectionMode.mockReturnValue('webhook');

      await expect(service.startClient('telegram', 'app-1', 'user-1')).resolves.toBe('started');

      expect(mockGatewayManager.startClient).toHaveBeenCalledWith('telegram', 'app-1');
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
      expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalled();
    });

    it('refuses to start a provider that is not enabled', async () => {
      await expect(service.startClient('discord', 'app-1', 'user-1')).rejects.toThrow(
        'No enabled provider found for discord:app-1',
      );
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('stops the local client, disconnects the provider and marks it disconnected', async () => {
      mockGatewayManager.isRunning = true;
      mockFindByPlatformAndAppId.mockResolvedValue({ id: 'prov-1' });

      await service.stopClient('discord', 'app-1');

      expect(mockGatewayManager.stopClient).toHaveBeenCalledWith('discord', 'app-1');
      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('prov-1');
      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith({
        applicationId: 'app-1',
        platform: 'discord',
        status: 'disconnected',
      });
    });

    it('still marks the provider disconnected when the gateway disconnect fails', async () => {
      mockFindByPlatformAndAppId.mockResolvedValue({ id: 'prov-1' });
      mockGatewayClient.disconnect.mockRejectedValue(new Error('gateway down'));

      await service.stopClient('discord', 'app-1');

      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith({
        applicationId: 'app-1',
        platform: 'discord',
        status: 'disconnected',
      });
    });

    it('skips the disconnect when no provider row exists', async () => {
      await service.stopClient('discord', 'app-1');

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('in-process (gateway disabled, not on Vercel)', () => {
    it('starts the manager on demand, then the client', async () => {
      mockGatewayManager.start.mockImplementation(async () => {
        mockGatewayManager.isRunning = true;
      });

      await expect(service.startClient('discord', 'app-1', 'user-1')).resolves.toBe('started');

      expect(mockGatewayManager.start).toHaveBeenCalledTimes(1);
      expect(mockGatewayManager.startClient).toHaveBeenCalledWith('discord', 'app-1');
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('reuses a running manager', async () => {
      mockGatewayManager.isRunning = true;

      await service.startClient('discord', 'app-1', 'user-1');

      expect(mockGatewayManager.start).not.toHaveBeenCalled();
      expect(mockGatewayManager.startClient).toHaveBeenCalledWith('discord', 'app-1');
    });

    it('stops the client on a running manager and marks it disconnected', async () => {
      mockGatewayManager.isRunning = true;

      await service.stopClient('discord', 'app-1', 'user-1');

      expect(mockGatewayManager.stopClient).toHaveBeenCalledWith('discord', 'app-1');
      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith({
        applicationId: 'app-1',
        platform: 'discord',
        status: 'disconnected',
      });
    });

    it('stop() stops a running manager and is a no-op otherwise', async () => {
      await service.stop();
      expect(mockGatewayManager.stop).not.toHaveBeenCalled();

      mockGatewayManager.isRunning = true;
      await service.stop();
      expect(mockGatewayManager.stop).toHaveBeenCalledTimes(1);
    });
  });
});
