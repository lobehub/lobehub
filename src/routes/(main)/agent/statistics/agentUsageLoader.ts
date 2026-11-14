import type { LoaderFunctionArgs } from 'react-router';

import { agentUsageParams, DEFAULT_GRANULARITY, DEFAULT_RANGE } from '@/features/AgentUsage/hooks';
import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { statsActions } from '@/store/stats';

/**
 * Route loader for an agent's usage tab (`/agent/:aid/statistics`).
 *
 * Route loaders run before React commits the route: the only point where the
 * persisted usage stats (an async IndexedDB read) can land before the tab
 * paints its loading state. Seeds the tab's initial range.
 */
export const agentUsageLoader = async ({ params }: LoaderFunctionArgs): Promise<null> => {
  if (!params.aid) return null;

  await settleWithin(
    statsActions.preHydrateAgentUsage(
      agentUsageParams(params.aid, DEFAULT_RANGE, DEFAULT_GRANULARITY),
    ),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );

  return null;
};
