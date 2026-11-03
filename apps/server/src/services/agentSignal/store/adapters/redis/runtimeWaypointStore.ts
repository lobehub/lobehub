import { AGENT_SIGNAL_DEFAULTS, AGENT_SIGNAL_KEYS } from '../../../constants';
import type {
  AgentSignalRuntimeBackendStore,
  RuntimeCompletionInput,
  RuntimeFailureInput,
  RuntimeNextHop,
  RuntimePendingClaim,
  RuntimeWaypoint,
} from '../../../runtime/backend/types';
import {
  closeCasRedisClient,
  getCasRedisClient,
  getRedisClient,
  parseJsonField,
  readHash,
  readHashFrom,
} from './shared';

/**
 * Compare-and-set retries for waypoint hash transitions.
 *
 * The runtime only needs a lightweight guard against stale `claim` / `complete` / `fail`
 * writes here. If contention remains after these retries, the caller can try again later.
 */
const WAYPOINT_MUTATION_MAX_RETRIES = 5;

const parseWaypointEvents = (entries: string[]): RuntimeWaypoint['events'] => {
  return entries.map((entry) => JSON.parse(entry) as RuntimeWaypoint['events'][number]);
};

const toWaypoint = (
  scopeKey: string,
  value: Record<string, string> | undefined,
  eventEntries: string[],
): RuntimeWaypoint => {
  if (!value && eventEntries.length === 0) {
    return {
      events: [],
      scopeKey,
    };
  }

  return {
    events: parseWaypointEvents(eventEntries),
    nextHop: parseJsonField<NonNullable<RuntimeWaypoint['nextHop']>>(value?.nextHop),
    pending: parseJsonField<RuntimePendingClaim>(value?.pending),
    scopeKey: value?.scopeKey ?? scopeKey,
    terminal: parseJsonField<NonNullable<RuntimeWaypoint['terminal']>>(value?.terminal),
  };
};

const getWaypointKey = (scopeKey: string) => AGENT_SIGNAL_KEYS.waypoint(scopeKey);
const getWaypointEventsKey = (scopeKey: string) => AGENT_SIGNAL_KEYS.waypointEvents(scopeKey);

const readWaypointRecord = async (scopeKey: string) => {
  const redis = getRedisClient();
  if (!redis) {
    return {
      events: [],
      scopeKey,
    };
  }

  const [hash, eventEntries] = await Promise.all([
    readHash(getWaypointKey(scopeKey)),
    redis.lrange(getWaypointEventsKey(scopeKey), 0, -1),
  ]);

  return toWaypoint(scopeKey, hash, eventEntries);
};

const findNextPendingSource = (waypoint: RuntimeWaypoint) => {
  if (waypoint.pending) {
    return waypoint.pending.source;
  }

  if (!waypoint.terminal) {
    return waypoint.events[0];
  }

  const terminalIndex = waypoint.events.findIndex(
    (event) => event.sourceId === waypoint.terminal?.sourceId,
  );

  if (terminalIndex === -1) {
    return waypoint.events[0];
  }

  return waypoint.events[terminalIndex + 1];
};

/** Appends one source to the durable waypoint for a scope. */
export const append = async (scopeKey: string, source: RuntimePendingClaim['source']) => {
  const redis = getRedisClient();
  if (!redis) return;

  const waypointKey = getWaypointKey(scopeKey);
  const waypointEventsKey = getWaypointEventsKey(scopeKey);

  await redis
    .multi()
    .rpush(waypointEventsKey, JSON.stringify(source))
    .hset(waypointKey, { scopeKey })
    .expire(waypointEventsKey, AGENT_SIGNAL_DEFAULTS.runtimeWaypointTtlSeconds)
    .expire(waypointKey, AGENT_SIGNAL_DEFAULTS.runtimeWaypointTtlSeconds)
    .exec();
};

/** Claims the next unprocessed source for one scope. */
export const claim = async (scopeKey: string): Promise<RuntimePendingClaim | null> => {
  const redis = getCasRedisClient();
  if (!redis) return null;

  const waypointKey = getWaypointKey(scopeKey);
  const waypointEventsKey = getWaypointEventsKey(scopeKey);

  try {
    for (let attempt = 0; attempt < WAYPOINT_MUTATION_MAX_RETRIES; attempt++) {
      await redis.watch(waypointKey, waypointEventsKey);

      const [hash, eventEntries] = await Promise.all([
        readHashFrom(redis, waypointKey),
        redis.lrange(waypointEventsKey, 0, -1),
      ]);
      const waypoint = toWaypoint(scopeKey, hash, eventEntries);
      const source = findNextPendingSource(waypoint);

      if (!source) {
        await redis.unwatch();
        return null;
      }

      const pending = {
        scopeKey,
        source,
        status: 'pending',
      } as const;
      const result = await redis
        .multi()
        .hset(waypointKey, {
          pending: JSON.stringify(pending),
          scopeKey,
        })
        .expire(waypointEventsKey, AGENT_SIGNAL_DEFAULTS.runtimeWaypointTtlSeconds)
        .expire(waypointKey, AGENT_SIGNAL_DEFAULTS.runtimeWaypointTtlSeconds)
        .exec();

      if (result) {
        return pending;
      }
    }

    throw new Error(`Failed to claim waypoint for scope "${scopeKey}" after retrying`);
  } finally {
    await closeCasRedisClient(redis);
  }
};

/** Marks one claimed source as completed. */
export const complete = async (input: RuntimeCompletionInput) => {
  const redis = getCasRedisClient();
  if (!redis) return;

  const waypointKey = getWaypointKey(input.scopeKey);
  const waypointEventsKey = getWaypointEventsKey(input.scopeKey);

  try {
    for (let attempt = 0; attempt < WAYPOINT_MUTATION_MAX_RETRIES; attempt++) {
      await redis.watch(waypointKey);

      const hash = await readHashFrom(redis, waypointKey);
      const pending = parseJsonField<RuntimePendingClaim>(hash?.pending);

      if (pending?.source.sourceId !== input.sourceId) {
        await redis.unwatch();
        return;
      }

      const result = await redis
        .multi()
        .hdel(waypointKey, 'pending')
        .hset(waypointKey, {
          scopeKey: input.scopeKey,
          terminal: JSON.stringify({
            completedAt: input.completedAt,
            sourceId: input.sourceId,
            status: 'completed',
          }),
        })
        .expire(waypointEventsKey, AGENT_SIGNAL_DEFAULTS.runtimeWaypointTtlSeconds)
        .expire(waypointKey, AGENT_SIGNAL_DEFAULTS.runtimeWaypointTtlSeconds)
        .exec();

      if (result) {
        return;
      }
    }

    throw new Error(`Failed to complete waypoint for scope "${input.scopeKey}" after retrying`);
  } finally {
    await closeCasRedisClient(redis);
  }
};

/** Marks one claimed source as failed. */
export const fail = async (input: RuntimeFailureInput) => {
  const redis = getCasRedisClient();
  if (!redis) return;

  const waypointKey = getWaypointKey(input.scopeKey);
  const waypointEventsKey = getWaypointEventsKey(input.scopeKey);

  try {
    for (let attempt = 0; attempt < WAYPOINT_MUTATION_MAX_RETRIES; attempt++) {
      await redis.watch(waypointKey);

      const hash = await readHashFrom(redis, waypointKey);
      const pending = parseJsonField<RuntimePendingClaim>(hash?.pending);

      if (pending?.source.sourceId !== input.sourceId) {
        await redis.unwatch();
        return;
      }

      const result = await redis
        .multi()
        .hdel(waypointKey, 'pending')
        .hset(waypointKey, {
          scopeKey: input.scopeKey,
          terminal: JSON.stringify({
            error: input.error,
            failedAt: input.failedAt,
            sourceId: input.sourceId,
            status: 'failed',
          }),
        })
        .expire(waypointEventsKey, AGENT_SIGNAL_DEFAULTS.runtimeWaypointTtlSeconds)
        .expire(waypointKey, AGENT_SIGNAL_DEFAULTS.runtimeWaypointTtlSeconds)
        .exec();

      if (result) {
        return;
      }
    }

    throw new Error(`Failed to fail waypoint for scope "${input.scopeKey}" after retrying`);
  } finally {
    await closeCasRedisClient(redis);
  }
};

/** Loads the durable waypoint snapshot for one scope. */
export const load = async (scopeKey: string): Promise<RuntimeWaypoint> => {
  return readWaypointRecord(scopeKey);
};

/** Persists the next workflow-driven wake-up for one scope. */
export const schedule = async (input: RuntimeNextHop) => {
  const redis = getRedisClient();
  if (!redis) return;

  const waypointKey = getWaypointKey(input.scopeKey);
  const waypointEventsKey = getWaypointEventsKey(input.scopeKey);

  await redis
    .multi()
    .hset(waypointKey, {
      nextHop: JSON.stringify(input),
      scopeKey: input.scopeKey,
    })
    .expire(waypointEventsKey, AGENT_SIGNAL_DEFAULTS.runtimeWaypointTtlSeconds)
    .expire(waypointKey, AGENT_SIGNAL_DEFAULTS.runtimeWaypointTtlSeconds)
    .exec();
};

/** Redis-backed waypoint store used by workflow-backed runtime adapters. */
export const redisRuntimeWaypointStore: AgentSignalRuntimeBackendStore = {
  append,
  claim,
  complete,
  fail,
  load,
  schedule,
};
