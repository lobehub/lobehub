import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '@lobechat/business-const';
import { TOPIC_TITLE_JSON_SCHEMA } from '@lobechat/prompts';
import type { LobeUser, UIChatMessage } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { mutate } from '@/libs/swr';
import { aiChatService } from '@/services/aiChat';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { useAgentStore } from '@/store/agent';
import { PortalViewType } from '@/store/chat/slices/portal/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';
import { type ChatTopic } from '@/types/topic';

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
// Mock topicService 和 messageService
vi.mock('@/services/topic', () => ({
  topicService: {
    removeTopics: vi.fn(),
    removeTopicsByAgentId: vi.fn(),
    removeTopicsByGroupId: vi.fn(),
    removeAllTopic: vi.fn(),
    removeTopic: vi.fn(),
    cloneTopic: vi.fn(),
    createTopic: vi.fn(),
    updateTopicFavorite: vi.fn(),
    updateTopicMetadata: vi.fn(),
    updateTopicTitle: vi.fn(),
    updateTopic: vi.fn(),
    batchRemoveTopics: vi.fn(),
    getTopicDetail: vi.fn(),
    getTopics: vi.fn(),
    queryTopics: vi.fn(),
    searchTopics: vi.fn(),
  },
}));

vi.mock('@/services/message', () => ({
  messageService: {
    removeMessages: vi.fn(),
    removeMessagesByAssistant: vi.fn(),
    getMessages: vi.fn(),
  },
}));

vi.mock('@lobehub/ui/base-ui', () => ({
  toast: {
    error: vi.fn(),
    loading: vi.fn(() => ({ close: vi.fn() })),
    success: vi.fn(),
  },
}));

vi.mock('i18next', () => ({
  t: vi.fn((key, params) => (params.title ? key + '_' + params.title : key)),
}));

beforeEach(() => {
  // Setup initial state and mocks before each test
  vi.clearAllMocks();
  useChatStore.setState(
    {
      activeAgentId: undefined,
      activeGroupId: undefined,
      activeTopicId: undefined,
      agentTopicsViewMap: {},
      searchTopics: [],
      topicDataMap: {},
      topicDetailMap: {},
      // ... initial state
    },
    false,
  );
  useAgentStore.setState({ agentDocumentsMap: {} });
  useUserStore.setState({ user: { id: 'user-1' } as LobeUser });
  useSessionStore.setState(
    {
      activeId: 'inbox',
      defaultSessions: [],
      pinnedSessions: [],
      sessions: [],
      isSessionsFirstFetchFinished: false,
    },
    false,
  );
});

afterEach(() => {
  // Cleanup mocks after each test
  vi.restoreAllMocks();
});

describe('topic action', () => {
  describe('openNewTopicOrSaveTopic', () => {
    it('should call switchTopic if activeTopicId exists', async () => {
      const { result } = renderHook(() => useChatStore());
      await act(async () => {
        useChatStore.setState({ activeTopicId: 'existing-topic-id' });
      });

      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        result.current.openNewTopicOrSaveTopic();
      });

      expect(switchTopicSpy).toHaveBeenCalled();
    });

    it('should call saveToTopic if activeTopicId does not exist', async () => {
      const { result } = renderHook(() => useChatStore());
      await act(async () => {
        useChatStore.setState({ activeTopicId: '' });
      });

      const saveToTopicSpy = vi.spyOn(result.current, 'saveToTopic');

      await act(async () => {
        await result.current.openNewTopicOrSaveTopic();
      });

      expect(saveToTopicSpy).toHaveBeenCalled();
    });

    it('should skip saveToTopic when a send is still in flight in the new-topic context', async () => {
      const { result } = renderHook(() => useChatStore());
      act(() => {
        useChatStore.setState({ activeAgentId: 'session', activeTopicId: undefined });
        // Simulate an in-flight send from the new-topic view (topic not created yet)
        result.current.startOperation({
          type: 'sendMessage',
          context: { agentId: 'session', topicId: null },
        });
      });

      const saveToTopicSpy = vi.spyOn(result.current, 'saveToTopic');

      await act(async () => {
        await result.current.openNewTopicOrSaveTopic();
      });

      expect(saveToTopicSpy).not.toHaveBeenCalled();
    });
  });
  describe('saveToTopic', () => {
    it('should not create a topic if there are no messages', async () => {
      const { result } = renderHook(() => useChatStore());
      act(() => {
        useChatStore.setState({
          messagesMap: {
            [messageMapKey({ agentId: 'session' })]: [],
          },
          activeAgentId: 'session',
        });
      });

      const createTopicSpy = vi.spyOn(topicService, 'createTopic');

      const topicId = await result.current.saveToTopic();

      expect(createTopicSpy).not.toHaveBeenCalled();
      expect(topicId).toBeUndefined();
    });

    it('should create a topic and bind messages to it', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [{ id: 'message1' }, { id: 'message2' }] as UIChatMessage[];
      act(() => {
        useChatStore.setState({
          messagesMap: {
            [messageMapKey({ agentId: 'session-id' })]: messages,
          },
          activeAgentId: 'session-id',
        });
      });

      const createTopicSpy = vi
        .spyOn(topicService, 'createTopic')
        .mockResolvedValue('new-topic-id');

      const topicId = await result.current.saveToTopic();

      expect(createTopicSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-id',
          messages: messages.map((m) => m.id),
        }),
      );
      expect(topicId).toEqual('new-topic-id');
    });

    it('should fire the title summary without blocking saveToTopic', async () => {
      const { result } = renderHook(() => useChatStore());
      const messages = [{ id: 'message1' }, { id: 'message2' }] as UIChatMessage[];
      let resolveSummary!: () => void;
      const summaryPromise = new Promise<void>((resolve) => {
        resolveSummary = resolve;
      });

      act(() => {
        useChatStore.setState({
          activeAgentId: 'session-id',
          messagesMap: {
            [messageMapKey({ agentId: 'session-id' })]: messages,
          },
        });
      });

      vi.spyOn(result.current, 'internal_createTopic').mockResolvedValue('new-topic-id');
      const summarySpy = vi
        .spyOn(result.current, 'summaryTopicTitle')
        .mockReturnValue(summaryPromise);

      await act(async () => {
        // Resolves before the summary settles — the summary is fire-and-forget.
        await result.current.saveToTopic();
      });

      expect(summarySpy).toHaveBeenCalledWith('new-topic-id', messages);

      await act(async () => {
        resolveSummary();
        await summaryPromise;
      });
    });
  });
  describe('refreshTopic', () => {
    beforeEach(() => {
      vi.mock('swr', async () => {
        const actual = await vi.importActual('swr');
        return {
          ...(actual as any),
          mutate: vi.fn(),
        };
      });
    });
    afterEach(() => {
      // 在每个测试用例开始前恢复到实际的 SWR 实现
      vi.resetAllMocks();
    });

    it('should call mutate to refresh topics', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeAgentId = 'test-session-id';

      act(() => {
        useChatStore.setState({ activeAgentId });
      });
      // Mock the mutate function to resolve immediately

      await act(async () => {
        await result.current.refreshTopic();
      });

      // Check if mutate has been called with a matcher function
      expect(mutate).toHaveBeenCalledWith(expect.any(Function));

      // Verify the matcher function works correctly
      // Key format: [SWR_USE_FETCH_TOPIC, containerKey, { isInbox, pageSize }]
      const matcherFn = (mutate as Mock).mock.calls[0][0];
      const containerKey = `agent_${activeAgentId}`;

      // Should match key with correct containerKey
      expect(matcherFn(['topic:list', containerKey, { isInbox: false, pageSize: 20 }])).toBe(true);
      // Should not match key with different containerKey
      expect(matcherFn(['topic:list', 'agent_other-id', { isInbox: false, pageSize: 20 }])).toBe(
        false,
      );
      // Should not match non-array keys
      expect(matcherFn('some-string')).toBe(false);
      // Should not match keys with wrong prefix
      expect(matcherFn(['OTHER_KEY', containerKey, {}])).toBe(false);
    });

    it('should handle errors during refreshing topics', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeAgentId = 'test-session-id';

      act(() => {
        useChatStore.setState({ activeAgentId });
      });
      // Mock the mutate function to throw an error
      // 设置模拟错误
      (mutate as Mock).mockImplementation(() => {
        throw new Error('Mutate error');
      });

      await act(async () => {
        await expect(result.current.refreshTopic()).rejects.toThrow('Mutate error');
      });

      // 确保恢复 mutate 的模拟，以免影响其他测试
      (mutate as Mock).mockReset();
    });

    // Additional tests for refreshTopic can be added here...
  });
  describe('updateTopicModel', () => {
    // The Agent Builder panels render a whole conversation for a builtin agent
    // while the page's activeAgentId still points at the agent being edited, so
    // the topic being switched lives in another `topicDataMap` bucket.
    const BUILDER_KEY = topicMapKey({ agentId: 'builder-agent' });

    const seedBuilderTopic = () => {
      act(() => {
        useChatStore.setState({
          activeAgentId: 'edited-agent',
          activeTopicId: 'builder-topic',
          topicDataMap: {
            [BUILDER_KEY]: {
              currentPage: 0,
              hasMore: false,
              items: [
                {
                  id: 'builder-topic',
                  model: 'glm-5.2',
                  provider: 'lobehub',
                  title: 'Builder chat',
                } as ChatTopic,
              ],
              pageSize: 20,
              total: 1,
            },
          },
        });
      });
    };

    it('applies the switch to the bucket that owns the topic', async () => {
      const { result } = renderHook(() => useChatStore());
      vi.spyOn(topicService, 'updateTopic').mockResolvedValue(undefined as any);
      seedBuilderTopic();

      await act(async () => {
        await result.current.updateTopicModel('builder-topic', {
          model: 'deepseek-v4-flash',
          provider: 'lobehub',
        });
      });

      expect(useChatStore.getState().topicDataMap[BUILDER_KEY].items[0]).toMatchObject({
        model: 'deepseek-v4-flash',
        provider: 'lobehub',
      });
    });

    it('revalidates the owning bucket instead of the active agent bucket', async () => {
      const { result } = renderHook(() => useChatStore());
      vi.spyOn(topicService, 'updateTopic').mockResolvedValue(undefined as any);
      (mutate as Mock).mockClear();
      seedBuilderTopic();

      await act(async () => {
        await result.current.updateTopicModel('builder-topic', {
          model: 'deepseek-v4-flash',
          provider: 'lobehub',
        });
      });

      const matcherFn = (mutate as Mock).mock.calls[0][0];
      expect(matcherFn(['topic:list', BUILDER_KEY, { pageSize: 20 }])).toBe(true);
      expect(matcherFn(['topic:list', topicMapKey({ agentId: 'edited-agent' }), {}])).toBe(false);
    });
  });

  describe('favoriteTopic', () => {
    it('should update the favorite state of a topic and refresh topics', async () => {
      const { result } = renderHook(() => useChatStore());
      const topicId = 'topic-id';
      const favState = true;

      const updateFavoriteSpy = vi
        .spyOn(topicService, 'updateTopic')
        .mockResolvedValue(undefined as any);

      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        await result.current.favoriteTopic(topicId, favState);
      });

      expect(updateFavoriteSpy).toHaveBeenCalledWith(topicId, { favorite: favState });
      expect(refreshTopicSpy).toHaveBeenCalled();
    });

    // Regression tests for issue #12072
    it('should handle non-array groups in SWR cache without throwing TypeError', async () => {
      const { result } = renderHook(() => useChatStore());
      const topicId = 'topic-id';
      const favState = true;
      const activeAgentId = 'test-agent';

      await act(async () => {
        useChatStore.setState({ activeAgentId });
      });

      const updateFavoriteSpy = vi
        .spyOn(topicService, 'updateTopic')
        .mockResolvedValue(undefined as any);

      // Mock mutate to receive a non-array value (malformed cache)
      (mutate as Mock).mockImplementation(async (_key, updateFn) => {
        if (typeof updateFn === 'function') {
          // Pass non-array values to test defensive checks
          const testCases = [
            null,
            undefined,
            'string-instead-of-array',
            { wrongStructure: true },
            42,
          ];

          for (const malformedData of testCases) {
            const result = updateFn(malformedData);
            // Should return the malformed data as-is without throwing
            expect(result).toBe(malformedData);
          }
        }
      });

      // Should not throw TypeError when cache has malformed data
      await act(async () => {
        await expect(result.current.favoriteTopic(topicId, favState)).resolves.not.toThrow();
      });

      expect(updateFavoriteSpy).toHaveBeenCalledWith(topicId, { favorite: favState });
    });

    it('should handle groups with non-array topics field without throwing TypeError', async () => {
      const { result } = renderHook(() => useChatStore());
      const topicId = 'topic-id';
      const favState = true;
      const activeAgentId = 'test-agent';

      await act(async () => {
        useChatStore.setState({ activeAgentId });
      });

      const updateFavoriteSpy = vi
        .spyOn(topicService, 'updateTopic')
        .mockResolvedValue(undefined as any);

      // Mock mutate to test groups with malformed topics field
      (mutate as Mock).mockImplementation(async (_key, updateFn) => {
        if (typeof updateFn === 'function') {
          // Test groups where topics is not an array
          const malformedGroups = [
            {
              cronJob: {},
              cronJobId: 'job-1',
              topics: null, // topics is null
            },
            {
              cronJob: {},
              cronJobId: 'job-2',
              topics: undefined, // topics is undefined
            },
            {
              cronJob: {},
              cronJobId: 'job-3',
              topics: 'not-an-array', // topics is a string
            },
            {
              cronJob: {},
              cronJobId: 'job-4',
              topics: { id: 'malformed' }, // topics is an object
            },
          ];

          const result = updateFn(malformedGroups);

          // When no topic matches, the function returns original groups unchanged
          // The important thing is it doesn't throw a TypeError on .map()
          expect(result).toBe(malformedGroups);
        }
      });

      // Should not throw TypeError when groups have malformed topics
      await act(async () => {
        await expect(result.current.favoriteTopic(topicId, favState)).resolves.not.toThrow();
      });

      expect(updateFavoriteSpy).toHaveBeenCalledWith(topicId, { favorite: favState });
    });

    it('should correctly update favorite state in well-formed cache data', async () => {
      const { result } = renderHook(() => useChatStore());
      const topicId = 'topic-to-favorite';
      const favState = true;
      const activeAgentId = 'test-agent';

      await act(async () => {
        useChatStore.setState({ activeAgentId });
      });

      const updateFavoriteSpy = vi
        .spyOn(topicService, 'updateTopic')
        .mockResolvedValue(undefined as any);

      // Mock mutate to test correct behavior with well-formed data
      (mutate as Mock).mockImplementation(async (_key, updateFn) => {
        if (typeof updateFn === 'function') {
          const wellFormedGroups = [
            {
              cronJob: {},
              cronJobId: 'job-1',
              topics: [
                { id: 'other-topic', favorite: false, title: 'Other' },
                { id: topicId, favorite: false, title: 'Target' },
              ],
            },
          ];

          const result = updateFn(wellFormedGroups);

          // Should return updated array with favorite state changed
          expect(Array.isArray(result)).toBe(true);
          const updatedTopic = result[0].topics.find((t: any) => t.id === topicId);
          expect(updatedTopic).toBeDefined();
          expect(updatedTopic.favorite).toBe(favState);

          // Other topics should remain unchanged
          const otherTopic = result[0].topics.find((t: any) => t.id === 'other-topic');
          expect(otherTopic.favorite).toBe(false);
        }
      });

      await act(async () => {
        await result.current.favoriteTopic(topicId, favState);
      });

      expect(updateFavoriteSpy).toHaveBeenCalledWith(topicId, { favorite: favState });
    });

    it('should return original groups when no updates are needed', async () => {
      const { result } = renderHook(() => useChatStore());
      const topicId = 'topic-already-favorited';
      const favState = true;
      const activeAgentId = 'test-agent';

      await act(async () => {
        useChatStore.setState({ activeAgentId });
      });

      const updateFavoriteSpy = vi
        .spyOn(topicService, 'updateTopic')
        .mockResolvedValue(undefined as any);

      // Mock mutate to test no-op scenario
      (mutate as Mock).mockImplementation(async (_key, updateFn) => {
        if (typeof updateFn === 'function') {
          const originalGroups = [
            {
              cronJob: {},
              cronJobId: 'job-1',
              topics: [
                { id: topicId, favorite: true, title: 'Already Favorited' }, // Already has the target state
              ],
            },
          ];

          const result = updateFn(originalGroups);

          // Should return the same reference when no updates are made
          expect(result).toBe(originalGroups);
        }
      });

      await act(async () => {
        await result.current.favoriteTopic(topicId, favState);
      });

      expect(updateFavoriteSpy).toHaveBeenCalledWith(topicId, { favorite: favState });
    });
  });
  describe('updateTopicStatus', () => {
    // Unique ids: updateTopicStatus registers a TTL-bounded pending status-write
    // in a private map that beforeEach's state reset can't clear, so a shared id
    // would bleed status onto other tests' fetched-topic fixtures.
    it('stamps completedAt when archiving (status: completed)', async () => {
      const { result } = renderHook(() => useChatStore());
      const topicId = 'update-status-completed-topic';

      const updateSpy = vi.spyOn(topicService, 'updateTopic').mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.updateTopicStatus({ status: 'completed', topicId });
      });

      // "Archive" persists the completion timestamp alongside the status so the
      // bulk/stale archive matches the single-item markTopicCompleted.
      expect(updateSpy).toHaveBeenCalledWith(topicId, {
        completedAt: expect.any(Date),
        status: 'completed',
      });
    });

    it('does not touch completedAt for non-completed transitions', async () => {
      const { result } = renderHook(() => useChatStore());
      const topicId = 'update-status-running-topic';

      const updateSpy = vi.spyOn(topicService, 'updateTopic').mockResolvedValue(undefined as any);

      await act(async () => {
        await result.current.updateTopicStatus({ status: 'running', topicId });
      });

      // Agent-run status writes must stay a pure status update — no completedAt.
      expect(updateSpy).toHaveBeenCalledWith(topicId, { status: 'running' });
    });
  });
  describe('useFetchTopicDetail', () => {
    // Regression: an archived (completed) topic is excluded from the sidebar
    // list fetch, so the active topic vanished from topicDataMap and the
    // header degraded to the "new topic" placeholder. The by-id detail fetch
    // caches the row in topicDetailMap, which currentActiveTopic falls back to.
    it('caches the fetched topic in topicDetailMap', async () => {
      const archived = { id: 'archived-topic', status: 'completed', title: 'Archived Topic' };
      (topicService.getTopicDetail as Mock).mockResolvedValue(archived);

      const { result } = renderHook(() => useChatStore().useFetchTopicDetail('archived-topic'));

      await waitFor(() => {
        expect(result.current.data).toEqual(archived);
      });
      expect(useChatStore.getState().topicDetailMap['archived-topic']).toEqual(archived);
    });

    it('does not fetch when no topic id is given', () => {
      renderHook(() => useChatStore().useFetchTopicDetail(undefined));
      expect(topicService.getTopicDetail).not.toHaveBeenCalled();
    });
  });

  describe('useFetchTopics', () => {
    it('should fetch topics for a given session id', async () => {
      const sessionId = 'test-session-id';
      const topics = [{ id: 'topic-id', title: 'Test Topic' }];

      // Mock the topicService.getTopics to resolve with paginated result
      (topicService.getTopics as Mock).mockResolvedValue({ items: topics, total: topics.length });

      // Use the hook with the session id
      const { result } = renderHook(() =>
        useChatStore().useFetchTopics(true, { agentId: sessionId }),
      );

      // Wait for the hook to resolve and update the state
      await waitFor(() => {
        expect(result.current.data).toEqual({ items: topics, total: topics.length });
      });
      // Verify topics are stored in topicDataMap with correct key
      expect(
        useChatStore.getState().topicDataMap[topicMapKey({ agentId: sessionId })]?.items,
      ).toEqual(topics);
    });

    describe('unread message prefetch', () => {
      // Regression: unread prefetch used to live only in the sidebar item's
      // mount effect, so topics in collapsed groups / outside the virtualized
      // viewport were never warmed — first click rendered the creation-time
      // seed (first message only) until the switch revalidation landed.

      it('prefetches messages for topics that flip to unread in a refetch', async () => {
        const agentId = 'unread-flip-agent';
        const prefetchMessages = vi.fn();
        act(() => {
          useChatStore.setState({
            prefetchMessages,
            topicDataMap: {
              [topicMapKey({ agentId })]: {
                currentPage: 0,
                hasMore: false,
                isInbox: false,
                items: [{ id: 'tpc-flip', status: 'running', title: 'Running' }] as ChatTopic[],
                pageSize: 20,
                total: 1,
              },
            },
          });
        });
        (topicService.getTopics as Mock).mockResolvedValue({
          items: [{ id: 'tpc-flip', status: 'unread', title: 'Done' }],
          total: 1,
        });

        renderHook(() => useChatStore().useFetchTopics(true, { agentId }));

        await waitFor(() => {
          expect(prefetchMessages).toHaveBeenCalledWith({
            agentId,
            scope: 'main',
            topicId: 'tpc-flip',
          });
        });
      });

      it('sweeps already-unread topics on the first list load (app-closed runs)', async () => {
        const agentId = 'unread-boot-agent';
        const prefetchMessages = vi.fn();
        act(() => {
          useChatStore.setState({ prefetchMessages });
        });
        (topicService.getTopics as Mock).mockResolvedValue({
          items: [
            { id: 'tpc-a', status: 'unread', title: 'A' },
            { id: 'tpc-b', status: null, title: 'B' },
            { id: 'tpc-c', status: 'unread', title: 'C' },
          ],
          total: 3,
        });

        renderHook(() => useChatStore().useFetchTopics(true, { agentId }));

        await waitFor(() => {
          expect(prefetchMessages).toHaveBeenCalledTimes(2);
        });
        expect(prefetchMessages).toHaveBeenCalledWith({ agentId, scope: 'main', topicId: 'tpc-a' });
        expect(prefetchMessages).toHaveBeenCalledWith({ agentId, scope: 'main', topicId: 'tpc-c' });
      });

      it('does not re-prefetch topics that were already unread, and caps the fan-out', async () => {
        const agentId = 'unread-cap-agent';
        const prefetchMessages = vi.fn();
        const alreadyUnread = { id: 'tpc-old', status: 'unread', title: 'Old' } as ChatTopic;
        act(() => {
          useChatStore.setState({
            prefetchMessages,
            topicDataMap: {
              [topicMapKey({ agentId })]: {
                currentPage: 0,
                hasMore: false,
                isInbox: false,
                items: [alreadyUnread],
                pageSize: 20,
                total: 1,
              },
            },
          });
        });
        // 1 already-unread + 7 fresh flips → only 5 (the cap) prefetch, none for tpc-old
        (topicService.getTopics as Mock).mockResolvedValue({
          items: [
            alreadyUnread,
            ...Array.from({ length: 7 }, (_, index) => ({
              id: `tpc-new-${index}`,
              status: 'unread',
              title: `New ${index}`,
            })),
          ],
          total: 8,
        });

        renderHook(() => useChatStore().useFetchTopics(true, { agentId }));

        await waitFor(() => {
          expect(prefetchMessages).toHaveBeenCalledTimes(5);
        });
        expect(prefetchMessages).not.toHaveBeenCalledWith(
          expect.objectContaining({ topicId: 'tpc-old' }),
        );
      });

      it('skips group topic lists (message buckets are not representable)', async () => {
        const prefetchMessages = vi.fn();
        act(() => {
          useChatStore.setState({ prefetchMessages });
        });
        (topicService.getTopics as Mock).mockResolvedValue({
          items: [{ id: 'tpc-group', status: 'unread', title: 'G' }],
          total: 1,
        });

        renderHook(() => useChatStore().useFetchTopics(true, { groupId: 'grp-1' }));

        await waitFor(() => {
          expect(
            useChatStore.getState().topicDataMap[topicMapKey({ groupId: 'grp-1' })]?.items,
          ).toBeDefined();
        });
        expect(prefetchMessages).not.toHaveBeenCalled();
      });
    });

    it('should preserve expanded topic list when first page revalidates after deletion', async () => {
      const agentId = 'expanded-delete-agent';
      const pageSize = 20;
      const currentTopics = [
        ...Array.from({ length: 19 }, (_, index) => ({
          id: `topic-${index + 1}`,
          title: `Topic ${index + 1}`,
        })),
        ...Array.from({ length: 20 }, (_, index) => ({
          id: `topic-${index + 21}`,
          title: `Topic ${index + 21}`,
        })),
      ] as ChatTopic[];
      const refreshedFirstPage = [
        ...Array.from({ length: 19 }, (_, index) => ({
          id: `topic-${index + 1}`,
          title: `Topic ${index + 1}`,
        })),
        { id: 'topic-21', title: 'Topic 21' },
      ];

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          topicDataMap: {
            [topicMapKey({ agentId })]: {
              currentPage: 1,
              excludeTriggers: ['cron', 'eval'],
              hasMore: true,
              isInbox: false,
              items: currentTopics,
              pageSize,
              total: 59,
            },
          },
        });
      });

      (topicService.getTopics as Mock).mockResolvedValue({
        items: refreshedFirstPage,
        total: 59,
      });

      const useFetchTopics = useChatStore.getState().useFetchTopics;

      const swrResponse = renderHook(() =>
        useFetchTopics(true, { agentId, excludeTriggers: ['cron', 'eval'], pageSize }),
      );

      await waitFor(() => {
        expect(swrResponse.result.current.data).toEqual({
          items: refreshedFirstPage,
          total: 59,
        });
      });

      await waitFor(() => {
        const topicData = useChatStore.getState().topicDataMap[topicMapKey({ agentId })];

        expect(topicData).toMatchObject({
          currentPage: 1,
          hasMore: true,
          total: 59,
        });
        expect(topicData.items).toHaveLength(39);
        expect(topicData.items.map((topic) => topic.id)).toEqual([
          ...Array.from({ length: 19 }, (_, index) => `topic-${index + 1}`),
          ...Array.from({ length: 20 }, (_, index) => `topic-${index + 21}`),
        ]);
      });
    });

    it('should preserve expanded topic list when first page reorders after favorite refresh', async () => {
      const agentId = 'favorite-agent';
      const pageSize = 20;
      const currentTopics = Array.from({ length: 40 }, (_, index) => ({
        favorite: index === 34,
        id: `topic-${index + 1}`,
        title: `Topic ${index + 1}`,
      })) as ChatTopic[];
      const refreshedFirstPage = [
        { favorite: true, id: 'topic-35', title: 'Topic 35' },
        ...Array.from({ length: 19 }, (_, index) => ({
          favorite: false,
          id: `topic-${index + 1}`,
          title: `Topic ${index + 1}`,
        })),
      ];

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          topicDataMap: {
            [topicMapKey({ agentId })]: {
              currentPage: 1,
              excludeTriggers: ['cron', 'eval'],
              hasMore: true,
              isInbox: false,
              items: currentTopics,
              pageSize,
              total: 60,
            },
          },
        });
      });

      (topicService.getTopics as Mock).mockResolvedValue({
        items: refreshedFirstPage,
        total: 60,
      });

      const useFetchTopics = useChatStore.getState().useFetchTopics;
      const swrResponse = renderHook(() =>
        useFetchTopics(true, { agentId, excludeTriggers: ['cron', 'eval'], pageSize }),
      );

      await waitFor(() => {
        expect(swrResponse.result.current.data).toEqual({
          items: refreshedFirstPage,
          total: 60,
        });
      });

      await waitFor(() => {
        const topicData = useChatStore.getState().topicDataMap[topicMapKey({ agentId })];

        expect(topicData).toMatchObject({
          currentPage: 1,
          hasMore: true,
          total: 60,
        });
        expect(topicData.items).toHaveLength(40);
        expect(topicData.items[0].id).toBe('topic-35');
        expect(topicData.items.some((topic) => topic.id === 'topic-40')).toBe(true);
      });
    });

    it('should reset expanded pagination when excludeTriggers changes for the same agent', async () => {
      const agentId = 'filtered-agent';
      const pageSize = 20;
      const currentTopics = Array.from({ length: 40 }, (_, index) => ({
        id: `topic-${index + 1}`,
        title: `Topic ${index + 1}`,
      })) as ChatTopic[];
      const refreshedTopics = Array.from({ length: 20 }, (_, index) => ({
        id: `new-topic-${index + 1}`,
        title: `New Topic ${index + 1}`,
      }));

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          topicDataMap: {
            [topicMapKey({ agentId })]: {
              currentPage: 1,
              excludeTriggers: ['cron', 'eval'],
              hasMore: true,
              isInbox: false,
              items: currentTopics,
              pageSize,
              total: 60,
            },
          },
        });
      });

      (topicService.getTopics as Mock).mockResolvedValue({
        items: refreshedTopics,
        total: 20,
      });

      const useFetchTopics = useChatStore.getState().useFetchTopics;
      const swrResponse = renderHook(() =>
        useFetchTopics(true, { agentId, excludeTriggers: ['cron'], pageSize }),
      );

      await waitFor(() => {
        expect(swrResponse.result.current.data).toEqual({ items: refreshedTopics, total: 20 });
      });

      await waitFor(() => {
        const topicData = useChatStore.getState().topicDataMap[topicMapKey({ agentId })];

        expect(topicData).toMatchObject({
          currentPage: 0,
          excludeTriggers: ['cron'],
          hasMore: false,
          total: 20,
        });
        expect(topicData.items).toEqual(refreshedTopics);
      });
    });

    it('should reset expanded pagination when excludeStatuses changes for the same agent', async () => {
      const agentId = 'status-filtered-agent';
      const pageSize = 20;
      const currentTopics = Array.from({ length: 40 }, (_, index) => ({
        id: `topic-${index + 1}`,
        title: `Topic ${index + 1}`,
      })) as ChatTopic[];
      const refreshedTopics = Array.from({ length: 20 }, (_, index) => ({
        id: `active-topic-${index + 1}`,
        title: `Active Topic ${index + 1}`,
      }));

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          topicDataMap: {
            [topicMapKey({ agentId })]: {
              currentPage: 1,
              excludeStatuses: ['completed', 'archived'],
              hasMore: true,
              isInbox: false,
              items: currentTopics,
              pageSize,
              total: 60,
            },
          },
        });
      });

      (topicService.getTopics as Mock).mockResolvedValue({
        items: refreshedTopics,
        total: 20,
      });

      const useFetchTopics = useChatStore.getState().useFetchTopics;
      const swrResponse = renderHook(() =>
        useFetchTopics(true, { agentId, excludeStatuses: ['completed'], pageSize }),
      );

      await waitFor(() => {
        expect(swrResponse.result.current.data).toEqual({ items: refreshedTopics, total: 20 });
      });

      await waitFor(() => {
        const topicData = useChatStore.getState().topicDataMap[topicMapKey({ agentId })];

        expect(topicData).toMatchObject({
          currentPage: 0,
          excludeStatuses: ['completed'],
          hasMore: false,
          total: 20,
        });
        expect(topicData.items).toEqual(refreshedTopics);
      });
    });
  });
  describe('useSearchTopics', () => {
    it('should search topics with the given keywords', async () => {
      const keywords = 'search-term';
      const searchResults = [{ id: 'searched-topic-id', title: 'Searched Topic' }];

      // Mock the topicService.searchTopics to resolve with search results
      (topicService.searchTopics as Mock).mockResolvedValue(searchResults);

      // Use the hook with the keywords
      const { result } = renderHook(() => useChatStore().useSearchTopics(keywords, {}));

      // Wait for the hook to resolve and update the state
      await waitFor(() => {
        expect(result.current.data).toEqual(searchResults);
      });
    });
  });
  describe('updateTopicTitle', () => {
    it('should call topicService.updateTitle with correct parameters and refresh the topic', async () => {
      const topicId = 'topic-id';
      const newTitle = 'Updated Topic Title';
      // Mock the topicService.updateTitle to resolve immediately

      const spyOn = vi.spyOn(topicService, 'updateTopic');

      const { result } = renderHook(() => useChatStore());

      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      // Call the action with the topicId and newTitle
      await act(async () => {
        await result.current.updateTopicTitle(topicId, newTitle);
      });

      // Verify that the topicService.updateTitle was called with correct parameters
      expect(spyOn).toHaveBeenCalledWith(topicId, {
        title: 'Updated Topic Title',
      });

      // Verify that the refreshTopic was called to update the state
      expect(refreshTopicSpy).toHaveBeenCalled();
    });

    it('should update the detail cache when the topic is absent from list buckets', async () => {
      const topicId = 'archived-topic';
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          topicDataMap: {},
          topicDetailMap: {
            [topicId]: { id: topicId, status: 'completed', title: 'Old title' } as ChatTopic,
          },
        });
      });
      vi.spyOn(result.current, 'refreshTopic').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.updateTopicTitle(topicId, 'New title');
      });

      expect(useChatStore.getState().topicDetailMap[topicId]).toMatchObject({
        status: 'completed',
        title: 'New title',
      });
    });
  });
  describe('switchTopic', () => {
    it('should update activeTopicId and softly revalidate messages', async () => {
      const topicId = 'topic-id';
      const { result } = renderHook(() => useChatStore());

      const revalidateMessagesSpy = vi.spyOn(result.current, 'revalidateMessages');
      // Call the switchTopic action with the topicId
      await act(async () => {
        await result.current.switchTopic(topicId);
      });

      // Verify that the activeTopicId has been updated
      expect(useChatStore.getState().activeTopicId).toBe(topicId);

      // Verify that the refreshMessages was called to update the messages
      expect(revalidateMessagesSpy).toHaveBeenCalled();
    });

    it('should support options object as second parameter', async () => {
      const topicId = 'topic-id';
      const { result } = renderHook(() => useChatStore());

      const revalidateMessagesSpy = vi.spyOn(result.current, 'revalidateMessages');

      // Call with options object (new API)
      await act(async () => {
        await result.current.switchTopic(topicId, { skipRefreshMessage: true });
      });

      expect(useChatStore.getState().activeTopicId).toBe(topicId);
      expect(revalidateMessagesSpy).not.toHaveBeenCalled();
    });

    it('should clear new key data when switching to null (main scope)', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeAgentId = 'test-agent-id';
      const newKey = messageMapKey({ agentId: activeAgentId, topicId: null });

      // Setup initial state with some messages in the new key
      await act(async () => {
        useChatStore.setState({
          activeAgentId,
          activeTopicId: 'existing-topic',
          dbMessagesMap: {
            [newKey]: [{ id: 'msg-1' }, { id: 'msg-2' }] as any,
          },
          messagesMap: {
            [newKey]: [{ id: 'msg-1' }, { id: 'msg-2' }] as any,
          },
          portalStack: [{ type: PortalViewType.Home }],
          showPortal: true,
        });
      });

      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      // Switch to new state (id = null)
      await act(async () => {
        await result.current.switchTopic(null, { skipRefreshMessage: true });
      });

      // Verify replaceMessages was called to clear the new key
      expect(replaceMessagesSpy).toHaveBeenCalledWith([], {
        context: {
          agentId: activeAgentId,
          groupId: undefined,
          scope: 'main',
          topicId: null,
        },
        action: expect.any(String),
      });

      // Verify activeTopicId is now null
      expect(useChatStore.getState().activeTopicId).toBeNull();
      expect(useChatStore.getState().portalStack).toEqual([]);
      expect(useChatStore.getState().showPortal).toBe(false);
    });

    it('should clear new key data when switching to null (group scope)', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeAgentId = 'test-agent-id';
      const activeGroupId = 'test-group-id';

      // Setup initial state with group context
      await act(async () => {
        useChatStore.setState({
          activeAgentId,
          activeGroupId,
          activeTopicId: 'existing-topic',
        });
      });

      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      // Switch to new state with null
      await act(async () => {
        await result.current.switchTopic(null, { skipRefreshMessage: true });
      });

      // Verify replaceMessages was called with group scope
      expect(replaceMessagesSpy).toHaveBeenCalledWith([], {
        context: {
          agentId: activeAgentId,
          groupId: activeGroupId,
          scope: 'group',
          topicId: null,
        },
        action: expect.any(String),
      });
    });

    it('should use explicit scope from options when provided', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeAgentId = 'test-agent-id';

      await act(async () => {
        useChatStore.setState({
          activeAgentId,
          activeTopicId: 'existing-topic',
        });
      });

      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      // Switch to null with explicit scope
      await act(async () => {
        await result.current.switchTopic(null, { skipRefreshMessage: true, scope: 'group' });
      });

      // Verify replaceMessages was called with explicit scope
      expect(replaceMessagesSpy).toHaveBeenCalledWith([], {
        context: expect.objectContaining({
          scope: 'group',
        }),
        action: expect.any(String),
      });
    });

    it('should clear new key data when switching with undefined (same as null)', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeAgentId = 'test-agent-id';

      await act(async () => {
        useChatStore.setState({
          activeAgentId,
          activeTopicId: 'existing-topic',
        });
      });

      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      // Switch with undefined (should clear because id == null matches both null and undefined)
      await act(async () => {
        await result.current.switchTopic(undefined, { skipRefreshMessage: true });
      });

      // replaceMessages SHOULD be called when switching with undefined
      expect(replaceMessagesSpy).toHaveBeenCalledWith([], {
        context: expect.objectContaining({
          agentId: activeAgentId,
          topicId: null,
        }),
        action: expect.any(String),
      });
    });

    it('should not clear new key data when switching to an existing topic', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeAgentId = 'test-agent-id';

      await act(async () => {
        useChatStore.setState({
          activeAgentId,
          activeTopicId: undefined,
        });
      });

      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      // Switch to an existing topic (not new state)
      await act(async () => {
        await result.current.switchTopic('existing-topic-id', { skipRefreshMessage: true });
      });

      // replaceMessages should not be called when switching to existing topic
      expect(replaceMessagesSpy).not.toHaveBeenCalled();
    });

    it('should clear new key data when clearNewKey option is true (even with existing topic)', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeAgentId = 'test-agent-id';
      const newKey = messageMapKey({ agentId: activeAgentId, topicId: null });

      // Setup initial state with some messages in the new key
      await act(async () => {
        useChatStore.setState({
          activeAgentId,
          activeTopicId: undefined,
          dbMessagesMap: {
            [newKey]: [{ id: 'msg-1' }, { id: 'msg-2' }] as any,
          },
          messagesMap: {
            [newKey]: [{ id: 'msg-1' }, { id: 'msg-2' }] as any,
          },
        });
      });

      const replaceMessagesSpy = vi.spyOn(result.current, 'replaceMessages');

      // Switch to an existing topic with clearNewKey option
      await act(async () => {
        await result.current.switchTopic('new-created-topic-id', {
          clearNewKey: true,
          skipRefreshMessage: true,
        });
      });

      // replaceMessages should be called to clear the new key
      expect(replaceMessagesSpy).toHaveBeenCalledWith([], {
        context: {
          agentId: activeAgentId,
          groupId: undefined,
          scope: 'main',
          topicId: null,
        },
        action: expect.any(String),
      });

      // Verify activeTopicId is set to the new topic
      expect(useChatStore.getState().activeTopicId).toBe('new-created-topic-id');
    });

    it('should skip revalidateMessages for superseded overlapping switches', async () => {
      const { result } = renderHook(() => useChatStore());
      const revalidateSpy = vi
        .spyOn(result.current, 'revalidateMessages')
        .mockResolvedValue(undefined);

      // Fire two overlapping switches: the sync body of both runs before
      // either yields, so by the microtask boundary the second has already
      // bumped the epoch and the first should bail out before fetching.
      await act(async () => {
        const p1 = result.current.switchTopic('topic-a');
        const p2 = result.current.switchTopic('topic-b');
        await Promise.all([p1, p2]);
      });

      expect(revalidateSpy).toHaveBeenCalledTimes(1);
      expect(useChatStore.getState().activeTopicId).toBe('topic-b');
    });
  });
  describe('removeSessionTopics', () => {
    it('should remove all topics from the current session and refresh the topic list', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeAgentId = 'test-session-id';
      await act(async () => {
        useChatStore.setState({ activeAgentId });
      });
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        await result.current.removeSessionTopics();
      });

      expect(topicService.removeTopicsByAgentId).toHaveBeenCalledWith(activeAgentId, 'own');
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
    });

    it('forwards explicit workspace scope for an owner full delete', async () => {
      const { result } = renderHook(() => useChatStore());
      await act(async () => {
        useChatStore.setState({ activeAgentId: 'agent-owner' });
        await result.current.removeSessionTopics('workspace');
      });

      expect(topicService.removeTopicsByAgentId).toHaveBeenCalledWith('agent-owner', 'workspace');
    });
  });
  describe('removeGroupTopics', () => {
    it('should remove all topics through the group-scoped endpoint and refresh state', async () => {
      const { result } = renderHook(() => useChatStore());
      const groupId = 'group-delete';
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic').mockResolvedValue(undefined);
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeGroupTopics(groupId);
      });

      expect(topicService.removeTopicsByGroupId).toHaveBeenCalledWith(groupId, 'own');
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
    });

    it('forwards explicit workspace scope through the group endpoint', async () => {
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.removeGroupTopics('group-owner', 'workspace');
      });

      expect(topicService.removeTopicsByGroupId).toHaveBeenCalledWith('group-owner', 'workspace');
    });
  });
  describe('removeAllTopics', () => {
    it('should remove all topics and refresh the topic list', async () => {
      const { result } = renderHook(() => useChatStore());

      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        await result.current.removeAllTopics();
      });

      expect(topicService.removeAllTopic).toHaveBeenCalled();
      expect(refreshTopicSpy).toHaveBeenCalled();
    });
  });
  describe('removeTopic', () => {
    it('should remove a specific topic and its messages, then refresh the topic list', async () => {
      const topicId = 'topic-1';
      const { result } = renderHook(() => useChatStore());
      const activeAgentId = 'test-session-id';

      await act(async () => {
        useChatStore.setState({ activeAgentId, activeTopicId: topicId });
      });

      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        await result.current.removeTopic(topicId);
      });

      expect(topicService.removeTopic).toHaveBeenCalledWith(topicId, undefined);
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
    });

    it('should evict a detail-only topic after deletion', async () => {
      const topicId = 'archived-topic';
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId: 'test-session-id',
          topicDataMap: {},
          topicDetailMap: {
            [topicId]: { id: topicId, status: 'completed', title: 'Archived' } as ChatTopic,
          },
        });
      });
      vi.spyOn(result.current, 'refreshTopic').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeTopic(topicId);
      });

      expect(useChatStore.getState().topicDetailMap[topicId]).toBeUndefined();
    });
    it('should forward removeFiles so the topic attachments are deleted', async () => {
      const topicId = 'topic-1';
      const { result } = renderHook(() => useChatStore());
      const activeAgentId = 'test-session-id';

      await act(async () => {
        useChatStore.setState({ activeAgentId, activeTopicId: topicId });
      });

      vi.spyOn(result.current, 'refreshTopic').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeTopic(topicId, true);
      });

      expect(topicService.removeTopic).toHaveBeenCalledWith(topicId, true);
    });

    it('should remove a specific topic and its messages, then not switch topic if not active', async () => {
      const topicId = 'topic-1';
      const { result } = renderHook(() => useChatStore());
      const activeAgentId = 'test-session-id';

      await act(async () => {
        useChatStore.setState({ activeAgentId });
      });

      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        await result.current.removeTopic(topicId);
      });

      expect(topicService.removeTopic).toHaveBeenCalledWith(topicId, undefined);
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).not.toHaveBeenCalled();
    });

    it('should remove topic when activeGroupId is set (group scenario)', async () => {
      const topicId = 'topic-1';
      const { result } = renderHook(() => useChatStore());
      const activeGroupId = 'test-group-id';

      await act(async () => {
        useChatStore.setState({ activeGroupId, activeTopicId: topicId });
      });

      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        await result.current.removeTopic(topicId);
      });

      expect(topicService.removeTopic).toHaveBeenCalledWith(topicId, undefined);
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
    });

    it('should not remove topic when neither agentId nor groupId is active', async () => {
      const topicId = 'topic-1';
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        useChatStore.setState({ activeAgentId: undefined, activeGroupId: undefined });
      });

      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        await result.current.removeTopic(topicId);
      });

      expect(topicService.removeTopic).not.toHaveBeenCalled();
      expect(refreshTopicSpy).not.toHaveBeenCalled();
    });

    it('should keep expanded pagination state after removing a topic', async () => {
      const topicId = 'topic-21';
      const activeAgentId = 'expanded-agent';
      const existingTopics = Array.from({ length: 40 }, (_, index) => ({
        id: `topic-${index + 1}`,
        title: `Topic ${index + 1}`,
      })) as ChatTopic[];
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({
          activeAgentId,
          topicDataMap: {
            [topicMapKey({ agentId: activeAgentId })]: {
              currentPage: 1,
              hasMore: true,
              isInbox: false,
              items: existingTopics,
              pageSize: 20,
              total: 60,
            },
          },
        });
      });

      vi.spyOn(result.current, 'refreshTopic').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeTopic(topicId);
      });

      const topicData =
        useChatStore.getState().topicDataMap[topicMapKey({ agentId: activeAgentId })];

      expect(topicService.removeTopic).toHaveBeenCalledWith(topicId, undefined);
      expect(topicData).toMatchObject({
        currentPage: 1,
        hasMore: true,
        total: 59,
      });
      expect(topicData.items).toHaveLength(39);
      expect(topicData.items.some((topic) => topic.id === topicId)).toBe(false);
    });

    it('should initialize addTopic total correctly for empty containers', async () => {
      const activeAgentId = 'empty-agent';
      const { result } = renderHook(() => useChatStore());

      act(() => {
        useChatStore.setState({ activeAgentId, topicDataMap: {} });
      });

      act(() => {
        result.current.internal_dispatchTopic(
          {
            type: 'addTopic',
            value: { id: 'topic-1', messages: [], sessionId: activeAgentId, title: 'Topic 1' },
          },
          'test/addTopic',
        );
      });

      const topicData =
        useChatStore.getState().topicDataMap[topicMapKey({ agentId: activeAgentId })];

      expect(topicData.items).toHaveLength(1);
      expect(topicData.total).toBe(1);
      expect(topicData.hasMore).toBe(false);
    });
  });
  describe('loadMoreAgentTopicsView', () => {
    it('records a pagination error without clearing existing topics or hasMore', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'agent-1';
      const key = topicMapKey({ agentId });
      const topics = [
        { id: 'topic-1', title: 'Topic 1' },
        { id: 'topic-2', title: 'Topic 2' },
      ] as ChatTopic[];
      const error = new Error('load more failed');

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          agentTopicsViewMap: {
            [key]: {
              currentPage: 0,
              hasMore: true,
              isLoadingMore: false,
              items: topics,
              pageSize: 2,
              total: 4,
              withDetails: true,
            },
          },
        });
      });

      (topicService.getTopics as Mock).mockRejectedValueOnce(error);

      await act(async () => {
        await result.current.loadMoreAgentTopicsView();
      });

      const topicData = useChatStore.getState().agentTopicsViewMap[key];
      expect(topicService.getTopics).toHaveBeenCalledWith({
        agentId,
        current: 1,
        pageSize: 2,
        withDetails: true,
      });
      expect(topicData.items).toEqual(topics);
      expect(topicData.hasMore).toBe(true);
      expect(topicData.isLoadingMore).toBe(false);
      expect(topicData.loadMoreError).toBe(error);
    });

    it('clears a stale pagination error after retry succeeds', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'agent-1';
      const key = topicMapKey({ agentId });

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          agentTopicsViewMap: {
            [key]: {
              currentPage: 0,
              hasMore: true,
              isLoadingMore: false,
              items: [{ id: 'topic-1', title: 'Topic 1' } as ChatTopic],
              loadMoreError: new Error('previous failure'),
              pageSize: 1,
              total: 2,
            },
          },
        });
      });

      (topicService.getTopics as Mock).mockResolvedValueOnce({
        items: [{ id: 'topic-2', title: 'Topic 2' }],
        total: 2,
      });

      await act(async () => {
        await result.current.loadMoreAgentTopicsView();
      });

      const topicData = useChatStore.getState().agentTopicsViewMap[key];
      expect(topicData.items.map((item) => item.id)).toEqual(['topic-1', 'topic-2']);
      expect(topicData.currentPage).toBe(1);
      expect(topicData.hasMore).toBe(false);
      expect(topicData.isLoadingMore).toBe(false);
      expect(topicData.loadMoreError).toBeUndefined();
    });
  });

  describe('removeUnstarredTopic', () => {
    it('should remove unstarred topics and refresh the topic list', async () => {
      const { result } = renderHook(() => useChatStore());
      const topics = [
        { id: 'topic-1', favorite: false },
        { id: 'topic-2', favorite: true },
        { id: 'topic-3', favorite: false },
      ] as ChatTopic[];
      // Set up mock state with unstarred topics
      await act(async () => {
        useChatStore.setState({
          activeAgentId: 'abc',
          topicDataMap: {
            [topicMapKey({ agentId: 'abc' })]: {
              items: topics,
              total: topics.length,
              currentPage: 0,
              hasMore: false,
              pageSize: 20,
            },
          },
        });
      });
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        await result.current.removeUnstarredTopic();
      });

      expect(topicService.batchRemoveTopics).toHaveBeenCalledWith(['topic-1', 'topic-3']);
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
    });

    it('removes only the signed-in user’s unstarred topics when onlyOwn is enabled', async () => {
      const { result } = renderHook(() => useChatStore());
      const topics = [
        { id: 'own-unstarred', favorite: false, userId: 'user-1' },
        { id: 'other-unstarred', favorite: false, userId: 'user-2' },
        { id: 'own-starred', favorite: true, userId: 'user-1' },
      ] as ChatTopic[];
      await act(async () => {
        useChatStore.setState({
          activeAgentId: 'abc',
          topicDataMap: {
            [topicMapKey({ agentId: 'abc' })]: {
              currentPage: 0,
              hasMore: false,
              items: topics,
              pageSize: 20,
              total: topics.length,
            },
          },
        });
      });

      await act(async () => {
        await result.current.removeUnstarredTopic({ onlyOwn: true });
      });

      expect(topicService.batchRemoveTopics).toHaveBeenCalledWith(['own-unstarred']);
    });
  });
  describe('internal_updateTopic', () => {
    it('should propagate the error when updating a topic fails', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'agent-1';
      const topicId = 'topic-1';
      const key = topicMapKey({ agentId });
      const topic: ChatTopic = {
        createdAt: Date.now(),
        favorite: false,
        id: topicId,
        sessionId: agentId,
        title: 'Topic',
        updatedAt: Date.now(),
      };

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          topicDataMap: {
            [key]: {
              currentPage: 0,
              hasMore: false,
              isExpandingPageSize: false,
              isLoadingMore: false,
              items: [topic],
              pageSize: 20,
              total: 1,
            },
          },
        });
      });

      vi.spyOn(topicService, 'updateTopic').mockRejectedValue(new Error('rename failed'));

      await act(async () => {
        await expect(
          result.current.internal_updateTopic(topicId, { title: 'New' }),
        ).rejects.toThrow('rename failed');
      });
    });
  });
  describe('cleanupStaleRunningTopics', () => {
    it('should mark stale running topics active when no alive operation exists', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'agent-1';
      const topicId = 'topic-1';
      const key = topicMapKey({ agentId });
      const topic = {
        agentId,
        createdAt: Date.now() - 3 * 60 * 60 * 1000,
        id: topicId,
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-1',
            operationId: 'server-op-1',
          },
        },
        sessionId: agentId,
        status: 'running',
        title: 'Stale running topic',
        updatedAt: Date.now() - 3 * 60 * 60 * 1000,
      } as ChatTopic & { agentId: string };

      vi.spyOn(topicService, 'queryTopics').mockResolvedValue([topic]);
      const updateTopicMock = vi.spyOn(topicService, 'updateTopic').mockResolvedValue([]);
      const updateTopicMetadataMock = vi
        .spyOn(topicService, 'updateTopicMetadata')
        .mockResolvedValue([]);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          messageOperationMap: {},
          operations: {},
          operationsByContext: {},
          operationsByMessage: {},
          topicDataMap: {
            [key]: {
              currentPage: 0,
              hasMore: false,
              items: [topic],
              pageSize: 20,
              total: 1,
            },
          },
        });
      });

      let cleaned = 0;
      await act(async () => {
        cleaned = await result.current.cleanupStaleRunningTopics();
      });

      expect(cleaned).toBe(1);
      expect(topicService.queryTopics).toHaveBeenCalledWith({
        pageSize: 500,
        statuses: ['running'],
      });
      expect(updateTopicMock).toHaveBeenCalledWith(topicId, { status: 'active' });
      expect(updateTopicMetadataMock).toHaveBeenCalledWith(topicId, {
        runningOperation: null,
      });
      expect(updateTopicMetadataMock.mock.invocationCallOrder[0]).toBeLessThan(
        updateTopicMock.mock.invocationCallOrder[0],
      );
      expect(useChatStore.getState().topicDataMap[key].items[0]).toMatchObject({
        metadata: { runningOperation: null },
        status: 'active',
      });
    });

    it('should patch group main topic scope when stale group rows include supervisor agent id', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'supervisor-agent';
      const groupId = 'group-1';
      const topicId = 'topic-1';
      const groupKey = topicMapKey({ groupId });
      const groupAgentKey = topicMapKey({ agentId, groupId });
      const topic = {
        agentId,
        createdAt: Date.now() - 3 * 60 * 60 * 1000,
        groupId,
        id: topicId,
        metadata: {
          runningOperation: {
            assistantMessageId: 'assistant-1',
            operationId: 'server-op-1',
          },
        },
        sessionId: agentId,
        status: 'running',
        title: 'Stale group topic',
        updatedAt: Date.now() - 3 * 60 * 60 * 1000,
      } as ChatTopic & { agentId: string; groupId: string };

      vi.spyOn(topicService, 'queryTopics').mockResolvedValue([topic]);
      vi.spyOn(topicService, 'updateTopic').mockResolvedValue([]);
      vi.spyOn(topicService, 'updateTopicMetadata').mockResolvedValue([]);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          activeGroupId: groupId,
          messageOperationMap: {},
          operations: {},
          operationsByContext: {},
          operationsByMessage: {},
          topicDataMap: {
            [groupKey]: {
              currentPage: 0,
              hasMore: false,
              items: [topic],
              pageSize: 20,
              total: 1,
            },
          },
        });
      });

      let cleaned = 0;
      await act(async () => {
        cleaned = await result.current.cleanupStaleRunningTopics();
      });

      expect(cleaned).toBe(1);
      expect(useChatStore.getState().topicDataMap[groupKey].items[0]).toMatchObject({
        metadata: { runningOperation: null },
        status: 'active',
      });
      expect(useChatStore.getState().topicDataMap[groupAgentKey]).toBeUndefined();
    });

    it('should not mark stale topics active when runningOperation metadata cleanup fails', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'agent-1';
      const topicId = 'topic-1';
      const key = topicMapKey({ agentId });
      const runningOperation = {
        assistantMessageId: 'assistant-1',
        operationId: 'server-op-1',
      };
      const topic = {
        agentId,
        createdAt: Date.now() - 3 * 60 * 60 * 1000,
        id: topicId,
        metadata: { runningOperation },
        sessionId: agentId,
        status: 'running',
        title: 'Stale running topic',
        updatedAt: Date.now() - 3 * 60 * 60 * 1000,
      } as ChatTopic & { agentId: string };

      vi.spyOn(topicService, 'queryTopics').mockResolvedValue([topic]);
      const updateTopicMock = vi.spyOn(topicService, 'updateTopic').mockResolvedValue([]);
      const updateTopicMetadataMock = vi
        .spyOn(topicService, 'updateTopicMetadata')
        .mockRejectedValue(new Error('metadata persist failed'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          messageOperationMap: {},
          operations: {},
          operationsByContext: {},
          operationsByMessage: {},
          topicDataMap: {
            [key]: {
              currentPage: 0,
              hasMore: false,
              items: [topic],
              pageSize: 20,
              total: 1,
            },
          },
        });
      });

      let cleaned = 0;
      await act(async () => {
        cleaned = await result.current.cleanupStaleRunningTopics();
      });

      expect(cleaned).toBe(0);
      expect(updateTopicMetadataMock).toHaveBeenCalledWith(topicId, { runningOperation: null });
      expect(updateTopicMock).not.toHaveBeenCalled();
      expect(useChatStore.getState().topicDataMap[key].items[0]).toMatchObject({
        metadata: { runningOperation },
        status: 'running',
      });
    });

    it('should keep stale running topics when an alive operation exists', async () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'agent-1';
      const topicId = 'topic-1';
      const topic = {
        agentId,
        createdAt: Date.now() - 3 * 60 * 60 * 1000,
        id: topicId,
        sessionId: agentId,
        status: 'running',
        title: 'Still running topic',
        updatedAt: Date.now() - 3 * 60 * 60 * 1000,
      } as ChatTopic & { agentId: string };

      vi.spyOn(topicService, 'queryTopics').mockResolvedValue([topic]);
      vi.spyOn(topicService, 'updateTopic').mockResolvedValue([]);

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          messageOperationMap: {},
          operations: {},
          operationsByContext: {},
          operationsByMessage: {},
        });

        result.current.startOperation({
          context: { agentId, topicId },
          type: 'execHeterogeneousAgent',
        });
      });

      let cleaned = 0;
      await act(async () => {
        cleaned = await result.current.cleanupStaleRunningTopics();
      });

      expect(cleaned).toBe(0);
      expect(topicService.updateTopic).not.toHaveBeenCalledWith(topicId, { status: 'active' });
    });
  });

  describe('syncScheduledTopicRun', () => {
    const agentId = 'sync-scheduled-agent';
    const topicId = 'sync-scheduled-topic';
    const key = topicMapKey({ agentId });

    const scheduledRun = {
      createdAt: '2026-07-22T00:00:00.000Z',
      failedAssistantMessageId: 'assistant-failed',
      kind: 'resume_after_rate_limit',
      runAt: '2026-07-22T05:00:00.000Z',
      source: 'heterogeneous_agent',
      updatedAt: '2026-07-22T00:00:00.000Z',
      userMessageId: 'user-1',
    };

    const seedScheduledTopic = (refreshMessages = vi.fn()) => {
      const topic = {
        id: topicId,
        metadata: { scheduledRun },
        status: 'scheduled',
        title: 'Parked topic',
      } as unknown as ChatTopic;

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          refreshMessages,
          topicDataMap: {
            [key]: { currentPage: 0, hasMore: false, items: [topic], pageSize: 20, total: 1 },
          },
        });
      });

      return refreshMessages;
    };

    it('folds a cron dispatch into the topic map and refetches messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const refreshMessages = seedScheduledTopic();

      // The dispatcher has fired: status moved off `scheduled`, the schedule is
      // cleared and the live operation marker is seeded.
      const runningOperation = { assistantMessageId: 'assistant-new', operationId: 'op-1' };
      vi.spyOn(topicService, 'getTopicDetail').mockResolvedValue({
        id: topicId,
        metadata: { runningOperation },
        status: 'running',
      } as any);

      let synced = false;
      await act(async () => {
        synced = await result.current.syncScheduledTopicRun(topicId);
      });

      expect(synced).toBe(true);
      // The patched map is what `useGatewayReconnect` reads — without this the
      // sitting client never attaches to the resumed stream (the original bug).
      expect(useChatStore.getState().topicDataMap[key].items[0]).toMatchObject({
        metadata: { runningOperation },
        status: 'running',
      });
      expect(refreshMessages).toHaveBeenCalled();
    });

    it('is a no-op while the server still parks the topic', async () => {
      const { result } = renderHook(() => useChatStore());
      const refreshMessages = seedScheduledTopic();

      vi.spyOn(topicService, 'getTopicDetail').mockResolvedValue({
        id: topicId,
        metadata: { scheduledRun },
        status: 'scheduled',
      } as any);

      let synced = true;
      await act(async () => {
        synced = await result.current.syncScheduledTopicRun(topicId);
      });

      expect(synced).toBe(false);
      expect(useChatStore.getState().topicDataMap[key].items[0].status).toBe('scheduled');
      expect(refreshMessages).not.toHaveBeenCalled();
    });

    it('keeps the topic parked while our own scheduled write is still in flight', async () => {
      const { result } = renderHook(() => useChatStore());
      const refreshMessages = vi.fn();
      // The pre-schedule row: the rate-limited turn parked the topic as 'failed'.
      const topic = {
        id: topicId,
        metadata: {},
        status: 'failed',
        title: 'Rate limited topic',
      } as unknown as ChatTopic;

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          refreshMessages,
          topicDataMap: {
            [key]: { currentPage: 0, hasMore: false, items: [topic], pageSize: 20, total: 1 },
          },
        });
      });

      // "Continue in ~1d 8h": the status is dispatched optimistically, the DB
      // write is still on the wire.
      let persistScheduled: () => void = () => {};
      vi.spyOn(topicService, 'updateTopic').mockReturnValueOnce(
        new Promise<void>((resolve) => {
          persistScheduled = () => resolve();
        }) as any,
      );
      act(() => {
        void result.current.updateTopicStatus({ status: 'scheduled', topicId });
      });
      expect(useChatStore.getState().topicDataMap[key].items[0].status).toBe('scheduled');

      // The watch this dispatch just armed fetches before the write lands, so
      // the server still reports the pre-schedule row.
      vi.spyOn(topicService, 'getTopicDetail').mockResolvedValue({
        id: topicId,
        metadata: {},
        status: 'failed',
      } as any);

      let synced = true;
      await act(async () => {
        synced = await result.current.syncScheduledTopicRun(topicId);
      });

      expect(synced).toBe(false);
      // Reverting here is what made the button read as a no-op until clicked twice.
      expect(useChatStore.getState().topicDataMap[key].items[0].status).toBe('scheduled');
      expect(refreshMessages).not.toHaveBeenCalled();

      persistScheduled();
    });

    it('folds in a stale row once the scheduled write failed to persist', async () => {
      const { result } = renderHook(() => useChatStore());
      const refreshMessages = vi.fn();
      const topic = {
        id: topicId,
        metadata: {},
        status: 'failed',
        title: 'Rate limited topic',
      } as unknown as ChatTopic;

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          refreshMessages,
          topicDataMap: {
            [key]: { currentPage: 0, hasMore: false, items: [topic], pageSize: 20, total: 1 },
          },
        });
      });

      // The persist rejects — the pin is dropped, so nothing should suppress the
      // server's view of the topic any more.
      vi.spyOn(topicService, 'updateTopic').mockRejectedValueOnce(new Error('offline'));
      await act(async () => {
        await result.current.updateTopicStatus({ status: 'scheduled', topicId });
      });

      vi.spyOn(topicService, 'getTopicDetail').mockResolvedValue({
        id: topicId,
        metadata: {},
        status: 'failed',
      } as any);

      let synced = false;
      await act(async () => {
        synced = await result.current.syncScheduledTopicRun(topicId);
      });

      expect(synced).toBe(true);
      expect(useChatStore.getState().topicDataMap[key].items[0].status).toBe('failed');
    });

    it('does not fetch at all when the store topic is not scheduled', async () => {
      const { result } = renderHook(() => useChatStore());
      const refreshMessages = vi.fn();
      const topic = { id: topicId, status: 'active', title: 'Live topic' } as unknown as ChatTopic;

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          refreshMessages,
          topicDataMap: {
            [key]: { currentPage: 0, hasMore: false, items: [topic], pageSize: 20, total: 1 },
          },
        });
      });

      const detailSpy = vi.spyOn(topicService, 'getTopicDetail');

      let synced = true;
      await act(async () => {
        synced = await result.current.syncScheduledTopicRun(topicId);
      });

      expect(synced).toBe(false);
      expect(detailSpy).not.toHaveBeenCalled();
      expect(refreshMessages).not.toHaveBeenCalled();
    });
  });

  describe('internal_updateTopicLinkedPullRequest', () => {
    const agentId = 'agent-1';
    const topicId = 'topic-1';
    const branch = 'fix/topic-running';
    const path = '/repo';
    const key = topicMapKey({ agentId });
    const stalePR = {
      number: 123,
      state: 'OPEN',
      title: 'fix: stop stale running topics',
      url: 'https://github.com/lobehub/lobehub/pull/123',
    };
    const mergedPR = {
      ...stalePR,
      mergedAt: '2026-07-07T09:00:00Z',
      state: 'MERGED',
    };

    const setupTopic = (
      pullRequest: typeof stalePR | null = stalePR,
      pullRequestStatus: 'error' | 'gh-missing' | 'ok' = 'ok',
    ) => {
      const topic: ChatTopic = {
        createdAt: Date.now(),
        favorite: false,
        id: topicId,
        metadata: {
          workingDirectory: path,
          workingDirectoryConfig: {
            git: {
              branch,
              github: { pullRequest, pullRequestStatus },
              isWorktree: false,
            },
            path,
            repoType: 'github',
          },
        },
        sessionId: agentId,
        title: 'Topic',
        updatedAt: Date.now(),
      };

      useChatStore.setState({
        activeAgentId: agentId,
        topicDataMap: {
          [key]: {
            currentPage: 0,
            hasMore: false,
            items: [topic],
            pageSize: 20,
            total: 1,
          },
        },
      });
    };

    it('silently patches the topic with the latest merged PR state', async () => {
      const { result } = renderHook(() => useChatStore());
      setupTopic();
      const updateTopicMetadataMock = vi
        .spyOn(topicService, 'updateTopicMetadata')
        .mockResolvedValue(undefined as never);

      await act(async () => {
        await result.current.internal_updateTopicLinkedPullRequest(
          { branch, path, pullRequestNumber: 123, topicId },
          { pullRequest: mergedPR, pullRequestStatus: 'ok' },
        );
      });

      const updatedTopic = useChatStore.getState().topicDataMap[key]!.items[0]!;
      expect(updatedTopic.metadata?.workingDirectoryConfig?.git?.github).toEqual({
        pullRequest: mergedPR,
        pullRequestStatus: 'ok',
      });
      expect(updateTopicMetadataMock).toHaveBeenCalledWith(topicId, {
        workingDirectoryConfig: {
          git: {
            branch,
            github: { pullRequest: mergedPR, pullRequestStatus: 'ok' },
            isWorktree: false,
          },
          path,
          repoType: 'github',
        },
      });
    });

    it('updates empty PR metadata when no existing PR number is anchored', async () => {
      const { result } = renderHook(() => useChatStore());
      setupTopic(null, 'error');
      const updateTopicMetadataMock = vi
        .spyOn(topicService, 'updateTopicMetadata')
        .mockResolvedValue(undefined as never);

      await act(async () => {
        await result.current.internal_updateTopicLinkedPullRequest(
          { branch, path, topicId },
          { pullRequest: null, pullRequestStatus: 'ok' },
        );
      });

      expect(
        useChatStore.getState().topicDataMap[key]!.items[0]!.metadata?.workingDirectoryConfig?.git
          ?.github,
      ).toEqual({ pullRequest: null, pullRequestStatus: 'ok' });
      expect(updateTopicMetadataMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the existing PR snapshot when lookup returns a different PR number', async () => {
      const { result } = renderHook(() => useChatStore());
      setupTopic();
      const updateTopicMetadataMock = vi
        .spyOn(topicService, 'updateTopicMetadata')
        .mockResolvedValue(undefined as never);

      await act(async () => {
        await result.current.internal_updateTopicLinkedPullRequest(
          { branch, path, pullRequestNumber: 123, topicId },
          {
            pullRequest: {
              ...mergedPR,
              number: 456,
              url: 'https://github.com/lobehub/lobehub/pull/456',
            },
            pullRequestStatus: 'ok',
          },
        );
      });

      expect(updateTopicMetadataMock).not.toHaveBeenCalled();
      expect(
        useChatStore.getState().topicDataMap[key]!.items[0]!.metadata?.workingDirectoryConfig?.git
          ?.github,
      ).toEqual({ pullRequest: stalePR, pullRequestStatus: 'ok' });
    });

    it('keeps the existing PR snapshot when gh is unavailable', async () => {
      const { result } = renderHook(() => useChatStore());
      setupTopic();
      const updateTopicMetadataMock = vi
        .spyOn(topicService, 'updateTopicMetadata')
        .mockResolvedValue(undefined as never);

      await act(async () => {
        await result.current.internal_updateTopicLinkedPullRequest(
          { branch, path, topicId },
          { ghMissing: true, pullRequest: null, pullRequestStatus: 'gh-missing' },
        );
      });

      expect(updateTopicMetadataMock).not.toHaveBeenCalled();
      expect(
        useChatStore.getState().topicDataMap[key]!.items[0]!.metadata?.workingDirectoryConfig?.git
          ?.github,
      ).toEqual({ pullRequest: stalePR, pullRequestStatus: 'ok' });
    });
  });
  describe('optimistic topic preservation across refetches', () => {
    const agentId = 'agent-1';
    const key = topicMapKey({ agentId });
    // The placeholder carries a real `tpc_…` id (the server is asked to honour
    // it), so nothing about the string marks it as client-only.
    const optimisticId = 'tpc_clientMinted1';

    const seedOptimisticRow = (result: { current: ReturnType<typeof useChatStore.getState> }) => {
      act(() => {
        useChatStore.setState({ activeAgentId: agentId, topicDataMap: {} });
      });
      act(() => {
        result.current.internal_dispatchTopic({
          agentId,
          optimistic: true,
          type: 'addTopic',
          value: { id: optimisticId, sessionId: agentId, title: '第一条消息' },
        });
      });
    };

    // A refetch triggered mid-send (fire-and-forget refreshTopic, SWR focus
    // revalidate) returns a list that cannot contain the placeholder yet. In
    // gateway mode it never will: the server mints its own id there.
    const serverList = [
      { createdAt: Date.now(), favorite: false, id: 'tpc_serverOther1', title: '别的话题' },
    ] as ChatTopic[];

    it('should keep a client-minted optimistic row when a refetch lands mid-send', () => {
      const { result } = renderHook(() => useChatStore());
      seedOptimisticRow(result);

      act(() => {
        result.current.internal_updateTopics(agentId, {
          items: serverList,
          pageSize: 20,
          total: 1,
        });
      });

      const ids = result.current.topicDataMap[key].items.map((item) => item.id);
      // Dropping it here makes the sidebar row and its loading spinner vanish,
      // and leaves replaceTopicId with nothing to reconcile the row's data onto.
      expect(ids).toContain(optimisticId);
      expect(ids).toEqual([optimisticId, 'tpc_serverOther1']);
    });

    it('should stop preserving the row once the server id is known', () => {
      const { result } = renderHook(() => useChatStore());
      seedOptimisticRow(result);

      act(() => {
        result.current.internal_replaceTopicId({
          agentId,
          nextId: 'tpc_serverReal01',
          previousId: optimisticId,
        });
      });

      act(() => {
        result.current.internal_updateTopics(agentId, {
          items: serverList,
          pageSize: 20,
          total: 1,
        });
      });

      // No longer client-only, so a later refetch is authoritative — otherwise a
      // resolved row would be pinned to the sidebar forever.
      const ids = result.current.topicDataMap[key].items.map((item) => item.id);
      expect(ids).not.toContain(optimisticId);
      expect(ids).toEqual(['tpc_serverOther1']);
    });

    it('should stop preserving the row after a rollback', () => {
      const { result } = renderHook(() => useChatStore());
      seedOptimisticRow(result);

      act(() => {
        result.current.internal_dispatchTopic({ agentId, id: optimisticId, type: 'deleteTopic' });
      });

      act(() => {
        result.current.internal_updateTopics(agentId, {
          items: serverList,
          pageSize: 20,
          total: 1,
        });
      });

      const ids = result.current.topicDataMap[key].items.map((item) => item.id);
      expect(ids).not.toContain(optimisticId);
    });
  });

  describe('replaceTopicId', () => {
    it('should swap the optimistic topic row to the server topic id', () => {
      const { result } = renderHook(() => useChatStore());
      const agentId = 'agent-1';
      const key = topicMapKey({ agentId });
      const optimisticTopic: ChatTopic = {
        createdAt: Date.now(),
        favorite: false,
        id: 'tmp_topic_1',
        sessionId: agentId,
        title: '666',
        updatedAt: Date.now(),
      };

      act(() => {
        useChatStore.setState({
          activeAgentId: agentId,
          topicDataMap: {
            [key]: {
              currentPage: 0,
              hasMore: false,
              isExpandingPageSize: false,
              isLoadingMore: false,
              items: [optimisticTopic],
              pageSize: 20,
              total: 1,
            },
          },
        });
      });

      act(() => {
        result.current.internal_replaceTopicId({
          agentId,
          nextId: 'topic-1',
          previousId: 'tmp_topic_1',
          value: { sessionId: agentId },
        });
      });

      expect(result.current.topicDataMap[key].items).toEqual([
        expect.objectContaining({
          id: 'topic-1',
          sessionId: agentId,
          title: '666',
        }),
      ]);
    });
  });
  describe('summaryTopicTitle', () => {
    it('should show a loading placeholder when auto-summarizing a topic without a title', async () => {
      const topicId = 'topic-1';
      const messages = [{ id: 'message-1', content: 'Hello' }] as UIChatMessage[];
      const topics = [{ id: 'topic-1', title: '' }] as ChatTopic[];
      const { result } = renderHook(() => useChatStore());
      await act(async () => {
        useChatStore.setState({
          topicDataMap: {
            [topicMapKey({ agentId: 'test' })]: {
              items: topics,
              total: topics.length,
              currentPage: 0,
              hasMore: false,
              pageSize: 20,
            },
          },
          activeAgentId: 'test',
        });
      });

      // Mock the `updateTopicTitleInSummary` and `refreshTopic` for spying
      const updateTopicTitleInSummarySpy = vi.spyOn(
        result.current,
        'internal_updateTopicTitleInSummary',
      );
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      vi.spyOn(aiChatService, 'generateJSON').mockResolvedValue({
        data: { title: 'Summarized Title' },
        tracingId: 'tracing-1',
      } as any);

      await act(async () => {
        await result.current.summaryTopicTitle(topicId, messages);
      });

      // Verify that the title was updated and the topic was refreshed
      expect(updateTopicTitleInSummarySpy).toHaveBeenCalledWith(topicId, LOADING_FLAT);
      expect(refreshTopicSpy).toHaveBeenCalled();
    });

    it('should keep an optimistic title visible until the summarized title is ready', async () => {
      const topicId = 'topic-1';
      const messages = [{ id: 'message-1', content: 'Hello' }] as UIChatMessage[];
      const optimisticTitle = '阅读下面的材料，根据要求写作。';
      const topics = [{ id: topicId, title: optimisticTitle }] as ChatTopic[];
      const { result } = renderHook(() => useChatStore());
      await act(async () => {
        useChatStore.setState({
          topicDataMap: {
            [topicMapKey({ agentId: 'test' })]: {
              items: topics,
              total: topics.length,
              currentPage: 0,
              hasMore: false,
              pageSize: 20,
            },
          },
          activeAgentId: 'test',
        });
      });

      const updateTopicTitleInSummarySpy = vi.spyOn(
        result.current,
        'internal_updateTopicTitleInSummary',
      );
      const updateTopicSpy = vi.spyOn(result.current, 'internal_updateTopic');

      vi.spyOn(aiChatService, 'generateJSON').mockResolvedValue({
        data: { title: 'Summarized Title' },
        tracingId: 'tracing-1',
      } as any);

      await act(async () => {
        await result.current.summaryTopicTitle(topicId, messages);
      });

      expect(updateTopicTitleInSummarySpy).not.toHaveBeenCalledWith(topicId, LOADING_FLAT);
      expect(updateTopicSpy).toHaveBeenCalledWith(topicId, { title: 'Summarized Title' });
    });

    describe('structured generation', () => {
      const topicId = 'topic-1';
      const messages = [{ id: 'message-1', content: 'Hello' }] as UIChatMessage[];

      const seedTopic = async (title: string) => {
        const topics = [{ id: topicId, title }] as ChatTopic[];
        const { result } = renderHook(() => useChatStore());

        await act(async () => {
          useChatStore.setState({
            topicDataMap: {
              [topicMapKey({ agentId: 'test' })]: {
                items: topics,
                total: topics.length,
                currentPage: 0,
                hasMore: false,
                pageSize: 20,
              },
            },
            activeAgentId: 'test',
          });
        });

        return result;
      };

      it('generates against the topic-title schema instead of a chat completion', async () => {
        const result = await seedTopic('');
        const generateSpy = vi.spyOn(aiChatService, 'generateJSON').mockResolvedValue({
          data: { title: '简单问候' },
          tracingId: 'tracing-1',
        } as any);
        const completionSpy = vi.spyOn(chatService, 'fetchPresetTaskResult');

        await act(async () => {
          await result.current.summaryTopicTitle(topicId, messages);
        });

        expect(completionSpy).not.toHaveBeenCalled();
        expect(generateSpy.mock.calls[0][0]).toMatchObject({
          schema: TOPIC_TITLE_JSON_SCHEMA,
          tracing: { scenario: 'topic_title', topicId },
        });
      });

      it('reads the title off the parsed object', async () => {
        const result = await seedTopic('');
        const updateTopicSpy = vi.spyOn(result.current, 'internal_updateTopic');

        vi.spyOn(aiChatService, 'generateJSON').mockResolvedValue({
          data: { title: '简单问候' },
          tracingId: 'tracing-1',
        } as any);

        await act(async () => {
          await result.current.summaryTopicTitle(topicId, messages);
        });

        expect(updateTopicSpy).toHaveBeenCalledWith(topicId, { title: '简单问候' });
      });

      it('restores the previous title when generation returns nothing', async () => {
        const result = await seedTopic('');
        const updateTopicSpy = vi.spyOn(result.current, 'internal_updateTopic');
        const updateTitleSpy = vi.spyOn(result.current, 'internal_updateTopicTitleInSummary');

        vi.spyOn(aiChatService, 'generateJSON').mockResolvedValue({
          data: { title: '  ' },
          tracingId: 'tracing-1',
        } as any);

        await act(async () => {
          await result.current.summaryTopicTitle(topicId, messages);
        });

        expect(updateTopicSpy).not.toHaveBeenCalled();
        expect(updateTitleSpy).toHaveBeenLastCalledWith(topicId, '');
      });

      it('restores the previous title when generation throws', async () => {
        const result = await seedTopic('');
        const updateTopicSpy = vi.spyOn(result.current, 'internal_updateTopic');
        const updateTitleSpy = vi.spyOn(result.current, 'internal_updateTopicTitleInSummary');

        vi.spyOn(aiChatService, 'generateJSON').mockRejectedValue(new Error('provider down'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await act(async () => {
          await result.current.summaryTopicTitle(topicId, messages);
        });

        expect(updateTopicSpy).not.toHaveBeenCalled();
        expect(updateTitleSpy).toHaveBeenLastCalledWith(topicId, '');
      });
    });
  });
  describe('createTopic', () => {
    it('should create a new topic and update the store', async () => {
      const { result } = renderHook(() => useChatStore());
      const activeAgentId = 'test-session-id';
      const newTopicId = 'new-topic-id';
      const messages = [{ id: 'message-1' }, { id: 'message-2' }] as UIChatMessage[];

      await act(async () => {
        useChatStore.setState({
          activeAgentId,
          messagesMap: {
            [messageMapKey({ agentId: activeAgentId })]: messages,
          },
        });
      });

      const createTopicSpy = vi.spyOn(topicService, 'createTopic').mockResolvedValue(newTopicId);
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');

      await act(async () => {
        const topicId = await result.current.createTopic();
        expect(topicId).toBe(newTopicId);
      });

      expect(createTopicSpy).toHaveBeenCalledWith({
        // The test never seeds agentMap, so snapshotAgentModel falls back to the
        // defaults — assert the constants so default-model bumps can't break this.
        model: DEFAULT_MODEL,
        provider: DEFAULT_PROVIDER,
        sessionId: activeAgentId,
        messages: messages.map((m) => m.id),
        title: 'defaultTitle',
      });
      expect(refreshTopicSpy).toHaveBeenCalled();
    });
  });
  describe('duplicateTopic', () => {
    it('should duplicate a topic and switch to the new topic', async () => {
      const { result } = renderHook(() => useChatStore());
      const topicId = 'topic-1';
      const newTopicId = 'new-topic-id';
      const topics = [{ id: topicId, title: 'Original Topic' }] as ChatTopic[];

      await act(async () => {
        useChatStore.setState({
          activeAgentId: 'abc',
          topicDataMap: {
            [topicMapKey({ agentId: 'abc' })]: {
              items: topics,
              total: topics.length,
              currentPage: 0,
              hasMore: false,
              pageSize: 20,
            },
          },
        });
      });

      const cloneTopicSpy = vi.spyOn(topicService, 'cloneTopic').mockResolvedValue(newTopicId);
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic');
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic');

      await act(async () => {
        await result.current.duplicateTopic(topicId);
      });

      expect(cloneTopicSpy).toHaveBeenCalledWith(topicId, 'duplicateTitle_Original Topic');
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalledWith(newTopicId);
    });
  });
  describe('autoRenameTopicTitle', () => {
    it('should auto-rename the topic title based on the messages', async () => {
      const { result } = renderHook(() => useChatStore());
      const topicId = 'topic-1';
      const activeAgentId = 'test-session-id';
      const messages = [{ id: 'message-1', content: 'Hello' }] as UIChatMessage[];

      await act(async () => {
        useChatStore.setState({ activeAgentId });
      });

      const getMessagesSpy = vi.spyOn(messageService, 'getMessages').mockResolvedValue(messages);
      const summaryTopicTitleSpy = vi.spyOn(result.current, 'summaryTopicTitle');

      await act(async () => {
        await result.current.autoRenameTopicTitle(topicId);
      });

      expect(getMessagesSpy).toHaveBeenCalledWith({ agentId: activeAgentId, topicId });
      expect(summaryTopicTitleSpy).toHaveBeenCalledWith(topicId, messages);
    });
  });

  describe('internal_updateTopics', () => {
    it('should preserve excludeStatuses/excludeTriggers from existing topicDataMap entry', () => {
      const agentId = 'agent-1';
      const key = topicMapKey({ agentId });
      const { result } = renderHook(() => useChatStore());

      // Seed the entry as the SWR onData handler would, with filter fields.
      act(() => {
        useChatStore.setState({
          topicDataMap: {
            [key]: {
              currentPage: 0,
              excludeStatuses: ['completed'],
              excludeTriggers: ['cron', 'eval'],
              hasMore: false,
              isExpandingPageSize: false,
              items: [{ id: 'topic-1', title: 'old' } as ChatTopic],
              pageSize: 20,
              total: 1,
            },
          },
        });
      });

      // Simulate the post-sendMessage write-back which previously dropped filters.
      act(() => {
        result.current.internal_updateTopics(agentId, {
          items: [{ id: 'topic-2', title: 'new' } as ChatTopic],
          pageSize: 20,
          total: 2,
        });
      });

      const next = useChatStore.getState().topicDataMap[key];
      expect(next.excludeStatuses).toEqual(['completed']);
      expect(next.excludeTriggers).toEqual(['cron', 'eval']);
      expect(next.items.map((i) => i.id)).toEqual(['topic-2']);
    });
  });
});
