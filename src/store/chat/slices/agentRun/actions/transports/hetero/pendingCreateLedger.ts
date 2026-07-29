import type { MessageBatchOperation } from '@/services/message';

type CreateMessageRow = Extract<MessageBatchOperation, { type: 'createMessage' }>['message'];

/**
 * Retry ledger for every failed row create — assistants AND tool rows, in one
 * Map on purpose. `messages.parent_id` is a real FK and the parent graph is not
 * layered: a tool row hangs off its assistant, but a signal/reactive assistant
 * hangs off the run's last TOOL row (see `computeTurnParentId`). Splitting the
 * ledger by role would replay a tool-parented assistant before its parent tool
 * row and lose the turn. Enqueue order IS dependency order — the reducer can
 * only name a parent it has already emitted a create for — and `Map` preserves
 * insertion order, so one in-order drain is correct with no knowledge of which
 * parent kind any given row uses.
 */
export const createPendingCreateLedger = (deps: {
  createMessage: (message: CreateMessageRow) => Promise<unknown>;
  /** The write batcher's flush. Resolves even when the writes inside it failed. */
  flush: (reason: string) => Promise<void>;
}) => {
  const pending = new Map<string, CreateMessageRow>();

  /**
   * Replay the ledger in insertion order (= FK dependency order). Best-effort: a
   * row that fails again stays in the ledger, so callers that need a specific row
   * to exist must re-check afterwards rather than trust this to have emptied it.
   */
  const drain = async () => {
    for (const [messageId, message] of pending) {
      try {
        await deps.createMessage(message);
        pending.delete(messageId);
      } catch (err) {
        console.error('[HeterogeneousAgent] Failed to replay message create:', err);
      }
    }
  };

  return {
    add: (messageId: string, message: CreateMessageRow) => pending.set(messageId, message),

    drain,

    /**
     * Gate a straight-through write on its FK parent actually existing in the DB.
     *
     * The main row a subagent hangs off is only *enqueued* into the write batcher,
     * while subagent rows are written straight through — so without a barrier the
     * child can reach the DB before its parent and Postgres rejects it against
     * `messages_parent_id_messages_id_fk`.
     *
     * Draining the batcher is necessary but NOT sufficient: a create that fails
     * inside the batcher is reported only through its `onFailure` (which parks it
     * here) and `flush` resolves regardless, so an awaited flush says nothing about
     * whether the parent landed. Replay the ledger too, then refuse to proceed while
     * the parent is still missing — walking into the FK error would skip the run's
     * state commit and strand another `Processing` thread on every retry
     * (`threads.source_message_id` has no FK, so the thread create keeps succeeding).
     */
    ensureParentPersisted: async (parentId?: string) => {
      await deps.flush('before-subagent-write');

      if (pending.size > 0) await drain();

      if (parentId && pending.has(parentId)) {
        throw new Error(
          `[HeterogeneousAgent] refusing to write a row against missing FK parent ${parentId}`,
        );
      }
    },

    has: (messageId: string) => pending.has(messageId),

    get size() {
      return pending.size;
    },
  };
};
