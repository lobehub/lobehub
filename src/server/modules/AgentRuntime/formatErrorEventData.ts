import { formatPgError, pgErrorType, unwrapPgError } from './pgError';

/**
 * Normalize an arbitrary thrown value into the shape the runtime stream-event
 * protocol expects. Extracts a human-readable `error` string and a best-effort
 * `errorType` bucket key.
 *
 * Precedence:
 *   1. Business-typed errors that carry an `errorType` string on the error
 *      object itself (e.g. `ConversationParentMissing`) — kept as-is with
 *      their original message. These already mean something specific and
 *      must not be reclassified.
 *   2. PostgreSQL errors — detected anywhere in the `.cause` chain OR at the
 *      top level (driver classes like `PostgresError` / `DatabaseError`
 *      carry their own `name` but no business-typed `errorType`). Emitted as
 *      `pg_<sqlstate>` with a formatted single-line diagnostic.
 *   3. Anything else — falls back to `error.message` + `error.name`, or
 *      `"Unknown error"` when the value isn't even an Error.
 *
 * See LOBE-7158 / LOBE-7334 for the motivation: Drizzle wraps driver errors
 * as `"Failed query: insert into ..."` and buries the real diagnostic fields
 * under `.cause`, which left the agent-gateway dashboard unable to bucket
 * DB failures by SQLSTATE.
 */
export const formatErrorEventData = (error: unknown, phase: string) => {
  let errorMessage = 'Unknown error';
  let errorType: string | undefined;
  // True when `errorType` came from a business-typed field on the error
  // payload (step 1 above). Driver class names assigned via `error.name`
  // do NOT set this flag, so raw `PostgresError` / `DatabaseError` instances
  // still fall through to the PG unwrap step.
  let hasBusinessErrorType = false;

  if (error && typeof error === 'object') {
    const payload = error as { error?: unknown; errorType?: unknown; message?: unknown };

    if (typeof payload.errorType === 'string') {
      errorType = payload.errorType;
      hasBusinessErrorType = true;
    }

    if (typeof payload.message === 'string' && payload.message.length > 0) {
      errorMessage = payload.message;
    } else if (typeof payload.error === 'string' && payload.error.length > 0) {
      errorMessage = payload.error;
    } else if (
      payload.error &&
      typeof payload.error === 'object' &&
      'message' in payload.error &&
      typeof payload.error.message === 'string'
    ) {
      errorMessage = payload.error.message;
    } else if (error instanceof Error && error.message.length > 0) {
      errorMessage = error.message;
    } else if (errorType) {
      errorMessage = errorType;
    }
  } else if (error instanceof Error && error.message.length > 0) {
    errorMessage = error.message;
    errorType = error.name;
  } else if (typeof error === 'string' && error.length > 0) {
    errorMessage = error;
  }

  if (!errorType && error instanceof Error && error.name) {
    errorType = error.name;
  }

  // Enrichment: run PG unwrap whenever no *business-typed* errorType was
  // declared. This covers both Drizzle-wrapped errors (PG info under .cause)
  // AND raw top-level driver errors like `PostgresError` / `DatabaseError`
  // which carry a specific `name` but are still real PG errors deserving
  // `pg_<sqlstate>` classification on the dashboard.
  if (!hasBusinessErrorType) {
    const pg = unwrapPgError(error);
    if (pg) {
      errorMessage = formatPgError(pg);
      errorType = pgErrorType(pg);
    }
  }

  return {
    error: errorMessage,
    errorType,
    phase,
  };
};
