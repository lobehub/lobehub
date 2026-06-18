import { appEnv } from '@/envs/app';
import { qstashClient } from '@/libs/qstash';

import { LocalTaskScheduler, type TaskExecutionCallback } from './local';
import { QStashTaskScheduler } from './qstash';
import type { TaskSchedulerImpl } from './type';

let cachedScheduler: TaskSchedulerImpl | null = null;
let cachedExecutionCallback: TaskExecutionCallback | null = null;

/**
 * Get (or lazily create) the singleton task scheduler.
 *
 * - `AGENT_RUNTIME_MODE=queue`: QStash (production)
 * - default: Local (setTimeout-based, dev / electron)
 *
 * Singleton because `LocalTaskScheduler` holds in-memory `setTimeout` state and
 * a per-request instance would orphan pending timers on the next request.
 */
export const createTaskSchedulerModule = (): TaskSchedulerImpl => {
  if (cachedScheduler) return cachedScheduler;

  if (appEnv.enableQueueAgentRuntime) {
    const baseUrl = process.env.APP_URL;
    if (!baseUrl) {
      throw new Error('APP_URL is required to schedule heartbeat ticks via QStash');
    }
    cachedScheduler = new QStashTaskScheduler({ baseUrl, qstashClient });
    return cachedScheduler;
  }

  const local = new LocalTaskScheduler();
  if (cachedExecutionCallback) local.setExecutionCallback(cachedExecutionCallback);
  cachedScheduler = local;

  // Lazy-load the heartbeat tick runner so it registers its own callback via
  // `setTaskSchedulerExecutionCallback`. Dynamic import avoids the import
  // cycle (heartbeatTick → TaskRunnerService → TaskLifecycleService →
  // createTaskSchedulerModule). Heartbeat ticks always fire after `delay`
  // seconds, so the dynamic import resolves long before the first tick.
  if (!cachedExecutionCallback) {
    void import('@/server/services/taskRunner/heartbeatTick').catch((e) => {
      console.warn('[taskScheduler] failed to load heartbeat tick runner:', e);
    });
  }

  return cachedScheduler;
};

/**
 * Register the in-process callback the LocalTaskScheduler invokes on tick.
 * Cloud (QStash) mode ignores this — its callback is the HTTP `/heartbeat-tick`
 * handler. Calling this after a Local scheduler is already created retroactively
 * wires the callback in.
 */
export const setTaskSchedulerExecutionCallback = (callback: TaskExecutionCallback): void => {
  cachedExecutionCallback = callback;
  if (cachedScheduler instanceof LocalTaskScheduler) {
    cachedScheduler.setExecutionCallback(callback);
  }
};

export { LocalTaskScheduler } from './local';
export { QStashTaskScheduler } from './qstash';
export type { TaskSchedulerImpl } from './type';
