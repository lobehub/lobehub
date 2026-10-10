import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { getUserMemoryStoreState } from '@/store/userMemory';

// Route loaders run before React commits the route: the only point where the
// persisted identity list (an async read) can land before the page paints its
// loading state.
export const identitiesListLoader = async (): Promise<null> => {
  await settleWithin(getUserMemoryStoreState().preHydrateIdentities(), PRE_PAINT_HYDRATE_TIMEOUT);

  return null;
};
