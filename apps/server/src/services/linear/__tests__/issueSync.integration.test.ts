// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { TaskExternalLinkModel } from '@/database/models/taskExternalLink';
import { tasks, users } from '@/database/schemas';

import type * as IssuesModule from '../issues';
import type { LinearIssue } from '../issues';
import { LinearIssueSyncService, MAX_TASKS_CREATED_PER_SYNC } from '../issueSync';

const linear = vi.hoisted(() => ({
  getLinearIssuesByIds: vi.fn(),
  listLinearIssues: vi.fn(),
}));
vi.mock('../issues', async (importOriginal) => ({
  ...(await importOriginal<typeof IssuesModule>()),
  getLinearIssuesByIds: linear.getLinearIssuesByIds,
  listLinearIssues: linear.listLinearIssues,
}));

const userId = 'linear-issue-sync-user';
const otherUserId = 'linear-issue-sync-other';
const TOKEN = 'token';
const TEAM = 'team-1';

// Module-level: the first call migrates a fresh database.
const db: LobeChatDatabase = await getTestDB();

const issue = (overrides: Partial<LinearIssue> & { id: string }): LinearIssue => ({
  description: `Body of ${overrides.id}`,
  identifier: `ENG-${overrides.id}`,
  priority: 2,
  state: { name: 'Todo', type: 'unstarted' },
  team: { id: TEAM, key: 'ENG' },
  title: `Issue ${overrides.id}`,
  updatedAt: '2026-10-01T00:00:00.000Z',
  url: `https://linear.app/acme/issue/ENG-${overrides.id}`,
  ...overrides,
});

/** Serve the given issues to both the filtered listing and the by-id lookup. */
const serve = (issues: LinearIssue[]) => {
  linear.listLinearIssues.mockImplementation(async () => ({ hasMore: false, issues }));
  linear.getLinearIssuesByIds.mockImplementation(async (_token: string, ids: string[]) =>
    issues.filter((item) => ids.includes(item.id)),
  );
};

const filter = { stateTypes: ['backlog', 'unstarted', 'started'] as const, teamId: TEAM };

const linkedTask = async (externalId: string, scopeUserId = userId) => {
  const [link] = await new TaskExternalLinkModel(db, scopeUserId).findByExternalIds('linear', [
    externalId,
  ]);
  return link ? new TaskModel(db, scopeUserId).findById(link.taskId) : null;
};

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, otherUserId));
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(users).where(eq(users.id, otherUserId));
});

describe('LinearIssueSyncService (real PostgreSQL)', () => {
  it('creates one task per issue with the issue fields and a link back', async () => {
    serve([issue({ id: '1', priority: 1 })]);
    const service = new LinearIssueSyncService(db, userId);

    const result = await service.syncByFilter(TOKEN, {
      ...filter,
      stateTypes: [...filter.stateTypes],
    });

    expect(result).toMatchObject({ created: 1, updated: 0, closed: 0, truncated: false });
    const task = await linkedTask('1');
    expect(task).toMatchObject({ name: 'Issue 1', priority: 1, status: 'backlog' });
    expect(task?.instruction).toContain('[ENG-1](https://linear.app/acme/issue/ENG-1)');
    expect(task?.instruction).toContain('Body of 1');
  });

  it('updates the same task on a second sync instead of creating another', async () => {
    serve([issue({ id: '1' })]);
    const service = new LinearIssueSyncService(db, userId);
    await service.syncByFilter(TOKEN, { ...filter, stateTypes: [...filter.stateTypes] });

    serve([issue({ id: '1', title: 'Renamed in Linear' })]);
    const result = await service.syncByFilter(TOKEN, {
      ...filter,
      stateTypes: [...filter.stateTypes],
    });

    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect((await linkedTask('1'))?.name).toBe('Renamed in Linear');
    const all = await db.select().from(tasks).where(eq(tasks.createdByUserId, userId));
    expect(all).toHaveLength(1);
  });

  it('keeps a task edited in LobeHub instead of overwriting it', async () => {
    serve([issue({ id: '1' })]);
    const service = new LinearIssueSyncService(db, userId);
    await service.syncByFilter(TOKEN, { ...filter, stateTypes: [...filter.stateTypes] });
    const task = await linkedTask('1');
    await new TaskModel(db, userId).update(task!.id, { name: 'My own title' });

    serve([issue({ id: '1', title: 'Renamed in Linear' })]);
    const result = await service.syncByFilter(TOKEN, {
      ...filter,
      stateTypes: [...filter.stateTypes],
    });

    expect(result).toMatchObject({ keptLocalEdits: 1, unchanged: 0, updated: 0 });
    expect((await linkedTask('1'))?.name).toBe('My own title');
  });

  it('closes the task of an issue Linear completed, even when the filter excludes it', async () => {
    serve([issue({ id: '1' })]);
    const service = new LinearIssueSyncService(db, userId);
    await service.syncByFilter(TOKEN, { ...filter, stateTypes: [...filter.stateTypes] });

    // Completed issues no longer match the open-states filter.
    const done = issue({ id: '1', state: { name: 'Done', type: 'completed' } });
    linear.listLinearIssues.mockResolvedValue({ hasMore: false, issues: [] });
    linear.getLinearIssuesByIds.mockResolvedValue([done]);
    const result = await service.syncByFilter(TOKEN, {
      ...filter,
      stateTypes: [...filter.stateTypes],
    });

    expect(result.closed).toBe(1);
    expect((await linkedTask('1'))?.status).toBe('completed');
  });

  it('does not interrupt a running task when its issue is closed', async () => {
    serve([issue({ id: '1' })]);
    const service = new LinearIssueSyncService(db, userId);
    await service.syncByFilter(TOKEN, { ...filter, stateTypes: [...filter.stateTypes] });
    const task = await linkedTask('1');
    await db.update(tasks).set({ status: 'running' }).where(eq(tasks.id, task!.id));

    serve([issue({ id: '1', state: { name: 'Canceled', type: 'canceled' } })]);
    const result = await service.importIssues(TOKEN, ['1']);

    expect(result).toMatchObject({ closed: 0, unchanged: 0 });
    expect(result.skipped).toEqual([{ identifier: 'ENG-1', reason: 'running' }]);
    expect((await linkedTask('1'))?.status).toBe('running');
  });

  it('skips closed issues it never imported, unless closed states were asked for', async () => {
    serve([issue({ id: '1', state: { name: 'Done', type: 'completed' } })]);
    const service = new LinearIssueSyncService(db, userId);

    const result = await service.importIssues(TOKEN, ['1']);

    // Picked explicitly: imported, then closed like its issue.
    expect(result.created).toBe(1);
    expect((await linkedTask('1'))?.status).toBe('completed');
  });

  it('nests a sub-issue under the task of its parent issue', async () => {
    serve([issue({ id: 'child', parent: { id: 'parent' } }), issue({ id: 'parent' })]);
    const service = new LinearIssueSyncService(db, userId);

    await service.syncByFilter(TOKEN, { ...filter, stateTypes: [...filter.stateTypes] });

    const parent = await linkedTask('parent');
    const child = await linkedTask('child');
    expect(child?.parentTaskId).toBe(parent?.id);
  });

  it('leaves no task behind when its link cannot be written', async () => {
    serve([issue({ id: '1' })]);
    const service = new LinearIssueSyncService(db, userId);
    vi.spyOn(TaskExternalLinkModel.prototype, 'create').mockRejectedValueOnce(
      new Error('connection lost'),
    );

    const failed = await service.importIssues(TOKEN, ['1']);
    expect(failed.skipped).toEqual([{ identifier: 'ENG-1', reason: 'failed' }]);
    expect(await db.select().from(tasks).where(eq(tasks.createdByUserId, userId))).toHaveLength(0);

    // Retrying imports it once, with no orphan from the failed run.
    const retried = await service.importIssues(TOKEN, ['1']);
    expect(retried.created).toBe(1);
    expect(await db.select().from(tasks).where(eq(tasks.createdByUserId, userId))).toHaveLength(1);
  });

  it('nests under the parent another run linked after this batch was loaded', async () => {
    serve([issue({ id: 'parent' })]);
    await new LinearIssueSyncService(db, userId).importIssues(TOKEN, ['parent']);
    const winner = await linkedTask('parent');

    serve([issue({ id: 'parent' }), issue({ id: 'child', parent: { id: 'parent' } })]);
    // This run read its links before the other run linked the parent.
    vi.spyOn(TaskExternalLinkModel.prototype, 'findByExternalIds').mockResolvedValueOnce([]);
    const result = await new LinearIssueSyncService(db, userId).importIssues(TOKEN, [
      'parent',
      'child',
    ]);

    expect(result).toMatchObject({ created: 1, unchanged: 1 });
    expect((await linkedTask('child'))?.parentTaskId).toBe(winner?.id);
    expect(await db.select().from(tasks).where(eq(tasks.createdByUserId, userId))).toHaveLength(2);
  });

  it('counts every skipped issue, beyond the listed ones', async () => {
    const ids = Array.from({ length: 105 }, (_, index) => `s${index}`);
    serve(ids.map((id) => issue({ id })));
    vi.spyOn(TaskExternalLinkModel.prototype, 'create').mockRejectedValue(new Error('down'));

    const result = await new LinearIssueSyncService(db, userId).importIssues(TOKEN, ids);

    expect(result.skipped).toHaveLength(100);
    expect(result.skippedCount).toBe(105);
  });

  it('reports picked issues Linear no longer returns instead of an empty run', async () => {
    serve([issue({ id: '1' })]);

    const result = await new LinearIssueSyncService(db, userId).importIssues(TOKEN, ['1', 'gone']);

    expect(result.created).toBe(1);
    expect(result.skipped).toEqual([{ identifier: 'gone', reason: 'missing' }]);
    expect(result.skippedCount).toBe(1);
  });

  it('keeps each scope separate: another user imports their own task', async () => {
    serve([issue({ id: '1' })]);
    await new LinearIssueSyncService(db, userId).importIssues(TOKEN, ['1']);

    const page = await new LinearIssueSyncService(db, otherUserId).listIssues(TOKEN, {
      ...filter,
      stateTypes: [...filter.stateTypes],
    });
    expect(page.issues[0].linkedTaskIdentifier).toBeUndefined();

    const result = await new LinearIssueSyncService(db, otherUserId).importIssues(TOKEN, ['1']);
    expect(result.created).toBe(1);
    expect((await linkedTask('1', otherUserId))?.createdByUserId).toBe(otherUserId);
  });

  it('reports a trashed task as unavailable instead of re-creating it', async () => {
    serve([issue({ id: '1' })]);
    const service = new LinearIssueSyncService(db, userId);
    await service.importIssues(TOKEN, ['1']);
    const task = await linkedTask('1');
    await db
      .update(tasks)
      .set({ deletedAt: new Date(), isDeleted: true })
      .where(eq(tasks.id, task!.id));

    const result = await service.importIssues(TOKEN, ['1']);

    expect(result).toMatchObject({ created: 0 });
    expect(result.skipped).toEqual([{ identifier: 'ENG-1', reason: 'unavailable' }]);
  });

  it('marks issues already imported in the picker', async () => {
    serve([issue({ id: '1' }), issue({ id: '2' })]);
    const service = new LinearIssueSyncService(db, userId);
    await service.importIssues(TOKEN, ['1']);

    const page = await service.listIssues(TOKEN, { ...filter, stateTypes: [...filter.stateTypes] });

    const task = await linkedTask('1');
    expect(page.issues.map((item) => item.linkedTaskIdentifier)).toEqual([
      task?.identifier,
      undefined,
    ]);
  });

  it('creates a bounded batch per run and continues on the next run', async () => {
    const many = Array.from({ length: MAX_TASKS_CREATED_PER_SYNC + 1 }, (_, index) =>
      issue({ id: `bulk-${index}` }),
    );
    serve(many);
    const service = new LinearIssueSyncService(db, userId);
    const options = { ...filter, stateTypes: [...filter.stateTypes] };

    const first = await service.syncByFilter(TOKEN, options);
    expect(first).toMatchObject({ created: MAX_TASKS_CREATED_PER_SYNC, truncated: true });

    const second = await service.syncByFilter(TOKEN, options);
    expect(second).toMatchObject({
      created: 1,
      truncated: false,
      unchanged: MAX_TASKS_CREATED_PER_SYNC,
    });
  }, 60_000);

  it('reads further pages on the next run once the first ones are imported', async () => {
    const many = Array.from({ length: 160 }, (_, index) => issue({ id: `page-${index}` }));
    linear.listLinearIssues.mockImplementation(
      async (_token: string, _filter: unknown, { after }: { after?: string } = {}) => {
        const start = after ? Number(after) : 0;
        const end = start + 50;
        return {
          cursor: end < many.length ? String(end) : undefined,
          hasMore: end < many.length,
          issues: many.slice(start, end),
        };
      },
    );
    linear.getLinearIssuesByIds.mockResolvedValue([]);
    const service = new LinearIssueSyncService(db, userId);
    const options = { ...filter, stateTypes: [...filter.stateTypes] };

    const first = await service.syncByFilter(TOKEN, options);
    expect(first).toMatchObject({ created: 100, truncated: true });

    const second = await service.syncByFilter(TOKEN, options);
    expect(second).toMatchObject({ created: 60, truncated: false, unchanged: 100 });
  }, 60_000);

  it('keeps a LobeHub edit made after the batch was loaded', async () => {
    serve([issue({ id: '1' })]);
    const service = new LinearIssueSyncService(db, userId);
    await service.importIssues(TOKEN, ['1']);
    const task = await linkedTask('1');

    // The edit lands while the sync is already running: after the batch read
    // the task, before it writes Linear's new title.
    const findByIds = TaskModel.prototype.findByIds;
    const spy = vi.spyOn(TaskModel.prototype, 'findByIds').mockImplementation(async function (
      this: TaskModel,
      ids: string[],
    ) {
      const rows = await findByIds.call(this, ids);
      await new TaskModel(db, userId).update(task!.id, { name: 'Edited mid-sync' });
      return rows;
    });
    serve([issue({ id: '1', title: 'Renamed in Linear' })]);
    const result = await service.importIssues(TOKEN, ['1']);
    spy.mockRestore();

    expect(result).toMatchObject({ keptLocalEdits: 1, updated: 0 });
    expect((await linkedTask('1'))?.name).toBe('Edited mid-sync');
  });

  it('does not close a task that started running after the batch was loaded', async () => {
    serve([issue({ id: '1' })]);
    const service = new LinearIssueSyncService(db, userId);
    await service.importIssues(TOKEN, ['1']);
    const task = await linkedTask('1');

    const findByIds = TaskModel.prototype.findByIds;
    const spy = vi.spyOn(TaskModel.prototype, 'findByIds').mockImplementation(async function (
      this: TaskModel,
      ids: string[],
    ) {
      const rows = await findByIds.call(this, ids);
      await db.update(tasks).set({ status: 'running' }).where(eq(tasks.id, task!.id));
      return rows;
    });
    serve([issue({ id: '1', state: { name: 'Done', type: 'completed' } })]);
    const result = await service.importIssues(TOKEN, ['1']);
    spy.mockRestore();

    expect(result).toMatchObject({ closed: 0 });
    expect(result.skipped).toEqual([{ identifier: 'ENG-1', reason: 'running' }]);
    expect((await linkedTask('1'))?.status).toBe('running');
  });

  it('keeps the hash a concurrent run wrote, so later Linear changes still apply', async () => {
    serve([issue({ id: '1' })]);
    await new LinearIssueSyncService(db, userId).importIssues(TOKEN, ['1']);

    // Run B reads the batch; run A then syncs the same rename and commits first.
    serve([issue({ id: '1', title: 'Renamed once', updatedAt: '2026-10-02T00:00:00.000Z' })]);
    const findByIds = TaskModel.prototype.findByIds;
    let raced = false;
    const spy = vi.spyOn(TaskModel.prototype, 'findByIds').mockImplementation(async function (
      this: TaskModel,
      ids: string[],
    ) {
      const rows = await findByIds.call(this, ids);
      if (!raced) {
        raced = true;
        spy.mockRestore();
        await new LinearIssueSyncService(db, userId).importIssues(TOKEN, ['1']);
      }
      return rows;
    });
    await new LinearIssueSyncService(db, userId).importIssues(TOKEN, ['1']);
    spy.mockRestore();
    expect((await linkedTask('1'))?.name).toBe('Renamed once');

    // A later Linear change must still apply, not be mistaken for a local edit.
    serve([issue({ id: '1', title: 'Renamed twice', updatedAt: '2026-10-03T00:00:00.000Z' })]);
    const result = await new LinearIssueSyncService(db, userId).importIssues(TOKEN, ['1']);

    expect(result).toMatchObject({ keptLocalEdits: 0, updated: 1 });
    expect((await linkedTask('1'))?.name).toBe('Renamed twice');
  });
});
