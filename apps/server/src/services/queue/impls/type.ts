import { type HealthCheckResult, type QueueMessage, type QueueStats } from '../types';

/**
 * Queue service implementation interface
 */
export interface QueueServiceImpl {
  /**
   * Cancel scheduled task
   */
  cancelScheduledTask: (taskId: string) => Promise<void>;

  /**
   * Get queue statistics
   */
  getQueueStats: () => Promise<QueueStats>;

  /**
   * Health check
   */
  healthCheck: () => Promise<HealthCheckResult>;

  /**
   * Schedule multiple messages to the queue
   */
  scheduleBatchMessages: (messages: QueueMessage[]) => Promise<string[]>;

  /**
   * Schedule a message to the queue
   */
  scheduleMessage: (message: QueueMessage) => Promise<string>;
}
