import { type ConversationContext, RequestTrigger } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { t } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';
import { messageService } from '@/services/message';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { createMockMessage, createMockResolvedAgentConfig, TEST_IDS } from './fixtures';
import { resetTestEnvironment } from './helpers';

// Mock the tRPC client & agentRuntimeService so the import chain doesn't pull
// server-only code (cloud business packages, redis envs) into the test env.
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: {
      processHumanIntervention: { mutate: vi.fn().mockResolvedValue({ success: true }) },
      resolveAgentInterventionBySource: {
        mutate: vi.fn().mockResolvedValue({
          contractVersion: 2,
          status: 'unavailable',
          success: false,
        }),
      },
      submitHeteroIntervention: { mutate: vi.fn().mockResolvedValue({ success: true }) },
    },
  },
}));

vi.mock('@/services/agentRuntime', () => ({
  agentRuntimeService: {
    handleHumanIntervention: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/utils/localStorage', () => {
  class AsyncLocalStorage<State> {
    getFromLocalStorageSync(): State {
      return {} as State;
    }

    async getFromLocalStorage(): Promise<State> {
      return {} as State;
    }

    async saveToLocalStorage(): Promise<void> {
      return undefined;
    }
  }

  return { AsyncLocalStorage };
});

beforeEach(() => {
  resetTestEnvironment();
  vi.mocked(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate)
    .mockReset()
    .mockResolvedValue({
      contractVersion: 2,
      status: 'unavailable',
      success: false,
    });
  useChatStore.setState({
    updateTopicStatus: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const captureActError = async (action: () => Promise<void>): Promise<unknown> => {
  let captured: unknown;
  await act(async () => {
    try {
      await action();
    } catch (error) {
      captured = error;
    }
  });
  return captured;
};

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

    it('should cancel and restore a creating thread without touching the active main conversation', () => {
      const { result } = renderHook(() => useChatStore());
      const mainEditor = { setJSONState: vi.fn() };
      const threadEditor = { setJSONState: vi.fn() };
      const threadEditorState = { content: 'thread draft' };
      const agentId = TEST_IDS.SESSION_ID;
      const topicId = TEST_IDS.TOPIC_ID;

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          mainInputEditor: mainEditor as any,
        });
      });

      let mainOperationId: string;
      let threadOperationId: string;
      act(() => {
        mainOperationId = result.current.startOperation({
          context: { agentId, scope: 'main', topicId },
          type: 'sendMessage',
        }).operationId;
        threadOperationId = result.current.startOperation({
          context: { agentId, isNew: true, scope: 'thread', threadId: null, topicId },
          metadata: { inputEditorTempState: threadEditorState },
          type: 'sendMessage',
        }).operationId;
      });

      act(() => {
        result.current.cancelSendMessageInServer(
          { agentId, isNew: true, scope: 'thread', threadId: null, topicId },
          threadEditor as any,
        );
      });

      expect(result.current.operations[threadOperationId!].status).toBe('cancelled');
      expect(result.current.operations[mainOperationId!].status).toBe('running');
      expect(threadEditor.setJSONState).toHaveBeenCalledWith(threadEditorState);
      expect(mainEditor.setJSONState).not.toHaveBeenCalled();
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
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      const updateTopicStatusSpy = vi
        .spyOn(result.current, 'updateTopicStatus')
        .mockResolvedValue(undefined as any);
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          state: {} as any,
          context: { phase: 'init' } as any,
          agentConfig: createMockResolvedAgentConfig(),
        });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
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

      // Verify executeClientAgent was called with builder context (now wrapped in context object)
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            agentId: builderAgentId,
            topicId: builderTopicId,
            scope: 'agent_builder',
          }),
        }),
      );
      expect(updateTopicStatusSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: builderAgentId,
          status: 'active',
          topicId: builderTopicId,
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
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
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

      // Verify executeClientAgent was called with global context (now wrapped in context object)
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
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

      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.approveToolCalling('non-existent-msg', 'group-1');
      });

      // Should not call executeClientAgent when tool message not found
      expect(executeClientAgentSpy).not.toHaveBeenCalled();
    });

    it('completes the approval even if a Stop lands mid optimistic write (best-effort Stop)', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'global-agent';
      const topicId = 'global-topic';

      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        plugin: { identifier: 'test-plugin', type: 'default', arguments: '{}', apiName: 'test' },
      });

      const globalKey = messageMapKey({ agentId, topicId });

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: { [globalKey]: [toolMessage] },
          messagesMap: { [globalKey]: [toolMessage] },
        });
      });

      // Simulate a Stop pressed while the optimistic update is in flight: cancel
      // the just-created interim op from inside the awaited optimistic write.
      // `intervention: approved` is already persisted, so bailing here would
      // leave the tool approved-but-never-executed (stuck). The approval must
      // complete atomically — Stop is best-effort in this sub-second window.
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockImplementation(
        async (_id, _value, ctx) => {
          if (ctx?.operationId) result.current.cancelOperation(ctx.operationId);
        },
      );
      // Stub the runtime setup so the assertion targets "did we reach the run?",
      // not the full agent-config resolution.
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        state: {},
        context: {},
      } as any);
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.approveToolCalling('tool-msg-1', 'group-1');
      });

      // The run proceeds despite the cancelled op — no stuck approval.
      expect(executeClientAgentSpy).toHaveBeenCalled();
    });

    describe('server-mode branch', () => {
      it('should start a new Gateway op with resumeApproval.decision=approved and NOT run local runtime', async () => {
        const { result } = renderHook(() => useChatStore());

        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });

        const onboardingUserMessage = createMockMessage({
          id: 'onboarding-user-msg',
          metadata: { trigger: RequestTrigger.Onboarding },
          role: 'user',
        });
        const onboardingAssistantMessage = createMockMessage({
          id: 'onboarding-assistant-msg',
          parentId: onboardingUserMessage.id,
          role: 'assistant',
        });
        const toolMessage = createMockMessage({
          id: 'tool-msg-1',
          parentId: onboardingAssistantMessage.id,
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
            dbMessagesMap: {
              [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
            },
            messagesMap: {
              [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
            },
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
        const executeClientAgentSpy = vi
          .spyOn(result.current, 'executeClientAgent')
          .mockResolvedValue(undefined);
        const updateTopicStatusMock = vi.mocked(result.current.updateTopicStatus);
        updateTopicStatusMock.mockClear();

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
            metadata: { trigger: RequestTrigger.Onboarding },
          }),
        );
        expect(executeClientAgentSpy).not.toHaveBeenCalled();
        expect(updateTopicStatusMock).toHaveBeenCalledWith(
          expect.objectContaining({ agentId, status: 'active', topicId }),
        );

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

      it('uses the generic source claim for a durable edited approval and adopts its precreated op', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });
        const toolMessage = createMockMessage({
          id: 'tool-msg-durable',
          plugin: {
            apiName: 'editFile',
            arguments: '{"path":"/tmp/a"}',
            identifier: 'lobe-local-system',
            type: 'default',
          },
          pluginIntervention: {
            batchId: 'batch-durable',
            operationId: 'operation-durable',
            status: 'pending',
          },
          role: 'tool',
          tool_call_id: 'call-durable',
        } as any);
        const precreatedResult = {
          autoStarted: true,
          messageId: 'assistant-resumed',
          operationId: 'operation-resumed',
          success: true,
        } as any;

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });
        });
        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);
        vi.mocked(
          lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate,
        ).mockResolvedValueOnce({
          contractVersion: 2,
          execution: precreatedResult,
          state: 'claimed',
          status: 'approved',
          success: true,
        });

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-durable', '', undefined, {
            editedArguments: { path: '/tmp/b' },
          });
        });

        expect(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate).toHaveBeenCalledWith({
          action: {
            edits: { 'tool-msg-durable': { path: '/tmp/b' } },
            scope: 'once',
            type: 'approve_tool',
          },
          batchId: 'batch-durable',
          operationId: 'operation-durable',
          resolutionRequestId: expect.any(String),
          targets: [{ toolCallId: 'call-durable', toolMessageId: 'tool-msg-durable' }],
        });
        expect(result.current.dbMessagesMap[chatKey][0].plugin?.arguments).toBe(
          '{"path":"/tmp/a"}',
        );
        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            parentMessageId: 'tool-msg-durable',
            precreatedResult,
          }),
        );
        expect(executeGatewayAgentSpy.mock.calls[0]?.[0]).not.toHaveProperty('resumeApproval');
      });

      it('refreshes a durable approval that another surface already resolved', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });
        let pausedOperationId!: string;
        const toolMessage = createMockMessage({
          id: 'tool-msg-already-resolved-approval',
          plugin: {
            apiName: 'writeFile',
            arguments: '{}',
            identifier: 'fs',
            type: 'default',
          },
          pluginIntervention: {
            batchId: 'batch-already-resolved-approval',
            operationId: 'operation-already-resolved-approval',
            status: 'pending',
          },
          role: 'tool',
          tool_call_id: 'call-already-resolved-approval',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });
          pausedOperationId = result.current.startOperation({
            context: { agentId, topicId, threadId: null },
            type: 'execServerAgentRuntime',
          }).operationId;
        });
        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);
        const completeOperationSpy = vi.spyOn(result.current, 'completeOperation');
        const refreshSpy = vi.spyOn(result.current, 'refreshMessages').mockResolvedValue(undefined);
        const updateTopicStatusSpy = vi.mocked(result.current.updateTopicStatus);
        updateTopicStatusSpy.mockClear();
        vi.mocked(
          lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate,
        ).mockResolvedValueOnce({
          contractVersion: 2,
          state: 'already_resolved',
          status: 'resolved',
          success: true,
        });

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-already-resolved-approval', '');
        });

        expect(refreshSpy).toHaveBeenCalledWith({ agentId, topicId });
        expect(executeGatewayAgentSpy).not.toHaveBeenCalled();
        expect(updateTopicStatusSpy).not.toHaveBeenCalledWith(
          expect.objectContaining({ status: 'active' }),
        );
        expect(completeOperationSpy).not.toHaveBeenCalled();
        expect(result.current.operations[pausedOperationId].status).toBe('running');
        expect(
          Object.values(result.current.operations).find(
            (operation) => operation.type === 'approveToolCalling',
          ),
        ).toMatchObject({
          metadata: { cancelReason: 'Intervention already resolved' },
          status: 'cancelled',
        });
      });

      it('propagates a generic approval failure, keeps the card pending, and reuses its UUID', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });
        const toolMessage = createMockMessage({
          id: 'tool-msg-claim-failure',
          plugin: { apiName: 'writeFile', arguments: '{}', identifier: 'fs', type: 'default' },
          pluginIntervention: {
            batchId: 'batch-claim-failure',
            operationId: 'operation-claim-failure',
            status: 'pending',
          },
          role: 'tool',
          tool_call_id: 'call-claim-failure',
        } as any);
        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });
        });
        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        const mutation = vi.mocked(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate);
        mutation.mockRejectedValue(new Error('claim unavailable'));

        expect(
          await captureActError(() =>
            result.current.approveToolCalling('tool-msg-claim-failure', ''),
          ),
        ).toMatchObject({ message: 'claim unavailable' });
        expect(
          await captureActError(() =>
            result.current.approveToolCalling('tool-msg-claim-failure', ''),
          ),
        ).toMatchObject({ message: 'claim unavailable' });

        expect(result.current.dbMessagesMap[chatKey][0].pluginIntervention?.status).toBe('pending');
        expect(mutation.mock.calls[0]?.[0].resolutionRequestId).toBe(
          mutation.mock.calls[1]?.[0].resolutionRequestId,
        );
      });

      it('falls back to the legacy Gateway resume only when the durable source is absent', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });
        const toolMessage = createMockMessage({
          id: 'tool-msg-compat',
          plugin: { apiName: 'search', arguments: '{}', identifier: 'web-search', type: 'default' },
          pluginIntervention: {
            batchId: 'batch-compat',
            operationId: 'operation-compat',
            status: 'pending',
          },
          role: 'tool',
          tool_call_id: 'call-compat',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });
        });
        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-compat', '');
        });

        expect(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate).toHaveBeenCalledOnce();
        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            resumeApproval: {
              decision: 'approved',
              parentMessageId: 'tool-msg-compat',
              toolCallId: 'call-compat',
            },
          }),
        );
      });

      it('retains a source idempotency UUID across transport retry and clears it after success', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });
        const toolMessage = createMockMessage({
          id: 'tool-msg-retry',
          pluginIntervention: {
            batchId: 'batch-retry',
            operationId: 'operation-retry',
            status: 'pending',
          },
          role: 'tool',
          tool_call_id: 'call-retry',
        } as any);
        act(() => {
          useChatStore.setState({
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });
        });
        const mutation = vi.mocked(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate);
        mutation
          .mockRejectedValueOnce(new Error('transport failed'))
          .mockResolvedValueOnce({
            contractVersion: 2,
            state: 'claimed',
            status: 'approved',
            success: true,
          })
          .mockResolvedValueOnce({
            contractVersion: 2,
            state: 'claimed',
            status: 'approved',
            success: true,
          });
        const params = {
          action: { scope: 'once', type: 'approve_tool' } as const,
          toolMessageIds: ['tool-msg-retry'],
        };

        await expect(result.current.tryResolveAgentInterventionBySource(params)).rejects.toThrow(
          'transport failed',
        );
        await expect(result.current.tryResolveAgentInterventionBySource(params)).resolves.toEqual({
          execution: undefined,
          handled: true,
          state: 'claimed',
        });
        await result.current.tryResolveAgentInterventionBySource(params);

        const requestIds = mutation.mock.calls.map(([input]) => input.resolutionRequestId);
        expect(requestIds[0]).toBe(requestIds[1]);
        expect(requestIds[2]).not.toBe(requestIds[1]);
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
        const executeClientAgentSpy = vi
          .spyOn(result.current, 'executeClientAgent')
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
        expect(executeClientAgentSpy).not.toHaveBeenCalled();

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
        const updateTopicStatusMock = vi.mocked(result.current.updateTopicStatus);
        updateTopicStatusMock.mockClear();

        expect(
          await captureActError(() => result.current.approveToolCalling('tool-msg-1', 'group-1')),
        ).toMatchObject({ message: 'network error' });

        expect(executeGatewayAgentSpy).toHaveBeenCalled();

        // On failure, the paused server op must stay `running` — otherwise a
        // retry would see no running server op and fall through to the
        // non-Gateway path while the backend is still awaiting human input.
        const serverOps = Object.values(result.current.operations).filter(
          (op: any) => op.type === 'execServerAgentRuntime',
        );
        expect(serverOps).toHaveLength(1);
        expect(serverOps[0]!.status).toBe('running');
        expect(
          updateTopicStatusMock.mock.calls.some(([payload]) => payload.status === 'active'),
        ).toBe(false);

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
        const executeClientAgentSpy = vi
          .spyOn(result.current, 'executeClientAgent')
          .mockResolvedValue(undefined);

        await act(async () => {
          await result.current.approveToolCalling('tool-msg-1', 'group-1');
        });

        expect(executeGatewayAgentSpy).not.toHaveBeenCalled();
        expect(executeClientAgentSpy).toHaveBeenCalled();

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
        const executeClientAgentSpy = vi
          .spyOn(result.current, 'executeClientAgent')
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
        expect(executeClientAgentSpy).not.toHaveBeenCalled();

        executeGatewayAgentSpy.mockRestore();
      });
    });
  });

  describe('durable terminal source lifecycle', () => {
    const agentId = 'server-agent';
    const topicId = 'server-topic';
    const chatKey = messageMapKey({ agentId, topicId });

    const seedDurableTerminalCard = (result: {
      current: ReturnType<typeof useChatStore.getState>;
    }) => {
      const toolMessage = createMockMessage({
        id: 'tool-msg-terminal-source',
        pluginIntervention: {
          batchId: 'batch-terminal-source',
          operationId: 'operation-terminal-source',
          status: 'pending',
        },
        role: 'tool',
        tool_call_id: 'call-terminal-source',
      } as any);
      let pausedOperationId!: string;

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [toolMessage] },
          messagesMap: { [chatKey]: [toolMessage] },
        });
        pausedOperationId = result.current.startOperation({
          context: { agentId, topicId, threadId: null },
          type: 'execServerAgentRuntime',
        }).operationId;
      });

      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
      return pausedOperationId;
    };

    it('does not retire the paused operation when Stop loses the durable claim', async () => {
      const { result } = renderHook(() => useChatStore());
      const pausedOperationId = seedDurableTerminalCard(result);
      const completeOperationSpy = vi.spyOn(result.current, 'completeOperation');
      const executeGatewayAgentSpy = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);
      const refreshSpy = vi.spyOn(result.current, 'refreshMessages').mockResolvedValue(undefined);
      const updateTopicStatusSpy = vi.mocked(result.current.updateTopicStatus);
      updateTopicStatusSpy.mockClear();
      vi.mocked(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate).mockResolvedValueOnce(
        {
          contractVersion: 2,
          state: 'already_resolved',
          status: 'resolved',
          success: true,
        },
      );

      await act(async () => {
        await result.current.stopPendingApproval(['tool-msg-terminal-source']);
      });

      expect(refreshSpy).toHaveBeenCalledWith({ agentId, topicId });
      expect(completeOperationSpy).not.toHaveBeenCalled();
      expect(result.current.operations[pausedOperationId].status).toBe('running');
      expect(executeGatewayAgentSpy).not.toHaveBeenCalled();
      expect(updateTopicStatusSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' }),
      );
    });

    it('retires the paused operation only when Stop wins the durable claim', async () => {
      const { result } = renderHook(() => useChatStore());
      const pausedOperationId = seedDurableTerminalCard(result);
      const executeGatewayAgentSpy = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);
      const updateTopicStatusSpy = vi.mocked(result.current.updateTopicStatus);
      updateTopicStatusSpy.mockClear();
      vi.mocked(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate).mockResolvedValueOnce(
        {
          contractVersion: 2,
          state: 'claimed',
          status: 'stopped',
          success: true,
        },
      );

      await act(async () => {
        await result.current.stopPendingApproval(['tool-msg-terminal-source']);
      });

      expect(result.current.operations[pausedOperationId].status).toBe('completed');
      expect(executeGatewayAgentSpy).not.toHaveBeenCalled();
      expect(updateTopicStatusSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' }),
      );
    });

    it('completes only the local action when custom cancel wins the durable claim', async () => {
      const { result } = renderHook(() => useChatStore());
      const pausedOperationId = seedDurableTerminalCard(result);
      const legacyFallback = vi.fn().mockResolvedValue(undefined);
      const executeGatewayAgentSpy = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);
      const updateTopicStatusSpy = vi.mocked(result.current.updateTopicStatus);
      updateTopicStatusSpy.mockClear();
      vi.mocked(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate).mockResolvedValueOnce(
        {
          contractVersion: 2,
          state: 'claimed',
          status: 'cancelled',
          success: true,
        },
      );

      await act(async () => {
        await result.current.cancelToolInteraction('tool-msg-terminal-source', undefined, {
          onLegacyFallback: legacyFallback,
        });
      });

      expect(legacyFallback).not.toHaveBeenCalled();
      expect(executeGatewayAgentSpy).not.toHaveBeenCalled();
      expect(updateTopicStatusSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' }),
      );
      expect(result.current.operations[pausedOperationId].status).toBe('running');
      expect(
        Object.values(result.current.operations).find(
          (operation) => operation.type === 'cancelToolInteraction',
        )?.status,
      ).toBe('completed');
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
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
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
      expect(executeClientAgentSpy).not.toHaveBeenCalled();
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

      const onboardingUserMessage = createMockMessage({
        id: 'onboarding-user-msg',
        metadata: { trigger: RequestTrigger.Onboarding },
        role: 'user',
      });
      const onboardingAssistantMessage = createMockMessage({
        id: 'onboarding-assistant-msg',
        parentId: onboardingUserMessage.id,
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        groupId: 'group-1',
        id: 'tool-msg-1',
        parentId: onboardingAssistantMessage.id,
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
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
          },
          messagesMap: {
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
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
              [chatKey]: [
                onboardingUserMessage,
                onboardingAssistantMessage,
                toolMessage,
                userMessage,
              ],
            },
            messagesMap: {
              [chatKey]: [
                onboardingUserMessage,
                onboardingAssistantMessage,
                toolMessage,
                userMessage,
              ],
            },
          });

          return {
            id: userMessageId,
            messages: [onboardingUserMessage, onboardingAssistantMessage, toolMessage, userMessage],
          };
        });

      const initialContext = { phase: 'init' } as any;
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          agentConfig: createMockResolvedAgentConfig(),
          context: initialContext,
          state: {} as any,
        });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.submitToolInteraction('tool-msg-1', response);
      });

      expect(optimisticCreateMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Writing documents, Professional',
          groupId: 'group-1',
          metadata: { trigger: RequestTrigger.Onboarding },
          // Anchored on the assistant that asked, not left null — a null parent
          // would make this turn a second root of the topic (`segment-split`).
          parentId: onboardingAssistantMessage.id,
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

      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext,
          metadata: { trigger: RequestTrigger.Onboarding },
          parentMessageId: userMessageId,
          parentMessageType: 'user',
        }),
      );
    });

    it('should preserve request trigger metadata when resuming from tool result only', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'global-agent';
      const topicId = 'global-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const response = {
        templateId: 'onboarding-template',
      };

      const onboardingUserMessage = createMockMessage({
        id: 'onboarding-user-msg',
        metadata: { trigger: RequestTrigger.Onboarding },
        role: 'user',
      });
      const onboardingAssistantMessage = createMockMessage({
        id: 'onboarding-assistant-msg',
        parentId: onboardingUserMessage.id,
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        groupId: 'group-1',
        id: 'tool-msg-1',
        parentId: onboardingAssistantMessage.id,
        plugin: {
          apiName: 'selectAgentTemplate',
          arguments: '{}',
          identifier: 'lobe-agent-marketplace',
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
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
          },
          messagesMap: {
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
          },
        });
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticCreateMessage');

      const initialContext = { phase: 'init' } as any;
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: initialContext,
        state: {} as any,
      });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.submitToolInteraction('tool-msg-1', response, undefined, {
          createUserMessage: false,
          toolResultContent: 'Selected onboarding template',
        });
      });

      expect(result.current.optimisticCreateMessage).not.toHaveBeenCalled();
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext: expect.objectContaining({
            phase: 'tool_result',
          }),
          metadata: { trigger: RequestTrigger.Onboarding },
          parentMessageId: 'tool-msg-1',
          parentMessageType: 'tool',
        }),
      );
    });

    it('should not reuse onboarding trigger metadata from an older message outside the active tool chain', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'global-agent';
      const topicId = 'global-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const oldOnboardingMessage = createMockMessage({
        id: 'old-onboarding-user-msg',
        metadata: { trigger: RequestTrigger.Onboarding },
        role: 'user',
      });
      const normalUserMessage = createMockMessage({
        id: 'normal-user-msg',
        role: 'user',
      });
      const normalAssistantMessage = createMockMessage({
        id: 'normal-assistant-msg',
        parentId: normalUserMessage.id,
        role: 'assistant',
      });
      const normalToolMessage = createMockMessage({
        id: 'normal-tool-msg',
        parentId: normalAssistantMessage.id,
        plugin: {
          apiName: 'selectAgentTemplate',
          arguments: '{}',
          identifier: 'lobe-agent-marketplace',
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
            [chatKey]: [
              oldOnboardingMessage,
              normalUserMessage,
              normalAssistantMessage,
              normalToolMessage,
            ],
          },
          messagesMap: {
            [chatKey]: [
              oldOnboardingMessage,
              normalUserMessage,
              normalAssistantMessage,
              normalToolMessage,
            ],
          },
        });
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: { phase: 'init' } as any,
        state: {} as any,
      });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.submitToolInteraction(
          normalToolMessage.id,
          { templateId: 'normal-template' },
          undefined,
          {
            createUserMessage: false,
            toolResultContent: 'Selected normal template',
          },
        );
      });

      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: undefined,
          parentMessageId: normalToolMessage.id,
          parentMessageType: 'tool',
        }),
      );
    });

    describe('server-mode branch', () => {
      it('starts a new Gateway op with resumeToolResult carrying the answer and does NOT run local runtime', async () => {
        const { result } = renderHook(() => useChatStore());

        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });

        const userMessage = createMockMessage({
          id: 'user-msg',
          metadata: { trigger: RequestTrigger.Chat },
          role: 'user',
        });
        const assistantMessage = createMockMessage({
          id: 'assistant-msg',
          parentId: userMessage.id,
          role: 'assistant',
        });
        const toolMessage = createMockMessage({
          groupId: 'group-1',
          id: 'tool-msg-1',
          parentId: assistantMessage.id,
          plugin: {
            apiName: 'askUserQuestion',
            arguments: '{}',
            identifier: 'lobe-agent',
            type: 'default',
          },
          role: 'tool',
          // `tool_call_id` is what the server uses to locate the pending tool
          // call; the new Gateway op carries it forward via `resumeToolResult`.
          tool_call_id: 'call_ask',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            activeThreadId: undefined,
            dbMessagesMap: { [chatKey]: [userMessage, assistantMessage, toolMessage] },
            messagesMap: { [chatKey]: [userMessage, assistantMessage, toolMessage] },
          });

          // Presence of an `execServerAgentRuntime` op is one half of the
          // Gateway-resume signal; the other is `isGatewayModeEnabled`.
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
        const executeClientAgentSpy = vi
          .spyOn(result.current, 'executeClientAgent')
          .mockResolvedValue(undefined);

        await act(async () => {
          await result.current.submitToolInteraction('tool-msg-1', { answer: 'blue' }, undefined, {
            toolResultContent: 'My favorite color is blue',
          });
        });

        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            message: '',
            parentMessageId: 'tool-msg-1',
            resumeToolResult: {
              content: 'My favorite color is blue',
              outcome: 'submitted',
              parentMessageId: 'tool-msg-1',
              toolCallId: 'call_ask',
            },
          }),
        );
        expect(executeClientAgentSpy).not.toHaveBeenCalled();

        // Fallback guard: the paused `execServerAgentRuntime` op is completed.
        const pausedServerOps = Object.values(result.current.operations).filter(
          (op: any) => op.type === 'execServerAgentRuntime',
        );
        expect(pausedServerOps).toHaveLength(1);
        expect(pausedServerOps[0]!.status).toBe('completed');

        executeGatewayAgentSpy.mockRestore();
      });

      it('forwards pluginState into resumeToolResult when provided', async () => {
        const { result } = renderHook(() => useChatStore());

        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });

        const toolMessage = createMockMessage({
          id: 'tool-msg-1',
          plugin: {
            apiName: 'askUserQuestion',
            arguments: '{}',
            identifier: 'lobe-agent',
            type: 'default',
          },
          role: 'tool',
          tool_call_id: 'call_ask',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            activeThreadId: undefined,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });
        });

        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
        vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
        vi.spyOn(result.current, 'optimisticUpdatePluginState').mockResolvedValue(undefined);
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);

        await act(async () => {
          await result.current.submitToolInteraction('tool-msg-1', { answer: 'blue' }, undefined, {
            pluginState: { askUserAnswers: { q: 'blue' } },
            toolResultContent: 'blue',
          });
        });

        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            resumeToolResult: expect.objectContaining({
              pluginState: { askUserAnswers: { q: 'blue' } },
            }),
          }),
        );

        executeGatewayAgentSpy.mockRestore();
      });

      it('propagates a generic custom-submit failure without running side effects or settling the card', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = 'server-agent';
        const topicId = 'server-topic';
        const chatKey = messageMapKey({ agentId, topicId });
        const toolMessage = createMockMessage({
          id: 'tool-msg-custom-failure',
          plugin: {
            apiName: 'showAgentMarketplace',
            arguments: '{}',
            identifier: 'lobe-web-onboarding',
            type: 'default',
          },
          pluginIntervention: {
            batchId: 'batch-custom-failure',
            operationId: 'operation-custom-failure',
            status: 'pending',
          },
          role: 'tool',
          tool_call_id: 'call-custom-failure',
        } as any);
        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });
        });
        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
        const legacySideEffect = vi.fn().mockResolvedValue({
          response: { selectedTemplateIds: ['template-1'] },
        });
        const mutation = vi.mocked(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate);
        mutation.mockRejectedValue(new Error('custom claim unavailable'));
        const submit = () =>
          result.current.submitToolInteraction('tool-msg-custom-failure', {}, undefined, {
            agentInterventionAction: {
              result: {
                kind: 'agent_marketplace',
                selectedTemplateIds: ['template-1'],
              },
              type: 'submit_custom',
            },
            prepareLegacyFallback: legacySideEffect,
          });

        expect(await captureActError(submit)).toMatchObject({
          message: 'custom claim unavailable',
        });
        expect(await captureActError(submit)).toMatchObject({
          message: 'custom claim unavailable',
        });

        expect(legacySideEffect).not.toHaveBeenCalled();
        expect(result.current.dbMessagesMap[chatKey][0].pluginIntervention?.status).toBe('pending');
        expect(mutation.mock.calls[0]?.[0].resolutionRequestId).toBe(
          mutation.mock.calls[1]?.[0].resolutionRequestId,
        );
      });

      it('takes the client path (executeClientAgent) when gateway mode is disabled', async () => {
        const { result } = renderHook(() => useChatStore());

        const agentId = 'client-agent';
        const topicId = 'client-topic';
        const chatKey = messageMapKey({ agentId, topicId });

        const toolMessage = createMockMessage({
          groupId: 'group-1',
          id: 'tool-msg-1',
          plugin: {
            apiName: 'askUserQuestion',
            arguments: '{}',
            identifier: 'lobe-agent',
            type: 'default',
          },
          role: 'tool',
          tool_call_id: 'call_ask',
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            activeThreadId: undefined,
            dbMessagesMap: { [chatKey]: [toolMessage] },
            messagesMap: { [chatKey]: [toolMessage] },
          });
        });

        vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(false);
        vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
        vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
        vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
          agentConfig: createMockResolvedAgentConfig(),
          context: { phase: 'init' } as any,
          state: {} as any,
        });
        const executeGatewayAgentSpy = vi
          .spyOn(result.current, 'executeGatewayAgent')
          .mockResolvedValue({} as any);
        const executeClientAgentSpy = vi
          .spyOn(result.current, 'executeClientAgent')
          .mockResolvedValue(undefined);

        await act(async () => {
          await result.current.submitToolInteraction('tool-msg-1', { answer: 'blue' }, undefined, {
            createUserMessage: false,
            toolResultContent: 'blue',
          });
        });

        expect(executeGatewayAgentSpy).not.toHaveBeenCalled();
        expect(executeClientAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            initialContext: expect.objectContaining({ phase: 'tool_result' }),
            parentMessageId: 'tool-msg-1',
            parentMessageType: 'tool',
          }),
        );

        executeGatewayAgentSpy.mockRestore();
      });
    });

    it('should bail before running if a Stop cancels the interim op during synthetic message creation', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'global-agent';
      const topicId = 'global-topic';
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        plugin: { identifier: 'test-plugin', type: 'default', arguments: '{}', apiName: 'test' },
      });
      const globalKey = messageMapKey({ agentId, topicId });
      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: { [globalKey]: [toolMessage] },
          messagesMap: { [globalKey]: [toolMessage] },
        });
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      // Stop lands while the synthetic user message is being created — a later
      // await than the guard before it.
      vi.spyOn(result.current, 'optimisticCreateMessage').mockImplementation(async (_msg, ctx) => {
        if (ctx?.operationId) result.current.cancelOperation(ctx.operationId);
        return { id: 'submitted-user-msg', messages: [] } as any;
      });
      const internal_createAgentStateSpy = vi.spyOn(result.current, 'internal_createAgentState');
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.submitToolInteraction('tool-msg-1', { answer: 'blue' });
      });

      expect(internal_createAgentStateSpy).not.toHaveBeenCalled();
      expect(executeClientAgentSpy).not.toHaveBeenCalled();
    });
  });

  describe('skipToolInteraction', () => {
    it('should create a user message and resume runtime from that user message', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'global-agent';
      const topicId = 'global-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const reason = 'Need to decide later';

      const onboardingUserMessage = createMockMessage({
        id: 'onboarding-user-msg',
        metadata: { trigger: RequestTrigger.Onboarding },
        role: 'user',
      });
      const onboardingAssistantMessage = createMockMessage({
        id: 'onboarding-assistant-msg',
        parentId: onboardingUserMessage.id,
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        groupId: 'group-1',
        id: 'tool-msg-1',
        parentId: onboardingAssistantMessage.id,
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
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
          },
          messagesMap: {
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
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
              [chatKey]: [
                onboardingUserMessage,
                onboardingAssistantMessage,
                toolMessage,
                userMessage,
              ],
            },
            messagesMap: {
              [chatKey]: [
                onboardingUserMessage,
                onboardingAssistantMessage,
                toolMessage,
                userMessage,
              ],
            },
          });

          return {
            id: userMessageId,
            messages: [onboardingUserMessage, onboardingAssistantMessage, toolMessage, userMessage],
          };
        });

      const initialContext = { phase: 'init' } as any;
      const internal_createAgentStateSpy = vi
        .spyOn(result.current, 'internal_createAgentState')
        .mockReturnValue({
          agentConfig: createMockResolvedAgentConfig(),
          context: initialContext,
          state: {} as any,
        });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.skipToolInteraction('tool-msg-1', reason);
      });

      expect(optimisticCreateMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          content: t('tool.intervention.skipMessageWithReason', { ns: 'chat', reason }),
          groupId: 'group-1',
          metadata: { trigger: RequestTrigger.Onboarding },
          // Anchored on the assistant that asked, not left null — a null parent
          // would make this turn a second root of the topic (`segment-split`).
          parentId: onboardingAssistantMessage.id,
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

      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext,
          metadata: { trigger: RequestTrigger.Onboarding },
          parentMessageId: userMessageId,
          parentMessageType: 'user',
        }),
      );
    });

    it('should preserve request trigger from raw messages when display messages are incomplete', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'global-agent';
      const topicId = 'global-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const onboardingUserMessage = createMockMessage({
        id: 'onboarding-user-msg',
        metadata: { trigger: RequestTrigger.Onboarding },
        role: 'user',
      });
      const onboardingAssistantMessage = createMockMessage({
        id: 'onboarding-assistant-msg',
        parentId: onboardingUserMessage.id,
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        groupId: 'group-1',
        id: 'tool-msg-1',
        parentId: onboardingAssistantMessage.id,
        plugin: {
          apiName: 'showAgentMarketplace',
          arguments: '{}',
          identifier: 'lobe-web-onboarding',
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
            [chatKey]: [onboardingUserMessage, onboardingAssistantMessage, toolMessage],
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
            metadata: message.metadata,
            role: 'user',
            topicId,
          });

          useChatStore.setState({
            dbMessagesMap: {
              [chatKey]: [
                onboardingUserMessage,
                onboardingAssistantMessage,
                toolMessage,
                userMessage,
              ],
            },
            messagesMap: {
              [chatKey]: [toolMessage, userMessage],
            },
          });

          return {
            id: userMessageId,
            messages: [onboardingUserMessage, onboardingAssistantMessage, toolMessage, userMessage],
          };
        });

      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: { phase: 'init' } as any,
        state: {} as any,
      });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.skipToolInteraction('tool-msg-1');
      });

      expect(optimisticCreateMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { trigger: RequestTrigger.Onboarding },
        }),
        expect.objectContaining({ operationId: expect.any(String) }),
      );
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { trigger: RequestTrigger.Onboarding },
          parentMessageId: userMessageId,
          parentMessageType: 'user',
        }),
      );
    });

    it('should bail before running if a Stop cancels the interim op during synthetic message creation', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'global-agent';
      const topicId = 'global-topic';
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        role: 'tool',
        plugin: { identifier: 'test-plugin', type: 'default', arguments: '{}', apiName: 'test' },
      });
      const globalKey = messageMapKey({ agentId, topicId });
      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: { [globalKey]: [toolMessage] },
          messagesMap: { [globalKey]: [toolMessage] },
        });
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      // Stop lands while the synthetic user message is being created — a later
      // await than the guard before it.
      vi.spyOn(result.current, 'optimisticCreateMessage').mockImplementation(async (_msg, ctx) => {
        if (ctx?.operationId) result.current.cancelOperation(ctx.operationId);
        return { id: 'skipped-user-msg', messages: [] } as any;
      });
      const internal_createAgentStateSpy = vi.spyOn(result.current, 'internal_createAgentState');
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.skipToolInteraction('tool-msg-1', 'not needed');
      });

      expect(internal_createAgentStateSpy).not.toHaveBeenCalled();
      expect(executeClientAgentSpy).not.toHaveBeenCalled();
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
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
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

      // Verify executeClientAgent was called with builder context (now wrapped in context object)
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
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
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
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

      // Verify executeClientAgent was called with global context
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({
            agentId: globalAgentId,
            topicId: globalTopicId,
          }),
        }),
      );
    });
  });

  // ===========================================================================
  // CHARACTERIZATION TESTS (lifecycle refactor regression net)
  //
  // Lock the CURRENT behavior of these non-sendMessage entry points so an
  // upcoming lifecycle refactor cannot silently change them. They assert what
  // the code does NOW.
  // ===========================================================================
  describe('rejectAndContinueToolCalling client characterization (lifecycle refactor regression net)', () => {
    it('runs rejectToolCalling (one op completes) then starts a NEW op and executes client agent with phase=user_input', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'client-agent';
      const topicId = 'client-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        plugin: { apiName: 'test', arguments: '{}', identifier: 'test-plugin', type: 'default' },
        role: 'tool',
        tool_call_id: 'call_client',
      } as any);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: { [chatKey]: [toolMessage] },
          messagesMap: { [chatKey]: [toolMessage] },
        });
      });

      // Client-mode (no Gateway resume): let the real rejectToolCalling chain
      // run so we can observe the dual-op sequence. Only stub the persistence
      // primitives and the runtime executor.
      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(false);
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const rejectToolCallingSpy = vi.spyOn(result.current, 'rejectToolCalling');
      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: { phase: 'init' } as any,
        state: {} as any,
      });
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.rejectAndContinueToolCalling('tool-msg-1', 'not safe');
      });

      // 1) The halting reject runs first (it creates + completes its own op).
      expect(rejectToolCallingSpy).toHaveBeenCalledWith('tool-msg-1', 'not safe', undefined);

      // 2) Then a SECOND op is created and the client runtime continues with
      //    phase overridden to 'user_input', resuming from the tool message.
      expect(executeClientAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          initialContext: expect.objectContaining({ phase: 'user_input' }),
          parentMessageId: 'tool-msg-1',
          parentMessageType: 'tool',
        }),
      );

      // Two 'rejectToolCalling' ops exist (the halting reject's own op + the
      // continue op). Both reach 'completed' on the happy path.
      const rejectOps = Object.values(result.current.operations).filter(
        (op: any) => op.type === 'rejectToolCalling',
      );
      expect(rejectOps).toHaveLength(2);
      expect(rejectOps.every((op: any) => op.status === 'completed')).toBe(true);
    });
  });

  describe('submitHeteroIntervention characterization (lifecycle refactor regression net)', () => {
    it.each([
      {
        actionType: 'submit' as const,
        expectedAction: {
          result: { 'Which color?': 'Blue' },
          type: 'submit_answers' as const,
        },
        interactionKind: 'question',
        payload: { 'Which color?': 'Blue' },
      },
      {
        actionType: 'skip' as const,
        expectedAction: { type: 'skip_interaction' as const },
        interactionKind: 'question',
        payload: {},
      },
      {
        actionType: 'cancel' as const,
        expectedAction: { type: 'cancel_interaction' as const },
        interactionKind: 'question',
        payload: {},
      },
      {
        actionType: 'submit' as const,
        expectedAction: { optionId: 'allow_once', type: 'select_provider_option' as const },
        interactionKind: 'permission',
        payload: { permission: 'allow_once' },
      },
      {
        actionType: 'skip' as const,
        expectedAction: { type: 'skip_interaction' as const },
        interactionKind: 'permission',
        payload: {},
      },
      {
        actionType: 'cancel' as const,
        expectedAction: { type: 'cancel_interaction' as const },
        interactionKind: 'permission',
        payload: {},
      },
      {
        actionType: 'submit' as const,
        expectedAction: { optionId: 'approve_plan', type: 'select_provider_option' as const },
        interactionKind: 'plan',
        payload: { plan: 'approve_plan' },
      },
      {
        actionType: 'skip' as const,
        expectedAction: { type: 'skip_interaction' as const },
        interactionKind: 'plan',
        payload: {},
      },
      {
        actionType: 'cancel' as const,
        expectedAction: { type: 'cancel_interaction' as const },
        interactionKind: 'plan',
        payload: {},
      },
    ])(
      'resolves a cold-start $interactionKind $actionType through the durable source before consulting operation memory',
      async ({ actionType, expectedAction, interactionKind, payload }) => {
        const { result } = renderHook(() => useChatStore());
        const agentId = 'remote-agent';
        const topicId = 'remote-topic';
        const chatKey = messageMapKey({ agentId, topicId });
        const assistantMessage = createMockMessage({
          id: `assistant-msg-${interactionKind}-${actionType}`,
          role: 'assistant',
        });
        const toolMessage = createMockMessage({
          id: `tool-msg-${interactionKind}-${actionType}`,
          parentId: assistantMessage.id,
          pluginIntervention: {
            batchId: `batch-${interactionKind}`,
            operationId: `server-operation-${interactionKind}`,
            status: 'pending',
          },
          pluginState: { heterogeneousIntervention: { interactionKind } },
          role: 'tool',
          tool_call_id: `call-${interactionKind}`,
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [chatKey]: [assistantMessage, toolMessage] },
            messageOperationMap: {},
            messagesMap: { [chatKey]: [assistantMessage, toolMessage] },
            operations: {},
          });
        });

        const sourceMutation = vi.mocked(
          lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate,
        );
        sourceMutation.mockResolvedValueOnce({
          contractVersion: 2,
          state: 'claimed',
          status: 'approved',
          success: true,
        });
        const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');
        const interventionWriteSpy = vi.spyOn(messageService, 'updateMessagePlugin');
        const persistAnswersSpy = vi
          .spyOn(messageService, 'updateMessagePluginState')
          .mockResolvedValue({ messages: [], success: true });
        const legacyRemoteSubmit = vi.mocked(lambdaClient.aiAgent.submitHeteroIntervention.mutate);
        const localSubmit = vi
          .spyOn(heterogeneousAgentService, 'submitIntervention')
          .mockResolvedValue(undefined as any);

        await act(async () => {
          await result.current.submitHeteroIntervention(toolMessage.id, actionType, payload);
        });

        expect(sourceMutation).toHaveBeenCalledWith({
          action: expectedAction,
          batchId: `batch-${interactionKind}`,
          operationId: `server-operation-${interactionKind}`,
          resolutionRequestId: expect.any(String),
          targets: [{ toolCallId: `call-${interactionKind}`, toolMessageId: toolMessage.id }],
        });
        const resolvingIntervention = {
          ...toolMessage.pluginIntervention,
          resolving: true,
          status: 'pending',
        };
        expect(dispatchSpy).toHaveBeenCalledWith(
          {
            id: toolMessage.id,
            type: 'updateMessage',
            value: { pluginIntervention: resolvingIntervention },
          },
          { context: { agentId, topicId } },
        );
        expect(dispatchSpy).toHaveBeenCalledWith(
          {
            id: assistantMessage.id,
            tool_call_id: toolMessage.tool_call_id,
            type: 'updateMessageTools',
            value: { intervention: resolvingIntervention },
          },
          { context: { agentId, topicId } },
        );
        expect(interventionWriteSpy).not.toHaveBeenCalled();
        if (actionType === 'submit') {
          expect(persistAnswersSpy).toHaveBeenCalledWith(
            toolMessage.id,
            { askUserAnswers: payload },
            expect.objectContaining({ agentId, topicId }),
          );
        } else {
          expect(persistAnswersSpy).not.toHaveBeenCalled();
        }
        expect(legacyRemoteSubmit).not.toHaveBeenCalled();
        expect(localSubmit).not.toHaveBeenCalled();
      },
    );

    it('refreshes an already-resolved cold-start card without persisting a losing answer', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'remote-agent';
      const topicId = 'remote-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const toolMessage = createMockMessage({
        id: 'tool-msg-already-resolved',
        pluginIntervention: {
          batchId: 'batch-already-resolved',
          operationId: 'server-operation-already-resolved',
          status: 'pending',
        },
        pluginState: { heterogeneousIntervention: { interactionKind: 'question' } },
        role: 'tool',
        tool_call_id: 'call-already-resolved',
      } as any);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [toolMessage] },
          messageOperationMap: {},
          messagesMap: { [chatKey]: [toolMessage] },
          operations: {},
        });
      });

      vi.mocked(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate).mockResolvedValueOnce(
        {
          contractVersion: 2,
          state: 'already_resolved',
          status: 'resolved',
          success: true,
        },
      );
      const interventionWriteSpy = vi.spyOn(messageService, 'updateMessagePlugin');
      const persistAnswersSpy = vi
        .spyOn(messageService, 'updateMessagePluginState')
        .mockResolvedValue({ messages: [], success: true });
      const refreshSpy = vi.spyOn(result.current, 'refreshMessages').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.submitHeteroIntervention('tool-msg-already-resolved', 'submit', {
          Question: 'Losing answer',
        });
      });

      expect(refreshSpy).toHaveBeenCalledWith({ agentId, topicId });
      expect(interventionWriteSpy).not.toHaveBeenCalled();
      expect(persistAnswersSpy).not.toHaveBeenCalled();
    });

    it('fails closed after an unavailable durable source when operation memory is empty', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'remote-agent';
      const topicId = 'remote-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const toolMessage = createMockMessage({
        id: 'tool-msg-source-unavailable',
        pluginIntervention: {
          batchId: 'batch-source-unavailable',
          operationId: 'server-operation-source-unavailable',
          status: 'pending',
        },
        pluginState: { heterogeneousIntervention: { interactionKind: 'question' } },
        role: 'tool',
        tool_call_id: 'call-source-unavailable',
      } as any);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [toolMessage] },
          messageOperationMap: {},
          messagesMap: { [chatKey]: [toolMessage] },
          operations: {},
        });
      });

      const sourceMutation = vi.mocked(
        lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate,
      );
      const pluginSpy = vi
        .spyOn(result.current, 'optimisticUpdateMessagePlugin')
        .mockResolvedValue(undefined);
      const legacyRemoteSubmit = vi.mocked(lambdaClient.aiAgent.submitHeteroIntervention.mutate);
      const localSubmit = vi
        .spyOn(heterogeneousAgentService, 'submitIntervention')
        .mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.submitHeteroIntervention('tool-msg-source-unavailable', 'submit', {
          Question: 'Answer',
        });
      });

      expect(sourceMutation).toHaveBeenCalledOnce();
      expect(pluginSpy).not.toHaveBeenCalled();
      expect(legacyRemoteSubmit).not.toHaveBeenCalled();
      expect(localSubmit).not.toHaveBeenCalled();
    });

    it('uses the in-memory runtime identity only for the handled-false local desktop fallback', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'local-agent';
      const topicId = 'local-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const assistantMessage = createMockMessage({ id: 'assistant-msg-local', role: 'assistant' });
      const toolMessage = createMockMessage({
        id: 'tool-msg-local-fallback',
        parentId: assistantMessage.id,
        pluginIntervention: {
          batchId: 'batch-local-fallback',
          operationId: 'server-operation-local-fallback',
          status: 'pending',
        },
        pluginState: { heterogeneousIntervention: { interactionKind: 'question' } },
        role: 'tool',
        tool_call_id: 'call-local-fallback',
      } as any);
      const clientOperationId = 'client-local-operation';

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [assistantMessage, toolMessage] },
          messagesMap: { [chatKey]: [assistantMessage, toolMessage] },
        });
        result.current.startOperation({
          context: { agentId, threadId: null, topicId },
          operationId: clientOperationId,
          type: 'execHeterogeneousAgent',
        });
        useChatStore.setState({
          messageOperationMap: { [assistantMessage.id]: clientOperationId },
        });
      });

      const pluginSpy = vi
        .spyOn(result.current, 'optimisticUpdateMessagePlugin')
        .mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      vi.spyOn(messageService, 'updateMessagePluginState').mockResolvedValue({
        messages: [],
        success: true,
      });
      const localSubmit = vi
        .spyOn(heterogeneousAgentService, 'submitIntervention')
        .mockResolvedValue(undefined as any);
      const sourceMutation = vi.mocked(
        lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate,
      );

      await act(async () => {
        await result.current.submitHeteroIntervention('tool-msg-local-fallback', 'submit', {
          Question: 'Answer',
        });
      });

      expect(sourceMutation).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'server-operation-local-fallback' }),
      );
      expect(pluginSpy).toHaveBeenCalledWith(
        'tool-msg-local-fallback',
        { intervention: { status: 'approved' } },
        { operationId: clientOperationId },
      );
      expect(localSubmit).toHaveBeenCalledWith({
        operationId: clientOperationId,
        result: { Question: 'Answer' },
        toolCallId: 'call-local-fallback',
      });
    });

    it('uses the in-memory runtime identity only for the handled-false remote legacy fallback', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'remote-agent';
      const topicId = 'remote-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const assistantMessage = createMockMessage({ id: 'assistant-msg-remote', role: 'assistant' });
      const toolMessage = createMockMessage({
        id: 'tool-msg-remote-fallback',
        parentId: assistantMessage.id,
        pluginIntervention: {
          batchId: 'batch-remote-fallback',
          operationId: 'server-operation-remote-fallback',
          status: 'pending',
        },
        pluginState: { heterogeneousIntervention: { interactionKind: 'question' } },
        role: 'tool',
        tool_call_id: 'call-remote-fallback',
      } as any);
      const clientOperationId = 'client-remote-operation';

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [assistantMessage, toolMessage] },
          messagesMap: { [chatKey]: [assistantMessage, toolMessage] },
        });
        result.current.startOperation({
          context: { agentId, threadId: null, topicId },
          operationId: clientOperationId,
          type: 'execServerAgentRuntime',
        });
        useChatStore.setState({
          messageOperationMap: { [assistantMessage.id]: clientOperationId },
        });
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(messageService, 'updateMessagePluginState').mockResolvedValue({
        messages: [],
        success: true,
      });
      const sourceMutation = vi.mocked(
        lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate,
      );
      const legacyRemoteSubmit = vi.mocked(lambdaClient.aiAgent.submitHeteroIntervention.mutate);

      await act(async () => {
        await result.current.submitHeteroIntervention('tool-msg-remote-fallback', 'submit', {
          Question: 'Answer',
        });
      });

      expect(sourceMutation).toHaveBeenCalledWith(
        expect.objectContaining({ operationId: 'server-operation-remote-fallback' }),
      );
      expect(legacyRemoteSubmit).toHaveBeenCalledWith({
        operationId: clientOperationId,
        resolutionRequestId: expect.any(String),
        result: { Question: 'Answer' },
        toolCallId: 'call-remote-fallback',
      });
    });

    it('keeps a cold-start durable card unchanged when the source request fails', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'remote-agent';
      const topicId = 'remote-topic';
      const chatKey = messageMapKey({ agentId, topicId });
      const toolMessage = createMockMessage({
        content: 'Pending question',
        id: 'tool-msg-source-failure',
        pluginIntervention: {
          batchId: 'batch-source-failure',
          operationId: 'server-operation-source-failure',
          status: 'pending',
        },
        pluginState: { heterogeneousIntervention: { interactionKind: 'question' } },
        role: 'tool',
        tool_call_id: 'call-source-failure',
      } as any);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [toolMessage] },
          messageOperationMap: {},
          messagesMap: { [chatKey]: [toolMessage] },
          operations: {},
        });
      });

      const sourceError = new Error('source transport unavailable');
      vi.mocked(lambdaClient.aiAgent.resolveAgentInterventionBySource.mutate).mockRejectedValueOnce(
        sourceError,
      );
      const pluginSpy = vi
        .spyOn(result.current, 'optimisticUpdateMessagePlugin')
        .mockResolvedValue(undefined);
      const contentSpy = vi
        .spyOn(result.current, 'optimisticUpdateMessageContent')
        .mockResolvedValue(undefined);
      const legacyRemoteSubmit = vi.mocked(lambdaClient.aiAgent.submitHeteroIntervention.mutate);

      expect(
        await captureActError(() =>
          result.current.submitHeteroIntervention('tool-msg-source-failure', 'submit', {
            Question: 'Answer',
          }),
        ),
      ).toBe(sourceError);

      expect(pluginSpy).not.toHaveBeenCalled();
      expect(contentSpy).not.toHaveBeenCalled();
      expect(legacyRemoteSubmit).not.toHaveBeenCalled();
      expect(result.current.dbMessagesMap[chatKey][0]).toMatchObject({
        content: 'Pending question',
        pluginIntervention: { status: 'pending' },
      });
    });

    it('submits via IPC, persists optimistic intervention, and flips topic status to running (submit)', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'hetero-agent';
      const topicId = 'hetero-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const assistantMessage = createMockMessage({
        id: 'assistant-msg-1',
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        parentId: assistantMessage.id,
        plugin: {
          apiName: 'askUserQuestion',
          arguments: '{}',
          identifier: 'lobe-claude-code',
          type: 'default',
        },
        role: 'tool',
        tool_call_id: 'cc_call_1',
      } as any);

      let assistantOpId!: string;
      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: { [chatKey]: [assistantMessage, toolMessage] },
          messagesMap: { [chatKey]: [assistantMessage, toolMessage] },
        });

        // The running CC stream op is associated with the assistant that owns
        // the tool message; submitHeteroIntervention walks up to find it.
        assistantOpId = result.current.startOperation({
          context: { agentId, topicId, threadId: null },
          type: 'execHeterogeneousAgent',
        }).operationId;

        useChatStore.setState((s) => ({
          messageOperationMap: { ...s.messageOperationMap, [assistantMessage.id]: assistantOpId },
        }));
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const updateTopicStatusSpy = vi
        .spyOn(result.current, 'updateTopicStatus')
        .mockResolvedValue(undefined as any);
      const submitInterventionSpy = vi
        .spyOn(heterogeneousAgentService, 'submitIntervention')
        .mockResolvedValue(undefined as any);

      const payload = { 'Which color?': 'Blue' };
      await act(async () => {
        await result.current.submitHeteroIntervention('tool-msg-1', 'submit', payload);
      });

      // Optimistic approval runs against the resolved op (operationId carried).
      expect(result.current.optimisticUpdateMessagePlugin).toHaveBeenCalledWith(
        'tool-msg-1',
        { intervention: { status: 'approved' } },
        { operationId: assistantOpId },
      );

      // IPC submit forwards the resolved operationId + toolCallId + result.
      expect(submitInterventionSpy).toHaveBeenCalledWith({
        operationId: assistantOpId,
        result: payload,
        toolCallId: 'cc_call_1',
      });

      // Topic row flips back from waitingForHuman to running.
      expect(updateTopicStatusSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running', topicId }),
      );
    });

    it('resolves the local hetero execution op from a reasoning child before submitting via IPC', async () => {
      const { result } = renderHook(() => useChatStore());

      const agentId = 'hetero-agent';
      const topicId = 'hetero-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const assistantMessage = createMockMessage({
        id: 'assistant-msg-1',
        role: 'assistant',
      });
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        parentId: assistantMessage.id,
        plugin: {
          apiName: 'askUserQuestion',
          arguments: '{}',
          identifier: 'lobe-claude-code',
          type: 'default',
        },
        role: 'tool',
        tool_call_id: 'cc_call_1',
      } as any);

      let executionOpId!: string;
      let reasoningOpId!: string;
      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: { [chatKey]: [assistantMessage, toolMessage] },
          messagesMap: { [chatKey]: [assistantMessage, toolMessage] },
        });

        executionOpId = result.current.startOperation({
          context: { agentId, messageId: 'user-msg-1', threadId: null, topicId },
          type: 'execHeterogeneousAgent',
        }).operationId;

        reasoningOpId = result.current.startOperation({
          context: { messageId: assistantMessage.id },
          parentOperationId: executionOpId,
          type: 'reasoning',
        }).operationId;

        result.current.completeOperation(reasoningOpId);
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'updateTopicStatus').mockResolvedValue(undefined as any);
      const submitInterventionSpy = vi
        .spyOn(heterogeneousAgentService, 'submitIntervention')
        .mockResolvedValue(undefined as any);

      const payload = { 'Which color?': 'Blue' };
      await act(async () => {
        await result.current.submitHeteroIntervention('tool-msg-1', 'submit', payload);
      });

      expect(result.current.messageOperationMap[assistantMessage.id]).toBe(reasoningOpId);
      expect(result.current.optimisticUpdateMessagePlugin).toHaveBeenCalledWith(
        'tool-msg-1',
        { intervention: { status: 'approved' } },
        { operationId: executionOpId },
      );
      expect(submitInterventionSpy).toHaveBeenCalledWith({
        operationId: executionOpId,
        result: payload,
        toolCallId: 'cc_call_1',
      });
      expect(lambdaClient.aiAgent.submitHeteroIntervention.mutate).not.toHaveBeenCalled();
    });

    it("falls back to global-state optimistic context and routes a GC'd op to the remote tRPC transport", async () => {
      // When the resolved op has already been garbage-collected (not present in
      // `operations`), the optimistic context is the empty object `{}`
      // (global-state fallback) rather than carrying the stale operationId. With
      // no live op to prove local-desktop provenance, the answer routes to the
      // universal remote transport (tRPC) — the run has already ended, so this is
      // a harmless no-op either way — and the call does NOT throw.
      const { result } = renderHook(() => useChatStore());

      const agentId = 'hetero-agent';
      const topicId = 'hetero-topic';
      const chatKey = messageMapKey({ agentId, topicId });

      const assistantMessage = createMockMessage({ id: 'assistant-msg-1', role: 'assistant' });
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        parentId: assistantMessage.id,
        plugin: {
          apiName: 'askUserQuestion',
          arguments: '{}',
          identifier: 'lobe-claude-code',
          type: 'default',
        },
        role: 'tool',
        tool_call_id: 'cc_call_1',
      } as any);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          activeThreadId: undefined,
          dbMessagesMap: { [chatKey]: [assistantMessage, toolMessage] },
          messagesMap: { [chatKey]: [assistantMessage, toolMessage] },
          // Point the assistant at an opId that does NOT exist in `operations`
          // (simulating a garbage-collected / completed-and-pruned op).
          messageOperationMap: { [assistantMessage.id]: 'gc-op-id' },
          operations: {},
        });
      });

      const pluginSpy = vi
        .spyOn(result.current, 'optimisticUpdateMessagePlugin')
        .mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const updateTopicStatusSpy = vi
        .spyOn(result.current, 'updateTopicStatus')
        .mockResolvedValue(undefined as any);
      const submitInterventionSpy = vi
        .spyOn(heterogeneousAgentService, 'submitIntervention')
        .mockResolvedValue(undefined as any);
      const remoteSubmit = vi.mocked(lambdaClient.aiAgent.submitHeteroIntervention.mutate);
      remoteSubmit.mockClear();

      await act(async () => {
        await expect(
          result.current.submitHeteroIntervention('tool-msg-1', 'cancel'),
        ).resolves.toBeUndefined();
      });

      // Remote publish is only transport acceptance: keep the form pending,
      // mark it resolving, and use the empty global-state fallback context.
      expect(pluginSpy).toHaveBeenCalledWith(
        'tool-msg-1',
        { intervention: { resolving: true, status: 'pending' } },
        {},
      );
      expect(updateTopicStatusSpy).not.toHaveBeenCalled();

      // Remote tRPC submit fires with the (stale) resolved operationId + cancel;
      // the desktop IPC path is not taken for a GC'd (non-local) op.
      expect(lambdaClient.aiAgent.submitHeteroIntervention.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          cancelled: true,
          operationId: 'gc-op-id',
          toolCallId: 'cc_call_1',
        }),
      );
      expect(submitInterventionSpy).not.toHaveBeenCalled();

      const firstCancelRequestId = remoteSubmit.mock.calls[0][0].resolutionRequestId;
      await act(async () => {
        await result.current.submitHeteroIntervention('tool-msg-1', 'cancel');
      });
      expect(remoteSubmit.mock.calls[1][0].resolutionRequestId).toBe(firstCancelRequestId);

      await act(async () => {
        await result.current.submitHeteroIntervention('tool-msg-1', 'skip');
      });
      expect(remoteSubmit.mock.calls[2][0].resolutionRequestId).not.toBe(firstCancelRequestId);

      await act(async () => {
        await result.current.submitHeteroIntervention('tool-msg-1', 'submit', { b: 2, a: 1 });
        await result.current.submitHeteroIntervention('tool-msg-1', 'submit', { a: 1, b: 2 });
        await result.current.submitHeteroIntervention('tool-msg-1', 'submit', { a: 2, b: 2 });
      });
      const firstPayloadRequestId = remoteSubmit.mock.calls[3][0].resolutionRequestId;
      expect(remoteSubmit.mock.calls[4][0].resolutionRequestId).toBe(firstPayloadRequestId);
      expect(remoteSubmit.mock.calls[5][0].resolutionRequestId).not.toBe(firstPayloadRequestId);

      const publishError = new Error('publish failed');
      remoteSubmit.mockRejectedValueOnce(publishError);
      await act(async () => {
        await expect(result.current.submitHeteroIntervention('tool-msg-1', 'cancel')).rejects.toBe(
          publishError,
        );
      });
      expect(pluginSpy).toHaveBeenLastCalledWith(
        'tool-msg-1',
        { intervention: { status: 'pending' } },
        {},
      );
    });

    it('flips topic status on the passed context, NOT the active topic, when submitting from a background conversation', async () => {
      // Regression: submitting a hetero intervention from the global approval
      // card while the user is viewing a DIFFERENT topic must flip *that card's*
      // topic back to `running` — not whatever topic is currently active. Before
      // the fix the chat store fell back to `activeTopicId`, so the unrelated
      // topic the user was looking at flickered into a loading/running state.
      const { result } = renderHook(() => useChatStore());

      const agentId = 'hetero-agent';
      const cardTopicId = 'background-topic';
      const activeTopicId = 'the-topic-user-is-viewing';
      const chatKey = messageMapKey({ agentId, topicId: cardTopicId });

      const assistantMessage = createMockMessage({ id: 'assistant-msg-1', role: 'assistant' });
      const toolMessage = createMockMessage({
        id: 'tool-msg-1',
        parentId: assistantMessage.id,
        plugin: {
          apiName: 'askUserQuestion',
          arguments: '{}',
          identifier: 'lobe-claude-code',
          type: 'default',
        },
        role: 'tool',
        tool_call_id: 'cc_call_1',
      } as any);

      let assistantOpId!: string;
      act(() => {
        useChatStore.setState({
          // The user is parked on a completely different topic.
          activeAgentId: agentId,
          activeThreadId: undefined,
          activeTopicId,
          dbMessagesMap: { [chatKey]: [assistantMessage, toolMessage] },
          messagesMap: { [chatKey]: [assistantMessage, toolMessage] },
        });

        assistantOpId = result.current.startOperation({
          context: { agentId, topicId: cardTopicId, threadId: null },
          type: 'execHeterogeneousAgent',
        }).operationId;

        useChatStore.setState((s) => ({
          messageOperationMap: { ...s.messageOperationMap, [assistantMessage.id]: assistantOpId },
        }));
      });

      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
      vi.spyOn(result.current, 'optimisticUpdateMessageContent').mockResolvedValue(undefined);
      const updateTopicStatusSpy = vi
        .spyOn(result.current, 'updateTopicStatus')
        .mockResolvedValue(undefined as any);
      vi.spyOn(heterogeneousAgentService, 'submitIntervention').mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.submitHeteroIntervention(
          'tool-msg-1',
          'submit',
          { 'Which color?': 'Blue' },
          { agentId, threadId: undefined, topicId: cardTopicId },
        );
      });

      // The card's own topic flips to running...
      expect(updateTopicStatusSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running', topicId: cardTopicId }),
      );
      // ...and the topic the user is currently viewing is never touched.
      expect(updateTopicStatusSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ topicId: activeTopicId }),
      );
    });
  });
  describe('approveAllToolCalls', () => {
    const agentId = 'server-agent';
    const topicId = 'server-topic';
    const chatKey = messageMapKey({ agentId, topicId, threadId: undefined });

    const seedPendingBatch = (result: any) => {
      const assistantMessage = createMockMessage({ id: 'assistant-msg-1', role: 'assistant' });
      const toolMessages = ['a', 'b', 'c'].map((suffix, index) =>
        createMockMessage({
          id: `tool-msg-${suffix}`,
          parentId: assistantMessage.id,
          plugin: {
            apiName: 'calculate',
            arguments: `{"expression":"${index}"}`,
            identifier: 'lobe-calculator',
            type: 'default',
          },
          role: 'tool',
          tool_call_id: `call_${suffix}`,
        } as any),
      );

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeTopicId: topicId,
          dbMessagesMap: { [chatKey]: [assistantMessage, ...toolMessages] },
          messagesMap: { [chatKey]: [assistantMessage, ...toolMessages] },
        });
      });

      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(true);
      vi.spyOn(result.current, 'optimisticUpdateMessagePlugin').mockResolvedValue(undefined);
    };

    // The whole point of the batch path: ONE gateway op carrying every decision.
    // Looping single approvals starts one op per tool, and each continues the
    // LLM while its siblings are still empty pending rows.
    it('resolves the whole batch through a single gateway op', async () => {
      const { result } = renderHook(() => useChatStore());
      seedPendingBatch(result);

      const executeGatewayAgentSpy = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.approveAllToolCalls(['tool-msg-a', 'tool-msg-b', 'tool-msg-c']);
      });

      expect(executeGatewayAgentSpy).toHaveBeenCalledTimes(1);
      expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '',
          parentMessageId: 'tool-msg-c',
          resumeApprovals: [
            { decision: 'approved', parentMessageId: 'tool-msg-a', toolCallId: 'call_a' },
            { decision: 'approved', parentMessageId: 'tool-msg-b', toolCallId: 'call_b' },
            { decision: 'approved', parentMessageId: 'tool-msg-c', toolCallId: 'call_c' },
          ],
        }),
      );
      expect(executeClientAgentSpy).not.toHaveBeenCalled();

      executeGatewayAgentSpy.mockRestore();
    });

    it('does not forge approved cards before the server wins the batch claim', async () => {
      const { result } = renderHook(() => useChatStore());
      seedPendingBatch(result);

      const optimisticSpy = vi.mocked(result.current.optimisticUpdateMessagePlugin);
      optimisticSpy.mockClear();
      const executeGatewayAgentSpy = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);

      await act(async () => {
        await result.current.approveAllToolCalls(['tool-msg-a', 'tool-msg-b', 'tool-msg-c']);
      });

      expect(optimisticSpy).not.toHaveBeenCalled();

      executeGatewayAgentSpy.mockRestore();
    });

    // An optimistic row has no server identity yet, so the server can't address
    // it; sending it would fail the whole batch instead of just that card.
    it('drops rows the server cannot address', async () => {
      const { result } = renderHook(() => useChatStore());
      seedPendingBatch(result);

      const executeGatewayAgentSpy = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);

      await act(async () => {
        await result.current.approveAllToolCalls(['tool-msg-a', 'tmp_pending', 'tool-msg-c']);
      });

      expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeApprovals: [
            { decision: 'approved', parentMessageId: 'tool-msg-a', toolCallId: 'call_a' },
            { decision: 'approved', parentMessageId: 'tool-msg-c', toolCallId: 'call_c' },
          ],
        }),
      );

      executeGatewayAgentSpy.mockRestore();
    });

    // Client mode has no batch resume; its local runtime re-parks on the
    // remaining pending tools after each approval, so sequential is correct.
    it('falls back to sequential approvals in client mode', async () => {
      const { result } = renderHook(() => useChatStore());
      seedPendingBatch(result);
      vi.spyOn(result.current, 'isGatewayModeEnabled').mockReturnValue(false);

      vi.spyOn(result.current, 'internal_createAgentState').mockReturnValue({
        agentConfig: createMockResolvedAgentConfig(),
        context: { phase: 'init' } as any,
        state: {} as any,
      });
      const executeGatewayAgentSpy = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);
      const executeClientAgentSpy = vi
        .spyOn(result.current, 'executeClientAgent')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.approveAllToolCalls(['tool-msg-a', 'tool-msg-b']);
      });

      expect(executeGatewayAgentSpy).not.toHaveBeenCalled();
      // One local resume per tool, in order — the runtime re-parks on the
      // remaining pending tools between them.
      expect(executeClientAgentSpy).toHaveBeenCalledTimes(2);
      expect(
        executeClientAgentSpy.mock.calls.map((call) => (call[0] as any).parentMessageId),
      ).toEqual(['tool-msg-a', 'tool-msg-b']);

      executeClientAgentSpy.mockRestore();
      executeGatewayAgentSpy.mockRestore();
    });

    it('is a no-op for an empty batch', async () => {
      const { result } = renderHook(() => useChatStore());
      seedPendingBatch(result);

      const executeGatewayAgentSpy = vi
        .spyOn(result.current, 'executeGatewayAgent')
        .mockResolvedValue({} as any);

      await act(async () => {
        await result.current.approveAllToolCalls([]);
      });

      expect(executeGatewayAgentSpy).not.toHaveBeenCalled();

      executeGatewayAgentSpy.mockRestore();
    });
  });
});
