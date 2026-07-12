import type {
  GithubWorkListItem,
  GithubWorkPatchField,
  GithubWorkSummaryItem,
  GithubWorkVersionEventItem,
  GithubWorkVersionSnapshot,
  RegisterGithubWorkParams,
  WorkItem,
  WorkVersionItem,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, eq, sql } from 'drizzle-orm';

import { works, workVersions } from '../../schemas/work';
import { type WorkContext, workOwnership } from './context';
import { getTotalCostByWorkIds } from './cost';
import {
  listSnapshotVersionEventRows,
  listSnapshotWorkSummaryRows,
  slimGithubSnapshotForSummary,
  type SnapshotWorkSummaryQueryRow,
} from './internal';
import { createVersion, findById, resolveWorkUpsertConflict } from './writes';

export const githubSnapshot = (
  params: Omit<RegisterGithubWorkParams, 'resourceId'> & { resourceId: string },
  previous?: GithubWorkVersionSnapshot | null,
): { github: GithubWorkVersionSnapshot } => {
  const patchFields = new Set(params.patchFields ?? []);
  // GitHub update responses can be partial (e.g. merge results); keep prior fields.
  const pick = <T>(field: GithubWorkPatchField, value: T | null | undefined, fallback: T) =>
    patchFields.has(field)
      ? (value ?? fallback)
      : ((previous?.[field] as T | undefined) ?? fallback);

  return {
    github: {
      assignees: pick('assignees', params.assignees, []),
      author: pick('author', params.author, null),
      baseRef: pick('baseRef', params.baseRef, null),
      body: pick('body', params.body, null),
      closedAt: pick('closedAt', params.closedAt, null),
      createdAt: pick('createdAt', params.createdAt, null),
      draft: pick('draft', params.draft, null),
      headRef: pick('headRef', params.headRef, null),
      id: params.resourceId,
      labels: pick('labels', params.labels, []),
      merged: pick('merged', params.merged, null),
      mergedAt: pick('mergedAt', params.mergedAt, null),
      number: pick('number', params.number, null),
      repo: pick('repo', params.repo, null),
      state: pick('state', params.state, null),
      stateReason: pick('stateReason', params.stateReason, null),
      title: pick('title', params.title, null),
      updatedAt: pick('updatedAt', params.updatedAt, null),
      url: pick('url', params.url, null),
    } satisfies GithubWorkVersionSnapshot,
  };
};

const findCurrentGithubSnapshot = async (
  ctx: WorkContext,
  workId: string,
): Promise<GithubWorkVersionSnapshot | null> => {
  const [row] = await ctx.db
    .select({
      github: sql<GithubWorkVersionSnapshot>`${workVersions.snapshot}->'github'`,
    })
    .from(works)
    .innerJoin(workVersions, eq(works.currentVersionId, workVersions.id))
    .where(and(eq(works.id, workId), workOwnership(ctx), eq(works.type, 'github')))
    .limit(1);

  return row?.github ?? null;
};

const upsertGithubWork = async (
  ctx: WorkContext,
  params: Omit<RegisterGithubWorkParams, 'resourceId'> & { resourceId: string },
): Promise<WorkItem> => {
  const values = {
    resourceId: params.resourceId,
    resourceIdentifier: params.resourceIdentifier ?? null,
    resourceType: params.resourceType,
    type: 'github' as const,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId ?? null,
  };

  const conflict = resolveWorkUpsertConflict(ctx);

  const [work] = await ctx.db
    .insert(works)
    .values(values)
    .onConflictDoUpdate({
      ...conflict,
      set: {
        resourceIdentifier: sql`COALESCE(${params.resourceIdentifier ?? null}, ${works.resourceIdentifier})`,
        updatedAt: new Date(),
      },
    })
    .returning();

  return work;
};

const createGithubVersion = async (
  ctx: WorkContext,
  work: WorkItem,
  params: Omit<RegisterGithubWorkParams, 'resourceId'> & { resourceId: string },
): Promise<WorkVersionItem> =>
  createVersion(ctx, work, params, async (txCtx) => {
    // Read through the tx-scoped context (see createVersion): the works row is
    // locked, so the patch-merge base is a concurrent winner's committed
    // snapshot, never a stale pre-race one.
    const previousSnapshot = await findCurrentGithubSnapshot(txCtx, work.id);
    return { snapshot: githubSnapshot(params, previousSnapshot) };
  });

export const registerGithubWork = async (
  ctx: WorkContext,
  params: Omit<RegisterGithubWorkParams, 'resourceId'> & { resourceId: string },
): Promise<WorkItem | null> => {
  const work = await upsertGithubWork(ctx, params);
  await createGithubVersion(ctx, work, params);

  return findById(ctx, work.id);
};

export const listGithubVersionEvents = async (
  ctx: WorkContext,
  filters: SQL[],
  limit = 20,
): Promise<GithubWorkVersionEventItem[]> => {
  const rows = await listSnapshotVersionEventRows<GithubWorkVersionSnapshot>(
    ctx,
    'github',
    filters,
    limit,
  );

  return rows.map((row) => ({
    ...row.work,
    github: row.snapshot,
    resourceType: row.work.resourceType as GithubWorkListItem['resourceType'],
    type: 'github' as const,
    version: row.version,
  }));
};

export const listGithubWorkSummaryRows = (ctx: WorkContext, filters: SQL[], rowLimit: number) =>
  listSnapshotWorkSummaryRows<GithubWorkVersionSnapshot>(ctx, 'github', filters, rowLimit);

export const toGithubWorkSummaries = async (
  ctx: WorkContext,
  rows: SnapshotWorkSummaryQueryRow<GithubWorkVersionSnapshot>[],
): Promise<GithubWorkSummaryItem[]> => {
  const costByWorkId = await getTotalCostByWorkIds(
    ctx,
    rows.map((row) => row.work.id),
  );

  return rows.map((row) => ({
    ...row.work,
    event: row.event,
    github: slimGithubSnapshotForSummary(row.snapshot),
    resourceType: row.work.resourceType as GithubWorkSummaryItem['resourceType'],
    totalCost: costByWorkId.get(row.work.id) ?? null,
    type: 'github' as const,
    version: row.version,
  }));
};
