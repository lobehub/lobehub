import type { LoaderFunctionArgs } from 'react-router';

import { preHydrateResourceAccess } from '@/features/ResourcePermission/accessLoader';
import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { pageActions } from '@/store/page';

// Route loaders run before React commits the route: the only point where the
// persisted page list (an async read) can land before the sidebar paints its
// loading skeleton. A page route also seeds the page's persisted access record,
// which the editor and the Permission page decide from.
export const pageListLoader = async ({ params }: LoaderFunctionArgs): Promise<null> => {
  await Promise.all([
    settleWithin(pageActions.preHydrate(), PRE_PAINT_HYDRATE_TIMEOUT),
    preHydrateResourceAccess('document', params.id),
  ]);

  return null;
};
