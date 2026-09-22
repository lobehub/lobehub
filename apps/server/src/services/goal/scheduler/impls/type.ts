import type { GoalAdvanceTrigger } from '@lobechat/agent-tracing';

export interface ScheduleGoalAdvanceParams {
  /** Seconds to wait before advancing. Defaults to 0 (as soon as possible). */
  delay?: number;
  goalId: string;
  /** What made this goal advanceable. Survives the queue hop onto the trajectory. */
  trigger?: GoalAdvanceTrigger;
  userId: string;
  workspaceId?: string;
}

export interface GoalSchedulerImpl {
  scheduleAdvance: (params: ScheduleGoalAdvanceParams) => Promise<string>;
}
