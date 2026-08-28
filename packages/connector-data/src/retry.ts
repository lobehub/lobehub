import { ConnectorDataError } from './errors';

const DEFAULT_ATTEMPTS = 3;
const FIRST_RETRY_DELAY_MS = 250;
const SECOND_RETRY_DELAY_MS = 500;
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
]);

export type ConnectorRetryDelay = (milliseconds: number) => Promise<void>;

export interface ConnectorRetryOptions {
  /** Delay implementation used between retry attempts. */
  delay?: ConnectorRetryDelay;
}

const defaultDelay: ConnectorRetryDelay = async (milliseconds) => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const getRetryDelay = (attempt: number) =>
  attempt === 0 ? FIRST_RETRY_DELAY_MS : SECOND_RETRY_DELAY_MS;

const getErrorStatus = (error: unknown): number | undefined => {
  if (typeof error !== 'object' || error === null) return;

  const { response, status, statusCode } = error as {
    response?: { status?: unknown };
    status?: unknown;
    statusCode?: unknown;
  };
  const candidate = status ?? statusCode ?? response?.status;

  return typeof candidate === 'number' ? candidate : undefined;
};

const getErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return;

  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
};

/**
 * Determines whether a connector failure can be retried without user intervention.
 *
 * Use when:
 * - Retrying raw upstream failures
 * - Persisting provider diagnostics after retries finish
 *
 * Expects:
 * - A raw upstream error or connector-owned protocol error
 *
 * Returns:
 * - Whether the failure matches the connector retry policy
 */
export const isConnectorErrorRetryable = (error: unknown) => {
  if (error instanceof ConnectorDataError) return error.retryable;

  const status = getErrorStatus(error);
  if (status !== undefined) {
    if (status === 401 || status === 403 || status === 404) return false;

    return TRANSIENT_HTTP_STATUSES.has(status);
  }

  const code = getErrorCode(error);
  return code !== undefined && TRANSIENT_NETWORK_CODES.has(code);
};

/**
 * Retries transient connector operations and rethrows the original terminal error.
 *
 * Use when:
 * - Calling an external connector transport with bounded retries
 *
 * Expects:
 * - The operation throws its original upstream or connector-owned error
 *
 * Returns:
 * - The successful operation result without wrapping terminal failures
 */
export const withConnectorRetry = async <T>(
  operation: () => Promise<T>,
  { delay = defaultDelay }: ConnectorRetryOptions = {},
): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const retryable = isConnectorErrorRetryable(error);
      const canRetry = attempt < DEFAULT_ATTEMPTS - 1 && retryable;

      if (!canRetry) throw error;
      await delay(getRetryDelay(attempt));
    }
  }
};
