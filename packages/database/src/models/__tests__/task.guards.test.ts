// @vitest-environment node
import { eq, inArray } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { documents, projects, tasks, users, workspaces } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { TaskModel } from '../task';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'task-guards-user';
const userId2 = 'task-guards-user-2';
const workspaceId = 'task-guards-ws';
const otherWorkspaceId = 'task-guards-ws-2';
const ownUsers = [userId, userId2];

const dialect = new PgDialect();

beforeEach(async () => {
  await serverDB.delete(users).where(inArray(users.id, ownUsers));
  await serverDB.insert(users).values(ownUsers.map((id) => ({ id })));
});

afterEach(async () => {
  vi.restoreAllMocks();
  // Tasks, projects, documents and workspaces all cascade from their owner.
  await serverDB.delete(users).where(inArray(users.id, ownUsers));
});

const createWorkspaces = () =>
  serverDB.insert(workspaces).values([
    { id: workspaceId, name: 'WS', primaryOwnerId: userId, slug: workspaceId },
    { id: otherWorkspaceId, name: 'WS 2', primaryOwnerId: userId, slug: otherWorkspaceId },
  ]);

const createDocument = async (title: string | null) => {
  const [doc] = await serverDB
    .insert(documents)
    .values({
      fileType: 'markdown',
      source: 'test',
      sourceType: 'api',
      title,
      totalCharCount: 0,
      totalLineCount: 0,
      userId,
    })
    .returning();
  return doc;
};

describe('TaskModel.create guards', () => {
  it('rejects a parent the caller cannot see', async () => {
    const model = new TaskModel(serverDB, userId);

    await expect(
      model.create({ instruction: 'child', parentTaskId: 'task_missing' }),
    ).rejects.toThrow('Task not found');
  });

  it('rejects a subtask placed in another project than its parent', async () => {
    const model = new TaskModel(serverDB, userId);
    const parent = await model.create({ instruction: 'parent' });

    await expect(
      model.create({ instruction: 'child', parentTaskId: parent.id, projectId: 'proj_other' }),
    ).rejects.toThrow('Subtask must belong to the same project as its parent');
    expect(await model.findSubtasks(parent.id)).toEqual([]);
  });

  it('gives up without inserting when no attempt is allowed', async () => {
    const model = new TaskModel(serverDB, userId);

    await expect(model.create({ instruction: 'never' }, { maxRetries: 0 })).rejects.toThrow(
      'Failed to create task after max retries',
    );
    expect((await model.list()).total).toBe(0);
  });

  it('rethrows an insert error that is not an identifier collision', async () => {
    const model = new TaskModel(serverDB, userId);

    await expect(
      model.create({ assigneeUserId: 'task-guards-ghost', instruction: 'bad ref' }),
    ).rejects.toThrow();
    expect((await model.list()).total).toBe(0);
  });
});

describe('TaskModel.findByRepairRequest', () => {
  it('finds the task carrying the repair request id, and null otherwise', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({
      config: { acceptanceRepair: { requestId: 'repair-1' } },
      instruction: 'repair',
    });

    expect((await model.findByRepairRequest('repair-1'))?.id).toBe(task.id);
    expect(await model.findByRepairRequest('repair-2')).toBeNull();
    expect(await new TaskModel(serverDB, userId2).findByRepairRequest('repair-1')).toBeNull();
  });
});

describe('TaskModel update guards', () => {
  it('returns null when reassigning a task that is not visible', async () => {
    const task = await new TaskModel(serverDB, userId).create({ instruction: 'mine' });

    expect(
      await new TaskModel(serverDB, userId2).update(task.id, { assigneeAgentId: null }),
    ).toBeNull();
  });

  it('merges a context patch into a null context', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'ctx' });
    await model.update(task.id, { context: null });

    const updated = await model.updateContext(task.id, { scheduler: { tickMessageId: 'm1' } });

    expect(updated?.context).toEqual({ scheduler: { tickMessageId: 'm1' } });
  });

  it('patches verify config onto a null config and skips undefined keys', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'verify' });
    await model.update(task.id, { config: null });

    const updated = await model.updateVerifyConfig(task.id, {
      enabled: true,
      maxIterations: undefined,
    });

    expect(updated?.config).toEqual({ verify: { enabled: true } });
  });

  it('resolves no verify config for a missing task', async () => {
    expect(
      await new TaskModel(serverDB, userId).resolveVerifyConfig('task_missing'),
    ).toBeUndefined();
  });

  it('stops walking at an ancestor the caller cannot see', async () => {
    const owner = new TaskModel(serverDB, userId, workspaceId);
    await createWorkspaces();
    const parent = await owner.create({
      config: { verify: { enabled: true } },
      instruction: 'private parent',
      visibility: 'private',
    });
    const child = await owner.create({
      instruction: 'public child',
      parentTaskId: parent.id,
      visibility: 'public',
    });

    expect(await owner.resolveVerifyConfig(child.id)).toEqual({ enabled: true });
    expect(
      await new TaskModel(serverDB, userId2, workspaceId).resolveVerifyConfig(child.id),
    ).toBeUndefined();
  });
});

describe('TaskModel.updateWithLog guards', () => {
  it('returns null for a task that is not visible', async () => {
    expect(
      await new TaskModel(serverDB, userId).updateWithLog(
        'task_missing',
        { status: 'running' },
        { userId },
      ),
    ).toBeNull();
  });

  it('applies a config patch onto a null config', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'patch' });
    await model.update(task.id, { config: null });

    const updated = await model.updateWithLog(
      task.id,
      {},
      { userId },
      { configPatch: { schedule: { maxExecutions: 3 } } },
    );

    expect(updated?.config).toEqual({ schedule: { maxExecutions: 3 } });
  });

  it('logs a priority change to and from null', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'priority', priority: 2 });

    await model.updateWithLog(task.id, { priority: null }, { userId });
    await model.updateWithLog(task.id, { priority: 3 }, { userId });

    const events = (await model.getActivities(task.id)).filter((row) => row.type === 'priority');
    expect(events.map((row) => row.payload)).toEqual([
      expect.objectContaining({ from: 2, to: null }),
      expect.objectContaining({ from: null, to: 3 }),
    ]);
  });
});

describe('TaskModel dependency guards', () => {
  it('rejects a dependency onto a task in a project when the task has none', async () => {
    const model = new TaskModel(serverDB, userId);
    const [project] = await serverDB
      .insert(projects)
      .values({ name: 'P', userId })
      .returning({ id: projects.id });
    const loose = await model.create({ instruction: 'loose' });
    const scoped = await model.create({ instruction: 'scoped', projectId: project.id });

    await expect(model.addDependency(loose.id, scoped.id)).rejects.toThrow(
      'Task dependencies cannot cross project boundaries',
    );
    expect(await model.getDependencies(loose.id)).toEqual([]);
  });

  it('unlocks nothing when the completed task has no dependents', async () => {
    const model = new TaskModel(serverDB, userId);
    const done = await model.create({ instruction: 'alone' });
    await model.updateStatus(done.id, 'completed');

    expect(await model.getUnlockedTasksForMany([done.id])).toEqual([]);
  });

  it('unlocks nothing while every dependent is still blocked elsewhere', async () => {
    const model = new TaskModel(serverDB, userId);
    const done = await model.create({ instruction: 'done' });
    const pending = await model.create({ instruction: 'pending' });
    const waiting = await model.create({ instruction: 'waiting' });
    await model.addDependency(waiting.id, done.id);
    await model.addDependency(waiting.id, pending.id);
    await model.updateStatus(done.id, 'completed');

    expect(await model.getUnlockedTasksForMany([done.id])).toEqual([]);
  });
});

describe('TaskModel empty-input early returns', () => {
  it('skips the database for empty id lists', async () => {
    const model = new TaskModel(serverDB, userId);

    expect(await model.addActivities([])).toEqual([]);
    expect(await model.lockForStatusChange([])).toEqual([]);
    expect(await model.deleteByIds([])).toBe(0);
  });
});

describe('TaskModel row guards', () => {
  it('reports no other creators outside a workspace', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'personal' });

    expect(await model.subtreeHasOtherCreators(task.id, userId2)).toBe(false);
  });

  it('restricts deleteAll to the caller’s own rows on request', async () => {
    await createWorkspaces();
    const mine = await new TaskModel(serverDB, userId, workspaceId).create({
      instruction: 'mine',
      visibility: 'public',
    });
    const theirs = await new TaskModel(serverDB, userId2, workspaceId).create({
      instruction: 'theirs',
      visibility: 'public',
    });

    const deleted = await new TaskModel(serverDB, userId, workspaceId).deleteAll({
      restrictToCreator: true,
    });

    expect(deleted).toBe(1);
    const left = await serverDB
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.id, [mine.id, theirs.id]));
    expect(left).toEqual([{ id: theirs.id }]);
  });

  it('returns null when the subtree root is not visible', async () => {
    const task = await new TaskModel(serverDB, userId).create({ instruction: 'mine' });

    expect(
      await new TaskModel(serverDB, userId2).setSubtreeVisibility(task.id, [], 'private'),
    ).toBeNull();
    expect((await new TaskModel(serverDB, userId).findById(task.id))?.visibility).toBe(
      task.visibility,
    );
  });
});

describe('TaskModel pinned document guards', () => {
  it('returns a null title for an untitled document pinned since a time', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'docs' });
    const doc = await createDocument(null);
    const since = new Date(Date.now() - 60_000);
    await model.pinDocument(task.id, doc.id);

    expect(await model.getDocumentsPinnedSince(task.id, since)).toEqual([
      { id: doc.id, kind: 'markdown', title: null },
    ]);
  });

  it('labels an untitled document in the pinned tree', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'tree' });
    const doc = await createDocument('');
    await model.pinDocument(task.id, doc.id);

    const { nodeMap, tree } = await model.getTreePinnedDocuments(task.id);

    expect(nodeMap[doc.id].title).toBe('Untitled');
    expect(tree).toEqual([{ children: [], id: doc.id }]);
  });
});

describe('TaskModel.groupList guards', () => {
  it('requires groups or a grouping dimension', async () => {
    await expect(new TaskModel(serverDB, userId).groupList({})).rejects.toThrow(
      'Task groups or a grouping dimension are required',
    );
    await expect(new TaskModel(serverDB, userId).groupList({ groups: [] })).rejects.toThrow(
      'Task groups or a grouping dimension are required',
    );
  });

  it('adds an empty unassigned group to the hybrid assignee board', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ assigneeUserId: userId2, instruction: 'member' });

    const groups = await model.groupList({ groupBy: 'assignee' });

    expect(
      groups.map(({ key, tasks, total }) => ({ ids: tasks.map((t) => t.id), key, total })),
    ).toEqual([
      { ids: [task.id], key: `assignee:user:${userId2}`, total: 1 },
      { ids: [], key: 'assignee:unassigned', total: 0 },
    ]);
    expect(groups[1]).toMatchObject({ assigneeAgentId: null, assigneeUserId: null });
  });

  it('adds an empty unassigned column to the member board', async () => {
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ assigneeUserId: userId2, instruction: 'member' });

    const groups = await model.groupList({ groupBy: 'member' });

    expect(
      groups.map(({ key, tasks, total }) => ({ ids: tasks.map((t) => t.id), key, total })),
    ).toEqual([
      { ids: [task.id], key: `member:${userId2}`, total: 1 },
      { ids: [], key: 'member:unassigned', total: 0 },
    ]);
  });

  it('returns empty status groups without reading run stats', async () => {
    const groups = await new TaskModel(serverDB, userId).groupList({
      groups: [{ key: 'running', statuses: ['running'] }],
    });

    expect(groups).toEqual([
      { hasMore: false, key: 'running', limit: 50, offset: 0, tasks: [], total: 0 },
    ]);
  });

  it('defaults run totals for a task whose stats row is gone', async () => {
    // A task deleted between the list read and the run-stats aggregate has no
    // stats row; the list still renders it with zero totals.
    const model = new TaskModel(serverDB, userId);
    const task = await model.create({ instruction: 'listed' });
    const execute = serverDB.execute.bind(serverDB);
    vi.spyOn(serverDB, 'execute').mockImplementation(((query: any) =>
      dialect.sqlToQuery(query).sql.includes('total_run_cost')
        ? Promise.resolve({ rows: [] })
        : execute(query)) as typeof serverDB.execute);

    const [group] = await model.groupList({ groups: [{ key: 'backlog', statuses: ['backlog'] }] });

    expect(group.tasks).toEqual([
      expect.objectContaining({ id: task.id, totalRunCost: 0, totalRunDuration: 0 }),
    ]);
  });
});

describe('TaskModel transfer visibility', () => {
  it('moves a subtree into a workspace with the requested visibility', async () => {
    await createWorkspaces();
    const model = new TaskModel(serverDB, userId);
    const root = await model.create({ instruction: 'root' });
    const child = await model.create({ instruction: 'child', parentTaskId: root.id });

    const { taskIds } = await model.transferTo(root.id, workspaceId, userId, 'public');

    expect(taskIds.sort()).toEqual([root.id, child.id].sort());
    const moved = await serverDB.select().from(tasks).where(inArray(tasks.id, taskIds));
    expect(moved.map((t) => [t.workspaceId, t.visibility])).toEqual([
      [workspaceId, 'public'],
      [workspaceId, 'public'],
    ]);
  });

  it('copies a subtree into a workspace with the requested visibility', async () => {
    await createWorkspaces();
    const model = new TaskModel(serverDB, userId);
    const root = await model.create({ instruction: 'root' });
    await model.create({ instruction: 'child', parentTaskId: root.id });

    const { rootId } = await model.copyToWorkspace(root.id, otherWorkspaceId, userId, 'public');

    const [copy] = await serverDB.select().from(tasks).where(eq(tasks.id, rootId));
    expect(copy).toMatchObject({ visibility: 'public', workspaceId: otherWorkspaceId });
    const copiedChildren = await new TaskModel(serverDB, userId, otherWorkspaceId).findSubtasks(
      rootId,
    );
    expect(copiedChildren).toEqual([
      expect.objectContaining({ instruction: 'child', visibility: 'public' }),
    ]);
  });
});
