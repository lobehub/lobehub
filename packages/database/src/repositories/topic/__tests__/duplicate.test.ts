import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { TopicModel } from '../../../models/topic';
import { messagePlugins, messages, sessions, topics, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { TopicRepository } from '../index';

const userId = 'topic-duplicate-user';
const userId2 = 'topic-duplicate-user-2';
const sessionId = 'topic-create-session';
const serverDB: LobeChatDatabase = await getTestDB();
const topicModel = new TopicModel(serverDB, userId);
const topicRepo = new TopicRepository(serverDB, userId);

describe('TopicRepository - duplicate', () => {
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

  describe('duplicate', () => {
    it('should duplicate a topic and its associated messages', async () => {
      const topicId = 'topic-duplicate';
      const newTitle = 'Duplicated Topic';

      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: topicId, sessionId, userId, title: 'Original Topic' });
        // Distinct createdAt so `duplicate`'s `orderBy(createdAt)` is
        // deterministic — inserting both in one tx would otherwise give them the
        // same `now()` default, leaving the tied rows in arbitrary order.
        await tx.insert(messages).values([
          {
            id: 'message1',
            role: 'user',
            topicId,
            userId,
            content: 'User message',
            createdAt: new Date('2024-01-01T00:00:00Z'),
          },
          {
            id: 'message2',
            role: 'assistant',
            topicId,
            userId,
            content: 'Assistant message',
            createdAt: new Date('2024-01-01T00:00:01Z'),
          },
        ]);
      });

      const { topic: duplicatedTopic, messages: duplicatedMessages } = await topicRepo.duplicate(
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

    it('should duplicate workspace messages created by other members', async () => {
      const workspaceId = 'topic-duplicate-workspace';
      const topicId = 'workspace-topic-duplicate';
      const workspaceTopicRepo = new TopicRepository(serverDB, userId, workspaceId);

      await serverDB.transaction(async (tx) => {
        await tx.insert(workspaces).values({
          id: workspaceId,
          name: 'Topic Duplicate Workspace',
          primaryOwnerId: userId,
          slug: workspaceId,
        });
        await tx.insert(topics).values({
          id: topicId,
          title: 'Workspace Original Topic',
          userId: userId2,
          workspaceId,
        });
        await tx.insert(messages).values([
          {
            content: 'Other member user message',
            id: 'workspace-duplicate-message-1',
            role: 'user',
            topicId,
            userId: userId2,
            workspaceId,
          },
          {
            content: 'Current member assistant message',
            id: 'workspace-duplicate-message-2',
            role: 'assistant',
            topicId,
            userId,
            workspaceId,
          },
        ]);
      });

      const { topic: duplicatedTopic, messages: duplicatedMessages } =
        await workspaceTopicRepo.duplicate(topicId, 'Workspace Duplicated Topic');

      expect(duplicatedTopic.workspaceId).toBe(workspaceId);
      expect(duplicatedMessages).toHaveLength(2);
      expect(duplicatedMessages.map((message) => message.content).sort()).toEqual([
        'Current member assistant message',
        'Other member user message',
      ]);
      expect(duplicatedMessages.every((message) => message.workspaceId === workspaceId)).toBe(true);
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

      const { messages: duplicatedMessages } = await topicRepo.duplicate(
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

    /**
     * Regression: messages were copied in `createdAt` order alone, so a reply
     * timestamped no later than its parent — rows written by one insert share a
     * timestamp, and imported or clock-skewed rows can run backwards — could be
     * inserted before its parent and break the parent foreign key.
     */
    it('copies a parent before its reply even when the reply is timestamped earlier', async () => {
      const topicId = 'topic-with-skewed-times';
      const later = new Date('2026-01-01T00:00:10.000Z');
      const earlier = new Date('2026-01-01T00:00:00.000Z');

      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: topicId, sessionId, userId, title: 'Original Topic' });
        await tx.insert(messages).values({
          content: 'Parent',
          createdAt: later,
          id: 'skew-parent',
          role: 'user',
          topicId,
          userId,
        });
        await tx.insert(messages).values({
          content: 'Reply',
          createdAt: earlier,
          id: 'skew-reply',
          parentId: 'skew-parent',
          role: 'assistant',
          topicId,
          userId,
        });
      });

      const { messages: duplicated } = await topicRepo.duplicate(topicId, 'Duplicated Topic');

      const byContent = new Map(duplicated.map((message) => [message.content, message]));
      expect(byContent.get('Parent')!.parentId).toBeNull();
      expect(byContent.get('Reply')!.parentId).toBe(byContent.get('Parent')!.id);
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

      const { messages: duplicatedMessages } = await topicRepo.duplicate(
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

      await expect(topicRepo.duplicate(topicId)).rejects.toThrow(
        `Topic with id ${topicId} not found`,
      );
    });

    it('should duplicate a topic with no messages (empty messageIds)', async () => {
      const topicId = 'topic-no-messages';

      await serverDB
        .insert(topics)
        .values({ id: topicId, sessionId, userId, title: 'Empty Topic' });

      const { topic: duplicated, messages: duplicatedMessages } = await topicRepo.duplicate(
        topicId,
        'Duplicated Empty',
      );

      expect(duplicated.id).not.toBe(topicId);
      expect(duplicated.title).toBe('Duplicated Empty');
      expect(duplicatedMessages).toHaveLength(0);
    });
  });

  describe('duplicate', () => {
    it('copies the topic and its messages under a new id', async () => {
      const topic = await topicModel.create({ title: 'original' });
      await serverDB.insert(messages).values([
        { content: 'hi', id: 'dup-m1', role: 'user', topicId: topic.id, userId },
        { content: 'yo', id: 'dup-m2', role: 'assistant', topicId: topic.id, userId },
      ]);

      const { topic: cloned, messages: clonedMessages } = await topicRepo.duplicate(
        topic.id,
        'copy',
      );

      expect(cloned.id).not.toBe(topic.id);
      expect(cloned.title).toBe('copy');
      expect(clonedMessages).toHaveLength(2);
      expect(clonedMessages.every((m) => m.topicId === cloned.id)).toBe(true);
      expect(clonedMessages.map((m) => m.id)).not.toContain('dup-m1');
    });

    it('marks duplicated messages and resets the topic-level rollups', async () => {
      const usage = { cost: 0.05, totalInputTokens: 100, totalOutputTokens: 50 };
      const topic = await topicModel.create({ title: 'billed' });
      await serverDB
        .update(topics)
        .set({ totalCost: '0.05' as any, totalTokens: 150 })
        .where(eq(topics.id, topic.id));
      await serverDB.insert(messages).values([
        {
          content: 'answer',
          id: 'dup-billed',
          metadata: { performance: { tps: 42 }, usage },
          role: 'assistant',
          topicId: topic.id,
          usage,
          userId,
        },
      ]);

      const { topic: cloned, messages: clonedMessages } = await topicRepo.duplicate(topic.id);

      // per-message figures are transcript facts and survive the copy...
      const clone = clonedMessages[0];
      expect(clone.usage).toEqual(usage);
      const metadata = clone.metadata as Record<string, unknown>;
      expect(metadata.usage).toEqual(usage);
      expect(metadata.performance).toEqual({ tps: 42 });
      // ...but the row is marked, so usage reports skip it
      expect(metadata.copied).toBe(true);

      // the topic rollup answers "what did this topic cost this scope", and a
      // fresh duplicate has spent nothing yet
      const clonedTopic = await serverDB.query.topics.findFirst({
        where: (t, { eq: is }) => is(t.id, cloned.id),
      });
      expect(clonedTopic?.totalCost).toBeNull();
      expect(clonedTopic?.totalTokens).toBeNull();
    });

    it('throws when the source topic does not exist', async () => {
      await expect(topicRepo.duplicate('nope')).rejects.toThrow('not found');
    });

    it('copies only the ancestor chain when forking up to a message', async () => {
      const topic = await topicModel.create({ title: 'fork source' });
      await serverDB.insert(messages).values([
        { content: 'q1', id: 'fork-m1', role: 'user', topicId: topic.id, userId },
        {
          content: 'a1',
          id: 'fork-m2',
          parentId: 'fork-m1',
          role: 'assistant',
          topicId: topic.id,
          userId,
        },
        {
          content: 'q2',
          id: 'fork-m3',
          parentId: 'fork-m2',
          role: 'user',
          topicId: topic.id,
          userId,
        },
      ]);

      const { topic: forked, messages: forkedMessages } = await topicRepo.duplicate(
        topic.id,
        'forked',
        { upToMessageId: 'fork-m2' },
      );

      // only the selected prefix is copied, in root → selected order
      expect(forkedMessages.map((m) => m.content)).toEqual(['q1', 'a1']);
      expect(forkedMessages.every((m) => m.topicId === forked.id)).toBe(true);

      // the chain is re-parented inside the fork: root stays root, child points at the copy
      const [root, child] = forkedMessages;
      expect(root.parentId).toBeNull();
      expect(child.parentId).toBe(root.id);

      // the unselected tail stays behind in the source topic
      const sourceMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.topicId, topic.id));
      expect(sourceMessages.map((m) => m.id).sort()).toEqual(['fork-m1', 'fork-m2', 'fork-m3']);
    });

    it('leaves sibling branches out of the fork', async () => {
      const topic = await topicModel.create({ title: 'branched source' });
      await serverDB.insert(messages).values([
        { content: 'q1', id: 'br-m1', role: 'user', topicId: topic.id, userId },
        {
          content: 'draft',
          id: 'br-m2a',
          parentId: 'br-m1',
          role: 'assistant',
          topicId: topic.id,
          userId,
        },
        {
          content: 'regenerated',
          id: 'br-m2b',
          parentId: 'br-m1',
          role: 'assistant',
          topicId: topic.id,
          userId,
        },
      ]);

      const { messages: forkedMessages } = await topicRepo.duplicate(topic.id, 'forked', {
        upToMessageId: 'br-m2b',
      });

      expect(forkedMessages.map((m) => m.content)).toEqual(['q1', 'regenerated']);
    });

    it('throws when the fork anchor message is not in the topic', async () => {
      const topic = await topicModel.create({ title: 'no anchor' });

      await expect(
        topicRepo.duplicate(topic.id, 'forked', { upToMessageId: 'missing' }),
      ).rejects.toThrow('not found in topic');
    });

    it('stamps the copy with fresh activity time instead of inheriting the source date', async () => {
      const sourceDate = new Date('2020-01-02T03:04:05Z');
      const topic = await topicModel.create({ title: 'stale source' });
      await serverDB.insert(messages).values([
        {
          content: 'old q',
          createdAt: sourceDate,
          id: 'stale-m1',
          role: 'user',
          topicId: topic.id,
          updatedAt: sourceDate,
          userId,
        },
        {
          content: 'old a',
          createdAt: new Date(sourceDate.getTime() + 1000),
          id: 'stale-m2',
          parentId: 'stale-m1',
          role: 'assistant',
          topicId: topic.id,
          updatedAt: new Date(sourceDate.getTime() + 1000),
          userId,
        },
      ]);

      const before = Date.now();
      const { topic: cloned, messages: clonedMessages } = await topicRepo.duplicate(
        topic.id,
        'fresh copy',
        { upToMessageId: 'stale-m2' },
      );

      // A copy is new activity: its own row and every copied message carry the
      // copy moment. The sidebar keys topics by the newest message activity, so
      // inheriting the source's 2020 timestamps would re-file the copy under the
      // source's date group instead of today.
      expect(new Date(cloned.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
      for (const message of clonedMessages) {
        expect(new Date(message.updatedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
      }

      // The retained order survives retiming: rows still increase root → leaf.
      const [root, child] = clonedMessages;
      expect(new Date(root.createdAt).getTime()).toBeLessThan(new Date(child.createdAt).getTime());

      // The source keeps its own timestamps untouched.
      const sourceMessages = await serverDB
        .select()
        .from(messages)
        .where(eq(messages.topicId, topic.id));
      expect(sourceMessages.every((m) => new Date(m.updatedAt).getTime() < before)).toBe(true);
    });
  });
});
