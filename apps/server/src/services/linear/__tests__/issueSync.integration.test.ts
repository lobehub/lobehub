// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import {
  LINEAR_DEFAULT_IMPORT_STATE_TYPES,
  LINEAR_NO_PROJECT_ID,
  LINEAR_OPEN_ISSUE_STATE_TYPES,
} from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { TaskArchiveModel } from '@/database/models/taskArchive';
import { TaskExternalLinkModel } from '@/database/models/taskExternalLink';
import { tasks, users } from '@/database/schemas';

import type * as ArchiveGuardModule from '../../task/archiveGuard';
import { LinearApiError } from '../client';
import type * as IssuesModule from '../issues';
import type { LinearIssue, LinearIssueComment } from '../issues';
import {
  LinearIssueSyncService,
  MAX_COMMENT_CATCH_UPS_PER_SYNC,
  MAX_TASKS_CREATED_PER_SYNC,
} from '../issueSync';

const linear = vi.hoisted(() => ({
  getArchivedLinearIssuesByIds: vi.fn(),
  getLinearIssuesByIds: vi.fn(),
  getLinearProjectTeamIds: vi.fn(),
  listLinearIssueComments: vi.fn(),
  listLinearIssues: vi.fn(),
}));
const openGoals = vi.hoisted(() => ({ taskIds: new Set<string>() }));
vi.mock('../../task/archiveGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof ArchiveGuardModule>()),
  findTasksInOpenGoals: async (_db: unknown, _scope: unknown, items: { id: string }[]) =>
    new Set(items.map((item) => item.id).filter((id) => openGoals.taskIds.has(id))),
}));
vi.mock('../issues', async (importOriginal) => ({
  ...(await importOriginal<typeof IssuesModule>()),
  getArchivedLinearIssuesByIds: linear.getArchivedLinearIssuesByIds,
  getLinearIssuesByIds: linear.getLinearIssuesByIds,
  getLinearProjectTeamIds: linear.getLinearProjectTeamIds,
  listLinearIssueComments: linear.listLinearIssueComments,
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
  linear.getArchivedLinearIssuesByIds.mockImplementation(async (_token: string, ids: string[]) =>
    issues.filter((item) => ids.includes(item.id) && item.archivedAt),
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

  it('closes the task of a project issue that lives in another team than the filter', async () => {
    // A project linked to teams PKG and LOBE whose issues all live in LOBE,
    // synced through a rule that names PKG.
    const projectFilter = {
      linearProjectId: 'project-1',
      stateTypes: [...filter.stateTypes],
      teamId: 'team-pkg',
    };
    const project = { id: 'project-1', name: 'LobeHub Model' };
    const lobeIssue = issue({ id: '1', project, team: { id: 'team-lobe', key: 'LOBE' } });
    linear.getLinearProjectTeamIds.mockResolvedValue(['team-pkg', 'team-lobe']);
    serve([lobeIssue]);
    const service = new LinearIssueSyncService(db, userId);
    expect((await service.syncByFilter(TOKEN, projectFilter)).created).toBe(1);

    // Closed in Linear, so the open-states filter no longer returns it.
    linear.listLinearIssues.mockResolvedValue({ hasMore: false, issues: [] });
    linear.getLinearIssuesByIds.mockResolvedValue([
      { ...lobeIssue, state: { name: 'Done', type: 'completed' } },
    ]);
    const result = await service.syncByFilter(TOKEN, projectFilter);

    expect(result.closed).toBe(1);
    expect((await linkedTask('1'))?.status).toBe('completed');
  });

  it('fails a project rule whose teams cannot be read instead of narrowing the closing pass', async () => {
    linear.getLinearProjectTeamIds.mockRejectedValue(new Error('Linear API error: timeout'));
    serve([issue({ id: '1', team: { id: 'team-lobe', key: 'LOBE' } })]);

    await expect(
      new LinearIssueSyncService(db, userId).syncByFilter(TOKEN, {
        linearProjectId: 'project-1',
        stateTypes: [...filter.stateTypes],
        teamId: 'team-pkg',
      }),
    ).rejects.toThrow('timeout');
  });

  it('syncs a team’s issues without a project, never looking No project up as a project', async () => {
    const noProjectFilter = {
      linearProjectId: LINEAR_NO_PROJECT_ID,
      stateTypes: [...filter.stateTypes],
      teamId: TEAM,
    };
    serve([issue({ id: '1' })]);
    const service = new LinearIssueSyncService(db, userId);
    expect((await service.syncByFilter(TOKEN, noProjectFilter)).created).toBe(1);

    // Moved into a project and closed there: the team-wide closing pass still closes it.
    linear.listLinearIssues.mockResolvedValue({ hasMore: false, issues: [] });
    linear.getLinearIssuesByIds.mockResolvedValue([
      issue({
        id: '1',
        project: { id: 'project-1', name: 'Later' },
        state: { name: 'Done', type: 'completed' },
      }),
    ]);
    const result = await service.syncByFilter(TOKEN, noProjectFilter);

    expect(linear.getLinearProjectTeamIds).not.toHaveBeenCalled();
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

  it('imports completed issues as completed tasks when the filter includes completed', async () => {
    serve([
      issue({ id: '1', state: { name: 'Done', type: 'completed' } }),
      issue({ id: '2', state: { name: 'In Progress', type: 'started' } }),
    ]);
    const service = new LinearIssueSyncService(db, userId);

    const result = await service.syncByFilter(TOKEN, {
      stateTypes: [...LINEAR_DEFAULT_IMPORT_STATE_TYPES],
      teamId: TEAM,
    });

    expect(result).toMatchObject({ created: 2, skipped: [] });
    expect((await linkedTask('1'))?.status).toBe('completed');
    expect((await linkedTask('2'))?.status).toBe('backlog');
  });

  it('skips completed issues when the filter only asks for open states', async () => {
    serve([issue({ id: '1', state: { name: 'Done', type: 'completed' } })]);
    const service = new LinearIssueSyncService(db, userId);

    const result = await service.syncByFilter(TOKEN, {
      stateTypes: [...LINEAR_OPEN_ISSUE_STATE_TYPES],
      teamId: TEAM,
    });

    expect(result.created).toBe(0);
    expect(result.skipped).toEqual([{ identifier: 'ENG-1', reason: 'closed' }]);
    expect(await linkedTask('1')).toBeNull();
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

  it('resumes where it left off, without rereading earlier pages or losing a capped issue', async () => {
    const many = Array.from({ length: 200 }, (_, index) => issue({ id: `cur-${index}` }));
    const reads: (string | undefined)[] = [];
    linear.listLinearIssues.mockImplementation(
      async (_token: string, _filter: unknown, { after }: { after?: string } = {}) => {
        reads.push(after);
        const start = after ? Number(after) : 0;
        const end = start + 50;
        return {
          cursor: end < many.length ? String(end) : undefined,
          hasMore: end < many.length,
          issues: many.slice(start, end),
        };
      },
    );
    linear.getLinearIssuesByIds.mockImplementation(async (_token: string, ids: string[]) =>
      many.filter((item) => ids.includes(item.id)),
    );
    const service = new LinearIssueSyncService(db, userId);
    // 30 of the first page are already in, so the cap falls inside the third page.
    await service.importIssues(
      TOKEN,
      many.slice(0, 30).map((item) => item.id),
    );
    linear.getLinearIssuesByIds.mockClear();
    const options = { ...filter, stateTypes: [...filter.stateTypes] };

    const first = await service.syncByFilter(TOKEN, options);
    expect(first).toMatchObject({ created: 100, resumeAfter: '100', truncated: true });
    expect(reads).toEqual([undefined, '50', '100']);

    // From the third page: its 20 left-over issues are not skipped.
    reads.length = 0;
    const second = await service.syncByFilter(TOKEN, options, { startAfter: first.resumeAfter });
    expect(second).toMatchObject({ created: 70, truncated: false });
    expect(second.resumeAfter).toBeUndefined();
    expect(reads).toEqual(['100', '150']);
    // The closing pass waits for a run that reads from the start.
    expect(linear.getLinearIssuesByIds).not.toHaveBeenCalled();

    for (const item of many) expect(await linkedTask(item.id)).not.toBeNull();
  }, 60_000);

  it('reconciles every page without creating when told not to create', async () => {
    const many = Array.from({ length: 150 }, (_, index) => issue({ id: `nc-${index}` }));
    const reads: (string | undefined)[] = [];
    linear.listLinearIssues.mockImplementation(
      async (_token: string, _filter: unknown, { after }: { after?: string } = {}) => {
        reads.push(after);
        const start = after ? Number(after) : 0;
        const end = start + 50;
        return {
          cursor: end < many.length ? String(end) : undefined,
          hasMore: end < many.length,
          issues: many.slice(start, end),
        };
      },
    );
    linear.getLinearIssuesByIds.mockImplementation(async (_token: string, ids: string[]) =>
      many.filter((item) => ids.includes(item.id)),
    );
    const service = new LinearIssueSyncService(db, userId);
    await service.importIssues(TOKEN, ['nc-149']);
    many[149] = { ...many[149], title: 'Renamed in Linear' };

    const result = await service.syncByFilter(
      TOKEN,
      { ...filter, stateTypes: [...filter.stateTypes] },
      { noCreate: true },
    );

    expect(reads).toEqual([undefined, '50', '100']);
    expect(result).toMatchObject({ created: 0, truncated: true, updated: 1 });
    expect(await linkedTask('nc-0')).toBeNull();
    expect((await linkedTask('nc-149'))?.name).toBe('Renamed in Linear');
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

describe('LinearIssueSyncService comments (real PostgreSQL)', () => {
  const comment = (
    overrides: Partial<LinearIssueComment> & { id: string; issueId: string },
  ): LinearIssueComment => ({
    body: `Comment ${overrides.id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    url: `https://linear.app/acme/issue/ENG-1#comment-${overrides.id}`,
    user: { displayName: 'JianXu', name: 'Jian Xu' },
    ...overrides,
  });

  /** Serve these comments for whichever issues are asked about. */
  const serveComments = (comments: LinearIssueComment[]) =>
    linear.listLinearIssueComments.mockImplementation(async (_token: string, ids: string[]) =>
      comments.filter((item) => ids.includes(item.issueId!)),
    );

  const commentsOf = async (externalId: string) => {
    const task = await linkedTask(externalId);
    return task ? new TaskModel(db, userId).getComments(task.id) : [];
  };

  const states = [...filter.stateTypes];

  it('copies an imported issue’s comments onto its task, credited and in Linear’s time', async () => {
    serve([issue({ id: '1' })]);
    serveComments([
      comment({ createdAt: '2026-02-01T00:00:00.000Z', id: 'c2', issueId: '1', parentId: 'c1' }),
      comment({ createdAt: '2026-01-01T00:00:00.000Z', id: 'c1', issueId: '1' }),
    ]);

    const result = await new LinearIssueSyncService(db, userId).importIssues(TOKEN, ['1'], {
      syncComments: true,
    });

    expect(result).toMatchObject({ commentsImported: 2, created: 1 });
    const comments = await commentsOf('1');
    // Written in the order Linear returned them, each at its Linear time.
    expect(comments.map((item) => item.createdAt.toISOString())).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    ]);
    expect(comments[0]).toMatchObject({
      authorUserId: userId,
      content:
        '> **JianXu** on [Linear](https://linear.app/acme/issue/ENG-1#comment-c1)\n\nComment c1',
    });
    expect(comments[1].content).toContain('**JianXu** replied on');
  });

  it('adds only new comments when synced again, even after the link is refreshed', async () => {
    const service = new LinearIssueSyncService(db, userId);
    serve([issue({ id: '1' })]);
    serveComments([comment({ id: 'c1', issueId: '1' })]);
    await service.syncByFilter(TOKEN, { ...filter, stateTypes: states }, { syncComments: true });

    // Linear changed the issue too, so the link's display metadata is rewritten.
    serve([issue({ id: '1', title: 'Renamed', updatedAt: '2026-10-02T00:00:00.000Z' })]);
    serveComments([comment({ id: 'c1', issueId: '1' }), comment({ id: 'c2', issueId: '1' })]);
    const second = await service.syncByFilter(
      TOKEN,
      { ...filter, stateTypes: states },
      { syncComments: true },
    );
    expect(second).toMatchObject({ commentsImported: 1, updated: 1 });

    const third = await service.syncByFilter(
      TOKEN,
      { ...filter, stateTypes: states },
      { syncComments: true },
    );
    expect(third.commentsImported).toBeUndefined();
    expect((await commentsOf('1')).map((item) => item.content)).toEqual([
      expect.stringContaining('Comment c1'),
      expect.stringContaining('Comment c2'),
    ]);
  });

  it('fills in comments of tasks imported without them', async () => {
    const service = new LinearIssueSyncService(db, userId);
    serve([issue({ id: '1' }), issue({ id: '2' })]);
    serveComments([comment({ id: 'c1', issueId: '1' }), comment({ id: 'c2', issueId: '2' })]);

    const first = await service.syncByFilter(TOKEN, { ...filter, stateTypes: states });
    expect(first.commentsImported).toBeUndefined();
    expect(linear.listLinearIssueComments).not.toHaveBeenCalled();
    expect(await commentsOf('1')).toHaveLength(0);

    const again = await service.importIssues(TOKEN, ['1', '2'], { syncComments: true });

    expect(again).toMatchObject({ commentsImported: 2, created: 0 });
    expect(await commentsOf('1')).toHaveLength(1);
    expect(await commentsOf('2')).toHaveLength(1);
  });

  it('copies the last comments of an issue that left the filter as it closes the task', async () => {
    const service = new LinearIssueSyncService(db, userId);
    serve([issue({ id: '1' })]);
    serveComments([]);
    await service.syncByFilter(TOKEN, { ...filter, stateTypes: states }, { syncComments: true });

    // Commented on, then completed: the open-states filter no longer lists it.
    const done = issue({ id: '1', state: { name: 'Done', type: 'completed' } });
    linear.listLinearIssues.mockImplementation(async () => ({ hasMore: false, issues: [] }));
    linear.getLinearIssuesByIds.mockImplementation(async () => [done]);
    serveComments([comment({ id: 'c-final', issueId: '1' })]);

    const result = await service.syncByFilter(
      TOKEN,
      { ...filter, stateTypes: states },
      { syncComments: true },
    );

    expect(result).toMatchObject({ closed: 1, commentsImported: 1 });
    expect((await linkedTask('1'))?.status).toBe('completed');
    expect((await commentsOf('1')).map((item) => item.content)).toEqual([
      expect.stringContaining('Comment c-final'),
    ]);
  });

  it('leaves the comments of an open issue the filter no longer lists to its own rule', async () => {
    const service = new LinearIssueSyncService(db, userId);
    serve([issue({ id: '1' })]);
    serveComments([]);
    await service.syncByFilter(TOKEN, { ...filter, stateTypes: states }, { syncComments: true });

    // Moved to a project another rule covers: still open, no longer listed.
    linear.listLinearIssues.mockImplementation(async () => ({ hasMore: false, issues: [] }));
    linear.getLinearIssuesByIds.mockImplementation(async () => [issue({ id: '1' })]);
    serveComments([comment({ id: 'c-elsewhere', issueId: '1' })]);
    linear.listLinearIssueComments.mockClear();

    const result = await service.syncByFilter(
      TOKEN,
      { ...filter, stateTypes: states },
      { syncComments: true },
    );

    expect(result.commentsImported).toBeUndefined();
    expect(linear.listLinearIssueComments).not.toHaveBeenCalled();
    expect(await commentsOf('1')).toHaveLength(0);
    expect((await linkedTask('1'))?.status).not.toBe('completed');
  });

  it('catches up the comments of a closed task the filter no longer reaches, once', async () => {
    const service = new LinearIssueSyncService(db, userId);
    // Imported as completed, without comments, before comments could be synced.
    const done = issue({ id: '1', state: { name: 'Done', type: 'completed' } });
    serve([done]);
    await service.importIssues(TOKEN, ['1']);
    expect((await linkedTask('1'))?.status).toBe('completed');

    // A rule over open states only never lists it again.
    linear.listLinearIssues.mockImplementation(async () => ({ hasMore: false, issues: [] }));
    serveComments([comment({ id: 'c1', issueId: '1' })]);
    const result = await service.syncByFilter(
      TOKEN,
      { ...filter, stateTypes: states },
      { syncComments: true },
    );

    expect(result).toMatchObject({ closed: 0, commentsImported: 1 });
    expect(await commentsOf('1')).toHaveLength(1);

    linear.listLinearIssueComments.mockClear();
    const again = await service.syncByFilter(
      TOKEN,
      { ...filter, stateTypes: states },
      { syncComments: true },
    );
    expect(again.commentsImported).toBeUndefined();
    expect(linear.listLinearIssueComments).not.toHaveBeenCalled();
  });

  it('catches up a bounded number of closed tasks per run, the rest on the next', async () => {
    const service = new LinearIssueSyncService(db, userId);
    const total = MAX_COMMENT_CATCH_UPS_PER_SYNC + 1;
    const done = Array.from({ length: total }, (_, index) =>
      issue({ id: `${index + 1}`, state: { name: 'Done', type: 'completed' } }),
    );
    serve(done);
    const ids = done.map((item) => item.id);
    for (let start = 0; start < ids.length; start += MAX_TASKS_CREATED_PER_SYNC) {
      await service.importIssues(TOKEN, ids.slice(start, start + MAX_TASKS_CREATED_PER_SYNC));
    }

    linear.listLinearIssues.mockImplementation(async () => ({ hasMore: false, issues: [] }));
    serveComments(done.map((item) => comment({ id: `c${item.id}`, issueId: item.id })));
    const readIds = () =>
      linear.listLinearIssueComments.mock.calls.flatMap(([, issueIds]) => issueIds as string[]);

    const first = await service.syncByFilter(
      TOKEN,
      { ...filter, stateTypes: states },
      { syncComments: true },
    );
    expect(first.commentsImported).toBe(MAX_COMMENT_CATCH_UPS_PER_SYNC);
    expect(readIds()).toHaveLength(MAX_COMMENT_CATCH_UPS_PER_SYNC);

    linear.listLinearIssueComments.mockClear();
    const second = await service.syncByFilter(
      TOKEN,
      { ...filter, stateTypes: states },
      { syncComments: true },
    );
    expect(second.commentsImported).toBe(1);
    expect(readIds()).toHaveLength(1);
  });

  it('retries a closed task whose comments could not be read', async () => {
    const service = new LinearIssueSyncService(db, userId);
    serve([issue({ id: '1', state: { name: 'Done', type: 'completed' } })]);
    linear.listLinearIssueComments.mockRejectedValue(new LinearApiError('rate limited', 429));
    await service.importIssues(TOKEN, ['1'], { syncComments: true });
    expect(await commentsOf('1')).toHaveLength(0);

    linear.listLinearIssues.mockImplementation(async () => ({ hasMore: false, issues: [] }));
    serveComments([comment({ id: 'c1', issueId: '1' })]);
    const result = await service.syncByFilter(
      TOKEN,
      { ...filter, stateTypes: states },
      { syncComments: true },
    );

    expect(result.commentsImported).toBe(1);
    expect(await commentsOf('1')).toHaveLength(1);
  });

  it('leaves out issues it did not import and tasks the caller cannot see', async () => {
    const service = new LinearIssueSyncService(db, userId);
    serve([issue({ id: '1' })]);
    await service.importIssues(TOKEN, ['1']);
    const task = await linkedTask('1');
    await db
      .update(tasks)
      .set({ deletedAt: new Date(), isDeleted: true })
      .where(eq(tasks.id, task!.id));

    serve([issue({ id: '1' }), issue({ id: '2', state: { name: 'Done', type: 'completed' } })]);
    serveComments([comment({ id: 'c1', issueId: '1' }), comment({ id: 'c2', issueId: '2' })]);
    const result = await service.syncByFilter(
      TOKEN,
      { ...filter, stateTypes: states },
      { syncComments: true },
    );

    expect(result.commentsImported).toBeUndefined();
    expect(linear.listLinearIssueComments).not.toHaveBeenCalled();
  });

  it('keeps the run when comments cannot be read, and fails it on a revoked token', async () => {
    const service = new LinearIssueSyncService(db, userId);
    serve([issue({ id: '1' })]);
    linear.listLinearIssueComments.mockRejectedValue(new LinearApiError('rate limited', 429));

    const result = await service.importIssues(TOKEN, ['1'], { syncComments: true });

    expect(result).toMatchObject({
      created: 1,
      skipped: [{ identifier: 'ENG-1', reason: 'commentsFailed' }],
      skippedCount: 1,
    });
    expect(result.commentsImported).toBeUndefined();

    linear.listLinearIssueComments.mockRejectedValue(new LinearApiError('revoked', 401));
    await expect(service.importIssues(TOKEN, ['1'], { syncComments: true })).rejects.toThrow(
      'revoked',
    );
  });
});

describe('LinearIssueSyncService archived issues (real PostgreSQL, Linear over fetch)', () => {
  /** Linear's own rule: archived issues are left out unless the query asks for them. */
  let linearIssues: (LinearIssue & { archived?: boolean })[] = [];

  beforeEach(async () => {
    const actual = await vi.importActual<typeof IssuesModule>('../issues');
    linear.listLinearIssues.mockImplementation(actual.listLinearIssues);
    linear.getArchivedLinearIssuesByIds.mockImplementation(actual.getArchivedLinearIssuesByIds);
    linear.getLinearIssuesByIds.mockImplementation(actual.getLinearIssuesByIds);
    linear.getLinearProjectTeamIds.mockImplementation(actual.getLinearProjectTeamIds);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const { query, variables } = JSON.parse(init.body as string) as {
          query: string;
          variables: { filter?: any; includeArchived?: boolean };
        };
        const includeArchived =
          variables.includeArchived === true || query.includes('includeArchived: true');
        const { filter: where = {} } = variables;
        const nodes = linearIssues
          .filter((item) => includeArchived || !item.archived)
          .filter((item) => !where.id || where.id.in.includes(item.id))
          .filter((item) => !where.archivedAt || !!item.archivedAt)
          .filter((item) => !where.state || where.state.type.in.includes(item.state.type))
          .filter((item) => !where.team || item.team.id === where.team.id.eq)
          .map(({ archived: _archived, ...rest }) => rest);
        return new Response(
          JSON.stringify({
            data: { issues: { nodes, pageInfo: { endCursor: null, hasNextPage: false } } },
          }),
          { status: 200 },
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    linearIssues = [];
  });

  const done = { name: 'Done', type: 'completed' } as const;

  it('syncs archived issues of a rule only when the run asks for them', async () => {
    linearIssues = [
      issue({ id: '1', state: done }),
      { ...issue({ id: '2', state: done }), archived: true },
    ];
    const service = new LinearIssueSyncService(db, userId);
    const rule = { stateTypes: ['completed' as const], teamId: TEAM };

    const plain = await service.syncByFilter(TOKEN, rule);
    expect(plain.created).toBe(1);
    expect(await linkedTask('2')).toBeNull();

    const withArchived = await service.syncByFilter(TOKEN, { ...rule, includeArchived: true });
    expect(withArchived).toMatchObject({ created: 1, unchanged: 1 });
    expect((await linkedTask('2'))?.status).toBe('completed');
  });

  it('imports a picked archived issue instead of reporting it missing', async () => {
    linearIssues = [{ ...issue({ id: '1', state: done }), archived: true }];

    const result = await new LinearIssueSyncService(db, userId).importIssues(TOKEN, ['1']);

    expect(result).toMatchObject({ created: 1, skipped: [], skippedCount: 0 });
    expect((await linkedTask('1'))?.status).toBe('completed');
  });

  it('closes the task of a linked issue Linear completed and archived since', async () => {
    linearIssues = [issue({ id: '1' })];
    const service = new LinearIssueSyncService(db, userId);
    await service.syncByFilter(TOKEN, { ...filter, stateTypes: [...filter.stateTypes] });

    linearIssues = [{ ...issue({ id: '1', state: done }), archived: true }];
    const result = await service.syncByFilter(TOKEN, {
      ...filter,
      stateTypes: [...filter.stateTypes],
    });

    expect(result.closed).toBe(1);
    expect((await linkedTask('1'))?.status).toBe('completed');
  });

  describe('archiving tasks like their issues', () => {
    const ARCHIVED_AT = '2026-09-01T08:00:00.000Z';
    const rule = {
      includeArchived: true,
      stateTypes: ['backlog' as const, 'unstarted' as const, 'completed' as const],
      teamId: TEAM,
    };
    const archivedIssue = (id: string, archivedAt = ARCHIVED_AT) => ({
      ...issue({ archivedAt, id, state: done }),
      archived: true,
    });

    afterEach(() => openGoals.taskIds.clear());

    it('archives the task of a picked archived issue at the time Linear did', async () => {
      linearIssues = [archivedIssue('1')];

      const result = await new LinearIssueSyncService(db, userId).importIssues(TOKEN, ['1']);

      expect(result).toMatchObject({ archived: 1, created: 1 });
      const task = await linkedTask('1');
      expect(task?.status).toBe('completed');
      expect(task?.archivedAt?.toISOString()).toBe(ARCHIVED_AT);
    });

    it('leaves the task of an unarchived issue out of the archive', async () => {
      linearIssues = [issue({ archivedAt: null, id: '1' })];

      const result = await new LinearIssueSyncService(db, userId).syncByFilter(TOKEN, rule);

      expect(result.archived).toBeUndefined();
      expect((await linkedTask('1'))?.archivedAt).toBeNull();
    });

    it('archives an already imported task on the next run that reads its archived issue', async () => {
      const service = new LinearIssueSyncService(db, userId);
      linearIssues = [issue({ id: '1', state: done })];
      await service.syncByFilter(TOKEN, rule);
      expect((await linkedTask('1'))?.archivedAt).toBeNull();

      linearIssues = [archivedIssue('1')];
      const result = await service.syncByFilter(TOKEN, rule);

      expect(result.archived).toBe(1);
      expect((await linkedTask('1'))?.archivedAt?.toISOString()).toBe(ARCHIVED_AT);
    });

    it('archives an open task whose issue a rule no longer lists, closing nothing', async () => {
      const service = new LinearIssueSyncService(db, userId);
      linearIssues = [issue({ id: '1' })];
      await service.syncByFilter(TOKEN, rule);

      linearIssues = [{ ...issue({ archivedAt: ARCHIVED_AT, id: '1' }), archived: true }];
      const result = await service.syncByFilter(TOKEN, { ...rule, includeArchived: false });

      expect(result).toMatchObject({ archived: 1, closed: 0 });
      const task = await linkedTask('1');
      expect(task?.archivedAt?.toISOString()).toBe(ARCHIVED_AT);
      expect(task?.status).not.toBe('completed');
    });

    it('archives a closed task whose issue is archived later, without the option, and asks once', async () => {
      const service = new LinearIssueSyncService(db, userId);
      linearIssues = [issue({ id: '1', state: done }), issue({ id: '2', state: done })];
      await service.syncByFilter(TOKEN, rule);

      // Archived in Linear after closing, so a listing without the option misses it.
      linearIssues = [archivedIssue('1'), issue({ id: '2', state: done })];
      const plain = { ...rule, includeArchived: false, stateTypes: ['backlog' as const] };
      const result = await service.syncByFilter(TOKEN, plain);

      expect(result.archived).toBe(1);
      expect((await linkedTask('1'))?.archivedAt?.toISOString()).toBe(ARCHIVED_AT);
      expect((await linkedTask('2'))?.archivedAt).toBeNull();

      // Applied: restored stays restored, and this link is not asked about again.
      await new TaskArchiveModel(db, userId).unarchive((await linkedTask('1'))!.id);
      linear.getArchivedLinearIssuesByIds.mockClear();
      expect((await service.syncByFilter(TOKEN, plain)).archived).toBeUndefined();
      expect(linear.getArchivedLinearIssuesByIds.mock.calls[0][1]).toEqual(['2']);
      expect((await linkedTask('1'))?.archivedAt).toBeNull();
    });

    it('does not archive again a task restored in LobeHub', async () => {
      const service = new LinearIssueSyncService(db, userId);
      linearIssues = [archivedIssue('1')];
      await service.syncByFilter(TOKEN, rule);
      const task = await linkedTask('1');
      await new TaskArchiveModel(db, userId).unarchive(task!.id);

      const result = await service.syncByFilter(TOKEN, rule);

      expect(result.archived).toBeUndefined();
      expect(result.unchanged).toBe(1);
      expect((await linkedTask('1'))?.archivedAt).toBeNull();
    });

    it('does not archive again from an older read a task restored since', async () => {
      const service = new LinearIssueSyncService(db, userId);
      linearIssues = [issue({ id: '1', state: done })];
      await service.syncByFilter(TOKEN, rule);
      // What an overlapping run read before this archive was applied.
      const [staleLink] = await new TaskExternalLinkModel(db, userId).findByExternalIds('linear', [
        '1',
      ]);
      const staleTask = await linkedTask('1');

      linearIssues = [archivedIssue('1')];
      await service.syncByFilter(TOKEN, rule);
      await new TaskArchiveModel(db, userId).unarchive(staleTask!.id);

      const result = { archived: undefined, closed: 0, skipped: [], unchanged: 0 };
      await (service as any).syncLinked(archivedIssue('1'), staleLink, staleTask, {}, result);

      expect(result.archived).toBeUndefined();
      expect((await linkedTask('1'))?.archivedAt).toBeNull();
    });

    it('keeps the task archived when Linear restores the issue, and applies a new archive', async () => {
      const service = new LinearIssueSyncService(db, userId);
      linearIssues = [archivedIssue('1')];
      await service.syncByFilter(TOKEN, rule);

      linearIssues = [issue({ archivedAt: null, id: '1', state: done })];
      const restored = await service.syncByFilter(TOKEN, rule);
      expect(restored.archived).toBeUndefined();
      const task = await linkedTask('1');
      expect(task?.archivedAt?.toISOString()).toBe(ARCHIVED_AT);

      // Restored here as well, then archived in Linear once more.
      await new TaskArchiveModel(db, userId).unarchive(task!.id);
      const later = '2026-10-15T08:00:00.000Z';
      linearIssues = [archivedIssue('1', later)];
      const again = await service.syncByFilter(TOKEN, rule);

      expect(again.archived).toBe(1);
      expect((await linkedTask('1'))?.archivedAt?.toISOString()).toBe(later);
    });

    it('keeps the time of a task archived in LobeHub first, without counting it', async () => {
      const service = new LinearIssueSyncService(db, userId);
      linearIssues = [issue({ id: '1', state: done })];
      await service.syncByFilter(TOKEN, rule);
      const task = await linkedTask('1');
      const own = await new TaskArchiveModel(db, userId).archive(task!.id);

      linearIssues = [archivedIssue('1')];
      const result = await service.syncByFilter(TOKEN, rule);

      expect(result.archived).toBeUndefined();
      expect((await linkedTask('1'))?.archivedAt).toEqual(own?.archivedAt);
    });

    it('leaves a running task for a later run, reporting it once', async () => {
      const service = new LinearIssueSyncService(db, userId);
      linearIssues = [issue({ id: '1' })];
      await service.syncByFilter(TOKEN, rule);
      const task = await linkedTask('1');
      await db.update(tasks).set({ status: 'running' }).where(eq(tasks.id, task!.id));

      linearIssues = [archivedIssue('1')];
      const running = await service.syncByFilter(TOKEN, rule);

      expect(running.archived).toBeUndefined();
      expect(running.skipped).toEqual([{ identifier: 'ENG-1', reason: 'running' }]);
      expect((await linkedTask('1'))?.archivedAt).toBeNull();

      await db.update(tasks).set({ status: 'paused' }).where(eq(tasks.id, task!.id));
      const later = await service.syncByFilter(TOKEN, rule);

      expect(later).toMatchObject({ archived: 1, closed: 1 });
      expect((await linkedTask('1'))?.archivedAt?.toISOString()).toBe(ARCHIVED_AT);
    });

    it('leaves a task with a live heartbeat for a later run', async () => {
      const service = new LinearIssueSyncService(db, userId);
      linearIssues = [issue({ id: '1' })];
      await service.syncByFilter(TOKEN, rule);
      const task = await linkedTask('1');
      await db
        .update(tasks)
        .set({ automationMode: 'heartbeat', heartbeatInterval: 60 })
        .where(eq(tasks.id, task!.id));

      linearIssues = [{ ...issue({ archivedAt: ARCHIVED_AT, id: '1' }), archived: true }];
      const live = await service.syncByFilter(TOKEN, rule);
      expect(live.archived).toBeUndefined();
      expect(live.skipped).toEqual([{ identifier: 'ENG-1', reason: 'live' }]);
      expect((await linkedTask('1'))?.archivedAt).toBeNull();

      await db.update(tasks).set({ heartbeatInterval: 0 }).where(eq(tasks.id, task!.id));
      expect((await service.syncByFilter(TOKEN, rule)).archived).toBe(1);
    });

    it('leaves an unfinished task of an open goal for a later run', async () => {
      const service = new LinearIssueSyncService(db, userId);
      linearIssues = [issue({ id: '1' })];
      await service.syncByFilter(TOKEN, rule);
      const task = await linkedTask('1');
      openGoals.taskIds.add(task!.id);

      linearIssues = [{ ...issue({ archivedAt: ARCHIVED_AT, id: '1' }), archived: true }];
      const held = await service.syncByFilter(TOKEN, rule);
      expect(held.archived).toBeUndefined();
      expect(held.skipped).toEqual([{ identifier: 'ENG-1', reason: 'live' }]);
      expect((await linkedTask('1'))?.archivedAt).toBeNull();

      openGoals.taskIds.clear();
      expect((await service.syncByFilter(TOKEN, rule)).archived).toBe(1);
    });
  });
});
