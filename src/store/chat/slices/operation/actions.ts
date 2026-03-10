import { nanoid } from '@lobechat/utils';
import debug from 'debug';
import { produce } from 'immer';

import { type ChatStore } from '@/store/chat/store';
import { type MessageMapKeyInput } from '@/store/chat/utils/messageMapKey';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { type StoreSetter } from '@/store/types';
import { setNamespace } from '@/utils/storeDebug';

import {
  type AfterCompletionCallback,
  type Operation,
  type OperationCancelContext,
  type OperationContext,
  type OperationFilter,
  type OperationMetadata,
  type OperationStatus,
  type OperationType,
} from './types';

const n = setNamespace('operation');
const log = debug('lobe-store:operation');

/**
 * Operation Actions
 */

type Setter = StoreSetter<ChatStore>;
export const operationActions = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new OperationActionsImpl(set, get, _api);

export class OperationActionsImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  internal_getConversationContext = (context?: { operationId?: string }): MessageMapKeyInput => {
    if (context?.operationId) {
      const operation = this.#get().operations[context.operationId];
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
    const agentId = this.#get().activeAgentId;
    const groupId = this.#get().activeGroupId;
    const topicId = this.#get().activeTopicId;
    const threadId = this.#get().activeThreadId;
    log('[internal_getConversationContext] use global state: ', {
      agentId,
      topicId,
      threadId,
      groupId,
    });
    return { agentId, topicId, threadId, groupId };
  };

  startOperation = (params: {
    context?: Partial<OperationContext>;
    description?: string;
    label?: string;
    metadata?: Partial<OperationMetadata>;
    operationId?: string;
    parentOperationId?: string;
    type: OperationType;
  }): { abortController: AbortController; operationId: string } => {
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
      const parentOp = this.#get().operations[parentOperationId];
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

    this.#set(
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
      this.#get().cleanupCompletedOperations(30_000);
    }

    return { operationId, abortController };
  };

  updateOperationMetadata = (operationId: string, metadata: Partial<OperationMetadata>): void => {
    const operation = this.#get().operations[operationId];
    if (metadata.isAborting) {
      log(
        '[updateOperationMetadata] Setting isAborting=true for operation %s (type=%s)',
        operationId,
        operation?.type,
      );
    }

    this.#set(
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
  };

  updateOperationStatus = (
    operationId: string,
    status: OperationStatus,
    metadata?: Partial<OperationMetadata>,
  ): void => {
    this.#set(
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
  };

  updateOperationProgress = (operationId: string, current: number, total?: number): void => {
    this.#set(
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
  };

  completeOperation = (operationId: string, metadata?: Partial<OperationMetadata>): void => {
    const operation = this.#get().operations[operationId];
    if (operation) {
      log(
        '[completeOperation] operation %s (type=%s) completed, duration=%dms',
        operationId,
        operation.type,
        Date.now() - operation.metadata.startTime,
      );
    }

    this.#set(
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
  };

  getOperationAbortSignal = (operationId: string): AbortSignal => {
    const operation = this.#get().operations[operationId];
    if (!operation) {
      throw new Error(`[getOperationAbortSignal] Operation not found: ${operationId}`);
    }
    return operation.abortController.signal;
  };

  onOperationCancel = (
    operationId: string,
    handler: (context: OperationCancelContext) => void | Promise<void>,
  ): void => {
    this.#set(
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
  };

  registerAfterCompletionCallback = (
    operationId: string,
    callback: AfterCompletionCallback,
  ): void => {
    this.#set(
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
  };

  cancelOperation = (operationId: string, reason: string = 'User cancelled'): void => {
    const operation = this.#get().operations[operationId];
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
      this.#get().updateOperationMetadata(operationId, { isAborting: true });
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
    this.#set(
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
        this.#get().cancelOperation(childId, 'Parent operation cancelled');
      });
    }
  };

  failOperation = (
    operationId: string,
    error: { code?: string; details?: any; message: string; type: string },
  ): void => {
    const operation = this.#get().operations[operationId];
    if (operation) {
      log(
        '[failOperation] operation %s (type=%s) failed: %s',
        operationId,
        operation.type,
        error.message,
      );
    }

    this.#set(
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
  };

  cancelOperations = (filter: OperationFilter, reason: string = 'Batch cancelled'): string[] => {
    const operations = Object.values(this.#get().operations);
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
      this.#get().cancelOperation(id, reason);
    });

    return matchedIds;
  };

  cancelAllOperations = (reason: string = 'Cancel all operations'): void => {
    const operations = Object.values(this.#get().operations);

    operations.forEach((op) => {
      if (op.status === 'running') {
        this.#get().cancelOperation(op.id, reason);
      }
    });
  };

  cleanupCompletedOperations = (olderThan: number = 60_000): number => {
    // Default: cleanup operations completed more than 1 minute ago
    const now = Date.now();

    // Collect operations to delete first
    const operationsToDelete: string[] = [];
    Object.values(this.#get().operations).forEach((op) => {
      const isCompleted =
        op.status === 'completed' || op.status === 'cancelled' || op.status === 'failed';
      const isOld = op.metadata.endTime && now - op.metadata.endTime > olderThan;

      if (isCompleted && isOld) {
        operationsToDelete.push(op.id);
      }
    });

    if (operationsToDelete.length === 0) return 0;

    this.#set(
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
  };

  associateMessageWithOperation = (messageId: string, operationId: string): void => {
    this.#set(
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
  };

  markUnreadCompleted = (agentId: string, topicId?: string | null): void => {
    const { activeAgentId, activeTopicId } = this.#get();

    // Only mark when user is NOT currently viewing this agent/topic
    const isViewingAgent = activeAgentId === agentId;
    const isViewingTopic = isViewingAgent && (activeTopicId ?? null) === (topicId ?? null);

    if (!isViewingAgent) {
      this.#set(
        produce((state: ChatStore) => {
          state.unreadCompletedAgentIds.add(agentId);
        }),
        false,
        n(`markUnreadCompleted/agent/${agentId}`),
      );
    }

    if (topicId && !isViewingTopic) {
      this.#set(
        produce((state: ChatStore) => {
          state.unreadCompletedTopicIds.add(topicId);
        }),
        false,
        n(`markUnreadCompleted/topic/${topicId}`),
      );
    }
  };

  clearUnreadCompletedAgent = (agentId: string): void => {
    if (!this.#get().unreadCompletedAgentIds.has(agentId)) return;
    this.#set(
      produce((state: ChatStore) => {
        state.unreadCompletedAgentIds.delete(agentId);
      }),
      false,
      n(`clearUnreadCompleted/agent/${agentId}`),
    );
  };

  clearUnreadCompletedTopic = (topicId: string): void => {
    if (!this.#get().unreadCompletedTopicIds.has(topicId)) return;
    this.#set(
      produce((state: ChatStore) => {
        state.unreadCompletedTopicIds.delete(topicId);
      }),
      false,
      n(`clearUnreadCompleted/topic/${topicId}`),
    );
  };
}

export type OperationActions = Pick<OperationActionsImpl, keyof OperationActionsImpl>;
