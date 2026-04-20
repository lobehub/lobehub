export interface ScheduleNextTopicParams {
  delay?: number; // delay in seconds, default 0
  taskId: string;
  userId: string;
}

export interface TaskSchedulerImpl {
  cancelScheduled: (scheduleId: string) => Promise<void>;

  scheduleNextTopic: (params: ScheduleNextTopicParams) => Promise<string>;
}
