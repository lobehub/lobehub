import type {
  QuickNoteAnalyzeTrigger,
  QuickNoteDelegatePreset,
  QuickNoteProposalDecisionStatus,
  QuickNoteProposalKind,
  QuickNoteProposalPayload,
  QuickNoteProposalValidity,
  QuickNoteResourceRole,
  QuickNoteResourceType,
  QuickNoteRunDecision,
  QuickNoteRunError,
  QuickNoteRunExecutionConfig,
  QuickNoteRunInputSnapshot,
  QuickNoteRunKind,
  QuickNoteRunStatus,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz } from './_helpers';
import { agents } from './agent';
import { agentOperations } from './agentOperations';
import { documentHistories } from './documentHistory';
import { documents } from './file';
import { topics } from './topic';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Quick Note captures and their stable backing Document.
 *
 * Content lives in `documents`; this table owns Quick Note organization. Agent conversations live
 * in the Topics their Runs' operations create, recorded on `quick_note_runs.topic_id`.
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
    tags: text('tags').array().default([]).notNull(),
    collection: text('collection'),
    location: text('location'),
    analyzeDueAt: timestamptz('analyze_due_at'),
    /**
     * When to ask whether the latest real edit changed the note's meaning. Every real edit pushes
     * it back by the idle delay (debounce); the sweep clears it when it runs the check.
     */
    contentCheckDueAt: timestamptz('content_check_due_at'),
    ...timestamps,
  },
  (table) => [
    // One note per backing Document; also serves the documents-delete cascade.
    uniqueIndex('quick_notes_document_id_unique').on(table.documentId),
    // Owner filter on every note read; also serves the users-delete cascade.
    index('quick_notes_user_id_idx').on(table.userId),
    // Workspace-scoped note reads; also serves the workspaces-delete cascade.
    index('quick_notes_workspace_id_idx').on(table.workspaceId),
    // Range scan and ordering for the periodic due-Analyze sweep.
    index('quick_notes_analyze_due_at_idx').on(table.analyzeDueAt),
    // Range scan and ordering for the periodic meaning-change check sweep.
    index('quick_notes_content_check_due_at_idx').on(table.contentCheckDueAt),
  ],
);

/** A persisted Quick Note capture. */
export type QuickNoteItem = typeof quickNotes.$inferSelect;

/** Values accepted when inserting a Quick Note capture. */
export type NewQuickNote = typeof quickNotes.$inferInsert;

/**
 * Immutable processing attempts over one pinned Quick Note Document History.
 *
 * The Run stores the rendered text it consumed (`input_snapshot`), its intent judgement
 * (`decision`), and its AI overview (`summary`) directly.
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
    /** Topic created by the Run's agent operation. */
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    operationId: text('operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    executionConfig: jsonb('execution_config').$type<QuickNoteRunExecutionConfig>(),
    kind: text('kind').$type<QuickNoteRunKind>().notNull(),
    trigger: text('trigger').$type<QuickNoteAnalyzeTrigger>(),
    status: text('status').$type<QuickNoteRunStatus>().default('pending').notNull(),
    error: jsonb('error').$type<QuickNoteRunError>(),
    /** Rendered source, comments, and pending Proposals as seen when the Run was claimed. */
    inputSnapshot: jsonb('input_snapshot').$type<QuickNoteRunInputSnapshot>(),
    /** Intent judgement produced by an Analyze Run. */
    decision: jsonb('decision').$type<QuickNoteRunDecision>(),
    /** AI overview of the note; the latest completed Run's summary is shown. */
    summary: text('summary'),
    startedAt: timestamptz('started_at'),
    /** Set when the Run reaches any terminal status (completed, failed, canceled or superseded). */
    completedAt: timestamptz('completed_at'),
    ...timestamps,
  },
  (table) => [
    // Lists all Runs of a note (the active-kind index is partial); serves the quick_notes cascade.
    index('quick_note_runs_quick_note_id_idx').on(table.quickNoteId),
    // Pinned-revision probe in history retention; serves the document_histories cascade.
    index('quick_note_runs_source_history_id_idx').on(table.sourceHistoryId),
    // Collects Run Topics on note delete; also serves the topics-delete set-null.
    index('quick_note_runs_topic_id_idx').on(table.topicId),
    // FK only: agents-delete set-null.
    index('quick_note_runs_agent_id_idx').on(table.agentId),
    // At most one Run per agent operation; also serves the agent_operations set-null.
    uniqueIndex('quick_note_runs_operation_id_unique').on(table.operationId),
    // One active Run per note and kind; conflict target when claiming a Run.
    uniqueIndex('quick_note_runs_active_kind_unique')
      .on(table.quickNoteId, table.kind)
      .where(sql`${table.status} IN ('pending', 'running')`),
  ],
);

/** A persisted immutable Quick Note processing attempt. */
export type QuickNoteRunItem = typeof quickNoteRuns.$inferSelect;

/** Values accepted when inserting a Quick Note processing attempt. */
export type NewQuickNoteRun = typeof quickNoteRuns.$inferInsert;

/**
 * Suggested downstream actions whose full arguments are stored as an editable payload.
 */
export const quickNoteProposals = pgTable(
  'quick_note_proposals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    quickNoteId: text('quick_note_id')
      .references(() => quickNotes.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .references(() => quickNoteRuns.id, { onDelete: 'cascade' })
      .notNull(),
    sourceHistoryId: varchar('source_history_id', { length: 255 })
      .references(() => documentHistories.id, { onDelete: 'cascade' })
      .notNull(),
    kind: text('kind').$type<QuickNoteProposalKind>().notNull(),
    /** Built-in `delegate` preset that produced the Proposal, when any. */
    preset: text('preset').$type<QuickNoteDelegatePreset>(),
    /** Full arguments of the target action; user edits overwrite it. */
    payload: jsonb('payload').$type<QuickNoteProposalPayload>().notNull(),
    /** The AI draft of `payload`, kept for diffing against user edits. */
    originalPayload: jsonb('original_payload').$type<QuickNoteProposalPayload>().notNull(),
    decisionStatus: text('decision_status')
      .$type<QuickNoteProposalDecisionStatus>()
      .default('pending')
      .notNull(),
    validity: text('validity').$type<QuickNoteProposalValidity>().default('current').notNull(),
    /** When the user accepted or dismissed the Proposal. */
    decidedAt: timestamptz('decided_at'),
    /** Optional user-supplied reason for a dismissal. */
    dismissReason: text('dismiss_reason'),
    /** Product object family produced by applying the Proposal, such as `task`. */
    resultType: text('result_type'),
    /** Identifier of the product object produced by applying the Proposal. */
    resultId: text('result_id'),
    ...timestamps,
  },
  (table) => [
    // FK only: quick_note_runs cascade.
    index('quick_note_proposals_run_id_idx').on(table.runId),
    // Pinned-revision probe in history retention; serves the document_histories cascade.
    index('quick_note_proposals_source_history_id_idx').on(table.sourceHistoryId),
    // Pending/current Proposal scans per note; the leading column also covers per-note
    // lookups and the quick_notes cascade.
    index('quick_note_proposals_decision_validity_idx').on(
      table.quickNoteId,
      table.decisionStatus,
      table.validity,
    ),
    // FK only: users / workspaces cascade (reads scope through quick_notes).
    index('quick_note_proposals_user_id_idx').on(table.userId),
    index('quick_note_proposals_workspace_id_idx').on(table.workspaceId),
  ],
);

/** A persisted Quick Note Proposal. */
export type QuickNoteProposalItem = typeof quickNoteProposals.$inferSelect;

/** Values accepted when inserting a Quick Note Proposal. */
export type NewQuickNoteProposal = typeof quickNoteProposals.$inferInsert;

/**
 * Lightweight user/agent feedback attached to a Quick Note.
 *
 * Comments keep no history: an edit overwrites the content, and Runs keep the text they saw in
 * their own `input_snapshot`.
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
    // Lists a note's Comments; also serves the quick_notes cascade.
    index('quick_note_comments_quick_note_id_idx').on(table.quickNoteId),
    // FK only: users / workspaces cascade and author set-null (reads scope through quick_notes).
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
 * Typed product resources associated with a particular source revision.
 */
export const quickNoteResources = pgTable(
  'quick_note_resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    quickNoteId: text('quick_note_id')
      .references(() => quickNotes.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    sourceHistoryId: varchar('source_history_id', { length: 255 })
      .references(() => documentHistories.id, { onDelete: 'cascade' })
      .notNull(),
    /** Run that linked the resource; null for user-supplied links such as create-time resources. */
    runId: uuid('run_id').references(() => quickNoteRuns.id, { onDelete: 'set null' }),
    /** Backing Document for Document/Page resources, so deleting it drops the link. */
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
    ...timestamps,
  },
  (table) => [
    // Deduplicates resource links (upsert conflict target); the leading column also covers
    // per-note lookups and the quick_notes cascade.
    uniqueIndex('quick_note_resources_identity_unique').on(
      table.quickNoteId,
      table.sourceHistoryId,
      table.resourceType,
      table.resourceId,
      table.role,
    ),
    // Pinned-revision probe in history retention; serves the document_histories cascade.
    index('quick_note_resources_source_history_id_idx').on(table.sourceHistoryId),
    // Lists what a Run linked; also serves the quick_note_runs set-null.
    index('quick_note_resources_run_id_idx').on(table.runId),
    // FK only: documents-delete cascade.
    index('quick_note_resources_document_id_idx').on(table.documentId),
    // FK only: users / workspaces cascade (reads scope through quick_notes).
    index('quick_note_resources_user_id_idx').on(table.userId),
    index('quick_note_resources_workspace_id_idx').on(table.workspaceId),
  ],
);

/** A canonical resource linked to one Quick Note source revision. */
export type QuickNoteResourceItem = typeof quickNoteResources.$inferSelect;

/** Values accepted when linking a canonical Quick Note resource. */
export type NewQuickNoteResource = typeof quickNoteResources.$inferInsert;
