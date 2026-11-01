import { useMemo } from 'react';
import { matchRoutes } from 'react-router';

import { selectActiveTabUrl } from '@/features/Electron/shell/activeTabUrl';
import { mainAreaMetaRoutes } from '@/spa/router/desktopRouter.config';
import { useElectronStore } from '@/store/electron';

// Every consumer resolves the same active-tab url against the same module-level
// route tree, and the public `matchRoutes` takes no precomputed branches — it
// re-flattens and re-compiles the whole tree on each call. Caching the last url
// keeps that at one match per navigation instead of one per consumer, which
// otherwise grows with the sidebar's item count.
let cachedUrl: string | null = null;
let cachedParams: Record<string, string | undefined> = {};

const resolveActiveRouteParams = (url: string) => {
  if (url !== cachedUrl) {
    const matches = matchRoutes(mainAreaMetaRoutes, url) ?? [];
    cachedUrl = url;
    cachedParams = matches.at(-1)?.params ?? {};
  }

  return cachedParams;
};

// Sidebar subtrees are portal'd into the shell (frozen root router), so raw
// `useParams` there resolves the boot url. Derive params from the active tab's
// url against the same meta route tree the tab routers are built from.
export const useActiveRouteParams = <
  T extends Record<string, string | undefined> = Record<string, string | undefined>,
>(): Readonly<T> => {
  const url = useElectronStore(selectActiveTabUrl) ?? '/';
  return useMemo(() => resolveActiveRouteParams(url) as T, [url]);
};
