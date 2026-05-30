import debug from 'debug';

const log = debug('lobe-server:memory:user-memory:retry');

export interface RetryOptions {
  baseDelayMs: number;
  maxRetries: number;
}

/**
 * Retry an async function with exponential backoff and jitter.
 * Only retries on transient errors (network/timeout/rate-limit).
 * Re-throws immediately for non-transient errors.
 */
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> => {
  const { baseDelayMs, maxRetries } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries || !isTransientError(error)) {
        throw error;
      }

      const delay = Math.floor(baseDelayMs * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5));
      log('retrying after %dms (attempt %d/%d): %s', delay, attempt + 1, maxRetries, errorMessage(error));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};

const isTransientError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;

  const msg = error.message.toLowerCase();
  const code = (error as NodeJS.ErrnoException).code;

  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED') return true;
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests')) return true;
  if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('socket hang up')) return true;
  if (msg.includes('503') || msg.includes('502') || msg.includes('service unavailable')) return true;

  return false;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};
