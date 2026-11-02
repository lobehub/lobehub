import type { UIChatMessage } from '@lobechat/types';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { clearMessageListClientCacheState, runMessageListQuery } from '@/services/message/cache';
import { useChatStore } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { createStore } from '../../index';
import { createEphemeralResetState } from '../../initialState';
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
vi.mock('@/services/message', () => {
  const getMessages = vi.fn();
  return {
    messageService: {
      getEarlierMessages: vi.fn(),
      // The list cache reads pages; tests stub the plain list underneath.
      getMessageListPage: vi.fn((params) => getMessages(params)),
      getMessages,
      updateMessageMetadata: vi.fn().mockResolvedValue({ success: true, messages: [] }),
    },
  };
});

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  getActiveWorkspaceId: () => undefined,
  useActiveWorkspaceId: () => undefined,
}));

// Mock SWR
vi.mock('@/libs/swr', () => ({
  mutate: vi.fn(),
  useClientDataSWR: vi.fn((key, fetcher, options) => {
    // Simulate SWR behavior for testing: fetch once, report success
    if (key) {
      fetcher?.().then((data: unknown) => {
        options?.onSuccess?.(data);
      });
    }

    return { data: undefined, isValidating: true, mutate: vi.fn() };
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

  describe('loadEarlierMessages', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      clearMessageListClientCacheState();
    });

    const windowMessages: UIChatMessage[] = [
      { id: 'u2', content: 'q2', role: 'user', createdAt: 1000, updatedAt: 1000 } as any,
      { id: 'a2', content: 'a2', role: 'assistant', createdAt: 2000, updatedAt: 2000 } as any,
    ];
    const earlierPage: UIChatMessage[] = [
      { id: 'u1', content: 'q1', role: 'user', createdAt: 100, updatedAt: 100 } as any,
      { id: 'a1', content: 'a1', role: 'assistant', createdAt: 200, updatedAt: 200 } as any,
    ];

    it('prepends the fetched round page below the live window rows', async () => {
      const store = createStore({
        context: {
          agentId: 'agent-earlier',
          topicId: 'topic-earlier-1',
          threadId: 'thread-earlier',
        },
      });
      store.getState().replaceMessages(windowMessages);
      vi.mocked(messageService.getEarlierMessages).mockResolvedValueOnce({ messages: earlierPage });

      await store.getState().loadEarlierMessages();

      expect(messageService.getEarlierMessages).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: 'agent-earlier', topicId: 'topic-earlier-1' }),
        { createdAt: new Date(1000).toISOString(), id: 'u2' },
      );
      expect(store.getState().dbMessages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
      expect(store.getState().isLoadingEarlierMessages).toBe(false);
    });

    it('pages into the chat store bucket every surface of the conversation reads', async () => {
      const context = {
        agentId: 'agent-earlier',
        threadId: 'thread-earlier',
        topicId: 'topic-earlier-host',
      };
      const store = createStore({ context });
      store.getState().replaceMessages(windowMessages);
      vi.mocked(messageService.getEarlierMessages).mockResolvedValueOnce({ messages: earlierPage });

      await store.getState().loadEarlierMessages();

      expect(
        useChatStore.getState().dbMessagesMap[messageMapKey(context)].map((m) => m.id),
      ).toEqual(['u1', 'a1', 'u2', 'a2']);
    });

    it('stops fetching once a page comes back empty (beginning reached)', async () => {
      const store = createStore({
        context: {
          agentId: 'agent-earlier',
          topicId: 'topic-earlier-2',
          threadId: 'thread-earlier',
        },
      });
      store.getState().replaceMessages(windowMessages);
      vi.mocked(messageService.getEarlierMessages).mockResolvedValue({ messages: [] });

      await store.getState().loadEarlierMessages();
      await store.getState().loadEarlierMessages();

      expect(messageService.getEarlierMessages).toHaveBeenCalledTimes(1);
      expect(store.getState().dbMessages.map((m) => m.id)).toEqual(['u2', 'a2']);
    });

    it('lands a page that resolves after a switch in its own conversation only', async () => {
      const context = {
        agentId: 'agent-earlier',
        topicId: 'topic-earlier-3',
        threadId: 'thread-earlier',
      };
      const nextContext = { ...context, topicId: 'topic-earlier-other' };
      const store = createStore({ context });
      store.getState().replaceMessages(windowMessages);
      vi.mocked(messageService.getEarlierMessages).mockImplementationOnce(async () => {
        // Mimic the real switch path (StoreUpdater): ephemeral reset + context.
        store.setState({
          ...createEphemeralResetState(),
          context: nextContext,
          dbMessages: [],
          displayMessages: [],
        } as any);
        return { messages: earlierPage };
      });

      await store.getState().loadEarlierMessages();

      const { dbMessagesMap } = useChatStore.getState();
      expect(dbMessagesMap[messageMapKey(context)].map((m) => m.id)).toEqual([
        'u1',
        'a1',
        'u2',
        'a2',
      ]);
      expect(store.getState().dbMessages).toEqual([]);
      expect(store.getState().isLoadingEarlierMessages).toBe(false);
    });

    it('surfaces a failed page fetch as state and only retries on explicit request', async () => {
      const store = createStore({
        context: {
          agentId: 'agent-earlier',
          topicId: 'topic-earlier-4',
          threadId: 'thread-earlier',
        },
      });
      store.getState().replaceMessages(windowMessages);
      const failure = new Error('network down');
      vi.mocked(messageService.getEarlierMessages)
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({ messages: earlierPage });

      await expect(store.getState().loadEarlierMessages()).resolves.toBeUndefined();
      expect(store.getState().isLoadingEarlierMessages).toBe(false);
      expect(store.getState().earlierMessagesError).toBe(failure);

      // Scroll gestures must not silently re-fire the failing request.
      await store.getState().loadEarlierMessages();
      expect(messageService.getEarlierMessages).toHaveBeenCalledTimes(1);

      await store.getState().loadEarlierMessages({ retry: true });

      expect(messageService.getEarlierMessages).toHaveBeenCalledTimes(2);
      expect(store.getState().earlierMessagesError).toBeUndefined();
      expect(store.getState().dbMessages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    });

    it('clears the failure on conversation switch', async () => {
      const store = createStore({
        context: {
          agentId: 'agent-earlier',
          topicId: 'topic-earlier-6',
          threadId: 'thread-earlier',
        },
      });
      store.getState().replaceMessages(windowMessages);
      vi.mocked(messageService.getEarlierMessages).mockRejectedValueOnce(new Error('boom'));

      await store.getState().loadEarlierMessages();
      expect(store.getState().earlierMessagesError).toBeDefined();

      store.setState({
        ...createEphemeralResetState(),
        context: {
          agentId: 'agent-earlier',
          topicId: 'topic-earlier-7',
          threadId: 'thread-earlier',
        },
      } as any);
      expect(store.getState().earlierMessagesError).toBeUndefined();
    });

    it('merges the page into messages that changed while it was in flight', async () => {
      const store = createStore({
        context: {
          agentId: 'agent-earlier',
          topicId: 'topic-earlier-8',
          threadId: 'thread-earlier',
        },
      });
      store.getState().replaceMessages(windowMessages);
      const streamed = {
        id: 'a2',
        content: 'a2 streamed',
        role: 'assistant',
        createdAt: 2000,
        updatedAt: 2500,
      } as any;
      const appended = {
        id: 'u3',
        content: 'q3',
        role: 'user',
        createdAt: 3000,
        updatedAt: 3000,
      } as any;
      vi.mocked(messageService.getEarlierMessages).mockImplementationOnce(async () => {
        // Same conversation keeps updating: an edit/stream and a new message.
        store.getState().replaceMessages([windowMessages[0], streamed, appended]);
        return { messages: earlierPage };
      });

      await store.getState().loadEarlierMessages();

      const { dbMessages } = store.getState();
      expect(dbMessages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3']);
      expect(dbMessages.find((m) => m.id === 'a2')?.content).toBe('a2 streamed');
    });

    it('does not clear the loading flag of the next conversation on late settle', async () => {
      const store = createStore({
        context: {
          agentId: 'agent-earlier',
          topicId: 'topic-earlier-5',
          threadId: 'thread-earlier',
        },
      });
      store.getState().replaceMessages(windowMessages);
      vi.mocked(messageService.getEarlierMessages).mockImplementationOnce(async () => {
        store.setState({
          ...createEphemeralResetState(),
          context: {
            agentId: 'agent-earlier',
            topicId: 'topic-earlier-next',
            threadId: 'thread-earlier',
          },
        } as any);
        // The next conversation starts its own page load while ours is in flight.
        store.setState({ isLoadingEarlierMessages: true });
        return { messages: earlierPage };
      });

      await store.getState().loadEarlierMessages();

      expect(store.getState().isLoadingEarlierMessages).toBe(true);
    });
  });

  describe('loadEarlierMessages on a round-cursor topic', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      clearMessageListClientCacheState();
    });

    const context = { agentId: 'agent-round', threadId: null, topicId: 'topic-round' };
    const windowMessages: UIChatMessage[] = [
      { id: 'u2', content: 'q2', role: 'user', createdAt: 1000, updatedAt: 1000 } as any,
    ];
    const windowCursor = { createdAt: '1970-01-01T00:00:01.000123Z', id: 'u2' };

    it('waits for the window cursor instead of deriving a lossy one', async () => {
      const store = createStore({ context });
      store.getState().replaceMessages(windowMessages);

      await store.getState().loadEarlierMessages();

      expect(messageService.getEarlierMessages).not.toHaveBeenCalled();
    });

    it("pages from the window's lossless cursor and stops at the topic start", async () => {
      await runMessageListQuery(context, async () => ({
        messages: windowMessages,
        olderCursor: windowCursor,
      }));
      const store = createStore({ context });
      store.getState().replaceMessages(windowMessages);
      vi.mocked(messageService.getEarlierMessages).mockResolvedValueOnce({
        messages: [{ id: 'u1', content: 'q1', role: 'user', createdAt: 1, updatedAt: 1 } as any],
        olderCursor: null,
      });

      await store.getState().loadEarlierMessages();
      await store.getState().loadEarlierMessages();

      expect(messageService.getEarlierMessages).toHaveBeenCalledTimes(1);
      expect(messageService.getEarlierMessages).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: 'topic-round' }),
        windowCursor,
      );
      expect(store.getState().dbMessages.map((m) => m.id)).toEqual(['u1', 'u2']);
    });

    it('never fetches when the window already holds the topic start', async () => {
      await runMessageListQuery(context, async () => ({
        messages: windowMessages,
        olderCursor: null,
      }));
      const store = createStore({ context });
      store.getState().replaceMessages(windowMessages);

      await store.getState().loadEarlierMessages();

      expect(messageService.getEarlierMessages).not.toHaveBeenCalled();
    });
  });

  describe('internal_syncChatTranscript', () => {
    it('mirrors the chat store bucket another surface wrote', () => {
      const context = { agentId: 'mirror-agent', threadId: null, topicId: 'mirror-topic' };
      const store = createStore({ context });
      expect(store.getState().messagesInit).toBe(false);
      const rows = [
        { id: 'm1', content: 'hi', role: 'user', createdAt: 1, updatedAt: 1 },
      ] as UIChatMessage[];

      useChatStore.getState().replaceMessages(rows, { context });
      store.getState().internal_syncChatTranscript();

      expect(store.getState().dbMessages).toBe(
        useChatStore.getState().dbMessagesMap[messageMapKey(context)],
      );
      expect(store.getState().displayMessages.map((m) => m.id)).toEqual(['m1']);
      expect(store.getState().messagesInit).toBe(true);
    });

    it('keeps a static transcript out of the chat store', () => {
      const context = { agentId: 'static-agent', threadId: null, topicId: 'static-topic' };
      const rows = [
        { id: 's1', content: 'hi', role: 'user', createdAt: 1, updatedAt: 1 },
      ] as UIChatMessage[];
      const store = createStore({ context, messages: rows });

      store.getState().internal_dispatchMessage({
        id: 's1',
        type: 'updateMessage',
        value: { content: 'edited' },
      });

      expect(store.getState().dbMessages[0].content).toBe('edited');
      expect(useChatStore.getState().dbMessagesMap[messageMapKey(context)]).toBeUndefined();
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

    it('writes replacements into the chat store bucket of the conversation', () => {
      const store = createTestStore();
      const messages: UIChatMessage[] = [
        { id: 'msg-1', content: 'Hello', role: 'user', createdAt: 1000, updatedAt: 1000 } as any,
      ];

      store.getState().replaceMessages(messages);

      expect(
        useChatStore.getState().dbMessagesMap[messageMapKey(store.getState().context)],
      ).toEqual(messages);
    });

    it('lands an async replacement in its own conversation, not the one now shown', () => {
      const oldContext = { agentId: 'agent-1', threadId: null, topicId: 'topic-old' };
      const currentContext = { agentId: 'agent-1', threadId: null, topicId: 'topic-current' };
      const currentMessages: UIChatMessage[] = [
        {
          content: 'current topic',
          createdAt: 2000,
          id: 'msg-current',
          role: 'user',
          updatedAt: 2000,
        },
      ];
      const lateOldMessages: UIChatMessage[] = [
        {
          content: 'late old topic result',
          createdAt: 1000,
          id: 'msg-old',
          role: 'assistant',
          updatedAt: 1000,
        },
      ];
      const store = createStore({ context: currentContext });
      store.getState().replaceMessages(currentMessages);

      store.getState().replaceMessages(lateOldMessages, { expectedContext: oldContext });

      expect(store.getState().dbMessages).toEqual(currentMessages);
      expect(useChatStore.getState().dbMessagesMap[messageMapKey(oldContext)]).toEqual(
        lateOldMessages,
      );
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

    it('getBlockContent should find assistant blocks in compressed messages', () => {
      const store = createTestStore();

      store.getState().replaceMessages([
        {
          id: 'compressed-group',
          content: '',
          role: 'compressedGroup',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          compressedMessages: [
            {
              id: 'compressed-assistant',
              content: 'Compressed assistant content',
              role: 'assistant',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            {
              id: 'compressed-assistant-group',
              content: '',
              role: 'assistantGroup',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              children: [
                {
                  id: 'compressed-block',
                  content: 'Compressed block content',
                  tools: [{ id: 'compressed-tool' }],
                },
              ],
            },
          ],
        },
      ] as any);

      expect(dataSelectors.getBlockContent('compressed-assistant')(store.getState())).toBe(
        'Compressed assistant content',
      );
      expect(dataSelectors.getBlockContent('compressed-block')(store.getState())).toBe(
        'Compressed block content',
      );
      expect(dataSelectors.getToolsInBlock('compressed-block')(store.getState())).toEqual([
        { id: 'compressed-tool' },
      ]);
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

  describe('switchMessageBranch', () => {
    // ROOT CAUSE:
    // MessageBranch calls this conversation action, which persists metadata
    // directly rather than delegating to ChatStore.switchMessageBranch.
    /** @example Leaving a live branch revokes retry before the UI swaps replies. */
    it('revokes automatic recovery through the branch button action', async () => {
      const store = createTestStore();
      const context = store.getState().context;
      const { operationId } = useChatStore.getState().startOperation({
        context,
        metadata: { heteroAutoRetryAvailable: true },
        type: 'execServerAgentRuntime',
      });
      store.setState({
        dbMessages: [
          {
            id: 'live-reply',
            parentId: 'parent-user',
            role: 'assistant',
            content: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      });
      const update = vi
        .spyOn(store.getState(), 'updateMessageMetadata')
        .mockImplementation(async () => {
          /** @example Even an error not yet rendered loses its automatic retry grant. */
          expect(
            useChatStore.getState().operations[operationId].metadata.heteroAutoRetryAvailable,
          ).toBe(false);
        });
      await store.getState().switchMessageBranch('live-reply', 0);
      /** @example The normal parent branch selection still persists. */
      expect(update).toHaveBeenCalledWith('parent-user', { activeBranchIndex: 0 });
      update.mockRestore();
    });

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
