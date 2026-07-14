import type {
  WorkResourceType,
  WorkType,
  WorkVersionChangeType,
  WorkVersionCumulativeUsage,
  WorkVersionMetadata,
} from '@lobechat/types';
import { isNotNull, isNull } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { amountNumeric, createdAt, updatedAt } from './_helpers';
import { agents } from './agent';
import { messages } from './message';
import { threads, topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Stable Work identity. The same underlying resource (for MVP, a task) maps to
 * one Work row; edits append immutable rows in `work_versions`.
 */
export const works = pgTable(
  'works',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('works'))
      .notNull(),
    /** Provider domain of the Work: 'task' | 'document' | 'external'. */
    type: text('type').$type<WorkType>().notNull(),
    /**
     * Latest `work_versions` row. Soft reference (no FK): work_versions.workId
     * already references works, so a real FK here would create a circular
     * dependency between the two tables.
     *
     * Typed `uuid` to match `work_versions.id` (also uuid): every list/summary
     * query joins `works.currentVersionId = work_versions.id`, and Postgres has
     * no `text = uuid` operator, so a text column here breaks the join.
     */
    currentVersionId: uuid('current_version_id'),

    /** Fine-grained resource kind, e.g. 'task' | 'linear_issue' | 'github_pull_request'. */
    resourceType: text('resource_type').$type<WorkResourceType>().notNull(),
    /**
     * Stable dedup key of the underlying resource within (resourceType, user/workspace).
     * task: task id; linear: issue identifier or document id; github: `owner/repo#number`
     * (the gh CLI surface never returns a node_id, so both github surfaces share this key).
     *
     * Still the dedup key when present. Rows with a NULL `resourceId` bypass the
     * partial unique indexes below (Postgres treats NULLs as distinct, so no two
     * NULL-resource rows ever conflict) — deliberate, reserving room for future
     * Works that have no stable backing resource to dedup against.
     */
    resourceId: text('resource_id'),

    /**
     * Conversation where the Work was FIRST registered (creation provenance):
     * stamped once at insert, never overwritten by later registrations —
     * per-mutation conversation lives on each `work_versions` row. Set-null so
     * deleting the conversation keeps the Work.
     */
    sourceTopicId: text('source_topic_id').references(() => topics.id, { onDelete: 'set null' }),
    sourceThreadId: text('source_thread_id').references(() => threads.id, {
      onDelete: 'set null',
    }),

    /**
     * Tool/plugin identifier that CREATED the Work, e.g. 'lobe-task',
     * 'lobe-agent-documents', or the skill provider ('github' / 'linear'). Written
     * once on insert and NOT overwritten by later registrations, so it always names
     * the creator surface even after other tools mutate the resource.
     */
    sourceToolIdentifier: text('source_tool_identifier'),
    /** Current display title (progressive disclosure layer 1). */
    title: text('title'),
    /** Short preview text, sliced to 120 chars at write time (layer 2). */
    description: text('description'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Null for personal Works; determines which resource unique index applies below. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    /** Deduplicates personal Works and serves the personal resource upsert conflict target. */
    uniqueIndex('works_resource_user_unique')
      .on(t.resourceType, t.resourceId, t.userId)
      .where(isNull(t.workspaceId)),
    /** Deduplicates workspace Works and serves the workspace resource upsert conflict target. */
    uniqueIndex('works_resource_workspace_unique')
      .on(t.workspaceId, t.resourceType, t.resourceId)
      .where(isNotNull(t.workspaceId)),
    /** Supports user-scoped ownership filters and cascading cleanup when a user is deleted. */
    index('works_user_id_idx').on(t.userId),
    /** Supports workspace-scoped ownership filters and cascading cleanup when a workspace is deleted. */
    index('works_workspace_id_idx').on(t.workspaceId),
    /** Powers keyset pagination of personal Works ordered by latest update and stable id. */
    index('works_user_updated_at_id_idx')
      .on(t.userId, t.updatedAt, t.id)
      .where(isNull(t.workspaceId)),
    /** Powers keyset pagination of workspace Works ordered by latest update and stable id. */
    index('works_workspace_updated_at_id_idx')
      .on(t.workspaceId, t.updatedAt, t.id)
      .where(isNotNull(t.workspaceId)),
    /** Locates a Work by its backing resource for resource-driven updates and deletes. */
    index('works_resource_idx').on(t.resourceType, t.resourceId),
    /** Supports reverse lookup from a materialized current version to its owning Work. */
    index('works_current_version_id_idx').on(t.currentVersionId),
    /** Supports global maintenance and recency scans ordered or filtered by last update. */
    index('works_updated_at_idx').on(t.updatedAt),
    /** Supports creation-topic provenance lookup and topic-deletion SET NULL processing. */
    index('works_source_topic_id_idx').on(t.sourceTopicId),
    /** Supports creation-thread provenance lookup and thread-deletion SET NULL processing. */
    index('works_source_thread_id_idx').on(t.sourceThreadId),
  ],
);

/**
 * Immutable Work version content plus the provenance of the mutation that
 * produced it (git-commit mental model: one row = one content change event).
 * Topic/thread/message references are set-null so deleting a conversation does
 * not delete the Work identity or its version history.
 */
export const workVersions = pgTable(
  'work_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: text('work_id')
      .references(() => works.id, { onDelete: 'cascade' })
      .notNull(),
    /** 1-based sequence within a Work, unique per (workId, version). */
    version: integer('version').notNull(),

    /** Display title captured when this immutable version was produced. */
    title: text('title'),
    /** Short preview text captured when this immutable version was produced. */
    description: text('description'),
    /**
     * Full text captured by this version, capped at write time. Null for document
     * Works because their full content remains in the documents table.
     */
    content: text('content'),
    /** Human reference captured by this version, such as `TASK-1` or `ENG-123`. */
    identifier: text('identifier'),
    /** Resource status captured by this version when the provider exposes one. */
    status: text('status'),
    /** Canonical http(s) open target captured by this version. */
    url: text('url'),

    /**
     * How this version changed the Work: 'created' | 'updated'. Not derivable
     * from `version === 1`: updating an external resource that was never
     * registered before yields a v1 row with changeType='updated'.
     */
    changeType: text('change_type').$type<WorkVersionChangeType>().notNull(),
    /** Concrete tool that produced this version, e.g. 'createTask'. */
    sourceToolName: text('source_tool_name').notNull(),
    /**
     * Tool/plugin identifier that produced THIS version. Unlike `works.sourceToolIdentifier`
     * (the creator, written once), this is per-mutation, so it names whichever tool
     * drove each individual version.
     */
    sourceToolIdentifier: text('source_tool_identifier'),

    /** Conversation where the mutation happened; set-null keeps history after topic deletion. */
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    /**
     * Message that triggered this version — the persisted tool result message.
     * Stamped at insert time by the agent runtime, which registers the version
     * only after the tool result message exists (see registerWorkFromIntent).
     */
    sourceMessageId: text('source_message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    /** Root runtime operation that groups all versions created during one assistant run. */
    rootOperationId: text('root_operation_id'),
    /** Runtime tool-call id that produced this version, used to dedupe repeated registration. */
    sourceToolCallId: text('source_tool_call_id'),
    /** Agent that triggered the Work change, when the source is agent/tool driven. */
    actorAgentId: text('actor_agent_id').references(() => agents.id, { onDelete: 'set null' }),
    /** Resource-specific tool provenance, such as the agent document binding used by a document tool. */
    metadata: jsonb('metadata').$type<WorkVersionMetadata>(),

    /**
     * Cumulative operation cost in USD when this version is produced.
     * For example, one operation may create Work A at $0.03 and Work B later at $0.05.
     * These are cumulative snapshots, not exclusive Work costs.
     */
    cumulativeCost: amountNumeric('cumulative_cost'),
    /** Runtime usage/cost detail captured with `cumulativeCost`, including tokens and breakdowns. */
    cumulativeUsage: jsonb('cumulative_usage').$type<WorkVersionCumulativeUsage>(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    /** Enforces one immutable row per Work version and supports ordered version-history reads. */
    uniqueIndex('work_versions_work_id_version_unique').on(t.workId, t.version),
    /** Deduplicates retries of the same tool call while resolving a Work version. */
    uniqueIndex('work_versions_work_id_source_tool_call_id_unique')
      .on(t.workId, t.sourceToolCallId)
      .where(isNotNull(t.sourceToolCallId)),
    /** Supports Work history and cost scans plus cascading cleanup when a Work is deleted. */
    index('work_versions_work_id_idx').on(t.workId),
    /** Supports topic-scoped event lookup and topic-deletion SET NULL processing. */
    index('work_versions_topic_id_idx').on(t.topicId),
    /** Supports thread-scoped event lookup and thread-deletion SET NULL processing. */
    index('work_versions_thread_id_idx').on(t.threadId),
    /** Supports message provenance lookup and message-deletion SET NULL processing. */
    index('work_versions_source_message_id_idx').on(t.sourceMessageId),
    /** Supports direct and batched lookup of version events produced by an agent operation. */
    index('work_versions_root_operation_id_idx').on(t.rootOperationId),
    /** Powers operation-scoped event lists ordered by creation time. */
    index('work_versions_root_operation_created_at_idx').on(t.rootOperationId, t.createdAt),
    /** Powers conversation event lists filtered by topic/thread and ordered by creation time. */
    index('work_versions_topic_thread_created_at_idx').on(t.topicId, t.threadId, t.createdAt),
    /** Supports user-scoped version ownership filters and cascading user cleanup. */
    index('work_versions_user_id_idx').on(t.userId),
    /** Supports workspace-scoped version ownership filters and cascading workspace cleanup. */
    index('work_versions_workspace_id_idx').on(t.workspaceId),
    /** Supports global maintenance and recency scans over Work mutation events. */
    index('work_versions_created_at_idx').on(t.createdAt),
  ],
);

export type NewWork = typeof works.$inferInsert;
export type WorkItem = typeof works.$inferSelect;
export type NewWorkVersion = typeof workVersions.$inferInsert;
export type WorkVersionItem = typeof workVersions.$inferSelect;
