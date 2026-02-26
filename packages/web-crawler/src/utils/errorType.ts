export class PageNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageNotFoundError';
  }
}
export class NetworkConnectionError extends Error {
  constructor() {
    super('Network connection error');
    this.name = 'NetworkConnectionError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Check if an error is a Node.js fetch network failure.
 * Node.js undici throws TypeError with message "fetch failed" on network errors.
 */
export const isFetchNetworkError = (error: unknown): boolean =>
  error instanceof TypeError && (error as Error).message === 'fetch failed';

/**
 * Normalize a fetch error into a typed error for consistent handling.
 * Converts network failures to `NetworkConnectionError`, passes through `TimeoutError`,
 * and returns any other error unchanged. Callers should `throw` the returned value.
 *
 * @example
 * ```ts
 * } catch (e) {
 *   throw toFetchError(e);
 * }
 * ```
 */
export const toFetchError = (error: unknown): Error => {
  if (isFetchNetworkError(error)) {
    return new NetworkConnectionError();
  }

  if (error instanceof TimeoutError) {
    return error;
  }

  return error as Error;
};
