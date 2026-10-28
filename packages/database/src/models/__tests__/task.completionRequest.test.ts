// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-completion-request-user';
const otherUserId = 'task-completion-request-user-2';

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  await serverDB.delete(users);
});

/** A running task whose completion waits for `op-self` to end. */
const createPendingTask = async (model: TaskModel) => {
  const task = await model.create({ instruction: 'Deliver' });
  await model.updateStatus(task.id, 'running');
  await model.updateContext(task.id, {
    completion: { requestedByOperationId: 'op-self' },
    scheduler: { tickMessageId: 'msg-1' },
  });
  return task;
};

const requestOf = (task: { context?: unknown } | null) =>
  (task?.context as { completion?: { requestedByOperationId?: string | null } } | null)?.completion
    ?.requestedByOperationId;

describe('TaskModel deferred completion request', () => {
  describe('completeIfCompletionRequested', () => {
    it('completes the task and consumes the request in one write', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await createPendingTask(model);

      const completed = await model.completeIfCompletionRequested(task.id, 'op-self');

      expect(completed?.status).toBe('completed');
      expect(completed?.completedAt).toBeInstanceOf(Date);
      expect(requestOf(completed)).toBeNull();
      // Other context namespaces survive.
      expect((completed?.context as any)?.scheduler).toEqual({ tickMessageId: 'msg-1' });
    });

    it('leaves the task running once the request was withdrawn', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await createPendingTask(model);

      expect(await model.withdrawCompletionRequest(task.id, 'op-self')).toBe(true);
      expect(await model.completeIfCompletionRequested(task.id, 'op-self')).toBeNull();
      expect((await model.findById(task.id))?.status).toBe('running');
    });

    it('ignores a request held by another run', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await createPendingTask(model);

      expect(await model.completeIfCompletionRequested(task.id, 'op-other')).toBeNull();
      expect((await model.findById(task.id))?.status).toBe('running');
    });

    it("does not complete another user's task", async () => {
      const task = await createPendingTask(new TaskModel(serverDB, otherUserId));

      expect(
        await new TaskModel(serverDB, userId).completeIfCompletionRequested(task.id, 'op-self'),
      ).toBeNull();
    });
  });

  describe('withdrawCompletionRequest', () => {
    it('clears the request on a running task', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await createPendingTask(model);

      expect(await model.withdrawCompletionRequest(task.id, 'op-self')).toBe(true);
      const found = await model.findById(task.id);
      expect(found?.status).toBe('running');
      expect(requestOf(found)).toBeNull();
    });

    it('reports false once the run already consumed the request', async () => {
      const model = new TaskModel(serverDB, userId);
      const task = await createPendingTask(model);

      await model.completeIfCompletionRequested(task.id, 'op-self');

      expect(await model.withdrawCompletionRequest(task.id, 'op-self')).toBe(false);
      expect((await model.findById(task.id))?.status).toBe('completed');
    });
  });
});
