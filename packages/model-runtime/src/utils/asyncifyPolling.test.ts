import { describe, expect, it, vi } from 'vitest';

import type { TaskResult } from './asyncifyPolling';
import { asyncifyPolling } from './asyncifyPolling';

describe('asyncifyPolling', () => {
  describe('basic functionality', () => {
    it('should return data when task succeeds immediately', async () => {
      const mockTask = vi.fn().mockResolvedValue({ status: 'completed', data: 'result' });
      const mockCheckStatus = vi.fn().mockReturnValue({
        status: 'success',
        data: 'result',
      } as TaskResult<string>);

      const result = await asyncifyPolling({
        pollingQuery: mockTask,
        checkStatus: mockCheckStatus,
      });

      expect(result).toBe('result');
      expect(mockTask).toHaveBeenCalledTimes(1);
      expect(mockCheckStatus).toHaveBeenCalledTimes(1);
    });

    it('should poll multiple times until success', async () => {
      const mockTask = vi
        .fn()
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'completed', data: 'final-result' });

      const mockCheckStatus = vi
        .fn()
        .mockReturnValueOnce({ status: 'pending' })
        .mockReturnValueOnce({ status: 'pending' })
        .mockReturnValueOnce({ status: 'success', data: 'final-result' });

      const result = await asyncifyPolling({
        pollingQuery: mockTask,
        checkStatus: mockCheckStatus,
        initialInterval: 10, // fast test
      });

      expect(result).toBe('final-result');
      expect(mockTask).toHaveBeenCalledTimes(3);
      expect(mockCheckStatus).toHaveBeenCalledTimes(3);
    });

    it('should throw error when task fails', async () => {
      const mockTask = vi.fn().mockResolvedValue({ status: 'failed', error: 'Task failed' });
      const mockCheckStatus = vi.fn().mockReturnValue({
        status: 'failed',
        error: new Error('Task failed'),
      });

      await expect(
        asyncifyPolling({
          pollingQuery: mockTask,
          checkStatus: mockCheckStatus,
        }),
      ).rejects.toThrow('Task failed');

      expect(mockTask).toHaveBeenCalledTimes(1);
    });

    it('should handle pending status correctly', async () => {
      const mockTask = vi
        .fn()
        .mockResolvedValueOnce({ status: 'processing' })
        .mockResolvedValueOnce({ status: 'done' });

      const mockCheckStatus = vi
        .fn()
        .mockReturnValueOnce({ status: 'pending' })
        .mockReturnValueOnce({ status: 'success', data: 'completed' });

      const result = await asyncifyPolling({
        pollingQuery: mockTask,
        checkStatus: mockCheckStatus,
        initialInterval: 10,
      });

      expect(result).toBe('completed');
      expect(mockTask).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry mechanism', () => {
    it('should retry with exponential backoff', async () => {
      const startTime = Date.now();
      const mockTask = vi
        .fn()
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'success' });

      const mockCheckStatus = vi
        .fn()
        .mockReturnValueOnce({ status: 'pending' })
        .mockReturnValueOnce({ status: 'pending' })
        .mockReturnValueOnce({ status: 'success', data: 'done' });

      await asyncifyPolling({
        pollingQuery: mockTask,
        checkStatus: mockCheckStatus,
        initialInterval: 50,
        backoffMultiplier: 2,
        maxInterval: 200,
      });

      const elapsed = Date.now() - startTime;
      // Should wait at least 50ms + 100ms = 150ms
      expect(elapsed).toBeGreaterThan(140);
    });

    it('should respect maxInterval limit', async () => {
      const intervals: number[] = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = vi.fn((callback, delay) => {
        intervals.push(delay as number);
        return originalSetTimeout(callback, 1); // fast execution
      }) as any;

      const mockTask = vi
        .fn()
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'success' });

      const mockCheckStatus = vi
        .fn()
        .mockReturnValueOnce({ status: 'pending' })
        .mockReturnValueOnce({ status: 'pending' })
        .mockReturnValueOnce({ status: 'pending' })
        .mockReturnValueOnce({ status: 'success', data: 'done' });

      await asyncifyPolling({
        pollingQuery: mockTask,
        checkStatus: mockCheckStatus,
        initialInterval: 100,
        backoffMultiplier: 3,
        maxInterval: 200,
      });

      // Intervals should be: 100, 200 (capped), 200 (capped)
      expect(intervals).toEqual([100, 200, 200]);

      global.setTimeout = originalSetTimeout;
    });

    it('should stop after maxRetries', async () => {
      const mockTask = vi.fn().mockResolvedValue({ status: 'pending' });
      const mockCheckStatus = vi.fn().mockReturnValue({ status: 'pending' });

      await expect(
        asyncifyPolling({
          pollingQuery: mockTask,
          checkStatus: mockCheckStatus,
          maxRetries: 3,
          initialInterval: 1,
        }),
      ).rejects.toThrow(/timeout after 3 attempts/);

      expect(mockTask).toHaveBeenCalledTimes(3);
    });
  });

  describe('error handling', () => {
    it('should handle consecutive failures', async () => {
      const mockTask = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error 1'))
        .mockRejectedValueOnce(new Error('Network error 2'))
        .mockResolvedValueOnce({ status: 'success' });

      const mockCheckStatus = vi.fn().mockReturnValue({ status: 'success', data: 'recovered' });

      const result = await asyncifyPolling({
        pollingQuery: mockTask,
        checkStatus: mockCheckStatus,
        maxConsecutiveFailures: 3,
        initialInterval: 1,
      });

      expect(result).toBe('recovered');
      expect(mockTask).toHaveBeenCalledTimes(3);
    });

    it('should throw after maxConsecutiveFailures', async () => {
      const mockTask = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error 1'))
        .mockRejectedValueOnce(new Error('Network error 2'))
        .mockRejectedValueOnce(new Error('Network error 3'));

      const mockCheckStatus = vi.fn();

      await expect(
        asyncifyPolling({
          pollingQuery: mockTask,
          checkStatus: mockCheckStatus,
          maxConsecutiveFailures: 2, // 允许最多2次连续失败
          initialInterval: 1,
        }),
      ).rejects.toThrow(/consecutive attempts/);

      expect(mockTask).toHaveBeenCalledTimes(2); // 第1次失败，第2次失败，然后抛出错误
      expect(mockCheckStatus).not.toHaveBeenCalled();
    });

    it('should reset consecutive failures on success', async () => {
      const mockTask = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error 1')) // Failure 1 (consecutiveFailures=1)
        .mockResolvedValueOnce({ status: 'pending' }) // Success 1 (reset to 0)
        .mockRejectedValueOnce(new Error('Network error 2')) // Failure 2 (consecutiveFailures=1)
        .mockRejectedValueOnce(new Error('Network error 3')) // Failure 3 (consecutiveFailures=2)
        .mockResolvedValueOnce({ status: 'success' }); // Success 2 (return result)

      const mockCheckStatus = vi
        .fn()
        .mockReturnValueOnce({ status: 'pending' }) // For success 1
        .mockReturnValueOnce({ status: 'success', data: 'final' }); // For success 2

      const result = await asyncifyPolling({
        pollingQuery: mockTask,
        checkStatus: mockCheckStatus,
        maxConsecutiveFailures: 3, // Allow up to 3 consecutive failures (since there are 2 consecutive failures)
        initialInterval: 1,
      });

      expect(result).toBe('final');
      expect(mockTask).toHaveBeenCalledTimes(5); // Total 5 calls
    });
  });

  describe('configuration', () => {
    it('should use custom intervals and multipliers', async () => {
      const intervals: number[] = [];
      const originalSetTimeout = global.setTimeout;

      global.setTimeout = vi.fn((callback, delay) => {
        intervals.push(delay as number);
        return originalSetTimeout(callback, 1);
      }) as any;

      const mockTask = vi
        .fn()
        .mockResolvedValueOnce({ status: 'pending' })
        .mockResolvedValueOnce({ status: 'success' });

      const mockCheckStatus = vi
        .fn()
        .mockReturnValueOnce({ status: 'pending' })
        .mockReturnValueOnce({ status: 'success', data: 'done' });

      await asyncifyPolling({
        pollingQuery: mockTask,
        checkStatus: mockCheckStatus,
        initialInterval: 200,
        backoffMultiplier: 1.2,
      });

      expect(intervals[0]).toBe(200);

      global.setTimeout = originalSetTimeout;
    });

    it('should accept custom logger function', async () => {
      const mockLogger = {
        debug: vi.fn(),
        error: vi.fn(),
      };

      const mockTask = vi
        .fn()
        .mockRejectedValueOnce(new Error('Test error'))
        .mockResolvedValueOnce({ status: 'success' });

      const mockCheckStatus = vi.fn().mockReturnValue({ status: 'success', data: 'done' });

      await asyncifyPolling({
        pollingQuery: mockTask,
        checkStatus: mockCheckStatus,
        logger: mockLogger,
        maxConsecutiveFailures: 3,
        initialInterval: 1,
      });

      expect(mockLogger.debug).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle immediate failure', async () => {
      const mockTask = vi.fn().mockResolvedValue({ error: 'immediate failure' });
      const mockCheckStatus = vi.fn().mockReturnValue({
        status: 'failed',
        error: new Error('immediate failure'),
      });

      await expect(
        asyncifyPolling({
          pollingQuery: mockTask,
          checkStatus: mockCheckStatus,
        }),
      ).rejects.toThrow('immediate failure');

      expect(mockTask).toHaveBeenCalledTimes(1);
    });

    it('should handle task throwing exceptions', async () => {
      const mockTask = vi.fn().mockRejectedValue(new Error('Task exception'));
      const mockCheckStatus = vi.fn();

      await expect(
        asyncifyPolling({
          pollingQuery: mockTask,
          checkStatus: mockCheckStatus,
          maxConsecutiveFailures: 1,
          initialInterval: 1,
        }),
      ).rejects.toThrow(/consecutive attempts/);
    });

    it('should timeout correctly with maxRetries = 1', async () => {
      const mockTask = vi.fn().mockResolvedValue({ status: 'pending' });
      const mockCheckStatus = vi.fn().mockReturnValue({ status: 'pending' });

      await expect(
        asyncifyPolling({
          pollingQuery: mockTask,
          checkStatus: mockCheckStatus,
          maxRetries: 1,
          initialInterval: 1,
        }),
      ).rejects.toThrow(/timeout after 1 attempts/);

      expect(mockTask).toHaveBeenCalledTimes(1);
    });
  });

  describe('custom error handling', () => {
    it('should allow continuing polling via onPollingError', async () => {
      const mockTask = vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Another error'))
        .mockResolvedValueOnce({ status: 'success' });

      const mockCheckStatus = vi.fn().mockReturnValue({ status: 'success', data: 'final-result' });

      const onPollingError = vi.fn().mockReturnValue({
        isContinuePolling: true,
      });

      const result = await asyncifyPolling({
        pollingQuery: mockTask,
        checkStatus: mockCheckStatus,
        onPollingError,
        initialInterval: 1,
      });

      expect(result).toBe('final-result');
      expect(mockTask).toHaveBeenCalledTimes(3);
      expect(onPollingError).toHaveBeenCalledTimes(2);

      // Check that error context was passed correctly
      expect(onPollingError).toHaveBeenCalledWith({
        error: expect.any(Error),
        retries: expect.any(Number),
        consecutiveFailures: expect.any(Number),
      });
    });

    it('should stop polling when onPollingError returns false', async () => {
      const mockTask = vi.fn().mockRejectedValue(new Error('Fatal error'));
      const mockCheckStatus = vi.fn();

      const onPollingError = vi.fn().mockReturnValue({
        isContinuePolling: false,
      });

      await expect(
        asyncifyPolling({
          pollingQuery: mockTask,
          checkStatus: mockCheckStatus,
          onPollingError,
          initialInterval: 1,
        }),
      ).rejects.toThrow('Fatal error');

      expect(mockTask).toHaveBeenCalledTimes(1);
      expect(onPollingError).toHaveBeenCalledTimes(1);
      expect(mockCheckStatus).not.toHaveBeenCalled();
    });

    it('should throw custom error when provided by onPollingError', async () => {
      const mockTask = vi.fn().mockRejectedValue(new Error('Original error'));
      const mockCheckStatus = vi.fn();

      const customError = new Error('Custom error message');
      const onPollingError = vi.fn().mockReturnValue({
        isContinuePolling: false,
        error: customError,
      });

      await expect(
        asyncifyPolling({
          pollingQuery: mockTask,
          checkStatus: mockCheckStatus,
          onPollingError,
          initialInterval: 1,
        }),
      ).rejects.toThrow('Custom error message');

      expect(onPollingError).toHaveBeenCalledWith({
        error: expect.objectContaining({ message: 'Original error' }),
        retries: 0,
        consecutiveFailures: 1,
      });
    });

    it('should provide correct context information to onPollingError', async () => {
      const mockTask = vi
        .fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockRejectedValueOnce(new Error('Error 3'));

      const mockCheckStatus = vi.fn();

      const onPollingError = vi
        .fn()
        .mockReturnValueOnce({ isContinuePolling: true })
        .mockReturnValueOnce({ isContinuePolling: true })
        .mockReturnValueOnce({ isContinuePolling: false });

      await expect(
        asyncifyPolling({
          pollingQuery: mockTask,
          checkStatus: mockCheckStatus,
          onPollingError,
          initialInterval: 1,
        }),
      ).rejects.toThrow('Error 3');

      // Verify context progression
      expect(onPollingError).toHaveBeenNthCalledWith(1, {
        error: expect.objectContaining({ message: 'Error 1' }),
        retries: 0,
        consecutiveFailures: 1,
      });

      expect(onPollingError).toHaveBeenNthCalledWith(2, {
        error: expect.objectContaining({ message: 'Error 2' }),
        retries: 1,
        consecutiveFailures: 2,
      });

      expect(onPollingError).toHaveBeenNthCalledWith(3, {
        error: expect.objectContaining({ message: 'Error 3' }),
        retries: 2,
        consecutiveFailures: 3,
      });
    });

    it('should fall back to default behavior when onPollingError is not provided', async () => {
      const mockTask = vi
        .fn()
        .mockRejectedValueOnce(new Error('Error 1'))
        .mockRejectedValueOnce(new Error('Error 2'))
        .mockRejectedValueOnce(new Error('Error 3'));

      const mockCheckStatus = vi.fn();

      await expect(
        asyncifyPolling({
          pollingQuery: mockTask,
          checkStatus: mockCheckStatus,
          maxConsecutiveFailures: 2,
          initialInterval: 1,
        }),
      ).rejects.toThrow(/consecutive attempts/);

      expect(mockTask).toHaveBeenCalledTimes(2);
    });
  });
});
