import type { Operation, OperationType } from './types';

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
}

export const initialOperationState: ChatOperationState = {
  messageOperationMap: {},
  operations: {},
  operationsByContext: {},
  operationsByMessage: {},
  operationsByType: {} as Record<OperationType, string[]>,
};
