import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, messages, sessions, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { AgentMigrationRepo } from '../index';

const userId = 'agent-migration-user';
const userId2 = 'agent-migration-user-2';
const sessionId = 'agent-migration-session';
const serverDB: LobeChatDatabase = await getTestDB();
const agentMigrationRepo = new AgentMigrationRepo(serverDB, userId);

describe('AgentMigrationRepo', () => {
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

  describe('migrateAgentId - inbox migration', () => {
    it('should migrate legacy inbox topics and their messages', async () => {
      const agentId = 'inbox-agent-id';
      await serverDB.insert(agents).values({ id: agentId, userId });

      // Create legacy inbox topics
      const originalUpdatedAt = new Date('2024-01-01T00:00:00Z');
      await serverDB.insert(topics).values([
        {
          id: 'inbox-topic-1',
          userId,
          title: 'Legacy inbox topic 1',
          sessionId: null,
          groupId: null,
          agentId: null,
          updatedAt: originalUpdatedAt,
        },
        {
          id: 'inbox-topic-2',
          userId,
          title: 'Legacy inbox topic 2',
          sessionId: null,
          groupId: null,
          agentId: null,
          updatedAt: originalUpdatedAt,
        },
      ]);

      // Create messages associated with these topics
      await serverDB.insert(messages).values([
        { id: 'msg-1', userId, role: 'user', topicId: 'inbox-topic-1', agentId: null },
        { id: 'msg-2', userId, role: 'assistant', topicId: 'inbox-topic-1', agentId: null },
        { id: 'msg-3', userId, role: 'user', topicId: 'inbox-topic-2', agentId: null },
      ]);

      // Create inbox messages without topicId
      await serverDB.insert(messages).values([
        {
          id: 'msg-inbox-no-topic',
          userId,
          role: 'user',
          sessionId: null,
          topicId: null,
          agentId: null,
        },
      ]);

      // Run migration
      await agentMigrationRepo.migrateAgentId({ agentId, isInbox: true });

      // Verify topics are migrated
      const migratedTopics = await serverDB.query.topics.findMany({
        where: eq(topics.userId, userId),
      });

      expect(migratedTopics).toHaveLength(2);
      migratedTopics.forEach((topic) => {
        expect(topic.agentId).toBe(agentId);
        // updatedAt should be preserved
        expect(topic.updatedAt.getTime()).toBe(originalUpdatedAt.getTime());
      });

      // Verify messages are migrated
      const migratedMessages = await serverDB.query.messages.findMany({
        where: eq(messages.userId, userId),
      });

      expect(migratedMessages).toHaveLength(4);
      migratedMessages.forEach((msg) => {
        expect(msg.agentId).toBe(agentId);
      });
    });

    it('should not migrate topics that already have agentId', async () => {
      const agentId = 'inbox-agent-id';
      const existingAgentId = 'existing-agent-id';
      await serverDB.insert(agents).values([
        { id: agentId, userId },
        { id: existingAgentId, userId },
      ]);

      // Create a topic that already has agentId
      await serverDB.insert(topics).values({
        id: 'topic-with-agent',
        userId,
        title: 'Topic with agent',
        agentId: existingAgentId,
      });

      // Run migration
      await agentMigrationRepo.migrateAgentId({ agentId, isInbox: true });

      // Verify topic was not changed
      const topic = await serverDB.query.topics.findFirst({
        where: eq(topics.id, 'topic-with-agent'),
      });

      expect(topic?.agentId).toBe(existingAgentId);
    });

    it('should not migrate messages that already have agentId', async () => {
      const agentId = 'inbox-agent-id';
      const existingAgentId = 'existing-agent-id';
      await serverDB.insert(agents).values([
        { id: agentId, userId },
        { id: existingAgentId, userId },
      ]);

      // Create legacy inbox topic
      await serverDB.insert(topics).values({
        id: 'inbox-topic',
        userId,
        sessionId: null,
        groupId: null,
        agentId: null,
      });

      // Create messages - one with agentId, one without
      await serverDB.insert(messages).values([
        {
          id: 'msg-with-agent',
          userId,
          role: 'user',
          topicId: 'inbox-topic',
          agentId: existingAgentId,
        },
        { id: 'msg-without-agent', userId, role: 'user', topicId: 'inbox-topic', agentId: null },
      ]);

      // Run migration
      await agentMigrationRepo.migrateAgentId({ agentId, isInbox: true });

      // Verify message with agentId was not changed
      const msgWithAgent = await serverDB.query.messages.findFirst({
        where: eq(messages.id, 'msg-with-agent'),
      });
      expect(msgWithAgent?.agentId).toBe(existingAgentId);

      // Verify message without agentId was migrated
      const msgWithoutAgent = await serverDB.query.messages.findFirst({
        where: eq(messages.id, 'msg-without-agent'),
      });
      expect(msgWithoutAgent?.agentId).toBe(agentId);
    });

    it('should not migrate other user topics or messages', async () => {
      const agentId = 'inbox-agent-id';
      await serverDB.insert(agents).values({ id: agentId, userId });

      // Create legacy inbox topic for user2
      await serverDB.insert(topics).values({
        id: 'user2-topic',
        userId: userId2,
        title: 'User2 legacy inbox topic',
        sessionId: null,
        groupId: null,
        agentId: null,
      });

      // Create message for user2
      await serverDB.insert(messages).values({
        id: 'user2-msg',
        userId: userId2,
        role: 'user',
        topicId: 'user2-topic',
        agentId: null,
      });

      // Run migration for user1
      await agentMigrationRepo.migrateAgentId({ agentId, isInbox: true });

      // Verify user2's topic was not migrated
      const topic = await serverDB.query.topics.findFirst({
        where: eq(topics.id, 'user2-topic'),
      });
      expect(topic?.agentId).toBeNull();

      // Verify user2's message was not migrated
      const msg = await serverDB.query.messages.findFirst({
        where: eq(messages.id, 'user2-msg'),
      });
      expect(msg?.agentId).toBeNull();
    });

    it('should migrate both orphan and sessionId-based legacy data when isInbox with sessionId', async () => {
      const agentId = 'inbox-combined-agent';
      const inboxSessionId = 'inbox-combined-session';
      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB.insert(sessions).values({ id: inboxSessionId, userId, slug: 'inbox' });

      // Create orphan legacy inbox topics (sessionId IS NULL, groupId IS NULL, agentId IS NULL)
      await serverDB.insert(topics).values([
        {
          id: 'orphan-inbox-topic-1',
          userId,
          title: 'Orphan inbox topic 1',
          sessionId: null,
          groupId: null,
          agentId: null,
        },
        {
          id: 'orphan-inbox-topic-2',
          userId,
          title: 'Orphan inbox topic 2',
          sessionId: null,
          groupId: null,
          agentId: null,
        },
      ]);

      // Create sessionId-based legacy topics (has sessionId but no agentId)
      await serverDB.insert(topics).values([
        {
          id: 'session-based-topic-1',
          userId,
          title: 'Session-based topic 1',
          sessionId: inboxSessionId,
          groupId: null,
          agentId: null,
        },
        {
          id: 'session-based-topic-2',
          userId,
          title: 'Session-based topic 2',
          sessionId: inboxSessionId,
          groupId: null,
          agentId: null,
        },
      ]);

      // Create messages for orphan topics
      await serverDB.insert(messages).values([
        {
          id: 'orphan-msg-1',
          userId,
          role: 'user',
          topicId: 'orphan-inbox-topic-1',
          sessionId: null,
          agentId: null,
        },
        {
          id: 'orphan-msg-no-topic',
          userId,
          role: 'user',
          sessionId: null,
          topicId: null,
          agentId: null,
        },
      ]);

      // Create messages for session-based topics
      await serverDB.insert(messages).values([
        {
          id: 'session-based-msg-1',
          userId,
          role: 'user',
          topicId: 'session-based-topic-1',
          sessionId: null,
          agentId: null,
        },
        {
          id: 'session-msg-no-topic',
          userId,
          role: 'user',
          sessionId: inboxSessionId,
          topicId: null,
          agentId: null,
        },
      ]);

      // Run migration with isInbox and sessionId
      await agentMigrationRepo.migrateAgentId({
        agentId,
        isInbox: true,
        sessionId: inboxSessionId,
      });

      // Verify all orphan topics are migrated
      const orphanTopics = await serverDB.query.topics.findMany({
        where: inArray(topics.id, ['orphan-inbox-topic-1', 'orphan-inbox-topic-2']),
      });
      expect(orphanTopics).toHaveLength(2);
      orphanTopics.forEach((topic) => {
        expect(topic.agentId).toBe(agentId);
      });

      // Verify all session-based topics are migrated
      const sessionBasedTopics = await serverDB.query.topics.findMany({
        where: inArray(topics.id, ['session-based-topic-1', 'session-based-topic-2']),
      });
      expect(sessionBasedTopics).toHaveLength(2);
      sessionBasedTopics.forEach((topic) => {
        expect(topic.agentId).toBe(agentId);
      });

      // Verify all messages are migrated
      const allMessages = await serverDB.query.messages.findMany({
        where: inArray(messages.id, [
          'orphan-msg-1',
          'orphan-msg-no-topic',
          'session-based-msg-1',
          'session-msg-no-topic',
        ]),
      });
      expect(allMessages).toHaveLength(4);
      allMessages.forEach((msg) => {
        expect(msg.agentId).toBe(agentId);
      });
    });

    it('should preserve messages updatedAt during inbox migration', async () => {
      const agentId = 'inbox-agent-preserve-time';
      await serverDB.insert(agents).values({ id: agentId, userId });

      // Create legacy inbox topic
      const originalTopicUpdatedAt = new Date('2024-01-15T10:00:00Z');
      await serverDB.insert(topics).values({
        id: 'inbox-topic-preserve',
        userId,
        sessionId: null,
        groupId: null,
        agentId: null,
        updatedAt: originalTopicUpdatedAt,
      });

      // Create messages with specific updatedAt
      const originalMsgUpdatedAt1 = new Date('2024-02-20T14:30:00Z');
      const originalMsgUpdatedAt2 = new Date('2024-03-10T09:15:00Z');
      const originalMsgUpdatedAtNoTopic = new Date('2024-04-05T16:45:00Z');

      await serverDB.insert(messages).values([
        {
          id: 'msg-preserve-1',
          userId,
          role: 'user',
          topicId: 'inbox-topic-preserve',
          agentId: null,
          updatedAt: originalMsgUpdatedAt1,
        },
        {
          id: 'msg-preserve-2',
          userId,
          role: 'assistant',
          topicId: 'inbox-topic-preserve',
          agentId: null,
          updatedAt: originalMsgUpdatedAt2,
        },
        {
          id: 'msg-preserve-no-topic',
          userId,
          role: 'user',
          sessionId: null,
          topicId: null,
          agentId: null,
          updatedAt: originalMsgUpdatedAtNoTopic,
        },
      ]);

      // Run migration
      await agentMigrationRepo.migrateAgentId({ agentId, isInbox: true });

      // Verify topic updatedAt is preserved
      const migratedTopic = await serverDB.query.topics.findFirst({
        where: eq(topics.id, 'inbox-topic-preserve'),
      });
      expect(migratedTopic?.agentId).toBe(agentId);
      expect(migratedTopic?.updatedAt.getTime()).toBe(originalTopicUpdatedAt.getTime());

      // Verify messages updatedAt are preserved
      const msg1 = await serverDB.query.messages.findFirst({
        where: eq(messages.id, 'msg-preserve-1'),
      });
      expect(msg1?.agentId).toBe(agentId);
      expect(msg1?.updatedAt.getTime()).toBe(originalMsgUpdatedAt1.getTime());

      const msg2 = await serverDB.query.messages.findFirst({
        where: eq(messages.id, 'msg-preserve-2'),
      });
      expect(msg2?.agentId).toBe(agentId);
      expect(msg2?.updatedAt.getTime()).toBe(originalMsgUpdatedAt2.getTime());

      const msgNoTopic = await serverDB.query.messages.findFirst({
        where: eq(messages.id, 'msg-preserve-no-topic'),
      });
      expect(msgNoTopic?.agentId).toBe(agentId);
      expect(msgNoTopic?.updatedAt.getTime()).toBe(originalMsgUpdatedAtNoTopic.getTime());
    });
  });

  describe('migrateAgentId - session migration', () => {
    it('should migrate topics and messages by sessionId', async () => {
      const agentId = 'test-agent-id';
      await serverDB.insert(agents).values({ id: agentId, userId });

      // Create legacy topics with sessionId but no agentId
      const originalUpdatedAt = new Date('2024-06-15T12:00:00Z');
      await serverDB.insert(topics).values([
        {
          id: 'session-topic-1',
          userId,
          title: 'Legacy session topic 1',
          sessionId,
          agentId: null,
          updatedAt: originalUpdatedAt,
        },
        {
          id: 'session-topic-2',
          userId,
          title: 'Legacy session topic 2',
          sessionId,
          agentId: null,
          updatedAt: originalUpdatedAt,
        },
      ]);

      // Create messages within these topics
      await serverDB.insert(messages).values([
        { id: 'session-msg-1', userId, role: 'user', topicId: 'session-topic-1', agentId: null },
        {
          id: 'session-msg-2',
          userId,
          role: 'assistant',
          topicId: 'session-topic-2',
          agentId: null,
        },
      ]);

      // Create messages with sessionId but no topicId
      await serverDB.insert(messages).values([
        {
          id: 'session-msg-no-topic',
          userId,
          role: 'user',
          sessionId,
          topicId: null,
          agentId: null,
        },
      ]);

      // Run migration
      await agentMigrationRepo.migrateAgentId({ agentId, sessionId });

      // Verify topics are migrated
      const migratedTopics = await serverDB.query.topics.findMany({
        where: eq(topics.sessionId, sessionId),
      });

      expect(migratedTopics).toHaveLength(2);
      migratedTopics.forEach((topic) => {
        expect(topic.agentId).toBe(agentId);
        // updatedAt should be preserved
        expect(topic.updatedAt.getTime()).toBe(originalUpdatedAt.getTime());
      });

      // Verify all messages are migrated
      const migratedMessages = await serverDB
        .select()
        .from(messages)
        .where(inArray(messages.id, ['session-msg-1', 'session-msg-2', 'session-msg-no-topic']));

      expect(migratedMessages).toHaveLength(3);
      migratedMessages.forEach((msg) => {
        expect(msg.agentId).toBe(agentId);
      });
    });

    it('should not migrate topics from different session', async () => {
      const agentId = 'test-agent-id';
      const otherSessionId = 'other-session-id';
      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB.insert(sessions).values({ id: otherSessionId, userId });

      // Create topic for different session
      await serverDB.insert(topics).values({
        id: 'other-session-topic',
        userId,
        title: 'Other session topic',
        sessionId: otherSessionId,
        agentId: null,
      });

      // Create message for different session
      await serverDB.insert(messages).values({
        id: 'other-session-msg',
        userId,
        role: 'user',
        sessionId: otherSessionId,
        agentId: null,
      });

      // Run migration for sessionId
      await agentMigrationRepo.migrateAgentId({ agentId, sessionId });

      // Verify other session's topic was not migrated
      const topic = await serverDB.query.topics.findFirst({
        where: eq(topics.id, 'other-session-topic'),
      });
      expect(topic?.agentId).toBeNull();

      // Verify other session's message was not migrated
      const msg = await serverDB.query.messages.findFirst({
        where: eq(messages.id, 'other-session-msg'),
      });
      expect(msg?.agentId).toBeNull();
    });

    it('should not migrate topics or messages that already have agentId', async () => {
      const agentId = 'test-agent-id';
      const existingAgentId = 'existing-agent-id';
      await serverDB.insert(agents).values([
        { id: agentId, userId },
        { id: existingAgentId, userId },
      ]);

      // Create topic that already has agentId
      await serverDB.insert(topics).values({
        id: 'topic-with-agent',
        userId,
        title: 'Topic with existing agent',
        sessionId,
        agentId: existingAgentId,
      });

      // Create message that already has agentId
      await serverDB.insert(messages).values({
        id: 'msg-with-agent',
        userId,
        role: 'user',
        sessionId,
        agentId: existingAgentId,
      });

      // Run migration
      await agentMigrationRepo.migrateAgentId({ agentId, sessionId });

      // Verify topic was not changed
      const topic = await serverDB.query.topics.findFirst({
        where: eq(topics.id, 'topic-with-agent'),
      });
      expect(topic?.agentId).toBe(existingAgentId);

      // Verify message was not changed
      const msg = await serverDB.query.messages.findFirst({
        where: eq(messages.id, 'msg-with-agent'),
      });
      expect(msg?.agentId).toBe(existingAgentId);
    });

    it('should not migrate other user topics or messages', async () => {
      const agentId = 'test-agent-id';
      const user2SessionId = 'user2-session-id';
      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB.insert(sessions).values({ id: user2SessionId, userId: userId2 });

      // Create topic for user2
      await serverDB.insert(topics).values({
        id: 'user2-session-topic',
        userId: userId2,
        title: 'User2 session topic',
        sessionId: user2SessionId,
        agentId: null,
      });

      // Create message for user2
      await serverDB.insert(messages).values({
        id: 'user2-session-msg',
        userId: userId2,
        role: 'user',
        sessionId: user2SessionId,
        agentId: null,
      });

      // Run migration for user1
      await agentMigrationRepo.migrateAgentId({ agentId, sessionId: user2SessionId });

      // Verify user2's topic was not migrated
      const topic = await serverDB.query.topics.findFirst({
        where: eq(topics.id, 'user2-session-topic'),
      });
      expect(topic?.agentId).toBeNull();

      // Verify user2's message was not migrated
      const msg = await serverDB.query.messages.findFirst({
        where: eq(messages.id, 'user2-session-msg'),
      });
      expect(msg?.agentId).toBeNull();
    });

    it('should preserve messages updatedAt during session migration', async () => {
      const agentId = 'session-agent-preserve-time';
      await serverDB.insert(agents).values({ id: agentId, userId });

      // Create legacy session topic
      const originalTopicUpdatedAt = new Date('2024-05-20T08:00:00Z');
      await serverDB.insert(topics).values({
        id: 'session-topic-preserve',
        userId,
        sessionId,
        agentId: null,
        updatedAt: originalTopicUpdatedAt,
      });

      // Create messages with specific updatedAt
      const originalMsgUpdatedAt1 = new Date('2024-06-15T11:30:00Z');
      const originalMsgUpdatedAt2 = new Date('2024-07-01T15:45:00Z');
      const originalMsgUpdatedAtNoTopic = new Date('2024-08-10T09:00:00Z');

      await serverDB.insert(messages).values([
        {
          id: 'session-msg-preserve-1',
          userId,
          role: 'user',
          topicId: 'session-topic-preserve',
          agentId: null,
          updatedAt: originalMsgUpdatedAt1,
        },
        {
          id: 'session-msg-preserve-2',
          userId,
          role: 'assistant',
          topicId: 'session-topic-preserve',
          agentId: null,
          updatedAt: originalMsgUpdatedAt2,
        },
        {
          id: 'session-msg-preserve-no-topic',
          userId,
          role: 'user',
          sessionId,
          topicId: null,
          agentId: null,
          updatedAt: originalMsgUpdatedAtNoTopic,
        },
      ]);

      // Run migration
      await agentMigrationRepo.migrateAgentId({ agentId, sessionId });

      // Verify topic updatedAt is preserved
      const migratedTopic = await serverDB.query.topics.findFirst({
        where: eq(topics.id, 'session-topic-preserve'),
      });
      expect(migratedTopic?.agentId).toBe(agentId);
      expect(migratedTopic?.updatedAt.getTime()).toBe(originalTopicUpdatedAt.getTime());

      // Verify messages updatedAt are preserved
      const msg1 = await serverDB.query.messages.findFirst({
        where: eq(messages.id, 'session-msg-preserve-1'),
      });
      expect(msg1?.agentId).toBe(agentId);
      expect(msg1?.updatedAt.getTime()).toBe(originalMsgUpdatedAt1.getTime());

      const msg2 = await serverDB.query.messages.findFirst({
        where: eq(messages.id, 'session-msg-preserve-2'),
      });
      expect(msg2?.agentId).toBe(agentId);
      expect(msg2?.updatedAt.getTime()).toBe(originalMsgUpdatedAt2.getTime());

      const msgNoTopic = await serverDB.query.messages.findFirst({
        where: eq(messages.id, 'session-msg-preserve-no-topic'),
      });
      expect(msgNoTopic?.agentId).toBe(agentId);
      expect(msgNoTopic?.updatedAt.getTime()).toBe(originalMsgUpdatedAtNoTopic.getTime());
    });
  });

  describe('migrateAgentId - transaction integrity', () => {
    it('should migrate topics and messages atomically', async () => {
      const agentId = 'atomic-agent-id';
      await serverDB.insert(agents).values({ id: agentId, userId });

      // Create legacy topics and messages
      await serverDB.insert(topics).values([
        { id: 'atomic-topic-1', userId, sessionId: null, groupId: null, agentId: null },
        { id: 'atomic-topic-2', userId, sessionId: null, groupId: null, agentId: null },
      ]);

      await serverDB.insert(messages).values([
        { id: 'atomic-msg-1', userId, role: 'user', topicId: 'atomic-topic-1', agentId: null },
        { id: 'atomic-msg-2', userId, role: 'user', topicId: 'atomic-topic-2', agentId: null },
      ]);

      // Run migration
      await agentMigrationRepo.migrateAgentId({ agentId, isInbox: true });

      // Verify all topics and messages are migrated together
      const migratedTopics = await serverDB.query.topics.findMany({
        where: eq(topics.userId, userId),
      });
      const migratedMessages = await serverDB.query.messages.findMany({
        where: eq(messages.userId, userId),
      });

      expect(migratedTopics.every((t) => t.agentId === agentId)).toBe(true);
      expect(migratedMessages.every((m) => m.agentId === agentId)).toBe(true);
    });
  });

  describe('getSessionIdByAgentId', () => {
    it('should return sessionId for an agent', async () => {
      const agentId = 'lookup-agent-id';
      const lookupSessionId = 'lookup-session-id';

      await serverDB.insert(agents).values({ id: agentId, userId });
      await serverDB.insert(sessions).values({ id: lookupSessionId, userId });

      // Import agentsToSessions schema
      const { agentsToSessions } = await import('../../../schemas');
      await serverDB.insert(agentsToSessions).values({
        agentId,
        sessionId: lookupSessionId,
        userId,
      });

      const result = await agentMigrationRepo.getSessionIdByAgentId(agentId);

      expect(result).toBe(lookupSessionId);
    });

    it('should return null for agent without session', async () => {
      const agentId = 'no-session-agent';
      await serverDB.insert(agents).values({ id: agentId, userId });

      const result = await agentMigrationRepo.getSessionIdByAgentId(agentId);

      expect(result).toBeNull();
    });

    it('should return null for non-existent agent', async () => {
      const result = await agentMigrationRepo.getSessionIdByAgentId('non-existent-agent');

      expect(result).toBeNull();
    });
  });
});
