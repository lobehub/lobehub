import { UIChatMessage } from '@lobechat/types';
import { LobeAgentConfig } from '@lobechat/types';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { INBOX_SESSION_ID } from '@/const/session';
import { useAgentStore } from '@/store/agent';
import { ChatStore } from '@/store/chat';
import { initialState } from '@/store/chat/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { createServerConfigStore } from '@/store/serverConfig/store';
import { merge } from '@/utils/merge';

import { chatSelectors } from './selectors';

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
    meta: {
      avatar: '😀',
    },
  },
  {
    id: 'msg2',
    content: 'Goodbye World',
    role: 'user',
    meta: {
      avatar: '😀',
    },
  },
  {
    id: 'msg3',
    content: 'Function Message',
    role: 'tool',
    meta: {
      avatar: DEFAULT_INBOX_AVATAR,
      backgroundColor: 'rgba(0,0,0,0)',
      description: 'inbox.desc',
      title: 'inbox.title',
    },
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
    [messageMapKey('abc')]: mockMessages,
  },
  activeId: 'abc',
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

describe('chatSelectors', () => {
  describe('getMessageById', () => {
    it('should return undefined if the message with the given id does not exist', () => {
      const message = chatSelectors.getMessageById('non-existent-id')(initialStore);
      expect(message).toBeUndefined();
    });

    it('should return the message object with the matching id', () => {
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('abc')]: mockMessages,
        },
        activeId: 'abc',
      });
      const message = chatSelectors.getMessageById('msg1')(state);
      expect(message).toEqual(mockedChats[0]);
    });

    it('should return the message with the matching id', () => {
      const message = chatSelectors.getMessageById('msg1')(mockChatStore);
      expect(message).toEqual(mockedChats[0]);
    });

    it('should return undefined if no message matches the id', () => {
      const message = chatSelectors.getMessageById('nonexistent')(mockChatStore);
      expect(message).toBeUndefined();
    });
  });

  describe('getMessageByToolCallId', () => {
    it('should return undefined if the message with the given id does not exist', () => {
      const message = chatSelectors.getMessageByToolCallId('non-existent-id')(initialStore);
      expect(message).toBeUndefined();
    });

    it('should return the message object with the matching tool_call_id', () => {
      const toolMessage = {
        id: 'msg3',
        content: 'Function Message',
        role: 'tool',
        tool_call_id: 'ttt',
        plugin: {
          arguments: 'arg1',
          identifier: 'func1',
          apiName: 'ttt',
          type: 'default',
        },
      } as UIChatMessage;
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('abc')]: [...mockMessages, toolMessage],
        },
        activeId: 'abc',
      });
      const message = chatSelectors.getMessageByToolCallId('ttt')(state);
      expect(message).toMatchObject(toolMessage);
    });
  });

  describe('currentChatsWithHistoryConfig', () => {
    it('should slice the messages according to the current agent config', () => {
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('abc')]: mockMessages,
        },
        activeId: 'abc',
      });

      const chats = chatSelectors.mainAIChatsWithHistoryConfig(state);
      expect(chats).toHaveLength(3);
      expect(chats).toEqual(mockedChats);
    });
    it('should slice the messages according to config, assuming historyCount is mocked to 2', async () => {
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('abc')]: mockMessages,
        },
        activeId: 'abc',
      });
      act(() => {
        useAgentStore.setState({
          activeId: 'inbox',
          agentMap: {
            inbox: {
              chatConfig: {
                historyCount: 2,
                enableHistoryCount: true,
              },
              model: 'abc',
            } as LobeAgentConfig,
          },
        });
      });

      const chats = chatSelectors.mainAIChatsWithHistoryConfig(state);

      expect(chats).toHaveLength(2);
      expect(chats).toEqual([
        {
          id: 'msg2',
          content: 'Goodbye World',
          role: 'user',
          meta: {
            avatar: '😀',
          },
        },
        {
          id: 'msg3',
          content: 'Function Message',
          role: 'tool',
          meta: {
            avatar: DEFAULT_INBOX_AVATAR,
            backgroundColor: 'rgba(0,0,0,0)',
            description: 'inbox.desc',
            title: 'inbox.title',
          },
          tools: [
            {
              apiName: 'ttt',
              arguments: ['arg1', 'arg2'],
              identifier: 'func1',
              id: 'abc',
              type: 'pluginType',
            },
          ],
        },
      ]);
    });
  });

  describe('mainDisplayChats', () => {
    it('should return existing messages except tool message', () => {
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('someActiveId')]: mockMessages,
        },
        activeId: 'someActiveId',
      });
      const chats = chatSelectors.mainDisplayChats(state);
      expect(chats).toEqual(mockedChats.slice(0, 2));
    });
  });

  describe('chatsMessageString', () => {
    it('should concatenate the contents of all messages returned by currentChatsWithHistoryConfig', () => {
      // Prepare a state with a few messages
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('active-session')]: mockMessages,
        },
        activeId: 'active-session',
      });

      // Assume that the currentChatsWithHistoryConfig will return the last two messages
      const expectedString = mockMessages
        .slice(-2)
        .map((m) => m.content)
        .join('');

      // Call the selector and verify the result
      const concatenatedString = chatSelectors.mainAIChatsMessageString(state);
      expect(concatenatedString).toBe(expectedString);

      // Restore the mocks after the test
      vi.restoreAllMocks();
    });
  });

  describe('latestMessageReasoningContent', () => {
    it('should return the reasoning content of the latest message', () => {
      // Prepare a state with a few messages
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('active-session')]: mockReasoningMessages,
        },
        activeId: 'active-session',
      });

      const expectedString = mockReasoningMessages.at(-1)?.reasoning?.content;

      // Call the selector and verify the result
      const reasoningContent = chatSelectors.mainAILatestMessageReasoningContent(state);
      expect(reasoningContent).toBe(expectedString);

      // Restore the mocks after the test
      vi.restoreAllMocks();
    });
  });

  describe('showInboxWelcome', () => {
    it('should return false if the active session is not the inbox session', () => {
      const state = merge(initialStore, { activeId: 'someActiveId' });
      const result = chatSelectors.showInboxWelcome(state);
      expect(result).toBe(false);
    });

    it('should return false if there are existing messages in the inbox session', () => {
      const state = merge(initialStore, {
        activeId: INBOX_SESSION_ID,
        messagesMap: {
          [messageMapKey('inbox')]: mockMessages,
        },
      });
      const result = chatSelectors.showInboxWelcome(state);
      expect(result).toBe(false);
    });

    it('should return true if the active session is the inbox session and there are no existing messages', () => {
      const state = merge(initialStore, {
        activeId: INBOX_SESSION_ID,
        messages: [],
      });
      const result = chatSelectors.showInboxWelcome(state);
      expect(result).toBe(true);
    });
  });

  describe('currentToolMessages', () => {
    it('should return only tool messages', () => {
      const messages = [
        { id: '1', role: 'user', content: 'Hello' },
        { id: '2', role: 'assistant', content: 'Hi' },
        { id: '3', role: 'tool', content: 'Tool message 1' },
        { id: '4', role: 'user', content: 'Query' },
        { id: '5', role: 'tool', tools: [] },
      ] as UIChatMessage[];
      const state: Partial<ChatStore> = {
        activeId: 'test-id',
        messagesMap: {
          [messageMapKey('test-id')]: messages,
        },
      };
      const result = chatSelectors.currentToolMessages(state as ChatStore);
      expect(result).toHaveLength(2);
      expect(result.every((msg) => msg.role === 'tool')).toBe(true);
    });

    it('should return an empty array when no tool messages exist', () => {
      const messages = [
        { id: '1', role: 'user', content: 'Hello' },
        { id: '2', role: 'assistant', content: 'Hi' },
      ] as UIChatMessage[];
      const state: Partial<ChatStore> = {
        activeId: 'test-id',
        messagesMap: {
          [messageMapKey('test-id')]: messages,
        },
      };
      const result = chatSelectors.currentToolMessages(state as ChatStore);
      expect(result).toHaveLength(0);
    });
  });

  describe('currentChatKey', () => {
    it('should generate correct key with activeId only', () => {
      const state: Partial<ChatStore> = {
        activeId: 'testId',
        activeTopicId: undefined,
      };
      const result = chatSelectors.currentChatKey(state as ChatStore);
      expect(result).toBe(messageMapKey('testId', undefined));
    });

    it('should generate correct key with both activeId and activeTopicId', () => {
      const state: Partial<ChatStore> = {
        activeId: 'testId',
        activeTopicId: 'topicId',
      };
      const result = chatSelectors.currentChatKey(state as ChatStore);
      expect(result).toBe(messageMapKey('testId', 'topicId'));
    });

    it('should generate key with undefined activeId', () => {
      const state: Partial<ChatStore> = {
        activeId: undefined,
        activeTopicId: 'topicId',
      };
      const result = chatSelectors.currentChatKey(state as ChatStore);
      expect(result).toBe(messageMapKey(undefined as any, 'topicId'));
    });

    it('should generate key with empty string activeId', () => {
      const state: Partial<ChatStore> = {
        activeId: '',
        activeTopicId: undefined,
      };
      const result = chatSelectors.currentChatKey(state as ChatStore);
      expect(result).toBe(messageMapKey('', undefined));
    });
  });

  describe('isToolCallStreaming', () => {
    it('should return true when tool call is streaming for given message and index', () => {
      const state: Partial<ChatStore> = {
        toolCallingStreamIds: {
          'msg-1': [true, false, true],
        },
      };
      expect(chatSelectors.isToolCallStreaming('msg-1', 0)(state as ChatStore)).toBe(true);
      expect(chatSelectors.isToolCallStreaming('msg-1', 2)(state as ChatStore)).toBe(true);
    });

    it('should return false when tool call is not streaming for given message and index', () => {
      const state: Partial<ChatStore> = {
        toolCallingStreamIds: {
          'msg-1': [true, false, true],
        },
      };
      expect(chatSelectors.isToolCallStreaming('msg-1', 1)(state as ChatStore)).toBe(false);
      expect(chatSelectors.isToolCallStreaming('msg-2', 0)(state as ChatStore)).toBe(false);
    });

    it('should return false when no streaming data exists for the message', () => {
      const state: Partial<ChatStore> = {
        toolCallingStreamIds: {},
      };
      expect(chatSelectors.isToolCallStreaming('msg-1', 0)(state as ChatStore)).toBe(false);
    });
  });

  describe('activeBaseChats with group chat messages', () => {
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
          [messageMapKey('group-123')]: groupChatMessages,
        },
        activeId: 'group-123',
      });

      const chats = chatSelectors.activeBaseChats(state);
      expect(chats).toHaveLength(1);
      expect(chats[0].id).toBe('msg1');
      expect(chats[0].meta).toBeDefined();
    });
  });
});
