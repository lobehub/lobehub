/**
 * Account load balancing.
 *
 * Candidates are only ever the accounts an agent is authorized to schedule
 * (its enabled `pool` bindings); the caller passes that set and anything
 * outside it is dropped here too, so a stray load view can never be picked.
 *
 * Ranking, best first — every key is deterministic, so the same inputs always
 * give the same order:
 *  1. Health tier. An account whose weekly (or the requested model's scoped
 *     weekly) utilization is at/above {@link LOW_HEADROOM_UTIL} only runs when
 *     no healthier account is left. The weekly budget is the real bottleneck —
 *     a week holds ~33 five-hour windows but the allowance covers ~4.5 full
 *     ones — so rotating onto a nearly spent week would just burn it out.
 *  2. Least recently selected (never-selected first). This is the rotation:
 *     consecutive runs of one agent cycle through its healthy accounts, and
 *     concurrent runs spread across them because the server serializes each
 *     agent's selections and stamps the winner before the next one ranks.
 *  3. Weekly headroom, then the requested model's scoped headroom, then
 *     session headroom — more is better.
 *  4. Explicit priority (lower first), then account id (stable tie-break).
 *
 * Exhausted (100%) limits, a 429 cooldown, a disabled account or binding, and
 * a scoped limit spent for the requested model make an account ineligible.
 */

/** Utilization (0..100) of one account's currently-active windows. */
export interface AccountLoad {
  accountId: string;
  enabled: boolean;
  /**
   * ms epoch this agent's load balancer last picked the account (per agent, so
   * two agents sharing an account rotate independently). `null` = never.
   */
  lastSelectedAt?: number | null;
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
  /**
   * The accounts the agent is authorized to schedule. When given, a candidate
   * outside it is never eligible, whatever its load.
   */
  authorizedAccountIds?: Iterable<string>;
  /** Model display name whose scoped weekly must be respected (e.g. `Fable`). */
  modelScope?: string;
  now: number;
}

/** A limit is treated as exhausted at/above this utilization. */
const EXHAUSTED = 100;

/** Weekly (or requested scoped weekly) utilization from which an account is a last resort. */
export const LOW_HEADROOM_UTIL = 90;

const isEligible = (
  a: AccountLoad,
  opts: SelectAccountOptions,
  authorized: Set<string> | undefined,
): boolean => {
  if (authorized && !authorized.has(a.accountId)) return false;
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

const scopedUtil = (a: AccountLoad, modelScope?: string): number =>
  (modelScope && a.scopedWeeklyUtil?.[modelScope]) || 0;

/** 0 = healthy, 1 = low headroom (only used when nothing healthier is left). */
const healthTier = (a: AccountLoad, modelScope?: string): number =>
  (a.weeklyUtil ?? 0) >= LOW_HEADROOM_UTIL || scopedUtil(a, modelScope) >= LOW_HEADROOM_UTIL
    ? 1
    : 0;

/**
 * Every eligible account, best first (see the module comment for the keys).
 * A caller that may not be able to run the top pick (a device holds only some
 * of the logins) walks this order instead of asking again.
 */
export const rankAccounts = (
  candidates: AccountLoad[],
  opts: SelectAccountOptions,
): AccountLoad[] => {
  const authorized = opts.authorizedAccountIds ? new Set(opts.authorizedAccountIds) : undefined;

  return candidates
    .filter((a) => isEligible(a, opts, authorized))
    .sort((a, b) => {
      // 1) health tier — a nearly spent week is a last resort
      const tier = healthTier(a, opts.modelScope) - healthTier(b, opts.modelScope);
      if (tier !== 0) return tier;
      // 2) least recently selected first (never selected = oldest)
      const recency = (a.lastSelectedAt ?? -Infinity) - (b.lastSelectedAt ?? -Infinity);
      if (recency !== 0 && !Number.isNaN(recency)) return recency;
      // 3) weekly headroom (the bottleneck), scoped headroom, session headroom
      const weekly = (a.weeklyUtil ?? 0) - (b.weeklyUtil ?? 0);
      if (weekly !== 0) return weekly;
      const scoped = scopedUtil(a, opts.modelScope) - scopedUtil(b, opts.modelScope);
      if (scoped !== 0) return scoped;
      const session = (a.sessionUtil ?? 0) - (b.sessionUtil ?? 0);
      if (session !== 0) return session;
      // 4) explicit priority (lower first), then a stable id tie-break
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0;
    });
};

/**
 * Pick the account an agent should run on. Returns null when every candidate is
 * unauthorized, exhausted or cooling down (caller then queues / rolls the task
 * over, or runs on the default login).
 */
export const selectAccount = (
  candidates: AccountLoad[],
  opts: SelectAccountOptions,
): AccountLoad | null => rankAccounts(candidates, opts)[0] ?? null;

/**
 * Assign `count` runs of one agent the way the server does when they arrive
 * together: one selection at a time, each stamping its pick's
 * `lastSelectedAt` before the next ranks. Pure model of the serialized
 * selection, used to reason about (and test) how concurrent runs spread.
 * Returns one entry per run; `null` when nothing was eligible.
 */
export const assignAccounts = (
  candidates: AccountLoad[],
  count: number,
  opts: SelectAccountOptions,
): (string | null)[] => {
  let loads = candidates.map((c) => ({ ...c }));
  const picks: (string | null)[] = [];
  for (let i = 0; i < count; i++) {
    const at = opts.now + i;
    const chosen = selectAccount(loads, { ...opts, now: at });
    picks.push(chosen?.accountId ?? null);
    if (chosen)
      loads = loads.map((l) =>
        l.accountId === chosen.accountId ? { ...l, lastSelectedAt: at } : l,
      );
  }
  return picks;
};
