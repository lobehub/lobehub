import type { LoaderFunctionArgs } from 'react-router';

import { PRE_PAINT_HYDRATE_TIMEOUT, settleWithin } from '@/libs/replica/prePaint';
import { useUserMemoryStore } from '@/store/userMemory';

/**
 * Seed the persisted preference page set for the query the route URL encodes.
 *
 * Route loaders run before React commits the route: the only point where the
 * persisted list (an async read) can land before the page paints its loading
 * skeleton. Without the URL's `q`, a bookmarked `/memory/preferences?q=foo`
 * would wait on the unfiltered entry and still mount into a skeleton.
 *
 * Only `q` is taken from the URL: the page's first paint is the timeline query,
 * whose `sort` is undefined (the sort control only exists in grid mode, which is
 * not part of the URL). Hydrating the URL's `sort` would key a different entry
 * and miss the one the page requests first.
 */
export const preferenceListLoader = async ({ request }: LoaderFunctionArgs): Promise<null> => {
  const q = new URL(request.url).searchParams.get('q') || undefined;

  await settleWithin(
    useUserMemoryStore.getState().preHydratePreferences({ q }),
    PRE_PAINT_HYDRATE_TIMEOUT,
  );

  return null;
};
