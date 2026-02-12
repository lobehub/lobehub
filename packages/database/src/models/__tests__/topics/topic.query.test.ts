import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import {
  agents,
  agentsToSessions,
  chatGroups,
  messages,
  sessions,
  topics,
  users,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicModel } from '../../topic';

const userId = 'topic-query-user';
const userId2 = 'topic-query-user-2';
const sessionId = 'topic-query-session';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

describe('TopicModel - Query', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }, { id: userId2 }]);
      await tx.insert(sessions).values({ id: sessionId, userId });
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('query', () => {
    it('should query topics by user ID', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(users).values([{ id: '456' }]);
        await tx.insert(topics).values([
          { id: '1', userId, sessionId, updatedAt: new Date('2023-01-01') },
          { id: '4', userId, sessionId, updatedAt: new Date('2023-03-01') },
          { id: '2', userId, sessionId, updatedAt: new Date('2023-02-01'), favorite: true },
          { id: '5', userId, sessionId, updatedAt: new Date('2023-05-01'), favorite: true },
          { id: '3', userId: '456', sessionId, updatedAt: new Date('2023-03-01') },
        ]);
      });

      const result = await topicModel.query({ containerId: sessionId });

      expect(result.items).toHaveLength(4);
      expect(result.items[0].id).toBe('5');
      expect(result.items[1].id).toBe('2');
      expect(result.items[2].id).toBe('4');
    });

    it('should query topics with pagination', async () => {
      await serverDB.insert(topics).values([
        { id: '1', userId, updatedAt: new Date('2023-01-01') },
        { id: '2', userId, updatedAt: new Date('2023-02-01') },
        { id: '3', userId, updatedAt: new Date('2023-03-01') },
      ]);

      const { items: result1 } = await topicModel.query({ current: 0, pageSize: 2 });
      expect(result1).toHaveLength(2);

      const { items: result2 } = await topicModel.query({ current: 1, pageSize: 1 });
      expect(result2).toHaveLength(1);
      expect(result2[0].id).toBe('2');
    });

    it('should query topics by session ID', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(sessions).values([
          { id: 'session1', userId },
          { id: 'session2', userId },
        ]);
        await tx.insert(topics).values([
          { id: '1', userId, sessionId: 'session1' },
          { id: '2', userId, sessionId: 'session2' },
          { id: '3', userId },
        ]);
      });

      const result = await topicModel.query({ containerId: 'session1' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('1');
    });

    it('should query topics by group ID using containerId (backward compatible)', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(chatGroups).values([
          { id: 'chat-group-1', title: 'Chat Group 1', userId },
          { id: 'chat-group-2', title: 'Chat Group 2', userId },
        ]);
        await tx.insert(topics).values([
          {
            id: 'group-topic-1',
            userId,
            groupId: 'chat-group-1',
            favorite: true,
            updatedAt: new Date('2023-05-01'),
          },
          {
            id: 'group-topic-2',
            userId,
            groupId: 'chat-group-1',
            favorite: false,
            updatedAt: new Date('2023-04-01'),
          },
          {
            id: 'group-topic-3',
            userId,
            groupId: 'chat-group-2',
            favorite: true,
            updatedAt: new Date('2023-06-01'),
          },
        ]);
      });

      const result = await topicModel.query({ containerId: 'chat-group-1' });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('group-topic-1');
      expect(result.items[1].id).toBe('group-topic-2');
    });

    it('should query topics by group ID using groupId parameter', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(chatGroups).values([
          { id: 'chat-group-3', title: 'Chat Group 3', userId },
          { id: 'chat-group-4', title: 'Chat Group 4', userId },
        ]);
        await tx.insert(topics).values([
          {
            id: 'group-topic-4',
            userId,
            groupId: 'chat-group-3',
            favorite: true,
            updatedAt: new Date('2023-05-01'),
          },
          {
            id: 'group-topic-5',
            userId,
            groupId: 'chat-group-3',
            favorite: false,
            updatedAt: new Date('2023-04-01'),
          },
          {
            id: 'group-topic-6',
            userId,
            groupId: 'chat-group-4',
            favorite: true,
            updatedAt: new Date('2023-06-01'),
          },
        ]);
      });

      const result = await topicModel.query({ groupId: 'chat-group-3' });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('group-topic-4');
      expect(result.items[1].id).toBe('group-topic-5');
    });

    it('should return topics based on pagination parameters', async () => {
      await serverDB.insert(topics).values([
        { id: 'topic1', sessionId, userId, updatedAt: new Date('2023-01-01') },
        { id: 'topic2', sessionId, userId, updatedAt: new Date('2023-01-02') },
        { id: 'topic3', sessionId, userId, updatedAt: new Date('2023-01-03') },
      ]);

      const { items: result1 } = await topicModel.query({
        containerId: sessionId,
        current: 0,
        pageSize: 2,
      });
      const { items: result2 } = await topicModel.query({
        containerId: sessionId,
        current: 1,
        pageSize: 2,
      });

      expect(result1).toHaveLength(2);
      expect(result1[0].id).toBe('topic3');
      expect(result1[1].id).toBe('topic2');

      expect(result2).toHaveLength(1);
      expect(result2[0].id).toBe('topic1');
    });
  });

  describe('query with agentId filter', () => {
    it('should filter legacy topics by agentId through agentsToSessions lookup', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([
          { id: 'session-for-agent', userId },
          { id: 'session-other', userId },
        ]);
        await trx.insert(agents).values([{ id: 'agent1', userId, title: 'Agent 1' }]);
        await trx
          .insert(agentsToSessions)
          .values([{ agentId: 'agent1', sessionId: 'session-for-agent', userId }]);
        await trx.insert(topics).values([
          {
            id: 'topic-agent-session',
            userId,
            sessionId: 'session-for-agent',
            agentId: null,
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'topic-other-session',
            userId,
            sessionId: 'session-other',
            agentId: null,
            updatedAt: new Date('2023-01-02'),
          },
        ]);
      });

      const result = await topicModel.query({ agentId: 'agent1' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('topic-agent-session');
    });

    it('should filter new topics by agentId directly', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(agents).values([
          { id: 'new-agent-1', userId, title: 'New Agent 1' },
          { id: 'new-agent-2', userId, title: 'New Agent 2' },
        ]);
        await trx.insert(topics).values([
          {
            id: 'new-topic-1',
            userId,
            agentId: 'new-agent-1',
            sessionId: null,
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'new-topic-2',
            userId,
            agentId: 'new-agent-2',
            sessionId: null,
            updatedAt: new Date('2023-01-02'),
          },
        ]);
      });

      const result = await topicModel.query({ agentId: 'new-agent-1' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('new-topic-1');
    });

    it('should return both legacy and new topics when querying by agentId', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'mixed-session', userId }]);
        await trx.insert(agents).values([{ id: 'mixed-agent', userId, title: 'Mixed Agent' }]);
        await trx
          .insert(agentsToSessions)
          .values([{ agentId: 'mixed-agent', sessionId: 'mixed-session', userId }]);
        await trx.insert(topics).values([
          {
            id: 'legacy-topic',
            userId,
            sessionId: 'mixed-session',
            agentId: null,
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'new-topic',
            userId,
            sessionId: null,
            agentId: 'mixed-agent',
            updatedAt: new Date('2023-01-02'),
          },
          {
            id: 'both-topic',
            userId,
            sessionId: 'mixed-session',
            agentId: 'mixed-agent',
            updatedAt: new Date('2023-01-03'),
          },
        ]);
      });

      const result = await topicModel.query({ agentId: 'mixed-agent' });

      expect(result.items).toHaveLength(3);
      expect(result.items.map((t) => t.id).sort()).toEqual([
        'both-topic',
        'legacy-topic',
        'new-topic',
      ]);
    });

    it('should not return duplicate topics when both agentId and sessionId match', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'dedup-session', userId }]);
        await trx.insert(agents).values([{ id: 'dedup-agent', userId, title: 'Dedup Agent' }]);
        await trx
          .insert(agentsToSessions)
          .values([{ agentId: 'dedup-agent', sessionId: 'dedup-session', userId }]);
        await trx.insert(topics).values([
          {
            id: 'dedup-topic',
            userId,
            sessionId: 'dedup-session',
            agentId: 'dedup-agent',
            updatedAt: new Date('2023-01-01'),
          },
        ]);
      });

      const result = await topicModel.query({ agentId: 'dedup-agent' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('dedup-topic');
    });

    it('should return empty array when agentId has no associated session and no direct agentId match', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session1', userId }]);
        await trx
          .insert(agents)
          .values([{ id: 'agent-no-match', userId, title: 'Agent No Match' }]);
        await trx
          .insert(topics)
          .values([{ id: 'topic-session1', userId, sessionId: 'session1', agentId: null }]);
      });

      const result = await topicModel.query({ agentId: 'agent-no-match' });

      expect(result.items).toHaveLength(0);
    });

    it('should return topics with direct agentId match even without agentsToSessions entry', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(agents).values([{ id: 'orphan-agent', userId, title: 'Orphan Agent' }]);
        await trx.insert(topics).values([
          {
            id: 'orphan-topic',
            userId,
            agentId: 'orphan-agent',
            sessionId: null,
            updatedAt: new Date('2023-01-01'),
          },
        ]);
      });

      const result = await topicModel.query({ agentId: 'orphan-agent' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('orphan-topic');
    });

    it('should only return topics for current user when querying by agentId', async () => {
      const otherUserId = 'other-user-for-topic-test';

      await serverDB.transaction(async (trx) => {
        await trx.insert(users).values([{ id: otherUserId }]);
        await trx.insert(agents).values([{ id: 'shared-agent-name', userId, title: 'User Agent' }]);
        await trx.insert(topics).values([
          { id: 'user-topic', userId, agentId: 'shared-agent-name' },
          { id: 'other-user-topic', userId: otherUserId, agentId: 'shared-agent-name' },
        ]);
      });

      const result = await topicModel.query({ agentId: 'shared-agent-name' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('user-topic');
    });

    it('should only lookup agentsToSessions for current user', async () => {
      const otherUserId = 'other-user-for-topic-test-2';

      await serverDB.transaction(async (trx) => {
        await trx.insert(users).values([{ id: otherUserId }]);
        await trx.insert(sessions).values([
          { id: 'user-session', userId },
          { id: 'other-user-session', userId: otherUserId },
        ]);
        await trx.insert(agents).values([
          { id: 'user-agent', userId, title: 'User Agent' },
          { id: 'other-user-agent', userId: otherUserId, title: 'Other User Agent' },
        ]);
        await trx
          .insert(agentsToSessions)
          .values([
            { agentId: 'other-user-agent', sessionId: 'other-user-session', userId: otherUserId },
          ]);
        await trx.insert(topics).values([
          { id: 'topic-user', userId, agentId: 'other-user-agent' },
          { id: 'topic-other-user', userId: otherUserId, sessionId: 'other-user-session' },
        ]);
      });

      const result = await topicModel.query({ agentId: 'other-user-agent' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('topic-user');
    });

    it('should work with agentId and pagination', async () => {
      await serverDB.transaction(async (trx) => {
        await trx
          .insert(agents)
          .values([{ id: 'paginate-agent', userId, title: 'Paginate Agent' }]);
        await trx.insert(topics).values([
          {
            id: 'page-topic1',
            userId,
            agentId: 'paginate-agent',
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'page-topic2',
            userId,
            agentId: 'paginate-agent',
            updatedAt: new Date('2023-01-02'),
          },
          {
            id: 'page-topic3',
            userId,
            agentId: 'paginate-agent',
            updatedAt: new Date('2023-01-03'),
          },
        ]);
      });

      const result = await topicModel.query({ agentId: 'paginate-agent', current: 0, pageSize: 2 });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('page-topic3');
      expect(result.items[1].id).toBe('page-topic2');

      const { items: result2 } = await topicModel.query({
        agentId: 'paginate-agent',
        current: 1,
        pageSize: 2,
      });
      expect(result2).toHaveLength(1);
      expect(result2[0].id).toBe('page-topic1');
    });

    it('should work with agentId and favorite sorting', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(agents).values([{ id: 'fav-agent', userId, title: 'Fav Agent' }]);
        await trx.insert(topics).values([
          {
            id: 'fav-topic1',
            userId,
            agentId: 'fav-agent',
            favorite: false,
            updatedAt: new Date('2023-01-03'),
          },
          {
            id: 'fav-topic2',
            userId,
            agentId: 'fav-agent',
            favorite: true,
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'fav-topic3',
            userId,
            agentId: 'fav-agent',
            favorite: true,
            updatedAt: new Date('2023-01-02'),
          },
        ]);
      });

      const result = await topicModel.query({ agentId: 'fav-agent' });

      expect(result.items).toHaveLength(3);
      expect(result.items[0].id).toBe('fav-topic3');
      expect(result.items[1].id).toBe('fav-topic2');
      expect(result.items[2].id).toBe('fav-topic1');
    });

    it('should use containerId when agentId is not provided', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'container-session', userId }]);
        await trx.insert(topics).values([
          {
            id: 'container-topic',
            userId,
            sessionId: 'container-session',
            updatedAt: new Date('2023-01-01'),
          },
        ]);
      });

      const result = await topicModel.query({ containerId: 'container-session' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('container-topic');
    });

    it('should ignore containerId when agentId is provided', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([
          { id: 'agent-only-session', userId },
          { id: 'container-only-session', userId },
        ]);
        await trx
          .insert(agents)
          .values([{ id: 'priority-agent', userId, title: 'Priority Agent' }]);
        await trx
          .insert(agentsToSessions)
          .values([{ agentId: 'priority-agent', sessionId: 'agent-only-session', userId }]);
        await trx.insert(topics).values([
          {
            id: 'agent-topic',
            userId,
            sessionId: 'agent-only-session',
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'container-topic',
            userId,
            sessionId: 'container-only-session',
            updatedAt: new Date('2023-01-02'),
          },
        ]);
      });

      const result = await topicModel.query({
        agentId: 'priority-agent',
        containerId: 'container-only-session',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('agent-topic');
    });

    it('should prioritize groupId over agentId when both provided', async () => {
      await serverDB.transaction(async (trx) => {
        await trx
          .insert(chatGroups)
          .values([{ id: 'priority-group', title: 'Priority Group', userId }]);
        await trx
          .insert(agents)
          .values([{ id: 'priority-agent', userId, title: 'Priority Agent' }]);
        await trx.insert(topics).values([
          {
            id: 'group-topic',
            userId,
            groupId: 'priority-group',
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'agent-topic',
            userId,
            agentId: 'priority-agent',
            updatedAt: new Date('2023-01-02'),
          },
        ]);
      });

      // When groupId is provided, it should only return topics for that group
      const result = await topicModel.query({
        groupId: 'priority-group',
        agentId: 'priority-agent',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('group-topic');
    });
  });

  describe('isInbox parameter', () => {
    it('should query legacy inbox topics when isInbox is true', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(agents).values([{ id: 'inbox-agent', userId, title: 'Inbox Agent' }]);
        await trx.insert(topics).values([
          {
            id: 'legacy-inbox-1',
            userId,
            sessionId: null,
            groupId: null,
            agentId: null,
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'legacy-inbox-2',
            userId,
            sessionId: null,
            groupId: null,
            agentId: null,
            updatedAt: new Date('2023-01-02'),
          },
          {
            id: 'new-inbox-topic',
            userId,
            sessionId: null,
            groupId: null,
            agentId: 'inbox-agent',
            updatedAt: new Date('2023-01-03'),
          },
        ]);
      });

      const result = await topicModel.query({ agentId: 'inbox-agent', isInbox: true });

      expect(result.items).toHaveLength(3);
      expect(result.items.map((t) => t.id).sort()).toEqual([
        'legacy-inbox-1',
        'legacy-inbox-2',
        'new-inbox-topic',
      ]);
    });

    it('should NOT query legacy inbox topics when isInbox is false or undefined', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(agents).values([{ id: 'normal-agent', userId, title: 'Normal Agent' }]);
        await trx.insert(topics).values([
          {
            id: 'legacy-inbox',
            userId,
            sessionId: null,
            groupId: null,
            agentId: null,
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'normal-topic',
            userId,
            sessionId: null,
            groupId: null,
            agentId: 'normal-agent',
            updatedAt: new Date('2023-01-02'),
          },
        ]);
      });

      const result = await topicModel.query({ agentId: 'normal-agent' });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('normal-topic');
    });

    it('should not include topics with unrelated sessionId when querying inbox legacy data', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'some-session', userId }]);
        await trx.insert(agents).values([{ id: 'inbox-agent-2', userId, title: 'Inbox Agent 2' }]);
        await trx.insert(topics).values([
          {
            id: 'true-legacy-inbox',
            userId,
            sessionId: null,
            groupId: null,
            agentId: null,
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'session-topic',
            userId,
            sessionId: 'some-session',
            groupId: null,
            agentId: null,
            updatedAt: new Date('2023-01-02'),
          },
        ]);
      });

      const result = await topicModel.query({ agentId: 'inbox-agent-2', isInbox: true });

      // Should only include true legacy inbox (no sessionId), not the unrelated session topic
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('true-legacy-inbox');
    });

    it('should include topics with associated sessionId via agentsToSessions when isInbox is true', async () => {
      // This tests the scenario where old users have inbox topics with sessionId
      // but no agentId, linked via agentsToSessions relation
      await serverDB.transaction(async (trx) => {
        // Create inbox session and agent with relation
        await trx.insert(sessions).values([{ id: 'inbox-session', slug: 'inbox', userId }]);
        await trx
          .insert(agents)
          .values([{ id: 'inbox-agent-linked', userId, title: 'Inbox Agent' }]);
        await trx
          .insert(agentsToSessions)
          .values([{ agentId: 'inbox-agent-linked', sessionId: 'inbox-session', userId }]);

        // Create topics: one with sessionId (legacy), one with agentId (new), one completely orphan
        await trx.insert(topics).values([
          {
            id: 'legacy-session-topic',
            userId,
            sessionId: 'inbox-session',
            groupId: null,
            agentId: null,
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'new-agentid-topic',
            userId,
            sessionId: null,
            groupId: null,
            agentId: 'inbox-agent-linked',
            updatedAt: new Date('2023-01-02'),
          },
          {
            id: 'orphan-legacy-topic',
            userId,
            sessionId: null,
            groupId: null,
            agentId: null,
            updatedAt: new Date('2023-01-03'),
          },
        ]);
      });

      const result = await topicModel.query({ agentId: 'inbox-agent-linked', isInbox: true });

      // Should include all three: legacy with sessionId, new with agentId, orphan legacy
      expect(result.items).toHaveLength(3);
      expect(result.items.map((t) => t.id).sort()).toEqual([
        'legacy-session-topic',
        'new-agentid-topic',
        'orphan-legacy-topic',
      ]);
    });

    it('should not include topics with groupId when querying inbox legacy data', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values([{ id: 'some-group', title: 'Some Group', userId }]);
        await trx.insert(agents).values([{ id: 'inbox-agent-3', userId, title: 'Inbox Agent 3' }]);
        await trx.insert(topics).values([
          {
            id: 'true-legacy-inbox-2',
            userId,
            sessionId: null,
            groupId: null,
            agentId: null,
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'group-topic',
            userId,
            sessionId: null,
            groupId: 'some-group',
            agentId: null,
            updatedAt: new Date('2023-01-02'),
          },
        ]);
      });

      const result = await topicModel.query({ agentId: 'inbox-agent-3', isInbox: true });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('true-legacy-inbox-2');
    });

    it('should isolate legacy inbox topics by user', async () => {
      const otherUserId = 'other-inbox-user';

      await serverDB.transaction(async (trx) => {
        await trx.insert(users).values([{ id: otherUserId }]);
        await trx.insert(agents).values([{ id: 'inbox-agent-4', userId, title: 'Inbox Agent 4' }]);
        await trx.insert(topics).values([
          {
            id: 'my-legacy-inbox',
            userId,
            sessionId: null,
            groupId: null,
            agentId: null,
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'other-legacy-inbox',
            userId: otherUserId,
            sessionId: null,
            groupId: null,
            agentId: null,
            updatedAt: new Date('2023-01-02'),
          },
        ]);
      });

      const result = await topicModel.query({ agentId: 'inbox-agent-4', isInbox: true });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('my-legacy-inbox');
    });

    it('should work with pagination when isInbox is true', async () => {
      await serverDB.transaction(async (trx) => {
        await trx
          .insert(agents)
          .values([{ id: 'inbox-paginate', userId, title: 'Inbox Paginate' }]);
        await trx.insert(topics).values([
          {
            id: 'inbox-page-1',
            userId,
            sessionId: null,
            groupId: null,
            agentId: null,
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'inbox-page-2',
            userId,
            sessionId: null,
            groupId: null,
            agentId: null,
            updatedAt: new Date('2023-01-02'),
          },
          {
            id: 'inbox-page-3',
            userId,
            sessionId: null,
            groupId: null,
            agentId: 'inbox-paginate',
            updatedAt: new Date('2023-01-03'),
          },
        ]);
      });

      const result1 = await topicModel.query({
        agentId: 'inbox-paginate',
        isInbox: true,
        current: 0,
        pageSize: 2,
      });

      expect(result1.items).toHaveLength(2);
      expect(result1.total).toBe(3);

      const result2 = await topicModel.query({
        agentId: 'inbox-paginate',
        isInbox: true,
        current: 1,
        pageSize: 2,
      });

      expect(result2.items).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('should return a topic by id', async () => {
      await serverDB.insert(topics).values({ id: 'topic1', sessionId, userId });

      const result = await topicModel.findById('topic1');

      expect(result?.id).toBe('topic1');
    });

    it('should return undefined for non-existent topic', async () => {
      const result = await topicModel.findById('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('queryAll', () => {
    it('should return all topics', async () => {
      await serverDB.insert(topics).values([
        { id: 'topic1', sessionId, userId },
        { id: 'topic2', sessionId, userId },
      ]);

      const result = await topicModel.queryAll();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('topic1');
      expect(result[1].id).toBe('topic2');
    });
  });

  describe('queryByKeyword', () => {
    it('should return topics matching topic title keyword', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values([
          { id: 'topic1', title: 'Hello world', sessionId, userId },
          { id: 'topic2', title: 'Goodbye', sessionId, userId },
        ]);
        await tx
          .insert(messages)
          .values([
            { id: 'message1', role: 'assistant', content: 'abc there', topicId: 'topic1', userId },
          ]);
      });

      const result = await topicModel.queryByKeyword('hello', sessionId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('topic1');
    });

    it('should return topics matching message content keyword', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values([
          { id: 'topic1', title: 'abc world', sessionId, userId },
          { id: 'topic2', title: 'Goodbye', sessionId, userId },
        ]);
        await tx.insert(messages).values([
          {
            id: 'message1',
            role: 'assistant',
            content: 'Hello there',
            topicId: 'topic1',
            userId,
          },
        ]);
      });

      const result = await topicModel.queryByKeyword('hello', sessionId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('topic1');
    });

    it('should return nothing if not match', async () => {
      await serverDB.insert(topics).values([
        { id: 'topic1', title: 'Hello world', userId },
        { id: 'topic2', title: 'Goodbye', sessionId, userId },
      ]);
      await serverDB
        .insert(messages)
        .values([
          { id: 'message1', role: 'assistant', content: 'abc there', topicId: 'topic1', userId },
        ]);

      const result = await topicModel.queryByKeyword('hello', sessionId);

      expect(result).toHaveLength(0);
    });

    it('should return topics by title when message matches have null topicIds', async () => {
      await serverDB.transaction(async (tx) => {
        await tx
          .insert(topics)
          .values([{ id: 'title-match-topic', title: 'Search keyword here', sessionId, userId }]);
        await tx.insert(messages).values([
          {
            id: 'orphan-message',
            role: 'assistant',
            content: 'Search keyword',
            topicId: null,
            userId,
          },
        ]);
      });

      const result = await topicModel.queryByKeyword('keyword', sessionId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('title-match-topic');
    });
  });

  describe('queryRecent', () => {
    it('should return recent topics with agentId and sessionId', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(agents).values([
          {
            id: 'agent1',
            userId,
            title: 'Agent 1',
            avatar: 'avatar1.png',
            backgroundColor: '#ff0000',
          },
          {
            id: 'agent2',
            userId,
            title: 'Agent 2',
            avatar: 'avatar2.png',
            backgroundColor: '#00ff00',
          },
        ]);
        await tx.insert(topics).values([
          {
            id: 'recent-topic-1',
            title: 'Topic 1',
            userId,
            agentId: 'agent1',
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'recent-topic-2',
            title: 'Topic 2',
            userId,
            agentId: 'agent2',
            updatedAt: new Date('2023-02-01'),
          },
          {
            id: 'recent-topic-3',
            title: 'Topic 3',
            userId,
            agentId: 'agent1',
            updatedAt: new Date('2023-03-01'),
          },
        ]);
      });

      const result = await topicModel.queryRecent();

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('recent-topic-3');
      expect(result[0].title).toBe('Topic 3');
      expect(result[0].agentId).toBe('agent1');

      expect(result[1].id).toBe('recent-topic-2');
      expect(result[1].agentId).toBe('agent2');
    });

    it('should respect limit parameter', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(agents).values([{ id: 'limit-agent', userId, title: 'Limit Agent' }]);
        await tx.insert(topics).values([
          { id: 'limit-topic-1', title: 'Topic 1', userId, agentId: 'limit-agent' },
          { id: 'limit-topic-2', title: 'Topic 2', userId, agentId: 'limit-agent' },
          { id: 'limit-topic-3', title: 'Topic 3', userId, agentId: 'limit-agent' },
        ]);
      });

      const result = await topicModel.queryRecent(2);

      expect(result).toHaveLength(2);
    });

    it('should return null agentId when topic has groupId but no agentId', async () => {
      // Topics with groupId are included even without agentId
      await serverDB.transaction(async (tx) => {
        await tx
          .insert(chatGroups)
          .values([{ id: 'group-for-null-agent', userId, title: 'Test Group' }]);
        await tx.insert(topics).values([
          {
            id: 'no-agent-topic',
            title: 'Topic without agent',
            userId,
            agentId: null,
            groupId: 'group-for-null-agent',
          },
        ]);
      });

      const result = await topicModel.queryRecent();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('no-agent-topic');
      expect(result[0].agentId).toBeNull();
      expect(result[0].type).toBe('group');
    });

    it('should only return topics for current user', async () => {
      const otherUserId = 'other-user-recent';

      await serverDB.transaction(async (tx) => {
        await tx.insert(users).values([{ id: otherUserId }]);
        // Create agents for both users (topics need valid agents)
        await tx.insert(agents).values([
          { id: 'user-agent-for-recent', userId, title: 'User Agent', virtual: false },
          {
            id: 'other-agent-for-recent',
            userId: otherUserId,
            title: 'Other Agent',
            virtual: false,
          },
        ]);
        await tx.insert(topics).values([
          {
            id: 'user-recent-topic',
            title: 'User Topic',
            userId,
            agentId: 'user-agent-for-recent',
          },
          {
            id: 'other-recent-topic',
            title: 'Other Topic',
            userId: otherUserId,
            agentId: 'other-agent-for-recent',
          },
        ]);
      });

      const result = await topicModel.queryRecent();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-recent-topic');
    });

    it('should use default limit of 12', async () => {
      await serverDB.transaction(async (tx) => {
        // Create a valid agent for topics
        await tx
          .insert(agents)
          .values([{ id: 'agent-for-limit-test', userId, title: 'Test Agent', virtual: false }]);
        const topicValues = Array.from({ length: 15 }, (_, i) => ({
          id: `default-limit-topic-${i}`,
          title: `Topic ${i}`,
          userId,
          agentId: 'agent-for-limit-test',
        }));
        await tx.insert(topics).values(topicValues);
      });

      const result = await topicModel.queryRecent();

      expect(result).toHaveLength(12);
    });

    it('should correctly assign type based on groupId presence', async () => {
      // Topics with groupId should be typed as 'group', topics without as 'agent'
      await serverDB.transaction(async (tx) => {
        await tx.insert(chatGroups).values([{ id: 'group-for-type', userId, title: 'Type Group' }]);
        await tx
          .insert(agents)
          .values([{ id: 'agent-for-type', userId, title: 'Type Agent', virtual: false }]);
        await tx.insert(topics).values([
          {
            id: 'group-topic-type',
            title: 'Group Topic',
            userId,
            groupId: 'group-for-type',
            updatedAt: new Date('2023-01-02'),
          },
          {
            id: 'agent-topic-type',
            title: 'Agent Topic',
            userId,
            agentId: 'agent-for-type',
            updatedAt: new Date('2023-01-01'),
          },
        ]);
      });

      const result = await topicModel.queryRecent();

      expect(result).toHaveLength(2);
      const groupTopic = result.find((t) => t.id === 'group-topic-type');
      const agentTopic = result.find((t) => t.id === 'agent-topic-type');
      expect(groupTopic?.type).toBe('group');
      expect(agentTopic?.type).toBe('agent');
    });

    it('should exclude topics from virtual agents', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(agents).values([
          { id: 'normal-agent', userId, title: 'Normal Agent', virtual: false },
          { id: 'virtual-agent', userId, title: 'Virtual Agent', virtual: true },
        ]);
        await tx.insert(topics).values([
          {
            id: 'normal-agent-topic',
            title: 'Normal Topic',
            userId,
            agentId: 'normal-agent',
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'virtual-agent-topic',
            title: 'Virtual Topic',
            userId,
            agentId: 'virtual-agent',
            updatedAt: new Date('2023-01-02'),
          },
        ]);
      });

      const result = await topicModel.queryRecent();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('normal-agent-topic');
      expect(result[0].type).toBe('agent');
    });

    it('should include topics from inbox agent (slug=inbox)', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(agents).values([
          { id: 'inbox-agent', userId, title: 'LobeAI', slug: 'inbox', virtual: true },
          { id: 'other-virtual', userId, title: 'Other Virtual', virtual: true },
        ]);
        await tx.insert(topics).values([
          {
            id: 'inbox-topic',
            title: 'Inbox Topic',
            userId,
            agentId: 'inbox-agent',
            updatedAt: new Date('2023-01-02'),
          },
          {
            id: 'other-virtual-topic',
            title: 'Other Virtual Topic',
            userId,
            agentId: 'other-virtual',
            updatedAt: new Date('2023-01-01'),
          },
        ]);
      });

      const result = await topicModel.queryRecent();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('inbox-topic');
      expect(result[0].type).toBe('agent');
    });

    it('should include topics with groupId and mark them as group type', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(chatGroups).values([{ id: 'test-group', title: 'Test Group', userId }]);
        await tx.insert(agents).values([{ id: 'group-member', userId, title: 'Group Member' }]);
        await tx.insert(topics).values([
          {
            id: 'group-topic',
            title: 'Group Topic',
            userId,
            groupId: 'test-group',
            updatedAt: new Date('2023-01-01'),
          },
        ]);
      });

      const result = await topicModel.queryRecent();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('group-topic');
      expect(result[0].groupId).toBe('test-group');
      expect(result[0].type).toBe('group');
    });

    it('should return mixed results from agent, inbox, and group topics', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(chatGroups).values([{ id: 'mixed-group', title: 'Mixed Group', userId }]);
        await tx.insert(agents).values([
          { id: 'normal-agent', userId, title: 'Normal Agent', virtual: false },
          { id: 'inbox-agent', userId, title: 'LobeAI', slug: 'inbox', virtual: true },
          { id: 'virtual-agent', userId, title: 'Virtual Agent', virtual: true },
        ]);
        await tx.insert(topics).values([
          {
            id: 'agent-topic',
            title: 'Agent Topic',
            userId,
            agentId: 'normal-agent',
            updatedAt: new Date('2023-01-01'),
          },
          {
            id: 'inbox-topic',
            title: 'Inbox Topic',
            userId,
            agentId: 'inbox-agent',
            updatedAt: new Date('2023-01-02'),
          },
          {
            id: 'group-topic',
            title: 'Group Topic',
            userId,
            groupId: 'mixed-group',
            updatedAt: new Date('2023-01-03'),
          },
          {
            id: 'virtual-topic',
            title: 'Virtual Topic (should be excluded)',
            userId,
            agentId: 'virtual-agent',
            updatedAt: new Date('2023-01-04'),
          },
        ]);
      });

      const result = await topicModel.queryRecent();

      // Should include: group-topic, inbox-topic, agent-topic
      // Should exclude: virtual-topic
      expect(result).toHaveLength(3);
      expect(result.map((t) => t.id)).toEqual(['group-topic', 'inbox-topic', 'agent-topic']);
      expect(result[0].type).toBe('group');
      expect(result[1].type).toBe('agent');
      expect(result[2].type).toBe('agent');
    });
  });

  describe('listTopicsForMemoryExtractor', () => {
    beforeEach(async () => {
      // Clear topics from previous tests to ensure isolation
      await serverDB.delete(topics);
    });

    it('should paginate pending topics and skip extracted ones by default', async () => {
      await serverDB.insert(topics).values([
        {
          createdAt: new Date('2024-01-01T00:00:00Z'),
          id: 't1',
          metadata: { userMemoryExtractStatus: 'completed' },
          userId,
        },
        { createdAt: new Date('2024-01-02T00:00:00Z'), id: 't2', userId },
        {
          createdAt: new Date('2024-01-03T00:00:00Z'),
          id: 't3',
          metadata: { userMemoryExtractStatus: 'pending' },
          userId,
        },
        { createdAt: new Date('2024-01-04T00:00:00Z'), id: 't4', userId: userId2 },
      ] satisfies Array<typeof topics.$inferInsert>);

      // t1 is skipped because it has userMemoryExtractStatus: 'completed'
      // t4 is skipped because it belongs to a different user
      const page1 = await topicModel.listTopicsForMemoryExtractor({ limit: 1 });
      expect(page1.map((t) => t.id)).toEqual(['t2']);

      const page2 = await topicModel.listTopicsForMemoryExtractor({
        cursor: { createdAt: page1[0].createdAt, id: page1[0].id },
        limit: 5,
      });
      expect(page2.map((t) => t.id)).toEqual(['t3']);
    });

    it('should include extracted topics when ignoreExtracted is true', async () => {
      await serverDB.insert(topics).values([
        {
          createdAt: new Date('2024-02-01T00:00:00Z'),
          id: 'et1',
          metadata: { userMemoryExtractStatus: 'completed' },
          userId,
        },
        { createdAt: new Date('2024-02-02T00:00:00Z'), id: 'et2', userId },
      ] satisfies Array<typeof topics.$inferInsert>);

      const rows = await topicModel.listTopicsForMemoryExtractor({
        ignoreExtracted: true,
        limit: 10,
      });

      expect(rows.map((t) => t.id)).toEqual(['et1', 'et2']);
    });

    it('should paginate forward from the cursor, excluding items at or before it and including later ones', async () => {
      const createdAt = new Date('2025-01-20T18:43:33.603Z');

      await serverDB.insert(topics).values([
        // Before cursor
        { createdAt: new Date(createdAt.getTime() - 2), id: 'before-old', userId },
        { createdAt, id: 'before-same-timestamp', userId },
        // Cursor row
        { createdAt, id: 'cursor-topic', userId },
        // Same timestamp, after cursor by ID
        { createdAt, id: 'cursor-topic-z', userId },
        // Later timestamps
        { createdAt: new Date(createdAt.getTime() + 1), id: 'after-1', userId },
        { createdAt: new Date(createdAt.getTime() + 2), id: 'after-2', userId },
        // Different user should be ignored
        { createdAt: new Date(createdAt.getTime() + 3), id: 'other-user', userId: userId2 },
      ] satisfies Array<typeof topics.$inferInsert>);

      const rows = await topicModel.listTopicsForMemoryExtractor({
        cursor: { createdAt, id: 'cursor-topic' },
        limit: 10,
      });

      expect(rows.map((t) => t.id)).toEqual(['cursor-topic-z', 'after-1', 'after-2']);
    });
  });
});
