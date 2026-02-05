// @vitest-environment node
import { ASYNC_TASK_TIMEOUT } from '@lobechat/business-config/server';
import type { UserMemoryExtractionMetadata } from '@lobechat/types';
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { asyncTasks, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AsyncTaskModel } from '../asyncTask';

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
});
