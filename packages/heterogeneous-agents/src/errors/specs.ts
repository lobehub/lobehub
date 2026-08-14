import type {
  HeteroErrorAttribution,
  HeteroErrorCategory,
  HeteroErrorSeverity,
  HeteroGuideCode,
} from './taxonomy';

/**
 * Every failure kind a heterogeneous run can be classified into.
 *
 * Naming is behavioral, not textual: `usage_limit` is "the user's plan window
 * is exhausted", regardless of whether the CLI said `You've hit your session
 * limit`, `weekly limit`, or a gateway localized it to `已达到 5 小时使用上限`.
 */
export type HeteroErrorKind =
  // auth
  | 'auth_required'
  // quota
  | 'usage_limit'
  | 'credit_limit'
  // capacity
  | 'server_overloaded'
  | 'server_throttle'
  // request
  | 'invalid_request'
  | 'unsupported_attachment'
  // network
  | 'network_drop'
  // lifecycle
  | 'aborted'
  | 'max_turns'
  // session
  | 'resume_thread_not_found'
  | 'resume_cwd_mismatch'
  // environment
  | 'cli_not_found'
  | 'working_directory_not_found'
  // provider
  | 'model_unavailable'
  | 'agent_failed';

export interface HeteroErrorSpec {
  attribution: HeteroErrorAttribution;
  category: HeteroErrorCategory;
  /** Whether this kind counts toward operational failure metrics. */
  countAsFailure: boolean;
  /** Short English description for dashboards / docs. */
  description: string;
  /**
   * The coarse code emitted on the wire so the client renders a dedicated
   * status guide. Absent → the generic error card shows the message verbatim,
   * which is only acceptable when that message explains itself.
   */
  guideCode?: HeteroGuideCode;
  /**
   * Marks a catch-all bucket. Monitoring tracks its volume to decide when a
   * finer kind is worth carving out — this is exactly how `agent_failed` went
   * from 53% of all real errors to ~3%.
   */
  isFallback?: boolean;
  kind: HeteroErrorKind;
  /** Stable identifier surfaced as `H<numericId>`. Append-only. */
  numericId: number;
  /** Whether an automatic retry of the same run is worth attempting. */
  retryable: boolean;
  severity: HeteroErrorSeverity;
}

/**
 * Single source of truth for heterogeneous run failures.
 *
 * To add a kind:
 *   1. Add it to `HeteroErrorKind` above.
 *   2. Add a spec entry here with the next free `numericId` in its category.
 *   3. Teach a classifier to produce it (`../adapters/*.ts` for in-stream
 *      failures, `../spawn/classifyProcessFailure.ts` for pre-stream ones).
 *   4. If it needs a dedicated card, give it a `guideCode` AND register that
 *      code in the two status-guide sets named in `./taxonomy`.
 */
export const HETERO_ERROR_SPECS: Record<HeteroErrorKind, HeteroErrorSpec> = {
  // ─── 1xxx Auth ────────────────────────────────────────────────────────
  auth_required: {
    attribution: 'user',
    category: 'auth',
    countAsFailure: false,
    description:
      'The CLI has no usable credentials — never signed in, or the token was rejected/expired.',
    guideCode: 'auth_required',
    kind: 'auth_required',
    numericId: 1001,
    retryable: false,
    severity: 'warning',
  },

  // ─── 2xxx Quota ───────────────────────────────────────────────────────
  usage_limit: {
    attribution: 'user',
    category: 'quota',
    countAsFailure: false,
    description:
      "The user's plan window is exhausted and carries a concrete reset time (5-hour / session / weekly).",
    guideCode: 'rate_limit',
    kind: 'usage_limit',
    numericId: 2001,
    retryable: false,
    severity: 'warning',
  },
  credit_limit: {
    attribution: 'user',
    category: 'quota',
    countAsFailure: false,
    description:
      'Credits or balance for the selected model are exhausted; resolved by topping up or switching model, not by waiting.',
    guideCode: 'rate_limit',
    kind: 'credit_limit',
    numericId: 2002,
    retryable: false,
    severity: 'warning',
  },

  // ─── 3xxx Capacity ────────────────────────────────────────────────────
  server_overloaded: {
    attribution: 'provider',
    category: 'capacity',
    countAsFailure: true,
    description: 'Upstream returned 5xx / overloaded_error. Momentary; the same request may pass.',
    guideCode: 'overloaded',
    kind: 'server_overloaded',
    numericId: 3001,
    retryable: true,
    severity: 'warning',
  },
  server_throttle: {
    attribution: 'provider',
    category: 'capacity',
    countAsFailure: true,
    description:
      'Provider-side transient throttle: a 429 that explicitly disclaims the plan limit ("not your usage limit"). Clears on its own.',
    guideCode: 'overloaded',
    kind: 'server_throttle',
    numericId: 3002,
    retryable: true,
    severity: 'warning',
  },

  // ─── 4xxx Request ─────────────────────────────────────────────────────
  invalid_request: {
    attribution: 'harness',
    category: 'request',
    countAsFailure: true,
    description:
      'Upstream rejected the request as malformed (400) — e.g. a tool-use id that fails schema validation. Retrying is futile.',
    kind: 'invalid_request',
    numericId: 4001,
    retryable: false,
    severity: 'error',
  },
  unsupported_attachment: {
    attribution: 'user',
    category: 'request',
    countAsFailure: false,
    description: 'An attached file could not be decoded or is an unsupported format.',
    kind: 'unsupported_attachment',
    numericId: 4002,
    retryable: false,
    severity: 'warning',
  },

  // ─── 5xxx Network ─────────────────────────────────────────────────────
  network_drop: {
    attribution: 'system',
    category: 'network',
    countAsFailure: true,
    description:
      'The connection reset, refused, stalled, or timed out mid-run. Shares the retry contract with a capacity failure, so it reports the `overloaded` guide code.',
    guideCode: 'overloaded',
    kind: 'network_drop',
    numericId: 5001,
    retryable: true,
    severity: 'warning',
  },

  // ─── 6xxx Lifecycle ───────────────────────────────────────────────────
  aborted: {
    attribution: 'user',
    category: 'lifecycle',
    countAsFailure: false,
    description:
      'The run was stopped before finishing (the user pressed stop). The CLI flags the result `is_error` while exiting 0, but it is an outcome, not a fault — so it does NOT terminate as an error: it ends as `agent_runtime_end { reason: "interrupted" }`, leaving the topic neutral with no error card, no unread badge, and no completion notification.',
    kind: 'aborted',
    numericId: 6001,
    retryable: false,
    severity: 'info',
  },
  max_turns: {
    attribution: 'harness',
    category: 'lifecycle',
    countAsFailure: true,
    description: 'The run hit its configured maximum number of turns and stopped short.',
    kind: 'max_turns',
    numericId: 6002,
    retryable: false,
    severity: 'warning',
  },

  // ─── 7xxx Session ─────────────────────────────────────────────────────
  resume_thread_not_found: {
    attribution: 'harness',
    category: 'session',
    countAsFailure: true,
    description:
      'The `--resume` id no longer exists in the CLI\'s local store ("No conversation found with session ID"). Recovered by rebuilding the transcript or starting a fresh session.',
    kind: 'resume_thread_not_found',
    numericId: 7001,
    retryable: false,
    severity: 'warning',
  },
  resume_cwd_mismatch: {
    attribution: 'harness',
    category: 'session',
    countAsFailure: true,
    description:
      'Resume was attempted from a different working directory than the one that created the session.',
    kind: 'resume_cwd_mismatch',
    numericId: 7002,
    retryable: false,
    severity: 'warning',
  },

  // ─── 8xxx Environment ─────────────────────────────────────────────────
  cli_not_found: {
    attribution: 'user',
    category: 'environment',
    countAsFailure: false,
    description:
      'The agent CLI is not installed or not executable on the machine running the run (`spawn <cmd> ENOENT`).',
    guideCode: 'cli_not_found',
    kind: 'cli_not_found',
    numericId: 8001,
    retryable: false,
    severity: 'warning',
  },
  working_directory_not_found: {
    attribution: 'user',
    category: 'environment',
    countAsFailure: false,
    description:
      'The configured working directory was removed or is otherwise no longer available before the CLI could start.',
    guideCode: 'working_directory_not_found',
    kind: 'working_directory_not_found',
    numericId: 8002,
    retryable: false,
    severity: 'warning',
  },

  // ─── 9xxx Provider ────────────────────────────────────────────────────
  model_unavailable: {
    attribution: 'provider',
    category: 'provider',
    countAsFailure: true,
    description:
      'The selected model is withdrawn, gated, or temporarily unavailable. Resolved by switching model, not by retrying.',
    kind: 'model_unavailable',
    numericId: 9001,
    retryable: false,
    severity: 'warning',
  },
  agent_failed: {
    attribution: 'harness',
    category: 'provider',
    countAsFailure: true,
    description:
      'Catch-all: the run failed with a reason no classifier claimed. Volume here is the signal for which kind to carve out next.',
    isFallback: true,
    kind: 'agent_failed',
    numericId: 9002,
    retryable: false,
    severity: 'error',
  },
};

/** Formatted stable id, e.g. `H2001`. */
export const formatHeteroErrorId = (kind: HeteroErrorKind): string =>
  `H${HETERO_ERROR_SPECS[kind].numericId}`;

export const getHeteroErrorSpec = (kind: string): HeteroErrorSpec | undefined =>
  HETERO_ERROR_SPECS[kind as HeteroErrorKind];

/**
 * True when the failure is an expected user-side or user-initiated outcome and
 * should be excluded from operational failure metrics.
 */
export const isUserSideHeteroError = (kind: string): boolean =>
  getHeteroErrorSpec(kind)?.countAsFailure === false;
