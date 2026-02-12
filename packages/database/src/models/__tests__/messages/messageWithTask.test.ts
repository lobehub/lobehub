import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThreadStatus, ThreadType } from '@/types/index';

import { getTestDB } from '../../../core/getTestDB';
import { messages, sessions, threads, topics, users } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { MessageModel } from '../../message';

const userId = 'message-task-user-test';
const sessionId = 'message-task-session';
const topicId = 'message-task-topic';

const serverDB: LobeChatDatabase = await getTestDB();
const messageModel = new MessageModel(serverDB, userId);

describe('MessageModel - queryWithWhere with task messages', () => {
  beforeEach(async () => {
    await serverDB.delete(users);

    // Create test user, session and topic
    await serverDB.transaction(async (tx) => {
      await tx.insert(users).values([{ id: userId }]);
      await tx.insert(sessions).values({ id: sessionId, userId });
      await tx.insert(topics).values({ id: topicId, userId, sessionId });
    });
  });

  afterEach(async () => {
    await serverDB.delete(users);
  });

  describe('taskDetail population for task messages', () => {
    it('should return taskDetail for task messages with associated thread', async () => {
      const taskMessageId = 'task-msg-1';
      const threadId = 'thread-for-task-1';

      // Create a task message
      await serverDB.insert(messages).values({
        content: 'Execute agent task',
        id: taskMessageId,
        role: 'task',
        sessionId,
        topicId,
        userId,
      });

      // Create an associated thread with sourceMessageId pointing to the task message
      await serverDB.insert(threads).values({
        id: threadId,
        metadata: {
          duration: 5000,
          totalCost: 0.05,
          totalMessages: 10,
          totalTokens: 1500,
          totalToolCalls: 3,
        },
        sourceMessageId: taskMessageId,
        status: ThreadStatus.Completed,
        title: 'Agent Task Execution',
        topicId,
        type: ThreadType.Standalone,
        userId,
      });

      const result = await messageModel.queryWithWhere();

      expect(result).toHaveLength(1);
      const taskMessage = result[0];
      expect(taskMessage.role).toBe('task');
      expect(taskMessage.taskDetail).toBeDefined();
      expect(taskMessage.taskDetail).toEqual({
        duration: 5000,
        status: ThreadStatus.Completed,
        threadId: threadId,
        title: 'Agent Task Execution',
        totalCost: 0.05,
        totalMessages: 10,
        totalTokens: 1500,
        totalToolCalls: 3,
      });
    });

    it('should not return taskDetail for task messages without associated thread', async () => {
      const taskMessageId = 'task-msg-no-thread';

      // Create a task message without an associated thread
      await serverDB.insert(messages).values({
        content: 'Orphan task message',
        id: taskMessageId,
        role: 'task',
        sessionId,
        topicId,
        userId,
      });

      const result = await messageModel.queryWithWhere();

      expect(result).toHaveLength(1);
      const taskMessage = result[0];
      expect(taskMessage.role).toBe('task');
      expect(taskMessage.taskDetail).toBeUndefined();
    });

    it('should not return taskDetail for non-task messages', async () => {
      // Create an assistant message
      await serverDB.insert(messages).values({
        content: 'Regular assistant message',
        id: 'assistant-msg-1',
        role: 'assistant',
        sessionId,
        topicId,
        userId,
      });

      const result = await messageModel.queryWithWhere();

      expect(result).toHaveLength(1);
      const assistantMessage = result[0];
      expect(assistantMessage.role).toBe('assistant');
      expect(assistantMessage.taskDetail).toBeUndefined();
    });

    it('should handle multiple task messages with different thread statuses', async () => {
      // Create multiple task messages
      await serverDB.insert(messages).values([
        {
          content: 'Processing task',
          createdAt: new Date('2024-01-01'),
          id: 'task-processing',
          role: 'task',
          sessionId,
          topicId,
          userId,
        },
        {
          content: 'Completed task',
          createdAt: new Date('2024-01-02'),
          id: 'task-completed',
          role: 'task',
          sessionId,
          topicId,
          userId,
        },
        {
          content: 'Failed task',
          createdAt: new Date('2024-01-03'),
          id: 'task-failed',
          role: 'task',
          sessionId,
          topicId,
          userId,
        },
      ]);

      // Create associated threads with different statuses
      await serverDB.insert(threads).values([
        {
          id: 'thread-processing',
          metadata: { totalTokens: 500 },
          sourceMessageId: 'task-processing',
          status: ThreadStatus.Processing,
          title: 'Processing Thread',
          topicId,
          type: ThreadType.Standalone,
          userId,
        },
        {
          id: 'thread-completed',
          metadata: {
            duration: 3000,
            totalCost: 0.03,
            totalMessages: 5,
            totalTokens: 800,
            totalToolCalls: 2,
          },
          sourceMessageId: 'task-completed',
          status: ThreadStatus.Completed,
          title: 'Completed Thread',
          topicId,
          type: ThreadType.Standalone,
          userId,
        },
        {
          id: 'thread-failed',
          metadata: { duration: 1000, totalTokens: 200 },
          sourceMessageId: 'task-failed',
          status: ThreadStatus.Failed,
          title: 'Failed Thread',
          topicId,
          type: ThreadType.Standalone,
          userId,
        },
      ]);

      const result = await messageModel.queryWithWhere();

      expect(result).toHaveLength(3);

      const processingTask = result.find((m) => m.id === 'task-processing');
      expect(processingTask?.taskDetail?.status).toBe(ThreadStatus.Processing);
      expect(processingTask?.taskDetail?.totalTokens).toBe(500);

      const completedTask = result.find((m) => m.id === 'task-completed');
      expect(completedTask?.taskDetail?.status).toBe(ThreadStatus.Completed);
      expect(completedTask?.taskDetail?.duration).toBe(3000);
      expect(completedTask?.taskDetail?.totalCost).toBe(0.03);

      const failedTask = result.find((m) => m.id === 'task-failed');
      expect(failedTask?.taskDetail?.status).toBe(ThreadStatus.Failed);
      expect(failedTask?.taskDetail?.duration).toBe(1000);
    });

    it('should handle mixed message types correctly', async () => {
      // Create a mix of message types
      await serverDB.insert(messages).values([
        {
          content: 'User message',
          createdAt: new Date('2024-01-01'),
          id: 'user-msg',
          role: 'user',
          sessionId,
          topicId,
          userId,
        },
        {
          content: 'Assistant response',
          createdAt: new Date('2024-01-02'),
          id: 'assistant-msg',
          role: 'assistant',
          sessionId,
          topicId,
          userId,
        },
        {
          content: 'Task execution',
          createdAt: new Date('2024-01-03'),
          id: 'task-msg',
          role: 'task',
          sessionId,
          topicId,
          userId,
        },
      ]);

      // Create thread only for task message
      await serverDB.insert(threads).values({
        id: 'task-thread',
        metadata: { totalTokens: 1000 },
        sourceMessageId: 'task-msg',
        status: ThreadStatus.Completed,
        title: 'Task Thread',
        topicId,
        type: ThreadType.Standalone,
        userId,
      });

      const result = await messageModel.queryWithWhere();

      expect(result).toHaveLength(3);

      const userMsg = result.find((m) => m.id === 'user-msg');
      expect(userMsg?.taskDetail).toBeUndefined();

      const assistantMsg = result.find((m) => m.id === 'assistant-msg');
      expect(assistantMsg?.taskDetail).toBeUndefined();

      const taskMsg = result.find((m) => m.id === 'task-msg');
      expect(taskMsg?.taskDetail).toBeDefined();
      expect(taskMsg?.taskDetail?.threadId).toBe('task-thread');
    });

    it('should not include thread from different user', async () => {
      const otherUserId = 'other-user-for-task-test';
      const taskMessageId = 'task-msg-cross-user';

      // Create other user
      await serverDB.insert(users).values({ id: otherUserId });

      // Create a task message for current user
      await serverDB.insert(messages).values({
        content: 'My task message',
        id: taskMessageId,
        role: 'task',
        sessionId,
        topicId,
        userId,
      });

      // Create other user's topic and thread with same sourceMessageId
      await serverDB.insert(sessions).values({ id: 'other-session', userId: otherUserId });
      await serverDB.insert(topics).values({
        id: 'other-topic',
        sessionId: 'other-session',
        userId: otherUserId,
      });
      await serverDB.insert(threads).values({
        id: 'other-user-thread',
        metadata: { totalTokens: 9999 },
        sourceMessageId: taskMessageId, // Same messageId but different user
        status: ThreadStatus.Completed,
        title: 'Other User Thread',
        topicId: 'other-topic',
        type: ThreadType.Standalone,
        userId: otherUserId,
      });

      const result = await messageModel.queryWithWhere();

      expect(result).toHaveLength(1);
      const taskMessage = result[0];
      // Should not get the other user's thread
      expect(taskMessage.taskDetail).toBeUndefined();
    });

    it('should handle thread with partial metadata', async () => {
      const taskMessageId = 'task-msg-partial';
      const threadId = 'thread-partial-metadata';

      await serverDB.insert(messages).values({
        content: 'Task with partial metadata',
        id: taskMessageId,
        role: 'task',
        sessionId,
        topicId,
        userId,
      });

      // Create thread with only some metadata fields
      await serverDB.insert(threads).values({
        id: threadId,
        metadata: {
          totalTokens: 500,
          // Other fields are missing
        },
        sourceMessageId: taskMessageId,
        status: ThreadStatus.Active,
        title: 'Partial Metadata Thread',
        topicId,
        type: ThreadType.Standalone,
        userId,
      });

      const result = await messageModel.queryWithWhere();

      expect(result).toHaveLength(1);
      const taskMessage = result[0];
      expect(taskMessage.taskDetail).toEqual({
        duration: undefined,
        status: ThreadStatus.Active,
        threadId: threadId,
        title: 'Partial Metadata Thread',
        totalCost: undefined,
        totalMessages: undefined,
        totalTokens: 500,
        totalToolCalls: undefined,
      });
    });

    it('should handle thread with no metadata', async () => {
      const taskMessageId = 'task-msg-no-metadata';
      const threadId = 'thread-no-metadata';

      await serverDB.insert(messages).values({
        content: 'Task with no metadata',
        id: taskMessageId,
        role: 'task',
        sessionId,
        topicId,
        userId,
      });

      // Create thread without metadata
      await serverDB.insert(threads).values({
        id: threadId,
        sourceMessageId: taskMessageId,
        status: ThreadStatus.Pending,
        topicId,
        type: ThreadType.Standalone,
        userId,
      });

      const result = await messageModel.queryWithWhere();

      expect(result).toHaveLength(1);
      const taskMessage = result[0];
      expect(taskMessage.taskDetail).toEqual({
        duration: undefined,
        status: ThreadStatus.Pending,
        threadId: threadId,
        title: undefined,
        totalCost: undefined,
        totalMessages: undefined,
        totalTokens: undefined,
        totalToolCalls: undefined,
      });
    });
  });
});
