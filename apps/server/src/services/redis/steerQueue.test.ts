import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { redisService } from './index';
import { STEER_QUEUE_MAX_ENTRIES, SteerQueueWriteUnknownError } from './steerQueue';

const getRedisServiceClient = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ getRedisServiceClient }));

/**
 * Emulates the queue's Lua scripts over in-memory state — the list, the taken
 * ids and the drained batches — reading each item's `<id>\t<behind>\n<json>`
 * header the way the scripts do. The scripts themselves run against a real
 * Redis in the PR's verification.
 */
const createFakeRedis = () => {
  const lists = new Map<string, string[]>();
  const ttls = new Map<string, number>();
  const taken = new Map<string, Set<string>>();
  const batches = new Map<string, Map<string, { expiry: number; items: string[] }>>();
  const listOf = (key: string) => lists.get(key) ?? [];
  const setOf = (key: string) => taken.get(key) ?? taken.set(key, new Set()).get(key)!;
  const batchesOf = (key: string) => batches.get(key) ?? batches.set(key, new Map()).get(key)!;
  const header = (item: string) => {
    const [id, behind] = item.slice(0, item.indexOf('\n')).split('\t');
    return { behind, id };
  };
  const takes = (item: string, op: string) => ['*', op].includes(header(item).behind);
  const unbind = (item: string) => `${header(item).id}\t*${item.slice(item.indexOf('\n'))}`;
  const inFlight = (key: string) =>
    [...batchesOf(key).values()].reduce((n, batch) => n + batch.items.length, 0);
  // Whether the scripts' `pushFront` renews the queue TTL, read off their source.
  let pushFrontRenewsTtl = false;
  const reclaim = (qkey: string, pkey: string, now: number) => {
    for (const [id, batch] of batchesOf(pkey)) {
      if (batch.expiry <= now) {
        lists.set(qkey, [...batch.items.map(unbind), ...listOf(qkey)]);
        if (pushFrontRenewsTtl) ttls.set(qkey, 24 * 60 * 60);
        batchesOf(pkey).delete(id);
      }
    }
  };

  const evalScript = vi.fn(async (script: string, numKeys: number, ...rest: any[]) => {
    const keys = rest.slice(0, numKeys);
    const args = rest.slice(numKeys);
    pushFrontRenewsTtl = /local function pushFront[\s\S]*?'EXPIRE', qkey[\s\S]*?\nend/.test(script);
    const [key] = keys;
    const list = listOf(key);

    if (script.includes('local delivering = {}')) {
      reclaim(key, keys[1], Number(args[0]));
      return [listOf(key), [...batchesOf(keys[1]).values()].flatMap((batch) => batch.items)];
    }
    if (script.includes("return 'absent'")) {
      const [, takenKey, drainedKey] = keys;
      const [id, mode, now] = args;
      reclaim(key, drainedKey, Number(now));
      const current = listOf(key);
      const index = current.findIndex((item) => header(item).id === id);
      if (index >= 0) {
        if (mode !== 'remove') return 'queued';
        current.splice(index, 1);
        lists.set(key, current);
        return 'removed';
      }
      const inBatch = [...batchesOf(drainedKey).values()].some((batch) =>
        batch.items.some((item) => header(item).id === id),
      );
      if (inBatch) return 'delivering';
      return setOf(takenKey).has(id) ? 'taken' : 'absent';
    }
    if (script.includes('reclaimLapsed(KEYS[1], KEYS[3]')) {
      const [, , pkey] = keys;
      const [op, drainId, now, lease, , ...ended] = args;
      reclaim(key, pkey, Number(now));
      const existing = batchesOf(pkey).get(drainId);
      if (existing) return existing.items;
      const current = listOf(key);
      const owned = (item: string) => takes(item, op) || ended.includes(header(item).behind);
      const out = current.filter(owned);
      if (out.length === 0) return [];
      for (const item of out) setOf(keys[1]).add(header(item).id);
      batchesOf(pkey).set(drainId, { expiry: Number(now) + Number(lease), items: out });
      lists.set(
        key,
        current.filter((item) => !owned(item)),
      );
      return out;
    }
    if (script.includes('local back = {}')) {
      const [, pkey] = keys;
      const [drainId, , ...ids] = args;
      const batch = batchesOf(pkey).get(drainId);
      if (!batch) return 0;
      const returned = batch.items.filter((item) => ids.includes(header(item).id));
      const kept = batch.items.filter((item) => !ids.includes(header(item).id));
      lists.set(key, [...returned.map(unbind), ...list]);
      if (ids.length === 0 || kept.length === 0) batchesOf(pkey).delete(drainId);
      else batch.items = kept;
      return returned.length;
    }
    if (script.includes('local count = 0')) {
      const [op, now] = args;
      const lapsed = [...batchesOf(keys[1]).values()]
        .filter((batch) => batch.expiry <= Number(now))
        .reduce((n, batch) => n + batch.items.length, 0);
      return list.filter((item) => takes(item, op)).length + lapsed;
    }
    if (script.includes('return inFlight(KEYS[1])')) return inFlight(key);
    if (script.includes('SISMEMBER')) {
      const [id, item, ttl, max] = args;
      if (setOf(keys[1]).has(id)) return -2;
      if (list.some((existing) => header(existing).id === id)) return list.length;
      if (list.length + inFlight(keys[2]) >= Number(max)) return -1;
      lists.set(key, [...list, item]);
      ttls.set(key, Number(ttl));
      return list.length + 1;
    }
    if (script.includes("redis.call('LREM'")) {
      const index = list.findIndex((item) => header(item).id === args[0]);
      if (index < 0) return 0;
      lists.set(key, list.toSpliced(index, 1));
      return 1;
    }
    if (script.includes('LRANGE')) return list;
    throw new Error(`unexpected script: ${script}`);
  });

  return { batches, client: { eval: evalScript }, lists, ttls };
};

const scope = { topicId: 'tpc-1', userId: 'u1' };
const entry = (id: string, createdAt = 1) => ({ createdAt, id, prompt: id });
const ids = async (s = scope) => (await redisService.steerQueue.list(s)).map((item) => item.id);
const q = redisService.steerQueue;

describe('redisService.steerQueue', () => {
  let redis: ReturnType<typeof createFakeRedis>;

  beforeEach(() => {
    redis = createFakeRedis();
    getRedisServiceClient.mockReset();
    getRedisServiceClient.mockImplementation(async () => redis.client);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps one queue per user and conversation surface under the agentSteer scope', async () => {
    await q.append(scope, entry('a'), 'op-1');
    await q.append({ ...scope, threadId: 'thd-1' }, entry('b'), 'op-2');
    await q.append({ ...scope, userId: 'u2' }, entry('c'), 'op-3');

    expect(getRedisServiceClient).toHaveBeenCalledWith('agentSteer');
    expect([...redis.lists.keys()]).toEqual([
      'follow_ups:v1:u1:tpc-1:main',
      'follow_ups:v1:u1:tpc-1:thd-1',
      'follow_ups:v1:u2:tpc-1:main',
    ]);
    expect(redis.ttls.get('follow_ups:v1:u1:tpc-1:main')).toBe(24 * 60 * 60);
  });

  it('drains what was queued behind the finishing run into a batch, once, in order', async () => {
    await q.append(scope, entry('a'), 'op-1');
    await q.append(scope, entry('b'), 'op-1');

    await expect(q.drain(scope, 'op-1', [], 'd1')).resolves.toEqual([entry('a'), entry('b')]);
    await expect(q.drain(scope, 'op-1', [], 'd2')).resolves.toEqual([]);
    expect(await ids()).toEqual([]);
    // Still held until acknowledged — it counts against the queue.
    await expect(q.boundOperations(scope)).resolves.toMatchObject({ total: 2 });

    await q.settle(scope, 'd1');
    await expect(q.boundOperations(scope)).resolves.toMatchObject({ total: 0 });
  });

  it('shows a drained entry as delivering until its batch is settled', async () => {
    await q.append(scope, entry('a'), 'op-1');
    await q.append(scope, entry('b'), 'op-1');
    await q.drain(scope, 'op-1', [], 'd1');

    await expect(q.snapshot(scope)).resolves.toEqual({
      delivering: [entry('a'), entry('b')],
      waiting: [],
    });

    // `b` cannot join and goes back to wait; `a` is still on its way.
    await q.settle(scope, 'd1', ['b']);
    await expect(q.snapshot(scope)).resolves.toEqual({
      delivering: [entry('a')],
      waiting: [expect.objectContaining({ id: 'b' })],
    });
    await expect(q.entryState(scope, 'a')).resolves.toBe('delivering');

    // `a` delivered.
    await q.settle(scope, 'd1');
    await expect(q.entryState(scope, 'a')).resolves.toBe('taken');
  });

  // ROOT CAUSE:
  //
  // A batch whose run crashed before settling stayed `delivering` after its
  // lease lapsed, until a later drain reclaimed it: with no further run the
  // user could neither withdraw nor resend it, and once the hash expired it
  // read as delivered.
  //
  // Before: only a drain reclaimed lapsed batches.
  // After: reading the queue or an entry's state reclaims them first.
  it('returns a lapsed batch to the queue before reporting what is delivering', async () => {
    vi.useFakeTimers();
    await q.append(scope, entry('a'), 'op-1');
    await q.drain(scope, 'op-1', [], 'd1');
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    await expect(q.snapshot(scope)).resolves.toEqual({
      delivering: [],
      waiting: [expect.objectContaining({ id: 'a' })],
    });

    await q.drain(scope, 'op-2', [], 'd2');
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await expect(q.entryState(scope, 'a', { remove: true })).resolves.toBe('removed');
  });

  // ROOT CAUSE:
  //
  // A drain that took the whole list deleted the queue key; returning a lapsed
  // batch recreated it without a TTL, so an abandoned follow-up never expired
  // and could replay into an unrelated run much later.
  //
  // Before: the reclaimed queue had no expiry.
  // After: moving entries back renews the queue TTL.
  it('keeps the queue expiring after a lapsed batch recreates it', async () => {
    vi.useFakeTimers();
    await q.append(scope, entry('a'), 'op-1');
    await q.drain(scope, 'op-1', [], 'd1');
    redis.ttls.clear();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);

    await q.snapshot(scope);

    expect(redis.ttls.get('follow_ups:v1:u1:tpc-1:main')).toBe(24 * 60 * 60);
  });

  it('reports an outage instead of an empty queue', async () => {
    getRedisServiceClient.mockResolvedValue(null);

    await expect(q.snapshot(scope)).rejects.toThrow('unavailable');
    await expect(q.entryState(scope, 'a')).resolves.toBeUndefined();
  });

  it('withdraws only a waiting entry, and says where any other one is', async () => {
    await q.append(scope, entry('a'), 'op-1');

    await expect(q.entryState(scope, 'a')).resolves.toBe('queued');
    await expect(q.entryState(scope, 'a', { remove: true })).resolves.toBe('removed');
    await expect(q.entryState(scope, 'a', { remove: true })).resolves.toBe('absent');
  });

  it('reads a drained batch back when its response was lost', async () => {
    await q.append(scope, entry('a'), 'op-1');
    await q.drain(scope, 'op-1', [], 'd1');

    await expect(q.drain(scope, 'op-1', [], 'd1')).resolves.toEqual([entry('a')]);
  });

  it('leaves follow-ups queued behind another live run on the surface to that run', async () => {
    await q.append(scope, entry('behind-1'), 'op-1');
    await q.append(scope, entry('behind-2'), 'op-2');

    await expect(q.length(scope, 'op-1')).resolves.toBe(1);
    await expect(q.drain(scope, 'op-1', [], 'd1')).resolves.toEqual([entry('behind-1')]);
    expect(await ids()).toEqual(['behind-2']);
  });

  it('lets the next run take follow-ups behind a run confirmed ended, and only those', async () => {
    await q.append(scope, entry('orphan'), 'op-ended');
    await q.append(scope, entry('behind-live'), 'op-live');

    await expect(q.boundOperations(scope)).resolves.toEqual({
      operationIds: ['op-ended', 'op-live'],
      total: 2,
    });
    await expect(q.drain(scope, 'op-next', ['op-ended'], 'd1')).resolves.toEqual([entry('orphan')]);
    expect(await ids()).toEqual(['behind-live']);
  });

  it('returns part of a batch to the head of the queue, unbound, and keeps the rest', async () => {
    await q.append(scope, entry('a'), 'op-1');
    await q.append(scope, entry('b'), 'op-1');
    await q.drain(scope, 'op-1', [], 'd1');
    await q.append(scope, entry('c'), 'op-2');

    await q.settle(scope, 'd1', ['b']);

    expect(await ids()).toEqual(['b', 'c']);
    // Unbound: any run on the surface takes it.
    await expect(q.length(scope, 'op-9')).resolves.toBe(1);
    await expect(q.boundOperations(scope)).resolves.toMatchObject({ total: 3 });
    await q.settle(scope, 'd1');
    await expect(q.boundOperations(scope)).resolves.toMatchObject({ total: 2 });
  });

  it('puts a batch nobody settled back into the queue once its lease lapses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    await q.append(scope, entry('a'), 'op-1');
    await q.drain(scope, 'op-1', [], 'd1');

    vi.setSystemTime(1_000_000 + 5 * 60 * 1000);
    // Counted for any run already, and drained back on the next drain.
    await expect(q.length(scope, 'op-9')).resolves.toBe(1);
    await expect(q.drain(scope, 'op-9', [], 'd2')).resolves.toEqual([entry('a')]);
  });

  it('counts drained batches against the bound, so a return never drops what was accepted', async () => {
    await q.append(scope, entry('old-1'), 'op-1');
    await q.append(scope, entry('old-2'), 'op-1');
    const drained = await q.drain(scope, 'op-1', [], 'd1');
    for (let i = 0; i < STEER_QUEUE_MAX_ENTRIES - 2; i++) {
      await expect(q.append(scope, entry(`new-${i}`), 'op-2')).resolves.toBe(i + 1);
    }
    await expect(q.append(scope, entry('over'), 'op-2')).resolves.toBe('full');

    await q.settle(
      scope,
      'd1',
      drained.map((item) => item.id),
    );

    const queued = await ids();
    expect(queued).toHaveLength(STEER_QUEUE_MAX_ENTRIES);
    expect(queued.slice(0, 3)).toEqual(['old-1', 'old-2', 'new-0']);
    expect(queued.at(-1)).toBe(`new-${STEER_QUEUE_MAX_ENTRIES - 3}`);
  });

  it('appends an entry id at most once, also after a drain took it', async () => {
    await expect(q.append(scope, entry('a'), 'op-1')).resolves.toBe(1);
    await expect(q.append(scope, entry('a'), 'op-1')).resolves.toBe(1);
    await q.drain(scope, 'op-1', [], 'd1');

    await expect(q.append(scope, entry('a'), 'op-2')).resolves.toBe('taken');
    expect(await ids()).toEqual([]);
  });

  it('removes one entry by id and reports a miss once it is gone', async () => {
    await q.append(scope, entry('a'), 'op-1');
    await q.append(scope, entry('b'), 'op-1');

    await expect(q.remove(scope, 'a')).resolves.toBe(true);
    await expect(q.remove(scope, 'a')).resolves.toBe(false);
    expect(await ids()).toEqual(['b']);
  });

  it('refuses entries past the bound', async () => {
    for (let i = 0; i < STEER_QUEUE_MAX_ENTRIES; i++) {
      await q.append(scope, entry(`m${i}`), 'op-1');
    }

    await expect(q.append(scope, entry('over'), 'op-1')).resolves.toBe('full');
  });

  it('reports no Redis instead of an empty queue', async () => {
    getRedisServiceClient.mockResolvedValue(null);

    await expect(q.append(scope, entry('a'), 'op-1')).resolves.toBeUndefined();
    await expect(q.length(scope, 'op-1')).resolves.toBe(0);
    await expect(q.drain(scope, 'op-1', [], 'd1')).rejects.toThrow('Redis is unavailable');
    await expect(q.settle(scope, 'd1')).rejects.toThrow('Redis is unavailable');
    await expect(q.boundOperations(scope)).rejects.toThrow('Redis is unavailable');
  });

  it('takes back an append that committed before its command failed, then falls back', async () => {
    const run = redis.client.eval.getMockImplementation()!;
    redis.client.eval.mockImplementationOnce(async (...args: any[]) => {
      await run(...(args as [string, number, string]));
      throw new Error('command timed out');
    });

    await expect(q.append(scope, entry('a'), 'op-1')).resolves.toBe('notStored');
    expect(await ids()).toEqual([]);
  });

  it('reports an unknown outcome when the take-back finds nothing to remove', async () => {
    redis.client.eval.mockRejectedValueOnce(new Error('command timed out'));

    await expect(q.append(scope, entry('a'), 'op-1')).rejects.toBeInstanceOf(
      SteerQueueWriteUnknownError,
    );
  });

  it('reports an unknown outcome when the take-back fails too', async () => {
    redis.client.eval
      .mockRejectedValueOnce(new Error('command timed out'))
      .mockRejectedValueOnce(new Error('connection lost'));

    await expect(q.append(scope, entry('a'), 'op-1')).rejects.toBeInstanceOf(
      SteerQueueWriteUnknownError,
    );
  });
});
