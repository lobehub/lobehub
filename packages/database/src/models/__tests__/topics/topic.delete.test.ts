import { eq } from 'drizzle-orm';
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

const userId = 'topic-delete-user';
const userId2 = 'topic-delete-user-2';
const sessionId = 'topic-delete-session';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

describe('TopicModel - Delete', () => {
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

  describe('delete', () => {
    it('should delete a topic and its associated messages', async () => {
      const topicId = 'topic1';
      await serverDB.transaction(async (tx) => {
        await tx.insert(users).values({ id: '345' });
        await tx.insert(sessions).values([
          { id: 'session1', userId },
          { id: 'session2', userId: '345' },
        ]);
        await tx.insert(topics).values([
          { id: topicId, sessionId: 'session1', userId },
          { id: 'topic2', sessionId: 'session2', userId: '345' },
        ]);
        await tx.insert(messages).values([
          { id: 'message1', role: 'user', topicId: topicId, userId },
          { id: 'message2', role: 'assistant', topicId: topicId, userId },
          { id: 'message3', role: 'user', topicId: 'topic2', userId: '345' },
        ]);
      });

      await topicModel.delete(topicId);

      expect(
        await serverDB.select().from(messages).where(eq(messages.topicId, topicId)),
      ).toHaveLength(0);
      expect(await serverDB.select().from(topics)).toHaveLength(1);
      expect(await serverDB.select().from(messages)).toHaveLength(1);
    });
  });

  describe('batchDeleteBySessionId', () => {
    it('should delete all topics associated with a session', async () => {
      await serverDB.insert(sessions).values([
        { id: 'session1', userId },
        { id: 'session2', userId },
      ]);
      await serverDB.insert(topics).values([
        { id: 'topic1', sessionId: 'session1', userId },
        { id: 'topic2', sessionId: 'session1', userId },
        { id: 'topic3', sessionId: 'session2', userId },
        { id: 'topic4', userId },
      ]);

      await topicModel.batchDeleteBySessionId('session1');

      expect(
        await serverDB.select().from(topics).where(eq(topics.sessionId, 'session1')),
      ).toHaveLength(0);
      expect(await serverDB.select().from(topics)).toHaveLength(2);
    });

    it('should delete all topics associated without sessionId', async () => {
      await serverDB.insert(sessions).values([{ id: 'session1', userId }]);
      await serverDB.insert(topics).values([
        { id: 'topic1', sessionId: 'session1', userId },
        { id: 'topic2', sessionId: 'session1', userId },
        { id: 'topic4', userId },
      ]);

      await topicModel.batchDeleteBySessionId();

      expect(
        await serverDB.select().from(topics).where(eq(topics.sessionId, 'session1')),
      ).toHaveLength(2);
      expect(await serverDB.select().from(topics)).toHaveLength(2);
    });
  });

  describe('batchDeleteByGroupId', () => {
    it('should delete all topics associated with a group', async () => {
      await serverDB.insert(chatGroups).values([
        { id: 'group1', userId, title: 'Group 1' },
        { id: 'group2', userId, title: 'Group 2' },
      ]);
      await serverDB.insert(topics).values([
        { id: 'topic1', groupId: 'group1', userId },
        { id: 'topic2', groupId: 'group1', userId },
        { id: 'topic3', groupId: 'group2', userId },
        { id: 'topic4', userId },
      ]);

      await topicModel.batchDeleteByGroupId('group1');

      expect(await serverDB.select().from(topics).where(eq(topics.groupId, 'group1'))).toHaveLength(
        0,
      );
      expect(await serverDB.select().from(topics)).toHaveLength(2);
    });

    it('should delete all topics associated without groupId', async () => {
      await serverDB.insert(chatGroups).values([{ id: 'group1', userId, title: 'Group 1' }]);
      await serverDB.insert(topics).values([
        { id: 'topic1', groupId: 'group1', userId },
        { id: 'topic2', groupId: 'group1', userId },
        { id: 'topic4', userId },
      ]);

      await topicModel.batchDeleteByGroupId();

      expect(await serverDB.select().from(topics).where(eq(topics.groupId, 'group1'))).toHaveLength(
        2,
      );
      expect(await serverDB.select().from(topics)).toHaveLength(2);
    });
  });

  describe('batchDeleteByAgentId', () => {
    it('should delete topics with direct agentId match (new data)', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(agents).values([
          { id: 'delete-agent-1', userId, title: 'Delete Agent 1' },
          { id: 'delete-agent-2', userId, title: 'Delete Agent 2' },
        ]);
        await trx.insert(topics).values([
          { id: 'topic-agent-1', userId, agentId: 'delete-agent-1' },
          { id: 'topic-agent-1-b', userId, agentId: 'delete-agent-1' },
          { id: 'topic-agent-2', userId, agentId: 'delete-agent-2' },
        ]);
      });

      await topicModel.batchDeleteByAgentId('delete-agent-1');

      const remainingTopics = await serverDB.select().from(topics).where(eq(topics.userId, userId));
      expect(remainingTopics).toHaveLength(1);
      expect(remainingTopics[0].id).toBe('topic-agent-2');
    });

    it('should delete legacy topics via sessionId lookup', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([
          { id: 'legacy-session-1', userId },
          { id: 'legacy-session-2', userId },
        ]);
        await trx.insert(agents).values([{ id: 'legacy-agent', userId, title: 'Legacy Agent' }]);
        await trx
          .insert(agentsToSessions)
          .values([{ agentId: 'legacy-agent', sessionId: 'legacy-session-1', userId }]);
        await trx.insert(topics).values([
          { id: 'legacy-topic-1', userId, sessionId: 'legacy-session-1', agentId: null },
          { id: 'legacy-topic-2', userId, sessionId: 'legacy-session-1', agentId: null },
          { id: 'other-session-topic', userId, sessionId: 'legacy-session-2', agentId: null },
        ]);
      });

      await topicModel.batchDeleteByAgentId('legacy-agent');

      const remainingTopics = await serverDB.select().from(topics).where(eq(topics.userId, userId));
      expect(remainingTopics).toHaveLength(1);
      expect(remainingTopics[0].id).toBe('other-session-topic');
    });

    it('should delete both new and legacy topics', async () => {
      await serverDB.transaction(async (trx) => {
        await trx.insert(sessions).values([{ id: 'mixed-del-session', userId }]);
        await trx
          .insert(agents)
          .values([{ id: 'mixed-del-agent', userId, title: 'Mixed Delete Agent' }]);
        await trx
          .insert(agentsToSessions)
          .values([{ agentId: 'mixed-del-agent', sessionId: 'mixed-del-session', userId }]);
        await trx.insert(topics).values([
          { id: 'mixed-legacy', userId, sessionId: 'mixed-del-session', agentId: null },
          { id: 'mixed-new', userId, agentId: 'mixed-del-agent', sessionId: null },
          { id: 'mixed-both', userId, sessionId: 'mixed-del-session', agentId: 'mixed-del-agent' },
        ]);
      });

      await topicModel.batchDeleteByAgentId('mixed-del-agent');

      const remainingTopics = await serverDB.select().from(topics).where(eq(topics.userId, userId));
      expect(remainingTopics).toHaveLength(0);
    });

    it('should not delete topics from other users', async () => {
      const otherUserId = 'other-user-delete-test';

      await serverDB.transaction(async (trx) => {
        await trx.insert(users).values([{ id: otherUserId }]);
        await trx
          .insert(agents)
          .values([{ id: 'shared-delete-agent', userId, title: 'Shared Agent' }]);
        await trx.insert(topics).values([
          { id: 'user-topic-del', userId, agentId: 'shared-delete-agent' },
          { id: 'other-user-topic-del', userId: otherUserId, agentId: 'shared-delete-agent' },
        ]);
      });

      await topicModel.batchDeleteByAgentId('shared-delete-agent');

      const allTopics = await serverDB.select().from(topics);
      expect(allTopics).toHaveLength(1);
      expect(allTopics[0].id).toBe('other-user-topic-del');
    });

    it('should handle agent with no associated session gracefully', async () => {
      await serverDB.transaction(async (trx) => {
        await trx
          .insert(agents)
          .values([{ id: 'no-session-agent', userId, title: 'No Session Agent' }]);
        await trx
          .insert(topics)
          .values([{ id: 'orphan-del-topic', userId, agentId: 'no-session-agent' }]);
      });

      await topicModel.batchDeleteByAgentId('no-session-agent');

      const remainingTopics = await serverDB.select().from(topics).where(eq(topics.userId, userId));
      expect(remainingTopics).toHaveLength(0);
    });

    it('should not delete any topics if agentId does not match', async () => {
      await serverDB.transaction(async (trx) => {
        await trx
          .insert(agents)
          .values([{ id: 'existing-agent', userId, title: 'Existing Agent' }]);
        await trx
          .insert(topics)
          .values([{ id: 'existing-topic', userId, agentId: 'existing-agent' }]);
      });

      await topicModel.batchDeleteByAgentId('non-existent-agent');

      const remainingTopics = await serverDB.select().from(topics).where(eq(topics.userId, userId));
      expect(remainingTopics).toHaveLength(1);
    });

    it('should delete associated messages when topics are deleted', async () => {
      await serverDB.transaction(async (trx) => {
        await trx
          .insert(agents)
          .values([{ id: 'msg-del-agent', userId, title: 'Message Delete Agent' }]);
        await trx
          .insert(topics)
          .values([{ id: 'msg-del-topic', userId, agentId: 'msg-del-agent' }]);
        await trx.insert(messages).values([
          { id: 'msg1', userId, role: 'user', topicId: 'msg-del-topic' },
          { id: 'msg2', userId, role: 'assistant', topicId: 'msg-del-topic' },
        ]);
      });

      await topicModel.batchDeleteByAgentId('msg-del-agent');

      const remainingMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.userId, userId));
      expect(remainingMessages).toHaveLength(0);
    });
  });

  describe('batchDelete', () => {
    it('should delete multiple topics and their associated messages', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(sessions).values({ id: 'session1', userId });
        await tx.insert(topics).values([
          { id: 'topic1', sessionId: 'session1', userId },
          { id: 'topic2', sessionId: 'session1', userId },
          { id: 'topic3', sessionId: 'session1', userId },
        ]);
        await tx.insert(messages).values([
          { id: 'message1', role: 'user', topicId: 'topic1', userId },
          { id: 'message2', role: 'assistant', topicId: 'topic2', userId },
          { id: 'message3', role: 'user', topicId: 'topic3', userId },
        ]);
      });

      await topicModel.batchDelete(['topic1', 'topic2']);

      expect(await serverDB.select().from(topics)).toHaveLength(1);
      expect(await serverDB.select().from(messages)).toHaveLength(1);
    });
  });

  describe('deleteAll', () => {
    it('should delete all topics of the user', async () => {
      await serverDB.insert(users).values({ id: '345' });
      await serverDB.insert(sessions).values([
        { id: 'session1', userId },
        { id: 'session2', userId: '345' },
      ]);
      await serverDB.insert(topics).values([
        { id: 'topic1', sessionId: 'session1', userId },
        { id: 'topic2', sessionId: 'session1', userId },
        { id: 'topic3', sessionId: 'session2', userId: '345' },
      ]);

      await topicModel.deleteAll();

      expect(await serverDB.select().from(topics).where(eq(topics.userId, userId))).toHaveLength(0);
      expect(await serverDB.select().from(topics)).toHaveLength(1);
    });
  });
});
