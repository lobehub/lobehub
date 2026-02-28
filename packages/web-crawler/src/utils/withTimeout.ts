import { TimeoutError } from './errorType';

export const DEFAULT_TIMEOUT = 10_000;

/**
 * Wraps a factory function with a timeout and abort support.
 * The factory receives an AbortSignal that is aborted on timeout,
 * allowing the underlying request (e.g. fetch) to be properly cancelled.
 * @param fn Factory function that receives an AbortSignal and returns a Promise
 * @param ms Timeout in milliseconds
 */
export const withTimeout = <T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number = DEFAULT_TIMEOUT,
): Promise<T> => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`Request timeout after ${ms}ms`));
    }, ms);
  });

  return Promise.race([
    fn(controller.signal).finally(() => clearTimeout(timeoutId)),
    timeoutPromise,
  ]);
};
