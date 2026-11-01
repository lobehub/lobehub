/**
 * The target server authoritatively confirmed the page does not exist (HTTP 404/410).
 * This is a final answer, not a transient failure — retrying it (or asking another
 * provider) only re-buys the same "nothing here" and, for metered providers, is billed.
 */
export class PageNotFoundError extends Error {
  status: number;

  constructor(message: string, status: number = 404) {
    super(message);
    this.name = 'PageNotFoundError';
    this.status = status;
  }
}

/**
 * The input could not be turned into an absolute http(s) URL even after normalization
 * (bare text, unsupported scheme, ...). Nothing was sent to any provider.
 */
export class InvalidUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUrlError';
  }
}

/**
 * The URL points at a resource file (image / font / video / archive ...) that has no
 * readable body. Nothing was sent to any provider.
 */
export class UnsupportedContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedContentError';
  }
}

/**
 * A crawl provider answered with a non-2xx status that is not a dead link.
 * `status` lets callers decide whether the failure is transient (5xx / 429 / 408)
 * or a rejected request (other 4xx) that will fail the same way on retry.
 */
export class HTTPStatusError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HTTPStatusError';
    this.status = status;
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

const RETRYABLE_HTTP_STATUS = new Set([408, 429]);

/**
 * Whether re-issuing the exact same crawl could plausibly succeed.
 *
 * - dead link (404/410), invalid URL, resource file: authoritative → never retry
 * - provider 4xx other than 408/429: request was rejected → never retry
 * - network / timeout / 5xx / 429 / 408 / empty body: transient → retry is fine
 */
export const isRetryableCrawlError = (error: unknown): boolean => {
  if (
    error instanceof PageNotFoundError ||
    error instanceof InvalidUrlError ||
    error instanceof UnsupportedContentError
  ) {
    return false;
  }

  if (error instanceof HTTPStatusError) {
    return error.status >= 500 || RETRYABLE_HTTP_STATUS.has(error.status);
  }

  return true;
};

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
