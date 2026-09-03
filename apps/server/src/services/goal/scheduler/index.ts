import debug from 'debug';

import { createGoalSchedulerModule, type ScheduleGoalAdvanceParams } from './impls';

const log = debug('goal-scheduler');

/**
 * Ask the coordinator to advance a goal, without waiting for it.
 *
 * Every caller is a place where a goal *might* now be able to move — it was
 * created, a gate was resolved, a budget was raised, a graph Task settled. None
 * of them should fail because the advance could not be queued, and none of them
 * should block on it: the handler re-reads the goal, and the sweep picks up
 * anything a lost message would have stranded.
 */
export const scheduleGoalAdvance = async (params: ScheduleGoalAdvanceParams): Promise<void> => {
  try {
    await createGoalSchedulerModule().scheduleAdvance(params);
    log('queued advance for goal %s', params.goalId);
  } catch (error) {
    // Loud on purpose: this is the only thing that makes a goal move on its
    // own, so a broken dispatch must be visible in the logs rather than left to
    // be inferred from goals that quietly stop progressing. The sweep still
    // covers the goal, which is why this stays non-fatal for the caller.
    console.error('[goal/scheduler] failed to queue advance for %s:', params.goalId, error);
  }
};

export type { GoalSchedulerImpl, ScheduleGoalAdvanceParams } from './impls';
export { createGoalSchedulerModule, GOAL_ADVANCE_PATH } from './impls';
