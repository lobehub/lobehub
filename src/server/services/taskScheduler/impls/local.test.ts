// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalTaskScheduler } from './local';

describe('LocalTaskScheduler', () => {
  let scheduler: LocalTaskScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new LocalTaskScheduler();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('scheduleNextTopic', () => {
    it('should return a schedule ID immediately', async () => {
      const scheduleId = await scheduler.scheduleNextTopic({
        taskId: 'task-1',
        userId: 'user-1',
      });

      expect(scheduleId).toMatch(/^local-task-task-1-\d+$/);
    });

    it('should execute callback after delay', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      scheduler.setExecutionCallback(callback);

      await scheduler.scheduleNextTopic({ delay: 5, taskId: 'task-1', userId: 'user-1' });

      expect(callback).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5000);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith('task-1', 'user-1');
    });

    it('should execute callback immediately when delay is 0', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      scheduler.setExecutionCallback(callback);

      await scheduler.scheduleNextTopic({ delay: 0, taskId: 'task-2', userId: 'user-2' });

      await vi.advanceTimersByTimeAsync(0);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith('task-2', 'user-2');
    });

    it('should execute callback immediately when delay is not provided', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      scheduler.setExecutionCallback(callback);

      await scheduler.scheduleNextTopic({ taskId: 'task-3', userId: 'user-3' });

      await vi.advanceTimersByTimeAsync(0);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith('task-3', 'user-3');
    });

    it('should not execute callback when no callback is set', async () => {
      // No callback set - should not throw
      await scheduler.scheduleNextTopic({ delay: 1, taskId: 'task-4', userId: 'user-4' });

      await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
    });

    it('should remove schedule from pending after execution', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      scheduler.setExecutionCallback(callback);

      const scheduleId = await scheduler.scheduleNextTopic({
        delay: 1,
        taskId: 'task-5',
        userId: 'user-5',
      });

      await vi.advanceTimersByTimeAsync(1000);

      // After execution, canceling should be a no-op (not throw)
      await expect(scheduler.cancelScheduled(scheduleId)).resolves.not.toThrow();
    });

    it('should handle callback errors without throwing', async () => {
      const callback = vi.fn().mockRejectedValue(new Error('execution failed'));
      scheduler.setExecutionCallback(callback);

      await scheduler.scheduleNextTopic({ delay: 1, taskId: 'task-6', userId: 'user-6' });

      await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
      expect(callback).toHaveBeenCalledOnce();
    });

    it('should support multiple concurrent schedules', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      scheduler.setExecutionCallback(callback);

      await scheduler.scheduleNextTopic({ delay: 1, taskId: 'task-a', userId: 'user-1' });
      await scheduler.scheduleNextTopic({ delay: 2, taskId: 'task-b', userId: 'user-1' });
      await scheduler.scheduleNextTopic({ delay: 3, taskId: 'task-c', userId: 'user-1' });

      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('task-a', 'user-1');

      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith('task-b', 'user-1');

      await vi.advanceTimersByTimeAsync(1000);
      expect(callback).toHaveBeenCalledTimes(3);
      expect(callback).toHaveBeenCalledWith('task-c', 'user-1');
    });
  });

  describe('cancelScheduled', () => {
    it('should cancel a pending schedule before it fires', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      scheduler.setExecutionCallback(callback);

      const scheduleId = await scheduler.scheduleNextTopic({
        delay: 5,
        taskId: 'task-7',
        userId: 'user-7',
      });

      await scheduler.cancelScheduled(scheduleId);

      await vi.advanceTimersByTimeAsync(5000);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should be a no-op for unknown schedule IDs', async () => {
      await expect(scheduler.cancelScheduled('unknown-schedule-id')).resolves.not.toThrow();
    });

    it('should not affect other pending schedules when canceling one', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);
      scheduler.setExecutionCallback(callback);

      const id1 = await scheduler.scheduleNextTopic({
        delay: 2,
        taskId: 'task-8a',
        userId: 'user-8',
      });
      await scheduler.scheduleNextTopic({ delay: 2, taskId: 'task-8b', userId: 'user-8' });

      await scheduler.cancelScheduled(id1);

      await vi.advanceTimersByTimeAsync(2000);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('task-8b', 'user-8');
    });
  });

  describe('setExecutionCallback', () => {
    it('should update the callback', async () => {
      const firstCallback = vi.fn().mockResolvedValue(undefined);
      const secondCallback = vi.fn().mockResolvedValue(undefined);

      scheduler.setExecutionCallback(firstCallback);
      scheduler.setExecutionCallback(secondCallback);

      await scheduler.scheduleNextTopic({ delay: 1, taskId: 'task-9', userId: 'user-9' });

      await vi.advanceTimersByTimeAsync(1000);

      expect(firstCallback).not.toHaveBeenCalled();
      expect(secondCallback).toHaveBeenCalledOnce();
    });
  });
});
