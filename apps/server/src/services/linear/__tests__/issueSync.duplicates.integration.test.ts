// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectModel } from '@/database/models/project';
import { TaskModel } from '@/database/models/task';
import { TaskExternalLinkModel } from '@/database/models/taskExternalLink';
import { tasks, users } from '@/database/schemas';
import { TaskService } from '@/server/services/task';

import type * as IssuesModule from '../issues';
import type { LinearIssue, LinearIssueComment } from '../issues';
import { LinearIssueSyncService, MAX_TASKS_CREATED_PER_SYNC } from '../issueSync';

const linear = vi.hoisted(() => ({
  getLinearIssuesByIds: vi.fn(),
  listLinearIssueComments: vi.fn(),
}));
vi.mock('../issues', async (importOriginal) => ({
  ...(await importOriginal<typeof IssuesModule>()),
  getLinearIssuesByIds: linear.getLinearIssuesByIds,
  listLinearIssueComments: linear.listLinearIssueComments,
}));

const userId = 'linear-issue-duplicates-user';
const TOKEN = 'token';

// Module-level: the first call migrates a fresh database.
const db: LobeChatDatabase = await getTestDB();

const issue = (overrides: Partial<LinearIssue> & { id: string }): LinearIssue => ({
  description: `Body of ${overrides.id}`,
  identifier: `ENG-${overrides.id}`,
  priority: 2,
  state: { name: 'Todo', type: 'unstarted' },
  team: { id: 'team-1', key: 'ENG' },
  title: `Issue ${overrides.id}`,
  updatedAt: '2026-10-01T00:00:00.000Z',
  url: `https://linear.app/acme/issue/ENG-${overrides.id}`,
  ...overrides,
});

const comment = (id: string, issueId: string): LinearIssueComment =>
  ({
    body: `Comment ${id}`,
    createdAt: '2026-10-02T00:00:00.000Z',
    id,
    issueId,
  }) as LinearIssueComment;

const serve = (issues: LinearIssue[]) =>
  linear.getLinearIssuesByIds.mockImplementation(async (_token: string, ids: string[]) =>
    issues.filter((item) => ids.includes(item.id)),
  );

const taskRows = () => db.select().from(tasks).where(eq(tasks.createdByUserId, userId));

const links = () => new TaskExternalLinkModel(db, userId).findByExternalIds('linear', ['1', '2']);

const service = () => new LinearIssueSyncService(db, userId);

beforeEach(async () => {
  vi.clearAllMocks();
  linear.listLinearIssueComments.mockResolvedValue([]);
  await db.delete(users).where(eq(users.id, userId));
  await db.insert(users).values({ id: userId });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(users).where(eq(users.id, userId));
});

describe('LinearIssueSyncService.importIssues duplicates (real PostgreSQL)', () => {
  it('keeps one task per issue by default', async () => {
    serve([issue({ id: '1' })]);
    await service().importIssues(TOKEN, ['1']);

    const again = await service().importIssues(TOKEN, ['1']);

    expect(again).toMatchObject({ created: 0, unchanged: 1 });
    expect(await taskRows()).toHaveLength(1);
  });

  it('adds an unlinked copy on request and leaves the linked task alone', async () => {
    serve([issue({ id: '1' })]);
    await service().importIssues(TOKEN, ['1']);
    const [link] = await links();

    // The issue changed in Linear: the default would rewrite the linked task.
    serve([issue({ id: '1', title: 'Renamed' })]);
    const result = await service().importIssues(TOKEN, ['1'], { importDuplicates: true });

    expect(result).toMatchObject({ created: 1, unchanged: 0, updated: 0 });
    const rows = await taskRows();
    expect(rows).toHaveLength(2);
    const original = rows.find((row) => row.id === link.taskId)!;
    const copy = rows.find((row) => row.id !== link.taskId)!;
    expect(original.name).toBe('Issue 1');
    expect(copy.name).toBe('Renamed');
    expect(copy.instruction).toContain('[ENG-1](https://linear.app/acme/issue/ENG-1)');
    expect(await links()).toEqual([expect.objectContaining({ id: link.id, taskId: link.taskId })]);
  });

  it('creates another copy on every further import, and later syncs ignore them', async () => {
    serve([issue({ id: '1' })]);
    await service().importIssues(TOKEN, ['1']);
    await service().importIssues(TOKEN, ['1'], { importDuplicates: true });
    await service().importIssues(TOKEN, ['1'], { importDuplicates: true });
    const before = await taskRows();
    expect(before).toHaveLength(3);
    const [link] = await links();

    serve([issue({ id: '1', title: 'Renamed' })]);
    expect(await service().importIssues(TOKEN, ['1'])).toMatchObject({ created: 0, updated: 1 });

    const after = await taskRows();
    expect(after.filter((row) => row.name === 'Renamed').map((row) => row.id)).toEqual([
      link.taskId,
    ]);
  });

  it('still links an issue imported for the first time', async () => {
    serve([issue({ id: '1' })]);

    const result = await service().importIssues(TOKEN, ['1'], { importDuplicates: true });

    expect(result).toMatchObject({ created: 1 });
    expect(await taskRows()).toHaveLength(1);
    expect(await links()).toHaveLength(1);
  });

  it('copies comments onto the copy and not the linked task', async () => {
    serve([issue({ id: '1' })]);
    await service().importIssues(TOKEN, ['1']);
    const [link] = await links();
    linear.listLinearIssueComments.mockResolvedValue([comment('c1', '1')]);

    const result = await service().importIssues(TOKEN, ['1'], {
      importDuplicates: true,
      syncComments: true,
    });

    expect(result.commentsImported).toBe(1);
    const [after] = await links();
    expect(after.metadata?.syncedCommentIds ?? []).toEqual([]);
    const rows = await taskRows();
    const model = new TaskModel(db, userId);
    const copy = rows.find((row) => row.id !== link.taskId)!;
    expect(await model.getComments(copy.id)).toHaveLength(1);
    expect(await model.getComments(link.taskId)).toHaveLength(0);
  });

  it('syncs comments through the link for a first import in the same run', async () => {
    serve([issue({ id: '1' }), issue({ id: '2' })]);
    await service().importIssues(TOKEN, ['1']);
    linear.listLinearIssueComments.mockResolvedValue([comment('c1', '1'), comment('c2', '2')]);

    const result = await service().importIssues(TOKEN, ['1', '2'], {
      importDuplicates: true,
      syncComments: true,
    });

    expect(result.commentsImported).toBe(2);
    const linked = await links();
    expect(linked.find((link) => link.externalId === '1')?.metadata?.commentsSynced).toBeFalsy();
    expect(linked.find((link) => link.externalId === '2')?.metadata?.syncedCommentIds).toEqual([
      'c2',
    ]);
  });

  it('reports copied comments it could not read as final, keeping the copy', async () => {
    serve([issue({ id: '1' })]);
    await service().importIssues(TOKEN, ['1']);
    linear.listLinearIssueComments.mockRejectedValue(new Error('throttled'));

    const result = await service().importIssues(TOKEN, ['1'], {
      importDuplicates: true,
      syncComments: true,
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toEqual([{ identifier: 'ENG-1', reason: 'duplicateCommentsFailed' }]);
  });

  it('nests a child copy under the parent copy of the same run', async () => {
    const parent = issue({ id: '1' });
    const child = issue({ id: '2', parent: { id: '1' } } as Partial<LinearIssue> & { id: string });
    serve([child, parent]);
    await service().importIssues(TOKEN, ['1', '2']);
    const linkedIds = new Set((await links()).map((link) => link.taskId));

    await service().importIssues(TOKEN, ['1', '2'], { importDuplicates: true });

    const copies = (await taskRows()).filter((row) => !linkedIds.has(row.id));
    expect(copies).toHaveLength(2);
    const parentCopy = copies.find((row) => row.name === 'Issue 1')!;
    const childCopy = copies.find((row) => row.name === 'Issue 2')!;
    expect(childCopy.parentTaskId).toBe(parentCopy.id);
  });

  it('closes the copy of a closed issue and lands it in the target project', async () => {
    const project = await new ProjectModel(db, userId).create({ name: 'Target' } as never);
    serve([issue({ id: '1', state: { name: 'Done', type: 'completed' } })]);
    await service().importIssues(TOKEN, ['1']);
    const [link] = await links();

    await service().importIssues(TOKEN, ['1'], {
      importDuplicates: true,
      targetProjectId: project.id,
    });

    const copy = (await taskRows()).find((row) => row.id !== link.taskId)!;
    expect(copy).toMatchObject({ projectId: project.id, status: 'completed' });
  });

  it('archives the copy of an archived issue at the time Linear did', async () => {
    const archivedAt = '2026-10-03T00:00:00.000Z';
    serve([issue({ archivedAt, id: '1', state: { name: 'Done', type: 'completed' } })]);
    await service().importIssues(TOKEN, ['1']);
    const [link] = await links();

    const result = await service().importIssues(TOKEN, ['1'], { importDuplicates: true });

    const copy = (await taskRows()).find((row) => row.id !== link.taskId)!;
    expect(result).toMatchObject({ archived: 1, created: 1 });
    expect(copy.archivedAt?.toISOString()).toBe(archivedAt);
    expect(link.metadata?.appliedArchivedAt).toBe(archivedAt);
  });

  it('counts a copy it could not close, so the run does not read as a retry', async () => {
    serve([issue({ id: '1', state: { name: 'Done', type: 'completed' } })]);
    const sync = service();
    await sync.importIssues(TOKEN, ['1']);
    const before = await taskRows();
    vi.spyOn(TaskService.prototype, 'updateStatus').mockRejectedValue(new Error('boom'));

    const result = await sync.importIssues(TOKEN, ['1'], { importDuplicates: true });

    expect(result.created).toBe(1);
    expect(result.skipped).toEqual([{ identifier: 'ENG-1', reason: 'duplicateNotClosed' }]);
    expect(await taskRows()).toHaveLength(before.length + 1);
  });

  it('holds to the task cap of a run', async () => {
    const issues = Array.from({ length: MAX_TASKS_CREATED_PER_SYNC + 1 }, (_, index) =>
      issue({ id: `${index}` }),
    );
    serve(issues);
    const ids = issues.map((item) => item.id);
    await service().importIssues(TOKEN, ids.slice(0, MAX_TASKS_CREATED_PER_SYNC));
    await service().importIssues(TOKEN, ids.slice(MAX_TASKS_CREATED_PER_SYNC));
    linear.listLinearIssueComments.mockClear();

    const result = await service().importIssues(TOKEN, ids, {
      importDuplicates: true,
      syncComments: true,
    });

    // Running again would copy the first ones again, so the rest are named, not "continued".
    expect(result).toMatchObject({ created: MAX_TASKS_CREATED_PER_SYNC, truncated: false });
    expect(result.skipped).toEqual([
      { identifier: `ENG-${MAX_TASKS_CREATED_PER_SYNC}`, reason: 'duplicateLimit' },
    ]);
    // The issue left out of this run keeps its linked task as it was, comments included.
    expect(linear.listLinearIssueComments.mock.calls.flatMap((call) => call[1])).toHaveLength(
      MAX_TASKS_CREATED_PER_SYNC,
    );
  });
});
