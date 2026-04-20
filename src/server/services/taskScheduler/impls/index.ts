import { appEnv } from '@/envs/app';

import { LocalTaskScheduler } from './local';
import type { TaskSchedulerImpl } from './type';

// QStash implementation will be added later
// import { QStashTaskScheduler } from './qstash';

/**
 * Create task scheduler module
 *
 * When AGENT_RUNTIME_MODE=queue: QStash (production)
 * When default: Local (setTimeout-based)
 */
export const createTaskSchedulerModule = (): TaskSchedulerImpl => {
  if (appEnv.enableQueueAgentRuntime) {
    // TODO: QStash implementation
    // return new QStashTaskScheduler({ qstashToken });
  }

  return new LocalTaskScheduler();
};

export { LocalTaskScheduler } from './local';
export type { TaskSchedulerImpl } from './type';
