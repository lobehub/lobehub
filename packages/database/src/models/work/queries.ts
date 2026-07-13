import {
  WORK_PROVIDER_RESOURCE_TYPES,
  type WorkItem,
  type WorkListItem,
  type WorkSkillProvider,
  type WorkSummaryItem,
  type WorkSummaryMap,
  type WorkType,
  type WorkVersionEventItem,
  type WorkVersionEventMap,
  type WorkVersionItem,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';

import { tasks } from '../../schemas/task';
import { works, workVersions } from '../../schemas/work';
import { type WorkContext, workOwnership } from './context';
import { getTotalCostByWorkIds } from './cost';
import { currentVersions, taskSummaryFields, taskSummaryJoin } from './internal';
import { WORK_TYPE_ADAPTERS, workTypeAdapters } from './registry';

/**
 * Over-fetch multiplier for list/summary queries: one per registered Work
 * type. Rows are fetched per type and deduped to the latest item per work in
 * JS, so each query over-fetches by this factor before results are trimmed
 * back down to `limit`.
 */
const WORK_TYPE_FANOUT = workTypeAdapters.length;
/**
 * Hard ceiling for the summary-row over-fetch LIMIT: `rootOperationIds` length
 * is caller-controlled (the tRPC schema caps only `limit`), so without a clamp
 * a long conversation's batched ids would inflate the per-type ORDER-BY
 * queries and the matching in-memory sort far beyond the final capped result.
 */
const MAX_SUMMARY_ROW_LIMIT = 1000;

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
  // One batched query per work type across all ids (instead of one per type
  // per id); rows are re-partitioned per rootOperationId below. Each per-type
  // query over-fetches up to `limit` rows per id, clamped like the sibling
  // listSummariesByRootOperations.
  const filters = [inArray(workVersions.rootOperationId, rootOperationIds)];
  const rowLimit = Math.min(rootOperationIds.length * limit, MAX_SUMMARY_ROW_LIMIT);
  const itemsByType = await Promise.all(
    workTypeAdapters.map((adapter) => adapter.listVersionEvents(ctx, filters, rowLimit)),
  );

  const items = itemsByType
    .flat()
    .sort((a, b) => b.version.createdAt.getTime() - a.version.createdAt.getTime());

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
  const rowsByType = await Promise.all(
    workTypeAdapters.map(async (adapter) => ({
      adapter,
      rows: await adapter.listSummaryRows(ctx, filters, rowLimit),
    })),
  );

  // ONE cost query across every type's rows (cumulative snapshots aggregated
  // per work in cost.ts), instead of one per type.
  const costByWorkId = await getTotalCostByWorkIds(
    ctx,
    rowsByType.flatMap(({ rows }) => rows.map((row) => row.work.id)),
  );

  const summaries = rowsByType
    .flatMap(({ adapter, rows }) =>
      rows.map((row) => adapter.mapSummaryRow(row, costByWorkId.get(row.work.id) ?? null)),
    )
    .sort((a, b) => b.event.createdAt.getTime() - a.event.createdAt.getTime());

  // Dedupe to the latest event per Work GLOBALLY across the requested
  // operations: when several rounds touch the same Work (turn A creates a
  // task, turn B updates it), only the last touching round's anchor card
  // should surface it — earlier rounds drop the chip instead of repeating
  // the same artifact every turn.
  const seenWorks = new Set<string>();
  for (const summary of summaries) {
    const rootOperationId = summary.event.rootOperationId;
    if (!rootOperationId || !(rootOperationId in result)) continue;
    if (seenWorks.has(summary.id)) continue;
    seenWorks.add(summary.id);
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

  const rowsByType = await Promise.all(
    workTypeAdapters.map((adapter) =>
      adapter.listConversationRows(ctx, {
        rowLimit: limit * WORK_TYPE_FANOUT,
        threadFilter,
        topicId: params.topicId!,
      }),
    ),
  );

  const rows = rowsByType
    .flat()
    .sort((a, b) => b.eventCreatedAt.getTime() - a.eventCreatedAt.getTime());

  const seen = new Set<string>();
  const items: WorkListItem[] = [];
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
  /** Narrow the `external` type to a single skill provider's resource types. */
  provider?: WorkSkillProvider | null;
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
 * the Work's current version. `type` optionally narrows to one registry entry;
 * omitting it powers the combined 全部 view. One query serves every type — the
 * per-type differences live in each adapter's `mapWorkspaceRow`.
 */
export const listByWorkspace = async (
  ctx: WorkContext,
  params: ListByWorkspaceParams,
): Promise<WorkSummaryPage> => {
  const limit = params.limit ?? WORKSPACE_WORK_LIMIT;

  const filters: SQL[] = [workOwnership(ctx)];
  if (params.type) filters.push(eq(works.type, params.type));
  // User-visible gallery tabs stay per-provider (Linear / GitHub) but filter by
  // provider — its resource types — over the unified `external` Work type.
  if (params.provider) {
    filters.push(eq(works.type, 'external'));
    // inArray needs a mutable array, so spread the readonly tuple.
    filters.push(inArray(works.resourceType, [...WORK_PROVIDER_RESOURCE_TYPES[params.provider]]));
  }

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
        changeType: currentVersions.changeType,
        createdAt: currentVersions.createdAt,
        cumulativeCost: currentVersions.cumulativeCost,
        id: currentVersions.id,
        metadata: currentVersions.metadata,
        rootOperationId: currentVersions.rootOperationId,
        sourceMessageId: currentVersions.sourceMessageId,
        sourceToolCallId: currentVersions.sourceToolCallId,
        sourceToolName: currentVersions.sourceToolName,
        version: currentVersions.version,
      },
      ...taskSummaryFields,
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

  const items = pageRows.map((row) =>
    WORK_TYPE_ADAPTERS[row.work.type].mapWorkspaceRow(row, costByWorkId.get(row.work.id) ?? null),
  );

  return { items, nextCursor: hasMore ? encodeWorkCursor(pageRows.at(-1)!.work) : null };
};
