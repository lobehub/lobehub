import debug from 'debug';

import type { ScheduleNextTopicParams, TaskSchedulerImpl } from './type';

const log = debug('task-scheduler:local');

export type TaskExecutionCallback = (taskId: string, userId: string) => Promise<void>;

/**
 * Local task scheduler using setTimeout
 * For local development without QStash
 */
export class LocalTaskScheduler implements TaskSchedulerImpl {
  private executionCallback: TaskExecutionCallback | null = null;
  private pendingSchedules: Map<string, NodeJS.Timeout> = new Map();

  setExecutionCallback(callback: TaskExecutionCallback): void {
    this.executionCallback = callback;
  }

  async scheduleNextTopic(params: ScheduleNextTopicParams): Promise<string> {
    const { taskId, userId, delay = 0 } = params;
    const scheduleId = `local-task-${taskId}-${Date.now()}`;

    log('Scheduling next topic for task %s (delay: %ds)', taskId, delay);

    const timer = setTimeout(async () => {
      this.pendingSchedules.delete(scheduleId);

      if (!this.executionCallback) {
        log('Warning: No execution callback set');
        return;
      }

      try {
        log('Executing next topic for task %s', taskId);
        await this.executionCallback(taskId, userId);
      } catch (error) {
        log('Failed to execute next topic for task %s: %O', taskId, error);
      }
    }, delay * 1000);

    this.pendingSchedules.set(scheduleId, timer);
    return scheduleId;
  }

  async cancelScheduled(scheduleId: string): Promise<void> {
    const timer = this.pendingSchedules.get(scheduleId);
    if (timer) {
      clearTimeout(timer);
      this.pendingSchedules.delete(scheduleId);
      log('Canceled schedule %s', scheduleId);
    }
  }
}
