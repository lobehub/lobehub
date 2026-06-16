import debug from 'debug';
import type { Redis } from 'ioredis';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:edit-lock');

/** Lease lifetime in seconds; clients heartbeat well within this to keep it alive. */
export const EDIT_LOCK_TTL_SECONDS = 30;

/** Editable resource families that can take a collaborative edit lock. */
export type EditLockResourceType = 'agent' | 'chatGroup' | 'document' | 'task';

export interface EditLockResult {
  /** Lease expiry of the active lock, if the caller now holds it. */
  expiresAt: Date | null;
  /** The user id currently holding the lock, or null when unlocked. */
  holderId: string | null;
  /** True when another user holds the lock (caller is locked out). */
  lockedByOther: boolean;
  /** The edit-session id currently holding the lock, or null for legacy/unlocked. */
  ownerId: string | null;
}

export interface ActiveEditLock {
  expiresAt: Date | null;
  ownerId: string | null;
  userId: string;
}

const UNLOCKED: EditLockResult = {
  expiresAt: null,
  holderId: null,
  lockedByOther: false,
  ownerId: null,
};

const lockKey = (type: EditLockResourceType, id: string) => `editlock:${type}:${id}`;

// Release only if the caller still holds the lock (compare-and-delete), so a
// stale releaser can't drop a lease another member has since taken over. The
// ownerId is broadcast on lock.changed, so it can't be used as a capability on
// its own — we also bind to the caller's userId (ARGV[2]) so a stranger who
// learned the ownerId from a broadcast cannot release another member's lock.
const RELEASE_SCRIPT = `
local raw = redis.call('get', KEYS[1])
if not raw then
  return 0
end
if raw == ARGV[2] then
  return redis.call('del', KEYS[1])
end
local ok, decoded = pcall(cjson.decode, raw)
if ok and decoded["userId"] == ARGV[2] and decoded["ownerId"] == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

const parseStoredLock = (raw: string): ActiveEditLock => {
  try {
    const parsed = JSON.parse(raw) as {
      expiresAt?: unknown;
      ownerId?: unknown;
      userId?: unknown;
    };
    if (typeof parsed.userId === 'string') {
      const expiresAt = typeof parsed.expiresAt === 'string' ? new Date(parsed.expiresAt) : null;

      return {
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        ownerId: typeof parsed.ownerId === 'string' ? parsed.ownerId : null,
        userId: parsed.userId,
      };
    }
  } catch {
    // Existing deployments may still have raw user-id values in Redis. Treat
    // them as legacy locks so rolling deploys do not temporarily unlock pages.
  }

  return { expiresAt: null, ownerId: null, userId: raw };
};

/**
 * Redis-backed collaborative edit lock, keyed by (resourceType, resourceId).
 *
 * Intentionally a thin, table-agnostic lease: there is no DB schema, so it
 * applies uniformly to any editable resource (documents, briefs, …) and can be
 * removed wholesale once real-time co-editing lands — the keys simply expire.
 *
 * The lock is advisory: when Redis is unavailable every method degrades to
 * "unlocked" so the lock infrastructure can never block editing or saving.
 */
export class EditLockService {
  private userId: string;
  private explicitRedis: Redis | null | undefined;
  private lazyRedis: Redis | null = null;
  private lazyResolved = false;

  constructor(userId: string, redis?: Redis | null) {
    this.userId = userId;
    this.explicitRedis = redis;
  }

  /**
   * The Redis client, resolved lazily on first use. Resolving eagerly in the
   * constructor would read server-only env (`getAgentRuntimeRedisClient`) the
   * moment any owning service is built — which throws in client/test contexts
   * that construct the service but never take a lock.
   */
  private get redis(): Redis | null {
    if (this.explicitRedis !== undefined) return this.explicitRedis;
    if (!this.lazyResolved) {
      this.lazyRedis = getAgentRuntimeRedisClient();
      this.lazyResolved = true;
    }
    return this.lazyRedis;
  }

  /**
   * Acquire the lock when it is free (or already mine), refreshing the lease;
   * otherwise report whoever currently holds it. Doubles as the heartbeat.
   */
  async acquire(
    type: EditLockResourceType,
    id: string,
    ownerId = this.userId,
  ): Promise<EditLockResult> {
    const redis = this.redis;
    if (!redis) return UNLOCKED;
    const key = lockKey(type, id);

    try {
      const nextLock = this.serialize(ownerId);
      // Claim only when the key is absent (NX). The TTL gives automatic expiry, so
      // a hard-closed tab frees the lock without any cleanup job.
      const claimed = await redis.set(key, nextLock, 'EX', EDIT_LOCK_TTL_SECONDS, 'NX');
      if (claimed) return this.held(ownerId);

      const raw = await redis.get(key);
      if (raw) {
        const holder = parseStoredLock(raw);
        // Owner-only matches are unsafe: ownerId is fanned out on lock.changed,
        // so a workspace member could echo a stranger's ownerId back to steal
        // the lock. Bind ownership to the calling userId. When the same user
        // shows up with a different ownerId (refresh, crashed tab, HMR), the
        // old session is almost certainly a ghost — silently take over with
        // the new owner rather than telling the user they're editing in
        // another tab. Two truly concurrent tabs will keep flipping the owner
        // on their own heartbeats — that's CRDT territory, not ours to police.
        if (holder.userId === this.userId) {
          await redis.set(key, nextLock, 'EX', EDIT_LOCK_TTL_SECONDS);
          return this.held(ownerId);
        }

        return {
          expiresAt: holder.expiresAt,
          holderId: holder.userId,
          lockedByOther: true,
          ownerId: holder.ownerId,
        };
      }

      // Freed between the NX and the GET — try once more.
      const reclaimed = await redis.set(key, nextLock, 'EX', EDIT_LOCK_TTL_SECONDS, 'NX');
      return reclaimed ? this.held(ownerId) : UNLOCKED;
    } catch (error) {
      // Fail-open: a Redis outage (configured but unreachable) must never block
      // editing — report unlocked rather than surfacing the command rejection.
      log('acquire failed for %s:%s %O', type, id, error);
      return UNLOCKED;
    }
  }

  /** Current holder of the lock, or undefined when unlocked / Redis is down. */
  async getActiveHolder(type: EditLockResourceType, id: string): Promise<string | undefined> {
    return (await this.getActiveLock(type, id))?.userId;
  }

  /** Current lock payload, or undefined when unlocked / Redis is down. */
  async getActiveLock(type: EditLockResourceType, id: string): Promise<ActiveEditLock | undefined> {
    const redis = this.redis;
    if (!redis) return undefined;
    try {
      const holder = await redis.get(lockKey(type, id));
      return holder ? parseStoredLock(holder) : undefined;
    } catch (error) {
      // Fail-open: a Redis outage must not turn the write guards into 500s.
      log('getActiveHolder failed for %s:%s %O', type, id, error);
      return undefined;
    }
  }

  /**
   * The holder when someone *other* than the caller holds the lock, else null.
   * Used by write guards; returns null when Redis is down (fail-open).
   */
  async getBlockingHolder(
    type: EditLockResourceType,
    id: string,
    ownerId?: string,
  ): Promise<string | null> {
    const holder = await this.getActiveLock(type, id);
    if (!holder) return null;
    // ownerId is broadcast on lock.changed; it can't authorize on its own.
    // Bind to userId first, then keep the stale-tab guard (same user, different
    // active ownerId still blocks so a ghost tab can't save over a newer one).
    if (holder.userId !== this.userId) return holder.userId;
    if (holder.ownerId && holder.ownerId !== ownerId) return holder.userId;

    return null;
  }

  /**
   * Validate a content write against the current lease. When a caller provides
   * an owner id, the active Redis lock must still belong to that owner; otherwise
   * a stale tab whose lease expired could save over a newer editor. Without an
   * owner id, this preserves the advisory-lock behavior: writes are allowed only
   * when no modern owner-scoped lock is active (legacy same-user locks remain
   * compatible during rolling deploys).
   */
  async canWrite(type: EditLockResourceType, id: string, ownerId?: string): Promise<boolean> {
    const redis = this.redis;
    if (!redis) return true;
    try {
      const raw = await redis.get(lockKey(type, id));
      if (!raw) return !ownerId;

      const holder = parseStoredLock(raw);
      // ownerId is broadcast on lock.changed; matching it alone isn't proof of
      // ownership. Bind the write to the calling userId before honoring the
      // owner-scoped match.
      if (holder.userId !== this.userId) return false;
      if (holder.ownerId) return holder.ownerId === ownerId;

      return true;
    } catch (error) {
      log('canWrite failed for %s:%s %O', type, id, error);
      return true;
    }
  }

  /**
   * Release the lock, but only if the caller still holds it (compare-and-delete).
   * Returns true only when the caller's lock was actually deleted — false when
   * the lease had already expired or another member has since taken it over, so
   * callers can avoid broadcasting a bogus "unlocked" event.
   */
  async release(type: EditLockResourceType, id: string, ownerId = this.userId): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const deleted = await this.redis.eval(
        RELEASE_SCRIPT,
        1,
        lockKey(type, id),
        ownerId,
        this.userId,
      );
      return deleted === 1;
    } catch (error) {
      log('release failed for %s:%s %O', type, id, error);
      return false;
    }
  }

  private held(ownerId: string): EditLockResult {
    return {
      expiresAt: new Date(Date.now() + EDIT_LOCK_TTL_SECONDS * 1000),
      holderId: this.userId,
      lockedByOther: false,
      ownerId,
    };
  }

  private serialize(ownerId: string): string {
    return JSON.stringify({
      expiresAt: new Date(Date.now() + EDIT_LOCK_TTL_SECONDS * 1000).toISOString(),
      ownerId,
      userId: this.userId,
    });
  }
}
