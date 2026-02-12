import { describe, expect, it } from 'vitest';

import { type ChatStore } from '@/store/chat';
import { initialState } from '@/store/chat/initialState';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import { merge } from '@/utils/merge';

import { topicSelectors } from './selectors';

// Mock i18next
vi.mock('i18next', () => ({
  t: vi.fn().mockImplementation((key) => key),
}));

const initialStore = initialState as ChatStore;

const topicItems = [
  { id: 'topic1', name: 'Topic 1', favorite: true },
  { id: 'topic2', name: 'Topic 2' },
];

// Helper to create topicDataMap with correct key format
const createTopicDataMap = (agentId: string, groupId?: string) => ({
  [topicMapKey({ agentId, groupId })]: {
    items: topicItems,
    total: topicItems.length,
    currentPage: 0,
    hasMore: false,
    pageSize: 20,
  },
});

const topicDataMap = createTopicDataMap('test');

describe('topicSelectors', () => {
  describe('currentTopics', () => {
    it('should return undefined if there are no topics with activeAgentId', () => {
      const topics = topicSelectors.currentTopics(initialStore);
      expect(topics).toBeUndefined();
    });

    it('should return all current topics from the store', () => {
      const state = merge(initialStore, { topicDataMap, activeAgentId: 'test' });

      const topics = topicSelectors.currentTopics(state);
      expect(topics).toEqual(topicItems);
    });
  });

  describe('currentTopicLength', () => {
    it('should return 0 if there are no topics', () => {
      const length = topicSelectors.currentTopicLength(initialStore);
      expect(length).toBe(0);
    });

    it('should return the number of current topics', () => {
      const state = merge(initialStore, { topicDataMap, activeAgentId: 'test' });
      const length = topicSelectors.currentTopicLength(state);
      expect(length).toBe(topicItems.length);
    });
  });

  describe('currentActiveTopic', () => {
    it('should return undefined if there is no active topic', () => {
      const topic = topicSelectors.currentActiveTopic(initialStore);
      expect(topic).toBeUndefined();
    });

    it('should return the current active topic', () => {
      const state = merge(initialStore, {
        topicDataMap,
        activeAgentId: 'test',
        activeTopicId: 'topic1',
      });
      const topic = topicSelectors.currentActiveTopic(state);
      expect(topic).toEqual(topicItems[0]);
    });
  });

  describe('currentUnFavTopics', () => {
    it('should return all unfavorited topics', () => {
      const state = merge(initialStore, { topicDataMap, activeAgentId: 'test' });
      const topics = topicSelectors.currentUnFavTopics(state);
      expect(topics).toEqual([topicItems[1]]);
    });
  });

  describe('displayTopics', () => {
    it('should return current topics if not searching', () => {
      const state = merge(initialStore, { topicDataMap, activeAgentId: 'test' });
      const topics = topicSelectors.displayTopics(state);
      expect(topics).toEqual(topicItems);
    });
  });

  describe('searchTopics', () => {
    it('should return search topics if searching', () => {
      const searchTopics = [{ id: 'search1', name: 'Search 1' }];
      const state = merge(initialStore, { inSearchingMode: true, searchTopics });
      const topics = topicSelectors.searchTopics(state);
      expect(topics).toEqual(searchTopics);
    });
  });

  describe('getTopicById', () => {
    it('should return undefined if topic is not found', () => {
      const state = merge(initialStore, { topicDataMap, activeAgentId: 'test' });
      const topic = topicSelectors.getTopicById('notfound')(state);
      expect(topic).toBeUndefined();
    });

    it('should return the topic with the given id', () => {
      const state = merge(initialStore, { topicDataMap, activeAgentId: 'test' });
      const topic = topicSelectors.getTopicById('topic1')(state);
      expect(topic).toEqual(topicItems[0]);
    });
  });

  describe('groupedTopicsSelector', () => {
    it('should return empty array if there are no topics', () => {
      const state = merge(initialStore, { activeAgentId: 'test' });
      const grouped = topicSelectors.groupedTopicsSelector(state);
      expect(grouped).toEqual([]);
    });

    it('should return grouped topics by time when no favorites exist', () => {
      const topics = [
        { id: 'topic1', name: 'Topic 1', favorite: false, createAt: '2023-01-01' },
        { id: 'topic2', name: 'Topic 2', favorite: false, createAt: '2023-01-01' },
      ];

      const state = merge(initialStore, {
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

      const grouped = topicSelectors.groupedTopicsSelector(state);
      expect(grouped).toHaveLength(1); // One time-based group
      expect(grouped[0].children).toEqual(topics);
    });

    it('should separate favorite and unfavorite topics into different groups', () => {
      const topics = [
        { id: 'topic1', name: 'Topic 1', favorite: true, createAt: '2023-01-01' },
        { id: 'topic2', name: 'Topic 2', favorite: false, createAt: '2023-01-01' },
        { id: 'topic3', name: 'Topic 3', favorite: true, createAt: '2023-01-01' },
      ];

      const state = merge(initialStore, {
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

      const grouped = topicSelectors.groupedTopicsSelector(state);

      expect(grouped).toHaveLength(2); // Favorite group + one time-based group

      // Check favorite group
      expect(grouped[0]).toEqual({
        id: 'favorite',
        title: 'favorite', // This matches the mocked t function return
        children: topics.filter((t) => t.favorite),
      });

      // Check unfavorite group
      expect(grouped[1].children).toEqual(topics.filter((t) => !t.favorite));
    });

    it('should only create time-based groups when there are no favorites', () => {
      const topics = [
        { id: 'topic1', name: 'Topic 1', favorite: false, createAt: '2023-01-01' },
        { id: 'topic2', name: 'Topic 2', favorite: false, createAt: '2023-02-01' },
      ];

      const state = merge(initialStore, {
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

      const grouped = topicSelectors.groupedTopicsSelector(state);

      // Should not have a favorites group
      expect(grouped.find((g) => g.id === 'favorite')).toBeUndefined();

      // Should have time-based groups
      expect(grouped.every((g) => g.id !== 'favorite')).toBeTruthy();
    });
  });

  describe('group session support', () => {
    const timestamp = Date.now();

    it('should return topics for group session when only groupId is set', () => {
      const groupTopics = [
        {
          id: 'group-topic1',
          title: 'Group Topic 1',
          favorite: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          id: 'group-topic2',
          title: 'Group Topic 2',
          favorite: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ];

      // Note: When in group session, activeAgentId may still have a value (e.g., 'inbox')
      // but we prioritize groupId for topic data lookup
      const state = {
        ...initialStore,
        topicDataMap: {
          [topicMapKey({ groupId: 'group-123' })]: {
            items: groupTopics,
            total: groupTopics.length,
            currentPage: 0,
            hasMore: false,
            pageSize: 20,
          },
        },
        activeAgentId: undefined as any,
        activeGroupId: 'group-123',
      };

      const topics = topicSelectors.currentTopics(state);
      expect(topics).toEqual(groupTopics);
    });

    it('should return topics for group_agent session when both groupId and agentId are set', () => {
      const groupAgentTopics = [
        {
          id: 'ga-topic1',
          title: 'Group Agent Topic 1',
          favorite: false,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ];

      const state = merge(initialStore, {
        topicDataMap: {
          [topicMapKey({ agentId: 'agent-456', groupId: 'group-123' })]: {
            items: groupAgentTopics,
            total: groupAgentTopics.length,
            currentPage: 0,
            hasMore: false,
            pageSize: 20,
          },
        },
        activeAgentId: 'agent-456',
        activeGroupId: 'group-123',
      });

      const topics = topicSelectors.currentTopics(state);
      expect(topics).toEqual(groupAgentTopics);
    });

    it('should return correct topic count for group session', () => {
      const groupTopics = [
        { id: 'group-topic1', title: 'Group Topic 1', createdAt: timestamp, updatedAt: timestamp },
        { id: 'group-topic2', title: 'Group Topic 2', createdAt: timestamp, updatedAt: timestamp },
        { id: 'group-topic3', title: 'Group Topic 3', createdAt: timestamp, updatedAt: timestamp },
      ];

      const state = {
        ...initialStore,
        topicDataMap: {
          [topicMapKey({ groupId: 'group-123' })]: {
            items: groupTopics,
            total: 10, // Total could be more than items (pagination)
            currentPage: 0,
            hasMore: true,
            pageSize: 20,
          },
        },
        activeAgentId: undefined as any,
        activeGroupId: 'group-123',
      };

      expect(topicSelectors.currentTopicLength(state)).toBe(3);
      expect(topicSelectors.currentTopicCount(state)).toBe(10);
      expect(topicSelectors.hasMoreTopics(state)).toBe(true);
    });

    it('should return isUndefinedTopics true when group has no topics data', () => {
      const state = {
        ...initialStore,
        topicDataMap: {},
        activeAgentId: undefined as any,
        activeGroupId: 'group-123',
      };

      expect(topicSelectors.isUndefinedTopics(state)).toBe(true);
    });
  });
});
