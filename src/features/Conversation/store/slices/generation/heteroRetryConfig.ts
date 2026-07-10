/**
 * Auto-retry policy for heterogeneous-agent (Claude Code / Codex) "overloaded"
 * errors. The upstream model service throttles transiently ("not your usage
 * limit") and clears on its own in moments, so instead of leaving the user to
 * click retry we schedule a capped, backed-off auto-retry. Only the
 * `overloaded` error code opts in — `auth_required` (needs a human) and
 * `rate_limit` (has a real reset window) never auto-retry.
 */

/** Maximum number of automatic retries before falling back to manual retry. */
export const MAX_HETERO_AUTO_RETRIES = 5;

/**
 * Backoff (seconds) before each auto-retry, indexed by the attempt count
 * already spent. The last value is reused if attempts exceed the array length.
 * Jitter is layered on at schedule time so concurrent sessions don't retry in
 * lockstep against an already-struggling upstream.
 */
export const HETERO_OVERLOAD_BACKOFF_SECONDS = [2, 5, 10, 20, 30] as const;

/** ±ratio of random jitter applied to each backoff window. */
export const HETERO_OVERLOAD_BACKOFF_JITTER = 0.2;
