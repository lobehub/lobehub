import { type Operation, type OperationType, type QueuedMessage } from './types';

/**
 * Chat Operation State
 * Unified state for all async operations
 */
export interface ChatOperationState {
  /**
   * Message to operation mapping (for automatic context retrieval)
   * key: messageId, value: operationId
   */
  messageOperationMap: Record<string, string>;

  /**
   * All operations map, key is operationId
   */
  operations: Record<string, Operation>;

  /**
   * Operations indexed by agent/topic
   * key: messageMapKey(agentId, topicId), value: operationId[]
   */
  operationsByContext: Record<string, string[]>;

  /**
   * Operations indexed by message
   * key: messageId, value: operationId[]
   */
  operationsByMessage: Record<string, string[]>;

  /**
   * Operations indexed by type (for fast querying)
   * key: OperationType, value: operationId[]
   */
  operationsByType: Record<OperationType, string[]>;

  /**
   * Message queue per conversation context.
   * key: contextKey (messageMapKey), value: queued messages
   * Messages are consumed either by the running step loop (injection)
   * or by triggering a new sendMessage when no operation is running.
   */
  queuedMessages: Record<string, QueuedMessage[]>;

  /**
   * Agent IDs with unread completed generation
   */
  unreadCompletedAgentIds: Set<string>;

  /**
   * Topic IDs with unread completed generation
   */
  unreadCompletedTopicIds: Set<string>;
}

export const initialOperationState: ChatOperationState = {
  messageOperationMap: {},
  operations: {},
  operationsByContext: {},
  operationsByMessage: {},
  operationsByType: {} as Record<OperationType, string[]>,
  queuedMessages: {},
  unreadCompletedAgentIds: new Set(),
  unreadCompletedTopicIds: new Set(),
};
