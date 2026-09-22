import { appEnv } from '@/envs/app';
import { qstashClient } from '@/libs/qstash';

import { LocalGoalScheduler } from './local';
import { QStashGoalScheduler } from './qstash';
import type { GoalSchedulerImpl } from './type';

let cached: GoalSchedulerImpl | null = null;

/**
 * The singleton goal scheduler.
 *
 * - `AGENT_RUNTIME_MODE=queue`: QStash (production)
 * - otherwise: in-process timers (dev / desktop)
 *
 * Singleton because the local implementation holds pending timers; a
 * per-request instance would orphan them.
 */
export const createGoalSchedulerModule = (): GoalSchedulerImpl => {
  if (cached) return cached;

  if (appEnv.enableQueueAgentRuntime) {
    const baseUrl = process.env.APP_URL;
    if (!baseUrl) throw new Error('APP_URL is required to schedule goal advances via QStash');
    cached = new QStashGoalScheduler({ baseUrl, qstashClient });
    return cached;
  }

  cached = new LocalGoalScheduler();
  return cached;
};

export { LocalGoalScheduler } from './local';
export { GOAL_ADVANCE_PATH } from './qstash';
export { QStashGoalScheduler } from './qstash';
export type { GoalSchedulerImpl, ScheduleGoalAdvanceParams } from './type';
