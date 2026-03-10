import { type UIChatMessage } from '@lobechat/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { type Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@/const/message';
import { mutate } from '@/libs/swr';
import { chatService } from '@/services/chat';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { useSessionStore } from '@/store/session';
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
    removeAllTopic: vi.fn(),
    removeTopic: vi.fn(),
    cloneTopic: vi.fn(),
    createTopic: vi.fn(),
    updateTopicFavorite: vi.fn(),
    updateTopicTitle: vi.fn(),
    updateTopic: vi.fn(),
    batchRemoveTopics: vi.fn(),
    getTopics: vi.fn(),
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

vi.mock('@/components/AntdStaticMethods', () => ({
  message: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    destroy: vi.fn(),
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
      activeTopicId: undefined,
      // ... initial state
    },
    false,
  );
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
      expect(
        matcherFn(['SWR_USE_FETCH_TOPIC', containerKey, { isInbox: false, pageSize: 20 }]),
      ).toBe(true);
      // Should not match key with different containerKey
      expect(
        matcherFn(['SWR_USE_FETCH_TOPIC', 'agent_other-id', { isInbox: false, pageSize: 20 }]),
      ).toBe(false);
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
  });
  describe('switchTopic', () => {
    it('should update activeTopicId and call refreshMessages', async () => {
      const topicId = 'topic-id';
      const { result } = renderHook(() => useChatStore());

      const refreshMessagesSpy = vi.spyOn(result.current, 'refreshMessages');
      // Call the switchTopic action with the topicId
      await act(async () => {
        await result.current.switchTopic(topicId);
      });

      // Verify that the activeTopicId has been updated
      expect(useChatStore.getState().activeTopicId).toBe(topicId);

      // Verify that the refreshMessages was called to update the messages
      expect(refreshMessagesSpy).toHaveBeenCalled();
    });

    it('should support options object as second parameter', async () => {
      const topicId = 'topic-id';
      const { result } = renderHook(() => useChatStore());

      const refreshMessagesSpy = vi.spyOn(result.current, 'refreshMessages');

      // Call with options object (new API)
      await act(async () => {
        await result.current.switchTopic(topicId, { skipRefreshMessage: true });
      });

      expect(useChatStore.getState().activeTopicId).toBe(topicId);
      expect(refreshMessagesSpy).not.toHaveBeenCalled();
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

      expect(topicService.removeTopicsByAgentId).toHaveBeenCalledWith(activeAgentId);
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
    });
  });
  describe('removeGroupTopics', () => {
    it('should remove all topics for the specified group and refresh state', async () => {
      const { result } = renderHook(() => useChatStore());
      const groupId = 'group-delete';
      const topics = [
        { id: 'topic-1', title: 'Topic 1' } as ChatTopic,
        { id: 'topic-2', title: 'Topic 2' } as ChatTopic,
      ];

      await act(async () => {
        useChatStore.setState({
          topicDataMap: {
            [topicMapKey({ groupId })]: {
              items: topics,
              total: topics.length,
              currentPage: 0,
              hasMore: false,
              pageSize: 20,
            },
          },
        });
      });

      const batchRemoveSpy = topicService.batchRemoveTopics as Mock;
      batchRemoveSpy.mockClear();
      const refreshTopicSpy = vi.spyOn(result.current, 'refreshTopic').mockResolvedValue(undefined);
      const switchTopicSpy = vi.spyOn(result.current, 'switchTopic').mockResolvedValue(undefined);

      await act(async () => {
        await result.current.removeGroupTopics(groupId);
      });

      expect(batchRemoveSpy).toHaveBeenCalledWith(['topic-1', 'topic-2']);
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
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

      expect(topicService.removeTopic).toHaveBeenCalledWith(topicId);
      expect(refreshTopicSpy).toHaveBeenCalled();
      expect(switchTopicSpy).toHaveBeenCalled();
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

      expect(topicService.removeTopic).toHaveBeenCalledWith(topicId);
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

      expect(topicService.removeTopic).toHaveBeenCalledWith(topicId);
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
  });
  describe('updateTopicLoading', () => {
    it('should call update topicLoadingId', async () => {
      const { result } = renderHook(() => useChatStore());
      act(() => {
        useChatStore.setState({ topicLoadingIds: [] });
      });

      expect(result.current.topicLoadingIds).toHaveLength(0);

      // Call the action with the topicId and newTitle
      act(() => {
        result.current.internal_updateTopicLoading('loading-id', true);
      });

      expect(result.current.topicLoadingIds).toEqual(['loading-id']);
    });
  });
  describe('summaryTopicTitle', () => {
    it('should auto-summarize the topic title and update it', async () => {
      const topicId = 'topic-1';
      const messages = [{ id: 'message-1', content: 'Hello' }] as UIChatMessage[];
      const topics = [{ id: 'topic-1', title: 'Test Topic' }] as ChatTopic[];
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

      // Mock the `chatService.fetchPresetTaskResult` to simulate the AI response
      vi.spyOn(chatService, 'fetchPresetTaskResult').mockImplementation((params) => {
        if (params) {
          params.onFinish?.('Summarized Title', { type: 'done' });
        }
        return Promise.resolve(undefined);
      });

      await act(async () => {
        await result.current.summaryTopicTitle(topicId, messages);
      });

      // Verify that the title was updated and the topic was refreshed
      expect(updateTopicTitleInSummarySpy).toHaveBeenCalledWith(topicId, LOADING_FLAT);
      expect(refreshTopicSpy).toHaveBeenCalled();

      // TODO: need to test with fetchPresetTaskResult
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
});
