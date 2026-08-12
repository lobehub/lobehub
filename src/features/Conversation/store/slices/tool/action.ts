import { useChatStore } from '@/store/chat';
import { type StoreSetter } from '@/store/types';

import { type Store as ConversationStore } from '../../action';
import { getInterventionBatch } from '../data/pendingInterventions';
import { dataSelectors } from '../data/selectors';

/**
 * Tool Interaction Actions
 *
 * Handles tool call approval, rejection, and intervention submit/skip/cancel.
 */
type Setter = StoreSetter<ConversationStore>;

export const toolSlice = (set: Setter, get: () => ConversationStore, _api?: unknown) =>
  new ToolActionImpl(set, get, _api);

export class ToolActionImpl {
  readonly #get: () => ConversationStore;

  constructor(_set: Setter, get: () => ConversationStore, _api?: unknown) {
    void _set;
    void _api;
    this.#get = get;
  }

  approveToolCall = async (toolMessageId: string, assistantGroupId: string): Promise<void> => {
    const { hooks, context, waitForPendingArgsUpdate } = this.#get();

    // Wait for any pending args update to complete before approval
    await waitForPendingArgsUpdate(toolMessageId);

    // ===== Hook: onToolApproved =====
    if (hooks.onToolApproved) {
      const shouldProceed = await hooks.onToolApproved(toolMessageId);
      if (shouldProceed === false) return;
    }

    // Delegate to global ChatStore with context for correct conversation scope
    const chatStore = useChatStore.getState();
    await chatStore.approveToolCalling(toolMessageId, assistantGroupId, context);

    // ===== Hook: onToolCallComplete =====
    if (hooks.onToolCallComplete) {
      hooks.onToolCallComplete(toolMessageId, undefined);
    }
  };

  /**
   * Approve every pending tool of a parallel batch in one action.
   *
   * Args edits are flushed for all cards first: the intervention UI debounces
   * `updatePluginArguments`, so approving without waiting would ship the
   * pre-edit arguments for any card the user had just typed in.
   */
  /**
   * Stop a run parked on tool approval — nothing in the batch executes and the
   * model is not continued.
   *
   * No `waitForPendingArgsUpdate` here, unlike approval: the arguments are
   * about to be discarded, so flushing a debounced edit into a call that will
   * never run is pure latency.
   */
  stopPendingApproval = async (toolMessageIds: string[]): Promise<void> => {
    const { context } = this.#get();
    await useChatStore.getState().stopPendingApproval(toolMessageIds, context);
  };

  /**
   * Stop from a single card: resolve that card's own parallel batch and stop
   * the whole thing.
   *
   * Scoped the same way approve-all is — the pending list spans the entire
   * conversation, so stopping the raw list would also discard an unrelated
   * turn's approval.
   */
  stopPendingApprovalForCard = async (toolMessageId: string): Promise<void> => {
    const state = this.#get();
    const pending = dataSelectors.pendingInterventions(state);
    const active = pending.find((item) => item.toolMessageId === toolMessageId);
    const batch = getInterventionBatch(pending, active);
    const ids = batch.length > 0 ? batch.map((item) => item.toolMessageId) : [toolMessageId];

    await useChatStore.getState().stopPendingApproval(ids, state.context);
  };

  approveAllToolCalls = async (toolMessageIds: string[]): Promise<void> => {
    const { hooks, context, waitForPendingArgsUpdate } = this.#get();

    await Promise.all(toolMessageIds.map((id) => waitForPendingArgsUpdate(id)));

    // ===== Hook: onToolApproved =====
    // Per tool, so a host that vetoes one card drops only that card from the
    // batch rather than cancelling the whole approval.
    const approved: string[] = [];
    for (const toolMessageId of toolMessageIds) {
      if (hooks.onToolApproved) {
        const shouldProceed = await hooks.onToolApproved(toolMessageId);
        if (shouldProceed === false) continue;
      }
      approved.push(toolMessageId);
    }

    if (approved.length === 0) return;

    const chatStore = useChatStore.getState();
    await chatStore.approveAllToolCalls(approved, context);

    // ===== Hook: onToolCallComplete =====
    if (hooks.onToolCallComplete) {
      for (const toolMessageId of approved) hooks.onToolCallComplete(toolMessageId, undefined);
    }
  };

  cancelToolInteraction = async (toolMessageId: string): Promise<void> => {
    const { context } = this.#get();
    const chatStore = useChatStore.getState();
    await chatStore.cancelToolInteraction(toolMessageId, context);
  };

  rejectAndContinueToolCall = async (toolMessageId: string, reason?: string): Promise<void> => {
    const { context, hooks, waitForPendingArgsUpdate } = this.#get();

    // Wait for any pending args update to complete before rejection
    await waitForPendingArgsUpdate(toolMessageId);

    // ===== Hook: onToolRejected =====
    // Fire the hook here directly rather than going through `rejectToolCall`.
    // `rejectToolCall` now delegates to `chatStore.rejectToolCalling`, so
    // chaining it would (in Gateway mode) kick off a halting
    // `decision='rejected'` resume op before our own
    // `decision='rejected_continue'` call below, racing two resume ops on
    // the same tool_call_id. In client mode it would also duplicate the
    // reject bookkeeping since `chatStore.rejectAndContinueToolCalling`
    // already calls `chatStore.rejectToolCalling` internally.
    if (hooks.onToolRejected) {
      const shouldProceed = await hooks.onToolRejected(toolMessageId, reason);
      if (shouldProceed === false) return;
    }

    // Delegate to ChatStore for rejection + continuation. In Gateway mode
    // this fires a single `decision='rejected_continue'` resume op; in
    // client mode it persists the rejection via an internal
    // `chatStore.rejectToolCalling` call before resuming the local runtime.
    const chatStore = useChatStore.getState();
    await chatStore.rejectAndContinueToolCalling(toolMessageId, reason, context);
  };

  rejectToolCall = async (toolMessageId: string, reason?: string): Promise<void> => {
    const { context, hooks, waitForPendingArgsUpdate } = this.#get();

    // Wait for any pending args update to complete before rejection
    await waitForPendingArgsUpdate(toolMessageId);

    // ===== Hook: onToolRejected =====
    if (hooks.onToolRejected) {
      const shouldProceed = await hooks.onToolRejected(toolMessageId, reason);
      if (shouldProceed === false) return;
    }

    // Delegate to global ChatStore with context for correct conversation scope.
    // In Gateway mode this also starts a new op carrying resumeApproval={decision:'rejected'}
    // so the server releases the paused confirmation; without this the server op stays
    // awaiting confirmation and the client loading state never clears.
    // `chatStore.rejectToolCalling` does its own tool-message existence guard, so the
    // lookup that used to live here is redundant.
    const chatStore = useChatStore.getState();
    await chatStore.rejectToolCalling(toolMessageId, reason, context);
  };

  skipToolInteraction = async (toolMessageId: string, reason?: string): Promise<void> => {
    const { context } = this.#get();
    const chatStore = useChatStore.getState();
    await chatStore.skipToolInteraction(toolMessageId, reason, context);
  };

  submitToolInteraction = async (
    toolMessageId: string,
    response: Record<string, unknown>,
    options?: {
      createUserMessage?: boolean;
      pluginState?: Record<string, unknown>;
      toolResultContent?: string;
    },
  ): Promise<void> => {
    const { context } = this.#get();
    const chatStore = useChatStore.getState();
    await chatStore.submitToolInteraction(toolMessageId, response, context, options);
  };

  /**
   * Hetero (CC / Codex) intervention submit/skip/cancel. Unlike the other tool
   * interactions this ships the answer back to a running CLI subprocess over
   * IPC, but it still needs this conversation's own `context` so the optimistic
   * writes and topic-status flip land on the topic that owns the card — not
   * whatever topic the user happens to be viewing (which is what the chatStore
   * falls back to via global `activeTopicId`).
   */
  submitHeteroIntervention = async (
    toolMessageId: string,
    actionType: 'submit' | 'skip' | 'cancel',
    payload?: Record<string, unknown>,
  ): Promise<void> => {
    const { context } = this.#get();
    const chatStore = useChatStore.getState();
    await chatStore.submitHeteroIntervention(toolMessageId, actionType, payload, context);
  };
}

export type ToolAction = Pick<ToolActionImpl, keyof ToolActionImpl>;
