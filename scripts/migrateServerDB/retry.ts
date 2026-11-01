const LOCK_TIMEOUT_CODE = '55P03';
const LOCK_RETRY_DELAYS_MS = [1000, 3000] as const;

type Wait = (delayMs: number) => Promise<void>;

const defaultWait: Wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

const isLockTimeoutError = (error: unknown): boolean => {
  const seen = new Set<unknown>();
  let current = error;

  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if ('code' in current && current.code === LOCK_TIMEOUT_CODE) return true;
    current = 'cause' in current ? current.cause : undefined;
  }

  return false;
};

/**
 * Retries a lock-sensitive database operation after PostgreSQL lock timeouts.
 *
 * Callers must ensure that each failed attempt either rolls back all partial changes before
 * rejecting or is idempotent, because this helper invokes the operation again from its beginning.
 * PostgreSQL releases transaction-scoped locks when an attempt rolls back, so retrying the whole
 * operation is safer than waiting longer while earlier work remains locked.
 */
export const runWithLockRetry = async (
  operation: () => Promise<void>,
  wait: Wait = defaultWait,
): Promise<void> => {
  for (let attempt = 0; ; attempt++) {
    try {
      await operation();
      return;
    } catch (error) {
      const delayMs = LOCK_RETRY_DELAYS_MS[attempt];
      if (!isLockTimeoutError(error) || delayMs === undefined) throw error;

      console.warn(
        'Database operation lock timed out; retrying the operation in %d ms (%d/%d)',
        delayMs,
        attempt + 1,
        LOCK_RETRY_DELAYS_MS.length,
      );
      await wait(delayMs);
    }
  }
};
