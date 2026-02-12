import { type UIChatMessage } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mutate } from '@/libs/swr';
import { chatService } from '@/services/chat';
import { threadService } from '@/services/thread';
import { type ThreadItem } from '@/types/topic';
import { ThreadStatus, ThreadType } from '@/types/topic';

import { useChatStore } from '../../store';

// Mock @/libs/swr mutate
vi.mock('@/libs/swr', async () => {
  const actual = await vi.importActual('@/libs/swr');
  return {
    ...actual,
    mutate: vi.fn(),
  };
});

vi.mock('zustand/traditional');

// Mock version constants
vi.mock('@/const/version', () => ({
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

vi.mock('@/store/user', () => ({
  useUserStore: {
    getState: vi.fn(() => ({})),
  },
}));

vi.mock('@/store/user/selectors', () => ({
  systemAgentSelectors: {
    thread: vi.fn(() => ({})),
  },
  userProfileSelectors: {
    userAvatar: vi.fn(() => 'avatar-url'),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
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
      threadLoadingIds: [],
      threadMaps: {},
      threadStartMessageId: undefined,
      threadsInit: false,
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

  describe('openThreadCreator', () => {
    it('should set thread creator state and open portal', () => {
      const { result } = renderHook(() => useChatStore());
      const pushPortalViewSpy = vi.spyOn(result.current, 'pushPortalView');

      act(() => {
        result.current.openThreadCreator('message-id');
      });

      expect(result.current.threadStartMessageId).toBe('message-id');
      expect(result.current.portalThreadId).toBeUndefined();
      expect(result.current.startToForkThread).toBe(true);
      expect(pushPortalViewSpy).toHaveBeenCalledWith({
        type: 'thread',
        startMessageId: 'message-id',
      });
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
    it('should fetch threads for a given topic id', async () => {
      const topicId = 'test-topic-id';
      const threads: ThreadItem[] = [
        {
          createdAt: new Date(),
          id: 'thread-1',
          lastActiveAt: new Date(),
          sourceMessageId: 'msg-1',
          status: ThreadStatus.Active,
          title: 'Thread 1',
          topicId,
          type: ThreadType.Continuation,
          updatedAt: new Date(),
          userId: 'user-1',
        },
      ];

      (threadService.getThreads as Mock).mockResolvedValue(threads);

      const { result } = renderHook(() => useChatStore().useFetchThreads(true, topicId));

      await waitFor(() => {
        expect(result.current.data).toEqual(threads);
      });

      expect(useChatStore.getState().threadsInit).toBeTruthy();
      expect(useChatStore.getState().threadMaps).toEqual({ [topicId]: threads });
    });

    it('should not fetch when enable is false', async () => {
      const topicId = 'test-topic-id';

      const { result } = renderHook(() => useChatStore().useFetchThreads(false, topicId));

      expect(threadService.getThreads).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });

    it('should not fetch when topicId is undefined', async () => {
      const { result } = renderHook(() => useChatStore().useFetchThreads(true, undefined));

      expect(threadService.getThreads).not.toHaveBeenCalled();
      expect(result.current.data).toBeUndefined();
    });
  });

  describe('refreshThreads', () => {
    it('should trigger SWR mutate for active topic', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeTopicId: 'test-topic-id' });
      });

      await act(async () => {
        await result.current.refreshThreads();
      });

      expect(mutate).toHaveBeenCalledWith(['SWR_USE_FETCH_THREADS', 'test-topic-id']);
    });

    it('should not mutate when activeTopicId is undefined', async () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeTopicId: undefined });
      });

      await act(async () => {
        await result.current.refreshThreads();
      });

      expect(mutate).not.toHaveBeenCalled();
    });
  });

  describe('removeThread', () => {
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

      (chatService.fetchPresetTaskResult as Mock).mockImplementation(
        async ({ onMessageHandle, onFinish }) => {
          await onMessageHandle?.({ text: 'New', type: 'text' });
          await onMessageHandle?.({ text: ' Generated', type: 'text' });
          await onMessageHandle?.({ text: ' Title', type: 'text' });
          await onFinish?.('New Generated Title');
        },
      );

      const internalUpdateSpy = vi
        .spyOn(result.current, 'internal_updateThread')
        .mockResolvedValue(undefined);

      await act(async () => {
        await result.current.summaryThreadTitle('thread-id', messages);
      });

      expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
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

      (chatService.fetchPresetTaskResult as Mock).mockImplementation(
        async ({ onLoadingChange, onFinish }) => {
          await onLoadingChange?.(true);
          await onFinish?.('Title');
          await onLoadingChange?.(false);
        },
      );

      vi.spyOn(result.current, 'internal_updateThread').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.summaryThreadTitle('thread-id', []);
      });

      expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
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

      (chatService.fetchPresetTaskResult as Mock).mockImplementation(async ({ onError }) => {
        await onError?.();
      });

      vi.spyOn(result.current, 'internal_updateThread').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.summaryThreadTitle('thread-id', []);
      });

      // Should have called with LOADING_FLAT first, then reverted to old title on error
      expect(chatService.fetchPresetTaskResult).toHaveBeenCalled();
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
    it('should update thread locally and on server', async () => {
      const { result } = renderHook(() => useChatStore());

      (threadService.updateThread as Mock).mockResolvedValue(undefined);

      const dispatchSpy = vi.spyOn(result.current, 'internal_dispatchThread');
      const refreshSpy = vi.spyOn(result.current, 'refreshThreads').mockResolvedValue(undefined);
      const loadingSpy = vi.spyOn(result.current, 'internal_updateThreadLoading');

      await act(async () => {
        await result.current.internal_updateThread('thread-id', { title: 'Updated Title' });
      });

      expect(dispatchSpy).toHaveBeenCalledWith({
        id: 'thread-id',
        type: 'updateThread',
        value: { title: 'Updated Title' },
      });
      expect(threadService.updateThread).toHaveBeenCalledWith('thread-id', {
        title: 'Updated Title',
      });
      expect(refreshSpy).toHaveBeenCalled();
      expect(loadingSpy).toHaveBeenCalledWith('thread-id', true);
      expect(loadingSpy).toHaveBeenCalledWith('thread-id', false);
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
