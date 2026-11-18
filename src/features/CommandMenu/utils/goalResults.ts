import type { GoalStatus } from '@lobechat/const/goal';
import { goalStatuses } from '@lobechat/const/goal';

import type { FtsSearchResult } from '@/database/repositories/ftsSearch';
import { goalStatusKey } from '@/features/AgentGoals/goalPresentation';

/**
 * Goals sit behind a lab: with it off their routes redirect away, so the menu
 * shows none — an explicit `type:goal` search included.
 */
export const withoutGatedGoals = (
  results: FtsSearchResult[] | undefined,
  goalsEnabled: boolean,
): FtsSearchResult[] | undefined =>
  goalsEnabled || !results ? results : results.filter((result) => result.type !== 'goal');

/**
 * The goal list's status label key for a search hit (`failed` reads as "Needs
 * attention"), or `undefined` for a status this client does not know.
 */
export const goalResultStatusKey = (status: string) =>
  (goalStatuses as readonly string[]).includes(status)
    ? goalStatusKey(status as GoalStatus)
    : undefined;
