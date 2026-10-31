// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GatewayService } from '.';
import {
  mockFindByIds,
  mockFindEnabledByPlatform,
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
vi.mock('../bot/platforms', () => import('./testUtils').then((m) => m.botPlatformsModule()));

describe('GatewayService', () => {
  let service: GatewayService;

  beforeEach(() => {
    resetGatewayServiceMocks();
    service = new GatewayService();
  });

  describe('syncGatewayConnections reconciliation (via ensureRunning)', () => {
    const provider = {
      applicationId: 'app-1',
      credentials: { token: 'x' },
      id: 'prov-1',
      settings: {},
      userId: 'u1',
    };

    beforeEach(() => {
      mockGatewayEnv.MESSAGE_GATEWAY_ENABLED = '1';
      mockGatewayClient.isConfigured = true;
      mockGatewayClient.isEnabled = true;
      mockResolveConnectionMode.mockReturnValue('websocket');
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: [] });
    });

    it('disconnects gateway connections with no matching enabled provider', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-1',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
          {
            connectionId: 'stale-1',
            platform: 'wechat',
            state: { status: 'connected' },
            userId: 'gone',
          },
        ],
        total: 2,
      });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('stale-1');
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalledWith('prov-1');
      // Desired + connected → no reconnect either.
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('never disconnects messenger-owned connections', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'messenger:discord:singleton',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'system',
          },
          {
            connectionId: 'messenger:telegram:user-u1',
            platform: 'telegram',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 2,
      });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('includes registered-only ids (pruned from stats) in stale-connection cleanup', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['dormant-stale'] });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('dormant-stale');
    });

    it('marks still-existing (disabled) providers as disconnected when stale-cleaned', async () => {
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-disabled',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });
      mockFindByIds.mockResolvedValue([
        { applicationId: 'app-disabled', enabled: false, id: 'prov-disabled', platform: 'discord' },
      ]);

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('prov-disabled');
      expect(mockUpdateBotRuntimeStatus).toHaveBeenCalledWith({
        applicationId: 'app-disabled',
        platform: 'discord',
        status: 'disconnected',
      });
    });

    it('skips stale-connection cleanup when a platform provider query fails', async () => {
      // wechat providers fail to load → desired set incomplete → a healthy
      // wechat connection must NOT be treated as stale.
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) => {
        if (platform === 'wechat') throw new Error('db timeout');
        return [];
      });
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'wechat-prov',
            platform: 'wechat',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('still cleans live stale connections when registered-ids is unavailable', async () => {
      // Mid-rollout: gateway without /api/admin/registered-ids. The stats
      // snapshot alone must keep the stale pass alive for live connections,
      // while desired providers missing from the partial snapshot are deferred
      // instead of waking dormant DOs or being treated as disconnected.
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'stale-live',
            platform: 'wechat',
            state: { status: 'connected' },
            userId: 'gone',
          },
        ],
        total: 1,
      });
      mockGatewayClient.getRegisteredIds.mockRejectedValue(new Error('404 not found'));
      mockGatewayClient.getStatus.mockResolvedValue({ state: { status: 'dormant' } });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('stale-live');
      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalledWith('prov-1');
    });

    it('skips stale cleanup entirely when the provider recheck query fails', async () => {
      // Treating a failed recheck as "no rows" would bypass the TOCTOU guard
      // and could tear down a provider enabled mid-sync.
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'stale-1',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });
      mockFindByIds.mockRejectedValue(new Error('db timeout'));

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects the old DO of a webhook-switched provider without marking it disconnected', async () => {
      // An enabled provider switched from persistent to webhook mode: its old
      // gateway DO is stale and must go, but the row is served by the webhook
      // registration now — writing `disconnected` would make a working
      // channel look off (webhook-mode refreshes return the cached snapshot).
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockResolveConnectionMode.mockReturnValue('webhook');
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-webhook',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });
      mockFindByIds.mockResolvedValue([
        {
          applicationId: 'app-webhook',
          enabled: true,
          id: 'prov-webhook',
          platform: 'discord',
          settings: {},
        },
      ]);

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).toHaveBeenCalledWith('prov-webhook');
      expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ applicationId: 'app-webhook', status: 'disconnected' }),
      );
    });

    it('does not disconnect a provider enabled after the desired snapshot was built', async () => {
      // TOCTOU race: the user enables + connects a provider while the sync is
      // between buildDesiredConnections and fetchActualConnections. It shows
      // up in `actual` but not in `desired` — the fresh row recheck must keep
      // it connected.
      mockFindEnabledByPlatform.mockResolvedValue([]);
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-race',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });
      mockFindByIds.mockResolvedValue([
        {
          applicationId: 'app-race',
          enabled: true,
          id: 'prov-race',
          platform: 'discord',
          settings: {},
        },
      ]);

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ applicationId: 'app-race', status: 'disconnected' }),
      );
    });

    it('uses the stats snapshot instead of per-connection status calls', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-1',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('connects desired providers missing from the gateway snapshot', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'prov-1', platform: 'discord' }),
        { ensure: true },
      );
    });

    it('keeps (never stale-disconnects, never reconnects) providers whose credentials are undecryptable', async () => {
      // KEY_VAULTS_SECRET mishap scenario: the model returns the row with
      // empty credentials instead of dropping it — the connection must stay
      // untouched rather than being treated as stale.
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord'
          ? [{ applicationId: 'app-1', credentials: {}, id: 'prov-1', settings: {}, userId: 'u1' }]
          : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-1',
            platform: 'discord',
            state: { status: 'connected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });

      await service.ensureRunning();

      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
    });

    it('requests the full enabled set including undecryptable rows', async () => {
      await service.ensureRunning();

      expect(mockFindEnabledByPlatform).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.anything(),
        { includeUndecryptable: true },
      );
    });

    it('ensure-wakes registered-only desired ids instead of leaving them stranded', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['prov-1'] });
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'prov-1' }),
        { ensure: true },
      );
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('keeps a parked registered-only connection parked (ensure 409 is not a status reset)', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['prov-1'] });
      mockGatewayClient.connect.mockRejectedValue(new Error('409 connection parked'));

      await service.ensureRunning();

      // The 409 must not overwrite the bot's runtime status with a fresh state.
      expect(mockUpdateBotRuntimeStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ applicationId: 'app-1', status: 'starting' }),
      );
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('reconnects a desired connection reported disconnected by stats without probing its DO', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({
        byPlatform: {},
        connections: [
          {
            connectionId: 'prov-1',
            platform: 'discord',
            state: { status: 'disconnected' },
            userId: 'u1',
          },
        ],
        total: 1,
      });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['prov-1'] });
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'prov-1' }),
        { ensure: true },
      );
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('reconciles 2,000 registered connections with two snapshot requests and no per-connection probes', async () => {
      const providers = Array.from({ length: 2000 }, (_, index) => ({
        ...provider,
        applicationId: `app-${index}`,
        id: `prov-${index}`,
      }));

      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? providers : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({
        ids: providers.map(({ id }) => id),
      });

      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.getStats).toHaveBeenCalledTimes(1);
      expect(mockGatewayClient.getRegisteredIds).toHaveBeenCalledTimes(1);
      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      // Registered-only wakes are capped per round so a large fleet cannot
      // turn the reconcile into a wake storm; the remainder waits for the
      // next cron round.
      expect(mockGatewayClient.connect).toHaveBeenCalledTimes(50);
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('samples registered-only wakes instead of always burning the cap on the same prefix', async () => {
      // A stable iteration order + head-first cap would starve ids after
      // position 50 forever when the early ones stay registered-only (parked
      // 409s). Force the sampler's rng to pick from the tail and assert the
      // selection is not the head prefix.
      const providers = Array.from({ length: 2000 }, (_, index) => ({
        ...provider,
        applicationId: `app-${index}`,
        id: `prov-${index}`,
      }));

      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? providers : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockResolvedValue({
        ids: providers.map(({ id }) => id),
      });
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.999_999);
      try {
        await service.ensureRunning();
      } finally {
        randomSpy.mockRestore();
      }

      expect(mockGatewayClient.connect).toHaveBeenCalledTimes(50);
      const wokenIds = new Set(
        mockGatewayClient.connect.mock.calls.map(
          (call) => (call[0] as { connectionId: string }).connectionId,
        ),
      );
      // rng pinned to ~1 → the sampler reaches the tail; the old head-first
      // cap could only ever pick prov-0..prov-49 and would return exactly
      // that prefix.
      expect(wokenIds.has('prov-1999')).toBe(true);
      const isHeadPrefix = [...wokenIds].every((id) => Number(id.split('-')[1]) < 50);
      expect(isHeadPrefix).toBe(false);
    });

    it('uses registered ids as a complete existence snapshot when stats is unavailable', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockRejectedValue(new Error('stats unavailable'));
      mockGatewayClient.getRegisteredIds.mockResolvedValue({ ids: ['prov-1'] });
      mockGatewayClient.connect.mockResolvedValue({ status: 'connecting' });

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      // With no stats, every desired id is registered-only (status unknown) —
      // still handled via the capped ensure wake, never a per-DO status probe.
      expect(mockGatewayClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'prov-1' }),
        { ensure: true },
      );
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });

    it('defers missing desired ids when registered ids are unavailable', async () => {
      mockFindEnabledByPlatform.mockImplementation(async (_db: unknown, platform: string) =>
        platform === 'discord' ? [provider] : [],
      );
      mockGatewayClient.getStats.mockResolvedValue({ byPlatform: {}, connections: [], total: 0 });
      mockGatewayClient.getRegisteredIds.mockRejectedValue(new Error('registered unavailable'));

      await service.ensureRunning();

      expect(mockGatewayClient.getStatus).not.toHaveBeenCalled();
      expect(mockGatewayClient.connect).not.toHaveBeenCalled();
      expect(mockGatewayClient.disconnect).not.toHaveBeenCalled();
    });
  });
});
