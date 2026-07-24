import { useMemo } from 'react';
import { matchRoutes } from 'react-router';

import { selectActiveTabUrl } from '@/features/Electron/shell/activeTabUrl';
import { mainAreaMetaRoutes } from '@/spa/router/desktopRouter.config';
import { useElectronStore } from '@/store/electron';

// Sidebar subtrees are portal'd into the shell (frozen root router), so raw
// `useParams` there resolves the boot url. Derive params from the active tab's
// url against the same meta route tree the tab routers are built from.
export const useActiveRouteParams = <
  T extends Record<string, string | undefined> = Record<string, string | undefined>,
>(): Readonly<T> => {
  const url = useElectronStore(selectActiveTabUrl) ?? '/';
  return useMemo(() => {
    const matches = matchRoutes(mainAreaMetaRoutes, url) ?? [];
    return (matches.at(-1)?.params ?? {}) as T;
  }, [url]);
};
