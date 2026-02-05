import { appEnv } from '@/envs/app';

import { LocalQueueServiceImpl } from './local';
import { QStashQueueServiceImpl } from './qstash';
import type {QueueServiceImpl} from './type';

/**
 * Check if queue-based agent runtime is enabled
 * Set via AGENT_RUNTIME_MODE=queue environment variable
 */
export const isQueueAgentRuntimeEnabled = (): boolean => {
  return appEnv.enableQueueAgentRuntime === true;
};

/**
 * Create queue service module
 *
 * When enableQueueAgentRuntime=true (AGENT_RUNTIME_MODE=queue):
 *   - QStashQueueServiceImpl (production, requires QSTASH_TOKEN)
 *
 * When enableQueueAgentRuntime=false (default):
 *   - LocalQueueServiceImpl (local development, uses setTimeout for async execution)
 */
export const createQueueServiceModule = (): QueueServiceImpl => {
  if (isQueueAgentRuntimeEnabled()) {
    const qstashToken = process.env.QSTASH_TOKEN;

    if (!qstashToken) {
      throw new Error('QSTASH_TOKEN is required when AGENT_RUNTIME_MODE=queue');
    }
    return new QStashQueueServiceImpl({ qstashToken });
  }

  // Local mode (default): use LocalQueueServiceImpl with callback mechanism
  return new LocalQueueServiceImpl();
};

export { LocalQueueServiceImpl } from './local';
export type { QueueServiceImpl } from './type';
