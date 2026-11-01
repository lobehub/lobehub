import { HOME_FEED_EXCLUDED_BRIEF_TYPES, NEWS_BRIEF_TYPES } from '@lobechat/types';

import { briefPriorityRank } from '@/features/DailyBrief/briefPriority';
import { type BriefItem } from '@/features/DailyBrief/types';

export interface SplitBriefs {
  /** Briefs the user must decide on — grouped as "Needs you". */
  needsYou: BriefItem[];
  /** `insight` + `result` briefs: nothing to decide, just worth a glance. */
  news: BriefItem[];
}

/**
 * A `result` brief is a completion report: the work already happened, reading
 * it is enough. Splitting on the parent task's *runtime* status proved fragile
 * (a paused/completed recurring task flipped its whole report history back
 * into the to-do pile), so results are news by *type*, never by task status.
 * The one exception is the brief's own priority: an unresolved `urgent` result
 * is promoted into "Needs you" (see `isPromotedNews`), where its card offers the
 * same approve action as the task page — approving it there completes a
 * one-off task, while a recurring run's occurrence is only dismissed.
 */
const isNewsBrief = (brief: BriefItem): boolean => NEWS_BRIEF_TYPES.includes(brief.type);

/**
 * An unresolved `urgent` news brief is the agent saying "look at this now" —
 * it waits in "Needs you" until handled instead of sinking into a digest the
 * user may only skim. Once resolved it is plain news again.
 */
const isPromotedNews = (brief: BriefItem): boolean =>
  isNewsBrief(brief) && !brief.resolvedAt && brief.priority === 'urgent';

/**
 * Splits the unresolved brief feed by whether the user has to *act on*
 * something. `decision` briefs block an agent until answered, and an urgent
 * `insight` / `result` is promoted beside them; the rest of `insight` and
 * `result` are pure knowledge and belong in a scannable list, not in a to-do
 * pile. Run failures are not decisions — they live in the notification center,
 * so legacy `error` briefs are dropped here too (the server already filters
 * them; this keeps stale caches from showing them).
 *
 * The server already sorts by priority then recency; the filter keeps that order.
 */
export const splitBriefs = (briefs: BriefItem[]): SplitBriefs => ({
  needsYou: briefs.filter(
    (brief) =>
      // A successful optimistic resolve stamps the row before the unresolved-list
      // SWR cache revalidates. Hide it immediately so "Ignore" actually closes the
      // card instead of leaving a resolved tombstone in the queue until remount.
      !brief.resolvedAt &&
      (!isNewsBrief(brief) || isPromotedNews(brief)) &&
      !HOME_FEED_EXCLUDED_BRIEF_TYPES.includes(brief.type),
  ),
  news: briefs.filter((brief) => isNewsBrief(brief) && !isPromotedNews(brief)),
});

/**
 * Arranges one day of the news digest against the unresolved feed.
 *
 * - The feed is the fresher copy of any brief both hold (an optimistic resolve
 *   or read lands there first), so its read/resolve stamps win.
 * - A brief promoted into "Needs you" leaves the digest, so it never shows twice;
 *   only promotions the feed actually carries are dropped — one missing from it
 *   (still loading, past its cap) stays visible here rather than nowhere.
 * - Within the day, urgent leads, then normal, then info; a stable sort keeps
 *   the server's newest-first order inside each level.
 */
export const arrangeDayNews = (dayNews: BriefItem[], feed: BriefItem[]): BriefItem[] => {
  const feedById = new Map(feed.map((brief) => [brief.id, brief]));

  return dayNews
    .map((brief) => {
      const fresh = feedById.get(brief.id);
      if (!fresh) return brief;
      return {
        ...brief,
        readAt: fresh.readAt ?? brief.readAt,
        resolvedAction: fresh.resolvedAction ?? brief.resolvedAction,
        resolvedAt: fresh.resolvedAt ?? brief.resolvedAt,
      };
    })
    .filter((brief) => !(feedById.has(brief.id) && isPromotedNews(brief)))
    .sort((a, b) => briefPriorityRank(a.priority) - briefPriorityRank(b.priority));
};
