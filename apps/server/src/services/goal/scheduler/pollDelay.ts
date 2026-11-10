const BASE_POLL_DELAY_S = 5;
const MAX_POLL_DELAY_S = 60;

/**
 * Seconds until the next poll of something that has not settled yet. Grows with
 * the time already waited, so a late answer is noticed within about a tenth of
 * that wait while a wait that never ends costs one advance a minute.
 *
 * Derived from when the wait began instead of a retry counter: parallel advances
 * and lost messages cannot skew it, and it needs no state of its own.
 */
export const goalPollDelay = (waitingSince?: Date | string, now = Date.now()): number => {
  const elapsedMs = waitingSince ? now - new Date(waitingSince).getTime() : Number.NaN;
  if (!Number.isFinite(elapsedMs)) return BASE_POLL_DELAY_S;
  return Math.min(MAX_POLL_DELAY_S, Math.max(BASE_POLL_DELAY_S, Math.ceil(elapsedMs / 10_000)));
};
