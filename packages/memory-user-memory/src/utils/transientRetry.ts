const TRANSIENT_ERROR_TYPES = new Set(['ProviderServiceUnavailable']);
const TRANSIENT_STATUS = new Set([502, 503, 504, 529]);
// Matched on the message too: providers report outages as plain text more often than as types.
const TRANSIENT_MESSAGE =
  /\b(502|503|504|529)\b|temporarily unavailable|overloaded|high demand|ECONNRESET|ETIMEDOUT|socket hang up/i;

const readField = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;

const messageOf = (error: unknown): string => {
  const message = readField(error, 'message');
  if (typeof message === 'string') return message;
  const nested = readField(readField(readField(error, 'error'), 'error'), 'message');
  if (typeof nested === 'string') return nested;
  const inner = readField(readField(error, 'error'), 'message');
  return typeof inner === 'string' ? inner : typeof error === 'string' ? error : '';
};

/**
 * Whether a model call failed for a reason worth retrying: the provider was briefly down or
 * overloaded. Quota, budget, auth and content errors are not transient and fail at once.
 */
export const isTransientModelError = (error: unknown): boolean => {
  const errorType = readField(error, 'errorType');
  if (typeof errorType === 'string' && TRANSIENT_ERROR_TYPES.has(errorType)) return true;
  for (const status of [readField(error, 'status'), readField(readField(error, 'error'), 'status')])
    if (typeof status === 'number' && TRANSIENT_STATUS.has(status)) return true;
  return TRANSIENT_MESSAGE.test(messageOf(error));
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a model call, retrying transient provider failures with a growing delay. Each call already
 * sits inside a workflow step, so a few seconds of waiting beats failing the whole extraction.
 */
export const withTransientRetry = async <T>(
  call: () => Promise<T>,
  { delaysMs = [2000, 6000] }: { delaysMs?: number[] } = {},
): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= delaysMs.length || !isTransientModelError(error)) throw error;
      await sleep(delaysMs[attempt]);
    }
  }
};
