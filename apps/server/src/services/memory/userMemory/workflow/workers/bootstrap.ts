import { Worker } from 'bullmq';
import debug from 'debug';

import { getRedisConfig } from '@/envs/redis';

import { hourlyProcessor } from './processors/hourly';
import { personaUpdateProcessor } from './processors/personaUpdate';
import { processTopicProcessor } from './processors/processTopic';
import { processTopicsProcessor } from './processors/processTopics';
import { processUsersProcessor } from './processors/processUsers';
import { processUserTopicsProcessor } from './processors/processUserTopics';
import { closeQueues } from './queues';

const log = debug('lobe-server:memory-workers');

const BULLMQ_PREFIX = process.env.MEMORY_WORKFLOW_BULLMQ_PREFIX ?? 'bull';

let workers: Worker[] = [];

/**
 * Starts BullMQ workers for the memory extraction pipeline.
 *
 * Each worker corresponds to one queue in the pipeline hierarchy:
 * - hourly → process-users → user-topics → process-topics → process-topic → persona-update
 *
 * Concurrency and rate limiting match the QStash flowControl settings.
 *
 * Call once during server startup when MEMORY_WORKFLOW_MODE=local-queue.
 */
export const startMemoryWorkers = () => {
  if (workers.length > 0) {
    log('Memory workers already running, skipping start');
    return workers;
  }

  const config = getRedisConfig();
  if (!config.url) {
    throw new Error('REDIS_URL is required for BullMQ memory workers');
  }

  const connection: Record<string, unknown> = {
    db: config.database ?? 0,
    url: config.url,
  };

  if (config.password) connection.password = config.password;
  if (config.username) connection.username = config.username;
  if (config.tls) connection.tls = {};

  const prefix = BULLMQ_PREFIX;

  workers = [
    new Worker('memory-hourly', hourlyProcessor, {
      connection,
      concurrency: 1,
      prefix,
    }),
    new Worker('memory-process-users', processUsersProcessor, {
      connection,
      concurrency: 1,
      prefix,
    }),
    new Worker('memory-user-topics', processUserTopicsProcessor, {
      connection,
      concurrency: 25,
      prefix,
    }),
    new Worker('memory-process-topics', processTopicsProcessor, {
      connection,
      concurrency: 20,
      prefix,
    }),
    new Worker('memory-process-topic', processTopicProcessor, {
      connection,
      concurrency: 25,
      prefix,
    }),
    new Worker('memory-persona-update', personaUpdateProcessor, {
      connection,
      concurrency: 4,
      prefix,
    }),
  ];

  for (const worker of workers) {
    worker.on('completed', (job) => {
      log('Completed: %s:%s', job.queueName, job.id);
    });

    worker.on('failed', (job, err) => {
      console.error(`[memory-worker] ${job?.queueName}:${job?.id} failed:`, err.message);
    });

    worker.on('stalled', (jobId) => {
      console.warn(`[memory-worker] stalled: ${jobId}`);
    });

    worker.on('error', (err) => {
      console.error(`[memory-worker] ${worker.name} error:`, err.message);
    });
  }

  log('Started %d memory workers', workers.length);
  return workers;
};

/**
 * Gracefully shuts down all memory workers and closes queues.
 *
 * Call during server shutdown (SIGTERM, SIGINT).
 */
export const stopMemoryWorkers = async () => {
  if (workers.length === 0) return;

  log('Stopping %d memory workers...', workers.length);

  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();

  workers = [];
  log('Memory workers stopped');
};
