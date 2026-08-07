import { RequestTrigger, ThreadStatus, ThreadType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import {
  agentOperations,
  agents,
  agentsToSessions,
  chatGroups,
  messages,
  sessions,
  threads,
  topics,
  users,
  workspaces,
} from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { ThreadModel } from '../thread';

const userId = 'thread-user-test';
const otherUserId = 'other-user-test';
const sessionId = 'thread-session';
const topicId = 'thread-topic';

const serverDB: LobeChatDatabase = await getTestDB();
const threadModel = new ThreadModel(serverDB, userId);

describe('ThreadModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);

    // Create test users, session and topic
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }, { id: otherUserId }]);
      await tx.insert(sessions).values({ id: sessionId, userId });
      await tx.insert(topics).values({ id: topicId, userId, sessionId });
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('create', () => {
    it('should create a new thread', async () => {
      const result = await threadModel.create({
        topicId,
        type: ThreadType.Standalone,
        sourceMessageId: 'msg-1',
      });

      expect(result).toBeDefined();
      expect(result.topicId).toBe(topicId);
      expect(result.type).toBe(ThreadType.Standalone);
      expect(result.status).toBe(ThreadStatus.Active);
      expect(result.sourceMessageId).toBe('msg-1');
    });

    it('should create a thread with title', async () => {
      const result = await threadModel.create({
        topicId,
        type: ThreadType.Continuation,
        title: 'Test Thread',
      });

      expect(result.title).toBe('Test Thread');
      expect(result.type).toBe(ThreadType.Continuation);
    });

    it('should honor caller-provided id', async () => {
      const customId = 'thd_custom_abc';
      const result = await threadModel.create({
        id: customId,
        topicId,
        type: ThreadType.Standalone,
      });

      expect(result.id).toBe(customId);
    });

    it('should return undefined when caller-provided id collides (onConflictDoNothing)', async () => {
      const customId = 'thd_collide_xyz';
      const first = await threadModel.create({
        id: customId,
        topicId,
        type: ThreadType.Standalone,
      });
      expect(first.id).toBe(customId);

      // The router layer translates this undefined into TRPCError(CONFLICT)
      // so callers using client-provided ids see an explicit error instead
      // of writing follow-up rows against a missing thread.
      const second = await threadModel.create({
        id: customId,
        topicId,
        type: ThreadType.Standalone,
      });
      expect(second).toBeUndefined();
    });
  });

  describe('query visibility', () => {
    it('requires parent-topic access before exposing direct thread targets', async () => {
      await serverDB.insert(workspaces).values({
        id: 'thread-visibility-workspace',
        name: 'Thread Visibility Workspace',
        primaryOwnerId: userId,
        slug: 'thread-visibility-workspace',
      });
      await serverDB.insert(agents).values([
        {
          id: 'thread-public-agent',
          userId,
          visibility: 'public',
          workspaceId: 'thread-visibility-workspace',
        },
        {
          id: 'thread-private-agent',
          userId,
          visibility: 'private',
          workspaceId: 'thread-visibility-workspace',
        },
      ]);
      await serverDB.insert(chatGroups).values({
        id: 'thread-public-group',
        title: 'Thread Public Group',
        userId,
        visibility: 'public',
        workspaceId: 'thread-visibility-workspace',
      });
      await serverDB.insert(topics).values([
        {
          agentId: 'thread-public-agent',
          id: 'thread-public-topic',
          userId,
          workspaceId: 'thread-visibility-workspace',
        },
        {
          agentId: 'thread-private-agent',
          id: 'thread-private-topic',
          userId,
          workspaceId: 'thread-visibility-workspace',
        },
      ]);
      await serverDB.insert(threads).values([
        {
          id: 'thread-public',
          topicId: 'thread-public-topic',
          type: ThreadType.Standalone,
          userId,
          workspaceId: 'thread-visibility-workspace',
        },
        {
          id: 'thread-private',
          topicId: 'thread-private-topic',
          type: ThreadType.Standalone,
          userId,
          workspaceId: 'thread-visibility-workspace',
        },
        {
          agentId: 'thread-public-agent',
          id: 'thread-private-public-child-agent',
          topicId: 'thread-private-topic',
          type: ThreadType.Standalone,
          userId,
          workspaceId: 'thread-visibility-workspace',
        },
        {
          groupId: 'thread-public-group',
          id: 'thread-private-public-child-group',
          topicId: 'thread-private-topic',
          type: ThreadType.Standalone,
          userId,
          workspaceId: 'thread-visibility-workspace',
        },
      ]);

      const model = new ThreadModel(serverDB, otherUserId, 'thread-visibility-workspace');

      await expect(model.query()).resolves.toEqual([
        expect.objectContaining({ id: 'thread-public' }),
      ]);
      await expect(model.queryByTopicId('thread-private-topic')).resolves.toEqual([]);
    });

    it('inherits legacy session visibility from the linked agent', async () => {
      const workspaceId = 'thread-legacy-workspace';
      await serverDB.insert(workspaces).values({
        id: workspaceId,
        name: 'Thread Legacy Workspace',
        primaryOwnerId: userId,
        slug: workspaceId,
      });
      await serverDB.insert(sessions).values([
        { id: 'thread-legacy-public-session', userId, workspaceId },
        { id: 'thread-legacy-private-session', userId, workspaceId },
      ]);
      await serverDB.insert(agents).values([
        {
          id: 'thread-legacy-public-agent',
          userId,
          visibility: 'public',
          workspaceId,
        },
        {
          id: 'thread-legacy-private-agent',
          userId,
          visibility: 'private',
          workspaceId,
        },
      ]);
      await serverDB.insert(agentsToSessions).values([
        {
          agentId: 'thread-legacy-public-agent',
          sessionId: 'thread-legacy-public-session',
          userId,
          workspaceId,
        },
        {
          agentId: 'thread-legacy-private-agent',
          sessionId: 'thread-legacy-private-session',
          userId,
          workspaceId,
        },
      ]);
      await serverDB.insert(topics).values([
        {
          id: 'thread-legacy-public-topic',
          sessionId: 'thread-legacy-public-session',
          userId,
          workspaceId,
        },
        {
          id: 'thread-legacy-private-topic',
          sessionId: 'thread-legacy-private-session',
          userId,
          workspaceId,
        },
      ]);
      await serverDB.insert(threads).values([
        {
          id: 'thread-legacy-public',
          topicId: 'thread-legacy-public-topic',
          type: ThreadType.Standalone,
          userId,
          workspaceId,
        },
        {
          id: 'thread-legacy-private',
          topicId: 'thread-legacy-private-topic',
          type: ThreadType.Standalone,
          userId,
          workspaceId,
        },
      ]);

      const memberModel = new ThreadModel(serverDB, otherUserId, workspaceId);
      const ownerModel = new ThreadModel(serverDB, userId, workspaceId);

      await expect(memberModel.query()).resolves.toEqual([
        expect.objectContaining({ id: 'thread-legacy-public' }),
      ]);
      await expect(memberModel.queryByTopicId('thread-legacy-public-topic')).resolves.toEqual([
        expect.objectContaining({ id: 'thread-legacy-public' }),
      ]);
      await expect(memberModel.queryByTopicId('thread-legacy-private-topic')).resolves.toEqual([]);
      await expect(ownerModel.queryByTopicId('thread-legacy-private-topic')).resolves.toEqual([
        expect.objectContaining({ id: 'thread-legacy-private' }),
      ]);
    });
  });

  describe('query', () => {
    it('should return all threads for the user', async () => {
      // Create test threads
      await serverDB.insert(threads).values([
        {
          id: 'thread-1',
          topicId,
          type: ThreadType.Standalone,
          status: ThreadStatus.Active,
          userId,
          updatedAt: new Date('2024-01-01'),
        },
        {
          id: 'thread-2',
          topicId,
          type: ThreadType.Continuation,
          status: ThreadStatus.Active,
          userId,
          updatedAt: new Date('2024-01-02'),
        },
      ]);

      const result = await threadModel.query();

      expect(result).toHaveLength(2);
      // Should be ordered by updatedAt desc
      expect(result[0].id).toBe('thread-2');
      expect(result[1].id).toBe('thread-1');
    });

    it('should only return threads for the current user', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: 'other-topic', userId: otherUserId });
        await tx.insert(threads).values([
          {
            id: 'thread-1',
            topicId,
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId,
          },
          {
            id: 'thread-2',
            topicId: 'other-topic',
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId: otherUserId,
          },
        ]);
      });

      const result = await threadModel.query();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('thread-1');
    });
  });

  describe('queryByTopicId', () => {
    it('should return threads for a specific topic', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: 'another-topic', userId, sessionId });
        await tx.insert(threads).values([
          {
            id: 'thread-1',
            topicId,
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId,
            updatedAt: new Date('2024-01-01'),
          },
          {
            id: 'thread-2',
            topicId: 'another-topic',
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId,
            updatedAt: new Date('2024-01-02'),
          },
        ]);
      });

      const result = await threadModel.queryByTopicId(topicId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('thread-1');
    });

    it('should return empty array when no threads exist for the topic', async () => {
      const result = await threadModel.queryByTopicId('non-existent-topic');

      expect(result).toHaveLength(0);
    });

    it('derives subagent metrics (SUM tokens, COUNT tools, model) from child messages', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(threads).values({
          id: 'sub-thread',
          metadata: { sourceToolCallId: 'tc-1' },
          status: ThreadStatus.Active,
          topicId,
          type: ThreadType.Standalone,
          userId,
        });
        await tx.insert(messages).values([
          // two assistant turns → tokens SUM to 1000 + 1800 = 2800
          {
            id: 'm-a1',
            model: 'claude-opus-4-8',
            role: 'assistant',
            threadId: 'sub-thread',
            topicId,
            usage: { totalTokens: 1000 },
            userId,
          },
          { id: 'm-t1', role: 'tool', threadId: 'sub-thread', topicId, userId },
          // legacy row: usage only under metadata.usage (no promoted column)
          {
            id: 'm-a2',
            metadata: { usage: { totalTokens: 1800 } },
            role: 'assistant',
            threadId: 'sub-thread',
            topicId,
            userId,
          },
          { id: 'm-t2', role: 'tool', threadId: 'sub-thread', topicId, userId },
        ]);
      });

      const [thread] = await threadModel.queryByTopicId(topicId);

      expect(thread.id).toBe('sub-thread');
      expect(thread.metadata?.totalTokens).toBe(2800);
      expect(thread.metadata?.totalToolCalls).toBe(2);
      expect(thread.metadata?.model).toBe('claude-opus-4-8');
      // create-time metadata preserved
      expect(thread.metadata?.sourceToolCallId).toBe('tc-1');
    });

    it('omits derived metrics for a thread with no child messages', async () => {
      await serverDB.insert(threads).values({
        id: 'empty-thread',
        status: ThreadStatus.Active,
        topicId,
        type: ThreadType.Standalone,
        userId,
      });

      const [thread] = await threadModel.queryByTopicId(topicId);

      expect(thread.id).toBe('empty-thread');
      expect(thread.metadata?.totalTokens).toBeUndefined();
      expect(thread.metadata?.totalToolCalls).toBeUndefined();
      expect(thread.metadata?.model).toBeUndefined();
    });

    it('hides agent-signal isolation threads from topic thread lists', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(threads).values([
          {
            id: 'visible-subagent-thread',
            status: ThreadStatus.Active,
            title: 'Visible subagent',
            topicId,
            type: ThreadType.Isolation,
            userId,
          },
          {
            id: 'agent-signal-thread',
            status: ThreadStatus.Active,
            title: 'Agent Signal Skill',
            topicId,
            type: ThreadType.Isolation,
            userId,
          },
        ]);
        await tx.insert(agentOperations).values({
          id: 'agent-signal-operation',
          status: 'done',
          threadId: 'agent-signal-thread',
          topicId,
          trigger: RequestTrigger.AgentSignal,
          userId,
        });
      });

      const result = await threadModel.queryByTopicId(topicId);

      expect(result.map((thread) => thread.id)).toEqual(['visible-subagent-thread']);
    });

    it('hides marked onboarding Understanding writing threads from topic thread lists', async () => {
      await serverDB.insert(threads).values({
        id: 'understanding-thread',
        metadata: { onboardingUnderstanding: { kind: 'writing' } },
        status: ThreadStatus.Pending,
        topicId,
        type: ThreadType.Isolation,
        userId,
      });

      expect(await threadModel.queryByTopicId(topicId)).toEqual([]);
      expect(await threadModel.findById('understanding-thread')).toBeDefined();
    });
  });

  describe('findById', () => {
    it('should return a thread by id', async () => {
      await serverDB.insert(threads).values({
        id: 'thread-1',
        topicId,
        type: ThreadType.Standalone,
        status: ThreadStatus.Active,
        userId,
        title: 'Test Thread',
      });

      const result = await threadModel.findById('thread-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('thread-1');
      expect(result?.title).toBe('Test Thread');
    });

    it('should return undefined for non-existent thread', async () => {
      const result = await threadModel.findById('non-existent');

      expect(result).toBeUndefined();
    });

    it('should not return thread belonging to another user', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: 'other-topic', userId: otherUserId });
        await tx.insert(threads).values({
          id: 'thread-other',
          topicId: 'other-topic',
          type: ThreadType.Standalone,
          status: ThreadStatus.Active,
          userId: otherUserId,
        });
      });

      const result = await threadModel.findById('thread-other');

      expect(result).toBeUndefined();
    });
  });

  describe('update', () => {
    it('should update a thread', async () => {
      await serverDB.insert(threads).values({
        id: 'thread-1',
        topicId,
        type: ThreadType.Standalone,
        status: ThreadStatus.Active,
        userId,
        title: 'Original Title',
      });

      await threadModel.update('thread-1', {
        title: 'Updated Title',
        status: ThreadStatus.Completed,
      });

      const updated = await serverDB.query.threads.findFirst({
        where: eq(threads.id, 'thread-1'),
      });

      expect(updated?.title).toBe('Updated Title');
      expect(updated?.status).toBe(ThreadStatus.Completed);
    });

    it('should not update thread belonging to another user', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: 'other-topic', userId: otherUserId });
        await tx.insert(threads).values({
          id: 'thread-other',
          topicId: 'other-topic',
          type: ThreadType.Standalone,
          status: ThreadStatus.Active,
          userId: otherUserId,
          title: 'Original Title',
        });
      });

      await threadModel.update('thread-other', { title: 'Hacked Title' });

      const unchanged = await serverDB.query.threads.findFirst({
        where: eq(threads.id, 'thread-other'),
      });

      expect(unchanged?.title).toBe('Original Title');
    });
  });

  describe('delete', () => {
    it('should delete a thread', async () => {
      await serverDB.insert(threads).values({
        id: 'thread-1',
        topicId,
        type: ThreadType.Standalone,
        status: ThreadStatus.Active,
        userId,
      });

      await threadModel.delete('thread-1');

      const deleted = await serverDB.query.threads.findFirst({
        where: eq(threads.id, 'thread-1'),
      });

      expect(deleted).toBeUndefined();
    });

    it('should not delete thread belonging to another user', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: 'other-topic', userId: otherUserId });
        await tx.insert(threads).values({
          id: 'thread-other',
          topicId: 'other-topic',
          type: ThreadType.Standalone,
          status: ThreadStatus.Active,
          userId: otherUserId,
        });
      });

      await threadModel.delete('thread-other');

      const stillExists = await serverDB.query.threads.findFirst({
        where: eq(threads.id, 'thread-other'),
      });

      expect(stillExists).toBeDefined();
    });
  });

  describe('deleteAll', () => {
    it('should delete all threads for the current user', async () => {
      await serverDB.transaction(async (tx) => {
        await tx.insert(topics).values({ id: 'other-topic', userId: otherUserId });
        await tx.insert(threads).values([
          {
            id: 'thread-1',
            topicId,
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId,
          },
          {
            id: 'thread-2',
            topicId,
            type: ThreadType.Continuation,
            status: ThreadStatus.Active,
            userId,
          },
          {
            id: 'thread-3',
            topicId: 'other-topic',
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId: otherUserId,
          },
        ]);
      });

      await threadModel.deleteAll();

      const userThreads = await serverDB.select().from(threads).where(eq(threads.userId, userId));
      const otherUserThreads = await serverDB
        .select()
        .from(threads)
        .where(eq(threads.userId, otherUserId));

      expect(userThreads).toHaveLength(0);
      expect(otherUserThreads).toHaveLength(1);
    });

    it('should only clear the caller own threads in workspace mode', async () => {
      const workspaceId = 'thread-delete-workspace';
      const workspaceThreadModel = new ThreadModel(serverDB, userId, workspaceId);

      await serverDB.transaction(async (tx) => {
        await tx.insert(workspaces).values({
          id: workspaceId,
          name: 'Thread Delete Workspace',
          primaryOwnerId: userId,
          slug: workspaceId,
        });
        await tx.insert(topics).values({ id: 'ws-topic', userId, workspaceId });
        await tx.insert(threads).values([
          {
            id: 'ws-thread-mine',
            topicId: 'ws-topic',
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId,
            workspaceId,
          },
          {
            id: 'ws-thread-other',
            topicId: 'ws-topic',
            type: ThreadType.Standalone,
            status: ThreadStatus.Active,
            userId: otherUserId,
            workspaceId,
          },
        ]);
      });

      await workspaceThreadModel.deleteAll();

      const remaining = await serverDB
        .select()
        .from(threads)
        .where(eq(threads.workspaceId, workspaceId));
      expect(remaining).toHaveLength(1);
      expect(remaining[0].userId).toBe(otherUserId);
    });
  });
});
