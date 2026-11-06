// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { TaskRestService } from '@lobechat/openapi/src/services/task.service';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectModel } from '@/database/models/project';
import { TaskModel } from '@/database/models/task';
import { projects, tasks, workspaceMembers, workspaces } from '@/database/schemas';

import { taskRouter } from '../../task';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

const WORKSPACE = 'task-project-link-ws';
const OTHER_WORKSPACE = 'task-project-link-other-ws';

describe('task.update projectId', () => {
  let userId: string;
  let memberId: string;
  let strangerId: string;
  let caller: ReturnType<typeof taskRouter.createCaller>;
  let projectA: string;
  let projectB: string;

  const storedProjectId = async (id: string) => {
    const [row] = await testDB.select().from(tasks).where(eq(tasks.id, id));
    return row.projectId;
  };

  const newProject = async (owner: string, workspaceId: string | undefined, name: string) =>
    (await new ProjectModel(testDB, owner, workspaceId).create({ name })).id;

  beforeEach(async () => {
    testDB = await getTestDB();
    userId = await createTestUser(testDB);
    memberId = await createTestUser(testDB);
    strangerId = await createTestUser(testDB);
    await testDB.insert(workspaces).values([
      { id: WORKSPACE, name: 'Mine', primaryOwnerId: userId, slug: WORKSPACE },
      { id: OTHER_WORKSPACE, name: 'Other', primaryOwnerId: strangerId, slug: OTHER_WORKSPACE },
    ]);
    await testDB.insert(workspaceMembers).values([
      { role: 'owner', userId, workspaceId: WORKSPACE },
      { role: 'member', userId: memberId, workspaceId: WORKSPACE },
      // The caller belongs to both, so only the active scope can refuse the other one.
      { role: 'member', userId, workspaceId: OTHER_WORKSPACE },
      { role: 'owner', userId: strangerId, workspaceId: OTHER_WORKSPACE },
    ]);
    caller = taskRouter.createCaller({ ...createTestContext(userId), workspaceId: WORKSPACE });
    projectA = await newProject(userId, WORKSPACE, 'Project A');
    projectB = await newProject(userId, WORKSPACE, 'Project B');
  });

  afterEach(async () => {
    await testDB.delete(workspaces).where(eq(workspaces.id, WORKSPACE));
    await testDB.delete(workspaces).where(eq(workspaces.id, OTHER_WORKSPACE));
    for (const id of [userId, memberId, strangerId]) await cleanupTestUser(testDB, id);
  });

  it('sets, changes and clears the project, keeping the identifier', async () => {
    const { data: task } = await caller.create({ instruction: 'Movable' });
    expect(task.projectId).toBeNull();

    const set = await caller.update({ id: task.id, projectId: projectA });
    expect(set.data.projectId).toBe(projectA);
    expect(await storedProjectId(task.id)).toBe(projectA);

    const changed = await caller.update({ id: task.identifier, projectId: projectB });
    expect(changed.data.projectId).toBe(projectB);
    expect(await storedProjectId(task.id)).toBe(projectB);

    const cleared = await caller.update({ id: task.id, projectId: null });
    expect(cleared.data.projectId).toBeNull();
    expect(await storedProjectId(task.id)).toBeNull();
    expect(cleared.data.identifier).toBe(task.identifier);
  });

  it('leaves the project alone when the patch does not send it', async () => {
    const { data: task } = await caller.create({ instruction: 'Stay', projectId: projectA });

    const renamed = await caller.update({ id: task.id, name: 'Renamed', priority: 2 });
    expect(renamed.data.name).toBe('Renamed');
    expect(renamed.data.projectId).toBe(projectA);
    expect(await storedProjectId(task.id)).toBe(projectA);

    const undefinedPatch = await caller.update({
      id: task.id,
      name: 'Again',
      projectId: undefined,
    });
    expect(undefinedPatch.data.projectId).toBe(projectA);
  });

  it('applies a project change that ships with a status change', async () => {
    const { data: task } = await caller.create({ instruction: 'Combined' });
    const { data } = await caller.update({ id: task.id, projectId: projectA, status: 'paused' });
    expect(data).toMatchObject({ projectId: projectA, status: 'paused' });
    expect(await storedProjectId(task.id)).toBe(projectA);
  });

  describe('refuses a project the caller cannot file under', () => {
    const notFound = { code: 'NOT_FOUND', message: 'Project not found' };

    it('in another workspace, on update and on create', async () => {
      const foreign = await newProject(strangerId, OTHER_WORKSPACE, 'Foreign');
      const { data: task } = await caller.create({ instruction: 'Scoped', projectId: projectA });

      await expect(caller.update({ id: task.id, projectId: foreign })).rejects.toMatchObject(
        notFound,
      );
      await expect(
        caller.create({ instruction: 'Cross', projectId: foreign }),
      ).rejects.toMatchObject(notFound);
      expect(await storedProjectId(task.id)).toBe(projectA);
    });

    it('owned personally by the caller, from a workspace', async () => {
      const personal = await newProject(userId, undefined, 'Personal');
      const { data: task } = await caller.create({ instruction: 'Scoped' });
      await expect(caller.update({ id: task.id, projectId: personal })).rejects.toMatchObject(
        notFound,
      );
    });

    it('private to another member, on update and on create', async () => {
      const hidden = (
        await new ProjectModel(testDB, memberId, WORKSPACE).create({
          name: 'Hidden',
          visibility: 'private',
        })
      ).id;
      const { data: task } = await caller.create({ instruction: 'Scoped' });
      await expect(caller.update({ id: task.id, projectId: hidden })).rejects.toMatchObject(
        notFound,
      );
      await expect(
        caller.create({ instruction: 'Cross', projectId: hidden }),
      ).rejects.toMatchObject(notFound);
    });

    it('that does not exist or is an empty id', async () => {
      const { data: task } = await caller.create({ instruction: 'Scoped' });
      for (const projectId of ['project-that-does-not-exist', '']) {
        await expect(caller.update({ id: task.id, projectId })).rejects.toMatchObject(notFound);
      }
    });

    it('that is another user’s in personal mode', async () => {
      const foreign = await newProject(strangerId, undefined, 'Foreign personal');
      const personalCaller = taskRouter.createCaller(createTestContext(userId));
      const { data: task } = await personalCaller.create({ instruction: 'Personal' });
      await expect(
        personalCaller.update({ id: task.id, projectId: foreign }),
      ).rejects.toMatchObject(notFound);
    });
  });

  describe('keeps subtasks and dependencies inside one project', () => {
    it('refuses to split a subtask from its parent, and allows detaching it', async () => {
      const { data: parent } = await caller.create({ instruction: 'Parent', projectId: projectA });
      const { data: child } = await caller.create({
        instruction: 'Child',
        parentTaskId: parent.id,
      });

      await expect(caller.update({ id: child.id, projectId: projectB })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Subtask must belong to the same project as its parent',
      });
      await expect(caller.update({ id: parent.id, projectId: null })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('subtasks'),
      });
      expect(await storedProjectId(child.id)).toBe(projectA);
      expect(await storedProjectId(parent.id)).toBe(projectA);

      const { data } = await caller.update({
        id: child.id,
        parentTaskId: null,
        projectId: projectB,
      });
      expect(data).toMatchObject({ parentTaskId: null, projectId: projectB });
      // The parent is free to move once nothing is left behind.
      const moved = await caller.update({ id: parent.id, projectId: projectB });
      expect(moved.data.projectId).toBe(projectB);
    });

    it('refuses to strand a dependency in either direction', async () => {
      const model = new TaskModel(testDB, userId, WORKSPACE);
      const { data: first } = await caller.create({ instruction: 'First', projectId: projectA });
      const { data: second } = await caller.create({ instruction: 'Second', projectId: projectA });
      await model.addDependency(second.id, first.id);

      for (const id of [first.id, second.id]) {
        await expect(caller.update({ id, projectId: projectB })).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          message: expect.stringContaining('dependencies cannot cross'),
        });
      }
    });

    it('counts a dependency on a private task the mover cannot see', async () => {
      const owner = new TaskModel(testDB, userId, WORKSPACE);
      const { data: shared } = await caller.create({
        instruction: 'Shared',
        projectId: projectA,
        visibility: 'public',
      });
      const hidden = await owner.create({
        instruction: 'Hidden',
        projectId: projectA,
        visibility: 'private',
      });
      await owner.addDependency(shared.id, hidden.id);

      const memberCaller = taskRouter.createCaller({
        ...createTestContext(memberId),
        workspaceId: WORKSPACE,
      });
      await expect(
        memberCaller.update({ id: shared.id, projectId: projectB }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('dependencies cannot cross'),
      });
      expect((await owner.findById(shared.id))?.projectId).toBe(projectA);
    });
  });

  it('reports the project in list, group list and detail reads', async () => {
    const { data: task } = await caller.create({ instruction: 'Read me', projectId: projectA });
    const { data: bare } = await caller.create({ instruction: 'No project' });

    const detail = await caller.detail({ id: task.id });
    expect(detail.data.projectId).toBe(projectA);
    expect((await caller.detail({ id: bare.id })).data.projectId).toBeNull();

    const list = await caller.list({ projectId: projectA });
    expect(list.data.map((row) => [row.id, row.projectId])).toEqual([[task.id, projectA]]);

    const groups = await caller.groupList({ groupBy: 'priority', projectId: projectA });
    const cards = groups.data.flatMap((group) => group.tasks);
    expect(cards.map((card) => [card.id, card.projectId])).toEqual([[task.id, projectA]]);
  });

  it('moves the task between the project-scoped lists', async () => {
    const { data: task } = await caller.create({ instruction: 'Mover', projectId: projectA });
    await caller.update({ id: task.id, projectId: projectB });

    expect((await caller.list({ projectId: projectA })).data).toEqual([]);
    const listed = await caller.list({ projectId: projectB });
    expect(listed.data.map((row) => row.id)).toEqual([task.id]);
    expect((await caller.detail({ id: task.id })).data.projectId).toBe(projectB);

    await caller.update({ id: task.id, projectId: null });
    expect((await caller.list({ projectId: projectB })).data).toEqual([]);
    const all = await caller.list({});
    expect(all.data.find((row) => row.id === task.id)?.projectId).toBeNull();
  });

  it('applies the same contract through the REST patch', async () => {
    const rest = new TaskRestService(testDB, userId, WORKSPACE);
    const { data: task } = await caller.create({ instruction: 'REST' });
    const patch = (projectId?: string | null) =>
      rest.updateTask(task.id, projectId === undefined ? { name: 'Named' } : { projectId });

    await patch(projectA);
    expect(await storedProjectId(task.id)).toBe(projectA);
    await patch(projectB);
    expect(await storedProjectId(task.id)).toBe(projectB);
    await patch();
    expect(await storedProjectId(task.id)).toBe(projectB);

    const foreign = await newProject(strangerId, OTHER_WORKSPACE, 'Foreign');
    await expect(patch(foreign)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Project not found',
    });
    expect(await storedProjectId(task.id)).toBe(projectB);

    await patch(null);
    expect(await storedProjectId(task.id)).toBeNull();
  });

  it('survives its project being deleted (the FK clears the link)', async () => {
    const { data: task } = await caller.create({ instruction: 'Orphan', projectId: projectA });
    await testDB.delete(projects).where(eq(projects.id, projectA));
    expect(await storedProjectId(task.id)).toBeNull();
    expect((await caller.detail({ id: task.id })).data.projectId).toBeNull();
  });
});
