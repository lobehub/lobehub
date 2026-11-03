import { LOADING_FLAT } from '@lobechat/const';
import { RequestTrigger, type UIChatMessage } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cacheScope, createReplicaState } from '@/libs/replica';
import { aiChatService } from '@/services/aiChat';
import { chatService } from '@/services/chat';
import { threadService } from '@/services/thread';
import { type ThreadItem } from '@/types/topic';
import { ThreadStatus, ThreadType } from '@/types/topic';

import { useChatStore } from '../../store';
import { threadListResource } from './projection';
import { threadSelectors } from './selectors';

// Mock @/libs/swr mutate
vi.mock('@/libs/swr', async () => {
  const actual = await vi.importActual('@/libs/swr');
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

// Mock version constants
vi.mock(import('@/const/version'), async (importOriginal) => ({
  ...(await importOriginal()),
  isDeprecatedEdition: false,
  isDesktop: false,
}));

// Mock threadService
vi.mock('@/services/thread', () => ({
  threadService: {
    createThreadWithMessage: vi.fn(),
    getThreads: vi.fn(),
    removeThread: vi.fn(),
    updateThread: vi.fn(),
  },
}));

// Mock chatService
vi.mock('@/services/chat', () => ({
  chatService: {
    fetchPresetTaskResult: vi.fn(),
  },
}));

vi.mock('@/services/aiChat', () => ({
  aiChatService: {
    generateJSON: vi.fn(),
  },
}));

// Mock mutate from SWR
vi.mock('swr', async () => {
  const actual = await vi.importActual('swr');
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

// Mock store helpers
vi.mock('@/store/global/helpers', () => ({
  globalHelpers: {
    getCurrentLanguage: vi.fn(() => 'en-US'),
  },
}));

vi.mock('@/store/session', () => ({
  useSessionStore: {
    getState: vi.fn(() => ({
      triggerSessionUpdate: vi.fn(),
    })),
  },
}));

vi.mock(import('@/store/user/selectors'), async (importOriginal) => ({
  ...(await importOriginal()),
  systemAgentSelectors: {
    thread: vi.fn(() => ({})),
  },
  userGeneralSettingsSelectors: {
    currentResponseLanguage: vi.fn(() => 'en-US'),
  },
}));

const SCOPE = 'thread-test-user:personal';

const makeThread = (id: string, title: string, topicId = 'test-topic-id'): ThreadItem => ({
  createdAt: new Date('2026-10-01T00:00:00Z'),
  id,
  lastActiveAt: new Date('2026-10-01T00:00:00Z'),
  sourceMessageId: 'msg-1',
  status: ThreadStatus.Active,
  title,
  topicId,
  type: ThreadType.Continuation,
  updatedAt: new Date('2026-10-01T00:00:00Z'),
  userId: 'user-1',
});

/** Fetch a topic's threads through the replica and wait until they are persisted. */
const seedPersistedThreads = async (topicId: string, threads: ThreadItem[]) => {
  (threadService.getThreads as Mock).mockResolvedValueOnce(threads);
  await act(async () => {
    await useChatStore.getState().refreshThreads(topicId);
  });
  await waitFor(async () => {
    const row = await threadListResource.storage!.get({ queryKey: topicId, scope: SCOPE });
    expect(row?.data).toEqual(threads);
  });
};

/** Drop everything in memory, as a reload does; only storage survives. */
const simulateReload = () => {
  act(() => {
    useChatStore.setState({ threadListReplica: createReplicaState(), threadMaps: {} });
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(cacheScope, 'get').mockReturnValue(SCOPE);
  vi.spyOn(cacheScope, 'use').mockReturnValue(SCOPE);
  vi.spyOn(cacheScope, 'canPersist').mockReturnValue(true);
  useChatStore.setState(
    {
      activeAgentId: 'test-session-id',
      activeTopicId: 'test-topic-id',
      isCreatingThread: false,
      isCreatingThreadMessage: false,
      messagesMap: {},
      newThreadMode: ThreadType.Continuation,
      portalThreadId: undefined,
      startToForkThread: undefined,
      threadInputMessage: '',
      threadListReplica: createReplicaState(),
      threadLoadingIds: [],
      threadMaps: {},
      threadStartMessageId: undefined,
    },
    false,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('thread action', () => {
  describe('updateThreadInputMessage', () => {
    it('should update thread input message', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.updateThreadInputMessage('test message');
      });

      expect(result.current.threadInputMessage).toBe('test message');
    });

    it('should not update if message is the same', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ threadInputMessage: 'test message' });
      });

      const stateBefore = useChatStore.getState();

      act(() => {
        result.current.updateThreadInputMessage('test message');
      });

      expect(useChatStore.getState()).toBe(stateBefore);
    });
  });

  describe('openThreadInPortal', () => {
    it('should set portal thread state and open portal', () => {
      const { result } = renderHook(() => useChatStore());
      const pushPortalViewSpy = vi.spyOn(result.current, 'pushPortalView');

      act(() => {
        result.current.openThreadInPortal('thread-id', 'source-message-id');
      });

      expect(result.current.portalThreadId).toBe('thread-id');
      expect(result.current.threadStartMessageId).toBe('source-message-id');
      expect(result.current.startToForkThread).toBe(false);
      expect(pushPortalViewSpy).toHaveBeenCalledWith({
        type: 'thread',
        threadId: 'thread-id',
        startMessageId: 'source-message-id',
      });
    });
  });

  describe('closeThreadPortal', () => {
    it('should clear thread portal state and close portal', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          portalThreadId: 'thread-id',
          startToForkThread: true,
          threadStartMessageId: 'message-id',
        });
      });

      const clearPortalStackSpy = vi.spyOn(result.current, 'clearPortalStack');

      act(() => {
        result.current.closeThreadPortal();
      });

      expect(result.current.portalThreadId).toBeUndefined();
      expect(result.current.threadStartMessageId).toBeUndefined();
      expect(result.current.startToForkThread).toBeUndefined();
      expect(clearPortalStackSpy).toHaveBeenCalled();
    });
  });

  describe('switchThread', () => {
    it('should set active thread id', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.switchThread('thread-id');
      });

      expect(result.current.activeThreadId).toBe('thread-id');
    });
  });

  describe('createThread', () => {
    it('should create thread with message and return ids', async () => {
      const { result } = renderHook(() => useChatStore());

      const mockResult = { messageId: 'new-message-id', threadId: 'new-thread-id' };
      (threadService.createThreadWithMessage as Mock).mockResolvedValue(mockResult);

      let createResult;
      await act(async () => {
        createResult = await result.current.createThread({
          message: {
            content: 'test message',
            role: 'user',
            agentId: 'test-session-id',
          },
          sourceMessageId: 'source-msg-id',
          topicId: 'test-topic-id',
          type: ThreadType.Continuation,
        });
      });

      expect(threadService.createThreadWithMessage).toHaveBeenCalledWith({
        message: {
          content: 'test message',
          role: 'user',
          agentId: 'test-session-id',
        },
        sourceMessageId: 'source-msg-id',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
      });
      expect(createResult).toEqual(mockResult);
      expect(result.current.isCreatingThread).toBe(false);
    });

    it('should set isCreatingThread during creation', async () => {
      const { result } = renderHook(() => useChatStore());

      (threadService.createThreadWithMessage as Mock).mockImplementation(async () => {
        expect(useChatStore.getState().isCreatingThread).toBe(true);
        return { messageId: 'message-id', threadId: 'thread-id' };
      });

      await act(async () => {
        await result.current.createThread({
          message: { content: 'test', role: 'user', agentId: 'test-session-id' },
          sourceMessageId: 'source-msg-id',
          topicId: 'test-topic-id',
          type: ThreadType.Continuation,
        });
      });

      expect(result.current.isCreatingThread).toBe(false);
    });
  });

  describe('useFetchThreads', () => {
    it('should fetch threads for a given topic id into threadMaps', async () => {
      const topicId = 'test-topic-id';
      const threads = [makeThread('thread-1', 'Thread 1')];

      (threadService.getThreads as Mock).mockResolvedValue(threads);

      renderHook(() => useChatStore().useFetchThreads(true, topicId));

      await waitFor(() => {
        expect(useChatStore.getState().threadMaps).toEqual({ [topicId]: threads });
      });
      expect(threadService.getThreads).toHaveBeenCalledWith(topicId);
    });

    it('should not fetch when enable is false', async () => {
      renderHook(() => useChatStore().useFetchThreads(false, 'test-topic-id'));

      expect(threadService.getThreads).not.toHaveBeenCalled();
      expect(useChatStore.getState().threadMaps).toEqual({});
    });

    it('should not fetch when topicId is undefined', async () => {
      const { result } = renderHook(() => useChatStore().useFetchThreads(true, undefined));

      expect(threadService.getThreads).not.toHaveBeenCalled();
      expect(result.current.isHydrated).toBe(true);
    });

    // A reload used to repaint the topic's threads only after the network
    // answered: the list rendered nothing (and the portal header a skeleton)
    // until then. The persisted copy now paints first.
    it('repaints the persisted threads after a reload before the network answers', async () => {
      const topicId = `topic-${Date.now()}`;
      const threads = [makeThread('thread-1', 'Persisted thread')].map((t) => ({ ...t, topicId }));

      (threadService.getThreads as Mock).mockResolvedValue(threads);
      const first = renderHook(() => useChatStore().useFetchThreads(true, topicId));
      await waitFor(() => {
        expect(useChatStore.getState().threadMaps[topicId]).toEqual(threads);
      });
      await waitFor(async () => {
        const row = await threadListResource.storage!.get({ queryKey: topicId, scope: SCOPE });
        expect(row?.data).toEqual(threads);
      });
      first.unmount();

      // Reload: memory is gone, only the persisted projection survives.
      act(() => {
        useChatStore.setState({ threadListReplica: createReplicaState(), threadMaps: {} });
      });
      (threadService.getThreads as Mock).mockImplementation(() => new Promise(() => {}));

      await act(async () => {
        await useChatStore.getState().preHydrateThreads(topicId);
      });

      expect(useChatStore.getState().threadMaps[topicId]).toEqual(threads);
      expect(
        threadSelectors.isCurrentTopicThreadsLoaded({
          ...useChatStore.getState(),
          activeTopicId: topicId,
        }),
      ).toBe(true);
    });

    it('sends one request when several mounts sync the same topic', async () => {
      const topicId = `topic-dedupe-${Date.now()}`;
      (threadService.getThreads as Mock).mockResolvedValue([makeThread('t1', 'T1', topicId)]);

      // ThreadHydration + the sidebar ThreadList both sync the active topic.
      renderHook(() => {
        useChatStore().useFetchThreads(true, topicId);
        useChatStore().useFetchThreads(true, topicId);
      });
      const other = renderHook(() => useChatStore().useFetchThreads(true, topicId));

      await waitFor(() => {
        expect(useChatStore.getState().threadMaps[topicId]).toHaveLength(1);
      });
      other.rerender();
      expect(threadService.getThreads).toHaveBeenCalledTimes(1);
    });

    it('does not show the previous identity threads after a scope switch', async () => {
      const topicId = `topic-scope-${Date.now()}`;
      await seedPersistedThreads(topicId, [makeThread('t1', 'Owned by A', topicId)]);
      simulateReload();

      // Another user / workspace opens the same topic id.
      vi.spyOn(cacheScope, 'get').mockReturnValue('other-user:personal');
      vi.spyOn(cacheScope, 'use').mockReturnValue('other-user:personal');
      (threadService.getThreads as Mock).mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(() => useChatStore().useFetchThreads(true, topicId));
      await waitFor(() => expect(result.current.isHydrated).toBe(true));

      expect(useChatStore.getState().threadMaps[topicId]).toBeUndefined();
    });

    it('keeps the last good threads when a background refresh fails', async () => {
      const topicId = `topic-offline-${Date.now()}`;
      const threads = [makeThread('t1', 'Last good', topicId)];
      await seedPersistedThreads(topicId, threads);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      (threadService.getThreads as Mock).mockRejectedValue(new Error('offline'));

      await act(async () => {
        await useChatStore.getState().refreshThreads(topicId);
      });

      expect(useChatStore.getState().threadMaps[topicId]).toEqual(threads);
    });
  });

  describe('isPortalThreadPending', () => {
    it('treats a thread missing from a restored snapshot as loading until the server answers', async () => {
      const topicId = `topic-portal-${Date.now()}`;
      await seedPersistedThreads(topicId, [makeThread('old', 'Old', topicId)]);
      simulateReload();
      act(() => {
        useChatStore.setState({ activeTopicId: topicId, portalThreadId: 'created-later' });
      });

      let resolve!: (threads: ThreadItem[]) => void;
      (threadService.getThreads as Mock).mockImplementation(
        () => new Promise<ThreadItem[]>((r) => (resolve = r)),
      );
      renderHook(() => useChatStore().useFetchThreads(true, topicId));
      await waitFor(() => expect(useChatStore.getState().threadMaps[topicId]).toHaveLength(1));

      // Restored, but the snapshot predates the thread: still loading.
      expect(threadSelectors.isPortalThreadPending(useChatStore.getState())).toBe(true);

      await act(async () => {
        resolve([makeThread('old', 'Old', topicId), makeThread('created-later', 'New', topicId)]);
      });
      await waitFor(() =>
        expect(threadSelectors.isPortalThreadPending(useChatStore.getState())).toBe(false),
      );
    });

    it('is settled once the server confirms the thread is gone', async () => {
      const topicId = `topic-gone-${Date.now()}`;
      await seedPersistedThreads(topicId, []);
      act(() => {
        useChatStore.setState({ activeTopicId: topicId, portalThreadId: 'deleted' });
      });

      expect(threadSelectors.isPortalThreadPending(useChatStore.getState())).toBe(false);
    });
  });

  describe('refreshThreads', () => {
    it('should refetch the active topic threads into threadMaps', async () => {
      const threads = [{ id: 'thread-1', title: 'Fresh', topicId: 'test-topic-id' }];
      (threadService.getThreads as Mock).mockResolvedValue(threads);

      await act(async () => {
        await useChatStore.getState().refreshThreads();
      });

      expect(threadService.getThreads).toHaveBeenCalledWith('test-topic-id');
      expect(useChatStore.getState().threadMaps['test-topic-id']).toEqual(threads);
    });

    it('should not fetch when activeTopicId is undefined', async () => {
      act(() => {
        useChatStore.setState({ activeTopicId: undefined });
      });

      await act(async () => {
        await useChatStore.getState().refreshThreads();
      });

      expect(threadService.getThreads).not.toHaveBeenCalled();
    });

    it('never rejects when the refetch fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      (threadService.getThreads as Mock).mockRejectedValue(new Error('offline'));

      await expect(useChatStore.getState().refreshThreads()).resolves.toBeUndefined();
    });
  });

  describe('removeThread', () => {
    it('drops the thread from the view and storage even when the refetch fails', async () => {
      const topicId = 'test-topic-id';
      await seedPersistedThreads(topicId, [makeThread('keep', 'Keep'), makeThread('gone', 'Gone')]);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      (threadService.removeThread as Mock).mockResolvedValue(undefined);
      (threadService.getThreads as Mock).mockRejectedValue(new Error('offline'));

      await act(async () => {
        await useChatStore.getState().removeThread('gone');
      });

      expect(useChatStore.getState().threadMaps[topicId]?.map((t) => t.id)).toEqual(['keep']);

      // A reload must not bring the deleted thread back from the local copy.
      simulateReload();
      await act(async () => {
        await useChatStore.getState().preHydrateThreads(topicId);
      });
      expect(useChatStore.getState().threadMaps[topicId]?.map((t) => t.id)).toEqual(['keep']);
    });

    it('restores the thread when the server rejects the delete', async () => {
      const topicId = 'test-topic-id';
      await seedPersistedThreads(topicId, [makeThread('keep', 'Keep'), makeThread('t2', 'T2')]);
      (threadService.removeThread as Mock).mockRejectedValue(new Error('forbidden'));

      await act(async () => {
        await expect(useChatStore.getState().removeThread('t2')).rejects.toThrow('forbidden');
      });

      expect(useChatStore.getState().threadMaps[topicId]?.map((t) => t.id)).toEqual(['keep', 't2']);
    });

    it('should remove thread and refresh threads', async () => {
      const { result } = renderHook(() => useChatStore());

      (threadService.removeThread as Mock).mockResolvedValue(undefined);

      const refreshThreadsSpy = vi
        .spyOn(result.current, 'refreshThreads')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeThread('thread-id');
      });

      expect(threadService.removeThread).toHaveBeenCalledWith('thread-id');
      expect(refreshThreadsSpy).toHaveBeenCalled();
    });

    it('should clear activeThreadId if removing active thread', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeThreadId: 'thread-id' });
      });

      (threadService.removeThread as Mock).mockResolvedValue(undefined);
      vi.spyOn(result.current, 'refreshThreads').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeThread('thread-id');
      });

      expect(result.current.activeThreadId).toBeUndefined();
    });

    it('should not clear activeThreadId if removing different thread', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeThreadId: 'active-thread-id' });
      });

      (threadService.removeThread as Mock).mockResolvedValue(undefined);
      vi.spyOn(result.current, 'refreshThreads').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeThread('different-thread-id');
      });

      expect(result.current.activeThreadId).toBe('active-thread-id');
    });
  });

  describe('updateThreadTitle', () => {
    it('should update thread title via internal_updateThread', async () => {
      const { result } = renderHook(() => useChatStore());

      const internalUpdateSpy = vi
        .spyOn(result.current, 'internal_updateThread')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.updateThreadTitle('thread-id', 'New Title');
      });

      expect(internalUpdateSpy).toHaveBeenCalledWith('thread-id', { title: 'New Title' });
    });
  });

  describe('summaryThreadTitle', () => {
    it('should generate and update thread title via AI', async () => {
      const { result } = renderHook(() => useChatStore());

      const mockThread: ThreadItem = {
        createdAt: new Date(),
        id: 'thread-id',
        lastActiveAt: new Date(),
        sourceMessageId: 'msg-1',
        status: ThreadStatus.Active,
        title: 'Old Title',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
        updatedAt: new Date(),
        userId: 'user-1',
      };

      act(() => {
        useChatStore.setState({
          portalThreadId: 'thread-id',
          threadMaps: {
            'test-topic-id': [mockThread],
          },
        });
      });

      const messages: UIChatMessage[] = [
        {
          content: 'Hello',
          createdAt: Date.now(),
          id: 'msg-1',
          role: 'user',
          agentId: 'test-session-id',
          updatedAt: Date.now(),
        },
      ];

      (aiChatService.generateJSON as Mock).mockResolvedValue({
        data: { title: 'New Generated Title' },
        tracingId: 'tracing-1',
      });

      const internalUpdateSpy = vi
        .spyOn(result.current, 'internal_updateThread')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.summaryThreadTitle('thread-id', messages);
      });

      // Structured generation, not a chat completion — the raw text used to be
      // written straight to the title, which leaked `{"title":"..."}`.
      expect(chatService.fetchPresetTaskResult).not.toHaveBeenCalled();
      expect((aiChatService.generateJSON as Mock).mock.calls[0][0]).toMatchObject({
        metadata: { trigger: RequestTrigger.ThreadTitle },
        schema: { name: 'topic_title' },
        tracing: { scenario: 'topic_title' },
      });
      expect(internalUpdateSpy).toHaveBeenCalledWith('thread-id', {
        title: 'New Generated Title',
      });
    });

    it('should show loading indicator during generation', async () => {
      const { result } = renderHook(() => useChatStore());

      const mockThread: ThreadItem = {
        createdAt: new Date(),
        id: 'thread-id',
        lastActiveAt: new Date(),
        sourceMessageId: 'msg-1',
        status: ThreadStatus.Active,
        title: 'Old Title',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
        updatedAt: new Date(),
        userId: 'user-1',
      };

      act(() => {
        useChatStore.setState({
          portalThreadId: 'thread-id',
          threadMaps: {
            'test-topic-id': [mockThread],
          },
        });
      });

      const loadingSpy = vi.spyOn(result.current, 'internal_updateThreadLoading');
      (aiChatService.generateJSON as Mock).mockResolvedValue({
        data: { title: 'Title' },
        tracingId: 'tracing-1',
      });

      vi.spyOn(result.current, 'internal_updateThread').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.summaryThreadTitle('thread-id', []);
      });

      expect(loadingSpy).toHaveBeenNthCalledWith(1, 'thread-id', true);
      expect(loadingSpy).toHaveBeenLastCalledWith('thread-id', false);
    });

    it('should revert title on error', async () => {
      const { result } = renderHook(() => useChatStore());

      const mockThread: ThreadItem = {
        createdAt: new Date(),
        id: 'thread-id',
        lastActiveAt: new Date(),
        sourceMessageId: 'msg-1',
        status: ThreadStatus.Active,
        title: 'Old Title',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
        updatedAt: new Date(),
        userId: 'user-1',
      };

      act(() => {
        useChatStore.setState({
          portalThreadId: 'thread-id',
          threadMaps: {
            'test-topic-id': [mockThread],
          },
        });
      });

      const titleSpy = vi.spyOn(result.current, 'internal_updateThreadTitleInSummary');
      (aiChatService.generateJSON as Mock).mockRejectedValue(new Error('provider down'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.spyOn(result.current, 'internal_updateThread').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.summaryThreadTitle('thread-id', []);
      });

      // LOADING_FLAT first, then reverted to the old title on error
      expect(titleSpy).toHaveBeenNthCalledWith(1, 'thread-id', LOADING_FLAT);
      expect(titleSpy).toHaveBeenLastCalledWith('thread-id', 'Old Title');
    });

    it('should not run if no portal thread found', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          portalThreadId: undefined,
        });
      });

      await act(async () => {
        await result.current.summaryThreadTitle('thread-id', []);
      });

      expect(chatService.fetchPresetTaskResult).not.toHaveBeenCalled();
    });
  });

  // Note: resendThreadMessage and delAndResendThreadMessage have been moved to ConversationStore

  describe('internal_updateThreadTitleInSummary', () => {
    it('should dispatch thread update', () => {
      const { result } = renderHook(() => useChatStore());

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchThread');

      act(() => {
        useChatStore.setState({
          activeTopicId: 'test-topic-id',
          threadMaps: {
            'test-topic-id': [
              {
                createdAt: new Date(),
                id: 'thread-id',
                lastActiveAt: new Date(),
                sourceMessageId: 'msg-1',
                status: ThreadStatus.Active,
                title: 'Old Title',
                topicId: 'test-topic-id',
                type: ThreadType.Continuation,
                updatedAt: new Date(),
                userId: 'user-1',
              },
            ],
          },
        });
      });

      act(() => {
        result.current.internal_updateThreadTitleInSummary('thread-id', 'New Title');
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        { id: 'thread-id', type: 'updateThread', value: { title: 'New Title' } },
        'updateThreadTitleInSummary',
      );
    });
  });

  describe('internal_updateThreadLoading', () => {
    it('should add thread id to loading list', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.internal_updateThreadLoading('thread-id', true);
      });

      expect(result.current.threadLoadingIds).toContain('thread-id');
    });

    it('should remove thread id from loading list', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ threadLoadingIds: ['thread-id'] });
      });

      act(() => {
        result.current.internal_updateThreadLoading('thread-id', false);
      });

      expect(result.current.threadLoadingIds).not.toContain('thread-id');
    });
  });

  describe('internal_updateThread', () => {
    const seedThread = () =>
      act(() => {
        useChatStore.setState({
          threadMaps: {
            'test-topic-id': [
              {
                createdAt: new Date(),
                id: 'thread-id',
                lastActiveAt: new Date(),
                status: ThreadStatus.Active,
                title: 'Old Title',
                topicId: 'test-topic-id',
                type: ThreadType.Continuation,
                updatedAt: new Date(),
                userId: 'user-1',
              },
            ],
          },
        });
      });

    it('should update thread locally and on server', async () => {
      const { result } = renderHook(() => useChatStore());
      seedThread();

      let resolveUpdate: () => void = () => {};
      (threadService.updateThread as Mock).mockImplementation(
        () => new Promise<void>((resolve) => (resolveUpdate = resolve)),
      );
      const refreshSpy = vi.spyOn(result.current, 'refreshThreads').mockResolvedValue(undefined);
      const loadingSpy = vi.spyOn(result.current, 'internal_updateThreadLoading');

      let pending: Promise<void> = Promise.resolve();
      act(() => {
        pending = result.current.internal_updateThread('thread-id', { title: 'Updated Title' });
      });

      // Optimistic: the new title shows while the server call is in flight.
      expect(useChatStore.getState().threadMaps['test-topic-id'][0].title).toBe('Updated Title');

      await act(async () => {
        resolveUpdate();
        await pending;
      });

      expect(threadService.updateThread).toHaveBeenCalledWith('thread-id', {
        title: 'Updated Title',
      });
      expect(refreshSpy).toHaveBeenCalled();
      expect(loadingSpy).toHaveBeenCalledWith('thread-id', true);
      expect(loadingSpy).toHaveBeenCalledWith('thread-id', false);
    });

    it('rolls the title back and clears loading when the server rejects', async () => {
      seedThread();
      (threadService.updateThread as Mock).mockRejectedValue(new Error('offline'));

      await act(async () => {
        await expect(
          useChatStore.getState().internal_updateThread('thread-id', { title: 'Updated Title' }),
        ).rejects.toThrow('offline');
      });

      expect(useChatStore.getState().threadMaps['test-topic-id'][0].title).toBe('Old Title');
      expect(useChatStore.getState().threadLoadingIds).not.toContain('thread-id');
    });
  });

  describe('internal_dispatchThread', () => {
    it('should update threadMaps with reducer result', () => {
      const { result } = renderHook(() => useChatStore());

      const mockThread: ThreadItem = {
        createdAt: new Date(),
        id: 'thread-id',
        lastActiveAt: new Date(),
        sourceMessageId: 'msg-1',
        status: ThreadStatus.Active,
        title: 'Old Title',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
        updatedAt: new Date(),
        userId: 'user-1',
      };

      act(() => {
        useChatStore.setState({
          activeTopicId: 'test-topic-id',
          threadMaps: {
            'test-topic-id': [mockThread],
          },
        });
      });

      act(() => {
        result.current.internal_dispatchThread({
          id: 'thread-id',
          type: 'updateThread',
          value: { title: 'New Title' },
        });
      });

      const updatedThread = result.current.threadMaps['test-topic-id']?.find(
        (t) => t.id === 'thread-id',
      );
      expect(updatedThread?.title).toBe('New Title');
    });

    it('should not update if result is the same', () => {
      const { result } = renderHook(() => useChatStore());

      const mockThread: ThreadItem = {
        createdAt: new Date(),
        id: 'thread-id',
        lastActiveAt: new Date(),
        sourceMessageId: 'msg-1',
        status: ThreadStatus.Active,
        title: 'Title',
        topicId: 'test-topic-id',
        type: ThreadType.Continuation,
        updatedAt: new Date(),
        userId: 'user-1',
      };

      act(() => {
        useChatStore.setState({
          activeTopicId: 'test-topic-id',
          threadMaps: {
            'test-topic-id': [mockThread],
          },
        });
      });

      const mapsBefore = result.current.threadMaps;

      // Update with non-existent thread id - should not change anything
      act(() => {
        result.current.internal_dispatchThread({
          id: 'non-existent-thread',
          type: 'updateThread',
          value: { title: 'New Title' },
        });
      });

      // Maps should remain the same reference due to isEqual check
      expect(result.current.threadMaps).toEqual(mapsBefore);
    });
  });
});
