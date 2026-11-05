// @vitest-environment node
import { and, eq, isNull, like, or } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { taskLabelLinks, taskLabels, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';
import { TaskLabelError, TaskLabelModel } from '../taskLabel';
import { UserModel } from '../user';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-label-test-user';
const otherUserId = 'task-label-test-user-2';
const workspaceId = 'task-label-test-ws';
const otherWorkspaceId = 'task-label-test-ws-2';

const personal = new TaskLabelModel(serverDB, userId);
const workspace = new TaskLabelModel(serverDB, userId, workspaceId);
const member = new TaskLabelModel(serverDB, otherUserId, workspaceId);

beforeEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: workspaceId },
    { id: otherWorkspaceId, name: 'WS 2', primaryOwnerId: userId, slug: otherWorkspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(users);
  await serverDB.delete(workspaces);
});

const expectCode = async (promise: Promise<unknown>, code: TaskLabelError['code']) => {
  await expect(promise).rejects.toBeInstanceOf(TaskLabelError);
  await expect(promise).rejects.toMatchObject({ code });
};

describe('TaskLabelModel registry', () => {
  it('scopes labels per workspace and per personal owner', async () => {
    await personal.create({ name: 'Mine' });
    await workspace.create({ color: '#EB5757', name: 'Shared' });

    expect((await personal.query()).map((l) => l.name)).toEqual(['Mine']);
    expect((await workspace.query()).map((l) => l.name)).toEqual(['Shared']);
    // every workspace member shares the registry
    expect((await member.query()).map((l) => l.name)).toEqual(['Shared']);
    // personal labels never leak to another user
    expect(await new TaskLabelModel(serverDB, otherUserId).query()).toHaveLength(0);
  });

  it('rejects a duplicate name in the same scope case-insensitively', async () => {
    await workspace.create({ name: 'Bug' });
    await expect(member.create({ name: 'bug' })).rejects.toThrow();
    // the same name is fine in another scope
    await expect(personal.create({ name: 'Bug' })).resolves.toBeDefined();
  });

  it('nests labels one level under a group only', async () => {
    const group = await workspace.create({ isGroup: true, name: 'Type' });
    const bug = await workspace.create({ name: 'Bug', parentId: group.id });
    expect(bug.parentId).toBe(group.id);

    await expectCode(
      workspace.create({ isGroup: true, name: 'Nested', parentId: group.id }),
      'INVALID_PARENT',
    );
    await expectCode(workspace.create({ name: 'Child', parentId: bug.id }), 'INVALID_PARENT');
    // a group from another scope is not a valid parent
    const foreign = await personal.create({ isGroup: true, name: 'Foreign' });
    await expectCode(workspace.create({ name: 'X', parentId: foreign.id }), 'INVALID_PARENT');
  });

  it('deleting a group deletes its labels and their task links', async () => {
    const tasks = new TaskModel(serverDB, userId, workspaceId);
    const task = await tasks.create({ instruction: 'a' });
    const group = await workspace.create({ isGroup: true, name: 'Type' });
    const bug = await workspace.create({ name: 'Bug', parentId: group.id });
    await workspace.addTaskLabels(task.id, [bug.id]);

    await workspace.delete(group.id);

    expect(await workspace.query()).toHaveLength(0);
    expect(await workspace.getTaskLabels(task.id)).toEqual([]);
  });

  it('counts only tasks visible to the caller', async () => {
    const label = await workspace.create({ name: 'Shared' });
    const own = await new TaskModel(serverDB, userId, workspaceId).create({ instruction: 'mine' });
    const othersPrivate = await new TaskModel(serverDB, otherUserId, workspaceId).create({
      instruction: 'secret',
      visibility: 'private',
    });
    await workspace.addTaskLabels(own.id, [label.id]);
    await member.addTaskLabels(othersPrivate.id, [label.id]);

    expect((await workspace.query())[0].usageCount).toBe(1);
    expect((await member.query())[0].usageCount).toBe(2);
  });

  it('checks a regroup against the parent under the lock, not a stale read', async () => {
    const task = await new TaskModel(serverDB, userId, workspaceId).create({ instruction: 'a' });
    const groupA = await workspace.create({ isGroup: true, name: 'A' });
    const groupB = await workspace.create({ isGroup: true, name: 'B' });
    const label = await workspace.create({ name: 'L', parentId: groupA.id });
    const sibling = await workspace.create({ name: 'S', parentId: groupA.id });
    const staleRead = await workspace.findById(label.id);

    // Meanwhile: L moves to B and the task gains L plus A's sibling.
    await workspace.update(label.id, { parentId: groupB.id });
    await workspace.addTaskLabels(task.id, [label.id, sibling.id]);

    // A writer that read L while it was still in A submits "parent A".
    const stale = new TaskLabelModel(serverDB, userId, workspaceId);
    stale.findById = async () => staleRead;
    await expectCode(stale.update(label.id, { parentId: groupA.id }), 'GROUP_CONFLICT');
    expect((await workspace.findById(label.id))?.parentId).toBe(groupB.id);
  });

  it('refuses to move a label into a group when a task would end up with two', async () => {
    const task = await new TaskModel(serverDB, userId, workspaceId).create({ instruction: 'a' });
    const group = await workspace.create({ isGroup: true, name: 'Type' });
    const bug = await workspace.create({ name: 'Bug', parentId: group.id });
    const loose = await workspace.create({ name: 'Feature' });
    await workspace.addTaskLabels(task.id, [bug.id, loose.id]);

    await expectCode(workspace.update(loose.id, { parentId: group.id }), 'GROUP_CONFLICT');

    const other = await workspace.create({ name: 'Chore' });
    await expect(workspace.update(other.id, { parentId: group.id })).resolves.toMatchObject({
      parentId: group.id,
    });
  });
});

describe('TaskLabelModel account deletion', () => {
  it("keeps a workspace label and its links when the label's creator is deleted", async () => {
    const task = await new TaskModel(serverDB, userId, workspaceId).create({ instruction: 'a' });
    const label = await member.create({ name: 'Frontend' });
    await workspace.addTaskLabels(task.id, [label.id]);

    await UserModel.deleteUser(serverDB, otherUserId);

    expect(await workspace.findById(label.id)).toMatchObject({ name: 'Frontend', userId: null });
    expect((await workspace.getTaskLabels(task.id)).map((l) => l.name)).toEqual(['Frontend']);
  });

  it('never orphans a personal label created while its owner is being deleted', async () => {
    const personalOther = new TaskLabelModel(serverDB, otherUserId);
    await Promise.allSettled([
      ...Array.from({ length: 5 }, (_, i) => personalOther.create({ name: `Racing ${i}` })),
      UserModel.deleteUser(serverDB, otherUserId),
      ...Array.from({ length: 5 }, (_, i) => personalOther.create({ name: `Late ${i}` })),
    ]);

    const orphans = await serverDB
      .select()
      .from(taskLabels)
      .where(
        and(
          isNull(taskLabels.userId),
          isNull(taskLabels.workspaceId),
          or(like(taskLabels.name, 'Racing %'), like(taskLabels.name, 'Late %')),
        ),
      );
    expect(orphans).toEqual([]);
  });

  it('deletes personal labels with their owner', async () => {
    const own = await new TaskLabelModel(serverDB, otherUserId).create({ name: 'Mine' });

    await UserModel.deleteUser(serverDB, otherUserId);

    const rows = await serverDB.select().from(taskLabels).where(eq(taskLabels.id, own.id));
    expect(rows).toEqual([]);
  });
});

describe('TaskLabelModel task assignments', () => {
  it('adds, lists and removes labels on a task', async () => {
    const task = await new TaskModel(serverDB, userId, workspaceId).create({ instruction: 'a' });
    const a = await workspace.create({ color: '#4CB782', name: 'Alpha' });
    const b = await workspace.create({ name: 'Beta' });

    const added = await workspace.addTaskLabels(task.id, [a.id, b.id, a.id]);
    expect(added.map((l) => l.name)).toEqual(['Alpha', 'Beta']);
    expect(added[0]).toMatchObject({ color: '#4CB782', id: a.id });

    const removed = await workspace.removeTaskLabels(task.id, [a.id]);
    expect(removed.map((l) => l.name)).toEqual(['Beta']);
  });

  it('replaces the sibling when attaching another label of the same group', async () => {
    const task = await new TaskModel(serverDB, userId, workspaceId).create({ instruction: 'a' });
    const group = await workspace.create({ isGroup: true, name: 'Type' });
    const bug = await workspace.create({ name: 'Bug', parentId: group.id });
    const feature = await workspace.create({ name: 'Feature', parentId: group.id });
    const loose = await workspace.create({ name: 'Frontend' });

    await workspace.addTaskLabels(task.id, [bug.id, loose.id]);
    const next = await workspace.addTaskLabels(task.id, [feature.id]);

    expect(next.map((l) => l.name).sort()).toEqual(['Feature', 'Frontend']);
  });

  it("keeps a teammate's label on a shared task after the teammate's account is deleted", async () => {
    const task = await new TaskModel(serverDB, userId, workspaceId).create({ instruction: 'a' });
    const label = await workspace.create({ name: 'Frontend' });

    await member.addTaskLabels(task.id, [label.id]);
    const [link] = await serverDB.select().from(taskLabelLinks);
    expect(link.userId).toBe(userId);

    await serverDB.delete(users).where(eq(users.id, otherUserId));
    expect((await workspace.getTaskLabels(task.id)).map((l) => l.name)).toEqual(['Frontend']);
  });

  it('keeps one label per group when siblings are attached concurrently', async () => {
    const task = await new TaskModel(serverDB, userId, workspaceId).create({ instruction: 'a' });
    const group = await workspace.create({ isGroup: true, name: 'Type' });
    const bug = await workspace.create({ name: 'Bug', parentId: group.id });
    const feature = await workspace.create({ name: 'Feature', parentId: group.id });
    const chore = await workspace.create({ name: 'Chore', parentId: group.id });

    await Promise.all([
      workspace.addTaskLabels(task.id, [bug.id]),
      member.addTaskLabels(task.id, [feature.id]),
      workspace.setTaskLabels(task.id, [chore.id]),
    ]);

    const labels = await workspace.getTaskLabels(task.id);
    expect(labels).toHaveLength(1);
    expect(labels[0].parentId).toBe(group.id);
  });

  it('keeps one label per group when a label is regrouped during an assignment', async () => {
    const taskModel = new TaskModel(serverDB, userId, workspaceId);
    const group = await workspace.create({ isGroup: true, name: 'Type' });
    const sibling = await workspace.create({ name: 'Bug', parentId: group.id });

    for (let round = 0; round < 4; round++) {
      // T carries the loose label and gains the sibling; T2 carries the
      // sibling and gains the loose label — both while the label joins Type.
      const loose = await workspace.create({ name: `Loose ${round}` });
      const task = await taskModel.create({ instruction: `a${round}` });
      const task2 = await taskModel.create({ instruction: `b${round}` });
      await workspace.addTaskLabels(task.id, [loose.id]);
      await workspace.addTaskLabels(task2.id, [sibling.id]);

      const results = await Promise.allSettled([
        workspace.update(loose.id, { parentId: group.id }),
        member.addTaskLabels(task.id, [sibling.id]),
        member.addTaskLabels(task2.id, [loose.id]),
      ]);
      // Losing the race is a clean rule error, never a deadlock or a DB error.
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toMatchObject({ code: 'GROUP_CONFLICT' });
        }
      }

      const parentOf = new Map(
        (await workspace.query()).map((label) => [label.id, label.parentId]),
      );
      for (const id of [task.id, task2.id]) {
        const inGroup = (await workspace.getTaskLabels(id)).filter(
          (label) => parentOf.get(label.id) === group.id,
        );
        expect(inGroup.length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('rejects groups, two labels of one group, and labels from another scope', async () => {
    const task = await new TaskModel(serverDB, userId, workspaceId).create({ instruction: 'a' });
    const group = await workspace.create({ isGroup: true, name: 'Type' });
    const bug = await workspace.create({ name: 'Bug', parentId: group.id });
    const feature = await workspace.create({ name: 'Feature', parentId: group.id });
    const foreign = await personal.create({ name: 'Personal' });

    await expectCode(workspace.addTaskLabels(task.id, [group.id]), 'GROUP_NOT_ASSIGNABLE');
    await expectCode(workspace.setTaskLabels(task.id, [bug.id, feature.id]), 'GROUP_CONFLICT');
    await expectCode(workspace.addTaskLabels(task.id, [foreign.id]), 'LABEL_NOT_FOUND');
  });

  it('changeTaskLabels applies removals and additions together, or not at all', async () => {
    const task = await new TaskModel(serverDB, userId, workspaceId).create({ instruction: 'a' });
    const frontend = await workspace.create({ name: 'Frontend' });
    const backend = await workspace.create({ name: 'Backend' });
    const foreign = await personal.create({ name: 'Personal' });
    await workspace.addTaskLabels(task.id, [frontend.id]);

    await expectCode(
      workspace.changeTaskLabels(task.id, { add: [foreign.id], remove: [frontend.id] }),
      'LABEL_NOT_FOUND',
    );
    expect((await workspace.getTaskLabels(task.id)).map((l) => l.name)).toEqual(['Frontend']);

    const next = await workspace.changeTaskLabels(task.id, {
      add: [backend.id],
      remove: [frontend.id],
    });
    expect(next.map((l) => l.name)).toEqual(['Backend']);
  });

  it('setTaskLabels replaces the full set', async () => {
    const task = await new TaskModel(serverDB, userId, workspaceId).create({ instruction: 'a' });
    const a = await workspace.create({ name: 'A' });
    const b = await workspace.create({ name: 'B' });
    const c = await workspace.create({ name: 'C' });
    await workspace.addTaskLabels(task.id, [a.id, b.id]);

    expect((await workspace.setTaskLabels(task.id, [b.id, c.id])).map((l) => l.name)).toEqual([
      'B',
      'C',
    ]);
    expect(await workspace.setTaskLabels(task.id, [])).toEqual([]);
  });

  it('cannot label a task the caller cannot see', async () => {
    const hidden = await new TaskModel(serverDB, otherUserId, workspaceId).create({
      instruction: 'secret',
      visibility: 'private',
    });
    const label = await workspace.create({ name: 'A' });

    await expectCode(workspace.addTaskLabels(hidden.id, [label.id]), 'TASK_NOT_FOUND');
    expect(await workspace.getLabelsForTasks([hidden.id])).toEqual({});
  });

  it('groups labels by task for a batch of tasks', async () => {
    const model = new TaskModel(serverDB, userId, workspaceId);
    const t1 = await model.create({ instruction: '1' });
    const t2 = await model.create({ instruction: '2' });
    const t3 = await model.create({ instruction: '3' });
    const a = await workspace.create({ name: 'A' });
    const b = await workspace.create({ name: 'B' });
    await workspace.addTaskLabels(t1.id, [a.id, b.id]);
    await workspace.addTaskLabels(t2.id, [b.id]);

    const map = await workspace.getLabelsForTasks([t1.id, t2.id, t3.id]);
    expect(map[t1.id].map((l) => l.name)).toEqual(['A', 'B']);
    expect(map[t2.id].map((l) => l.name)).toEqual(['B']);
    expect(map[t3.id]).toBeUndefined();
  });

  it('finds labels by name case-insensitively within scope', async () => {
    await workspace.create({ name: 'Bug' });
    await personal.create({ name: 'Bug' });

    const found = await workspace.findByNames(['bug', ' BUG ', 'missing']);
    expect(found).toHaveLength(1);
    expect(found[0].workspaceId).toBe(workspaceId);
  });

  it('drops label links when a task moves to another workspace, keeps them otherwise', async () => {
    const model = new TaskModel(serverDB, userId, workspaceId);
    const moved = await model.create({ instruction: 'moved' });
    const kept = await model.create({ instruction: 'kept' });
    const label = await workspace.create({ name: 'A' });
    await workspace.addTaskLabels(moved.id, [label.id]);
    await workspace.addTaskLabels(kept.id, [label.id]);

    await model.transferTo(moved.id, otherWorkspaceId, userId, 'public');
    await model.transferTo(kept.id, workspaceId, otherUserId, 'public');

    const links = await serverDB.select().from(taskLabelLinks);
    expect(links.map((l) => l.taskId)).toEqual([kept.id]);
    // The kept link follows the new owner, so removing the old one keeps it.
    expect(links[0].userId).toBe(otherUserId);
  });
});

describe('TaskLabelModel id guards', () => {
  it('treats a malformed id as absent instead of raising a uuid cast error', async () => {
    const label = await workspace.create({ name: 'Bug' });

    expect(await workspace.findById('not-a-uuid')).toBeUndefined();
    expect(await workspace.findByIds(['not-a-uuid'])).toEqual([]);
    await expect(workspace.delete('not-a-uuid')).resolves.toBeUndefined();

    // A mixed list keeps the rows that do resolve.
    expect((await workspace.findByIds([label.id, 'not-a-uuid'])).map((l) => l.id)).toEqual([
      label.id,
    ]);
    expect(await workspace.findByIds([label.id])).toHaveLength(1);
  });

  it('resolves no names when every entry is blank', async () => {
    await workspace.create({ name: 'Bug' });

    expect(await workspace.findByNames(['', '   '])).toEqual([]);
  });

  it('reports a malformed parent id as a missing group', async () => {
    await expectCode(
      workspace.create({ name: 'Orphan', parentId: 'not-a-uuid' }),
      'INVALID_PARENT',
    );
  });

  it('checks an assignment set without writing anything', async () => {
    const group = await workspace.create({ isGroup: true, name: 'Type' });
    const bug = await workspace.create({ name: 'Bug', parentId: group.id });
    const feature = await workspace.create({ name: 'Feature', parentId: group.id });
    const loose = await workspace.create({ name: 'Loose' });

    await expect(workspace.assertAssignable([loose.id, bug.id])).resolves.toBeUndefined();
    await expectCode(workspace.assertAssignable([group.id]), 'GROUP_NOT_ASSIGNABLE');
    await expectCode(workspace.assertAssignable([bug.id, feature.id]), 'GROUP_CONFLICT');
  });
});

describe('TaskLabelModel sparse updates', () => {
  it('writes a patch without a parent change straight through', async () => {
    const label = await workspace.create({ name: 'Bug' });

    // No `parentId` in the patch: no parent or conflict checks run.
    expect(await workspace.update(label.id, { color: '#123456' })).toMatchObject({
      color: '#123456',
      name: 'Bug',
    });
    // A name-only patch is trimmed and the parent left alone.
    expect(await workspace.update(label.id, { name: '  Bugfix  ' })).toMatchObject({
      name: 'Bugfix',
    });
  });

  it('reports a missing label as LABEL_NOT_FOUND', async () => {
    const group = await workspace.create({ isGroup: true, name: 'Type' });
    const label = await workspace.create({ name: 'Bug' });
    await workspace.delete(label.id);

    await expectCode(workspace.update(label.id, { name: 'Gone' }), 'LABEL_NOT_FOUND');
    await expectCode(workspace.update(label.id, { parentId: group.id }), 'LABEL_NOT_FOUND');
  });

  it('reports LABEL_NOT_FOUND when the row vanishes under the lock', async () => {
    const group = await workspace.create({ isGroup: true, name: 'Type' });
    const label = await workspace.create({ name: 'Bug' });
    const snapshot = await workspace.findById(label.id);

    // A writer that already read the label, which another request then deletes.
    const racy = new TaskLabelModel(serverDB, userId, workspaceId);
    racy.findById = async () => snapshot;
    await workspace.delete(label.id);

    await expectCode(racy.update(label.id, { parentId: group.id }), 'LABEL_NOT_FOUND');
  });

  it('writes a move to the parent the label already sits in without a conflict check', async () => {
    const group = await workspace.create({ isGroup: true, name: 'Type' });
    const label = await workspace.create({ name: 'Bug', parentId: group.id });

    expect(await workspace.update(label.id, { parentId: group.id })).toMatchObject({
      parentId: group.id,
    });
  });

  it('returns the current set for an empty label list', async () => {
    const task = await new TaskModel(serverDB, userId, workspaceId).create({ instruction: 'a' });
    const label = await workspace.create({ name: 'Bug' });
    await workspace.addTaskLabels(task.id, [label.id]);

    expect(await workspace.getLabelsForTasks([])).toEqual({});
    expect((await workspace.addTaskLabels(task.id, [])).map((l) => l.id)).toEqual([label.id]);
  });
});

describe('TaskLabelModel personal handover', () => {
  it('keeps label links on a same-owner move and drops them for another owner', async () => {
    const personalTasks = new TaskModel(serverDB, userId);
    const toSameOwner = await personalTasks.create({ instruction: 'same owner' });
    const toAnotherOwner = await personalTasks.create({ instruction: 'another owner' });
    const label = await personal.create({ name: 'Mine' });
    await personal.addTaskLabels(toSameOwner.id, [label.id]);
    await personal.addTaskLabels(toAnotherOwner.id, [label.id]);

    // A personal label registry is not visible to another user, so only the
    // same-owner handover can keep its links.
    await personalTasks.transferTo(toSameOwner.id, null, userId);
    await personalTasks.transferTo(toAnotherOwner.id, null, otherUserId);

    const links = await serverDB.select().from(taskLabelLinks);
    expect(links.map((link) => link.taskId)).toEqual([toSameOwner.id]);
    expect(links[0].userId).toBe(userId);
  });
});
