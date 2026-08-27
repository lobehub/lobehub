export interface ScheduleGoalAdvanceParams {
  /** Seconds to wait before advancing. Defaults to 0 (as soon as possible). */
  delay?: number;
  goalId: string;
  userId: string;
  workspaceId?: string;
}

export interface GoalSchedulerImpl {
  scheduleAdvance: (params: ScheduleGoalAdvanceParams) => Promise<string>;
}
