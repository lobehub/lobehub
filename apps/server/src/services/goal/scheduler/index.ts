import debug from 'debug';

import { createGoalSchedulerModule, type ScheduleGoalAdvanceParams } from './impls';

const log = debug('goal-scheduler');

/**
 * Ask the coordinator to advance a goal, without waiting for it.
 *
 * Every caller is a place where a goal *might* now be able to move — it was
 * created, a gate was resolved, a budget was raised, a Work Task settled. None
 * of them should fail because the advance could not be queued, and none of them
 * should block on it: the handler re-reads the goal, and the sweep picks up
 * anything a lost message would have stranded.
 */
export const scheduleGoalAdvance = async (params: ScheduleGoalAdvanceParams): Promise<void> => {
  try {
    await createGoalSchedulerModule().scheduleAdvance(params);
  } catch (error) {
    log('failed to schedule advance for goal %s (non-fatal): %O', params.goalId, error);
  }
};

export type { GoalSchedulerImpl, ScheduleGoalAdvanceParams } from './impls';
export { createGoalSchedulerModule, GOAL_ADVANCE_PATH } from './impls';
