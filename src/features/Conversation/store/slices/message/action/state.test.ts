import { type UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';

import { createStore } from '../../../index';

const { chatStoreMock } = vi.hoisted(() => ({
  chatStoreMock: {
    cancelOperations: vi.fn(),
  },
}));

// Mock conversation-flow parse function
vi.mock('@lobechat/conversation-flow', () => ({
  parse: (messages: UIChatMessage[]) => {
    const messageMap: Record<string, UIChatMessage> = {};
    for (const msg of messages) {
      messageMap[msg.id] = msg;
    }
    const flatList = [...messages].sort((a, b) => a.createdAt - b.createdAt);
    return { flatList, messageMap };
  },
}));

// Mock messageService
vi.mock('@/services/message', () => ({
  messageService: {
    cancelCompression: vi.fn(),
    getMessages: vi.fn(),
    updateMessageGroupMetadata: vi.fn(),
    updateMessageMetadata: vi.fn().mockResolvedValue({ success: true, messages: [] }),
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: () => chatStoreMock,
  },
}));

// Mock SWR
vi.mock('@/libs/swr', () => ({
  useClientDataSWRWithSync: vi.fn(() => ({ data: undefined, isLoading: true })),
}));

const createTestStore = (options?: { agentId?: string; topicId?: string | null }) =>
  createStore({
    context: {
      agentId: options?.agentId ?? 'test-agent',
      threadId: null,
      topicId: options?.topicId === null ? null : (options?.topicId ?? 'test-topic'),
    },
  });

describe('MessageStateAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cancelCompression', () => {
    it('should cancel running compression operations before restoring messages', async () => {
      const store = createTestStore();

      const compressedGroup: UIChatMessage = {
        id: 'group-1',
        content: 'Summary content',
        role: 'compressedGroup' as any,
        createdAt: 1000,
        updatedAt: 1000,
      };
      const restoredMessages: UIChatMessage[] = [
        {
          id: 'msg-1',
          content: 'Original content',
          role: 'user',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ];

      store.setState({ displayMessages: [compressedGroup] });
      vi.mocked(messageService.cancelCompression).mockResolvedValue({ messages: restoredMessages });

      const replaceMessagesSpy = vi.spyOn(store.getState(), 'replaceMessages');

      await store.getState().cancelCompression('group-1');

      expect(chatStoreMock.cancelOperations).toHaveBeenCalledWith(
        { messageId: 'group-1', status: 'running' },
        'Compression cancelled',
      );
      expect(messageService.cancelCompression).toHaveBeenCalledWith({
        agentId: 'test-agent',
        groupId: undefined,
        messageGroupId: 'group-1',
        threadId: null,
        topicId: 'test-topic',
      });
      expect(replaceMessagesSpy).toHaveBeenCalledWith(restoredMessages, {
        expectedContext: {
          agentId: 'test-agent',
          threadId: null,
          topicId: 'test-topic',
        },
      });
    });
  });
});
