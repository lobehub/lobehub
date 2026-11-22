import type { GoalListItem } from '@/store/goal/initialState';

/** The search box's text as the matcher reads it: trimmed and lower-cased. */
export const normalizeGoalKeyword = (keyword: string): string => keyword.trim().toLowerCase();

/**
 * The goals page's search: keep the rows whose title or requirement contains
 * every whitespace-separated term, case-insensitively. A blank keyword keeps
 * every row (the same array, so memoized consumers do not re-render).
 */
export const filterGoalsByKeyword = <T extends Pick<GoalListItem, 'goal'>>(
  items: T[],
  keyword: string,
): T[] => {
  const terms = normalizeGoalKeyword(keyword).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;

  return items.filter(({ goal }) => {
    const haystack = `${goal.title}\n${goal.requirement ?? ''}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
};
