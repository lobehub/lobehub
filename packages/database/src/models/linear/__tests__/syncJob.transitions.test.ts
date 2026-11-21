// @vitest-environment node
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { asyncTasks, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { LinearSyncJobModel } from '../syncJob';

const db: LobeChatDatabase = await getTestDB();

const userId = 'linear-job-transition-user';
const otherUserId = 'linear-job-transition-other';
const workspaceId = 'linear-job-transition-ws';
const projectId = 'linear-job-transition-project';
const ruleId = 'linear-job-transition-rule';

const personal = { userId };
const shared = { userId, workspaceId };

/** A Linear sync job in the given status; `kind: 'rule'` is what `cancel` accepts. */
const job = async (
  overrides: Partial<typeof asyncTasks.$inferInsert> & {
    kind?: 'issues' | 'rule';
    workspace?: boolean;
  } = {},
) => {
  const { kind = 'rule', workspace = false, ...values } = overrides;
  const [row] = await db
    .insert(asyncTasks)
    .values({
      metadata: { connectionId: 'conn', kind, projectId, ruleId },
      status: AsyncTaskStatus.Pending,
      type: AsyncTaskType.LinearIssueSync,
      userId,
      workspaceId: workspace ? workspaceId : null,
      ...values,
    })
    .returning();
  return row;
};

const statusOf = async (id: string) => {
  const [row] = await db.select().from(asyncTasks).where(eq(asyncTasks.id, id));
  return row;
};

beforeEach(async () => {
  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  // Async tasks cascade with their owner and workspace.
  await db.delete(workspaces).where(inArray(workspaces.id, [workspaceId]));
  await db.delete(users).where(inArray(users.id, [userId, otherUserId]));
});

describe('LinearSyncJobModel transitions', () => {
  it('transitions a job only from the statuses it may leave', async () => {
    const pending = await job();

    expect(
      await LinearSyncJobModel.transition(db, personal, pending.id, [AsyncTaskStatus.Pending], {
        status: AsyncTaskStatus.Processing,
      }),
    ).toBe(true);
    expect((await statusOf(pending.id))?.status).toBe(AsyncTaskStatus.Processing);

    // Already past `pending`: the same transition matches no row.
    expect(
      await LinearSyncJobModel.transition(db, personal, pending.id, [AsyncTaskStatus.Pending], {
        status: AsyncTaskStatus.Processing,
      }),
    ).toBe(false);
  });

  it('will not transition a job that already carries an error', async () => {
    const failed = await job({ error: { code: 'rate_limited' } });

    expect(
      await LinearSyncJobModel.transition(db, personal, failed.id, [AsyncTaskStatus.Pending], {
        status: AsyncTaskStatus.Processing,
      }),
    ).toBe(false);
    expect((await statusOf(failed.id))?.status).toBe(AsyncTaskStatus.Pending);
  });

  it('transitions a workspace job through the workspace scope', async () => {
    const pending = await job({ workspace: true });

    expect(
      await LinearSyncJobModel.transition(db, shared, pending.id, [AsyncTaskStatus.Pending], {
        duration: 1500,
        status: AsyncTaskStatus.Success,
      }),
    ).toBe(true);
    expect(await statusOf(pending.id)).toMatchObject({
      duration: 1500,
      status: AsyncTaskStatus.Success,
    });
  });

  it('settles a stopped run once its round has written what it was writing', async () => {
    const running = await job({ status: AsyncTaskStatus.Processing });

    expect(await LinearSyncJobModel.cancel(db, personal, projectId, running.id)).toBe(true);
    // A running rule is only marked as stopping: its round still holds the job.
    expect(await statusOf(running.id)).toMatchObject({
      error: { code: 'canceled' },
      status: AsyncTaskStatus.Processing,
    });

    await LinearSyncJobModel.settleStopped(db, personal, running.id, { duration: 900 });

    expect(await statusOf(running.id)).toMatchObject({
      duration: 900,
      status: AsyncTaskStatus.Error,
    });
  });

  it('ends a queued rule run at once when it is stopped', async () => {
    const queued = await job();

    expect(await LinearSyncJobModel.cancel(db, personal, projectId, queued.id)).toBe(true);
    expect((await statusOf(queued.id))?.status).toBe(AsyncTaskStatus.Error);
  });

  it('never cuts short an import of picked issues', async () => {
    const importRun = await job({ kind: 'issues' });

    expect(await LinearSyncJobModel.cancel(db, personal, projectId, importRun.id)).toBe(false);
    expect(await statusOf(importRun.id)).toMatchObject({ error: null });
  });

  it('finds the unfinished run of a rule, and nothing once it ended', async () => {
    const running = await job({ status: AsyncTaskStatus.Processing });

    expect((await LinearSyncJobModel.findActiveForRule(db, personal, projectId, ruleId))?.id).toBe(
      running.id,
    );

    await LinearSyncJobModel.transition(db, personal, running.id, [AsyncTaskStatus.Processing], {
      status: AsyncTaskStatus.Success,
    });

    expect(await LinearSyncJobModel.findActiveForRule(db, personal, projectId, ruleId)).toBeNull();
  });
});
