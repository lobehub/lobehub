// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { HeteroEventLedger, type HeteroLedgerRedis } from '../HeteroEventLedger';

const createFakeRedis = () => {
  const sets = new Map<string, Set<string>>();
  const redis: HeteroLedgerRedis = {
    del: vi.fn(async (key: string) => (sets.delete(key) ? 1 : 0)),
    expire: vi.fn(async () => 1),
    sadd: vi.fn(async (key: string, ...members: string[]) => {
      let set = sets.get(key);
      if (!set) {
        set = new Set();
        sets.set(key, set);
      }
      let added = 0;
      for (const member of members) {
        if (!set.has(member)) {
          set.add(member);
          added += 1;
        }
      }
      return added;
    }),
    smismember: vi.fn(async (key: string, ...members: string[]) =>
      members.map((member) => (sets.get(key)?.has(member) ? 1 : 0)),
    ),
  };
  return { redis, sets };
};

describe('HeteroEventLedger', () => {
  it('answers from memory without touching Redis for keys this process marked', async () => {
    const { redis } = createFakeRedis();
    const ledger = new HeteroEventLedger('published', () => redis);

    ledger.markMemory('op-1', 'k1');
    const known = await ledger.knownKeys('op-1', ['k1']);

    expect(known).toEqual(new Set(['k1']));
    expect(redis.smismember).not.toHaveBeenCalled();
  });

  it('persist survives a replica death: a FRESH instance resolves the keys via Redis', async () => {
    const { redis } = createFakeRedis();
    const replicaA = new HeteroEventLedger('published', () => redis);
    await replicaA.persist('op-1', ['k1', 'k2']);

    const replicaB = new HeteroEventLedger('published', () => redis);
    const known = await replicaB.knownKeys('op-1', ['k1', 'k2', 'k3']);

    expect(known).toEqual(new Set(['k1', 'k2']));
    // Redis-confirmed keys warm replica B's memory: the next lookup skips Redis.
    vi.mocked(redis.smismember).mockClear();
    await replicaB.knownKeys('op-1', ['k1', 'k2']);
    expect(redis.smismember).not.toHaveBeenCalled();
  });

  it('scopes keys per ledger kind and per operation', async () => {
    const { redis } = createFakeRedis();
    const published = new HeteroEventLedger('published', () => redis);
    const applied = new HeteroEventLedger('applied', () => redis);
    await published.persist('op-1', ['k1']);

    expect(await applied.knownKeys('op-1', ['k1'])).toEqual(new Set());
    expect(await published.knownKeys('op-2', ['k1'])).toEqual(new Set());
  });

  it('degrades to memory-only on Redis errors instead of failing the batch', async () => {
    const { redis } = createFakeRedis();
    vi.mocked(redis.smismember).mockRejectedValue(new Error('redis down'));
    vi.mocked(redis.sadd).mockRejectedValue(new Error('redis down'));
    const ledger = new HeteroEventLedger('published', () => redis);

    await expect(ledger.persist('op-1', ['k1'])).resolves.toBeUndefined();
    // The memory layer still answers even though the durable write failed.
    await expect(ledger.knownKeys('op-1', ['k1', 'k2'])).resolves.toEqual(new Set(['k1']));
  });

  it('is memory-only (and reports non-durable) without a Redis client', async () => {
    const ledger = new HeteroEventLedger('applied', () => null);

    expect(ledger.isDurable).toBe(false);
    await ledger.persist('op-1', ['k1']);
    expect(await ledger.knownKeys('op-1', ['k1'])).toEqual(new Set(['k1']));

    ledger.__clearMemoryForTesting(); // replica death
    expect(await ledger.knownKeys('op-1', ['k1'])).toEqual(new Set());
  });

  it('cleanup drops both layers for one operation only', async () => {
    const { redis, sets } = createFakeRedis();
    const ledger = new HeteroEventLedger('published', () => redis);
    await ledger.persist('op-1', ['k1']);
    await ledger.persist('op-2', ['k2']);

    await ledger.cleanup('op-1');

    expect(await ledger.knownKeys('op-1', ['k1'])).toEqual(new Set());
    expect(sets.has('hetero_evt:published:op-1')).toBe(false);
    expect(await ledger.knownKeys('op-2', ['k2'])).toEqual(new Set(['k2']));
  });
});
