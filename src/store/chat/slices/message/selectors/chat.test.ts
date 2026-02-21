import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { type ChatStore } from '@/store/chat';
import { initialState } from '@/store/chat/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { createServerConfigStore } from '@/store/serverConfig/store';
import { merge } from '@/utils/merge';

import { chatSelectors } from './chat';

vi.mock('i18next', () => ({
  t: vi.fn((key) => key),
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
] as UIChatMessage[];

beforeAll(() => {
  createServerConfigStore();
});

describe('chatSelectors - Backward Compatibility Layer', () => {
  describe('getMessageById', () => {
    it('should work as backward compatibility alias for getDisplayMessageById', () => {
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey({ agentId: 'abc' })]: mockMessages,
        },
        activeAgentId: 'abc',
      });
      const message = chatSelectors.getMessageById('msg1')(state);
      expect(message?.id).toBe('msg1');
      expect(message?.content).toBe('Hello World');
    });
  });

  describe('currentChatKey', () => {
    it('should work as backward compatibility alias for currentDisplayChatKey', () => {
      const state: Partial<ChatStore> = {
        activeAgentId: 'testId',
        activeTopicId: 'topicId',
      };
      const result = chatSelectors.currentChatKey(state as ChatStore);
      expect(result).toBe(messageMapKey({ agentId: 'testId', topicId: 'topicId' }));
    });
  });

  describe('activeBaseChats', () => {
    it('should work as backward compatibility alias for activeDisplayMessages', () => {
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey({ agentId: 'abc' })]: mockMessages,
        },
        activeAgentId: 'abc',
      });
      const chats = chatSelectors.activeBaseChats(state);
      expect(chats).toHaveLength(2);
      expect(chats[0].id).toBe('msg1');
    });
  });

  describe('currentToolMessages', () => {
    it('should work as backward compatibility alias for dbToolMessages', () => {
      const messages = [
        { id: '1', role: 'user', content: 'Hello' },
        { id: '2', role: 'tool', content: 'Tool message' },
      ] as UIChatMessage[];
      const state: Partial<ChatStore> = {
        activeAgentId: 'test-id',
        dbMessagesMap: {
          [messageMapKey({ agentId: 'test-id' })]: messages,
        },
      };
      const result = chatSelectors.currentToolMessages(state as ChatStore);
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('tool');
    });
  });
});
