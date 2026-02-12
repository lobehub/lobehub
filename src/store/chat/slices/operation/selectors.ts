import { type ChatStoreState } from '@/store/chat/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { type Operation, type OperationType } from './types';
import { AI_RUNTIME_OPERATION_TYPES } from './types';

// === Basic Queries ===
/**
 * Get all operations
 */
const getAllOperations = (s: ChatStoreState): Operation[] => {
  return Object.values(s.operations);
};

/**
 * Get operations for current context (active agent and topic)
 */
const getCurrentContextOperations = (s: ChatStoreState): Operation[] => {
  const { activeAgentId, activeTopicId } = s;
  if (!activeAgentId) return [];

  const contextKey = messageMapKey({ agentId: activeAgentId, topicId: activeTopicId });
  const operationIds = s.operationsByContext[contextKey] || [];
  return operationIds.map((id) => s.operations[id]).filter(Boolean);
};

/**
 * Get all running operations
 */
const getRunningOperations = (s: ChatStoreState): Operation[] => {
  return Object.values(s.operations).filter((op) => op.status === 'running');
};

/**
 * Get operation by ID
 */
const getOperationById =
  (operationId: string) =>
  (s: ChatStoreState): Operation | undefined => {
    return s.operations[operationId];
  };

/**
 * Get operation context from message ID
 * Useful for automatic context retrieval
 */
const getOperationContextFromMessage =
  (messageId: string) =>
  (s: ChatStoreState): Operation['context'] | undefined => {
    const operationId = s.messageOperationMap[messageId];
    if (!operationId) return undefined;

    const operation = s.operations[operationId];
    return operation?.context;
  };

/**
 * Get operations by message ID
 */
const getOperationsByMessage =
  (messageId: string) =>
  (s: ChatStoreState): Operation[] => {
    const operationIds = s.operationsByMessage[messageId] || [];
    return operationIds.map((id) => s.operations[id]).filter(Boolean);
  };

/**
 * Get operations by type
 */
const getOperationsByType =
  (type: OperationType) =>
  (s: ChatStoreState): Operation[] => {
    const operationIds = s.operationsByType[type] || [];
    return operationIds.map((id) => s.operations[id]).filter(Boolean);
  };

// === Status Checks ===
/**
 * Check if there's any running operation
 */
const hasAnyRunningOperation = (s: ChatStoreState): boolean => {
  return Object.values(s.operations).some((op) => op.status === 'running');
};

/**
 * Check if there's a running operation of specific type
 */
const hasRunningOperationType =
  (type: OperationType) =>
  (s: ChatStoreState): boolean => {
    const operationIds = s.operationsByType[type] || [];
    return operationIds.some((id) => {
      const op = s.operations[id];
      return op && op.status === 'running';
    });
  };

/**
 * Check if can interrupt (has running operations that can be cancelled)
 */
const canInterrupt = (s: ChatStoreState): boolean => {
  const currentOps = getCurrentContextOperations(s);
  return currentOps.some((op) => op.status === 'running');
};

/**
 * Check if can send message (no blocking operations running)
 */
const canSendMessage = (s: ChatStoreState): boolean => {
  // Cannot send if there's any running operation in current context
  const currentOps = getCurrentContextOperations(s);
  const hasRunningOp = currentOps.some((op) => op.status === 'running');

  return !hasRunningOp;
};

// === UI Helpers ===
/**
 * Get active operation types (for debugging/display)
 */
const getActiveOperationTypes = (s: ChatStoreState): OperationType[] => {
  const runningOps = getRunningOperations(s);
  const types = new Set(runningOps.map((op) => op.type));
  return Array.from(types);
};

/**
 * Get current operation label for UI display
 * Returns the label of the most recent running operation in current context
 */
const getCurrentOperationLabel = (s: ChatStoreState): string => {
  const currentOps = getCurrentContextOperations(s);
  const runningOps = currentOps.filter((op) => op.status === 'running');

  if (runningOps.length === 0) return '';

  // Get the most recent running operation
  const latestOp = runningOps.reduce((latest, op) => {
    return op.metadata.startTime > latest.metadata.startTime ? op : latest;
  });

  return latestOp.label || latestOp.type;
};

/**
 * Get current operation progress
 * Returns the progress of the most recent running operation with progress info
 */
const getCurrentOperationProgress = (s: ChatStoreState): number | undefined => {
  const currentOps = getCurrentContextOperations(s);
  const runningOps = currentOps.filter((op) => op.status === 'running');

  if (runningOps.length === 0) return undefined;

  // Find the most recent operation with progress
  const opsWithProgress = runningOps.filter((op) => op.metadata.progress);

  if (opsWithProgress.length === 0) return undefined;

  const latestOp = opsWithProgress.reduce((latest, op) => {
    return op.metadata.startTime > latest.metadata.startTime ? op : latest;
  });

  return latestOp.metadata.progress?.percentage;
};

/**
 * Get operations by context (agentId, topicId, threadId)
 * Useful for filtering operations for a specific conversation context
 */
const getOperationsByContext =
  (context: { agentId: string; threadId?: string | null; topicId?: string | null }) =>
  (s: ChatStoreState): Operation[] => {
    const contextKey = messageMapKey({ agentId: context.agentId, topicId: context.topicId });
    const operationIds = s.operationsByContext[contextKey] || [];
    return operationIds
      .map((id) => s.operations[id])
      .filter((op): op is Operation => {
        if (!op) return false;
        // Also filter by threadId if provided
        const opThreadId = op.context.threadId ?? null;
        const contextThreadId = context.threadId ?? null;
        return opThreadId === contextThreadId;
      });
  };

/**
 * Check if there's a running operation in a specific context
 * Use this for loading states in components that display a specific conversation
 */
const hasRunningOperationByContext =
  (context: { agentId: string; threadId?: string | null; topicId?: string | null }) =>
  (s: ChatStoreState): boolean => {
    const operations = getOperationsByContext(context)(s);
    return operations.some((op) => op.status === 'running' && !op.metadata.isAborting);
  };

/**
 * Check if agent runtime is running in a specific context
 * Checks both client-side (execAgentRuntime) and server-side (execServerAgentRuntime) operations
 */
const isAgentRuntimeRunningByContext =
  (context: {
    agentId?: string;
    groupId?: string;
    threadId?: string | null;
    topicId?: string | null;
  }) =>
  (s: ChatStoreState): boolean => {
    if (!context.agentId) return false;

    const contextKey = messageMapKey({
      agentId: context.agentId,
      groupId: context.groupId,
      topicId: context.topicId,
    });

    const operationIds = s.operationsByContext[contextKey] || [];
    const operations = operationIds
      .map((id) => s.operations[id])
      .filter((op): op is Operation => {
        if (!op) return false;
        // Also filter by threadId if provided
        const opThreadId = op.context.threadId ?? null;
        const contextThreadId = context.threadId ?? null;
        return opThreadId === contextThreadId;
      });

    return operations.some(
      (op) =>
        AI_RUNTIME_OPERATION_TYPES.includes(op.type) &&
        op.status === 'running' &&
        !op.metadata.isAborting,
    );
  };

// === Backward Compatibility ===

/**
 * Check if a specific agent has running AI runtime operations
 * Used for agent list item loading states where we need per-agent granularity
 */
const isAgentRunning =
  (agentId: string) =>
  (s: ChatStoreState): boolean => {
    for (const type of AI_RUNTIME_OPERATION_TYPES) {
      const operationIds = s.operationsByType[type] || [];
      const hasRunning = operationIds.some((id) => {
        const op = s.operations[id];
        return (
          op && op.status === 'running' && !op.metadata.isAborting && op.context.agentId === agentId
        );
      });
      if (hasRunning) return true;
    }
    return false;
  };

/**
 * Check if agent runtime is running (including both main window and thread)
 * Checks both client-side (execAgentRuntime) and server-side (execServerAgentRuntime) operations
 * Excludes operations that are aborting (cleaning up after cancellation)
 */
const isAgentRuntimeRunning = (s: ChatStoreState): boolean => {
  // Check all AI runtime operation types
  for (const type of AI_RUNTIME_OPERATION_TYPES) {
    const operationIds = s.operationsByType[type] || [];
    const hasRunning = operationIds.some((id) => {
      const op = s.operations[id];
      // Exclude operations that are aborting (user already cancelled, just cleaning up)
      return op && op.status === 'running' && !op.metadata.isAborting;
    });
    if (hasRunning) return true;
  }
  return false;
};

/**
 * Check if agent runtime is running in main window only
 * Used for main window UI state (e.g., send button loading)
 * Excludes thread operations and operations from other topics to prevent cross-contamination
 */
const isMainWindowAgentRuntimeRunning = (s: ChatStoreState): boolean => {
  // Check all AI runtime operation types
  for (const type of AI_RUNTIME_OPERATION_TYPES) {
    const operationIds = s.operationsByType[type] || [];

    const hasRunning = operationIds.some((id) => {
      const op = s.operations[id];
      if (!op || op.status !== 'running' || op.metadata.isAborting || op.metadata.inThread) {
        return false;
      }

      // For group operations, check groupId
      if (op.context.groupId) {
        return s.activeGroupId === op.context.groupId;
      }

      // Agent must match
      if (s.activeAgentId !== op.context.agentId) return false;

      // Topic comparison: normalize null/undefined (both mean "default topic")
      // activeTopicId can be null (initial state) or undefined (after topic operations)
      // Operation context topicId can also be null or undefined
      const activeTopicId = s.activeTopicId ?? null;
      const opTopicId = op.context.topicId ?? null;

      return activeTopicId === opTopicId;
    });

    if (hasRunning) return true;
  }

  return false;
};

/**
 * Check if continuing (for backward compatibility)
 */
const isContinuing = (s: ChatStoreState): boolean => {
  return hasRunningOperationType('continue')(s);
};

/**
 * Check if in search workflow (for backward compatibility)
 */
const isInSearchWorkflow = (s: ChatStoreState): boolean => {
  return hasRunningOperationType('searchWorkflow')(s);
};

/**
 * Check if a specific message is being processed (any operation type)
 */
const isMessageProcessing =
  (messageId: string) =>
  (s: ChatStoreState): boolean => {
    const operations = getOperationsByMessage(messageId)(s);
    return operations.some((op) => op.status === 'running');
  };

/**
 * Check if a specific message is being generated (AI generation only)
 * Checks both client-side (execAgentRuntime) and server-side (execServerAgentRuntime) operations
 */
const isMessageGenerating =
  (messageId: string) =>
  (s: ChatStoreState): boolean => {
    const operations = getOperationsByMessage(messageId)(s);
    return operations.some(
      (op) => AI_RUNTIME_OPERATION_TYPES.includes(op.type) && op.status === 'running',
    );
  };

/**
 * Check if a specific message is being created (CRUD operation only)
 * Checks message creation operations:
 * - User messages: sendMessage
 * - Assistant messages: createAssistantMessage
 */
const isMessageCreating =
  (messageId: string) =>
  (s: ChatStoreState): boolean => {
    const operations = getOperationsByMessage(messageId)(s);
    return operations.some(
      (op) =>
        (op.type === 'sendMessage' || op.type === 'createAssistantMessage') &&
        op.status === 'running',
    );
  };

/**
 * Check if any message in a list is being processed
 */
const isAnyMessageLoading =
  (messageIds: string[]) =>
  (s: ChatStoreState): boolean => {
    return messageIds.some((id) => isMessageProcessing(id)(s));
  };

/**
 * Get the deepest running operation for a message (leaf node in operation tree)
 * Operations form a tree structure via parentOperationId/childOperationIds
 * This returns the most specific (deepest) running operation for UI display
 */
const getDeepestRunningOperationByMessage =
  (messageId: string) =>
  (s: ChatStoreState): Operation | undefined => {
    const operations = getOperationsByMessage(messageId)(s);
    const runningOps = operations.filter((op) => op.status === 'running');

    if (runningOps.length === 0) return undefined;

    const runningOpIds = new Set(runningOps.map((op) => op.id));

    // A leaf running operation has no running children
    return runningOps.find((op) => {
      const childIds = op.childOperationIds || [];
      return !childIds.some((childId) => runningOpIds.has(childId));
    });
  };

/**
 * Check if a specific message is being regenerated
 */
const isMessageRegenerating =
  (messageId: string) =>
  (s: ChatStoreState): boolean => {
    const operations = getOperationsByMessage(messageId)(s);
    return operations.some((op) => op.type === 'regenerate' && op.status === 'running');
  };

/**
 * Check if a specific message is continuing generation
 */
const isMessageContinuing =
  (messageId: string) =>
  (s: ChatStoreState): boolean => {
    const operations = getOperationsByMessage(messageId)(s);
    return operations.some((op) => op.type === 'continue' && op.status === 'running');
  };

/**
 * Check if a specific message is in reasoning state
 */
const isMessageInReasoning =
  (messageId: string) =>
  (s: ChatStoreState): boolean => {
    const operations = getOperationsByMessage(messageId)(s);
    return operations.some((op) => op.type === 'reasoning' && op.status === 'running');
  };

/**
 * Check if a specific message is in tool calling (plugin API invocation)
 */
const isMessageInToolCalling =
  (messageId: string) =>
  (s: ChatStoreState): boolean => {
    const operations = getOperationsByMessage(messageId)(s);
    return operations.some((op) => op.type === 'toolCalling' && op.status === 'running');
  };

/**
 * Check if currently aborting (cleaning up after user cancellation)
 * Used to show "Cleaning up tool calls..." message
 */
const isAborting = (s: ChatStoreState): boolean => {
  const currentOps = getCurrentContextOperations(s);
  return currentOps.some((op) => op.status === 'running' && op.metadata.isAborting);
};

/**
 * Check if a specific message is aborting
 */
const isMessageAborting =
  (messageId: string) =>
  (s: ChatStoreState): boolean => {
    const operations = getOperationsByMessage(messageId)(s);
    return operations.some((op) => op.status === 'running' && op.metadata.isAborting);
  };

/**
 * Check if regenerating (for backward compatibility)
 */
const isRegenerating = (s: ChatStoreState): boolean => {
  return hasRunningOperationType('regenerate')(s);
};

/**
 * Check if sending message (for backward compatibility)
 * Equivalent to: hasRunningOperationType('sendMessage')
 */
const isSendingMessage = (s: ChatStoreState): boolean => {
  return hasRunningOperationType('sendMessage')(s);
};

// === Unread Completion ===

/**
 * Check if an agent has unread completed generation
 */
const isAgentUnreadCompleted =
  (agentId: string) =>
  (s: ChatStoreState): boolean => {
    return s.unreadCompletedAgentIds.has(agentId);
  };

/**
 * Check if a topic has unread completed generation
 */
const isTopicUnreadCompleted =
  (topicId: string) =>
  (s: ChatStoreState): boolean => {
    return s.unreadCompletedTopicIds.has(topicId);
  };

/**
 * Operation Selectors
 */
export const operationSelectors = {
  canInterrupt,
  canSendMessage,
  getActiveOperationTypes,
  getAllOperations,
  getCurrentContextOperations,
  getCurrentOperationLabel,
  getCurrentOperationProgress,
  getDeepestRunningOperationByMessage,
  getOperationById,
  getOperationContextFromMessage,
  getOperationsByContext,
  getOperationsByMessage,
  getOperationsByType,
  getRunningOperations,
  hasAnyRunningOperation,
  hasRunningOperationByContext,
  hasRunningOperationType,
  /** @deprecated Use isAgentRuntimeRunning instead */
  isAIGenerating: isAgentRuntimeRunning,

  isAborting,

  isAgentRunning,
  isAgentRuntimeRunning,
  isAgentUnreadCompleted,
  isAgentRuntimeRunningByContext,
  isAnyMessageLoading,
  isContinuing,
  isInSearchWorkflow,
  isMainWindowAgentRuntimeRunning,
  isMessageAborting,
  isMessageContinuing,
  isMessageCreating,
  isMessageGenerating,
  isMessageInReasoning,
  isMessageInToolCalling,
  isMessageProcessing,
  isMessageRegenerating,
  isRegenerating,
  isSendingMessage,
  isTopicUnreadCompleted,
};
