/**
 * Verify (delivery checker) domain types — the shared vocabulary, frozen-item
 * shape, Toulmin narrative, and rubric run-policy config. Kept here (not in the
 * DB schema) so every layer — schema, services, store, UI — depends on one
 * source of truth without reaching into the database package.
 *
 * The closed sets (verifier types, statuses, verdicts, surfaces, evidence media)
 * are runtime values, and this package is replaced by a hand-written stub inside
 * the isolated desktop workspace — so they live in `@lobechat/const/verify`,
 * which every workspace can resolve. Their derived types are re-exported here so
 * `@lobechat/types` stays the one-stop vocabulary for the domain.
 */
import type {
  VerifierType,
  VerifyCheckResultStatus,
  VerifyEvidenceCapturedBy,
  VerifyEvidenceType,
  VerifyOnFailStrategy,
  VerifyRunOrigin,
  VerifyRunScenario,
  VerifyRunSource,
  VerifyRunStatus,
  VerifySurface,
  VerifyUserDecision,
  VerifyVerdict,
} from '@lobechat/const/verify';

export type {
  VerifierType,
  VerifyCheckResultStatus,
  VerifyEvidenceCapturedBy,
  VerifyEvidenceType,
  VerifyOnFailStrategy,
  VerifyRunOrigin,
  VerifyRunScenario,
  VerifyRunSource,
  VerifyRunStatus,
  VerifySurface,
  VerifyUserDecision,
  VerifyVerdict,
};

/**
 * Coding-scenario scope: where the code under test came from and how it ran.
 * Rendered as the report's scope header so the verify page reads as the final
 * report.
 */
export interface VerifyCodingPullRequest {
  /** Pull request number, e.g. 123. */
  number?: number | string;
  /** Pull request title. */
  title?: string;
  /** Web URL for opening the PR. */
  url?: string;
}

export interface VerifyCodingScope {
  /** Git branch the report was produced against. */
  branch?: string;
  /** Git commit (short sha) of the code under test. */
  commit?: string;
  /** Entry point / command exercised, e.g. "lh verify ingest-report". */
  entry?: string;
  /** Associated pull request, when the verification run has one. */
  pullRequest?: VerifyCodingPullRequest;
  /** Product surfaces the checks ran on. */
  surfaces?: VerifySurface[];
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

export interface VerifyInteractionCostOperators {
  H?: number;
  K?: number;
  M?: number;
  P?: number;
  R_ms?: number;
  T_chars?: number;
}

export interface VerifyInteractionCostPhase {
  actionCount?: number;
  activeSeconds?: number;
  checkItemId?: string;
  id: string;
  label?: string;
  operators?: VerifyInteractionCostOperators;
  seconds?: number;
  waitSeconds?: number;
}

export interface VerifyInteractionCost {
  actionCount?: number;
  activeSeconds: number;
  actualAgentSeconds?: number;
  categoryCounts?: Record<string, number>;
  generatedAt?: string;
  mentalEstimates?: Record<string, unknown>[];
  model: string;
  operators: VerifyInteractionCostOperators;
  phases?: VerifyInteractionCostPhase[];
  scope?: string;
  sourceTrace?: string;
  timingSeconds?: Record<string, number>;
  totalSeconds: number;
  waitSeconds: number;
}

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
 * Generic per-run extension bag (`verify_runs.metadata`) — cross-scenario knobs
 * we don't model as columns. Kept open so new policy switches don't require a
 * migration; the active scenario's input lives in `context`, not here.
 */
export interface VerifyRunMetadata {
  [key: string]: unknown;
  interactionCost?: VerifyInteractionCost;
  /**
   * Per-run override for the repair-round cap, taking precedence over the
   * rubric's {@link VerifyRubricConfig.maxRepairRounds}. Set from a task's
   * `TaskVerifyConfig.maxIterations` so a task with ad-hoc criteria or a per-task
   * override honors its saved cap (the rubric may not carry it). Read at repair
   * time via {@link DEFAULT_MAX_REPAIR_ROUNDS} fallback.
   */
  maxRepairRounds?: number;
  /**
   * Where this report came from — the LobeHub conversation whose agent produced
   * it. Set when the harness runs inside a LobeHub-spawned agent (the runtime
   * echoes the ids into the child env; see {@link VerifyRunOrigin}).
   *
   * Deliberately *not* `verify_runs.operation_id`: that column means "this
   * session verifies that Agent Run" and is uniquely indexed, so one agent
   * publishing two reports would collide. Origin is the inverse relation — the
   * run that *authored* the report — and is many-to-one.
   */
  origin?: VerifyRunOrigin;
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
 * `verifierConfig` of a plan item authored by a harness before its run.
 *
 * Note what is NOT here: *how the item is judged* is `verifierType`
 * (program / agent / llm), and *what artifact it must produce* is
 * {@link RequiredEvidenceSpec} under `requiredEvidence` — both closed sets, and
 * the latter is enforced (a missing required artifact fails the item through the
 * executor's coverage gate). `method` and `expected` are the human-readable
 * complement to those two, not a replacement: prose the author writes down
 * *before* the run so a reader can weigh intent against outcome, and so a
 * planned-but-never-executed item stays legible instead of vanishing.
 */
export interface VerifyAgentPlanConfig {
  /** The observable outcome that would make this item pass. Prose. */
  expected?: string;
  /** How the item would be exercised (steps / command / probe). Prose. */
  method?: string;
  /** Evidence media this item must produce — gated, not decorative. */
  requiredEvidence?: RequiredEvidenceSpec[];
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

/**
 * Declares that a criterion is evidence-driven: it cannot pass on the
 * deliverable text alone — the run must capture and upload an artifact of each
 * listed `type` (via `lh verify upload-evidence`). Stored under the plan item's
 * `verifierConfig.requiredEvidence`, so adding it needs no schema change. The
 * structural gate marks a required item `uncertain` when any listed type is
 * missing, independent of the LLM judge.
 */
export interface RequiredEvidenceSpec {
  /** What the capturer should produce — guidance only, not validated. */
  hint?: string;
  /** The evidence medium that must be present for this criterion. */
  type: VerifyEvidenceType;
}

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
  /** Generic extension bag; concrete capturer-specific shape is not fixed yet. */
  metadata?: unknown | null;
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
