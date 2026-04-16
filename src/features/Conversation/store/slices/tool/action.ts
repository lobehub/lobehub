import { type StateCreator } from 'zustand';

import { useChatStore } from '@/store/chat';

import { type Store as ConversationStore } from '../../action';

/**
 * Tool Interaction Actions
 *
 * Handles tool call approval and rejection
 */
export interface ToolAction {
  /**
   * Approve a tool call
   */
  approveToolCall: (toolMessageId: string, assistantGroupId: string) => Promise<void>;

  cancelToolInteraction: (toolMessageId: string) => Promise<void>;

  /**
   * Reject a tool call and continue the conversation
   */
  rejectAndContinueToolCall: (toolMessageId: string, reason?: string) => Promise<void>;

  /**
   * Reject a tool call
   */
  rejectToolCall: (toolMessageId: string, reason?: string) => Promise<void>;

  skipToolInteraction: (toolMessageId: string, reason?: string) => Promise<void>;

  submitToolInteraction: (
    toolMessageId: string,
    response: Record<string, unknown>,
  ) => Promise<void>;
}

export const toolSlice: StateCreator<
  ConversationStore,
  [['zustand/devtools', never]],
  [],
  ToolAction
> = (set, get) => ({
  approveToolCall: async (toolMessageId: string, assistantGroupId: string) => {
    const state = get();
    const { hooks, context, waitForPendingArgsUpdate } = state;

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
  },

  cancelToolInteraction: async (toolMessageId: string) => {
    const { context } = get();
    const chatStore = useChatStore.getState();
    await chatStore.cancelToolInteraction(toolMessageId, context);
  },

  rejectAndContinueToolCall: async (toolMessageId: string, reason?: string) => {
    const { context, hooks, waitForPendingArgsUpdate } = get();

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
  },

  rejectToolCall: async (toolMessageId: string, reason?: string) => {
    const state = get();
    const { context, hooks, waitForPendingArgsUpdate } = state;

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
  },

  skipToolInteraction: async (toolMessageId: string, reason?: string) => {
    const { context } = get();
    const chatStore = useChatStore.getState();
    await chatStore.skipToolInteraction(toolMessageId, reason, context);
  },

  submitToolInteraction: async (toolMessageId: string, response: Record<string, unknown>) => {
    const { context } = get();
    const chatStore = useChatStore.getState();
    await chatStore.submitToolInteraction(toolMessageId, response, context);
  },
});
