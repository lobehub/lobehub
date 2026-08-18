import debug from 'debug';
import type Redis from 'ioredis';
import pMap from 'p-map';

import { isBotFeatureAccessAllowed } from '@/business/server/bot/featureAccess';
import { getServerDB } from '@/database/core/db-adaptor';
import {
  AgentBotProviderModel,
  type DecryptedBotProvider,
} from '@/database/models/agentBotProvider';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { platformRegistry, resolveBotProviderConfig } from '@/server/services/bot/platforms';
import {
  clearPollPark,
  isPollParked,
  type WechatPollStateRedis,
} from '@/server/services/bot/platforms/wechat/pollState';

import { BotConnectQueue } from '../botConnectQueue';
import { getMessageGatewayClient } from '../MessageGatewayClient';
import {
  getWechatPollerMode,
  getWechatPollShardCount,
  getWechatPollWorkerDurationMs,
  isWechatGatewayHostEnabled,
  WECHAT_POLL_ABORT_GRACE_MS,
  WECHAT_POLL_START_CONCURRENCY,
  WECHAT_POLL_TICK_INTERVAL_MS,
  wechatShardOf,
} from './config';
import { acquireLease, releaseLease, renewLease, shardLeaseKey } from './lease';
import { acquireTransitionLock, getActiveMode, releaseTransitionLock, setActiveMode } from './mode';

const log = debug('lobe-server:wechat-poll:shard');

export interface WechatPollShardResult {
  bots?: number;
  durationMs?: number;
  role: 'skipped' | 'transition' | 'worker';
  shard?: number;
  skippedReason?:
    'disabled' | 'lease-held' | 'no-redis' | 'shard-out-of-range' | 'transition-pending';
  /** Set when this invocation performed (or completed) a mode transition. */
  transition?: 'migration' | 'rollback';
}

/**
 * The slice of the WeChat platform client this runner drives. Structural so
 * tests can inject a fake without constructing the real client.
 */
export interface WechatShardClient {
  start: (options: {
    durationMs: number;
    waitUntil: (task: Promise<any>) => void;
  }) => Promise<void>;
  stop: () => Promise<void>;
}

/** Minimal surface of MessageGatewayClient the migration drain needs. */
interface GatewayDrainClient {
  disconnect: (connectionId: string) => Promise<unknown>;
  isConfigured: boolean;
}

export interface RunWechatPollShardOptions {
  /** Injectable for tests. */
  createClient?: (provider: DecryptedBotProvider) => WechatShardClient;
  /** Injectable for tests — worker run budget. */
  durationMs?: number;
  /** Injectable for tests — gateway client used to drain the previous host. */
  gatewayClient?: GatewayDrainClient;
  /** Injectable for tests. */
  loadProviders?: () => Promise<DecryptedBotProvider[]>;
  redis?: Redis | null;
  /** Injectable for tests — rollback rebuild (defaults to GatewayService.ensureRunning). */
  runGatewaySync?: () => Promise<void>;
  /**
   * Host shutdown signal (SIGTERM on redeploy). A worker that sees it stops
   * early and releases its lease, so the replacement instance takes over in
   * one tick instead of waiting out the lease TTL.
   */
  shouldStop?: () => boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const defaultLoadProviders = async (): Promise<DecryptedBotProvider[]> => {
  const serverDB = await getServerDB();
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  return AgentBotProviderModel.findEnabledByPlatform(serverDB, 'wechat', gateKeeper);
};

/**
 * Build the real platform client for a provider — the same construction the
 * cron gateway uses, so the poll loop, webhook forwarding, context-token
 * bookkeeping, and runtime-status reporting are shared code, not a fork.
 */
const defaultCreateClient = (provider: DecryptedBotProvider): WechatShardClient => {
  const definition = platformRegistry.getPlatform('wechat');
  if (!definition) throw new Error('WeChat platform is not registered');

  const { config } = resolveBotProviderConfig(definition, {
    applicationId: provider.applicationId,
    credentials: provider.credentials,
    settings: provider.settings,
  });

  return platformRegistry.createClient('wechat', config, {
    appUrl: process.env.APP_URL,
    redisClient: getAgentRuntimeRedisClient() as any,
  }) as unknown as WechatShardClient;
};

/**
 * Rollback rebuild is one ordinary gateway sync: with the flag off, WeChat is
 * back in the desired set, so the sync's desired − actual diff reconnects every
 * provider. Imported lazily to keep the heavyweight GatewayService module out
 * of this module's load graph (and to avoid an import cycle).
 */
const defaultRunGatewaySync = async (): Promise<void> => {
  const { GatewayService } = await import('../index');
  await new GatewayService().ensureRunning();
};

/** Best-effort follow-up drain after a migration — see the caller's comment. */
const redrainPreviousHost = async (
  gatewayClient: GatewayDrainClient,
  loadProviders: () => Promise<DecryptedBotProvider[]>,
): Promise<void> => {
  try {
    if (!gatewayClient.isConfigured) return;
    const providers = await loadProviders();
    if (providers.length === 0) return;
    await Promise.allSettled(providers.map((provider) => gatewayClient.disconnect(provider.id)));
    log('post-migration re-drain: %d connections', providers.length);
  } catch (err: any) {
    log('post-migration re-drain failed: %s', err?.message);
  }
};

const isEligible = async (
  provider: DecryptedBotProvider,
  redis: WechatPollStateRedis,
): Promise<boolean> => {
  if (Object.keys(provider.credentials).length === 0) return false;
  if (!provider.credentials.botToken?.trim()) return false;

  // A parked bot's session is dead until its owner re-scans; starting it would
  // burn one doomed request per bot per window and report a misleading status.
  if (await isPollParked(redis, provider.applicationId)) {
    log('appId=%s parked (needs re-auth), skipping', provider.applicationId);
    return false;
  }

  try {
    return await isBotFeatureAccessAllowed({
      action: 'runtime',
      applicationId: provider.applicationId,
      platform: 'wechat',
      userId: provider.userId,
      workspaceId: provider.workspaceId ?? undefined,
    });
  } catch (err: any) {
    // Fail open like the gateway sync: a gate outage must not silence bots.
    log('feature gate check failed for %s, keeping: %s', provider.id, err?.message);
    return true;
  }
};

/**
 * Migration transition: disconnect EVERY WeChat connection on the previous
 * host, then flip the active-mode record. Runs under the transition lock and
 * is strictly drain-before-poll — the record only advances (and therefore no
 * poll loop ever starts) once the full drain succeeded, so there is no window
 * in which both hosts poll the same bot and deliver its messages twice.
 *
 * Returns true when the record now says 'host'.
 */
const runMigrationTransition = async (
  redis: Redis,
  holder: string,
  providers: DecryptedBotProvider[],
  gatewayClient: GatewayDrainClient,
): Promise<boolean> => {
  if (!(await acquireTransitionLock(redis, holder))) return false;

  try {
    if (gatewayClient.isConfigured && providers.length > 0) {
      log('migration transition: draining %d gateway connections', providers.length);
      const results = await Promise.allSettled(
        providers.map((provider) => gatewayClient.disconnect(provider.id)),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        // Partial drain — do NOT flip the record; the next tick retries the
        // whole transition (disconnect is idempotent).
        log(
          'migration transition: %d/%d disconnects failed, will retry',
          failed.length,
          results.length,
        );
        return false;
      }
    }

    await setActiveMode(redis, 'host');
    log('migration transition complete: active-mode=host');
    return true;
  } finally {
    await releaseTransitionLock(redis, holder).catch(() => {});
  }
};

/**
 * Rollback transition: wait for every shard worker to stop (their supervision
 * loops exit within one tick of the flag flipping), then run one gateway sync
 * to rebuild the previous host, then flip the record.
 */
const runRollbackTransition = async (
  redis: Redis,
  holder: string,
  runGatewaySync: () => Promise<void>,
): Promise<WechatPollShardResult> => {
  // A live lease means a worker may still be polling — rebuilding the other
  // host now would double-poll. The worker notices the flag within one tick
  // and exits; retry on a later service tick.
  const shardCount = getWechatPollShardCount();
  for (let shard = 0; shard < shardCount; shard++) {
    if (await redis.get(shardLeaseKey(shard))) {
      log('rollback transition: shard %d worker still holds its lease, deferring', shard);
      return { role: 'skipped', skippedReason: 'transition-pending' };
    }
  }

  if (!(await acquireTransitionLock(redis, holder))) {
    return { role: 'skipped', skippedReason: 'transition-pending' };
  }

  try {
    await runGatewaySync();
    await setActiveMode(redis, 'gateway');
    log('rollback transition complete: active-mode=gateway');
    return { role: 'transition', transition: 'rollback' };
  } finally {
    await releaseTransitionLock(redis, holder).catch(() => {});
  }
};

/**
 * One service tick: reconcile the mode state machine, then claim the first
 * free shard lease (0..SHARD_COUNT-1) and become that shard's worker.
 *
 * Shard count is pure config (`WECHAT_POLL_SHARD_COUNT`) — scaling out means
 * changing the env var and nothing else, because later ticks claim the new
 * shards on their own. Once every shard's lease is held, a tick returns
 * immediately.
 */
export const runWechatPollTick = async (
  options: RunWechatPollShardOptions = {},
): Promise<WechatPollShardResult> => {
  const shardCount = getWechatPollShardCount();
  let last: WechatPollShardResult = { role: 'skipped', skippedReason: 'lease-held' };

  for (let shard = 0; shard < shardCount; shard++) {
    const result = await runWechatPollShard(shard, options);
    // Only "this shard's lease is taken" means "try the next one" — every
    // other outcome (disabled, no-redis, transition, worker) ends the tick.
    if (result.skippedReason !== 'lease-held') return result;
    last = result;
  }
  return last;
};

/**
 * Claim one shard and, if won, run its worker for a full poll window.
 *
 * Reconciles the desired mode (env) against the active mode (Redis) first and
 * performs any pending transition; in steady state it races for the shard's
 * lease, and the winner multiplexes every WeChat bot assigned to that shard
 * before releasing the lease. Losers return `lease-held`.
 */
export const runWechatPollShard = async (
  shard: number,
  options: RunWechatPollShardOptions = {},
): Promise<WechatPollShardResult> => {
  const expected = getWechatPollerMode();

  const redis = options.redis !== undefined ? options.redis : getAgentRuntimeRedisClient();
  if (!redis) return { role: 'skipped', skippedReason: 'no-redis' };

  const workerId = `${shard}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const recorded = await getActiveMode(redis);

  if (expected === 'gateway') {
    if (recorded !== 'host') return { role: 'skipped', skippedReason: 'disabled' };
    return runRollbackTransition(redis, workerId, options.runGatewaySync ?? defaultRunGatewaySync);
  }

  if (shard >= getWechatPollShardCount()) {
    return { role: 'skipped', skippedReason: 'shard-out-of-range' };
  }

  const loadProviders = options.loadProviders ?? defaultLoadProviders;
  const gatewayClient = options.gatewayClient ?? getMessageGatewayClient();

  let transition: 'migration' | undefined;
  if (recorded !== 'host') {
    const migrated = await runMigrationTransition(
      redis,
      workerId,
      await loadProviders(),
      gatewayClient,
    );
    if (!migrated) return { role: 'skipped', skippedReason: 'transition-pending' };
    transition = 'migration';
  }

  if (!(await acquireLease(redis, shard, workerId))) {
    return { role: 'skipped', skippedReason: 'lease-held', transition };
  }

  const startedAt = Date.now();
  const durationMs = options.durationMs ?? getWechatPollWorkerDurationMs();
  const deadline = startedAt + durationMs;
  const shardCount = getWechatPollShardCount();
  const createClient = options.createClient ?? defaultCreateClient;
  const shouldStop = options.shouldStop ?? (() => false);
  const pollStateRedis = redis as unknown as WechatPollStateRedis;

  const running = new Map<string, WechatShardClient>();
  const tasks: Promise<unknown>[] = [];
  const waitUntil = (task: Promise<any>) => {
    tasks.push(task.catch(() => {}));
  };
  let redrainPending = transition === 'migration';

  // Don't pay a readiness probe (seconds) for a window we cannot outlive — the
  // next window picks the bot up as an ordinary member anyway. Capped at half
  // the window so a deliberately short one (staging, tests) still adopts its
  // shard instead of starting nothing at all.
  const minStartWindowMs = Math.min(5000, Math.floor(durationMs / 2));

  const startBot = async (provider: DecryptedBotProvider): Promise<void> => {
    if (running.has(provider.applicationId)) return;
    const remaining = deadline - Date.now();
    if (remaining < minStartWindowMs) return;

    let client: WechatShardClient;
    try {
      client = createClient(provider);
    } catch (err: any) {
      log('appId=%s client construction failed: %s', provider.applicationId, err?.message);
      return;
    }

    // Registered before awaiting `start` so the dedupe guard covers the whole
    // (potentially seconds-long) readiness probe.
    running.set(provider.applicationId, client);
    try {
      await client.start({ durationMs: remaining, waitUntil });
    } catch (err: any) {
      log('appId=%s start failed: %s', provider.applicationId, err?.message);
      running.delete(provider.applicationId);
      await client.stop().catch(() => {});
    }
  };

  try {
    const providers = await loadProviders();
    const members: DecryptedBotProvider[] = [];
    for (const provider of providers) {
      if (wechatShardOf(provider.applicationId, shardCount) !== shard) continue;
      if (!(await isEligible(provider, pollStateRedis))) continue;
      members.push(provider);
    }
    // Each start awaits a readiness probe, so adopt the shard concurrently
    // rather than paying that latency once per bot.
    await pMap(members, startBot, { concurrency: WECHAT_POLL_START_CONCURRENCY });

    log('shard=%d worker started with %d bots', shard, running.size);

    // Supervision loop: renew the lease and pick up hot-join connect requests
    // every tick until the deadline. Losing the lease means another worker took
    // over; the flag flipping back means a rollback was requested; a host
    // shutdown signal means a replacement instance is coming up — each stops
    // this worker at once so two hosts never poll the same bot.
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      await sleep(Math.min(WECHAT_POLL_TICK_INTERVAL_MS, remaining));
      if (Date.now() >= deadline) break;

      if (shouldStop()) {
        log('shard=%d host shutdown requested, stopping worker', shard);
        break;
      }

      if (!isWechatGatewayHostEnabled()) {
        log('shard=%d rollback requested, stopping worker', shard);
        break;
      }

      if (!(await renewLease(redis, shard, workerId).catch(() => false))) {
        log('shard=%d lost lease, stopping early', shard);
        break;
      }

      // A gateway sync that was already in flight when the migration flipped
      // the record may have reconnected WeChat on the previous host moments
      // after the drain. One follow-up drain on the first supervision tick
      // closes that window (disconnect is idempotent and cheap); the sync's
      // own stale cleanup remains the long-tail backstop.
      if (redrainPending) {
        redrainPending = false;
        await redrainPreviousHost(gatewayClient, loadProviders);
      }

      await consumeConnectQueue(shard, shardCount, pollStateRedis, startBot, loadProviders);
    }
  } finally {
    // Stop before releasing the lease, so the next claimant (the service's
    // next tick, or a replacement instance) can never start polling a bot
    // this worker still holds.
    await Promise.allSettled([...running.values()].map((client) => client.stop()));
    // A hung poll loop must not pin this worker past its window.
    await Promise.race([Promise.allSettled(tasks), sleep(WECHAT_POLL_ABORT_GRACE_MS)]);
    await releaseLease(redis, shard, workerId).catch(() => {});
  }

  return {
    bots: running.size,
    durationMs: Date.now() - startedAt,
    role: 'worker',
    shard,
    transition,
  };
};

/**
 * Hot-join: users who just saved credentials (or hit reconnect) land in the
 * BotConnectQueue. Consume the WeChat entries belonging to this shard so they
 * start within one tick instead of waiting for the next poll window. Entries
 * for other platforms and shards are left in place for their own consumers.
 */
const consumeConnectQueue = async (
  shard: number,
  shardCount: number,
  pollStateRedis: WechatPollStateRedis,
  startBot: (provider: DecryptedBotProvider) => Promise<void>,
  loadProviders: () => Promise<DecryptedBotProvider[]>,
): Promise<void> => {
  try {
    const queue = new BotConnectQueue();
    const items = await queue.popAll();
    // popAll only reads the hash; entries stay queued until removed.
    const mine = items.filter(
      (item) =>
        item.platform === 'wechat' && wechatShardOf(item.applicationId, shardCount) === shard,
    );
    if (mine.length === 0) return;
    for (const item of mine) await queue.remove(item.platform, item.applicationId);

    const providers = await loadProviders();
    for (const item of mine) {
      const provider = providers.find((p) => p.applicationId === item.applicationId);
      if (!provider) continue;
      // A queued connect means the owner acted (saved credentials, hit
      // reconnect), so an earlier re-auth park no longer applies.
      await clearPollPark(pollStateRedis, item.applicationId);
      if (!(await isEligible(provider, pollStateRedis))) continue;
      await startBot(provider);
    }
  } catch (err: any) {
    log('shard=%d connect-queue consumption failed: %s', shard, err?.message);
  }
};
