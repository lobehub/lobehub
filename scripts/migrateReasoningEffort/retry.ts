import pg from 'pg';

/**
 * Whether a failed migration task may be rerun. Only an error PostgreSQL itself returned carries a
 * SQLSTATE; Node socket errors also set `code` (`ECONNRESET`, `ETIMEDOUT`, `EPIPE`), so `code`
 * alone cannot tell them apart. Connection failures and client timeouts are retried, as is
 * SQLSTATE class `08` (connection exception); any other server error would fail again.
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export const isRetryableError = (error: unknown): boolean => {
  if (!(error instanceof pg.DatabaseError)) return true;
  return error.code?.startsWith('08') ?? false;
};
