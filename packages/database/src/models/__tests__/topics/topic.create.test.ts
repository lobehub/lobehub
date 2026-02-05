import { asc, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { agents, messagePlugins, messages, sessions, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import type { CreateTopicParams } from '../../topic';
import { TopicModel } from '../../topic';

const userId = 'topic-create-user';
const userId2 = 'topic-create-user-2';
const sessionId = 'topic-create-session';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);

describe('TopicModel - Create', () => {
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

  describe('create', () => {
    it('should create a new topic and associate messages', async () => {
      const topicData = {
        title: 'New Topic',
        favorite: true,
        sessionId,
        messages: ['message1', 'message2'],
      } satisfies CreateTopicParams;

      const topicId = 'new-topic';

      await serverDB.insert(messages).values([
        { id: 'message1', role: 'user', userId, sessionId },
        { id: 'message2', role: 'assistant', userId, sessionId },
        { id: 'message3', role: 'user', userId, sessionId },
      ]);

      const createdTopic = await topicModel.create(topicData, topicId);

      expect(createdTopic).toEqual({
        id: topicId,
        title: 'New Topic',
        favorite: true,
        sessionId,
        userId,
        historySummary: null,
        metadata: null,
        groupId: null,
        clientId: null,
        agentId: null,
        content: null,
        editorData: null,
        trigger: null,
        mode: null,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        accessedAt: expect.any(Date),
      });

      const dbTopic = await serverDB.select().from(topics).where(eq(topics.id, topicId));
      expect(dbTopic).toHaveLength(1);
      expect(dbTopic[0]).toEqual(createdTopic);

      const associatedMessages = await serverDB
        .select()
        .from(messages)
        .where(inArray(messages.id, topicData.messages!));
      expect(associatedMessages).toHaveLength(2);
      expect(associatedMessages.every((msg) => msg.topicId === topicId)).toBe(true);

      const unassociatedMessage = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, 'message3'));
      expect(unassociatedMessage[0].topicId).toBeNull();
    });

    it('should create a new topic without associating messages', async () => {
      const topicData = {
        title: 'New Topic',
        favorite: false,
        sessionId,
      };

      const topicId = 'new-topic';

      const createdTopic = await topicModel.create(topicData, topicId);

      expect(createdTopic).toEqual({
        id: topicId,
        title: 'New Topic',
        favorite: false,
        clientId: null,
        agentId: null,
        content: null,
        editorData: null,
        groupId: null,
        historySummary: null,
        metadata: null,
        trigger: null,
        mode: null,
        sessionId,
        userId,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        accessedAt: expect.any(Date),
      });

      const dbTopic = await serverDB.select().from(topics).where(eq(topics.id, topicId));
      expect(dbTopic).toHaveLength(1);
      expect(dbTopic[0]).toEqual(createdTopic);
    });

    it('should create a new topic with agentId', async () => {
      await serverDB.insert(agents).values({ id: 'agent-for-topic', userId, title: 'Test Agent' });

      const topicData = {
        title: 'Topic with Agent',
        favorite: false,
        sessionId,
        agentId: 'agent-for-topic',
      } satisfies CreateTopicParams;

      const topicId = 'topic-with-agent';

      const createdTopic = await topicModel.create(topicData, topicId);

      expect(createdTopic.id).toBe(topicId);
      expect(createdTopic.title).toBe('Topic with Agent');
      expect(createdTopic.agentId).toBe('agent-for-topic');
      expect(createdTopic.sessionId).toBe(sessionId);

      const dbTopic = await serverDB.select().from(topics).where(eq(topics.id, topicId));
      expect(dbTopic).toHaveLength(1);
      expect(dbTopic[0].agentId).toBe('agent-for-topic');
    });

    it('should create a new topic with only agentId (no sessionId)', async () => {
      await serverDB.insert(agents).values({ id: 'agent-only', userId, title: 'Agent Only' });

      const topicData = {
        title: 'Agent Only Topic',
        favorite: true,
        agentId: 'agent-only',
      } satisfies CreateTopicParams;

      const topicId = 'agent-only-topic';

      const createdTopic = await topicModel.create(topicData, topicId);

      expect(createdTopic.agentId).toBe('agent-only');
      expect(createdTopic.sessionId).toBeNull();
    });
  });

  describe('batchCreate', () => {
    it('should batch create topics and update associated messages', async () => {
      const topicParams = [
        { title: 'Topic 1', favorite: true, sessionId, messages: ['message1', 'message2'] },
        { title: 'Topic 2', favorite: false, sessionId, messages: ['message3'] },
      ];
      await serverDB.insert(messages).values([
        { id: 'message1', role: 'user', userId },
        { id: 'message2', role: 'assistant', userId },
        { id: 'message3', role: 'user', userId },
      ]);

      const createdTopics = await topicModel.batchCreate(topicParams);

      expect(createdTopics).toHaveLength(2);
      expect(createdTopics[0]).toMatchObject({
        title: 'Topic 1',
        favorite: true,
        sessionId,
        userId,
      });
      expect(createdTopics[1]).toMatchObject({
        title: 'Topic 2',
        favorite: false,
        sessionId,
        userId,
      });

      const items = await serverDB.select().from(topics).orderBy(asc(topics.title));
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ title: 'Topic 1', favorite: true, sessionId, userId });
      expect(items[1]).toMatchObject({ title: 'Topic 2', favorite: false, sessionId, userId });

      const updatedMessages = await serverDB.select().from(messages).orderBy(asc(messages.id));
      expect(updatedMessages).toHaveLength(3);
      expect(updatedMessages[0].topicId).toBe(createdTopics[0].id);
      expect(updatedMessages[1].topicId).toBe(createdTopics[0].id);
      expect(updatedMessages[2].topicId).toBe(createdTopics[1].id);
    });

    it('should generate topic IDs if not provided', async () => {
      const topicParams = [
        { title: 'Topic 1', favorite: true, sessionId },
        { title: 'Topic 2', favorite: false, sessionId },
      ];

      const createdTopics = await topicModel.batchCreate(topicParams);

      expect(createdTopics[0].id).toBeDefined();
      expect(createdTopics[1].id).toBeDefined();
      expect(createdTopics[0].id).not.toBe(createdTopics[1].id);
    });

    it('should batch create topics with agentId', async () => {
      await serverDB.insert(agents).values([
        { id: 'batch-agent-1', userId, title: 'Batch Agent 1' },
        { id: 'batch-agent-2', userId, title: 'Batch Agent 2' },
      ]);

      const topicParams = [
        { title: 'Topic with Agent 1', favorite: true, sessionId, agentId: 'batch-agent-1' },
        { title: 'Topic with Agent 2', favorite: false, agentId: 'batch-agent-2' },
      ];

      const createdTopics = await topicModel.batchCreate(topicParams);

      expect(createdTopics).toHaveLength(2);
      expect(createdTopics[0].agentId).toBe('batch-agent-1');
      expect(createdTopics[0].sessionId).toBe(sessionId);
      expect(createdTopics[1].agentId).toBe('batch-agent-2');
      expect(createdTopics[1].sessionId).toBeNull();

      const dbTopics = await serverDB
        .select()
        .from(topics)
        .where(
          inArray(
            topics.id,
            createdTopics.map((t) => t.id),
          ),
        );
      expect(dbTopics).toHaveLength(2);
      expect(dbTopics.find((t) => t.id === createdTopics[0].id)?.agentId).toBe('batch-agent-1');
      expect(dbTopics.find((t) => t.id === createdTopics[1].id)?.agentId).toBe('batch-agent-2');
    });
  });

  describe('duplicate', () => {
    it('should duplicate a topic and its associated messages', async () => {
      const topicId = 'topic-duplicate';
      const newTitle = 'Duplicated Topic';

      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: topicId, sessionId, userId, title: 'Original Topic' });
        await tx.insert(messages).values([
          { id: 'message1', role: 'user', topicId, userId, content: 'User message' },
          { id: 'message2', role: 'assistant', topicId, userId, content: 'Assistant message' },
        ]);
      });

      const { topic: duplicatedTopic, messages: duplicatedMessages } = await topicModel.duplicate(
        topicId,
        newTitle,
      );

      expect(duplicatedTopic.id).not.toBe(topicId);
      expect(duplicatedTopic.title).toBe(newTitle);
      expect(duplicatedTopic.sessionId).toBe(sessionId);
      expect(duplicatedTopic.userId).toBe(userId);

      expect(duplicatedMessages).toHaveLength(2);
      expect(duplicatedMessages[0].id).not.toBe('message1');
      expect(duplicatedMessages[0].topicId).toBe(duplicatedTopic.id);
      expect(duplicatedMessages[0].content).toBe('User message');
      expect(duplicatedMessages[1].id).not.toBe('message2');
      expect(duplicatedMessages[1].topicId).toBe(duplicatedTopic.id);
      expect(duplicatedMessages[1].content).toBe('Assistant message');
    });

    it('should correctly map parentId references when duplicating messages', async () => {
      const topicId = 'topic-with-parent-refs';

      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: topicId, sessionId, userId, title: 'Original Topic' });
        await tx.insert(messages).values([
          { id: 'msg1', role: 'user', topicId, userId, content: 'First message', parentId: null },
          {
            id: 'msg2',
            role: 'assistant',
            topicId,
            userId,
            content: 'Reply to first',
            parentId: 'msg1',
          },
          {
            id: 'msg3',
            role: 'tool',
            topicId,
            userId,
            content: 'Tool response',
            parentId: 'msg2',
          },
          {
            id: 'msg4',
            role: 'assistant',
            topicId,
            userId,
            content: 'Final message',
            parentId: 'msg3',
          },
        ]);
      });

      const { topic: duplicatedTopic, messages: duplicatedMessages } = await topicModel.duplicate(
        topicId,
        'Duplicated Topic',
      );

      expect(duplicatedMessages).toHaveLength(4);

      const msgMap = new Map(duplicatedMessages.map((m) => [m.content, m]));
      const newMsg1 = msgMap.get('First message')!;
      const newMsg2 = msgMap.get('Reply to first')!;
      const newMsg3 = msgMap.get('Tool response')!;
      const newMsg4 = msgMap.get('Final message')!;

      expect(newMsg1.parentId).toBeNull();
      expect(newMsg2.parentId).toBe(newMsg1.id);
      expect(newMsg3.parentId).toBe(newMsg2.id);
      expect(newMsg4.parentId).toBe(newMsg3.id);

      expect(newMsg1.id).not.toBe('msg1');
      expect(newMsg2.id).not.toBe('msg2');
      expect(newMsg3.id).not.toBe('msg3');
      expect(newMsg4.id).not.toBe('msg4');
    });

    it('should correctly map tool_call_id when duplicating messages with tools', async () => {
      const topicId = 'topic-with-tools';
      const originalToolId = 'toolu_original_123';

      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: topicId, sessionId, userId, title: 'Original Topic' });

        // Insert assistant message with tools
        await tx.insert(messages).values({
          id: 'msg1',
          role: 'assistant',
          topicId,
          userId,
          content: 'Using tool',
          parentId: null,
          tools: [{ id: originalToolId, type: 'builtin', apiName: 'broadcast' }],
        });

        // Insert tool message
        await tx.insert(messages).values({
          id: 'msg2',
          role: 'tool',
          topicId,
          userId,
          content: 'Tool response',
          parentId: 'msg1',
        });

        // Insert messagePlugins entry
        await tx.insert(messagePlugins).values({
          id: 'msg2',
          userId,
          toolCallId: originalToolId,
          apiName: 'broadcast',
        });
      });

      const { topic: duplicatedTopic, messages: duplicatedMessages } = await topicModel.duplicate(
        topicId,
        'Duplicated Topic',
      );

      expect(duplicatedMessages).toHaveLength(2);

      const msgMap = new Map(duplicatedMessages.map((m) => [m.role, m]));
      const newAssistant = msgMap.get('assistant')!;
      const newTool = msgMap.get('tool')!;

      // Check that tools array has new IDs
      expect(newAssistant.tools).toBeDefined();
      const newTools = newAssistant.tools as any[];
      expect(newTools).toHaveLength(1);
      expect(newTools[0].id).not.toBe(originalToolId);
      expect(newTools[0].id).toMatch(/^toolu_/);

      // Check that messagePlugins was copied with new toolCallId
      const newPlugin = await serverDB.query.messagePlugins.findFirst({
        where: eq(messagePlugins.id, newTool.id),
      });

      expect(newPlugin).toBeDefined();
      expect(newPlugin!.toolCallId).toBe(newTools[0].id);
      expect(newPlugin!.toolCallId).not.toBe(originalToolId);
    });

    it('should throw an error if the topic to duplicate does not exist', async () => {
      const topicId = 'nonexistent-topic';

      await expect(topicModel.duplicate(topicId)).rejects.toThrow(
        `Topic with id ${topicId} not found`,
      );
    });
  });
});
