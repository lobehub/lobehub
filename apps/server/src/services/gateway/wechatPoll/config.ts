/**
 * WeChat shard-poller configuration.
 *
 * WeChat receives messages by long polling, which a per-bot persistent
 * connection host bills as continuously-active time. This poller instead
 * multiplexes every bot's poll loop inside a small, fixed number of
 * serverless invocations: cost tracks the number of workers, not the number
 * of bots.
 *
 * Entirely flag-gated — unless `WECHAT_VERCEL_POLLER_ENABLED=1`, the cron
 * entry point returns immediately and no polling connection is ever opened,
 * leaving WeChat on whatever host managed it before.
 */

export type WechatPollerMode = 'gateway' | 'vercel';

/**
 * Read at call time (not module init) so tests and runtime flips both work.
 * Boolean by design, matching the `MESSAGE_GATEWAY_ENABLED` convention: unset
 * or `0` keeps the existing host, an explicit `1` opts into this poller.
 */
export const isWechatVercelPollerEnabled = (): boolean =>
  process.env.WECHAT_VERCEL_POLLER_ENABLED === '1';

export const getWechatPollerMode = (): WechatPollerMode =>
  isWechatVercelPollerEnabled() ? 'vercel' : 'gateway';

/**
 * Number of worker leases. Scaling out is this env var alone — the single
 * poll route's every-minute ticks claim whichever shard lease is free, so new
 * shards come online within N minutes of the change.
 *
 * Capacity: each long poll holds one socket for its whole duration, so bots
 * consume file descriptors without the turnover an ordinary request-response
 * service enjoys. Where several workers land on one instance they share that
 * instance's descriptor budget — revisit the topology past a few hundred bots.
 */
export const getWechatPollShardCount = (): number => {
  const parsed = Number(process.env.WECHAT_POLL_SHARD_COUNT);
  if (!Number.isInteger(parsed) || parsed < 1) return 2;
  return parsed;
};

/**
 * Worker budget. Defaults below the common 800s serverless ceiling, leaving
 * room for abort grace, lease release, and the successor trigger.
 * Env-overridable so staging and verification runs can use short windows.
 */
const DEFAULT_WORKER_DURATION_MS = 780_000;

export const getWechatPollWorkerDurationMs = (): number => {
  const parsed = Number(process.env.WECHAT_POLL_WORKER_DURATION_MS);
  if (!Number.isInteger(parsed) || parsed < 1000) return DEFAULT_WORKER_DURATION_MS;
  return parsed;
};

/** Lease TTL. Must exceed the renew interval by a comfortable margin. */
export const WECHAT_POLL_LEASE_TTL_MS = 90_000;

/** Lease renew + connect-queue consumption cadence inside the worker loop. */
export const WECHAT_POLL_TICK_INTERVAL_MS = 30_000;

/** How long to wait for poll loops to unwind after the deadline abort. */
export const WECHAT_POLL_ABORT_GRACE_MS = 5000;

/** Bounds concurrent readiness probes when a worker adopts its whole shard. */
export const WECHAT_POLL_START_CONCURRENCY = 10;

/**
 * Deterministic shard assignment: djb2 over the applicationId. Stable across
 * processes and deploys, so no coordination is needed to agree on ownership.
 */
export const wechatShardOf = (applicationId: string, shardCount: number): number => {
  let hash = 5381;
  for (let i = 0; i < applicationId.length; i++) {
    hash = ((hash << 5) + hash + applicationId.charCodeAt(i)) >>> 0;
  }
  return hash % shardCount;
};
