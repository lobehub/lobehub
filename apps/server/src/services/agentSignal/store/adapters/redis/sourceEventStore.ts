import { AGENT_SIGNAL_KEYS } from '../../../constants';
import type { AgentSignalSourceEventStore } from '../../types';
import { getRedisClient, readHash, trySetNx, writeHash } from './shared';

/** Accepts one source-event id once within the configured TTL window. */
export const tryDedupe = async (eventId: string, ttlSeconds: number) => {
  return trySetNx(AGENT_SIGNAL_KEYS.dedupe(eventId), ttlSeconds);
};

/** Reads one persisted source-event window snapshot. */
export const readWindow = async (scopeKey: string) => {
  return readHash(AGENT_SIGNAL_KEYS.window(scopeKey));
};

/** Writes one persisted source-event window snapshot. */
export const writeWindow = async (
  scopeKey: string,
  data: Record<string, string>,
  ttlSeconds: number,
) => {
  await writeHash(AGENT_SIGNAL_KEYS.window(scopeKey), data, ttlSeconds);
};

/** Acquires the short-lived source-generation lock for one scope. */
export const acquireScopeLock = async (scopeKey: string, ttlSeconds: number) => {
  return trySetNx(AGENT_SIGNAL_KEYS.lock(scopeKey), ttlSeconds);
};

/** Releases the short-lived source-generation lock for one scope. */
export const releaseScopeLock = async (scopeKey: string) => {
  const redis = getRedisClient();
  if (!redis) return;

  await redis.del(AGENT_SIGNAL_KEYS.lock(scopeKey));
};

/** Redis-backed source-event store used by generation. */
export const redisSourceEventStore: AgentSignalSourceEventStore = {
  acquireScopeLock,
  readWindow,
  releaseScopeLock,
  tryDedupe,
  writeWindow,
};
