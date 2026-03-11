import { type StateCreator } from 'zustand';

import { useChatStore } from '@/store/chat';

import { type Store as ConversationStore } from '../../action';
import { dataSelectors } from '../data/selectors';

/**
 * Tool Interaction Actions
 *
 * Handles tool call approval and rejection
 */
export interface ToolAction {
  approveAllByAuditType: (auditType: string, assistantGroupId: string) => Promise<void>;
  approveToolCall: (toolMessageId: string, assistantGroupId: string) => Promise<void>;
  bypassAuditForSession: (auditType: string, assistantGroupId: string) => Promise<void>;
  rejectAllByAuditType: (auditType: string, reason?: string) => Promise<void>;
  rejectAndContinueToolCall: (toolMessageId: string, reason?: string) => Promise<void>;
  rejectToolCall: (toolMessageId: string, reason?: string) => Promise<void>;
}

export const toolSlice: StateCreator<
  ConversationStore,
  [['zustand/devtools', never]],
  [],
  ToolAction
> = (set, get) => ({
  approveAllByAuditType: async (auditType: string, assistantGroupId: string) => {
    const state = get();
    const { context, hooks, waitForPendingArgsUpdate } = state;
    const allMessages = dataSelectors.dbMessages(state);
    const pendingIds = allMessages
      .filter(
        (m) =>
          m.role === 'tool' &&
          !m.id.startsWith('tmp_') &&
          m.pluginIntervention?.status === 'pending' &&
          m.pluginIntervention?.auditType === auditType,
      )
      .map((m) => m.id);

    if (pendingIds.length === 0) return;

    // Wait for all pending args updates before batch approval
    await Promise.all(pendingIds.map((id) => waitForPendingArgsUpdate(id)));

    // Fire onToolApproved hook for each tool
    if (hooks.onToolApproved) {
      for (const id of pendingIds) {
        const shouldProceed = await hooks.onToolApproved(id);
        if (shouldProceed === false) return;
      }
    }

    const chatStore = useChatStore.getState();
    await chatStore.approveAllToolCallings(pendingIds, assistantGroupId, context);

    // Fire onToolCallComplete hook for each tool
    if (hooks.onToolCallComplete) {
      for (const id of pendingIds) {
        hooks.onToolCallComplete(id, undefined);
      }
    }
  },

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

  bypassAuditForSession: async (auditType: string, assistantGroupId: string) => {
    const chatStore = useChatStore.getState();
    chatStore.bypassAuditForSession(auditType);
    await get().approveAllByAuditType(auditType, assistantGroupId);
  },

  rejectAllByAuditType: async (auditType: string, reason?: string) => {
    const state = get();
    const allMessages = dataSelectors.dbMessages(state);
    const pendingIds = allMessages
      .filter(
        (m) =>
          m.role === 'tool' &&
          !m.id.startsWith('tmp_') &&
          m.pluginIntervention?.status === 'pending' &&
          m.pluginIntervention?.auditType === auditType,
      )
      .map((m) => m.id);

    for (const id of pendingIds) {
      await get().rejectToolCall(id, reason);
    }
  },

  rejectAndContinueToolCall: async (toolMessageId: string, reason?: string) => {
    const { context, waitForPendingArgsUpdate } = get();

    // Wait for any pending args update to complete before rejection
    await waitForPendingArgsUpdate(toolMessageId);

    // First reject the tool call
    await get().rejectToolCall(toolMessageId, reason);

    // Then delegate to ChatStore to continue the conversation with context
    const chatStore = useChatStore.getState();
    await chatStore.rejectAndContinueToolCalling(toolMessageId, reason, context);
  },

  rejectToolCall: async (toolMessageId: string, reason?: string) => {
    const state = get();
    const { hooks, updateMessagePlugin, updateMessageContent, waitForPendingArgsUpdate } = state;

    // Wait for any pending args update to complete before rejection
    await waitForPendingArgsUpdate(toolMessageId);

    // ===== Hook: onToolRejected =====
    if (hooks.onToolRejected) {
      const shouldProceed = await hooks.onToolRejected(toolMessageId, reason);
      if (shouldProceed === false) return;
    }

    const toolMessage = dataSelectors.getDbMessageById(toolMessageId)(state);
    if (!toolMessage) return;

    // Update intervention status to rejected
    await updateMessagePlugin(toolMessageId, {
      intervention: {
        rejectedReason: reason,
        status: 'rejected',
      },
    });

    // Update tool message content with rejection reason
    const toolContent = !!reason
      ? `User reject this tool calling with reason: ${reason}`
      : 'User reject this tool calling without reason';

    await updateMessageContent(toolMessageId, toolContent);
  },
});
