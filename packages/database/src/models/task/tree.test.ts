// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { projects, users, workspaceMembers, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from './index';

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
