// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { tasks, users, workspaces } from '../../schemas';
import { TaskModel } from '../task';

const db = await getTestDB();
const userId = 'checkpoint-transfer-user';
const workspaceId = 'checkpoint-transfer-workspace';
const model = new TaskModel(db, userId);
const destination = new TaskModel(db, userId, workspaceId);
beforeEach(async () => {
  await db.insert(users).values({ id: userId });
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'target', slug: workspaceId, primaryOwnerId: userId });
  await destination.create({ instruction: 'existing destination task' });
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
});

describe.each(['copy', 'transfer'] as const)('checkpoint %s compatibility', (mode) => {
  it.each(['legacy', 'dual', 'stale', 'renamed'] as const)(
    'rewrites both representations from %s data',
    async (history) => {
      const parent = await model.create({ instruction: 'parent' });
      const a = await model.create({ instruction: 'child A', parentTaskId: parent.id });
      const b = await model.create({ instruction: 'child B', parentTaskId: parent.id });
      const label = history === 'stale' ? b.identifier : a.identifier;
      const pair = { id: a.id, identifier: a.identifier };
      await model.updateTaskConfig(parent.id, {
        checkpoint: {
          tasks: {
            beforeIds: [label],
            afterIds: [label],
            ...(history !== 'legacy' ? { beforeTasks: [pair], afterTasks: [pair] } : {}),
          },
        },
      });
      if (history === 'renamed') {
        await db.update(tasks).set({ identifier: 'REN-1' }).where(eq(tasks.id, a.id));
        await db.update(tasks).set({ identifier: a.identifier }).where(eq(tasks.id, b.id));
      }
      const rootId =
        mode === 'copy'
          ? (await model.copyToWorkspace(parent.id, workspaceId, userId)).rootId
          : (await model.transferTo(parent.id, workspaceId, userId), parent.id);
      const children = await destination.findSubtasks(rootId);
      const intended = children.find(
        (child) => child.instruction === (history === 'stale' ? 'child B' : 'child A'),
      )!;
      const other = children.find((child) => child.id !== intended.id)!;
      const stored = (await destination.findById(rootId))!;
      const refs = destination.getCheckpointConfig(stored).tasks!;
      const expected = { id: intended.id, identifier: intended.identifier };
      expect(refs).toEqual({
        beforeIds: [intended.identifier],
        beforeTasks: [expected],
        afterIds: [intended.identifier],
        afterTasks: [expected],
      });
      expect(refs.beforeIds?.includes(intended.identifier)).toBe(true);
      expect(refs.afterIds?.includes(intended.identifier)).toBe(true);
      expect(destination.shouldPauseBeforeStart(stored, intended)).toBe(true);
      expect(destination.shouldPauseBeforeStart(stored, other)).toBe(false);
      expect(destination.shouldPauseAfterComplete(stored, intended)).toBe(true);
      expect(
        mode === 'copy'
          ? intended.id !== a.id && intended.id !== b.id
          : [a.id, b.id].includes(intended.id),
      ).toBe(true);
    },
  );
});
