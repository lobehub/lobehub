import { RedisKeys } from '@/server/modules/Redis';

import { getRedisServiceClient } from './client';

const getClient = () => getRedisServiceClient('agentSteer');

// A queue outlives a long run with room to spare; one abandoned by a run that
// never ended expires instead of being replayed into a later, unrelated turn.
const QUEUE_TTL_SECONDS = 24 * 60 * 60;

/**
 * How long a drained batch belongs to the run that took it. Delivery (joining
 * the run, or starting the next turn) finishes well within it; a batch its run
 * never settled — a crash, a timed-out drain, Redis gone between drain and
 * settle — goes back to the queue once it lapses, so nothing is lost.
 */
const PROCESSING_LEASE_MS = 5 * 60 * 1000;

/**
 * Upper bound on follow-ups waiting behind one turn, counting the ones a run
 * has taken but not yet delivered (they may still come back).
 */
export const STEER_QUEUE_MAX_ENTRIES = 20;

/**
 * One user's queue on one conversation surface: the topic's main spine, or one
 * of its threads. Keyed by the user too — workspace members can each have a run
 * on the same surface, and each run drains only its own owner's follow-ups.
 */
export interface SteerQueueScope {
  threadId?: string | null;
  topicId: string;
  userId: string;
}

export interface SteerQueueEntry {
  createdAt: number;
  id: string;
}

/**
 * The append outcome is unknown: the command failed, and so did taking the
 * entry back. The caller must not tell the client to send directly (the stored
 * copy could still start); retrying the append with the same entry id settles it.
 */
export class SteerQueueWriteUnknownError extends Error {
  constructor(cause: unknown) {
    super('The follow-up may or may not have been queued; retry with the same id', { cause });
    this.name = 'SteerQueueWriteUnknownError';
  }
}

/**
 * Entries waiting on the surface but bound to no run — returned after a failed
 * delivery or reclaimed from a lapsed batch. The next run that drains the
 * surface takes them.
 */
const UNBOUND = '*';

// Each item is `<entry id>\t<operation it waits behind>\n<entry JSON>`, so the
// scripts can match ids and operations without parsing JSON. A drained batch is
// `<lease expiry ms>` followed by its items, each after a 0x1E separator —
// a character neither an entry id nor `JSON.stringify` output ever contains.
const encode = (entry: SteerQueueEntry, behind: string) =>
  `${entry.id}\t${behind}\n${JSON.stringify(entry)}`;

/** Lua helpers shared by the scripts below. */
const LUA_HELPERS = `
local SEP = string.char(30)
local function header(item)
  local nl = string.find(item, '\\n', 1, true)
  if not nl then return nil, nil end
  local head = string.sub(item, 1, nl - 1)
  local tab = string.find(head, '\\t', 1, true)
  if not tab then return nil, nil end
  return string.sub(head, 1, tab - 1), string.sub(head, tab + 1)
end
local function takes(item, op)
  local _, behind = header(item)
  return behind == op or behind == '${UNBOUND}'
end
local function unbind(item)
  local id = header(item)
  local nl = string.find(item, '\\n', 1, true)
  return id .. '\\t${UNBOUND}' .. string.sub(item, nl)
end
local function splitBatch(batch)
  local parts = {}
  local from = 1
  while true do
    local at = string.find(batch, SEP, from, true)
    if not at then
      table.insert(parts, string.sub(batch, from))
      break
    end
    table.insert(parts, string.sub(batch, from, at - 1))
    from = at + 1
  end
  local expiry = tonumber(table.remove(parts, 1))
  return expiry, parts
end
local function joinBatch(expiry, items)
  return tostring(expiry) .. SEP .. table.concat(items, SEP)
end
local function pushFront(qkey, items)
  if #items == 0 then return end
  for i = #items, 1, -1 do redis.call('LPUSH', qkey, unbind(items[i])) end
  -- A drain that took the whole list deleted the queue key; the push recreated
  -- it without a TTL, and an abandoned follow-up must still expire.
  redis.call('EXPIRE', qkey, ${QUEUE_TTL_SECONDS})
end
local function reclaimLapsed(qkey, pkey, now)
  local all = redis.call('HGETALL', pkey)
  for i = 1, #all, 2 do
    local expiry, items = splitBatch(all[i + 1])
    if expiry <= now then
      pushFront(qkey, items)
      redis.call('HDEL', pkey, all[i])
    end
  end
end
local function inFlight(pkey)
  local n = 0
  for _, batch in ipairs(redis.call('HVALS', pkey)) do
    local _, items = splitBatch(batch)
    n = n + #items
  end
  return n
end
`;

/**
 * Idempotent by entry id: a retried append of an id still queued answers the
 * current length, and of an id a drain already took answers -2, instead of
 * adding a copy. The bound counts entries in drained batches too.
 *
 * KEYS[1] = queue; KEYS[2] = taken ids; KEYS[3] = drained batches;
 * ARGV[1] = entry id; ARGV[2] = item; ARGV[3] = ttl; ARGV[4] = max
 */
const APPEND_SCRIPT = `${LUA_HELPERS}
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return -2 end
local items = redis.call('LRANGE', KEYS[1], 0, -1)
for _, item in ipairs(items) do
  local id = header(item)
  if id == ARGV[1] then return #items end
end
if #items + inFlight(KEYS[3]) >= tonumber(ARGV[4]) then return -1 end
local length = redis.call('RPUSH', KEYS[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return length
`;

/** KEYS[1] = queue */
const LIST_SCRIPT = `return redis.call('LRANGE', KEYS[1], 0, -1)`;

/**
 * Waiting entries and those in drained batches, read in one step so an entry
 * moving between the two is never missed. A batch whose lease lapsed goes back
 * to the queue first: nothing is delivering it any more.
 *
 * KEYS[1] = queue; KEYS[2] = drained batches; ARGV[1] = now ms.
 * Returns `{ waiting, delivering }`.
 */
const SNAPSHOT_SCRIPT = `${LUA_HELPERS}
reclaimLapsed(KEYS[1], KEYS[2], tonumber(ARGV[1]))
local delivering = {}
for _, batch in ipairs(redis.call('HVALS', KEYS[2])) do
  local _, items = splitBatch(batch)
  for _, item in ipairs(items) do table.insert(delivering, item) end
end
return { redis.call('LRANGE', KEYS[1], 0, -1), delivering }
`;

/**
 * Where one entry is, in one step — and with ARGV[2] = 'remove', takes it out
 * when it is still waiting. Returns `removed`, `queued`, `delivering` (a run
 * took it and has not settled), `taken` (delivered) or `absent`.
 *
 * A batch whose lease lapsed goes back to the queue first, as in a drain.
 *
 * KEYS[1] = queue; KEYS[2] = taken ids; KEYS[3] = drained batches;
 * ARGV[1] = id; ARGV[2] = 'remove' | 'peek'; ARGV[3] = now ms
 */
const ENTRY_STATE_SCRIPT = `${LUA_HELPERS}
reclaimLapsed(KEYS[1], KEYS[3], tonumber(ARGV[3]))
for _, item in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do
  if header(item) == ARGV[1] then
    if ARGV[2] == 'remove' then
      redis.call('LREM', KEYS[1], 1, item)
      return 'removed'
    end
    return 'queued'
  end
end
for _, batch in ipairs(redis.call('HVALS', KEYS[3])) do
  local _, items = splitBatch(batch)
  for _, item in ipairs(items) do
    if header(item) == ARGV[1] then return 'delivering' end
  end
end
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return 'taken' end
return 'absent'
`;

export type SteerQueueEntryState = 'absent' | 'delivering' | 'queued' | 'removed' | 'taken';

/**
 * Entries a run would take: queued ones it owns, plus any in a lapsed batch
 * (they go back unbound on the next drain).
 *
 * KEYS[1] = queue; KEYS[2] = drained batches; ARGV[1] = operation id; ARGV[2] = now ms
 */
const LENGTH_SCRIPT = `${LUA_HELPERS}
local count = 0
for _, item in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do
  if takes(item, ARGV[1]) then count = count + 1 end
end
for _, batch in ipairs(redis.call('HVALS', KEYS[2])) do
  local expiry, items = splitBatch(batch)
  if expiry <= tonumber(ARGV[2]) then count = count + #items end
end
return count
`;

/** KEYS[1] = queue; ARGV[1] = entry id. Returns 1 when this call removed it. */
const REMOVE_SCRIPT = `${LUA_HELPERS}
for _, item in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do
  local id = header(item)
  if id == ARGV[1] then return redis.call('LREM', KEYS[1], 1, item) end
end
return 0
`;

/**
 * Moves the entries a run owns into a drained batch under `drainId`, in one
 * step: those queued behind it, unbound ones, and those behind a run confirmed
 * ended. Entries behind any other run stay. Lapsed batches go back to the queue
 * first. Retrying with the same `drainId` returns the same batch, so a drain
 * whose response was lost can be read back. Taken ids are recorded so a retried
 * append of one is recognized.
 *
 * KEYS[1] = queue; KEYS[2] = taken ids; KEYS[3] = drained batches;
 * ARGV[1] = operation id; ARGV[2] = drain id; ARGV[3] = now ms; ARGV[4] = lease ms;
 * ARGV[5] = ttl; ARGV[6..] = runs confirmed ended
 */
const DRAIN_SCRIPT = `${LUA_HELPERS}
local now = tonumber(ARGV[3])
reclaimLapsed(KEYS[1], KEYS[3], now)
local existing = redis.call('HGET', KEYS[3], ARGV[2])
if existing then
  local _, items = splitBatch(existing)
  return items
end
local ended = {}
for i = 6, #ARGV do ended[ARGV[i]] = true end
local taken = {}
local kept = {}
for _, item in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do
  local id, behind = header(item)
  if takes(item, ARGV[1]) or (behind and ended[behind]) then
    table.insert(taken, item)
    if id then redis.call('SADD', KEYS[2], id) end
  else
    table.insert(kept, item)
  end
end
if #taken == 0 then return taken end
redis.call('HSET', KEYS[3], ARGV[2], joinBatch(now + tonumber(ARGV[4]), taken))
redis.call('EXPIRE', KEYS[3], ARGV[5])
redis.call('EXPIRE', KEYS[2], ARGV[5])
local ttl = redis.call('TTL', KEYS[1])
redis.call('DEL', KEYS[1])
if #kept > 0 then
  redis.call('RPUSH', KEYS[1], unpack(kept))
  redis.call('EXPIRE', KEYS[1], ttl > 0 and ttl or ARGV[5])
end
return taken
`;

/**
 * Settles part or all of a drained batch: the listed entries go back to the
 * head of the queue, unbound, in order; the batch keeps the rest, or is gone
 * once nothing is left. An empty list acknowledges the whole batch (delivered).
 *
 * KEYS[1] = queue; KEYS[2] = drained batches; ARGV[1] = drain id; ARGV[2] = ttl;
 * ARGV[3..] = entry ids to return
 */
const SETTLE_SCRIPT = `${LUA_HELPERS}
local batch = redis.call('HGET', KEYS[2], ARGV[1])
if not batch then return 0 end
local back = {}
for i = 3, #ARGV do back[ARGV[i]] = true end
local expiry, items = splitBatch(batch)
local returned = {}
local kept = {}
for _, item in ipairs(items) do
  local id = header(item)
  if #ARGV >= 3 and back[id] then table.insert(returned, item) else table.insert(kept, item) end
end
if #returned > 0 then
  pushFront(KEYS[1], returned)
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if #ARGV < 3 or #kept == 0 then
  redis.call('HDEL', KEYS[2], ARGV[1])
else
  redis.call('HSET', KEYS[2], ARGV[1], joinBatch(expiry, kept))
end
return #returned
`;

const keyOf = (scope: SteerQueueScope) =>
  RedisKeys.agentSteer.followUps(scope.userId, scope.topicId, scope.threadId);

const takenKeyOf = (scope: SteerQueueScope) =>
  RedisKeys.agentSteer.takenFollowUps(scope.userId, scope.topicId, scope.threadId);

const drainedKeyOf = (scope: SteerQueueScope) =>
  RedisKeys.agentSteer.drainedFollowUps(scope.userId, scope.topicId, scope.threadId);

/** The operation an item waits behind, from its header. */
const behindOf = (item: string) => {
  const head = item.slice(0, Math.max(item.indexOf('\n'), 0));
  const tab = head.indexOf('\t');
  return tab < 0 ? undefined : head.slice(tab + 1);
};

const parseEntries = <T extends SteerQueueEntry>(raw: unknown): T[] => {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item) => {
    if (typeof item !== 'string') return [];
    const nl = item.indexOf('\n');
    if (nl < 0) return [];
    try {
      return [JSON.parse(item.slice(nl + 1)) as T];
    } catch {
      return [];
    }
  });
};

/**
 * Follow-ups a user queued behind a running turn, held server-side so the
 * runtime can start the next turn without a round trip through the client.
 * Each entry is bound to the run it was queued behind, and only that run (or,
 * once returned unbound, the next run on the surface) takes it.
 *
 * Draining is two-phase: `drain` moves entries into a batch that stays in Redis
 * until `settle` acknowledges it or returns entries from it. A batch nobody
 * settles goes back to the queue when its lease lapses, so a crash, a lost
 * response or an outage between the two never loses an accepted follow-up.
 *
 * `append` returns `notStored` when it took back a write whose command failed —
 * definitely not stored, so the client sends the message itself, as it did
 * before this queue — and `undefined` without a Redis client. Redis is a
 * deployment requirement, so that is an outage, where the state is unknown.
 */
export const steerQueue = {
  /**
   * Adds an entry at the tail, waiting behind `operationId`. Retrying with an
   * entry id that is already queued is a no-op.
   *
   * @returns the queue length, `'full'` at {@link STEER_QUEUE_MAX_ENTRIES},
   * `'taken'` when a drain already took this entry id (a retry of a write that
   * landed), or `undefined` when it was not stored (no Redis, or a failed
   * command that was taken back)
   * @throws {SteerQueueWriteUnknownError} when the command failed and taking
   * the entry back did not prove it absent (the take-back failed, or found
   * nothing because a drain may already have taken it)
   */
  async append(scope: SteerQueueScope, entry: SteerQueueEntry, operationId: string) {
    const redis = await getClient();
    if (!redis) return;

    const key = keyOf(scope);
    try {
      const length = await redis.eval<number>(
        APPEND_SCRIPT,
        3,
        key,
        takenKeyOf(scope),
        drainedKeyOf(scope),
        entry.id,
        encode(entry, operationId),
        QUEUE_TTL_SECONDS,
        STEER_QUEUE_MAX_ENTRIES,
      );
      if (Number(length) === -2) return 'taken' as const;
      return Number(length) < 0 ? ('full' as const) : Number(length);
    } catch (error) {
      // A timed-out command may still have committed. Take the entry back
      // through the same client (a fresh one is behind the open circuit) so
      // "not stored" holds before the client is told to send directly.
      let removed: number;
      try {
        removed = Number(await redis.eval<number>(REMOVE_SCRIPT, 1, key, entry.id));
      } catch {
        throw new SteerQueueWriteUnknownError(error);
      }
      // Nothing to take back: the write never landed, or a drain already took
      // it and may be starting it. Only a removal proves "not stored".
      if (removed === 0) throw new SteerQueueWriteUnknownError(error);
      return 'notStored' as const;
    }
  },

  /**
   * Moves the entries `operationId` owns — queued behind it, unbound, or
   * behind one of `endedOperationIds` (runs the caller confirmed ended) — into
   * a drained batch under `drainId`, and returns them oldest first. Entries
   * behind any other run stay queued. The caller must `settle` the batch; a
   * retry with the same `drainId` reads the same batch back.
   *
   * @throws when Redis is unavailable — an outage is not an empty queue; the
   * entries stay, and a later run on the surface takes them
   */
  async drain<T extends SteerQueueEntry>(
    scope: SteerQueueScope,
    operationId: string,
    endedOperationIds: string[],
    drainId: string,
  ): Promise<T[]> {
    const redis = await getClient();
    if (!redis) throw new Error('Redis is unavailable to drain queued follow-ups');

    return parseEntries<T>(
      await redis.eval<unknown>(
        DRAIN_SCRIPT,
        3,
        keyOf(scope),
        takenKeyOf(scope),
        drainedKeyOf(scope),
        operationId,
        drainId,
        Date.now(),
        PROCESSING_LEASE_MS,
        QUEUE_TTL_SECONDS,
        ...endedOperationIds,
      ),
    );
  },

  /**
   * Settles a drained batch: `returnIds` go back to the head of the queue,
   * unbound; with none, the whole batch is acknowledged as delivered.
   *
   * @throws when Redis is unavailable — the batch then stays and goes back to
   * the queue on its own once its lease lapses
   */
  async settle(scope: SteerQueueScope, drainId: string, returnIds: string[] = []): Promise<void> {
    const redis = await getClient();
    if (!redis) throw new Error('Redis is unavailable to settle queued follow-ups');

    await redis.eval(
      SETTLE_SCRIPT,
      2,
      keyOf(scope),
      drainedKeyOf(scope),
      drainId,
      QUEUE_TTL_SECONDS,
      ...returnIds,
    );
  },

  /**
   * The runs the waiting entries are bound to (unbound ones excluded), so a
   * caller can tell which of them ended. `total` also counts entries in drained
   * batches, so a lapsed one is still drained back. Zero when nothing waits.
   *
   * @throws when Redis is unavailable, like {@link steerQueue.drain}
   */
  async boundOperations(
    scope: SteerQueueScope,
  ): Promise<{ operationIds: string[]; total: number }> {
    const redis = await getClient();
    if (!redis) throw new Error('Redis is unavailable to read queued follow-ups');

    const raw = await redis.eval<unknown>(LIST_SCRIPT, 1, keyOf(scope));
    const items = Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === 'string')
      : [];
    const operationIds = new Set<string>();
    for (const item of items) {
      const behind = behindOf(item);
      if (behind && behind !== UNBOUND) operationIds.add(behind);
    }
    const drained = Number(
      await redis.eval<number>(`${LUA_HELPERS}\nreturn inFlight(KEYS[1])`, 1, drainedKeyOf(scope)),
    );
    return { operationIds: [...operationIds], total: items.length + drained };
  },

  /** Number of entries `operationId` would take; `0` without Redis. */
  async length(scope: SteerQueueScope, operationId: string): Promise<number> {
    const redis = await getClient();
    if (!redis) return 0;

    return Number(
      await redis.eval<number>(
        LENGTH_SCRIPT,
        2,
        keyOf(scope),
        drainedKeyOf(scope),
        operationId,
        Date.now(),
      ),
    );
  },

  /** Every waiting entry on the surface, oldest first. */
  async list<T extends SteerQueueEntry>(scope: SteerQueueScope): Promise<T[]> {
    const redis = await getClient();
    if (!redis) return [];

    return parseEntries<T>(await redis.eval<unknown>(LIST_SCRIPT, 1, keyOf(scope)));
  },

  /**
   * The entries not delivered yet, read atomically: `waiting` ones, and
   * `delivering` ones a drain took that are not settled — on their way into a
   * run, or back to the queue should that fail. A lapsed batch is returned to
   * the queue first.
   *
   * @throws when Redis is unavailable — an outage is not an empty queue
   */
  async snapshot<T extends SteerQueueEntry>(
    scope: SteerQueueScope,
  ): Promise<{ delivering: T[]; waiting: T[] }> {
    const redis = await getClient();
    if (!redis) throw new Error('Redis is unavailable to read queued follow-ups');

    const raw = await redis.eval<unknown>(
      SNAPSHOT_SCRIPT,
      2,
      keyOf(scope),
      drainedKeyOf(scope),
      Date.now(),
    );
    const [waiting, delivering] = Array.isArray(raw) ? raw : [];
    return { delivering: parseEntries<T>(delivering), waiting: parseEntries<T>(waiting) };
  },

  /**
   * Where one entry is (see {@link SteerQueueEntryState}); with `remove`, takes
   * it out in the same step when it is still waiting. `undefined` without Redis:
   * then nothing about it is known.
   */
  async entryState(
    scope: SteerQueueScope,
    id: string,
    options?: { remove?: boolean },
  ): Promise<SteerQueueEntryState | undefined> {
    const redis = await getClient();
    if (!redis) return;

    return (await redis.eval<string>(
      ENTRY_STATE_SCRIPT,
      3,
      keyOf(scope),
      takenKeyOf(scope),
      drainedKeyOf(scope),
      id,
      options?.remove ? 'remove' : 'peek',
      Date.now(),
    )) as SteerQueueEntryState;
  },

  /**
   * Removes one entry by id.
   *
   * @returns `true` when this call removed it — `false` when it was never
   * there or a drain already took it
   */
  async remove(scope: SteerQueueScope, id: string): Promise<boolean> {
    const redis = await getClient();
    if (!redis) return false;

    return Number(await redis.eval<number>(REMOVE_SCRIPT, 1, keyOf(scope), id)) > 0;
  },
};
