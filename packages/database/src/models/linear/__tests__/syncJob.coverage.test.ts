// @vitest-environment node
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { eq, inArray } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { asyncTasks, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import { LinearSyncJobModel } from '../syncJob';

const db: LobeChatDatabase = await getTestDB();

const userId = 'linear-job-cov-user';
const otherUserId = 'linear-job-cov-other';
const workspaceId = 'linear-job-cov-ws';
const projectId = 'linear-job-cov-project';

const personal = { userId };
const shared = { userId, workspaceId };

const job = async (
  overrides: Partial<typeof asyncTasks.$inferInsert> & { ruleId?: string } = {},
) => {
  const { ruleId, ...values } = overrides;
  const [row] = await db
    .insert(asyncTasks)
    .values({
      metadata: { connectionId: 'conn', kind: ruleId ? 'rule' : 'issues', projectId, ruleId },
      status: AsyncTaskStatus.Pending,
      type: AsyncTaskType.LinearIssueSync,
      userId,
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

describe('LinearSyncJobModel coverage', () => {
  it('lists a project sync jobs newest first, scoped and limited', async () => {
    const older = await job({ createdAt: new Date('2026-01-01T00:00:00.000Z') });
    const newer = await job({ createdAt: new Date('2026-01-02T00:00:00.000Z') });
    // Not a Linear sync, another project, and a workspace job: never listed for personal.
    await job({ type: AsyncTaskType.Chunking });
    await job({ metadata: { connectionId: 'conn', kind: 'issues', projectId: 'other' } });
    const wsJob = await job({ workspaceId });

    expect(
      (await LinearSyncJobModel.listByProject(db, personal, projectId)).map((r) => r.id),
    ).toEqual([newer.id, older.id]);
    expect(
      (await LinearSyncJobModel.listByProject(db, personal, projectId, 1)).map((r) => r.id),
    ).toEqual([newer.id]);
    expect(
      (await LinearSyncJobModel.listByProject(db, shared, projectId)).map((r) => r.id),
    ).toEqual([wsJob.id]);
    expect(await LinearSyncJobModel.listByProject(db, { userId: otherUserId }, projectId)).toEqual(
      [],
    );
  });

  it('lets only one caller claim a queued job', async () => {
    const queued = await job();

    expect(await LinearSyncJobModel.claim(db, { userId: otherUserId }, queued.id)).toBeNull();
    expect(await LinearSyncJobModel.claim(db, shared, queued.id)).toBeNull();

    const claimed = await LinearSyncJobModel.claim(db, personal, queued.id);
    expect(claimed).toMatchObject({ id: queued.id, status: AsyncTaskStatus.Processing });
    expect(await LinearSyncJobModel.claim(db, personal, queued.id)).toBeNull();
  });

  it('claims a queued workspace job from the workspace scope', async () => {
    const queued = await job({ workspaceId });

    expect(await LinearSyncJobModel.claim(db, personal, queued.id)).toBeNull();
    expect(await LinearSyncJobModel.claim(db, shared, queued.id)).toMatchObject({
      id: queued.id,
      status: AsyncTaskStatus.Processing,
    });
  });

  it('touches only a running job in scope', async () => {
    const stale = new Date('2026-01-01T00:00:00.000Z');
    const running = await job({ status: AsyncTaskStatus.Processing, updatedAt: stale });
    const finished = await job({ status: AsyncTaskStatus.Success, updatedAt: stale });
    const wsRunning = await job({
      status: AsyncTaskStatus.Processing,
      updatedAt: stale,
      workspaceId,
    });

    await LinearSyncJobModel.touch(db, personal, running.id);
    await LinearSyncJobModel.touch(db, personal, finished.id);
    await LinearSyncJobModel.touch(db, personal, wsRunning.id);
    await LinearSyncJobModel.touch(db, { userId: otherUserId }, running.id);

    expect((await statusOf(running.id)).updatedAt.getTime()).toBeGreaterThan(stale.getTime());
    expect((await statusOf(finished.id)).updatedAt).toEqual(stale);
    expect((await statusOf(wsRunning.id)).updatedAt).toEqual(stale);

    await LinearSyncJobModel.touch(db, shared, wsRunning.id);
    expect((await statusOf(wsRunning.id)).updatedAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  it('finds the unfinished run of a rule', async () => {
    const ruleId = 'linear-job-cov-rule';
    await job({ ruleId, status: AsyncTaskStatus.Success });

    expect(await LinearSyncJobModel.findActiveForRule(db, personal, projectId, ruleId)).toBeNull();

    const active = await job({ ruleId, status: AsyncTaskStatus.Processing });
    expect(
      await LinearSyncJobModel.findActiveForRule(db, personal, projectId, ruleId),
    ).toMatchObject({ id: active.id, metadata: { ruleId } });
    expect(
      await LinearSyncJobModel.findActiveForRule(db, personal, projectId, 'another-rule'),
    ).toBeNull();
    expect(await LinearSyncJobModel.findActiveForRule(db, shared, projectId, ruleId)).toBeNull();
  });
});
