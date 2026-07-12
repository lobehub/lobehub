import type {
  DocumentWorkListItem,
  DocumentWorkVersionSnapshot,
  GithubWorkListItem,
  GithubWorkSummaryItem,
  GithubWorkVersionSnapshot,
  LinearWorkListItem,
  LinearWorkSummaryItem,
  LinearWorkVersionSnapshot,
  TaskWorkListItem,
  WorkItem,
  WorkListItem,
  WorkSummaryItem,
  WorkSummaryMap,
  WorkType,
  WorkVersionEventItem,
  WorkVersionEventMap,
  WorkVersionItem,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';

import { tasks } from '../../schemas/task';
import { works, workVersions } from '../../schemas/work';
import { versionOwnership, type WorkContext, workOwnership } from './context';
import { getTotalCostByWorkIds } from './cost';
import {
  listDocumentVersionEvents,
  listDocumentWorkSummaryRows,
  toDocumentWorkSummaries,
} from './document';
import {
  listGithubVersionEvents,
  listGithubWorkSummaryRows,
  toGithubWorkSummaries,
} from './github';
import {
  currentVersions,
  slimGithubSnapshotForSummary,
  slimLinearSnapshotForSummary,
  snapshotField,
  type SnapshotWorkType,
  taskSummaryFields,
  taskSummaryJoin,
  truncateSummaryText,
} from './internal';
import {
  listLinearVersionEvents,
  listLinearWorkSummaryRows,
  toLinearWorkSummaries,
} from './linear';
import { listTaskVersionEvents, listTaskWorkSummaryRows, toTaskWorkSummaries } from './task';

/**
 * Over-fetch multiplier for list/summary queries: one per Work provider type
 * (task / document / linear / github). Rows are fetched per type and deduped
 * to the latest item per work in JS, so each query over-fetches by this factor
 * before results are trimmed back down to `limit`.
 */
const WORK_TYPE_FANOUT = 4;
/**
 * Hard ceiling for the summary-row over-fetch LIMIT: `rootOperationIds` length
 * is caller-controlled (the tRPC schema caps only `limit`), so without a clamp
 * a long conversation's batched ids would inflate the per-type ORDER-BY
 * queries and the matching in-memory sort far beyond the final capped result.
 */
const MAX_SUMMARY_ROW_LIMIT = 1000;

const latestSummaryItemsByWork = (items: WorkSummaryItem[], limit?: number) => {
  const seen = new Set<string>();
  const latestItems: WorkSummaryItem[] = [];

  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    latestItems.push(item);
    if (limit && latestItems.length >= limit) break;
  }

  return latestItems;
};

export const listByRootOperation = async (
  ctx: WorkContext,
  params: {
    limit?: number;
    rootOperationId?: string | null;
  },
): Promise<WorkVersionEventItem[]> => {
  if (!params.rootOperationId) return [];

  const map = await listByRootOperations(ctx, {
    limit: params.limit,
    rootOperationIds: [params.rootOperationId],
  });

  return map[params.rootOperationId] ?? [];
};

export const listByRootOperations = async (
  ctx: WorkContext,
  params: {
    limit?: number;
    rootOperationIds?: string[] | null;
  },
): Promise<WorkVersionEventMap> => {
  const rootOperationIds = Array.from(
    new Set((params.rootOperationIds ?? []).filter((id): id is string => !!id)),
  ).sort();
  if (rootOperationIds.length === 0) return {};

  const limit = params.limit ?? 20;
  const result: WorkVersionEventMap = Object.fromEntries(
    rootOperationIds.map((rootOperationId) => [rootOperationId, []]),
  );
  // One batched query per work type across all ids (instead of 4 queries per
  // id); rows are re-partitioned per rootOperationId below. Each per-type
  // query over-fetches up to `limit` rows per id, clamped like the sibling
  // listSummariesByRootOperations.
  const filters = [inArray(workVersions.rootOperationId, rootOperationIds)];
  const rowLimit = Math.min(rootOperationIds.length * limit, MAX_SUMMARY_ROW_LIMIT);
  const [taskItems, documentItems, linearItems, githubItems] = await Promise.all([
    listTaskVersionEvents(ctx, filters, rowLimit),
    listDocumentVersionEvents(ctx, filters, rowLimit),
    listLinearVersionEvents(ctx, filters, rowLimit),
    listGithubVersionEvents(ctx, filters, rowLimit),
  ]);

  const items = [...taskItems, ...documentItems, ...linearItems, ...githubItems].sort(
    (a, b) => b.version.createdAt.getTime() - a.version.createdAt.getTime(),
  );

  for (const item of items) {
    const rootOperationId = item.version.rootOperationId;
    if (!rootOperationId || !(rootOperationId in result)) continue;
    if (result[rootOperationId].length >= limit) continue;
    result[rootOperationId].push(item);
  }

  return result;
};

export const listSummariesByRootOperations = async (
  ctx: WorkContext,
  params: {
    limit?: number;
    rootOperationIds?: string[] | null;
  },
): Promise<WorkSummaryMap> => {
  const rootOperationIds = Array.from(
    new Set((params.rootOperationIds ?? []).filter((id): id is string => !!id)),
  ).sort();
  const result: WorkSummaryMap = Object.fromEntries(
    rootOperationIds.map((rootOperationId) => [rootOperationId, []]),
  );
  if (rootOperationIds.length === 0) return result;

  const limit = params.limit ?? 20;
  const filters = [inArray(workVersions.rootOperationId, rootOperationIds)];
  const rowLimit = Math.min(
    rootOperationIds.length * limit * WORK_TYPE_FANOUT,
    MAX_SUMMARY_ROW_LIMIT,
  );
  const [taskRows, documentRows, linearRows, githubRows] = await Promise.all([
    listTaskWorkSummaryRows(ctx, filters, rowLimit),
    listDocumentWorkSummaryRows(ctx, filters, rowLimit),
    listLinearWorkSummaryRows(ctx, filters, rowLimit),
    listGithubWorkSummaryRows(ctx, filters, rowLimit),
  ]);
  const summaries = latestSummaryItemsByWork(
    (
      await Promise.all([
        toTaskWorkSummaries(ctx, taskRows),
        toDocumentWorkSummaries(ctx, documentRows),
        toLinearWorkSummaries(ctx, linearRows),
        toGithubWorkSummaries(ctx, githubRows),
      ])
    )
      .flat()
      .sort((a, b) => b.event.createdAt.getTime() - a.event.createdAt.getTime()),
  );

  for (const summary of summaries) {
    const rootOperationId = summary.event.rootOperationId;
    if (!rootOperationId || !(rootOperationId in result)) continue;
    if (result[rootOperationId].length >= limit) continue;
    result[rootOperationId].push(summary);
  }

  return result;
};

export const listByConversation = async (
  ctx: WorkContext,
  params: {
    limit?: number;
    threadId?: string | null;
    topicId?: string | null;
  },
): Promise<WorkListItem[]> => {
  if (!params.topicId) return [];

  const limit = params.limit ?? 50;
  const threadFilter = params.threadId
    ? eq(workVersions.threadId, params.threadId)
    : isNull(workVersions.threadId);

  const taskRows = await ctx.db
    .select({
      eventCreatedAt: workVersions.createdAt,
      // LEFT JOIN so orphaned task Works still surface; live columns coalesce
      // onto the current-version snapshot and `tasks.id is null` flags deletion.
      ...taskSummaryFields(currentVersions.snapshot),
      work: works,
    })
    .from(workVersions)
    .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
    .innerJoin(currentVersions, eq(works.currentVersionId, currentVersions.id))
    .leftJoin(tasks, taskSummaryJoin(ctx))
    .where(
      and(
        versionOwnership(ctx),
        eq(workVersions.topicId, params.topicId),
        threadFilter,
        eq(works.type, 'task'),
      ),
    )
    .orderBy(desc(workVersions.createdAt), desc(works.updatedAt))
    .limit(limit * WORK_TYPE_FANOUT);

  const snapshotRows = <Snapshot>(type: SnapshotWorkType) =>
    ctx.db
      .select({
        eventCreatedAt: workVersions.createdAt,
        snapshot: snapshotField<Snapshot>(currentVersions.snapshot, type),
        work: works,
      })
      .from(workVersions)
      .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
      .innerJoin(currentVersions, eq(works.currentVersionId, currentVersions.id))
      .where(
        and(
          versionOwnership(ctx),
          eq(workVersions.topicId, params.topicId!),
          threadFilter,
          eq(works.type, type),
        ),
      )
      .orderBy(desc(workVersions.createdAt), desc(works.updatedAt))
      .limit(limit * WORK_TYPE_FANOUT);

  const [documentRows, linearRows, githubRows] = await Promise.all([
    snapshotRows<DocumentWorkVersionSnapshot>('document'),
    snapshotRows<LinearWorkVersionSnapshot>('linear'),
    snapshotRows<GithubWorkVersionSnapshot>('github'),
  ]);

  const seen = new Set<string>();
  const items: WorkListItem[] = [];
  const rows = [
    ...taskRows.map((row) => ({
      eventCreatedAt: row.eventCreatedAt,
      item: {
        ...row.work,
        resourceType: 'task' as const,
        task: {
          instruction: truncateSummaryText(row.task.instruction),
          name: row.task.name,
          priority: row.task.priority,
          status: row.task.status,
        },
        taskDeleted: row.task.deleted,
        type: 'task' as const,
      } satisfies TaskWorkListItem,
    })),
    ...documentRows.map((row) => ({
      eventCreatedAt: row.eventCreatedAt,
      item: {
        ...row.work,
        document: row.snapshot,
        resourceType: 'document' as const,
        type: 'document' as const,
      } satisfies DocumentWorkListItem,
    })),
    ...linearRows.map((row) => ({
      eventCreatedAt: row.eventCreatedAt,
      item: {
        ...row.work,
        linear: slimLinearSnapshotForSummary(row.snapshot),
        resourceType: row.work.resourceType as LinearWorkListItem['resourceType'],
        type: 'linear' as const,
      } satisfies LinearWorkListItem,
    })),
    ...githubRows.map((row) => ({
      eventCreatedAt: row.eventCreatedAt,
      item: {
        ...row.work,
        github: slimGithubSnapshotForSummary(row.snapshot),
        resourceType: row.work.resourceType as GithubWorkListItem['resourceType'],
        type: 'github' as const,
      } satisfies GithubWorkListItem,
    })),
  ].sort((a, b) => b.eventCreatedAt.getTime() - a.eventCreatedAt.getTime());

  for (const row of rows) {
    if (seen.has(row.item.id)) continue;
    seen.add(row.item.id);
    items.push(row.item);
    if (items.length >= limit) break;
  }

  return items;
};

export const listVersions = async (
  ctx: WorkContext,
  workId: string,
): Promise<WorkVersionItem[]> => {
  const rows = await ctx.db
    .select({ version: workVersions })
    .from(workVersions)
    .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
    .where(eq(workVersions.workId, workId))
    .orderBy(desc(workVersions.version));

  return rows.map((row) => row.version);
};

/** Default page size for the workspace-wide Work list. */
const WORKSPACE_WORK_LIMIT = 30;

export interface ListByWorkspaceParams {
  cursor?: string | null;
  limit?: number;
  type?: WorkType | null;
}

// Not exported: only used as this module's own return-type annotation. The
// service layer (`src/services/work.ts`) names its own `WorkSummaryPage` for
// client consumption, mirroring how `VerifyReportSummaryPage` is named once,
// at the service boundary, rather than duplicated from the db layer.
interface WorkSummaryPage {
  items: WorkSummaryItem[];
  nextCursor: string | null;
}

/**
 * Keyset cursor over the `(updatedAt, id)` order key. `updatedAt` alone is not
 * unique (batch task creation stamps many rows in the same instant), so the id
 * tie-breaker prevents rows from being skipped or duplicated across pages. The
 * cursor stays opaque to callers: `<updatedAt ISO>|<work id>` (a work id never
 * contains `|`, and neither does an ISO timestamp).
 */
const encodeWorkCursor = (work: Pick<WorkItem, 'id' | 'updatedAt'>): string =>
  `${work.updatedAt.toISOString()}|${work.id}`;

const decodeWorkCursor = (cursor: string): { id: string; updatedAt: Date } | null => {
  const separator = cursor.indexOf('|');
  if (separator === -1) return null;

  const updatedAt = new Date(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (!id || Number.isNaN(updatedAt.getTime())) return null;

  return { id, updatedAt };
};

/**
 * Workspace-wide (cross-topic) Work list for the resource page's 产物 group.
 * Unlike the conversation/root-operation queries, this pages off `works` as the
 * primary table (not `work_versions` events), so `event`/`version` both reflect
 * the Work's current version. `type` optionally narrows to one entry (task /
 * document / linear / github); omitting it powers the combined 全部 view.
 */
export const listByWorkspace = async (
  ctx: WorkContext,
  params: ListByWorkspaceParams,
): Promise<WorkSummaryPage> => {
  const limit = params.limit ?? WORKSPACE_WORK_LIMIT;

  const filters: SQL[] = [workOwnership(ctx)];
  if (params.type) filters.push(eq(works.type, params.type));

  if (params.cursor) {
    const decoded = decodeWorkCursor(params.cursor);
    // desc(updatedAt), desc(id): the next page holds rows strictly "after" the
    // cursor in that order — older updatedAt, or same updatedAt with a lower id.
    if (decoded)
      filters.push(
        or(
          lt(works.updatedAt, decoded.updatedAt),
          and(eq(works.updatedAt, decoded.updatedAt), lt(works.id, decoded.id)),
        )!,
      );
  }

  const rows = await ctx.db
    .select({
      // Global view has no mutation event to anchor on, so the current version
      // doubles as the surfacing event (mirrors the summary row shape).
      event: {
        createdAt: currentVersions.createdAt,
        cumulativeCost: currentVersions.cumulativeCost,
        id: currentVersions.id,
        metadata: currentVersions.metadata,
        role: currentVersions.role,
        rootOperationId: currentVersions.rootOperationId,
        source: currentVersions.source,
        sourceMessageId: currentVersions.sourceMessageId,
        sourceToolCallId: currentVersions.sourceToolCallId,
        version: currentVersions.version,
      },
      snapshot: currentVersions.snapshot,
      ...taskSummaryFields(currentVersions.snapshot),
      version: {
        createdAt: currentVersions.createdAt,
        id: currentVersions.id,
        version: currentVersions.version,
      },
      work: works,
    })
    .from(works)
    .innerJoin(currentVersions, eq(works.currentVersionId, currentVersions.id))
    .leftJoin(tasks, taskSummaryJoin(ctx))
    .where(and(...filters))
    .orderBy(desc(works.updatedAt), desc(works.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const costByWorkId = await getTotalCostByWorkIds(
    ctx,
    pageRows.map((row) => row.work.id),
  );

  const items = pageRows.map((row): WorkSummaryItem => {
    const base = {
      ...row.work,
      event: row.event,
      totalCost: costByWorkId.get(row.work.id) ?? null,
      version: row.version,
    };

    switch (row.work.type) {
      case 'document': {
        return {
          ...base,
          document: (row.snapshot as { document: DocumentWorkVersionSnapshot }).document,
          resourceType: 'document',
          type: 'document',
        };
      }

      case 'linear': {
        return {
          ...base,
          linear: slimLinearSnapshotForSummary(
            (row.snapshot as { linear: LinearWorkVersionSnapshot }).linear,
          ),
          resourceType: row.work.resourceType as LinearWorkSummaryItem['resourceType'],
          type: 'linear',
        };
      }

      case 'github': {
        return {
          ...base,
          github: slimGithubSnapshotForSummary(
            (row.snapshot as { github: GithubWorkVersionSnapshot }).github,
          ),
          resourceType: row.work.resourceType as GithubWorkSummaryItem['resourceType'],
          type: 'github',
        };
      }

      default: {
        return {
          ...base,
          resourceType: 'task',
          task: {
            instruction: truncateSummaryText(row.task.instruction),
            name: row.task.name,
            priority: row.task.priority,
            status: row.task.status,
          },
          taskDeleted: row.task.deleted,
          type: 'task',
        };
      }
    }
  });

  return { items, nextCursor: hasMore ? encodeWorkCursor(pageRows.at(-1)!.work) : null };
};
