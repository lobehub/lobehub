import { randomUUID } from 'node:crypto';

import { TRPCError } from '@trpc/server';

import { trpc } from '../lambda/init';

/**
 * Prefix of the reference we hand back to the client in place of a raw
 * database error. Kept greppable on purpose: the same `ref` is written to the
 * server log right next to the error it refers to, so support can go from a
 * user-facing string to the exact failure without asking for a timestamp.
 */
export const DATABASE_ERROR_REF_PREFIX = 'db_';

const MAX_CAUSE_DEPTH = 5;

/** PostgreSQL SQLSTATEs are five digits / uppercase letters (`23503`, `23505`, ...). */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

interface DrizzleQueryErrorLike {
  cause?: unknown;
  message?: string;
  name?: string;
  params?: unknown;
  query?: unknown;
}

interface PostgresErrorLike {
  code?: string;
  column?: string;
  constraint?: string;
  table?: string;
}

export interface DatabaseErrorLogEntry {
  column?: string;
  constraint?: string;
  /** The error as it arrived, statement and bound values included. */
  error: unknown;
  ref: string;
  sqlstate?: string;
  table?: string;
}

export interface ToDatabaseTRPCErrorOptions {
  /** Injectable for tests / callers that need deterministic references. */
  createRef?: () => string;
  /** Injectable for tests; production writes the two lines below. */
  log?: (entry: DatabaseErrorLogEntry) => void;
}

const isObjectLike = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object';

/**
 * Drizzle wraps every failed statement / transaction in a `DrizzleQueryError`
 * whose `message` is `` `Failed query: <sql>\nparams: <bound values>` ``, and
 * whose `cause` is the driver error.
 *
 * That wrapper message is what tRPC puts on the wire — and the chat input
 * renders `error.message` verbatim — so a routine constraint violation reaches
 * the user as a wall of SQL plus every bound parameter, including their own
 * message body. Meanwhile the actionable part (SQLSTATE, constraint name) only
 * exists on the driver error, which never leaves the server.
 *
 * We deliberately avoid `instanceof`: the error crosses bundler boundaries
 * (app router / worker bundles carry their own copy of the class), so class
 * identity is not stable. Match the shape Drizzle always produces instead.
 */
export const isDrizzleQueryError = (error: unknown): error is DrizzleQueryErrorLike => {
  if (!isObjectLike(error)) return false;
  if (error.name === 'DrizzleQueryError') return true;

  return (
    typeof error.message === 'string' &&
    error.message.startsWith('Failed query:') &&
    'query' in error &&
    'params' in error
  );
};

/**
 * Walk the cause chain for the driver error. Both `postgres` and the Neon
 * serverless driver expose the SQLSTATE on `code`, plus `constraint` / `table` /
 * `column` for constraint violations.
 *
 * The agent-runtime side has its own richer unwrapper
 * (`apps/server/src/modules/AgentRuntime/pgError.ts`) for the harness error
 * records; it cannot be shared from here because a `packages/*` module must not
 * depend on `apps/*`.
 */
const findPostgresError = (error: unknown): PostgresErrorLike | undefined => {
  let current: unknown = error;

  for (let depth = 0; current && depth < MAX_CAUSE_DEPTH; depth++) {
    if (
      isObjectLike(current) &&
      typeof current.code === 'string' &&
      SQLSTATE_PATTERN.test(current.code)
    ) {
      return current as PostgresErrorLike;
    }

    current = (current as { cause?: unknown }).cause;
  }
};

export const createDatabaseErrorRef = (): string =>
  `${DATABASE_ERROR_REF_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 12)}`;

/**
 * A one-line index (no SQL, no bound values) plus the error itself. The full
 * error is kept on purpose — the client only gets the reference, so the log is
 * the only place the statement and driver diagnostics still exist. Logging both
 * here rather than relying on the route's `onError` also covers callers that
 * never go through an HTTP handler (server-side `createCallerFactory` calls).
 */
const logDatabaseError = (entry: DatabaseErrorLogEntry) => {
  const fields = [`ref=${entry.ref}`, `sqlstate=${entry.sqlstate ?? 'unknown'}`];
  if (entry.constraint) fields.push(`constraint=${entry.constraint}`);
  if (entry.table) fields.push(`table=${entry.table}`);
  if (entry.column) fields.push(`column=${entry.column}`);

  console.error(`[db-error] ${fields.join(' ')}`);
  console.error(`[db-error] ${entry.ref} original`, entry.error);
};

/**
 * Replace a database failure's client-facing message with a neutral one that
 * carries a searchable reference, and keep the failure itself in the server
 * log under that same reference.
 *
 * Returns `undefined` for anything that is not a leaked query, so unrelated
 * 500s keep their original (already-meaningful) message. Codes routers chose
 * deliberately are respected for the same reason as `toUpstreamTRPCError`.
 */
export const toDatabaseTRPCError = (
  error: TRPCError,
  options: ToDatabaseTRPCErrorOptions = {},
): TRPCError | undefined => {
  // Respect codes routers chose deliberately; only reclassify the generic 500.
  if (error.code !== 'INTERNAL_SERVER_ERROR') return;

  let current: unknown = error;
  let leaked: DrizzleQueryErrorLike | undefined;

  for (let depth = 0; current && depth <= MAX_CAUSE_DEPTH; depth++) {
    if (isDrizzleQueryError(current)) {
      leaked = current;
      break;
    }

    current = (current as { cause?: unknown }).cause;
  }

  // Also cover the case where the wrapper survived as the top-level message but
  // the object was flattened somewhere in transit.
  const leaksQuery =
    !!leaked || (typeof error.message === 'string' && error.message.startsWith('Failed query:'));

  if (!leaksQuery) return;

  const ref = (options.createRef ?? createDatabaseErrorRef)();
  const postgres = findPostgresError(leaked ?? error.cause ?? error);

  (options.log ?? logDatabaseError)({
    column: postgres?.column,
    constraint: postgres?.constraint,
    error,
    ref,
    sqlstate: postgres?.code,
    table: postgres?.table,
  });

  // Keep the original as `cause`: tRPC's clients and our own error logger both
  // walk the chain, so the statement stays reachable from the error object.
  return new TRPCError({
    cause: error,
    code: 'INTERNAL_SERVER_ERROR',
    message: `Internal server error (ref: ${ref})`,
  });
};

/**
 * Keep Drizzle's SQL dump out of the client response: the user gets a neutral
 * message plus a reference, the server log keeps the whole error.
 */
export const databaseError = trpc.middleware(async ({ next }) => {
  const result = await next();
  if (result.ok) return result;

  const mapped = toDatabaseTRPCError(result.error);
  if (mapped) throw mapped;

  return result;
});
