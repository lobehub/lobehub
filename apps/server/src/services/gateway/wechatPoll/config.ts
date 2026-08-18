/**
 * WeChat shard-poller configuration.
 *
 * WeChat receives messages by long polling, which a per-bot persistent
 * connection host bills as continuously-active time. This poller instead
 * multiplexes every bot's poll loop inside a small number of resident
 * workers: cost tracks the number of workers, not the number of bots.
 *
 * Entirely flag-gated — unless `WECHAT_GATEWAY_HOST_ENABLED=1`, the service
 * loop idles and no polling connection is ever opened, leaving WeChat on
 * whatever host managed it before.
 */

export type WechatPollerMode = 'gateway' | 'host';

/**
 * Read at call time (not module init) so tests and runtime flips both work.
 * Boolean by design, matching the `MESSAGE_GATEWAY_ENABLED` convention: unset
 * or `0` keeps the existing host, an explicit `1` opts into this poller.
 */
export const isWechatGatewayHostEnabled = (): boolean =>
  process.env.WECHAT_GATEWAY_HOST_ENABLED === '1';

export const getWechatPollerMode = (): WechatPollerMode =>
  isWechatGatewayHostEnabled() ? 'host' : 'gateway';

/**
 * Number of worker leases. A resident service runs one claim loop per shard,
 * so scaling out is this env var alone (a config change restarts the host and
 * the new loops claim their shards on boot). One shard multiplexes every bot
 * comfortably on a dedicated process; shards exist for when a single event
 * loop or process becomes the bottleneck, not for descriptor budgeting.
 */
export const getWechatPollShardCount = (): number => {
  const parsed = Number(process.env.WECHAT_POLL_SHARD_COUNT);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return parsed;
};

/**
 * Worker window. A worker re-resolves its shard membership at every window
 * boundary, so this is the upper bound on how long a disabled or deleted
 * provider keeps polling. The next window starts immediately after (same
 * process), so the boundary costs milliseconds, not a handover gap.
 * Env-overridable so staging and verification runs can use short windows.
 */
const DEFAULT_WORKER_DURATION_MS = 780_000;

export const getWechatPollWorkerDurationMs = (): number => {
  const parsed = Number(process.env.WECHAT_POLL_WORKER_DURATION_MS);
  if (!Number.isInteger(parsed) || parsed < 1000) return DEFAULT_WORKER_DURATION_MS;
  return parsed;
};

/**
 * Idle pause between service-loop ticks that did not win a shard (disabled,
 * lease held elsewhere, transition pending). Doubles as the mode-transition
 * detection cadence, so a flag flip takes effect within about a minute.
 */
export const getWechatPollServiceIdleMs = (): number => {
  const parsed = Number(process.env.WECHAT_POLL_SERVICE_IDLE_MS);
  if (!Number.isInteger(parsed) || parsed < 100) return 60_000;
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
