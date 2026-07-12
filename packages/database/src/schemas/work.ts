import type {
  WorkResourceType,
  WorkType,
  WorkVersionCumulativeUsage,
  WorkVersionMetadata,
  WorkVersionRole,
  WorkVersionSnapshot,
} from '@lobechat/types';
import { isNotNull, isNull } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

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
    /** Provider domain of the Work: 'task' | 'document' | 'linear' | 'github'. */
    type: text('type').$type<WorkType>().notNull(),
    /**
     * Latest `work_versions` row. Soft reference (no FK): work_versions.workId
     * already references works, so a real FK here would create a circular
     * dependency between the two tables.
     */
    currentVersionId: text('current_version_id'),

    /** Fine-grained resource kind, e.g. 'task' | 'linear_issue' | 'github_pull_request'. */
    resourceType: text('resource_type').$type<WorkResourceType>().notNull(),
    /**
     * Stable dedup key of the underlying resource within (resourceType, user/workspace).
     * task: task id; linear: issue identifier or document id; github: `owner/repo#number`
     * (the gh CLI surface never returns a node_id, so both github surfaces share this key).
     */
    resourceId: text('resource_id').notNull(),
    /** Human-readable external identifier for display, e.g. `LOBE-123` or `owner/repo#456`. */
    resourceIdentifier: text('resource_identifier'),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** Null for personal Works; determines which resource unique index applies below. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('works_resource_user_unique')
      .on(t.resourceType, t.resourceId, t.userId)
      .where(isNull(t.workspaceId)),
    uniqueIndex('works_resource_workspace_unique')
      .on(t.workspaceId, t.resourceType, t.resourceId)
      .where(isNotNull(t.workspaceId)),
    index('works_user_id_idx').on(t.userId),
    index('works_workspace_id_idx').on(t.workspaceId),
    index('works_resource_idx').on(t.resourceType, t.resourceId),
    index('works_current_version_id_idx').on(t.currentVersionId),
    index('works_updated_at_idx').on(t.updatedAt),
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
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('workVersions'))
      .notNull(),
    workId: text('work_id')
      .references(() => works.id, { onDelete: 'cascade' })
      .notNull(),
    /** 1-based sequence within a Work, unique per (workId, version). */
    version: integer('version').notNull(),
    /**
     * Normalized, white-listed resource fields (never raw connector payloads).
     * Partial tool results are patch-merged over the previous version's snapshot
     * using the normalizer's `patchFields`.
     */
    snapshot: jsonb('snapshot').$type<WorkVersionSnapshot>().notNull(),

    /**
     * How this version changed the Work: 'created' | 'updated'. Not derivable
     * from `version === 1`: updating an external resource that was never
     * registered before yields a v1 row with role='updated'.
     */
    role: text('role').$type<WorkVersionRole>().notNull(),
    /** Concrete tool that produced this version, e.g. 'createTask'. */
    source: text('source').notNull(),

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
    uniqueIndex('work_versions_work_id_version_unique').on(t.workId, t.version),
    uniqueIndex('work_versions_work_id_source_tool_call_id_unique')
      .on(t.workId, t.sourceToolCallId)
      .where(isNotNull(t.sourceToolCallId)),
    index('work_versions_work_id_idx').on(t.workId),
    index('work_versions_topic_id_idx').on(t.topicId),
    index('work_versions_thread_id_idx').on(t.threadId),
    index('work_versions_source_message_id_idx').on(t.sourceMessageId),
    index('work_versions_root_operation_id_idx').on(t.rootOperationId),
    index('work_versions_user_id_idx').on(t.userId),
    index('work_versions_workspace_id_idx').on(t.workspaceId),
    index('work_versions_created_at_idx').on(t.createdAt),
  ],
);

export type NewWork = typeof works.$inferInsert;
export type WorkItem = typeof works.$inferSelect;
export type NewWorkVersion = typeof workVersions.$inferInsert;
export type WorkVersionItem = typeof workVersions.$inferSelect;
