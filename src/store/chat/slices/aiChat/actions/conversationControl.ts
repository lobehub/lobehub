/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import { type AgentRuntimeContext } from '@lobechat/agent-runtime';
import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import { type ConversationContext } from '@lobechat/types';
import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';

import { displayMessageSelectors } from '../../../selectors';
import { messageMapKey } from '../../../utils/messageMapKey';
import { type OptimisticUpdateContext } from '../../message/actions/optimisticUpdate';
import { dbMessageSelectors } from '../../message/selectors';

/**
 * Actions for controlling conversation operations like cancellation and error handling
 */
export interface ConversationControlAction {
  /**
   * Interrupts the ongoing ai message generation process
   */
  stopGenerateMessage: () => void;
  /**
   * Cancels sendMessage operation for a specific topic/session
   */
  cancelSendMessageInServer: (topicId?: string) => void;
  /**
   * Clears any error messages from the send message operation
   */
  clearSendMessageError: () => void;
  /**
   * Switches to a different branch of a message
   * @param messageId - The ID of the message to switch branch
   * @param branchIndex - The index of the branch to switch to
   * @param context - Optional context for optimistic update (required for Group mode)
   */
  switchMessageBranch: (
    messageId: string,
    branchIndex: number,
    context?: OptimisticUpdateContext,
  ) => Promise<void>;
  /**
   * Approve tool intervention
   * @param toolMessageId - The ID of the tool message to approve
   * @param assistantGroupId - The ID of the assistant group
   * @param context - Optional conversation context (for non-main conversations like agent-builder)
   */
  approveToolCalling: (
    toolMessageId: string,
    assistantGroupId: string,
    context?: ConversationContext,
  ) => Promise<void>;
  /**
   * Reject tool intervention
   * @param messageId - The ID of the tool message to reject
   * @param reason - Optional rejection reason
   * @param context - Optional conversation context (for non-main conversations like agent-builder)
   */
  rejectToolCalling: (
    messageId: string,
    reason?: string,
    context?: ConversationContext,
  ) => Promise<void>;
  /**
   * Reject tool intervention and continue
   * @param messageId - The ID of the tool message to reject
   * @param reason - Optional rejection reason
   * @param context - Optional conversation context (for non-main conversations like agent-builder)
   */
  rejectAndContinueToolCalling: (
    messageId: string,
    reason?: string,
    context?: ConversationContext,
  ) => Promise<void>;
}

export const conversationControl: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ConversationControlAction
> = (set, get) => ({
  stopGenerateMessage: () => {
    const { activeAgentId, activeTopicId, cancelOperations } = get();

    // Cancel all running execAgentRuntime operations in the current context
    cancelOperations(
      {
        type: 'execAgentRuntime',
        status: 'running',
        agentId: activeAgentId,
        topicId: activeTopicId,
      },
      MESSAGE_CANCEL_FLAT,
    );
  },

  cancelSendMessageInServer: (topicId?: string) => {
    const { activeAgentId, activeTopicId } = get();

    // Determine which operation to cancel
    const targetTopicId = topicId ?? activeTopicId;
    const contextKey = messageMapKey({ agentId: activeAgentId, topicId: targetTopicId });

    // Cancel operations in the operation system
    const operationIds = get().operationsByContext[contextKey] || [];

    operationIds.forEach((opId) => {
      const operation = get().operations[opId];
      if (operation && operation.type === 'sendMessage' && operation.status === 'running') {
        get().cancelOperation(opId, 'User cancelled');
      }
    });

    // Restore editor state if it's the active session
    if (contextKey === messageMapKey({ agentId: activeAgentId, topicId: activeTopicId })) {
      // Find the latest sendMessage operation with editor state
      for (const opId of [...operationIds].reverse()) {
        const op = get().operations[opId];
        if (op && op.type === 'sendMessage' && op.metadata.inputEditorTempState) {
          get().mainInputEditor?.setJSONState(op.metadata.inputEditorTempState);
          break;
        }
      }
    }
  },

  clearSendMessageError: () => {
    const { activeAgentId, activeTopicId } = get();
    const contextKey = messageMapKey({ agentId: activeAgentId, topicId: activeTopicId });
    const operationIds = get().operationsByContext[contextKey] || [];

    // Clear error message from all sendMessage operations in current context
    operationIds.forEach((opId) => {
      const op = get().operations[opId];
      if (op && op.type === 'sendMessage' && op.metadata.inputSendErrorMsg) {
        get().updateOperationMetadata(opId, { inputSendErrorMsg: undefined });
      }
    });
  },

  switchMessageBranch: async (messageId, branchIndex, context) => {
    await get().optimisticUpdateMessageMetadata(
      messageId,
      { activeBranchIndex: branchIndex },
      context,
    );
  },
  approveToolCalling: async (toolMessageId, _assistantGroupId, context) => {
    const { internal_execAgentRuntime, startOperation, completeOperation } = get();

    // Build effective context from provided context or global state
    const effectiveContext: ConversationContext = context ?? {
      agentId: get().activeAgentId,
      topicId: get().activeTopicId,
      threadId: get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    // 1. Get tool message and verify it exists
    const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(get());
    if (!toolMessage) return;

    // Create an operation to carry the context for optimistic updates
    // This ensures optimistic updates use the correct agentId/topicId
    const { operationId } = startOperation({
      type: 'approveToolCalling',
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId: toolMessageId,
      },
    });

    const optimisticContext = { operationId };

    // 2. Update intervention status to approved
    await get().optimisticUpdatePlugin(
      toolMessageId,
      { intervention: { status: 'approved' } },
      optimisticContext,
    );

    // 3. Get current messages for state construction using context
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(get());

    // 4. Create agent state and context with user intervention config
    const { state, context: initialContext } = get().internal_createAgentState({
      messages: currentMessages,
      parentMessageId: toolMessageId,
      agentId,
      topicId,
      threadId: threadId ?? undefined,
      operationId,
    });

    // 5. Override context with 'human_approved_tool' phase
    const agentRuntimeContext: AgentRuntimeContext = {
      ...initialContext,
      phase: 'human_approved_tool',
      payload: {
        approvedToolCall: toolMessage.plugin,
        parentMessageId: toolMessageId,
        skipCreateToolMessage: true,
      },
    };

    // 7. Execute agent runtime from tool message position
    try {
      await internal_execAgentRuntime({
        context: effectiveContext,
        messages: currentMessages,
        parentMessageId: toolMessageId, // Start from tool message
        parentMessageType: 'tool', // Type is 'tool'
        initialState: state,
        initialContext: agentRuntimeContext,
        // Pass parent operation ID to establish parent-child relationship
        // This ensures proper cancellation propagation
        parentOperationId: operationId,
      });
      completeOperation(operationId);
    } catch (error) {
      const err = error as Error;
      console.error('[approveToolCalling] Error executing agent runtime:', err);
      get().failOperation(operationId, {
        type: 'approveToolCalling',
        message: err.message || 'Unknown error',
      });
    }
  },

  rejectToolCalling: async (messageId, reason, context) => {
    const { startOperation, completeOperation } = get();

    // Build effective context from provided context or global state
    const effectiveContext: ConversationContext = context ?? {
      agentId: get().activeAgentId,
      topicId: get().activeTopicId,
      threadId: get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    const toolMessage = dbMessageSelectors.getDbMessageById(messageId)(get());
    if (!toolMessage) return;

    // Create an operation to carry the context for optimistic updates
    const { operationId } = startOperation({
      type: 'rejectToolCalling',
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId,
      },
    });

    const optimisticContext = { operationId };

    // Optimistic update - update status to rejected and save reason
    const intervention = {
      rejectedReason: reason,
      status: 'rejected',
    } as const;
    await get().optimisticUpdatePlugin(toolMessage.id, { intervention }, optimisticContext);

    const toolContent = !!reason
      ? `User reject this tool calling with reason: ${reason}`
      : 'User reject this tool calling without reason';

    await get().optimisticUpdateMessageContent(
      messageId,
      toolContent,
      undefined,
      optimisticContext,
    );

    completeOperation(operationId);
  },

  rejectAndContinueToolCalling: async (messageId, reason, context) => {
    // Pass context to rejectToolCalling for proper context isolation
    await get().rejectToolCalling(messageId, reason, context);

    const toolMessage = dbMessageSelectors.getDbMessageById(messageId)(get());
    if (!toolMessage) return;

    const { internal_execAgentRuntime, startOperation, completeOperation } = get();

    // Build effective context from provided context or global state
    const effectiveContext: ConversationContext = context ?? {
      agentId: get().activeAgentId,
      topicId: get().activeTopicId,
      threadId: get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    // Create an operation to manage the continue execution
    const { operationId } = startOperation({
      type: 'rejectToolCalling',
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId,
      },
    });

    // Get current messages for state construction using context
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(get());

    // Create agent state and context to continue from rejected tool message
    const { state, context: initialContext } = get().internal_createAgentState({
      messages: currentMessages,
      parentMessageId: messageId,
      agentId,
      topicId,
      threadId: threadId ?? undefined,
      operationId,
    });

    // Override context with 'userInput' phase to continue as if user provided feedback
    const agentRuntimeContext: AgentRuntimeContext = {
      ...initialContext,
      phase: 'user_input',
    };

    // Execute agent runtime from rejected tool message position to continue
    try {
      await internal_execAgentRuntime({
        context: effectiveContext,
        messages: currentMessages,
        parentMessageId: messageId,
        parentMessageType: 'tool',
        initialState: state,
        initialContext: agentRuntimeContext,
        // Pass parent operation ID to establish parent-child relationship
        parentOperationId: operationId,
      });
      completeOperation(operationId);
    } catch (error) {
      const err = error as Error;
      console.error('[rejectAndContinueToolCalling] Error executing agent runtime:', err);
      get().failOperation(operationId, {
        type: 'rejectToolCalling',
        message: err.message || 'Unknown error',
      });
    }
  },
});
