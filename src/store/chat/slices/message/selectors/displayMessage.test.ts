import { type UIChatMessage } from '@lobechat/types';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { INBOX_SESSION_ID } from '@/const/session';
import { useAgentStore } from '@/store/agent';
import { type ChatStore } from '@/store/chat';
import { initialState } from '@/store/chat/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { createServerConfigStore } from '@/store/serverConfig/store';
import { merge } from '@/utils/merge';

import { displayMessageSelectors } from './displayMessage';

vi.mock('i18next', () => ({
  t: vi.fn((key) => key), // Simplified mock return value
}));

const initialStore = initialState as ChatStore;

const mockMessages = [
  {
    id: 'msg1',
    content: 'Hello World',
    role: 'user',
  },
  {
    id: 'msg2',
    content: 'Goodbye World',
    role: 'user',
  },
  {
    id: 'msg3',
    content: 'Function Message',
    role: 'tool',
    tools: [
      {
        arguments: ['arg1', 'arg2'],
        identifier: 'func1',
        apiName: 'ttt',
        type: 'pluginType',
        id: 'abc',
      },
    ],
  },
] as UIChatMessage[];

const mockReasoningMessages = [
  {
    id: 'msg1',
    content: 'Hello World',
    role: 'user',
  },
  {
    id: 'msg2',
    content: 'Goodbye World',
    role: 'user',
  },
  {
    id: 'msg3',
    content: 'Content Message',
    role: 'assistant',
    reasoning: {
      content: 'Reasoning Content',
    },
  },
] as UIChatMessage[];

const mockedChats = [
  {
    id: 'msg1',
    content: 'Hello World',
    role: 'user',
  },
  {
    id: 'msg2',
    content: 'Goodbye World',
    role: 'user',
  },
  {
    id: 'msg3',
    content: 'Function Message',
    role: 'tool',
    tools: [
      {
        arguments: ['arg1', 'arg2'],
        identifier: 'func1',
        apiName: 'ttt',
        type: 'pluginType',
        id: 'abc',
      },
    ],
  },
] as UIChatMessage[];

const mockChatStore = {
  messagesMap: {
    [messageMapKey({ agentId: 'abc' })]: mockMessages,
  },
  activeAgentId: 'abc',
} as ChatStore;

beforeAll(() => {
  createServerConfigStore();
});

afterEach(() => {
  const store = createServerConfigStore();
  store.setState((state) => ({
    featureFlags: { ...state.featureFlags, isAgentEditable: true },
  }));
});

describe('displayMessageSelectors', () => {
  describe('getDisplayMessageById', () => {
    it('should return undefined if the message with the given id does not exist', () => {
      const message =
        displayMessageSelectors.getDisplayMessageById('non-existent-id')(initialStore);
      expect(message).toBeUndefined();
    });

    it('should return the message object with the matching id', () => {
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey({ agentId: 'abc' })]: mockMessages,
        },
        activeAgentId: 'abc',
      });
      const message = displayMessageSelectors.getDisplayMessageById('msg1')(state);
      expect(message).toEqual(mockedChats[0]);
    });

    it('should return the message with the matching id', () => {
      const message = displayMessageSelectors.getDisplayMessageById('msg1')(mockChatStore);
      expect(message).toEqual(mockedChats[0]);
    });

    it('should return undefined if no message matches the id', () => {
      const message = displayMessageSelectors.getDisplayMessageById('nonexistent')(mockChatStore);
      expect(message).toBeUndefined();
    });
  });

  describe('mainAIChatsWithHistoryConfig', () => {
    it('should slice the messages according to the current agent config', () => {
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey({ agentId: 'abc' })]: mockMessages,
        },
        activeAgentId: 'abc',
      });

      const chats = displayMessageSelectors.mainAIChatsWithHistoryConfig(state);
      expect(chats).toHaveLength(3);
      // Verify structure without strict meta matching (meta is computed dynamically from agent store)
      expect(chats.map((c) => ({ id: c.id, content: c.content, role: c.role }))).toEqual(
        mockedChats.map((c) => ({ id: c.id, content: c.content, role: c.role })),
      );
    });

    it('should slice the messages according to config, assuming historyCount is mocked to 2', async () => {
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey({ agentId: 'abc' })]: mockMessages,
        },
        activeAgentId: 'abc',
      });
      act(() => {
        useAgentStore.setState({
          activeAgentId: 'inbox-agent',
          builtinAgentIdMap: { inbox: 'inbox-agent' },
          agentMap: {
            'inbox-agent': {
              chatConfig: {
                historyCount: 2,
                enableHistoryCount: true,
              },
              model: 'abc',
            },
          },
        });
      });

      const chats = displayMessageSelectors.mainAIChatsWithHistoryConfig(state);

      expect(chats).toHaveLength(2);
      // Verify structure without strict meta matching (meta is computed dynamically from agent store)
      expect(chats[0]).toEqual(
        expect.objectContaining({
          id: 'msg2',
          content: 'Goodbye World',
          role: 'user',
        }),
      );
      expect(chats[1]).toEqual(
        expect.objectContaining({
          id: 'msg3',
          content: 'Function Message',
          role: 'tool',
          tools: [
            {
              apiName: 'ttt',
              arguments: ['arg1', 'arg2'],
              identifier: 'func1',
              id: 'abc',
              type: 'pluginType',
            },
          ],
        }),
      );
    });
  });

  describe('mainAIChatsMessageString', () => {
    it('should concatenate the contents of all messages returned by mainAIChatsWithHistoryConfig', () => {
      // Prepare a state with a few messages
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey({ agentId: 'active-session' })]: mockMessages,
        },
        activeAgentId: 'active-session',
      });

      // Assume that the mainAIChatsWithHistoryConfig will return the last two messages
      const expectedString = mockMessages
        .slice(-2)
        .map((m) => m.content)
        .join('');

      // Call the selector and verify the result
      const concatenatedString = displayMessageSelectors.mainAIChatsMessageString(state);
      expect(concatenatedString).toBe(expectedString);

      // Restore the mocks after the test
      vi.restoreAllMocks();
    });
  });

  describe('mainAILatestMessageReasoningContent', () => {
    it('should return the reasoning content of the latest message', () => {
      // Prepare a state with a few messages
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey({ agentId: 'active-session' })]: mockReasoningMessages,
        },
        activeAgentId: 'active-session',
      });

      const expectedString = mockReasoningMessages.at(-1)?.reasoning?.content;

      // Call the selector and verify the result
      const reasoningContent = displayMessageSelectors.mainAILatestMessageReasoningContent(state);
      expect(reasoningContent).toBe(expectedString);

      // Restore the mocks after the test
      vi.restoreAllMocks();
    });
  });

  describe('showInboxWelcome', () => {
    it('should return false if the active session is not the inbox session', () => {
      const state = merge(initialStore, { activeAgentId: 'someActiveId' });
      const result = displayMessageSelectors.showInboxWelcome(state);
      expect(result).toBe(false);
    });

    it('should return false if there are existing messages in the inbox session', () => {
      const state = merge(initialStore, {
        activeAgentId: INBOX_SESSION_ID,
        messagesMap: {
          [messageMapKey({ agentId: 'inbox' })]: mockMessages,
        },
      });
      const result = displayMessageSelectors.showInboxWelcome(state);
      expect(result).toBe(false);
    });

    it('should return true if the active session is the inbox session and there are no existing messages', () => {
      const state = merge(initialStore, {
        activeAgentId: INBOX_SESSION_ID,
        messages: [],
      });
      const result = displayMessageSelectors.showInboxWelcome(state);
      expect(result).toBe(true);
    });
  });

  describe('currentDisplayChatKey', () => {
    it('should generate correct key with activeAgentId only', () => {
      const state: Partial<ChatStore> = {
        activeAgentId: 'testId',
        activeTopicId: undefined,
      };
      const result = displayMessageSelectors.currentDisplayChatKey(state as ChatStore);
      expect(result).toBe(messageMapKey({ agentId: 'testId', topicId: undefined }));
    });

    it('should generate correct key with both activeAgentId and activeTopicId', () => {
      const state: Partial<ChatStore> = {
        activeAgentId: 'testId',
        activeTopicId: 'topicId',
      };
      const result = displayMessageSelectors.currentDisplayChatKey(state as ChatStore);
      expect(result).toBe(messageMapKey({ agentId: 'testId', topicId: 'topicId' }));
    });

    it('should generate key with undefined activeAgentId', () => {
      const state: Partial<ChatStore> = {
        activeAgentId: undefined,
        activeTopicId: 'topicId',
      };
      const result = displayMessageSelectors.currentDisplayChatKey(state as ChatStore);
      expect(result).toBe(messageMapKey({ agentId: undefined as any, topicId: 'topicId' }));
    });

    it('should generate key with empty string activeAgentId', () => {
      const state: Partial<ChatStore> = {
        activeAgentId: '',
        activeTopicId: undefined,
      };
      const result = displayMessageSelectors.currentDisplayChatKey(state as ChatStore);
      expect(result).toBe(messageMapKey({ agentId: '', topicId: undefined }));
    });

    it('should generate correct key with activeGroupId for group conversations', () => {
      const state: Partial<ChatStore> = {
        activeAgentId: 'testId',
        activeGroupId: 'groupId',
        activeTopicId: undefined,
      };
      const result = displayMessageSelectors.currentDisplayChatKey(state as ChatStore);
      expect(result).toBe(
        messageMapKey({ agentId: 'testId', groupId: 'groupId', topicId: undefined }),
      );
    });

    it('should generate correct key with activeGroupId and activeTopicId', () => {
      const state: Partial<ChatStore> = {
        activeAgentId: 'testId',
        activeGroupId: 'groupId',
        activeTopicId: 'topicId',
      };
      const result = displayMessageSelectors.currentDisplayChatKey(state as ChatStore);
      expect(result).toBe(
        messageMapKey({ agentId: 'testId', groupId: 'groupId', topicId: 'topicId' }),
      );
    });

    it('should generate correct key with activeThreadId for thread conversations', () => {
      const state: Partial<ChatStore> = {
        activeAgentId: 'testId',
        activeThreadId: 'threadId',
        activeTopicId: 'topicId',
      };
      const result = displayMessageSelectors.currentDisplayChatKey(state as ChatStore);
      expect(result).toBe('thread_testId_topicId_threadId');
    });
  });

  describe('activeDisplayMessages with group chat messages', () => {
    it('should retrieve agent meta for group chat messages with groupId and agentId', () => {
      const groupChatMessages = [
        {
          id: 'msg1',
          content: 'Hello from agent',
          role: 'assistant',
          groupId: 'group-123',
          agentId: 'agent-456',
        },
      ] as UIChatMessage[];

      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey({ agentId: 'group-123' })]: groupChatMessages,
        },
        activeAgentId: 'group-123',
      });

      const chats = displayMessageSelectors.activeDisplayMessages(state);
      expect(chats).toHaveLength(1);
      expect(chats[0].id).toBe('msg1');
    });
  });

  describe('getGroupLatestMessageWithoutTools', () => {
    it('should return the last child without tools', () => {
      const groupMessage = {
        id: 'group-1',
        role: 'assistantGroup',
        content: '',
        children: [
          {
            id: 'child-1',
            content: 'First response',
            tools: [
              {
                id: 'tool-1',
                identifier: 'test',
                apiName: 'test',
                arguments: '{}',
                type: 'default',
              },
            ],
          },
          {
            id: 'child-2',
            content: 'Second response',
            tools: [],
          },
          {
            id: 'child-3',
            content: 'Final response',
          },
        ],
      } as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [groupMessage],
        },
      };

      const result = displayMessageSelectors.getGroupLatestMessageWithoutTools('group-1')(
        state as ChatStore,
      );
      expect(result).toBeDefined();
      expect(result?.id).toBe('child-3');
      expect(result?.content).toBe('Final response');
    });

    it('should return undefined if the last child has tools', () => {
      const groupMessage = {
        id: 'group-2',
        role: 'assistantGroup',
        content: '',
        children: [
          {
            id: 'child-1',
            content: 'First response',
          },
          {
            id: 'child-2',
            content: 'Second response with tools',
            tools: [
              {
                id: 'tool-1',
                identifier: 'test',
                apiName: 'test',
                arguments: '{}',
                type: 'default',
              },
            ],
          },
        ],
      } as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [groupMessage],
        },
      };

      const result = displayMessageSelectors.getGroupLatestMessageWithoutTools('group-2')(
        state as ChatStore,
      );
      expect(result).toBeUndefined();
    });

    it('should return the last child when it has empty tools array', () => {
      const groupMessage = {
        id: 'group-3',
        role: 'assistantGroup',
        content: '',
        children: [
          {
            id: 'child-1',
            content: 'First response with tools',
            tools: [
              {
                id: 'tool-1',
                identifier: 'test',
                apiName: 'test',
                arguments: '{}',
                type: 'default',
              },
            ],
          },
          {
            id: 'child-2',
            content: 'Final response',
            tools: [],
          },
        ],
      } as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [groupMessage],
        },
      };

      const result = displayMessageSelectors.getGroupLatestMessageWithoutTools('group-3')(
        state as ChatStore,
      );
      expect(result).toBeDefined();
      expect(result?.id).toBe('child-2');
      expect(result?.content).toBe('Final response');
    });

    it('should return undefined for non-group messages', () => {
      const assistantMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Regular message',
      } as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [assistantMessage],
        },
      };

      const result = displayMessageSelectors.getGroupLatestMessageWithoutTools('msg-1')(
        state as ChatStore,
      );
      expect(result).toBeUndefined();
    });

    it('should return undefined for group messages without children', () => {
      const groupMessage = {
        id: 'group-4',
        role: 'assistantGroup',
        content: '',
        children: undefined,
      } as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [groupMessage],
        },
      };

      const result = displayMessageSelectors.getGroupLatestMessageWithoutTools('group-4')(
        state as ChatStore,
      );
      expect(result).toBeUndefined();
    });

    it('should return undefined for group messages with empty children array', () => {
      const groupMessage = {
        id: 'group-5',
        role: 'assistantGroup',
        content: '',
        children: [],
      } as unknown as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [groupMessage],
        },
      };

      const result = displayMessageSelectors.getGroupLatestMessageWithoutTools('group-5')(
        state as ChatStore,
      );
      expect(result).toBeUndefined();
    });

    it('should return undefined if all children have tools', () => {
      const groupMessage = {
        id: 'group-6',
        role: 'assistantGroup',
        content: '',
        children: [
          {
            id: 'child-1',
            content: 'First response',
            tools: [
              {
                id: 'tool-1',
                identifier: 'test',
                apiName: 'test',
                arguments: '{}',
                type: 'default',
              },
            ],
          },
          {
            id: 'child-2',
            content: 'Second response',
            tools: [
              {
                id: 'tool-2',
                identifier: 'test2',
                apiName: 'test2',
                arguments: '{}',
                type: 'default',
              },
            ],
          },
        ],
      } as unknown as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [groupMessage],
        },
      };

      const result = displayMessageSelectors.getGroupLatestMessageWithoutTools('group-6')(
        state as ChatStore,
      );
      expect(result).toBeUndefined();
    });

    it('should handle empty tools array as no tools', () => {
      const groupMessage = {
        id: 'group-7',
        role: 'assistantGroup',
        content: '',
        children: [
          {
            id: 'child-1',
            content: 'Response with empty tools',
            tools: [],
          },
        ],
      } as unknown as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [groupMessage],
        },
      };

      const result = displayMessageSelectors.getGroupLatestMessageWithoutTools('group-7')(
        state as ChatStore,
      );
      expect(result).toBeDefined();
      expect(result?.id).toBe('child-1');
    });

    it('should return undefined when message is not found', () => {
      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [],
        },
      };

      const result = displayMessageSelectors.getGroupLatestMessageWithoutTools('non-existent')(
        state as ChatStore,
      );
      expect(result).toBeUndefined();
    });
  });

  describe('findLastMessageId', () => {
    it('should return message id when no children or tools', () => {
      const message = {
        id: 'msg-1',
        role: 'assistant',
        content: 'Simple message',
      } as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [message],
        },
      };

      const result = displayMessageSelectors.findLastMessageId('msg-1')(state as ChatStore);
      expect(result).toBe('msg-1');
    });

    it('should find the last child id', () => {
      const groupMessage = {
        id: 'group-1',
        role: 'assistantGroup',
        content: '',
        children: [
          {
            id: 'child-1',
            content: 'First response',
          },
          {
            id: 'child-2',
            content: 'Second response',
          },
        ],
      } as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [groupMessage],
        },
      };

      const result = displayMessageSelectors.findLastMessageId('group-1')(state as ChatStore);
      expect(result).toBe('child-2');
    });

    it('should return tool result_msg_id when no children', () => {
      const messageWithTools = {
        id: 'msg-with-tools',
        role: 'assistant',
        content: 'Message with tools',
        tools: [
          {
            id: 'tool-1',
            identifier: 'test',
            apiName: 'test',
            arguments: '{}',
            type: 'default',
            result_msg_id: 'tool-result-1',
          },
          {
            id: 'tool-2',
            identifier: 'test2',
            apiName: 'test2',
            arguments: '{}',
            type: 'default',
            result_msg_id: 'tool-result-2',
          },
        ],
      } as unknown as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [messageWithTools],
        },
      };

      const result = displayMessageSelectors.findLastMessageId('msg-with-tools')(
        state as ChatStore,
      );
      expect(result).toBe('tool-result-2');
    });

    it('should prioritize children over tools', () => {
      const message = {
        id: 'msg-1',
        role: 'assistantGroup',
        content: '',
        children: [
          {
            id: 'child-1',
            content: 'Child message',
          },
        ],
        tools: [
          {
            id: 'tool-1',
            identifier: 'test',
            apiName: 'test',
            arguments: '{}',
            type: 'default',
            result_msg_id: 'tool-result-1',
          },
        ],
      } as unknown as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [message],
        },
      };

      const result = displayMessageSelectors.findLastMessageId('msg-1')(state as ChatStore);
      expect(result).toBe('child-1');
    });

    it('should return undefined for non-existent message', () => {
      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [],
        },
      };

      const result = displayMessageSelectors.findLastMessageId('non-existent')(state as ChatStore);
      expect(result).toBeUndefined();
    });

    it('should return last child with tools result_msg_id', () => {
      const messageWithChildrenAndTools = {
        id: 'msg-1',
        role: 'assistantGroup',
        content: '',
        children: [
          {
            id: 'child-1',
            content: 'First child',
          },
          {
            id: 'child-2',
            content: 'Second child with tools',
            tools: [
              {
                id: 'tool-1',
                identifier: 'test',
                apiName: 'test',
                arguments: '{}',
                type: 'default',
                result_msg_id: 'tool-result-id',
              },
            ],
          },
        ],
      } as unknown as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [messageWithChildrenAndTools],
        },
      };

      const result = displayMessageSelectors.findLastMessageId('msg-1')(state as ChatStore);
      expect(result).toBe('tool-result-id');
    });

    it('should return lastMessageId for compressedGroup instead of group id', () => {
      const compressedGroupMessage = {
        id: 'mg_123456',
        role: 'compressedGroup',
        content: 'Compressed summary',
        lastMessageId: 'msg-999',
        compressedMessages: [],
        pinnedMessages: [],
      } as unknown as UIChatMessage;

      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        messagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: [compressedGroupMessage],
        },
      };

      const result = displayMessageSelectors.findLastMessageId('mg_123456')(state as ChatStore);
      expect(result).toBe('msg-999');
    });
  });
});
