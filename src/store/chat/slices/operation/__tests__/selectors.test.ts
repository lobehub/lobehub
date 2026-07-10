import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { operationSelectors } from '../selectors';
import {
  INPUT_LOADING_OPERATION_TYPES,
  INTERIM_LOADING_OPERATION_TYPES,
  QUEUE_BLOCKING_OPERATION_TYPES,
} from '../types';

describe('Operation Selectors', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
  });

  // Coherence invariant: interim approve/submit/skip/regenerate ops must live in
  // BOTH whitelists. If the input shows loading for an op (INPUT_LOADING), a
  // follow-up must queue behind it and "Send now" must be able to cancel it
  // (QUEUE_BLOCKING). Dropping them from either set silently reintroduces the
  // interleave / stuck-queue / no-op-send-now bugs.
  describe('operation-type set invariants', () => {
    it('keeps interim ops in both INPUT_LOADING and QUEUE_BLOCKING', () => {
      for (const type of INTERIM_LOADING_OPERATION_TYPES) {
        expect(INPUT_LOADING_OPERATION_TYPES).toContain(type);
        expect(QUEUE_BLOCKING_OPERATION_TYPES).toContain(type);
      }
    });
  });

  describe('getRunningQueueBlockingOperationIds', () => {
    it('returns every running queue-blocking op, not just the first', () => {
      // A delAndRegenerate/delAndResendThread retry runs two concurrent
      // `regenerate` ops (outer wrapper + inner regenerateUserMessage). "Send now"
      // must cancel BOTH — returning only the first would leave the queue blocked.
      const { result } = renderHook(() => useChatStore());
      const context = { agentId: 'agent1', topicId: 'topic1' };
      let outerId = '';
      let innerId = '';

      act(() => {
        outerId = result.current.startOperation({ type: 'regenerate', context }).operationId;
        innerId = result.current.startOperation({ type: 'regenerate', context }).operationId;
      });

      const ids = operationSelectors.getRunningQueueBlockingOperationIds(context)(result.current);
      expect(ids).toHaveLength(2);
      expect(ids).toEqual(expect.arrayContaining([outerId, innerId]));
    });

    it('excludes non-running and non-blocking ops', () => {
      const { result } = renderHook(() => useChatStore());
      const context = { agentId: 'agent1', topicId: 'topic1' };
      let runningId = '';

      act(() => {
        runningId = result.current.startOperation({ type: 'regenerate', context }).operationId;
        // Different queue-blocking op, but completed → excluded.
        const doneId = result.current.startOperation({
          type: 'execAgentRuntime',
          context,
        }).operationId;
        result.current.completeOperation(doneId);
      });

      expect(
        operationSelectors.getRunningQueueBlockingOperationIds(context)(result.current),
      ).toEqual([runningId]);
    });
  });

  describe('getOperationsByType', () => {
    it('should return operations of specific type', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        });

        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        });

        result.current.startOperation({
          type: 'reasoning',
          context: { agentId: 'session1' },
        });
      });

      const generateOps = operationSelectors.getOperationsByType('execAgentRuntime')(
        result.current,
      );
      const reasoningOps = operationSelectors.getOperationsByType('reasoning')(result.current);

      expect(generateOps).toHaveLength(2);
      expect(reasoningOps).toHaveLength(1);
    });
  });

  describe('getRunningQueueBlockingOperationIds', () => {
    it('returns every running queue blocker for send-now in the same context', () => {
      const { result } = renderHook(() => useChatStore());

      let outerRegenerate: string;
      let innerRegenerate: string;

      act(() => {
        outerRegenerate = result.current.startOperation({
          context: { agentId: 'agent-1', topicId: 'topic-1' },
          type: 'regenerate',
        }).operationId;
        innerRegenerate = result.current.startOperation({
          context: { agentId: 'agent-1', topicId: 'topic-1' },
          type: 'regenerate',
        }).operationId;
        const completedRegenerate = result.current.startOperation({
          context: { agentId: 'agent-1', topicId: 'topic-1' },
          type: 'regenerate',
        }).operationId;
        result.current.startOperation({
          context: { agentId: 'agent-1', topicId: 'topic-1' },
          type: 'toolCalling',
        });
        result.current.startOperation({
          context: { agentId: 'agent-2', topicId: 'topic-2' },
          type: 'regenerate',
        });
        result.current.completeOperation(completedRegenerate);
      });

      // Regression: delAndRegenerate/delAndResendThread can leave both an outer
      // wrapper regenerate and an inner regenerateUserMessage running. Send-now
      // must cancel both; cancelling only the first makes it re-queue.
      expect(
        operationSelectors.getRunningQueueBlockingOperationIds({
          agentId: 'agent-1',
          topicId: 'topic-1',
        })(result.current),
      ).toEqual([outerRegenerate!, innerRegenerate!]);
    });
  });

  describe('getCurrentContextOperations', () => {
    it('should return operations for current active session/topic', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        // Set active session and topic
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });

        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: 'topic1' },
        });

        result.current.startOperation({
          type: 'reasoning',
          context: { agentId: 'session1', topicId: 'topic1' },
        });

        // Operation in different context
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session2', topicId: 'topic2' },
        });
      });

      const currentOps = operationSelectors.getCurrentContextOperations(result.current);

      expect(currentOps).toHaveLength(2);
      expect(currentOps.every((op) => op.context.agentId === 'session1')).toBe(true);
      expect(currentOps.every((op) => op.context.topicId === 'topic1')).toBe(true);
    });
  });

  describe('hasAnyRunningOperation', () => {
    it('should return true if any operation is running', () => {
      const { result } = renderHook(() => useChatStore());

      expect(operationSelectors.hasAnyRunningOperation(result.current)).toBe(false);

      let opId: string;

      act(() => {
        opId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        }).operationId;
      });

      expect(operationSelectors.hasAnyRunningOperation(result.current)).toBe(true);

      act(() => {
        result.current.completeOperation(opId!);
      });

      expect(operationSelectors.hasAnyRunningOperation(result.current)).toBe(false);
    });
  });

  describe('hasRunningOperationType', () => {
    it('should return true if specific type is running', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        });
      });

      expect(operationSelectors.hasRunningOperationType('execAgentRuntime')(result.current)).toBe(
        true,
      );
      expect(operationSelectors.hasRunningOperationType('reasoning')(result.current)).toBe(false);
    });
  });

  describe('canSendMessage', () => {
    it('should return false when operations are running in current context', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });
      });

      expect(operationSelectors.canSendMessage(result.current)).toBe(true);

      act(() => {
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: 'topic1' },
        });
      });

      expect(operationSelectors.canSendMessage(result.current)).toBe(false);
    });
  });

  describe('canInterrupt', () => {
    it('should return true when operations can be cancelled', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });
      });

      expect(operationSelectors.canInterrupt(result.current)).toBe(false);

      act(() => {
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: 'topic1' },
        });
      });

      expect(operationSelectors.canInterrupt(result.current)).toBe(true);
    });
  });

  describe('getCurrentOperationLabel', () => {
    it('should return label of most recent running operation', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });

        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: 'topic1' },
          label: 'Generating response...',
        });

        // Simulate some time passing
        setTimeout(() => {
          result.current.startOperation({
            type: 'reasoning',
            context: { agentId: 'session1', topicId: 'topic1' },
            label: 'Thinking...',
          });
        }, 10);
      });

      // Should return the most recent operation's label
      const label = operationSelectors.getCurrentOperationLabel(result.current);
      expect(label).toBeTruthy();
    });
  });

  describe('getDeepestRunningOperationByMessage', () => {
    it('should return undefined when no operations exist', () => {
      const { result } = renderHook(() => useChatStore());

      const deepestOp = operationSelectors.getDeepestRunningOperationByMessage('msg1')(
        result.current,
      );

      expect(deepestOp).toBeUndefined();
    });

    it('should return undefined when no running operations exist', () => {
      const { result } = renderHook(() => useChatStore());

      let opId: string;
      act(() => {
        opId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', messageId: 'msg1' },
        }).operationId;
        result.current.associateMessageWithOperation('msg1', opId);
        result.current.completeOperation(opId);
      });

      const deepestOp = operationSelectors.getDeepestRunningOperationByMessage('msg1')(
        result.current,
      );

      expect(deepestOp).toBeUndefined();
    });

    it('should return the only running operation when there is one', () => {
      const { result } = renderHook(() => useChatStore());

      let opId: string;
      act(() => {
        opId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', messageId: 'msg1' },
        }).operationId;
        result.current.associateMessageWithOperation('msg1', opId);
      });

      const deepestOp = operationSelectors.getDeepestRunningOperationByMessage('msg1')(
        result.current,
      );

      expect(deepestOp).toBeDefined();
      expect(deepestOp?.type).toBe('execAgentRuntime');
    });

    it('should return the leaf operation in a parent-child tree', () => {
      const { result } = renderHook(() => useChatStore());

      let parentOpId: string;
      let childOpId: string;

      act(() => {
        // Start parent operation
        parentOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', messageId: 'msg1' },
        }).operationId;
        result.current.associateMessageWithOperation('msg1', parentOpId);

        // Start child operation
        childOpId = result.current.startOperation({
          type: 'reasoning',
          context: { agentId: 'session1', messageId: 'msg1' },
          parentOperationId: parentOpId,
        }).operationId;
        result.current.associateMessageWithOperation('msg1', childOpId);
      });

      const deepestOp = operationSelectors.getDeepestRunningOperationByMessage('msg1')(
        result.current,
      );

      // Should return the child (reasoning) not the parent (execAgentRuntime)
      expect(deepestOp).toBeDefined();
      expect(deepestOp?.type).toBe('reasoning');
      expect(deepestOp?.id).toBe(childOpId!);
    });

    it('should return the deepest leaf in a multi-level tree', () => {
      const { result } = renderHook(() => useChatStore());

      let rootOpId: string;
      let level1OpId: string;
      let level2OpId: string;

      act(() => {
        // Level 0: root operation
        rootOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', messageId: 'msg1' },
        }).operationId;
        result.current.associateMessageWithOperation('msg1', rootOpId);

        // Level 1: child of root
        level1OpId = result.current.startOperation({
          type: 'callLLM',
          context: { agentId: 'session1', messageId: 'msg1' },
          parentOperationId: rootOpId,
        }).operationId;
        result.current.associateMessageWithOperation('msg1', level1OpId);

        // Level 2: grandchild (deepest)
        level2OpId = result.current.startOperation({
          type: 'reasoning',
          context: { agentId: 'session1', messageId: 'msg1' },
          parentOperationId: level1OpId,
        }).operationId;
        result.current.associateMessageWithOperation('msg1', level2OpId);
      });

      const deepestOp = operationSelectors.getDeepestRunningOperationByMessage('msg1')(
        result.current,
      );

      // Should return the deepest leaf (reasoning at level 2)
      expect(deepestOp).toBeDefined();
      expect(deepestOp?.type).toBe('reasoning');
      expect(deepestOp?.id).toBe(level2OpId!);
    });

    it('should return parent when child operation completes', () => {
      const { result } = renderHook(() => useChatStore());

      let parentOpId: string;
      let childOpId: string;

      act(() => {
        parentOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', messageId: 'msg1' },
        }).operationId;
        result.current.associateMessageWithOperation('msg1', parentOpId);

        childOpId = result.current.startOperation({
          type: 'reasoning',
          context: { agentId: 'session1', messageId: 'msg1' },
          parentOperationId: parentOpId,
        }).operationId;
        result.current.associateMessageWithOperation('msg1', childOpId);
      });

      // Before completing child
      let deepestOp = operationSelectors.getDeepestRunningOperationByMessage('msg1')(
        result.current,
      );
      expect(deepestOp?.type).toBe('reasoning');

      // Complete child operation
      act(() => {
        result.current.completeOperation(childOpId);
      });

      // After completing child, parent should be the deepest running
      deepestOp = operationSelectors.getDeepestRunningOperationByMessage('msg1')(result.current);
      expect(deepestOp?.type).toBe('execAgentRuntime');
      expect(deepestOp?.id).toBe(parentOpId!);
    });
  });

  describe('isMessageProcessing', () => {
    it('should return true if message has running operations', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', messageId: 'msg1' },
        });
      });

      expect(operationSelectors.isMessageProcessing('msg1')(result.current)).toBe(true);
      expect(operationSelectors.isMessageProcessing('msg2')(result.current)).toBe(false);
    });
  });

  describe('isMessageCreating', () => {
    it('should return true for user message during sendMessage operation', () => {
      const { result } = renderHook(() => useChatStore());

      let opId: string;

      act(() => {
        opId = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', messageId: 'user_msg_1' },
        }).operationId;

        // Associate message with operation
        result.current.associateMessageWithOperation('user_msg_1', opId!);
      });

      expect(operationSelectors.isMessageCreating('user_msg_1')(result.current)).toBe(true);
      expect(operationSelectors.isMessageCreating('other_msg')(result.current)).toBe(false);
    });

    it('should return true for assistant message during createAssistantMessage operation', () => {
      const { result } = renderHook(() => useChatStore());

      let opId: string;

      act(() => {
        opId = result.current.startOperation({
          type: 'createAssistantMessage',
          context: { agentId: 'session1', messageId: 'assistant_msg_1' },
        }).operationId;

        // Associate message with operation
        result.current.associateMessageWithOperation('assistant_msg_1', opId!);
      });

      expect(operationSelectors.isMessageCreating('assistant_msg_1')(result.current)).toBe(true);
      expect(operationSelectors.isMessageCreating('other_msg')(result.current)).toBe(false);
    });

    it('should return false when operation completes', () => {
      const { result } = renderHook(() => useChatStore());

      let opId: string;

      act(() => {
        opId = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', messageId: 'msg1' },
        }).operationId;

        result.current.associateMessageWithOperation('msg1', opId!);
      });

      expect(operationSelectors.isMessageCreating('msg1')(result.current)).toBe(true);

      act(() => {
        result.current.completeOperation(opId!);
      });

      expect(operationSelectors.isMessageCreating('msg1')(result.current)).toBe(false);
    });

    it('should return false for other operation types', () => {
      const { result } = renderHook(() => useChatStore());

      let opId: string;

      act(() => {
        // execAgentRuntime should not be considered as "creating"
        opId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', messageId: 'msg1' },
        }).operationId;

        result.current.associateMessageWithOperation('msg1', opId!);
      });

      expect(operationSelectors.isMessageCreating('msg1')(result.current)).toBe(false);
    });

    it('should only check sendMessage and createAssistantMessage operations', () => {
      const { result } = renderHook(() => useChatStore());

      let sendMsgOpId: string;
      let createAssistantOpId: string;
      let toolCallOpId: string;

      act(() => {
        // sendMessage - should be creating
        sendMsgOpId = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1', messageId: 'user_msg' },
        }).operationId;
        result.current.associateMessageWithOperation('user_msg', sendMsgOpId!);

        // createAssistantMessage - should be creating
        createAssistantOpId = result.current.startOperation({
          type: 'createAssistantMessage',
          context: { agentId: 'session1', messageId: 'assistant_msg' },
        }).operationId;
        result.current.associateMessageWithOperation('assistant_msg', createAssistantOpId!);

        // toolCalling - should NOT be creating
        toolCallOpId = result.current.startOperation({
          type: 'toolCalling',
          context: { agentId: 'session1', messageId: 'tool_msg' },
        }).operationId;
        result.current.associateMessageWithOperation('tool_msg', toolCallOpId!);
      });

      expect(operationSelectors.isMessageCreating('user_msg')(result.current)).toBe(true);
      expect(operationSelectors.isMessageCreating('assistant_msg')(result.current)).toBe(true);
      expect(operationSelectors.isMessageCreating('tool_msg')(result.current)).toBe(false);
    });
  });

  describe('getOperationContextFromMessage', () => {
    it('should return operation context from message ID', () => {
      const { result } = renderHook(() => useChatStore());

      let opId: string;

      act(() => {
        opId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: 'topic1', messageId: 'msg1' },
        }).operationId;

        result.current.associateMessageWithOperation('msg1', opId!);
      });

      const context = operationSelectors.getOperationContextFromMessage('msg1')(result.current);

      expect(context).toBeDefined();
      expect(context?.agentId).toBe('session1');
      expect(context?.topicId).toBe('topic1');
      expect(context?.messageId).toBe('msg1');
    });
  });

  describe('getAgentRuntimeStartTimeByContext', () => {
    it('should return the earliest running runtime start time for the context', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'agent1', topicId: 'topic1' },
          metadata: { startTime: 2000 },
        });

        result.current.startOperation({
          type: 'execHeterogeneousAgent',
          context: { agentId: 'agent1', topicId: 'topic1' },
          metadata: { startTime: 1000 },
        });

        result.current.startOperation({
          type: 'reasoning',
          context: { agentId: 'agent1', topicId: 'topic1' },
          metadata: { startTime: 500 },
        });

        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'agent1', topicId: 'topic2' },
          metadata: { startTime: 300 },
        });
      });

      expect(
        operationSelectors.getAgentRuntimeStartTimeByContext({
          agentId: 'agent1',
          topicId: 'topic1',
        })(result.current),
      ).toBe(1000);
    });

    it('should ignore completed and aborting runtime operations', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const completedOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'agent1', topicId: 'topic1' },
          metadata: { startTime: 1000 },
        }).operationId;

        result.current.completeOperation(completedOpId);

        result.current.startOperation({
          type: 'execHeterogeneousAgent',
          context: { agentId: 'agent1', topicId: 'topic1' },
          metadata: { isAborting: true, startTime: 1500 },
        });
      });

      expect(
        operationSelectors.getAgentRuntimeStartTimeByContext({
          agentId: 'agent1',
          topicId: 'topic1',
        })(result.current),
      ).toBeUndefined();
    });
  });

  describe('visible loading selectors', () => {
    it('should hide a no-tool terminal tail without unblocking the operation', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeAgentId: 'agent1', activeTopicId: 'topic1' });

        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'agent1', topicId: 'topic1' },
          metadata: { startTime: 1000, visibleLoadingDone: true },
        });
      });

      const context = { agentId: 'agent1', topicId: 'topic1' };

      expect(operationSelectors.isAgentRunning('agent1')(result.current)).toBe(true);
      expect(operationSelectors.isAgentRuntimeRunning(result.current)).toBe(true);
      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(true);
      expect(operationSelectors.isAgentRuntimeRunningByContext(context)(result.current)).toBe(true);
      expect(operationSelectors.isInputLoadingByContext(context)(result.current)).toBe(true);
      expect(operationSelectors.canSendMessage(result.current)).toBe(false);

      expect(operationSelectors.isAgentVisiblyRunning('agent1')(result.current)).toBe(false);
      expect(operationSelectors.isAgentRuntimeVisiblyRunning(result.current)).toBe(false);
      expect(operationSelectors.isMainWindowAgentRuntimeVisiblyRunning(result.current)).toBe(false);
      expect(
        operationSelectors.isAgentRuntimeVisiblyRunningByContext(context)(result.current),
      ).toBe(false);
      expect(operationSelectors.isInputVisiblyLoadingByContext(context)(result.current)).toBe(
        false,
      );
      expect(
        operationSelectors.getVisibleAgentRuntimeStartTimeByContext(context)(result.current),
      ).toBeUndefined();
    });

    it('should keep visible loading when a queued message waits behind a visibly-done op', () => {
      const { result } = renderHook(() => useChatStore());
      const context = { agentId: 'agent1', topicId: 'topic1' };

      act(() => {
        useChatStore.setState({ activeAgentId: 'agent1', activeTopicId: 'topic1' });

        // Prior op has finished its visible output but hasn't reached its
        // terminal end yet (visibleLoadingDone), so it is not visibly running.
        result.current.startOperation({
          type: 'execAgentRuntime',
          context,
          metadata: { startTime: 1000, visibleLoadingDone: true },
        });
      });

      // Sanity: without a queued message the input reads idle in this window.
      expect(operationSelectors.isInputVisiblyLoadingByContext(context)(result.current)).toBe(
        false,
      );

      // User sends a follow-up while the op is still running: it queues without
      // its own op. The visible loading must stay on so the input doesn't look idle.
      act(() => {
        result.current.enqueueMessage(messageMapKey(context), {
          content: 'follow-up',
          createdAt: 1200,
          id: 'queued-1',
          interruptMode: 'soft',
        });
      });

      expect(operationSelectors.isInputVisiblyLoadingByContext(context)(result.current)).toBe(true);
    });

    it('should not pin visible loading on a stale queue once the op is no longer running', () => {
      const { result } = renderHook(() => useChatStore());
      const context = { agentId: 'agent1', topicId: 'topic1' };

      let opId!: string;
      act(() => {
        useChatStore.setState({ activeAgentId: 'agent1', activeTopicId: 'topic1' });
        opId = result.current.startOperation({
          type: 'execAgentRuntime',
          context,
          metadata: { startTime: 1000, visibleLoadingDone: true },
        }).operationId;
        result.current.enqueueMessage(messageMapKey(context), {
          content: 'follow-up',
          createdAt: 1200,
          id: 'queued-1',
          interruptMode: 'soft',
        });
      });

      expect(operationSelectors.isInputVisiblyLoadingByContext(context)(result.current)).toBe(true);

      // A cancelled/errored run never drains its queue; with no running op left,
      // the leftover queue must not keep the indicator pinned on.
      act(() => {
        result.current.cancelOperation(opId);
      });

      expect(operationSelectors.isInputVisiblyLoadingByContext(context)(result.current)).toBe(
        false,
      );
    });

    it('should find a queued follow-up in a thread-scope context (full context key)', () => {
      const { result } = renderHook(() => useChatStore());
      // Thread scope keys on threadId/scope; a reduced agentId/topicId key would
      // collapse to the main-scope bucket and miss the queue.
      const context = {
        agentId: 'agent1',
        scope: 'thread' as const,
        threadId: 'thread1',
        topicId: 'topic1',
      };

      act(() => {
        useChatStore.setState({ activeAgentId: 'agent1', activeTopicId: 'topic1' });
        result.current.startOperation({
          type: 'execAgentRuntime',
          context,
          metadata: { startTime: 1000, visibleLoadingDone: true },
        });
        result.current.enqueueMessage(messageMapKey(context), {
          content: 'follow-up',
          createdAt: 1200,
          id: 'queued-1',
          interruptMode: 'soft',
        });
      });

      expect(operationSelectors.isInputVisiblyLoadingByContext(context)(result.current)).toBe(true);
    });

    it('should count a queued follow-up in a thread-scope context (QueueTray mounts)', () => {
      const { result } = renderHook(() => useChatStore());
      // queuedMessageCount gates whether QueueTray mounts. It must key off the
      // same full context as getQueuedMessages/enqueue — a reduced
      // agentId/topicId key would report 0 here and hide the tray even though a
      // real queued message is pinning the input loading.
      const context = {
        agentId: 'agent1',
        scope: 'thread' as const,
        threadId: 'thread1',
        topicId: 'topic1',
      };

      act(() => {
        result.current.enqueueMessage(messageMapKey(context), {
          content: 'follow-up',
          createdAt: 1200,
          id: 'queued-1',
          interruptMode: 'soft',
        });
      });

      expect(operationSelectors.queuedMessageCount(context)(result.current)).toBe(1);
    });

    it('should keep visible loading for a normal running runtime operation', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'agent1', topicId: 'topic1' },
          metadata: { startTime: 1000 },
        });
      });

      const context = { agentId: 'agent1', topicId: 'topic1' };

      expect(
        operationSelectors.isAgentRuntimeVisiblyRunningByContext(context)(result.current),
      ).toBe(true);
      expect(operationSelectors.isInputVisiblyLoadingByContext(context)(result.current)).toBe(true);
      expect(
        operationSelectors.getVisibleAgentRuntimeStartTimeByContext(context)(result.current),
      ).toBe(1000);
    });
  });

  describe('getRunningToolCallStartTime', () => {
    it('should prefer the running executeToolCall start time', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const parentOpId = result.current.startOperation({
          type: 'toolCalling',
          context: { agentId: 'session1', messageId: 'assistant_msg' },
          metadata: { startTime: 1000, tool_call_id: 'tool-1' },
        }).operationId;

        result.current.startOperation({
          type: 'executeToolCall',
          context: { agentId: 'session1', messageId: 'tool_msg' },
          metadata: { startTime: 1500, tool_call_id: 'tool-1' },
          parentOperationId: parentOpId,
        });

        result.current.startOperation({
          type: 'toolCalling',
          context: { agentId: 'session1', messageId: 'assistant_msg' },
          metadata: { startTime: 900, tool_call_id: 'tool-2' },
        });
      });

      expect(operationSelectors.getRunningToolCallStartTime('tool-1')(result.current)).toBe(1500);
    });

    it('should fall back to the running toolCalling start time when execution has not started', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.startOperation({
          type: 'toolCalling',
          context: { agentId: 'session1', messageId: 'assistant_msg' },
          metadata: { startTime: 1000, tool_call_id: 'tool-1' },
        });
      });

      expect(operationSelectors.getRunningToolCallStartTime('tool-1')(result.current)).toBe(1000);
    });

    it('should ignore completed and unrelated tool operations', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const completedOpId = result.current.startOperation({
          type: 'toolCalling',
          context: { agentId: 'session1', messageId: 'assistant_msg' },
          metadata: { startTime: 1000, tool_call_id: 'tool-1' },
        }).operationId;

        result.current.completeOperation(completedOpId);

        result.current.startOperation({
          type: 'createToolMessage',
          context: { agentId: 'session1', messageId: 'tool_msg' },
          metadata: { startTime: 1200, tool_call_id: 'tool-1' },
        });
      });

      expect(operationSelectors.getRunningToolCallStartTime('tool-1')(result.current)).toBe(
        undefined,
      );
    });
  });

  describe('isAgentRunning', () => {
    it('should return false when no operations exist', () => {
      const { result } = renderHook(() => useChatStore());

      expect(operationSelectors.isAgentRunning('agent1')(result.current)).toBe(false);
    });

    it('should return true only for the agent with running operations', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'agent1' },
        });
      });

      expect(operationSelectors.isAgentRunning('agent1')(result.current)).toBe(true);
      expect(operationSelectors.isAgentRunning('agent2')(result.current)).toBe(false);
    });

    it('should return false when operation completes', () => {
      const { result } = renderHook(() => useChatStore());

      let opId: string;

      act(() => {
        opId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'agent1' },
        }).operationId;
      });

      expect(operationSelectors.isAgentRunning('agent1')(result.current)).toBe(true);

      act(() => {
        result.current.completeOperation(opId!);
      });

      expect(operationSelectors.isAgentRunning('agent1')(result.current)).toBe(false);
    });

    it('should exclude aborting operations', () => {
      const { result } = renderHook(() => useChatStore());

      let opId: string;

      act(() => {
        opId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'agent1' },
        }).operationId;
      });

      expect(operationSelectors.isAgentRunning('agent1')(result.current)).toBe(true);

      act(() => {
        result.current.updateOperationMetadata(opId!, { isAborting: true });
      });

      expect(operationSelectors.isAgentRunning('agent1')(result.current)).toBe(false);
    });

    it('should detect any topic with running operations for the agent', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        // Agent 1, topic 1
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'agent1', topicId: 'topic1' },
        });

        // Agent 1, topic 2
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'agent1', topicId: 'topic2' },
        });

        // Agent 2, topic 3
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'agent2', topicId: 'topic3' },
        });
      });

      // Agent 1 should be running (has 2 topics with operations)
      expect(operationSelectors.isAgentRunning('agent1')(result.current)).toBe(true);
      // Agent 2 should also be running
      expect(operationSelectors.isAgentRunning('agent2')(result.current)).toBe(true);
      // Agent 3 should not be running
      expect(operationSelectors.isAgentRunning('agent3')(result.current)).toBe(false);
    });

    it('should detect server agent runtime operations', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.startOperation({
          type: 'execServerAgentRuntime',
          context: { agentId: 'agent1', groupId: 'group1' },
        });
      });

      expect(operationSelectors.isAgentRunning('agent1')(result.current)).toBe(true);
      expect(operationSelectors.isAgentRunning('agent2')(result.current)).toBe(false);
    });

    it('should not detect non-AI-runtime operations', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        // sendMessage is not an AI runtime operation type
        result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'agent1' },
        });
      });

      // sendMessage is not in AI_RUNTIME_OPERATION_TYPES, so should return false
      expect(operationSelectors.isAgentRunning('agent1')(result.current)).toBe(false);
    });
  });

  describe('backward compatibility selectors', () => {
    it('isAgentRuntimeRunning should work', () => {
      const { result } = renderHook(() => useChatStore());

      expect(operationSelectors.isAgentRuntimeRunning(result.current)).toBe(false);

      act(() => {
        result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1' },
        });
      });

      expect(operationSelectors.isAgentRuntimeRunning(result.current)).toBe(true);
    });

    it('isSendingMessage should work', () => {
      const { result } = renderHook(() => useChatStore());

      expect(operationSelectors.isSendingMessage(result.current)).toBe(false);

      act(() => {
        result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session1' },
        });
      });

      expect(operationSelectors.isSendingMessage(result.current)).toBe(true);
    });

    it('isMainWindowAgentRuntimeRunning should only detect main window operations', () => {
      const { result } = renderHook(() => useChatStore());

      // Set active context
      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: undefined });
      });

      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(false);

      // Start a main window operation (inThread: false)
      let mainOpId: string;
      act(() => {
        mainOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: null },
          metadata: { inThread: false },
        }).operationId;
      });

      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(true);
      expect(operationSelectors.isAgentRuntimeRunning(result.current)).toBe(true);

      // Complete main window operation
      act(() => {
        result.current.completeOperation(mainOpId!);
      });

      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(false);
      expect(operationSelectors.isAgentRuntimeRunning(result.current)).toBe(false);
    });

    it('isMainWindowAgentRuntimeRunning should exclude thread operations', () => {
      const { result } = renderHook(() => useChatStore());

      // Set active context
      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: undefined });
      });

      // Start a thread operation (inThread: true)
      let threadOpId: string;
      act(() => {
        threadOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: null, threadId: 'thread1' },
          metadata: { inThread: true },
        }).operationId;
      });

      // Thread operation should not affect main window state
      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(false);
      // But should be detected by general isAgentRuntimeRunning
      expect(operationSelectors.isAgentRuntimeRunning(result.current)).toBe(true);

      // Complete thread operation
      act(() => {
        result.current.completeOperation(threadOpId!);
      });

      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(false);
      expect(operationSelectors.isAgentRuntimeRunning(result.current)).toBe(false);
    });

    it('isMainWindowAgentRuntimeRunning should distinguish between main and thread operations', () => {
      const { result } = renderHook(() => useChatStore());

      // Set active context
      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: undefined });
      });

      let mainOpId: string;
      let threadOpId: string;

      // Start both main window and thread operations
      act(() => {
        mainOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: null },
          metadata: { inThread: false },
        }).operationId;

        threadOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: null, threadId: 'thread1' },
          metadata: { inThread: true },
        }).operationId;
      });

      // Both selectors should detect their respective operations
      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(true);
      expect(operationSelectors.isAgentRuntimeRunning(result.current)).toBe(true);

      // Complete main window operation, thread operation still running
      act(() => {
        result.current.completeOperation(mainOpId!);
      });

      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(false);
      expect(operationSelectors.isAgentRuntimeRunning(result.current)).toBe(true);

      // Complete thread operation
      act(() => {
        result.current.completeOperation(threadOpId!);
      });

      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(false);
      expect(operationSelectors.isAgentRuntimeRunning(result.current)).toBe(false);
    });

    it('isMainWindowAgentRuntimeRunning should exclude aborting operations', () => {
      const { result } = renderHook(() => useChatStore());

      // Set active context
      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: undefined });
      });

      let opId: string;
      act(() => {
        opId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: null },
          metadata: { inThread: false },
        }).operationId;
      });

      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(true);

      // Mark as aborting
      act(() => {
        result.current.updateOperationMetadata(opId!, { isAborting: true });
      });

      // Should exclude aborting operations
      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(false);
      expect(operationSelectors.isAgentRuntimeRunning(result.current)).toBe(false);
    });

    it('isMainWindowAgentRuntimeRunning should only detect operations in current active topic', () => {
      const { result } = renderHook(() => useChatStore());

      // Set active session and topic
      act(() => {
        useChatStore.setState({ activeAgentId: 'session1', activeTopicId: 'topic1' });
      });

      let topic1OpId: string;
      let topic2OpId: string;

      // Start operation in topic1 (current active topic)
      act(() => {
        topic1OpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: 'topic1' },
          metadata: { inThread: false },
        }).operationId;
      });

      // Should detect operation in current topic
      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(true);

      // Start operation in topic2 (different topic)
      act(() => {
        topic2OpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session1', topicId: 'topic2' },
          metadata: { inThread: false },
        }).operationId;
      });

      // Should still only detect topic1 operation (current active topic)
      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(true);

      // Switch to topic2
      act(() => {
        useChatStore.setState({ activeTopicId: 'topic2' });
      });

      // Should now detect topic2 operation
      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(true);

      // Complete topic2 operation
      act(() => {
        result.current.completeOperation(topic2OpId!);
      });

      // Should not detect any operation in topic2 now
      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(false);

      // Switch back to topic1
      act(() => {
        useChatStore.setState({ activeTopicId: 'topic1' });
      });

      // Should detect topic1 operation again
      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(true);

      // Complete topic1 operation
      act(() => {
        result.current.completeOperation(topic1OpId!);
      });

      // Should not detect any operation now
      expect(operationSelectors.isMainWindowAgentRuntimeRunning(result.current)).toBe(false);
    });
  });
});
