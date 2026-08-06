import debug from 'debug';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const log = debug('lobe-server:hetero-agent:event-ledger');

/**
 * Minimal structural slice of an ioredis client the ledger needs. Kept
 * structural so tests can inject a plain in-memory fake without pulling in
 * ioredis, while the production `getAgentRuntimeRedisClient()` singleton
 * satisfies it as-is.
 */
export interface HeteroLedgerRedis {
  del: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  sadd: (key: string, ...members: string[]) => Promise<number>;
  smismember: (key: string, ...members: string[]) => Promise<number[]>;
}

/**
 * Mirror the stream retention (`StreamEventManager.STREAM_RETENTION`): once the
 * stream itself has expired, replaying into it cannot reach any subscriber, so
 * keeping the ledger longer buys nothing. Runs longer than the TTL degrade to
 * the in-memory-only baseline (sticky-replica dedupe), never to corruption.
 */
const LEDGER_RETENTION_SECONDS = 2 * 3600;

/**
 * Durable per-operation event-key ledger — the cross-replica half of hetero
 * ingest idempotency.
 *
 * The persistence handler's `processedKeys` and the publish latch are
 * per-Node-process; a CLI BatchIngester retry that lands on a COLD replica
 * (non-sticky routing, replica recycled between attempts) starts with both
 * empty and would redo work another replica already completed: republish the
 * whole batch to live subscribers, re-fold the execution trace, and re-reduce
 * events whose effects (subagent text append, assistant row creation) are not
 * all idempotent under replay. This ledger stores the same `eventKey`s in a
 * Redis set per operation so the "already done" answer survives replica death.
 *
 * Two independent instances exist (see the module singletons below) because
 * persistence and publish fail independently — a batch can persist fully yet
 * die inside the publish loop, and its retry must then skip persistence but
 * republish the unpublished tail:
 *
 *  - `applied` — marked only after the WHOLE batch persisted and its content
 *    flush landed (`HeterogeneousPersistenceHandler.ingest`). Consulted before
 *    reducing, so a redelivered already-applied event never reaches the
 *    reducer: a cold-replica redelivery becomes indistinguishable from the
 *    already-supported cold-replica *handoff* (state comes from the DB, new
 *    events continue from it).
 *  - `published` — in-memory-marked per event right after its XADD succeeds,
 *    durably persisted once per batch in the caller's `finally`
 *    (`HeterogeneousAgentService.heteroIngest`). XADD-before-mark means a
 *    crash window can duplicate at most one batch, never lose events.
 *
 * Degradation posture: Redis being absent (desktop / single-process deploys —
 * where the in-memory maps are already correct, since there is no second
 * replica) or erroring never fails ingest; the ledger silently narrows to its
 * in-memory layer, which is exactly the pre-ledger baseline.
 */
export class HeteroEventLedger {
  private readonly memory = new Map<string, Set<string>>();

  constructor(
    /** Namespace segment of the Redis key — distinguishes the two ledgers. */
    private readonly scope: 'applied' | 'published',
    /**
     * Lazy client resolver. Deferred to call time (not construction) because
     * the module singletons are created at import time, before env-based
     * Redis initialization has necessarily happened.
     */
    private readonly getRedis: () => HeteroLedgerRedis | null = getAgentRuntimeRedisClient,
  ) {}

  /**
   * Whether marks survive this process. Callers that would be UNSAFE under a
   * memory-only ledger key their behavior off this — e.g. the subagent
   * accumulator restore, which pairs with the ledger's replay skip: restoring
   * while a replay can still reach the reducer would double-append. A
   * memory-only ledger also implies a single replica, so what the restore
   * exists for (cross-replica handoff) cannot occur there anyway.
   */
  get isDurable(): boolean {
    return this.getRedis() !== null;
  }

  private redisKey(operationId: string): string {
    return `hetero_evt:${this.scope}:${operationId}`;
  }

  private memorySet(operationId: string): Set<string> {
    let set = this.memory.get(operationId);
    if (!set) {
      set = new Set();
      this.memory.set(operationId, set);
    }
    return set;
  }

  /**
   * Subset of `keys` this ledger already contains. In-memory hits are
   * authoritative (this process marked them); only the remainder consults
   * Redis, so the common warm-replica batch costs at most one `SMISMEMBER`
   * round trip and a pure in-memory deployment costs none. Redis-confirmed
   * keys are folded back into the memory layer so a later retry on this
   * replica skips the round trip.
   */
  async knownKeys(operationId: string, keys: string[]): Promise<Set<string>> {
    const mem = this.memory.get(operationId);
    const known = new Set<string>();
    const unknown: string[] = [];
    for (const key of keys) {
      if (mem?.has(key)) known.add(key);
      else unknown.push(key);
    }
    if (unknown.length === 0) return known;

    const redis = this.getRedis();
    if (!redis) return known;

    try {
      const flags = await redis.smismember(this.redisKey(operationId), ...unknown);
      const memSet = this.memorySet(operationId);
      flags.forEach((flag, i) => {
        if (flag === 1) {
          known.add(unknown[i]);
          memSet.add(unknown[i]);
        }
      });
    } catch (err) {
      // Degrade to the in-memory answer: worst case is the pre-ledger
      // behavior (redo work), never lost work.
      log('knownKeys redis lookup failed op=%s scope=%s err=%O', operationId, this.scope, err);
    }
    return known;
  }

  /**
   * Latch a key in the in-memory layer only. Used per event inside the publish
   * loop so a same-process retry skips it even if the durable `persist` at the
   * end of the batch never runs.
   */
  markMemory(operationId: string, key: string): void {
    this.memorySet(operationId).add(key);
  }

  /**
   * Durably record keys (memory + Redis `SADD`, TTL refreshed). Batch-granular
   * on purpose: one round trip per ingest batch instead of one per event.
   * Best-effort — a Redis failure leaves the keys memory-only (baseline
   * behavior), it never fails the batch.
   */
  async persist(operationId: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const memSet = this.memorySet(operationId);
    for (const key of keys) memSet.add(key);

    const redis = this.getRedis();
    if (!redis) return;

    try {
      const redisKey = this.redisKey(operationId);
      await redis.sadd(redisKey, ...keys);
      await redis.expire(redisKey, LEDGER_RETENTION_SECONDS);
    } catch (err) {
      log('persist redis write failed op=%s scope=%s err=%O', operationId, this.scope, err);
    }
  }

  /** Drop an operation's ledger (terminal finish). Best-effort on Redis. */
  async cleanup(operationId: string): Promise<void> {
    this.memory.delete(operationId);
    const redis = this.getRedis();
    if (!redis) return;
    try {
      await redis.del(this.redisKey(operationId));
    } catch (err) {
      log('cleanup redis del failed op=%s scope=%s err=%O', operationId, this.scope, err);
    }
  }

  /** Test-only: clear the in-memory layer (simulates a replica restart). */
  __clearMemoryForTesting(): void {
    this.memory.clear();
  }
}

/** Shared applied-events ledger (persistence side). See class doc. */
export const heteroAppliedEventLedger = new HeteroEventLedger('applied');

/** Shared published-events ledger (live-stream side). See class doc. */
export const heteroPublishedEventLedger = new HeteroEventLedger('published');
