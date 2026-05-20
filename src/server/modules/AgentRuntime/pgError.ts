/**
 * Helpers for extracting PostgreSQL error diagnostics from errors thrown by
 * the `drizzle-orm` + `postgres-js` (or `pg`) stack.
 *
 * Drizzle wraps the underlying driver error as `.cause`; some paths double-wrap
 * (e.g. transaction runners), so walking a few layers is necessary. Without
 * unwrapping, the runtime only sees the generic `"Failed query: insert into ..."`
 * wrapper message, which strips every diagnostic field the Agent Harness
 * dashboard needs to classify the failure (see LOBE-7158 / LOBE-7334).
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

export interface PgErrorInfo {
  code?: string;
  column?: string;
  constraint?: string;
  detail?: string;
  message: string;
  severity?: string;
  table?: string;
}

/**
 * PG `severity` values that appear on driver errors. Used as a duck-type
 * signature to distinguish real PG errors from unrelated objects that happen
 * to have a `code` string (e.g. Node `ERR_*` errors, fetch failures).
 */
const PG_SEVERITIES = new Set([
  'ERROR',
  'FATAL',
  'PANIC',
  'WARNING',
  'NOTICE',
  'DEBUG',
  'INFO',
  'LOG',
]);

const MAX_CAUSE_DEPTH = 5;

const looksLikePgError = (value: any): boolean =>
  !!value &&
  typeof value === 'object' &&
  typeof value.code === 'string' &&
  typeof value.severity === 'string' &&
  PG_SEVERITIES.has(value.severity);

/**
 * Walk the `.cause` chain up to {@link MAX_CAUSE_DEPTH} layers looking for an
 * object shaped like a raw PG driver error. Returns its diagnostic fields
 * flattened into {@link PgErrorInfo}, or `null` if no PG layer is found.
 *
 * Field aliases covered:
 *   - `constraint` / `constraint_name` (postgres-js vs pg)
 */
export const unwrapPgError = (error: unknown): PgErrorInfo | null => {
  let current: any = error;
  for (let i = 0; i < MAX_CAUSE_DEPTH && current && typeof current === 'object'; i++) {
    if (looksLikePgError(current)) {
      return {
        code: current.code,
        column: current.column,
        constraint: current.constraint ?? current.constraint_name,
        detail: current.detail,
        message: typeof current.message === 'string' ? current.message : 'PG error',
        severity: current.severity,
        table: current.table ?? current.table_name,
      };
    }
    current = current.cause;
  }
  return null;
};

/**
 * Format a {@link PgErrorInfo} as a single-line human-readable string suitable
 * for the `error` field of a runtime stream event. Fields are joined with
 * ` · ` so downstream log viewers stay greppable.
 */
export const formatPgError = (info: PgErrorInfo): string =>
  [
    `PG ${info.code ?? '?'}`,
    info.severity,
    info.message,
    info.detail && `detail=${info.detail}`,
    info.table && `table=${info.table}`,
    info.column && `column=${info.column}`,
    info.constraint && `constraint=${info.constraint}`,
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * Stable `errorType` tag derived from the PG SQLSTATE code. Agent Harness
 * dashboards bucket errors by `errorType` — using a fine-grained `pg_<code>`
 * keeps distinct PG failures (e.g. 22021 invalid UTF-8 vs 23505 unique
 * violation vs 54000 row-too-big) in separate buckets instead of collapsing
 * them all under a generic "DatabaseError".
 */
export const pgErrorType = (info: PgErrorInfo): string => `pg_${info.code ?? 'unknown'}`;
