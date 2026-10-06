import type { AcceptanceCheck, AcceptanceCheckState } from './types';

export const CHECK_GROUPING_THRESHOLD = 10;

/** Small checklists stay flat; grouping only earns its hierarchy once the list grows beyond 10. */
export const shouldGroupChecks = (checkCount: number) => checkCount > CHECK_GROUPING_THRESHOLD;

/** The user's standing verdict on a check — `pending` means "awaiting your confirmation". */
export type UserReviewState = 'accepted' | 'ignored' | 'pending' | 'rejected';

export const userReviewState = (check: AcceptanceCheck): UserReviewState => {
  const review = check.userReview;
  if (!review || review.stale) return 'pending';
  if (review.action === 'accept') return 'accepted';
  if (review.action === 'ignore') return 'ignored';
  return 'rejected';
};

/** A successful review decision moves the reviewer forward by folding the finished row. */
export const shouldCollapseAfterReview = (succeeded: boolean, expanded: boolean): boolean =>
  succeeded && expanded;

/** Every reviewable check in the group is user-accepted — settled business. */
export const isGroupFullyAccepted = (checks: AcceptanceCheck[]): boolean => {
  const reviewable = checks.filter((check) => check.result);
  return (
    reviewable.length > 0 && reviewable.every((check) => userReviewState(check) === 'accepted')
  );
};

/** Unresolved-first ordering — exceptions are what the decision hinges on. */
export const SEVERITY: Record<AcceptanceCheckState, number> = {
  failed: 0,
  not_executed: 2,
  passed: 3,
  uncertain: 1,
};

export const isException = (check: AcceptanceCheck) =>
  check.state === 'failed' || check.state === 'uncertain';

export type CheckFilter = 'all' | 'pending' | 'needsFix' | 'accepted' | 'ignored';

export const checkFilterState = (check: AcceptanceCheck): Exclude<CheckFilter, 'all'> => {
  const review = userReviewState(check);
  if (review === 'accepted') return 'accepted';
  if (review === 'ignored') return 'ignored';
  if (review === 'rejected') return 'needsFix';
  return 'pending';
};

/** Keep the verifier's result separate from the user's acceptance workflow state. */
export const focusedCheckStates = (check: AcceptanceCheck) => ({
  review: checkFilterState(check),
  verifier: check.state,
  verifierLabel: check.state === 'not_executed' ? ('notExecuted' as const) : check.state,
});

interface CheckGroup {
  checks: AcceptanceCheck[];
  key: string;
  label: string;
}

/**
 * Group by the harness-authored business `category`. Product surfaces describe
 * where a check ran, not what user requirement it verifies, so they must never
 * become acceptance sections.
 */
export const groupChecks = (checks: AcceptanceCheck[], otherLabel: string): CheckGroup[] => {
  const groups = new Map<string, CheckGroup>();
  for (const check of checks) {
    const category = check.category?.trim();
    const key = category ? `category:${category}` : 'uncategorized';
    const label = category || otherLabel;
    const group = groups.get(key) ?? { checks: [], key, label };
    group.checks.push(check);
    groups.set(key, group);
  }
  return [...groups.values()];
};
