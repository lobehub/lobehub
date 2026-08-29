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
 * Retries lock-sensitive migrations from a fresh Drizzle transaction.
 *
 * PostgreSQL releases every DDL lock when a migration attempt rolls back, so retrying the whole
 * migrator is safer than waiting longer while earlier tables remain locked.
 */
export const runMigrationWithLockRetry = async (
  migrate: () => Promise<void>,
  wait: Wait = defaultWait,
): Promise<void> => {
  for (let attempt = 0; ; attempt++) {
    try {
      await migrate();
      return;
    } catch (error) {
      const delayMs = LOCK_RETRY_DELAYS_MS[attempt];
      if (!isLockTimeoutError(error) || delayMs === undefined) throw error;

      console.warn(
        'Database migration lock timed out; retrying the full migration in %d ms (%d/%d)',
        delayMs,
        attempt + 1,
        LOCK_RETRY_DELAYS_MS.length,
      );
      await wait(delayMs);
    }
  }
};
