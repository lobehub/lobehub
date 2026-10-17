// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { taskRouter } from '../../task';
import { cleanupTestUser, createTestContext, createTestUser } from './setup';

let testDB: LobeChatDatabase;
vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: vi.fn(function () {
    return testDB;
  }),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: vi.fn(),
}));

describe('Task Router archive', () => {
  let serverDB: LobeChatDatabase;
  let userId: string;
  let caller: ReturnType<typeof taskRouter.createCaller>;

  beforeEach(async () => {
    serverDB = await getTestDB();
    testDB = serverDB;
    userId = await createTestUser(serverDB);
    caller = taskRouter.createCaller(createTestContext(userId));
  });

  afterEach(async () => {
    await cleanupTestUser(serverDB, userId);
  });

  it('archives by identifier, keeps status, and restores on unarchive', async () => {
    const created = await caller.create({ instruction: 'Ship the archive action' });
    await caller.updateStatus({ id: created.data.identifier, status: 'completed' });

    const archived = await caller.archive({ archived: true, id: created.data.identifier });
    expect(archived.data.archivedAt).toBeInstanceOf(Date);
    expect(archived.data.status).toBe('completed');

    // Re-archiving keeps the original timestamp.
    const again = await caller.archive({ archived: true, id: created.data.id });
    expect(again.data.archivedAt).toEqual(archived.data.archivedAt);

    const restored = await caller.archive({ archived: false, id: created.data.id });
    expect(restored.data.archivedAt).toBeNull();
    expect(restored.data.status).toBe('completed');
  });

  it('hides archived tasks from list and groupList unless includeArchived is set', async () => {
    const active = await caller.create({ instruction: 'Still open' });
    const closed = await caller.create({ instruction: 'Truly done' });
    await caller.archive({ archived: true, id: closed.data.id });

    const hidden = await caller.list({});
    expect(hidden.data.map((task) => task.id)).toEqual([active.data.id]);

    const shown = await caller.list({ includeArchived: true });
    expect(shown.data.map((task) => task.id).sort()).toEqual(
      [active.data.id, closed.data.id].sort(),
    );

    const groups = [{ key: 'backlog', statuses: ['backlog'] }];
    const hiddenBoard = await caller.groupList({ groups });
    expect(hiddenBoard.data[0].tasks.map((task) => task.id)).toEqual([active.data.id]);

    const shownBoard = await caller.groupList({ groups, includeArchived: true });
    expect(shownBoard.data[0].total).toBe(2);
  });

  it('refuses to archive a schedule that can still fire, but allows restoring', async () => {
    const scheduled = await caller.create({
      automationMode: 'schedule',
      instruction: 'Daily digest',
      schedulePattern: '0 9 * * *',
    });

    await expect(caller.archive({ archived: true, id: scheduled.data.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    const listed = await caller.list({ includeArchived: true });
    expect(listed.data.find((task) => task.id === scheduled.data.id)?.archivedAt).toBeNull();

    // Unarchiving never hides work, so it is always allowed.
    const restored = await caller.archive({ archived: false, id: scheduled.data.id });
    expect(restored.data.archivedAt).toBeNull();
  });

  it('refuses to run an archived task until it is restored', async () => {
    const created = await caller.create({ instruction: 'Ship the weekly report' });
    await caller.archive({ archived: true, id: created.data.id });

    await expect(caller.run({ id: created.data.id })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    const [stored] = (await caller.list({ includeArchived: true })).data;
    expect(stored.status).toBe('backlog');
  });

  it('refuses to turn automation back on for an archived task', async () => {
    const created = await caller.create({ instruction: 'Weekly digest' });
    await caller.archive({ archived: true, id: created.data.id });

    await expect(
      caller.update({ automationMode: 'heartbeat', heartbeatInterval: 600, id: created.data.id }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(
      caller.updateStatus({ id: created.data.id, status: 'running' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    // Edits that keep it idle still go through.
    await expect(caller.update({ id: created.data.id, name: 'Renamed' })).resolves.toMatchObject({
      success: true,
    });
  });

  it('marks an archived subtask in its parent detail instead of dropping it', async () => {
    const parent = await caller.create({ instruction: 'Parent' });
    const child = await caller.create({ instruction: 'Child', parentTaskId: parent.data.id });
    await caller.archive({ archived: true, id: child.data.id });

    const detail = await caller.detail({ id: parent.data.id });
    const [subtask] = detail.data.subtasks ?? [];
    expect(subtask.identifier).toBe(child.data.identifier);
    expect(subtask.archivedAt).toEqual(expect.any(String));
  });

  it('limits archiving a shared task to its creator or a workspace owner', async () => {
    const memberId = await createTestUser(serverDB);
    const workspaceId = 'task-archive-scope-workspace';
    const { workspaces, workspaceMembers } = await import('@/database/schemas');
    await serverDB.insert(workspaces).values({
      id: workspaceId,
      name: 'Task Archive Scope',
      primaryOwnerId: userId,
      slug: workspaceId,
    });
    await serverDB.insert(workspaceMembers).values([
      { role: 'owner', userId, workspaceId },
      { role: 'member', userId: memberId, workspaceId },
    ]);
    // The Cloud workspace middleware derives `workspaceRole` from membership;
    // the OSS test context has to state it.
    const ownerCaller = taskRouter.createCaller({
      ...createTestContext(userId),
      workspaceId,
      workspaceRole: 'owner',
    } as any);
    const memberCaller = taskRouter.createCaller({
      ...createTestContext(memberId),
      workspaceId,
      workspaceRole: 'member',
    } as any);

    try {
      const ownersTask = await ownerCaller.create({ instruction: "Owner's task" });
      const membersTask = await memberCaller.create({ instruction: "Member's task" });

      await expect(
        memberCaller.archive({ archived: true, id: ownersTask.data.id }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      // The member still manages their own task, and the owner manages every task.
      await expect(
        memberCaller.archive({ archived: true, id: membersTask.data.id }),
      ).resolves.toMatchObject({ success: true });
      await expect(
        ownerCaller.archive({ archived: false, id: membersTask.data.id }),
      ).resolves.toMatchObject({ success: true });
    } finally {
      await cleanupTestUser(serverDB, memberId);
    }
  });

  it('refuses to archive an unfinished task its open goal still plans to run', async () => {
    const created = await caller.create({ instruction: 'Goal step' });
    const { GoalModel } = await import('@/database/models/goal');
    await new GoalModel(serverDB, userId).create({
      subjectId: created.data.id,
      subjectType: 'task',
      title: 'Open goal',
    });

    await expect(caller.archive({ archived: true, id: created.data.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('rejects an unknown task', async () => {
    await expect(caller.archive({ archived: true, id: 'T-404' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
