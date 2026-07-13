import type {
  DocumentWorkSummaryItem,
  RegisterTaskWorkParams,
  TaskWorkListItem,
  TaskWorkSummaryItem,
  WorkDisplayField,
  WorkItem,
  WorkListItem,
  WorkSummaryItem,
  WorkVersionEventItem,
  WorkVersionPreview,
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
 * Write-time cap for the card-preview `description` column (message list,
 * sidebar summary, workspace gallery). The full body lives untruncated in
 * `works.content` (external Works) or on the owning table (documents); only the
 * `description` preview is sliced. Single source of truth, also consumed by the
 * provider normalizers.
 */
export const WORK_DESCRIPTION_PREVIEW_LENGTH = 120;

/** Collapse whitespace and cap length for card-facing Work text fields. */
export const truncateSummaryText = (value: string | null | undefined): string | null => {
  const normalized = value?.replaceAll(/\s+/g, ' ').trim();
  if (!normalized) return null;

  return normalized.length > WORK_DESCRIPTION_PREVIEW_LENGTH
    ? `${normalized.slice(0, WORK_DESCRIPTION_PREVIEW_LENGTH)}...`
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
  | 'sourceToolIdentifier'
  | 'sourceToolName'
  | 'threadId'
  | 'topicId'
>;

/** The display columns a registration writes onto the `works` row. */
export interface WorkDisplayColumns {
  content?: string | null;
  description?: string | null;
  identifier?: string | null;
  status?: string | null;
  title?: string | null;
  url?: string | null;
}

/** Provider-specific inputs for one work-version insert attempt. */
export interface CreateVersionInput {
  /**
   * Display columns to write onto the `works` row under the version lock. When
   * `patchFields` is set, ONLY those named columns are updated (partial tool
   * results must not wipe a concurrent registration's other columns); otherwise
   * every display column is overwritten (task/document carry complete data).
   */
  display: WorkDisplayColumns;
  metadata?: (typeof workVersions.$inferInsert)['metadata'];
  patchFields?: WorkDisplayField[];
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
 * Work types whose list rows are fully described by the `works` display columns
 * (unlike `task`, which additionally joins the live tasks table).
 */
export type DisplayWorkType = 'document' | 'external';

export interface DisplayWorkSummaryQueryRow {
  event: WorkVersionPreview;
  version: DocumentWorkSummaryItem['version'];
  work: WorkItem;
}

/** Version-event row for display-backed types (each mutation event, no live join). */
export interface DisplayVersionEventRow {
  version: WorkVersionPreview;
  work: WorkItem;
}

/**
 * Task live-column projection shared by every task summary/list query. `tasks`
 * columns take priority; a LEFT JOIN miss (task deleted without the tool path)
 * nulls the whole `tasks` row, so title/identifier coalesce onto the persisted
 * `works` display columns and `tasks.id is null` becomes the orphan-deletion
 * signal. `instruction` (NOT NULL on live rows) is the card preview text;
 * instruction/priority/status are live-only — a deleted task's card renders
 * title + identifier + deleted badge from the `works` columns.
 */
export const taskSummaryFields = {
  task: {
    deleted: sql<boolean>`${tasks.id} is null`,
    identifier: sql<string | null>`coalesce(${tasks.identifier}, ${works.identifier})`,
    instruction: sql<string | null>`${tasks.instruction}`,
    name: sql<string | null>`coalesce(${tasks.name}, ${works.title})`,
    priority: sql<number | null>`${tasks.priority}`,
    status: sql<string | null>`${tasks.status}`,
  },
};

/**
 * LEFT JOIN condition pairing a Work row to its live `tasks` row (task type
 * only, owner-scoped). Callers use a LEFT JOIN (not INNER) so orphaned task
 * Works — the task deleted without the tool path — still surface; deletion is
 * then derived from the missing `tasks` row (see `taskSummaryColumns`).
 */
export const taskSummaryJoin = (ctx: WorkContext) =>
  and(eq(works.resourceType, 'task'), eq(works.resourceId, tasks.id), taskOwnership(ctx));

/**
 * Shared version-event query for display-backed work types; `task` keeps its
 * own variant because it additionally joins the tasks table.
 */
export const listDisplayVersionEventRows = (
  ctx: WorkContext,
  type: DisplayWorkType,
  filters: SQL[],
  limit: number,
): Promise<DisplayVersionEventRow[]> =>
  ctx.db
    .select({
      version: versionEventSelection,
      work: works,
    })
    .from(workVersions)
    .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
    .where(and(versionOwnership(ctx), ...filters, eq(works.type, type)))
    .orderBy(desc(workVersions.createdAt))
    .limit(limit);

/**
 * Shared current-version summary query for display-backed work types; `task`
 * keeps its own variant because it additionally joins the tasks table.
 */
export const listDisplayWorkSummaryRows = (
  ctx: WorkContext,
  type: DisplayWorkType,
  filters: SQL[],
  rowLimit: number,
): Promise<DisplayWorkSummaryQueryRow[]> =>
  ctx.db
    .select({
      event: versionEventSelection,
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
 * fan-out): the `works` display columns plus the coalesced task columns (nulled
 * for non-task rows by the LEFT JOIN).
 */
export interface WorkspaceSummaryQueryRow {
  event: WorkVersionPreview;
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
  /** Current-version rows for the conversation sidebar list. */
  listConversationRows(
    ctx: WorkContext,
    params: WorkConversationRowParams,
  ): Promise<WorkConversationRow[]>;
  /** Current-version summary rows anchored on mutation events (message-list chips). */
  listSummaryRows(ctx: WorkContext, filters: SQL[], rowLimit: number): Promise<Row[]>;
  /** Version-event rows carrying each mutation event. */
  listVersionEvents(
    ctx: WorkContext,
    filters: SQL[],
    limit: number,
  ): Promise<WorkVersionEventItem[]>;
  mapSummaryRow(row: Row, totalCost: number | null): WorkSummaryItem;
  /** Map one shared workspace-list row onto this type's summary item. */
  mapWorkspaceRow(row: WorkspaceSummaryQueryRow, totalCost: number | null): WorkSummaryItem;
}
/* eslint-enable @typescript-eslint/method-signature-style */
