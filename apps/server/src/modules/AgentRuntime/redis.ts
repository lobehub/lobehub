import debug from 'debug';
import Redis, { type RedisOptions } from 'ioredis';

import { redisEnv } from '@/envs/redis';
import { isRedisDisabledByEnv } from '@/server/modules/Redis';

const log = debug('lobe-server:agent-runtime:redis');
const timing = debug('lobe-server:agent-runtime:timing');

/**
 * Get Redis URL from environment
 */
const getRedisUrl = (): string | undefined => {
  return redisEnv.REDIS_URL;
};

/**
 * Get Redis connection description for logging (hide sensitive parts)
 */
const getRedisConnectionDescription = (url: string): string => {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'redis://***';
  }
};

/**
 * Connection options from the shared Redis env, applied the way the main
 * provider (`IoRedisRedisProvider`) applies them. ioredis lets values already
 * in the URL win, so `redis://user:pass@host/1` keeps working.
 */
const getRedisEnvConnectionOptions = (): RedisOptions => ({
  db: redisEnv.REDIS_DATABASE,
  password: redisEnv.REDIS_PASSWORD,
  tls: redisEnv.REDIS_TLS ? {} : undefined,
  username: redisEnv.REDIS_USERNAME,
});

/**
 * Create Redis client instance for Agent Runtime.
 *
 * Without an explicit `url` the client targets the env-configured server and
 * also uses its credentials/db/TLS. An explicit `url` is self-contained: the
 * env credentials belong to the env server and are not sent to another host.
 */
export const createAgentRuntimeRedisClient = (url?: string): Redis | null => {
  if (isRedisDisabledByEnv()) return null;

  const redisUrl = url || getRedisUrl();

  if (!redisUrl) {
    console.warn(
      '[Agent Runtime Redis] No Redis URL available. Agent Runtime features are disabled.',
    );
    return null;
  }

  const createStart = Date.now();
  timing('Redis client creating at %d', createStart);

  const client = new Redis(redisUrl, {
    ...(url ? {} : getRedisEnvConnectionOptions()),
    maxRetriesPerRequest: 3,
  });

  client.on('connect', () => {
    const connectTime = Date.now();
    log('Connected to Redis: %s', getRedisConnectionDescription(redisUrl));
    timing(
      'Redis connected at %d, took %dms from creation',
      connectTime,
      connectTime - createStart,
    );
  });

  client.on('ready', () => {
    const readyTime = Date.now();
    timing('Redis ready at %d, took %dms from creation', readyTime, readyTime - createStart);
  });

  client.on('error', (error) => {
    console.error('[Agent Runtime Redis] Redis connection error:', error);
  });

  client.on('close', () => {
    log('Redis connection closed');
  });

  return client;
};

/**
 * Global Redis client instance for Agent Runtime (singleton pattern)
 */
let globalAgentRuntimeRedisClient: Redis | null = null;
let redisInitialized = false;

/**
 * Get global Redis client instance for Agent Runtime
 */
export function getAgentRuntimeRedisClient(): Redis | null {
  if (!redisInitialized) {
    timing('Redis client not initialized, creating new instance at %d', Date.now());
    globalAgentRuntimeRedisClient = createAgentRuntimeRedisClient();
    redisInitialized = true;
  } else {
    timing('Redis client already initialized, reusing at %d', Date.now());
  }
  return globalAgentRuntimeRedisClient;
}

/**
 * Close global Redis client connection
 */
export async function closeAgentRuntimeRedisClient(): Promise<void> {
  if (globalAgentRuntimeRedisClient) {
    await globalAgentRuntimeRedisClient.quit();
    globalAgentRuntimeRedisClient = null;
    redisInitialized = false;
  }
}
