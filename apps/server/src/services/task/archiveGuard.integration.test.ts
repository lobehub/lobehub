// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GoalModel } from '@/database/models/goal';
import { TaskModel } from '@/database/models/task';
import { TaskArchiveModel } from '@/database/models/taskArchive';
import { goals, tasks, users } from '@/database/schemas';

import {
  assertNotInOpenGoal,
  findTasksInOpenGoals,
  writeKeepingArchivedIdle,
} from './archiveGuard';

const userId = 'archive-guard-integration-user';

// Module-level, like the database model tests: the first call migrates a
// fresh database, which can outlast a hook timeout on a loaded CI shard.
const db: LobeChatDatabase = await getTestDB();

describe('writeKeepingArchivedIdle (real PostgreSQL)', () => {
  beforeEach(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await db.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await db.delete(users).where(eq(users.id, userId));
  });

  it('rolls back a write that would make an already archived task live', async () => {
    const model = new TaskModel(db, userId);
    const task = await model.create({ instruction: 'Idle task' });
    // The archive commits first, as it would in a concurrent request.
    await new TaskArchiveModel(db, userId).archive(task.id);

    await expect(
      writeKeepingArchivedIdle(db, (tx) =>
        new TaskModel(tx, userId).update(task.id, {
          automationMode: 'heartbeat',
          heartbeatInterval: 600,
        }),
      ),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    const stored = await model.findById(task.id);
    expect(stored?.archivedAt).toBeInstanceOf(Date);
    expect(stored?.automationMode).toBeNull();
    expect(stored?.heartbeatInterval).toBeNull();
  });

  it('rolls back every statement of the transaction', async () => {
    const model = new TaskModel(db, userId);
    const task = await model.create({ instruction: 'Idle task' });

    await expect(
      writeKeepingArchivedIdle(db, async (tx) => {
        const [row] = await tx
          .update(tasks)
          .set({ archivedAt: new Date(), status: 'running' })
          .where(eq(tasks.id, task.id))
          .returning();
        return row;
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    const stored = await model.findById(task.id);
    expect(stored?.archivedAt).toBeNull();
    expect(stored?.status).toBe('backlog');
  });

  it('lets an idle write through', async () => {
    const model = new TaskModel(db, userId);
    const task = await model.create({ instruction: 'Idle task' });
    await new TaskArchiveModel(db, userId).archive(task.id);

    const renamed = await writeKeepingArchivedIdle(db, (tx) =>
      new TaskModel(tx, userId).update(task.id, { name: 'Renamed' }),
    );
    expect(renamed?.name).toBe('Renamed');
  });

  describe('assertNotInOpenGoal', () => {
    it('refuses an unfinished task on an open goal, and allows it once the goal ends', async () => {
      const task = await new TaskModel(db, userId).create({ instruction: 'Goal task' });
      const goal = await new GoalModel(db, userId).create({
        subjectId: task.id,
        subjectType: 'task',
        title: 'Open goal',
      });

      await expect(assertNotInOpenGoal(db, { userId }, task)).rejects.toMatchObject({
        code: 'CONFLICT',
      });

      await db.update(goals).set({ status: 'achieved' }).where(eq(goals.id, goal.id));
      await expect(assertNotInOpenGoal(db, { userId }, task)).resolves.toBeUndefined();
    });

    it('allows a finished task and a task with no goal', async () => {
      const model = new TaskModel(db, userId);
      const done = await model.create({ instruction: 'Done goal task' });
      await new GoalModel(db, userId).create({
        subjectId: done.id,
        subjectType: 'task',
        title: 'Open goal',
      });
      const loose = await model.create({ instruction: 'Loose task' });

      await expect(
        assertNotInOpenGoal(db, { userId }, { ...done, status: 'completed' }),
      ).resolves.toBeUndefined();
      await expect(assertNotInOpenGoal(db, { userId }, loose)).resolves.toBeUndefined();
    });
  });

  describe('findTasksInOpenGoals', () => {
    it('agrees with assertNotInOpenGoal for carriers, descendants, finished and closed-goal tasks', async () => {
      const model = new TaskModel(db, userId);
      const carrier = await model.create({ instruction: 'Open goal carrier' });
      await new GoalModel(db, userId).create({
        subjectId: carrier.id,
        subjectType: 'task',
        title: 'Open goal',
      });
      const child = await model.create({ instruction: 'Child', parentTaskId: carrier.id });
      const grandchild = await model.create({ instruction: 'Grandchild', parentTaskId: child.id });
      const closedCarrier = await model.create({ instruction: 'Closed goal carrier' });
      const closed = await new GoalModel(db, userId).create({
        subjectId: closedCarrier.id,
        subjectType: 'task',
        title: 'Closed goal',
      });
      await db.update(goals).set({ status: 'achieved' }).where(eq(goals.id, closed.id));
      const loose = await model.create({ instruction: 'Loose task' });
      const finished = {
        ...(await model.create({ instruction: 'Finished' })),
        status: 'completed',
      };
      await new GoalModel(db, userId).create({
        subjectId: finished.id,
        subjectType: 'task',
        title: 'Open goal on finished task',
      });

      const all = [carrier, child, grandchild, closedCarrier, loose, finished];
      const blocked = await findTasksInOpenGoals(db, { userId }, all);

      expect([...blocked].sort()).toEqual([carrier.id, child.id, grandchild.id].sort());
      // Same answer as the single-task guard, task by task.
      for (const task of all) {
        const single = await assertNotInOpenGoal(db, { userId }, task).then(
          () => false,
          () => true,
        );
        expect(single).toBe(blocked.has(task.id));
      }
      expect(await findTasksInOpenGoals(db, { userId }, [])).toEqual(new Set());
    });
  });
});
