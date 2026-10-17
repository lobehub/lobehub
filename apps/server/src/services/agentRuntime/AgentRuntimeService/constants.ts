/** Tries for a client wait's notice or expiry error on the assistant row. */
export const CLIENT_WAIT_ROW_WRITE_ATTEMPTS = 3;

/**
 * Base delay before the first `verifyAsyncToolBarrier` re-check fires after a
 * sub-agent completion found the parent not yet resumable. Long enough for
 * the parent's parking step to finish persisting, short enough that a lost
 * resume is recovered promptly. Subsequent attempts back off exponentially —
 * see {@link asyncToolVerifyDelayMs}.
 */
export const ASYNC_TOOL_VERIFY_DELAY_MS = 15_000;

/**
 * Maximum number of bounded watchdog re-checks armed per parked parent. The
 * watchdog re-arms after each unsatisfied check (instead of the old single
 * shot) so a transient miss — a read-replica lag, a sibling dying between
 * backfill and resume — is retried rather than leaving the parent stuck in
 * `waiting_for_async_tool` forever. With exponential backoff from a 15s base,
 * 5 attempts span ~15s → ~7.75min total before giving up. For details see: async sub-agent suspend/resume stability hardening — bounded watchdog retry with exponential backoff instead of single-shot verification.
 */
export const ASYNC_TOOL_VERIFY_MAX_ATTEMPTS = 5;

/** Hard ceiling on a single backoff delay so late attempts don't overshoot. */
export const ASYNC_TOOL_VERIFY_MAX_DELAY_MS = 240_000;

export const STEP_LOCK_TTL_SECONDS = 120;
/**
 * How often a live step re-reads its own operation state to notice an
 * interrupt. Interrupts are persisted by a different invocation, so this poll
 * is the only way a running tool learns it should stop.
 */
export const STEP_ABORT_POLL_INTERVAL_MS = 2_000;
/**
 * Temporary compatibility cadence for interrupts written by pre-sentinel
 * workers during a rolling deployment. Remove after every worker writes the
 * sentinel; keeping this much slower than the sentinel poll preserves most of
 * the Redis bandwidth reduction in the meantime.
 */
export const LEGACY_INTERRUPT_STATE_POLL_INTERVAL_MS = 30_000;
/** Cap on the exponential backoff multiplier after consecutive poll failures. */
export const STEP_ABORT_POLL_MAX_BACKOFF = 8;
export const STEP_LOCK_HEARTBEAT_MS = 30_000;
export const DURABLE_LEASE_HEARTBEAT_EVERY_TICKS = 3;
/**
 * How long a `running` operation's durable lease may go unrefreshed, with its
 * runtime state gone, before a stop request treats it as dead. Far above the
 * heartbeat cadence (STEP_LOCK_HEARTBEAT_MS × DURABLE_LEASE_HEARTBEAT_EVERY_TICKS).
 */
export const DEAD_OPERATION_LEASE_MS = 10 * 60 * 1000;
export const EVAL_TOOL_FORWARDING_HOOK_ID = 'eval-tool-forwarding';
export const INTERVENTION_LIFECYCLE_CHECKPOINT_KEY = '_agentInterventionLifecycle';

/**
 * How many times a delivery that lost the operation lock re-queues itself
 * before giving up and falling back to a retryable response.
 */
export const STEP_LOCK_RETRY_MAX_ATTEMPTS = 12;
/** Base delay for the first lock-conflict re-delivery. */
export const STEP_LOCK_RETRY_BASE_DELAY_MS = 15_000;
/**
 * Ceiling on a single lock-conflict backoff. Together with the base delay,
 * {@link STEP_LOCK_RETRY_MAX_ATTEMPTS} attempts span ~20 minutes — comfortably
 * longer than the platform's hard step ceiling, so a step that legitimately
 * holds the lock for minutes no longer strands the delivery waiting behind it.
 */
export const STEP_LOCK_RETRY_MAX_DELAY_MS = 120_000;
