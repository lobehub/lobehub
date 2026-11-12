const TRANSIENT_ERROR_TYPES = new Set(['ProviderServiceUnavailable']);
const TRANSIENT_STATUS = new Set([502, 503, 504, 529]);
// Matched on the message too: providers report outages as plain text more often than as types.
const TRANSIENT_MESSAGE =
  /\b(502|503|504|529)\b|temporarily unavailable|overloaded|high demand|ECONNRESET|ETIMEDOUT|socket hang up/i;

const readField = (value: unknown, key: string): unknown =>
  value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;

// Wrapped provider errors keep their own message and put the real cause underneath, up to a few
// levels deep (SDK error -> wrapper -> socket error). The top-level message alone loses the cause.
const MAX_NESTED_DEPTH = 3;
const NESTED_KEYS = ['message', 'code', 'error', 'cause'] as const;

const inspectError = (error: unknown): { messages: string[]; statuses: number[] } => {
  const messages: string[] = [];
  const statuses: number[] = [];
  const seen = new Set<unknown>();

  const visit = (value: unknown, depth: number) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string') {
      messages.push(value);
      return;
    }
    // Only objects recurse, so strings at the bottom of the chain are always read.
    if (typeof value !== 'object' || depth > MAX_NESTED_DEPTH || seen.has(value)) return;
    seen.add(value);

    const record = value as Record<string, unknown>;
    const status = record.status;
    if (typeof status === 'number') statuses.push(status);
    for (const key of NESTED_KEYS) visit(record[key], depth + 1);
  };

  visit(error, 0);
  return { messages, statuses };
};

/**
 * Whether a model call failed for a reason worth retrying: the provider was briefly down or
 * overloaded. Quota, budget, auth and content errors are not transient and fail at once.
 */
export const isTransientModelError = (error: unknown): boolean => {
  const errorType = readField(error, 'errorType');
  if (typeof errorType === 'string' && TRANSIENT_ERROR_TYPES.has(errorType)) return true;
  const { messages, statuses } = inspectError(error);
  if (statuses.some((status) => TRANSIENT_STATUS.has(status))) return true;
  return messages.some((message) => TRANSIENT_MESSAGE.test(message));
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
