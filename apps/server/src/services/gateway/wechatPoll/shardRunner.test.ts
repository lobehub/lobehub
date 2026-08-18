// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DecryptedBotProvider } from '@/database/models/agentBotProvider';

import { wechatShardOf } from './config';
import { runWechatPollShard, runWechatPollTick, type WechatShardClient } from './shardRunner';

// ─── Module mocks (only the heavyweight deps; redis is injected) ───

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: vi.fn(async () => ({})) }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { initWithEnvKey: vi.fn(async () => ({})) },
}));
vi.mock('@/database/models/agentBotProvider', () => ({
  AgentBotProviderModel: { findEnabledByPlatform: vi.fn(async () => []) },
}));
vi.mock('@/server/modules/AgentRuntime/redis', () => ({
  getAgentRuntimeRedisClient: vi.fn(() => null),
}));
vi.mock('@/server/services/bot/platforms', () => ({
  platformRegistry: { createClient: vi.fn(), getPlatform: vi.fn(() => ({ id: 'wechat' })) },
  resolveBotProviderConfig: vi.fn(() => ({ config: {} })),
}));
vi.mock('../MessageGatewayClient', () => ({
  getMessageGatewayClient: vi.fn(() => ({ disconnect: vi.fn(), isConfigured: false })),
}));

const featureAccessMock = vi.hoisted(() => ({
  isBotFeatureAccessAllowed: vi.fn(async (_params: { applicationId?: string }) => true),
}));
vi.mock('@/business/server/bot/featureAccess', () => featureAccessMock);

const connectQueueMock = vi.hoisted(() => ({
  popAll: vi.fn(async () => [] as { applicationId: string; platform: string; userId: string }[]),
  remove: vi.fn(async () => {}),
}));
vi.mock('../botConnectQueue', () => ({ BotConnectQueue: vi.fn(() => connectQueueMock) }));

// ─── Fakes ───

/** In-memory Redis covering exactly the commands lease/mode/pollState use. */
class FakeRedis {
  store = new Map<string, string>();

  async set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    if (args.includes('NX') && this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const key of keys) if (this.store.delete(key)) n++;
    return n;
  }

  async eval(script: string, _numKeys: number, key: string, holder: string): Promise<number> {
    if (this.store.get(key) !== holder) return 0;
    if (script.includes('DEL')) this.store.delete(key);
    return 1;
  }
}

const makeProvider = (applicationId: string): DecryptedBotProvider =>
  ({
    applicationId,
    credentials: { botToken: `token-${applicationId}` },
    enabled: true,
    id: `prov-${applicationId}`,
    platform: 'wechat',
    userId: 'user-1',
    workspaceId: null,
  }) as unknown as DecryptedBotProvider;

/**
 * Stand-in for the real platform client: `start` hands the runner a poll task
 * that only settles once `stop` is called, matching how the WeChat client's
 * loop unwinds on abort.
 */
const makeFakeClient = (): WechatShardClient => {
  let end: () => void = () => {};
  const loop = new Promise<void>((resolve) => {
    end = resolve;
  });
  return {
    start: async ({ waitUntil }) => {
      waitUntil(loop);
    },
    stop: async () => {
      end();
    },
  };
};

const ACTIVE_MODE_KEY = 'wechat:poller:active-mode';

describe('wechat poll shard runner', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
    vi.clearAllMocks();
    featureAccessMock.isBotFeatureAccessAllowed.mockImplementation(async () => true);
    connectQueueMock.popAll.mockResolvedValue([]);
    process.env.WECHAT_GATEWAY_HOST_ENABLED = '1';
    delete process.env.WECHAT_POLL_SHARD_COUNT;
    // Steady state for the worker tests; transition tests clear this.
    redis.store.set(ACTIVE_MODE_KEY, 'host');
  });

  afterEach(() => {
    delete process.env.WECHAT_GATEWAY_HOST_ENABLED;
    delete process.env.WECHAT_POLL_SHARD_COUNT;
  });

  // ─── Gating ───

  it('returns disabled without touching redis when the flag is off', async () => {
    process.env.WECHAT_GATEWAY_HOST_ENABLED = '0';
    redis.store.delete(ACTIVE_MODE_KEY);
    const result = await runWechatPollShard(0, { redis: redis as never });
    expect(result).toEqual({ role: 'skipped', skippedReason: 'disabled' });
    expect(redis.store.size).toBe(0);
  });

  it('skips shards outside the configured shard count', async () => {
    process.env.WECHAT_POLL_SHARD_COUNT = '1';
    const result = await runWechatPollShard(1, { redis: redis as never });
    expect(result).toEqual({ role: 'skipped', skippedReason: 'shard-out-of-range' });
  });

  it('skips when redis is unavailable', async () => {
    const result = await runWechatPollShard(0, { redis: null });
    expect(result).toEqual({ role: 'skipped', skippedReason: 'no-redis' });
  });

  // ─── Lease + membership ───

  it('only one of two concurrent invocations becomes the worker', async () => {
    const options = {
      durationMs: 50,
      loadProviders: async () => [],
      redis: redis as never,
    };
    const [a, b] = await Promise.all([
      runWechatPollShard(0, options),
      runWechatPollShard(0, options),
    ]);
    expect([a.role, b.role].sort()).toEqual(['skipped', 'worker']);
    expect([a.skippedReason, b.skippedReason]).toContain('lease-held');
  });

  it('starts clients only for providers assigned to this shard', async () => {
    process.env.WECHAT_POLL_SHARD_COUNT = '2';
    const ids = ['app-a', 'app-b', 'app-c', 'app-d', 'app-e'];
    const shard0 = ids.filter((id) => wechatShardOf(id, 2) === 0);
    expect(shard0.length).toBeGreaterThan(0);
    expect(shard0.length).toBeLessThan(ids.length);

    const started: string[] = [];
    const result = await runWechatPollShard(0, {
      createClient: (provider) => {
        started.push(provider.applicationId);
        return makeFakeClient();
      },
      durationMs: 50,
      loadProviders: async () => ids.map(makeProvider),
      redis: redis as never,
    });

    expect(result.role).toBe('worker');
    expect(started.sort()).toEqual(shard0.sort());
  });

  it('excludes feature-gated, credential-less and parked providers', async () => {
    process.env.WECHAT_POLL_SHARD_COUNT = '1';
    featureAccessMock.isBotFeatureAccessAllowed.mockImplementation(
      async (params: { applicationId?: string }) => params.applicationId !== 'gated',
    );
    const noToken = makeProvider('no-token');
    (noToken as { credentials: Record<string, string> }).credentials = {};
    // A dead session: only a re-scan revives it, so the worker must not start it.
    redis.store.set('wechat:poll:parked:parked-bot', '1');

    const started: string[] = [];
    await runWechatPollShard(0, {
      createClient: (provider) => {
        started.push(provider.applicationId);
        return makeFakeClient();
      },
      durationMs: 50,
      loadProviders: async () => [
        makeProvider('gated'),
        makeProvider('parked-bot'),
        noToken,
        makeProvider('ok'),
      ],
      redis: redis as never,
    });

    expect(started).toEqual(['ok']);
  });

  // ─── Worker lifecycle ───

  it('releases the lease at deadline so the next claim takes over immediately', async () => {
    const result = await runWechatPollShard(0, {
      durationMs: 50,
      loadProviders: async () => [],
      redis: redis as never,
    });

    expect(result.role).toBe('worker');
    expect(redis.store.has('wechat:poll:lease:0')).toBe(false);

    // The service loop's next tick can claim it at once — that is the handover.
    const next = await runWechatPollShard(0, {
      durationMs: 10,
      loadProviders: async () => [],
      redis: redis as never,
    });
    expect(next.role).toBe('worker');
  });

  it('stops every client before releasing the lease', async () => {
    process.env.WECHAT_POLL_SHARD_COUNT = '1';
    const stopped: string[] = [];
    let leaseAtStop: boolean | undefined;

    await runWechatPollShard(0, {
      createClient: (provider) => {
        const client = makeFakeClient();
        return {
          start: client.start,
          stop: async () => {
            // The next claimant must never find a free lease while a
            // predecessor client is still winding down.
            leaseAtStop = redis.store.has('wechat:poll:lease:0');
            stopped.push(provider.applicationId);
            await client.stop();
          },
        };
      },
      durationMs: 50,
      loadProviders: async () => [makeProvider('a')],
      redis: redis as never,
    });

    expect(stopped).toEqual(['a']);
    expect(leaseAtStop).toBe(true);
  });

  it('a hung client cannot pin the worker past deadline + grace', async () => {
    process.env.WECHAT_POLL_SHARD_COUNT = '1';
    const started: string[] = [];
    const start = Date.now();

    const result = await runWechatPollShard(0, {
      createClient: (provider) => {
        started.push(provider.applicationId);
        return {
          // Hands over a task that never settles and ignores stop.
          start: async ({ waitUntil }) => waitUntil(new Promise<void>(() => {})),
          stop: async () => {},
        };
      },
      durationMs: 100,
      loadProviders: async () => [makeProvider('hung')],
      redis: redis as never,
    });

    expect(started).toEqual(['hung']);
    expect(result.role).toBe('worker');
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(redis.store.has('wechat:poll:lease:0')).toBe(false);
  }, 12_000);

  it('one client failing to start does not sink the others', async () => {
    process.env.WECHAT_POLL_SHARD_COUNT = '1';
    const result = await runWechatPollShard(0, {
      createClient: (provider) =>
        provider.applicationId === 'boom'
          ? {
              start: async () => {
                throw new Error('handshake rejected');
              },
              stop: async () => {},
            }
          : makeFakeClient(),
      durationMs: 50,
      loadProviders: async () => [makeProvider('boom'), makeProvider('fine')],
      redis: redis as never,
    });

    expect(result.role).toBe('worker');
    // The failed one is dropped from the roster; the healthy one still runs.
    expect(result.bots).toBe(1);
  });

  it('hot-joins queued wechat connects and clears their re-auth park', async () => {
    process.env.WECHAT_POLL_SHARD_COUNT = '1';
    redis.store.set('wechat:poll:parked:late-join', '1');
    connectQueueMock.popAll.mockResolvedValue([
      { applicationId: 'late-join', platform: 'wechat', userId: 'user-1' },
      { applicationId: 'other', platform: 'discord', userId: 'user-1' },
    ]);

    vi.useFakeTimers();
    try {
      const started: string[] = [];
      const runPromise = runWechatPollShard(0, {
        createClient: (provider) => {
          started.push(provider.applicationId);
          return makeFakeClient();
        },
        durationMs: 45_000,
        // Parked at load time, so only the queue path can bring it in.
        loadProviders: async () => [makeProvider('late-join')],
        redis: redis as never,
      });

      await vi.advanceTimersByTimeAsync(31_000); // one supervision tick
      expect(started).toEqual(['late-join']);
      expect(redis.store.has('wechat:poll:parked:late-join')).toBe(false);

      await vi.advanceTimersByTimeAsync(20_000);
      await runPromise;

      expect(connectQueueMock.remove).toHaveBeenCalledWith('wechat', 'late-join');
      expect(connectQueueMock.remove).not.toHaveBeenCalledWith('discord', 'other');
    } finally {
      vi.useRealTimers();
    }
  });

  // ─── Mode state machine ───

  it('migration transition drains every connection before any polling starts', async () => {
    redis.store.delete(ACTIVE_MODE_KEY); // recorded=gateway, expected=host
    process.env.WECHAT_POLL_SHARD_COUNT = '1';

    const events: string[] = [];
    const gatewayClient = {
      disconnect: vi.fn(async (id: string) => {
        events.push(`drain:${id}`);
      }),
      isConfigured: true,
    };

    const result = await runWechatPollShard(0, {
      createClient: (provider) => {
        events.push(`poll:${provider.applicationId}`);
        return makeFakeClient();
      },
      durationMs: 50,
      gatewayClient,
      loadProviders: async () => [makeProvider('a'), makeProvider('b')],
      redis: redis as never,
    });

    expect(result.role).toBe('worker');
    expect(result.transition).toBe('migration');
    expect(redis.store.get(ACTIVE_MODE_KEY)).toBe('host');
    expect(gatewayClient.disconnect).toHaveBeenCalledTimes(2);

    const firstPoll = events.findIndex((e) => e.startsWith('poll:'));
    const lastDrain = events.reduce((acc, e, i) => (e.startsWith('drain:') ? i : acc), -1);
    expect(lastDrain).toBeGreaterThanOrEqual(0);
    expect(lastDrain).toBeLessThan(firstPoll);
  });

  it('migration retries in full after a partial drain failure', async () => {
    redis.store.delete(ACTIVE_MODE_KEY);
    process.env.WECHAT_POLL_SHARD_COUNT = '1';
    const providers = [makeProvider('a'), makeProvider('b')];

    let failOnce = true;
    const gatewayClient = {
      disconnect: vi.fn(async (id: string) => {
        if (failOnce && id === 'prov-b') {
          failOnce = false;
          throw new Error('gateway 503');
        }
      }),
      isConfigured: true,
    };
    const options = {
      createClient: () => makeFakeClient(),
      durationMs: 50,
      gatewayClient,
      loadProviders: async () => providers,
      redis: redis as never,
    };

    const first = await runWechatPollShard(0, options);
    expect(first).toEqual({ role: 'skipped', skippedReason: 'transition-pending' });
    expect(redis.store.has(ACTIVE_MODE_KEY)).toBe(false); // record NOT advanced

    const second = await runWechatPollShard(0, options);
    expect(second.role).toBe('worker');
    expect(redis.store.get(ACTIVE_MODE_KEY)).toBe('host');
    // The retry re-drains everything, including the id that already succeeded.
    expect(gatewayClient.disconnect).toHaveBeenCalledTimes(4);
  });

  it('concurrent first-enable ticks perform the drain exactly once', async () => {
    redis.store.delete(ACTIVE_MODE_KEY);
    process.env.WECHAT_POLL_SHARD_COUNT = '1';
    const gatewayClient = {
      disconnect: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
      }),
      isConfigured: true,
    };
    const options = {
      createClient: () => makeFakeClient(),
      durationMs: 50,
      gatewayClient,
      loadProviders: async () => [makeProvider('a')],
      redis: redis as never,
    };

    const [a, b] = await Promise.all([
      runWechatPollShard(0, options),
      runWechatPollShard(0, options),
    ]);
    expect(gatewayClient.disconnect).toHaveBeenCalledTimes(1);
    expect([a.role, b.role].sort()).toEqual(['skipped', 'worker']);
  });

  it('re-drains the previous host on the first supervision tick after migration', async () => {
    redis.store.delete(ACTIVE_MODE_KEY);
    process.env.WECHAT_POLL_SHARD_COUNT = '1';
    const gatewayClient = { disconnect: vi.fn(async () => {}), isConfigured: true };

    vi.useFakeTimers();
    try {
      const runPromise = runWechatPollShard(0, {
        createClient: () => makeFakeClient(),
        durationMs: 45_000,
        gatewayClient,
        loadProviders: async () => [makeProvider('a'), makeProvider('b')],
        redis: redis as never,
      });

      await vi.advanceTimersByTimeAsync(1); // transition drain done, worker up
      expect(gatewayClient.disconnect).toHaveBeenCalledTimes(2);

      // A gateway sync in flight when the record flipped may have reconnected
      // the old host; the first supervision tick drains once more to cover it.
      await vi.advanceTimersByTimeAsync(31_000);
      expect(gatewayClient.disconnect).toHaveBeenCalledTimes(4);

      await vi.advanceTimersByTimeAsync(20_000);
      await runPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rollback transition rebuilds via sync and flips the record', async () => {
    process.env.WECHAT_GATEWAY_HOST_ENABLED = '0'; // expected gateway, recorded host
    const runGatewaySync = vi.fn(async () => {});

    const result = await runWechatPollShard(0, { redis: redis as never, runGatewaySync });

    expect(result).toEqual({ role: 'transition', transition: 'rollback' });
    expect(runGatewaySync).toHaveBeenCalledTimes(1);
    expect(redis.store.get(ACTIVE_MODE_KEY)).toBe('gateway');
  });

  it('rollback defers while a shard worker still holds its lease', async () => {
    process.env.WECHAT_GATEWAY_HOST_ENABLED = '0';
    redis.store.set('wechat:poll:lease:0', 'live-worker');
    const runGatewaySync = vi.fn(async () => {});

    const result = await runWechatPollShard(0, { redis: redis as never, runGatewaySync });

    expect(result).toEqual({ role: 'skipped', skippedReason: 'transition-pending' });
    expect(runGatewaySync).not.toHaveBeenCalled();
    expect(redis.store.get(ACTIVE_MODE_KEY)).toBe('host'); // record NOT advanced
  });

  it('worker exits within one tick and releases its lease when rollback is requested', async () => {
    vi.useFakeTimers();
    try {
      const runPromise = runWechatPollShard(0, {
        durationMs: 120_000,
        loadProviders: async () => [],
        redis: redis as never,
      });

      await vi.advanceTimersByTimeAsync(1); // worker up, holding the lease
      process.env.WECHAT_GATEWAY_HOST_ENABLED = '0';
      await vi.advanceTimersByTimeAsync(31_000); // next tick notices the flip
      await vi.advanceTimersByTimeAsync(6000); // abort grace
      const result = await runPromise;

      expect(result.role).toBe('worker');
      expect(result.durationMs).toBeLessThan(40_000); // exited at the tick, not the deadline
      // The freed lease is what lets the rollback transition's check pass.
      expect(redis.store.has('wechat:poll:lease:0')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('worker exits within one tick and releases its lease on host shutdown', async () => {
    vi.useFakeTimers();
    try {
      let stopping = false;
      const runPromise = runWechatPollShard(0, {
        durationMs: 120_000,
        loadProviders: async () => [],
        redis: redis as never,
        shouldStop: () => stopping,
      });

      await vi.advanceTimersByTimeAsync(1); // worker up, holding the lease
      stopping = true; // SIGTERM: a replacement instance is coming up
      await vi.advanceTimersByTimeAsync(31_000); // next tick notices the signal
      await vi.advanceTimersByTimeAsync(6000); // abort grace
      const result = await runPromise;

      expect(result.role).toBe('worker');
      expect(result.durationMs).toBeLessThan(40_000); // exited at the tick, not the deadline
      // Released lease = the replacement claims the shard in one tick instead
      // of waiting out the lease TTL.
      expect(redis.store.has('wechat:poll:lease:0')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // ─── Tick shard scan (env-only scaling) ───

  it('sequential ticks claim shard 0 then shard 1, a third returns lease-held', async () => {
    process.env.WECHAT_POLL_SHARD_COUNT = '2';
    vi.useFakeTimers();
    try {
      const options = {
        durationMs: 120_000,
        loadProviders: async () => [],
        redis: redis as never,
      };
      const tick1 = runWechatPollTick(options);
      await vi.advanceTimersByTimeAsync(1);
      expect(redis.store.has('wechat:poll:lease:0')).toBe(true);
      expect(redis.store.has('wechat:poll:lease:1')).toBe(false);

      const tick2 = runWechatPollTick(options);
      await vi.advanceTimersByTimeAsync(1);
      expect(redis.store.has('wechat:poll:lease:1')).toBe(true);

      expect(await runWechatPollTick(options)).toEqual({
        role: 'skipped',
        skippedReason: 'lease-held',
      });

      await vi.advanceTimersByTimeAsync(130_000);
      const [r1, r2] = await Promise.all([tick1, tick2]);
      expect([r1.role, r2.role]).toEqual(['worker', 'worker']);
      expect([r1.shard, r2.shard]).toEqual([0, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('raising the shard count via env alone brings the new shard online next tick', async () => {
    process.env.WECHAT_POLL_SHARD_COUNT = '1';
    redis.store.set('wechat:poll:lease:0', 'live-worker'); // shard 0 occupied

    const options = {
      durationMs: 30,
      loadProviders: async () => [],
      redis: redis as never,
    };
    expect(await runWechatPollTick(options)).toEqual({
      role: 'skipped',
      skippedReason: 'lease-held',
    });

    process.env.WECHAT_POLL_SHARD_COUNT = '2';
    const result = await runWechatPollTick(options);
    expect(result.role).toBe('worker');
    expect(result.shard).toBe(1);
  });

  it('tick short-circuits on disabled without probing any lease', async () => {
    process.env.WECHAT_GATEWAY_HOST_ENABLED = '0';
    redis.store.delete(ACTIVE_MODE_KEY);
    const result = await runWechatPollTick({ redis: redis as never });
    expect(result).toEqual({ role: 'skipped', skippedReason: 'disabled' });
  });
});
