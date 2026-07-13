import type {
  DocumentWorkSummaryItem,
  RegisterTaskWorkParams,
  TaskWorkListItem,
  TaskWorkSummaryItem,
  WorkItem,
  WorkListItem,
  WorkSummaryItem,
  WorkVersionEventItem,
  WorkVersionPreview,
  WorkVersionSnapshot,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { tasks } from '../../schemas/task';
import { works, workVersions } from '../../schemas/work';
import { taskOwnership, versionOwnership, type WorkContext, workOwnership } from './context';

/**
 * Second reference to `work_versions` for summary/list queries that both
 * filter by the mutation event (topicId / rootOperationId on the event row)
 * and render the Work's current content (works.currentVersionId join).
 */
export const currentVersions = alias(workVersions, 'current_work_versions');

/**
 * Max length for free-text fields on summary/list card payloads (message list,
 * sidebar summary, workspace gallery). Full bodies stay on version snapshots
 * in DB; only cards need a short preview.
 */
export const SUMMARY_TEXT_PREFIX_LENGTH = 120;

/** Collapse whitespace and cap length for card-facing Work text fields. */
export const truncateSummaryText = (value: string | null | undefined): string | null => {
  const normalized = value?.replaceAll(/\s+/g, ' ').trim();
  if (!normalized) return null;

  return normalized.length > SUMMARY_TEXT_PREFIX_LENGTH
    ? `${normalized.slice(0, SUMMARY_TEXT_PREFIX_LENGTH)}...`
    : normalized;
};

/** Provenance fields shared by all four Register*WorkParams shapes. */
export type WorkVersionEventParams = Pick<
  RegisterTaskWorkParams,
  | 'actorAgentId'
  | 'cumulativeCost'
  | 'cumulativeUsage'
  | 'changeType'
  | 'rootOperationId'
  | 'sourceMessageId'
  | 'sourceToolCallId'
  | 'sourceToolName'
  | 'threadId'
  | 'topicId'
>;

/** Provider-specific inputs for one work-version insert attempt. */
export interface CreateVersionInput {
  metadata?: (typeof workVersions.$inferInsert)['metadata'];
  snapshot: WorkVersionSnapshot;
}

/** Event-version columns embedded in list/summary rows (`WorkVersionPreview`). */
export const versionEventSelection = {
  createdAt: workVersions.createdAt,
  cumulativeCost: workVersions.cumulativeCost,
  id: workVersions.id,
  metadata: workVersions.metadata,
  changeType: workVersions.changeType,
  rootOperationId: workVersions.rootOperationId,
  sourceMessageId: workVersions.sourceMessageId,
  sourceToolCallId: workVersions.sourceToolCallId,
  sourceToolName: workVersions.sourceToolName,
  version: workVersions.version,
};

export interface TaskWorkSummaryQueryRow {
  event: WorkVersionPreview;
  /** Live-coalesced task columns; `deleted` flags a missing live row. */
  task: TaskWorkListItem['task'] & { deleted: TaskWorkListItem['taskDeleted'] };
  version: TaskWorkSummaryItem['version'];
  work: WorkItem;
}

/**
 * Work types whose list rows are fully described by the version's snapshot
 * JSON (unlike `task`, which additionally joins the tasks table).
 */
export type SnapshotWorkType = 'document' | 'github' | 'linear';

export interface SnapshotWorkSummaryQueryRow<Snapshot> {
  event: WorkVersionPreview;
  snapshot: Snapshot;
  version: DocumentWorkSummaryItem['version'];
  work: WorkItem;
}

/** Project the per-type snapshot object out of a version row's snapshot JSON. */
export const snapshotField = <Snapshot>(
  snapshotColumn: (typeof workVersions)['snapshot'] | (typeof currentVersions)['snapshot'],
  type: SnapshotWorkType,
) => sql<Snapshot>`${snapshotColumn}->${sql.raw(`'${type}'`)}`;

/**
 * Task live-column projection shared by every task summary/list query. `tasks`
 * columns take priority; a LEFT JOIN miss (task deleted without the tool path)
 * nulls the whole `tasks` row, so title/identifier coalesce onto
 * `snapshotColumn` (the minimal display snapshot) and `tasks.id is null`
 * becomes the orphan-deletion signal. `instruction` (NOT NULL on live rows) is
 * the card preview text; instruction/priority/status are live-only — a deleted
 * task's card renders title + identifier + deleted badge from the snapshot.
 * `snapshotColumn` is `workVersions.snapshot` for event rows or
 * `currentVersions.snapshot` for summary rows.
 */
export const taskSummaryFields = (
  snapshotColumn: (typeof workVersions)['snapshot'] | (typeof currentVersions)['snapshot'],
) => ({
  task: {
    deleted: sql<boolean>`${tasks.id} is null`,
    identifier: sql<
      string | null
    >`coalesce(${tasks.identifier}, ${snapshotColumn}->'task'->>'identifier')`,
    instruction: sql<string | null>`${tasks.instruction}`,
    name: sql<string | null>`coalesce(${tasks.name}, ${snapshotColumn}->'task'->>'title')`,
    priority: sql<number | null>`${tasks.priority}`,
    status: sql<string | null>`${tasks.status}`,
  },
});

/**
 * LEFT JOIN condition pairing a Work row to its live `tasks` row (task type
 * only, owner-scoped). Callers use a LEFT JOIN (not INNER) so orphaned task
 * Works — the task deleted without the tool path — still surface; deletion is
 * then derived from the missing `tasks` row (see `taskSummaryFields`).
 */
export const taskSummaryJoin = (ctx: WorkContext) =>
  and(eq(works.resourceType, 'task'), eq(works.resourceId, tasks.id), taskOwnership(ctx));

/**
 * Shared version-event query for snapshot-backed work types; `task` keeps
 * its own variant because it additionally joins the tasks table.
 */
export const listSnapshotVersionEventRows = <Snapshot>(
  ctx: WorkContext,
  type: SnapshotWorkType,
  filters: SQL[],
  limit: number,
) =>
  ctx.db
    .select({
      snapshot: snapshotField<Snapshot>(workVersions.snapshot, type),
      version: versionEventSelection,
      work: works,
    })
    .from(workVersions)
    .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
    .where(and(versionOwnership(ctx), ...filters, eq(works.type, type)))
    .orderBy(desc(workVersions.createdAt))
    .limit(limit);

/**
 * Shared current-version summary query for snapshot-backed work types;
 * `task` keeps its own variant because it additionally joins the tasks table.
 */
export const listSnapshotWorkSummaryRows = <Snapshot>(
  ctx: WorkContext,
  type: SnapshotWorkType,
  filters: SQL[],
  rowLimit: number,
): Promise<SnapshotWorkSummaryQueryRow<Snapshot>[]> =>
  ctx.db
    .select({
      event: versionEventSelection,
      snapshot: snapshotField<Snapshot>(currentVersions.snapshot, type),
      version: {
        createdAt: currentVersions.createdAt,
        id: currentVersions.id,
        version: currentVersions.version,
      },
      work: works,
    })
    .from(workVersions)
    .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
    .innerJoin(currentVersions, eq(works.currentVersionId, currentVersions.id))
    .where(and(versionOwnership(ctx), ...filters, eq(works.type, type)))
    .orderBy(desc(workVersions.createdAt), desc(works.updatedAt))
    .limit(rowLimit);

/**
 * One current-version row surfaced by the conversation-scoped list query,
 * paired with the mutation-event timestamp used for cross-type ordering.
 */
export interface WorkConversationRow {
  eventCreatedAt: Date;
  item: WorkListItem;
}

export interface WorkConversationRowParams {
  rowLimit: number;
  threadFilter: SQL;
  topicId: string;
}

/**
 * Workspace-wide list row shape shared by every type (one query, no per-type
 * fan-out): the full current-version snapshot JSON plus the coalesced task
 * columns (nulled for non-task rows by the LEFT JOIN).
 */
export interface WorkspaceSummaryQueryRow {
  event: WorkVersionPreview;
  snapshot: WorkVersionSnapshot;
  task: TaskWorkSummaryQueryRow['task'];
  version: TaskWorkSummaryItem['version'];
  work: WorkItem;
}

/**
 * Per-type query/mapping strategy consumed by the aggregate queries in
 * `queries.ts`. The aggregates iterate `WORK_TYPE_ADAPTERS` (see registry.ts),
 * so adding a Work type means registering ONE adapter — there is no hand-written
 * per-type fan-out left to forget, which would silently drop that type's rows.
 *
 * `Row` is the type-specific summary row; it round-trips within one adapter
 * (`listSummaryRows` produces it, `mapSummaryRow` consumes it), so the registry
 * can hold adapters as `WorkTypeAdapter<{ work: WorkItem }>` without losing
 * per-adapter safety. METHOD signatures are required here — methods stay
 * bivariant under strictFunctionTypes, which is what lets an adapter with a
 * narrower `Row` conform to the registry's widened constraint; the
 * property-arrow style the lint rule prefers is contravariant and breaks the
 * `satisfies Record<WorkType, …>` check in registry.ts.
 */
/* eslint-disable @typescript-eslint/method-signature-style */
export interface WorkTypeAdapter<Row extends { work: WorkItem }> {
  /** Current-version rows for the conversation sidebar list (summary-slimmed snapshots). */
  listConversationRows(
    ctx: WorkContext,
    params: WorkConversationRowParams,
  ): Promise<WorkConversationRow[]>;
  /** Current-version summary rows anchored on mutation events (message-list chips). */
  listSummaryRows(ctx: WorkContext, filters: SQL[], rowLimit: number): Promise<Row[]>;
  /** Version-event rows carrying the FULL (unslimmed) event snapshot. */
  listVersionEvents(
    ctx: WorkContext,
    filters: SQL[],
    limit: number,
  ): Promise<WorkVersionEventItem[]>;
  mapSummaryRow(row: Row, totalCost: number | null): WorkSummaryItem;
  /** Map one shared workspace-list row (full snapshot JSON) onto this type's summary item. */
  mapWorkspaceRow(row: WorkspaceSummaryQueryRow, totalCost: number | null): WorkSummaryItem;
}
/* eslint-enable @typescript-eslint/method-signature-style */
