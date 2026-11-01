// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { and, eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { taskActivities, tasks, users } from '@/database/schemas';

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

  describe('delete', () => {
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
