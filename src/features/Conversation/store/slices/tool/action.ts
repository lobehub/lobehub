import { useChatStore } from '@/store/chat';
import { type StoreSetter } from '@/store/types';

import { type Store as ConversationStore } from '../../action';

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
}

export type ToolAction = Pick<ToolActionImpl, keyof ToolActionImpl>;
