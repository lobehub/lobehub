import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { getUserMemoryStoreState } from '@/store/userMemory';

import { identityListParamsOf } from './identityListParams';

// Route loaders run before React commits the route: the only point where the
// persisted identity list (an async read) can land before the page paints its
// loading state. It hydrates the query the URL asks for — a different query's
// row would fill the replica slot and block the page's own hydrate.
export const identitiesListLoader = async ({
  request,
}: { request?: Request } = {}): Promise<null> => {
  const search = request ? new URL(request.url).searchParams : undefined;
  const params = identityListParamsOf(search?.get('q'), search?.get('type'));

  await settleWithin(
    getUserMemoryStoreState().preHydrateIdentities(params),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );

  return null;
};
