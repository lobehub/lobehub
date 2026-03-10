import { type UIChatMessage } from '@lobechat/types';
import { act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useClientDataSWRWithSync } from '@/libs/swr';
import { messageService } from '@/services/message';

import { createStore } from '../../index';
import { dataSelectors } from './selectors';

// Mock conversation-flow parse function
vi.mock('@lobechat/conversation-flow', () => ({
  parse: (messages: UIChatMessage[]) => {
    const messageMap: Record<string, UIChatMessage> = {};
    for (const msg of messages) {
      messageMap[msg.id] = msg;
    }
    // Sort by createdAt for flatList
    const flatList = [...messages].sort((a, b) => a.createdAt - b.createdAt);
    return { flatList, messageMap };
  },
}));

// Mock messageService
vi.mock('@/services/message', () => ({
  messageService: {
    getMessages: vi.fn(),
    updateMessageMetadata: vi.fn().mockResolvedValue({ success: true, messages: [] }),
  },
}));

// Mock SWR
vi.mock('@/libs/swr', () => ({
  useClientDataSWRWithSync: vi.fn((key, fetcher, options) => {
    // Simulate SWR behavior for testing
    if (key) {
      fetcher?.().then((data: UIChatMessage[]) => {
        options?.onData?.(data);
      });
    }

    return { data: undefined, isLoading: true };
  }),
}));

// Create a test store
const createTestStore = () =>
  createStore({
    context: { agentId: 'test-session', topicId: null, threadId: null },
  });

describe('DataSlice', () => {
  describe('internal_dispatchMessage', () => {
    it('should create a new message', () => {
      const store = createTestStore();

      store.getState().internal_dispatchMessage({
        type: 'createMessage',
        id: 'msg-1',
        value: {
          content: 'Hello',
          role: 'user',
          agentId: 'session-1',
        },
      });

      const state = store.getState();
      expect(state.displayMessages).toHaveLength(1);
      expect(state.displayMessages[0].id).toBe('msg-1');
      expect(state.displayMessages[0].content).toBe('Hello');
      expect(state.displayMessages[0].role).toBe('user');
    });

    it('should update an existing message', () => {
      const store = createTestStore();

      // First create a message
      store.getState().internal_dispatchMessage({
        type: 'createMessage',
        id: 'msg-1',
        value: {
          content: 'Hello',
          role: 'user',
          agentId: 'session-1',
        },
      });

      // Then update it
      store.getState().internal_dispatchMessage({
        type: 'updateMessage',
        id: 'msg-1',
        value: { content: 'Updated Hello' },
      });

      const state = store.getState();
      expect(state.displayMessages).toHaveLength(1);
      expect(state.displayMessages[0].content).toBe('Updated Hello');
    });

    it('should delete a message', () => {
      const store = createTestStore();

      // Create two messages
      store.getState().internal_dispatchMessage({
        type: 'createMessage',
        id: 'msg-1',
        value: { content: 'Message 1', role: 'user', sessionId: 'session-1' },
      });
      store.getState().internal_dispatchMessage({
        type: 'createMessage',
        id: 'msg-2',
        value: { content: 'Message 2', role: 'assistant', sessionId: 'session-1' },
      });

      expect(store.getState().displayMessages).toHaveLength(2);

      // Delete one
      store.getState().internal_dispatchMessage({
        type: 'deleteMessage',
        id: 'msg-1',
      });

      const state = store.getState();
      expect(state.displayMessages).toHaveLength(1);
      expect(state.displayMessages[0].id).toBe('msg-2');
    });

    it('should not update state if message does not exist', () => {
      const store = createTestStore();

      const initialMessages = store.getState().displayMessages;

      store.getState().internal_dispatchMessage({
        type: 'updateMessage',
        id: 'nonexistent',
        value: { content: 'Updated' },
      });

      // State should remain unchanged (same reference)
      expect(store.getState().displayMessages).toBe(initialMessages);
    });

    it('should update message metadata', () => {
      const store = createTestStore();

      // Create a message
      store.getState().internal_dispatchMessage({
        type: 'createMessage',
        id: 'msg-1',
        value: { content: 'Hello', role: 'user', sessionId: 'session-1' },
      });

      // Update metadata
      store.getState().internal_dispatchMessage({
        type: 'updateMessageMetadata',
        id: 'msg-1',
        value: { collapsed: true },
      });

      const state = store.getState();
      // Check both dbMessages and displayMessages
      const dbMsg = state.dbMessages.find((m) => m.id === 'msg-1');
      expect(dbMsg?.metadata?.collapsed).toBe(true);
      const displayMsg = state.displayMessages.find((m) => m.id === 'msg-1');
      expect(displayMsg?.metadata?.collapsed).toBe(true);
    });

    it('should update messageGroup metadata (compressedGroup)', () => {
      const store = createTestStore();

      // Simulate a compressedGroup in displayMessages (injected during query, not in dbMessages)
      const compressedGroup: UIChatMessage = {
        id: 'group-1',
        content: 'Summary content',
        role: 'compressedGroup' as any,
        createdAt: 1000,
        updatedAt: 1000,
        metadata: { expanded: false } as any,
      };

      // Manually set displayMessages to include compressedGroup
      store.setState({ displayMessages: [compressedGroup] });

      // Update messageGroup metadata
      store.getState().internal_dispatchMessage({
        type: 'updateMessageGroupMetadata',
        id: 'group-1',
        value: { expanded: true },
      });

      const state = store.getState();
      // compressedGroup should only be in displayMessages, not dbMessages
      expect(state.dbMessages).toHaveLength(0);
      expect(state.displayMessages).toHaveLength(1);
      expect((state.displayMessages[0].metadata as any)?.expanded).toBe(true);
    });

    it('should not update messageGroup metadata if message does not exist', () => {
      const store = createTestStore();

      const initialDisplayMessages = store.getState().displayMessages;

      store.getState().internal_dispatchMessage({
        type: 'updateMessageGroupMetadata',
        id: 'nonexistent',
        value: { expanded: true },
      });

      // State should remain unchanged
      expect(store.getState().displayMessages).toBe(initialDisplayMessages);
    });

    it('should merge messageGroup metadata with existing values', () => {
      const store = createTestStore();

      // Simulate a compressedGroup with existing metadata
      const compressedGroup: UIChatMessage = {
        id: 'group-1',
        content: 'Summary content',
        role: 'compressedGroup' as any,
        createdAt: 1000,
        updatedAt: 1000,
        metadata: { expanded: false, someOtherField: 'preserved' } as any,
      };

      store.setState({ displayMessages: [compressedGroup] });

      // Update only expanded
      store.getState().internal_dispatchMessage({
        type: 'updateMessageGroupMetadata',
        id: 'group-1',
        value: { expanded: true },
      });

      const state = store.getState();
      const metadata = state.displayMessages[0].metadata as any;
      expect(metadata?.expanded).toBe(true);
      expect(metadata?.someOtherField).toBe('preserved');
    });
  });

  describe('replaceMessages', () => {
    it('should replace all messages with new data', () => {
      const store = createTestStore();

      // First add some messages
      store.getState().internal_dispatchMessage({
        type: 'createMessage',
        id: 'old-msg',
        value: { content: 'Old', role: 'user', sessionId: 'session-1' },
      });

      expect(store.getState().displayMessages).toHaveLength(1);

      // Replace with new messages
      const newMessages: UIChatMessage[] = [
        {
          id: 'new-msg-1',
          content: 'New 1',
          role: 'user',
          createdAt: 1000,
          updatedAt: 1000,
        },
        {
          id: 'new-msg-2',
          content: 'New 2',
          role: 'assistant',
          createdAt: 2000,
          updatedAt: 2000,
        },
      ];

      store.getState().replaceMessages(newMessages);

      const state = store.getState();
      expect(state.displayMessages).toHaveLength(2);
      expect(state.displayMessages[0].id).toBe('new-msg-1');
      expect(state.displayMessages[1].id).toBe('new-msg-2');
      expect(state.dbMessages.find((m) => m.id === 'old-msg')).toBeUndefined();
    });

    it('should handle empty messages array', () => {
      const store = createTestStore();

      // Add a message first
      store.getState().internal_dispatchMessage({
        type: 'createMessage',
        id: 'msg-1',
        value: { content: 'Hello', role: 'user', sessionId: 'session-1' },
      });

      // Replace with empty
      store.getState().replaceMessages([]);

      const state = store.getState();
      expect(state.displayMessages).toHaveLength(0);
      expect(state.dbMessages).toHaveLength(0);
    });
  });

  describe('selectors', () => {
    it('displayMessages should return display messages array', () => {
      const store = createTestStore();

      store.getState().internal_dispatchMessage({
        type: 'createMessage',
        id: 'msg-1',
        value: { content: 'Hello', role: 'user', sessionId: 'session-1' },
      });

      const messages = dataSelectors.displayMessages(store.getState());
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
    });

    it('displayMessageIds should return array of message IDs', () => {
      const store = createTestStore();

      store.getState().internal_dispatchMessage({
        type: 'createMessage',
        id: 'msg-1',
        value: { content: 'Hello', role: 'user', sessionId: 'session-1' },
      });
      store.getState().internal_dispatchMessage({
        type: 'createMessage',
        id: 'msg-2',
        value: { content: 'World', role: 'assistant', sessionId: 'session-1' },
      });

      const ids = dataSelectors.displayMessageIds(store.getState());
      expect(ids).toContain('msg-1');
      expect(ids).toContain('msg-2');
    });

    it('getDisplayMessageById should find message by ID', () => {
      const store = createTestStore();

      store.getState().internal_dispatchMessage({
        type: 'createMessage',
        id: 'msg-1',
        value: { content: 'Hello', role: 'user', sessionId: 'session-1' },
      });

      const message = dataSelectors.getDisplayMessageById('msg-1')(store.getState());
      expect(message?.content).toBe('Hello');

      const notFound = dataSelectors.getDisplayMessageById('nonexistent')(store.getState());
      expect(notFound).toBeUndefined();
    });

    it('getDbMessageById should find message from dbMessages', () => {
      const store = createTestStore();

      store.getState().internal_dispatchMessage({
        type: 'createMessage',
        id: 'msg-1',
        value: { content: 'Hello', role: 'user', sessionId: 'session-1' },
      });

      const message = dataSelectors.getDbMessageById('msg-1')(store.getState());
      expect(message?.content).toBe('Hello');
    });

    it('messagesInit should return initialization state', () => {
      const store = createTestStore();

      expect(dataSelectors.messagesInit(store.getState())).toBe(false);
    });

    describe('getGroupLatestMessageWithoutTools', () => {
      it('should return undefined for non-existent message', () => {
        const store = createTestStore();

        const result = dataSelectors.getGroupLatestMessageWithoutTools('non-existent')(
          store.getState(),
        );
        expect(result).toBeUndefined();
      });

      it('should return undefined for non-group message', () => {
        const store = createTestStore();

        store.getState().internal_dispatchMessage({
          type: 'createMessage',
          id: 'msg-1',
          value: { content: 'Hello', role: 'user', sessionId: 'session-1' },
        });

        const result = dataSelectors.getGroupLatestMessageWithoutTools('msg-1')(store.getState());
        expect(result).toBeUndefined();
      });

      it('should return last child without tools from assistantGroup', () => {
        const store = createTestStore();

        // Create a group message with children
        const groupMessage = {
          id: 'group-1',
          content: '',
          role: 'assistantGroup' as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          children: [
            { id: 'child-1', content: 'First response', role: 'assistant' as const },
            { id: 'child-2', content: 'Second response', role: 'assistant' as const },
          ],
        };

        store.getState().replaceMessages([groupMessage as any]);

        const result = dataSelectors.getGroupLatestMessageWithoutTools('group-1')(store.getState());
        expect(result?.id).toBe('child-2');
        expect(result?.content).toBe('Second response');
      });

      it('should return undefined if last child has tools', () => {
        const store = createTestStore();

        const groupMessage = {
          id: 'group-1',
          content: '',
          role: 'assistantGroup' as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          children: [
            { id: 'child-1', content: 'First response', role: 'assistant' as const },
            {
              id: 'child-2',
              content: 'Second response',
              role: 'assistant' as const,
              tools: [
                {
                  id: 'tool-1',
                  type: 'default',
                  identifier: 'test',
                  apiName: 'test',
                  arguments: '',
                },
              ],
            },
          ],
        };

        store.getState().replaceMessages([groupMessage as any]);

        const result = dataSelectors.getGroupLatestMessageWithoutTools('group-1')(store.getState());
        expect(result).toBeUndefined();
      });

      it('should return undefined if last child has no content', () => {
        const store = createTestStore();

        const groupMessage = {
          id: 'group-1',
          content: '',
          role: 'assistantGroup' as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          children: [
            { id: 'child-1', content: 'First response', role: 'assistant' as const },
            { id: 'child-2', content: '', role: 'assistant' as const },
          ],
        };

        store.getState().replaceMessages([groupMessage as any]);

        const result = dataSelectors.getGroupLatestMessageWithoutTools('group-1')(store.getState());
        expect(result).toBeUndefined();
      });

      it('should return undefined for group with empty children', () => {
        const store = createTestStore();

        const groupMessage = {
          id: 'group-1',
          content: '',
          role: 'assistantGroup' as const,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          children: [],
        };

        store.getState().replaceMessages([groupMessage as any]);

        const result = dataSelectors.getGroupLatestMessageWithoutTools('group-1')(store.getState());
        expect(result).toBeUndefined();
      });
    });
  });

  describe('useFetchMessages', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should pass threadId to messageService.getMessages', async () => {
      const mockMessages: UIChatMessage[] = [
        {
          id: 'thread-msg-1',
          content: 'Thread message',
          role: 'user',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ];

      vi.mocked(messageService.getMessages).mockResolvedValue(mockMessages);

      const store = createStore({
        context: { agentId: 'test-session', topicId: 'test-topic', threadId: 'test-thread' },
      });

      // Call useFetchMessages - this triggers the SWR mock
      store.getState().useFetchMessages({
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: 'test-thread',
      });

      await waitFor(() => {
        expect(messageService.getMessages).toHaveBeenCalledWith({
          agentId: 'test-session',
          threadId: 'test-thread',
          topicId: 'test-topic',
        });
      });
    });

    it('should pass null threadId when provided as null', async () => {
      const mockMessages: UIChatMessage[] = [
        {
          id: 'msg-1',
          content: 'Regular message',
          role: 'user',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ];

      vi.mocked(messageService.getMessages).mockResolvedValue(mockMessages);

      const store = createStore({
        context: { agentId: 'test-session', topicId: 'test-topic', threadId: null },
      });

      store.getState().useFetchMessages({
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: null,
      });

      await waitFor(() => {
        expect(messageService.getMessages).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: 'test-session',
            topicId: 'test-topic',
          }),
        );
      });
    });

    it('should not fetch when sessionId is empty', () => {
      const store = createStore({
        context: { agentId: '', topicId: null, threadId: null },
      });

      store.getState().useFetchMessages({
        agentId: '',
        topicId: null,
        threadId: null,
      });

      // SWR should be called with null key (disabled)
      expect(vi.mocked(useClientDataSWRWithSync)).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('should not fetch when topicId is null (new conversation state)', () => {
      const store = createStore({
        context: { agentId: 'test-session', topicId: null, threadId: null },
      });

      store.getState().useFetchMessages({
        agentId: 'test-session',
        topicId: null,
        threadId: null,
      });

      // SWR should be called with null key when topicId is null
      // This prevents fetching empty data that would overwrite local optimistic updates
      expect(vi.mocked(useClientDataSWRWithSync)).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        expect.any(Object),
      );

      // messageService.getMessages should NOT be called
      expect(messageService.getMessages).not.toHaveBeenCalled();
    });

    it('should not fetch when topicId is undefined (new conversation state)', () => {
      const store = createStore({
        context: { agentId: 'test-session', topicId: null, threadId: null },
      });

      store.getState().useFetchMessages({
        agentId: 'test-session',
        topicId: undefined as any,
        threadId: null,
      });

      // SWR should be called with null key when topicId is undefined
      expect(vi.mocked(useClientDataSWRWithSync)).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('should use different SWR keys for different threadIds', () => {
      const store1 = createStore({
        context: { agentId: 'session-1', topicId: 'topic-1', threadId: 'thread-1' },
      });

      store1.getState().useFetchMessages({
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: 'thread-1',
      });

      const firstCallKey = vi.mocked(useClientDataSWRWithSync).mock.calls[0][0];

      const store2 = createStore({
        context: { agentId: 'session-1', topicId: 'topic-1', threadId: 'thread-2' },
      });

      store2.getState().useFetchMessages({
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: 'thread-2',
      });

      const secondCallKey = vi.mocked(useClientDataSWRWithSync).mock.calls[1][0];

      // Keys should be different because threadIds are different
      expect(firstCallKey).not.toEqual(secondCallKey);
      expect((firstCallKey as any[])[1].threadId).toBe('thread-1');
      expect((secondCallKey as any[])[1].threadId).toBe('thread-2');
    });

    it('should use same SWR key structure with Object containing sessionId, topicId, threadId', () => {
      const store = createStore({
        context: { agentId: 'test-session', topicId: 'test-topic', threadId: 'test-thread' },
      });

      store.getState().useFetchMessages({
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: 'test-thread',
      });

      const swrKey = vi.mocked(useClientDataSWRWithSync).mock.calls[0][0] as any[];

      // Key should be an array with prefix and context object
      expect(Array.isArray(swrKey)).toBe(true);
      expect(swrKey[0]).toBe('CONVERSATION_FETCH_MESSAGES');
      expect(swrKey[1]).toEqual({
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: 'test-thread',
      });
    });

    it('should pass groupId to messageService.getMessages for group chat', async () => {
      const mockMessages: UIChatMessage[] = [
        {
          id: 'group-msg-1',
          content: 'Group message',
          role: 'assistant',
          createdAt: 1000,
          updatedAt: 1000,
          groupId: 'group-123',
          agentId: 'worker-agent-1',
        },
        {
          id: 'group-msg-2',
          content: 'Another group message',
          role: 'assistant',
          createdAt: 2000,
          updatedAt: 2000,
          groupId: 'group-123',
          agentId: 'worker-agent-2',
        },
      ];

      vi.mocked(messageService.getMessages).mockResolvedValue(mockMessages);

      const store = createStore({
        context: {
          agentId: 'supervisor-agent',
          topicId: 'test-topic',
          threadId: null,
          groupId: 'group-123',
        },
      });

      // Call useFetchMessages with groupId - this triggers the SWR mock
      store.getState().useFetchMessages({
        agentId: 'supervisor-agent',
        topicId: 'test-topic',
        threadId: null,
        groupId: 'group-123',
      });

      await waitFor(() => {
        expect(messageService.getMessages).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: 'supervisor-agent',
            groupId: 'group-123',
            topicId: 'test-topic',
          }),
        );
      });
    });

    it('should not pass groupId when not in group context', async () => {
      const mockMessages: UIChatMessage[] = [
        {
          id: 'msg-1',
          content: 'Regular message',
          role: 'user',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ];

      vi.mocked(messageService.getMessages).mockResolvedValue(mockMessages);

      const store = createStore({
        context: { agentId: 'test-session', topicId: 'test-topic', threadId: null },
      });

      store.getState().useFetchMessages({
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: null,
      });

      await waitFor(() => {
        expect(messageService.getMessages).toHaveBeenCalledWith(
          expect.objectContaining({
            agentId: 'test-session',
            topicId: 'test-topic',
          }),
        );
      });
    });
  });

  describe('switchMessageBranch', () => {
    it('should call updateMessageMetadata on parent message with branch index', async () => {
      const store = createTestStore();

      // Set up the message in the store's dbMessages array
      store.setState({
        dbMessages: [
          {
            id: 'msg-1',
            role: 'assistant',
            parentId: 'parent-msg-1',
            content: 'test',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      } as any);

      const updateMessageMetadataSpy = vi.spyOn(store.getState(), 'updateMessageMetadata');

      await act(async () => {
        await store.getState().switchMessageBranch('msg-1', 2);
      });

      // Should update the parent's metadata, not the current message
      expect(updateMessageMetadataSpy).toHaveBeenCalledWith('parent-msg-1', {
        activeBranchIndex: 2,
      });
    });

    it('should switch to branch index 0 on parent message', async () => {
      const store = createTestStore();

      // Set up the message in the store's dbMessages array
      store.setState({
        dbMessages: [
          {
            id: 'msg-1',
            role: 'assistant',
            parentId: 'parent-msg-1',
            content: 'test',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      } as any);

      const updateMessageMetadataSpy = vi.spyOn(store.getState(), 'updateMessageMetadata');

      await act(async () => {
        await store.getState().switchMessageBranch('msg-1', 0);
      });

      // Should update the parent's metadata, not the current message
      expect(updateMessageMetadataSpy).toHaveBeenCalledWith('parent-msg-1', {
        activeBranchIndex: 0,
      });
    });

    it('should not update metadata if message has no parentId', async () => {
      const store = createTestStore();

      // Set up a root message without parentId
      store.setState({
        dbMessages: [
          {
            id: 'msg-1',
            role: 'user',
            parentId: null,
            content: 'test',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      } as any);

      const updateMessageMetadataSpy = vi.spyOn(store.getState(), 'updateMessageMetadata');

      await act(async () => {
        await store.getState().switchMessageBranch('msg-1', 2);
      });

      // Should not call updateMessageMetadata when there's no parent
      expect(updateMessageMetadataSpy).not.toHaveBeenCalled();
    });

    it('should not update metadata if message does not exist', async () => {
      const store = createTestStore();

      // No messages in store
      store.setState({
        dbMessages: [],
      } as any);

      const updateMessageMetadataSpy = vi.spyOn(store.getState(), 'updateMessageMetadata');

      await act(async () => {
        await store.getState().switchMessageBranch('non-existent-msg', 2);
      });

      // Should not call updateMessageMetadata when message doesn't exist
      expect(updateMessageMetadataSpy).not.toHaveBeenCalled();
    });
  });
});
