import type { TaskContext, TaskStatus } from '@lobechat/types';

/**
 * Arms a task created directly in schedule mode, matching what starting a
 * schedule through `updateStatus(…, 'scheduled')` does.
 *
 * The dispatcher fires any non-terminal schedule-mode task, so a task created
 * with `automationMode: 'schedule'` is live from its first insert. Creating it
 * as `scheduled` keeps the UI's run/pause controls truthful, and stamping
 * `context.scheduler.scheduleStartedAt` opens the window `maxExecutions`
 * counts against and keeps the dispatcher from replaying an occurrence from
 * before the task existed.
 */
export const armScheduleOnCreate = (
  input: {
    automationMode?: 'heartbeat' | 'schedule';
    context?: TaskContext;
    schedulePattern?: string;
  },
  now: Date = new Date(),
): { context?: TaskContext; status?: TaskStatus } => {
  // Without a cron pattern the dispatcher never picks the task up, so it is
  // not live and must not look armed.
  if (input.automationMode !== 'schedule' || !input.schedulePattern) return {};

  return {
    context: {
      ...input.context,
      scheduler: { ...input.context?.scheduler, scheduleStartedAt: now.toISOString() },
    },
    status: 'scheduled',
  };
};
