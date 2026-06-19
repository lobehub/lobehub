import { pickNonEmptyString, toRecord } from '@lobechat/utils/object';

import { formatErrorForState } from './formatErrorForState';
import { formatPgError, pgErrorType, unwrapPgError } from './pgError';

const isErrorType = (value: unknown): value is string | number =>
  typeof value === 'string' || typeof value === 'number';

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
 * See for the motivation: Drizzle wraps driver errors
 * as `"Failed query: insert into ..."` and buries the real diagnostic fields
 * under `.cause`, which left the agent-gateway dashboard unable to bucket
 * DB failures by SQLSTATE.
 */
export const formatErrorEventData = (error: unknown, phase: string) => {
  const payload = toRecord(error);
  const rawPayloadErrorType = payload?.errorType ?? payload?.type;
  const payloadErrorType = isErrorType(rawPayloadErrorType) ? rawPayloadErrorType : undefined;
  const structuredError =
    error instanceof Error || payloadErrorType === undefined
      ? undefined
      : formatErrorForState(payload);
  const body = structuredError?.body;
  const hasPayloadErrorType = payloadErrorType !== undefined;
  let errorType = hasPayloadErrorType
    ? String(structuredError?.type ?? payloadErrorType)
    : undefined;
  const payloadError = payload?.error;
  let errorMessage =
    pickNonEmptyString(structuredError?.message) ??
    pickNonEmptyString(payload?.message) ??
    pickNonEmptyString(payloadError) ??
    pickNonEmptyString(toRecord(payloadError)?.message) ??
    (error instanceof Error ? pickNonEmptyString(error.message) : pickNonEmptyString(error)) ??
    errorType ??
    'Unknown error';

  if (!errorType && error instanceof Error && error.name) {
    errorType = error.name;
  }

  // Enrichment: run PG unwrap whenever no payload errorType was
  // declared. This covers both Drizzle-wrapped errors (PG info under .cause)
  // AND raw top-level driver errors like `PostgresError` / `DatabaseError`
  // which carry a specific `name` but are still real PG errors deserving
  // `pg_<sqlstate>` classification on the dashboard.
  if (!hasPayloadErrorType) {
    const pg = unwrapPgError(error);
    if (pg) {
      errorMessage = formatPgError(pg);
      errorType = pgErrorType(pg);
    }
  }

  return {
    ...(body === undefined ? {} : { body }),
    error: errorMessage,
    errorType,
    phase,
  };
};
