import type { GoalStatus } from '@lobechat/const/goal';
import { goalStatuses } from '@lobechat/const/goal';

import { goalStatusKey } from '@/features/AgentGoals/goalPresentation';

/**
 * The goal list's status label key for a search hit (`failed` reads as "Needs
 * attention"), or `undefined` for a status this client does not know.
 */
export const goalResultStatusKey = (status: string) =>
  (goalStatuses as readonly string[]).includes(status)
    ? goalStatusKey(status as GoalStatus)
    : undefined;
