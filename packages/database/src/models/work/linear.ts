import type {
  LinearWorkListItem,
  LinearWorkPatchField,
  LinearWorkSummaryItem,
  LinearWorkVersionEventItem,
  LinearWorkVersionSnapshot,
  RegisterLinearWorkParams,
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
  slimLinearSnapshotForSummary,
  type SnapshotWorkSummaryQueryRow,
} from './internal';
import { createVersion, findById, resolveWorkUpsertConflict } from './writes';

export const linearSnapshot = (
  params: RegisterLinearWorkParams,
  previous?: LinearWorkVersionSnapshot | null,
): { linear: LinearWorkVersionSnapshot } => {
  const patchFields = new Set(params.patchFields ?? []);
  const pick = <T>(field: LinearWorkPatchField, value: T | null | undefined, fallback: T) =>
    patchFields.has(field)
      ? (value ?? fallback)
      : ((previous?.[field] as T | undefined) ?? fallback);

  return {
    linear: {
      assignee: pick('assignee', params.assignee, null),
      assigneeId: pick('assigneeId', params.assigneeId, null),
      color: pick('color', params.color, null),
      content: pick('content', params.content, null),
      createdAt: pick('createdAt', params.createdAt, null),
      description: pick('description', params.description, null),
      dueDate: pick('dueDate', params.dueDate, null),
      id: params.resourceId,
      icon: pick('icon', params.icon, null),
      identifier: pick('identifier', params.resourceIdentifier, null),
      issueId: pick('issueId', params.issueId, null),
      issueIdentifier: pick('issueIdentifier', params.issueIdentifier, null),
      labels: pick('labels', params.labels, []),
      parentId: pick('parentId', params.parentId, null),
      priority: pick('priority', params.priority, null),
      priorityValue: pick('priorityValue', params.priorityValue, null),
      project: pick('project', params.project, null),
      projectId: pick('projectId', params.projectId, null),
      slugId: pick('slugId', params.slugId, null),
      status: pick('status', params.status, null),
      statusType: pick('statusType', params.statusType, null),
      targetId: pick('targetId', params.targetId, null),
      targetIdentifier: pick('targetIdentifier', params.targetIdentifier, null),
      targetType: pick('targetType', params.targetType, null),
      team: pick('team', params.team, null),
      teamId: pick('teamId', params.teamId, null),
      title: pick('title', params.title, null),
      updatedAt: pick('updatedAt', params.updatedAt, null),
      url: pick('url', params.url, null),
    } satisfies LinearWorkVersionSnapshot,
  };
};

const findCurrentLinearSnapshot = async (
  ctx: WorkContext,
  workId: string,
): Promise<LinearWorkVersionSnapshot | null> => {
  const [row] = await ctx.db
    .select({
      linear: sql<LinearWorkVersionSnapshot>`${workVersions.snapshot}->'linear'`,
    })
    .from(works)
    .innerJoin(workVersions, eq(works.currentVersionId, workVersions.id))
    .where(and(eq(works.id, workId), workOwnership(ctx), eq(works.type, 'linear')))
    .limit(1);

  return row?.linear ?? null;
};

const upsertLinearWork = async (
  ctx: WorkContext,
  params: RegisterLinearWorkParams,
): Promise<WorkItem> => {
  const values = {
    resourceId: params.resourceId,
    resourceIdentifier: params.resourceIdentifier ?? null,
    resourceType: params.resourceType,
    type: 'linear' as const,
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

const createLinearVersion = async (
  ctx: WorkContext,
  work: WorkItem,
  params: RegisterLinearWorkParams,
): Promise<WorkVersionItem> =>
  createVersion(ctx, work, params, async (txCtx) => {
    // Read through the tx-scoped context (see createVersion): the works row is
    // locked, so the patch-merge base is a concurrent winner's committed
    // snapshot, never a stale pre-race one.
    const previousSnapshot = await findCurrentLinearSnapshot(txCtx, work.id);
    // Linear update responses can be partial, e.g. { id, state }; keep prior labels/team.
    return { snapshot: linearSnapshot(params, previousSnapshot) };
  });

export const registerLinearWork = async (
  ctx: WorkContext,
  params: RegisterLinearWorkParams,
): Promise<WorkItem | null> => {
  const work = await upsertLinearWork(ctx, params);
  await createLinearVersion(ctx, work, params);

  return findById(ctx, work.id);
};

export const listLinearVersionEvents = async (
  ctx: WorkContext,
  filters: SQL[],
  limit = 20,
): Promise<LinearWorkVersionEventItem[]> => {
  const rows = await listSnapshotVersionEventRows<LinearWorkVersionSnapshot>(
    ctx,
    'linear',
    filters,
    limit,
  );

  return rows.map((row) => ({
    ...row.work,
    linear: row.snapshot,
    resourceType: row.work.resourceType as LinearWorkListItem['resourceType'],
    type: 'linear' as const,
    version: row.version,
  }));
};

export const listLinearWorkSummaryRows = (ctx: WorkContext, filters: SQL[], rowLimit: number) =>
  listSnapshotWorkSummaryRows<LinearWorkVersionSnapshot>(ctx, 'linear', filters, rowLimit);

export const toLinearWorkSummaries = async (
  ctx: WorkContext,
  rows: SnapshotWorkSummaryQueryRow<LinearWorkVersionSnapshot>[],
): Promise<LinearWorkSummaryItem[]> => {
  const costByWorkId = await getTotalCostByWorkIds(
    ctx,
    rows.map((row) => row.work.id),
  );

  return rows.map((row) => ({
    ...row.work,
    event: row.event,
    linear: slimLinearSnapshotForSummary(row.snapshot),
    resourceType: row.work.resourceType as LinearWorkSummaryItem['resourceType'],
    totalCost: costByWorkId.get(row.work.id) ?? null,
    type: 'linear' as const,
    version: row.version,
  }));
};
