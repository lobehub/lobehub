/**
 * Verify (delivery checker) domain types — the shared vocabulary, frozen-item
 * shape, Toulmin narrative, and rubric run-policy config. Kept here (not in the
 * DB schema) so every layer — schema, services, store, UI — depends on one
 * source of truth without reaching into the database package.
 *
 * The unions below are declared here, and their runtime counterparts (the `as
 * const` arrays a schema or a `<Select>` iterates) live in
 * `@lobechat/const/verify`. The duplication is deliberate: this package is
 * replaced by a hand-written stub inside the isolated desktop workspace, so a
 * runtime value exported from here is unreachable for members of that workspace
 * (`@lobehub/cli`), while `@lobechat/types` must stay dependency-free of
 * `@lobechat/const`. `packages/const/src/verify.test.ts` fails the type-check the
 * moment the two sides drift apart.
 */

/**
 * How a single criterion is judged.
 * - program: run a deterministic command / script
 * - agent:   spawn a sub agent_operations to investigate
 * - llm:     call generateObject and let an LLM judge produce a Toulmin verdict
 */
export type VerifierType = 'program' | 'agent' | 'llm';

/** What to do when a check item fails. */
export type VerifyOnFailStrategy = 'manual' | 'auto_repair';

/**
 * Lifecycle of a single check result.
 * - errored: the verifier could not run (infra / startup failure) — NOT a
 *   delivery judgment. Kept distinct from `failed` so a broken verifier never
 *   reads as a rejected delivery and never seeds an auto-repair round.
 */
export type VerifyCheckResultStatus =
  'pending' | 'running' | 'passed' | 'failed' | 'errored' | 'skipped';

/** Toulmin Claim — the verifier's judgement. */
export type VerifyVerdict = 'passed' | 'failed' | 'uncertain';

/** Human feedback on a result, feeding the data flywheel. */
export type VerifyUserDecision = 'accepted' | 'rejected' | 'overridden';

// ============================================
// Acceptance — business-level delivery acceptance aggregate
// ============================================

/**
 * The product object being accepted. Kept polymorphic so the acceptance aggregate
 * is not coupled to task-only workflows: a future run can accept a topic,
 * document, artifact, release, etc. without another schema reshape.
 */
export type AcceptanceSubjectType = 'task' | 'topic' | 'document';

/**
 * Business-level acceptance state. Check-level and run-level verdicts stay in the
 * verify vocabulary (`passed` / `failed`); the aggregate exposes the user's
 * outcome language (`accepted` / `rejected`).
 *
 * `delivered`: verification settled (passed OR failed) and the aggregate now
 * waits for the user's accept/reject — the human decision closes the lifecycle,
 * the verifier's verdict is only a recommendation either way.
 */
export type AcceptanceStatus =
  | 'pending'
  | 'planned'
  | 'verifying'
  | 'repairing'
  | 'delivered'
  | 'accepted'
  | 'rejected'
  | 'errored';

/**
 * AI-generated visualization for an acceptance report (`acceptances.visual_render`).
 * One jsonb bag (not a bare text column) so generation provenance and future
 * knobs (theme, assets) never need a migration.
 *
 * The `html` payload is model-produced — viewers MUST render it inside a
 * sandboxed iframe, never inject it into the host document.
 */
export interface AcceptanceVisualRender {
  generatedAt?: string;
  /** Producer of the visualization, e.g. a model id. */
  generatedBy?: string;
  /** Self-contained HTML document filled in by the AI. */
  html: string;
}

/**
 * Acceptance policy/config snapshot. The source may be a task's `config.verify`,
 * a topic-level override, or a document acceptance rule, so it lives with the
 * generic aggregate rather than only in task types.
 */
export interface AcceptanceConfig {
  enabled?: boolean;
  maxIterations?: number;
  verifierAgentId?: string;
  verifyCriteriaIds?: string[];
  verifyRubricId?: string;
}

/**
 * User feedback addressed to a check GROUP (business category) rather than any
 * single check — the "this concern doesn't belong to a check I could reject"
 * channel. Stored on the round it judges ({@link VerifyRunDecisionDetail});
 * this is the derived view the acceptance page consumes, with `roundIndex`
 * read off that run, so the check-reject staleness rule (consumed once a
 * newer round lands) applies structurally.
 */
export interface AcceptanceGroupFeedback {
  /** The group's category label ('' targets the uncategorized bucket). */
  category: string;
  comment: string;
  /** When the feedback was written (ISO 8601). */
  createdAt: string;
  /** The round the feedback was addressed to — its run's own round index. */
  roundIndex: number;
}

/** One group-scoped feedback entry as stored on a round's decision detail. */
export type VerifyRunGroupFeedbackEntry = Omit<AcceptanceGroupFeedback, 'roundIndex'>;

/** Generic acceptance extension bag for cross-subject state we have not modeled yet. */
export interface AcceptanceMetadata {
  [key: string]: unknown;
}

/**
 * The user's per-check verdict on the acceptance union. `accept` is sticky —
 * an accepted check stays settled across later rounds; `reject` binds to the
 * round it was made on and becomes iteration history once a newer round lands.
 */
export type AcceptanceCheckReviewAction = 'accept' | 'reject';

/**
 * A user-drawn region on one evidence image, in coordinates normalized to the
 * image box (0–1) so the overlay renders at any display size.
 */
export interface AcceptanceReviewAnnotation {
  /** The note attached to this region. */
  comment?: string;
  /** The evidence row (`verify_evidence.id`) the region was drawn on. */
  evidenceId: string;
  rect: { height: number; width: number; x: number; y: number };
}

/**
 * Provenance + feedback behind a user's decision on one check result
 * (`verify_check_results.user_decision_detail`) — the check-level mirror of
 * {@link VerifyRunDecisionDetail}. The `user_decision` verb stays the queryable
 * field; this bag carries the note, the circled evidence regions, and who/when,
 * so richer feedback never needs new columns.
 */
export interface VerifyCheckDecisionDetail {
  /** Regions circled on the check's evidence images, each with its own note. */
  annotations?: AcceptanceReviewAnnotation[];
  /** Free-form feedback — for a reject, the re-tasking input of the next round. */
  comment?: string;
  /** When the decision was made (ISO 8601). */
  decidedAt?: string;
  /** Who made the decision (user id) — set when it may differ from the row owner. */
  decidedBy?: string;
  /**
   * The acceptance round that was CURRENT when the decision was made. A
   * carried-forward check's result row belongs to an older round, so the
   * result's own round cannot arbitrate staleness — a reject stands until a
   * round NEWER than this lands, regardless of which round produced the
   * judged evidence.
   */
  roundIndex?: number;
}

/**
 * Denormalized rollup of a verification round's pipeline state — mirrors the
 * legacy `agent_operations.verify_status` set so the two stay interchangeable
 * while results/reports migrate from being operation-anchored to run-anchored.
 *
 * `errored`: at least one required check errored (verifier couldn't run) and none
 * genuinely failed — verification is inconclusive, not a rejected delivery.
 */
export type VerifyRunStatus =
  | 'unverified'
  | 'planned'
  | 'verifying'
  | 'passed'
  | 'failed'
  | 'errored'
  | 'repairing'
  | 'delivered';

/**
 * What produced a verification round.
 * - agent:         verifying a real Agent Run (`verify_runs.operation_id` set)
 * - agent-testing: a standalone round ingested from the agent-testing harness
 *   (no Agent Run — `operation_id` is null)
 */
export type VerifyRunSource = 'agent' | 'agent-testing';

/**
 * The kind of thing a verification round checks. Orthogonal to `source` (which
 * records what *produced* the run): `scenario` drives how the report renders its
 * scope header and scenario-specific detail. Open-ended — new scenarios add a
 * value here plus their own {@link VerifyRunContext} shape.
 * - coding:   verifying a software change (branch / commit / surfaces under test).
 * - writing:  verifying a written deliverable (manuscript / chapters / documents).
 * - research: verifying a research deliverable (question / sources / claims).
 * - generic:  any other delivery — no modeled scope; context is an open bag.
 */
export type VerifyRunScenario = 'coding' | 'writing' | 'research' | 'generic';

/**
 * The product surface a check was exercised on — *where* it ran, never *what
 * kind* of test it was. `unit` / `backend` / `type-check` are test kinds and do
 * not belong here; a backend change verified through the CLI has surface `cli`.
 *
 * A closed set on purpose: free-form surfaces drifted into 76 distinct values
 * (long prose, runtime modes, tool names), which no viewer can render as a
 * legible badge. Runtime detail ("packaged build", "CDP dev instance") belongs
 * on the plan item's `method`, not here.
 */
export type VerifySurface = 'web' | 'desktop' | 'cli' | 'mobile' | 'bot';

/** The medium of a captured evidence artifact. */
export type VerifyEvidenceType =
  'screenshot' | 'gif' | 'video' | 'text' | 'dom_snapshot' | 'transcript';

/** Who / what captured an evidence artifact (provenance). */
export type VerifyEvidenceCapturedBy = 'agent-browser' | 'cdp' | 'cli' | 'program' | 'llm_judge';

/**
 * Provenance of a user's acceptance decision on a verify round
 * (`verify_runs.decision_detail`). One bag so the decision can carry richer
 * evidence — a note, attachments, who and when — without new columns; the
 * `verify_runs.user_decision` verb stays the queryable field.
 */
export interface VerifyRunDecisionDetail {
  /** Free-form reason, e.g. the reject note that seeds the next repair round. */
  comment?: string;
  /** When the decision was made (ISO 8601). */
  decidedAt?: string;
  /** Who made the decision (user id) — set when it may differ from the run owner. */
  decidedBy?: string;
  /** Attachments backing the decision (annotated screenshots, etc.) — FKs to files. */
  fileIds?: string[];
  /**
   * Group-scoped review feedback addressed to THIS round — concerns that
   * belong to no single check (whose checks may well be accepted) yet must
   * reach the next round. Lives here, not on the acceptance aggregate, so a
   * round carries its own feedback (and takes it along when deleted) and
   * staleness falls out of the round chain.
   */
  groupFeedback?: VerifyRunGroupFeedbackEntry[];
}

/**
 * The LobeHub conversation an ingested report was authored in. Lets the report
 * link back to (and later resume) the agent session that produced it.
 */
export interface VerifyRunOrigin {
  /** The agent that ran the verification. */
  agentId?: string;
  /** The agent operation (one execution) that produced the report. */
  operationId?: string;
  /** The topic to reopen to continue from this report. */
  topicId?: string;
}

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
 * Writing-scenario scope: what manuscript this round verified. Every field is
 * optional — the viewer renders whatever the round recorded.
 */
export interface VerifyWritingScope {
  /** Chapters covered by this round (delivered so far / in this batch). */
  chapters?: number;
  /** Documents holding the deliverable under verification. */
  documentIds?: string[];
  /** Entry point / command exercised, e.g. "lh doc export". */
  entry?: string;
  /** Genre / form of the work, e.g. "长篇小说". */
  genre?: string;
  /** When the round was executed (ISO 8601) — distinct from ingest time. */
  testedAt?: string;
  /** Word count of the manuscript under verification. */
  wordCount?: number;
  /** Title of the work under verification. */
  work?: string;
}

/** One source backing a research deliverable. */
export interface VerifyResearchSource {
  title?: string;
  url?: string;
}

/**
 * Research-scenario scope: what question the deliverable answers and what it
 * stands on.
 */
export interface VerifyResearchScope {
  /** Entry point / command exercised. */
  entry?: string;
  /** The research question the deliverable answers. */
  question?: string;
  /** Count of distinct sources consulted (when listing them all is too long). */
  sourceCount?: number;
  /** Key sources backing the deliverable. */
  sources?: VerifyResearchSource[];
  /** When the round was executed (ISO 8601) — distinct from ingest time. */
  testedAt?: string;
  /** Time range the research covers, e.g. "2024–2026". */
  timeRange?: string;
}

/**
 * Catch-all scope for scenarios without a modeled shape yet. An open bag on
 * purpose: the server stores non-coding context as-is, so a new scenario can
 * ship its own scope fields without a server change.
 */
export interface VerifyGenericScope {
  [key: string]: unknown;
  /** Entry point / command exercised. */
  entry?: string;
  /** When the round was executed (ISO 8601) — distinct from ingest time. */
  testedAt?: string;
}

/**
 * The scenario's context — its scope/provenance, discriminated by the run's
 * `scenario` (a sibling column, so the shapes need no inline discriminant).
 * Kept in one jsonb (not columns) so each scenario can carry its own shape and
 * the viewer can render per scenario without a migration.
 *
 * Distinct from the generic `metadata` bag (reserved for cross-scenario
 * extension) — `context` is specifically the active scenario's input.
 */
export type VerifyRunContext =
  VerifyCodingScope | VerifyWritingScope | VerifyResearchScope | VerifyGenericScope;

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
  /**
   * Grouping key for the acceptance union view (a page section / feature
   * domain, authored by the harness that writes the plan). Free-form label;
   * checks without one fall back to surface grouping.
   */
  category?: string;
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
  /**
   * Generation declaration: the older check-item ids THIS item replaces. The
   * acceptance union folds the superseded items into this item's iteration
   * timeline instead of listing semantically-dead checks side by side.
   */
  supersedes?: string[];
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
  /**
   * The product surface THIS item was exercised on — the acceptance union view
   * groups checks by it. Optional and per-item on purpose: the run-level
   * `context.surfaces` records where the round ran as a whole, while one round
   * routinely mixes web + cli + desktop checks. Same closed set as
   * {@link VerifySurface}; a missing value renders ungrouped.
   */
  surface?: VerifySurface;
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
 * `summary` / `content` are written by an LLM from the round's check results +
 * evidence. Tied to a verification round via `verifyRunId` (which itself
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
  /** The verification round this report summarizes. */
  verifyRunId: string;
}
