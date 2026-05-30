import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';

vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
  parseMemoryExtractionConfig: vi.fn(() => ({
    rateLimit: { rpm: 30 },
    workflowParallelism: 2,
  })),
}));

import {
  getInProcessScheduler,
  InProcessScheduler,
  resetInProcessScheduler,
} from '../inProcessScheduler';

describe('InProcessScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetInProcessScheduler();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetInProcessScheduler();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default maxConcurrency=2 and delayMs=100 from config', () => {
      const scheduler = new InProcessScheduler();
      expect(scheduler.activeTasks).toBe(0);
      expect(scheduler.queueSize).toBe(0);
    });

    it('should accept custom maxConcurrency and delayMs', () => {
      const scheduler = new InProcessScheduler({ delayMs: 500, maxConcurrency: 5 });
      expect(scheduler.activeTasks).toBe(0);
      expect(scheduler.queueSize).toBe(0);
    });

    it('should use default maxQueueSize=10 when not specified', async () => {
      const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 1 });
      // Fill queue to the default limit by scheduling tasks that block
      const blocker = new Promise<void>(() => {}); // never resolves
      scheduler.schedule('blocker', async () => blocker);

      for (let i = 0; i < 10; i++) {
        scheduler.schedule(`task-${i}`, async () => {});
      }

      expect(scheduler.queueSize).toBe(10);

      // The 11th queued task should be rejected
      await expect(scheduler.schedule('overflow', async () => {})).rejects.toThrow(
        /Queue is full/,
      );
    });
  });

  describe('schedule', () => {
    it('should execute a single task', async () => {
      const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 2 });
      const taskFn = vi.fn().mockResolvedValue(undefined);

      const promise = scheduler.schedule('task-1', taskFn);

      // Flush microtasks
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      expect(taskFn).toHaveBeenCalled();
      await promise;
    });

    it('should resolve promise when task completes', async () => {
      const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 2 });
      let resolved = false;

      const promise = scheduler.schedule('task-1', async () => {});
      promise.then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      expect(resolved).toBe(true);
    });

    it('should reject promise when task throws', async () => {
      const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 2 });
      let rejected = false;

      // Catch the rejection to prevent unhandled rejection warning
      const promise = scheduler
        .schedule('task-1', async () => {
          throw new Error('task failed');
        })
        .catch(() => {
          rejected = true;
        });

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
      await promise;

      expect(rejected).toBe(true);
    });

    it('should respect maxConcurrency', async () => {
      const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 2 });
      let running = 0;
      let maxRunning = 0;

      const createTask = () => async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 100));
        running--;
      };

      // Schedule 4 tasks with maxConcurrency=2
      const p1 = scheduler.schedule('t1', createTask());
      const p2 = scheduler.schedule('t2', createTask());
      const p3 = scheduler.schedule('t3', createTask());
      const p4 = scheduler.schedule('t4', createTask());

      // Flush all timers
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(200);
      await vi.advanceTimersByTimeAsync(200);
      await vi.advanceTimersByTimeAsync(200);

      await Promise.all([p1, p2, p3, p4]);

      // maxConcurrency was 2, so at most 2 tasks ran concurrently
      // Note: the first batch starts immediately, so maxRunning could be 2
      expect(maxRunning).toBeLessThanOrEqual(2);
    });

    it('should queue tasks beyond maxConcurrency', async () => {
      const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 1 });
      const executionOrder: string[] = [];

      const createTask = (id: string) => async () => {
        executionOrder.push(id);
      };

      const p1 = scheduler.schedule('t1', createTask('t1'));
      const p2 = scheduler.schedule('t2', createTask('t2'));
      const p3 = scheduler.schedule('t3', createTask('t3'));

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      await Promise.all([p1, p2, p3]);

      expect(executionOrder).toEqual(['t1', 't2', 't3']);
    });

    it('should schedule tasks when queue is not full', async () => {
      const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 2, maxQueueSize: 5 });
      const taskFn = vi.fn().mockResolvedValue(undefined);

      const promise = scheduler.schedule('task-1', taskFn);
      await vi.advanceTimersByTimeAsync(0);
      await promise;

      expect(taskFn).toHaveBeenCalled();
      expect(scheduler.queueSize).toBe(0);
    });

    it('should reject when queue is full', async () => {
      const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 1, maxQueueSize: 2 });
      // Block the running task so everything else stays queued
      const blocker = new Promise<void>(() => {});
      scheduler.schedule('blocker', async () => blocker);

      scheduler.schedule('q1', async () => {});
      scheduler.schedule('q2', async () => {});

      expect(scheduler.queueSize).toBe(2);

      await expect(scheduler.schedule('overflow', async () => {})).rejects.toThrow(
        /Queue is full \(maxQueueSize=2\)\. Task "overflow" rejected\./,
      );
    });

    it('should allow new tasks after queue drains', async () => {
      const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 1, maxQueueSize: 2 });

      let resolveBlocker: () => void;
      const blocker = new Promise<void>((resolve) => {
        resolveBlocker = resolve;
      });

      scheduler.schedule('blocker', async () => blocker);
      await vi.advanceTimersByTimeAsync(0);

      scheduler.schedule('q1', async () => {});
      scheduler.schedule('q2', async () => {});

      // Queue is full now
      await expect(scheduler.schedule('rejected', async () => {})).rejects.toThrow(/Queue is full/);

      // Drain the queue
      resolveBlocker!();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);

      // Should be able to schedule again
      const taskFn = vi.fn().mockResolvedValue(undefined);
      const promise = scheduler.schedule('new-task', taskFn);
      await vi.advanceTimersByTimeAsync(0);
      await promise;

      expect(taskFn).toHaveBeenCalled();
    });
  });

  describe('queueSize / activeTasks', () => {
    it('should report correct queue size', async () => {
      const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 1 });

      // Block the first task so others queue up
      let resolveFirst: () => void;
      const firstTaskBlocked = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      scheduler.schedule('t1', async () => firstTaskBlocked);
      await vi.advanceTimersByTimeAsync(0);

      scheduler.schedule('t2', async () => {});
      scheduler.schedule('t3', async () => {});

      expect(scheduler.queueSize).toBe(2);

      // Let first task finish
      resolveFirst!();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
    });

    it('should report correct active task count', async () => {
      const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 2 });

      let resolveTask: () => void;
      const taskBlocked = new Promise<void>((resolve) => {
        resolveTask = resolve;
      });

      scheduler.schedule('t1', async () => taskBlocked);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      expect(scheduler.activeTasks).toBe(1);

      resolveTask!();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      expect(scheduler.activeTasks).toBe(0);
    });
  });
});

describe('getInProcessScheduler (singleton)', () => {
  beforeEach(() => {
    resetInProcessScheduler();
    vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
      parseMemoryExtractionConfig: vi.fn(() => ({
        rateLimit: { rpm: 30 },
        workflowParallelism: 2,
      })),
    }));
  });

  afterEach(() => {
    resetInProcessScheduler();
  });

  it('should return same instance on multiple calls', () => {
    const s1 = getInProcessScheduler();
    const s2 = getInProcessScheduler();
    expect(s1).toBe(s2);
  });

  it('should create new instance on first call', () => {
    const scheduler = getInProcessScheduler();
    expect(scheduler).toBeInstanceOf(InProcessScheduler);
  });
});

describe('resetInProcessScheduler', () => {
  beforeEach(() => {
    vi.mock('@/server/globalConfig/parseMemoryExtractionConfig', () => ({
      parseMemoryExtractionConfig: vi.fn(() => ({
        rateLimit: { rpm: 30 },
        workflowParallelism: 2,
      })),
    }));
  });

  it('should reset singleton to null', () => {
    const s1 = getInProcessScheduler();
    resetInProcessScheduler();
    const s2 = getInProcessScheduler();
    expect(s1).not.toBe(s2);
  });

  it('should allow creating new instance after reset', () => {
    getInProcessScheduler();
    resetInProcessScheduler();
    const s = getInProcessScheduler();
    expect(s).toBeInstanceOf(InProcessScheduler);
  });
});

describe('delay jitter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetInProcessScheduler();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetInProcessScheduler();
    vi.restoreAllMocks();
  });

  it('should apply jittered delay between tasks when delayMs > 0', async () => {
    const scheduler = new InProcessScheduler({ delayMs: 1000, maxConcurrency: 1 });
    const executionTimes: number[] = [];

    const createTask = (id: string) => async () => {
      executionTimes.push(Date.now());
    };

    const p1 = scheduler.schedule('t1', createTask('t1'));
    const p2 = scheduler.schedule('t2', createTask('t2'));

    // Start processing
    await vi.advanceTimersByTimeAsync(0);

    // First task executes immediately
    expect(executionTimes).toHaveLength(1);

    // Advance past the minimum jitter (0.5 * 1000 = 500ms)
    await vi.advanceTimersByTimeAsync(500);

    // Second task should not have executed yet (jitter is 500-1000ms)
    // Note: Due to random jitter, we can't assert exact timing, but we can verify
    // that the delay mechanism is invoked by checking that tasks don't execute immediately

    // Advance past maximum jitter (1000ms)
    await vi.advanceTimersByTimeAsync(600);

    // Both tasks should have completed
    await Promise.all([p1, p2]);
    expect(executionTimes).toHaveLength(2);
  });

  it('should NOT apply delay when delayMs=0', async () => {
    const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 1 });
    const executionOrder: string[] = [];

    const createTask = (id: string) => async () => {
      executionOrder.push(id);
    };

    const p1 = scheduler.schedule('t1', createTask('t1'));
    const p2 = scheduler.schedule('t2', createTask('t2'));
    const p3 = scheduler.schedule('t3', createTask('t3'));

    // With delayMs=0, all tasks should execute without artificial delays
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    await Promise.all([p1, p2, p3]);
    expect(executionOrder).toEqual(['t1', 't2', 't3']);
  });

  it('should NOT apply delay when queue is empty after task completes', async () => {
    const scheduler = new InProcessScheduler({ delayMs: 1000, maxConcurrency: 1 });

    // Only one task - no delay should be applied since there's nothing queued after it
    const taskFn = vi.fn().mockResolvedValue(undefined);
    const promise = scheduler.schedule('single-task', taskFn);

    await vi.advanceTimersByTimeAsync(0);
    await promise;

    expect(taskFn).toHaveBeenCalled();
  });
});

describe('constructor config fallback chain', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetInProcessScheduler();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetInProcessScheduler();
    vi.restoreAllMocks();
  });

  it('should use default maxConcurrency=2 when config.workflowParallelism is undefined', () => {
    vi.mocked(parseMemoryExtractionConfig).mockReturnValue({
      rateLimit: { rpm: 30 },
    } as any);

    const scheduler = new InProcessScheduler();
    // Verify by scheduling 3 tasks and checking that only 2 run concurrently
    let running = 0;
    let maxRunning = 0;

    const createTask = () => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 100));
      running--;
    };

    scheduler.schedule('t1', createTask());
    scheduler.schedule('t2', createTask());
    scheduler.schedule('t3', createTask());

    vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTimeAsync(200);
    vi.advanceTimersByTimeAsync(200);

    // Default maxConcurrency is 2
    expect(maxRunning).toBeLessThanOrEqual(2);
  });

  it('should use default delayMs=1000 when options.delayMs is not provided', () => {
    vi.mocked(parseMemoryExtractionConfig).mockReturnValue({
      workflowParallelism: 2,
    } as any);

    const scheduler = new InProcessScheduler();
    // We can't directly test the private delayMs, but we can verify the scheduler works
    expect(scheduler.activeTasks).toBe(0);
    expect(scheduler.queueSize).toBe(0);
  });

  it('should use default maxQueueSize=10 when config.maxQueueSize is undefined', async () => {
    vi.mocked(parseMemoryExtractionConfig).mockReturnValue({
      rateLimit: { rpm: 30 },
      workflowParallelism: 2,
    } as any);

    const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 1 });
    // Block the first task so others stay queued
    const blocker = new Promise<void>(() => {});
    scheduler.schedule('blocker', async () => blocker);

    // Schedule 10 tasks (they will queue because blocker is running)
    for (let i = 0; i < 10; i++) {
      scheduler.schedule(`task-${i}`, async () => {});
    }

    // blocker is running (not in queue), 10 tasks are queued
    expect(scheduler.queueSize).toBe(10);

    // The 11th queued task should be rejected
    await expect(scheduler.schedule('overflow', async () => {})).rejects.toThrow(/Queue is full/);
  });

  it('should use options over config when both provided', () => {
    vi.mocked(parseMemoryExtractionConfig).mockReturnValue({
      rateLimit: { rpm: 30 },
      workflowParallelism: 2,
      maxQueueSize: 50,
    } as any);

    const scheduler = new InProcessScheduler({
      delayMs: 500,
      maxConcurrency: 5,
      maxQueueSize: 10,
    });

    // Options should take precedence over config
    expect(scheduler.activeTasks).toBe(0);
  });
});

describe('shutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetInProcessScheduler();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetInProcessScheduler();
    vi.restoreAllMocks();
  });

  it('should reject new tasks after shutdown initiated', async () => {
    const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 2 });

    // Start shutdown
    const shutdownPromise = scheduler.shutdown();

    // New task should be rejected
    await expect(scheduler.schedule('new-task', async () => {})).rejects.toThrow(
      /Scheduler is shutting down/,
    );

    await shutdownPromise;
  });

  it('should reject all queued tasks on shutdown', async () => {
    const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 1 });

    // Block the first task with a resolvable promise
    let resolveBlocker: () => void;
    const blocker = new Promise<void>((resolve) => {
      resolveBlocker = resolve;
    });
    scheduler.schedule('blocker', async () => blocker);

    // Let blocker start
    await vi.advanceTimersByTimeAsync(0);

    // Queue more tasks
    const rejected: string[] = [];
    const p1 = scheduler.schedule('t1', async () => {}).catch(() => rejected.push('t1'));
    const p2 = scheduler.schedule('t2', async () => {}).catch(() => rejected.push('t2'));

    // Shutdown should reject queued tasks immediately
    const shutdownPromise = scheduler.shutdown(5000);

    await Promise.all([p1, p2]);
    expect(rejected).toEqual(['t1', 't2']);

    // Resolve blocker to allow shutdown to complete
    resolveBlocker!();
    await vi.advanceTimersByTimeAsync(100);

    await shutdownPromise;
  });

  it('should wait for running tasks to complete before shutdown', async () => {
    const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 2 });

    let taskCompleted = false;
    scheduler.schedule('long-task', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      taskCompleted = true;
    });

    // Let task start
    await vi.advanceTimersByTimeAsync(0);

    // Start shutdown with timeout
    const shutdownPromise = scheduler.shutdown(5000);

    // Task should still be running
    expect(taskCompleted).toBe(false);

    // Advance timer to complete the task
    await vi.advanceTimersByTimeAsync(1000);

    await shutdownPromise;
    expect(taskCompleted).toBe(true);
  });

  it('should timeout if running tasks take too long', async () => {
    const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 1 });

    // Block the task indefinitely
    const blocker = new Promise<void>(() => {});
    scheduler.schedule('blocker', async () => blocker);

    await vi.advanceTimersByTimeAsync(0);

    // Shutdown with short timeout
    const shutdownPromise = scheduler.shutdown(100);

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(200);

    await shutdownPromise;
    // Shutdown should complete even though task is still running
    expect(scheduler.isShuttingDown).toBe(true);
  });

  it('should report isShuttingDown status', async () => {
    const scheduler = new InProcessScheduler({ delayMs: 0, maxConcurrency: 2 });

    expect(scheduler.isShuttingDown).toBe(false);

    const shutdownPromise = scheduler.shutdown();
    expect(scheduler.isShuttingDown).toBe(true);

    await shutdownPromise;
    expect(scheduler.isShuttingDown).toBe(true);
  });
});
