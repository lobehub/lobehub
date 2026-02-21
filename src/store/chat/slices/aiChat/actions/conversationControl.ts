/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import { type AgentRuntimeContext } from '@lobechat/agent-runtime';
import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import { type ConversationContext } from '@lobechat/types';

import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

import { displayMessageSelectors } from '../../../selectors';
import { messageMapKey } from '../../../utils/messageMapKey';
import { type OptimisticUpdateContext } from '../../message/actions/optimisticUpdate';
import { dbMessageSelectors } from '../../message/selectors';

/**
 * Actions for controlling conversation operations like cancellation and error handling
 */

type Setter = StoreSetter<ChatStore>;
export const conversationControl = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ConversationControlActionImpl(set, get, _api);

export class ConversationControlActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  stopGenerateMessage = (): void => {
    const { activeAgentId, activeTopicId, cancelOperations } = this.#get();

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
  };

  cancelSendMessageInServer = (topicId?: string): void => {
    const { activeAgentId, activeTopicId } = this.#get();

    // Determine which operation to cancel
    const targetTopicId = topicId ?? activeTopicId;
    const contextKey = messageMapKey({ agentId: activeAgentId, topicId: targetTopicId });

    // Cancel operations in the operation system
    const operationIds = this.#get().operationsByContext[contextKey] || [];

    operationIds.forEach((opId) => {
      const operation = this.#get().operations[opId];
      if (operation && operation.type === 'sendMessage' && operation.status === 'running') {
        this.#get().cancelOperation(opId, 'User cancelled');
      }
    });

    // Restore editor state if it's the active session
    if (contextKey === messageMapKey({ agentId: activeAgentId, topicId: activeTopicId })) {
      // Find the latest sendMessage operation with editor state
      for (const opId of [...operationIds].reverse()) {
        const op = this.#get().operations[opId];
        if (op && op.type === 'sendMessage' && op.metadata.inputEditorTempState) {
          this.#get().mainInputEditor?.setJSONState(op.metadata.inputEditorTempState);
          break;
        }
      }
    }
  };

  clearSendMessageError = (): void => {
    const { activeAgentId, activeTopicId } = this.#get();
    const contextKey = messageMapKey({ agentId: activeAgentId, topicId: activeTopicId });
    const operationIds = this.#get().operationsByContext[contextKey] || [];

    // Clear error message from all sendMessage operations in current context
    operationIds.forEach((opId) => {
      const op = this.#get().operations[opId];
      if (op && op.type === 'sendMessage' && op.metadata.inputSendErrorMsg) {
        this.#get().updateOperationMetadata(opId, { inputSendErrorMsg: undefined });
      }
    });
  };

  switchMessageBranch = async (
    messageId: string,
    branchIndex: number,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    await this.#get().optimisticUpdateMessageMetadata(
      messageId,
      { activeBranchIndex: branchIndex },
      context,
    );
  };

  approveToolCalling = async (
    toolMessageId: string,
    _assistantGroupId: string,
    context?: ConversationContext,
  ): Promise<void> => {
    const { internal_execAgentRuntime, startOperation, completeOperation } = this.#get();

    // Build effective context from provided context or global state
    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    // 1. Get tool message and verify it exists
    const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(this.#get());
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
    await this.#get().optimisticUpdatePlugin(
      toolMessageId,
      { intervention: { status: 'approved' } },
      optimisticContext,
    );

    // 3. Get current messages for state construction using context
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());

    // 4. Create agent state and context with user intervention config
    const { state, context: initialContext } = this.#get().internal_createAgentState({
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
      this.#get().failOperation(operationId, {
        type: 'approveToolCalling',
        message: err.message || 'Unknown error',
      });
    }
  };

  rejectToolCalling = async (
    messageId: string,
    reason?: string,
    context?: ConversationContext,
  ): Promise<void> => {
    const { startOperation, completeOperation } = this.#get();

    // Build effective context from provided context or global state
    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    const toolMessage = dbMessageSelectors.getDbMessageById(messageId)(this.#get());
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
    await this.#get().optimisticUpdatePlugin(toolMessage.id, { intervention }, optimisticContext);

    const toolContent = !!reason
      ? `User reject this tool calling with reason: ${reason}`
      : 'User reject this tool calling without reason';

    await this.#get().optimisticUpdateMessageContent(
      messageId,
      toolContent,
      undefined,
      optimisticContext,
    );

    completeOperation(operationId);
  };

  rejectAndContinueToolCalling = async (
    messageId: string,
    reason?: string,
    context?: ConversationContext,
  ): Promise<void> => {
    // Pass context to rejectToolCalling for proper context isolation
    await this.#get().rejectToolCalling(messageId, reason, context);

    const toolMessage = dbMessageSelectors.getDbMessageById(messageId)(this.#get());
    if (!toolMessage) return;

    const { internal_execAgentRuntime, startOperation, completeOperation } = this.#get();

    // Build effective context from provided context or global state
    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
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
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());

    // Create agent state and context to continue from rejected tool message
    const { state, context: initialContext } = this.#get().internal_createAgentState({
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
      this.#get().failOperation(operationId, {
        type: 'rejectToolCalling',
        message: err.message || 'Unknown error',
      });
    }
  };
}

export type ConversationControlAction = Pick<
  ConversationControlActionImpl,
  keyof ConversationControlActionImpl
>;
