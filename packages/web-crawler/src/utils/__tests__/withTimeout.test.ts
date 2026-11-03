import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeoutError } from '../errorType';
import { DEFAULT_TIMEOUT, withTimeout } from '../withTimeout';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should resolve when factory function resolves before timeout', async () => {
    const result = await withTimeout(() => Promise.resolve('success'), 1000);
    expect(result).toBe('success');
  });

  it('should reject with TimeoutError when factory takes too long', async () => {
    const fn = () =>
      new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 200);
      });

    const timeoutPromise = withTimeout(fn, 100);
    vi.advanceTimersByTime(100);

    await expect(timeoutPromise).rejects.toThrow(TimeoutError);
    await expect(timeoutPromise).rejects.toThrow('Request timeout after 100ms');
  });

  it('should use DEFAULT_TIMEOUT when no timeout specified', async () => {
    const fn = () =>
      new Promise((resolve) => {
        setTimeout(() => resolve('success'), DEFAULT_TIMEOUT + 100);
      });

    const timeoutPromise = withTimeout(fn);
    vi.advanceTimersByTime(DEFAULT_TIMEOUT);

    await expect(timeoutPromise).rejects.toThrow(TimeoutError);
    await expect(timeoutPromise).rejects.toThrow(`Request timeout after ${DEFAULT_TIMEOUT}ms`);
  });

  it('should reject with original error if factory rejects before timeout', async () => {
    const error = new Error('Original error');
    const fn = () => Promise.reject(error);

    await expect(withTimeout(fn, 1000)).rejects.toThrow('Original error');
  });

  it('should pass AbortSignal to the factory function', async () => {
    const factoryFn = vi.fn().mockResolvedValue('result');
    await withTimeout(factoryFn, 1000);

    expect(factoryFn).toHaveBeenCalledTimes(1);
    const signal = factoryFn.mock.calls[0][0];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it('should abort the signal when timeout occurs', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fn = (signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise((resolve) => {
        setTimeout(() => resolve('too late'), 2000);
      });
    };

    const timeoutPromise = withTimeout(fn, 100);
    expect(capturedSignal!.aborted).toBe(false);

    vi.advanceTimersByTime(100);
    await expect(timeoutPromise).rejects.toThrow(TimeoutError);

    expect(capturedSignal!.aborted).toBe(true);
  });

  it('should clear timeout timer when promise resolves successfully', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    await withTimeout(() => Promise.resolve('success'), 5000);

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('should clear timeout timer when promise rejects', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    await expect(withTimeout(() => Promise.reject(new Error('fail')), 5000)).rejects.toThrow(
      'fail',
    );

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
