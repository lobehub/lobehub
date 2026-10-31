import { asc, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import type { CreateTopicParams } from '../../../models/topic';
import { TopicModel } from '../../../models/topic';
import {
  agents,
  chatGroups,
  messages,
  sessions,
  topics,
  users,
  workspaces,
} from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicRepository } from '../index';

const userId = 'topic-create-user';
const userId2 = 'topic-create-user-2';
const sessionId = 'topic-create-session';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);
const topicRepo = new TopicRepository(serverDB, userId);

describe('TopicRepository - create', () => {
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

      const createdTopic = await topicRepo.create(topicData, topicId);

      expect(createdTopic).toMatchObject({
        id: topicId,
        title: 'New Topic',
        favorite: true,
        sessionId,
        userId,
        description: null,
        historySummary: null,
        metadata: null,
        groupId: null,
        clientId: null,
        agentId: null,
        content: null,
        editorData: null,
        trigger: null,
        mode: null,
        status: null,
        completedAt: null,
        totalCost: null,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        cost: null,
        usage: null,
        model: null,
        provider: null,
        senderId: null,
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

    it('should associate workspace messages created by another member', async () => {
      const workspaceId = 'topic-create-workspace';
      const workspaceSessionId = 'topic-create-workspace-session';
      const workspaceTopicRepo = new TopicRepository(serverDB, userId, workspaceId);

      await serverDB.transaction(async (tx) => {
        await tx.insert(workspaces).values({
          id: workspaceId,
          name: 'Topic Create Workspace',
          primaryOwnerId: userId,
          slug: workspaceId,
        });
        await tx.insert(sessions).values({
          id: workspaceSessionId,
          userId,
          workspaceId,
        });
        await tx.insert(messages).values({
          id: 'workspace-message-other-member',
          role: 'user',
          sessionId: workspaceSessionId,
          userId: userId2,
          workspaceId,
        });
      });

      const createdTopic = await workspaceTopicRepo.create(
        {
          messages: ['workspace-message-other-member'],
          sessionId: workspaceSessionId,
          title: 'Workspace Topic',
        },
        'workspace-topic-created',
      );

      const [updatedMessage] = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.id, 'workspace-message-other-member'));

      expect(createdTopic.workspaceId).toBe(workspaceId);
      expect(updatedMessage.topicId).toBe(createdTopic.id);
    });

    it('should create a new topic without associating messages', async () => {
      const topicData = {
        title: 'New Topic',
        favorite: false,
        sessionId,
      };

      const topicId = 'new-topic';

      const timingEvents: string[] = [];
      const createdTopic = await topicRepo.create(topicData, topicId, {
        log: (event) => timingEvents.push(event),
      });

      expect(createdTopic).toMatchObject({
        id: topicId,
        title: 'New Topic',
        favorite: false,
        clientId: null,
        agentId: null,
        content: null,
        description: null,
        editorData: null,
        groupId: null,
        historySummary: null,
        metadata: null,
        trigger: null,
        mode: null,
        status: null,
        completedAt: null,
        totalCost: null,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        cost: null,
        usage: null,
        model: null,
        provider: null,
        senderId: null,
        sessionId,
        userId,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        accessedAt: expect.any(Date),
      });

      const dbTopic = await serverDB.select().from(topics).where(eq(topics.id, topicId));
      expect(dbTopic).toHaveLength(1);
      expect(dbTopic[0]).toEqual(createdTopic);
      expect(timingEvents).toContain('db.topic.create.topics.insert:start');
      expect(timingEvents).not.toContain('db.topic.create.transaction:start');
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

      const createdTopic = await topicRepo.create(topicData, topicId);

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

      const createdTopic = await topicRepo.create(topicData, topicId);

      expect(createdTopic.agentId).toBe('agent-only');
      expect(createdTopic.sessionId).toBeNull();
    });

    it('attaches given messages to the new topic in one transaction', async () => {
      await serverDB.insert(messages).values([
        { content: 'm1', id: 'msg-1', role: 'user', userId },
        { content: 'm2', id: 'msg-2', role: 'assistant', userId },
      ]);

      const topic = await topicRepo.create({ messages: ['msg-1', 'msg-2'], title: 'with msgs' });

      const linked = await serverDB
        .select({ id: messages.id, topicId: messages.topicId })
        .from(messages)
        .where(eq(messages.topicId, topic.id));

      expect(linked.map((m) => m.id).sort()).toEqual(['msg-1', 'msg-2']);
    });

    it('leaves TopicModel.create single-table: re-parenting messages there is refused', async () => {
      await expect(
        topicModel.create({ messages: ['msg-1'], title: 'model only' } as CreateTopicParams),
      ).rejects.toThrow('TopicRepository.create');
      expect(await serverDB.select().from(topics)).toHaveLength(0);
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

      const createdTopics = await topicRepo.batchCreate(topicParams);

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

    it('should batch associate workspace messages created by other members', async () => {
      const workspaceId = 'topic-batch-workspace';
      const workspaceSessionId = 'topic-batch-workspace-session';
      const workspaceTopicRepo = new TopicRepository(serverDB, userId, workspaceId);

      await serverDB.transaction(async (tx) => {
        await tx.insert(workspaces).values({
          id: workspaceId,
          name: 'Topic Batch Workspace',
          primaryOwnerId: userId,
          slug: workspaceId,
        });
        await tx.insert(sessions).values({
          id: workspaceSessionId,
          userId,
          workspaceId,
        });
        await tx.insert(messages).values([
          {
            id: 'workspace-batch-message-1',
            role: 'user',
            sessionId: workspaceSessionId,
            userId: userId2,
            workspaceId,
          },
          {
            id: 'workspace-batch-message-2',
            role: 'assistant',
            sessionId: workspaceSessionId,
            userId,
            workspaceId,
          },
        ]);
      });

      const createdTopics = await workspaceTopicRepo.batchCreate([
        {
          messages: ['workspace-batch-message-1', 'workspace-batch-message-2'],
          sessionId: workspaceSessionId,
          title: 'Workspace Batch Topic',
        },
      ]);

      const updatedMessages = await serverDB
        .select()
        .from(messages)
        .where(inArray(messages.id, ['workspace-batch-message-1', 'workspace-batch-message-2']))
        .orderBy(asc(messages.id));

      expect(createdTopics[0].workspaceId).toBe(workspaceId);
      expect(updatedMessages.map((message) => message.topicId)).toEqual([
        createdTopics[0].id,
        createdTopics[0].id,
      ]);
    });

    it('should generate topic IDs if not provided', async () => {
      const topicParams = [
        { title: 'Topic 1', favorite: true, sessionId },
        { title: 'Topic 2', favorite: false, sessionId },
      ];

      const createdTopics = await topicRepo.batchCreate(topicParams);

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

      const createdTopics = await topicRepo.batchCreate(topicParams);

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

    it('keeps a session topic session-scoped and a group topic group-scoped', async () => {
      await serverDB.insert(agents).values({ id: 'agent-b', userId });
      await serverDB.insert(sessions).values({ id: 'session-x', userId });
      await serverDB.insert(chatGroups).values({ id: 'group-b', userId });

      const created = await topicRepo.batchCreate([
        { agentId: 'agent-b', sessionId: 'session-x', title: 'session topic' },
        { groupId: 'group-b', title: 'group topic' },
      ]);

      const bySession = created.find((t) => t.title === 'session topic')!;
      const byGroup = created.find((t) => t.title === 'group topic')!;

      // sessionId given (no groupId) → sessionId kept, groupId stays null
      expect(bySession.sessionId).toBe('session-x');
      expect(bySession.groupId).toBeNull();

      // groupId given (no sessionId) → groupId kept, sessionId stays null
      expect(byGroup.groupId).toBe('group-b');
      expect(byGroup.sessionId).toBeNull();
    });

    it('drops both owner ids when sessionId and groupId are passed together', async () => {
      await serverDB.insert(sessions).values({ id: 'session-both', userId });
      await serverDB.insert(chatGroups).values({ id: 'group-both', userId });

      // Each field is nulled based on the *other* being present, so passing both
      // detaches the topic from both — callers must pick exactly one.
      const [created] = await topicRepo.batchCreate([
        { groupId: 'group-both', sessionId: 'session-both', title: 'ambiguous' },
      ]);

      expect(created.sessionId).toBeNull();
      expect(created.groupId).toBeNull();
    });
  });
});
