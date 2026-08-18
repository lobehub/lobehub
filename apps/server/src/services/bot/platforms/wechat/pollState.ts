import debug from 'debug';

const log = debug('bot-platform:wechat:poll-state');

/**
 * The commands these helpers use, in ioredis' variadic form.
 *
 * `BotPlatformRuntimeContext.redisClient` is declared as the abstract
 * `BotPlatformRedisClient`, but every construction site passes the real
 * ioredis client through an `as any`. Its `set` takes `('EX', seconds)`
 * positionally, not an options object — so this file states the shape it
 * actually calls rather than trusting the declared one, exactly as
 * `WechatWindowRedis` does next door.
 */
export interface WechatPollStateRedis {
  del: (...keys: string[]) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ...args: (string | number)[]) => Promise<unknown>;
}

/**
 * Durable per-bot state for WeChat long polling.
 *
 * WeChat is the only platform whose inbound stream is a resumable cursor
 * (`get_updates_buf`, a `{account, seq}` token) rather than a socket, so the
 * poll loop needs two things to survive process boundaries — serverless poll
 * windows, deploys, shard handovers:
 *
 * - **cursor**: where to resume. Without it every restart silently rewinds to
 *   "whatever the server considers latest", dropping the messages that arrived
 *   while nobody was polling.
 * - **park**: whether the session is dead. `errcode -14` can only be cleared
 *   by the owner re-scanning the QR code, so an unparked dead bot would be
 *   restarted — and immediately fail again — on every single poll window.
 *
 * Every helper is best-effort: poll-loop hot paths must never fail because
 * Redis hiccuped.
 */

const CURSOR_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Mirrors the gateway DO's parked-expiry: an abandoned session ages out. */
const PARK_TTL_SECONDS = 7 * 24 * 60 * 60;

const cursorKey = (applicationId: string): string => `wechat:poll:cursor:${applicationId}`;
const parkKey = (applicationId: string): string => `wechat:poll:parked:${applicationId}`;

export const getPollCursor = async (
  redis: WechatPollStateRedis | undefined,
  applicationId: string,
): Promise<string | undefined> => {
  if (!redis) return undefined;
  try {
    return (await redis.get(cursorKey(applicationId))) ?? undefined;
  } catch (err: any) {
    log('appId=%s cursor read failed: %s', applicationId, err?.message);
    return undefined;
  }
};

export const setPollCursor = async (
  redis: WechatPollStateRedis | undefined,
  applicationId: string,
  cursor: string,
): Promise<void> => {
  if (!redis) return;
  try {
    await redis.set(cursorKey(applicationId), cursor, 'EX', CURSOR_TTL_SECONDS);
  } catch (err: any) {
    log('appId=%s cursor write failed: %s', applicationId, err?.message);
  }
};

export const clearPollCursor = async (
  redis: WechatPollStateRedis | undefined,
  applicationId: string,
): Promise<void> => {
  if (!redis) return;
  try {
    await redis.del(cursorKey(applicationId));
  } catch (err: any) {
    log('appId=%s cursor clear failed: %s', applicationId, err?.message);
  }
};

/** True while the session is known dead and only re-auth can revive it. */
export const isPollParked = async (
  redis: WechatPollStateRedis | undefined,
  applicationId: string,
): Promise<boolean> => {
  if (!redis) return false;
  try {
    return !!(await redis.get(parkKey(applicationId)));
  } catch (err: any) {
    // Fail open: a Redis blip must not silence a healthy bot.
    log('appId=%s park read failed, treating as unparked: %s', applicationId, err?.message);
    return false;
  }
};

export const parkPoll = async (
  redis: WechatPollStateRedis | undefined,
  applicationId: string,
  now = Date.now(),
): Promise<void> => {
  if (!redis) return;
  try {
    await redis.set(parkKey(applicationId), String(now), 'EX', PARK_TTL_SECONDS);
  } catch (err: any) {
    log('appId=%s park write failed: %s', applicationId, err?.message);
  }
};

/**
 * Clear on any credential-bearing (re)registration — the owner re-scanned, so
 * the next poll deserves a real attempt. The stale cursor goes with it: a new
 * QR session issues a fresh account/seq space.
 */
export const clearPollPark = async (
  redis: WechatPollStateRedis | undefined,
  applicationId: string,
): Promise<void> => {
  if (!redis) return;
  try {
    await redis.del(parkKey(applicationId));
  } catch (err: any) {
    log('appId=%s park clear failed: %s', applicationId, err?.message);
  }
};
