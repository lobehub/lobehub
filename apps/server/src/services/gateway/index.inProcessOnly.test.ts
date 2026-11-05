// @vitest-environment node
/**
 * Platforms flagged `requiresInProcessConnection` (WeCom: replies ride the bot's own long
 * connection) must never be handed to the external message gateway, which can forward inbound
 * events but not relay outbound frames.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayService } from '.';
import {
  mockFindEnabledByPlatform,
  mockFindEnabledByPlatformAndAppId,
  mockGatewayClient,
  mockGatewayEnv,
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
vi.mock('../bot/platforms', () =>
  import('./testUtils').then((m) => {
    const definitions = [
      { id: 'discord' },
      { id: 'wecom', name: 'WeCom', requiresInProcessConnection: true },
    ];
    const base = m.botPlatformsModule();
    return {
      ...base,
      platformRegistry: {
        getPlatform: (platform: string) => definitions.find((d) => d.id === platform),
        listPlatforms: () => definitions,
      },
    };
  }),
);

const providerFor = (platform: string) => ({
  applicationId: `${platform}-app`,
  credentials: { secret: 'x' },
  id: `${platform}-prov`,
  settings: {},
  userId: 'u1',
  workspaceId: null,
});

describe('GatewayService with an in-process-only platform', () => {
  let service: GatewayService;

  beforeEach(() => {
    resetGatewayServiceMocks();
    service = new GatewayService();
    mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = '1';
    mockGatewayClient.isConfigured = true;
    mockGatewayClient.isEnabled = true;
    mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
    mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });
    mockResolveConnectionMode.mockReturnValue('websocket');
    mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });
  });

  it('leaves its providers out of the reconcile sync', async () => {
    mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) => [
      providerFor(platform),
    ]);

    await service.ensureRunning();

    const connected = mockGatewayClient.connect.mock.calls.map(([config]) => config.platform);
    expect(connected).toEqual(['discord']);
    expect(mockFindEnabledByPlatform).not.toHaveBeenCalledWith(
      expect.anything(),
      'wecom',
      expect.anything(),
      expect.anything(),
    );
  });

  it('refuses a direct gateway connect and says why', async () => {
    mockFindEnabledByPlatformAndAppId.mockResolvedValue(providerFor('wecom'));

    await expect(service.startClient('wecom', 'wecom-app', 'u1')).resolves.toBe('started');

    expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith({
      applicationId: 'wecom-app',
      errorMessage: expect.stringContaining('message gateway cannot relay'),
      platform: 'wecom',
      status: 'failed',
    });
  });
});
