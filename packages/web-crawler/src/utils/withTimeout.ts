import { TimeoutError } from './errorType';

export const DEFAULT_TIMEOUT = 10_000;

/**
 * Wraps a promise with a timeout
 * @param promise Promise to wrap
 * @param ms Timeout in milliseconds
 * @returns Promise that will be rejected if it takes longer than ms to resolve
 */
export const withTimeout = <T>(promise: Promise<T>, ms: number = DEFAULT_TIMEOUT): Promise<T> => {
  const controller = new AbortController();
  const timeoutPromise = new Promise<T>((_, reject) => {
    setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`Request timeout after ${ms}ms`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]);
};
