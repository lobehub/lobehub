import { type BriefItem } from '@/features/DailyBrief/types';

/**
 * Within "Needs you", failures sink to the bottom: a stuck decision blocks the
 * agent right now, while a failed run has already stopped and can wait.
 */
const NEEDS_YOU_ORDER: Record<string, number> = {
  decision: 0,
  error: 9,
};

export interface SplitBriefs {
  /** Briefs the user must act on — grouped as "Needs you", errors last. */
  needsYou: BriefItem[];
  /** `insight` + `result` briefs: nothing to decide, just worth a glance. */
  news: BriefItem[];
}

/**
 * A `result` brief is a completion report: the work already happened, reading
 * it is enough. Splitting on the parent task's *runtime* status proved fragile
 * (a paused/completed recurring task flipped its whole report history back
 * into the to-do pile), so results are news unconditionally — accepting a
 * one-off delivery stays available from the task page.
 */
const isNewsBrief = (brief: BriefItem): boolean =>
  brief.type === 'insight' || brief.type === 'result';

/**
 * Splits the unresolved brief feed by whether the user has to *do* something.
 * `decision` / `error` block an agent until answered; `insight` and `result`
 * are pure knowledge and belong in a scannable list, not in a to-do pile.
 *
 * The server already sorts by priority then recency, so we only re-order within
 * "Needs you" — a stable sort keeps that ordering inside each rank.
 */
export const splitBriefs = (briefs: BriefItem[]): SplitBriefs => ({
  needsYou: briefs
    .filter((brief) => !isNewsBrief(brief))
    .sort((a, b) => (NEEDS_YOU_ORDER[a.type] ?? 5) - (NEEDS_YOU_ORDER[b.type] ?? 5)),
  news: briefs.filter(isNewsBrief),
});
