import {
  acceptanceStatuses,
  acceptanceSubjectTypes,
  verifierTypes,
  verifyCheckResultStatuses,
  verifyEvidenceCapturedBy,
  verifyEvidenceTypes,
  verifyOnFailStrategies,
  verifyRunSources,
  verifyRunStatuses,
  verifyUserDecisions,
  verifyVerdicts,
} from '@lobechat/const/verify';
import type {
  AcceptanceConfig,
  AcceptanceMetadata,
  AcceptanceVisualRender,
  ToulminVerdict,
  VerifyCheckItem,
  VerifyRubricConfig,
  VerifyRunContext,
  VerifyRunDecisionDetail,
  VerifyRunMetadata,
  VerifyRunScenario,
} from '@lobechat/types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
     * The verification round this result belongs to (the grouping key). The
     * plan snapshot lives on verify_runs.plan; results relate to its items via
     * check_item_id. Nullable as an additive column; the verify pipeline always
     * sets it.
     */
    verifyRunId: uuid('verify_run_id').references(() => verifyRuns.id, { onDelete: 'cascade' }),

    /**
     * Denormalized direct link to the Agent Run, retained for the agent pipeline;
     * null for standalone rounds. The canonical run link is `verify_runs`
     * (addressed via verifyRunId) — this is convenience only, hence `set null`.
     */
    operationId: text('operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),

    /** Redundant ownership column — required for list queries / access control. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Workspace this result belongs to (mirrors the run) — scopes listing + cascade. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Stable relation key → verify_runs.plan.items[].id (never the array index). */
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

    /** Generic result extension bag. Shape is intentionally unknown until verifier payloads stabilize. */
    metadata: jsonb('metadata').$type<unknown>(),

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
    index('verify_check_results_verify_run_id_idx').on(t.verifyRunId),
    index('verify_check_results_operation_id_idx').on(t.operationId),
    index('verify_check_results_user_id_idx').on(t.userId),
    // One lifecycle result row per plan item per run: check_item_id is the stable
    // key into verify_runs.plan, so a retry / concurrent worker must not insert a
    // second row for the same (run, item). Doubles as the lookup index for
    // updateByCheckItem(verifyRunId, checkItemId).
    uniqueIndex('verify_check_results_verify_run_id_check_item_id_unique').on(
      t.verifyRunId,
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

    /** Generic evidence extension bag. Shape is intentionally unknown until the capturers stabilize it. */
    metadata: jsonb('metadata').$type<unknown>(),

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
// 6. acceptances — business-level aggregate for one subject's acceptance lifecycle
// ============================================
export const acceptances = pgTable(
  'acceptances',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    /** Redundant ownership column — required for list queries / access control. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Workspace this acceptance belongs to — scopes listing and cascades on workspace delete. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /**
     * Polymorphic accepted object. No FK on purpose: an acceptance may target task,
     * topic, document, or future subject types without reshaping this aggregate.
     * Subject existence/ownership is validated in the service that creates it.
     */
    subjectType: text('subject_type', { enum: acceptanceSubjectTypes }).notNull(),
    subjectId: text('subject_id').notNull(),

    /** User-facing acceptance lifecycle state. */
    status: text('status', { enum: acceptanceStatuses }).default('pending').notNull(),

    /** One-sentence acceptance requirement the user configured for this subject. */
    requirement: text('requirement'),

    /** Policy/config snapshot used when instantiating verify rounds for this acceptance. */
    config: jsonb('config').$type<AcceptanceConfig>().default({}),

    // No root/current/latest-report pointers: all three are derivable from the
    // round chain via the verify_runs (acceptance_id, round_index) unique index —
    // root = min round, current = max round, latest report = report of the
    // highest round that has one. A denormalized pointer would only add a
    // write-time sync burden and a staleness bug surface for no read win at this
    // (per-user, bounded) list scale.

    /**
     * AI-filled visualization for the acceptance report. The html payload is
     * model-produced: viewers MUST render it in a sandboxed iframe, never
     * inject it into the host document.
     */
    visualRender: jsonb('visual_render').$type<AcceptanceVisualRender>(),

    /** Generic aggregate extension bag for future subject-specific state. */
    metadata: jsonb('metadata').$type<AcceptanceMetadata>(),

    completedAt: timestamptz('completed_at'),
    ...timestamps,
  },
  (t) => [
    index('acceptances_user_id_idx').on(t.userId),
    index('acceptances_workspace_id_idx').on(t.workspaceId),
    index('acceptances_subject_idx').on(t.subjectType, t.subjectId),
    index('acceptances_status_idx').on(t.status),
    // One acceptance per subject in personal scope.
    uniqueIndex('acceptances_personal_subject_unique')
      .on(t.userId, t.subjectType, t.subjectId)
      .where(sql`${t.workspaceId} IS NULL`),
    // One acceptance per subject in workspace scope.
    uniqueIndex('acceptances_workspace_subject_unique')
      .on(t.workspaceId, t.subjectType, t.subjectId)
      .where(sql`${t.workspaceId} IS NOT NULL`),
  ],
);

export type NewAcceptance = typeof acceptances.$inferInsert;
export type AcceptanceItem = typeof acceptances.$inferSelect;

// ============================================
// 7. verify_reports — LLM-generated delivery-verification narrative for a run
// ============================================
export const verifyReports = pgTable(
  'verify_reports',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    /**
     * The verification round this report summarizes (the grouping key). One
     * report per run (regenerating overwrites in place via the unique index).
     * Nullable as an additive column; the report writer always sets it.
     */
    verifyRunId: uuid('verify_run_id').references(() => verifyRuns.id, { onDelete: 'cascade' }),

    /**
     * Denormalized direct link to the Agent Run, retained for the agent pipeline;
     * null for standalone rounds. Canonical run link is `verify_runs` — this is
     * convenience only, hence `set null`.
     */
    operationId: text('operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
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
    // One report per verification round — regenerating overwrites in place.
    uniqueIndex('verify_reports_verify_run_id_unique').on(t.verifyRunId),
    index('verify_reports_operation_id_idx').on(t.operationId),
    index('verify_reports_user_id_idx').on(t.userId),
    index('verify_reports_workspace_id_idx').on(t.workspaceId),
  ],
);

// ============================================
// 8. verify_runs — a verification round / attempt (the run-anchor that decouples
//     the chain from agent_operations)
// ============================================
// The verify chain used to hang off agent_operations: the plan lived on
// `agent_operations.verify_plan` and results/reports keyed on `operation_id`.
// That forced every verification — including standalone ones (e.g. the
// agent-testing harness ingesting results) — to mint a fake Agent Run, polluting
// the operation analytics with rows that carry no real execution trace.
//
// `verify_runs` is the round/attempt entity instead: it owns the plan snapshot +
// the rollup status and is what check results / evidence anchor to. A business
// acceptance can aggregate several verify runs across repair iterations; the link
// to a real Agent Run is still an OPTIONAL FK (`operation_id`) — set when verifying
// an agent run, null for standalone rounds.
export const verifyRuns = pgTable(
  'verify_runs',
  {
    id: uuid('id').defaultRandom().primaryKey().notNull(),

    /** Redundant ownership column — required for list queries / access control. */
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Workspace this round belongs to — scopes listing and cascades on workspace delete. */
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /**
     * Optional business-level acceptance aggregate this verify round belongs to.
     * Null keeps standalone rounds (e.g. agent-testing) and legacy rows valid.
     */
    acceptanceId: uuid('acceptance_id').references(() => acceptances.id, {
      onDelete: 'set null',
    }),

    /** Display / ordering index of this round inside an acceptance chain. */
    roundIndex: integer('round_index'),

    /**
     * Optional link to the Agent Run this round verifies. Null for standalone
     * rounds (e.g. agent-testing). `set null` so deleting the run keeps the
     * verification round and its results/report alive.
     */
    operationId: text('operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),

    /** What produced this round — drives provenance + analytics filtering. */
    source: text('source', { enum: verifyRunSources }).default('agent').notNull(),

    /**
     * What kind of thing this round verifies (e.g. `coding`). Drives how the
     * report renders its scope header + scenario-specific detail. Null for
     * legacy/agent runs that predate scenarios.
     */
    scenario: text('scenario').$type<VerifyRunScenario>(),

    /** Human-readable round title (report title / test name). */
    title: text('title'),
    /** The delivery goal being verified. */
    goal: text('goal'),

    /**
     * The scenario's context — its scope/provenance (shape keyed by `scenario`;
     * for `coding`: branch / commit / surfaces / …), rendered as the report's
     * scope header. One bag so each scenario can enrich it without a migration.
     */
    context: jsonb('context').$type<VerifyRunContext>(),

    /**
     * Generic, scenario-agnostic extension bag — reserved for cross-scenario
     * metadata we don't model yet (the active scenario's input lives in
     * `context`). Kept open so future needs don't require a migration.
     */
    metadata: jsonb('metadata').$type<VerifyRunMetadata>(),

    /**
     * Immutable check-plan snapshot for this round (instantiated from rubrics /
     * criteria / agent-generated / ingested). Results relate to its items via
     * check_item_id. Moved here off `agent_operations.verify_plan`.
     */
    plan: jsonb('plan').$type<VerifyCheckItem[]>(),
    /** When the plan was confirmed (frozen). */
    planConfirmedAt: timestamptz('plan_confirmed_at'),

    /** Denormalized rollup of the round's verify pipeline state. */
    status: text('status', { enum: verifyRunStatuses }),

    /**
     * The user's acceptance decision on THIS round — the human verdict that
     * drives the acceptance loop (`accept` closes it, `reject` seeds the next
     * repair round). Per-round because every delivered round can be judged
     * again, so the trail lives here, not on a single aggregate pointer.
     *
     * Free-form text, not an enum column: the decision vocabulary is expected to
     * grow (e.g. `accept-with-reservation`) and we don't want a migration for a
     * new verb. Null until the user decides.
     */
    userDecision: text('user_decision'),

    /**
     * Provenance of that decision — comment, attachments, who and when. One bag
     * so the decision can carry richer evidence without new columns; the
     * `userDecision` verb stays the queryable field.
     */
    decisionDetail: jsonb('decision_detail').$type<VerifyRunDecisionDetail>(),

    ...timestamps,
  },
  (t) => [
    index('verify_runs_user_id_idx').on(t.userId),
    index('verify_runs_workspace_id_idx').on(t.workspaceId),
    index('verify_runs_acceptance_id_idx').on(t.acceptanceId),
    uniqueIndex('verify_runs_acceptance_round_unique').on(t.acceptanceId, t.roundIndex),
    // A run linked to an acceptance MUST carry a round index. Without this, the
    // unique index above cannot order the chain: Postgres treats NULLs as
    // distinct, so several null-round rows could pile onto one acceptance. Both
    // columns stay nullable for standalone/legacy runs (neither set).
    check(
      'verify_runs_acceptance_requires_round',
      sql`${t.acceptanceId} IS NULL OR ${t.roundIndex} IS NOT NULL`,
    ),
    // At most one verification round per Agent Run; NULLs are distinct in a
    // unique index, so standalone (operation-less) rounds stay unconstrained.
    uniqueIndex('verify_runs_operation_id_unique').on(t.operationId),
    index('verify_runs_source_idx').on(t.source),
    index('verify_runs_user_decision_idx').on(t.userDecision),
  ],
);

export type NewVerifyRun = typeof verifyRuns.$inferInsert;
export type VerifyRunItem = typeof verifyRuns.$inferSelect;
