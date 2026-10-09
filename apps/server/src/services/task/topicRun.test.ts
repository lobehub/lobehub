import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import type { LobeChatDatabase } from '@/database/type';

import { TopicRunService } from './topicRun';

vi.mock('@/database/models/task', () => ({ TaskModel: vi.fn() }));
vi.mock('@/database/models/taskTopic', () => ({ TaskTopicModel: vi.fn() }));

/**
 * A user answering a finished run in that run's own conversation starts the
 * next run — from the composer, not `runTask`. The Task side has to follow it,
 * or the run card keeps reading as finished while the agent works and the Task
 * never leaves its old terminal state.
 */
describe('TopicRunService', () => {
  // `reopen` writes the run row and the topic's end stamp as one unit. The mock
  // runs the body against the same object, so the models patched onto it apply
  // inside the transaction too.
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  } as unknown as LobeChatDatabase;
  const userId = 'user-1';

  const taskModel = {
    findById: vi.fn(),
    lockForUpdate: vi.fn(),
    updateStatusIfCurrent: vi.fn(),
  };
  const taskTopicModel = {
    clearTopicEnded: vi.fn(),
    findByTopicId: vi.fn(),
    reopenSettledRun: vi.fn(),
  };

  /** As the service returns it. */
  const link = { runStatus: 'completed', taskId: 'task-1', taskIdentifier: 'T-1' };
  /** As the run row comes back from the model. */
  const run = { status: 'completed', taskId: 'task-1', topicId: 'tpc-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    (TaskModel as any).mockImplementation(function () {
      return taskModel;
    });
    (TaskTopicModel as any).mockImplementation(function () {
      return taskTopicModel;
    });

    taskModel.findById.mockResolvedValue({ identifier: 'T-1', status: 'completed' });
    taskModel.lockForUpdate.mockResolvedValue(true);
    taskModel.updateStatusIfCurrent.mockResolvedValue({ status: 'running' });
    taskTopicModel.clearTopicEnded.mockResolvedValue(undefined);
    taskTopicModel.findByTopicId.mockResolvedValue(null);
    taskTopicModel.reopenSettledRun.mockResolvedValue(true);
  });

  describe('findByTopicId', () => {
    it('leaves an ordinary conversation alone', async () => {
      // The common case on the send path, and the one that must stay free: no
      // run row means this topic is not a Task's, so nothing else is read.
      await expect(
        new TopicRunService(db, userId).findByTopicId('tpc-plain'),
      ).resolves.toBeUndefined();

      expect(taskModel.findById).not.toHaveBeenCalled();
    });

    it('resolves the run and the Task that owns it', async () => {
      taskTopicModel.findByTopicId.mockResolvedValue(run);

      await expect(new TopicRunService(db, userId).findByTopicId('tpc-1')).resolves.toEqual(link);
    });

    it('reports nothing for a run whose Task is gone', async () => {
      taskTopicModel.findByTopicId.mockResolvedValue(run);
      taskModel.findById.mockResolvedValue(null);

      await expect(new TopicRunService(db, userId).findByTopicId('tpc-1')).resolves.toBeUndefined();
    });
  });

  describe('reopen', () => {
    it('puts the run back in flight and takes the Task back to running', async () => {
      const reopened = await new TopicRunService(db, userId).reopen({
        link,
        operationId: 'op-answer',
        topicId: 'tpc-1',
      });

      expect(reopened).toBe(true);
      expect(taskModel.lockForUpdate).toHaveBeenCalledWith('task-1');
      expect(taskTopicModel.reopenSettledRun).toHaveBeenCalledWith('tpc-1', 'op-answer');
      expect(taskTopicModel.clearTopicEnded).toHaveBeenCalledWith('tpc-1');
      expect(taskModel.updateStatusIfCurrent).toHaveBeenCalledWith(
        'task-1',
        'completed',
        'running',
        expect.objectContaining({ error: null }),
      );
    });

    it('keeps the live run’s operation id when the message lands behind it', async () => {
      // The row is already `running`, so this message joined the run in flight:
      // the row must keep naming the operation that cancellation interrupts, and
      // there is nothing to re-stamp.
      taskTopicModel.reopenSettledRun.mockResolvedValue(false);

      const reopened = await new TopicRunService(db, userId).reopen({
        link,
        operationId: 'op-queued',
        topicId: 'tpc-1',
      });

      expect(reopened).toBe(false);
      expect(taskTopicModel.clearTopicEnded).not.toHaveBeenCalled();
      expect(taskModel.updateStatusIfCurrent).not.toHaveBeenCalled();
    });

    it('does not reopen a run under a Task that was retired meanwhile', async () => {
      taskModel.findById.mockResolvedValue({ identifier: 'T-1', status: 'canceled' });

      await expect(
        new TopicRunService(db, userId).reopen({
          link,
          operationId: 'op-answer',
          topicId: 'tpc-1',
        }),
      ).resolves.toBe(false);

      expect(taskTopicModel.reopenSettledRun).not.toHaveBeenCalled();
    });

    it('does not reopen a run under a Task that was deleted meanwhile', async () => {
      taskModel.lockForUpdate.mockResolvedValue(false);

      await expect(
        new TopicRunService(db, userId).reopen({
          link,
          operationId: 'op-answer',
          topicId: 'tpc-1',
        }),
      ).resolves.toBe(false);

      expect(taskTopicModel.reopenSettledRun).not.toHaveBeenCalled();
    });
  });
});
