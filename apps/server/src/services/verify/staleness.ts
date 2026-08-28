/**
 * How long a run may sit in `verifying` before we treat the attempt that put it
 * there as gone.
 *
 * Verification is started as post-response work (see `runVerifyOnCompletion`'s
 * caller): the run is flipped to `verifying` by a durable write, but the judging
 * that would flip it back lives in a promise the host may stop scheduling at any
 * point. That asymmetry is what strands a run — `verifying` forever, with no
 * retry able to re-enter and no watchdog looking. Both the re-entry claim and
 * the sweep read the same two thresholds so "abandoned" means one thing.
 */

/**
 * Grace before the sweep touches a run whose required checks have all landed.
 *
 * Nothing needs judging in that state — only the rollup was lost — so the sweep
 * could act immediately. It waits anyway: the finalizer of a still-live attempt
 * runs within seconds of the last verdict, and letting the sweep in during that
 * window would race it into spawning a second repair round.
 */
export const VERIFY_ROLLUP_GRACE_MS = 5 * 60 * 1000;

/**
 * How long a run with checks still pending/running is given before its verifier
 * is presumed dead and the outstanding checks are closed as `errored`.
 *
 * Generous on purpose: an agent verifier is a full sub-agent run. Checks bound
 * to a verifier operation that is still live are skipped regardless of age, so
 * this bound only has to cover inline (LLM / program) judging.
 */
export const VERIFY_ABANDONED_MS = 30 * 60 * 1000;
