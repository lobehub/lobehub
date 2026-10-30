// @vitest-environment node
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { tasks, users, workspaces } from '../../schemas';
import { TaskModel } from '../task';
import { WorkModel } from '../work';

const db = await getTestDB();
const userId = 'task-refs-user';
const otherId = 'task-refs-other';
const wsId = 'task-refs-ws';
const model = new TaskModel(db, userId);
beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherId }]);
  await db
    .insert(workspaces)
    .values({ id: wsId, name: 'refs', slug: wsId, primaryOwnerId: userId })
    .onConflictDoNothing();
});
afterEach(async () => {
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, otherId));
});

describe('Task stable refs', () => {
  it('maps mixed refs in input order, deduplicates aliases and excludes invisible rows', async () => {
    const a = await model.create({ instruction: 'a' });
    const b = await model.create({ instruction: 'b' });
    const other = await new TaskModel(db, otherId).create({ instruction: 'other' });
    const result = await model.resolveRefs([
      b.identifier.toLowerCase(),
      a.id,
      b.id,
      other.id,
      'missing',
    ]);
    expect(result.tasks.map((t) => t.id)).toEqual([b.id, a.id]);
    expect(result.byRef.get(b.identifier.toLowerCase())?.id).toBe(b.id);
    expect(result.missing).toEqual([other.id, 'missing']);
    expect(result.ambiguous).toEqual([]);
    expect((await model.resolveRefs([])).tasks).toEqual([]);
    await db.update(tasks).set({ isDeleted: true }).where(eq(tasks.id, a.id));
    expect((await model.resolveRefs([a.id, a.identifier])).missing).toEqual([a.id, a.identifier]);
  });

  it('isolates personal and workspace identifiers and hides other members private tasks', async () => {
    const personal = await model.create({ instruction: 'personal' });
    const workspace = new TaskModel(db, userId, wsId);
    const publicTask = await workspace.create({ instruction: 'public', visibility: 'public' });
    const privateTask = await workspace.create({ instruction: 'private', visibility: 'private' });
    expect(personal.identifier).toBe(publicTask.identifier);
    expect((await workspace.resolve(personal.identifier))?.id).toBe(publicTask.id);
    const teammate = new TaskModel(db, otherId, wsId);
    expect((await teammate.resolve(publicTask.id))?.id).toBe(publicTask.id);
    expect(
      (await teammate.resolveRefs([privateTask.id, privateTask.identifier, personal.id])).missing,
    ).toEqual([privateTask.id, privateTask.identifier, personal.id]);
  });

  it('never registers Work on a replacement task when the stable id is gone', async () => {
    const a = await model.create({ instruction: 'old' });
    await model.delete(a.id);
    const b = await model.create({ instruction: 'replacement' });
    expect(b.identifier).toBe(a.identifier);
    const result = await new WorkModel(db, userId).registerTask({
      taskId: a.id,
      taskIdentifier: a.identifier,
      changeType: 'created',
      toolName: 'createTask',
      toolIdentifier: 'lobe-task',
    });
    expect(result).toBeNull();
  });

  it('matches canonical and historical checkpoint entries without activating lowercase history', async () => {
    const child = await model.create({ instruction: 'child' });
    const parent = await model.create({
      instruction: 'parent',
      config: {
        checkpoint: {
          tasks: {
            beforeIds: [child.identifier],
            beforeTasks: [{ id: child.id, identifier: child.identifier }],
            afterIds: [child.identifier],
          },
        },
      },
    });
    expect(model.shouldPauseBeforeStart(parent, child)).toBe(true);
    expect(model.shouldPauseAfterComplete(parent, child)).toBe(true);
    const lowercase = {
      ...parent,
      config: { checkpoint: { tasks: { beforeIds: [child.identifier.toLowerCase()] } } },
    };
    expect(model.shouldPauseBeforeStart(lowercase, child)).toBe(false);
  });

  it('rewrites checkpoint refs after copy and transfer', async () => {
    const parent = await model.create({ instruction: 'parent' });
    const child = await model.create({ instruction: 'child', parentTaskId: parent.id });
    await model.update(parent.id, {
      config: {
        checkpoint: {
          tasks: {
            beforeIds: [child.identifier],
            afterIds: [child.identifier],
            afterTasks: [{ id: child.id, identifier: child.identifier }],
          },
        },
      },
    });
    const { rootId } = await model.copyToWorkspace(parent.id, wsId, userId);
    const workspace = new TaskModel(db, userId, wsId);
    const [copiedChild] = await workspace.findSubtasks(rootId);
    const copied = await workspace.findById(rootId);
    expect(workspace.getCheckpointConfig(copied!).tasks).toEqual({
      beforeIds: [copiedChild.identifier],
      beforeTasks: [{ id: copiedChild.id, identifier: copiedChild.identifier }],
      afterIds: [copiedChild.identifier],
      afterTasks: [{ id: copiedChild.id, identifier: copiedChild.identifier }],
    });
    await model.transferTo(parent.id, wsId, userId);
    const moved = await workspace.findById(parent.id);
    const movedChild = (await workspace.findById(child.id))!;
    expect(workspace.getCheckpointConfig(moved!).tasks).toMatchObject({
      beforeIds: [movedChild.identifier],
      beforeTasks: [{ id: child.id, identifier: movedChild.identifier }],
    });
  });
});
