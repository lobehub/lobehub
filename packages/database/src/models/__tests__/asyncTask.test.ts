// @vitest-environment node
import { ASYNC_TASK_TIMEOUT } from '@lobechat/business-config/server';
import type { UserMemoryExtractionMetadata } from '@lobechat/types';
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { asyncTasks, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AsyncTaskModel, initUserMemoryExtractionMetadata } from '../asyncTask';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'async-task-model-test-user-id';
const asyncTaskModel = new AsyncTaskModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }]);
});

afterEach(async () => {
  await serverDB.delete(users).where(eq(users.id, userId));
});

describe('AsyncTaskModel', () => {
  describe('create', () => {
    it('should create a new async task', async () => {
      const params = {
        type: AsyncTaskType.Chunking,
        status: AsyncTaskStatus.Processing,
      };

      const taskId = await asyncTaskModel.create(params);

      const task = await serverDB.query.asyncTasks.findFirst({
        where: eq(asyncTasks.id, taskId),
      });
      expect(task).toMatchObject({ ...params, userId });
    });
  });

  describe('delete', () => {
    it('should delete an async task by id', async () => {
      const { id } = await serverDB
        .insert(asyncTasks)
        .values({
          type: AsyncTaskType.Chunking,
          status: AsyncTaskStatus.Processing,
          userId,
        })
        .returning()
        .then((res) => res[0]);

      await asyncTaskModel.delete(id);

      const task = await serverDB.query.asyncTasks.findFirst({
        where: eq(asyncTasks.id, id),
      });
      expect(task).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('should find an async task by id', async () => {
      const { id } = await serverDB
        .insert(asyncTasks)
        .values({
          type: AsyncTaskType.Chunking,
          status: AsyncTaskStatus.Processing,
          userId,
        })
        .returning()
        .then((res) => res[0]);

      const task = await asyncTaskModel.findById(id);
      expect(task).toBeDefined();
      expect(task?.id).toBe(id);
    });
  });

  describe('update', () => {
    it('should update an async task', async () => {
      const { id } = await serverDB
        .insert(asyncTasks)
        .values({
          type: AsyncTaskType.Chunking,
          status: AsyncTaskStatus.Processing,
          userId,
        })
        .returning()
        .then((res) => res[0]);

      await asyncTaskModel.update(id, { status: AsyncTaskStatus.Success });

      const updatedTask = await serverDB.query.asyncTasks.findFirst({
        where: eq(asyncTasks.id, id),
      });
      expect(updatedTask?.status).toBe(AsyncTaskStatus.Success);
    });
  });

  describe('findByIds', () => {
    it('should find async tasks by ids and type', async () => {
      const tasks = await serverDB
        .insert(asyncTasks)
        .values([
          { type: AsyncTaskType.Chunking, status: AsyncTaskStatus.Processing, userId },
          { type: AsyncTaskType.Chunking, status: AsyncTaskStatus.Success, userId },
          { type: AsyncTaskType.Embedding, status: AsyncTaskStatus.Processing, userId },
        ])
        .returning();

      const chunkTasks = await asyncTaskModel.findByIds(
        tasks.map((t) => t.id),
        AsyncTaskType.Chunking,
      );

      expect(chunkTasks).toHaveLength(2);
      expect(chunkTasks.every((t) => t.type === AsyncTaskType.Chunking)).toBe(true);
    });
  });

  describe('incrementUserMemoryExtractionProgress', () => {
    it('should increment completedTopics and set status to success when reaching total', async () => {
      const { id } = await serverDB
        .insert(asyncTasks)
        .values({
          metadata: {
            progress: {
              completedTopics: 0,
              totalTopics: 2,
            },
            source: 'chat_topic',
          },
          status: AsyncTaskStatus.Pending,
          type: AsyncTaskType.UserMemoryExtractionWithChatTopic,
          userId,
        })
        .returning()
        .then((res) => res[0]);

      await asyncTaskModel.incrementUserMemoryExtractionProgress(id);
      let task = await serverDB.query.asyncTasks.findFirst({ where: eq(asyncTasks.id, id) });
      const firstMetadata = task?.metadata as UserMemoryExtractionMetadata | undefined;
      expect(firstMetadata?.progress?.completedTopics).toBe(1);
      expect(firstMetadata?.progress?.totalTopics).toBe(2);
      expect(task?.status).toBe(AsyncTaskStatus.Processing);

      await asyncTaskModel.incrementUserMemoryExtractionProgress(id);
      task = await serverDB.query.asyncTasks.findFirst({ where: eq(asyncTasks.id, id) });
      const secondMetadata = task?.metadata as UserMemoryExtractionMetadata | undefined;
      expect(secondMetadata?.progress?.completedTopics).toBe(2);
      expect(task?.status).toBe(AsyncTaskStatus.Success);
    });
  });

  describe('findActiveByType', () => {
    it('should find active tasks with Pending status', async () => {
      await serverDB.insert(asyncTasks).values({
        type: AsyncTaskType.Chunking,
        status: AsyncTaskStatus.Pending,
        userId,
      });

      const task = await asyncTaskModel.findActiveByType(AsyncTaskType.Chunking);
      expect(task).toBeDefined();
      expect(task?.status).toBe(AsyncTaskStatus.Pending);
      expect(task?.type).toBe(AsyncTaskType.Chunking);
    });

    it('should find active tasks with Processing status', async () => {
      await serverDB.insert(asyncTasks).values({
        type: AsyncTaskType.Embedding,
        status: AsyncTaskStatus.Processing,
        userId,
      });

      const task = await asyncTaskModel.findActiveByType(AsyncTaskType.Embedding);
      expect(task).toBeDefined();
      expect(task?.status).toBe(AsyncTaskStatus.Processing);
      expect(task?.type).toBe(AsyncTaskType.Embedding);
    });

    it('should not find completed or error tasks', async () => {
      await serverDB.insert(asyncTasks).values([
        {
          type: AsyncTaskType.Chunking,
          status: AsyncTaskStatus.Success,
          userId,
        },
        {
          type: AsyncTaskType.Chunking,
          status: AsyncTaskStatus.Error,
          userId,
        },
      ]);

      const task = await asyncTaskModel.findActiveByType(AsyncTaskType.Chunking);
      expect(task).toBeUndefined();
    });

    it('should only find tasks for the current user', async () => {
      const otherUserId = 'other-user-for-active-test';
      await serverDB.insert(users).values([{ id: otherUserId }]);

      await serverDB.insert(asyncTasks).values({
        type: AsyncTaskType.Chunking,
        status: AsyncTaskStatus.Pending,
        userId: otherUserId,
      });

      const task = await asyncTaskModel.findActiveByType(AsyncTaskType.Chunking);
      expect(task).toBeUndefined();

      // Clean up
      await serverDB.delete(users).where(eq(users.id, otherUserId));
    });

    it('should only find tasks matching the specified type', async () => {
      await serverDB.insert(asyncTasks).values({
        type: AsyncTaskType.Embedding,
        status: AsyncTaskStatus.Pending,
        userId,
      });

      const task = await asyncTaskModel.findActiveByType(AsyncTaskType.Chunking);
      expect(task).toBeUndefined();
    });
  });

  describe('checkTimeoutTasks', () => {
    it('should mark tasks as error if they timeout', async () => {
      // Create a task with old timestamp (beyond timeout)
      const timeoutDate = new Date(Date.now() - ASYNC_TASK_TIMEOUT - 1000);

      const { id } = await serverDB
        .insert(asyncTasks)
        .values({
          type: AsyncTaskType.Chunking,
          status: AsyncTaskStatus.Processing,
          userId,
          createdAt: timeoutDate,
        })
        .returning()
        .then((res) => res[0]);

      await asyncTaskModel.checkTimeoutTasks([id]);

      const updatedTask = await serverDB.query.asyncTasks.findFirst({
        where: eq(asyncTasks.id, id),
      });
      expect(updatedTask?.status).toBe(AsyncTaskStatus.Error);
      expect(updatedTask?.error).toBeDefined();
    });

    it('should not mark tasks as error if they are not timed out', async () => {
      // Create a task with recent timestamp (within timeout)
      const recentDate = new Date();

      const { id } = await serverDB
        .insert(asyncTasks)
        .values({
          type: AsyncTaskType.Chunking,
          status: AsyncTaskStatus.Processing,
          userId,
          createdAt: recentDate,
        })
        .returning()
        .then((res) => res[0]);

      await asyncTaskModel.checkTimeoutTasks([id]);

      const updatedTask = await serverDB.query.asyncTasks.findFirst({
        where: eq(asyncTasks.id, id),
      });
      expect(updatedTask?.status).toBe(AsyncTaskStatus.Processing);
      expect(updatedTask?.error).toBeNull();
    });
  });

  describe('isUserMemoryExtractionCancellationRequested', () => {
    it('should return true when cancellation is requested for current user memory extraction task', async () => {
      const [task] = await serverDB
        .insert(asyncTasks)
        .values({
          metadata: {
            control: {
              cancelRequestedAt: new Date().toISOString(),
            },
            progress: {
              completedTopics: 0,
              totalTopics: 1,
            },
            source: 'chat_topic',
          },
          status: AsyncTaskStatus.Processing,
          type: AsyncTaskType.UserMemoryExtractionWithChatTopic,
          userId,
        })
        .returning();

      const requested = await asyncTaskModel.isUserMemoryExtractionCancellationRequested(task.id);

      expect(requested).toBe(true);
    });

    it('should return false when task is not user memory extraction type', async () => {
      const [task] = await serverDB
        .insert(asyncTasks)
        .values({
          metadata: {
            control: {
              cancelRequestedAt: new Date().toISOString(),
            },
            progress: {
              completedTopics: 0,
              totalTopics: 1,
            },
            source: 'chat_topic',
          },
          status: AsyncTaskStatus.Processing,
          type: AsyncTaskType.Chunking,
          userId,
        })
        .returning();

      const requested = await asyncTaskModel.isUserMemoryExtractionCancellationRequested(task.id);

      expect(requested).toBe(false);
    });

    it('should return false when task belongs to another user', async () => {
      const otherUserId = 'other-user-for-cancel-test';
      await serverDB.insert(users).values([{ id: otherUserId }]);

      const [task] = await serverDB
        .insert(asyncTasks)
        .values({
          metadata: {
            control: {
              cancelRequestedAt: new Date().toISOString(),
            },
            progress: {
              completedTopics: 0,
              totalTopics: 1,
            },
            source: 'chat_topic',
          },
          status: AsyncTaskStatus.Processing,
          type: AsyncTaskType.UserMemoryExtractionWithChatTopic,
          userId: otherUserId,
        })
        .returning();

      const requested = await asyncTaskModel.isUserMemoryExtractionCancellationRequested(task.id);

      expect(requested).toBe(false);

      await serverDB.delete(users).where(eq(users.id, otherUserId));
    });
  });
});

describe('initUserMemoryExtractionMetadata', () => {
  it('should return default metadata when called with undefined', () => {
    const result = initUserMemoryExtractionMetadata(undefined);

    expect(result).toEqual({
      control: undefined,
      progress: {
        completedTopics: 0,
        totalTopics: null,
      },
      range: undefined,
      source: 'chat_topic',
    });
  });

  it('should return default metadata when called with no arguments', () => {
    const result = initUserMemoryExtractionMetadata();

    expect(result).toEqual({
      control: undefined,
      progress: {
        completedTopics: 0,
        totalTopics: null,
      },
      range: undefined,
      source: 'chat_topic',
    });
  });

  it('should preserve existing progress values from partial metadata', () => {
    const result = initUserMemoryExtractionMetadata({
      progress: {
        completedTopics: 5,
        totalTopics: 10,
      },
      source: 'chat_topic',
    });

    expect(result).toEqual({
      control: undefined,
      progress: {
        completedTopics: 5,
        totalTopics: 10,
      },
      range: undefined,
      source: 'chat_topic',
    });
  });

  it('should preserve range and source from full metadata', () => {
    const range = { start: '2024-01-01', end: '2024-12-31' };
    const result = initUserMemoryExtractionMetadata({
      progress: {
        completedTopics: 3,
        totalTopics: 7,
      },
      range: range as any,
      source: 'chat_topic',
    });

    expect(result).toEqual({
      control: undefined,
      progress: {
        completedTopics: 3,
        totalTopics: 7,
      },
      range,
      source: 'chat_topic',
    });
  });

  it('should default completedTopics to 0 when not provided', () => {
    const result = initUserMemoryExtractionMetadata({
      progress: {
        totalTopics: 5,
      },
    } as any);

    expect(result.progress.completedTopics).toBe(0);
    expect(result.progress.totalTopics).toBe(5);
  });

  it('should default totalTopics to null when not provided', () => {
    const result = initUserMemoryExtractionMetadata({
      progress: {
        completedTopics: 2,
      },
    } as any);

    expect(result.progress.completedTopics).toBe(2);
    expect(result.progress.totalTopics).toBeNull();
  });

  it('should default source to chat_topic when not provided', () => {
    const result = initUserMemoryExtractionMetadata({
      progress: {
        completedTopics: 0,
        totalTopics: null,
      },
    } as any);

    expect(result.source).toBe('chat_topic');
  });
});

describe('AsyncTaskModel.findByInferenceId', () => {
  it('should find a task by inferenceId', async () => {
    const [task] = await serverDB
      .insert(asyncTasks)
      .values({
        status: AsyncTaskStatus.Processing,
        userId,
        inferenceId: 'inference-123',
        type: AsyncTaskType.UserMemoryExtractionWithChatTopic,
      })
      .returning();

    const result = await AsyncTaskModel.findByInferenceId(serverDB, 'inference-123');
    expect(result).toBeDefined();
    expect(result?.id).toBe(task.id);
  });

  it('should return undefined for non-existent inferenceId', async () => {
    const result = await AsyncTaskModel.findByInferenceId(
      serverDB,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(result).toBeUndefined();
  });
});
