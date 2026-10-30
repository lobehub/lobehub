import type { TaskStatus } from '@lobechat/types';

/**
 * Arms the run-count window for a schedule write that does not pass through
 * `updateStatus` (T-634).
 *
 * `setTaskSchedule` (agent tool) and REST/SDK patches land in `task.update`
 * without a status, so a backlog task configured this way keeps its status and
 * never reaches the stamping branch inside the status-transition path — the
 * dispatcher then evaluates the task with `armedAt = null`, and a cron slot
 * inside the dispatch grace window fires immediately, consuming a one-shot
 * `maxExecutions` quota before the user ever intended the schedule to go live
 * (vent T-634, David Tai 2026-09-14 / Rex 2026-10-07 / Leon Kwan 2026-10-10).
 *
 * Returns the `context` pocket to persist **in the same atomic write** that
 * makes the schedule dispatchable. The caller must merge this into the row
 * update rather than writing it separately — a stamp landing after the pattern
 * column commit would leave a window where the dispatcher sees an unstamped
 * dispatchable row and replays a grace-window occurrence.
 *
 * Stamps when the resulting task is dispatchable (schedule mode with a cron
 * pattern, not terminal/paused/running) and the task has no stamp yet. A
 * `scheduled` row is dispatched too (`getScheduledTasks` only excludes
 * terminal/paused/running), so it must be stamped here as well: a heartbeat
 * task switched to cron keeps status `scheduled` and never passes the
 * `updateStatus` stamping branch. Re-arming must not reset an existing quota
 * window — the `scheduleStartedAt` check below guards that — and the
 * `updateStatus` path keeps its own stamping, so the two must not double-stamp
 * on a transition that carries schedule columns.
 */
export const armScheduleOnColumnWrite = (task: {
  automationMode: string | null;
  context?: unknown;
  schedulePattern: string | null;
  status: TaskStatus | string;
}): { context?: Record<string, unknown> } => {
  // Without a cron pattern the dispatcher never picks the task up, so it is
  // not live and must not look armed.
  if (task.automationMode !== 'schedule' || !task.schedulePattern) return {};

  const status = task.status;
  if (
    status === 'running' ||
    status === 'paused' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'canceled'
  ) {
    return {};
  }

  const context = (task.context as Record<string, unknown> | null) ?? {};
  const scheduler = (context.scheduler as { scheduleStartedAt?: string } | null) ?? {};
  if (scheduler.scheduleStartedAt) return {};

  return {
    context: {
      ...context,
      scheduler: { ...scheduler, scheduleStartedAt: new Date().toISOString() },
    },
  };
};
