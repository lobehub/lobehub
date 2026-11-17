// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { projects, users, workspaceMembers, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel, TaskTreeProjectMoveError } from './index';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'task-tree-project-owner';
const memberId = 'task-tree-project-member';
const workspaceId = 'task-tree-project-workspace';

const projectIn = async (id: string) => {
  await serverDB.insert(projects).values({ id, name: id, userId: ownerId, workspaceId });
  return id;
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: ownerId }, { id: memberId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Tree', primaryOwnerId: ownerId, slug: workspaceId });
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { role: 'member', userId: memberId, workspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(workspaces).where(inArray(workspaces.id, [workspaceId]));
  await serverDB.delete(users).where(inArray(users.id, [ownerId, memberId]));
});

describe('TaskModel.hasSubtaskOutsideProject', () => {
  it('compares direct subtasks against a project and against no project', async () => {
    const model = new TaskModel(serverDB, ownerId, workspaceId);
    const inside = await projectIn('task-tree-project-a');
    const outside = await projectIn('task-tree-project-b');

    const parent = await model.create({ instruction: 'parent', projectId: inside });
    expect(await model.hasSubtaskOutsideProject(parent.id, inside)).toBe(false);
    expect(await model.hasSubtaskOutsideProject(parent.id, null)).toBe(false);

    await model.create({ instruction: 'child', parentTaskId: parent.id });
    expect(await model.hasSubtaskOutsideProject(parent.id, inside)).toBe(false);
    expect(await model.hasSubtaskOutsideProject(parent.id, outside)).toBe(true);
    expect(await model.hasSubtaskOutsideProject(parent.id, null)).toBe(true);
  });

  it('flags a subtask without a project when asked about a project', async () => {
    const model = new TaskModel(serverDB, ownerId, workspaceId);
    const target = await projectIn('task-tree-project-c');
    const parent = await model.create({ instruction: 'parent' });
    await model.create({ instruction: 'child', parentTaskId: parent.id });

    expect(await model.hasSubtaskOutsideProject(parent.id, null)).toBe(false);
    expect(await model.hasSubtaskOutsideProject(parent.id, target)).toBe(true);
  });

  it("sees another member's private subtask the caller cannot read", async () => {
    const owner = new TaskModel(serverDB, ownerId, workspaceId);
    const member = new TaskModel(serverDB, memberId, workspaceId);
    const parent = await owner.create({ instruction: 'parent', visibility: 'public' });
    const hidden = await member.create({
      instruction: 'hidden child',
      parentTaskId: parent.id,
      visibility: 'private',
    });
    const target = await projectIn('task-tree-project-d');

    expect(await owner.findById(hidden.id)).toBeNull();
    expect(await owner.hasSubtaskOutsideProject(parent.id, target)).toBe(true);
  });

  it('ignores a trashed subtask and subtasks of another scope', async () => {
    const model = new TaskModel(serverDB, ownerId, workspaceId);
    const target = await projectIn('task-tree-project-e');
    const parent = await model.create({ instruction: 'parent' });
    const child = await model.create({ instruction: 'child', parentTaskId: parent.id });
    await model.update(child.id, { deletedAt: new Date(), isDeleted: true });
    expect(await model.hasSubtaskOutsideProject(parent.id, target)).toBe(false);

    await model.create({ instruction: 'live child', parentTaskId: parent.id });
    const outsider = new TaskModel(serverDB, memberId);
    expect(await outsider.hasSubtaskOutsideProject(parent.id, target)).toBe(false);
  });
});

describe('TaskModel.moveUnfiledTreeToProject', () => {
  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => 'moved',
      (error: unknown) => (error instanceof TaskTreeProjectMoveError ? error.reason : error),
    );

  it('files an unfiled root and every descendant under the project', async () => {
    const model = new TaskModel(serverDB, ownerId, workspaceId);
    const target = await projectIn('task-tree-move-a');
    const root = await model.create({ instruction: 'root' });
    const child = await model.create({ instruction: 'child', parentTaskId: root.id });
    const grandchild = await model.create({ instruction: 'grandchild', parentTaskId: child.id });
    // A dependency inside the tree moves with it.
    await model.addDependency(grandchild.id, child.id);

    const moved = await model.moveUnfiledTreeToProject(root.id, target);

    expect(moved?.projectId).toBe(target);
    const rows = await model.findByIds([root.id, child.id, grandchild.id]);
    expect(rows.map((row) => row.projectId)).toEqual([target, target, target]);
  });

  it("moves another member's private subtask the caller cannot read", async () => {
    const owner = new TaskModel(serverDB, ownerId, workspaceId);
    const member = new TaskModel(serverDB, memberId, workspaceId);
    const target = await projectIn('task-tree-move-b');
    const root = await owner.create({ instruction: 'root', visibility: 'public' });
    const hidden = await member.create({
      instruction: 'hidden child',
      parentTaskId: root.id,
      visibility: 'private',
    });

    await owner.moveUnfiledTreeToProject(root.id, target);

    expect((await member.findById(hidden.id))?.projectId).toBe(target);
  });

  it('leaves a trashed subtask behind', async () => {
    const model = new TaskModel(serverDB, ownerId, workspaceId);
    const target = await projectIn('task-tree-move-c');
    const root = await model.create({ instruction: 'root' });
    const trashed = await model.create({ instruction: 'trashed', parentTaskId: root.id });
    await model.update(trashed.id, { deletedAt: new Date(), isDeleted: true });

    expect(await refusal(model.moveUnfiledTreeToProject(root.id, target))).toBe('moved');
  });

  it('refuses a subtask, a filed task and a tree with a filed descendant', async () => {
    const model = new TaskModel(serverDB, ownerId, workspaceId);
    const filed = await projectIn('task-tree-move-d');
    const target = await projectIn('task-tree-move-e');

    const root = await model.create({ instruction: 'root' });
    const child = await model.create({ instruction: 'child', parentTaskId: root.id });
    expect(await refusal(model.moveUnfiledTreeToProject(child.id, target))).toBe('has_parent');

    const filedRoot = await model.create({ instruction: 'filed root', projectId: filed });
    expect(await refusal(model.moveUnfiledTreeToProject(filedRoot.id, target))).toBe('filed_task');

    // Bypass the create-time rule to reach a state an older write left behind.
    await model.update(child.id, { projectId: filed });
    expect(await refusal(model.moveUnfiledTreeToProject(root.id, target))).toBe('filed_subtask');
    expect((await model.findById(root.id))?.projectId).toBeNull();
  });

  it('refuses a dependency reaching a live task outside the tree, in either direction', async () => {
    const model = new TaskModel(serverDB, ownerId, workspaceId);
    const target = await projectIn('task-tree-move-f');
    const root = await model.create({ instruction: 'root' });
    const child = await model.create({ instruction: 'child', parentTaskId: root.id });
    const outsider = await model.create({ instruction: 'outsider' });

    await model.addDependency(outsider.id, child.id);
    expect(await refusal(model.moveUnfiledTreeToProject(root.id, target))).toBe(
      'external_dependency',
    );
    expect((await model.findById(child.id))?.projectId).toBeNull();

    // A trashed outsider no longer blocks the move.
    await model.update(outsider.id, { deletedAt: new Date(), isDeleted: true });
    const blocker = await model.create({ instruction: 'blocker' });
    await model.addDependency(root.id, blocker.id);
    expect(await refusal(model.moveUnfiledTreeToProject(root.id, target))).toBe(
      'external_dependency',
    );
    await model.update(blocker.id, { deletedAt: new Date(), isDeleted: true });
    expect(await refusal(model.moveUnfiledTreeToProject(root.id, target))).toBe('moved');
  });

  it('returns null for a root the caller cannot see', async () => {
    const owner = new TaskModel(serverDB, ownerId, workspaceId);
    const member = new TaskModel(serverDB, memberId, workspaceId);
    const target = await projectIn('task-tree-move-g');
    const root = await owner.create({ instruction: 'root', visibility: 'private' });

    expect(await member.moveUnfiledTreeToProject(root.id, target)).toBeNull();
    expect((await owner.findById(root.id))?.projectId).toBeNull();
  });
});
