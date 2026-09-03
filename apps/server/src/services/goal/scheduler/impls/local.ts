import debug from 'debug';

import { advanceGoal } from '../../advanceGoal';
import type { GoalSchedulerImpl, ScheduleGoalAdvanceParams } from './type';

const log = debug('goal-scheduler:local');

/**
 * Dev / desktop scheduler: a `setTimeout` in this process instead of a queue
 * message. It calls the same runner the HTTP handler calls, so local runs
 * exercise the real advance path rather than a stub.
 */
export class LocalGoalScheduler implements GoalSchedulerImpl {
  private pending = new Map<string, NodeJS.Timeout>();

  async scheduleAdvance(params: ScheduleGoalAdvanceParams): Promise<string> {
    const { delay = 0, goalId, trigger, userId, workspaceId } = params;
    const scheduleId = `local-goal-${goalId}-${Date.now()}`;

    log('scheduling advance for goal %s (delay: %ds)', goalId, delay);
    const timer = setTimeout(async () => {
      this.pending.delete(scheduleId);
      try {
        await advanceGoal({ goalId, trigger, userId, workspaceId });
      } catch (error) {
        // Never surface: an advance is best-effort, and the sweep retries.
        log('advance failed for goal %s: %O', goalId, error);
      }
    }, delay * 1000);

    this.pending.set(scheduleId, timer);
    return scheduleId;
  }
}
