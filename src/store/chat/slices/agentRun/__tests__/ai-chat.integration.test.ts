/**
 * Integration test for AI Chat with Operation Management System
 * Tests the integration between AI chat actions and the unified operation system
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { operationSelectors } from '@/store/chat/selectors';
import { useChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

vi.mock('zustand/traditional');

describe('AI Chat Operation Integration Tests', () => {
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
        mainInputEditor: undefined,
      });
    });
  });

  describe('SendMessage Operation Lifecycle', () => {
    it('should create sendMessage operation with editor state', () => {
      const { result } = renderHook(() => useChatStore());
      const sessionId = 'test-session';
      const topicId = 'test-topic';

      const mockEditorState = { type: 'doc', content: [{ type: 'text', text: 'Hello' }] };

      let operationId: string;
      act(() => {
        const { operationId: id } = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: sessionId, topicId },
          metadata: {
            inputEditorTempState: mockEditorState,
          },
        });
        operationId = id;
      });

      const operation = result.current.operations[operationId!];
      expect(operation).toBeDefined();
      expect(operation.type).toBe('sendMessage');
      expect(operation.status).toBe('running');
      expect(operation.metadata.inputEditorTempState).toEqual(mockEditorState);
    });

    it('should restore editor state when cancelling sendMessage', () => {
      const { result } = renderHook(() => useChatStore());
      const sessionId = 'test-session';
      const topicId = 'test-topic';

      const mockEditorState = { type: 'doc', content: [{ type: 'text', text: 'Hello World' }] };
      const mockEditor = {
        setJSONState: vi.fn(),
      };

      // Set mock editor
      act(() => {
        useChatStore.setState({ mainInputEditor: mockEditor as any });
      });

      let operationId: string;
      act(() => {
        const { operationId: id } = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: sessionId, topicId },
          metadata: {
            inputEditorTempState: mockEditorState,
          },
        });
        operationId = id;
      });

      // Cancel operation
      act(() => {
        result.current.cancelOperation(operationId!, 'User cancelled');
      });

      // Verify operation cancelled
      expect(result.current.operations[operationId!].status).toBe('cancelled');
      expect(result.current.operations[operationId!].metadata.cancelReason).toBe('User cancelled');
    });

    it('should handle error message in sendMessage operation', () => {
      const { result } = renderHook(() => useChatStore());
      const sessionId = 'test-session';
      const topicId = 'test-topic';

      let operationId: string;
      act(() => {
        const { operationId: id } = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: sessionId, topicId },
        });
        operationId = id;
      });

      // Set error message
      const errorMsg = 'Failed to send message: Network error';
      act(() => {
        result.current.updateOperationMetadata(operationId!, {
          inputSendErrorMsg: errorMsg,
        });
      });

      // Verify error message stored
      expect(result.current.operations[operationId!].metadata.inputSendErrorMsg).toBe(errorMsg);

      // Clear error message
      act(() => {
        result.current.updateOperationMetadata(operationId!, {
          inputSendErrorMsg: undefined,
        });
      });

      // Verify error message cleared
      expect(result.current.operations[operationId!].metadata.inputSendErrorMsg).toBeUndefined();
    });

    it('should handle abort controller for sendMessage operation', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId = '';
      let abortController: AbortController | undefined;

      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'test-session', topicId: 'test-topic' },
        });
        operationId = res.operationId;
        abortController = res.abortController;
      });

      expect(abortController!.signal.aborted).toBe(false);

      // Cancel operation
      act(() => {
        result.current.cancelOperation(operationId, 'User stopped');
      });

      expect(abortController!.signal.aborted).toBe(true);
      expect(result.current.operations[operationId].status).toBe('cancelled');
    });
  });

  describe('AI Generation Operation Integration', () => {
    it('should create generateAI operation and associate with message', () => {
      const { result } = renderHook(() => useChatStore());
      const sessionId = 'session-1';
      const topicId = 'topic-1';
      const messageId = 'msg-1';

      let operationId = '';
      act(() => {
        const { operationId: id } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: sessionId, topicId, messageId },
          label: 'AI Generation',
        });
        operationId = id;
      });

      // Associate message
      act(() => {
        result.current.associateMessageWithOperation(messageId, operationId);
      });

      // Verify operation and association
      expect(result.current.operations[operationId]).toBeDefined();
      expect(result.current.messageOperationMap[messageId]).toBe(operationId);
      expect(operationSelectors.isAIGenerating(result.current)).toBe(true);
    });

    it('should handle AI generation with child operations (reasoning, toolCalling, rag)', () => {
      const { result } = renderHook(() => useChatStore());

      // Create parent generateAI operation
      let parentOpId = '';
      act(() => {
        const { operationId } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-1', topicId: 'topic-1', messageId: 'msg-1' },
        });
        parentOpId = operationId;
      });

      // Create child operations without explicit context (should inherit)
      let reasoningOpId = '';
      let ragOpId = '';
      let toolCallingOpId = '';

      act(() => {
        reasoningOpId = result.current.startOperation({
          type: 'reasoning',
          parentOperationId: parentOpId,
        }).operationId;

        ragOpId = result.current.startOperation({
          type: 'rag',
          parentOperationId: parentOpId,
        }).operationId;

        toolCallingOpId = result.current.startOperation({
          type: 'toolCalling',
          parentOperationId: parentOpId,
        }).operationId;
      });

      // Verify all child operations inherited parent context
      const parentContext = result.current.operations[parentOpId].context;
      expect(result.current.operations[reasoningOpId].context).toEqual(parentContext);
      expect(result.current.operations[ragOpId].context).toEqual(parentContext);
      expect(result.current.operations[toolCallingOpId].context).toEqual(parentContext);

      // Verify parent-child relationships
      const parent = result.current.operations[parentOpId];
      expect(parent.childOperationIds).toContain(reasoningOpId);
      expect(parent.childOperationIds).toContain(ragOpId);
      expect(parent.childOperationIds).toContain(toolCallingOpId);

      // Verify all operations are running
      expect(operationSelectors.getRunningOperations(result.current)).toHaveLength(4);
    });

    it('should cancel all child operations when parent AI generation is cancelled', () => {
      const { result } = renderHook(() => useChatStore());

      // Create complex operation hierarchy (AI generation -> tool calling -> plugin API)
      let parentOpId = '';
      let reasoningOpId = '';
      let toolCallingOpId = '';
      let pluginApiOpId = '';

      act(() => {
        parentOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-1', messageId: 'msg-1' },
        }).operationId;

        reasoningOpId = result.current.startOperation({
          type: 'reasoning',
          parentOperationId: parentOpId,
        }).operationId;

        toolCallingOpId = result.current.startOperation({
          type: 'toolCalling',
          parentOperationId: parentOpId,
        }).operationId;

        // Create grandchild operation
        pluginApiOpId = result.current.startOperation({
          type: 'pluginApi',
          parentOperationId: toolCallingOpId,
        }).operationId;
      });

      // Cancel parent AI generation
      act(() => {
        result.current.cancelOperation(parentOpId, 'User stopped generation');
      });

      // Verify entire hierarchy is cancelled
      expect(result.current.operations[parentOpId].status).toBe('cancelled');
      expect(result.current.operations[reasoningOpId].status).toBe('cancelled');
      expect(result.current.operations[toolCallingOpId].status).toBe('cancelled');
      expect(result.current.operations[pluginApiOpId].status).toBe('cancelled');

      // Verify no running operations
      expect(operationSelectors.hasAnyRunningOperation(result.current)).toBe(false);
      expect(operationSelectors.canSendMessage(result.current)).toBe(true);
    });

    it('should complete AI generation and all child operations', () => {
      const { result } = renderHook(() => useChatStore());

      let parentOpId = '';
      let childOpId = '';

      act(() => {
        parentOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-1' },
        }).operationId;

        childOpId = result.current.startOperation({
          type: 'toolCalling',
          parentOperationId: parentOpId,
        }).operationId;
      });

      // Complete child first
      act(() => {
        result.current.completeOperation(childOpId);
      });

      expect(result.current.operations[childOpId].status).toBe('completed');
      expect(result.current.operations[parentOpId].status).toBe('running');

      // Complete parent
      act(() => {
        result.current.completeOperation(parentOpId);
      });

      expect(result.current.operations[parentOpId].status).toBe('completed');
      expect(result.current.operations[parentOpId].metadata.duration).toBeGreaterThanOrEqual(0);
      expect(operationSelectors.canSendMessage(result.current)).toBe(true);
    });
  });

  describe('Multi-Context Operation Isolation', () => {
    it('should handle multiple sendMessage operations in different contexts', () => {
      const { result } = renderHook(() => useChatStore());

      const op1Context = { agentId: 'session-1', topicId: 'topic-a' };
      const op2Context = { agentId: 'session-1', topicId: 'topic-b' };
      const op3Context = { agentId: 'session-2', topicId: 'topic-a' };

      let op1Id = '';
      let op2Id = '';
      let op3Id = '';

      act(() => {
        op1Id = result.current.startOperation({
          type: 'sendMessage',
          context: op1Context,
        }).operationId;

        op2Id = result.current.startOperation({
          type: 'sendMessage',
          context: op2Context,
        }).operationId;

        op3Id = result.current.startOperation({
          type: 'sendMessage',
          context: op3Context,
        }).operationId;
      });

      // Verify all operations created with correct contexts
      expect(result.current.operations[op1Id].context).toMatchObject(op1Context);
      expect(result.current.operations[op2Id].context).toMatchObject(op2Context);
      expect(result.current.operations[op3Id].context).toMatchObject(op3Context);

      // Verify context index
      const contextKey1 = messageMapKey({ agentId: 'session-1', topicId: 'topic-a' });
      const contextKey2 = messageMapKey({ agentId: 'session-1', topicId: 'topic-b' });
      const contextKey3 = messageMapKey({ agentId: 'session-2', topicId: 'topic-a' });

      expect(result.current.operationsByContext[contextKey1]).toContain(op1Id);
      expect(result.current.operationsByContext[contextKey2]).toContain(op2Id);
      expect(result.current.operationsByContext[contextKey3]).toContain(op3Id);
    });

    it('should cancel operations only in specific topic', () => {
      const { result } = renderHook(() => useChatStore());

      let topicAOpId = '';
      let topicBOpId = '';

      act(() => {
        topicAOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-1', topicId: 'topic-a' },
        }).operationId;

        topicBOpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-1', topicId: 'topic-b' },
        }).operationId;
      });

      // Cancel operations in topic-a only
      let cancelledIds: string[] = [];
      act(() => {
        cancelledIds = result.current.cancelOperations({
          agentId: 'session-1',
          topicId: 'topic-a',
        });
      });

      // Verify only topic-a operations cancelled
      expect(cancelledIds).toHaveLength(1);
      expect(cancelledIds).toContain(topicAOpId);
      expect(result.current.operations[topicAOpId].status).toBe('cancelled');
      expect(result.current.operations[topicBOpId].status).toBe('running');
    });

    it('should isolate operations between different sessions', () => {
      const { result } = renderHook(() => useChatStore());

      let session1OpId = '';
      let session2OpId = '';

      act(() => {
        session1OpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-1', topicId: 'topic-1' },
        }).operationId;

        session2OpId = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-2', topicId: 'topic-1' },
        }).operationId;
      });

      // Cancel operations in session-1 only
      let cancelledIds: string[] = [];
      act(() => {
        cancelledIds = result.current.cancelOperations({
          agentId: 'session-1',
        });
      });

      // Verify only session-1 operations cancelled
      expect(cancelledIds).toHaveLength(1);
      expect(cancelledIds).toContain(session1OpId);
      expect(result.current.operations[session1OpId].status).toBe('cancelled');
      expect(result.current.operations[session2OpId].status).toBe('running');
    });
  });

  describe('Operation Error Handling', () => {
    it('should handle operation failure with error details', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId = '';
      act(() => {
        const { operationId: id } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-1' },
        });
        operationId = id;
      });

      // Fail operation with error
      const error = {
        type: 'NetworkError',
        message: 'Failed to connect to AI service',
        code: 'ERR_NETWORK',
        details: { statusCode: 503 },
      };

      act(() => {
        result.current.failOperation(operationId, error);
      });

      const operation = result.current.operations[operationId];
      expect(operation.status).toBe('failed');
      expect(operation.metadata.error).toEqual(error);
      expect(operation.metadata.endTime).toBeDefined();
      expect(operation.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle sendMessage error display', () => {
      const { result } = renderHook(() => useChatStore());
      const sessionId = 'session-1';
      const topicId = 'topic-1';

      let operationId = '';
      act(() => {
        const { operationId: id } = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: sessionId, topicId },
        });
        operationId = id;
      });

      // Set error message for UI display
      const errorMsg = 'Message too long';
      act(() => {
        result.current.updateOperationMetadata(operationId, {
          inputSendErrorMsg: errorMsg,
        });
      });

      // Verify error message can be retrieved
      expect(result.current.operations[operationId].metadata.inputSendErrorMsg).toBe(errorMsg);

      // User fixes the error and clears it
      act(() => {
        result.current.updateOperationMetadata(operationId, {
          inputSendErrorMsg: undefined,
        });
      });

      expect(result.current.operations[operationId].metadata.inputSendErrorMsg).toBeUndefined();
    });
  });

  describe('Tool Execution Cancellation', () => {
    it('should abort tool execution when executeToolCall operation is cancelled', () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'tool-msg-1';

      // Create toolCalling parent operation
      let toolCallingOpId = '';
      act(() => {
        toolCallingOpId = result.current.startOperation({
          type: 'toolCalling',
          context: { agentId: 'session-1', messageId },
        }).operationId;
      });

      // Create executeToolCall child operation
      let executeToolOpId = '';
      let executeToolAbortController: AbortController | undefined;
      act(() => {
        const res = result.current.startOperation({
          type: 'executeToolCall',
          context: { agentId: 'session-1', messageId },
          parentOperationId: toolCallingOpId,
        });
        executeToolOpId = res.operationId;
        executeToolAbortController = res.abortController;
      });

      // Associate message with executeToolCall operation (not parent)
      act(() => {
        result.current.associateMessageWithOperation(messageId, executeToolOpId);
      });

      // Verify message is associated with executeToolCall operation
      expect(result.current.messageOperationMap[messageId]).toBe(executeToolOpId);

      // Verify abort signal is not aborted yet
      expect(executeToolAbortController!.signal.aborted).toBe(false);

      // Cancel parent toolCalling operation (should cascade to child)
      act(() => {
        result.current.cancelOperation(toolCallingOpId, 'User stopped');
      });

      // Verify both operations are cancelled
      expect(result.current.operations[toolCallingOpId].status).toBe('cancelled');
      expect(result.current.operations[executeToolOpId].status).toBe('cancelled');

      // Verify abort signal is triggered
      expect(executeToolAbortController!.signal.aborted).toBe(true);

      // Verify tool can check abort status via messageOperationMap
      const toolOperation =
        result.current.operations[result.current.messageOperationMap[messageId]];
      expect(toolOperation.status).toBe('cancelled');
      expect(toolOperation.abortController.signal.aborted).toBe(true);
    });

    it('should allow tool execution to check abort signal before starting', () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = 'tool-msg-2';

      // Create and immediately cancel executeToolCall operation
      let executeToolOpId = '';
      let abortController: AbortController | undefined;

      act(() => {
        const res = result.current.startOperation({
          type: 'executeToolCall',
          context: { agentId: 'session-1', messageId },
        });
        executeToolOpId = res.operationId;
        abortController = res.abortController;
      });

      // Associate message
      act(() => {
        result.current.associateMessageWithOperation(messageId, executeToolOpId);
      });

      // Cancel immediately
      act(() => {
        result.current.cancelOperation(executeToolOpId, 'Cancelled before execution');
      });

      // Simulate tool checking abort signal before execution
      const operationId = result.current.messageOperationMap[messageId];
      const operation = operationId ? result.current.operations[operationId] : undefined;
      const toolAbortController = operation?.abortController;

      // Tool should detect cancellation
      expect(toolAbortController?.signal.aborted).toBe(true);
      expect(operation?.status).toBe('cancelled');
    });
  });

  describe('Operation State Queries', () => {
    it('should correctly report AI generation state', () => {
      const { result } = renderHook(() => useChatStore());

      // Initially no AI generation
      expect(operationSelectors.isAIGenerating(result.current)).toBe(false);
      expect(operationSelectors.canSendMessage(result.current)).toBe(true);

      // Start AI generation in current context
      let operationId = '';
      act(() => {
        const { operationId: id } = result.current.startOperation({
          type: 'execAgentRuntime',
          context: {
            agentId: result.current.activeAgentId,
            topicId: result.current.activeTopicId,
          },
        });
        operationId = id;
      });

      expect(operationSelectors.isAIGenerating(result.current)).toBe(true);
      expect(operationSelectors.canSendMessage(result.current)).toBe(false);

      // Complete generation
      act(() => {
        result.current.completeOperation(operationId);
      });

      expect(operationSelectors.isAIGenerating(result.current)).toBe(false);
      expect(operationSelectors.canSendMessage(result.current)).toBe(true);
    });

    it('should report running operations by type', () => {
      const { result } = renderHook(() => useChatStore());

      let sendOpId = '';
      let genOpId1 = '';
      let genOpId2 = '';

      act(() => {
        sendOpId = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session-1' },
        }).operationId;

        genOpId1 = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-1' },
        }).operationId;

        genOpId2 = result.current.startOperation({
          type: 'execAgentRuntime',
          context: { agentId: 'session-2' },
        }).operationId;
      });

      // Verify type index
      expect(result.current.operationsByType.sendMessage).toContain(sendOpId);
      expect(result.current.operationsByType.execAgentRuntime).toContain(genOpId1);
      expect(result.current.operationsByType.execAgentRuntime).toContain(genOpId2);

      // Complete one generateAI
      act(() => {
        result.current.completeOperation(genOpId1);
      });

      // Verify AI still generating (genOpId2 is still running)
      expect(operationSelectors.isAIGenerating(result.current)).toBe(true);
    });
  });
});
