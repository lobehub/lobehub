/** Postgres SQLSTATE for `unique_violation`. */
export const PG_UNIQUE_VIOLATION = '23505';

interface PgErrorFields {
  cause?: unknown;
  code?: unknown;
  constraint?: string;
  detail?: string;
}

/**
 * Returns the driver error that carries a Postgres unique violation, or
 * `undefined` for any other error.
 *
 * drizzle (0.45+) wraps every driver error in a `DrizzleQueryError`, so the
 * SQLSTATE and its diagnostics live on `error.cause`. A driver error that
 * reaches us unwrapped (raw client calls, node-postgres or PGlite alike)
 * carries them on the error itself, so read both levels.
 */
export const getUniqueViolation = (error: unknown): PgErrorFields | undefined => {
  if (!error || typeof error !== 'object') return undefined;

  const pgError = error as PgErrorFields;
  if (pgError.code === PG_UNIQUE_VIOLATION) return pgError;

  const cause = pgError.cause as PgErrorFields | undefined;
  if (cause && typeof cause === 'object' && cause.code === PG_UNIQUE_VIOLATION) return cause;

  return undefined;
};

export const isUniqueViolation = (error: unknown): boolean => !!getUniqueViolation(error);

/**
 * The violated constraint name when `error` is a unique violation, `''` when
 * the driver did not report one, and `undefined` for any other error.
 */
export const uniqueViolationConstraint = (error: unknown): string | undefined => {
  const violation = getUniqueViolation(error);
  return violation ? (violation.constraint ?? '') : undefined;
};
