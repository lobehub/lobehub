import { type StateCreator } from 'zustand';

import { MESSAGE_CANCEL_FLAT } from '@/const/index';
import { useChatStore } from '@/store/chat';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation/types';

import { type Store as ConversationStore } from '../../action';

/**
 * Generation Actions
 *
 * Handles generation control (stop, cancel, regenerate, continue)
 */
export interface GenerationAction {
  /**
   * Cancel a specific operation
   */
  cancelOperation: (operationId: string, reason?: string) => void;

  /**
   * Clear all operations
   */
  clearOperations: () => void;

  /**
   * Clear translate for a message
   * @deprecated Temporary bridge to ChatStore
   */
  clearTranslate: (messageId: string) => Promise<void>;

  /**
   * Clear TTS for a message
   * @deprecated Temporary bridge to ChatStore
   */
  clearTTS: (messageId: string) => Promise<void>;

  /**
   * Continue generation from a message
   */
  continueGeneration: (displayMessageId: string) => Promise<void>;

  /**
   * Continue generation from a specific block
   */
  continueGenerationMessage: (displayMessageId: string, messageId: string) => Promise<void>;

  /**
   * Delete and regenerate a message
   */
  delAndRegenerateMessage: (messageId: string) => Promise<void>;

  /**
   * Delete and resend a thread message
   */
  delAndResendThreadMessage: (messageId: string) => Promise<void>;

  /**
   * Open thread creator
   * @deprecated Temporary bridge to ChatStore
   */
  openThreadCreator: (messageId: string) => void;

  /**
   * Regenerate an assistant message
   */
  regenerateAssistantMessage: (messageId: string) => Promise<void>;

  /**
   * Regenerate a user message
   */
  regenerateUserMessage: (messageId: string) => Promise<void>;

  /**
   * Re-invoke a tool message
   * @deprecated Temporary bridge to ChatStore
   */
  reInvokeToolMessage: (messageId: string) => Promise<void>;

  /**
   * Resend a thread message
   */
  resendThreadMessage: (messageId: string) => Promise<void>;

  /**
   * Stop current generation
   */
  stopGenerating: () => void;

  /**
   * Translate a message
   * @deprecated Temporary bridge to ChatStore
   */
  translateMessage: (messageId: string, targetLang: string) => Promise<void>;

  /**
   * TTS a message
   * @deprecated Temporary bridge to ChatStore
   */
  ttsMessage: (
    messageId: string,
    state?: { contentMd5?: string; file?: string; voice?: string },
  ) => Promise<void>;
}

export const generationSlice: StateCreator<
  ConversationStore,
  [['zustand/devtools', never]],
  [],
  GenerationAction
> = (set, get) => ({
  cancelOperation: (operationId: string, reason?: string) => {
    const state = get();
    const { hooks } = state;

    const chatStore = useChatStore.getState();
    chatStore.cancelOperation(operationId, reason || 'User cancelled');

    // ===== Hook: onOperationCancelled =====
    if (hooks.onOperationCancelled) {
      hooks.onOperationCancelled(operationId);
    }
  },

  clearOperations: () => {
    // Operations are now managed by ChatStore, nothing to clear locally
  },

  clearTTS: async (messageId: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.clearTTS(messageId);
  },

  clearTranslate: async (messageId: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.clearTranslate(messageId);
  },

  continueGeneration: async (groupMessageId: string) => {
    const { displayMessages } = get();

    // Find the message
    const message = displayMessages.find((m) => m.id === groupMessageId);
    if (!message) return;

    // If it's an assistantGroup, find the last child's ID as blockId
    let lastBlockId: string | undefined;

    if (message.role !== 'assistantGroup') return;

    if (message.children && message.children.length > 0) {
      const lastChild = message.children.at(-1);

      if (lastChild) {
        lastBlockId = lastChild.id;
      }
    }

    if (!lastBlockId) return;

    await get().continueGenerationMessage(groupMessageId, lastBlockId);
  },

  continueGenerationMessage: async (displayMessageId: string, dbMessageId: string) => {
    const { context, displayMessages, hooks } = get();
    const chatStore = useChatStore.getState();

    // Find the message (blockId refers to the assistant message to continue from)
    const message = displayMessages.find((m) => m.id === displayMessageId);
    if (!message) return;

    // ===== Hook: onBeforeContinue =====
    if (hooks.onBeforeContinue) {
      const shouldProceed = await hooks.onBeforeContinue(displayMessageId);
      if (shouldProceed === false) return;
    }

    // Create continue operation with ConversationStore context (includes groupId)
    const { operationId } = chatStore.startOperation({
      context: { ...context, messageId: displayMessageId },
      type: 'continue',
    });

    try {
      // Execute agent runtime with full context from ConversationStore
      await chatStore.internal_execAgentRuntime({
        context,
        messages: displayMessages,
        parentMessageId: dbMessageId,
        parentMessageType: message.role as 'assistant' | 'tool' | 'user',
        parentOperationId: operationId,
      });

      chatStore.completeOperation(operationId);

      // ===== Hook: onContinueComplete =====
      if (hooks.onContinueComplete) {
        hooks.onContinueComplete(displayMessageId);
      }
    } catch (error) {
      chatStore.failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'ContinueError',
      });
      throw error;
    }
  },

  delAndRegenerateMessage: async (messageId: string) => {
    const { context, displayMessages } = get();
    const chatStore = useChatStore.getState();

    // Find the assistant message and get parent user message ID before deletion
    // This is needed because after deletion, we can't find the parent anymore
    const currentMessage = displayMessages.find((c) => c.id === messageId);
    if (!currentMessage) return;

    const userId = currentMessage.parentId;
    if (!userId) return;

    // Create operation to track context (use 'regenerate' type since this is a regenerate action)
    const { operationId } = chatStore.startOperation({
      context: { ...context, messageId },
      type: 'regenerate',
    });

    // IMPORTANT: Delete first, then regenerate (LOBE-2533)
    // If we regenerate first, it switches to a new branch, causing the original
    // message to no longer appear in displayMessages. Then deleteMessage cannot
    // find the message and fails silently.
    await chatStore.deleteMessage(messageId, { operationId });
    await get().regenerateUserMessage(userId);
    chatStore.completeOperation(operationId);
  },

  delAndResendThreadMessage: async (messageId: string) => {
    const { context } = get();
    const chatStore = useChatStore.getState();

    // Create operation to track context (use 'regenerate' type since resend is essentially regenerate)
    const { operationId } = chatStore.startOperation({
      context: { ...context, messageId },
      type: 'regenerate',
    });

    // Resend then delete
    await get().resendThreadMessage(messageId);
    await chatStore.deleteMessage(messageId, { operationId });
    chatStore.completeOperation(operationId);
  },

  openThreadCreator: (messageId: string) => {
    const chatStore = useChatStore.getState();
    chatStore.openThreadCreator(messageId);
  },

  reInvokeToolMessage: async (messageId: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.reInvokeToolMessage(messageId);
  },

  regenerateAssistantMessage: async (messageId: string) => {
    const { displayMessages } = get();

    // Find the assistant message
    const currentIndex = displayMessages.findIndex((c) => c.id === messageId);
    const currentMessage = displayMessages[currentIndex];

    if (!currentMessage) return;

    // Find the parent user message
    const userId = currentMessage.parentId;
    if (!userId) return;

    // Delegate to regenerateUserMessage with the parent user message
    await get().regenerateUserMessage(userId);
  },

  regenerateUserMessage: async (messageId: string) => {
    const { context, displayMessages, hooks } = get();
    const chatStore = useChatStore.getState();

    // Check if already regenerating
    const isRegenerating = chatStore.messageLoadingIds.includes(messageId);
    if (isRegenerating) return;

    // Find the message in current conversation messages
    const currentIndex = displayMessages.findIndex((c) => c.id === messageId);
    const item = displayMessages[currentIndex];
    if (!item) return;

    // Get context messages up to and including the target message
    const contextMessages = displayMessages.slice(0, currentIndex + 1);
    if (contextMessages.length <= 0) return;

    // ===== Hook: onBeforeRegenerate =====
    if (hooks.onBeforeRegenerate) {
      const shouldProceed = await hooks.onBeforeRegenerate(messageId);
      if (shouldProceed === false) return;
    }

    // Create regenerate operation with context
    const { operationId } = chatStore.startOperation({
      context: { ...context, messageId },
      type: 'regenerate',
    });

    try {
      // Calculate next branch index by counting children of this user message
      // We need to count how many assistant messages have this user message as parent
      const { dbMessages } = get();
      const childrenCount = dbMessages.filter((m) => m.parentId === messageId).length;
      // New branch index = current children count (since index is 0-based)
      const nextBranchIndex = childrenCount;

      // Switch to a new branch (pass operationId for correct context in optimistic update)
      await chatStore.switchMessageBranch(messageId, nextBranchIndex, {
        operationId,
      });

      // Execute agent runtime with full context from ConversationStore
      await chatStore.internal_execAgentRuntime({
        context,
        messages: contextMessages,
        parentMessageId: messageId,
        parentMessageType: 'user',
        parentOperationId: operationId,
      });

      chatStore.completeOperation(operationId);

      // ===== Hook: onRegenerateComplete =====
      if (hooks.onRegenerateComplete) {
        hooks.onRegenerateComplete(messageId);
      }
    } catch (error) {
      chatStore.failOperation(operationId, {
        message: error instanceof Error ? error.message : String(error),
        type: 'RegenerateError',
      });
      throw error;
    }
  },

  resendThreadMessage: async (messageId: string) => {
    // Resend is essentially regenerating the user message in thread context
    await get().regenerateUserMessage(messageId);
  },

  stopGenerating: () => {
    const state = get();
    const { context, hooks } = state;
    const { agentId, topicId } = context;

    const chatStore = useChatStore.getState();

    // Cancel all running AI runtime operations in this conversation context
    // Includes both client-side (execAgentRuntime) and server-side (execServerAgentRuntime) operations
    chatStore.cancelOperations(
      { agentId, status: 'running', topicId, type: AI_RUNTIME_OPERATION_TYPES },
      MESSAGE_CANCEL_FLAT,
    );

    // ===== Hook: onGenerationStop =====
    if (hooks.onGenerationStop) {
      hooks.onGenerationStop();
    }
  },

  translateMessage: async (messageId: string, targetLang: string) => {
    const chatStore = useChatStore.getState();
    await chatStore.translateMessage(messageId, targetLang);
  },

  ttsMessage: async (
    messageId: string,
    state?: { contentMd5?: string; file?: string; voice?: string },
  ) => {
    const chatStore = useChatStore.getState();
    await chatStore.ttsMessage(messageId, state);
  },
});
