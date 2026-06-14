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
  workspaces,
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

    it('should isolate personal and workspace topics for the same user', async () => {
      await serverDB.insert(workspaces).values({
        id: 'topic-workspace',
        name: 'Workspace',
        primaryOwnerId: userId,
        slug: 'topic-workspace',
      });
      await serverDB.insert(sessions).values({
        id: 'topic-workspace-session',
        userId,
        workspaceId: 'topic-workspace',
      });
      await serverDB.insert(topics).values([
        {
          id: 'personal-topic',
          sessionId,
          updatedAt: new Date('2023-01-01'),
          userId,
          workspaceId: null,
        },
        {
          id: 'workspace-topic',
          sessionId: 'topic-workspace-session',
          updatedAt: new Date('2023-02-01'),
          userId,
          workspaceId: 'topic-workspace',
        },
      ]);

      await expect(topicModel.query({ containerId: sessionId })).resolves.toMatchObject({
        items: [expect.objectContaining({ id: 'personal-topic' })],
        total: 1,
      });
      await expect(
        new TopicModel(serverDB, userId, 'topic-workspace').query({
          containerId: 'topic-workspace-session',
        }),
      ).resolves.toMatchObject({
        items: [expect.objectContaining({ id: 'workspace-topic' })],
        total: 1,
      });
    });

    it('should order by status priority when sortBy is "status"', async () => {
      await serverDB.insert(topics).values([
        // favorite floats to the top regardless of its (lower-priority) status
        {
          favorite: true,
          id: 'fav',
          sessionId,
          status: 'completed',
          updatedAt: new Date('2023-01-01'),
          userId,
        },
        // null status is treated as `active` (rank 3)
        { id: 'active', sessionId, updatedAt: new Date('2023-09-01'), userId },
        {
          id: 'running-old',
          sessionId,
          status: 'running',
          updatedAt: new Date('2023-02-01'),
          userId,
        },
        {
          id: 'running-new',
          sessionId,
          status: 'running',
          updatedAt: new Date('2023-08-01'),
          userId,
        },
        {
          id: 'waiting',
          sessionId,
          status: 'waitingForHuman',
          updatedAt: new Date('2023-03-01'),
          userId,
        },
        // failed shares the top "pending" bucket with waitingForHuman, so it
        // ranks just below it and above running/active
        {
          id: 'failed',
          sessionId,
          status: 'failed',
          updatedAt: new Date('2023-04-01'),
          userId,
        },
        {
          id: 'completed',
          sessionId,
          status: 'completed',
          updatedAt: new Date('2023-07-01'),
          userId,
        },
      ]);

      const result = await topicModel.query({ containerId: sessionId, sortBy: 'status' });

      expect(result.items.map((t) => t.id)).toEqual([
        'fav', // favorite, rank-independent
        'waiting', // waitingForHuman = 0
        'failed', // failed = 1
        'running-new', // running = 2, newer first within the bucket
        'running-old',
        'active', // null status → active = 3
        'completed', // completed = 5
      ]);
    });

    it('should order by latest message activity by default (no sortBy)', async () => {
      await serverDB.insert(topics).values([
        {
          id: 'waiting',
          sessionId,
          status: 'waitingForHuman',
          updatedAt: new Date('2023-01-01'),
          userId,
        },
        { id: 'active', sessionId, updatedAt: new Date('2023-05-01'), userId },
      ]);
      await serverDB.insert(messages).values([
        {
          id: 'waiting-latest-message',
          role: 'user',
          topicId: 'waiting',
          updatedAt: new Date('2023-06-01'),
          userId,
        },
        {
          id: 'active-older-message',
          role: 'user',
          topicId: 'active',
          updatedAt: new Date('2023-04-01'),
          userId,
        },
      ]);

      const result = await topicModel.query({ containerId: sessionId });

      // Without status sort, most-recent message activity wins even if topic.updatedAt is older.
      expect(result.items.map((t) => t.id)).toEqual(['waiting', 'active']);
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

    it('should exclude topics with specified triggers via excludeTriggers', async () => {
      await serverDB.insert(topics).values([
        { id: 'normal-topic', sessionId, userId, title: 'Normal' },
        { id: 'cron-topic', sessionId, userId, title: 'Cron', trigger: 'cron' },
        { id: 'null-trigger', sessionId, userId, title: 'Null Trigger' },
      ]);

      const result = await topicModel.query({
        containerId: sessionId,
        excludeTriggers: ['cron'],
      });

      // Should return topics with null trigger or triggers not in the exclude list
      expect(result.items).toHaveLength(2);
      const ids = result.items.map((t) => t.id);
      expect(ids).toContain('normal-topic');
      expect(ids).toContain('null-trigger');
      expect(ids).not.toContain('cron-topic');
    });

    it('should include only topics with specified triggers via includeTriggers', async () => {
      await serverDB.insert(topics).values([
        { id: 'normal-topic', sessionId, userId, title: 'Normal' },
        { id: 'cron-topic', sessionId, userId, title: 'Cron', trigger: 'cron' },
        { id: 'eval-topic', sessionId, userId, title: 'Eval', trigger: 'eval' },
      ]);

      const result = await topicModel.query({
        containerId: sessionId,
        includeTriggers: ['cron'],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('cron-topic');
    });

    it('should prioritize includeTriggers over excludeTriggers when both are provided', async () => {
      await serverDB.insert(topics).values([
        { id: 'cron-topic', sessionId, userId, title: 'Cron', trigger: 'cron' },
        { id: 'eval-topic', sessionId, userId, title: 'Eval', trigger: 'eval' },
      ]);

      const result = await topicModel.query({
        containerId: sessionId,
        excludeTriggers: ['cron'],
        includeTriggers: ['cron'],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('cron-topic');
    });

    it('should only return topics with matching triggers when triggers is set', async () => {
      await serverDB.insert(topics).values([
        { id: 'normal-topic', sessionId, userId, title: 'Normal' },
        { id: 'cron-topic', sessionId, userId, title: 'Cron', trigger: 'cron' },
        { id: 'eval-topic', sessionId, userId, title: 'Eval', trigger: 'eval' },
      ]);

      const result = await topicModel.query({
        containerId: sessionId,
        triggers: ['cron'],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('cron-topic');
    });

    it('should exclude topics with matching status via excludeStatuses, keeping null status', async () => {
      const completedAt = new Date('2024-01-05');
      await serverDB.insert(topics).values([
        { id: 'active-topic', sessionId, userId, title: 'Active', status: 'active' },
        {
          id: 'completed-topic',
          sessionId,
          userId,
          title: 'Completed',
          status: 'completed',
          completedAt,
        },
        { id: 'archived-topic', sessionId, userId, title: 'Archived', status: 'archived' },
        { id: 'null-status-topic', sessionId, userId, title: 'No status' },
      ]);

      const result = await topicModel.query({
        containerId: sessionId,
        excludeStatuses: ['completed'],
      });

      const ids = result.items.map((t) => t.id);
      expect(ids).toHaveLength(3);
      expect(ids).toContain('active-topic');
      expect(ids).toContain('archived-topic');
      expect(ids).toContain('null-status-topic');
      expect(ids).not.toContain('completed-topic');
    });

    it('should select status and completedAt on returned topics', async () => {
      const completedAt = new Date('2024-02-01T10:00:00Z');
      await serverDB.insert(topics).values([
        {
          id: 'with-status',
          sessionId,
          userId,
          title: 'With Status',
          status: 'completed',
          completedAt,
        },
      ]);

      const result = await topicModel.query({ containerId: sessionId });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].status).toBe('completed');
      expect(result.items[0].completedAt?.toISOString()).toBe(completedAt.toISOString());
    });

    it('should apply excludeStatuses on the agent query branch', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(agents).values([{ id: 'status-agent', userId, title: 'Status Agent' }]);
        await trx.insert(topics).values([
          {
            id: 'agent-active',
            userId,
            agentId: 'status-agent',
            status: 'active',
            updatedAt: new Date('2024-01-01'),
          },
          {
            id: 'agent-completed',
            userId,
            agentId: 'status-agent',
            status: 'completed',
            updatedAt: new Date('2024-01-02'),
          },
        ]);
      });

      const result = await topicModel.query({
        agentId: 'status-agent',
        excludeStatuses: ['completed'],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('agent-active');
      expect(result.total).toBe(1);
    });

    it('should apply excludeStatuses on the groupId query branch', async () => {
      await serverDB.transaction(async (trx) => {
        await trx
          .insert(chatGroups)
          .values([{ id: 'status-group', title: 'Status Group', userId }]);
        await trx.insert(topics).values([
          {
            id: 'group-active',
            userId,
            groupId: 'status-group',
            status: 'active',
            updatedAt: new Date('2024-01-01'),
          },
          {
            id: 'group-completed',
            userId,
            groupId: 'status-group',
            status: 'completed',
            updatedAt: new Date('2024-01-02'),
          },
        ]);
      });

      const result = await topicModel.query({
        groupId: 'status-group',
        excludeStatuses: ['completed'],
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('group-active');
    });
  });

  describe('query with agentId filter', () => {
    it('should not match legacy session-only topics by agentId', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'session-for-agent', userId }]);
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
        ]);
      });

      // Topics carrying only a legacy sessionId are no longer adopted by the
      // agent query; only `topics.agentId` matches.
      const result = await topicModel.query({ agentId: 'agent1' });

      expect(result.items).toHaveLength(0);
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

    it('should only return topics carrying the agentId, ignoring session-only ones', async () => {
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

      // `legacy-topic` (sessionId only, no agentId) is excluded.
      expect(result.items).toHaveLength(2);
      expect(result.items.map((t) => t.id).sort()).toEqual(['both-topic', 'new-topic']);
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
        await trx.insert(sessions).values([{ id: 'container-only-session', userId }]);
        await trx
          .insert(agents)
          .values([{ id: 'priority-agent', userId, title: 'Priority Agent' }]);
        await trx.insert(topics).values([
          {
            id: 'agent-topic',
            userId,
            agentId: 'priority-agent',
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

  describe('query with withDetails option', () => {
    const seedTopicWithMessages = async (
      topicId: string,
      userMessage: string,
      messageCount: number,
      description?: string,
      trigger?: string,
    ) => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(agents).values({ id: `agt-${topicId}`, userId, title: `Agent ${topicId}` });
        await tx.insert(topics).values({
          id: topicId,
          userId,
          agentId: `agt-${topicId}`,
          description: description ?? null,
          trigger: trigger ?? null,
          updatedAt: new Date('2024-01-01'),
        });

        const rows = [
          { id: `${topicId}-m0`, role: 'user', content: userMessage },
          ...Array.from({ length: messageCount - 1 }, (_, i) => ({
            id: `${topicId}-m${i + 1}`,
            role: i % 2 === 0 ? 'assistant' : 'user',
            content: `reply ${i + 1}`,
          })),
        ].map((m, idx) => ({
          ...m,
          topicId,
          userId,
          createdAt: new Date(`2024-01-01T00:00:0${idx}Z`),
        }));
        if (rows.length > 0) await tx.insert(messages).values(rows);
      });
    };

    it('omits detail columns by default (withDetails not set)', async () => {
      await seedTopicWithMessages('plain-topic', 'first user msg', 3, 'desc-text', 'chat');

      const result = await topicModel.query({ agentId: 'agt-plain-topic' });

      expect(result.items).toHaveLength(1);
      const item = result.items[0] as Record<string, unknown>;
      expect(item.id).toBe('plain-topic');
      // Sidebar-shape: detail columns must not exist on the payload
      expect(item).not.toHaveProperty('firstUserMessage');
      expect(item).not.toHaveProperty('messageCount');
      expect(item).not.toHaveProperty('description');
      expect(item).not.toHaveProperty('trigger');
      expect(item).not.toHaveProperty('cost');
      expect(item).not.toHaveProperty('tokenUsage');
    });

    it('returns detail columns when withDetails is true', async () => {
      await seedTopicWithMessages(
        'detailed-topic',
        'hello first user message',
        4,
        'a short description',
        'cron',
      );

      const result = await topicModel.query({
        agentId: 'agt-detailed-topic',
        withDetails: true,
      });

      expect(result.items).toHaveLength(1);
      const item = result.items[0] as Record<string, unknown>;
      expect(item.id).toBe('detailed-topic');
      expect(item.firstUserMessage).toBe('hello first user message');
      expect(item.messageCount).toBe(4);
      expect(item.description).toBe('a short description');
      expect(item.trigger).toBe('cron');
      // cost / tokenUsage are not yet returned — waiting on a schema
      // migration to add real columns before they come back.
      expect(item).not.toHaveProperty('cost');
      expect(item).not.toHaveProperty('tokenUsage');
    });

    it('returns null firstUserMessage when no user message exists', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(agents).values({ id: 'agt-no-user-msg', userId, title: 'No User Msg' });
        await tx.insert(topics).values({
          id: 'no-user-msg-topic',
          userId,
          agentId: 'agt-no-user-msg',
          updatedAt: new Date('2024-01-01'),
        });
        // Only an assistant message — the `WHERE role = 'user'` subquery should
        // skip it and return null.
        await tx.insert(messages).values({
          id: 'no-user-msg-topic-m0',
          role: 'assistant',
          content: 'assistant only reply',
          topicId: 'no-user-msg-topic',
          userId,
        });
      });

      const result = await topicModel.query({
        agentId: 'agt-no-user-msg',
        withDetails: true,
      });

      expect(result.items).toHaveLength(1);
      const item = result.items[0] as Record<string, unknown>;
      expect(item.firstUserMessage).toBeNull();
      expect(item.messageCount).toBe(1);
    });

    it('picks the earliest user message by createdAt for firstUserMessage', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(agents).values({ id: 'agt-order', userId, title: 'Order' });
        await tx.insert(topics).values({
          id: 'order-topic',
          userId,
          agentId: 'agt-order',
          updatedAt: new Date('2024-01-01'),
        });
        // Insert in non-chronological order so we exercise the ORDER BY in
        // the subquery rather than insertion order.
        await tx.insert(messages).values([
          {
            id: 'order-topic-m2',
            role: 'user',
            content: 'second user message',
            topicId: 'order-topic',
            userId,
            createdAt: new Date('2024-01-01T00:00:02Z'),
          },
          {
            id: 'order-topic-m0',
            role: 'user',
            content: 'first user message',
            topicId: 'order-topic',
            userId,
            createdAt: new Date('2024-01-01T00:00:00Z'),
          },
          {
            id: 'order-topic-m1',
            role: 'assistant',
            content: 'an assistant reply in between',
            topicId: 'order-topic',
            userId,
            createdAt: new Date('2024-01-01T00:00:01Z'),
          },
        ]);
      });

      const result = await topicModel.query({
        agentId: 'agt-order',
        withDetails: true,
      });

      const item = result.items[0] as Record<string, unknown>;
      expect(item.firstUserMessage).toBe('first user message');
      expect(item.messageCount).toBe(3);
    });

    it('also returns detail columns when querying via groupId', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(chatGroups).values({ id: 'detail-group', title: 'Detail Group', userId });
        await tx.insert(topics).values({
          id: 'detail-group-topic',
          userId,
          groupId: 'detail-group',
          description: 'group topic desc',
          trigger: 'chat',
          updatedAt: new Date('2024-01-01'),
        });
        await tx.insert(messages).values({
          id: 'detail-group-topic-m0',
          role: 'user',
          content: 'group user message',
          topicId: 'detail-group-topic',
          userId,
        });
      });

      const result = await topicModel.query({
        groupId: 'detail-group',
        withDetails: true,
      });

      const item = result.items[0] as Record<string, unknown>;
      expect(item.firstUserMessage).toBe('group user message');
      expect(item.messageCount).toBe(1);
      expect(item.description).toBe('group topic desc');
      expect(item.trigger).toBe('chat');
    });

    it('measures payload size delta between basic and withDetails queries', async () => {
      // Realistic-ish seed: 20 topics, each with ~5 messages — a first user
      // message big enough to dominate the row (~600 chars), a long-ish
      // description (~200 chars), plus a handful of assistant replies that
      // don't show up in either payload but affect the messageCount subquery.
      const TOPIC_COUNT = 20;
      const MESSAGES_PER_TOPIC = 5;
      const firstUserText = 'u'.repeat(600);
      const descriptionText = 'd'.repeat(200);

      await serverDB.transaction(async (tx) => {
        await tx.insert(agents).values({ id: 'agt-size-bench', userId, title: 'Size Bench' });
        await tx.insert(topics).values(
          Array.from({ length: TOPIC_COUNT }, (_, i) => ({
            id: `size-topic-${i}`,
            userId,
            agentId: 'agt-size-bench',
            description: descriptionText,
            trigger: i % 2 === 0 ? 'chat' : 'cron',
            updatedAt: new Date(`2024-01-${String(i + 1).padStart(2, '0')}`),
          })),
        );

        const messageRows = [] as {
          id: string;
          role: string;
          content: string;
          topicId: string;
          userId: string;
        }[];
        for (let i = 0; i < TOPIC_COUNT; i++) {
          messageRows.push({
            id: `size-topic-${i}-m0`,
            role: 'user',
            content: firstUserText,
            topicId: `size-topic-${i}`,
            userId,
          });
          for (let j = 1; j < MESSAGES_PER_TOPIC; j++) {
            messageRows.push({
              id: `size-topic-${i}-m${j}`,
              role: j % 2 === 1 ? 'assistant' : 'user',
              content: 'short reply',
              topicId: `size-topic-${i}`,
              userId,
            });
          }
        }
        await tx.insert(messages).values(messageRows);
      });

      const basic = await topicModel.query({
        agentId: 'agt-size-bench',
        pageSize: TOPIC_COUNT,
      });
      const detailed = await topicModel.query({
        agentId: 'agt-size-bench',
        pageSize: TOPIC_COUNT,
        withDetails: true,
      });

      const basicBytes = Buffer.byteLength(JSON.stringify(basic.items), 'utf8');
      const detailedBytes = Buffer.byteLength(JSON.stringify(detailed.items), 'utf8');
      const ratio = detailedBytes / basicBytes;

      // Print so the developer running the test gets a real-world number to
      // reason about — the actual size depends on text length seeded above.

      console.log(
        `[topic.query withDetails size] basic=${basicBytes}B  detailed=${detailedBytes}B  ` +
          `ratio=${ratio.toFixed(2)}x  perRowDelta=${Math.round(
            (detailedBytes - basicBytes) / TOPIC_COUNT,
          )}B`,
      );

      // Detailed payload must be strictly larger and roughly proportional to
      // the seeded user-message + description text — guard against the detail
      // columns silently disappearing from the SELECT shape.
      expect(detailedBytes).toBeGreaterThan(basicBytes);
      expect(ratio).toBeGreaterThan(1.5);
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

    it('should adopt only agentId and fully-orphan topics, not session-linked ones, when isInbox is true', async () => {
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

      // `legacy-session-topic` is no longer adopted via the agentsToSessions
      // lookup; only the agentId match and the fully-orphan fallback remain.
      expect(result.items).toHaveLength(2);
      expect(result.items.map((t) => t.id).sort()).toEqual([
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

  describe('queryTopics', () => {
    it('should return all topics when no status filter is given', async () => {
      await serverDB.insert(topics).values([
        { id: 'topic1', sessionId, userId },
        { id: 'topic2', sessionId, userId },
      ]);

      const result = await topicModel.queryTopics();

      expect(result).toHaveLength(2);
      expect(result.map((t) => t.id).sort()).toEqual(['topic1', 'topic2']);
    });

    it('should filter by status', async () => {
      await serverDB.insert(topics).values([
        { id: 'running1', sessionId, status: 'running', userId },
        { id: 'done1', sessionId, status: 'completed', userId },
      ]);

      const result = await topicModel.queryTopics({ statuses: ['running'] });

      expect(result.map((t) => t.id)).toEqual(['running1']);
    });

    it('should only return topics owned by the model user', async () => {
      await serverDB.insert(topics).values([
        { id: 'mine-running', sessionId, status: 'running', userId },
        { id: 'mine-done', sessionId, status: 'completed', userId },
        { id: 'others-running', sessionId, status: 'running', userId: userId2 },
      ]);

      const all = await topicModel.queryTopics();
      expect(all.map((t) => t.id).sort()).toEqual(['mine-done', 'mine-running']);

      // a status filter must not leak another user's topics
      const running = await topicModel.queryTopics({ statuses: ['running'] });
      expect(running.map((t) => t.id)).toEqual(['mine-running']);
    });

    it('should not leak workspace topics into the personal scope', async () => {
      await serverDB.insert(workspaces).values({
        id: 'qt-workspace',
        name: 'QT Workspace',
        primaryOwnerId: userId,
        slug: 'qt-workspace',
      });
      await serverDB.insert(sessions).values({
        id: 'qt-workspace-session',
        userId,
        workspaceId: 'qt-workspace',
      });
      await serverDB.insert(topics).values([
        { id: 'qt-personal', sessionId, status: 'running', userId, workspaceId: null },
        {
          id: 'qt-workspace-topic',
          sessionId: 'qt-workspace-session',
          status: 'running',
          userId,
          workspaceId: 'qt-workspace',
        },
      ]);

      // topicModel is scoped to the personal context (no workspaceId)
      const personal = await topicModel.queryTopics({ statuses: ['running'] });
      expect(personal.map((t) => t.id)).toEqual(['qt-personal']);

      // a workspace-scoped model only sees that workspace's topics
      const workspaceScoped = await new TopicModel(serverDB, userId, 'qt-workspace').queryTopics({
        statuses: ['running'],
      });
      expect(workspaceScoped.map((t) => t.id)).toEqual(['qt-workspace-topic']);
    });
  });

  // BM25 search requires pg_search extension (ParadeDB), not available in PGlite
  const isServerDB = process.env.TEST_SERVER_DB === '1';
  describe.skipIf(!isServerDB)('queryByKeyword', () => {
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

    it('should match topics by agentId when the scope provides one (no sessionId)', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(agents).values([{ id: 'search-agent', userId }]);
        await tx.insert(topics).values([
          // New agent system: topic carries agentId but no sessionId.
          { id: 'agent-topic', title: 'Hello world', agentId: 'search-agent', userId },
          { id: 'other-topic', title: 'Hello world', sessionId, userId },
        ]);
      });

      const result = await topicModel.queryByKeyword('hello', { agentId: 'search-agent' });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('agent-topic');
    });

    it('should not fall back to the session when scoped by agentId (stays consistent with the list)', async () => {
      // The agent scope mirrors `query` exactly: it matches by agentId only,
      // with NO sessionId fallback. A legacy row that another agent owns but
      // shares the resolved session must not leak into this agent's search,
      // and un-backfilled rows the list hides must not appear here either.
      await serverDB.transaction(async (tx) => {
        await tx.insert(agents).values([
          { id: 'search-agent', userId },
          { id: 'other-agent', userId },
        ]);
        await tx.insert(topics).values([
          { id: 'agent-topic', title: 'Hello world', agentId: 'search-agent', userId },
          // Same session mapping, but already stamped for a DIFFERENT agent.
          {
            id: 'other-agent-topic',
            title: 'Hello world',
            agentId: 'other-agent',
            sessionId,
            userId,
          },
          // Legacy, un-backfilled (agentId null) — the list doesn't show it either.
          { id: 'legacy-topic', title: 'Hello legacy', sessionId, userId },
        ]);
      });

      const result = await topicModel.queryByKeyword('hello', {
        agentId: 'search-agent',
        containerId: sessionId,
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('agent-topic');
    });

    it('should not leak other agents topics when scoped by agentId', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(agents).values([
          { id: 'search-agent', userId },
          { id: 'other-agent', userId },
        ]);
        await tx.insert(topics).values([
          { id: 'agent-topic', title: 'Hello world', agentId: 'search-agent', userId },
          { id: 'other-agent-topic', title: 'Hello world', agentId: 'other-agent', userId },
        ]);
      });

      const result = await topicModel.queryByKeyword('hello', { agentId: 'search-agent' });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('agent-topic');
    });
  });

  describe('queryRecent', () => {
    it('should return recent topics with agentId', async () => {
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

    it('should order recent topics by latest message activity', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(agents).values([{ id: 'activity-agent', userId, title: 'Activity Agent' }]);
        await tx.insert(topics).values([
          {
            agentId: 'activity-agent',
            id: 'activity-topic-old-topic-row',
            title: 'Older topic row',
            updatedAt: new Date('2023-01-01'),
            userId,
          },
          {
            agentId: 'activity-agent',
            id: 'activity-topic-new-topic-row',
            title: 'Newer topic row',
            updatedAt: new Date('2023-05-01'),
            userId,
          },
        ]);
        await tx.insert(messages).values({
          id: 'activity-topic-latest-message',
          role: 'user',
          topicId: 'activity-topic-old-topic-row',
          updatedAt: new Date('2023-06-01'),
          userId,
        });
      });

      const result = await topicModel.queryRecent();

      expect(result.map((topic) => topic.id)).toEqual([
        'activity-topic-old-topic-row',
        'activity-topic-new-topic-row',
      ]);
      expect(result[0].updatedAt.toISOString()).toBe('2023-06-01T00:00:00.000Z');
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
          { id: 'inbox-agent', userId, title: 'Lobe AI', slug: 'inbox', virtual: true },
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
          { id: 'inbox-agent', userId, title: 'Lobe AI', slug: 'inbox', virtual: true },
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

  describe('getCronTopicsGroupedByCronJob', () => {
    it('should return cron topics grouped by cronJobId', async () => {
      const agentId = 'cron-agent';
      await serverDB.insert(agents).values({ id: agentId, userId });
      const [session] = await serverDB
        .insert(sessions)
        .values({ userId, type: 'agent' })
        .returning();
      await serverDB.insert(agentsToSessions).values({ agentId, sessionId: session.id, userId });

      await serverDB.insert(topics).values([
        {
          id: 'cron-topic-1',
          userId,
          sessionId: session.id,
          agentId,
          trigger: 'cron',
          title: 'Cron Topic 1',
          metadata: { cronJobId: 'job-a' },
        },
        {
          id: 'cron-topic-2',
          userId,
          sessionId: session.id,
          agentId,
          trigger: 'cron',
          title: 'Cron Topic 2',
          metadata: { cronJobId: 'job-a' },
        },
        {
          id: 'cron-topic-3',
          userId,
          sessionId: session.id,
          agentId,
          trigger: 'cron',
          title: 'Cron Topic 3',
          metadata: { cronJobId: 'job-b' },
        },
      ]);

      const result = await topicModel.getCronTopicsGroupedByCronJob(agentId);

      expect(result).toHaveLength(2);
      const jobA = result.find((g) => g.cronJobId === 'job-a');
      const jobB = result.find((g) => g.cronJobId === 'job-b');
      expect(jobA?.topics).toHaveLength(2);
      expect(jobB?.topics).toHaveLength(1);
    });

    it('should return empty array when no cron topics exist', async () => {
      const agentId = 'no-cron-agent';
      await serverDB.insert(agents).values({ id: agentId, userId });

      const result = await topicModel.getCronTopicsGroupedByCronJob(agentId);
      expect(result).toEqual([]);
    });

    it('should not return topics without cronJobId in metadata', async () => {
      const agentId = 'cron-agent-no-meta';
      await serverDB.insert(agents).values({ id: agentId, userId });
      const [session] = await serverDB
        .insert(sessions)
        .values({ userId, type: 'agent' })
        .returning();
      await serverDB.insert(agentsToSessions).values({ agentId, sessionId: session.id, userId });

      await serverDB.insert(topics).values({
        id: 'cron-no-meta',
        userId,
        sessionId: session.id,
        agentId,
        trigger: 'cron',
        title: 'No Meta',
        metadata: {},
      });

      const result = await topicModel.getCronTopicsGroupedByCronJob(agentId);
      expect(result).toEqual([]);
    });
  });
});
