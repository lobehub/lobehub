import { type BriefItem } from '@/features/DailyBrief/types';

/**
 * Within "Needs you", failures sink to the bottom: a stuck decision blocks the
 * agent right now, while a failed run has already stopped and can wait.
 */
const NEEDS_YOU_ORDER: Record<string, number> = {
  decision: 0,
  error: 9,
  result: 1,
};

export interface SplitBriefs {
  /** Briefs the user must act on — grouped as "Needs you", errors last. */
  needsYou: BriefItem[];
  /** `insight` briefs: nothing to decide, just worth a glance. */
  news: BriefItem[];
}

/**
 * Results belonging to scheduled tasks are recurring reports, including an
 * ad-hoc "Run now" invocation. They remain `result` briefs, but reading the
 * report is enough — they do not require explicit acceptance.
 */
const isNewsBrief = (brief: BriefItem): boolean =>
  brief.type === 'insight' || (brief.type === 'result' && brief.taskStatus === 'scheduled');

/**
 * Splits the unresolved brief feed by whether the user has to *do* something.
 * `decision` / one-off `result` / `error` block an agent until answered;
 * `insight` and recurring-run results are pure knowledge and belong in a
 * scannable list, not in a to-do pile.
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
