import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { agentRuntimeClient } from '@/services/agentRuntime';
import { useChatStore } from '@/store/chat/store';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional');

// Mock lambdaClient
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    aiAgent: {
      execGroupAgent: {
        mutate: vi.fn(),
      },
    },
    session: {
      updateSession: {
        mutate: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}));

// Mock agentRuntimeClient
vi.mock('@/services/agentRuntime', () => ({
  agentRuntimeClient: {
    createStreamConnection: vi.fn(),
  },
  StreamEvent: {},
}));

// Test Constants
const TEST_IDS = {
  AGENT_ID: 'test-agent-id',
  ASSISTANT_MESSAGE_ID: 'test-assistant-message-id',
  GROUP_ID: 'test-group-id',
  OPERATION_ID: 'test-operation-id',
  TOPIC_ID: 'test-topic-id',
  USER_MESSAGE_ID: 'test-user-message-id',
} as const;

const TEST_CONTENT = {
  GROUP_MESSAGE: 'Hello group!',
  EMPTY: '',
} as const;

// Helper to reset test environment
const resetTestEnvironment = () => {
  vi.clearAllMocks();
  useChatStore.setState(
    {
      activeAgentId: TEST_IDS.AGENT_ID,
      activeGroupId: TEST_IDS.GROUP_ID,
      activeTopicId: undefined,
      messagesMap: {},
      dbMessagesMap: {},
      operations: {},
      messageOperationMap: {},
      isCreatingMessage: false,
    },
    false,
  );
};

// Helper to create test context
const createTestContext = (overrides: any = {}) => ({
  agentId: TEST_IDS.AGENT_ID,
  groupId: TEST_IDS.GROUP_ID,
  topicId: null as string | null,
  threadId: null as string | null,
  ...overrides,
});

// Helper to create mock response from execGroupAgent
const createMockExecGroupAgentResponse = (overrides: any = {}) => ({
  assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
  operationId: TEST_IDS.OPERATION_ID,
  topicId: TEST_IDS.TOPIC_ID,
  userMessageId: TEST_IDS.USER_MESSAGE_ID,
  isCreateNewTopic: false,
  messages: [
    {
      id: TEST_IDS.USER_MESSAGE_ID,
      role: 'user' as const,
      content: TEST_CONTENT.GROUP_MESSAGE,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: TEST_IDS.ASSISTANT_MESSAGE_ID,
      role: 'assistant' as const,
      content: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
  topics: {
    items: [],
    total: 0,
  },
  ...overrides,
});

describe('agentGroup actions', () => {
  beforeEach(() => {
    resetTestEnvironment();

    // Setup default mocks for store methods
    act(() => {
      useChatStore.setState({
        optimisticCreateTmpMessage: vi.fn(),
        internal_toggleMessageLoading: vi.fn(),
        internal_dispatchMessage: vi.fn(),
        internal_handleAgentStreamEvent: vi.fn(),
        internal_cleanupAgentOperation: vi.fn(),
        internal_handleAgentError: vi.fn(),
        internal_updateTopics: vi.fn(),
        replaceMessages: vi.fn(),
        startOperation: vi
          .fn()
          .mockReturnValueOnce({
            operationId: 'op-exec',
            abortController: new AbortController(),
          }) // execServerAgentRuntime (first)
          .mockReturnValueOnce({
            operationId: TEST_IDS.OPERATION_ID,
            abortController: new AbortController(),
          }), // groupAgentStream (second)
        completeOperation: vi.fn(),
        failOperation: vi.fn(),
        onOperationCancel: vi.fn(),
        switchTopic: vi.fn(),
        associateMessageWithOperation: vi.fn(),
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sendGroupMessage', () => {
    describe('validation', () => {
      it('should not send when message is empty and no files provided', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.EMPTY,
          });
        });

        expect(lambdaClient.aiAgent.execGroupAgent.mutate).not.toHaveBeenCalled();
      });

      it('should not send when message is whitespace only', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: '   ',
          });
        });

        expect(lambdaClient.aiAgent.execGroupAgent.mutate).not.toHaveBeenCalled();
      });

      it('should not send when message is empty with empty files array', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.EMPTY,
            files: [],
          });
        });

        expect(lambdaClient.aiAgent.execGroupAgent.mutate).not.toHaveBeenCalled();
      });

      it('should not send when agentId is missing', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext({ agentId: '' }),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        expect(lambdaClient.aiAgent.execGroupAgent.mutate).not.toHaveBeenCalled();
      });

      it('should not send when groupId is missing', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext({ groupId: '' }),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        expect(lambdaClient.aiAgent.execGroupAgent.mutate).not.toHaveBeenCalled();
      });
    });

    describe('optimistic update', () => {
      it('should create execServerAgentRuntime operation first for loading state', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
          createMockExecGroupAgentResponse(),
        );
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        const context = createTestContext();

        await act(async () => {
          await result.current.sendGroupMessage({
            context,
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        // First call should be execServerAgentRuntime (created BEFORE mutate call for loading state)
        expect(result.current.startOperation).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({
            type: 'execServerAgentRuntime',
            context: expect.objectContaining({
              agentId: TEST_IDS.AGENT_ID,
              groupId: TEST_IDS.GROUP_ID,
            }),
            label: 'Execute Server Agent',
          }),
        );
      });

      it('should create temp user and assistant messages without operationId (optimistic update)', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
          createMockExecGroupAgentResponse(),
        );
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        // Should create temp user message (no operationId for optimistic updates)
        expect(result.current.optimisticCreateTmpMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            content: TEST_CONTENT.GROUP_MESSAGE,
            role: 'user',
            groupId: TEST_IDS.GROUP_ID,
          }),
          expect.objectContaining({
            tempMessageId: expect.any(String),
          }),
        );

        // Should create temp assistant message (no operationId for optimistic updates)
        expect(result.current.optimisticCreateTmpMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            role: 'assistant',
            groupId: TEST_IDS.GROUP_ID,
          }),
          expect.objectContaining({
            tempMessageId: expect.any(String),
          }),
        );
      });

      it('should set isCreatingMessage state during operation', async () => {
        const { result } = renderHook(() => useChatStore());

        let capturedState: boolean | undefined;
        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockImplementation(async () => {
          // Capture state during the API call
          capturedState = useChatStore.getState().isCreatingMessage;
          return createMockExecGroupAgentResponse();
        });
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        expect(capturedState).toBe(true);
        // After completion, should be false
        expect(useChatStore.getState().isCreatingMessage).toBe(false);
      });
    });

    describe('backend integration', () => {
      it('should call execGroupAgent with correct parameters', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
          createMockExecGroupAgentResponse(),
        );
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        const context = createTestContext({ topicId: TEST_IDS.TOPIC_ID });

        await act(async () => {
          await result.current.sendGroupMessage({
            context,
            message: TEST_CONTENT.GROUP_MESSAGE,
            files: [{ id: 'file-1' } as any],
          });
        });

        expect(lambdaClient.aiAgent.execGroupAgent.mutate).toHaveBeenCalledWith(
          {
            agentId: TEST_IDS.AGENT_ID,
            groupId: TEST_IDS.GROUP_ID,
            message: TEST_CONTENT.GROUP_MESSAGE,
            topicId: TEST_IDS.TOPIC_ID,
            files: ['file-1'],
          },
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      });

      it('should replace messages with server response using correct context', async () => {
        const { result } = renderHook(() => useChatStore());

        const mockResponse = createMockExecGroupAgentResponse();
        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(mockResponse);
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        const context = createTestContext();

        await act(async () => {
          await result.current.sendGroupMessage({
            context,
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        expect(result.current.replaceMessages).toHaveBeenCalledWith(
          mockResponse.messages,
          expect.objectContaining({
            context: expect.objectContaining({
              agentId: TEST_IDS.AGENT_ID,
              groupId: TEST_IDS.GROUP_ID,
              topicId: TEST_IDS.TOPIC_ID,
            }),
          }),
        );
      });

      it('should create groupAgentStream child operation with backend operationId', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
          createMockExecGroupAgentResponse(),
        );
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        // Verify that startOperation was called twice:
        // 1. For execServerAgentRuntime operation (created BEFORE mutate for loading state)
        // 2. For groupAgentStream operation (child, with backend operationId)
        expect(result.current.startOperation).toHaveBeenCalledTimes(2);
        expect(result.current.startOperation).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            type: 'groupAgentStream',
            operationId: TEST_IDS.OPERATION_ID,
            parentOperationId: 'op-exec',
          }),
        );
      });

      it('should register cancel handler for SSE stream', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
          createMockExecGroupAgentResponse(),
        );
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        expect(result.current.onOperationCancel).toHaveBeenCalledWith(
          TEST_IDS.OPERATION_ID,
          expect.any(Function),
        );
      });

      it('should associate assistant message with both execServerAgentRuntime and groupAgentStream operations', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
          createMockExecGroupAgentResponse(),
        );
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        // Should associate assistant message with execServerAgentRuntime (for isGenerating detection)
        expect(result.current.associateMessageWithOperation).toHaveBeenCalledWith(
          TEST_IDS.ASSISTANT_MESSAGE_ID,
          'op-exec', // execServerAgentRuntime operationId
        );

        // Should also associate assistant message with groupAgentStream (for stream cancel handling)
        expect(result.current.associateMessageWithOperation).toHaveBeenCalledWith(
          TEST_IDS.ASSISTANT_MESSAGE_ID,
          TEST_IDS.OPERATION_ID, // groupAgentStream operationId
        );

        // Total 2 calls for the assistant message
        expect(result.current.associateMessageWithOperation).toHaveBeenCalledTimes(2);
      });

      it('should create stream connection with operationId', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
          createMockExecGroupAgentResponse(),
        );
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        expect(agentRuntimeClient.createStreamConnection).toHaveBeenCalledWith(
          TEST_IDS.OPERATION_ID,
          expect.objectContaining({
            includeHistory: false,
            onConnect: expect.any(Function),
            onDisconnect: expect.any(Function),
            onError: expect.any(Function),
            onEvent: expect.any(Function),
          }),
        );
      });

      it('should complete operations on stream disconnect', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
          createMockExecGroupAgentResponse(),
        );

        let onDisconnectCallback: (() => void) | undefined;
        vi.mocked(agentRuntimeClient.createStreamConnection).mockImplementation(
          (_operationId, options) => {
            onDisconnectCallback = options?.onDisconnect;
            return {} as any;
          },
        );

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        // Simulate stream disconnect
        await act(async () => {
          onDisconnectCallback?.();
        });

        // Should complete both the stream operation and the main execServerAgentRuntime operation
        expect(result.current.completeOperation).toHaveBeenCalledWith(TEST_IDS.OPERATION_ID);
        expect(result.current.completeOperation).toHaveBeenCalledWith('op-exec');
      });

      it('should update topics when new topic is created', async () => {
        const { result } = renderHook(() => useChatStore());

        const mockTopics = {
          items: [{ id: 'topic-1', title: 'New Topic' }],
          total: 1,
        };
        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
          createMockExecGroupAgentResponse({
            isCreateNewTopic: true,
            topics: mockTopics,
          }),
        );
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        expect(result.current.internal_updateTopics).toHaveBeenCalledWith(
          TEST_IDS.AGENT_ID,
          expect.objectContaining({
            groupId: TEST_IDS.GROUP_ID,
            items: mockTopics.items,
            total: mockTopics.total,
          }),
        );
      });

      it('should switch to new topic when isCreateNewTopic is true', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
          createMockExecGroupAgentResponse({
            isCreateNewTopic: true,
            topics: { items: [], total: 1 },
          }),
        );
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        expect(result.current.switchTopic).toHaveBeenCalledWith(TEST_IDS.TOPIC_ID, {
          clearNewKey: true,
          skipRefreshMessage: true,
        });
      });

      it('should not switch topic when using existing topic', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
          createMockExecGroupAgentResponse({
            isCreateNewTopic: false,
          }),
        );
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext({ topicId: 'existing-topic-id' }),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        expect(result.current.switchTopic).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should remove temp messages on backend error with correct context', async () => {
        const { result } = renderHook(() => useChatStore());

        const testError = new Error('Backend error');
        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockRejectedValue(testError);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        // Should delete both temp user and assistant messages with operationId for correct context
        // execServerAgentRuntime is now created BEFORE mutate, so use its operationId
        expect(result.current.internal_dispatchMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'deleteMessages',
            ids: expect.arrayContaining([
              expect.stringContaining('tmp_'),
              expect.stringContaining('tmp_'),
            ]),
          }),
          expect.objectContaining({
            operationId: 'op-exec', // execServerAgentRuntime operation's ID
          }),
        );
        // Verify exactly 2 messages are deleted
        const deleteCall = vi
          .mocked(result.current.internal_dispatchMessage)
          .mock.calls.find((call) => call[0].type === 'deleteMessages');
        expect((deleteCall?.[0] as { ids: string[] })?.ids).toHaveLength(2);
      });

      it('should fail operation with error details', async () => {
        const { result } = renderHook(() => useChatStore());

        const testError = new Error('Backend error');
        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockRejectedValue(testError);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        // Fails the execServerAgentRuntime operation (created BEFORE mutate)
        expect(result.current.failOperation).toHaveBeenCalledWith('op-exec', {
          type: 'SendGroupMessageError',
          message: 'Backend error',
        });
      });

      it('should reset isCreatingMessage state on error', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockRejectedValue(
          new Error('Backend error'),
        );

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        expect(useChatStore.getState().isCreatingMessage).toBe(false);
      });

      it('should toggle loading state off on error', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockRejectedValue(
          new Error('Backend error'),
        );

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        // Should toggle loading off in finally block
        expect(result.current.internal_toggleMessageLoading).toHaveBeenLastCalledWith(
          false,
          expect.any(String),
        );
      });

      it('should handle abort error without calling failOperation', async () => {
        const { result } = renderHook(() => useChatStore());

        // Create an AbortError
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockRejectedValue(abortError);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
          });
        });

        // Should NOT call failOperation for abort errors (status already updated by cancelOperation)
        expect(result.current.failOperation).not.toHaveBeenCalled();

        // Should still clean up temp messages
        expect(result.current.internal_dispatchMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'deleteMessages',
          }),
          expect.any(Object),
        );
      });
    });

    describe('with files', () => {
      it('should send message with files when message is empty but files provided', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
          createMockExecGroupAgentResponse(),
        );
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.EMPTY,
            files: [{ id: 'file-1' } as any, { id: 'file-2' } as any],
          });
        });

        expect(lambdaClient.aiAgent.execGroupAgent.mutate).toHaveBeenCalledWith(
          expect.objectContaining({
            files: ['file-1', 'file-2'],
          }),
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
      });

      it('should include file ids in temp user message', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.mocked(lambdaClient.aiAgent.execGroupAgent.mutate).mockResolvedValue(
          createMockExecGroupAgentResponse(),
        );
        vi.mocked(agentRuntimeClient.createStreamConnection).mockReturnValue({} as any);

        await act(async () => {
          await result.current.sendGroupMessage({
            context: createTestContext(),
            message: TEST_CONTENT.GROUP_MESSAGE,
            files: [{ id: 'file-1' } as any],
          });
        });

        expect(result.current.optimisticCreateTmpMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            role: 'user',
            files: ['file-1'],
          }),
          expect.any(Object),
        );
      });
    });
  });
});
