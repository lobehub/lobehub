// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayService } from '.';
import {
  mockFindAllLinksByPlatform,
  mockFindEnabledByPlatform,
  mockGatewayClient,
  mockNodeGateway,
  mockNodeGatewayClient,
  mockResolveConnectionMode,
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

  // ─── listDesiredConnectionsForHost (restart recovery, pull side) ───

  describe('listDesiredConnectionsForHost', () => {
    beforeEach(() => {
      mockGatewayClient.isEnabled = true;
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord'
          ? [
              {
                applicationId: 'app-1',
                credentials: { token: 'x' },
                id: 'prov-1',
                settings: { watchKeywords: [{ keyword: 'hi' }] },
                userId: 'u1',
              },
            ]
          : [],
      );
    });

    // The whole point of sharing one builder: whichever side establishes a
    // connection, the gateway ends up holding the same config. A drifting
    // second builder would show up here and nowhere else.
    it('hands back exactly the payload the reconcile would have pushed', async () => {
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();
      const pushed = mockGatewayClient.connect.mock.calls[0][0];

      const { connections } = await service.listDesiredConnectionsForHost('default');

      expect(connections).toHaveLength(1);
      expect(connections[0]).toEqual({ config: pushed, ensure: true });
    });

    // A pull changes nothing and wakes nothing. It reads another host's
    // registry to see what is still held there — two admin requests, no
    // fan-out — but it must never mutate a gateway, and never probe a single
    // connection's status, which is what would drag a dormant one up.
    it('reads, but never mutates a gateway or probes a connection', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;

      await service.listDesiredConnectionsForHost('node');

      for (const client of [mockGatewayClient, mockNodeGatewayClient]) {
        expect(client.connect).not.toHaveBeenCalled();
        expect(client.disconnect).not.toHaveBeenCalled();
        expect(client.disconnectAll).not.toHaveBeenCalled();
        expect(client.getStatus).not.toHaveBeenCalled();
      }
      // Its own host is never queried — the answer comes from the database.
      expect(mockNodeGatewayClient.getStats).not.toHaveBeenCalled();
    });

    it('returns only the requested host slice', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'wechat'
          ? [
              {
                applicationId: 'wx-app',
                credentials: { token: 'w' },
                id: 'prov-wechat',
                settings: {},
                userId: 'u-wx',
              },
            ]
          : [
              {
                applicationId: 'dc-app',
                credentials: { token: 'd' },
                id: `prov-${platform}`,
                settings: {},
                userId: 'u-dc',
              },
            ],
      );

      const node = await service.listDesiredConnectionsForHost('node');
      const def = await service.listDesiredConnectionsForHost('default');

      expect(node.connections.map((entry) => entry.config.connectionId)).toEqual(['prov-wechat']);
      expect(def.connections.map((entry) => entry.config.connectionId)).not.toContain(
        'prov-wechat',
      );
    });

    // One unreadable row used to be able to fail the whole recovery. A row
    // that can never connect is data we exclude, not a reason to leave a
    // gateway empty.
    it('excludes an undecryptable row without failing the call', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord'
          ? [
              { applicationId: 'app-1', credentials: {}, id: 'prov-1', settings: {}, userId: 'u1' },
              {
                applicationId: 'app-2',
                credentials: { token: 'x' },
                id: 'prov-2',
                settings: {},
                userId: 'u2',
              },
            ]
          : [],
      );

      const result = await service.listDesiredConnectionsForHost('default');

      expect(result.complete).toBe(true);
      expect(result.excluded).toBe(1);
      expect(result.connections.map((entry) => entry.config.connectionId)).toEqual(['prov-2']);
    });

    it('reports complete:false when a platform fails to load', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) => {
        if (platform === 'telegram') throw new Error('key vault unavailable');
        return [];
      });

      const result = await service.listDesiredConnectionsForHost('default');

      expect(result.complete).toBe(false);
    });

    it('includes messenger polling links and excludes ones with no usable token', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
        { applicationId: 'wx-app', credentials: {}, tenantId: 't2', userId: 'u2' },
      ]);

      const result = await service.listDesiredConnectionsForHost('default');

      expect(result.excluded).toBe(1);
      expect(result.connections).toHaveLength(1);
      expect(result.connections[0].config).toMatchObject({
        connectionId: 'messenger:wechat:t1:user-u1',
        connectionMode: 'polling',
        credentials: {
          baseUrl: 'https://ilink',
          botId: 'bot-1',
          botToken: 'tok-1',
          webhookToken: 'gateway-service-token',
        },
        webhookPath: '/api/agent/messenger/webhooks/wechat',
      });
    });

    // Routing a platform here does not mean this host can run it. Handing over
    // credentials for a connection it will reject arms nothing and exposes
    // them for no reason — and the reconcile already refuses to move such a
    // platform, so leaving the gap here would put the two out of step.
    it('withholds credentials for a platform this host says it cannot serve', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;
      mockNodeGatewayClient.getCapabilities.mockResolvedValue({
        platforms: ['whatsapp-baileys'],
      });
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
      ]);
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });

      const result = await service.listDesiredConnectionsForHost('node');

      expect(result.connections).toEqual([]);
    });

    // Today's production shape: the node URL is configured but no platform is
    // routed there yet. Deploying the node gateway must not drag the other
    // host's fleet over — it should be handed nothing at all.
    it('hands a host nothing while no platform is routed to it', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = [];
      mockNodeGatewayClient.isConfigured = true;
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
      ]);

      const result = await service.listDesiredConnectionsForHost('node');

      expect(result.connections).toEqual([]);
      expect(result.deferred).toBe(0);
    });

    // Routing a platform here does not make its connections safe to build: the
    // host that owned them a moment ago is still polling. Handing one over
    // before that host is drained double-delivers every message.
    it('withholds a connection the previous host has not released yet', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
      ]);
      // The default host still holds it — mid-migration.
      mockGatewayClient.getRegisteredIds.mockResolvedValue({
        ids: ['messenger:wechat:t1:user-u1'],
      });

      const result = await service.listDesiredConnectionsForHost('node');

      expect(result.connections).toEqual([]);
      expect(result.deferred).toBe(1);
      // Partial answer, so the caller keeps asking rather than settling.
      expect(result.complete).toBe(false);
    });

    // A stats-only snapshot omits dormant registrations, so an id missing from
    // it proves nothing about whether the other host released it. Marking the
    // answer incomplete is not enough on its own: the caller applies what it
    // receives and only then asks again, so the flag would land after the
    // duplicate it was meant to prevent. The connection has to be withheld.
    it('withholds a connection the other host cannot be proven to have released', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
      ]);
      // Stats answered, registered-ids did not: a live host we can only half see.
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockRejectedValue(new Error('registry unavailable'));

      const result = await service.listDesiredConnectionsForHost('node');

      expect(result.connections).toEqual([]);
      expect(result.deferred).toBe(1);
      expect(result.complete).toBe(false);
    });

    it('hands the connection over once the previous host has released it', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
      ]);
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });

      const result = await service.listDesiredConnectionsForHost('node');

      expect(result.connections).toHaveLength(1);
      expect(result.deferred).toBe(0);
      expect(result.complete).toBe(true);
    });

    // Same rule from the other direction: a host we could not reach shows
    // nothing, which is no more proof of release than a half-seen one. Restart
    // recovery is an optimisation over the reconcile, so when it cannot be done
    // safely the right move is not to do it.
    it('withholds when the other host cannot be read at all', async () => {
      mockNodeGateway.configured = true;
      mockNodeGateway.platforms = ['wechat'];
      mockNodeGatewayClient.isConfigured = true;
      mockResolveConnectionMode.mockReturnValue('polling');
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockFindAllLinksByPlatform.mockResolvedValue([
        {
          applicationId: 'wx-app',
          credentials: { baseUrl: 'https://ilink', botId: 'bot-1', botToken: 'tok-1' },
          tenantId: 't1',
          userId: 'u1',
        },
      ]);
      mockGatewayClient.getStats.mockRejectedValue(new Error('admin down'));
      mockGatewayClient.getRegisteredIds.mockRejectedValue(new Error('admin down'));

      const result = await service.listDesiredConnectionsForHost('node');

      expect(result.connections).toEqual([]);
      expect(result.deferred).toBe(1);
    });

    it('reports complete:false when messenger links fail to load', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockFindAllLinksByPlatform.mockRejectedValue(new Error('link listing failed'));

      const result = await service.listDesiredConnectionsForHost('default');

      expect(result.complete).toBe(false);
    });
  });
});
