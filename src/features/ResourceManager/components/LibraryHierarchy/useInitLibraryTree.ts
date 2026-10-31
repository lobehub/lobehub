import { useLayoutEffect } from 'react';

import { useResourceManagerStore } from '@/features/ResourceManager/store';
import { useActiveRouteParams } from '@/hooks/useActiveRouteParams';
import { useTreeStore } from '@/store/tree';

/**
 * The library the sidebar tree shows, initialised before the first paint.
 *
 * The page segment copies the route's library into the ResourceManager store
 * only once its own (lazy) chunk mounts. The sidebar mounts with the layout, so
 * it reads the route first: waiting for the store kept the persisted tree behind
 * a skeleton for as long as the page took to load. It reads the *active* route:
 * Electron portals the sidebar into the shell's frozen root router, where raw
 * `useParams` keeps answering with the boot tab's library.
 *
 * The same pre-paint effect copies the route's library into the store: the
 * sidebar's row actions (navigate, create, upload) read it from there, and must
 * not act on the previous library while this one's cached rows are on screen.
 *
 * `init` runs in a layout effect, so the tree it seeds from the persisted
 * snapshot is already in the first painted frame.
 */
export const useInitLibraryTree = (): string | undefined => {
  const { id: routeLibraryId } = useActiveRouteParams<{ id?: string }>();
  const storeLibraryId = useResourceManagerStore((s) => s.libraryId);
  const setLibraryId = useResourceManagerStore((s) => s.setLibraryId);
  const init = useTreeStore((s) => s.init);
  const libraryId = routeLibraryId ?? storeLibraryId;

  useLayoutEffect(() => {
    if (!libraryId) return;
    if (routeLibraryId) setLibraryId(routeLibraryId);
    init(libraryId);
  }, [libraryId, routeLibraryId, init, setLibraryId]);

  return libraryId;
};
