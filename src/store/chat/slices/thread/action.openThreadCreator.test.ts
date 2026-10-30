import { type UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThreadType } from '@/types/topic';

import { useChatStore } from '../../store';

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

// Message writes go through the transcript replica, which reads the cache scope.
vi.mock('@/libs/swr/useCacheScope', () => ({
  getCacheScope: () => 'test-scope',
  isScopeTrusted: () => false,
  useCacheScope: () => 'test-scope',
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
  userGeneralSettingsSelectors: {
    currentResponseLanguage: vi.fn(() => 'en-US'),
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
    },
    false,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('thread action', () => {
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

    it('should initialize optimistic parent messages from main scope messages', () => {
      const { result } = renderHook(() => useChatStore());

      const mainMessages: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'first',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          agentId: 'test-session-id',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'reply',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          agentId: 'test-session-id',
        },
        {
          id: 'msg-3',
          role: 'user',
          content: 'second',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          agentId: 'test-session-id',
        },
      ];

      act(() => {
        useChatStore.setState({
          messagesMap: {
            'main_test-session-id_test-topic-id': mainMessages,
          },
        });
      });

      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      act(() => {
        result.current.openThreadCreator('msg-3');
      });

      // Should call replaceMessages with all 3 parent messages (continuation mode)
      expect(replaceMessagesSpy).toHaveBeenCalledWith(
        mainMessages,
        expect.objectContaining({ action: 'initThreadMessages' }),
      );
    });

    it('should use main scope messages even when activeThreadId is set ()', () => {
      const { result } = renderHook(() => useChatStore());

      const mainMessages: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'first',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          agentId: 'test-session-id',
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'reply',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          agentId: 'test-session-id',
        },
        {
          id: 'msg-3',
          role: 'user',
          content: 'second',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          agentId: 'test-session-id',
        },
      ];

      const threadMessages: UIChatMessage[] = [
        {
          id: 'msg-1',
          role: 'user',
          content: 'first',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          agentId: 'test-session-id',
        },
        {
          id: 'thread-msg-1',
          role: 'user',
          content: 'thread msg',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          agentId: 'test-session-id',
          threadId: 'existing-thread',
        },
        {
          id: 'thread-msg-2',
          role: 'assistant',
          content: 'thread reply',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          agentId: 'test-session-id',
          threadId: 'existing-thread',
        },
      ];

      act(() => {
        useChatStore.setState({
          activeThreadId: 'existing-thread',
          messagesMap: {
            // Main scope has all messages including msg-3
            'main_test-session-id_test-topic-id': mainMessages,
            // Thread scope does NOT have msg-3
            'thread_test-session-id_test-topic-id_existing-thread': threadMessages,
          },
        });
      });

      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      act(() => {
        // Fork from msg-3 which only exists in main scope
        result.current.openThreadCreator('msg-3');
      });

      // BUG: if openThreadCreator uses activeDisplayMessages (which includes activeThreadId),
      // it gets thread-scoped messages that don't contain msg-3,
      // genParentMessages returns [], and replaceMessages is never called.
      //
      // FIX: openThreadCreator should always use main scope key to get messages.
      expect(replaceMessagesSpy).toHaveBeenCalledWith(
        mainMessages,
        expect.objectContaining({ action: 'initThreadMessages' }),
      );
    });
  });
});
