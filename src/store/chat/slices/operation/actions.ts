/* eslint-disable sort-keys-fix/sort-keys-fix */
import { nanoid } from '@lobechat/utils';
import debug from 'debug';
import { produce } from 'immer';
import { type StateCreator } from 'zustand/vanilla';

import { type ChatStore } from '@/store/chat/store';
import { type MessageMapKeyInput, messageMapKey } from '@/store/chat/utils/messageMapKey';
import { setNamespace } from '@/utils/storeDebug';

import type {
  AfterCompletionCallback,
  Operation,
  OperationCancelContext,
  OperationContext,
  OperationFilter,
  OperationMetadata,
  OperationStatus,
  OperationType,
} from './types';

const n = setNamespace('operation');
const log = debug('lobe-store:operation');

/**
 * Operation Actions
 */
export interface OperationActions {
  /**
   * Associate message with operation (for automatic context retrieval)
   */
  associateMessageWithOperation: (messageId: string, operationId: string) => void;

  /**
   * Cancel all operations
   */
  cancelAllOperations: (reason?: string) => void;

  /**
   * Cancel operation (recursively cancel all child operations)
   */
  cancelOperation: (operationId: string, reason?: string) => void;

  /**
   * Cancel operations by filter
   */
  cancelOperations: (filter: OperationFilter, reason?: string) => string[];

  /**
   * Clean up completed or cancelled operations
   * Removes operations that are older than the specified age (default: 30 seconds)
   */
  cleanupCompletedOperations: (maxAgeMs?: number) => number;

  /**
   * Complete operation
   */
  completeOperation: (operationId: string, metadata?: Partial<OperationMetadata>) => void;

  /**
   * Mark operation as failed
   */
  failOperation: (
    operationId: string,
    error: { code?: string; details?: any; message: string; type: string },
  ) => void;

  /**
   * Get operation's AbortSignal (for passing to async operations like fetch)
   */
  getOperationAbortSignal: (operationId: string) => AbortSignal;

  /**
   * Get conversation context from operation or fallback to global state
   * This is a helper method that can be used by other slices
   *
   * Returns full MessageMapKeyInput for consistent key generation
   *
   * Migration Note:
   * - Only agentId is used for message association
   * - Backend handles sessionId mapping internally based on agentId
   */
  internal_getConversationContext: (context?: { operationId?: string }) => MessageMapKeyInput;

  /**
   * Register cancel handler for an operation
   * The handler will be called when the operation is cancelled
   */
  onOperationCancel: (
    operationId: string,
    handler: (context: OperationCancelContext) => void | Promise<void>,
  ) => void;

  /**
   * Register an afterCompletion callback for an operation
   * The callback will be executed after the AgentRuntime completes
   * Used to avoid race conditions with message updates
   */
  registerAfterCompletionCallback: (operationId: string, callback: AfterCompletionCallback) => void;

  /**
   * Start an operation (supports auto-inheriting context from parent operation)
   */
  startOperation: (params: {
    context?: Partial<OperationContext>;
    description?: string;
    label?: string;
    metadata?: Partial<OperationMetadata>;
    operationId?: string;
    parentOperationId?: string;
    type: OperationType;
  }) => { abortController: AbortController; operationId: string };

  /**
   * Update operation metadata
   */
  updateOperationMetadata: (operationId: string, metadata: Partial<OperationMetadata>) => void;

  /**
   * Update operation progress
   */
  updateOperationProgress: (operationId: string, current: number, total?: number) => void;

  /**
   * Update operation status
   */
  updateOperationStatus: (
    operationId: string,
    status: OperationStatus,
    metadata?: Partial<OperationMetadata>,
  ) => void;
}

export const operationActions: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  OperationActions
> = (set, get) => ({
  internal_getConversationContext: (context) => {
    if (context?.operationId) {
      const operation = get().operations[context.operationId];
      if (!operation) {
        log(
          '[internal_getConversationContext] ERROR: Operation not found: %s',
          context.operationId,
        );
        throw new Error(`Operation not found: ${context.operationId}`);
      }
      const { agentId, topicId, threadId, scope, isNew, groupId } = operation.context;
      log(
        '[internal_getConversationContext] get from operation %s: agentId=%s, topicId=%s, threadId=%s, scope=%s, groupId=%s',
        context.operationId,
        agentId,
        topicId,
        threadId,
        scope,
        groupId,
      );
      return { agentId: agentId!, topicId, threadId, scope, isNew, groupId };
    }

    // Fallback to global state
    const agentId = get().activeAgentId;
    const groupId = get().activeGroupId;
    const topicId = get().activeTopicId;
    const threadId = get().activeThreadId;
    log('[internal_getConversationContext] use global state: ', {
      agentId,
      topicId,
      threadId,
      groupId,
    });
    return { agentId, topicId, threadId, groupId };
  },

  startOperation: (params) => {
    const {
      type,
      context: partialContext,
      parentOperationId,
      label,
      description,
      metadata,
      operationId: customOperationId,
    } = params;

    const operationId = customOperationId || `op_${nanoid()}`;

    // If parent operation exists and context is not fully provided, inherit from parent
    let context: OperationContext = partialContext || {};

    if (parentOperationId) {
      const parentOp = get().operations[parentOperationId];
      if (parentOp) {
        // Inherit parent's context, allow partial override
        context = { ...parentOp.context, ...partialContext };
        log('[startOperation] inherit context from parent %s: %o', parentOperationId, context);
      }
    }

    log('[startOperation] create operation %s (type=%s, context=%o)', operationId, type, context);

    const abortController = new AbortController();
    const now = Date.now();

    const operation: Operation = {
      id: operationId,
      type,
      status: 'running',
      context,
      abortController,
      metadata: {
        startTime: now,
        ...metadata,
      },
      parentOperationId,
      childOperationIds: [],
      label,
      description,
    };

    set(
      produce((state: ChatStore) => {
        // Add to operations map
        state.operations[operationId] = operation;

        // Update type index
        if (!state.operationsByType[type]) {
          state.operationsByType[type] = [];
        }
        state.operationsByType[type].push(operationId);

        // Update message index (if messageId exists)
        if (context.messageId) {
          if (!state.operationsByMessage[context.messageId]) {
            state.operationsByMessage[context.messageId] = [];
          }
          state.operationsByMessage[context.messageId].push(operationId);

          // Auto-associate message with this operation (most granular)
          // This allows tools to access the correct AbortController via messageOperationMap
          state.messageOperationMap[context.messageId] = operationId;
        }

        // Update context index (if agentId exists)
        if (context.agentId) {
          const contextKey = messageMapKey({
            agentId: context.agentId,
            groupId: context.groupId,
            topicId: context.topicId !== undefined ? context.topicId : null,
          });
          if (!state.operationsByContext[contextKey]) {
            state.operationsByContext[contextKey] = [];
          }
          state.operationsByContext[contextKey].push(operationId);
        }

        // Update parent's childOperationIds
        if (parentOperationId && state.operations[parentOperationId]) {
          if (!state.operations[parentOperationId].childOperationIds) {
            state.operations[parentOperationId].childOperationIds = [];
          }
          state.operations[parentOperationId].childOperationIds!.push(operationId);
        }
      }),
      false,
      n(`startOperation/${type}/${operationId}`),
    );

    // Periodically cleanup old completed operations
    // Only cleanup for top-level operations (no parent) to avoid excessive cleanup calls
    if (!parentOperationId) {
      // Clean up operations completed more than 30 seconds ago
      get().cleanupCompletedOperations(30_000);
    }

    return { operationId, abortController };
  },

  updateOperationMetadata: (operationId, metadata) => {
    const operation = get().operations[operationId];
    if (metadata.isAborting) {
      log(
        '[updateOperationMetadata] Setting isAborting=true for operation %s (type=%s)',
        operationId,
        operation?.type,
      );
    }

    set(
      produce((state: ChatStore) => {
        const operation = state.operations[operationId];
        if (!operation) return;

        operation.metadata = {
          ...operation.metadata,
          ...metadata,
        };
      }),
      false,
      n(`updateOperationMetadata/${operationId}`),
    );
  },

  updateOperationStatus: (operationId, status, metadata) => {
    set(
      produce((state: ChatStore) => {
        const operation = state.operations[operationId];
        if (!operation) return;

        operation.status = status;

        if (metadata) {
          operation.metadata = {
            ...operation.metadata,
            ...metadata,
          };
        }
      }),
      false,
      n(`updateOperationStatus/${operationId}/${status}`),
    );
  },

  updateOperationProgress: (operationId, current, total) => {
    set(
      produce((state: ChatStore) => {
        const operation = state.operations[operationId];
        if (!operation) return;

        operation.metadata.progress = {
          current,
          total: total ?? operation.metadata.progress?.total ?? current,
          percentage: total ? Math.round((current / total) * 100) : undefined,
        };
      }),
      false,
      n(`updateOperationProgress/${operationId}`),
    );
  },

  completeOperation: (operationId, metadata) => {
    const operation = get().operations[operationId];
    if (operation) {
      log(
        '[completeOperation] operation %s (type=%s) completed, duration=%dms',
        operationId,
        operation.type,
        Date.now() - operation.metadata.startTime,
      );
    }

    set(
      produce((state: ChatStore) => {
        const operation = state.operations[operationId];
        if (!operation) return;

        const now = Date.now();
        operation.status = 'completed';
        operation.metadata.endTime = now;
        operation.metadata.duration = now - operation.metadata.startTime;

        if (metadata) {
          operation.metadata = {
            ...operation.metadata,
            ...metadata,
          };
        }
      }),
      false,
      n(`completeOperation/${operationId}`),
    );
  },

  getOperationAbortSignal: (operationId) => {
    const operation = get().operations[operationId];
    if (!operation) {
      throw new Error(`[getOperationAbortSignal] Operation not found: ${operationId}`);
    }
    return operation.abortController.signal;
  },

  onOperationCancel: (operationId, handler) => {
    set(
      produce((state: ChatStore) => {
        const operation = state.operations[operationId];
        if (!operation) {
          log('[onOperationCancel] WARNING: Operation not found: %s', operationId);
          return;
        }

        operation.onCancelHandler = handler;
        log(
          '[onOperationCancel] registered cancel handler for %s (type=%s)',
          operationId,
          operation.type,
        );
      }),
      false,
      n(`onOperationCancel/${operationId}`),
    );
  },

  registerAfterCompletionCallback: (operationId, callback) => {
    set(
      produce((state: ChatStore) => {
        const operation = state.operations[operationId];
        if (!operation) {
          log('[registerAfterCompletionCallback] WARNING: Operation not found: %s', operationId);
          return;
        }

        // Initialize runtimeHooks if not exists
        if (!operation.metadata.runtimeHooks) {
          operation.metadata.runtimeHooks = {};
        }

        // Initialize afterCompletionCallbacks array if not exists
        if (!operation.metadata.runtimeHooks.afterCompletionCallbacks) {
          operation.metadata.runtimeHooks.afterCompletionCallbacks = [];
        }

        // Add callback to array
        operation.metadata.runtimeHooks.afterCompletionCallbacks.push(callback);

        log(
          '[registerAfterCompletionCallback] registered callback for %s (type=%s), total callbacks: %d',
          operationId,
          operation.type,
          operation.metadata.runtimeHooks.afterCompletionCallbacks.length,
        );
      }),
      false,
      n(`registerAfterCompletionCallback/${operationId}`),
    );
  },

  cancelOperation: (operationId, reason = 'User cancelled') => {
    const operation = get().operations[operationId];
    if (!operation) {
      log('[cancelOperation] operation not found: %s', operationId);
      return;
    }

    // Skip if already cancelled or completed
    if (operation.status === 'cancelled' || operation.status === 'completed') {
      log('[cancelOperation] operation %s already %s, skipping', operationId, operation.status);
      return;
    }

    log(
      '[cancelOperation] cancelling operation %s (type=%s), reason: %s',
      operationId,
      operation.type,
      reason,
    );

    // 1. Abort the operation (triggers AbortSignal for all async operations)
    try {
      operation.abortController.abort(reason);
    } catch {
      // Ignore abort errors
    }

    // 2. Set isAborting flag immediately for execAgentRuntime operations
    // This ensures UI (loading button) responds instantly to user cancellation
    if (operation.type === 'execAgentRuntime') {
      get().updateOperationMetadata(operationId, { isAborting: true });
    }

    // 3. Call cancel handler if registered
    if (operation.onCancelHandler) {
      log('[cancelOperation] calling cancel handler for %s (type=%s)', operationId, operation.type);

      const cancelContext: OperationCancelContext = {
        operationId,
        type: operation.type,
        reason,
        metadata: operation.metadata,
      };

      // Execute handler asynchronously (don't block cancellation flow)
      // Use try-catch to handle synchronous errors, then wrap in Promise for async errors
      try {
        Promise.resolve(operation.onCancelHandler(cancelContext)).catch((err) => {
          log('[cancelOperation] cancel handler error for %s: %O', operationId, err);
        });
      } catch (err) {
        // Handle synchronous errors from handler
        log('[cancelOperation] cancel handler synchronous error for %s: %O', operationId, err);
      }
    }

    // 4. Update status
    set(
      produce((state: ChatStore) => {
        const op = state.operations[operationId];
        if (!op) return;

        const now = Date.now();
        op.status = 'cancelled';
        op.metadata.endTime = now;
        op.metadata.duration = now - op.metadata.startTime;
        op.metadata.cancelReason = reason;
      }),
      false,
      n(`cancelOperation/${operationId}`),
    );

    // 4. Cancel all child operations recursively
    if (operation.childOperationIds && operation.childOperationIds.length > 0) {
      log('[cancelOperation] cancelling %d child operations', operation.childOperationIds.length);
      operation.childOperationIds.forEach((childId) => {
        get().cancelOperation(childId, 'Parent operation cancelled');
      });
    }
  },

  failOperation: (operationId, error) => {
    const operation = get().operations[operationId];
    if (operation) {
      log(
        '[failOperation] operation %s (type=%s) failed: %s',
        operationId,
        operation.type,
        error.message,
      );
    }

    set(
      produce((state: ChatStore) => {
        const operation = state.operations[operationId];
        if (!operation) return;

        const now = Date.now();
        operation.status = 'failed';
        operation.metadata.endTime = now;
        operation.metadata.duration = now - operation.metadata.startTime;
        operation.metadata.error = error;
      }),
      false,
      n(`failOperation/${operationId}`),
    );
  },

  cancelOperations: (filter, reason = 'Batch cancelled') => {
    const operations = Object.values(get().operations);
    const matchedIds: string[] = [];

    operations.forEach((op) => {
      if (op.status !== 'running') return;

      let matches = true;

      // Type filter
      if (filter.type) {
        const types = Array.isArray(filter.type) ? filter.type : [filter.type];
        matches = matches && types.includes(op.type);
      }

      // Status filter
      if (filter.status) {
        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
        matches = matches && statuses.includes(op.status);
      }

      // Context filters
      if (filter.agentId !== undefined) {
        matches = matches && op.context.agentId === filter.agentId;
      }
      if (filter.topicId !== undefined) {
        matches = matches && op.context.topicId === filter.topicId;
      }
      if (filter.messageId !== undefined) {
        matches = matches && op.context.messageId === filter.messageId;
      }
      if (filter.threadId !== undefined) {
        matches = matches && op.context.threadId === filter.threadId;
      }
      if (filter.groupId !== undefined) {
        matches = matches && op.context.groupId === filter.groupId;
      }
      if (filter.agentId !== undefined) {
        matches = matches && op.context.agentId === filter.agentId;
      }

      if (matches) {
        matchedIds.push(op.id);
      }
    });

    // Cancel all matched operations
    matchedIds.forEach((id) => {
      get().cancelOperation(id, reason);
    });

    return matchedIds;
  },

  cancelAllOperations: (reason = 'Cancel all operations') => {
    const operations = Object.values(get().operations);

    operations.forEach((op) => {
      if (op.status === 'running') {
        get().cancelOperation(op.id, reason);
      }
    });
  },

  cleanupCompletedOperations: (olderThan = 60_000) => {
    // Default: cleanup operations completed more than 1 minute ago
    const now = Date.now();

    // Collect operations to delete first
    const operationsToDelete: string[] = [];
    Object.values(get().operations).forEach((op) => {
      const isCompleted =
        op.status === 'completed' || op.status === 'cancelled' || op.status === 'failed';
      const isOld = op.metadata.endTime && now - op.metadata.endTime > olderThan;

      if (isCompleted && isOld) {
        operationsToDelete.push(op.id);
      }
    });

    if (operationsToDelete.length === 0) return 0;

    set(
      produce((state: ChatStore) => {
        // Delete operations and update indexes
        operationsToDelete.forEach((operationId) => {
          const op = state.operations[operationId];
          if (!op) return;

          // Remove from operations map
          delete state.operations[operationId];

          // Remove from type index
          const typeIndex = state.operationsByType[op.type];
          if (typeIndex) {
            state.operationsByType[op.type] = typeIndex.filter((id) => id !== operationId);
          }

          // Remove from message index
          if (op.context.messageId) {
            const msgIndex = state.operationsByMessage[op.context.messageId];
            if (msgIndex) {
              state.operationsByMessage[op.context.messageId] = msgIndex.filter(
                (id) => id !== operationId,
              );
            }
          }

          // Remove from context index
          if (op.context.agentId) {
            const contextKey = messageMapKey({
              agentId: op.context.agentId,
              groupId: op.context.groupId,
              topicId: op.context.topicId !== undefined ? op.context.topicId : null,
            });
            const contextIndex = state.operationsByContext[contextKey];
            if (contextIndex) {
              state.operationsByContext[contextKey] = contextIndex.filter(
                (id) => id !== operationId,
              );
            }
          }

          // Remove from parent's childOperationIds
          if (op.parentOperationId && state.operations[op.parentOperationId]) {
            const parent = state.operations[op.parentOperationId];
            if (parent.childOperationIds) {
              parent.childOperationIds = parent.childOperationIds.filter(
                (id) => id !== operationId,
              );
            }
          }

          // Remove from messageOperationMap
          const messageEntry = Object.entries(state.messageOperationMap).find(
            ([, opId]) => opId === operationId,
          );
          if (messageEntry) {
            delete state.messageOperationMap[messageEntry[0]];
          }
        });
      }),
      false,
      n(`cleanupCompletedOperations/count=${operationsToDelete.length}`),
    );

    log('[cleanupCompletedOperations] cleaned up %d operations', operationsToDelete.length);
    return operationsToDelete.length;
  },

  associateMessageWithOperation: (messageId, operationId) => {
    set(
      produce((state: ChatStore) => {
        // Update messageOperationMap (for single operation lookup)
        state.messageOperationMap[messageId] = operationId;

        // Update operationsByMessage index (for multiple operations lookup)
        if (!state.operationsByMessage[messageId]) {
          state.operationsByMessage[messageId] = [];
        }
        if (!state.operationsByMessage[messageId].includes(operationId)) {
          state.operationsByMessage[messageId].push(operationId);
        }
      }),
      false,
      n(`associateMessageWithOperation/${messageId}/${operationId}`),
    );
  },
});
