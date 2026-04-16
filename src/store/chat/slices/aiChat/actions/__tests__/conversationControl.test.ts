import { type ConversationContext } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { createMockMessage, createMockResolvedAgentConfig, TEST_IDS } from './fixtures';
import { resetTestEnvironment } from './helpers';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional');

// Mock the tRPC client & agentRuntimeService so the import chain doesn't pull
// server-only code (cloud business packages, redis envs) into the test env.
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: {
      processHumanIntervention: { mutate: vi.fn().mockResolvedValue({ success: true }) },
    },
  },
}));

vi.mock('@/services/agentRuntime', () => ({
  agentRuntimeService: {
    handleHumanIntervention: vi.fn().mockResolvedValue({ success: true }),
  },
}));

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

    it('cancels Gateway-mode execServerAgentRuntime ops and invokes their cancel handler', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
        });
      });

      let operationId!: string;
      act(() => {
        const res = result.current.startOperation({
          type: 'execServerAgentRuntime',
          context: { agentId: TEST_IDS.SESSION_ID, topicId: TEST_IDS.TOPIC_ID },
        });
        operationId = res.operationId;
      });

      const cancelHandler = vi.fn();
      act(() => {
        result.current.onOperationCancel(operationId, cancelHandler);
      });

      expect(result.current.operations[operationId].status).toBe('running');

      act(() => {
        result.current.stopGenerateMessage();
      });

      // Operation gets cancelled and the handler (which would fire the WS interrupt
      // in real code) is invoked with the operation context.
      expect(result.current.operations[operationId].status).toBe('cancelled');
      expect(cancelHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId,
          type: 'execServerAgentRuntime',
        }),
      );
      // isAborting flag is also flipped so the UI loading state clears immediately.
      expect(result.current.operations[operationId].metadata.isAborting).toBe(true);
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
        .spyOn(result.current, 'optimisticUpdateMessagePlugin')
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
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
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

    describe('server-mode branch', () => {
      it('should start a new Gateway op with resumeApproval.decision=approved and NOT run local runtime', async () => {
        const { result } = renderHook(() => useChatStore());

        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });

        const toolMessage = createMockMessage({
          id: 'tool-msg-1',
          plugin: {
            apiName: 'search',
            arguments: '{"q":"test"}',
            identifier: 'web-search',
            type: 'default',
          },
          role: 'tool',
          // `tool_call_id` is what the server uses to locate the pending tool
          // call; the new Gateway op carries it forward via `resumeApproval`.
          tool_call_id: 'call_xyz',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });

          // Presence of an `execServerAgentRuntime` op (any status) is one
          // half of the Gateway-resume signal; the other is the lab flag.
          result.current.startOperation({
            context: { agentId, topicId, threadId: null },
            metadata: { serverOperationId: 'server-op-xyz' },
            type: 'execServerAgentRuntime',
          });
        });

        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);
        const internal_execAgentRuntimeSpy = vi
          .spyOn(result.current, 'internal_execAgentRuntime')
          .mockResolvedValue(undefined);

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-1', 'group-1');
        });

        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            message: '',
            parentMessageId: 'tool-msg-1',
            resumeApproval: {
              decision: 'approved',
              parentMessageId: 'tool-msg-1',
              toolCallId: 'call_xyz',
            },
          }),
        );
        expect(internal_execAgentRuntimeSpy).not.toHaveBeenCalled();

        // Fallback guard: the paused `execServerAgentRuntime` op in this
        // context must be completed so the loading state doesn't bleed
        // across ops when the server-side `agent_runtime_end` for
        // `waiting_for_human` hasn't landed yet.
        const pausedServerOps = Object.values(result.current.operations).filter(
          (op: any) => op.type === 'execServerAgentRuntime',
        );
        expect(pausedServerOps).toHaveLength(1);
        expect(pausedServerOps[0]!.status).toBe('completed');

        executeGatewayAgentSpy.mockRestore();
      });

      it('should still take the Gateway branch when the server already ended the paused op (post-coordinator-fix state)', async () => {
        const { result } = renderHook(() => useChatStore());

        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });

        const toolMessage = createMockMessage({
          id: 'tool-msg-1',
          plugin: {
            apiName: 'search',
            arguments: '{"q":"test"}',
            identifier: 'web-search',
            type: 'default',
          },
          role: 'tool',
          tool_call_id: 'call_xyz',
        } as any);

        let serverOpId: string | undefined;
        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });

          serverOpId = result.current.startOperation({
            context: { agentId, topicId, threadId: null },
            metadata: { serverOperationId: 'server-op-xyz' },
            type: 'execServerAgentRuntime',
          }).operationId;

          // Simulate the coordinator's `waiting_for_human` → `agent_runtime_end`
          // signal arriving before the user clicks approve: the op is already
          // `completed` when the Gateway-branch decision runs.
          result.current.completeOperation(serverOpId!);
        });

        expect(result.current.operations[serverOpId!]!.status).toBe('completed');

        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);
        const internal_execAgentRuntimeSpy = vi
          .spyOn(result.current, 'internal_execAgentRuntime')
          .mockResolvedValue(undefined);

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-1', 'group-1');
        });

        // Critical regression guard: with `#hasRunningServerOp` the branch
        // was missed here (no running op → fell through to client-mode).
        // The combined `isGatewayModeEnabled() + any execServerAgentRuntime`
        // check keeps us on the Gateway path.
        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            resumeApproval: expect.objectContaining({
              decision: 'approved',
              toolCallId: 'call_xyz',
            }),
          }),
        );
        expect(internal_execAgentRuntimeSpy).not.toHaveBeenCalled();

        executeGatewayAgentSpy.mockRestore();
      });

      it('should leave the paused server op running when the Gateway resume call fails so retries stay on the server-mode path', async () => {
        const { result } = renderHook(() => useChatStore());

        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });

        const toolMessage = createMockMessage({
          id: 'tool-msg-1',
          plugin: {
            apiName: 'search',
            arguments: '{"q":"test"}',
            identifier: 'web-search',
            type: 'default',
          },
          role: 'tool',
          tool_call_id: 'call_xyz',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });

          result.current.startOperation({
            context: { agentId, topicId, threadId: null },
            metadata: { serverOperationId: 'server-op-xyz' },
            type: 'execServerAgentRuntime',
          });
        });

        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockRejectedValue(new Error('network error'));

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-1', 'group-1');
        });

        expect(executeGatewayAgentSpy).toHaveBeenCalled();

        // On failure, the paused server op must stay `running` — otherwise a
        // retry would see no running server op and fall through to the
        // non-Gateway path while the backend is still awaiting human input.
        const serverOps = Object.values(result.current.operations).filter(
          (op: any) => op.type === 'execServerAgentRuntime',
        );
        expect(serverOps).toHaveLength(1);
        expect(serverOps[0]!.status).toBe('running');

        executeGatewayAgentSpy.mockRestore();
      });

      it('should fall through to client-mode runtime when no server operation is running', async () => {
        const { result } = renderHook(() => useChatStore());

        const agentId = 'local-agent';
        const topicId = 'local-topic';
        const chatKey = messageMapKey({ agentId, topicId });

        const toolMessage = createMockMessage({
          id: 'tool-msg-1',
          plugin: { identifier: 'x', type: 'default', arguments: '{}', apiName: 'y' },
          role: 'tool',
          tool_call_id: 'call_local',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });
        });

        vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
        vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
          state: {} as any,
          context: { phase: 'init' } as any,
          agentConfig: createMockResolvedAgentConfig(),
        });
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);
        const internal_execAgentRuntimeSpy = vi
          .spyOn(result.current, 'internal_execAgentRuntime')
          .mockResolvedValue(undefined);

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-1', 'group-1');
        });

        expect(executeGatewayAgentSpy).not.toHaveBeenCalled();
        expect(internal_execAgentRuntimeSpy).toHaveBeenCalled();

        executeGatewayAgentSpy.mockRestore();
      });

      it('resolves the running server op in a group scope context (scope/groupId forwarded to the lookup)', async () => {
        // Regression: operationsByContext is keyed by the full messageMapKey
        // including scope/groupId. If #hasRunningServerOp were to drop those
        // fields, a group conversation's approve/reject would miss the op and
        // fall back to client mode. Assert the server-mode branch fires with
        // the group context intact.
        const { result } = renderHook(() => useChatStore());

        const agentId = 'server-agent';
        const groupId = 'group-1';
        const topicId = 'server-topic';
        const scope = 'group' as const;
        const chatKey = messageMapKey({ agentId, groupId, scope, topicId });

        const toolMessage = createMockMessage({
          id: 'tool-msg-1',
          plugin: { apiName: 'y', arguments: '{}', identifier: 'x', type: 'default' },
          role: 'tool',
          tool_call_id: 'call_group',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });

          // Server op is indexed under the group-scope key. Without scope
          // forwarding the lookup would hit the default 'main' bucket instead.
          result.current.startOperation({
            context: { agentId, groupId, scope, topicId, threadId: null },
            metadata: { serverOperationId: 'server-op-group' },
            type: 'execServerAgentRuntime',
          });
        });

        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);
        const internal_execAgentRuntimeSpy = vi
          .spyOn(result.current, 'internal_execAgentRuntime')
          .mockResolvedValue(undefined);

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-1', 'group-1', {
            agentId,
            groupId,
            scope,
            topicId,
            threadId: null,
          });
        });

        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            resumeApproval: expect.objectContaining({ decision: 'approved' }),
          }),
        );
        expect(internal_execAgentRuntimeSpy).not.toHaveBeenCalled();

        executeGatewayAgentSpy.mockRestore();
      });
    });
  });

  describe('rejectToolCalling server-mode branch', () => {
    it('starts a new Gateway op with resumeApproval.decision=rejected_continue (unified)', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'server-agent';
      const topicId = 'server-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        tool_call_id: 'call_xyz',
      } as any);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [toolMessage] },
          messagesMap: { [chatKey]: [toolMessage] },
        });

        result.current.startOperation({
          context: { agentId, topicId, threadId: null },
          metadata: { serverOperationId: 'server-op-xyz' },
          type: 'execServerAgentRuntime',
        });
      });

      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const executeGatewayAgentSpy = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);

      await act(async () => {
        await result.current.rejectToolCalling('tool-msg-1', 'not appropriate');
      });

      expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '',
          parentMessageId: 'tool-msg-1',
          resumeApproval: {
            decision: 'rejected_continue',
            parentMessageId: 'tool-msg-1',
            rejectionReason: 'not appropriate',
            toolCallId: 'call_xyz',
          },
        }),
      );

      executeGatewayAgentSpy.mockRestore();
    });
  });

  describe('rejectAndContinueToolCalling server-mode branch', () => {
    it('starts a new Gateway op with resumeApproval.decision=rejected_continue and skips both local runtime and client rejectToolCalling', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'server-agent';
      const topicId = 'server-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        tool_call_id: 'call_xyz',
      } as any);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [toolMessage] },
          messagesMap: { [chatKey]: [toolMessage] },
        });

        result.current.startOperation({
          context: { agentId, topicId, threadId: null },
          metadata: { serverOperationId: 'server-op-xyz' },
          type: 'execServerAgentRuntime',
        });
      });

      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const executeGatewayAgentSpy = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);
      const internal_execAgentRuntimeSpy = vi
        .spyOn(result.current, 'internal_execAgentRuntime')
        .mockResolvedValue(undefined);
      // Ensure client rejectToolCalling is NOT invoked in server-mode path —
      // otherwise the server would see a duplicate halting `reject` before
      // this continue signal lands.
      const rejectToolCallingSpy = vi
        .spyOn(result.current, 'rejectToolCalling')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.rejectAndContinueToolCalling('tool-msg-1', 'too risky');
      });

      expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '',
          parentMessageId: 'tool-msg-1',
          resumeApproval: {
            decision: 'rejected_continue',
            parentMessageId: 'tool-msg-1',
            rejectionReason: 'too risky',
            toolCallId: 'call_xyz',
          },
        }),
      );
      expect(internal_execAgentRuntimeSpy).not.toHaveBeenCalled();
      expect(rejectToolCallingSpy).not.toHaveBeenCalled();

      executeGatewayAgentSpy.mockRestore();
    });
  });

  describe('submitToolInteraction', () => {
    it('should create a user message and resume runtime from that user message', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'global-agent';
      const topicId = 'global-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const response = {
        primaryUseCase: 'Writing documents',
        tone: 'Professional',
      };

      const toolMessage = createMockMessage({
        groupId: 'group-1',
        id: 'tool-msg-1',
        plugin: {
          apiName: 'askUserQuestion',
          arguments: '{}',
          identifier: 'lobe-user-interaction',
          type: 'default',
        },
        role: 'tool',
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: {
            [chatKey]: [toolMessage],
          },
          messagesMap: {
            [chatKey]: [toolMessage],
          },
        });
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);

      const userMessageId = 'submitted-user-msg';
      const optimisticCreateMessageSpy = vi
        .spyOn(result.current, 'optimisticCreateMessage')
        .mockImplementation(async (message) => {
          const userMessage = createMockMessage({
            content: message.content,
            groupId: message.groupId,
            id: userMessageId,
            role: 'user',
            topicId,
          });

          useChatStore.setState({
            dbMessagesMap: {
              [chatKey]: [toolMessage, userMessage],
            },
            messagesMap: {
              [chatKey]: [toolMessage, userMessage],
            },
          });

          return { id: userMessageId, messages: [toolMessage, userMessage] };
        });

      const initialContext = { phase: 'init' } as any;
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          agentConfig: createMockResolvedAgentConfig(),
          context: initialContext,
          state: {} as any,
        });
      const internal_execAgentRuntimeSpy = vi
        .spyOn(result.current, 'internal_execAgentRuntime')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.submitToolInteraction('tool-msg-1', response);
      });

      expect(optimisticCreateMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Writing documents, Professional',
          groupId: 'group-1',
          role: 'user',
        }),
        expect.objectContaining({ operationId: expect.any(String) }),
      );

      expect(internal_createAgentStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ id: 'tool-msg-1', role: 'tool' }),
            expect.objectContaining({ id: userMessageId, role: 'user' }),
          ]),
          parentMessageId: userMessageId,
        }),
      );

      expect(internal_execAgentRuntimeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext,
          parentMessageId: userMessageId,
          parentMessageType: 'user',
        }),
      );
    });
  });

  describe('skipToolInteraction', () => {
    it('should create a user message and resume runtime from that user message', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'global-agent';
      const topicId = 'global-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const reason = 'Need to decide later';

      const toolMessage = createMockMessage({
        groupId: 'group-1',
        id: 'tool-msg-1',
        plugin: {
          apiName: 'askUserQuestion',
          arguments: '{}',
          identifier: 'lobe-user-interaction',
          type: 'default',
        },
        role: 'tool',
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: {
            [chatKey]: [toolMessage],
          },
          messagesMap: {
            [chatKey]: [toolMessage],
          },
        });
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);

      const userMessageId = 'skipped-user-msg';
      const optimisticCreateMessageSpy = vi
        .spyOn(result.current, 'optimisticCreateMessage')
        .mockImplementation(async (message) => {
          const userMessage = createMockMessage({
            content: message.content,
            groupId: message.groupId,
            id: userMessageId,
            role: 'user',
            topicId,
          });

          useChatStore.setState({
            dbMessagesMap: {
              [chatKey]: [toolMessage, userMessage],
            },
            messagesMap: {
              [chatKey]: [toolMessage, userMessage],
            },
          });

          return { id: userMessageId, messages: [toolMessage, userMessage] };
        });

      const initialContext = { phase: 'init' } as any;
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          agentConfig: createMockResolvedAgentConfig(),
          context: initialContext,
          state: {} as any,
        });
      const internal_execAgentRuntimeSpy = vi
        .spyOn(result.current, 'internal_execAgentRuntime')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.skipToolInteraction('tool-msg-1', reason);
      });

      expect(optimisticCreateMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: `I'll skip this. ${reason}`,
          groupId: 'group-1',
          role: 'user',
        }),
        expect.objectContaining({ operationId: expect.any(String) }),
      );

      expect(internal_createAgentStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ id: 'tool-msg-1', role: 'tool' }),
            expect.objectContaining({ id: userMessageId, role: 'user' }),
          ]),
          parentMessageId: userMessageId,
        }),
      );

      expect(internal_execAgentRuntimeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext,
          parentMessageId: userMessageId,
          parentMessageType: 'user',
        }),
      );
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
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
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
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
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
