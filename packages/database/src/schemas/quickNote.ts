import type {
  QuickNoteAnalyzeTrigger,
  QuickNoteProposalDecisionStatus,
  QuickNoteProposalKind,
  QuickNoteProposalValidity,
  QuickNoteResourceRole,
  QuickNoteResourceType,
  QuickNoteRunExecutionConfig,
  QuickNoteRunInputRole,
  QuickNoteRunKind,
  QuickNoteRunStatus,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { agentOperations } from './agentOperations';
import { documentHistories } from './documentHistory';
import { documents } from './file';
import { threads, topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Quick Note captures and their stable backing containers.
 *
 * Content lives in `documents`; this table owns Quick Note organization and
 * the hidden Topic used by future Dive conversations.
 */
export const quickNotes = pgTable(
  'quick_notes',
  {
    id: text('id')
      .$defaultFn(() => idGenerator('quickNotes'))
      .primaryKey(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    documentId: varchar('document_id', { length: 255 })
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    topicId: text('topic_id')
      .references(() => topics.id, { onDelete: 'cascade' })
      .notNull(),
    tags: text('tags').array().default([]).notNull(),
    collection: text('collection'),
    location: text('location'),
    analyzeDueAt: timestamptz('analyze_due_at'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('quick_notes_document_id_unique').on(table.documentId),
    uniqueIndex('quick_notes_topic_id_unique').on(table.topicId),
    index('quick_notes_user_id_idx').on(table.userId),
    index('quick_notes_workspace_id_idx').on(table.workspaceId),
    index('quick_notes_analyze_due_at_idx').on(table.analyzeDueAt),
  ],
);

/** A persisted Quick Note capture. */
export type QuickNoteItem = typeof quickNotes.$inferSelect;

/** Values accepted when inserting a Quick Note capture. */
export type NewQuickNote = typeof quickNotes.$inferInsert;

/**
 * Immutable processing attempts over one pinned Quick Note Document History.
 */
export const quickNoteRuns = pgTable(
  'quick_note_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    quickNoteId: text('quick_note_id')
      .references(() => quickNotes.id, { onDelete: 'cascade' })
      .notNull(),
    sourceHistoryId: varchar('source_history_id', { length: 255 })
      .references(() => documentHistories.id, { onDelete: 'cascade' })
      .notNull(),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    operationId: text('operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    executionConfig: jsonb('execution_config').$type<QuickNoteRunExecutionConfig>(),
    kind: text('kind').$type<QuickNoteRunKind>().notNull(),
    trigger: text('trigger').$type<QuickNoteAnalyzeTrigger>(),
    status: text('status').$type<QuickNoteRunStatus>().default('pending').notNull(),
    error: text('error'),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    ...timestamps,
  },
  (table) => [
    index('quick_note_runs_quick_note_id_idx').on(table.quickNoteId),
    index('quick_note_runs_source_history_id_idx').on(table.sourceHistoryId),
    index('quick_note_runs_thread_id_idx').on(table.threadId),
    index('quick_note_runs_agent_id_idx').on(table.agentId),
    uniqueIndex('quick_note_runs_operation_id_unique').on(table.operationId),
    uniqueIndex('quick_note_runs_active_kind_unique')
      .on(table.quickNoteId, table.kind)
      .where(sql`${table.status} IN ('pending', 'running')`),
    index('quick_note_runs_status_idx').on(table.status),
  ],
);

/** A persisted immutable Quick Note processing attempt. */
export type QuickNoteRunItem = typeof quickNoteRuns.$inferSelect;

/** Values accepted when inserting a Quick Note processing attempt. */
export type NewQuickNoteRun = typeof quickNoteRuns.$inferInsert;

/**
 * Editable downstream suggestions whose content is versioned as a Document.
 */
export const quickNoteProposals = pgTable(
  'quick_note_proposals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    quickNoteId: text('quick_note_id')
      .references(() => quickNotes.id, { onDelete: 'cascade' })
      .notNull(),
    runId: uuid('run_id')
      .references(() => quickNoteRuns.id, { onDelete: 'cascade' })
      .notNull(),
    sourceHistoryId: varchar('source_history_id', { length: 255 })
      .references(() => documentHistories.id, { onDelete: 'cascade' })
      .notNull(),
    documentId: varchar('document_id', { length: 255 })
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    /** The exact editable Proposal revision currently presented to the user. */
    currentHistoryId: varchar('current_history_id', { length: 255 })
      .references(() => documentHistories.id, { onDelete: 'restrict' })
      .notNull(),
    /** The exact revision accepted by the user, independent of later Document edits. */
    acceptedHistoryId: varchar('accepted_history_id', { length: 255 }).references(
      () => documentHistories.id,
      { onDelete: 'set null' },
    ),
    kind: text('kind').$type<QuickNoteProposalKind>().notNull(),
    decisionStatus: text('decision_status')
      .$type<QuickNoteProposalDecisionStatus>()
      .default('pending')
      .notNull(),
    validity: text('validity').$type<QuickNoteProposalValidity>().default('current').notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('quick_note_proposals_document_id_unique').on(table.documentId),
    index('quick_note_proposals_quick_note_id_idx').on(table.quickNoteId),
    index('quick_note_proposals_run_id_idx').on(table.runId),
    index('quick_note_proposals_source_history_id_idx').on(table.sourceHistoryId),
    index('quick_note_proposals_current_history_id_idx').on(table.currentHistoryId),
    index('quick_note_proposals_accepted_history_id_idx').on(table.acceptedHistoryId),
    index('quick_note_proposals_decision_validity_idx').on(
      table.quickNoteId,
      table.decisionStatus,
      table.validity,
    ),
    index('quick_note_proposals_user_id_idx').on(table.userId),
    index('quick_note_proposals_workspace_id_idx').on(table.workspaceId),
  ],
);

/** A persisted editable Quick Note Proposal. */
export type QuickNoteProposalItem = typeof quickNoteProposals.$inferSelect;

/** Values accepted when inserting a Quick Note Proposal. */
export type NewQuickNoteProposal = typeof quickNoteProposals.$inferInsert;

/**
 * Lightweight user/agent feedback attached to a Quick Note.
 */
export const quickNoteComments = pgTable(
  'quick_note_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    quickNoteId: text('quick_note_id')
      .references(() => quickNotes.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    authorUserId: text('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    editorData: jsonb('editor_data').$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index('quick_note_comments_quick_note_id_idx').on(table.quickNoteId),
    index('quick_note_comments_user_id_idx').on(table.userId),
    index('quick_note_comments_workspace_id_idx').on(table.workspaceId),
    index('quick_note_comments_author_user_id_idx').on(table.authorUserId),
  ],
);

/** A current lightweight Quick Note Comment. */
export type QuickNoteCommentItem = typeof quickNoteComments.$inferSelect;

/** Values accepted when inserting a Quick Note Comment. */
export type NewQuickNoteComment = typeof quickNoteComments.$inferInsert;

/**
 * Append-only content revisions for editable Quick Note Comments.
 */
export const quickNoteCommentRevisions = pgTable(
  'quick_note_comment_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    commentId: uuid('comment_id')
      .references(() => quickNoteComments.id, { onDelete: 'cascade' })
      .notNull(),
    content: text('content').notNull(),
    editorData: jsonb('editor_data').$type<Record<string, unknown>>(),
    editorUserId: text('editor_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('quick_note_comment_revisions_comment_id_idx').on(table.commentId),
    index('quick_note_comment_revisions_editor_user_id_idx').on(table.editorUserId),
  ],
);

/** An immutable Quick Note Comment content revision. */
export type QuickNoteCommentRevisionItem = typeof quickNoteCommentRevisions.$inferSelect;

/** Values accepted when inserting a Quick Note Comment revision. */
export type NewQuickNoteCommentRevision = typeof quickNoteCommentRevisions.$inferInsert;

/**
 * Immutable content revisions actually supplied to a Quick Note Run.
 */
export const quickNoteRunInputs = pgTable(
  'quick_note_run_inputs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .references(() => quickNoteRuns.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').$type<QuickNoteRunInputRole>().notNull(),
    // Explicit document deletion also removes its run input; retention preserves pinned revisions.
    documentHistoryId: varchar('document_history_id', { length: 255 }).references(
      () => documentHistories.id,
      { onDelete: 'cascade' },
    ),
    commentRevisionId: uuid('comment_revision_id').references(() => quickNoteCommentRevisions.id, {
      onDelete: 'no action',
    }),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      'quick_note_run_inputs_exactly_one_revision_check',
      sql`num_nonnulls(${table.documentHistoryId}, ${table.commentRevisionId}) = 1`,
    ),
    uniqueIndex('quick_note_run_inputs_document_history_unique')
      .on(table.runId, table.role, table.documentHistoryId)
      .where(sql`${table.documentHistoryId} IS NOT NULL`),
    uniqueIndex('quick_note_run_inputs_comment_revision_unique')
      .on(table.runId, table.role, table.commentRevisionId)
      .where(sql`${table.commentRevisionId} IS NOT NULL`),
    index('quick_note_run_inputs_run_id_idx').on(table.runId),
    index('quick_note_run_inputs_document_history_id_idx').on(table.documentHistoryId),
    index('quick_note_run_inputs_comment_revision_id_idx').on(table.commentRevisionId),
    index('quick_note_run_inputs_user_id_idx').on(table.userId),
    index('quick_note_run_inputs_workspace_id_idx').on(table.workspaceId),
  ],
);

/** A persisted immutable input consumed by a Quick Note Run. */
export type QuickNoteRunInputItem = typeof quickNoteRunInputs.$inferSelect;

/** Values accepted when inserting a Quick Note Run input. */
export type NewQuickNoteRunInput = typeof quickNoteRunInputs.$inferInsert;

/**
 * Typed product resources associated with a particular source revision.
 */
export const quickNoteResources = pgTable(
  'quick_note_resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    quickNoteId: text('quick_note_id')
      .references(() => quickNotes.id, { onDelete: 'cascade' })
      .notNull(),
    sourceHistoryId: varchar('source_history_id', { length: 255 })
      .references(() => documentHistories.id, { onDelete: 'cascade' })
      .notNull(),
    /** Optional backing Document for Document/Page resources and generated Annotations. */
    documentId: varchar('document_id', { length: 255 }).references(() => documents.id, {
      onDelete: 'cascade',
    }),
    /** Stable identifier in the referenced product domain. */
    resourceId: text('resource_id').notNull(),
    /** Canonical product object family; intentionally independent from table-specific FKs. */
    resourceType: text('resource_type').$type<QuickNoteResourceType>().notNull(),
    /** Optional resource-native selection, such as a quoted Message range. */
    selector: jsonb('selector').$type<Record<string, unknown>>(),
    role: text('role').$type<QuickNoteResourceRole>().notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('quick_note_resources_identity_unique').on(
      table.quickNoteId,
      table.sourceHistoryId,
      table.resourceType,
      table.resourceId,
      table.role,
    ),
    uniqueIndex('quick_note_resources_annotation_unique')
      .on(table.quickNoteId, table.sourceHistoryId, table.role)
      .where(sql`${table.role} = 'annotation'`),
    index('quick_note_resources_quick_note_id_idx').on(table.quickNoteId),
    index('quick_note_resources_source_history_id_idx').on(table.sourceHistoryId),
    index('quick_note_resources_document_id_idx').on(table.documentId),
    index('quick_note_resources_resource_idx').on(table.resourceType, table.resourceId),
    index('quick_note_resources_user_id_idx').on(table.userId),
    index('quick_note_resources_workspace_id_idx').on(table.workspaceId),
  ],
);

/** A canonical resource linked to one Quick Note source revision. */
export type QuickNoteResourceItem = typeof quickNoteResources.$inferSelect;

/** Values accepted when linking a canonical Quick Note resource. */
export type NewQuickNoteResource = typeof quickNoteResources.$inferInsert;

/**
 * Append-only evidence that a Run created or updated a resource revision.
 */
export const quickNoteRunResources = pgTable(
  'quick_note_run_resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id')
      .references(() => quickNoteRuns.id, { onDelete: 'cascade' })
      .notNull(),
    resourceId: uuid('resource_id')
      .references(() => quickNoteResources.id, { onDelete: 'cascade' })
      .notNull(),
    documentHistoryId: varchar('document_history_id', { length: 255 }).references(
      () => documentHistories.id,
      { onDelete: 'set null' },
    ),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('quick_note_run_resources_identity_unique').on(table.runId, table.resourceId),
    index('quick_note_run_resources_run_id_idx').on(table.runId),
    index('quick_note_run_resources_resource_id_idx').on(table.resourceId),
    index('quick_note_run_resources_document_history_id_idx').on(table.documentHistoryId),
    index('quick_note_run_resources_user_id_idx').on(table.userId),
    index('quick_note_run_resources_workspace_id_idx').on(table.workspaceId),
  ],
);

/** A Run-to-resource output revision link. */
export type QuickNoteRunResourceItem = typeof quickNoteRunResources.$inferSelect;

/** Values accepted when linking a Run to a resource revision. */
export type NewQuickNoteRunResource = typeof quickNoteRunResources.$inferInsert;
