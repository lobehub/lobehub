import { AgentRuntimeErrorType } from '@lobechat/types';

/**
 * Postgres error code for `foreign_key_violation`.
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_FOREIGN_KEY_VIOLATION = '23503';

/**
 * Constraint names drizzle generates for the `messages` foreign keys that point
 * at rows a user can delete *while an operation is still running* — the parent /
 * quota message, the topic, the agent, the session, the thread. When any of
 * these rows is removed mid-flight, the assistant/tool-message INSERT fails with
 * a 23503 foreign_key_violation. That's a lost race against the user, not a
 * runtime bug.
 *
 * Hard-coded because we only use them as signatures — no need to reflect over
 * the schema at runtime. An entry for a constraint that doesn't exist is a
 * harmless no-op.
 */
const MID_OPERATION_DELETABLE_FK_CONSTRAINTS = new Set([
  'messages_parent_id_messages_id_fk', // parent message deleted
  'messages_quota_id_messages_id_fk', // quota (root) message deleted
  'messages_topic_id_topics_id_fk', // topic deleted
  'messages_agent_id_agents_id_fk', // agent deleted
  'messages_session_id_sessions_id_fk', // session deleted
  'messages_thread_id_threads_id_fk', // thread deleted
]);

/**
 * Internal property the runtime uses to mark a thrown error as coming from
 * the persist path (inside a `Promise.all` mapper that has its own outer
 * catch). The outer catch re-throws anything carrying this marker so the
 * whole batch short-circuits.
 */
export const PERSIST_FATAL_MARKER = 'persistFatal';

/**
 * Detect whether an error returned by `messageModel.create` is a foreign-key
 * violation on one of the mid-operation-deletable `messages` references — the
 * parent / quota message, topic, agent, session or thread no longer exists,
 * almost always because the user deleted that context concurrently with agent
 * execution.
 *
 * Previously this only matched the `parent_id` self-FK, so topic / agent / etc.
 * deletions slipped through as raw `Failed query: insert into "messages"` 500s
 * (DatabasePersistError noise on the dashboard) instead of the typed user-side
 * error.
 *
 * `drizzle` + `postgres-js` wrap the raw PG error as `.cause`, so the check
 * looks at both the top level and the cause.
 */
export const isMidOperationReferenceMissingError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const err = error as any;
  const code = err?.code ?? err?.cause?.code;
  const constraint =
    err?.constraint_name ??
    err?.constraint ??
    err?.cause?.constraint_name ??
    err?.cause?.constraint;
  return (
    code === PG_FOREIGN_KEY_VIOLATION &&
    typeof constraint === 'string' &&
    MID_OPERATION_DELETABLE_FK_CONSTRAINTS.has(constraint)
  );
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
