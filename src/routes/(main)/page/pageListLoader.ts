import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { pageActions } from '@/store/page';

// Route loaders run before React commits the route: the only point where the
// persisted page list (an async read) can land before the sidebar paints its
// loading skeleton.
export const pageListLoader = async (): Promise<null> => {
  await settleWithin(pageActions.preHydrate(), PRE_PAINT_HYDRATE_TIMEOUT);

  return null;
};
