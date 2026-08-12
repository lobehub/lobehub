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
 * Names of the repo's own automated test suites and static-analysis gates. A
 * check built on one of these is a *precondition of shipping*, not something a
 * human accepts: "138 unit tests pass" tells the reviewer nothing about whether
 * the delivery is right, and a page full of them buries the two or three checks
 * that actually needed a person to look.
 *
 * ASCII entries match on word boundaries (so `lint` never fires on `client`);
 * CJK entries match as plain substrings, which is how those words are written.
 */
const PROGRAMMATIC_TEST_PATTERNS: RegExp[] = [
  // test kinds
  /\bunit[\s-]?tests?\b/i,
  /\bintegration[\s-]?tests?\b/i,
  /\bregression[\s-]?tests?\b/i,
  /\bsnapshot[\s-]?tests?\b/i,
  /\btest[\s-]?(?:suite|case)s?\b/i,
  /\bcode coverage\b|\btest coverage\b/i,
  // "the tests pass" in its ordinary phrasings — the subject is the suite even
  // when no runner or kind is named ("All tests pass", "tests are green").
  /\btests?\s+(?:pass(?:es|ed|ing)?|(?:are\s+|is\s+)?green)\b/i,
  // runners
  /\b(?:vitest|jest|mocha|pytest|junit|rspec|phpunit|karma|ava)\b/i,
  /\b(?:npm|pnpm|yarn|bun|bunx|go|cargo|make)\s+(?:run\s+)?tests?\b/i,
  // this repo's own composite gate ("bun run check", with or without flags)
  /\b(?:npm|pnpm|yarn|bun|bunx)\s+run\s+check\b/i,
  // static analysis / build / CI gates
  /\btype[\s-]?check(?:s|ing)?\b/i,
  /\b(?:tsc|tsgo|eslint|stylelint|prettier|biome|ruff|mypy|clippy)\b/i,
  /\blint(?:s|ing)?\b/i,
  /\bcompiles?\s+(?:cleanly|without errors)\b/i,
  /\bbuild\s+(?:pass(?:es|ed)?|succeed(?:s|ed)?|(?:is\s+)?(?:green|clean))\b/i,
  /\bci\s+(?:is\s+)?(?:pass(?:es|ed|ing)?|green)\b/i,
  /\bformat(?:ting)?\s+(?:is\s+)?(?:clean|correct)\b/i,
  // Chinese
  /单元测试|单测|集成测试|回归测试|类型检查|类型校验|测试覆盖率|代码覆盖率|静态检查|测试用例全部通过/,
];

/**
 * Whether a proposed acceptance check is really one of the repo's programmatic
 * test / static-analysis gates rather than a delivery outcome a person accepts.
 *
 * Pass every field that names the check — title, category, and the plan item's
 * `method` — because the give-away is as often in the how ("run `bun run test`")
 * as in the what.
 *
 * This does NOT mean "the verifier is a program": a CLI behavior check asserted
 * by a command is a perfectly good acceptance item. It means the *subject* of
 * the check is the test suite itself.
 */
export const isProgrammaticTestCheck = (...fields: (string | null | undefined)[]): boolean => {
  const text = fields.filter(Boolean).join(' \n ');
  if (!text.trim()) return false;
  return PROGRAMMATIC_TEST_PATTERNS.some((pattern) => pattern.test(text));
};

/** Why a programmatic-test check was dropped — shared by every surface that drops one. */
export const PROGRAMMATIC_TEST_CHECK_HINT =
  'Unit / integration tests, type-checks and lint gates are preconditions of shipping, not acceptance items — they are noise on the acceptance page. Report them in the narrative (report.md) instead, and keep the checks for outcomes a person can judge.';

/**
 * The product object being accepted. Kept polymorphic so the acceptance aggregate
 * is not coupled to task-only workflows: a future run can accept a topic,
 * document, artifact, release, etc. without another schema reshape.
 */
export const acceptanceSubjectTypes = ['task', 'topic', 'document', 'standalone'] as const;
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
  'closed',
  'rejected',
  'errored',
] as const;
export type AcceptanceStatus = (typeof acceptanceStatuses)[number];

/**
 * The user's per-check verdict on the acceptance union. `accept` and `ignore`
 * are sticky — both settle the check across later rounds; `reject` binds to
 * the round it was made on and becomes iteration history once a newer round
 * lands.
 */
export const acceptanceCheckReviewActions = ['accept', 'ignore', 'reject'] as const;
export type AcceptanceCheckReviewAction = (typeof acceptanceCheckReviewActions)[number];

/**
 * Why a reviewer rejected a check. The offline baseline (LOBE-13035) found that
 * three different models converged on the same "wrong" answer for 24 of the
 * checks a human had rejected — because the reject button is the only outbound
 * channel on the page, so it carries three unrelated jobs at once. Only `unmet`
 * is learnable from the check spec; the other two are a different question
 * entirely, and folding them into one label caps how good any reviewer (human
 * or model) can look.
 *
 * - unmet:       the delivery does not satisfy THIS check
 * - new-idea:    the check passes, but the reviewer wants something different
 * - no-evidence: the evidence does not show enough to judge the check at all
 */
export const acceptanceRejectIntents = ['unmet', 'new-idea', 'no-evidence'] as const;
export type AcceptanceRejectIntent = (typeof acceptanceRejectIntents)[number];

/** What an automated reviewer proposes for a check. Deliberately narrower than
 *  the human's vocabulary: a model never proposes `ignore`, which is a statement
 *  about the reviewer's priorities rather than about the delivery. */
export const reviewPredictionActions = ['accept', 'reject'] as const;
export type ReviewPredictionAction = (typeof reviewPredictionActions)[number];

/**
 * How a review attempt ended. Split from the verdict for the same reason
 * `verify_check_results` splits `status` from `verdict`: an attempt can finish
 * without producing a judgement at all, and "no judgement" must be recorded
 * rather than inferred from a missing row.
 *
 * Without this, four different situations collapse into "no row" — the model
 * passed the check, it had no frame to look at, the call failed, or nobody ever
 * asked. Only the first is the model's opinion, so miss rate (the metric this
 * whole feature exists to move) has no denominator. A silent provider outage
 * also becomes indistinguishable from "the model approved everything".
 *
 * - judged:  the model returned a verdict; `action` is set
 * - skipped: nothing judgeable (no screenshot/GIF evidence); `action` is null
 * - errored: the call failed or its output did not parse; `action` is null
 */
export const reviewPredictionStatuses = ['judged', 'skipped', 'errored'] as const;
export type ReviewPredictionStatus = (typeof reviewPredictionStatuses)[number];

/**
 * The reviewer's verdict on a model proposal. Three-way on purpose — a flat
 * accept/dismiss would merge two opposite training signals: "you saw a problem
 * that isn't there" (the judgement was wrong) and "there IS a problem but you
 * circled the wrong thing" (the judgement was RIGHT, the grounding was wrong).
 *
 * - confirmed:    the proposal was right; it becomes a real reject
 * - not-an-issue: no problem here — negative signal on the judgement
 * - misidentified: a real problem, wrong region or wrong description —
 *   positive signal on the judgement, negative on the grounding
 */
export const reviewAdjudications = ['confirmed', 'not-an-issue', 'misidentified'] as const;
export type ReviewAdjudication = (typeof reviewAdjudications)[number];

/**
 * How closely the reviewer's submitted reject matched the proposal it started
 * from. Derived by diffing the proposal against what was actually submitted, so
 * it costs the reviewer no extra clicks — they were writing the reject anyway.
 * Each value isolates which part of the proposal was wrong.
 */
export const reviewProposalEdits = [
  'verbatim',
  'comment-edited',
  'region-moved',
  'rewritten',
] as const;
export type ReviewProposalEdit = (typeof reviewProposalEdits)[number];

/** The medium of a captured evidence artifact. */
export const verifyEvidenceTypes = [
  'screenshot',
  'gif',
  'video',
  // A delivered or captured sound: TTS output, a recorded voice reply, an
  // alert tone. Plays inline on the acceptance page — without it, audio
  // deliverables could only be published as an unplayable "text" blob.
  'audio',
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
 * Round budget applied when the user left a goal's round cap untouched.
 *
 * A goal has *two* independent budgets and they must never be written from one
 * value: this one caps the outer loop (how many task topics the goal may spawn,
 * `tasks.config.goal.maxIterations`), while {@link DEFAULT_MAX_REPAIR_ROUNDS}
 * caps the inner auto-repair loop *within* a single round
 * (`tasks.config.verify.maxIterations`). Their product is the worst-case number
 * of agent runs a goal can pay for.
 */
export const DEFAULT_GOAL_MAX_ROUNDS = 3;

/** Bounds the round budget a goal may be created with. */
export const GOAL_MAX_ROUNDS_RANGE = { max: 10, min: 2 } as const;

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
