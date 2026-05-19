import { sunoClient, type SunoTask } from '@/business/server/audio-generation/suno';

interface PollingState {
  retryCount: number;
  startTime: number;
}

export class AudioPollingService {
  private pollingStates = new Map<string, PollingState>();
  private pollingInterval: number;
  private maxRetries: number;

  constructor(
    pollingInterval: number = 2000,
    maxRetries: number = 20,
  ) {
    this.pollingInterval = pollingInterval;
    this.maxRetries = maxRetries;
  }

  /**
   * Poll a single task status from Suno API
   */
  async pollTaskStatus(taskId: string): Promise<SunoTask> {
    return sunoClient.getTaskStatus(taskId);
  }

  /**
   * Start polling for task completion
   * Polls up to maxRetries times with configurable interval
   */
  async startPolling(taskId: string, maxRetries?: number): Promise<SunoTask | null> {
    const retries = maxRetries ?? this.maxRetries;
    let lastTask: SunoTask | null = null;
    let lastError: Error | null = null;

    for (let i = 0; i < retries; i++) {
      try {
        const task = await this.pollTaskStatus(taskId);
        lastTask = task;

        if (task.status === 'completed' || task.status === 'failed') {
          this.pollingStates.delete(taskId);
          return task;
        }

        // Wait before next poll
        if (i < retries - 1) {
          await this.delay(this.pollingInterval);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on certain errors
        if (error instanceof Error && error.message.includes('401')) {
          throw error;
        }

        // Wait before retrying
        if (i < retries - 1) {
          await this.delay(this.pollingInterval);
        }
      }
    }

    // Return last successful task or null
    if (lastTask) {
      this.pollingStates.delete(taskId);
      return lastTask;
    }

    // Clean up state and throw if we have an error
    this.pollingStates.delete(taskId);
    if (lastError) {
      throw lastError;
    }

    return null;
  }

  /**
   * Check if 10 seconds have passed since task start time
   * This allows playback after a minimum delay
   */
  allowUserPlayAfter(taskStartTime: Date | number): boolean {
    const now = Date.now();
    const startTime = taskStartTime instanceof Date ? taskStartTime.getTime() : taskStartTime;
    const elapsedMs = now - startTime;
    return elapsedMs >= 10000; // 10 seconds
  }

  /**
   * Get polling state for a task
   */
  getPollingState(taskId: string): PollingState | undefined {
    return this.pollingStates.get(taskId);
  }

  /**
   * Initialize polling state for a task
   */
  initializePollingState(taskId: string): void {
    this.pollingStates.set(taskId, {
      retryCount: 0,
      startTime: Date.now(),
    });
  }

  /**
   * Update polling state
   */
  updatePollingState(taskId: string, state: Partial<PollingState>): void {
    const current = this.pollingStates.get(taskId) || { retryCount: 0, startTime: Date.now() };
    this.pollingStates.set(taskId, { ...current, ...state });
  }

  /**
   * Clear polling state for a task
   */
  clearPollingState(taskId: string): void {
    this.pollingStates.delete(taskId);
  }

  /**
   * Utility to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const audioPollingService = new AudioPollingService(
  parseInt(process.env.AUDIO_POLLING_INTERVAL_MS || '2000'),
  parseInt(process.env.AUDIO_MAX_RETRIES || '20'),
);
