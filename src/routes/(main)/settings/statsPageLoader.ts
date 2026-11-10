import type { LoaderFunctionArgs } from 'react-router';

import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { SettingsTabs } from '@/store/global/initialState';
import { statsActions } from '@/store/stats';

/**
 * Route loader for the settings tab route (`/settings/:tab`); only the stats
 * tab has anything to seed.
 *
 * Route loaders run before React commits the route: the only point where the
 * persisted stats (async IndexedDB reads) can land before the cards paint their
 * loading state.
 */
export const statsPageLoader = async ({ params }: LoaderFunctionArgs): Promise<null> => {
  if (params.tab !== SettingsTabs.Stats) return null;

  await settleWithin(statsActions.preHydrateStatsPage(), PRE_PAINT_HYDRATE_TIMEOUT);

  return null;
};
