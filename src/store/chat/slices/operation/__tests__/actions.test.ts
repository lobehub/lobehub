import { act, renderHook } from '@testing-library/react';
import { produce } from 'immer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat/store';

describe('Operation Actions', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe('startOperation', () => {
    it('should create a new operation with correct initial state', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;
      let abortController: AbortController;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: 'topic1', messageId: 'msg1' },
          label: 'Generating...',
        });
        operationId = res.operationId;
        abortController = res.abortController;
      });

      const operation = result.current.operations[operationId!];

      expect(operation).toBeDefined();
      expect(operation.type).toBe('execAgentRuntime');
      expect(operation.status).toBe('running');
      expect(operation.context.agentId).toBe('session1');
      expect(operation.context.topicId).toBe('topic1');
      expect(operation.context.messageId).toBe('msg1');
      expect(operation.label).toBe('Generating...');
      expect(operation.abortController).toBe(abortController!);
    });

    it('should inherit context from parent operation', () => {
      const { result } = renderHook(() => useChatStore());

      let parentOpId: string;
      let childOpId: string;

      act(() => {
        // Create parent operation
        const parent = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', topicId: 'topic1' },
        });
        parentOpId = parent.operationId;

        // Create child operation (inherits context)
        const child = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { messageId: 'msg1' }, // Only override messageId
          parentOperationId: parentOpId,
        });
        childOpId = child.operationId;
      });

      const childOp = result.current.operations[childOpId!];

      expect(childOp.context.agentId).toBe('session1'); // Inherited
      expect(childOp.context.topicId).toBe('topic1'); // Inherited
      expect(childOp.context.messageId).toBe('msg1'); // Overridden
      expect(childOp.parentOperationId).toBe(parentOpId!);
    });

    it('should fully inherit parent context when child context is undefined', () => {
      const { result } = renderHook(() => useChatStore());

      let parentOpId: string;
      let childOpId: string;

      act(() => {
        // Create parent operation with full context
        const parent = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', topicId: 'topic1', messageId: 'msg1' },
        });
        parentOpId = parent.operationId;

        // Create child operation without context (undefined)
        const child = result.current.startOperation({
          type: 'execAgentRuntime',
          parentOperationId: parentOpId,
        });
        childOpId = child.operationId;
      });

      const childOp = result.current.operations[childOpId!];

      // Should fully inherit parent's context
      expect(childOp.context.agentId).toBe('session1');
      expect(childOp.context.topicId).toBe('topic1');
      expect(childOp.context.messageId).toBe('msg1');
      expect(childOp.parentOperationId).toBe(parentOpId!);
    });

    it('should update indexes correctly', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: 'topic1', messageId: 'msg1' },
        }).operationId;
      });

      // Check type index
      expect(result.current.operationsByType.execAgentRuntime).toContain(operationId!);

      // Check message index
      expect(result.current.operationsByMessage.msg1).toContain(operationId!);

      // Check context index
      const contextKey = 'main_session1_topic1';
      expect(result.current.operationsByContext[contextKey]).toContain(operationId!);
    });
  });

  describe('completeOperation', () => {
    it('should mark operation as completed with correct metadata', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;
      });

      const startTime = result.current.operations[operationId!].metadata.startTime;

      act(() => {
        result.current.completeOperation(operationId!);
      });

      const operation = result.current.operations[operationId!];

      expect(operation.status).toBe('completed');
      expect(operation.metadata.endTime).toBeDefined();
      expect(operation.metadata.duration).toBeDefined();
      expect(operation.metadata.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('cancelOperation', () => {
    it('should cancel operation and abort controller', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;
      let abortController: AbortController;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        });
        operationId = res.operationId;
        abortController = res.abortController;
      });

      act(() => {
        result.current.cancelOperation(operationId!, 'User cancelled');
      });

      const operation = result.current.operations[operationId!];

      expect(operation.status).toBe('cancelled');
      expect(operation.metadata.cancelReason).toBe('User cancelled');
      expect(abortController!.signal.aborted).toBe(true);
    });

    it('should recursively cancel child operations', () => {
      const { result } = renderHook(() => useChatStore());

      let parentOpId: string;
      let child1OpId: string;
      let child2OpId: string;

      act(() => {
        parentOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        child1OpId = result.current.startOperation({
          type: 'reasoning',
          parentOperationId: parentOpId,
        }).operationId;

        child2OpId = result.current.startOperation({
          type: 'toolCalling',
          parentOperationId: parentOpId,
        }).operationId;
      });

      act(() => {
        result.current.cancelOperation(parentOpId!);
      });

      expect(result.current.operations[parentOpId!].status).toBe('cancelled');
      expect(result.current.operations[child1OpId!].status).toBe('cancelled');
      expect(result.current.operations[child2OpId!].status).toBe('cancelled');
    });

    it('should not cancel already completed child operations', () => {
      const { result } = renderHook(() => useChatStore());

      let parentOpId: string;
      let completedChildOpId: string;
      let runningChildOpId: string;

      act(() => {
        parentOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        completedChildOpId = result.current.startOperation({
          type: 'toolCalling',
          parentOperationId: parentOpId,
        }).operationId;

        runningChildOpId = result.current.startOperation({
          type: 'reasoning',
          parentOperationId: parentOpId,
        }).operationId;

        // Complete the first child
        result.current.completeOperation(completedChildOpId!);
      });

      // Verify initial states
      expect(result.current.operations[completedChildOpId!].status).toBe('completed');
      expect(result.current.operations[runningChildOpId!].status).toBe('running');

      act(() => {
        result.current.cancelOperation(parentOpId!);
      });

      // Parent and running child should be cancelled
      expect(result.current.operations[parentOpId!].status).toBe('cancelled');
      expect(result.current.operations[runningChildOpId!].status).toBe('cancelled');

      // Completed child should remain completed (not cancelled)
      expect(result.current.operations[completedChildOpId!].status).toBe('completed');
    });

    it('should not invoke cancel handler for already completed operations', async () => {
      const { result } = renderHook(() => useChatStore());

      let parentOpId: string;
      let completedChildOpId: string;
      const completedChildHandler = vi.fn();

      act(() => {
        parentOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        completedChildOpId = result.current.startOperation({
          type: 'toolCalling',
          parentOperationId: parentOpId,
        }).operationId;

        // Register cancel handler
        result.current.onOperationCancel(completedChildOpId!, completedChildHandler);

        // Complete the child operation
        result.current.completeOperation(completedChildOpId!);
      });

      act(() => {
        result.current.cancelOperation(parentOpId!);
      });

      // Wait a bit to ensure no async handler calls
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Handler should NOT be called for completed operation
      expect(completedChildHandler).not.toHaveBeenCalled();
    });

    it('should skip cancellation of already cancelled operations', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;
      });

      // Cancel the operation
      act(() => {
        result.current.cancelOperation(operationId!, 'First cancellation');
      });

      expect(result.current.operations[operationId!].status).toBe('cancelled');
      expect(result.current.operations[operationId!].metadata.cancelReason).toBe(
        'First cancellation',
      );

      // Try to cancel again
      act(() => {
        result.current.cancelOperation(operationId!, 'Second cancellation');
      });

      // Should still have the first cancellation reason (not updated)
      expect(result.current.operations[operationId!].status).toBe('cancelled');
      expect(result.current.operations[operationId!].metadata.cancelReason).toBe(
        'First cancellation',
      );
    });
  });

  describe('failOperation', () => {
    it('should mark operation as failed with error', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;
      });

      act(() => {
        result.current.failOperation(operationId!, {
          type: 'NetworkError',
          message: 'Connection failed',
          code: 'ERR_NETWORK',
        });
      });

      const operation = result.current.operations[operationId!];

      expect(operation.status).toBe('failed');
      expect(operation.metadata.error).toEqual({
        type: 'NetworkError',
        message: 'Connection failed',
        code: 'ERR_NETWORK',
      });
    });
  });

  describe('cancelOperations (batch)', () => {
    it('should cancel operations matching filter', () => {
      const { result } = renderHook(() => useChatStore());

      let op1: string;
      let op2: string;
      let op3: string;

      act(() => {
        op1 = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        op2 = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        op3 = result.current.startOperation({
          type: 'reasoning',
          context: { agentId: 'session1' },
        }).operationId;
      });

      act(() => {
        const cancelled = result.current.cancelOperations({ type: 'execAgentRuntime' });
        expect(cancelled).toHaveLength(2);
      });

      expect(result.current.operations[op1!].status).toBe('cancelled');
      expect(result.current.operations[op2!].status).toBe('cancelled');
      expect(result.current.operations[op3!].status).toBe('running'); // Not cancelled
    });
  });

  describe('cleanupCompletedOperations', () => {
    it('should remove operations completed longer than specified time', () => {
      const { result } = renderHook(() => useChatStore());

      let op1: string;
      let op2: string;
      let op3: string;

      act(() => {
        // Create and complete operations at different times
        op1 = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        op2 = result.current.startOperation({
          type: 'reasoning',
          context: { agentId: 'session1' },
        }).operationId;

        op3 = result.current.startOperation({
          type: 'toolCalling',
          context: { agentId: 'session1' },
        }).operationId;

        // Complete op1 and op2, leave op3 running
        result.current.completeOperation(op1!);
        result.current.completeOperation(op2!);
      });

      // Manually set endTime to simulate operations completed long ago
      act(() => {
        useChatStore.setState(
          produce((state) => {
            const now = Date.now();
            if (state.operations[op1!]) {
              state.operations[op1!].metadata.endTime = now - 70_000; // 70 seconds ago
            }
            if (state.operations[op2!]) {
              state.operations[op2!].metadata.endTime = now - 20_000; // 20 seconds ago
            }
          }),
        );
      });

      // Cleanup operations older than 60 seconds
      let cleanedCount = 0;
      act(() => {
        cleanedCount = result.current.cleanupCompletedOperations(60_000);
      });

      expect(cleanedCount).toBe(1);
      expect(result.current.operations[op1!]).toBeUndefined(); // Removed (70s old)
      expect(result.current.operations[op2!]).toBeDefined(); // Kept (20s old)
      expect(result.current.operations[op3!]).toBeDefined(); // Kept (running)
    });

    it('should clean up operations on startOperation for top-level operations', () => {
      const { result } = renderHook(() => useChatStore());

      let completedOp: string;

      act(() => {
        // Create and complete an operation
        completedOp = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        result.current.completeOperation(completedOp!);

        // Set endTime to 40 seconds ago
        useChatStore.setState(
          produce((state) => {
            if (state.operations[completedOp!]) {
              state.operations[completedOp!].metadata.endTime = Date.now() - 40_000;
            }
          }),
        );
      });

      expect(result.current.operations[completedOp!]).toBeDefined();

      // Start a new top-level operation (should trigger cleanup)
      act(() => {
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        });
      });

      // Old operation should be cleaned up (older than 30s)
      expect(result.current.operations[completedOp!]).toBeUndefined();
    });

    it('should not clean up operations when starting child operations', () => {
      const { result } = renderHook(() => useChatStore());

      let parentOp: string;
      let oldCompletedOp: string;

      act(() => {
        // Create parent operation
        parentOp = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        // Create and complete an old operation
        oldCompletedOp = result.current.startOperation({
          type: 'reasoning',
          context: { agentId: 'session1' },
        }).operationId;

        result.current.completeOperation(oldCompletedOp!);

        // Set endTime to 40 seconds ago
        useChatStore.setState(
          produce((state) => {
            if (state.operations[oldCompletedOp!]) {
              state.operations[oldCompletedOp!].metadata.endTime = Date.now() - 40_000;
            }
          }),
        );
      });

      // Start a child operation (should NOT trigger cleanup)
      act(() => {
        result.current.startOperation({
          type: 'callLLM',
          parentOperationId: parentOp!,
        });
      });

      // Old operation should still exist (cleanup not triggered for child operations)
      expect(result.current.operations[oldCompletedOp!]).toBeDefined();
    });

    it('should clean up cancelled and failed operations', () => {
      const { result } = renderHook(() => useChatStore());

      let cancelledOp: string;
      let failedOp: string;

      act(() => {
        cancelledOp = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        failedOp = result.current.startOperation({
          type: 'reasoning',
          context: { agentId: 'session1' },
        }).operationId;

        result.current.cancelOperation(cancelledOp!, 'User cancelled');
        result.current.failOperation(failedOp!, {
          type: 'Error',
          message: 'Failed',
        });

        // Set endTime to 70 seconds ago
        useChatStore.setState(
          produce((state) => {
            const now = Date.now();
            if (state.operations[cancelledOp!]) {
              state.operations[cancelledOp!].metadata.endTime = now - 70_000;
            }
            if (state.operations[failedOp!]) {
              state.operations[failedOp!].metadata.endTime = now - 70_000;
            }
          }),
        );
      });

      let cleanedCount = 0;
      act(() => {
        cleanedCount = result.current.cleanupCompletedOperations(60_000);
      });

      expect(cleanedCount).toBe(2);
      expect(result.current.operations[cancelledOp!]).toBeUndefined();
      expect(result.current.operations[failedOp!]).toBeUndefined();
    });
  });

  describe('associateMessageWithOperation', () => {
    it('should create message-operation mapping', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        result.current.associateMessageWithOperation('msg1', operationId!);
      });

      expect(result.current.messageOperationMap.msg1).toBe(operationId!);
      expect(result.current.operationsByMessage.msg1).toContain(operationId!);
    });

    it('should update operationsByMessage index', () => {
      const { result } = renderHook(() => useChatStore());

      let op1: string;
      let op2: string;

      act(() => {
        op1 = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        op2 = result.current.startOperation({
          type: 'regenerate',
          context: { agentId: 'session1' },
        }).operationId;

        // Associate same message with multiple operations
        result.current.associateMessageWithOperation('msg1', op1!);
        result.current.associateMessageWithOperation('msg1', op2!);
      });

      // Both operations should be in the index
      expect(result.current.operationsByMessage.msg1).toContain(op1!);
      expect(result.current.operationsByMessage.msg1).toContain(op2!);
      expect(result.current.operationsByMessage.msg1).toHaveLength(2);
    });

    it('should not duplicate operation IDs in operationsByMessage', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        // Associate same operation twice
        result.current.associateMessageWithOperation('msg1', operationId!);
        result.current.associateMessageWithOperation('msg1', operationId!);
      });

      // Should only appear once
      expect(result.current.operationsByMessage.msg1).toHaveLength(1);
      expect(result.current.operationsByMessage.msg1[0]).toBe(operationId!);
    });
  });

  describe('cleanupCompletedOperations', () => {
    it('should remove old completed operations', () => {
      const { result } = renderHook(() => useChatStore());

      let op1: string;
      let op2: string;

      act(() => {
        op1 = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        op2 = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;
      });

      act(() => {
        result.current.completeOperation(op1!);
      });

      // Manually set endTime to past
      act(() => {
        useChatStore.setState({
          operations: {
            ...result.current.operations,
            [op1!]: {
              ...result.current.operations[op1!],
              metadata: {
                ...result.current.operations[op1!].metadata,
                endTime: Date.now() - 120000, // 2 minutes ago
              },
            },
          },
        });
      });

      act(() => {
        result.current.cleanupCompletedOperations(60000); // 1 minute threshold
      });

      expect(result.current.operations[op1!]).toBeUndefined(); // Cleaned up
      expect(result.current.operations[op2!]).toBeDefined(); // Still running
    });
  });

  describe('getOperationAbortSignal', () => {
    it('should return the AbortSignal for a given operation', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;
      let abortController: AbortController;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        });
        operationId = res.operationId;
        abortController = res.abortController;
      });

      const signal = result.current.getOperationAbortSignal(operationId!);

      expect(signal).toBe(abortController!.signal);
      expect(signal.aborted).toBe(false);
    });

    it('should throw error when operation not found', () => {
      const { result } = renderHook(() => useChatStore());

      expect(() => {
        result.current.getOperationAbortSignal('non-existent-id');
      }).toThrow('Operation not found');
    });

    it('should return aborted signal after operation is cancelled', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;
      });

      const signal = result.current.getOperationAbortSignal(operationId!);

      expect(signal.aborted).toBe(false);

      act(() => {
        result.current.cancelOperation(operationId!);
      });

      expect(signal.aborted).toBe(true);
    });
  });

  describe('onOperationCancel', () => {
    it('should register cancel handler for an operation', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;
      const handler = vi.fn();

      act(() => {
        operationId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        result.current.onOperationCancel(operationId!, handler);
      });

      const operation = result.current.operations[operationId!];
      expect(operation.onCancelHandler).toBe(handler);
    });

    it('should handle registering handler for non-existent operation gracefully', () => {
      const { result } = renderHook(() => useChatStore());

      const handler = vi.fn();

      act(() => {
        result.current.onOperationCancel('non-existent-id', handler);
      });

      // Should not throw, just log warning
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('cancelOperation with cancel handler', () => {
    it('should call cancel handler when operation is cancelled', async () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;
      const handler = vi.fn();

      act(() => {
        operationId = result.current.startOperation({
          type: 'createAssistantMessage',
          context: { agentId: 'session1', messageId: 'msg1' },
          metadata: { tempMessageId: 'temp-123' },
        }).operationId;

        result.current.onOperationCancel(operationId!, handler);
      });

      act(() => {
        result.current.cancelOperation(operationId!, 'User clicked stop');
      });

      // Wait for async handler
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });

      expect(handler).toHaveBeenCalledWith({
        operationId: operationId!,
        type: 'createAssistantMessage',
        reason: 'User clicked stop',
        metadata: expect.objectContaining({
          tempMessageId: 'temp-123',
        }),
      });
    });

    it('should call handler with correct type for different operation types', async () => {
      const { result } = renderHook(() => useChatStore());

      const testCases = [
        { type: 'createAssistantMessage' as const, reason: 'Rollback creation' },
        { type: 'callLLM' as const, reason: 'LLM streaming cancelled' },
        { type: 'createToolMessage' as const, reason: 'Tool message creation cancelled' },
        { type: 'executeToolCall' as const, reason: 'Tool execution cancelled' },
      ];

      for (const { type, reason } of testCases) {
        const handler = vi.fn();
        let opId: string;

        act(() => {
          opId = result.current.startOperation({
            type,
            context: { agentId: 'session1' },
          }).operationId;

          result.current.onOperationCancel(opId!, handler);
        });

        act(() => {
          result.current.cancelOperation(opId!, reason);
        });

        await vi.waitFor(() => {
          expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({
              type,
              reason,
            }),
          );
        });
      }
    });

    it('should handle async cancel handler correctly', async () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;
      const asyncHandler = vi.fn(async ({ type }) => {
        // Simulate async cleanup
        await new Promise((resolve) => setTimeout(resolve, 10));
        // Don't return anything (void)
      });

      act(() => {
        operationId = result.current.startOperation({
          type: 'createToolMessage',
          context: { agentId: 'session1' },
        }).operationId;

        result.current.onOperationCancel(operationId!, asyncHandler);
      });

      act(() => {
        result.current.cancelOperation(operationId!);
      });

      // Handler should be called
      await vi.waitFor(() => {
        expect(asyncHandler).toHaveBeenCalledTimes(1);
      });

      // Operation should be marked as cancelled even if handler is still running
      expect(result.current.operations[operationId!].status).toBe('cancelled');
    });

    it('should not block cancellation flow if handler throws error', async () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;
      const errorHandler = vi.fn(() => {
        throw new Error('Handler error');
      });

      act(() => {
        operationId = result.current.startOperation({
          type: 'executeToolCall',
          context: { agentId: 'session1' },
        }).operationId;

        result.current.onOperationCancel(operationId!, errorHandler);
      });

      act(() => {
        result.current.cancelOperation(operationId!);
      });

      // Operation should still be cancelled despite handler error
      expect(result.current.operations[operationId!].status).toBe('cancelled');
      expect(errorHandler).toHaveBeenCalledTimes(1);
    });

    it('should not call handler if operation is already cancelled', async () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;
      const handler = vi.fn();

      act(() => {
        operationId = result.current.startOperation({
          type: 'callLLM',
          context: { agentId: 'session1' },
        }).operationId;

        result.current.onOperationCancel(operationId!, handler);
      });

      // Cancel first time
      act(() => {
        result.current.cancelOperation(operationId!);
      });

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });

      // Try to cancel again
      act(() => {
        result.current.cancelOperation(operationId!);
      });

      // Handler should not be called again
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('internal_getConversationContext', () => {
    it('should return context from operationId when provided', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        operationId = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', topicId: 'topic1', threadId: 'thread1' },
        }).operationId;
      });

      const context = result.current.internal_getConversationContext({ operationId: operationId! });

      expect(context.agentId).toBe('session1');
      expect(context.topicId).toBe('topic1');
      expect(context.threadId).toBe('thread1');
    });

    it('should return groupId from operation context when provided', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        operationId = result.current.startOperation({
          type: 'sendMessage',
          context: {
            agentId: 'agent1',
            groupId: 'group1',
            topicId: 'topic1',
          },
        }).operationId;
      });

      const context = result.current.internal_getConversationContext({ operationId: operationId! });

      expect(context.agentId).toBe('agent1');
      expect(context.groupId).toBe('group1');
      expect(context.topicId).toBe('topic1');
    });

    it('should preserve scope and isNew from operation context', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        operationId = result.current.startOperation({
          type: 'sendMessage',
          context: {
            agentId: 'agent1',
            topicId: 'topic1',
            scope: 'group',
            isNew: true,
          },
        }).operationId;
      });

      const context = result.current.internal_getConversationContext({ operationId: operationId! });

      expect(context.scope).toBe('group');
      expect(context.isNew).toBe(true);
    });

    it('should fallback to global state when no operationId provided', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: 'global-agent',
          activeTopicId: 'global-topic',
          activeThreadId: 'global-thread',
          activeGroupId: 'global-group',
        });
      });

      const context = result.current.internal_getConversationContext({});

      expect(context.agentId).toBe('global-agent');
      expect(context.topicId).toBe('global-topic');
      expect(context.threadId).toBe('global-thread');
      expect(context.groupId).toBe('global-group');
    });

    it('should throw error when operationId is invalid', () => {
      const { result } = renderHook(() => useChatStore());

      expect(() => {
        result.current.internal_getConversationContext({ operationId: 'invalid-op-id' });
      }).toThrow('Operation not found');
    });
  });

  describe('cancelOperation with child operations and handlers', () => {
    it('should call handlers for both parent and child operations', async () => {
      const { result } = renderHook(() => useChatStore());

      let parentOpId: string;
      let childOpId: string;
      const parentHandler = vi.fn();
      const childHandler = vi.fn();

      act(() => {
        parentOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        childOpId = result.current.startOperation({
          type: 'callLLM',
          context: { messageId: 'msg1' },
          parentOperationId: parentOpId!,
        }).operationId;

        result.current.onOperationCancel(parentOpId!, parentHandler);
        result.current.onOperationCancel(childOpId!, childHandler);
      });

      act(() => {
        result.current.cancelOperation(parentOpId!);
      });

      // Both handlers should be called
      await vi.waitFor(() => {
        expect(parentHandler).toHaveBeenCalledTimes(1);
        expect(childHandler).toHaveBeenCalledTimes(1);
      });

      // Child should be cancelled due to parent cancellation
      expect(childHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: childOpId!,
          reason: 'Parent operation cancelled',
        }),
      );
    });

    it('should handle nested operations with multiple levels', async () => {
      const { result } = renderHook(() => useChatStore());

      let level1: string;
      let level2: string;
      let level3: string;
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const handler3 = vi.fn();

      act(() => {
        level1 = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;

        level2 = result.current.startOperation({
          type: 'createAssistantMessage',
          parentOperationId: level1!,
        }).operationId;

        level3 = result.current.startOperation({
          type: 'callLLM',
          parentOperationId: level2!,
        }).operationId;

        result.current.onOperationCancel(level1!, handler1);
        result.current.onOperationCancel(level2!, handler2);
        result.current.onOperationCancel(level3!, handler3);
      });

      act(() => {
        result.current.cancelOperation(level1!);
      });

      await vi.waitFor(() => {
        expect(handler1).toHaveBeenCalledTimes(1);
        expect(handler2).toHaveBeenCalledTimes(1);
        expect(handler3).toHaveBeenCalledTimes(1);
      });

      // All operations should be cancelled
      expect(result.current.operations[level1!].status).toBe('cancelled');
      expect(result.current.operations[level2!].status).toBe('cancelled');
      expect(result.current.operations[level3!].status).toBe('cancelled');
    });
  });

  describe('registerAfterCompletionCallback', () => {
    it('should register a callback to operation metadata', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;
      const callback = vi.fn();

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        });
        operationId = res.operationId;
      });

      act(() => {
        result.current.registerAfterCompletionCallback(operationId!, callback);
      });

      const operation = result.current.operations[operationId!];

      expect(operation.metadata.runtimeHooks).toBeDefined();
      expect(operation.metadata.runtimeHooks?.afterCompletionCallbacks).toHaveLength(1);
      expect(operation.metadata.runtimeHooks?.afterCompletionCallbacks?.[0]).toBe(callback);
    });

    it('should allow registering multiple callbacks', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        });
        operationId = res.operationId;
      });

      act(() => {
        result.current.registerAfterCompletionCallback(operationId!, callback1);
        result.current.registerAfterCompletionCallback(operationId!, callback2);
        result.current.registerAfterCompletionCallback(operationId!, callback3);
      });

      const operation = result.current.operations[operationId!];

      expect(operation.metadata.runtimeHooks?.afterCompletionCallbacks).toHaveLength(3);
      expect(operation.metadata.runtimeHooks?.afterCompletionCallbacks?.[0]).toBe(callback1);
      expect(operation.metadata.runtimeHooks?.afterCompletionCallbacks?.[1]).toBe(callback2);
      expect(operation.metadata.runtimeHooks?.afterCompletionCallbacks?.[2]).toBe(callback3);
    });

    it('should not fail when operation does not exist', () => {
      const { result } = renderHook(() => useChatStore());

      const callback = vi.fn();

      // Should not throw
      act(() => {
        result.current.registerAfterCompletionCallback('non-existent-id', callback);
      });

      // Operation should not be created
      expect(result.current.operations['non-existent-id']).toBeUndefined();
    });

    it('should preserve existing runtimeHooks when adding callbacks', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        });
        operationId = res.operationId;
      });

      // Register first callback
      act(() => {
        result.current.registerAfterCompletionCallback(operationId!, callback1);
      });

      // Verify first callback is registered
      expect(
        result.current.operations[operationId!].metadata.runtimeHooks?.afterCompletionCallbacks,
      ).toHaveLength(1);

      // Register second callback
      act(() => {
        result.current.registerAfterCompletionCallback(operationId!, callback2);
      });

      // Both callbacks should be present
      const callbacks =
        result.current.operations[operationId!].metadata.runtimeHooks?.afterCompletionCallbacks;
      expect(callbacks).toHaveLength(2);
      expect(callbacks?.[0]).toBe(callback1);
      expect(callbacks?.[1]).toBe(callback2);
    });

    it('should work with child operations registering to parent', () => {
      const { result } = renderHook(() => useChatStore());

      let parentOpId: string;
      let childOpId: string;
      const callback = vi.fn();

      act(() => {
        // Create parent operation (execAgentRuntime)
        const parent = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        });
        parentOpId = parent.operationId;

        // Create child operation (toolCalling)
        const child = result.current.startOperation({
          type: 'toolCalling',
          parentOperationId: parentOpId,
        });
        childOpId = child.operationId;
      });

      // Register callback to parent operation (simulating what speak/broadcast/delegate do)
      act(() => {
        result.current.registerAfterCompletionCallback(parentOpId!, callback);
      });

      // Callback should be on parent, not child
      expect(
        result.current.operations[parentOpId!].metadata.runtimeHooks?.afterCompletionCallbacks,
      ).toHaveLength(1);
      expect(
        result.current.operations[childOpId!].metadata.runtimeHooks?.afterCompletionCallbacks,
      ).toBeUndefined();
    });
  });
});
