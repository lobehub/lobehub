import type { LoaderFunctionArgs } from 'react-router';

// The route tables sit in the entry chunk's static graph; resolving the real
// loader on first use keeps the userMemory store in the preferences route's
// lazy chunks. The loader arguments carry the request, so the pre-hydrate can
// target the query the URL encodes.
export const preferenceListLoader = (args: LoaderFunctionArgs) =>
  import('@/routes/(main)/memory/preferences/preferencesLoader').then((module) =>
    module.preferenceListLoader(args),
  );
