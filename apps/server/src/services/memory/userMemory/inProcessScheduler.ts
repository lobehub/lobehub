import debug from 'debug';
import { getDurationMs } from '@lobechat/utils';

import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
const log = debug('lobe-server:memory:user-memory:scheduler');

export interface InProcessSchedulerOptions {
  /** Delay between tasks in milliseconds to avoid rate limiting */
  delayMs?: number;
  /** Maximum concurrent tasks */
  maxConcurrency?: number;
  /** Maximum number of tasks allowed in the queue (default: 100) */
  maxQueueSize?: number;
}

interface ScheduledTask {
  execute: () => Promise<void>;
  id: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * In-process task scheduler for memory extraction.
 *
 * This is an alternative to QStash that runs within the application process.
 * Useful for personal deployments to avoid QStash rate limits.
 *
 * Limitations:
 * - Tasks are lost if the process restarts
 * - No distributed execution
 * - No built-in retry (but can be added)
 */
export class InProcessScheduler {
  private queue: ScheduledTask[] = [];
  private running = 0;
  private readonly maxConcurrency: number;
  private readonly delayMs: number;
  private readonly maxQueueSize: number;
  private draining = false;
  private shuttingDown = false;

  constructor(options?: InProcessSchedulerOptions) {
    const config = parseMemoryExtractionConfig();
    this.maxConcurrency = options?.maxConcurrency ?? config.workflowParallelism ?? 2;
    this.delayMs = options?.delayMs ?? 1000;
    this.maxQueueSize = options?.maxQueueSize ?? config.maxQueueSize ?? 10;
  }

  /**
   * Schedule a task for execution.
   * Returns a promise that resolves when the task completes.
   */
  async schedule(taskId: string, execute: () => Promise<void>): Promise<void> {
    log('scheduling task: %s', taskId);
    if (this.shuttingDown) {
      return Promise.reject(
        new Error(`[in-process-scheduler] Scheduler is shutting down. Task "${taskId}" rejected.`),
      );
    }
    if (this.queue.length >= this.maxQueueSize) {
      return Promise.reject(
        new Error(
          `[in-process-scheduler] Queue is full (maxQueueSize=${this.maxQueueSize}). Task "${taskId}" rejected.`,
        ),
      );
    }
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ execute, id: taskId, reject, resolve });
      // Don't wait for processQueue to complete
      this.processQueue().catch((error) => {
        log('error processing queue: %O', error);
      });
    });
  }

  /**
   * Get the current queue size.
   */
  get queueSize(): number {
    return this.queue.length;
  }

  /**
   * Get the number of currently running tasks.
   */
  get activeTasks(): number {
    return this.running;
  }

  /**
   * Check if the scheduler is shutting down.
   */
  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /**
   * Gracefully shutdown the scheduler.
   * - Stops accepting new tasks
   * - Waits for running tasks to complete (up to timeout)
   * - Rejects all queued tasks
   *
   * @param timeoutMs - Maximum time to wait for running tasks (default: 30000ms)
   */
  async shutdown(timeoutMs = 30_000): Promise<void> {
    log('shutting down, queue size: %d, running: %d', this.queue.length, this.running);
    this.shuttingDown = true;

    // Reject all queued tasks
    const queuedTasks = [...this.queue];
    this.queue = [];
    for (const task of queuedTasks) {
      task.reject(new Error(`[in-process-scheduler] Task "${task.id}" rejected due to shutdown.`));
    }

    // Wait for running tasks to complete with timeout
    if (this.running > 0) {
      const deadline = Date.now() + timeoutMs;
      while (this.running > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (this.running > 0) {
        log('shutdown timeout reached with %d tasks still running', this.running);
      }
    }

    log('shutdown complete');
  }

  private async processQueue(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;

    while (this.queue.length > 0 && this.running < this.maxConcurrency) {
      const task = this.queue.shift();
      if (!task) break;

      this.running++;

      // Execute task without awaiting (fire and forget for concurrency)
      this.executeTask(task).catch((error) => {
        log('error executing task: %s %O', task.id, error);
      });
    }

    this.draining = false;
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    const start = Date.now();

    try {
      await task.execute();
      task.resolve();
    } catch (error) {
      const duration = getDurationMs(start);
      log('task failed: %s, duration: %dms, error: %O', task.id, duration, error);
      task.reject(error as Error);
    } finally {
      this.running--;

      // Add delay before processing next task
      if (this.queue.length > 0 && this.delayMs > 0) {
        const delay = Math.floor(this.delayMs * (0.5 + Math.random() * 0.5));
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Trigger next drain cycle to pick up remaining queued tasks
      this.processQueue().catch((error) => {
        log('error draining queue: %O', error);
      });
    }
  }
}

// Singleton instance
let schedulerInstance: InProcessScheduler | null = null;

/**
 * Get the global in-process scheduler instance.
 */
export function getInProcessScheduler(): InProcessScheduler {
  if (!schedulerInstance) {
    const config = parseMemoryExtractionConfig();
    schedulerInstance = new InProcessScheduler({
      maxConcurrency: config.workflowParallelism,
      maxQueueSize: config.maxQueueSize,
    });
  }
  return schedulerInstance;
}

/**
 * Reset the global scheduler instance (useful for testing).
 */
export function resetInProcessScheduler(): void {
  schedulerInstance = null;
}
