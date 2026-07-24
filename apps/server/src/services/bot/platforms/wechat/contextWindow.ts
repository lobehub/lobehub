import { getWechatTextSendCount } from '@lobechat/chat-adapter-wechat';
import debug from 'debug';

import type { WechatOutboundAttachment } from './sendAttachments';

const log = debug('bot-platform:wechat:context-window');

/**
 * WeChat iLink send-window bookkeeping.
 *
 * The protocol gives no way to open a conversation from the bot side: every
 * outbound `sendmessage` must carry the `context_token` of a recent inbound
 * message, the token dies after ~24h, and every 10 outbound sends
 * require a fresh user-initiated message (see protocol-spec §5.10). This
 * module keeps that window explicit in Redis so callers can tell whether a
 * proactive push can be delivered now or must wait for the next inbound
 * message:
 *
 * - `wechat:ctx-window:{applicationId}:{userId}` — hash `token` / `remaining`
 *   / `refreshedAt`, TTL 24h, quota reset on every inbound message.
 * - `wechat:ctx-token:{applicationId}:{userId}` — legacy plain-token key,
 *   still written for older readers and consumed as a seed when the hash is
 *   missing (rolling deploy compatibility).
 * - `wechat:pending-push:{applicationId}:{userId}` — proactive messages that
 *   arrived while the window was closed, replayed on the next inbound message.
 *
 * The quota is best-effort bookkeeping — WeChat enforces the real limit — so
 * plain HINCRBY atomicity is enough; small races only shift when we start
 * queueing instead of sending.
 */

export const WECHAT_WINDOW_MAX_SENDS = 10;
export const WECHAT_WINDOW_TTL_SECONDS = 24 * 60 * 60;

const PENDING_QUEUE_MAX = 20;
const PENDING_QUEUE_TTL_SECONDS = 72 * 60 * 60;
const FLUSH_LOCK_TTL_SECONDS = 30;

/**
 * Minimal structural Redis contract — the runtime client is a raw ioredis
 * instance reaching us through loosely-typed contexts (see WechatGatewayClient),
 * so depend on the commands we use rather than the ioredis types.
 */
export interface WechatWindowRedis {
  del: (...keys: string[]) => Promise<unknown>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  hgetall: (key: string) => Promise<Record<string, string> | null>;
  hincrby: (key: string, field: string, increment: number) => Promise<number>;
  hset: (key: string, data: Record<string, string | number>) => Promise<unknown>;
  llen: (key: string) => Promise<number>;
  lpop: (key: string) => Promise<string | null>;
  lpush: (key: string, value: string) => Promise<unknown>;
  ltrim: (key: string, start: number, stop: number) => Promise<unknown>;
  pttl: (key: string) => Promise<number>;
  rpush: (key: string, value: string) => Promise<number>;
  set: (key: string, value: string, ...args: (string | number)[]) => Promise<unknown>;
  ttl: (key: string) => Promise<number>;
}

export const wechatLegacyTokenKey = (applicationId: string, userId: string): string =>
  `wechat:ctx-token:${applicationId}:${userId}`;

export const wechatWindowKey = (applicationId: string, userId: string): string =>
  `wechat:ctx-window:${applicationId}:${userId}`;

export const wechatPendingPushKey = (applicationId: string, userId: string): string =>
  `wechat:pending-push:${applicationId}:${userId}`;

const flushLockKey = (applicationId: string, userId: string): string =>
  `wechat:pending-flush:${applicationId}:${userId}`;

export interface WechatSendWindow {
  refreshedAt: number;
  remaining: number;
  token: string;
}

/**
 * Record the `context_token` of an inbound message: refresh the token, reset
 * the outbound quota, and restart the 24h clock. Also mirrors the legacy
 * plain-token key so pre-window readers keep working during rollout.
 */
export const recordInboundToken = async (
  redis: WechatWindowRedis,
  applicationId: string,
  userId: string,
  token: string,
): Promise<void> => {
  const windowKey = wechatWindowKey(applicationId, userId);
  await Promise.all([
    redis
      .hset(windowKey, {
        refreshedAt: Date.now(),
        remaining: WECHAT_WINDOW_MAX_SENDS,
        token,
      })
      .then(() => redis.expire(windowKey, WECHAT_WINDOW_TTL_SECONDS)),
    redis.set(wechatLegacyTokenKey(applicationId, userId), token, 'EX', WECHAT_WINDOW_TTL_SECONDS),
  ]);
};

/**
 * Seed a window hash from the legacy plain-token key (written by deploys that
 * predate quota tracking). The seeded window inherits the legacy TTL so it
 * never outlives the token, and starts with a full quota — optimistic, but the
 * legacy key carries no send count to recover.
 */
const seedFromLegacyToken = async (
  redis: WechatWindowRedis,
  applicationId: string,
  userId: string,
): Promise<WechatSendWindow | null> => {
  const token = await redis.get(wechatLegacyTokenKey(applicationId, userId));
  if (!token) return null;

  const windowKey = wechatWindowKey(applicationId, userId);
  // NOTE: never name these locals `window` — bundlers substitute the global
  // `window` at compile time and silently break the null checks.
  const seeded: WechatSendWindow = {
    refreshedAt: Date.now(),
    remaining: WECHAT_WINDOW_MAX_SENDS,
    token,
  };
  await redis.hset(windowKey, seeded as unknown as Record<string, string | number>);

  const legacyPttl = await redis.pttl(wechatLegacyTokenKey(applicationId, userId));
  await redis.expire(
    windowKey,
    legacyPttl > 0 ? Math.ceil(legacyPttl / 1000) : WECHAT_WINDOW_TTL_SECONDS,
  );
  return seeded;
};

/** Read the current send window without consuming quota. */
export const peekWindow = async (
  redis: WechatWindowRedis,
  applicationId: string,
  userId: string,
): Promise<WechatSendWindow | null> => {
  const raw = await redis.hgetall(wechatWindowKey(applicationId, userId));
  if (raw?.token) {
    return {
      refreshedAt: Number(raw.refreshedAt) || 0,
      remaining: Number.isFinite(Number(raw.remaining)) ? Number(raw.remaining) : 0,
      token: raw.token,
    };
  }
  // `return await` is load-bearing: returning the bare promise makes
  // Turbopack's value analysis treat this function's result as always-truthy
  // and constant-fold callers' `if (!window)` guards into dead code.
  return await seedFromLegacyToken(redis, applicationId, userId);
};

export type ConsumeSendCreditsResult =
  | { remaining: number; status: 'ok'; token: string }
  | { remaining: number; status: 'exhausted'; token: string }
  | { status: 'missing' };

/**
 * Consume `count` outbound sends from the window.
 *
 * - Strict mode (default): refuses to go below zero and reports `exhausted`
 *   without touching the counter — the proactive-push path uses this to decide
 *   between sending and queueing.
 * - `allowOverdraft`: always returns the token and lets the counter go
 *   negative — reply paths use this for pure bookkeeping, because refusing to
 *   answer a user who just messaged us would be worse than a failed send.
 */
export const consumeSendCredits = async (
  redis: WechatWindowRedis,
  applicationId: string,
  userId: string,
  count: number,
  options?: { allowOverdraft?: boolean },
): Promise<ConsumeSendCreditsResult> => {
  const sendWindow = await peekWindow(redis, applicationId, userId);
  if (!sendWindow) return { status: 'missing' };

  const windowKey = wechatWindowKey(applicationId, userId);
  const remaining = await redis.hincrby(windowKey, 'remaining', -count);

  if (remaining < 0 && !options?.allowOverdraft) {
    await redis.hincrby(windowKey, 'remaining', count);
    return { remaining: remaining + count, status: 'exhausted', token: sendWindow.token };
  }

  return { remaining, status: 'ok', token: sendWindow.token };
};

/** A proactive push that arrived while the send window was closed. */
export interface WechatPendingPush {
  attachments?: WechatOutboundAttachment[];
  content?: string;
  enqueuedAt: number;
}

/** Number of `sendmessage` calls a payload will consume. */
export const pendingPushSendCount = (payload: Pick<WechatPendingPush, 'attachments' | 'content'>) =>
  Math.max(
    1,
    (payload.content?.trim() ? getWechatTextSendCount(payload.content) : 0) +
      (payload.attachments?.length ?? 0),
  );

/**
 * Queue a proactive push for replay on the next inbound message. The queue is
 * capped (oldest dropped first) and expires after 72h — a user who has not
 * messaged for three days should not get a burst of stale notifications.
 */
export const enqueuePendingPush = async (
  redis: WechatWindowRedis,
  applicationId: string,
  userId: string,
  payload: WechatPendingPush,
): Promise<number> => {
  const key = wechatPendingPushKey(applicationId, userId);
  const length = await redis.rpush(key, JSON.stringify(payload));
  if (length > PENDING_QUEUE_MAX) {
    await redis.ltrim(key, length - PENDING_QUEUE_MAX, -1);
    log(
      'enqueuePendingPush: queue for %s:%s trimmed to %d',
      applicationId,
      userId,
      PENDING_QUEUE_MAX,
    );
  }
  await redis.expire(key, PENDING_QUEUE_TTL_SECONDS);
  return Math.min(length, PENDING_QUEUE_MAX);
};

/**
 * Replay queued pushes in FIFO order under a short NX lock (concurrent inbound
 * messages must not double-send). The handler returns `sent` to continue or
 * `stop` to halt — a stopped payload is pushed back to the queue head.
 */
export const drainPendingPushes = async (
  redis: WechatWindowRedis,
  applicationId: string,
  userId: string,
  send: (payload: WechatPendingPush) => Promise<'sent' | 'stop'>,
): Promise<number> => {
  const lockKey = flushLockKey(applicationId, userId);
  const locked = await redis.set(lockKey, '1', 'EX', FLUSH_LOCK_TTL_SECONDS, 'NX');
  if (locked !== 'OK') return 0;

  let sent = 0;
  try {
    const pendingKey = wechatPendingPushKey(applicationId, userId);
    while (true) {
      const raw = await redis.lpop(pendingKey);
      if (!raw) break;

      let payload: WechatPendingPush;
      try {
        payload = JSON.parse(raw) as WechatPendingPush;
      } catch {
        log('drainPendingPushes: dropping malformed payload for %s:%s', applicationId, userId);
        continue;
      }

      const result = await send(payload);
      if (result === 'stop') {
        await redis.lpush(pendingKey, raw);
        break;
      }
      sent++;
    }
  } finally {
    await redis.del(lockKey);
  }
  return sent;
};
