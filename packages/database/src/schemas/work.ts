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
 * Stable Work identity. The same underlying task, document, or external
 * resource maps to one Work row; edits append immutable rows in
 * `work_versions`.
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

    /** Current display title (progressive disclosure layer 1). */
    title: text('title'),
    /** Short preview text, sliced to 120 chars at write time (layer 2). */
    description: text('description'),
    /** Current human reference, such as `TASK-1` or `ENG-123`. */
    identifier: text('identifier'),
    /** Current resource status exposed by the latest version's provider. */
    status: text('status'),
    /** Current canonical http(s) open target. */
    url: text('url'),

    /** Concrete tool that produced the current version, e.g. `createTask`. */
    toolName: text('tool_name').notNull(),
    /** Tool/plugin identifier that produced the current version, e.g. `lobe-task`. */
    toolIdentifier: text('tool_identifier').notNull(),

    /**
     * Origin provenance: where this Work was FIRST registered. Stamped once when
     * the identity row is created and never updated — even when that first
     * registration is an update to a pre-existing external resource
     * (changeType='updated'). Powers "works created in this topic / by this
     * agent" filters; per-mutation provenance lives on `work_versions`.
     * Set-null so deleting the origin conversation/agent keeps the Work.
     */
    originTopicId: text('origin_topic_id').references(() => topics.id, { onDelete: 'set null' }),
    originThreadId: text('origin_thread_id').references(() => threads.id, {
      onDelete: 'set null',
    }),
    originAgentId: text('origin_agent_id').references(() => agents.id, { onDelete: 'set null' }),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Null for personal Works; determines which resource unique index applies below. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    /**
     * Visibility within the owning workspace. Registration must explicitly
     * inherit this from the backing resource; external Works default to private
     * at the write boundary until a workspace-shared authorization is known.
     * Ignored in personal mode where the row is implicitly private to its owner.
     */
    visibility: text('visibility', { enum: ['private', 'public'] }).notNull(),

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
    /** Supports workspace public-or-owner visibility filtering. */
    index('works_workspace_visibility_idx').on(t.workspaceId, t.visibility, t.userId),
    /** Powers keyset pagination of personal Works ordered by latest update and stable id. */
    index('works_user_updated_at_id_idx')
      .on(t.userId, t.updatedAt, t.id)
      .where(isNull(t.workspaceId)),
    /** Powers keyset pagination of workspace Works ordered by latest update and stable id. */
    index('works_workspace_updated_at_id_idx')
      .on(t.workspaceId, t.updatedAt, t.id)
      .where(isNotNull(t.workspaceId)),
    /** Supports origin-topic filters (e.g. per-topic created-works lists) and topic-deletion SET NULL processing. */
    index('works_origin_topic_id_idx').on(t.originTopicId),
    /** Supports origin-thread filters and thread-deletion SET NULL processing. */
    index('works_origin_thread_id_idx').on(t.originThreadId),
    /** Supports origin-agent filters and agent-deletion SET NULL processing. */
    index('works_origin_agent_id_idx').on(t.originAgentId),
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
    /** Concrete tool that produced this version, e.g. `createTask`. */
    toolName: text('tool_name').notNull(),
    /** Tool/plugin identifier that produced this version, e.g. `lobe-task`. */
    toolIdentifier: text('tool_identifier').notNull(),

    /** Conversation where the mutation happened; set-null keeps history after topic deletion. */
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    /**
     * Message that triggered this version — the persisted tool result message.
     * Stamped at insert time by the agent runtime, which registers the version
     * only after the tool result message exists (see registerWorkFromIntent).
     */
    messageId: text('message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    /** Root runtime operation that groups all versions created during one assistant run. */
    rootOperationId: text('root_operation_id'),
    /** Runtime tool-call id that produced this version, used to dedupe repeated registration. */
    toolCallId: text('tool_call_id'),
    /** Agent that produced this version, when the source is agent/tool driven. */
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
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

    createdAt: createdAt(),
  },
  (t) => [
    /** Enforces one immutable row per Work version and supports ordered version-history reads. */
    uniqueIndex('work_versions_work_id_version_unique').on(t.workId, t.version),
    /** Deduplicates retries of the same tool call while resolving a Work version. */
    uniqueIndex('work_versions_work_id_tool_call_id_unique')
      .on(t.workId, t.toolCallId)
      .where(isNotNull(t.toolCallId)),
    /** Supports thread-scoped event lookup and thread-deletion SET NULL processing. */
    index('work_versions_thread_id_idx').on(t.threadId),
    /** Supports message provenance lookup and message-deletion SET NULL processing. */
    index('work_versions_message_id_idx').on(t.messageId),
    /** Supports agent-attribution lookup and agent-deletion SET NULL processing. */
    index('work_versions_agent_id_idx').on(t.agentId),
    /** Powers operation-scoped event lists ordered by creation time. */
    index('work_versions_root_operation_created_at_idx').on(t.rootOperationId, t.createdAt),
    /** Powers topic-level event lists and topic-deletion SET NULL processing. */
    index('work_versions_topic_created_at_idx').on(t.topicId, t.createdAt),
    /** Powers conversation event lists filtered by topic/thread and ordered by creation time. */
    index('work_versions_topic_thread_created_at_idx').on(t.topicId, t.threadId, t.createdAt),
  ],
);

export type NewWork = typeof works.$inferInsert;
export type WorkItem = typeof works.$inferSelect;
export type NewWorkVersion = typeof workVersions.$inferInsert;
export type WorkVersionItem = typeof workVersions.$inferSelect;
