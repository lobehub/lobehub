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
  /** When each scoped weekly window resets (ms epoch), by model display name; `null` = not reported. */
  scopedWeeklyResetsAt?: Record<string, number | null>;
  /** Scoped weekly utilization by model display name, e.g. `{ Fable: 100 }`. */
  scopedWeeklyUtil?: Record<string, number>;
  /** When the session (5h) window resets, ms epoch; `null` = not reported. */
  sessionResetsAt?: number | null;
  /** Session (5h) utilization, 0..100. */
  sessionUtil?: number;
  /** When the weekly (7d) window resets, ms epoch; `null` = not reported. */
  weeklyResetsAt?: number | null;
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

/**
 * The limits that keep an enabled account from taking work right now, each as
 * the time it lifts (`null` when the provider gave none). Empty = eligible.
 */
const benchedUntil = (a: AccountLoad, opts: SelectAccountOptions): (number | null)[] => {
  const until: (number | null)[] = [];
  if (a.rateLimitedUntil != null && a.rateLimitedUntil > opts.now) until.push(a.rateLimitedUntil);
  if ((a.weeklyUtil ?? 0) >= EXHAUSTED) until.push(a.weeklyResetsAt ?? null);
  if ((a.sessionUtil ?? 0) >= EXHAUSTED)
    until.push(a.sessionResetsAt ?? a.rateLimitedUntil ?? null);
  if (opts.modelScope) {
    const scoped = a.scopedWeeklyUtil?.[opts.modelScope];
    if (scoped != null && scoped >= EXHAUSTED)
      until.push(a.scopedWeeklyResetsAt?.[opts.modelScope] ?? null);
  }
  return until;
};

const isEligible = (a: AccountLoad, opts: SelectAccountOptions): boolean =>
  a.enabled && benchedUntil(a, opts).length === 0;

const scopedHeadroom = (a: AccountLoad, modelScope?: string): number => {
  if (!modelScope) return 100;
  const scoped = a.scopedWeeklyUtil?.[modelScope];
  return scoped == null ? 100 : 100 - scoped;
};

/**
 * Every eligible account, best first. A caller that may not be able to run the
 * top pick (a device holds only some of the logins) walks this order instead
 * of asking again.
 */
export const rankAccounts = (
  candidates: AccountLoad[],
  opts: SelectAccountOptions,
): AccountLoad[] =>
  candidates
    .filter((a) => isEligible(a, opts))
    .sort((a, b) => {
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
    });

/**
 * Pick the account an agent should run on. Returns null when every candidate is
 * exhausted or cooling down (caller then queues / rolls the task over).
 */
export const selectAccount = (
  candidates: AccountLoad[],
  opts: SelectAccountOptions,
): AccountLoad | null => rankAccounts(candidates, opts)[0] ?? null;

/** Whether a set of accounts can take a run, as the balancer would see it. */
export interface AccountsAvailability {
  /** At least one account is eligible now. */
  available: boolean;
  /**
   * When none is: the earliest moment one comes back (ms epoch). Absent while
   * one is available, and when an account is benched by a limit that gives no
   * reset time — it could come back sooner than any promise made here.
   */
  resetsAt?: number;
}

/**
 * Judge `candidates` with the balancer's own eligibility rule: available when
 * `rankAccounts` would pick one of them, else when the first one frees up. A
 * benched account lifts at the latest reset among the limits that bench it.
 * A disabled account never comes back on its own, so it sets no time.
 */
export const summarizeAvailability = (
  candidates: AccountLoad[],
  opts: SelectAccountOptions,
): AccountsAvailability => {
  const enabled = candidates.filter((a) => a.enabled);
  if (enabled.some((a) => isEligible(a, opts))) return { available: true };

  const liftsAt = enabled.map((a) => {
    const until = benchedUntil(a, opts);
    return until.includes(null) ? null : Math.max(...(until as number[]));
  });
  if (liftsAt.length === 0 || liftsAt.includes(null)) return { available: false };

  return { available: false, resetsAt: Math.min(...(liftsAt as number[])) };
};
