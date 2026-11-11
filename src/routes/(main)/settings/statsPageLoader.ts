import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { statsActions } from '@/store/stats';

/**
 * Route loader for the Settings → Stats tab.
 *
 * Route loaders run before React commits the route: the only point where the
 * persisted stats (async IndexedDB reads) can land before the cards paint their
 * loading state.
 */
export const statsPageLoader = async (): Promise<null> => {
  await settleWithin(statsActions.preHydrateStatsPage(), PRE_PAINT_HYDRATE_TIMEOUT);

  return null;
};
