// @vitest-environment node
import { inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { projects, users, workspaceMembers, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from './index';

const serverDB: LobeChatDatabase = await getTestDB();

const ownerId = 'task-dep-project-owner';
const memberId = 'task-dep-project-member';
const workspaceId = 'task-dep-project-workspace';

const projectIn = async (id: string) => {
  await serverDB.insert(projects).values({ id, name: id, userId: ownerId, workspaceId });
  return id;
};

beforeEach(async () => {
  await serverDB.insert(users).values([{ id: ownerId }, { id: memberId }]);
  await serverDB
    .insert(workspaces)
    .values({ id: workspaceId, name: 'Deps', primaryOwnerId: ownerId, slug: workspaceId });
  await serverDB.insert(workspaceMembers).values([
    { role: 'owner', userId: ownerId, workspaceId },
    { role: 'member', userId: memberId, workspaceId },
  ]);
});

afterEach(async () => {
  await serverDB.delete(workspaces).where(inArray(workspaces.id, [workspaceId]));
  await serverDB.delete(users).where(inArray(users.id, [ownerId, memberId]));
});

describe('TaskModel.hasDependencyOutsideProject', () => {
  it('checks both directions against a project and against no project', async () => {
    const model = new TaskModel(serverDB, ownerId, workspaceId);
    const inside = await projectIn('task-dep-project-a');
    const outside = await projectIn('task-dep-project-b');
    const task = await model.create({ instruction: 'task', projectId: inside });

    expect(await model.hasDependencyOutsideProject(task.id, outside)).toBe(false);

    const blocker = await model.create({ instruction: 'blocker', projectId: inside });
    await model.addDependency(task.id, blocker.id);
    expect(await model.hasDependencyOutsideProject(task.id, inside)).toBe(false);
    expect(await model.hasDependencyOutsideProject(task.id, outside)).toBe(true);
    expect(await model.hasDependencyOutsideProject(task.id, null)).toBe(true);

    const dependent = await model.create({ instruction: 'dependent', projectId: inside });
    await model.addDependency(dependent.id, blocker.id);
    expect(await model.hasDependencyOutsideProject(blocker.id, outside)).toBe(true);
  });

  it('flags a linked task without a project when asked about a project', async () => {
    const model = new TaskModel(serverDB, ownerId, workspaceId);
    const target = await projectIn('task-dep-project-c');
    const task = await model.create({ instruction: 'task' });
    const blocker = await model.create({ instruction: 'blocker' });
    await model.addDependency(task.id, blocker.id);

    expect(await model.hasDependencyOutsideProject(task.id, null)).toBe(false);
    expect(await model.hasDependencyOutsideProject(task.id, target)).toBe(true);
  });

  it("sees a dependency on another member's private task the caller cannot read", async () => {
    const owner = new TaskModel(serverDB, ownerId, workspaceId);
    const member = new TaskModel(serverDB, memberId, workspaceId);
    const shared = await owner.create({ instruction: 'shared', visibility: 'public' });
    const hidden = await owner.create({ instruction: 'hidden', visibility: 'private' });
    await owner.addDependency(shared.id, hidden.id);
    const target = await projectIn('task-dep-project-d');

    expect(await member.findById(hidden.id)).toBeNull();
    expect(await member.hasDependencyOutsideProject(shared.id, target)).toBe(true);
  });

  it('ignores a trashed linked task and links of another scope', async () => {
    const model = new TaskModel(serverDB, ownerId, workspaceId);
    const target = await projectIn('task-dep-project-e');
    const task = await model.create({ instruction: 'task' });
    const blocker = await model.create({ instruction: 'blocker' });
    await model.addDependency(task.id, blocker.id);
    await model.update(blocker.id, { deletedAt: new Date(), isDeleted: true });
    expect(await model.hasDependencyOutsideProject(task.id, target)).toBe(false);

    const live = await model.create({ instruction: 'live blocker' });
    await model.addDependency(task.id, live.id);
    const outsider = new TaskModel(serverDB, memberId);
    expect(await outsider.hasDependencyOutsideProject(task.id, target)).toBe(false);
  });
});
