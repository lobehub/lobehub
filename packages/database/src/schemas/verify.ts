import type { ToulminVerdict, VerifyRubricConfig } from '@lobechat/types';
import {
  verifierTypes,
  verifyCheckResultStatuses,
  verifyOnFailStrategies,
  verifyUserDecisions,
  verifyVerdicts,
} from '@lobechat/types';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { createdAt, timestamps, timestamptz } from './_helpers';
import { agentOperations } from './agentOperations';
import { documents } from './file';
import { llmGenerationTracing } from './llmGenerationTracing';
import { users } from './user';
import { workspaces } from './workspace';

// The verify domain vocabulary, frozen-item shape, Toulmin narrative and rubric
// run-policy config live in `@lobechat/types` (the single source of truth across
// schema / services / store / UI). This file owns only the tables and their
// inferred row types.

// ============================================
// 1. verify_criteria — reusable single pass/fail standard (the atomic unit)
// ============================================
export const verifyCriteria = pgTable(
  'verify_criteria',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    title: text('title').notNull(),

    /** One-sentence summary of what this criterion verifies. */
    description: text('description'),

    /** Default blocking behaviour; a snapshot item may override it. */
    required: boolean('required').default(true).notNull(),

    verifierType: text('verifier_type', { enum: verifierTypes }).notNull(),

    /** Default verifier parameters used when instantiating a snapshot item. */
    verifierConfig: jsonb('verifier_config').$type<Record<string, unknown>>().default({}),

    /** Default action when this criterion fails. */
    onFail: text('on_fail', { enum: verifyOnFailStrategies }).default('manual').notNull(),

    /**
     * The detailed judging instruction / rule body lives in a document; its edit /
     * iteration history reuses document_history, so no version / is_latest columns
     * are needed here.
     */
    documentId: varchar('document_id', { length: 255 }).references(() => documents.id, {
      onDelete: 'set null',
    }),

    /** Workspace this criterion belongs to — scopes listing/reuse and cascades on workspace delete. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    ...timestamps,
  },
  (t) => [
    index('verify_criteria_user_id_idx').on(t.userId),
    index('verify_criteria_verifier_type_idx').on(t.verifierType),
    index('verify_criteria_document_id_idx').on(t.documentId),
    index('verify_criteria_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewVerifyCriterion = typeof verifyCriteria.$inferInsert;
export type VerifyCriterionItem = typeof verifyCriteria.$inferSelect;

// ============================================
// 2. verify_rubrics — named group aggregating criteria (the reusable, mountable unit)
// ============================================
export const verifyRubrics = pgTable(
  'verify_rubrics',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    title: text('title').notNull(),
    description: text('description'),

    /** Run-policy knobs applied to every run that mounts this rubric (e.g. maxRepairRounds). */
    config: jsonb('config').$type<VerifyRubricConfig>().default({}),

    /** Workspace this rubric belongs to — scopes listing/reuse and cascades on workspace delete. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    ...timestamps,
  },
  (t) => [
    index('verify_rubrics_user_id_idx').on(t.userId),
    index('verify_rubrics_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewVerifyRubric = typeof verifyRubrics.$inferInsert;
export type VerifyRubricItem = typeof verifyRubrics.$inferSelect;

// ============================================
// 3. verify_rubric_criteria — which criteria a rubric aggregates (criteria reusable across rubrics)
// ============================================
export const verifyRubricCriteria = pgTable(
  'verify_rubric_criteria',
  {
    rubricId: uuid('rubric_id')
      .references(() => verifyRubrics.id, { onDelete: 'cascade' })
      .notNull(),

    criterionId: uuid('criterion_id')
      .references(() => verifyCriteria.id, { onDelete: 'cascade' })
      .notNull(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Workspace this link belongs to — mirrors the redundant user_id for scoped cascade. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Display ordering of the criterion within the rubric. */
    sortOrder: integer('sort_order'),

    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.rubricId, t.criterionId] }),
    index('verify_rubric_criteria_criterion_id_idx').on(t.criterionId),
    index('verify_rubric_criteria_user_id_idx').on(t.userId),
    index('verify_rubric_criteria_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewVerifyRubricCriterion = typeof verifyRubricCriteria.$inferInsert;
export type VerifyRubricCriterionItem = typeof verifyRubricCriteria.$inferSelect;

// ============================================
// 4. verify_check_results — execution result of each check item
// ============================================
export const verifyCheckResults = pgTable(
  'verify_check_results',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    /**
     * The Agent Run this result belongs to. The plan snapshot lives on
     * agent_operations.verify_plan; results relate to it via check_item_id.
     */
    operationId: text('operation_id')
      .references(() => agentOperations.id, { onDelete: 'cascade' })
      .notNull(),

    /** Redundant ownership column — required for list queries / access control. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Workspace this result belongs to (mirrors the run's operation) — scopes listing + cascade. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Stable relation key → agent_operations.verify_plan.items[].id (never the array index). */
    checkItemId: text('check_item_id').notNull(),

    // ---- Flattened item snapshot (denormalized for analytics) ----
    checkItemTitle: text('check_item_title'),
    required: boolean('required').default(true).notNull(),
    /** Display ordering only. */
    checkItemIndex: integer('check_item_index'),

    // ---- Verifier snapshot (Toulmin Backing anchor) ----
    verifierType: text('verifier_type', { enum: verifierTypes }).notNull(),
    verifierConfigHash: text('verifier_config_hash'),

    /** Agent verifier → sub agent_operations (via parent_operation_id chain). */
    verifierOperationId: text('verifier_operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),
    /** LLM verifier → tracing row. N:1 — a batch generateObject shares one tracing id. */
    verifierTracingId: uuid('verifier_tracing_id').references(() => llmGenerationTracing.id, {
      onDelete: 'set null',
    }),

    status: text('status', { enum: verifyCheckResultStatuses }).default('pending').notNull(),

    // ---- Toulmin model ----
    /** Claim → drives the state machine / FP-FN / aggregation. */
    verdict: text('verdict', { enum: verifyVerdicts }),
    /** Qualifier → 0-1 confidence. */
    confidence: numeric('confidence', { mode: 'number', precision: 3, scale: 2 }),
    /** Data / Warrant / Rebuttal narrative — read as a whole. */
    toulmin: jsonb('toulmin').$type<ToulminVerdict>(),

    /** Forward-looking remediation hint, seeded into auto_repair. */
    suggestion: text('suggestion'),

    // ---- Data flywheel ----
    userDecision: text('user_decision', { enum: verifyUserDecisions }),
    isFalsePositive: boolean('is_false_positive'),
    isFalseNegative: boolean('is_false_negative'),

    /** Auto-repair → new agent_operations (parent chain). */
    repairOperationId: text('repair_operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),

    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('verify_check_results_operation_id_idx').on(t.operationId),
    index('verify_check_results_user_id_idx').on(t.userId),
    // One lifecycle result row per plan item per run: check_item_id is the stable
    // key into agent_operations.verify_plan, so a retry / concurrent worker must
    // not insert a second row for the same (operation, item). Doubles as the
    // lookup index for updateByCheckItem(operationId, checkItemId).
    uniqueIndex('verify_check_results_operation_id_check_item_id_unique').on(
      t.operationId,
      t.checkItemId,
    ),
    index('verify_check_results_verifier_type_idx').on(t.verifierType),
    index('verify_check_results_verifier_operation_id_idx').on(t.verifierOperationId),
    index('verify_check_results_verifier_tracing_id_idx').on(t.verifierTracingId),
    index('verify_check_results_status_idx').on(t.status),
    index('verify_check_results_verdict_idx').on(t.verdict),
    index('verify_check_results_repair_operation_id_idx').on(t.repairOperationId),
    index('verify_check_results_workspace_id_idx').on(t.workspaceId),
  ],
);

export type NewVerifyCheckResult = typeof verifyCheckResults.$inferInsert;
export type VerifyCheckResultItem = typeof verifyCheckResults.$inferSelect;
