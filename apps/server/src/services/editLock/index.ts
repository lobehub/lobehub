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
}

const UNLOCKED: EditLockResult = { expiresAt: null, holderId: null, lockedByOther: false };

const lockKey = (type: EditLockResourceType, id: string) => `editlock:${type}:${id}`;

// Release only if the caller still holds the lock (compare-and-delete), so a
// stale releaser can't drop a lease another member has since taken over.
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

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
  async acquire(type: EditLockResourceType, id: string): Promise<EditLockResult> {
    const redis = this.redis;
    if (!redis) return UNLOCKED;
    const key = lockKey(type, id);

    try {
      // Claim only when the key is absent (NX). The TTL gives automatic expiry, so
      // a hard-closed tab frees the lock without any cleanup job.
      const claimed = await redis.set(key, this.userId, 'EX', EDIT_LOCK_TTL_SECONDS, 'NX');
      if (claimed) return this.held();

      const holder = await redis.get(key);
      if (holder === this.userId) {
        // Already mine — refresh the lease (heartbeat).
        await redis.set(key, this.userId, 'EX', EDIT_LOCK_TTL_SECONDS);
        return this.held();
      }
      if (holder) return { expiresAt: null, holderId: holder, lockedByOther: true };

      // Freed between the NX and the GET — try once more.
      const reclaimed = await redis.set(key, this.userId, 'EX', EDIT_LOCK_TTL_SECONDS, 'NX');
      return reclaimed ? this.held() : UNLOCKED;
    } catch (error) {
      // Fail-open: a Redis outage (configured but unreachable) must never block
      // editing — report unlocked rather than surfacing the command rejection.
      log('acquire failed for %s:%s %O', type, id, error);
      return UNLOCKED;
    }
  }

  /** Current holder of the lock, or undefined when unlocked / Redis is down. */
  async getActiveHolder(type: EditLockResourceType, id: string): Promise<string | undefined> {
    const redis = this.redis;
    if (!redis) return undefined;
    try {
      const holder = await redis.get(lockKey(type, id));
      return holder ?? undefined;
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
  async getBlockingHolder(type: EditLockResourceType, id: string): Promise<string | null> {
    const holder = await this.getActiveHolder(type, id);
    return holder && holder !== this.userId ? holder : null;
  }

  /**
   * Release the lock, but only if the caller still holds it (compare-and-delete).
   * Returns true only when the caller's lock was actually deleted — false when
   * the lease had already expired or another member has since taken it over, so
   * callers can avoid broadcasting a bogus "unlocked" event.
   */
  async release(type: EditLockResourceType, id: string): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const deleted = await this.redis.eval(RELEASE_SCRIPT, 1, lockKey(type, id), this.userId);
      return deleted === 1;
    } catch (error) {
      log('release failed for %s:%s %O', type, id, error);
      return false;
    }
  }

  private held(): EditLockResult {
    return {
      expiresAt: new Date(Date.now() + EDIT_LOCK_TTL_SECONDS * 1000),
      holderId: this.userId,
      lockedByOther: false,
    };
  }
}
