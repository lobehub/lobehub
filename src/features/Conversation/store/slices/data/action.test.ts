import type { UIChatMessage } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope } from '@/libs/replica';
import { useClientDataSWR } from '@/libs/swr';
import { messageService } from '@/services/message';
import {
  clearMessageListClientCacheState,
  MESSAGE_LIST_VERIFICATION_INTERVAL,
  runMessageListQuery,
} from '@/services/message/cache';
import { conversationMessagesResource } from '@/services/message/replica';
import { useChatStore } from '@/store/chat';
import { operationSelectors } from '@/store/chat/selectors';
import { LOCAL_MESSAGE_SCOPE } from '@/store/chat/utils/localMessages';

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

/** The transcript sync's SWR keys (the replica's hydration read is a separate query). */
const messageSyncKeys = () =>
  vi
    .mocked(useClientDataSWR)
    .mock.calls.map(([key]) => key as any[] | null)
    .filter((key) => key?.[0] === 'message:list');

/** `useFetchMessages` is a hook: run it inside a component. */
const fetchMessagesOf =
  (store: ReturnType<typeof createStore>) =>
  (
    ...args: Parameters<ReturnType<ReturnType<typeof createStore>['getState']>['useFetchMessages']>
  ) =>
    renderHook(() => store.getState().useFetchMessages(...args)).result.current;

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

    it('hands the extended transcript to the host, so its next sync keeps the older rows', async () => {
      const onMessagesChange = vi.fn();
      const context = {
        agentId: 'agent-earlier',
        threadId: 'thread-earlier',
        topicId: 'topic-earlier-host',
      };
      const store = createStore({ context });
      store.setState({ onMessagesChange });
      store.getState().replaceMessages(windowMessages, { skipOnMessagesChange: true });
      vi.mocked(messageService.getEarlierMessages).mockResolvedValueOnce({ messages: earlierPage });

      await store.getState().loadEarlierMessages();

      expect(onMessagesChange).toHaveBeenCalledTimes(1);
      expect(onMessagesChange.mock.calls[0][0].map((m: UIChatMessage) => m.id)).toEqual([
        'u1',
        'a1',
        'u2',
        'a2',
      ]);
      expect(onMessagesChange.mock.calls[0][1]).toEqual(context);
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

    it('drops a page that resolves after the store switched conversations', async () => {
      const store = createStore({
        context: {
          agentId: 'agent-earlier',
          topicId: 'topic-earlier-3',
          threadId: 'thread-earlier',
        },
      });
      store.getState().replaceMessages(windowMessages);
      vi.mocked(messageService.getEarlierMessages).mockImplementationOnce(async () => {
        // Mimic the real switch path (StoreUpdater): ephemeral reset + context.
        store.setState({
          ...createEphemeralResetState(),
          context: {
            agentId: 'agent-earlier',
            topicId: 'topic-earlier-other',
            threadId: 'thread-earlier',
          },
        } as any);
        return { messages: earlierPage };
      });

      await store.getState().loadEarlierMessages();

      expect(store.getState().dbMessages.map((m) => m.id)).toEqual(['u2', 'a2']);
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

  it('echoes the committed extended transcript after head revalidation', async () => {
    clearMessageListClientCacheState();
    const context = { agentId: 'review-agent', topicId: 'review-topic', threadId: null };
    const old = { id: 'old', role: 'user', content: 'older', createdAt: 1 } as UIChatMessage;
    const head = { id: 'head', role: 'user', content: 'newest', createdAt: 2 } as UIChatMessage;
    const cursor = { id: 'head', createdAt: '1970-01-01T00:00:00.002Z' };
    await runMessageListQuery(context, async () => ({ messages: [head], olderCursor: cursor }));
    const onMessagesChange = vi.fn();
    const store = createStore({ context });
    store.setState({ onMessagesChange });
    store.getState().replaceMessages([head]);
    vi.mocked(messageService.getEarlierMessages).mockResolvedValueOnce({
      messages: [old],
      olderCursor: null,
    });
    await store.getState().loadEarlierMessages();
    onMessagesChange.mockClear();
    vi.mocked(messageService.getMessageListPage).mockResolvedValueOnce({
      messages: [head],
      olderCursor: cursor,
    });
    fetchMessagesOf(store)(context);
    await waitFor(() =>
      expect(onMessagesChange).toHaveBeenCalledWith([old, head], context, { source: 'fetch' }),
    );
    expect(store.getState().dbMessages).toEqual([old, head]);
  });

  it('resets paging after an unpaged replacement but keeps it for an unchanged host echo', () => {
    const context = { agentId: 'replace-agent', topicId: 'replace-topic', threadId: null };
    const store = createStore({ context });
    const rows = ['older', 'head'].map((id, i) => ({
      id,
      role: 'user',
      content: id,
      createdAt: i,
    })) as UIChatMessage[];
    const paging = {
      currentPage: 2,
      pageSize: 1,
      hasMore: true,
      anchorId: 'head',
      nextCursor: { id: 'older', createdAt: 'old' },
      pages: [{ count: 1 }, { count: 1 }],
    };
    store.setState({ dbMessages: rows, messagePaging: paging });
    store.getState().replaceMessages([...rows], { skipOnMessagesChange: true });
    expect(store.getState().messagePaging).toEqual(paging);
    store.getState().replaceMessages([rows[1]]);
    expect(store.getState().messagePaging).toEqual({ currentPage: 0, pageSize: 1, hasMore: true });
  });

  describe('transcript persistence', () => {
    it('keeps streamed writes in memory and persists once the run settles', async () => {
      let running = true;
      vi.spyOn(operationSelectors, 'isAgentRuntimeRunningByContext').mockImplementation(
        () => () => running,
      );
      vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
      const storageSet = vi
        .spyOn(conversationMessagesResource.storage!, 'set')
        .mockResolvedValue(undefined);
      const store = createStore({
        context: { agentId: 'agent-persist', threadId: null, topicId: 'topic-persist' },
      });

      for (const id of ['m1', 'm2']) {
        store.getState().internal_dispatchMessage({
          id,
          type: 'createMessage',
          value: { content: id, role: 'assistant' } as any,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(storageSet.mock.calls.some(([, row]) => Array.isArray((row.data as any)?.items))).toBe(
        false,
      );

      running = false;
      store.getState().replaceMessages(store.getState().dbMessages);

      // The engine also tracks its stored keys in an index row.
      const transcriptWrites = () =>
        storageSet.mock.calls.filter(([, row]) => Array.isArray((row.data as any)?.items));
      await waitFor(() => expect(transcriptWrites()).toHaveLength(1));
      const [[, row]] = transcriptWrites();
      expect((row.data as any).items.map((m: UIChatMessage) => m.id)).toEqual(['m1', 'm2']);
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

    it('should sync internal replacements to the external store via onMessagesChange', () => {
      const store = createTestStore();
      const onMessagesChange = vi.fn();
      store.setState({ onMessagesChange });

      const messages: UIChatMessage[] = [
        { id: 'msg-1', content: 'Hello', role: 'user', createdAt: 1000, updatedAt: 1000 } as any,
      ];
      store.getState().replaceMessages(messages);

      expect(onMessagesChange).toHaveBeenCalledWith(messages, store.getState().context);
    });

    it('should NOT echo external prop sync back through onMessagesChange (skipOnMessagesChange)', () => {
      // Regression: StoreUpdater's external → internal sync used to echo the
      // bucket back to ChatStore, whose write-through mutate re-wrote the SWR
      // cache with the (possibly partial) bucket and discarded an in-flight
      // switch-time revalidation — locking the UI on a partial message list.
      const store = createTestStore();
      const onMessagesChange = vi.fn();
      store.setState({ onMessagesChange });

      const partialBucket: UIChatMessage[] = [
        { id: 'msg-first', content: 'seed', role: 'user', createdAt: 1000, updatedAt: 1000 } as any,
      ];
      store.getState().replaceMessages(partialBucket, { skipOnMessagesChange: true });

      // State still updates…
      expect(store.getState().dbMessages).toHaveLength(1);
      expect(store.getState().displayMessages[0].id).toBe('msg-first');
      // …but nothing is echoed back to the external store.
      expect(onMessagesChange).not.toHaveBeenCalled();
    });

    it('discards an async replacement when the store has switched conversations', () => {
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
      const store = createStore({ context: currentContext, initialMessages: currentMessages });
      const onMessagesChange = vi.fn();
      store.setState({ onMessagesChange });

      store.getState().replaceMessages(
        [
          {
            content: 'late old topic result',
            createdAt: 1000,
            id: 'msg-old',
            role: 'assistant',
            updatedAt: 1000,
          },
        ],
        { expectedContext: oldContext },
      );

      expect(store.getState().dbMessages).toEqual(currentMessages);
      expect(onMessagesChange).not.toHaveBeenCalled();
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

  describe('useFetchMessages', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      vi.clearAllMocks();
      clearMessageListClientCacheState();
      useChatStore.setState({ voiceMessageUploadMap: {} });
    });

    it.each(['approved', 'rejected', 'aborted'] as const)(
      'observes a remote %s while preserving locally streaming content',
      async (status) => {
        vi.spyOn(operationSelectors, 'isAgentRuntimeRunningByContext').mockReturnValue(() => true);
        const context = { agentId: 'test-session', threadId: null, topicId: 'test-topic' };
        const pending: UIChatMessage = {
          content: '',
          createdAt: 1,
          id: 'question',
          role: 'tool',
          tool_call_id: 'call-1',
          updatedAt: 10,
          pluginIntervention: { status: 'pending' },
        };
        const streaming: UIChatMessage = {
          content: 'Streaming content that has not been persisted yet',
          createdAt: 2,
          id: 'assistant',
          role: 'assistant',
          updatedAt: 10,
        };
        const answered: UIChatMessage = {
          ...pending,
          content: 'Remote answer',
          updatedAt: 1,
          pluginIntervention: { status },
        };
        const store = createStore({ context });
        const onMessagesChange = vi.fn();
        store.setState({ dbMessages: [pending, streaming], messagesInit: true, onMessagesChange });
        vi.mocked(messageService.getMessages).mockResolvedValue([
          answered,
          { ...streaming, content: '...' },
        ]);

        fetchMessagesOf(store)(context, { refreshInterval: 2000 });

        await waitFor(() => expect(store.getState().dbMessages[0]).toEqual(answered));
        expect(store.getState().dbMessages[1]).toBe(streaming);
        expect(onMessagesChange).toHaveBeenCalledWith([answered, streaming], context, {
          source: 'fetch',
        });
        expect(useClientDataSWR).toHaveBeenCalledWith(
          expect.any(Array),
          expect.any(Function),
          expect.objectContaining({
            dedupingInterval: 1000,
            refreshInterval: 2000,
            refreshWhenHidden: false,
            refreshWhenOffline: false,
          }),
        );
      },
    );

    it('settles a remote answer and permits an authoritative rollback at the same timestamp', async () => {
      const context = { agentId: 'test-session', threadId: null, topicId: 'test-topic' };
      const pending: UIChatMessage = {
        content: '',
        createdAt: 1,
        id: 'question',
        role: 'tool',
        tool_call_id: 'call-1',
        updatedAt: 10,
        pluginIntervention: { status: 'pending' },
      };
      const answered: UIChatMessage = {
        ...pending,
        content: 'Remote answer',
        updatedAt: 1,
        pluginIntervention: { status: 'approved' },
      };
      const store = createStore({ context });
      store.setState({ dbMessages: [pending] });
      vi.mocked(messageService.getMessages).mockResolvedValue([answered]);
      fetchMessagesOf(store)(context);
      await waitFor(() => expect(store.getState().dbMessages).toEqual([answered]));

      clearMessageListClientCacheState();
      const rollback = { ...pending, updatedAt: 1 };
      vi.mocked(messageService.getMessages).mockResolvedValue([rollback]);
      fetchMessagesOf(store)(context);
      await act(async () => {
        await Promise.resolve();
      });
      expect(store.getState().dbMessages).toEqual([rollback]);
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
      fetchMessagesOf(store)({
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: 'test-thread',
      });

      await waitFor(() => {
        expect(messageService.getMessages).toHaveBeenCalledWith({
          agentId: 'test-session',
          groupId: null,
          projectToolPayloads: false,
          threadId: 'test-thread',
          topicId: 'test-topic',
        });
      });
    });

    it("tags the onData echo with source 'fetch' so handlers skip the cache write-through", async () => {
      // Regression: without the tag, ChatStore.replaceMessages writes the
      // echoed (possibly stale) snapshot through the SWR cache at mount, which
      // trips SWR's mutation race guard and discards the in-flight
      // revalidation — the conversation locks on the stale/partial list.
      const mockMessages: UIChatMessage[] = [
        { id: 'sync-msg-1', content: 'Synced', role: 'user', createdAt: 1000, updatedAt: 1000 },
      ];
      vi.mocked(messageService.getMessages).mockResolvedValue(mockMessages);

      const context = { agentId: 'test-session', threadId: null, topicId: 'test-topic' };
      const store = createStore({ context });
      const onMessagesChange = vi.fn();
      store.setState({ onMessagesChange });

      fetchMessagesOf(store)(context);

      await waitFor(() => {
        expect(onMessagesChange).toHaveBeenCalledWith(mockMessages, context, { source: 'fetch' });
      });
    });

    describe('while an agent run is in flight in this conversation', () => {
      const context = { agentId: 'test-session', threadId: null, topicId: 'test-topic' };
      const fetched: UIChatMessage[] = [
        {
          content: 'Run the script',
          createdAt: 1000,
          id: 'msg-user',
          role: 'user',
          updatedAt: 1000,
        },
      ];

      it('still lands the first load, so a parked run does not leave a skeleton (G-05)', async () => {
        // A group supervisor parked on a member's approval stays `running`
        // indefinitely; dropping the first load there never initializes the list.
        const running = vi
          .spyOn(operationSelectors, 'isAgentRuntimeRunningByContext')
          .mockReturnValue(() => true);
        vi.mocked(messageService.getMessages).mockResolvedValue(fetched);
        const store = createStore({ context });
        store.setState({ messagesInit: false });

        fetchMessagesOf(store)(context);

        await waitFor(() => {
          expect(store.getState().messagesInit).toBe(true);
        });
        expect(store.getState().dbMessages.map((m) => m.id)).toEqual(['msg-user']);
        running.mockRestore();
      });

      it('keeps loaded rows but lands rows the list has never seen (G-05)', async () => {
        // A stale cached first load can miss the parked member's rows; the fresh
        // read that follows must still bring them in, without touching the
        // rows the stream owns.
        const running = vi
          .spyOn(operationSelectors, 'isAgentRuntimeRunningByContext')
          .mockReturnValue(() => true);
        const streamed = {
          content: 'streamed so far',
          createdAt: 2000,
          id: 'msg-supervisor',
          role: 'assistant',
          updatedAt: 2000,
        } as UIChatMessage;
        const memberTool = {
          content: '',
          createdAt: 3000,
          id: 'msg-member-tool',
          role: 'tool',
          updatedAt: 3000,
        } as UIChatMessage;
        vi.mocked(messageService.getMessages).mockResolvedValue([
          ...fetched,
          { ...streamed, content: '' },
          memberTool,
        ]);
        const store = createStore({ context });
        store.setState({ dbMessages: [...fetched, streamed], messagesInit: true });

        fetchMessagesOf(store)(context);

        await waitFor(() => {
          expect(store.getState().dbMessages.map((m) => m.id)).toContain('msg-member-tool');
        });
        expect(store.getState().dbMessages.find((m) => m.id === 'msg-supervisor')?.content).toBe(
          'streamed so far',
        );
        running.mockRestore();
      });

      it('drops a refetch that brings nothing new', async () => {
        const running = vi
          .spyOn(operationSelectors, 'isAgentRuntimeRunningByContext')
          .mockReturnValue(() => true);
        vi.mocked(messageService.getMessages).mockResolvedValue(fetched);
        const store = createStore({ context });
        const loaded = [{ ...fetched[0], content: 'local' }];
        store.setState({ dbMessages: loaded, messagesInit: true });

        fetchMessagesOf(store)(context);

        await waitFor(() => {
          expect(messageService.getMessages).toHaveBeenCalled();
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(store.getState().dbMessages).toBe(loaded);
        running.mockRestore();
      });
    });

    it('discards a fetch result that resolves after switching conversations', async () => {
      let resolveFetch!: (messages: UIChatMessage[]) => void;
      vi.mocked(messageService.getMessages).mockReturnValue(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );

      const oldContext = { agentId: 'test-session', threadId: null, topicId: 'topic-old' };
      const currentContext = { agentId: 'test-session', threadId: null, topicId: 'topic-current' };
      const currentMessages: UIChatMessage[] = [
        {
          content: 'current topic',
          createdAt: 2000,
          id: 'msg-current',
          role: 'user',
          updatedAt: 2000,
        },
      ];
      const store = createStore({ context: oldContext });
      const onMessagesChange = vi.fn();
      store.setState({ onMessagesChange });

      fetchMessagesOf(store)(oldContext);
      store.setState({
        context: currentContext,
        dbMessages: currentMessages,
        displayMessages: currentMessages,
        messagesInit: true,
      });

      await act(async () => {
        resolveFetch([
          {
            content: 'late old topic result',
            createdAt: 1000,
            id: 'msg-old',
            role: 'assistant',
            updatedAt: 1000,
          },
        ]);
        await Promise.resolve();
      });

      expect(store.getState().dbMessages).toEqual(currentMessages);
      expect(onMessagesChange).not.toHaveBeenCalled();
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

      fetchMessagesOf(store)({
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

      fetchMessagesOf(store)({
        agentId: '',
        topicId: null,
        threadId: null,
      });

      // SWR should be called with null key (disabled)
      expect(vi.mocked(useClientDataSWR)).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('should not fetch when topicId is null (new conversation state)', () => {
      const store = createStore({
        context: { agentId: 'test-session', topicId: null, threadId: null },
      });

      fetchMessagesOf(store)({
        agentId: 'test-session',
        topicId: null,
        threadId: null,
      });

      // SWR should be called with null key when topicId is null
      // This prevents fetching empty data that would overwrite local optimistic updates
      expect(vi.mocked(useClientDataSWR)).toHaveBeenCalledWith(
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

      fetchMessagesOf(store)({
        agentId: 'test-session',
        topicId: undefined as any,
        threadId: null,
      });

      // SWR should be called with null key when topicId is undefined
      expect(vi.mocked(useClientDataSWR)).toHaveBeenCalledWith(
        null,
        expect.any(Function),
        expect.any(Object),
      );
    });

    it('should use different SWR keys for different threadIds', () => {
      const store1 = createStore({
        context: { agentId: 'session-1', topicId: 'topic-1', threadId: 'thread-1' },
      });

      fetchMessagesOf(store1)({
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: 'thread-1',
      });

      const firstCallKey = messageSyncKeys()[0];

      const store2 = createStore({
        context: { agentId: 'session-1', topicId: 'topic-1', threadId: 'thread-2' },
      });

      fetchMessagesOf(store2)({
        agentId: 'session-1',
        topicId: 'topic-1',
        threadId: 'thread-2',
      });

      const secondCallKey = messageSyncKeys()[1];

      // Keys should be different because threadIds are different
      expect(firstCallKey).not.toEqual(secondCallKey);
      expect((firstCallKey as any[])[1].threadId).toBe('thread-1');
      expect((secondCallKey as any[])[1].threadId).toBe('thread-2');
    });

    it('should use same SWR key structure with Object containing sessionId, topicId, threadId', () => {
      const store = createStore({
        context: { agentId: 'test-session', topicId: 'test-topic', threadId: 'test-thread' },
      });

      fetchMessagesOf(store)({
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: 'test-thread',
      });

      const swrKey = messageSyncKeys()[0]!;

      // Key should be an array with prefix and context object
      expect(Array.isArray(swrKey)).toBe(true);
      expect(swrKey[0]).toBe('message:list');
      expect(swrKey[1]).toEqual({
        agentId: 'test-session',
        groupId: null,
        threadId: 'test-thread',
        topicId: 'test-topic',
      });
    });

    it('skips switch-time revalidation after a successful server verification', async () => {
      const context = {
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: null,
      };
      await runMessageListQuery(context, async () => []);
      vi.mocked(messageService.getMessages).mockResolvedValue([]);

      const store = createStore({ context });
      fetchMessagesOf(store)(context);

      expect(vi.mocked(useClientDataSWR)).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(Function),
        expect.objectContaining({
          dedupingInterval: MESSAGE_LIST_VERIFICATION_INTERVAL,
          revalidateIfStale: false,
        }),
      );
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
      fetchMessagesOf(store)({
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

      fetchMessagesOf(store)({
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

    it('should preserve newer local message state when fetched data is stale', async () => {
      const localError = {
        body: { message: 'Codex CLI was not found' },
        message: 'Codex CLI was not found',
        type: 'AgentRuntimeError',
      } as any;

      vi.mocked(messageService.getMessages).mockResolvedValue([
        {
          id: 'msg-1',
          content: '',
          role: 'assistant',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ]);

      const store = createStore({
        context: { agentId: 'test-session', topicId: 'test-topic', threadId: null },
      });

      store.setState({
        dbMessages: [
          {
            id: 'msg-1',
            content: '',
            error: localError,
            role: 'assistant',
            createdAt: 1000,
            updatedAt: 2000,
          },
        ],
      } as any);

      fetchMessagesOf(store)({
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: null,
      });

      await waitFor(() => {
        expect(store.getState().dbMessages[0].error).toEqual(localError);
        expect(store.getState().dbMessages[0].updatedAt).toBe(2000);
      });
    });

    it('should preserve a local-only message that is missing from fetched data', async () => {
      const persistedMessage: UIChatMessage = {
        id: 'persisted-message',
        content: 'Persisted message',
        role: 'assistant',
        createdAt: 1000,
        updatedAt: 1000,
      };
      const localVoiceMessage: UIChatMessage = {
        id: 'tmp-voice-message',
        audioList: [{ alt: 'voice.webm', id: 'tmp-audio', url: 'blob:voice-preview' }],
        content: '',
        metadata: { scope: LOCAL_MESSAGE_SCOPE },
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };

      vi.mocked(messageService.getMessages).mockResolvedValue([persistedMessage]);

      const store = createStore({
        context: { agentId: 'test-session', topicId: 'test-topic', threadId: null },
      });
      store.setState({ dbMessages: [localVoiceMessage] });
      useChatStore.setState({
        voiceMessageUploadMap: {
          [localVoiceMessage.id]: { progress: 50, status: 'uploading' },
        },
      });

      fetchMessagesOf(store)({
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: null,
      });

      await waitFor(() => {
        expect(store.getState().dbMessages).toEqual([persistedMessage, localVoiceMessage]);
      });
    });

    it('should keep an earlier local-only voice row ahead of a later fetched message', async () => {
      const localVoiceMessage: UIChatMessage = {
        id: 'tmp-voice-message',
        audioList: [{ alt: 'voice.webm', id: 'tmp-audio', url: 'blob:voice-preview' }],
        content: '',
        metadata: { scope: LOCAL_MESSAGE_SCOPE },
        role: 'user',
        createdAt: 1000,
        updatedAt: 1000,
      };
      const laterFetchedMessage: UIChatMessage = {
        id: 'later-message',
        content: 'Later text',
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };

      vi.mocked(messageService.getMessages).mockResolvedValue([laterFetchedMessage]);

      const store = createStore({
        context: { agentId: 'test-session', topicId: 'test-topic', threadId: null },
      });
      store.setState({ dbMessages: [localVoiceMessage] });
      useChatStore.setState({
        voiceMessageUploadMap: {
          [localVoiceMessage.id]: { progress: 50, status: 'uploading' },
        },
      });

      fetchMessagesOf(store)({
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: null,
      });

      await waitFor(() => {
        expect(store.getState().dbMessages).toEqual([localVoiceMessage, laterFetchedMessage]);
      });
    });

    it('should drop a missing local-only message after its voice transaction settles', async () => {
      const persistedMessage: UIChatMessage = {
        id: 'persisted-message',
        content: 'Persisted message',
        role: 'assistant',
        createdAt: 1000,
        updatedAt: 1000,
      };
      const settledLocalVoiceMessage: UIChatMessage = {
        id: 'tmp-settled-voice-message',
        audioList: [{ alt: 'voice.webm', id: 'tmp-audio', url: 'blob:stale-voice-preview' }],
        content: '',
        metadata: { scope: LOCAL_MESSAGE_SCOPE },
        role: 'user',
        createdAt: 2000,
        updatedAt: 2000,
      };

      vi.mocked(messageService.getMessages).mockResolvedValue([persistedMessage]);

      const store = createStore({
        context: { agentId: 'test-session', topicId: 'test-topic', threadId: null },
      });
      store.setState({ dbMessages: [settledLocalVoiceMessage] });

      fetchMessagesOf(store)({
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: null,
      });

      await waitFor(() => {
        expect(store.getState().dbMessages).toEqual([persistedMessage]);
      });
    });

    it('should let a fetched server row replace a newer local-only row with the same id', async () => {
      const fetchedMessage: UIChatMessage = {
        id: 'tmp-voice-message',
        audioList: [
          { alt: 'voice.webm', id: 'persisted-audio', url: 'https://example.com/voice.webm' },
        ],
        content: 'Persisted message',
        role: 'user',
        createdAt: 1000,
        updatedAt: 1000,
      };
      const localVoiceMessage: UIChatMessage = {
        id: 'tmp-voice-message',
        audioList: [{ alt: 'voice.webm', id: 'tmp-audio', url: 'blob:voice-preview' }],
        content: '',
        metadata: { scope: LOCAL_MESSAGE_SCOPE },
        role: 'user',
        createdAt: 1000,
        updatedAt: 2000,
      };

      vi.mocked(messageService.getMessages).mockResolvedValue([fetchedMessage]);

      const store = createStore({
        context: { agentId: 'test-session', topicId: 'test-topic', threadId: null },
      });
      store.setState({ dbMessages: [localVoiceMessage] });
      useChatStore.setState({
        voiceMessageUploadMap: {
          [localVoiceMessage.id]: { progress: 100, status: 'sending' },
        },
      });

      fetchMessagesOf(store)({
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: null,
      });

      await waitFor(() => {
        expect(store.getState().dbMessages).toEqual([fetchedMessage]);
      });
    });

    it('should accept fetched message state when server data is newer', async () => {
      vi.mocked(messageService.getMessages).mockResolvedValue([
        {
          id: 'msg-1',
          content: '',
          error: {
            body: { message: 'Persisted error' },
            message: 'Persisted error',
            type: 'AgentRuntimeError',
          } as any,
          role: 'assistant',
          createdAt: 1000,
          updatedAt: 3000,
        },
      ]);

      const store = createStore({
        context: { agentId: 'test-session', topicId: 'test-topic', threadId: null },
      });

      store.setState({
        dbMessages: [
          {
            id: 'msg-1',
            content: '',
            role: 'assistant',
            createdAt: 1000,
            updatedAt: 2000,
          },
        ],
      } as any);

      fetchMessagesOf(store)({
        agentId: 'test-session',
        topicId: 'test-topic',
        threadId: null,
      });

      await waitFor(() => {
        expect(store.getState().dbMessages[0].error).toEqual({
          body: { message: 'Persisted error' },
          message: 'Persisted error',
          type: 'AgentRuntimeError',
        });
        expect(store.getState().dbMessages[0].updatedAt).toBe(3000);
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
