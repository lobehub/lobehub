import { type ConversationContext } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { createMockMessage, createMockResolvedAgentConfig, TEST_IDS } from './fixtures';
import { resetTestEnvironment } from './helpers';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional');

beforeEach(() => {
  resetTestEnvironment();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConversationControl actions', () => {
  describe('stopGenerateMessage', () => {
    it('should cancel running generateAI operations in current context', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
        });
      });

      // Create a generateAI operation
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
        });
        operationId = res.operationId;
      });

      expect(result.current.operations[operationId!].status).toBe('running');

      // Stop generation
      act(() => {
        result.current.stopGenerateMessage();
      });

      expect(result.current.operations[operationId!].status).toBe('cancelled');
    });

    it('should not cancel operations from different context', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
        });
      });

      // Create a generateAI operation in a different context
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'execAgentRuntime',
          context: {
            agentId: 'different-session',
            topicId: 'different-topic',
          },
        });
        operationId = res.operationId;
      });

      expect(result.current.operations[operationId!].status).toBe('running');

      // Stop generation - should not affect different context
      act(() => {
        result.current.stopGenerateMessage();
      });

      expect(result.current.operations[operationId!].status).toBe('running');
    });
  });

  describe('cancelSendMessageInServer', () => {
    it('should cancel operation and restore editor state', () => {
      const { result } = renderHook(() => useChatStore());
      const mockSetJSONState = vi.fn();
      const editorState = { content: 'saved content' };

      act(() => {
        useChatStore.setState({
          activeAgentId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
          mainInputEditor: { setJSONState: mockSetJSONState } as any,
        });
      });

      // Create operation
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
        });
        operationId = res.operationId;

        result.current.updateOperationMetadata(res.operationId, {
          inputEditorTempState: editorState,
        });
      });

      expect(result.current.operations[operationId!].status).toBe('running');

      // Cancel
      act(() => {
        result.current.cancelSendMessageInServer();
      });

      expect(result.current.operations[operationId!].status).toBe('cancelled');
      expect(mockSetJSONState).toHaveBeenCalledWith(editorState);
    });

    it('should cancel operation for specified topic ID', () => {
      const { result } = renderHook(() => useChatStore());
      const customTopicId = 'custom-topic-id';

      act(() => {
        useChatStore.setState({
          activeAgentId: TEST_IDS.SESSION_ID,
        });
      });

      // Create operation
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: customTopicId,
          },
        });
        operationId = res.operationId;
      });

      expect(result.current.operations[operationId!].status).toBe('running');

      // Cancel
      act(() => {
        result.current.cancelSendMessageInServer(customTopicId);
      });

      expect(result.current.operations[operationId!].status).toBe('cancelled');
    });

    it('should handle gracefully when operation does not exist', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          operations: {},
          operationsByContext: {},
        });
      });

      expect(() => {
        act(() => {
          result.current.cancelSendMessageInServer('non-existing-topic');
        });
      }).not.toThrow();
    });
  });

  describe('clearSendMessageError', () => {
    it('should clear error state for current topic', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
        });
      });

      // Create operation with error
      let operationId: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: {
            agentId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
        });
        operationId = res.operationId;

        result.current.updateOperationMetadata(res.operationId, {
          inputSendErrorMsg: 'Some error',
        });
      });

      expect(result.current.operations[operationId!].metadata.inputSendErrorMsg).toBe('Some error');

      // Clear error
      act(() => {
        result.current.clearSendMessageError();
      });

      expect(result.current.operations[operationId!].metadata.inputSendErrorMsg).toBeUndefined();
    });

    it('should handle gracefully when no error operation exists', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          operations: {},
          operationsByContext: {},
        });
      });

      expect(() => {
        act(() => {
          result.current.clearSendMessageError();
        });
      }).not.toThrow();
    });
  });

  describe('Operation system integration', () => {
    it('should create operation with abort controller', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string = '';
      let abortController: AbortController | undefined;

      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'test-session' },
        });
        operationId = res.operationId;
        abortController = res.abortController;
      });

      expect(abortController!).toBeInstanceOf(AbortController);
      expect(result.current.operations[operationId!].abortController).toBe(abortController);
      expect(result.current.operations[operationId!].status).toBe('running');
    });

    it('should update operation metadata', () => {
      const { result } = renderHook(() => useChatStore());

      let operationId: string;

      act(() => {
        const res = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'test-session' },
        });
        operationId = res.operationId;

        result.current.updateOperationMetadata(res.operationId, {
          inputSendErrorMsg: 'test error',
          inputEditorTempState: { content: 'test' },
        });
      });

      expect(result.current.operations[operationId!].metadata.inputSendErrorMsg).toBe('test error');
      expect(result.current.operations[operationId!].metadata.inputEditorTempState).toEqual({
        content: 'test',
      });
    });

    it('should support multiple parallel operations', () => {
      const { result } = renderHook(() => useChatStore());

      let opId1: string = '';
      let opId2: string = '';

      act(() => {
        const res1 = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session-1', topicId: 'topic-1' },
        });
        const res2 = result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session-1', topicId: 'topic-2' },
        });

        opId1 = res1.operationId;
        opId2 = res2.operationId;
      });

      expect(result.current.operations[opId1!].status).toBe('running');
      expect(result.current.operations[opId2!].status).toBe('running');
      expect(opId1).not.toBe(opId2);

      const contextKey1 = messageMapKey({ agentId: 'session-1', topicId: 'topic-1' });
      const contextKey2 = messageMapKey({ agentId: 'session-1', topicId: 'topic-2' });

      expect(result.current.operationsByContext[contextKey1]).toContain(opId1!);
      expect(result.current.operationsByContext[contextKey2]).toContain(opId2!);
    });
  });

  describe('switchMessageBranch', () => {
    it('should switch to a different message branch', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = TEST_IDS.MESSAGE_ID;
      const branchIndex = 1;

      const optimisticUpdateSpy = vi
        .spyOn(result.current, 'optimisticUpdateMessageMetadata')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.switchMessageBranch(messageId, branchIndex);
      });

      expect(optimisticUpdateSpy).toHaveBeenCalledWith(
        messageId,
        { activeBranchIndex: branchIndex },
        undefined,
      );
    });

    it('should handle switching to branch 0', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = TEST_IDS.MESSAGE_ID;
      const branchIndex = 0;

      const optimisticUpdateSpy = vi
        .spyOn(result.current, 'optimisticUpdateMessageMetadata')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.switchMessageBranch(messageId, branchIndex);
      });

      expect(optimisticUpdateSpy).toHaveBeenCalledWith(
        messageId,
        { activeBranchIndex: 0 },
        undefined,
      );
    });

    it('should handle errors gracefully when optimistic update fails', async () => {
      const { result } = renderHook(() => useChatStore());
      const messageId = TEST_IDS.MESSAGE_ID;
      const branchIndex = 2;

      const optimisticUpdateSpy = vi
        .spyOn(result.current, 'optimisticUpdateMessageMetadata')
        .mockRejectedValue(new Error('Update failed'));

      await expect(
        act(async () => {
          await result.current.switchMessageBranch(messageId, branchIndex);
        }),
      ).rejects.toThrow('Update failed');

      expect(optimisticUpdateSpy).toHaveBeenCalledWith(
        messageId,
        { activeBranchIndex: branchIndex },
        undefined,
      );
    });
  });

  describe('approveToolCalling', () => {
    it('should use provided context instead of global state', async () => {
      const { result } = renderHook(() => useChatStore());

      // Setup: global activeAgentId = 'global-agent'
      const globalAgentId = 'global-agent';
      const builderAgentId = 'builder-agent';
      const builderTopicId = 'builder-topic';

      // Create tool message
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        plugin: { identifier: 'test-plugin', type: 'default', arguments: '{}', apiName: 'test' },
      });

      // Setup store with global context and builder context messages
      const globalKey = messageMapKey({ agentId: globalAgentId, topicId: null });
      const builderKey = messageMapKey({
        agentId: builderAgentId,
        topicId: builderTopicId,
        scope: 'agent_builder',
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: globalAgentId,
          activeTopicId: undefined,
          dbMessagesMap: {
            [globalKey]: [createMockMessage({ id: 'global-msg', role: 'user' })],
            [builderKey]: [toolMessage],
          },
          messagesMap: {
            [globalKey]: [createMockMessage({ id: 'global-msg', role: 'user' })],
            [builderKey]: [toolMessage],
          },
        });
      });

      // Mock internal methods
      const optimisticUpdatePluginSpy = vi
        .spyOn(result.current, 'optimisticUpdatePlugin')
        .mockResolvedValue(undefined);
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          state: {} as any,
          context: { phase: 'init' } as any,
          agentConfig: createMockResolvedAgentConfig(),
        });
      const internal_execAgentRuntimeSpy = vi
        .spyOn(result.current, 'internal_execAgentRuntime')
        .mockResolvedValue(undefined);

      // Call with builder context
      const context: ConversationContext = {
        agentId: builderAgentId,
        topicId: builderTopicId,
        scope: 'agent_builder',
      };

      await act(async () => {
        await result.current.approveToolCalling('tool-msg-1', 'group-1', context);
      });

      // Verify internal_createAgentState was called with builder context
      expect(internal_createAgentStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: builderAgentId,
          topicId: builderTopicId,
        }),
      );

      // Verify internal_execAgentRuntime was called with builder context (now wrapped in context object)
      expect(internal_execAgentRuntimeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            agentId: builderAgentId,
            topicId: builderTopicId,
            scope: 'agent_builder',
          }),
        }),
      );
    });

    it('should fallback to global state when context not provided', async () => {
      const { result } = renderHook(() => useChatStore());

      const globalAgentId = 'global-agent';
      const globalTopicId = 'global-topic';

      // Create tool message
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        plugin: { identifier: 'test-plugin', type: 'default', arguments: '{}', apiName: 'test' },
      });

      const globalKey = messageMapKey({ agentId: globalAgentId, topicId: globalTopicId });

      act(() => {
        useChatStore.setState({
          activeAgentId: globalAgentId,
          activeTopicId: globalTopicId,
          activeThreadId: undefined,
          dbMessagesMap: {
            [globalKey]: [toolMessage],
          },
          messagesMap: {
            [globalKey]: [toolMessage],
          },
        });
      });

      // Mock internal methods
      vi.spyOn(result.current, 'optimisticUpdatePlugin').mockResolvedValue(undefined);
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          state: {} as any,
          context: { phase: 'init' } as any,
          agentConfig: createMockResolvedAgentConfig(),
        });
      const internal_execAgentRuntimeSpy = vi
        .spyOn(result.current, 'internal_execAgentRuntime')
        .mockResolvedValue(undefined);

      // Call without context (should use global state)
      await act(async () => {
        await result.current.approveToolCalling('tool-msg-1', 'group-1');
      });

      // Verify internal_createAgentState was called with global context
      expect(internal_createAgentStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: globalAgentId,
          topicId: globalTopicId,
        }),
      );

      // Verify internal_execAgentRuntime was called with global context (now wrapped in context object)
      expect(internal_execAgentRuntimeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            agentId: globalAgentId,
            topicId: globalTopicId,
          }),
        }),
      );
    });

    it('should not execute when tool message not found', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: 'test-agent',
          activeTopicId: undefined,
          dbMessagesMap: {},
          messagesMap: {},
        });
      });

      const internal_execAgentRuntimeSpy = vi
        .spyOn(result.current, 'internal_execAgentRuntime')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.approveToolCalling('non-existent-msg', 'group-1');
      });

      // Should not call internal_execAgentRuntime when tool message not found
      expect(internal_execAgentRuntimeSpy).not.toHaveBeenCalled();
    });
  });

  describe('rejectAndContinueToolCalling', () => {
    it('should use provided context instead of global state', async () => {
      const { result } = renderHook(() => useChatStore());

      const globalAgentId = 'global-agent';
      const builderAgentId = 'builder-agent';
      const builderTopicId = 'builder-topic';

      // Create tool message
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        plugin: { identifier: 'test-plugin', type: 'default', arguments: '{}', apiName: 'test' },
      });

      const globalKey = messageMapKey({ agentId: globalAgentId, topicId: null });
      const builderKey = messageMapKey({
        agentId: builderAgentId,
        topicId: builderTopicId,
        scope: 'agent_builder',
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: globalAgentId,
          activeTopicId: undefined,
          dbMessagesMap: {
            [globalKey]: [createMockMessage({ id: 'global-msg', role: 'user' })],
            [builderKey]: [toolMessage],
          },
          messagesMap: {
            [globalKey]: [createMockMessage({ id: 'global-msg', role: 'user' })],
            [builderKey]: [toolMessage],
          },
        });
      });

      // Mock internal methods
      vi.spyOn(result.current, 'optimisticUpdatePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          state: {} as any,
          context: { phase: 'init' } as any,
          agentConfig: createMockResolvedAgentConfig(),
        });
      const internal_execAgentRuntimeSpy = vi
        .spyOn(result.current, 'internal_execAgentRuntime')
        .mockResolvedValue(undefined);

      // Call with builder context
      const context: ConversationContext = {
        agentId: builderAgentId,
        topicId: builderTopicId,
        scope: 'agent_builder',
      };

      await act(async () => {
        await result.current.rejectAndContinueToolCalling('tool-msg-1', 'User rejected', context);
      });

      // Verify internal_createAgentState was called with builder context
      expect(internal_createAgentStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: builderAgentId,
          topicId: builderTopicId,
        }),
      );

      // Verify internal_execAgentRuntime was called with builder context (now wrapped in context object)
      expect(internal_execAgentRuntimeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            agentId: builderAgentId,
            topicId: builderTopicId,
            scope: 'agent_builder',
          }),
        }),
      );
    });

    it('should fallback to global state when context not provided', async () => {
      const { result } = renderHook(() => useChatStore());

      const globalAgentId = 'global-agent';
      const globalTopicId = 'global-topic';

      // Create tool message
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        plugin: { identifier: 'test-plugin', type: 'default', arguments: '{}', apiName: 'test' },
      });

      const globalKey = messageMapKey({ agentId: globalAgentId, topicId: globalTopicId });

      act(() => {
        useChatStore.setState({
          activeAgentId: globalAgentId,
          activeTopicId: globalTopicId,
          activeThreadId: undefined,
          dbMessagesMap: {
            [globalKey]: [toolMessage],
          },
          messagesMap: {
            [globalKey]: [toolMessage],
          },
        });
      });

      // Mock internal methods
      vi.spyOn(result.current, 'optimisticUpdatePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          state: {} as any,
          context: { phase: 'init' } as any,
          agentConfig: createMockResolvedAgentConfig(),
        });
      const internal_execAgentRuntimeSpy = vi
        .spyOn(result.current, 'internal_execAgentRuntime')
        .mockResolvedValue(undefined);

      // Call without context
      await act(async () => {
        await result.current.rejectAndContinueToolCalling('tool-msg-1', 'User rejected');
      });

      // Verify internal_createAgentState was called with global context
      expect(internal_createAgentStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: globalAgentId,
          topicId: globalTopicId,
        }),
      );

      // Verify internal_execAgentRuntime was called with global context
      expect(internal_execAgentRuntimeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            agentId: globalAgentId,
            topicId: globalTopicId,
          }),
        }),
      );
    });
  });
});
