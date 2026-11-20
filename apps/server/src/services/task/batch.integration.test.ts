// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import {
  applyTaskReposSelection,
  readTaskExecutionConfig,
  toTaskExecutionConfigPatch,
} from '@lobechat/types';
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalModel } from '@/database/models/goal';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { agents, taskActivities, tasks, users, workspaces } from '@/database/schemas';
import { TaskRunnerService } from '@/server/services/taskRunner';

import { TaskBatchService } from './batch';

vi.mock('@/server/utils/scheduleAfterResponse', () => ({ after: vi.fn() }));

const userId = 'task-batch-integration-user';
const otherUserId = 'task-batch-integration-other';

// Module-level, like the database model tests: the first call migrates a
// fresh database, which can outlast a hook timeout on a loaded CI shard.
const db: LobeChatDatabase = await getTestDB();

const activitiesOf = (ids: string[], type: string) =>
  db
    .select()
    .from(taskActivities)
    .where(and(inArray(taskActivities.taskId, ids), eq(taskActivities.type, type)));

describe('TaskBatchService (real PostgreSQL)', () => {
  let model: TaskModel;
  let service: TaskBatchService;

  beforeEach(async () => {
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
    await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
    model = new TaskModel(db, userId);
    service = new TaskBatchService(db, userId);
  });

  afterEach(async () => {
    await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
  });

  const createTasks = async (count: number, data: Record<string, unknown> = {}) => {
    const created = [];
    for (let i = 0; i < count; i++) {
      created.push(await model.create({ instruction: `Task ${i}`, ...data }));
    }
    return created;
  };

  describe('updateFields', () => {
    it('sets priority on the whole selection and logs one activity per changed task', async () => {
      const [a, b, c] = await createTasks(3);
      await model.update(c.id, { priority: 2 });
      const foreign = await new TaskModel(db, otherUserId).create({ instruction: 'Not mine' });

      const { result } = await service.updateFields(
        [a.id, b.id, c.id, foreign.id, 'task_missing'],
        { priority: 2 },
        { userId },
      );

      expect(result.updated.sort()).toEqual([a.id, b.id].sort());
      expect(result.skipped).toEqual(
        expect.arrayContaining([
          { id: c.id, reason: 'unchanged' },
          { id: foreign.id, reason: 'notFound' },
          { id: 'task_missing', reason: 'notFound' },
        ]),
      );
      expect((await model.findById(a.id))?.priority).toBe(2);
      expect((await new TaskModel(db, otherUserId).findById(foreign.id))?.priority).toBe(0);

      const logged = await activitiesOf([a.id, b.id, c.id], 'priority');
      expect(logged.map((row) => row.taskId).sort()).toEqual([a.id, b.id].sort());
      expect(logged[0].payload).toMatchObject({ from: 0, to: 2 });
    });

    it('reassigns tasks in one statement and drops only the previous agent repo selection', async () => {
      await db.insert(agents).values([
        { id: 'agt_batch_a', slug: 'agt_batch_a', userId },
        { id: 'agt_batch_b', slug: 'agt_batch_b', userId },
      ]);
      const withRepos = await createTasks(2, { assigneeAgentId: 'agt_batch_a' });
      for (const task of withRepos) {
        await model.updateTaskConfig(task.id, {
          checkpoint: { onAgentRequest: true },
          execution: toTaskExecutionConfigPatch(
            applyTaskReposSelection(undefined, ['lobehub/lobehub']),
          ),
        });
      }
      const [unassigned] = await createTasks(1, {
        config: { checkpoint: { onAgentRequest: false } },
      });
      const ids = [...withRepos.map((task) => task.id), unassigned.id];

      const { result } = await service.updateFields(
        ids,
        { assigneeAgentId: 'agt_batch_b' },
        { userId },
      );

      expect(result.updated.sort()).toEqual([...ids].sort());
      for (const task of withRepos) {
        const stored = await model.findById(task.id);
        expect(stored?.assigneeAgentId).toBe('agt_batch_b');
        expect(readTaskExecutionConfig(stored?.config as Record<string, unknown>)).toBeUndefined();
        // Only the repo selection goes; the rest of the config stays.
        expect((stored?.config as any).checkpoint).toEqual({ onAgentRequest: true });
      }
      const other = await model.findById(unassigned.id);
      expect(other?.assigneeAgentId).toBe('agt_batch_b');
      expect(other?.config).toEqual({ checkpoint: { onAgentRequest: false } });
      expect(await activitiesOf(ids, 'assignee_agent')).toHaveLength(3);
    });

    it('assigns a member and leaves running tasks alone', async () => {
      const [idle, running] = await createTasks(2);
      await model.update(running.id, { status: 'running' });

      const { result } = await service.updateFields(
        [idle.id, running.id],
        { assigneeUserId: userId },
        { userId },
      );

      expect(result.updated).toEqual([idle.id]);
      expect(result.skipped).toEqual([{ id: running.id, reason: 'running' }]);
      expect((await model.findById(idle.id))?.assigneeUserId).toBe(userId);
      expect((await model.findById(running.id))?.assigneeUserId).toBeNull();
      expect(await activitiesOf([idle.id], 'assignee_user')).toHaveLength(1);
    });

    it('rejects an empty patch', async () => {
      const [task] = await createTasks(1);
      await expect(service.updateFields([task.id], {}, { userId })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });

    it('updates hundreds of tasks in one call', async () => {
      const many = await createTasks(300);
      const ids = many.map((task) => task.id);

      const { result } = await service.updateFields(ids, { priority: 1 }, { userId });

      expect(result.updated).toHaveLength(300);
      const stored = await db.select().from(tasks).where(inArray(tasks.id, ids));
      expect(stored.every((task) => task.priority === 1)).toBe(true);
      expect(await activitiesOf(ids, 'priority')).toHaveLength(300);
    });
  });

  describe('updateStatus', () => {
    it('moves the selection to one status, stamps completion and logs transitions', async () => {
      const [a, b, done] = await createTasks(3);
      await model.update(done.id, { status: 'completed' });

      const { result } = await service.updateStatus([a.id, b.id, done.id], 'completed', {
        userId,
      });

      expect(result.updated.sort()).toEqual([a.id, b.id].sort());
      expect(result.skipped).toEqual([{ id: done.id, reason: 'unchanged' }]);
      const stored = await model.findById(a.id);
      expect(stored?.status).toBe('completed');
      expect(stored?.completedAt).toBeInstanceOf(Date);

      const logged = await activitiesOf([a.id, b.id, done.id], 'status');
      expect(logged).toHaveLength(2);
      expect(logged[0].payload).toMatchObject({ from: 'backlog', to: 'completed' });
    });

    it('pauses a parent whose checkpoint asks to review completed subtasks', async () => {
      const parent = await model.create({ instruction: 'Parent' });
      const [child] = await createTasks(1, { parentTaskId: parent.id });
      await model.updateCheckpointConfig(parent.id, { tasks: { afterIds: [child.identifier] } });
      await model.update(parent.id, { status: 'running' });

      await service.updateStatus([child.id], 'completed', { userId });

      expect((await model.findById(parent.id))?.status).toBe('paused');
    });

    it('keeps a committed completion when its follow-ups fail, and reports it', async () => {
      const [task] = await createTasks(1);
      const spy = vi
        .spyOn(TaskRunnerService.prototype, 'cascadeOnCompletionMany')
        .mockRejectedValueOnce(new Error('dependency discovery failed'));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = await service.updateStatus([task.id], 'completed', { userId });

      expect(spy).toHaveBeenCalled();
      expect(result.updated).toEqual([task.id]);
      expect(result.failed).toEqual([]);
      expect(result.followUpFailed).toBe(true);
      expect((await model.findById(task.id))?.status).toBe('completed');
      spy.mockRestore();
    });

    it('does not pause a parent that was finished after the snapshot', async () => {
      const parent = await model.create({ instruction: 'Parent' });
      const [child] = await createTasks(1, { parentTaskId: parent.id });
      await model.updateCheckpointConfig(parent.id, { tasks: { afterIds: [child.identifier] } });
      await model.update(parent.id, { status: 'running' });
      // Another request cancels the parent between the snapshot and the pause.
      const original = TaskModel.prototype.findByIds;
      const spy = vi.spyOn(TaskModel.prototype, 'findByIds').mockImplementation(async function (
        this: TaskModel,
        ids: string[],
      ) {
        const rows = await original.call(this, ids);
        if (ids.includes(parent.id)) {
          await new TaskModel(db, userId).update(parent.id, { status: 'canceled' });
        }
        return rows;
      });

      await service.updateStatus([child.id], 'completed', { userId });
      spy.mockRestore();

      expect((await model.findById(parent.id))?.status).toBe('canceled');
    });

    it('leaves a task whose run is still starting alone instead of stopping it blind', async () => {
      const [starting, stale, idle] = await createTasks(3);
      // Just dispatched: running, no recorded topic / operation yet.
      await model.update(starting.id, { startedAt: new Date(), status: 'running' });
      // A start that died long ago: past the grace window, safe to stop.
      await model.update(stale.id, {
        startedAt: new Date(Date.now() - 10 * 60 * 1000),
        status: 'running',
      });

      const { result } = await service.updateStatus([starting.id, stale.id, idle.id], 'paused', {
        userId,
      });

      expect(result.updated.sort()).toEqual([stale.id, idle.id].sort());
      expect(result.skipped).toEqual([{ id: starting.id, reason: 'running' }]);
      expect((await model.findById(starting.id))?.status).toBe('running');
    });

    it('skips a task that started running after the interrupt pass', async () => {
      const [task] = await createTasks(1);
      const original = TaskTopicModel.prototype.findRunningByTaskIds;
      const spy = vi
        .spyOn(TaskTopicModel.prototype, 'findRunningByTaskIds')
        .mockImplementationOnce(async function (this: TaskTopicModel, ids: string[]) {
          const topics = await original.call(this, ids);
          // A run starts right after the snapshot was checked.
          await new TaskModel(db, userId).update(task.id, {
            startedAt: new Date(),
            status: 'running',
          });
          return topics;
        });

      const { result } = await service.updateStatus([task.id], 'completed', { userId });
      spy.mockRestore();

      expect(result.updated).toEqual([]);
      expect(result.skipped).toEqual([{ id: task.id, reason: 'running' }]);
      expect((await model.findById(task.id))?.status).toBe('running');
    });

    it('does not re-open a parent completed in the same batch', async () => {
      const parent = await model.create({ instruction: 'Parent' });
      const [child] = await createTasks(1, { parentTaskId: parent.id });
      await model.updateCheckpointConfig(parent.id, { tasks: { afterIds: [child.identifier] } });

      await service.updateStatus([parent.id, child.id], 'completed', { userId });

      expect((await model.findById(parent.id))?.status).toBe('completed');
    });

    it('skips an archived task the status would make live instead of failing the batch', async () => {
      const [plain, archived] = await createTasks(2);
      await model.update(archived.id, {
        automationMode: 'schedule',
        schedulePattern: '0 9 * * *',
        status: 'paused',
      });
      await db.update(tasks).set({ archivedAt: new Date() }).where(eq(tasks.id, archived.id));

      const { result } = await service.updateStatus([plain.id, archived.id], 'backlog', {
        userId,
      });

      expect(result.updated).toEqual([]);
      expect(result.skipped).toEqual(
        expect.arrayContaining([
          { id: plain.id, reason: 'unchanged' },
          { id: archived.id, reason: 'invalid' },
        ]),
      );
      expect((await model.findById(archived.id))?.status).toBe('paused');
    });
  });

  describe('archive', () => {
    it('archives idle tasks, skips running ones, and restores them again', async () => {
      const [idle, running] = await createTasks(2);
      await model.update(running.id, { status: 'running' });

      const archived = await service.archive([idle.id, running.id], true);
      expect(archived.updated).toEqual([idle.id]);
      expect(archived.skipped).toEqual([{ id: running.id, reason: 'running' }]);
      expect((await model.findById(idle.id))?.archivedAt).toBeInstanceOf(Date);

      const again = await service.archive([idle.id], true);
      expect(again.skipped).toEqual([{ id: idle.id, reason: 'unchanged' }]);

      const restored = await service.archive([idle.id, running.id], false);
      expect(restored.updated).toEqual([idle.id]);
      expect((await model.findById(idle.id))?.archivedAt).toBeNull();
    });
  });

  describe('archive (goals)', () => {
    it('skips tasks an open goal still owns and archives the rest', async () => {
      const [carrier, loose] = await createTasks(2);
      await new GoalModel(db, userId).create({
        subjectId: carrier.id,
        subjectType: 'task',
        title: 'Open goal',
      });

      const result = await service.archive([carrier.id, loose.id], true);

      expect(result.updated).toEqual([loose.id]);
      expect(result.skipped).toEqual([{ id: carrier.id, reason: 'inGoal' }]);
      expect((await model.findById(carrier.id))?.archivedAt).toBeNull();
    });
  });

  describe('delete', () => {
    it("deletes other members' visible workspace tasks, like the single-task delete", async () => {
      const workspaceId = 'task-batch-delete-ws';
      await db.insert(workspaces).values({
        id: workspaceId,
        name: 'Workspace',
        primaryOwnerId: otherUserId,
        slug: workspaceId,
      });
      const teammate = new TaskModel(db, otherUserId, workspaceId);
      const shared = await teammate.create({ instruction: 'Teammate task', visibility: 'public' });
      const hidden = await teammate.create({
        instruction: 'Teammate private',
        visibility: 'private',
      });
      const own = await new TaskModel(db, userId, workspaceId).create({
        instruction: 'My task',
        visibility: 'public',
      });

      const result = await new TaskBatchService(db, userId, workspaceId).delete([
        shared.id,
        own.id,
        hidden.id,
      ]);

      expect(result.updated.sort()).toEqual([shared.id, own.id].sort());
      // A teammate's private task is not visible, so it is reported, not touched.
      expect(result.skipped).toEqual([{ id: hidden.id, reason: 'notFound' }]);
      expect(await teammate.findById(shared.id)).toBeNull();
      expect(await teammate.findById(hidden.id)).not.toBeNull();
    });

    it('deletes idle tasks in one pass and reports missing ones', async () => {
      const [a, b] = await createTasks(2);
      const keep = (await createTasks(1))[0];

      const result = await service.delete([a.id, b.id, 'task_missing']);

      expect(result.updated.sort()).toEqual([a.id, b.id].sort());
      expect(result.skipped).toEqual([{ id: 'task_missing', reason: 'notFound' }]);
      expect(await model.findById(a.id)).toBeNull();
      expect(await model.findById(keep.id)).not.toBeNull();
    });
  });
});
