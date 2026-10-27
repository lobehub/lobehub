import type {
  DocumentReviewCheckStatus,
  DocumentReviewCheckSuggestion,
  DocumentReviewImpactCategory,
  DocumentReviewImpactKind,
  DocumentReviewImpactSeverity,
  DocumentReviewImpactStatus,
  DocumentReviewRuleSetStatus,
  DocumentReviewRuleSeverity,
  DocumentReviewSessionStatus,
  DocumentReviewTextAnchor,
} from '@lobechat/types';
import { index, integer, jsonb, pgTable, real, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz } from './_helpers';
import { documents } from './file';
import { users } from './user';
import { workspaces } from './workspace';

/**
 * Document review (change-impact analysis + rule check list). Every row is
 * scoped to one workspace document; all access is authorized against that
 * document, never against the review rows themselves.
 */

/** One review pass over a document revision. Owns its impacts and check results. */
export const documentReviewSessions = pgTable(
  'document_review_sessions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('documentReviewSessions'))
      .notNull(),
    documentId: text('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    /** Kept nullable so a review survives its creator's account deletion. */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** The rule set checked in this session; nulled if the set is deleted. */
    ruleSetId: text('rule_set_id').references(() => documentReviewRuleSets.id, {
      onDelete: 'set null',
    }),
    title: text('title'),
    status: text('status').$type<DocumentReviewSessionStatus>().default('active').notNull(),
    /** Document history snapshot the revision is compared against, when known. */
    baseHistoryId: text('base_history_id'),
    ...timestamps,
  },
  (t) => [
    index('document_review_sessions_document_id_created_at_idx').on(t.documentId, t.createdAt),
    index('document_review_sessions_workspace_id_idx').on(t.workspaceId),
    index('document_review_sessions_rule_set_id_idx').on(t.ruleSetId),
    index('document_review_sessions_user_id_idx').on(t.userId),
  ],
);

/** A definition / reference / clause / obligation possibly affected by the revision. */
export const documentReviewImpacts = pgTable(
  'document_review_impacts',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    sessionId: text('session_id')
      .references(() => documentReviewSessions.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    kind: text('kind').$type<DocumentReviewImpactKind>().notNull(),
    /** `textual` = direct wording diff; `semantic` = potential meaning impact. */
    category: text('category').$type<DocumentReviewImpactCategory>().notNull(),
    severity: text('severity').$type<DocumentReviewImpactSeverity>().default('medium').notNull(),
    status: text('status').$type<DocumentReviewImpactStatus>().default('open').notNull(),
    title: text('title').notNull(),
    /** The change that triggers this impact, in the reviewer's words. */
    trigger: text('trigger'),
    /** Judgement basis shown to the reviewer. */
    reason: text('reason').notNull(),
    /** Model confidence (0..1) that the element is affected. */
    confidence: real('confidence'),
    sourceAnchor: jsonb('source_anchor').$type<DocumentReviewTextAnchor>(),
    relatedAnchor: jsonb('related_anchor').$type<DocumentReviewTextAnchor>(),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => [
    index('document_review_impacts_session_id_sort_order_idx').on(t.sessionId, t.sortOrder),
    index('document_review_impacts_workspace_id_idx').on(t.workspaceId),
  ],
);

/** User-defined or user-confirmed review rules (a playbook) for one document. */
export const documentReviewRuleSets = pgTable(
  'document_review_rule_sets',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('documentReviewRuleSets'))
      .notNull(),
    documentId: text('document_id')
      .references(() => documents.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').$type<DocumentReviewRuleSetStatus>().default('draft').notNull(),
    confirmedAt: timestamptz('confirmed_at'),
    confirmedByUserId: text('confirmed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => [
    index('document_review_rule_sets_document_id_idx').on(t.documentId),
    index('document_review_rule_sets_workspace_id_idx').on(t.workspaceId),
    index('document_review_rule_sets_user_id_idx').on(t.userId),
    index('document_review_rule_sets_confirmed_by_user_id_idx').on(t.confirmedByUserId),
  ],
);

export const documentReviewRules = pgTable(
  'document_review_rules',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    ruleSetId: text('rule_set_id')
      .references(() => documentReviewRuleSets.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    title: text('title').notNull(),
    instruction: text('instruction').notNull(),
    severity: text('severity').$type<DocumentReviewRuleSeverity>().default('medium').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => [
    index('document_review_rules_rule_set_id_sort_order_idx').on(t.ruleSetId, t.sortOrder),
    index('document_review_rules_workspace_id_idx').on(t.workspaceId),
  ],
);

/**
 * The checklist entry for one rule in one session. `status` is only ever
 * written through the server-side transition resolver; see
 * `resolveDocumentReviewCheckTransition` in `@lobechat/types`.
 */
export const documentReviewCheckResults = pgTable(
  'document_review_check_results',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),
    sessionId: text('session_id')
      .references(() => documentReviewSessions.id, { onDelete: 'cascade' })
      .notNull(),
    ruleId: uuid('rule_id')
      .references(() => documentReviewRules.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    status: text('status').$type<DocumentReviewCheckStatus>().default('unchecked').notNull(),
    /** Why the agent reached this outcome. */
    explanation: text('explanation'),
    /** Original-text evidence quotes supporting the outcome. */
    evidence: jsonb('evidence').$type<DocumentReviewTextAnchor[]>(),
    /** Proposed fix for a failed / uncertain rule; user-editable before applying. */
    suggestion: jsonb('suggestion').$type<DocumentReviewCheckSuggestion>(),
    checkedAt: timestamptz('checked_at'),
    appliedAt: timestamptz('applied_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('document_review_check_results_session_id_rule_id_unique').on(
      t.sessionId,
      t.ruleId,
    ),
    index('document_review_check_results_rule_id_idx').on(t.ruleId),
    index('document_review_check_results_workspace_id_idx').on(t.workspaceId),
  ],
);

export type DocumentReviewSessionItem = typeof documentReviewSessions.$inferSelect;
export type NewDocumentReviewSession = typeof documentReviewSessions.$inferInsert;
export type DocumentReviewImpactItem = typeof documentReviewImpacts.$inferSelect;
export type NewDocumentReviewImpact = typeof documentReviewImpacts.$inferInsert;
export type DocumentReviewRuleSetItem = typeof documentReviewRuleSets.$inferSelect;
export type DocumentReviewRuleItem = typeof documentReviewRules.$inferSelect;
export type DocumentReviewCheckResultItem = typeof documentReviewCheckResults.$inferSelect;
