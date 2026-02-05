import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiChatService } from '@/services/aiChat';
import * as agentGroupStore from '@/store/agentGroup';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getSessionStoreState } from '@/store/session';

import { useChatStore } from '../../../../store';
import { createMockMessage,TEST_CONTENT, TEST_IDS } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional');

// Mock lambdaClient to prevent network requests
vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    session: {
      updateSession: {
        mutate: vi.fn().mockResolvedValue(undefined),
      },
    },
  },
}));

beforeEach(() => {
  resetTestEnvironment();
  setupMockSelectors();
  spyOnMessageService();
  const sessionStore = getSessionStoreState();
  vi.spyOn(sessionStore, 'triggerSessionUpdate').mockResolvedValue(undefined);

  act(() => {
    useChatStore.setState({
      refreshMessages: vi.fn(),
      refreshTopic: vi.fn(),
      internal_execAgentRuntime: vi.fn(),
    });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper to create context for testing
const createTestContext = (agentId: string = TEST_IDS.SESSION_ID) => ({
  agentId,
  topicId: null,
  threadId: null,
});

describe('ConversationLifecycle actions', () => {
  describe('sendMessage', () => {
    describe('validation', () => {
      it('should not send when sessionId is empty', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: { agentId: '', topicId: null, threadId: null },
          });
        });

        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });

      it('should not send when message is empty and no files are provided', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.EMPTY,
            context: createTestContext(),
          });
        });

        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });

      it('should not send when message is empty with empty files array', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.EMPTY,
            files: [],
            context: createTestContext(),
          });
        });

        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });
    });

    describe('message creation', () => {
      it('should not process AI when onlyAddUserMessage is true', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [],
          topics: [],
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            onlyAddUserMessage: true,
            context: createTestContext(),
          });
        });

        expect(result.current.internal_execAgentRuntime).not.toHaveBeenCalled();
      });

      it('should create user message and trigger AI processing', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topics: [],
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });

      it('should work when sending from home page (activeAgentId is empty but context.agentId exists)', async () => {
        const { result } = renderHook(() => useChatStore());

        // Simulate home page state where activeAgentId is empty
        act(() => {
          useChatStore.setState({
            activeAgentId: '',
            activeTopicId: undefined,
          });
        });

        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topics: [],
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            // Pass agentId via context (simulating home page sending to inbox)
            context: createTestContext('inbox-agent-id'),
          });
        });

        // Should use agentId from context to get agent config
        expect(sendMessageInServerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: 'inbox-agent-id',
            newAssistantMessage: expect.objectContaining({
              model: expect.any(String),
              provider: expect.any(String),
            }),
          }),
          expect.any(AbortController),
        );
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });
    });

    describe('group chat supervisor metadata', () => {
      it('should pass isSupervisor metadata when agentId matches supervisorAgentId', async () => {
        const { result } = renderHook(() => useChatStore());

        // Mock agentGroup store to return a group with specific supervisorAgentId
        vi.spyOn(agentGroupStore, 'getChatGroupStoreState').mockReturnValue({
          groupMap: {
            'test-group-id': {
              id: 'test-group-id',
              supervisorAgentId: 'supervisor-agent-id',
            },
          },
        } as any);

        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topics: [],
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: {
              agentId: 'supervisor-agent-id',
              groupId: 'test-group-id',
              topicId: null,
              threadId: null,
            },
          });
        });

        // Should pass isSupervisor metadata when agentId matches supervisorAgentId
        expect(sendMessageInServerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            groupId: 'test-group-id',
            newAssistantMessage: expect.objectContaining({
              metadata: { isSupervisor: true },
            }),
          }),
          expect.any(AbortController),
        );
      });

      it('should NOT pass isSupervisor metadata when agentId is a sub-agent (not supervisor)', async () => {
        const { result } = renderHook(() => useChatStore());

        // Mock agentGroup store - sub-agent-id does NOT match supervisorAgentId
        vi.spyOn(agentGroupStore, 'getChatGroupStoreState').mockReturnValue({
          groupMap: {
            'test-group-id': {
              id: 'test-group-id',
              supervisorAgentId: 'supervisor-agent-id', // Different from sub-agent-id
            },
          },
        } as any);

        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topics: [],
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: {
              agentId: 'sub-agent-id',
              groupId: 'test-group-id',
              topicId: 'topic-id',
              threadId: 'thread-id',
            },
          });
        });

        // Should NOT pass isSupervisor metadata since agentId doesn't match supervisorAgentId
        expect(sendMessageInServerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            groupId: 'test-group-id',
            newAssistantMessage: expect.objectContaining({
              metadata: undefined,
            }),
          }),
          expect.any(AbortController),
        );
      });

      it('should pass isSupervisor metadata when isSupervisor is explicitly set in context', async () => {
        const { result } = renderHook(() => useChatStore());

        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topics: [],
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: {
              agentId: 'supervisor-agent-id',
              isSupervisor: true,
              topicId: null,
              threadId: null,
            },
          });
        });

        // Should pass isSupervisor metadata when explicitly set in context
        expect(sendMessageInServerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            newAssistantMessage: expect.objectContaining({
              metadata: { isSupervisor: true },
            }),
          }),
          expect.any(AbortController),
        );
      });

      it('should NOT pass isSupervisor metadata for regular agent chat (no groupId)', async () => {
        const { result } = renderHook(() => useChatStore());

        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topics: [],
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        // Should NOT pass isSupervisor metadata for regular agent chat
        expect(sendMessageInServerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            newAssistantMessage: expect.objectContaining({
              metadata: undefined,
            }),
          }),
          expect.any(AbortController),
        );
      });
    });

    describe('new topic creation cleanup', () => {
      it('should clear _new key data when new topic is created', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const newTopicId = 'created-topic-id';

        // Setup initial state: messages exist in the _new key (no topicId)
        const newKey = messageMapKey({ agentId, topicId: null });
        const existingMessages = [
          createMockMessage({ id: 'old-msg-1', role: 'user' }),
          createMockMessage({ id: 'old-msg-2', role: 'assistant' }),
        ];

        await act(async () => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            messagesMap: {
              [newKey]: existingMessages,
            },
            dbMessagesMap: {
              [newKey]: existingMessages,
            },
          });
        });

        // Verify messages exist in _new key before sending
        expect(useChatStore.getState().messagesMap[newKey]).toHaveLength(2);

        // Mock server response with new topic creation
        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            createMockMessage({ id: 'new-user-msg', role: 'user', topicId: newTopicId }),
            createMockMessage({ id: 'new-assistant-msg', role: 'assistant', topicId: newTopicId }),
          ],
          topics: { items: [{ id: newTopicId, title: 'New Topic' }], total: 1 },
          topicId: newTopicId,
          isCreateNewTopic: true,
          assistantMessageId: 'new-assistant-msg',
          userMessageId: 'new-user-msg',
        } as any);

        // Mock switchTopic to verify it's called correctly
        const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: { agentId, topicId: null, threadId: null },
          });
        });

        // switchTopic should be called with the new topicId and clearNewKey option
        expect(switchTopicSpy).toHaveBeenCalledWith(newTopicId, {
          clearNewKey: true,
          skipRefreshMessage: true,
        });

        // After new topic creation, the _new key should be cleared
        const messagesInNewKey = useChatStore.getState().messagesMap[newKey];
        expect(messagesInNewKey ?? []).toHaveLength(0);
      });
    });
  });
});
