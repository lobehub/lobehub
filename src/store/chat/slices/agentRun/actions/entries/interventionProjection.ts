import { type ToolIntervention } from '@lobechat/types';

import { type OptimisticUpdateContext } from '@/store/chat/slices/message/actions/optimisticUpdate';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import { type ChatStore } from '@/store/chat/store';

/**
 * Write an intervention state onto both projections the UI reads: the tool
 * row's own `pluginIntervention` (what the pending-card list is built from)
 * and the parent assistant's tool entry (inline row), so every subscribed
 * surface agrees immediately.
 *
 * Local only. For `resolving` that is the whole point — it describes this
 * client's in-flight publish, not durable truth, and a slow write could land
 * after the producer's terminal ACK and resurrect a settled card. For a
 * terminal settle it is the fast half: the durable write follows separately,
 * and the card must not wait on it to leave the screen.
 */
const dispatchInterventionState = (
  get: () => ChatStore,
  toolMessageId: string,
  patch: Partial<ToolIntervention>,
  context: OptimisticUpdateContext,
): void => {
  const message = dbMessageSelectors.getDbMessageById(toolMessageId)(get());
  if (!message) return;

  const intervention = { ...message.pluginIntervention, ...patch };
  get().internal_dispatchMessage(
    { id: toolMessageId, type: 'updateMessage', value: { pluginIntervention: intervention } },
    context,
  );
  if (message.parentId && message.tool_call_id) {
    get().internal_dispatchMessage(
      {
        id: message.parentId,
        tool_call_id: message.tool_call_id,
        type: 'updateMessageTools',
        value: { intervention },
      },
      context,
    );
  }
};

/**
 * Bind the intervention projection writers to one chat store.
 *
 * `applyLocalDecision` shows an approve/reject decision on the card the instant
 * the user clicks. A Gateway resume only echoes the decision after the server
 * claim and the new op's start request return, which kept the card spinning for
 * seconds. The decision goes to the local projections only: the server claims
 * the row atomically and requires it to still be `pending`, so it must never be
 * persisted here.
 *
 * Until the server answers, each card keeps a rollback:
 * - `settle` drops it once the server owns the decision (claimed, or, through
 *   `settleAfter`, a local runtime persisted it).
 * - `rollback` restores the card when the resume fails, and before an
 *   authoritative refresh, whose merge would otherwise keep the newer local
 *   terminal state over the server's.
 */
export const createInterventionProjection = (get: () => ChatStore) => {
  const rollbacks = new Map<string, () => void>();
  /** The pre-decision state, kept from the first of nested decisions on one card. */
  const originals = new Map<string, ToolIntervention | undefined>();

  const rollback = (toolMessageIds: readonly string[]) => {
    for (const id of toolMessageIds) {
      rollbacks.get(id)?.();
      settle([id]);
    }
  };

  const settle = (toolMessageIds: readonly string[]) => {
    for (const id of toolMessageIds) {
      rollbacks.delete(id);
      originals.delete(id);
    }
  };

  const applyLocalDecision = (
    toolMessageIds: readonly string[],
    decision: Partial<ToolIntervention>,
    context: OptimisticUpdateContext,
  ): (() => void) => {
    for (const id of toolMessageIds) {
      // The client reject-and-continue path decides once itself, then again through
      // `rejectToolCalling`; the rollback must restore the card from before both.
      const original = originals.has(id)
        ? originals.get(id)
        : dbMessageSelectors.getDbMessageById(id)(get())?.pluginIntervention;
      originals.set(id, original);
      dispatchInterventionState(get, id, decision, context);
      const applied = dbMessageSelectors.getDbMessageById(id)(get())?.pluginIntervention;
      rollbacks.set(id, () => {
        // Any server write since (an `aborted`, or the same `approved` confirmed by the
        // server) replaces the immer-frozen object, so it is not ours to undo.
        const current = dbMessageSelectors.getDbMessageById(id)(get())?.pluginIntervention;
        if (current !== applied) return;
        // The message reducers `merge`, which skips `undefined`, so restoring an absent
        // `rejectedReason` as `undefined` would keep the abandoned one, and a retry
        // rejecting without a reason would show it. An empty reason renders as none.
        dispatchInterventionState(
          get,
          id,
          {
            ...original,
            rejectedReason: original?.rejectedReason ?? '',
            status: original?.status ?? 'pending',
          },
          context,
        );
      });
    }
    return () => rollback(toolMessageIds);
  };

  return {
    applyLocalDecision,
    dispatch: (
      toolMessageId: string,
      patch: Partial<ToolIntervention>,
      context: OptimisticUpdateContext,
    ) => dispatchInterventionState(get, toolMessageId, patch, context),
    rollback,
    settle,
    /** Settle once a local runtime persisted the decision; restore the card if it failed. */
    settleAfter: async (toolMessageIds: readonly string[], persist: () => Promise<unknown>) => {
      try {
        await persist();
      } catch (error) {
        rollback(toolMessageIds);
        throw error;
      }
      settle(toolMessageIds);
    },
  };
};
