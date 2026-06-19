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
