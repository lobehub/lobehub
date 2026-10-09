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
  const topicId = 'tpc-1';

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
  const link = {
    ownerUserId: 'owner-1',
    runStatus: 'completed',
    taskId: 'task-1',
    taskIdentifier: 'T-1',
    topicId,
  };
  /** As the run row comes back from the model. */
  const run = { status: 'completed', taskId: 'task-1', topicId };
  /** As the Task comes back from the model. */
  const task = {
    createdByUserId: 'owner-1',
    identifier: 'T-1',
    status: 'completed',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (TaskModel as any).mockImplementation(function () {
      return taskModel;
    });
    (TaskTopicModel as any).mockImplementation(function () {
      return taskTopicModel;
    });

    taskModel.findById.mockResolvedValue(task);
    taskModel.lockForUpdate.mockResolvedValue(true);
    taskModel.updateStatusIfCurrent.mockResolvedValue({ status: 'running' });
    taskTopicModel.clearTopicEnded.mockResolvedValue(undefined);
    taskTopicModel.findByTopicId.mockResolvedValue(null);
    taskTopicModel.reopenSettledRun.mockResolvedValue(true);
  });

  describe('resolveOwnableRun', () => {
    it('leaves an ordinary conversation alone', async () => {
      // The common case on the send path, and the one that must stay free: no
      // run row means this topic is not a Task's, so nothing else is read.
      await expect(
        new TopicRunService(db, userId).resolveOwnableRun('tpc-plain'),
      ).resolves.toBeUndefined();

      expect(taskModel.findById).not.toHaveBeenCalled();
    });

    it('resolves the run, its Task and the Task owner', async () => {
      taskTopicModel.findByTopicId.mockResolvedValue(run);

      await expect(new TopicRunService(db, userId).resolveOwnableRun(topicId)).resolves.toEqual(
        link,
      );
    });

    it('falls back to the caller when the Task has no recorded creator', async () => {
      taskTopicModel.findByTopicId.mockResolvedValue(run);
      taskModel.findById.mockResolvedValue({ ...task, createdByUserId: null });

      await expect(
        new TopicRunService(db, userId).resolveOwnableRun(topicId),
      ).resolves.toMatchObject({ ownerUserId: userId });
    });

    it('refuses a run a live run already owns', async () => {
      // A second send is not a second Task run: taking the row over would steal
      // the operation id cancellation interrupts, and attaching a completion
      // hook would let this send settle the row while that run is still going.
      taskTopicModel.findByTopicId.mockResolvedValue({ ...run, status: 'running' });

      await expect(
        new TopicRunService(db, userId).resolveOwnableRun(topicId),
      ).resolves.toBeUndefined();
      expect(taskModel.findById).not.toHaveBeenCalled();
    });

    it('refuses a run whose Task was canceled', async () => {
      // There is no Task-side row left to keep honest, and settling one could
      // move a canceled Task back out of its terminal state. The message still
      // sends — as an ordinary turn in the conversation.
      taskTopicModel.findByTopicId.mockResolvedValue(run);
      taskModel.findById.mockResolvedValue({ ...task, status: 'canceled' });

      await expect(
        new TopicRunService(db, userId).resolveOwnableRun(topicId),
      ).resolves.toBeUndefined();
    });

    it('refuses a run whose Task is gone', async () => {
      taskTopicModel.findByTopicId.mockResolvedValue(run);
      taskModel.findById.mockResolvedValue(null);

      await expect(
        new TopicRunService(db, userId).resolveOwnableRun(topicId),
      ).resolves.toBeUndefined();
    });
  });

  describe('reopen', () => {
    it('puts the run back in flight and takes the Task back to running', async () => {
      const outcome = await new TopicRunService(db, userId).reopen({
        link,
        operationId: 'op-answer',
      });

      expect(outcome).toBe('reopened');
      expect(taskModel.lockForUpdate).toHaveBeenCalledWith('task-1');
      expect(taskTopicModel.reopenSettledRun).toHaveBeenCalledWith(topicId, 'op-answer');
      expect(taskTopicModel.clearTopicEnded).toHaveBeenCalledWith(topicId);
      expect(taskModel.updateStatusIfCurrent).toHaveBeenCalledWith(
        'task-1',
        'completed',
        'running',
        expect.objectContaining({ error: null }),
      );
    });

    it('writes under the Task owner, not the member who answered the run', async () => {
      await new TopicRunService(db, 'member-2').reopen({ link, operationId: 'op-answer' });

      expect(TaskModel).toHaveBeenCalledWith(expect.anything(), 'owner-1', undefined);
      expect(TaskTopicModel).toHaveBeenCalledWith(expect.anything(), 'owner-1', undefined);
    });

    it('reports a run a newer operation has taken over without writing anything', async () => {
      taskTopicModel.reopenSettledRun.mockResolvedValue(false);

      const outcome = await new TopicRunService(db, userId).reopen({
        link,
        operationId: 'op-queued',
      });

      expect(outcome).toBe('already-running');
      expect(taskTopicModel.clearTopicEnded).not.toHaveBeenCalled();
      expect(taskModel.updateStatusIfCurrent).not.toHaveBeenCalled();
    });

    it('refuses a Task retired while the run was starting', async () => {
      // The caller stops the run on this outcome: its hooks are already
      // attached, and a run the Task side never recorded must not be allowed to
      // settle the Task.
      taskModel.findById.mockResolvedValue({ ...task, status: 'canceled' });

      await expect(
        new TopicRunService(db, userId).reopen({ link, operationId: 'op-answer' }),
      ).resolves.toBe('refused');
      expect(taskTopicModel.reopenSettledRun).not.toHaveBeenCalled();
    });

    it('refuses a Task deleted while the run was starting', async () => {
      taskModel.lockForUpdate.mockResolvedValue(false);

      await expect(
        new TopicRunService(db, userId).reopen({ link, operationId: 'op-answer' }),
      ).resolves.toBe('refused');
      expect(taskTopicModel.reopenSettledRun).not.toHaveBeenCalled();
    });
  });
});
