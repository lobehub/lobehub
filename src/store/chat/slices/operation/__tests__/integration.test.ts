/**
 * Integration test for Operation Management System
 * Tests the full lifecycle of operations in realistic scenarios
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

vi.mock('zustand/traditional');

describe('Operation Management Integration Tests', () => {
  beforeEach(() => {
    act(() => {
      useChatStore.setState({
        activeAgentId: 'test-session',
        activeTopicId: 'test-topic',
        operations: {},
        operationsByType: {} as any,
        operationsByMessage: {},
        operationsByContext: {},
        messageOperationMap: {},
      });
    });
  });

  describe('Complete Operation Lifecycle', () => {
    it('should handle full AI generation lifecycle', async () => {
      const { result } = renderHook(() => useChatStore());
      const sessionId = 'test-session';
      const topicId = 'test-topic';
      const messageId = 'user-msg-1';

      // 1. Start operation
      let operationId: string = '';
      act(() => {
        const { operationId: id } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: sessionId, topicId, messageId },
          label: 'AI Generation',
        });
        operationId = id;
      });

      // Verify operation created
      expect(result.current.operations[operationId!]).toBeDefined();
      expect(result.current.operations[operationId!].status).toBe('running');
      expect(result.current.operations[operationId!].context).toEqual({
        agentId: sessionId,
        topicId,
        messageId,
      });

      // 2. Associate message
      act(() => {
        result.current.associateMessageWithOperation(messageId, operationId!);
      });

      expect(result.current.messageOperationMap[messageId]).toBe(operationId);

      // 3. Check status during execution
      expect(operationSelectors.hasAnyRunningOperation(result.current)).toBe(true);
      expect(operationSelectors.canSendMessage(result.current)).toBe(false);
      expect(operationSelectors.isAgentRuntimeRunning(result.current)).toBe(true);

      // 4. Complete operation
      act(() => {
        result.current.completeOperation(operationId!);
      });

      expect(result.current.operations[operationId!].status).toBe('completed');
      expect(operationSelectors.hasAnyRunningOperation(result.current)).toBe(false);
      expect(operationSelectors.canSendMessage(result.current)).toBe(true);
    });

    it('should handle operation cancellation', async () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string = '';
      let abortController: AbortController | undefined;

      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'test-session' },
        });
        operationId = res.operationId;
        abortController = res.abortController;
      });

      const abortSpy = vi.spyOn(abortController!, 'abort');

      // Cancel operation
      act(() => {
        result.current.cancelOperation(operationId!, 'User cancelled');
      });

      expect(result.current.operations[operationId!].status).toBe('cancelled');
      expect(abortSpy).toHaveBeenCalled();
    });
  });

  describe('Parent-Child Operation Relationship', () => {
    it('should handle nested operations with context inheritance', async () => {
      const { result } = renderHook(() => useChatStore());

      // Create parent operation
      let parentOpId: string = '';
      act(() => {
        const { operationId } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'test-session', topicId: 'test-topic' },
        });
        parentOpId = operationId;
      });

      // Create child operation (should inherit context)
      let childOpId: string = '';
      act(() => {
        const { operationId } = result.current.startOperation({
          type: 'toolCalling',
          parentOperationId: parentOpId!,
        });
        childOpId = operationId;
      });

      // Verify context inheritance
      const parentOp = result.current.operations[parentOpId!];
      const childOp = result.current.operations[childOpId!];

      expect(childOp.context.agentId).toBe(parentOp.context.agentId);
      expect(childOp.context.topicId).toBe(parentOp.context.topicId);
      expect(childOp.parentOperationId).toBe(parentOpId);
      expect(parentOp.childOperationIds).toContain(childOpId);
    });

    it('should cascade cancel child operations', async () => {
      const { result } = renderHook(() => useChatStore());

      // Create parent and child operations
      let parentOpId: string = '';
      let childOpId1: string = '';
      let childOpId2: string = '';

      act(() => {
        const { operationId } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'test-session' },
        });
        parentOpId = operationId;
      });

      act(() => {
        const { operationId } = result.current.startOperation({
          type: 'toolCalling',
          parentOperationId: parentOpId!,
        });
        childOpId1 = operationId;
      });

      act(() => {
        const { operationId } = result.current.startOperation({
          type: 'toolCalling',
          parentOperationId: parentOpId!,
        });
        childOpId2 = operationId;
      });

      // Cancel parent
      act(() => {
        result.current.cancelOperation(parentOpId!, 'Parent cancelled');
      });

      // Verify all cancelled
      expect(result.current.operations[parentOpId!].status).toBe('cancelled');
      expect(result.current.operations[childOpId1!].status).toBe('cancelled');
      expect(result.current.operations[childOpId2!].status).toBe('cancelled');
    });
  });

  describe('Context Isolation', () => {
    it('should maintain correct context when switching topics', async () => {
      const { result } = renderHook(() => useChatStore());

      // Create operation in topic A
      let opIdTopicA: string = '';
      act(() => {
        const { operationId } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-1', topicId: 'topic-a' },
        });
        opIdTopicA = operationId;
      });

      // Switch to topic B
      act(() => {
        useChatStore.setState({ activeTopicId: 'topic-b' });
      });

      // Create operation in topic B
      let opIdTopicB: string = '';
      act(() => {
        const { operationId } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-1', topicId: 'topic-b' },
        });
        opIdTopicB = operationId;
      });

      // Verify context isolation
      const opA = result.current.operations[opIdTopicA!];
      const opB = result.current.operations[opIdTopicB!];

      expect(opA.context.topicId).toBe('topic-a');
      expect(opB.context.topicId).toBe('topic-b');

      // Get operations by context
      const contextA = messageMapKey({ agentId: 'session-1', topicId: 'topic-a' });
      const contextB = messageMapKey({ agentId: 'session-1', topicId: 'topic-b' });

      const opsInA = result.current.operationsByContext[contextA] || [];
      const opsInB = result.current.operationsByContext[contextB] || [];

      expect(opsInA).toContain(opIdTopicA);
      expect(opsInB).toContain(opIdTopicB);
      expect(opsInA).not.toContain(opIdTopicB);
      expect(opsInB).not.toContain(opIdTopicA);
    });
  });

  describe('Batch Operations', () => {
    it('should handle multiple concurrent operations', async () => {
      const { result } = renderHook(() => useChatStore());

      const opIds: string[] = [];

      // Start 5 operations concurrently
      act(() => {
        for (let i = 0; i < 5; i++) {
          const { operationId } = result.current.startOperation({
            type: i % 2 === 0 ? 'execAgentRuntime' : 'toolCalling',
            context: { agentId: 'session-1', messageId: `msg-${i}` },
          });
          opIds.push(operationId);
        }
      });

      // Verify all running
      expect(operationSelectors.getRunningOperations(result.current)).toHaveLength(5);

      // Cancel all generateAI operations
      let cancelledIds: string[];
      act(() => {
        cancelledIds = result.current.cancelOperations({
          type: 'execAgentRuntime',
          status: 'running',
        });
      });

      // Verify correct operations cancelled
      expect(cancelledIds!).toHaveLength(3); // 0, 2, 4
      expect(operationSelectors.getRunningOperations(result.current)).toHaveLength(2);
    });
  });

  describe('Memory Management', () => {
    it('should cleanup old completed operations', async () => {
      const { result } = renderHook(() => useChatStore());

      const oldTimestamp = Date.now() - 2 * 60 * 1000; // 2 minutes ago
      const recentTimestamp = Date.now() - 30 * 1000; // 30 seconds ago

      // Create old completed operation
      let oldOpId: string;
      act(() => {
        const { operationId } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-1' },
        });
        oldOpId = operationId;
      });

      // Complete and manually set old timestamp
      act(() => {
        result.current.completeOperation(oldOpId!);
        useChatStore.setState((state) => ({
          operations: {
            ...state.operations,
            [oldOpId!]: {
              ...state.operations[oldOpId!],
              status: 'completed' as const,
              metadata: {
                ...state.operations[oldOpId!].metadata,
                startTime: oldTimestamp,
                endTime: oldTimestamp + 1000,
              },
            },
          },
        }));
      });

      // Create recent completed operation
      let recentOpId: string;
      act(() => {
        const { operationId } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-1' },
        });
        recentOpId = operationId;
      });

      act(() => {
        result.current.completeOperation(recentOpId!);
        useChatStore.setState((state) => ({
          operations: {
            ...state.operations,
            [recentOpId!]: {
              ...state.operations[recentOpId!],
              status: 'completed' as const,
              metadata: {
                ...state.operations[recentOpId!].metadata,
                startTime: recentTimestamp,
                endTime: recentTimestamp + 1000,
              },
            },
          },
        }));
      });

      // Cleanup operations older than 1 minute
      act(() => {
        result.current.cleanupCompletedOperations(60 * 1000);
      });

      // Verify old operation cleaned up, recent kept
      expect(result.current.operations[oldOpId!]).toBeUndefined();
      expect(result.current.operations[recentOpId!]).toBeDefined();
    });
  });
});
