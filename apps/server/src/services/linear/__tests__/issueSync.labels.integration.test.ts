// @vitest-environment node
import { type LobeChatDatabase } from '@lobechat/database';
import { getTestDB } from '@lobechat/database/test-utils';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskModel } from '@/database/models/task';
import { TaskExternalLinkModel } from '@/database/models/taskExternalLink';
import { TaskLabelModel } from '@/database/models/taskLabel';
import { users } from '@/database/schemas';

import type * as IssuesModule from '../issues';
import type { LinearIssue } from '../issues';
import { LinearIssueSyncService } from '../issueSync';

const linear = vi.hoisted(() => ({
  getLinearIssuesByIds: vi.fn(),
  getLinearProjectTeamIds: vi.fn(),
  listLinearIssueComments: vi.fn(),
  listLinearIssues: vi.fn(),
}));
vi.mock('../issues', async (importOriginal) => ({
  ...(await importOriginal<typeof IssuesModule>()),
  getLinearIssuesByIds: linear.getLinearIssuesByIds,
  getLinearProjectTeamIds: linear.getLinearProjectTeamIds,
  listLinearIssueComments: linear.listLinearIssueComments,
  listLinearIssues: linear.listLinearIssues,
}));

const userId = 'linear-issue-sync-labels-user';
const otherUserId = 'linear-issue-sync-labels-other';
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

describe('LinearIssueSyncService labels (real PostgreSQL)', () => {
  const labels = (
    ...nodes: { color?: string; name: string; parent?: { color?: string; name: string } }[]
  ) => ({ labels: { nodes } });
  const rule = { ...filter, stateTypes: [...filter.stateTypes] };
  const syncLabels = { syncLabels: true };

  const taskLabelNames = async (externalId: string) => {
    const task = await linkedTask(externalId);
    const rows = await new TaskLabelModel(db, userId).getTaskLabels(task!.id);
    return rows.map((label) => label.name).sort();
  };

  it('leaves labels alone unless the run asks for them', async () => {
    serve([issue({ id: '1', ...labels({ name: 'Bug' }) })]);

    await new LinearIssueSyncService(db, userId).syncByFilter(TOKEN, rule);

    expect(await taskLabelNames('1')).toEqual([]);
    expect(await new TaskLabelModel(db, userId).query()).toEqual([]);
  });

  it('creates missing labels with their color and reuses one that exists', async () => {
    const model = new TaskLabelModel(db, userId);
    const existing = await model.create({ color: '#111111', name: 'bug' });
    serve([
      issue({
        id: '1',
        ...labels({ color: '#EB5757', name: 'Bug' }, { color: '#4CB782', name: 'Backend' }),
      }),
      issue({ id: '2', ...labels({ color: '#4CB782', name: 'Backend' }) }),
    ]);

    const result = await new LinearIssueSyncService(db, userId).syncByFilter(
      TOKEN,
      rule,
      syncLabels,
    );

    expect(result).toMatchObject({ created: 2, labelsSynced: 2, skippedCount: 0 });
    expect(await taskLabelNames('1')).toEqual(['Backend', 'bug']);
    expect(await taskLabelNames('2')).toEqual(['Backend']);
    const registry = await model.query();
    expect(registry).toHaveLength(2);
    expect(registry.find((label) => label.id === existing.id)?.color).toBe('#111111');
    expect(registry.find((label) => label.name === 'Backend')?.color).toBe('#4CB782');
  });

  it("mirrors a Linear label group and drops a color that isn't a hex literal", async () => {
    serve([
      issue({
        id: '1',
        ...labels({
          color: 'url(https://evil.example/x)',
          name: 'Bug',
          parent: { color: '#5E6AD2', name: 'Type' },
        }),
      }),
    ]);

    await new LinearIssueSyncService(db, userId).syncByFilter(TOKEN, rule, syncLabels);

    const registry = await new TaskLabelModel(db, userId).query();
    const group = registry.find((label) => label.name === 'Type');
    expect(group).toMatchObject({ color: '#5E6AD2', isGroup: true });
    expect(registry.find((label) => label.name === 'Bug')).toMatchObject({
      color: null,
      isGroup: false,
      parentId: group?.id,
    });
    expect(await taskLabelNames('1')).toEqual(['Bug']);
  });

  it('follows changes in Linear and keeps changes made on the task', async () => {
    const service = new LinearIssueSyncService(db, userId);
    const model = new TaskLabelModel(db, userId);
    serve([issue({ id: '1', ...labels({ name: 'A' }, { name: 'B' }) })]);
    await service.syncByFilter(TOKEN, rule, syncLabels);

    // On the task: B taken off, and a label of its own added.
    const task = await linkedTask('1');
    const [mine] = await model.findOrCreateMany([{ name: 'Mine' }]);
    const [b] = await model.findByNames(['B']);
    await model.changeTaskLabels(task!.id, { add: [mine.id], remove: [b.id] });

    // In Linear: A removed, C added, B untouched.
    serve([
      issue({
        id: '1',
        updatedAt: '2026-10-02T00:00:00.000Z',
        ...labels({ name: 'B' }, { name: 'C' }),
      }),
    ]);
    await service.syncByFilter(TOKEN, rule, syncLabels);

    expect(await taskLabelNames('1')).toEqual(['C', 'Mine']);
    // The label itself stays for other tasks; only this task lost it.
    expect((await model.findByNames(['A'])).map((label) => label.name)).toEqual(['A']);
  });

  it('labels tasks synced before, and does not write again when nothing changed', async () => {
    const service = new LinearIssueSyncService(db, userId);
    serve([issue({ id: '1', ...labels({ name: 'Bug' }) })]);
    await service.syncByFilter(TOKEN, rule);
    expect(await taskLabelNames('1')).toEqual([]);

    await service.syncByFilter(TOKEN, rule, syncLabels);
    expect(await taskLabelNames('1')).toEqual(['Bug']);

    // Still known after a display refresh, which replaces the rest of the metadata.
    serve([issue({ id: '1', updatedAt: '2026-10-02T00:00:00.000Z', ...labels({ name: 'Bug' }) })]);
    await service.syncByFilter(TOKEN, rule);
    const task = await linkedTask('1');
    const model = new TaskLabelModel(db, userId);
    const [bug] = await model.findByNames(['Bug']);
    await model.removeTaskLabels(task!.id, [bug.id]);

    await service.syncByFilter(TOKEN, rule, syncLabels);
    expect(await taskLabelNames('1')).toEqual([]);
  });

  it('attaches one label per group when the registry groups two of an issue together', async () => {
    const model = new TaskLabelModel(db, userId);
    const group = await model.create({ isGroup: true, name: 'Kind' });
    await model.create({ name: 'Bug', parentId: group.id });
    await model.create({ name: 'Feature', parentId: group.id });
    serve([issue({ id: '1', ...labels({ name: 'Bug' }, { name: 'Feature' }) })]);

    const result = await new LinearIssueSyncService(db, userId).syncByFilter(
      TOKEN,
      rule,
      syncLabels,
    );

    expect(result.skippedCount).toBe(0);
    expect(await taskLabelNames('1')).toEqual(['Bug']);
  });

  it('skips a name the registry holds as a group, keeping the other labels', async () => {
    await new TaskLabelModel(db, userId).create({ isGroup: true, name: 'Bug' });
    serve([issue({ id: '1', ...labels({ name: 'Bug' }, { name: 'Backend' }) })]);

    const result = await new LinearIssueSyncService(db, userId).syncByFilter(
      TOKEN,
      rule,
      syncLabels,
    );

    expect(result.skippedCount).toBe(0);
    expect(await taskLabelNames('1')).toEqual(['Backend']);
  });

  it('does not count a task none of whose labels could be attached', async () => {
    await new TaskLabelModel(db, userId).create({ isGroup: true, name: 'Bug' });
    serve([issue({ id: '1', ...labels({ name: 'Bug' }) })]);

    const result = await new LinearIssueSyncService(db, userId).syncByFilter(
      TOKEN,
      rule,
      syncLabels,
    );

    expect(result.labelsSynced).toBeUndefined();
  });

  it('reads the same name when cutting a long one leaves a space at the end', async () => {
    const name = `${'a'.repeat(63)} tail`;
    serve([issue({ id: '1', ...labels({ name }) })]);

    await new LinearIssueSyncService(db, userId).syncByFilter(TOKEN, rule, syncLabels);

    expect(await taskLabelNames('1')).toEqual(['a'.repeat(63)]);
  });

  it('counts the tasks whose labels changed, and none when nothing did', async () => {
    const service = new LinearIssueSyncService(db, userId);
    serve([issue({ id: '1', ...labels({ name: 'Bug' }) }), issue({ id: '2' })]);
    await service.syncByFilter(TOKEN, rule);

    const first = await service.syncByFilter(TOKEN, rule, syncLabels);
    expect(first.labelsSynced).toBe(1);

    const second = await service.syncByFilter(TOKEN, rule, syncLabels);
    expect(second.labelsSynced).toBeUndefined();
  });

  it('works the change out from what is recorded now, not from an older read', async () => {
    const service = new LinearIssueSyncService(db, userId);
    serve([issue({ id: '1', ...labels({ name: 'A' }) })]);
    await service.syncByFilter(TOKEN, rule, syncLabels);
    // Another run moved the task on from A to C after this run read the link.
    serve([issue({ id: '1', ...labels({ name: 'C' }) })]);
    await service.syncByFilter(TOKEN, rule, syncLabels);

    // Stale only outside a transaction: the batch is old, the read under the lock is not.
    const read = TaskExternalLinkModel.prototype.findByExternalIds;
    const stale = vi
      .spyOn(TaskExternalLinkModel.prototype, 'findByExternalIds')
      .mockImplementation(async function (this: TaskExternalLinkModel, provider, ids) {
        const rows = await read.call(this, provider, ids);
        if ((this as unknown as { db: unknown }).db !== db) return rows;
        return rows.map((row) => ({ ...row, metadata: { ...row.metadata, syncedLabels: ['a'] } }));
      });
    serve([issue({ id: '1', ...labels({ name: 'B' }) })]);
    await service.syncByFilter(TOKEN, rule, syncLabels);
    stale.mockRestore();

    expect(await taskLabelNames('1')).toEqual(['B']);
  });

  it('imports picked issues with their labels', async () => {
    serve([issue({ id: '1', ...labels({ name: 'Bug' }) })]);

    await new LinearIssueSyncService(db, userId).importIssues(TOKEN, ['1'], syncLabels);

    expect(await taskLabelNames('1')).toEqual(['Bug']);
  });

  it('labels the task of a linked issue Linear closed since', async () => {
    const service = new LinearIssueSyncService(db, userId);
    serve([issue({ id: '1' })]);
    await service.syncByFilter(TOKEN, rule);

    linear.listLinearIssues.mockImplementation(async () => ({ hasMore: false, issues: [] }));
    linear.getLinearIssuesByIds.mockImplementation(async () => [
      issue({
        id: '1',
        state: { name: 'Done', type: 'completed' },
        ...labels({ name: 'Bug' }),
      }),
    ]);
    const result = await service.syncByFilter(TOKEN, rule, syncLabels);

    expect(result.closed).toBe(1);
    expect(await taskLabelNames('1')).toEqual(['Bug']);
  });

  it('reports a failed label write and retries it on the next run', async () => {
    const service = new LinearIssueSyncService(db, userId);
    serve([issue({ id: '1', ...labels({ name: 'Bug' }) })]);
    const record = vi
      .spyOn(TaskExternalLinkModel.prototype, 'recordSyncedLabels')
      .mockRejectedValueOnce(new Error('boom'));

    const failed = await service.syncByFilter(TOKEN, rule, syncLabels);

    expect(failed.created).toBe(1);
    expect(failed.skipped).toEqual([{ identifier: 'ENG-1', reason: 'labelsFailed' }]);
    // Rolled back with the record, so the retry is not mistaken for a label removed on the task.
    expect(await taskLabelNames('1')).toEqual([]);

    record.mockRestore();
    const retried = await service.syncByFilter(TOKEN, rule, syncLabels);
    expect(retried.skippedCount).toBe(0);
    expect(await taskLabelNames('1')).toEqual(['Bug']);
  });
});
