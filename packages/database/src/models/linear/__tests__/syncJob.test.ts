// @vitest-environment node
import type { LinearSyncJobMetadata } from '@lobechat/types';
import { AsyncTaskStatus, AsyncTaskType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../../core/getTestDB';
import { asyncTasks, users, workspaces } from '../../../schemas';
import type { LobeChatDatabase } from '../../../type';
import type { LinearSyncJobRow } from '../syncJob';
import { LinearSyncJobModel } from '../syncJob';

const db: LobeChatDatabase = await getTestDB();

const userId = 'linear-job-user';
const otherUserId = 'linear-job-other';
const workspaceId = 'linear-job-ws';
const projectId = 'linear-job-project';
const otherProjectId = 'linear-job-project-2';
const ruleId = 'linear-job-rule-1';

interface SeedJobParams {
  createdAt?: Date;
  projectId?: string;
  ruleId?: string;
  status?: AsyncTaskStatus;
  type?: string;
  updatedAt?: Date;
  userId?: string;
  workspaceId?: string | null;
}

const seedJob = async (params: SeedJobParams = {}): Promise<LinearSyncJobRow> => {
  const metadata: LinearSyncJobMetadata = {
    connectionId: 'linear-job-connection',
    kind: 'rule',
    projectId: params.projectId ?? projectId,
    ...(params.ruleId === undefined ? { ruleId } : { ruleId: params.ruleId }),
  };

  const [row] = await db
    .insert(asyncTasks)
    .values({
      metadata,
      status: params.status ?? AsyncTaskStatus.Pending,
      type: params.type ?? AsyncTaskType.LinearIssueSync,
      userId: params.userId ?? userId,
      workspaceId: params.workspaceId ?? null,
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
      ...(params.updatedAt ? { updatedAt: params.updatedAt } : {}),
    })
    .returning();

  return row as LinearSyncJobRow;
};

const personalScope = { userId };
const workspaceScope = { userId, workspaceId };

beforeEach(async () => {
  await db.delete(asyncTasks);
  await db.delete(users);

  await db.insert(users).values([{ id: userId }, { id: otherUserId }]);
  await db
    .insert(workspaces)
    .values({ id: workspaceId, name: 'ws', primaryOwnerId: userId, slug: workspaceId });
});

afterEach(async () => {
  await db.delete(asyncTasks);
  await db.delete(users);
});

describe('LinearSyncJobModel', () => {
  describe('listByProject', () => {
    it('lists the syncs of one project newest first', async () => {
      const older = await seedJob({ createdAt: new Date('2026-01-01T00:00:00Z') });
      const newer = await seedJob({ createdAt: new Date('2026-02-01T00:00:00Z') });

      const rows = await LinearSyncJobModel.listByProject(db, personalScope, projectId);

      expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);
    });

    it('only lists Linear syncs of that project and scope', async () => {
      const own = await seedJob();
      await seedJob({ projectId: otherProjectId });
      await seedJob({ type: 'embedding' });
      await seedJob({ userId: otherUserId });
      await seedJob({ workspaceId });

      const rows = await LinearSyncJobModel.listByProject(db, personalScope, projectId);

      expect(rows.map((row) => row.id)).toEqual([own.id]);
    });

    it('keeps workspace syncs out of the personal scope', async () => {
      const workspaceJob = await seedJob({ workspaceId });
      await seedJob();

      const rows = await LinearSyncJobModel.listByProject(db, workspaceScope, projectId);

      expect(rows.map((row) => row.id)).toEqual([workspaceJob.id]);
    });

    it('defaults to ten rows and honours an explicit limit', async () => {
      const createdAt = (day: number) => new Date(`2026-03-${String(day).padStart(2, '0')}Z`);
      await db.insert(asyncTasks).values(
        Array.from({ length: 11 }, (_, index) => ({
          createdAt: createdAt(index + 1),
          metadata: { connectionId: 'c', kind: 'rule', projectId, ruleId } as LinearSyncJobMetadata,
          status: AsyncTaskStatus.Pending,
          type: AsyncTaskType.LinearIssueSync,
          userId,
        })),
      );

      const defaults = await LinearSyncJobModel.listByProject(db, personalScope, projectId);
      const limited = await LinearSyncJobModel.listByProject(db, personalScope, projectId, 2);

      expect(defaults).toHaveLength(10);
      expect(defaults[0].createdAt).toEqual(createdAt(11));
      expect(limited).toHaveLength(2);
      expect(limited[0].createdAt).toEqual(createdAt(11));
    });
  });

  describe('claim', () => {
    it('moves a pending sync to processing exactly once', async () => {
      const job = await seedJob();

      const claimed = await LinearSyncJobModel.claim(db, personalScope, job.id);
      const second = await LinearSyncJobModel.claim(db, personalScope, job.id);

      expect(claimed?.id).toBe(job.id);
      expect(claimed?.status).toBe(AsyncTaskStatus.Processing);
      expect(claimed?.metadata.ruleId).toBe(ruleId);
      expect(second).toBeNull();
    });

    it('refuses another type, another status, another user or a missing id', async () => {
      const otherType = await seedJob({ type: 'embedding' });
      const alreadyDone = await seedJob({ status: AsyncTaskStatus.Success });
      const foreign = await seedJob({ userId: otherUserId });

      expect(await LinearSyncJobModel.claim(db, personalScope, otherType.id)).toBeNull();
      expect(await LinearSyncJobModel.claim(db, personalScope, alreadyDone.id)).toBeNull();
      expect(await LinearSyncJobModel.claim(db, personalScope, foreign.id)).toBeNull();
      expect(
        await LinearSyncJobModel.claim(db, personalScope, '00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
    });
  });

  describe('touch', () => {
    it('bumps the heartbeat of a running sync', async () => {
      const startedAt = new Date('2026-01-01T00:00:00Z');
      const job = await seedJob({ status: AsyncTaskStatus.Processing, updatedAt: startedAt });

      await LinearSyncJobModel.touch(db, personalScope, job.id);

      const [updated] = await db.select().from(asyncTasks);
      expect(updated.updatedAt.getTime()).toBeGreaterThan(startedAt.getTime());
    });

    it('leaves a finished, foreign or mismatched sync alone', async () => {
      const startedAt = new Date('2026-01-01T00:00:00Z');
      const done = await seedJob({ status: AsyncTaskStatus.Success, updatedAt: startedAt });
      const foreign = await seedJob({
        status: AsyncTaskStatus.Processing,
        updatedAt: startedAt,
        userId: otherUserId,
      });

      await LinearSyncJobModel.touch(db, personalScope, done.id);
      await LinearSyncJobModel.touch(db, personalScope, foreign.id);

      const rows = await db.select().from(asyncTasks);
      expect(rows.map((row) => row.updatedAt.getTime())).toEqual([
        startedAt.getTime(),
        startedAt.getTime(),
      ]);
    });
  });

  describe('findActiveForRule', () => {
    it('returns the newest unfinished run of the rule', async () => {
      const pending = await seedJob({
        createdAt: new Date('2026-01-01T00:00:00Z'),
        status: AsyncTaskStatus.Pending,
      });
      const processing = await seedJob({
        createdAt: new Date('2026-02-01T00:00:00Z'),
        status: AsyncTaskStatus.Processing,
      });

      const active = await LinearSyncJobModel.findActiveForRule(
        db,
        personalScope,
        projectId,
        ruleId,
      );

      expect(active?.id).toBe(processing.id);
      expect(active?.id).not.toBe(pending.id);
    });

    it('ignores finished runs, other rules, projects and users', async () => {
      await seedJob({ status: AsyncTaskStatus.Success });
      await seedJob({ ruleId: 'another-rule' });
      await seedJob({ projectId: otherProjectId });
      await seedJob({ userId: otherUserId });

      expect(
        await LinearSyncJobModel.findActiveForRule(db, personalScope, projectId, ruleId),
      ).toBeNull();
    });

    it('keeps personal and workspace runs apart', async () => {
      const workspaceJob = await seedJob({ workspaceId });

      expect(
        await LinearSyncJobModel.findActiveForRule(db, workspaceScope, projectId, ruleId),
      ).toMatchObject({ id: workspaceJob.id });
      expect(
        await LinearSyncJobModel.findActiveForRule(db, personalScope, projectId, ruleId),
      ).toBeNull();
    });
  });
});
