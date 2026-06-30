import type * as LobechatConstModule from '@lobechat/const';
import { act, renderHook, waitFor } from '@testing-library/react';
import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentService } from '@/services/agent';
import { aiChatService } from '@/services/aiChat';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import * as agentGroupStore from '@/store/agentGroup';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { getSessionStoreState } from '@/store/session';
import * as toolStoreModule from '@/store/tool';
import { pageAgentRuntime } from '@/store/tool/slices/builtin/executors/lobe-page-agent';

import { useChatStore } from '../../../../store';
import { createMockAgentConfig, createMockMessage, TEST_CONTENT, TEST_IDS } from './fixtures';
import { resetTestEnvironment, setupMockSelectors, spyOnMessageService } from './helpers';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional');

const executeHeterogeneousAgentMock = vi.hoisted(() => vi.fn());
const mockConstEnv = vi.hoisted(() => ({ isDesktop: false }));
const mockLocalFileService = vi.hoisted(() => ({
  listLocalFiles: vi.fn(),
  readLocalFile: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal<typeof LobechatConstModule>();
  return {
    ...actual,
    get isDesktop() {
      return mockConstEnv.isDesktop;
    },
  };
});

vi.mock('../transports/hetero/heterogeneousAgentExecutor', () => ({
  executeHeterogeneousAgent: (...args: any[]) => executeHeterogeneousAgentMock(...args),
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: mockLocalFileService,
}));

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
  vi.spyOn(agentService, 'getAgentConfigById').mockResolvedValue(createMockAgentConfig() as any);

  act(() => {
    useChatStore.setState({
      refreshMessages: vi.fn(),
      refreshTopic: vi.fn(),
      executeClientAgent: vi.fn(),
      mainInputEditor: null,
    });
  });
});

afterEach(() => {
  executeHeterogeneousAgentMock.mockReset();
  mockConstEnv.isDesktop = false;
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

        expect(result.current.executeClientAgent).not.toHaveBeenCalled();
      });

      it('should not send when message is empty and no files are provided', async () => {
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.EMPTY,
            context: createTestContext(),
          });
        });

        expect(result.current.executeClientAgent).not.toHaveBeenCalled();
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

        expect(result.current.executeClientAgent).not.toHaveBeenCalled();
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

        expect(result.current.executeClientAgent).not.toHaveBeenCalled();
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

        expect(result.current.executeClientAgent).toHaveBeenCalled();
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
        expect(result.current.executeClientAgent).toHaveBeenCalled();
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
        expect(result.current.executeClientAgent).toHaveBeenCalled();
      });

      it('should show an optimistic topic while the first message is still creating the server topic', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const topicKey = topicMapKey({ agentId });
        const newTopicId = TEST_IDS.NEW_TOPIC_ID;
        let resolveServerSend!: (value: any) => void;
        const serverSendPromise = new Promise<any>((resolve) => {
          resolveServerSend = resolve;
        });
        let resolveExecute!: () => void;
        const executePromise = new Promise<void>((resolve) => {
          resolveExecute = resolve;
        });

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            executeClientAgent: vi.fn().mockReturnValue(executePromise),
            summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
            topicDataMap: {
              [topicKey]: {
                currentPage: 0,
                hasMore: false,
                isExpandingPageSize: false,
                isLoadingMore: false,
                items: [],
                pageSize: 20,
                total: 0,
              },
            },
          });
        });

        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockReturnValue(serverSendPromise);

        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: '**666**',
          });
        });

        await waitFor(() => expect(sendMessageInServerSpy).toHaveBeenCalled());

        const optimisticTopic = useChatStore.getState().topicDataMap[topicKey]?.items[0];
        expect(optimisticTopic).toEqual(
          expect.objectContaining({
            sessionId: agentId,
            title: '666',
          }),
        );
        expect(optimisticTopic?.id).toMatch(/^tmp_topic_/);
        expect(useChatStore.getState().topicLoadingIds).toContain(optimisticTopic!.id);

        await act(async () => {
          resolveServerSend({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            isCreateNewTopic: true,
            messages: [
              createMockMessage({
                id: TEST_IDS.USER_MESSAGE_ID,
                role: 'user',
                topicId: newTopicId,
              }),
              createMockMessage({
                id: TEST_IDS.ASSISTANT_MESSAGE_ID,
                role: 'assistant',
                topicId: newTopicId,
              }),
            ],
            topicId: newTopicId,
            topics: { items: [{ id: newTopicId, title: 'Server Topic' }], total: 1 },
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);
        });

        await waitFor(() =>
          expect(useChatStore.getState().topicDataMap[topicKey]?.items[0]?.id).toBe(newTopicId),
        );
        const finalTopics = useChatStore.getState().topicDataMap[topicKey]?.items ?? [];
        expect(finalTopics).toEqual([expect.objectContaining({ id: newTopicId })]);
        expect(finalTopics.some((topic) => topic.id === optimisticTopic?.id)).toBe(false);
        expect(useChatStore.getState().topicLoadingIds).not.toContain(optimisticTopic!.id);
        expect(useChatStore.getState().topicLoadingIds).toContain(newTopicId);

        await act(async () => {
          resolveExecute();
          await sendPromise;
        });

        expect(useChatStore.getState().topicLoadingIds).not.toContain(newTopicId);
      });

      it('should rollback an optimistic topic if the create response resolves without a topic id', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const topicKey = topicMapKey({ agentId });

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            executeClientAgent: vi.fn().mockResolvedValue(undefined),
            summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
            topicDataMap: {
              [topicKey]: {
                currentPage: 0,
                hasMore: false,
                isExpandingPageSize: false,
                isLoadingMore: false,
                items: [],
                pageSize: 20,
                total: 0,
              },
            },
          });
        });

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topics: undefined,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        expect(useChatStore.getState().topicDataMap[topicKey]?.items ?? []).toEqual([]);
        expect(useChatStore.getState().topicLoadingIds).toEqual([]);
        expect(useChatStore.getState().topicLoadingIdCounts).toEqual({});
      });

      it('should show a group optimistic topic in the group topic bucket', async () => {
        const { result } = renderHook(() => useChatStore());
        const groupId = 'group-1';
        const supervisorAgentId = 'supervisor-agent';
        const groupKey = topicMapKey({ groupId });
        const groupAgentKey = topicMapKey({ agentId: supervisorAgentId, groupId });
        let resolveServerSend!: (value: any) => void;
        const serverSendPromise = new Promise<any>((resolve) => {
          resolveServerSend = resolve;
        });

        vi.spyOn(agentGroupStore, 'getChatGroupStoreState').mockReturnValue({
          groupMap: {
            [groupId]: {
              id: groupId,
              supervisorAgentId,
            },
          },
        } as any);

        act(() => {
          useChatStore.setState({
            activeAgentId: undefined,
            activeGroupId: groupId,
            activeTopicId: undefined,
            executeClientAgent: vi.fn().mockResolvedValue(undefined),
            summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
            topicDataMap: {
              [groupKey]: {
                currentPage: 0,
                hasMore: false,
                isExpandingPageSize: false,
                isLoadingMore: false,
                items: [],
                pageSize: 20,
                total: 0,
              },
            },
          });
        });

        vi.spyOn(aiChatService, 'sendMessageInServer').mockReturnValue(serverSendPromise);

        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context: {
              agentId: supervisorAgentId,
              groupId,
              scope: 'group',
              threadId: null,
              topicId: null,
            },
            message: 'Group first message',
          });
        });

        await waitFor(() =>
          expect(useChatStore.getState().topicDataMap[groupKey]?.items[0]?.id).toMatch(
            /^tmp_topic_/,
          ),
        );

        const optimisticTopic = useChatStore.getState().topicDataMap[groupKey]?.items[0];
        expect(optimisticTopic).toEqual(
          expect.objectContaining({
            title: 'Group first message',
          }),
        );
        expect(useChatStore.getState().topicDataMap[groupAgentKey]?.items ?? []).toEqual([]);

        await act(async () => {
          resolveServerSend({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            isCreateNewTopic: true,
            messages: [
              createMockMessage({
                id: TEST_IDS.USER_MESSAGE_ID,
                role: 'user',
                topicId: TEST_IDS.NEW_TOPIC_ID,
              }),
              createMockMessage({
                id: TEST_IDS.ASSISTANT_MESSAGE_ID,
                role: 'assistant',
                topicId: TEST_IDS.NEW_TOPIC_ID,
              }),
            ],
            topicId: TEST_IDS.NEW_TOPIC_ID,
            topics: { items: [{ id: TEST_IDS.NEW_TOPIC_ID, title: 'Group Topic' }], total: 1 },
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);
          await sendPromise;
        });

        expect(useChatStore.getState().topicDataMap[groupKey]?.items).toEqual([
          expect.objectContaining({ id: TEST_IDS.NEW_TOPIC_ID, title: 'Group Topic' }),
        ]);
        expect(useChatStore.getState().topicDataMap[groupAgentKey]?.items ?? []).toEqual([]);
      });

      it('should clear the active temp topic when rolling back an optimistic topic', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const topicKey = topicMapKey({ agentId });
        let resolveServerSend!: (value: any) => void;
        const serverSendPromise = new Promise<any>((resolve) => {
          resolveServerSend = resolve;
        });

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            executeClientAgent: vi.fn().mockResolvedValue(undefined),
            summaryTopicTitle: vi.fn().mockResolvedValue(undefined),
            topicDataMap: {
              [topicKey]: {
                currentPage: 0,
                hasMore: false,
                isExpandingPageSize: false,
                isLoadingMore: false,
                items: [],
                pageSize: 20,
                total: 0,
              },
            },
          });
        });

        vi.spyOn(aiChatService, 'sendMessageInServer').mockReturnValue(serverSendPromise);

        let sendPromise!: ReturnType<typeof result.current.sendMessage>;
        act(() => {
          sendPromise = result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        await waitFor(() =>
          expect(useChatStore.getState().topicDataMap[topicKey]?.items[0]?.id).toMatch(
            /^tmp_topic_/,
          ),
        );
        const optimisticTopicId = useChatStore.getState().topicDataMap[topicKey]!.items[0].id;

        act(() => {
          useChatStore.setState({ activeTopicId: optimisticTopicId });
        });

        await act(async () => {
          resolveServerSend({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topics: undefined,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);
          await sendPromise;
        });

        expect(useChatStore.getState().topicDataMap[topicKey]?.items ?? []).toEqual([]);
        expect(useChatStore.getState().activeTopicId).not.toBe(optimisticTopicId);
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
        expect(result.current.executeClientAgent).toHaveBeenCalled();
      });

      it('should merge partial persisted messages into existing topic history', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const topicId = TEST_IDS.TOPIC_ID;
        const context = { agentId, threadId: null, topicId };
        const key = messageMapKey(context);
        const existingMessages = [
          createMockMessage({ id: 'existing-user', role: 'user', topicId }),
          createMockMessage({ id: 'existing-assistant', role: 'assistant', topicId }),
        ];
        const persistedUserMessage = createMockMessage({
          id: TEST_IDS.USER_MESSAGE_ID,
          role: 'user',
          topicId,
        });
        const persistedAssistantMessage = createMockMessage({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          parentId: TEST_IDS.USER_MESSAGE_ID,
          role: 'assistant',
          topicId,
        });

        act(() => {
          useChatStore.setState({
            dbMessagesMap: { [key]: existingMessages },
            messagesMap: { [key]: existingMessages },
          });
        });

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          __isPartialMessages: true,
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          isCreateNewTopic: false,
          messages: [persistedUserMessage, persistedAssistantMessage],
          topicId,
          topics: undefined,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            context,
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        expect(result.current.messagesMap[key].map((message) => message.id)).toEqual([
          'existing-user',
          'existing-assistant',
          TEST_IDS.USER_MESSAGE_ID,
          TEST_IDS.ASSISTANT_MESSAGE_ID,
        ]);
        expect(
          result.current.messagesMap[key].some((message) => message.id.startsWith('tmp_')),
        ).toBe(false);
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

      it('should enqueue when an execHeterogeneousAgent op is running (CC queue mode)', async () => {
        // With Plan A, sends during a running CC turn must hit the
        // same queue path used by client mode — without this we'd spawn a
        // second `claude` process in parallel.
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const contextKey = messageMapKey(context);

        act(() => {
          useChatStore.setState({
            operations: {
              'op-cc-running': {
                childOperationIds: [],
                context,
                id: 'op-cc-running',
                metadata: {},
                status: 'running',
                type: 'execHeterogeneousAgent',
              },
            } as any,
            operationsByContext: {
              [contextKey]: ['op-cc-running'],
            },
          });
        });

        const enqueueMessageSpy = vi.spyOn(result.current, 'enqueueMessage');

        await act(async () => {
          await result.current.sendMessage({
            context,
            message: 'follow-up during CC run',
          });
        });

        expect(enqueueMessageSpy).toHaveBeenCalledWith(
          contextKey,
          expect.objectContaining({
            content: 'follow-up during CC run',
            interruptMode: 'soft',
          }),
          'op-cc-running',
        );
      });

      it('should enqueue while the first new-topic message is still being persisted', async () => {
        const { result } = renderHook(() => useChatStore());
        const context = createTestContext();
        const contextKey = messageMapKey(context);

        act(() => {
          useChatStore.setState({
            operations: {
              'op-send-running': {
                childOperationIds: [],
                context: { ...context, messageId: 'tmp-first-user-message' },
                id: 'op-send-running',
                metadata: {},
                status: 'running',
                type: 'sendMessage',
              },
            } as any,
            operationsByContext: {
              [contextKey]: ['op-send-running'],
            },
          });
        });

        const enqueueMessageSpy = vi.spyOn(result.current, 'enqueueMessage');
        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            isCreateNewTopic: true,
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topicId: TEST_IDS.TOPIC_ID,
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);

        await act(async () => {
          await result.current.sendMessage({
            context,
            message: 'fast follow-up before topic is created',
          });
        });

        expect(enqueueMessageSpy).toHaveBeenCalledWith(
          contextKey,
          expect.objectContaining({
            content: 'fast follow-up before topic is created',
            interruptMode: 'soft',
          }),
          'op-send-running',
        );
        expect(sendMessageInServerSpy).not.toHaveBeenCalled();
      });

      it('should move queued follow-ups from the new-topic key to the created topic key', async () => {
        const { result } = renderHook(() => useChatStore());
        const agentId = TEST_IDS.SESSION_ID;
        const createdTopicId = 'created-topic-id';
        const newTopicKey = messageMapKey({ agentId, topicId: null });
        const createdTopicKey = messageMapKey({ agentId, topicId: createdTopicId });
        const queuedMessage = {
          content: 'queued while topic is being created',
          createdAt: Date.now(),
          id: 'queued-before-topic-created',
          interruptMode: 'soft' as const,
        };

        act(() => {
          useChatStore.setState({
            activeAgentId: agentId,
            activeTopicId: undefined,
            queuedMessages: {
              [newTopicKey]: [queuedMessage],
            },
          });
        });

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          isCreateNewTopic: true,
          messages: [
            createMockMessage({
              id: TEST_IDS.USER_MESSAGE_ID,
              role: 'user',
              topicId: createdTopicId,
            }),
            createMockMessage({
              id: TEST_IDS.ASSISTANT_MESSAGE_ID,
              role: 'assistant',
              topicId: createdTopicId,
            }),
          ],
          topicId: createdTopicId,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);

        await act(async () => {
          await result.current.sendMessage({
            context: { agentId, threadId: null, topicId: null },
            message: TEST_CONTENT.USER_MESSAGE,
          });
        });

        expect(useChatStore.getState().queuedMessages[newTopicKey] ?? []).toEqual([]);
        expect(useChatStore.getState().queuedMessages[createdTopicKey]).toEqual([queuedMessage]);
      });
    });

    describe('page scope documentId injection', () => {
      it('injects the active page documentId into the gateway context when scope is page', async () => {
        const { result } = renderHook(() => useChatStore());

        const getCurrentDocIdSpy = vi
          .spyOn(pageAgentRuntime, 'getCurrentDocId')
          .mockReturnValue('doc-page-1');

        const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          operationId: 'op-1',
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        });

        act(() => {
          useChatStore.setState({
            executeGatewayAgent: executeGatewayAgentSpy,
            isGatewayModeEnabled: () => true,
          });
        });

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: {
              agentId: TEST_IDS.SESSION_ID,
              scope: 'page',
              threadId: null,
              topicId: null,
            },
          });
        });

        expect(getCurrentDocIdSpy).toHaveBeenCalled();
        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.objectContaining({ documentId: 'doc-page-1', scope: 'page' }),
          }),
        );
      });

      it('does not inject documentId for non-page scope conversations', async () => {
        const { result } = renderHook(() => useChatStore());

        vi.spyOn(pageAgentRuntime, 'getCurrentDocId').mockReturnValue('doc-page-1');

        const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          operationId: 'op-1',
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        });

        act(() => {
          useChatStore.setState({
            executeGatewayAgent: executeGatewayAgentSpy,
            isGatewayModeEnabled: () => true,
          });
        });

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        expect(executeGatewayAgentSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            context: expect.not.objectContaining({ documentId: expect.anything() }),
          }),
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
              metadata: { isSupervisor: true, orchestrationRole: 'supervisor' },
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
              metadata: { isSupervisor: true, orchestrationRole: 'supervisor' },
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

      it('should not persist the requested model for heterogeneous agents before the CLI reports it', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
            model: 'claude-sonnet-4-6',
          },
        });

        const { result } = renderHook(() => useChatStore());

        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topicId: TEST_IDS.TOPIC_ID,
            topics: [],
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);

        executeHeterogeneousAgentMock.mockResolvedValue(undefined);

        await act(async () => {
          await result.current.sendMessage({
            message: TEST_CONTENT.USER_MESSAGE,
            context: createTestContext(),
          });
        });

        expect(sendMessageInServerSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            newAssistantMessage: {
              provider: 'codex',
            },
          }),
          expect.any(AbortController),
        );
      });

      it('should materialize local file mention editor data into persisted tool-result snapshots', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            agencyConfig: {
              heterogeneousProvider: { command: 'codex', type: 'codex' },
            },
          },
        });
        mockLocalFileService.readLocalFile.mockResolvedValue({
          charCount: 17,
          content: 'export const x = 1;',
          fileType: 'text',
          filename: 'foo.ts',
          loc: [0, 200],
          totalCharCount: 17,
          totalLineCount: 1,
        });

        const { result } = renderHook(() => useChatStore());
        const sendMessageInServerSpy = vi
          .spyOn(aiChatService, 'sendMessageInServer')
          .mockResolvedValue({
            assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            messages: [
              createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
              createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
            ],
            topicId: TEST_IDS.TOPIC_ID,
            topics: [],
            userMessageId: TEST_IDS.USER_MESSAGE_ID,
          } as any);

        executeHeterogeneousAgentMock.mockResolvedValue(undefined);

        await act(async () => {
          await result.current.sendMessage({
            context: createTestContext(),
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        label: 'foo.ts',
                        metadata: {
                          name: 'foo.ts',
                          path: '/Users/me/project/foo.ts',
                          type: 'localFile',
                        },
                        type: 'mention',
                      },
                      { text: ' 这个文件是什么', type: 'text' },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            },
            message: '<localFile name="foo.ts" path="/Users/me/project/foo.ts" /> 这个文件是什么',
          });
        });

        expect(mockLocalFileService.readLocalFile).toHaveBeenCalledWith({
          path: '/Users/me/project/foo.ts',
        });
        const payload = sendMessageInServerSpy.mock.calls[0]?.[0];
        expect(payload?.newUserMessage.metadata?.localSystemToolSnapshots).toMatchObject([
          {
            apiName: 'readFile',
            arguments: { path: '/Users/me/project/foo.ts' },
            content: expect.stringContaining('export const x = 1;'),
            identifier: 'lobe-local-system',
            success: true,
          },
        ]);
      });

      it('should preserve local file snapshots for runtime when server response omits metadata', async () => {
        mockConstEnv.isDesktop = true;
        setupMockSelectors({
          agentConfig: {
            plugins: ['lobe-local-system'],
          },
        });
        mockLocalFileService.readLocalFile.mockResolvedValue({
          charCount: 17,
          content: 'export const x = 1;',
          fileType: 'text',
          filename: 'foo.ts',
          loc: [0, 200],
          totalCharCount: 17,
          totalLineCount: 1,
        });

        const { result } = renderHook(() => useChatStore());
        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          isCreateNewTopic: true,
          messages: [
            createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user' }),
            createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant' }),
          ],
          topicId: TEST_IDS.TOPIC_ID,
          topics: { items: [], total: 0 },
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
                        label: 'foo.ts',
                        metadata: {
                          name: 'foo.ts',
                          path: '/Users/me/project/foo.ts',
                          type: 'localFile',
                        },
                        type: 'mention',
                      },
                      { text: ' 这个文件是什么', type: 'text' },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            },
            message: '<localFile name="foo.ts" path="/Users/me/project/foo.ts" /> 这个文件是什么',
          });
        });

        const runtimePayload = vi.mocked(result.current.executeClientAgent).mock.calls[0]?.[0];
        const runtimeUserMessage = runtimePayload?.messages.find(
          (message) => message.id === TEST_IDS.USER_MESSAGE_ID,
        );

        expect(runtimeUserMessage?.metadata?.localSystemToolSnapshots).toMatchObject([
          {
            apiName: 'readFile',
            arguments: { path: '/Users/me/project/foo.ts' },
            content: expect.stringContaining('export const x = 1;'),
            identifier: 'lobe-local-system',
            success: true,
          },
        ]);
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
      it('should NOT set isSupervisor on assistant message when @agent uses supervisor path in non-group chat', async () => {
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
            message: 'hello @Agent A',
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      { text: 'hello ', type: 'text' },
                      {
                        label: 'Agent A',
                        metadata: { id: 'agent-a', type: 'agent' },
                        type: 'mention',
                      },
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
        expect(result.current.executeClientAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            initialContext: expect.objectContaining({
              initialContext: expect.objectContaining({
                mentionedAgents: [{ id: 'agent-a', name: 'Agent A' }],
              }),
            }),
          }),
        );
      });

      it('should directly call a single leading @agent in non-group chat', async () => {
        const { result } = renderHook(() => useChatStore());
        const targetAgentId = 'agent-direct-target';
        const toolMessageId = 'tool-call-agent-result';
        const message = '@Agent B hello';
        const createdThreadId = 'thread-created-by-send';

        const userMessage = createMockMessage({
          id: TEST_IDS.USER_MESSAGE_ID,
          role: 'user',
          content: message,
        });
        let assistantMessage = createMockMessage({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          role: 'assistant',
          content: '',
          tools: [],
        });

        vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
          createdThreadId,
          messages: [userMessage, assistantMessage],
          topics: [],
          assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
          userMessageId: TEST_IDS.USER_MESSAGE_ID,
        } as any);

        (messageService.updateMessage as any).mockImplementation(
          async (_id: string, value: any) => {
            assistantMessage = { ...assistantMessage, ...value };
            return { messages: [userMessage, assistantMessage], success: true };
          },
        );
        (messageService.createMessage as any).mockImplementation(async (params: any) => {
          const toolMessage = createMockMessage({
            ...params,
            id: toolMessageId,
            role: 'tool',
          });

          return {
            id: toolMessageId,
            messages: [userMessage, assistantMessage, toolMessage],
          };
        });

        await act(async () => {
          await result.current.sendMessage({
            message,
            editorData: {
              root: {
                children: [
                  {
                    children: [
                      {
                        label: 'Agent B',
                        metadata: { id: targetAgentId, type: 'agent' },
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
            context: createTestContext(),
          });
        });

        expect(agentService.getAgentConfigById).toHaveBeenCalledWith(targetAgentId);
        expect(messageService.updateMessage).toHaveBeenCalledWith(
          TEST_IDS.ASSISTANT_MESSAGE_ID,
          expect.objectContaining({
            content: '',
            tools: [
              expect.objectContaining({
                apiName: 'callAgent',
                identifier: 'lobe-agent-management',
              }),
            ],
          }),
          expect.objectContaining({ agentId: TEST_IDS.SESSION_ID }),
        );
        expect(messageService.createMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: TEST_IDS.SESSION_ID,
            content: `Called agent "${targetAgentId}" to respond.`,
            parentId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            plugin: expect.objectContaining({
              apiName: 'callAgent',
              identifier: 'lobe-agent-management',
            }),
            pluginState: {
              agentId: targetAgentId,
              instruction: message,
              mode: 'speak',
            },
            role: 'tool',
          }),
        );

        const execCall = (result.current.executeClientAgent as any).mock.calls[0]?.[0];
        expect(execCall).toEqual(
          expect.objectContaining({
            context: expect.objectContaining({
              agentId: TEST_IDS.SESSION_ID,
              scope: 'sub_agent',
              subAgentId: targetAgentId,
            }),
            inPortalThread: true,
            parentMessageId: toolMessageId,
            parentMessageType: 'tool',
          }),
        );
        expect(execCall.initialContext).toBeUndefined();
        expect(execCall.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: toolMessageId, role: 'tool' }),
            expect.objectContaining({
              content: expect.stringContaining(message),
              role: 'user',
            }),
          ]),
        );
      });

      it('should keep supervisor delegation for multiple @agent mentions', async () => {
        const { result } = renderHook(() => useChatStore());

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
            message: '@Agent A @Agent B compare',
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
                      { text: ' ', type: 'text' },
                      {
                        label: 'Agent B',
                        metadata: { id: 'agent-b', type: 'agent' },
                        type: 'mention',
                      },
                      { text: ' compare', type: 'text' },
                    ],
                    type: 'paragraph',
                  },
                ],
                type: 'root',
              },
            } as any,
            context: createTestContext(),
          });
        });

        expect(agentService.getAgentConfigById).not.toHaveBeenCalledWith('agent-a');
        expect(result.current.executeClientAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            initialContext: expect.objectContaining({
              initialContext: expect.objectContaining({
                mentionedAgents: [
                  { id: 'agent-a', name: 'Agent A' },
                  { id: 'agent-b', name: 'Agent B' },
                ],
              }),
            }),
            parentMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
            parentMessageType: 'assistant',
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
        const execCall = (result.current.executeClientAgent as any).mock.calls[0]?.[0];
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

        const newTopicKey = messageMapKey({ agentId, topicId: newTopicId });
        expect(useChatStore.getState().messagesMap[newTopicKey]).toHaveLength(2);
        expect(useChatStore.getState().topicDataMap[topicMapKey({ agentId })]?.items[0]).toEqual(
          expect.objectContaining({ id: newTopicId }),
        );
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Characterization net for the POST-PERSIST topic-title auto-generation hook.
  //
  // After the user message is persisted (client mode), sendMessage fires a
  // fire-and-forget `summaryTitle()` (conversationLifecycle.ts ~L1004-1024) that
  // calls `summaryTopicTitle(topicId, messages)` when the gate is met:
  //   - data.isCreateNewTopic === true  → always summarize the new topic, OR
  //   - existing topic whose `title` is empty/falsy → summarize it.
  // These tests lock the PER-PATH WIRING (which path triggers the hook), not the
  // title generation mechanism itself (that's unit-tested in topic/action.test.ts).
  // They must keep passing across the upcoming lifecycle refactor.
  //
  // NOTE on async: summaryTitle() is dispatched WITHOUT await inside sendMessage.
  // Because the spy resolves synchronously and `act(async () => await ...)` flushes
  // the microtask queue, asserting on the spy right after the awaited sendMessage
  // is reliable here.
  // ───────────────────────────────────────────────────────────────────────────
  describe('post-persist title auto-gen characterization (lifecycle refactor regression net)', () => {
    it('CLIENT new-topic path: summaryTopicTitle IS invoked with the new topicId + persisted messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = TEST_IDS.SESSION_ID;
      const newTopicId = TEST_IDS.NEW_TOPIC_ID;

      const summaryTopicTitleSpy = vi.fn().mockResolvedValue(undefined);
      act(() => {
        useChatStore.setState({ summaryTopicTitle: summaryTopicTitleSpy });
      });

      const persistedMessages = [
        createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user', topicId: newTopicId }),
        createMockMessage({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          parentId: TEST_IDS.USER_MESSAGE_ID,
          role: 'assistant',
          topicId: newTopicId,
        }),
      ];

      vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        isCreateNewTopic: true,
        messages: persistedMessages,
        topicId: newTopicId,
        topics: undefined,
        userMessageId: TEST_IDS.USER_MESSAGE_ID,
      } as any);

      await act(async () => {
        await result.current.sendMessage({
          context: { agentId, threadId: null, topicId: null },
          message: TEST_CONTENT.USER_MESSAGE,
        });
      });

      // new-topic gate (data.isCreateNewTopic) → summarize the freshly created topic,
      // passing data.topicId and data.messages straight through.
      expect(summaryTopicTitleSpy).toHaveBeenCalledTimes(1);
      expect(summaryTopicTitleSpy).toHaveBeenCalledWith(
        newTopicId,
        expect.arrayContaining([
          expect.objectContaining({ id: TEST_IDS.USER_MESSAGE_ID }),
          expect.objectContaining({ id: TEST_IDS.ASSISTANT_MESSAGE_ID }),
        ]),
      );
    });

    it('CLIENT new-topic path: summaryTopicTitle still runs when the response omits isCreateNewTopic', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = TEST_IDS.SESSION_ID;
      const newTopicId = TEST_IDS.NEW_TOPIC_ID;

      const summaryTopicTitleSpy = vi.fn().mockResolvedValue(undefined);
      act(() => {
        useChatStore.setState({ summaryTopicTitle: summaryTopicTitleSpy });
      });

      const persistedMessages = [
        createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user', topicId: newTopicId }),
        createMockMessage({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          parentId: TEST_IDS.USER_MESSAGE_ID,
          role: 'assistant',
          topicId: newTopicId,
        }),
      ];

      vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        messages: persistedMessages,
        topicId: newTopicId,
        topics: undefined,
        userMessageId: TEST_IDS.USER_MESSAGE_ID,
      } as any);

      await act(async () => {
        await result.current.sendMessage({
          context: { agentId, threadId: null, topicId: null },
          message: TEST_CONTENT.USER_MESSAGE,
        });
      });

      expect(summaryTopicTitleSpy).toHaveBeenCalledWith(newTopicId, expect.any(Array));
    });

    it('CLIENT existing-topic with EMPTY title: summaryTopicTitle IS invoked', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = TEST_IDS.SESSION_ID;
      const topicId = TEST_IDS.TOPIC_ID;
      const key = messageMapKey({ agentId, topicId });

      const summaryTopicTitleSpy = vi.fn().mockResolvedValue(undefined);

      // Seed an existing topic whose title is empty — this is the second gate branch.
      // currentTopicData() keys on activeAgentId, which resetTestEnvironment set to SESSION_ID.
      act(() => {
        useChatStore.setState({
          summaryTopicTitle: summaryTopicTitleSpy,
          topicDataMap: {
            [topicMapKey({ agentId })]: {
              items: [{ id: topicId, title: '' }],
              total: 1,
            },
          } as any,
        });
      });

      const persistedMessages = [
        createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user', topicId }),
        createMockMessage({
          id: TEST_IDS.ASSISTANT_MESSAGE_ID,
          parentId: TEST_IDS.USER_MESSAGE_ID,
          role: 'assistant',
          topicId,
        }),
      ];

      vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        isCreateNewTopic: false,
        messages: persistedMessages,
        topicId,
        topics: undefined,
        userMessageId: TEST_IDS.USER_MESSAGE_ID,
      } as any);

      await act(async () => {
        await result.current.sendMessage({
          context: { agentId, threadId: null, topicId },
          message: TEST_CONTENT.USER_MESSAGE,
        });
      });

      // empty-title gate → summarize the existing topic.
      expect(summaryTopicTitleSpy).toHaveBeenCalledTimes(1);
      // First arg is the existing topic id; messages come from the display selector
      // for the topic's message key (assistant message id filtered out).
      expect(summaryTopicTitleSpy.mock.calls[0][0]).toBe(topicId);
      // sanity: the message key exists so the selector path is real
      expect(key).toBe(messageMapKey({ agentId, topicId }));
    });

    it('CLIENT existing-topic that ALREADY has a title: summaryTopicTitle is NOT invoked (gate not met)', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = TEST_IDS.SESSION_ID;
      const topicId = TEST_IDS.TOPIC_ID;

      const summaryTopicTitleSpy = vi.fn().mockResolvedValue(undefined);

      // Existing topic WITH a non-empty title → neither gate branch fires.
      act(() => {
        useChatStore.setState({
          summaryTopicTitle: summaryTopicTitleSpy,
          topicDataMap: {
            [topicMapKey({ agentId })]: {
              items: [{ id: topicId, title: 'Already has a title' }],
              total: 1,
            },
          } as any,
        });
      });

      vi.spyOn(aiChatService, 'sendMessageInServer').mockResolvedValue({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        isCreateNewTopic: false,
        messages: [
          createMockMessage({ id: TEST_IDS.USER_MESSAGE_ID, role: 'user', topicId }),
          createMockMessage({ id: TEST_IDS.ASSISTANT_MESSAGE_ID, role: 'assistant', topicId }),
        ],
        topics: undefined,
        userMessageId: TEST_IDS.USER_MESSAGE_ID,
      } as any);

      await act(async () => {
        await result.current.sendMessage({
          context: { agentId, threadId: null, topicId },
          message: TEST_CONTENT.USER_MESSAGE,
        });
      });

      expect(summaryTopicTitleSpy).not.toHaveBeenCalled();
    });

    it('GATEWAY path: summaryTopicTitle is NOT invoked on the client sendMessage lifecycle (persistence happens inside executeGatewayAgent)', async () => {
      // OBSERVED behavior: in gateway mode sendMessage delegates to
      // `executeGatewayAgent` and `return`s early (~conversationLifecycle.ts L738),
      // BEFORE reaching the post-persist summaryTitle() block (~L1024). Message
      // creation / persistence — and any title summarization — happen server-side
      // inside the gateway run, not on this client lifecycle. So the client-side
      // summaryTopicTitle hook is NOT exercised here. Locking this no-op so the
      // refactor doesn't accidentally double-fire title generation for gateway runs.
      const { result } = renderHook(() => useChatStore());

      const summaryTopicTitleSpy = vi.fn().mockResolvedValue(undefined);
      const executeGatewayAgentSpy = vi.fn().mockResolvedValue({
        assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
        operationId: 'op-gateway',
        userMessageId: TEST_IDS.USER_MESSAGE_ID,
      });

      act(() => {
        useChatStore.setState({
          executeGatewayAgent: executeGatewayAgentSpy,
          isGatewayModeEnabled: () => true,
          summaryTopicTitle: summaryTopicTitleSpy,
        });
      });

      await act(async () => {
        await result.current.sendMessage({
          context: createTestContext(),
          message: TEST_CONTENT.USER_MESSAGE,
        });
      });

      // gateway routing was actually taken (precondition for the assertion below)
      expect(executeGatewayAgentSpy).toHaveBeenCalled();
      // and the client-side post-persist title hook was NOT reached
      expect(summaryTopicTitleSpy).not.toHaveBeenCalled();
    });
  });
});
