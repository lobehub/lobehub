import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { expertiseActions } from '@/store/expertise';

/**
 * Route loader for My rules (`/memory/rules`).
 *
 * Route loaders run before React commits the route: the only point where the
 * persisted rule sheet (an async IndexedDB read) can land before the page
 * paints its loader.
 */
export const memoryRulesLoader = async (): Promise<null> => {
  await settleWithin(expertiseActions.preHydrateRules(), PRE_PAINT_HYDRATE_TIMEOUT);

  return null;
};
