import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/store/chat/store';

import { operationSelectors } from '../selectors';

describe('Operation Selectors', () => {
  beforeEach(() => {
    useChatStore.setState(useChatStore.getInitialState());
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
