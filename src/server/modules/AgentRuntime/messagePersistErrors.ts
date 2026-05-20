import { AgentRuntimeErrorType } from '@lobechat/types';

/**
 * Postgres error code for `foreign_key_violation`.
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_FOREIGN_KEY_VIOLATION = '23503';

/**
 * Constraint name drizzle generates for the `messages.parent_id` self-FK.
 * Hard-coded because we only use it as a signature — no need to reflect over
 * the schema at runtime.
 */
const MESSAGES_PARENT_FK_CONSTRAINT = 'messages_parent_id_messages_id_fk';

/**
 * Internal property the runtime uses to mark a thrown error as coming from
 * the persist path (inside a `Promise.all` mapper that has its own outer
 * catch). The outer catch re-throws anything carrying this marker so the
 * whole batch short-circuits.
 */
export const PERSIST_FATAL_MARKER = 'persistFatal';

/**
 * Detect whether an error returned by `messageModel.create` is a `parent_id`
 * FK violation — meaning the parent message no longer exists. Most commonly
 * caused by the parent being deleted concurrently with agent execution
 * (see LOBE-7154 / LOBE-7158).
 *
 * `drizzle` + `postgres-js` wrap the raw PG error as `.cause`, so the check
 * looks at both the top level and the cause.
 */
export const isParentMessageMissingError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const err = error as any;
  const code = err?.code ?? err?.cause?.code;
  const constraint =
    err?.constraint_name ??
    err?.constraint ??
    err?.cause?.constraint_name ??
    err?.cause?.constraint;
  return code === PG_FOREIGN_KEY_VIOLATION && constraint === MESSAGES_PARENT_FK_CONSTRAINT;
};

/**
 * Build a structured `ConversationParentMissing` error that downstream layers
 * (stream events, error classifiers, frontend) can identify and render with
 * an actionable message instead of a raw SQL error.
 */
export const createConversationParentMissingError = (parentId: string, cause?: unknown) => {
  const error = new Error(
    `Conversation parent message ${parentId} no longer exists. It was likely deleted while the operation was running.`,
  );
  (error as any).errorType = AgentRuntimeErrorType.ConversationParentMissing;
  (error as any).parentId = parentId;
  if (cause !== undefined) (error as any).cause = cause;
  return error;
};

/**
 * Tag an error so the outer `Promise.all` catch propagates it instead of
 * bundling it into `events` as a per-tool failure.
 */
export const markPersistFatal = <T>(error: T): T => {
  if (error && typeof error === 'object') {
    (error as any)[PERSIST_FATAL_MARKER] = true;
  }
  return error;
};

export const isPersistFatal = (error: unknown): boolean =>
  !!error && typeof error === 'object' && !!(error as any)[PERSIST_FATAL_MARKER];
