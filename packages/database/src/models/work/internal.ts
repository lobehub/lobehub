import type {
  DocumentWorkSummaryItem,
  GithubWorkVersionSnapshot,
  LinearWorkVersionSnapshot,
  RegisterTaskWorkParams,
  TaskWorkListItem,
  TaskWorkSummaryItem,
  WorkItem,
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

/**
 * Strip Linear full-document `content` and cap description for summary/list
 * rows so message-list and gallery payloads stay small.
 */
export const slimLinearSnapshotForSummary = (
  linear: LinearWorkVersionSnapshot,
): LinearWorkVersionSnapshot => ({
  ...linear,
  content: null,
  description: truncateSummaryText(linear.description || linear.content),
});

/**
 * Cap GitHub issue/PR `body` for summary/list rows (cards only show a one-line
 * preview; full body remains on the version snapshot in DB).
 */
export const slimGithubSnapshotForSummary = (
  github: GithubWorkVersionSnapshot,
): GithubWorkVersionSnapshot => ({
  ...github,
  body: truncateSummaryText(github.body),
});

/** Provenance fields shared by all four Register*WorkParams shapes. */
export type WorkVersionEventParams = Pick<
  RegisterTaskWorkParams,
  | 'actorAgentId'
  | 'cumulativeCost'
  | 'cumulativeUsage'
  | 'role'
  | 'rootOperationId'
  | 'source'
  | 'sourceMessageId'
  | 'sourceToolCallId'
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
  role: workVersions.role,
  rootOperationId: workVersions.rootOperationId,
  source: workVersions.source,
  sourceMessageId: workVersions.sourceMessageId,
  sourceToolCallId: workVersions.sourceToolCallId,
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
 * nulls the whole `tasks` row, so name/priority/status coalesce onto
 * `snapshotColumn` (the version snapshot) and `tasks.id is null` becomes the
 * orphan-deletion signal. `instruction` (NOT NULL on live rows) is the card
 * preview text — the optional short `description` is deliberately not
 * surfaced. `snapshotColumn` is `workVersions.snapshot` for event rows or
 * `currentVersions.snapshot` for summary rows.
 */
export const taskSummaryFields = (
  snapshotColumn: (typeof workVersions)['snapshot'] | (typeof currentVersions)['snapshot'],
) => ({
  task: {
    deleted: sql<boolean>`${tasks.id} is null`,
    instruction: sql<
      string | null
    >`coalesce(${tasks.instruction}, ${snapshotColumn}->'task'->>'instruction')`,
    name: sql<string | null>`coalesce(${tasks.name}, ${snapshotColumn}->'task'->>'name')`,
    priority: sql<
      number | null
    >`coalesce(${tasks.priority}, (${snapshotColumn}->'task'->>'priority')::integer)`,
    status: sql<string | null>`coalesce(${tasks.status}, ${snapshotColumn}->'task'->>'status')`,
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
