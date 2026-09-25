import type {
  ExpertiseAnchorCandidate,
  ExpertiseBacktestResult,
  ExpertiseCanonEntry,
  ExpertiseEvidenceSpecItem,
  ExpertiseInsightEvidenceRef,
  ExpertiseLayerDefinition,
  ExpertiseLessonSection,
  ExpertiseReasonKind,
  ExpertiseReasonSource,
  ExpertiseRevisionEvidence,
} from '@lobechat/types';
import { isNotNull, isNull, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, timestamptz, varchar255 } from './_helpers';
import { agents } from './agent';
import { agentOperations } from './agentOperations';
import { documents } from './file';
import { projects } from './project';
import { users } from './user';
import { verifyCheckResults, verifyCriteria, verifyEvidence } from './verify';
import { workspaces } from './workspace';

/**
 * Expertise — the data layer of the SCLPT self-improvement system.
 *
 * Its relationship to verify is **compilation**, not the same layer:
 *   lesson (human-readable know-how, injected as context) ──matures into something programmable──▶ verify criterion (machine-runnable)
 * So lessons live in their own table and, once mature, compile one-way into a criterion and backfill
 * compiledCriterionId. Lessons at the mental-model layer never compile — that is exactly the part a
 * human expert cannot be replaced on.
 *
 * Table responsibilities:
 *   domains    the expertise itself + the non-P parts of SCLPT (filter / layers / canon / flow / evidence spec)
 *   bindings   mounts onto an agent / project / workspace / user
 *   lessons    P — lessons, with a four-part structured body
 *   revisions  version chain of conversational rewrites
 *   runs       one practice; its boundary reuses the reflection time window
 *   hits       "which lessons were applied this time" — the foundation of the whole L2 view
 *   snapshots  time-series snapshot after each practice; feeds every curve and the maturity score
 *   insights   meta-patterns only visible across many practices, produced by a scheduled analysis job
 */

export const EXPERTISE_DOMAIN_SOURCES = ['market', 'user'] as const;
export const EXPERTISE_LAYER_SOURCES = ['canonical', 'invented'] as const;
export const EXPERTISE_SEED_STATES = ['seeding', 'seeded'] as const;
export const EXPERTISE_CONTRIBUTION_MODES = ['read-only', 'contribute', 'derive'] as const;
export const EXPERTISE_LESSON_POLARITIES = ['bad', 'good', 'rule'] as const;
export const EXPERTISE_LESSON_STATUSES = ['active', 'rejected', 'retired'] as const;
export const EXPERTISE_COMPILABILITIES = ['compiled', 'compilable', 'not-compilable'] as const;
export const EXPERTISE_ACTOR_TYPES = ['agent', 'user', 'system'] as const;
/**
 * Mirrors `acceptanceSubjectTypes`: a practice run records the object it judged, and an
 * acceptance-driven run inherits that acceptance's own subject rather than inventing one.
 * `standalone` exists because 36 of this owner's 193 acceptances carry no in-product subject.
 */
export const EXPERTISE_SUBJECT_TYPES = ['topic', 'task', 'document', 'standalone'] as const;
/**
 * Two values only. There used to be a third, false_positive, and in practice it was systematically
 * misused: the model recorded "this rule does not apply to this topic" as fp (fp 29 > pass 19 on
 * message replies). But fp was meant as "applied, but applied wrongly" — a demotion signal for
 * use-it-or-lose-it. Recorded that way, every rule is penalised merely for showing up in an
 * unrelated topic. **Not applicable should produce no hit at all**; genuine false alarms are carried
 * by userDecision = 'reject'.
 */
export const EXPERTISE_HIT_OUTCOMES = ['pass', 'violation'] as const;
export const EXPERTISE_HIT_SEVERITIES = ['high', 'mid', 'low'] as const;
export const EXPERTISE_HIT_USER_DECISIONS = ['agree', 'reject'] as const;
export const EXPERTISE_FIT_CONFIDENCES = ['insufficient', 'low', 'ok'] as const;
export const EXPERTISE_INSIGHT_STATUSES = ['active', 'dismissed', 'acted'] as const;
export const EXPERTISE_REVISION_ACTORS = ['user', 'agent', 'system'] as const;
/** The two sources of a rewrite: a person made the boundary explicit vs. a merge generalized it to cover new instances. */
export const EXPERTISE_REVISION_KINDS = ['user-feedback', 'generalize'] as const;
/**
 * Zero hits come from two different conditions, handled differently:
 *   over-specific  the trigger is hard-coded to one role/platform → merge back into the parent rule
 *   one-off        genuinely rare → keep or retire
 * Measured: 90% of the zero-hit lessons in the recruiting expert carry a "when…" clause, 0% in the
 * design engineer — the same bucket, two different conditions.
 */
export const EXPERTISE_SPECIFICITIES = ['general', 'over-specific', 'one-off'] as const;
/** Curve shape. Telling "truly saturated" apart from "never took off" was the old version's biggest hole. */
export const EXPERTISE_PLATEAU_KINDS = ['saturated', 'growing', 'stalled', 'noisy'] as const;

// ============================================
// 1. expertise_domains — the expertise itself + the non-P parts of SCLPT
// ============================================

export const expertiseDomains = pgTable(
  'expertise_domains',
  {
    id: varchar255('id')
      .$defaultFn(() => idGenerator('expertiseDomains'))
      .primaryKey(),

    slug: varchar255('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),

    // ---- Ownership (not usage rights). Same shape as projects / documents ----
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    visibility: text('visibility', { enum: ['private', 'public'] })
      .notNull()
      .default('private'),
    source: text('source', { enum: EXPERTISE_DOMAIN_SOURCES }).notNull().default('user'),

    /**
     * Derivation. When someone else's domain is mounted but lessons should accumulate locally, fork
     * it: canon + layers + domainFilter are inherited and lessons stack on top. Deliberately capped at
     * one level — merge semantics across multiple inheritance levels get out of hand.
     */
    parentDomainId: varchar255('parent_domain_id').references(
      (): AnyPgColumn => expertiseDomains.id,
      { onDelete: 'set null' },
    ),

    // ---- The non-P parts of SCLPT: these are product-visible content, not documentation ----
    /**
     * The gatekeeping criterion for P, required when creating a domain. E.g. "Strip out every
     * framework, table and component name — is there still a product insight left?"
     * notNull is deliberate: without it the Pattern Base becomes a bucket for everything within months.
     */
    domainFilter: text('domain_filter').notNull(),
    /** States explicitly what does not belong to this domain. */
    outOfScope: text('out_of_scope'),

    /**
     * L — the layered model, owned by the expertise rather than a global enum:
     * Cooper's three models / correctness-maintainability-security / L1-L2-L3 all differ.
     * canonRef records which classic a layer was taken from; a self-invented layering hides what the
     * classic would have let you see.
     */
    layers: jsonb('layers').$type<ExpertiseLayerDefinition[]>().notNull().default([]),
    layerSource: text('layer_source', { enum: EXPERTISE_LAYER_SOURCES })
      .notNull()
      .default('invented'),

    /**
     * Canon — the external benchmark, **as entries**.
     *
     * This used to be a single sentence of text, and lesson.canonAnchor ended up null 100% of the
     * time — an anchor that cannot be referenced cannot be anchored to. After switching to entries
     * the anchoring rate jumped to 100%.
     *
     * jsonb rather than its own table, same as layers: each domain has a fixed 7–8 entries, reads are
     * always the full set (fed to prompts, used for coverage), and there is zero reuse across the 9
     * real domains. lesson.canonAnchor references it by key — the same trade-off as lesson.layer
     * referencing layers[].key.
     */
    canonEntries: jsonb('canon_entries').$type<ExpertiseCanonEntry[]>().notNull().default([]),
    /** Full text of or reference material for the classic — entries are the index, the document is the source. */
    canonDocumentId: varchar255('canon_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),

    /** How one practice proceeds. */
    flow: jsonb('flow').$type<string[]>().notNull().default([]),

    /**
     * T — which evidence one practice must leave behind. Checked when a run finishes; anything
     * missing is flagged. Items tied to a layer are only required when that layer runs: e.g. a UX
     * audit ties screenshot to L2 as required, so no L2 conclusion is allowed without a screenshot.
     */
    evidenceSpec: jsonb('evidence_spec').$type<ExpertiseEvidenceSpecItem[]>().notNull().default([]),

    /** Markdown projection of the lesson base, attached via agent_documents for deterministic injection. */
    lessonBaseDocumentId: varchar255('lesson_base_document_id').references(() => documents.id, {
      onDelete: 'set null',
    }),

    /**
     * The full candidate set produced at anchoring. A domain is a **choice**, not a discovery —
     * anchoring the same agent twice can yield two valid identities (tech-intelligence analysis /
     * paper reading), each with its own canon and layers. The road not taken is kept too, so we can
     * later answer "what if we had picked the other one".
     */
    anchorCandidates: jsonb('anchor_candidates').$type<ExpertiseAnchorCandidate[]>(),
    /**
     * When a person settled the anchor. null = not yet — and while it is null, **growing rules is
     * forbidden**, because the downstream layers, canon and filter all depend on that choice.
     */
    anchorChosenAt: timestamptz('anchor_chosen_at'),
    anchorChosenByUserId: text('anchor_chosen_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    /** The seed practice is saturated by definition and does not count toward maturity. */
    seedState: text('seed_state', { enum: EXPERTISE_SEED_STATES }).notNull().default('seeding'),
    /** No FK, to avoid a circular reference with runs; consistency is guaranteed by the service. */
    seedRunId: uuid('seed_run_id'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('expertise_domains_slug_user_unique')
      .on(t.slug, t.userId)
      .where(isNull(t.workspaceId)),
    uniqueIndex('expertise_domains_slug_workspace_unique')
      .on(t.workspaceId, t.slug)
      .where(isNotNull(t.workspaceId)),
    index('expertise_domains_user_id_idx').on(t.userId),
    index('expertise_domains_workspace_visibility_idx').on(t.workspaceId, t.visibility),
    index('expertise_domains_parent_idx').on(t.parentDomainId),
  ],
);

export type ExpertiseDomainItem = typeof expertiseDomains.$inferSelect;
export type NewExpertiseDomain = typeof expertiseDomains.$inferInsert;

// ============================================
// 2. expertise_bindings — mounts (exclusive arc)
// ============================================

/**
 * An expertise is mounted on a carrier; the carrier does not own it — the same semantics as
 * project_knowledge_bases.
 *
 * Exclusive arc (four nullable FKs + exactly one non-null) rather than carrier-side polymorphism:
 * carriers are a closed, known set, so the usual justification for polymorphism does not hold, and
 * FK integrity buys automatic cascades when a carrier is deleted, with no extra GC.
 */
export const expertiseBindings = pgTable(
  'expertise_bindings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    domainId: varchar255('domain_id')
      .notNull()
      .references(() => expertiseDomains.id, { onDelete: 'cascade' }),

    agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    boundWorkspaceId: text('bound_workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    boundUserId: text('bound_user_id').references(() => users.id, { onDelete: 'cascade' }),

    /**
     * Whether a mount consumes or co-builds — decides where new lessons are written.
     * derive is the default: when a public domain is mounted, pitfalls hit locally should neither
     * pollute the public base nor leak out of it, so a private domain is forked automatically the
     * first time a new lesson is produced.
     */
    contributionMode: text('contribution_mode', { enum: EXPERTISE_CONTRIBUTION_MODES })
      .notNull()
      .default('derive'),

    addedByUserId: text('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    ...timestamps,
  },
  (t) => [
    check(
      'expertise_bindings_exactly_one_carrier',
      sql`(${t.agentId} IS NOT NULL)::int + (${t.projectId} IS NOT NULL)::int + (${t.boundWorkspaceId} IS NOT NULL)::int + (${t.boundUserId} IS NOT NULL)::int = 1`,
    ),
    uniqueIndex('expertise_bindings_agent_domain_unique')
      .on(t.agentId, t.domainId)
      .where(isNotNull(t.agentId)),
    uniqueIndex('expertise_bindings_project_domain_unique')
      .on(t.projectId, t.domainId)
      .where(isNotNull(t.projectId)),
    uniqueIndex('expertise_bindings_workspace_domain_unique')
      .on(t.boundWorkspaceId, t.domainId)
      .where(isNotNull(t.boundWorkspaceId)),
    uniqueIndex('expertise_bindings_user_domain_unique')
      .on(t.boundUserId, t.domainId)
      .where(isNotNull(t.boundUserId)),
    index('expertise_bindings_domain_idx').on(t.domainId),
    index('expertise_bindings_workspace_id_idx').on(t.workspaceId),
  ],
);

export type ExpertiseBindingItem = typeof expertiseBindings.$inferSelect;
export type NewExpertiseBinding = typeof expertiseBindings.$inferInsert;

// ============================================
// 3. expertise_lessons — P, lessons
// ============================================

export const expertiseLessons = pgTable(
  'expertise_lessons',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    domainId: varchar255('domain_id')
      .notNull()
      .references(() => expertiseDomains.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    /** Stable human-readable code, P-01 / C-02. Insights reference it; retired codes are never reused. */
    code: varchar('code', { length: 20 }).notNull(),

    /**
     * rule is a neutral criterion — neither an anti-pattern nor a positive example, but a heuristic.
     * It decides which set of keys sections uses:
     *   bad  → wrong / why / breaks / correct
     *   good → good / works / dont
     *   rule → rule / why / how / limits
     */
    polarity: text('polarity', { enum: EXPERTISE_LESSON_POLARITIES }).notNull(),
    title: text('title').notNull(),
    /**
     * Four-part structured body, ordered. jsonb rather than named columns: the three polarities use
     * different field names, so named columns would be mostly null forever; conversational rewrites
     * locate a part by key and change only that part.
     */
    sections: jsonb('sections').$type<ExpertiseLessonSection[]>().notNull(),

    layer: varchar255('layer'),
    tags: text('tags').array(),

    /**
     * Whether the standard rests on a mechanism or on taste, and whether its reason came from the
     * owner or was filled in during distillation.
     *
     * Must be a column rather than a sentence in the body: the compile step relies on reasonKind to
     * stop "compiling taste into a criterion that can block a delivery on its own", and the sentence
     * in the body is **written in the reviewer's language**, so string matching is bound to miss it.
     *
     * Fixed at the moment the lesson is born. If a later rejection supplies a mechanism, taste should
     * in principle be upgraded to mechanism, but the upgrade rule is not worked out yet, so it is not
     * done for now.
     */
    reasonKind: text('reason_kind').$type<ExpertiseReasonKind>(),
    reasonSource: text('reason_source').$type<ExpertiseReasonSource>(),
    /** Failing to anchor to a classic (null) is a weak signal — per BM-58 it usually means not yet thought through, not an error. */
    canonAnchor: text('canon_anchor'),

    /** The practice and the hit that taught us this lesson. */
    originRunId: uuid('origin_run_id'),
    originHitId: uuid('origin_hit_id'),

    /** Newly learned lessons go in by default, so there is no candidate state; gatekeeping is by later retirement, not up-front approval. */
    status: text('status', { enum: EXPERTISE_LESSON_STATUSES }).notNull().default('active'),
    /** rejected is a recycle bin, not deletion — filtered-out entries often hide a kernel inside an implementation shell. */
    rejectedReason: text('rejected_reason'),
    salvagedFromId: uuid('salvaged_from_id').references((): AnyPgColumn => expertiseLessons.id, {
      onDelete: 'set null',
    }),
    retiredAt: timestamptz('retired_at'),

    /** Where a lesson ends up: compiled into a machine-runnable criterion. Mental-model-layer lessons are always not-compilable. */
    compilability: text('compilability', { enum: EXPERTISE_COMPILABILITIES })
      .notNull()
      .default('compilable'),
    /**
     * How this standard scored against deliveries the reviewer already judged.
     *
     * Nothing writes it yet, deliberately. Measured on 898 circled rejections, a score against
     * those labels cannot gate compilation: a reviewer circles the worst thing in a delivery, so a
     * standard that correctly spots a defect they did not circle that time reads as a false alarm.
     * See `ExpertiseBacktestResult` for the numbers. The column stays because the measurement
     * belongs on the lesson once one with unbiased labels exists; jsonb so its shape can change
     * without a migration each time.
     */
    backtest: jsonb('backtest').$type<ExpertiseBacktestResult>(),
    compiledCriterionId: uuid('compiled_criterion_id').references(() => verifyCriteria.id, {
      onDelete: 'set null',
    }),

    /**
     * Denormalized counts of hits — not an optimization but a necessity: hits is the only table
     * with scale risk, and counting it on every list render would bring L2 down.
     * hitCount is "how many times it was applied" (one practice can apply the same lesson in several
     * places); hitRunCount is "in how many distinct situations it was validated". Tier ranking uses
     * the former, saturation detection the latter.
     */
    hitCount: integer('hit_count').notNull().default(0),
    hitRunCount: integer('hit_run_count').notNull().default(0),
    falsePositiveCount: integer('false_positive_count').notNull().default(0),
    lastHitAt: timestamptz('last_hit_at'),
    lastHitRunId: uuid('last_hit_run_id'),

    /**
     * On a merge, points to the parent rules that were generalized away, to trace "which lessons was
     * this merged from". Of the three write-path branches (instance / refine / new), refine fills it.
     */
    generalizedFromIds: jsonb('generalized_from_ids').$type<string[]>(),
    /** Diagnosis of zero hits — decides whether to merge back into the parent rule or keep it (see EXPERTISE_SPECIFICITIES). */
    specificity: text('specificity', { enum: EXPERTISE_SPECIFICITIES }),
    /** Number of concrete cases attached through instance matches — the source of the ✅❌ examples. */
    exampleCount: integer('example_count').notNull().default(0),

    currentRevision: integer('current_revision').notNull().default(1),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('expertise_lessons_domain_code_unique').on(t.domainId, t.code),
    unique('expertise_lessons_id_domain_unique').on(t.id, t.domainId),
    index('expertise_lessons_domain_status_hits_idx').on(t.domainId, t.status, t.hitCount),
    index('expertise_lessons_domain_layer_idx').on(t.domainId, t.layer),
    index('expertise_lessons_compiled_criterion_idx').on(t.compiledCriterionId),
  ],
);

export type ExpertiseLessonItem = typeof expertiseLessons.$inferSelect;
export type NewExpertiseLesson = typeof expertiseLessons.$inferInsert;

// ============================================
// 4. expertise_lesson_revisions — version chain of conversational rewrites
// ============================================

/**
 * When "the condition you stated becomes its exception", the result must leave a trail; otherwise
 * nobody can answer "why does this lesson have this restriction" next time. feedback stores what the
 * person actually said at the time — it is worth more than the rewritten result.
 */
export const expertiseLessonRevisions = pgTable(
  'expertise_lesson_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => expertiseLessons.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),

    /** Full snapshot of the body at this revision. */
    sections: jsonb('sections').$type<ExpertiseLessonSection[]>().notNull(),
    /** The words that triggered this rewrite. */
    feedback: text('feedback'),

    changedBy: text('changed_by', { enum: EXPERTISE_REVISION_ACTORS }).notNull(),
    /** A person made it explicit, or a merge generalized it — the two differ in value and trustworthiness. */
    kind: text('kind', { enum: EXPERTISE_REVISION_KINDS }).notNull().default('user-feedback'),
    /** Title before the rewrite, so what was generalized is visible at a glance. */
    prevTitle: text('prev_title'),
    /**
     * The deliveries a generalize pass read, and which accepted delivery each exemption was read
     * from. null on a person's rewrite, whose authority is `feedback` itself. jsonb rather than a
     * link table: a pass reads a handful of deliveries and is only ever audited one revision at a
     * time; the ids are provenance, so a deleted check simply stops resolving.
     */
    evidence: jsonb('evidence').$type<ExpertiseRevisionEvidence>(),
    changedByUserId: text('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    sourceRunId: uuid('source_run_id'),
    operationId: text('operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('expertise_lesson_revisions_lesson_revision_unique').on(t.lessonId, t.revision),
    index('expertise_lesson_revisions_lesson_idx').on(t.lessonId),
  ],
);

export type ExpertiseLessonRevisionItem = typeof expertiseLessonRevisions.$inferSelect;
export type NewExpertiseLessonRevision = typeof expertiseLessonRevisions.$inferInsert;

// ============================================
// 5. expertise_runs — one practice
// ============================================

/**
 * One practice = one complete judgement pass over some object.
 *
 * The boundary is not invented here: it reuses the reflection time-window idempotency key directly.
 * A reflection is itself "an agent reviewing a topic/scope over a time window", which is exactly this
 * definition.
 *
 * Deliberately no operationId — a reflection on a topic naturally spans several operations;
 * operation attribution is pushed down to expertise_hits (which execution each piece of evidence came from).
 */
export const expertiseRuns = pgTable(
  'expertise_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    domainId: varchar255('domain_id')
      .notNull()
      .references(() => expertiseDomains.id, { onDelete: 'cascade' }),

    /** X axis of the curve. Set to the domain's max+1 on write. */
    runIndex: integer('run_index').notNull(),
    /** The seed practice is saturated by definition — a first-class field, not a convention. */
    isSeedRun: boolean('is_seed_run').notNull().default(false),

    // Attribution (not ownership): who contributed to this curve
    actorType: text('actor_type', { enum: EXPERTISE_ACTOR_TYPES }).notNull(),
    actorId: text('actor_id').notNull(),

    /** Follows the acceptance subject convention instead of inventing another one. */
    subjectType: text('subject_type', { enum: EXPERTISE_SUBJECT_TYPES }).notNull(),
    subjectId: text('subject_id').notNull(),

    windowStart: timestamptz('window_start'),
    windowEnd: timestamptz('window_end'),
    /** Reflection window idempotency key; guarantees the same reflection window never creates a second run. */
    reflectionKey: varchar255('reflection_key'),

    /** The insight "the times it learned fastest were all with you in the conversation" depends on this. */
    hadHumanInLoop: boolean('had_human_in_loop').notNull().default(false),

    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /**
     * Counts for the three write-path branches. Their ratio is **a direct reading of enumeration
     * health**: a healthy rule base is dominated by instance; a persistently high new count means
     * cases are being recorded as rules.
     */
    instanceCount: integer('instance_count').notNull().default(0),
    refineCount: integer('refine_count').notNull().default(0),
    newCount: integer('new_count').notNull().default(0),

    startedAt: timestamptz('started_at').notNull().defaultNow(),
    completedAt: timestamptz('completed_at'),

    ...timestamps,
  },
  (t) => [
    uniqueIndex('expertise_runs_domain_run_index_unique').on(t.domainId, t.runIndex),
    unique('expertise_runs_id_domain_unique').on(t.id, t.domainId),
    uniqueIndex('expertise_runs_domain_reflection_key_unique')
      .on(t.domainId, t.reflectionKey)
      .where(isNotNull(t.reflectionKey)),
    index('expertise_runs_domain_started_idx').on(t.domainId, t.startedAt),
    index('expertise_runs_actor_idx').on(t.actorType, t.actorId),
    index('expertise_runs_subject_idx').on(t.subjectType, t.subjectId),
  ],
);

export type ExpertiseRunItem = typeof expertiseRuns.$inferSelect;
export type NewExpertiseRun = typeof expertiseRuns.$inferInsert;

// ============================================
// 6. expertise_hits — hits
// ============================================

/**
 * "Which lessons were applied this time." The entire L2 view (tier ranking, dead entries, ✅❌
 * examples, use-it-or-lose-it) is built on this table.
 *
 * Note that "learned a new one" is **not** a hit — that is a lesson being born, recorded on
 * lesson.originRunId. The early design had two axes, verdict + compliance, precisely because it mixed
 * those two things into one table.
 *
 * This is the only table with scale risk: one expertise × 47 practices × 30 hits each = 1,400 rows,
 * multiplied by expertises and by tenants. That is why the denormalized counts on lesson are
 * required; details can be archived while the counts are kept.
 */
export const expertiseHits = pgTable(
  'expertise_hits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id').notNull(),
    lessonId: uuid('lesson_id').notNull(),
    domainId: varchar255('domain_id')
      .notNull()
      .references(() => expertiseDomains.id, { onDelete: 'cascade' }),

    /** pass = the object follows this lesson; violation = it breaks it (one finding). See EXPERTISE_HIT_OUTCOMES. */
    outcome: text('outcome', { enum: EXPERTISE_HIT_OUTCOMES }).notNull(),

    /** Location and explanation when violated. */
    where: text('where'),
    note: text('note'),
    /** The concrete case attached by an instance match — what this rule looked like this time; the ✅❌ example. */
    example: text('example'),
    severity: text('severity', { enum: EXPERTISE_HIT_SEVERITIES }),

    /** Evidence links to verify_evidence instead of degrading into a sentence. */
    evidenceId: uuid('evidence_id').references(() => verifyEvidence.id, { onDelete: 'set null' }),
    operationId: text('operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),
    /**
     * For a hit distilled from a rejection, points back at the rejection that taught us this lesson.
     *
     * Without it, "which acceptances did this standard come from" could only be inferred via
     * evidenceId, and a rejection does not always circle evidence (260 of 876 rejections have no
     * circled region). set null because this is provenance, not ownership: deleting an acceptance
     * should not also delete the rules learned from it.
     */
    sourceCheckResultId: uuid('source_check_result_id').references(() => verifyCheckResults.id, {
      onDelete: 'set null',
    }),

    /** A person overruling it → feeds use-it-or-lose-it, so this lesson is more conservative next time. */
    userDecision: text('user_decision', { enum: EXPERTISE_HIT_USER_DECISIONS }),
    userDecisionAt: timestamptz('user_decision_at'),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.runId, t.domainId],
      foreignColumns: [expertiseRuns.id, expertiseRuns.domainId],
      name: 'expertise_hits_run_domain_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.lessonId, t.domainId],
      foreignColumns: [expertiseLessons.id, expertiseLessons.domainId],
      name: 'expertise_hits_lesson_domain_fk',
    }).onDelete('cascade'),
    index('expertise_hits_lesson_created_idx').on(t.lessonId, t.createdAt),
    index('expertise_hits_run_idx').on(t.runId),
    index('expertise_hits_domain_outcome_idx').on(t.domainId, t.outcome),
    index('expertise_hits_operation_idx').on(t.operationId),
  ],
);

export type ExpertiseHitItem = typeof expertiseHits.$inferSelect;
export type NewExpertiseHit = typeof expertiseHits.$inferInsert;

// ============================================
// 7. expertise_domain_snapshots — source of truth for the curves
// ============================================

/**
 * One row written when each practice finishes. A single table feeds: the L0 maturity curve, the L1
 * bar/line chart, the maturity orb, this month's delta, idle detection, solidification, and layer gaps.
 *
 * Counts and fitting are deliberately separated:
 *   - the count part is written on the run-finished event: pure aggregation, deterministic, cheap
 *   - the fit part is backfilled by a 6-hour scheduled job: numerical optimization, with entirely different failure modes
 * So there are two different kinds of "no maturity yet", with different UI copy:
 *   fitComputedAt IS NULL          → still computing
 *   fitConfidence = 'insufficient' → too few samples to compute (no fake numbers)
 */
export const expertiseDomainSnapshots = pgTable(
  'expertise_domain_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    domainId: varchar255('domain_id')
      .notNull()
      .references(() => expertiseDomains.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').references(() => expertiseRuns.id, { onDelete: 'set null' }),
    runIndex: integer('run_index').notNull(),

    // ---- Written on events ----
    learnedTotal: integer('learned_total').notNull(),
    retiredTotal: integer('retired_total').notNull().default(0),
    /** = learnedTotal − retiredTotal. Retirement makes the curve dip, which is exactly the visualization of "capability declining". */
    activeCount: integer('active_count').notNull(),
    /** Numerator of solidification: how many lessons have been compiled into a verify criterion. */
    compiledCount: integer('compiled_count').notNull().default(0),
    layerCounts: jsonb('layer_counts').$type<Record<string, number>>().notNull().default({}),

    // ---- Backfilled by the 6-hour scheduled job: P(n) = P∞·(1−e^(−n/τ)) ----
    /** Estimate of how many lessons this domain can learn in total (the asymptote). */
    pInf: numeric('p_inf', { mode: 'number' }),
    /** Learning time constant; its reciprocal is the learning rate. */
    tau: numeric('tau', { mode: 'number' }),
    /** = activeCount / pInf, 0..1. Normalized, so comparable across domains regardless of absolute practice counts. */
    maturity: numeric('maturity', { mode: 'number' }),
    fitSampleSize: integer('fit_sample_size'),
    /**
     * Goodness of fit. Not the same thing as fitConfidence, and both must be kept: a high r² only says
     * the curve hugs the observed points — the 6 backtest groups whose τ hit the upper bound had
     * equally pretty r², because they were hugging the linear segment. The UI shows it next to
     * observedSpan precisely so "fits well" and "extrapolation is trustworthy" are read separately.
     */
    fitR2: numeric('fit_r2', { mode: 'number' }),
    fitConfidence: text('fit_confidence', { enum: EXPERTISE_FIT_CONFIDENCES }),
    fitComputedAt: timestamptz('fit_computed_at'),
    /**
     * τ hitting the search upper bound = the fit failed, and pInf / maturity are then pure boundary
     * artifacts. 6 of 9 backtest groups hit the bound, and the old version reported all of them as ok
     * (that is where a "maturity 93.6%" came from). Hitting the bound must always downgrade.
     */
    tauPinned: boolean('tau_pinned').notNull().default(false),
    /**
     * = runIndex / τ. τ is the scale at which the curve bends: until a full time constant has passed,
     * the curve is still on its linear segment, the asymptote is not constrained by the data at all,
     * and pInf is **guessed rather than measured**.
     * Below 1 the UI must warn explicitly and must not extrapolate from it.
     */
    observedSpan: numeric('observed_span', { mode: 'number' }),
    plateauKind: text('plateau_kind', { enum: EXPERTISE_PLATEAU_KINDS }),

    /**
     * Bounded metrics: fixed denominators, no extrapolation, so they stay trustworthy when the fit fails.
     *
     * Layer coverage and canon coverage are **two independent ratios** and must not be multiplied into
     * a Cartesian product — not every (layer, canon) pair is meaningful (entity_disambiguation only
     * holds at the entity_resolution layer; pairing it with the corroboration layer is an empty cell
     * that can never be filled).
     */
    layerCoverage: numeric('layer_coverage', { mode: 'number' }),
    canonCoverage: numeric('canon_coverage', { mode: 'number' }),
    /** Lessons with hits / all lessons. **The more you enumerate, the lower it goes — a built-in anti-enumeration metric.** */
    activeRate: numeric('active_rate', { mode: 'number' }),

    capturedAt: timestamptz('captured_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.runId, t.domainId],
      foreignColumns: [expertiseRuns.id, expertiseRuns.domainId],
      name: 'expertise_domain_snapshots_run_domain_fk',
    }),
    uniqueIndex('expertise_domain_snapshots_domain_run_index_unique').on(t.domainId, t.runIndex),
    index('expertise_domain_snapshots_domain_captured_idx').on(t.domainId, t.capturedAt),
    index('expertise_domain_snapshots_pending_fit_idx')
      .on(t.domainId)
      .where(isNull(t.fitComputedAt)),
  ],
);

export type ExpertiseDomainSnapshotItem = typeof expertiseDomainSnapshots.$inferSelect;
export type NewExpertiseDomainSnapshot = typeof expertiseDomainSnapshots.$inferInsert;

// ============================================
// 8. expertise_insights — meta-patterns only visible across many practices
// ============================================

/**
 * Produced by a scheduled analysis job, not obtainable from an aggregate query: semantic clustering
 * of correction records, a lesson co-occurrence matrix, run-metadata correlation, discovery overlap.
 *
 * Because it is an analysis artifact it will be wrong sometimes, so dismissed is a hard requirement —
 * an insight must be possible to overrule. staleAfterRunIndex makes it expire as the data changes, so
 * stale conclusions do not stay pinned on the first screen.
 */
export const expertiseInsights = pgTable(
  'expertise_insights',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Nullable: some insights span domains. */
    domainId: varchar255('domain_id').references(() => expertiseDomains.id, {
      onDelete: 'cascade',
    }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),

    /** 'repeated-mistake' | 'possible-duplicate' | 'learns-faster-with-human' | 'no-judgment-yet' … */
    kind: varchar255('kind').notNull(),
    headline: text('headline').notNull(),
    body: text('body').notNull(),
    actionLabel: text('action_label'),
    actionTarget: jsonb('action_target').$type<Record<string, unknown>>(),

    /** The concrete objects backing it; opening it must lead to them. */
    evidence: jsonb('evidence').$type<ExpertiseInsightEvidenceRef[]>().notNull().default([]),
    confidence: real('confidence'),

    status: text('status', { enum: EXPERTISE_INSIGHT_STATUSES }).notNull().default('active'),
    dismissReason: text('dismiss_reason'),
    /** Considered stale once the practice index passes this value. */
    staleAfterRunIndex: integer('stale_after_run_index'),

    generatedByOperationId: text('generated_by_operation_id').references(() => agentOperations.id, {
      onDelete: 'set null',
    }),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('expertise_insights_domain_status_idx').on(t.domainId, t.status),
    index('expertise_insights_user_status_idx').on(t.userId, t.status),
    index('expertise_insights_workspace_idx').on(t.workspaceId),
  ],
);

export type ExpertiseInsightItem = typeof expertiseInsights.$inferSelect;
export type NewExpertiseInsight = typeof expertiseInsights.$inferInsert;
