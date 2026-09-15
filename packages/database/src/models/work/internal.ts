import type {
  RegisterTaskWorkParams,
  TaskWorkListItem,
  TaskWorkSummaryItem,
  WorkDisplayField,
  WorkItem,
  WorkListBaseItem,
  WorkListItem,
  WorkSummaryItem,
  WorkSummaryVersionPreview,
  WorkVersionEventItem,
  WorkVersionPreview,
} from '@lobechat/types';
import type { SQL } from 'drizzle-orm';
import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { documents } from '../../schemas/file';
import { tasks } from '../../schemas/task';
import { works, workVersions } from '../../schemas/work';
import { taskOwnership, type WorkContext, workOwnership } from './context';

/**
 * Alias used when a current-Work query joins the immutable Version selected by
 * `works.currentVersionId` to expose version metadata without another lookup.
 */
export const currentVersions = alias(workVersions, 'current_work_versions');

/**
 * Write-time cap for the card-preview `description` column (message list,
 * sidebar summary, workspace gallery). The full body lives in the immutable
 * version snapshot (external Works, capped at {@link WORK_CONTENT_MAX_LENGTH})
 * or on the owning table (documents); list/summary projections deliberately
 * omit `content` and carry only the `description` preview. Single source of
 * truth, also consumed by the provider normalizers.
 */
export const WORK_DESCRIPTION_PREVIEW_LENGTH = 120;

/**
 * Write-time cap for the full-text `content` column (layer 3 of the display
 * trio). Anchored to GitHub's 65 536-char issue-body limit; without a cap an
 * agent-generated multi-MB body would land in a version row. Card-facing
 * queries exclude this column and fetch only the bounded preview.
 */
export const WORK_CONTENT_MAX_LENGTH = 65_536;

/** Cap the full-text `content` column; no whitespace collapsing (it IS the full text). */
export const truncateContentText = (value: string | null | undefined): string | null => {
  if (!value) return null;

  return value.length > WORK_CONTENT_MAX_LENGTH
    ? `${value.slice(0, WORK_CONTENT_MAX_LENGTH)}...`
    : value;
};

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
  | 'agentId'
  | 'cumulativeCost'
  | 'cumulativeUsage'
  | 'changeType'
  | 'messageId'
  | 'rootOperationId'
  | 'threadId'
  | 'toolCallId'
  | 'toolIdentifier'
  | 'toolName'
  | 'topicId'
>;

/** The display fields captured by an immutable Work version snapshot. */
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
   * Display fields used to build the next immutable snapshot under the Work row
   * lock. When `patchFields` is set, unnamed fields inherit from the current
   * version; otherwise omitted fields become null (task/document carry complete
   * data).
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
  messageId: workVersions.messageId,
  rootOperationId: workVersions.rootOperationId,
  toolCallId: workVersions.toolCallId,
  toolName: workVersions.toolName,
  version: workVersions.version,
};

/** Current-version event fields selected through the `currentVersions` alias. */
export const currentVersionEventSelection = {
  changeType: currentVersions.changeType,
  createdAt: currentVersions.createdAt,
  cumulativeCost: currentVersions.cumulativeCost,
  cumulativeUsage: currentVersions.cumulativeUsage,
  id: currentVersions.id,
  messageId: currentVersions.messageId,
  metadata: currentVersions.metadata,
  rootOperationId: currentVersions.rootOperationId,
  toolCallId: currentVersions.toolCallId,
  toolName: currentVersions.toolName,
  version: currentVersions.version,
};

/** Stable Work columns shared by current-card and historical-event projections. */
const workIdentityFields = {
  createdAt: works.createdAt,
  currentVersionId: works.currentVersionId,
  id: works.id,
  originAgentId: works.originAgentId,
  originThreadId: works.originThreadId,
  originTopicId: works.originTopicId,
  resourceId: works.resourceId,
  resourceType: works.resourceType,
  toolIdentifier: works.toolIdentifier,
  toolName: works.toolName,
  type: works.type,
  updatedAt: works.updatedAt,
  url: works.url,
  userId: works.userId,
  visibility: works.visibility,
  workspaceId: works.workspaceId,
};

/** Current-version card fields; full `content` remains intentionally excluded. */
export const currentWorkListFields = {
  ...workIdentityFields,
  description: works.description,
  identifier: works.identifier,
  status: works.status,
  title: works.title,
};

/** Historical event card fields sourced entirely from that event's version snapshot. */
export const eventWorkListFields = {
  ...workIdentityFields,
  description: workVersions.description,
  identifier: workVersions.identifier,
  status: workVersions.status,
  title: workVersions.title,
  toolIdentifier: workVersions.toolIdentifier,
  toolName: workVersions.toolName,
  url: workVersions.url,
};

export interface TaskWorkSummaryQueryRow {
  event: WorkSummaryVersionPreview;
  /** See {@link WorkListBaseItem.resourceDeleted}; derived by the query, not a column. */
  resourceDeleted: boolean;
  /** Live-coalesced task columns, falling back to the snapshot on a LEFT JOIN miss. */
  task: TaskWorkListItem['task'];
  version: TaskWorkSummaryItem['version'];
  work: WorkItem;
}

/**
 * Work types whose list rows are fully described by the `works` display columns
 * (unlike `task`, which additionally joins the live tasks table).
 */
export type DisplayWorkType = 'document' | 'external' | 'file';

/** Version-event row for display-backed types (each mutation event). */
export interface DisplayVersionEventRow {
  /** See {@link WorkListBaseItem.resourceDeleted}; constant `false` for external / file. */
  resourceDeleted: boolean;
  version: WorkVersionPreview;
  work: WorkItem;
}

/**
 * Current-card task projection. Live task columns take priority; a LEFT JOIN
 * miss falls back to the Work's current-version cache/snapshot and is reported
 * separately through {@link taskDeletedField}.
 */
export const currentTaskSummaryFields = {
  task: {
    identifier: sql<string | null>`coalesce(${tasks.identifier}, ${works.identifier})`,
    instruction: sql<string | null>`coalesce(${tasks.instruction}, ${works.description})`,
    name: sql<string | null>`coalesce(${tasks.name}, ${works.title})`,
    priority: sql<number | null>`${tasks.priority}`,
    status: sql<string | null>`coalesce(${tasks.status}, ${works.status})`,
  },
};

/** Historical task-event projection with fallback to that event's immutable snapshot. */
export const eventTaskSummaryFields = {
  task: {
    identifier: sql<string | null>`coalesce(${tasks.identifier}, ${workVersions.identifier})`,
    instruction: sql<string | null>`coalesce(${tasks.instruction}, ${workVersions.description})`,
    name: sql<string | null>`coalesce(${tasks.name}, ${workVersions.title})`,
    priority: sql<number | null>`${tasks.priority}`,
    status: sql<string | null>`coalesce(${tasks.status}, ${workVersions.status})`,
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
 * LEFT JOIN condition pairing a Work row to its live `documents` row (document
 * type only). Existence-only, and deliberately WITHOUT the ownership predicate
 * {@link taskSummaryJoin} carries: the single thing read through this join is
 * `documents.id is null`, and which Work rows are visible at all is already
 * decided by `workOwnership`'s `documentVisibilityGuard`. Filtering by owner
 * here would instead make another member's live, public document look deleted.
 */
export const documentSummaryJoin = and(
  eq(works.resourceType, 'document'),
  eq(works.resourceId, documents.id),
);

/** `resourceDeleted` for a task-only query (the `tasks` LEFT JOIN missed). */
export const taskDeletedField = sql<boolean>`${tasks.id} is null`;

/** `resourceDeleted` for a document-only query (the `documents` LEFT JOIN missed). */
export const documentDeletedField = sql<boolean>`${documents.id} is null`;

/**
 * `resourceDeleted` for the Work types with no local backing row (`external`,
 * `file`): there is nothing to join, so the flag is a constant `false`.
 */
export const resourceNeverDeletedField = sql<boolean>`false`;

/**
 * `resourceDeleted` for the cross-type queries that LEFT JOIN BOTH backing
 * tables (workspace gallery, root-operation summaries). Switching on
 * `works.resourceType` keeps each type reading only its own join, and short-
 * circuits `external` / `file` to `false` instead of misreading a NULL join.
 */
export const resourceDeletedField = sql<boolean>`case ${works.resourceType} when 'task' then ${tasks.id} is null when 'document' then ${documents.id} is null else false end`;

/**
 * Shared version-event query for display-backed work types; `task` keeps its
 * own variant because it additionally joins the tasks table.
 */
export const listDisplayVersionEventRows = (
  ctx: WorkContext,
  type: DisplayWorkType,
  filters: SQL[],
  limit: number,
): Promise<DisplayVersionEventRow[]> => {
  const query = ctx.db
    .select({
      resourceDeleted: type === 'document' ? documentDeletedField : resourceNeverDeletedField,
      version: versionEventSelection,
      work: eventWorkListFields,
    })
    .from(workVersions)
    .innerJoin(works, and(eq(workVersions.workId, works.id), workOwnership(ctx)))
    .$dynamic();

  // `document` is the only display-backed type with a local backing row, so it
  // is the only one that pays for the join; the others answer with a constant.
  const joined = type === 'document' ? query.leftJoin(documents, documentSummaryJoin) : query;

  return joined
    .where(and(...filters, eq(works.type, type)))
    .orderBy(desc(workVersions.createdAt))
    .limit(limit);
};

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
  event: WorkSummaryVersionPreview;
  /** See {@link WorkListBaseItem.resourceDeleted}; derived by {@link resourceDeletedField}. */
  resourceDeleted: boolean;
  task: TaskWorkSummaryQueryRow['task'];
  version: TaskWorkSummaryItem['version'];
  work: WorkItem;
}

/**
 * Per-type event-query and display-mapping strategy. Current summaries use one
 * shared Work-first query; adding a Work type requires only its historical and
 * conversation projections plus a mapping entry in `WORK_TYPE_ADAPTERS`.
 */
export interface WorkTypeAdapter {
  /** Current-version rows for the conversation sidebar list. */
  listConversationRows: (
    ctx: WorkContext,
    params: WorkConversationRowParams,
  ) => Promise<WorkConversationRow[]>;
  /** Version-event rows carrying each mutation event. */
  listVersionEvents: (
    ctx: WorkContext,
    filters: SQL[],
    limit: number,
  ) => Promise<WorkVersionEventItem[]>;
  /** Map one shared current-Work row onto this type's summary item. */
  mapCurrentRow: (row: WorkspaceSummaryQueryRow, totalCost: number | null) => WorkSummaryItem;
}
