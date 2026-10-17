import { useCallback, useMemo } from 'react';

import { useGlobalStore } from '@/store/global';

import type { GoalClarificationGroup } from './usePendingGoalClarifications';

/**
 * Old keys point at asks long since answered, so only the newest ones are worth
 * keeping. The cap holds the array's length steady once reached:
 * `updateSystemStatus` merges arrays by index and could never shrink it.
 */
export const MAX_DISMISSED_ISLAND_KEYS = 200;

export const appendDismissedIslandKey = (current: string[], key: string): string[] =>
  current.includes(key) ? current : [...current, key].slice(-MAX_DISMISSED_ISLAND_KEYS);

/**
 * A clarification round is keyed by its questions, not just its goal: waving
 * off one round must not hide the next round the same goal asks.
 */
export const goalClarificationIslandKey = (group: GoalClarificationGroup): string =>
  `goal-clarify:${group.goalId}:${group.questions.map((q) => q.decisionId).join(',')}`;

/**
 * Asks the user put away from the island. Dismissing only hides the island
 * card; the ask itself stays pending and keeps waiting in the Home inbox.
 */
export const useIslandDismissals = () => {
  const keys = useGlobalStore((s) => s.status.dismissedIslandItemKeys);
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const dismissed = useMemo(() => new Set(keys), [keys]);

  const dismiss = useCallback(
    (key: string) => {
      const current = useGlobalStore.getState().status.dismissedIslandItemKeys || [];
      const next = appendDismissedIslandKey(current, key);
      if (next !== current) updateSystemStatus({ dismissedIslandItemKeys: next });
    },
    [updateSystemStatus],
  );

  return { dismiss, dismissed };
};
