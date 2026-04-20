import { act, renderHook } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiChatService } from '@/services/aiChat';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import * as agentGroupStore from '@/store/agentGroup';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { getSessionStoreState } from '@/store/session';
import * as toolStoreModule from '@/store/tool';

import { useChatStore } from '../../../../store';
import { createMockMessage, TEST_CONTENT, TEST_IDS } from './fixtures';
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
      mainInputEditor: null,
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
      it('should render pending compressedGroup immediately for /compact', async () => {
        const { result } = renderHook(() => useChatStore());
        const topicId = TEST_IDS.TOPIC_ID;
        const agentId = TEST_IDS.SESSION_ID;
        const key = messageMapKey({ agentId, topicId });
        const existingMessages = [
          createMockMessage({ id: 'user-1', role: 'user', topicId }),
          createMockMessage({ id: 'assistant-1', role: 'assistant', topicId }),
        ];

        await act(async () => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: topicId,
            dbMessagesMap: { [key]: existingMessages },
            messagesMap: { [key]: existingMessages },
          });
        });

        const createCompressionGroupSpy = vi
          .spyOn(messageService, 'createCompressionGroup')
          .mockResolvedValue({
            messageGroupId: 'group-1',
            messages: [
              {
                id: 'group-1',
                content: '...',
                role: 'compressedGroup',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              } as any,
            ],
            messagesToSummarize: existingMessages,
          });
        vi.spyOn(chatService, 'fetchPresetTaskResult').mockResolvedValue(undefined);
        vi.spyOn(messageService, 'finalizeCompression').mockResolvedValue({
          messages: [
            {
              id: 'group-1',
              content: 'summary',
              role: 'compressedGroup',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            } as any,
          ],
        });

        const optimisticCreateTmpMessageSpy = vi.spyOn(
          result.current,
          'optimisticCreateTmpMessage',
        );
        const internalDispatchMessageSpy = vi.spyOn(result.current, 'internal_dispatchMessage');

        await act(async () => {
          await result.current.sendMessage({
            context: { agentId, topicId, threadId: null },
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        actionCategory: 'command',
                        actionLabel: 'Compact context',
                        actionType: 'compact',
                        type: 'action-tag',
                      },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            message: '',
          });
        });

        expect(optimisticCreateTmpMessageSpy).not.toHaveBeenCalled();
        expect(internalDispatchMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            id: expect.stringMatching(/^tmp_compress_/),
            type: 'createMessage',
            value: expect.objectContaining({
              compressedMessages: [],
              content: '...',
              role: 'compressedGroup',
            }),
          }),
          expect.any(Object),
        );
        expect(createCompressionGroupSpy).toHaveBeenCalledWith({
          agentId,
          messageIds: ['user-1', 'assistant-1'],
          topicId,
        });
      });

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

      it('should restore the pre-send editor snapshot when server send fails', async () => {
        const { result } = renderHook(() => useChatStore());
        const inputEditorState = {
          root: {
            children: [
              {
                children: [{ text: 'Restored rich text', type: 'text', version: 1 }],
                type: 'paragraph',
                version: 1,
              },
            ],
            type: 'root',
            version: 1,
          },
        };
        const clearedEditorState = {
          root: { children: [], type: 'root', version: 1 },
        };
        const setDocument = vi.fn();
        const setJSONState = vi.fn();

        vi.spyOn(aiChatService, 'sendMessageInServer').mockRejectedValue(
          new TRPCClientError('restore failed'),
        );

        act(() => {
          useChatStore.setState({
            mainInputEditor: {
              getJSONState: vi.fn().mockReturnValue(clearedEditorState),
              setDocument,
              setJSONState,
            } as any,
          });
        });

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            editorData: inputEditorState as any,
            message: 'Restored rich text',
          });
        });

        const sendMessageOperation = Object.values(result.current.operations).find(
          (operation) => operation.type === 'sendMessage',
        );

        expect(sendMessageOperation?.metadata.inputEditorTempState).toEqual(inputEditorState);
        expect(setJSONState).toHaveBeenCalledWith(inputEditorState);
        expect(setDocument).not.toHaveBeenCalled();
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

      it('should persist selected slash skills into user message content before sending', async () => {
        const { result } = renderHook(() => useChatStore());

        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topics: undefined,
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);
        vi.spyOn(toolStoreModule, 'getToolStoreState').mockReturnValue({
          agentSkillDetailMap: {},
          agentSkills: [],
          builtinSkills: [
            {
              content: 'Use the user memory skill content.',
              description: 'Load user memory',
              identifier: 'user_memory',
              name: 'User Memory',
              source: 'builtin',
            },
            {
              content: 'Use the instruction skill content.',
              description: 'Load instruction',
              identifier: 'instruction',
              name: 'Instruction',
              source: 'builtin',
            },
          ],
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        actionCategory: 'skill',
                        actionLabel: 'User Memory',
                        actionType: 'user_memory',
                        type: 'action-tag',
                      },
                      {
                        actionCategory: 'skill',
                        actionLabel: 'Instruction',
                        actionType: 'instruction',
                        type: 'action-tag',
                      },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            message: '<action type="user_memory" category="skill" /> ' + TEST_CONTENT.USER_MESSAGE,
          });
        });

        const requestPayload = sendMessageInServerSpy.mock.calls[0]?.[0];

        expect(requestPayload?.newUserMessage).toEqual(
          expect.objectContaining({
            content: expect.stringContaining(TEST_CONTENT.USER_MESSAGE),
            editorData: expect.objectContaining({
              root: expect.any(Object),
            }),
          }),
        );
        expect(requestPayload?.newUserMessage.content).toContain('<selected_skill_context>');
        expect(requestPayload?.newUserMessage.content).toContain('identifier="user_memory"');
        expect(requestPayload?.newUserMessage.content).toContain('identifier="instruction"');
        expect(requestPayload?.newUserMessage.content).toContain(
          'Use the user memory skill content.',
        );
        expect(requestPayload?.newUserMessage.content).toContain(
          'Use the instruction skill content.',
        );
        expect(requestPayload?.preloadMessages).toBeUndefined();
        expect(requestPayload?.newUserMessage.editorData?.root.children[0].children).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              actionCategory: 'skill',
              actionType: 'user_memory',
              type: 'action-tag',
            }),
          ]),
        );
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

      it('should persist selected tool tags into user message content before runtime execution', async () => {
        const { result } = renderHook(() => useChatStore());

        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topics: undefined,
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        actionCategory: 'tool',
                        actionLabel: 'Notebook',
                        actionType: 'lobe-notebook',
                        type: 'action-tag',
                      },
                      {
                        actionCategory: 'tool',
                        actionLabel: 'Artifacts',
                        actionType: 'lobe-artifacts',
                        type: 'action-tag',
                      },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        const requestPayload = sendMessageInServerSpy.mock.calls[0]?.[0];

        expect(requestPayload?.newUserMessage.content).toContain(TEST_CONTENT.USER_MESSAGE);
        expect(requestPayload?.newUserMessage.content).toContain('<selected_tool_context>');
        expect(requestPayload?.newUserMessage.content).toContain('identifier="lobe-notebook"');
        expect(requestPayload?.newUserMessage.content).toContain('name="Notebook"');
        expect(requestPayload?.newUserMessage.content).toContain('identifier="lobe-artifacts"');
        expect(requestPayload?.newUserMessage.content).toContain('name="Artifacts"');
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalled();
      });

      it('should preserve editorData when enqueueing a queued message', async () => {
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const contextKey = messageMapKey(context);
        const editorData = {
          root: {
            children: [
              {
                children: [
                  {
                    actionCategory: 'tool',
                    actionLabel: 'Notebook',
                    actionType: 'lobe-notebook',
                    type: 'action-tag',
                  },
                  { text: ' queued message', type: 'text' },
                ],
                type: 'paragraph',
              },
            ],
            type: 'root',
          },
        };

        act(() => {
          useChatStore.setState({
            operations: {
              'op-running': {
                childOperationIds: [],
                context,
                id: 'op-running',
                metadata: {},
                status: 'running',
                type: 'execAgentRuntime',
              },
            } as any,
            operationsByContext: {
              [contextKey]: ['op-running'],
            },
          });
        });

        const enqueueMessageSpy = vi.spyOn(result.current, 'enqueueMessage');

        await act(async () => {
          await result.current.sendMessage({
            context,
            editorData: editorData as any,
            message: 'queued message',
          });
        });

        expect(enqueueMessageSpy).toHaveBeenCalledWith(
          contextKey,
          expect.objectContaining({
            content: 'queued message',
            editorData,
          }),
          'op-running',
        );
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

    describe('optimistic topic updatedAt', () => {
      it('should optimistically update topic updatedAt when sending message to existing topic', async () => {
        const { result } = renderHook(() => useChatStore());
        const topicId = TEST_IDS.TOPIC_ID;

        const dispatchTopicSpy = vi.spyOn(result.current, 'internal_dispatchTopic');

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user', topicId }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant', topicId }),
          ],
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: { agentId: TEST_IDS.SESSION_ID, topicId, threadId: null },
          });
        });

        // Should call internal_dispatchTopic with updateTopic to touch updatedAt
        expect(dispatchTopicSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'updateTopic',
            id: topicId,
            value: { updatedAt: expect.any(Number) },
          }),
        );
      });

      it('should NOT optimistically update topic updatedAt when server returns topics (new topic)', async () => {
        const { result } = renderHook(() => useChatStore());

        const dispatchTopicSpy = vi.spyOn(result.current, 'internal_dispatchTopic');

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topics: { items: [{ id: 'new-topic', title: 'New Topic' }], total: 1 },
          topicId: 'new-topic',
          isCreateNewTopic: true,
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        // Should NOT call internal_dispatchTopic with updateTopic for updatedAt
        const updateTopicCalls = dispatchTopicSpy.mock.calls.filter(
          ([payload]) => payload.type === 'updateTopic' && 'updatedAt' in (payload.value || {}),
        );
        expect(updateTopicCalls).toHaveLength(0);
      });
    });

    describe('@agent mention delegation', () => {
      it('should NOT set isSupervisor on assistant message when @agent is mentioned in non-group chat', async () => {
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
            message: '@Agent A hello',
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        label: 'Agent A',
                        metadata: { id: 'agent-a', type: 'agent' },
                        type: 'mention',
                      },
                      { text: ' hello', type: 'text' },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            // Non-group context: no groupId
            context: createTestContext(),
          });
        });

        // Assistant message metadata should NOT contain isSupervisor
        expect(sendMessageInServerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            newAssistantMessage: expect.objectContaining({
              metadata: undefined,
            }),
          }),
          expect.any(AbortController),
        );

        // But runtime should receive mentionedAgents in initialContext
        expect(result.current.internal_execAgentRuntime).toHaveBeenCalledWith(
          expect.objectContaining({
            initialContext: expect.objectContaining({
              initialContext: expect.objectContaining({
                mentionedAgents: [{ id: 'agent-a', name: 'Agent A' }],
              }),
            }),
          }),
        );
      });

      it('should NOT inject mentionedAgents into initialContext when in group chat', async () => {
        const { result } = renderHook(() => useChatStore());

        // Mock group store so groupId resolves
        vi.spyOn(agentGroupStore, 'getChatGroupStoreState').mockReturnValue({
          groupMap: {
            'test-group': {
              id: 'test-group',
              supervisorAgentId: 'supervisor-id',
            },
          },
        } as any);

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
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
            message: '@Agent A in group',
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        label: 'Agent A',
                        metadata: { id: 'agent-a', type: 'agent' },
                        type: 'mention',
                      },
                      { text: ' in group', type: 'text' },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            // Group context
            context: {
              agentId: 'sub-agent-id',
              groupId: 'test-group',
              topicId: null,
              threadId: null,
            },
          });
        });

        // Runtime should NOT receive mentionedAgents in group context
        const execCall = (result.current.internal_execAgentRuntime as any).mock.calls[0]?.[0];
        const initialCtx = execCall?.initialContext?.initialContext;
        expect(initialCtx?.mentionedAgents).toBeUndefined();
      });
    });

    describe('auto-dismiss pending tool interventions', () => {
      it('should abort pending flat tool messages when user sends a new message', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const key = messageMapKey({ agentId, topicId: null });

        const pendingToolMsg = createMockMessage({
          id: 'tool-pending-1',
          role: 'tool',
          content: '',
          pluginIntervention: { status: 'pending' },
          topicId: undefined,
        });

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            messagesMap: { [key]: [pendingToolMsg] },
            dbMessagesMap: { [key]: [pendingToolMsg] },
          });
        });

        const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');
        const updatePluginSpy = vi
          .spyOn(messageService, 'updateMessagePlugin')
          .mockResolvedValue({ success: true } as any);

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            pendingToolMsg,
            createMockMessage({ id: 'new-user-msg', role: 'user', topicId: undefined }),
            createMockMessage({ id: 'new-assistant-msg', role: 'assistant', topicId: undefined }),
          ],
          topics: [],
          assistantMessageId: 'new-assistant-msg',
          userMessageId: 'new-user-msg',
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: 'override pending interaction',
            context: { agentId, topicId: null, threadId: null },
          });
        });

        // Should dispatch a single merged update for pluginIntervention + content
        const abortCalls = dispatchSpy.mock.calls.filter(
          ([payload]) =>
            payload.type === 'updateMessage' &&
            (payload as any).value?.pluginIntervention?.status === 'aborted',
        );
        expect(abortCalls).toHaveLength(1);
        expect(abortCalls[0][0]).toEqual(
          expect.objectContaining({
            id: 'tool-pending-1',
            type: 'updateMessage',
            value: expect.objectContaining({
              pluginIntervention: { status: 'aborted' },
              content: 'User bypassed this interaction by sending a message directly.',
            }),
          }),
        );

        // Should persist intervention status to server
        expect(updatePluginSpy).toHaveBeenCalledWith(
          'tool-pending-1',
          { intervention: { status: 'aborted' } },
          expect.any(Object),
        );
      });

      it('should abort pending interventions in group message children', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const key = messageMapKey({ agentId, topicId: null });

        const groupMsg = createMockMessage({
          id: 'group-1',
          role: 'assistant',
          topicId: undefined,
          children: [
            {
              id: 'child-1',
              content: '',
              tools: [
                {
                  apiName: 'askUserQuestion',
                  arguments: '{}',
                  id: 'tool-call-1',
                  identifier: 'lobe-user-interaction',
                  intervention: { status: 'pending' },
                  result_msg_id: 'tool-result-1',
                },
              ],
            },
          ] as any,
        });

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            messagesMap: { [key]: [groupMsg] },
            dbMessagesMap: { [key]: [groupMsg] },
          });
        });

        const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');
        vi.spyOn(messageService, 'updateMessagePlugin').mockResolvedValue({
          success: true,
        } as any);

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            groupMsg,
            createMockMessage({ id: 'new-user-msg', role: 'user', topicId: undefined }),
            createMockMessage({ id: 'new-assistant-msg', role: 'assistant', topicId: undefined }),
          ],
          topics: [],
          assistantMessageId: 'new-assistant-msg',
          userMessageId: 'new-user-msg',
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: 'override group interaction',
            context: { agentId, topicId: null, threadId: null },
          });
        });

        // Should dispatch abort for the tool result message found in children
        const abortCalls = dispatchSpy.mock.calls.filter(
          ([payload]) =>
            payload.type === 'updateMessage' &&
            (payload as any).value?.pluginIntervention?.status === 'aborted',
        );
        expect(abortCalls).toHaveLength(1);
        expect(abortCalls[0][0]).toEqual(
          expect.objectContaining({
            id: 'tool-result-1',
            type: 'updateMessage',
            value: expect.objectContaining({
              pluginIntervention: { status: 'aborted' },
            }),
          }),
        );
      });

      it('should not dispatch if no pending interventions exist', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const key = messageMapKey({ agentId, topicId: null });

        const normalMsg = createMockMessage({
          id: 'normal-1',
          role: 'assistant',
          topicId: undefined,
        });

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            messagesMap: { [key]: [normalMsg] },
            dbMessagesMap: { [key]: [normalMsg] },
          });
        });

        const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchMessage');
        const updatePluginSpy = vi
          .spyOn(messageService, 'updateMessagePlugin')
          .mockResolvedValue({ success: true } as any);

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          messages: [
            normalMsg,
            createMockMessage({ id: 'new-user-msg', role: 'user', topicId: undefined }),
            createMockMessage({ id: 'new-assistant-msg', role: 'assistant', topicId: undefined }),
          ],
          topics: [],
          assistantMessageId: 'new-assistant-msg',
          userMessageId: 'new-user-msg',
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            message: 'normal message',
            context: { agentId, topicId: null, threadId: null },
          });
        });

        // No updateMessage dispatch for intervention abort
        const abortDispatches = dispatchSpy.mock.calls.filter(
          ([payload]) =>
            payload.type === 'updateMessage' &&
            (payload as any).value?.pluginIntervention?.status === 'aborted',
        );
        expect(abortDispatches).toHaveLength(0);
        expect(updatePluginSpy).not.toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ intervention: { status: 'aborted' } }),
          expect.any(Object),
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
