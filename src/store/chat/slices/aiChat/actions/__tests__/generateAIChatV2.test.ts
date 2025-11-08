import { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { DEFAULT_AGENT_CHAT_CONFIG, DEFAULT_MODEL, DEFAULT_PROVIDER } from '@/const/settings';
import { aiChatService } from '@/services/aiChat';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { agentChatConfigSelectors } from '@/store/agent/selectors';
import { UploadFileItem } from '@/types/files/upload';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { TEST_CONTENT, TEST_IDS, createMockStoreState } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional');

// Mock server mode for V2 tests
vi.mock('@/const/version', async (importOriginal) => {
  const module = await importOriginal();
  return {
    ...(module as any),
    isServerMode: true,
    isDesktop: false,
  };
});

// Mock aiChatService for V2 server flow
vi.mock('@/services/aiChat', () => ({
  aiChatService: {
    sendMessageInServer: vi.fn(async (params: any) => {
      const userId = TEST_IDS.USER_MESSAGE_ID;
      const assistantId = TEST_IDS.ASSISTANT_MESSAGE_ID;
      const topicId = params.topicId ?? TEST_IDS.TOPIC_ID;
      return {
        messages: [
          {
            id: userId,
            role: 'user',
            content: params.newUserMessage?.content ?? '',
            sessionId: params.sessionId ?? TEST_IDS.SESSION_ID,
            topicId,
          } as any,
          {
            id: assistantId,
            role: 'assistant',
            content: LOADING_FLAT,
            sessionId: params.sessionId ?? TEST_IDS.SESSION_ID,
            topicId,
          } as any,
        ],
        topics: [],
        topicId,
        userMessageId: userId,
        assistantMessageId: assistantId,
        isCreateNewTopic: !params.topicId,
      } as any;
    }),
  },
}));

const realExecAgentRuntime = useChatStore.getState().internal_execAgentRuntime;

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();

  // Setup default spies that most tests need
  spyOnMessageService();

  // Setup common mock methods that most V2 tests need
  act(() => {
    useChatStore.setState({
      activeId: TEST_IDS.SESSION_ID,
      activeTopicId: TEST_IDS.TOPIC_ID,
      mainSendMessageOperations: {},
      refreshMessages: vi.fn(),
      refreshTopic: vi.fn(),
      internal_execAgentRuntime: vi.fn(),
      saveToTopic: vi.fn(),
      switchTopic: vi.fn(),
    });
  });
});

afterEach(() => {
  process.env.NEXT_PUBLIC_BASE_PATH = undefined;
  vi.restoreAllMocks();
});

describe('generateAIChatV2 actions', () => {
  describe('sendMessageInServer', () => {
    describe('validation', () => {
      it('should not send when there is no active session', async () => {
        act(() => {
          useChatStore.setState({ activeId: undefined });
        });

        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(messageService.createMessage).not.toHaveBeenCalled();
        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });

      it('should not send when message is empty and no files are provided', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.EMPTY });
        });

        expect(messageService.createMessage).not.toHaveBeenCalled();
      });

      it('should not send when message is empty with empty files array', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.EMPTY, files: [] });
        });

        expect(messageService.createMessage).not.toHaveBeenCalled();
      });
    });

    describe('message creation', () => {
      it('should create user message and trigger AI processing', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(aiChatService.sendMessageInServer).toHaveBeenCalledWith(
          {
            newAssistantMessage: {
              model: DEFAULT_MODEL,
              provider: DEFAULT_PROVIDER,
            },
            newUserMessage: {
              content: TEST_CONTENT.USER_MESSAGE,
              files: undefined,
            },
            sessionId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
          expect.anything(),
        );
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });

      it('should skip creating new topic when auto-create topic is disabled', async () => {
        const { result } = renderHook(() => useChatStore());

        (agentChatConfigSelectors.currentChatConfig as Mock).mockReturnValue({
          ...DEFAULT_AGENT_CHAT_CONFIG,
          enableAutoCreateTopic: false,
        });

        await act(async () => {
          useChatStore.setState({
            ...createMockStoreState(),
            activeTopicId: undefined,
            messagesMap: {},
          });

          await result.current.sendMessage({ message: 'disable auto create' });
        });

        const callArgs = (aiChatService.sendMessageInServer as Mock).mock.calls[0][0];
        expect(callArgs.newTopic).toBeUndefined();
      });

      it('should include newTopic payload when auto-create topic is enabled and threshold is reached', async () => {
        const { result } = renderHook(() => useChatStore());

        (agentChatConfigSelectors.currentChatConfig as Mock).mockReturnValue({
          ...DEFAULT_AGENT_CHAT_CONFIG,
          enableAutoCreateTopic: true,
          autoCreateTopicThreshold: 1,
        });

        await act(async () => {
          useChatStore.setState({
            ...createMockStoreState(),
            activeTopicId: undefined,
            messagesMap: {},
          });

          await result.current.sendMessage({ message: 'auto create topic' });
        });

        const callArgs = (aiChatService.sendMessageInServer as Mock).mock.calls[0][0];
        expect(callArgs.newTopic).toMatchObject({
          topicMessageIds: [],
        });
      });

      it('should not create new topic when threshold is not reached', async () => {
        const { result } = renderHook(() => useChatStore());

        (agentChatConfigSelectors.currentChatConfig as Mock).mockReturnValue({
          ...DEFAULT_AGENT_CHAT_CONFIG,
          enableAutoCreateTopic: true,
          autoCreateTopicThreshold: 10,
        });

        await act(async () => {
          useChatStore.setState({
            ...createMockStoreState(),
            activeTopicId: undefined,
            messagesMap: {},
          });

          await result.current.sendMessage({ message: 'threshold not met' });
        });

        const callArgs = (aiChatService.sendMessageInServer as Mock).mock.calls[0][0];
        expect(callArgs.newTopic).toBeUndefined();
      });

      it('should send message with files attached', async () => {
        const { result } = renderHook(() => useChatStore());
        const files = [{ id: TEST_IDS.FILE_ID } as UploadFileItem];

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE, files });
        });

        expect(aiChatService.sendMessageInServer).toHaveBeenCalledWith(
          {
            newAssistantMessage: {
              model: DEFAULT_MODEL,
              provider: DEFAULT_PROVIDER,
            },
            newUserMessage: {
              content: TEST_CONTENT.USER_MESSAGE,
              files: [TEST_IDS.FILE_ID],
            },
            sessionId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
          expect.anything(),
        );
      });

      it('should send files without message content', async () => {
        const { result } = renderHook(() => useChatStore());
        const files = [{ id: TEST_IDS.FILE_ID } as UploadFileItem];

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.EMPTY, files });
        });

        expect(aiChatService.sendMessageInServer).toHaveBeenCalledWith(
          {
            newAssistantMessage: {
              model: DEFAULT_MODEL,
              provider: DEFAULT_PROVIDER,
            },
            newUserMessage: {
              content: TEST_CONTENT.EMPTY,
              files: [TEST_IDS.FILE_ID],
            },
            sessionId: TEST_IDS.SESSION_ID,
            topicId: TEST_IDS.TOPIC_ID,
          },
          expect.anything(),
        );
      });

      it('should not process AI when onlyAddUserMessage is true', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            onlyAddUserMessage: true,
          });
        });

        expect(messageService.createMessage).toHaveBeenCalled();
        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });

      it('should handle message creation errors gracefully', async () => {
        const { result } = renderHook(() => useChatStore());
        vi.spyOn(aiChatService, 'sendMessageInServer').mockRejectedValue(
          new Error('create message error'),
        );

        await act(async () => {
          try {
            await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
          } catch {
            // Expected to throw
          }
        });

        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });
    });

    describe('RAG integration', () => {
      it('should include RAG query when RAG is enabled', async () => {
        const { result } = renderHook(() => useChatStore());
        vi.spyOn(result.current, 'internal_shouldUseRAG').mockReturnValue(true);

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.RAG_QUERY });
        });

        expect(result.current.internal_execAgentRuntime).toHaveBeenCalledWith(
          expect.objectContaining({
            ragQuery: TEST_CONTENT.RAG_QUERY,
          }),
        );
      });

      it('should not use RAG when feature is disabled', async () => {
        const { result } = renderHook(() => useChatStore());
        vi.spyOn(result.current, 'internal_shouldUseRAG').mockReturnValue(false);
        const retrieveChunksSpy = vi.spyOn(result.current, 'internal_retrieveChunks');

        await act(async () => {
          await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
        });

        expect(retrieveChunksSpy).not.toHaveBeenCalled();
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalledWith(
          expect.objectContaining({
            ragQuery: undefined,
          }),
        );
      });
    });

    describe('special flags', () => {
      it('should pass isWelcomeQuestion flag to processing', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            isWelcomeQuestion: true,
          });
        });

        expect(result.current.internal_execAgentRuntime).toHaveBeenCalledWith(
          expect.objectContaining({
            isWelcomeQuestion: true,
          }),
        );
      });
    });
  });

  describe('internal_execAgentRuntime', () => {
    it('should handle the core AI message processing', async () => {
      act(() => {
        useChatStore.setState({ internal_execAgentRuntime: realExecAgentRuntime });
      });

      const { result } = renderHook(() => useChatStore());
      const userMessage = {
        id: TEST_IDS.USER_MESSAGE_ID,
        role: 'user',
        content: TEST_CONTENT.USER_MESSAGE,
        sessionId: TEST_IDS.SESSION_ID,
        topicId: TEST_IDS.TOPIC_ID,
      } as UIChatMessage;
      const messages = [userMessage];

      const streamSpy = vi.spyOn(chatService, 'createAssistantMessageStream');

      await act(async () => {
        await result.current.internal_execAgentRuntime({
          messages,
          userMessageId: userMessage.id,
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        });
      });

      expect(streamSpy).toHaveBeenCalled();
      expect(result.current.refreshMessages).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should set error message when sendMessageInServer throws a regular error', async () => {
      const { result } = renderHook(() => useChatStore());
      const errorMessage = 'Network error';
      const mockError = new TRPCClientError(errorMessage);
      (mockError as any).data = { code: 'BAD_REQUEST' };

      vi.spyOn(aiChatService, 'sendMessageInServer').mockRejectedValue(mockError);

      await act(async () => {
        await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
      });

      const operationKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);
      expect(result.current.mainSendMessageOperations[operationKey]?.inputSendErrorMsg).toBe(
        errorMessage,
      );
    });

    it('should not set error message when receiving a cancel signal', async () => {
      const { result } = renderHook(() => useChatStore());
      const abortError = new Error('AbortError');
      abortError.name = 'AbortError';

      vi.spyOn(aiChatService, 'sendMessageInServer').mockRejectedValue(abortError);

      await act(async () => {
        await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
      });

      const operationKey = messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID);
      expect(
        result.current.mainSendMessageOperations[operationKey]?.inputSendErrorMsg,
      ).toBeUndefined();
    });
  });

  describe('topic creation and switching', () => {
    it('should remove temporary message when creating new topic in default state', async () => {
      const { result } = renderHook(() => useChatStore());

      vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValueOnce({
        isCreateNewTopic: true,
        topicId: TEST_IDS.TOPIC_ID,
        messages: [{}, {}] as any,
        topics: [{}] as any,
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        userMessageId: TEST_IDS.USER_MESSAGE_ID,
      });

      await act(async () => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          activeTopicId: undefined,
          messagesMap: {},
          switchTopic: vi.fn(),
        });

        await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
      });

      expect(useChatStore.getState().messagesMap[`${TEST_IDS.SESSION_ID}_null`]).toEqual([]);
    });

    it('should automatically switch to newly created topic when no active topic exists', async () => {
      const { result } = renderHook(() => useChatStore());
      const mockSwitchTopic = vi.fn();

      await act(async () => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          activeTopicId: undefined,
          switchTopic: mockSwitchTopic,
        });
        await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
      });

      expect(mockSwitchTopic).toHaveBeenCalledWith(TEST_IDS.TOPIC_ID, true);
    });

    it('should not switch topic when active topic already exists', async () => {
      const { result } = renderHook(() => useChatStore());
      const mockSwitchTopic = vi.fn();

      await act(async () => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
          switchTopic: mockSwitchTopic,
        });
        await result.current.sendMessage({ message: TEST_CONTENT.USER_MESSAGE });
      });

      expect(mockSwitchTopic).not.toHaveBeenCalled();
    });
  });

  describe('cancelSendMessageInServer', () => {
    it('should abort operation and restore editor state when cancelling', () => {
      const { result } = renderHook(() => useChatStore());
      const mockAbort = vi.fn();
      const mockSetJSONState = vi.fn();

      act(() => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
          mainSendMessageOperations: {
            [messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)]: {
              isLoading: true,
              abortController: { abort: mockAbort, signal: {} as any },
              inputEditorTempState: { content: 'saved content' },
            },
          },
          mainInputEditor: { setJSONState: mockSetJSONState } as any,
        });
      });

      act(() => {
        result.current.cancelSendMessageInServer();
      });

      expect(mockAbort).toHaveBeenCalledWith('User cancelled sendMessageInServer operation');
      expect(
        result.current.mainSendMessageOperations[
          messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
        ]?.isLoading,
      ).toBe(false);
      expect(mockSetJSONState).toHaveBeenCalledWith({ content: 'saved content' });
    });

    it('should cancel operation for specified topic ID', () => {
      const { result } = renderHook(() => useChatStore());
      const mockAbort = vi.fn();
      const customTopicId = 'custom-topic-id';

      act(() => {
        useChatStore.setState({
          activeId: TEST_IDS.SESSION_ID,
          mainSendMessageOperations: {
            [messageMapKey(TEST_IDS.SESSION_ID, customTopicId)]: {
              isLoading: true,
              abortController: { abort: mockAbort, signal: {} as any },
            },
          },
        });
      });

      act(() => {
        result.current.cancelSendMessageInServer(customTopicId);
      });

      expect(mockAbort).toHaveBeenCalledWith('User cancelled sendMessageInServer operation');
    });

    it('should handle gracefully when operation does not exist', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ mainSendMessageOperations: {} });
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
          activeId: TEST_IDS.SESSION_ID,
          activeTopicId: TEST_IDS.TOPIC_ID,
          mainSendMessageOperations: {
            [messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)]: {
              isLoading: false,
              inputSendErrorMsg: 'Some error',
            },
          },
        });
      });

      act(() => {
        result.current.clearSendMessageError();
      });

      expect(
        result.current.mainSendMessageOperations[
          messageMapKey(TEST_IDS.SESSION_ID, TEST_IDS.TOPIC_ID)
        ],
      ).toBeUndefined();
    });

    it('should handle gracefully when no error operation exists', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ mainSendMessageOperations: {} });
      });

      expect(() => {
        act(() => {
          result.current.clearSendMessageError();
        });
      }).not.toThrow();
    });
  });

  describe('internal_toggleSendMessageOperation', () => {
    it('should create new send operation with abort controller', () => {
      const { result } = renderHook(() => useChatStore());
      let abortController: AbortController | undefined;

      act(() => {
        abortController = result.current.internal_toggleSendMessageOperation('test-key', true);
      });

      expect(abortController!).toBeInstanceOf(AbortController);
      expect(result.current.mainSendMessageOperations['test-key']?.isLoading).toBe(true);
      expect(result.current.mainSendMessageOperations['test-key']?.abortController).toBe(
        abortController,
      );
    });

    it('should stop send operation and clear abort controller', () => {
      const { result } = renderHook(() => useChatStore());
      const mockAbortController = { abort: vi.fn() } as any;

      let abortController: AbortController | undefined;
      act(() => {
        result.current.internal_updateSendMessageOperation('test-key', {
          isLoading: true,
          abortController: mockAbortController,
        });

        abortController = result.current.internal_toggleSendMessageOperation('test-key', false);
      });

      expect(abortController).toBeUndefined();
      expect(result.current.mainSendMessageOperations['test-key']?.isLoading).toBe(false);
      expect(result.current.mainSendMessageOperations['test-key']?.abortController).toBeNull();
    });

    it('should call abort with cancel reason when stopping', () => {
      const { result } = renderHook(() => useChatStore());
      const mockAbortController = { abort: vi.fn() } as any;

      act(() => {
        result.current.internal_updateSendMessageOperation('test-key', {
          isLoading: true,
          abortController: mockAbortController,
        });

        result.current.internal_toggleSendMessageOperation('test-key', false, 'Test cancel reason');
      });

      expect(mockAbortController.abort).toHaveBeenCalledWith('Test cancel reason');
    });

    it('should support multiple parallel operations', () => {
      const { result } = renderHook(() => useChatStore());

      let abortController1, abortController2;
      act(() => {
        abortController1 = result.current.internal_toggleSendMessageOperation('key1', true);
        abortController2 = result.current.internal_toggleSendMessageOperation('key2', true);
      });

      expect(result.current.mainSendMessageOperations['key1']?.isLoading).toBe(true);
      expect(result.current.mainSendMessageOperations['key2']?.isLoading).toBe(true);
      expect(abortController1).not.toBe(abortController2);
    });
  });

  describe('internal_updateSendMessageOperation', () => {
    it('should update operation state', () => {
      const { result } = renderHook(() => useChatStore());
      const mockAbortController = new AbortController();

      act(() => {
        result.current.internal_updateSendMessageOperation('test-key', {
          isLoading: true,
          abortController: mockAbortController,
          inputSendErrorMsg: 'test error',
        });
      });

      expect(result.current.mainSendMessageOperations['test-key']).toEqual({
        isLoading: true,
        abortController: mockAbortController,
        inputSendErrorMsg: 'test error',
      });
    });

    it('should support partial update of operation state', () => {
      const { result } = renderHook(() => useChatStore());
      const initialController = new AbortController();

      act(() => {
        result.current.internal_updateSendMessageOperation('test-key', {
          isLoading: true,
          abortController: initialController,
        });

        result.current.internal_updateSendMessageOperation('test-key', {
          inputSendErrorMsg: 'new error',
        });
      });

      expect(result.current.mainSendMessageOperations['test-key']).toEqual({
        isLoading: true,
        abortController: initialController,
        inputSendErrorMsg: 'new error',
      });
    });
  });
});
