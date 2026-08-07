/**
 * Account load balancing.
 *
 * Two rules come straight from the calibration data, not intuition:
 *  1. The *weekly* budget is the real bottleneck — a week holds ~33 five-hour
 *     windows but the weekly allowance only covers ~4.5 full ones. So ranking
 *     is weekly-headroom-first; session headroom is only a tie-breaker.
 *  2. Scoped limits are independent — an account can have weekly headroom while
 *     its Fable-scoped weekly is exhausted. Model-scoped work must avoid an
 *     account whose matching scope is spent, even if its overall weekly is fine.
 */

/** Utilization (0..100) of one account's currently-active windows. */
export interface AccountLoad {
  accountId: string;
  enabled: boolean;
  priority: number;
  /** ms epoch until which the account is cooling down after a 429, if any. */
  rateLimitedUntil?: number | null;
  /** Scoped weekly utilization by model display name, e.g. `{ Fable: 100 }`. */
  scopedWeeklyUtil?: Record<string, number>;
  /** Session (5h) utilization, 0..100. */
  sessionUtil?: number;
  /** Weekly (7d) utilization, 0..100. */
  weeklyUtil?: number;
}

export interface SelectAccountOptions {
  /** Model display name whose scoped weekly must be respected (e.g. `Fable`). */
  modelScope?: string;
  now: number;
}

/** A limit is treated as exhausted at/above this utilization. */
const EXHAUSTED = 100;

const isEligible = (a: AccountLoad, opts: SelectAccountOptions): boolean => {
  if (!a.enabled) return false;
  if (a.rateLimitedUntil != null && a.rateLimitedUntil > opts.now) return false;
  if ((a.weeklyUtil ?? 0) >= EXHAUSTED) return false;
  if ((a.sessionUtil ?? 0) >= EXHAUSTED) return false;
  if (opts.modelScope) {
    const scoped = a.scopedWeeklyUtil?.[opts.modelScope];
    if (scoped != null && scoped >= EXHAUSTED) return false;
  }
  return true;
};

const scopedHeadroom = (a: AccountLoad, modelScope?: string): number => {
  if (!modelScope) return 100;
  const scoped = a.scopedWeeklyUtil?.[modelScope];
  return scoped == null ? 100 : 100 - scoped;
};

/**
 * Pick the account an agent should run on. Returns null when every candidate is
 * exhausted or cooling down (caller then queues / rolls the task over).
 */
export const selectAccount = (
  candidates: AccountLoad[],
  opts: SelectAccountOptions,
): AccountLoad | null => {
  const eligible = candidates.filter((a) => isEligible(a, opts));
  if (eligible.length === 0) return null;

  return eligible.sort((a, b) => {
    // 1) weekly headroom (the bottleneck) — more is better
    const weekly = 100 - (a.weeklyUtil ?? 0) - (100 - (b.weeklyUtil ?? 0));
    if (weekly !== 0) return -weekly;
    // 2) scoped headroom for the requested model
    const scoped = scopedHeadroom(a, opts.modelScope) - scopedHeadroom(b, opts.modelScope);
    if (scoped !== 0) return -scoped;
    // 3) session headroom
    const session = 100 - (a.sessionUtil ?? 0) - (100 - (b.sessionUtil ?? 0));
    if (session !== 0) return -session;
    // 4) explicit priority (lower first)
    return a.priority - b.priority;
  })[0];
};
