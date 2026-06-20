import type { ToulminVerdict, VerifyRubricConfig } from '@lobechat/types';
import {
  verifierTypes,
  verifyCheckResultStatuses,
  verifyEvidenceCapturedBy,
  verifyEvidenceTypes,
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
import { documents, files } from './file';
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

// ============================================
// 5. verify_evidence — first-class artifacts a check produces (screenshots, logs, …)
// ============================================
export const verifyEvidence = pgTable(
  'verify_evidence',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    /** Human-readable caption, e.g. "首页首屏完整渲染". */
    description: text('description'),

    /** The check result this evidence backs; evidence dies with its result. */
    checkResultId: uuid('check_result_id')
      .references(() => verifyCheckResults.id, { onDelete: 'cascade' })
      .notNull(),

    /** Medium of the artifact (screenshot / gif / video / text / dom_snapshot / transcript). */
    type: text('type', { enum: verifyEvidenceTypes }).notNull(),

    // ---- Payload: exactly one of `content` (inline text) or `fileId` (stored artifact) ----
    /** Inline payload for small text evidence (dom snapshot / console log / transcript). */
    content: text('content'),

    /**
     * Stored artifact (screenshot / gif / video, or large text persisted to storage).
     * FK to `files`, which already owns mime / size / hash / url — so this table keeps
     * none of that metadata. Set null if the underlying file is removed.
     */
    fileId: text('file_id').references(() => files.id, { onDelete: 'set null' }),

    // ---- Provenance ----
    /** Who / what produced this artifact. */
    capturedBy: text('captured_by', { enum: verifyEvidenceCapturedBy }),
    capturedAt: timestamptz('captured_at'),

    /** Redundant ownership column — required for list queries / access control. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Workspace this evidence belongs to — scopes listing and cascades on workspace delete. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('verify_evidence_check_result_id_idx').on(t.checkResultId),
    index('verify_evidence_file_id_idx').on(t.fileId),
    index('verify_evidence_user_id_idx').on(t.userId),
    index('verify_evidence_workspace_id_idx').on(t.workspaceId),
  ],
);

// ============================================
// 6. verify_reports — LLM-generated delivery-verification narrative for a run
// ============================================
export const verifyReports = pgTable(
  'verify_reports',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    /**
     * The Agent Run this report verifies, when bound to one — not required, so a
     * report isn't strongly coupled to an operation. The unique index still keeps
     * at most one report per operation (regenerating overwrites in place).
     */
    operationId: text('operation_id').references(() => agentOperations.id, {
      onDelete: 'cascade',
    }),

    /** Redundant ownership column — required for list queries / access control. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Workspace this report belongs to — scopes listing and cascades on workspace delete. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    // ---- Summary verdict ----
    verdict: text('verdict', { enum: verifyVerdicts }),
    overallConfidence: numeric('overall_confidence', { mode: 'number', precision: 3, scale: 2 }),

    // ---- Statistics snapshot ----
    totalChecks: integer('total_checks'),
    passedChecks: integer('passed_checks'),
    failedChecks: integer('failed_checks'),
    uncertainChecks: integer('uncertain_checks'),

    // ---- LLM-generated narrative (a produced artifact, not a computed one) ----
    /** Short 3-5 sentence summary, suitable for embedding in a chat message. */
    summary: text('summary'),
    /** Full Markdown report, shown in the expanded review view. */
    content: text('content'),

    /** Whether the user has acknowledged the report. */
    reviewedByUser: boolean('reviewed_by_user').default(false),

    /** Producer of this report, e.g. 'system' / a model id. */
    generatedBy: text('generated_by').default('system'),
    generatedAt: timestamptz('generated_at').notNull().defaultNow(),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // One report per Agent Run — regenerating overwrites the existing row in place.
    uniqueIndex('verify_reports_operation_id_unique').on(t.operationId),
    index('verify_reports_user_id_idx').on(t.userId),
    index('verify_reports_workspace_id_idx').on(t.workspaceId),
  ],
);
