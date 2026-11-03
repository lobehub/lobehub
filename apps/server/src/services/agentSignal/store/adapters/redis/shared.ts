import type Redis from 'ioredis';

import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

interface AgentSignalRedisGlobal {
  __agentSignalRedisClient?: Redis | null;
}

export type HashPayload = Record<string, string>;

export const getRedisClient = (): Redis | null => {
  const testRedis = (globalThis as AgentSignalRedisGlobal).__agentSignalRedisClient;
  if (testRedis !== undefined) return testRedis;

  return getAgentRuntimeRedisClient();
};

export const readHashFrom = async (
  redis: Pick<Redis, 'hgetall'> | null,
  key: string,
): Promise<HashPayload | undefined> => {
  if (!redis) return undefined;

  const value = await redis.hgetall(key);
  if (!value || Object.keys(value).length === 0) return undefined;

  return value;
};

export const readHash = async (key: string): Promise<HashPayload | undefined> => {
  return readHashFrom(getRedisClient(), key);
};

export const getCasRedisClient = (): Redis | null => {
  const redis = getRedisClient();
  if (!redis) return null;

  return redis.duplicate();
};

export const closeCasRedisClient = async (redis: Pick<Redis, 'quit'> | null) => {
  if (!redis) return;

  await redis.quit();
};

export const writeHash = async (
  key: string,
  data: HashPayload,
  ttlSeconds: number,
): Promise<void> => {
  const redis = getRedisClient();
  if (!redis) return;
  if (Object.keys(data).length === 0) return;

  await redis.hset(key, data);
  await redis.expire(key, ttlSeconds);
};

export const trySetNx = async (key: string, ttlSeconds: number): Promise<boolean> => {
  const redis = getRedisClient();
  if (!redis) return false;

  const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
};

export const parseJsonField = <T>(value?: string): T | undefined => {
  if (!value) return undefined;

  return JSON.parse(value) as T;
};
