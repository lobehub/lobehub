import debug from 'debug';

import type {HealthCheckResult, QueueMessage, QueueStats} from '../types';
import type {QueueServiceImpl} from './type';

const log = debug('queue:local');

/**
 * Callback type for local execution
 * This is set by AgentRuntimeService to avoid circular dependency
 */
export type LocalExecutionCallback = (
  operationId: string,
  stepIndex: number,
  context: any,
) => Promise<void>;

/**
 * Local queue service implementation
 *
 * Instead of scheduling HTTP requests (like QStashQueueServiceImpl),
 * this implementation uses setTimeout to schedule execution callbacks,
 * allowing the event loop to continue between steps.
 *
 * Use case: Local development without QStash
 */
export class LocalQueueServiceImpl implements QueueServiceImpl {
  private executionCallback: LocalExecutionCallback | null = null;
  private pendingExecutions: Set<string> = new Set();

  /**
   * Set the execution callback (called by AgentRuntimeService)
   * This breaks the circular dependency by using callback injection
   */
  setExecutionCallback(callback: LocalExecutionCallback): void {
    this.executionCallback = callback;
  }

  async scheduleMessage(message: QueueMessage): Promise<string> {
    const { operationId, stepIndex, context, delay = 50 } = message;

    const taskId = `local-${operationId}-${stepIndex}-${Date.now()}`;

    log(
      'Local execution scheduled for step %d of operation %s (delay: %dms)',
      stepIndex,
      operationId,
      delay,
    );

    // Use setTimeout to allow the current call stack to complete
    // This is important for createOperation to return before execution starts
    setTimeout(async () => {
      if (!this.executionCallback) {
        log('Warning: No execution callback set for local queue service');
        return;
      }

      this.pendingExecutions.add(taskId);

      try {
        log('Starting local execution for step %d of operation %s', stepIndex, operationId);
        await this.executionCallback(operationId, stepIndex, context);
        log('Completed local execution for step %d of operation %s', stepIndex, operationId);
      } catch (error) {
        log(
          'Local execution failed for step %d of operation %s: %O',
          stepIndex,
          operationId,
          error,
        );
      } finally {
        this.pendingExecutions.delete(taskId);
      }
    }, delay);

    return taskId;
  }

  async scheduleBatchMessages(messages: QueueMessage[]): Promise<string[]> {
    const taskIds: string[] = [];

    for (const message of messages) {
      const taskId = await this.scheduleMessage(message);
      taskIds.push(taskId);
    }

    log('Scheduled %d batch messages locally', messages.length);
    return taskIds;
  }

  async cancelScheduledTask(taskId: string): Promise<void> {
    // Local execution doesn't support cancellation of scheduled tasks
    // since they execute via setTimeout
    log('Cancel requested for task %s (not supported in local mode)', taskId);
  }

  async getQueueStats(): Promise<QueueStats> {
    return {
      completedCount: 0,
      failedCount: 0,
      pendingCount: this.pendingExecutions.size,
      processingCount: 0,
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return {
      healthy: true,
      message: `Local queue service healthy, ${this.pendingExecutions.size} pending executions`,
    };
  }
}
