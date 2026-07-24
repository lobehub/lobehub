/**
 * Verify vocabulary — the runtime closed sets every layer agrees on (schema,
 * server, CLI, store, UI), plus the small shapes that travel with them.
 *
 * Deliberately kept here rather than in `@lobechat/types`: these are runtime
 * values, and `@lobechat/types` is replaced by a hand-written stub inside the
 * isolated desktop workspace (`apps/desktop/stubs/types`), so a value imported
 * from it is unreachable for members of that workspace — `@lobehub/cli` among
 * them. This module imports nothing, so it resolves from every workspace.
 *
 * `packages/types/src/verify.ts` declares the same unions independently (it must
 * not depend on `@lobechat/const`) and owns the domain model built on top of them
 * — plan items, Toulmin narrative, evidence, reports. The two sides are pinned
 * together by `./verify.test.ts`, which fails the type-check on any drift.
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

/**
 * Lifecycle of a single check result.
 * - errored: the verifier could not run (infra / startup failure) — NOT a
 *   delivery judgment. Kept distinct from `failed` so a broken verifier never
 *   reads as a rejected delivery and never seeds an auto-repair round.
 */
export const verifyCheckResultStatuses = [
  'pending',
  'running',
  'passed',
  'failed',
  'errored',
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
  // At least one required check errored (verifier couldn't run) and none
  // genuinely failed — verification is inconclusive, not a rejected delivery.
  'errored',
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
 * value here plus their own `VerifyRunContext` shape.
 * - coding:   verifying a software change (branch / commit / surfaces under test).
 * - writing:  verifying a written deliverable (manuscript / chapters / documents).
 * - research: verifying a research deliverable (question / sources / claims).
 * - generic:  any other delivery — no modeled scope; context is an open bag.
 */
export const verifyRunScenarios = ['coding', 'writing', 'research', 'generic'] as const;
export type VerifyRunScenario = (typeof verifyRunScenarios)[number];

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
export const verifySurfaces = ['web', 'desktop', 'cli', 'mobile', 'bot'] as const;
export type VerifySurface = (typeof verifySurfaces)[number];

/**
 * Historical spellings that name a surface in this set. Only unambiguous
 * synonyms — anything else is a rejected value, not a guess.
 */
const VERIFY_SURFACE_ALIASES: Record<string, VerifySurface> = {
  android: 'mobile',
  browser: 'web',
  electron: 'desktop',
  ios: 'mobile',
  terminal: 'cli',
};

/** Canonical surface for a raw value, or null when it names no known surface. */
export const normalizeVerifySurface = (value: string): VerifySurface | null => {
  const key = value.trim().toLowerCase();
  if ((verifySurfaces as readonly string[]).includes(key)) return key as VerifySurface;
  return VERIFY_SURFACE_ALIASES[key] ?? null;
};

/**
 * The product object being accepted. Kept polymorphic so the acceptance aggregate
 * is not coupled to task-only workflows: a future run can accept a topic,
 * document, artifact, release, etc. without another schema reshape.
 */
export const acceptanceSubjectTypes = ['task', 'topic', 'document'] as const;
export type AcceptanceSubjectType = (typeof acceptanceSubjectTypes)[number];

/**
 * Business-level acceptance state. Check-level and run-level verdicts stay in the
 * verify vocabulary (`passed` / `failed`); the aggregate exposes the user's
 * outcome language (`accepted` / `rejected`).
 */
/**
 * Who can see a verify artifact (a run's report page, an acceptance page)
 * beyond its creator. Personal-scope rows default to `public` (the page is
 * meant to be linked from PRs / reports); workspace-scope rows default to
 * `private` (org data stays member-gated until deliberately opened up).
 */
export const verifyVisibilities = ['private', 'public'] as const;
export type VerifyVisibility = (typeof verifyVisibilities)[number];

export const acceptanceVisibilities = verifyVisibilities;
export type AcceptanceVisibility = VerifyVisibility;

export const acceptanceStatuses = [
  'pending',
  'planned',
  'verifying',
  'repairing',
  // Verification settled (passed OR failed); waiting for the user's
  // accept/reject — the human decision closes the lifecycle, the verdict is a
  // recommendation either way.
  'delivered',
  'accepted',
  'rejected',
  'errored',
] as const;
export type AcceptanceStatus = (typeof acceptanceStatuses)[number];

/**
 * The user's per-check verdict on the acceptance union. `accept` is sticky —
 * an accepted check stays settled across later rounds; `reject` binds to the
 * round it was made on and becomes iteration history once a newer round lands.
 */
export const acceptanceCheckReviewActions = ['accept', 'reject'] as const;
export type AcceptanceCheckReviewAction = (typeof acceptanceCheckReviewActions)[number];

/** The medium of a captured evidence artifact. */
export const verifyEvidenceTypes = [
  'screenshot',
  'gif',
  'video',
  'text',
  // Prose evidence (root-cause write-ups, structured findings) — rendered as
  // body markdown instead of the monospace raw-text box `text` gets.
  'markdown',
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

/** Default cap on automatic repair rounds when a rubric doesn't override it. */
export const DEFAULT_MAX_REPAIR_ROUNDS = 3;

/**
 * The LobeHub conversation an ingested report was authored in. Lets the report
 * link back to (and later resume) the agent session that produced it. Lives here
 * because the CLI authors it (from the child env the runtime echoes in) before
 * any other layer sees it.
 */
export interface VerifyRunOrigin {
  /** The agent that ran the verification. */
  agentId?: string;
  /** The agent operation (one execution) that produced the report. */
  operationId?: string;
  /** The topic to reopen to continue from this report. */
  topicId?: string;
}
