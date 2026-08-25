import { Queue } from 'bullmq';

import { getRedisConfig } from '@/envs/redis';

const BULLMQ_PREFIX = process.env.MEMORY_WORKFLOW_BULLMQ_PREFIX ?? 'bull';

/**
 * Default job options applied to all queues.
 *
 * - attempts: 3 with exponential backoff — handles transient Redis/DB failures
 * - removeOnComplete: keep last 100 completed jobs, expire after 1 day
 * - removeOnFail: keep last 50 failed jobs, expire after 7 days
 */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { delay: 1000, factor: 2, type: 'exponential' as const },
  removeOnComplete: { age: 86_400, count: 100 },
  removeOnFail: { age: 604_800, count: 50 },
};

/**
 * Parses a Redis URL into ioredis connection options.
 *
 * BullMQ passes options to ioredis, which does not recognize a `url` property
 * in the object form. We parse the URL to extract host, port, and credentials.
 */
const parseRedisUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const connection: Record<string, unknown> = {
      db: 0,
      host: parsed.hostname || '127.0.0.1',
      port: Number(parsed.port) || 6379,
    };

    if (parsed.password) {
      connection.password = decodeURIComponent(parsed.password);
    }

    if (parsed.username && parsed.username !== 'default') {
      connection.username = decodeURIComponent(parsed.username);
    }

    if (parsed.pathname && parsed.pathname !== '/') {
      const db = parseInt(parsed.pathname.slice(1), 10);
      if (!Number.isNaN(db)) connection.db = db;
    }

    return connection;
  } catch {
    // If URL parsing fails, let ioredis try to handle it
    return { url };
  }
};

/**
 * Builds the BullMQ Redis connection options from the existing LobeHub Redis config.
 *
 * BullMQ uses ioredis internally (already a project dependency). This shares
 * the same Redis instance but creates separate connection pools — BullMQ needs
 * blocking connections for workers that the shared IoRedisRedisProvider doesn't provide.
 */
const getBullMQConnection = () => {
  const config = getRedisConfig();

  if (!config.url) {
    throw new Error(
      'REDIS_URL is required for BullMQ memory workflow. Set REDIS_URL or use MEMORY_WORKFLOW_MODE=local instead.',
    );
  }

  const connection = parseRedisUrl(config.url);

  if (config.tls) {
    connection.tls = {};
  }

  return connection;
};

/**
 * Lazy-initialized queue instances. Created once on first access to avoid
 * establishing Redis connections during import time (which would break tests
 * and non-BullMQ modes).
 */
let _queues: ReturnType<typeof createQueues> | null = null;

const createQueues = () => {
  const connection = getBullMQConnection();
  const prefix = BULLMQ_PREFIX;

  return {
    hourly: new Queue('memory-hourly', { connection, prefix }),
    personaUpdate: new Queue('memory-persona-update', { connection, prefix }),
    processTopic: new Queue('memory-process-topic', { connection, prefix }),
    processTopics: new Queue('memory-process-topics', { connection, prefix }),
    processUsers: new Queue('memory-process-users', { connection, prefix }),
    userTopics: new Queue('memory-user-topics', { connection, prefix }),
  } as const;
};

/**
 * Returns the BullMQ queue instances, creating them on first call.
 *
 * Queues are:
 * - `memory-hourly` — hourly cron entry point (concurrency: 1)
 * - `memory-process-users` — user batch fan-out (concurrency: 1)
 * - `memory-user-topics` — per-user topic discovery (concurrency: 25)
 * - `memory-process-topics` — topic batch fan-out (concurrency: 20)
 * - `memory-process-topic` — per-topic extraction (concurrency: 5 per user)
 * - `memory-persona-update` — persona composition (concurrency: 1 per user)
 */
export const getQueues = () => {
  if (!_queues) {
    _queues = createQueues();
  }
  return _queues;
};

/**
 * Default job options for BullMQ producers. Callers should spread these
 * into their `add()` calls to get retry and cleanup behavior.
 */
export { DEFAULT_JOB_OPTIONS };

/**
 * Closes all queue instances. Call during graceful shutdown.
 */
export const closeQueues = async () => {
  if (_queues) {
    await Promise.all(Object.values(_queues).map((q) => q.close()));
    _queues = null;
  }
};
