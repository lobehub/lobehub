import type { LoaderFunctionArgs } from 'react-router';

import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { useTreeStore } from '@/store/tree';

/**
 * Seed the library sidebar's persisted tree before the route commits.
 *
 * Route loaders run before React paints the new route, so this is the one place
 * the (async) persisted read can land in time for the tree's first frame;
 * without it the sidebar paints its skeleton until the in-tree hydrate resolves.
 */
export const libraryTreeLoader = async ({ params }: LoaderFunctionArgs): Promise<null> => {
  if (params.id) {
    await settleWithin(useTreeStore.getState().preHydrate(params.id), PRE_PAINT_HYDRATE_TIMEOUT);
  }

  return null;
};
