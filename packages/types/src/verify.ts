/**
 * Verify (delivery checker) domain types — the shared vocabulary, frozen-item
 * shape, Toulmin narrative, and rubric run-policy config. Kept here (not in the
 * DB schema) so every layer — schema, services, store, UI — depends on one
 * source of truth without reaching into the database package.
 */

/**
 * How a single criterion is judged.
 * - program: run a deterministic command / script
 * - agent:   spawn a sub agent_operations to investigate
 * - llm:     call generateObject and let an LLM judge produce a Toulmin verdict
 */
export const verifierTypes = ['program', 'agent', 'llm'] as const;
export type VerifierType = (typeof verifierTypes)[number];

/** What to do when a check item fails. */
export const verifyOnFailStrategies = ['manual', 'auto_repair'] as const;
export type VerifyOnFailStrategy = (typeof verifyOnFailStrategies)[number];

/** Lifecycle of a single check result. */
export const verifyCheckResultStatuses = [
  'pending',
  'running',
  'passed',
  'failed',
  'skipped',
] as const;
export type VerifyCheckResultStatus = (typeof verifyCheckResultStatuses)[number];

/** Toulmin Claim — the verifier's judgement. */
export const verifyVerdicts = ['passed', 'failed', 'uncertain'] as const;
export type VerifyVerdict = (typeof verifyVerdicts)[number];

/** Human feedback on a result, feeding the data flywheel. */
export const verifyUserDecisions = ['accepted', 'rejected', 'overridden'] as const;
export type VerifyUserDecision = (typeof verifyUserDecisions)[number];

/**
 * Denormalized rollup of a verification session's pipeline state — mirrors the
 * legacy `agent_operations.verify_status` set so the two stay interchangeable
 * while results/reports migrate from being operation-anchored to run-anchored.
 */
export const verifyRunStatuses = [
  'unverified',
  'planned',
  'verifying',
  'passed',
  'failed',
  'repairing',
  'delivered',
] as const;
export type VerifyRunStatus = (typeof verifyRunStatuses)[number];

/**
 * What produced a verification session.
 * - agent:         verifying a real Agent Run (`verify_runs.operation_id` set)
 * - agent-testing: a standalone session ingested from the agent-testing harness
 *   (no Agent Run — `operation_id` is null)
 */
export const verifyRunSources = ['agent', 'agent-testing'] as const;
export type VerifyRunSource = (typeof verifyRunSources)[number];

/**
 * The kind of thing a verification session checks. Orthogonal to `source` (which
 * records what *produced* the run): `scenario` drives how the report renders its
 * scope header and scenario-specific detail. Open-ended — new scenarios add a
 * value here plus their own {@link VerifyRunContext} shape.
 * - coding: verifying a software change (branch / commit / surfaces under test).
 */
export const verifyRunScenarios = ['coding'] as const;
export type VerifyRunScenario = (typeof verifyRunScenarios)[number];

/**
 * Coding-scenario scope: where the code under test came from and how it ran.
 * Rendered as the report's scope header so the verify page reads as the final
 * report.
 */
export interface VerifyCodingScope {
  /** Git branch the report was produced against. */
  branch?: string;
  /** Git commit (short sha) of the code under test. */
  commit?: string;
  /** Entry point / command exercised, e.g. "lh verify ingest-report". */
  entry?: string;
  /** The focus / key risk of this round (free text). */
  focus?: string;
  /** Test surfaces exercised, e.g. ["cli", "web"]. */
  surfaces?: string[];
  /** When the report was authored (ISO 8601) — distinct from the row's createdAt (ingest time). */
  testedAt?: string;
}

/**
 * The scenario's context — its scope/provenance, discriminated by the run's
 * `scenario`. Kept in one jsonb (not columns) so each scenario can carry its own
 * shape and the viewer can render per scenario without a migration. Today only
 * `coding`; as scenarios grow this becomes a union (`VerifyCodingScope | …`).
 *
 * Distinct from a future generic `metadata` bag (reserved for cross-scenario
 * extension) — `context` is specifically the active scenario's input.
 */
export type VerifyRunContext = VerifyCodingScope;

/** Default cap on automatic repair rounds when a rubric doesn't override it. */
export const DEFAULT_MAX_REPAIR_ROUNDS = 3;

/**
 * Run-policy knobs for a rubric — applied to every run that mounts it. Lives in
 * one bag (not columns) so new policy switches can be added without a migration.
 * Read live at repair time via the plan item's `sourceRubricId`.
 */
export interface VerifyRubricConfig {
  /**
   * Max automatic repair rounds (parent-chain depth) before giving up, to cap
   * runaway repair loops. Defaults to {@link DEFAULT_MAX_REPAIR_ROUNDS}.
   */
  maxRepairRounds?: number;
}

/**
 * Immutable snapshot of one check item, frozen into `agent_operations.verify_plan`
 * when the plan is confirmed. The resolved content (title / verifierConfig) is
 * copied in — not just a criterion FK — so editing the source criterion / rubric
 * never drifts the meaning of a historical plan. `sourceCriterionId` /
 * `sourceRubricId` are provenance pointers only.
 */
export interface VerifyCheckItem {
  /** One-sentence summary of what this check verifies. */
  description?: string;
  /** The document holding the detailed judging instruction / rule body, if any. */
  documentId?: string | null;
  /** Stable uuid; `verify_check_results.check_item_id` relates to this, never the index. */
  id: string;
  /** Display ordering only — never used as a relation key. */
  index: number;
  /** What to do when this item fails. */
  onFail: VerifyOnFailStrategy;
  /** Whether failing this item blocks delivery (snapshot may override the source default). */
  required: boolean;
  /** Provenance: the criterion this item was instantiated from, or null when agent-generated. */
  sourceCriterionId?: string | null;
  /** Provenance: the rubric (group) this item came in through, or null. */
  sourceRubricId?: string | null;
  title: string;
  verifierConfig: Record<string, unknown>;
  verifierType: VerifierType;
}

/**
 * Strongly-typed Toulmin narrative for a verdict. Only ever read as a whole, so
 * the narrative elements live in one bag instead of 4-5 half-empty columns.
 * The query-driving Claim (`verdict`) and Qualifier (`confidence`) stay as columns.
 */
export interface ToulminVerdict {
  /** Rebuttal — evidence pointing the other way. */
  counterEvidence?: string;
  /** Data — the evidence collected to support the claim. */
  evidence?: string;
  /** Rebuttal — known limitations of this verifier. */
  limitation?: string;
  /** Warrant — why the evidence supports the claim. */
  reasoning?: string;
}

// ============================================
// Evidence — first-class artifacts a verifier produces (screenshots, logs, …)
// ============================================

/** The medium of a captured evidence artifact. */
export const verifyEvidenceTypes = [
  'screenshot',
  'gif',
  'video',
  'text',
  'dom_snapshot',
  'transcript',
] as const;
export type VerifyEvidenceType = (typeof verifyEvidenceTypes)[number];

/** Who / what captured an evidence artifact (provenance). */
export const verifyEvidenceCapturedBy = [
  'agent-browser',
  'cdp',
  'cli',
  'program',
  'llm_judge',
] as const;
export type VerifyEvidenceCapturedBy = (typeof verifyEvidenceCapturedBy)[number];

/**
 * One evidence artifact produced while judging a check. Carries existence +
 * provenance only — no verdict logic. Verifying an evidence is itself a new
 * check (related through `verify_check_results`), so this table stays flat.
 *
 * The payload lives in exactly one of two places: `content` for small inline
 * text (dom snapshot / console log / transcript), or `fileId` for a stored
 * artifact (screenshot / gif / video, or large text). The `files` table already
 * owns mime / size / hash / url, so none of that metadata is duplicated here.
 */
export interface VerifyEvidence {
  capturedAt?: Date | null;
  /** Who produced this artifact. */
  capturedBy?: VerifyEvidenceCapturedBy | null;
  /** The check result this evidence backs. */
  checkResultId: string;
  /** Inline payload for small text evidence (dom snapshot / console log / transcript). */
  content?: string | null;
  createdAt: Date;
  /** Human-readable caption, e.g. "首页首屏完整渲染". */
  description?: string | null;
  /** Stored artifact — FK to `files`, which owns mime / size / hash / url. */
  fileId?: string | null;
  id: string;
  type: VerifyEvidenceType;
}

// ============================================
// Report — the LLM-generated delivery-verification narrative for a run
// ============================================

/**
 * A delivery-verification report. A generated artifact (not a computed one):
 * `summary` / `content` are written by an LLM from the session's check results +
 * evidence. Tied to a verification session via `verifyRunId` (which itself
 * optionally links back to an Agent Run).
 */
export interface VerifyReport {
  /** Full Markdown report, shown in the expanded review view. */
  content?: string | null;
  createdAt: Date;
  failedChecks?: number | null;
  generatedAt: Date;
  /** Producer of this report, e.g. 'system' / a model id. */
  generatedBy?: string | null;
  id: string;
  /** 0-1 aggregate confidence across the run. */
  overallConfidence?: number | null;
  passedChecks?: number | null;
  /** Whether the user has acknowledged the report. */
  reviewedByUser?: boolean | null;
  /** Short 3-5 sentence summary, suitable for embedding in a chat message. */
  summary?: string | null;
  totalChecks?: number | null;
  uncertainChecks?: number | null;
  /** Overall Claim, reusing the verdict vocabulary. */
  verdict?: VerifyVerdict | null;
  /** The verification session this report summarizes. */
  verifyRunId: string;
}
